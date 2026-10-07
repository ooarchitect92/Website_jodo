import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Inject,
  Injectable,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Db } from './db';
import { AuthGuard, AuthedRequest, Roles } from './auth';
import { leadSchema, scoreLead, csvCell } from '../../../packages/core/src/contracts';
import { decrypt, digest, encrypt, keyed } from '../../../packages/core/src/security';
import { uuid } from './content';
@Injectable()
export class LeadsService {
  constructor(@Inject(Db) private db: Db) {}
  async accept(body: unknown, key: string, req: Request, chatId?: string) {
    const input = leadSchema.parse(body);
    z.string().uuid().parse(key);
    const fingerprint = keyed(JSON.stringify(input));
    return this.db.tx(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['lead:' + key]);
      const old = (
        await c.query('SELECT receipt,event_id,fingerprint FROM leads WHERE submission_key=$1', [
          key,
        ])
      ).rows[0];
      if (old) {
        if (old.fingerprint !== fingerprint)
          throw new ConflictException('This request key was already used with different details');
        return { status: 'accepted', receipt: old.receipt, eventId: old.event_id, replayed: true };
      }
      const form = (await c.query("SELECT value FROM settings WHERE key='form'")).rows[0]?.value;
      if (form?.revision !== input.formRevision)
        throw new UnprocessableEntityException(
          'The form has changed. Reload this page before submitting.',
        );
      let consentId = null;
      let touch = null;
      const consentToken = req.cookies?.jodo_consent;
      if (typeof consentToken === 'string') {
        const choice = (
          await c.query(
            "SELECT id FROM consent WHERE token_hash=$1 AND analytics=true AND expires_at>now() AND policy_version='2026-10-v1'",
            [digest(consentToken)],
          )
        ).rows[0];
        if (choice) {
          consentId = choice.id;
          touch =
            (
              await c.query(
                "SELECT id FROM acquisition WHERE consent_id=$1 AND created_at>now()-interval '30 days' ORDER BY created_at DESC LIMIT 1",
                [choice.id],
              )
            ).rows[0]?.id || null;
        }
      }
      const id = randomUUID(),
        eventId = randomUUID(),
        receipt = 'REQ-' + randomUUID().slice(0, 8).toUpperCase();
      await c.query(
        'INSERT INTO leads(id,receipt,event_id,submission_key,fingerprint,encrypted_fields,form_revision,source,consent_id,acquisition_id,chat_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [
          id,
          receipt,
          eventId,
          key,
          fingerprint,
          encrypt(input),
          input.formRevision,
          input.source,
          consentId,
          touch,
          chatId || null,
        ],
      );
      await c.query(
        "INSERT INTO outbox(event_id,type,aggregate_id,payload) VALUES($1,'lead.accepted',$2,$3)",
        [eventId, id, { formRevision: input.formRevision }],
      );
      await this.db.audit(c, 'visitor', 'lead.accepted', id, { source: input.source, eventId });
      return { status: 'accepted', receipt, eventId, replayed: false };
    });
  }
}
@Controller('v1/forms')
export class FormsController {
  constructor(@Inject(LeadsService) private leads: LeadsService) {}
  @Post('demo/submissions') submit(
    @Body() body: unknown,
    @Headers('idempotency-key') key: string,
    @Req() req: Request,
  ) {
    const v = leadSchema.parse(body);
    if (v.source !== 'form') throw new ForbiddenException('Use the conversation capture endpoint');
    return this.leads.accept(v, key, req);
  }
}
@Controller('v1/admin/leads')
@UseGuards(AuthGuard)
@Roles('owner', 'sales')
export class LeadsController {
  constructor(@Inject(Db) private db: Db) {}
  @Get() async list(@Req() req: AuthedRequest) {
    await this.db.tx((c) => this.db.audit(c, req.actor.id, 'leads.read', 'list'));
    const rows = await this.db.query('SELECT * FROM leads ORDER BY created_at DESC LIMIT 200');
    return rows.map((r) => {
      const fields = decrypt<z.infer<typeof leadSchema>>(r.encrypted_fields);
      return {
        id: r.id,
        receipt: r.receipt,
        stage: r.stage,
        version: r.version,
        createdAt: r.created_at,
        fields,
        score: scoreLead(fields),
        attribution: r.acquisition_id ? 'eligible_touch' : 'not_collected',
      };
    });
  }
  @Post(':id/stage') async stage(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    const v = z
      .object({
        stage: z.enum(['new', 'contacted', 'qualified', 'won', 'lost', 'spam']),
        expectedVersion: z.number().int().positive(),
        reason: z.string().min(3).max(200),
      })
      .strict()
      .parse(body);
    return this.db.tx(async (c) => {
      const row = (await c.query('SELECT * FROM leads WHERE id=$1 FOR UPDATE', [uuid(id)])).rows[0];
      if (!row || row.version !== v.expectedVersion)
        throw new ConflictException('Lead changed; reload');
      const allowed: Record<string, string[]> = {
        new: ['contacted', 'spam', 'lost'],
        contacted: ['qualified', 'lost', 'spam'],
        qualified: ['won', 'lost', 'contacted'],
        won: ['contacted'],
        lost: ['contacted'],
        spam: ['new'],
      };
      if (!allowed[row.stage]?.includes(v.stage))
        throw new ConflictException('That transition is not allowed');
      await c.query('UPDATE leads SET stage=$2,version=version+1,updated_at=now() WHERE id=$1', [
        id,
        v.stage,
      ]);
      await c.query(
        'INSERT INTO lead_activities(lead_id,actor_id,type,encrypted_note) VALUES($1,$2,$3,$4)',
        [id, req.actor.id, 'stage.' + v.stage, encrypt(v.reason)],
      );
      await this.db.audit(c, req.actor.id, 'lead.stage', id, { from: row.stage, to: v.stage });
      if (v.stage === 'qualified' || v.stage === 'won')
        await c.query(
          'INSERT INTO outbox(event_id,type,aggregate_id) VALUES(gen_random_uuid(),$1,$2)',
          ['lead.' + v.stage, id],
        );
      return { status: 'updated' };
    });
  }
  @Post('export') @Roles('owner') async export(@Req() req: AuthedRequest, @Res() res: Response) {
    const rows = await this.db.query('SELECT * FROM leads ORDER BY created_at DESC LIMIT 5000');
    await this.db.tx((c) =>
      this.db.audit(c, req.actor.id, 'leads.export', 'csv', { count: rows.length }),
    );
    const text = [
      'Receipt,Name,Email,Institute,Stage,Created',
      ...rows.map((r) => {
        const f = decrypt(r.encrypted_fields);
        return [r.receipt, f.name, f.email, f.institute, r.stage, r.created_at.toISOString()]
          .map(csvCell)
          .join(',');
      }),
    ].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="leads.csv"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(text);
  }
}
