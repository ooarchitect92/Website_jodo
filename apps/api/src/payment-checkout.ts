import {
  BadGatewayException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { z } from 'zod';
import { Db } from './db';
import { payerCheckoutRequestSchema } from '../../../packages/core/src/contracts';
import { digest, token } from '../../../packages/core/src/security';

const providerResponseSchema = z
  .object({
    providerReference: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._:-]{3,120}$/),
    checkoutUrl: z.string().trim().min(8).max(1200),
    expiresAt: z.iso.datetime().optional(),
  })
  .strict();

function configuredHosts() {
  return new Set(
    (process.env.PAYMENT_CHECKOUT_ALLOWED_HOSTS || '')
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

export function checkoutProviderEnabled() {
  return process.env.PAYMENT_CHECKOUT_MODE === 'redirect_api';
}

@Controller('v1/payer')
export class PayerCheckoutController {
  constructor(@Inject(Db) private db: Db) {}

  private async access(rawToken: string) {
    if (!/^[A-Za-z0-9_-]{30,100}$/.test(rawToken))
      throw new ConflictException('Portal link is invalid or expired');
    const row = (
      await this.db.query(
        `SELECT t.schedule_id,s.account_reference,s.currency,s.status,
                p.id AS payer_id,p.active
         FROM payer_access_tokens t
         JOIN fee_schedules s ON s.id=t.schedule_id
         JOIN fee_payers p ON p.id=s.payer_id
         WHERE t.token_hash=$1 AND t.revoked_at IS NULL AND t.expires_at>now()`,
        [digest(rawToken)],
      )
    )[0];
    if (!row || !row.active) throw new ConflictException('Portal link is invalid or expired');
    if (row.status !== 'active') throw new ConflictException('This fee schedule is not payable');
    return row;
  }

  @Post(':token/checkout')
  async create(@Param('token') rawToken: string, @Body() body: unknown) {
    if (!checkoutProviderEnabled())
      throw new ServiceUnavailableException('Hosted payment checkout is not activated');

    const provider = process.env.PAYMENT_PROVIDER_NAME!;
    const createUrl = safeProviderUrl(
      process.env.PAYMENT_CHECKOUT_CREATE_URL || '',
      'PAYMENT_CHECKOUT_CREATE_URL',
    );
    const secret = process.env.PAYMENT_CHECKOUT_API_KEY!;
    const timeoutMs = Number(process.env.PAYMENT_CHECKOUT_TIMEOUT_MS || 5000);
    const v = payerCheckoutRequestSchema.parse(body);
    const access = await this.access(rawToken);

    const existing = (
      await this.db.query(
        `SELECT id,schedule_id,installment_id,payer_id,amount_minor,currency,status,checkout_url,expires_at
         FROM payment_checkout_sessions
         WHERE idempotency_key=$1`,
        [v.idempotencyKey],
      )
    )[0];
    if (existing) {
      if (
        existing.schedule_id !== access.schedule_id ||
        existing.installment_id !== v.installmentId ||
        existing.payer_id !== access.payer_id ||
        Number(existing.amount_minor) !== v.amountMinor
      )
        throw new ConflictException('Checkout idempotency key was reused with different details');
      if (existing.status === 'created' && existing.checkout_url)
        return {
          sessionId: existing.id,
          status: existing.status,
          checkoutUrl: existing.checkout_url,
          expiresAt: existing.expires_at,
        };
      throw new ConflictException('This checkout attempt is no longer reusable');
    }

    const returnToken = token();
    const session = await this.db.tx(async (c) => {
      const installment = (
        await c.query(
          `SELECT i.id,i.schedule_id,i.amount_minor,i.paid_amount_minor,i.status,
                  s.currency,s.payer_id
           FROM fee_installments i
           JOIN fee_schedules s ON s.id=i.schedule_id
           WHERE i.id=$1 AND i.schedule_id=$2
           FOR UPDATE OF i,s`,
          [v.installmentId, access.schedule_id],
        )
      ).rows[0];
      if (!installment)
        throw new ConflictException('Installment does not belong to this fee account');
      if (installment.status === 'paid' || installment.status === 'cancelled')
        throw new ConflictException('This installment is not payable');
      const remaining = Number(installment.amount_minor) - Number(installment.paid_amount_minor);
      if (v.amountMinor > remaining)
        throw new ConflictException('Checkout amount exceeds the outstanding installment balance');

      if (v.allocations.length) {
        const componentRows = (
          await c.query(
            `SELECT fc.code,fc.amount_minor,
                    coalesce((
                      SELECT sum(pa.amount_minor)
                      FROM payment_component_allocations pa
                      JOIN payment_records pr ON pr.id=pa.payment_id
                      WHERE pr.schedule_id=$1 AND pa.component_code=fc.code
                    ),0)::bigint AS paid_minor
             FROM fee_schedule_components fc
             WHERE fc.schedule_id=$1`,
            [access.schedule_id],
          )
        ).rows;
        const components = new Map(
          componentRows.map((row) => [
            row.code,
            Math.max(0, Number(row.amount_minor) - Number(row.paid_minor || 0)),
          ]),
        );
        for (const allocation of v.allocations) {
          const available = components.get(allocation.componentCode);
          if (available === undefined)
            throw new ConflictException('Unknown fee component allocation');
          if (allocation.amountMinor > available)
            throw new ConflictException('Fee component allocation exceeds its remaining amount');
        }
      }

      const row = (
        await c.query(
          `INSERT INTO payment_checkout_sessions(
             schedule_id,installment_id,payer_id,idempotency_key,provider,return_token_hash,
             amount_minor,currency,status
           ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'requested')
           RETURNING id,schedule_id,installment_id,payer_id,amount_minor,currency,status,created_at`,
          [
            access.schedule_id,
            v.installmentId,
            access.payer_id,
            v.idempotencyKey,
            provider,
            digest(returnToken),
            v.amountMinor,
            access.currency,
          ],
        )
      ).rows[0];

      for (const allocation of v.allocations)
        await c.query(
          `INSERT INTO payment_checkout_allocations(session_id,component_code,amount_minor)
           VALUES($1,$2,$3)`,
          [row.id, allocation.componentCode, allocation.amountMinor],
        );

      await this.db.audit(c, 'payer:' + access.payer_id, 'fees.checkout.requested', row.id, {
        scheduleId: access.schedule_id,
        installmentId: v.installmentId,
        amountMinor: v.amountMinor,
        currency: access.currency,
        allocationCount: v.allocations.length,
      });
      return row;
    });

    const returnUrl =
      process.env.SITE_URL!.replace(/\/$/, '') +
      '/payment/return/' +
      encodeURIComponent(returnToken) +
      '/';
    const requestBody = JSON.stringify({
      merchantSessionId: session.id,
      installmentId: session.installment_id,
      amountMinor: Number(session.amount_minor),
      currency: session.currency,
      returnUrl,
      metadata: {
        scheduleId: session.schedule_id,
        checkoutSessionId: session.id,
      },
    });

    let providerResult: z.infer<typeof providerResponseSchema>;
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
      providerResult = providerResponseSchema.parse(await response.json());
      safeProviderUrl(providerResult.checkoutUrl, 'Provider checkout URL');
    } catch {
      await this.db.tx(async (c) => {
        await c.query(
          `UPDATE payment_checkout_sessions
           SET status='failed',failure_code='PROVIDER_CREATE_FAILED',updated_at=now()
           WHERE id=$1 AND status='requested'`,
          [session.id],
        );
        await this.db.audit(c, 'payer:' + access.payer_id, 'fees.checkout.failed', session.id, {
          code: 'PROVIDER_CREATE_FAILED',
        });
      });
      throw new BadGatewayException('The payment provider could not create a checkout session');
    }

    const created = await this.db.tx(async (c) => {
      const row = (
        await c.query(
          `UPDATE payment_checkout_sessions
           SET provider_reference=$2,checkout_url=$3,status='created',
               expires_at=coalesce($4::timestamptz,now()+interval '30 minutes'),updated_at=now()
           WHERE id=$1 AND status='requested'
           RETURNING id,status,checkout_url,expires_at,provider_reference`,
          [
            session.id,
            providerResult.providerReference,
            providerResult.checkoutUrl,
            providerResult.expiresAt || null,
          ],
        )
      ).rows[0];
      if (!row) throw new ConflictException('Checkout session changed before provider activation');
      await this.db.audit(c, 'payer:' + access.payer_id, 'fees.checkout.created', session.id, {
        provider,
        providerReference: providerResult.providerReference,
        expiresAt: row.expires_at,
      });
      return row;
    });

    return {
      sessionId: created.id,
      status: created.status,
      checkoutUrl: created.checkout_url,
      expiresAt: created.expires_at,
    };
  }
}

@Controller('v1/payment-return')
export class PaymentReturnController {
  constructor(@Inject(Db) private db: Db) {}

  @Get(':token')
  async status(@Param('token') rawToken: string) {
    if (!/^[A-Za-z0-9_-]{30,100}$/.test(rawToken))
      throw new ConflictException('Payment return link is invalid');
    const row = (
      await this.db.query(
        `SELECT s.id,s.amount_minor,s.currency,
                CASE
                  WHEN s.status='created' AND s.expires_at<now() THEN 'expired'
                  ELSE s.status
                END AS status,
                s.created_at,s.updated_at,r.receipt_number
         FROM payment_checkout_sessions s
         LEFT JOIN fee_receipts r ON r.payment_id=s.completed_payment_id
         WHERE s.return_token_hash=$1`,
        [digest(rawToken)],
      )
    )[0];
    if (!row) throw new ConflictException('Payment return link is invalid');
    return {
      sessionId: row.id,
      amountMinor: row.amount_minor,
      currency: row.currency,
      status: row.status,
      receiptNumber: row.receipt_number || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
