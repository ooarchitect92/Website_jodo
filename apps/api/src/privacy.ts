import { Body, Controller, ForbiddenException, Get, Inject, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { z } from 'zod';
import { Db } from './db';
import { secureCookie } from './auth';
import {
  consentSchema,
  eventSchema,
  safePath,
  sanitizeCampaign,
} from '../../../packages/core/src/contracts';
import { digest, encrypt, token } from '../../../packages/core/src/security';
const sensitiveVisitorRoute = (path: string) =>
  new Set([
    'admin',
    'auth',
    'login',
    'privacy',
    'contact',
    'tools',
    'payer',
    'checkout',
    'payment',
    'payments',
    'fees',
    'mandates',
  ]).has(path.split('/')[1]);
@Controller('v1')
export class PrivacyController {
  constructor(@Inject(Db) private db: Db) {}
  async choice(req: Request) {
    const t = req.cookies?.jodo_consent;
    return typeof t === 'string'
      ? (
          await this.db.query(
            "SELECT * FROM consent WHERE token_hash=$1 AND expires_at>now() AND policy_version='2026-10-v1'",
            [digest(t)],
          )
        )[0]
      : null;
  }
  @Get('consent') async get(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    const row = await this.choice(req);
    return {
      analytics: row?.analytics || false,
      advertising: row?.advertising || false,
      chosen: !!row,
      policyVersion: '2026-10-v1',
    };
  }
  @Post('consent/choices') async set(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = consentSchema.parse(body);
    const old = await this.choice(req);
    const t = typeof req.cookies?.jodo_consent === 'string' ? req.cookies.jodo_consent : token();
    await this.db.tx(async (c) => {
      const row = (
        await c.query(
          "INSERT INTO consent(token_hash,analytics,advertising,policy_version) VALUES($1,$2,$3,$4) ON CONFLICT(token_hash) DO UPDATE SET analytics=$2,advertising=$3,policy_version=$4,updated_at=now(),expires_at=now()+interval '180 days' RETURNING id",
          [digest(t), v.analytics, v.advertising, v.policyVersion],
        )
      ).rows[0];
      await c.query(
        'INSERT INTO consent_history(consent_id,analytics,advertising,policy_version) VALUES($1,$2,$3,$4)',
        [row.id, v.analytics, v.advertising, v.policyVersion],
      );
      await this.db.audit(c, 'visitor', 'consent.change', row.id, {
        analytics: v.analytics,
        advertising: v.advertising,
        previousChoice: !!old,
      });
    });
    res.cookie('jodo_consent', t, { ...secureCookie(), maxAge: 180 * 86400000 });
    res.setHeader('Cache-Control', 'no-store');
    return { ...v, chosen: true };
  }
  @Post('events') async event(@Body() body: unknown, @Req() req: Request) {
    const v = eventSchema.parse(body);
    const choice = await this.choice(req);
    if (!choice?.analytics) throw new ForbiddenException('Analytics permission required');
    if (Math.abs(Date.now() - Date.parse(v.occurredAt)) > 300000)
      throw new ForbiddenException('Event outside allowed clock window');
    if (sensitiveVisitorRoute(v.route))
      return { status: 'suppressed', reason: 'sensitive_route' };
    await this.db.query(
      'INSERT INTO events(id,consent_id,name,route,action_id,occurred_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING',
      [v.id, choice.id, v.name, v.route, v.actionId || null, v.occurredAt],
    );
    return { status: 'recorded' };
  }
  @Post('attribution/touches') async touch(@Body() body: unknown, @Req() req: Request) {
    const v = z
      .object({ route: safePath, fields: z.record(z.string(), z.unknown()) })
      .strict()
      .parse(body);
    const choice = await this.choice(req);
    if (!choice?.analytics) throw new ForbiddenException('Analytics permission required');
    if (sensitiveVisitorRoute(v.route)) {
      return { status: 'suppressed', reason: 'sensitive_route' };
    }
    const fields = sanitizeCampaign(v.fields);
    if (!Object.keys(fields).length) return { status: 'not_collected' };
    const rows = await this.db.query(
      'INSERT INTO acquisition(consent_id,fields,route) VALUES($1,$2,$3) RETURNING id',
      [choice.id, fields, v.route],
    );
    return { status: 'recorded', reference: rows[0]!.id };
  }
  @Post('privacy/requests') async rights(@Body() body: unknown) {
    const v = z
      .object({ email: z.email().max(200), kind: z.enum(['access', 'correction', 'deletion']) })
      .strict()
      .parse(body);
    await this.db.tx(async (c) => {
      const rows = await c.query(
        'INSERT INTO privacy_requests(encrypted_contact,kind) VALUES($1,$2) RETURNING id',
        [encrypt(v.email), v.kind],
      );
      await this.db.audit(c, 'visitor', 'privacy.request', rows.rows[0]!.id, {
        kind: v.kind,
      });
    });
    return {
      status: 'verification_required',
      message:
        'The operator must verify ownership before acting. This response does not confirm whether any matching records exist.',
    };
  }
}
