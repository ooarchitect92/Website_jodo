import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Inject,
  Post,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Request } from 'express';
import { Db } from './db';
import { paymentProviderEventSchema } from '../../../packages/core/src/contracts';

function safeEqualHex(a: string, b: string) {
  if (!/^[a-f0-9]{64}$/i.test(a) || !/^[a-f0-9]{64}$/i.test(b)) return false;
  const aa = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

@Controller('v1/provider/payments')
export class PaymentProviderController {
  constructor(@Inject(Db) private db: Db) {}

  @Get('status')
  status() {
    const enabled = process.env.PAYMENT_PROVIDER_MODE === 'signed_hmac';
    return {
      provider: enabled ? process.env.PAYMENT_PROVIDER_NAME : null,
      mode: enabled ? 'signed_hmac' : 'disabled',
      moneyMovement: false,
      note:
        'This endpoint accepts signed, normalized provider callbacks. Hosted checkout/payment initiation remains provider-specific.',
    };
  }

  @Post('webhook')
  @HttpCode(202)
  async webhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Body() body: unknown,
    @Headers('x-payment-signature') signature?: string,
    @Headers('x-payment-timestamp') timestamp?: string,
  ) {
    if (process.env.PAYMENT_PROVIDER_MODE !== 'signed_hmac')
      throw new ServiceUnavailableException('Payment provider webhook is not activated');

    const secret = process.env.PAYMENT_WEBHOOK_SECRET!;
    const provider = process.env.PAYMENT_PROVIDER_NAME!;
    const raw = req.rawBody;
    if (!raw?.length) throw new ForbiddenException('Raw signed payload is unavailable');

    const ts = Number(timestamp);
    const tolerance = Number(process.env.PAYMENT_WEBHOOK_TOLERANCE_SECONDS || 300);
    if (!Number.isInteger(ts) || Math.abs(Date.now() / 1000 - ts) > tolerance)
      throw new ForbiddenException('Webhook timestamp is outside the accepted window');

    const expected = createHmac('sha256', secret)
      .update(String(ts))
      .update('.')
      .update(raw)
      .digest('hex');
    const supplied = (signature || '').replace(/^sha256=/i, '');
    if (!safeEqualHex(expected, supplied))
      throw new ForbiddenException('Webhook signature is invalid');

    const event = paymentProviderEventSchema.parse(body);
    const bodyHash = createHash('sha256').update(raw).digest('hex');

    return this.db.tx(async (c) => {
      const inserted = (
        await c.query(
          `INSERT INTO payment_provider_events(
             provider,provider_event_id,event_type,body_hash,normalized_payload
           ) VALUES($1,$2,$3,$4,$5)
           ON CONFLICT(provider,provider_event_id) DO NOTHING
           RETURNING *`,
          [provider, event.eventId, event.type, bodyHash, event],
        )
      ).rows[0];

      if (!inserted) {
        const existing = (
          await c.query(
            `SELECT id,status,failure_code FROM payment_provider_events
             WHERE provider=$1 AND provider_event_id=$2`,
            [provider, event.eventId],
          )
        ).rows[0];
        return { accepted: true, duplicate: true, status: existing?.status || 'received' };
      }

      if (event.type === 'payment_failed') {
        await c.query(
          `UPDATE payment_provider_events
           SET status='applied',applied_at=now()
           WHERE id=$1`,
          [inserted.id],
        );
        await this.db.audit(c, 'provider:' + provider, 'payment.provider_failed', inserted.id, {
          providerEventId: event.eventId,
          providerReference: event.providerReference,
          installmentId: event.installmentId,
          amountMinor: event.amountMinor,
          currency: event.currency,
          reasonCode: event.reasonCode,
          occurredAt: event.occurredAt,
        });
        return { accepted: true, duplicate: false, status: 'applied' };
      }

      if (event.type === 'mandate_status') {
        const schedule = (
          await c.query('SELECT id FROM fee_schedules WHERE id=$1 FOR UPDATE', [event.scheduleId])
        ).rows[0];
        if (!schedule) {
          await c.query(
            `UPDATE payment_provider_events
             SET status='failed',failure_code='UNKNOWN_SCHEDULE'
             WHERE id=$1`,
            [inserted.id],
          );
          return { accepted: false, duplicate: false, status: 'failed', code: 'UNKNOWN_SCHEDULE' };
        }

        const existingMandate = (
          await c.query(
            `SELECT * FROM payment_mandates
             WHERE provider=$1 AND provider_reference=$2
             FOR UPDATE`,
            [provider, event.providerReference],
          )
        ).rows[0];

        const mandate = existingMandate
          ? (
              await c.query(
                `UPDATE payment_mandates
                 SET status=$2,last_event_at=$3,recorded_by=NULL,recorded_via='provider'
                 WHERE id=$1 RETURNING *`,
                [existingMandate.id, event.status, event.occurredAt],
              )
            ).rows[0]
          : (
              await c.query(
                `INSERT INTO payment_mandates(
                   schedule_id,rail,provider,provider_reference,status,last_event_at,recorded_by,recorded_via
                 ) VALUES($1,$2,$3,$4,$5,$6,NULL,'provider')
                 RETURNING *`,
                [
                  event.scheduleId,
                  event.rail,
                  provider,
                  event.providerReference,
                  event.status,
                  event.occurredAt,
                ],
              )
            ).rows[0];

        await c.query(
          `UPDATE payment_provider_events
           SET status='applied',applied_at=now()
           WHERE id=$1`,
          [inserted.id],
        );
        await this.db.audit(c, 'provider:' + provider, 'fees.mandate.provider_status', mandate.id, {
          providerEventId: event.eventId,
          scheduleId: event.scheduleId,
          rail: event.rail,
          status: event.status,
          occurredAt: event.occurredAt,
        });
        return { accepted: true, duplicate: false, status: 'applied' };
      }

      const installment = (
        await c.query(
          `SELECT i.*,s.status AS schedule_status,s.currency,s.account_reference,s.payer_id,
                  p.preferred_channel
           FROM fee_installments i
           JOIN fee_schedules s ON s.id=i.schedule_id
           LEFT JOIN fee_payers p ON p.id=s.payer_id
           WHERE i.id=$1
           FOR UPDATE OF i,s`,
          [event.installmentId],
        )
      ).rows[0];

      const fail = async (code: string) => {
        await c.query(
          `UPDATE payment_provider_events
           SET status='failed',failure_code=$2
           WHERE id=$1`,
          [inserted.id, code],
        );
        await this.db.audit(c, 'provider:' + provider, 'payment.provider_rejected', inserted.id, {
          providerEventId: event.eventId,
          code,
        });
        return { accepted: false, duplicate: false, status: 'failed', code };
      };

      if (!installment) return fail('UNKNOWN_INSTALLMENT');
      if (installment.schedule_status !== 'active') return fail('SCHEDULE_NOT_ACTIVE');
      if (installment.status === 'cancelled') return fail('INSTALLMENT_CANCELLED');
      if (installment.currency !== event.currency) return fail('CURRENCY_MISMATCH');

      const existingPayment = (
        await c.query(
          `SELECT id FROM payment_records
           WHERE provider=$1 AND provider_reference=$2`,
          [provider, event.providerReference],
        )
      ).rows[0];
      if (existingPayment) {
        await c.query(
          `UPDATE payment_provider_events
           SET status='ignored',failure_code='DUPLICATE_PROVIDER_REFERENCE',applied_at=now()
           WHERE id=$1`,
          [inserted.id],
        );
        return {
          accepted: true,
          duplicate: true,
          status: 'ignored',
          code: 'DUPLICATE_PROVIDER_REFERENCE',
        };
      }

      const remaining = Number(installment.amount_minor) - Number(installment.paid_amount_minor);
      if (event.amountMinor > remaining) return fail('AMOUNT_EXCEEDS_BALANCE');

      const payment = (
        await c.query(
          `INSERT INTO payment_records(
             schedule_id,installment_id,idempotency_key,provider,provider_reference,
             amount_minor,currency,evidence_note,recorded_by,recorded_via,provider_event_id
           ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,NULL,'provider',$9)
           RETURNING *`,
          [
            installment.schedule_id,
            event.installmentId,
            randomUUID(),
            provider,
            event.providerReference,
            event.amountMinor,
            event.currency,
            'Verified signed provider webhook ' + event.eventId,
            inserted.id,
          ],
        )
      ).rows[0];

      const nextPaid = Number(installment.paid_amount_minor) + event.amountMinor;
      const nextStatus = nextPaid === Number(installment.amount_minor) ? 'paid' : 'part_paid';
      await c.query(
        'UPDATE fee_installments SET paid_amount_minor=$2,status=$3 WHERE id=$1',
        [event.installmentId, nextPaid, nextStatus],
      );

      const open = (
        await c.query(
          `SELECT count(*)::int AS count
           FROM fee_installments
           WHERE schedule_id=$1 AND status NOT IN('paid','cancelled')`,
          [installment.schedule_id],
        )
      ).rows[0]!.count;
      if (open === 0)
        await c.query(
          `UPDATE fee_schedules
           SET status='completed',version=version+1,updated_at=now()
           WHERE id=$1`,
          [installment.schedule_id],
        );

      const receiptNumber = 'RCP-' + randomUUID().slice(0, 8).toUpperCase();
      const receipt = (
        await c.query(
          `INSERT INTO fee_receipts(payment_id,receipt_number,snapshot)
           VALUES($1,$2,$3)
           RETURNING id,receipt_number,issued_at`,
          [
            payment.id,
            receiptNumber,
            {
              scheduleId: installment.schedule_id,
              accountReference: installment.account_reference,
              installmentId: event.installmentId,
              amountMinor: event.amountMinor,
              currency: event.currency,
              providerReference: event.providerReference,
              provider,
              providerEventId: event.eventId,
              occurredAt: event.occurredAt,
            },
          ],
        )
      ).rows[0];

      const outboxEventId = randomUUID();
      const payerCommunication = Boolean(
        installment.payer_id &&
          installment.preferred_channel &&
          installment.preferred_channel !== 'none',
      );
      await c.query(
        `INSERT INTO outbox(event_id,type,aggregate_id,payload)
         VALUES($1,'payment.external_confirmed',$2,$3)`,
        [
          outboxEventId,
          payment.id,
          {
            scheduleId: installment.schedule_id,
            amountMinor: event.amountMinor,
            receiptId: receipt.id,
            receiptNumber: receipt.receipt_number,
            payerCommunication,
          },
        ],
      );

      if (payerCommunication) {
        await c.query(
          `INSERT INTO fee_communication_log(
             event_id,schedule_id,installment_id,payer_id,channel,kind,status
           ) VALUES($1,$2,$3,$4,$5,'receipt','pending')`,
          [
            outboxEventId,
            installment.schedule_id,
            event.installmentId,
            installment.payer_id,
            installment.preferred_channel,
          ],
        );
      }

      await c.query(
        `UPDATE payment_provider_events
         SET status='applied',applied_at=now()
         WHERE id=$1`,
        [inserted.id],
      );
      await this.db.audit(c, 'provider:' + provider, 'fees.payment.provider_confirmed', payment.id, {
        providerEventId: event.eventId,
        providerReference: event.providerReference,
        installmentId: event.installmentId,
        amountMinor: event.amountMinor,
        currency: event.currency,
        occurredAt: event.occurredAt,
        receiptNumber: receipt.receipt_number,
        outboxEventId,
      });

      return {
        accepted: true,
        duplicate: false,
        status: 'applied',
        paymentId: payment.id,
        receiptNumber: receipt.receipt_number,
      };
    });
  }
}

@Controller('v1/admin/fees/provider-events')
export class PaymentProviderAdminController {
  constructor(@Inject(Db) private db: Db) {}

  @Get()
  async list() {
    return this.db.query(
      `SELECT id,provider,provider_event_id,event_type,status,failure_code,received_at,applied_at
       FROM payment_provider_events
       ORDER BY received_at DESC
       LIMIT 300`,
    );
  }
}
