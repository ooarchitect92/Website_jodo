import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Inject,
  NotFoundException,
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
import { decrypt, encrypt, keyed } from '../../../packages/core/src/security';
import { uuid } from './content';
import { csvCell } from '../../../packages/core/src/contracts';

const domainSchema = z
  .string()
  .max(253)
  .regex(/^[a-z0-9-]+(?:[.][a-z0-9-]+)+$/);
const formSettingsSchema = z
  .object({
    title: z.string().trim().min(3).max(120),
    notice: z.string().trim().min(30).max(1000),
    success: z.string().trim().min(5).max(240),
    enabled: z.boolean(),
  })
  .strict();
const enquirySchema = z
  .object({
    hostname: domainSchema,
    revision: z.number().int().positive(),
    name: z.string().trim().min(2).max(120),
    email: z.email().max(200),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[\d ()-]{8,20}$/),
    message: z.string().trim().min(5).max(1500),
    noticeAccepted: z.literal(true),
    website: z.string().max(0).default(''),
  })
  .strict();

@Controller('v1/admin/tenant/enquiries')
@UseGuards(AuthGuard)
@Roles('owner', 'sales')
export class TenantEnquiriesAdminController {
  constructor(@Inject(Db) private db: Db) {}
  @Get() async list(@Req() req: AuthedRequest) {
    const rows = await this.db.query(
      `SELECT id,receipt,stage,version,encrypted_fields,created_at
       FROM tenant_enquiries WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 200`,
      [req.actor.tenantId],
    );
    await this.db.tx((c) =>
      this.db.audit(c, req.actor.id, 'tenant.enquiries.read', req.actor.tenantId),
    );
    return rows.map((r) => ({
      id: r.id,
      receipt: r.receipt,
      stage: r.stage,
      version: r.version,
      createdAt: r.created_at,
      fields: decrypt(r.encrypted_fields),
    }));
  }

  @Post('export')
  @Roles('owner')
  async export(@Req() req: AuthedRequest, @Res() res: Response) {
    // Export the active institution only. Keep staff notes out of the bulk file.
    const rows = await this.db.query(
      `SELECT receipt,stage,encrypted_fields,created_at
       FROM tenant_enquiries WHERE tenant_id=$1
       ORDER BY created_at DESC,id DESC LIMIT 5000`,
      [req.actor.tenantId],
    );
    const cells = rows.map((row) => {
      const fields = decrypt<{
        name: string;
        email: string;
        phone: string;
        message: string;
      }>(row.encrypted_fields);
      return [
        row.receipt,
        fields.name,
        fields.email,
        fields.phone,
        fields.message,
        row.stage,
        row.created_at.toISOString(),
      ]
        .map(csvCell)
        .join(',');
    });
    // Confirm authorization and audit the exact export before returning any private data.
    await this.db.tx((c) =>
      this.db.audit(c, req.actor.id, 'tenant.enquiries.export', req.actor.tenantId, {
        tenantId: req.actor.tenantId,
        count: rows.length,
        format: 'csv',
      }),
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="institution-enquiries.csv"');
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(['Receipt,Name,Email,Phone,Message,Stage,Received', ...cells].join('\r\n'));
  }

  @Post(':id/stage')
  async stage(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const v = z
      .object({
        stage: z.enum(['new', 'contacted', 'qualified', 'closed', 'spam']),
        expectedVersion: z.number().int().positive(),
        reason: z.string().trim().min(3).max(500),
      })
      .strict()
      .parse(body);
    return this.db.tx(async (c) => {
      const row = (
        await c.query(
          'SELECT id,stage,version FROM tenant_enquiries WHERE id=$1 AND tenant_id=$2 FOR UPDATE',
          [uuid(id), req.actor.tenantId],
        )
      ).rows[0];
      if (!row || row.version !== v.expectedVersion)
        throw new ConflictException('Enquiry changed; reload before updating');
      const allowed: Record<string, string[]> = {
        new: ['contacted', 'closed', 'spam'],
        contacted: ['qualified', 'closed', 'spam'],
        qualified: ['contacted', 'closed'],
        closed: ['contacted'],
        spam: ['new'],
      };
      if (!allowed[row.stage]?.includes(v.stage))
        throw new ConflictException('That enquiry transition is not allowed');
      const updated = (
        await c.query(
          'UPDATE tenant_enquiries SET stage=$3,version=version+1,updated_at=now() WHERE id=$1 AND tenant_id=$2 RETURNING version',
          [row.id, req.actor.tenantId, v.stage],
        )
      ).rows[0];
      await c.query(
        `INSERT INTO tenant_enquiry_activities(
          enquiry_id,tenant_id,actor_id,from_stage,to_stage,encrypted_reason
        ) VALUES($1,$2,$3,$4,$5,$6)`,
        [row.id, req.actor.tenantId, req.actor.id, row.stage, v.stage, encrypt(v.reason)],
      );
      await this.db.audit(c, req.actor.id, 'tenant.enquiry.stage', row.id, {
        tenantId: req.actor.tenantId,
        from: row.stage,
        to: v.stage,
      });
      return { status: 'updated', stage: v.stage, version: updated.version };
    });
  }

  @Get(':id/history')
  async history(@Param('id') id: string, @Req() req: AuthedRequest) {
    const rows = await this.db.query(
      `SELECT a.id,a.from_stage,a.to_stage,a.encrypted_reason,a.created_at,u.email
       FROM tenant_enquiry_activities a
       JOIN users u ON u.id=a.actor_id
       JOIN tenant_enquiries e ON e.id=a.enquiry_id AND e.tenant_id=a.tenant_id
       WHERE a.enquiry_id=$1 AND a.tenant_id=$2
       ORDER BY a.created_at ASC,a.id ASC LIMIT 200`,
      [uuid(id), req.actor.tenantId],
    );
    // Keep the same response for missing and foreign-tenant enquiries.
    const exists = await this.db.query(
      'SELECT id FROM tenant_enquiries WHERE id=$1 AND tenant_id=$2',
      [uuid(id), req.actor.tenantId],
    );
    if (!exists.length) throw new NotFoundException('Enquiry not found');
    await this.db.tx((c) =>
      this.db.audit(c, req.actor.id, 'tenant.enquiry.history.read', id, {
        tenantId: req.actor.tenantId,
      }),
    );
    return rows.map((r) => ({
      id: r.id,
      from: r.from_stage,
      to: r.to_stage,
      reason: decrypt<string>(r.encrypted_reason),
      staff: r.email,
      createdAt: r.created_at,
    }));
  }
}

@Controller('v1/admin/tenant/enquiry-form')
@UseGuards(AuthGuard)
@Roles('owner')
export class TenantEnquiryFormAdminController {
  constructor(@Inject(Db) private db: Db) {}

  @Get() async form(@Req() req: AuthedRequest) {
    return (
      (
        await this.db.query(
          'SELECT revision,enabled,title,notice,success,updated_at FROM tenant_form_settings WHERE tenant_id=$1',
          [req.actor.tenantId],
        )
      )[0] || { enabled: false }
    );
  }

  @Post() async configure(@Req() req: AuthedRequest, @Body() body: unknown) {
    if (req.actor.tenantRole !== 'owner')
      throw new ForbiddenException('Only the institution owner may enable enquiry capture');
    const data = formSettingsSchema.parse(body);
    return this.db.tx(async (c) => {
      // Domain readiness and tenant lifecycle are enforced again on every public submission.
      if (data.enabled) {
        const ready = (
          await c.query(
            `SELECT t.id FROM tenants t JOIN tenant_domains d ON d.tenant_id=t.id
             WHERE t.id=$1 AND t.status IN('pilot','live') AND d.status='active' LIMIT 1`,
            [req.actor.tenantId],
          )
        ).rows[0];
        if (!ready)
          throw new ConflictException('Activate a website domain before enabling public enquiries');
      }
      const result = (
        await c.query(
          `INSERT INTO tenant_form_settings(tenant_id,title,notice,success,enabled,updated_by)
           VALUES($1,$2,$3,$4,$5,$6)
           ON CONFLICT(tenant_id) DO UPDATE
             SET title=excluded.title,notice=excluded.notice,success=excluded.success,
                 enabled=excluded.enabled,updated_by=excluded.updated_by,
                 revision=tenant_form_settings.revision+1,updated_at=now()
           RETURNING revision,enabled,title,notice,success`,
          [req.actor.tenantId, data.title, data.notice, data.success, data.enabled, req.actor.id],
        )
      ).rows[0];
      await this.db.audit(c, req.actor.id, 'tenant.form.configure', req.actor.tenantId, {
        enabled: data.enabled,
        revision: result.revision,
      });
      return result;
    });
  }
}

@Controller('v1/forms/tenant')
export class TenantEnquiryPublicController {
  constructor(@Inject(Db) private db: Db) {}

  @Post('submissions')
  async submit(
    @Body() body: unknown,
    @Headers('idempotency-key') key: string,
    @Req() req: Request,
  ) {
    const v = enquirySchema.parse(body);
    const submissionKey = z.uuid().parse(key);
    // Browser-origin equivalence is checked explicitly because public tenants use
    // domains that differ from the original site's global SITE_URL setting.
    if (req.headers.origin !== 'https://' + v.hostname)
      throw new ForbiddenException('Enquiries must originate from this institution website');

    const fingerprint = keyed(JSON.stringify(v));
    return this.db.tx(async (c) => {
      const active = (
        await c.query(
          `SELECT t.id,f.revision
           FROM tenant_domains d JOIN tenants t ON t.id=d.tenant_id
           JOIN tenant_form_settings f ON f.tenant_id=t.id
           WHERE d.hostname=$1 AND d.status='active'
             AND t.status IN('pilot','live') AND f.enabled=true`,
          [v.hostname],
        )
      ).rows[0];
      if (!active) throw new NotFoundException('Institution enquiry form is unavailable');
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        'tenant-enquiry:' + active.id + ':' + submissionKey,
      ]);
      const old = (
        await c.query(
          'SELECT receipt,event_id,fingerprint FROM tenant_enquiries WHERE tenant_id=$1 AND submission_key=$2',
          [active.id, submissionKey],
        )
      ).rows[0];
      if (old) {
        if (old.fingerprint !== fingerprint)
          throw new ConflictException('Submission key was already used with different details');
        return { status: 'accepted', receipt: old.receipt, eventId: old.event_id, replayed: true };
      }
      if (active.revision !== v.revision)
        throw new UnprocessableEntityException('Form settings changed; reload before submitting');

      const id = randomUUID();
      const eventId = randomUUID();
      const receipt = 'ENQ-' + randomUUID().slice(0, 8).toUpperCase();
      await c.query(
        `INSERT INTO tenant_enquiries(
          id,tenant_id,receipt,event_id,submission_key,fingerprint,encrypted_fields,form_revision
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, active.id, receipt, eventId, submissionKey, fingerprint, encrypt(v), v.revision],
      );
      await c.query(
        `INSERT INTO tasks(tenant_id,title,execution_key)
         VALUES($1,$2,$3)`,
        [active.id, 'Review institution enquiry ' + receipt, 'tenant-enquiry:' + id],
      );
      await c.query(
        `INSERT INTO outbox(event_id,type,aggregate_id,payload)
         VALUES($1,'tenant.enquiry.accepted',$2,$3)`,
        [eventId, id, { tenantId: active.id, receipt }],
      );
      await this.db.audit(c, 'visitor', 'tenant.enquiry.accepted', id, {
        tenantId: active.id,
        eventId,
      });
      return { status: 'accepted', receipt, eventId, replayed: false };
    });
  }
}
