import {
  BadGatewayException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { Db } from './db';
import { AuthGuard, AuthedRequest, Roles } from './auth';
import { payerMandateSetupSchema } from '../../../packages/core/src/contracts';
import { digest, token } from '../../../packages/core/src/security';

const providerMandateResponseSchema = z
  .object({
    providerReference: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._:-]{3,120}$/),
    authorizationUrl: z.string().trim().min(8).max(1200),
    expiresAt: z.iso.datetime().optional(),
  })
  .strict();

function configuredHosts() {
  return new Set(
    (process.env.AUTOPAY_ALLOWED_HOSTS || '')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  );
}

function safeProviderUrl(raw: string, label: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ServiceUnavailableException(label + ' is invalid');
  }
  if (url.username || url.password) throw new ServiceUnavailableException(label + ' is unsafe');
  const local =
    process.env.DEPLOYMENT_MODE !== 'production' &&
    ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
    throw new ServiceUnavailableException(label + ' must use HTTPS');
  if (!configuredHosts().has(url.hostname.toLowerCase()))
    throw new ServiceUnavailableException(label + ' host is not allowlisted');
  return url;
}

export function autopayProviderEnabled() {
  return process.env.AUTOPAY_PROVIDER_MODE === 'mandate_api';
}

@Controller('v1/payer')
export class PayerMandateController {
  constructor(@Inject(Db) private db: Db) {}

  private async access(rawToken: string) {
    if (!/^[A-Za-z0-9_-]{30,100}$/.test(rawToken))
      throw new ConflictException('Portal link is invalid or expired');
    const row = (
      await this.db.query(
        `SELECT t.schedule_id,s.tenant_id,s.account_reference,s.currency,s.total_amount_minor,s.status,
                p.id AS payer_id,p.active
         FROM payer_access_tokens t
         JOIN fee_schedules s ON s.id=t.schedule_id
         JOIN fee_payers p ON p.id=s.payer_id
         WHERE t.token_hash=$1 AND t.revoked_at IS NULL AND t.expires_at>now()`,
        [digest(rawToken)],
      )
    )[0];
    if (!row || !row.active) throw new ConflictException('Portal link is invalid or expired');
    if (row.status !== 'active') throw new ConflictException('This fee schedule is not active');
    return row;
  }

  @Post(':token/mandates')
  async create(@Param('token') rawToken: string, @Body() body: unknown) {
    if (!autopayProviderEnabled())
      throw new ServiceUnavailableException('Recurring payment setup is not activated');

    const provider = process.env.PAYMENT_PROVIDER_NAME!;
    const createUrl = safeProviderUrl(
      process.env.AUTOPAY_MANDATE_CREATE_URL || '',
      'AUTOPAY_MANDATE_CREATE_URL',
    );
    const secret = process.env.AUTOPAY_API_KEY!;
    const timeoutMs = Number(process.env.AUTOPAY_TIMEOUT_MS || 5000);
    const v = payerMandateSetupSchema.parse(body);
    const access = await this.access(rawToken);

    const existing = (
      await this.db.query(
        `SELECT id,schedule_id,payer_id,rail,status,authorization_url,expires_at
         FROM payment_mandate_setup_requests
         WHERE tenant_id=$1 AND idempotency_key=$2`,
        [access.tenant_id, v.idempotencyKey],
      )
    )[0];
    if (existing) {
      if (
        existing.schedule_id !== access.schedule_id ||
        existing.payer_id !== access.payer_id ||
        existing.rail !== v.rail
      )
        throw new ConflictException('Mandate idempotency key was reused with different details');
      if (existing.status === 'created' && existing.authorization_url)
        return {
          setupId: existing.id,
          status: existing.status,
          authorizationUrl: existing.authorization_url,
          expiresAt: existing.expires_at,
        };
      throw new ConflictException('This mandate setup attempt is no longer reusable');
    }

    const returnToken = token();
    const setup = await this.db.tx(async (c) => {
      const activeMandate = (
        await c.query(
          `SELECT id,status FROM payment_mandates
           WHERE schedule_id=$1 AND status='active'
           ORDER BY last_event_at DESC LIMIT 1`,
          [access.schedule_id],
        )
      ).rows[0];
      if (activeMandate) throw new ConflictException('An active mandate already exists');

      const open = (
        await c.query(
          `SELECT id,status FROM payment_mandate_setup_requests
           WHERE schedule_id=$1 AND status IN('requested','created')
             AND (expires_at IS NULL OR expires_at>now())
           ORDER BY created_at DESC LIMIT 1`,
          [access.schedule_id],
        )
      ).rows[0];
      if (open) throw new ConflictException('A mandate setup is already in progress');

      return (
        await c.query(
          `INSERT INTO payment_mandate_setup_requests(
             schedule_id,payer_id,idempotency_key,provider,rail,return_token_hash
           ) VALUES($1,$2,$3,$4,$5,$6)
           RETURNING id,schedule_id,payer_id,rail,status,created_at`,
          [
            access.schedule_id,
            access.payer_id,
            v.idempotencyKey,
            provider,
            v.rail,
            digest(returnToken),
          ],
        )
      ).rows[0];
    });

    const returnUrl =
      process.env.SITE_URL!.replace(/\/$/, '') +
      '/mandate/return/' +
      encodeURIComponent(returnToken) +
      '/';
    const requestBody = JSON.stringify({
      merchantSetupId: setup.id,
      scheduleId: access.schedule_id,
      payerReference: access.payer_id,
      accountReference: access.account_reference,
      rail: v.rail,
      currency: access.currency,
      maxAmountMinor: Number(access.total_amount_minor),
      returnUrl,
      metadata: { scheduleId: access.schedule_id, mandateSetupId: setup.id },
    });

    let providerResult: z.infer<typeof providerMandateResponseSchema>;
    try {
      const response = await fetch(createUrl, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + secret,
          'Content-Type': 'application/json',
          'Idempotency-Key': v.idempotencyKey,
        },
        body: requestBody,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error('PROVIDER_HTTP_' + response.status);
      providerResult = providerMandateResponseSchema.parse(await response.json());
      safeProviderUrl(providerResult.authorizationUrl, 'Provider authorization URL');
    } catch {
      await this.db.tx(async (c) => {
        await c.query(
          `UPDATE payment_mandate_setup_requests
           SET status='failed',failure_code='PROVIDER_CREATE_FAILED',updated_at=now()
           WHERE id=$1 AND status='requested'`,
          [setup.id],
        );
        await this.db.audit(c, 'payer:' + access.payer_id, 'fees.mandate_setup.failed', setup.id, {
          code: 'PROVIDER_CREATE_FAILED',
          rail: v.rail,
        });
      });
      throw new BadGatewayException('The payment provider could not create a mandate setup');
    }

    const created = await this.db.tx(async (c) => {
      const row = (
        await c.query(
          `UPDATE payment_mandate_setup_requests
           SET provider_reference=$2,authorization_url=$3,status='created',
               expires_at=coalesce($4::timestamptz,now()+interval '30 minutes'),updated_at=now()
           WHERE id=$1 AND status='requested'
           RETURNING id,status,authorization_url,expires_at,provider_reference`,
          [
            setup.id,
            providerResult.providerReference,
            providerResult.authorizationUrl,
            providerResult.expiresAt || null,
          ],
        )
      ).rows[0];
      if (!row) throw new ConflictException('Mandate setup state changed before provider response');
      await this.db.audit(c, 'payer:' + access.payer_id, 'fees.mandate_setup.created', setup.id, {
        rail: v.rail,
        providerReference: providerResult.providerReference,
      });
      return row;
    });

    return {
      setupId: created.id,
      status: created.status,
      authorizationUrl: created.authorization_url,
      expiresAt: created.expires_at,
    };
  }
}

@Controller('v1/mandate-return')
export class MandateReturnController {
  constructor(@Inject(Db) private db: Db) {}

  @Get(':token')
  async status(@Param('token') rawToken: string) {
    if (!/^[A-Za-z0-9_-]{30,100}$/.test(rawToken))
      throw new ConflictException('Mandate return token is invalid');
    const row = (
      await this.db.query(
        `SELECT r.id,r.rail,r.status,r.failure_code,r.expires_at,r.created_at,r.updated_at,
                s.account_reference
         FROM payment_mandate_setup_requests r
         JOIN fee_schedules s ON s.id=r.schedule_id
         WHERE r.return_token_hash=$1`,
        [digest(rawToken)],
      )
    )[0];
    if (!row) throw new ConflictException('Mandate return token is invalid');
    return row;
  }
}

@Controller('v1/admin/fees')
@UseGuards(AuthGuard)
@Roles('owner')
export class AutopayAdminController {
  constructor(@Inject(Db) private db: Db) {}

  @Get('mandate-setups')
  setups(@Req() req: AuthedRequest) {
    return this.db.query(
      `SELECT r.id,r.schedule_id,r.rail,r.provider,r.provider_reference,r.status,
              r.failure_code,r.expires_at,r.created_at,r.updated_at,s.account_reference
       FROM payment_mandate_setup_requests r
       JOIN fee_schedules s ON s.id=r.schedule_id
       WHERE r.tenant_id=$1
       ORDER BY r.created_at DESC LIMIT 300`,
      [req.actor.tenantId],
    );
  }

  @Get('autopay-attempts')
  attempts(@Req() req: AuthedRequest) {
    return this.db.query(
      `SELECT a.id,a.schedule_id,a.installment_id,a.mandate_id,a.provider,
              a.provider_reference,a.amount_minor,a.currency,a.attempt_no,a.status,
              a.failure_code,a.next_retry_at,a.submitted_at,a.completed_at,a.created_at,
              s.account_reference,i.sequence,i.due_date
       FROM autopay_debit_attempts a
       JOIN fee_schedules s ON s.id=a.schedule_id
       JOIN fee_installments i ON i.id=a.installment_id
       WHERE a.tenant_id=$1
       ORDER BY a.created_at DESC LIMIT 500`,
      [req.actor.tenantId],
    );
  }
}
