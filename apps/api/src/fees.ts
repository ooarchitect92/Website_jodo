import {
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Db } from './db';
import { AuthGuard, AuthedRequest, Roles } from './auth';
import { uuid } from './content';
import {
  externalPaymentRecordSchema,
  feeScheduleActivationSchema,
  feeScheduleCreateSchema,
  mandateRecordSchema,
  moneyMinor,
  refundRecordSchema,
} from '../../../packages/core/src/contracts';

const settlementSchema = z
  .object({
    providerReference: z.string().trim().regex(/^[A-Za-z0-9._:-]{3,120}$/),
    currency: z.literal('INR'),
    amountMinor: moneyMinor,
    status: z.enum(['pending', 'settled', 'failed']).default('pending'),
    expectedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    allocations: z
      .array(
        z
          .object({
            paymentId: z.uuid(),
            amountMinor: moneyMinor,
          })
          .strict(),
      )
      .max(200)
      .default([]),
  })
  .strict()
  .superRefine((v, ctx) => {
    const allocated = v.allocations.reduce((sum, x) => sum + x.amountMinor, 0);
    if (allocated > v.amountMinor)
      ctx.addIssue({
        code: 'custom',
        path: ['allocations'],
        message: 'Allocated payment total cannot exceed settlement amount',
      });
  });

@Controller('v1/admin/fees')
@UseGuards(AuthGuard)
@Roles('owner')
export class FeeOperationsController {
  constructor(@Inject(Db) private db: Db) {}

  @Get('overview')
  async overview() {
    const [summary, upcoming, mandates, reconciliation] = await Promise.all([
      this.db.query(
        `SELECT
          count(*)::int AS schedules,
          count(*) FILTER (WHERE status='active')::int AS active_schedules,
          coalesce(sum(total_amount_minor),0)::bigint AS scheduled_minor,
          coalesce((SELECT sum(amount_minor-refunded_amount_minor) FROM payment_records),0)::bigint AS confirmed_minor,
          coalesce((SELECT sum(amount_minor-paid_amount_minor) FROM fee_installments WHERE status NOT IN('paid','cancelled')),0)::bigint AS outstanding_minor,
          coalesce((SELECT sum(amount_minor-paid_amount_minor) FROM fee_installments WHERE due_date<current_date AND status NOT IN('paid','cancelled')),0)::bigint AS overdue_minor
        FROM fee_schedules`,
      ),
      this.db.query(
        `SELECT i.id,i.schedule_id,s.account_reference,i.sequence,i.due_date,i.amount_minor,i.paid_amount_minor,
          CASE
            WHEN i.status='paid' THEN 'paid'
            WHEN i.due_date<current_date THEN 'overdue'
            WHEN i.due_date=current_date THEN 'due'
            ELSE i.status
          END AS effective_status
        FROM fee_installments i
        JOIN fee_schedules s ON s.id=i.schedule_id
        WHERE s.status='active' AND i.status<>'cancelled'
        ORDER BY i.due_date,i.sequence
        LIMIT 100`,
      ),
      this.db.query(
        `SELECT status,count(*)::int AS count FROM payment_mandates GROUP BY status ORDER BY status`,
      ),
      this.db.query(
        `SELECT status,count(*)::int AS count FROM reconciliation_entries GROUP BY status ORDER BY status`,
      ),
    ]);
    return {
      summary: summary[0],
      upcoming,
      mandates,
      reconciliation,
      providerMode: 'external-evidence-recording',
      moneyMovement: false,
      note:
        'This module manages fee schedules and records externally confirmed payment evidence. It does not move money or perform lending.',
    };
  }

  @Get('schedules')
  async schedules() {
    return this.db.query(
      `SELECT s.*,
        coalesce(
          json_agg(
            json_build_object(
              'id',i.id,
              'sequence',i.sequence,
              'dueDate',i.due_date,
              'amountMinor',i.amount_minor,
              'paidAmountMinor',i.paid_amount_minor,
              'status',CASE
                WHEN i.status='paid' THEN 'paid'
                WHEN i.due_date<current_date AND i.status NOT IN('paid','cancelled') THEN 'overdue'
                WHEN i.due_date=current_date AND i.status NOT IN('paid','cancelled') THEN 'due'
                ELSE i.status
              END
            )
            ORDER BY i.sequence
          ) FILTER (WHERE i.id IS NOT NULL),
          '[]'::json
        ) AS installments
      FROM fee_schedules s
      LEFT JOIN fee_installments i ON i.schedule_id=s.id
      GROUP BY s.id
      ORDER BY s.created_at DESC
      LIMIT 200`,
    );
  }

  @Post('schedules')
  async createSchedule(@Body() body: unknown, @Req() req: AuthedRequest) {
    const v = feeScheduleCreateSchema.parse(body);
    const total = v.installments.reduce((sum, x) => sum + x.amountMinor, 0);
    if (!Number.isSafeInteger(total))
      throw new UnprocessableEntityException('Schedule total is outside supported limits');
    return this.db.tx(async (c) => {
      const schedule = (
        await c.query(
          `INSERT INTO fee_schedules(account_reference,payer_id,currency,total_amount_minor,note,created_by)
           VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
          [v.accountReference, v.payerId || null, v.currency, total, v.note, req.actor.id],
        )
      ).rows[0];
      for (let n = 0; n < v.installments.length; n++) {
        const i = v.installments[n]!;
        await c.query(
          `INSERT INTO fee_installments(schedule_id,sequence,due_date,amount_minor)
           VALUES($1,$2,$3,$4)`,
          [schedule.id, n + 1, i.dueDate, i.amountMinor],
        );
      }
      await this.db.audit(c, req.actor.id, 'fees.schedule.create', schedule.id, {
        accountReference: v.accountReference,
        currency: v.currency,
        totalAmountMinor: total,
        installmentCount: v.installments.length,
        payerLinked: !!v.payerId,
      });
      return schedule;
    });
  }

  @Post('schedules/:id/activate')
  async activate(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    const scheduleId = uuid(id);
    const v = feeScheduleActivationSchema.parse(body);
    return this.db.tx(async (c) => {
      const schedule = (
        await c.query('SELECT * FROM fee_schedules WHERE id=$1 FOR UPDATE', [scheduleId])
      ).rows[0];
      if (!schedule) throw new ConflictException('Fee schedule does not exist');
      if (schedule.version !== v.expectedVersion)
        throw new ConflictException('Fee schedule changed; reload before activating');
      if (schedule.status !== 'draft')
        throw new ConflictException('Only draft fee schedules can be activated');
      const total = (
        await c.query(
          'SELECT coalesce(sum(amount_minor),0)::bigint AS total FROM fee_installments WHERE schedule_id=$1',
          [scheduleId],
        )
      ).rows[0]!.total;
      if (BigInt(total) !== BigInt(schedule.total_amount_minor))
        throw new ConflictException('Installment total does not equal schedule total');
      const updated = (
        await c.query(
          `UPDATE fee_schedules
           SET status='active',version=version+1,updated_at=now()
           WHERE id=$1 RETURNING *`,
          [scheduleId],
        )
      ).rows[0];
      await this.db.audit(c, req.actor.id, 'fees.schedule.activate', scheduleId);
      return updated;
    });
  }

  @Get('payments')
  async payments() {
    return this.db.query(
      `SELECT p.id,p.schedule_id,p.installment_id,p.provider,p.provider_reference,
        p.amount_minor,p.refunded_amount_minor,p.currency,p.status,p.evidence_note,p.recorded_at,
        s.account_reference,i.sequence,i.due_date
       FROM payment_records p
       JOIN fee_schedules s ON s.id=p.schedule_id
       JOIN fee_installments i ON i.id=p.installment_id
       ORDER BY p.recorded_at DESC
       LIMIT 300`,
    );
  }

  @Post('payments/external-confirmation')
  async recordPayment(@Body() body: unknown, @Req() req: AuthedRequest) {
    const v = externalPaymentRecordSchema.parse(body);
    return this.db.tx(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        'payment:' + v.idempotencyKey,
      ]);
      const replay = (
        await c.query('SELECT * FROM payment_records WHERE idempotency_key=$1', [
          v.idempotencyKey,
        ])
      ).rows[0];
      if (replay) return { ...replay, replayed: true };

      const installment = (
        await c.query(
          `SELECT i.*,s.status AS schedule_status,s.currency
           FROM fee_installments i
           JOIN fee_schedules s ON s.id=i.schedule_id
           WHERE i.id=$1
           FOR UPDATE OF i,s`,
          [v.installmentId],
        )
      ).rows[0];
      if (!installment) throw new ConflictException('Installment does not exist');
      if (installment.schedule_status !== 'active')
        throw new ConflictException('Fee schedule must be active before payment evidence is recorded');
      if (installment.status === 'cancelled')
        throw new ConflictException('Cancelled installment cannot accept payment evidence');
      if (installment.currency !== v.currency)
        throw new ConflictException('Payment currency does not match schedule currency');
      const remaining = Number(installment.amount_minor) - Number(installment.paid_amount_minor);
      if (v.amountMinor > remaining)
        throw new UnprocessableEntityException('Payment exceeds the installment balance');

      const payment = (
        await c.query(
          `INSERT INTO payment_records(
            schedule_id,installment_id,idempotency_key,provider_reference,amount_minor,currency,
            evidence_note,recorded_by
          ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
          RETURNING *`,
          [
            installment.schedule_id,
            v.installmentId,
            v.idempotencyKey,
            v.providerReference,
            v.amountMinor,
            v.currency,
            v.evidenceNote,
            req.actor.id,
          ],
        )
      ).rows[0];
      const nextPaid = Number(installment.paid_amount_minor) + v.amountMinor;
      const nextStatus = nextPaid === Number(installment.amount_minor) ? 'paid' : 'part_paid';
      await c.query(
        'UPDATE fee_installments SET paid_amount_minor=$2,status=$3 WHERE id=$1',
        [v.installmentId, nextPaid, nextStatus],
      );
      const open = (
        await c.query(
          `SELECT count(*)::int AS count FROM fee_installments
           WHERE schedule_id=$1 AND status NOT IN('paid','cancelled')`,
          [installment.schedule_id],
        )
      ).rows[0]!.count;
      if (open === 0)
        await c.query(
          `UPDATE fee_schedules SET status='completed',version=version+1,updated_at=now() WHERE id=$1`,
          [installment.schedule_id],
        );
      const receiptNumber = 'RCP-' + randomUUID().slice(0, 8).toUpperCase();
      const receipt = (
        await c.query(
          `INSERT INTO fee_receipts(payment_id,receipt_number,snapshot)
           VALUES($1,$2,$3) RETURNING id,receipt_number,issued_at`,
          [
            payment.id,
            receiptNumber,
            {
              scheduleId: installment.schedule_id,
              accountReference: installment.account_reference || null,
              installmentId: v.installmentId,
              amountMinor: v.amountMinor,
              currency: v.currency,
              providerReference: v.providerReference,
              recordedAt: payment.recorded_at,
            },
          ],
        )
      ).rows[0];
      const eventId = randomUUID();
      await c.query(
        `INSERT INTO outbox(event_id,type,aggregate_id,payload)
         VALUES($1,'payment.external_confirmed',$2,$3)`,
        [
          eventId,
          payment.id,
          {
            scheduleId: installment.schedule_id,
            amountMinor: v.amountMinor,
            receiptId: receipt.id,
            receiptNumber: receipt.receipt_number,
          },
        ],
      );
      await this.db.audit(c, req.actor.id, 'fees.payment.external_confirmed', payment.id, {
        scheduleId: installment.schedule_id,
        providerReference: v.providerReference,
        amountMinor: v.amountMinor,
        eventId,
      });
      return { ...payment, receipt, replayed: false };
    });
  }

  @Post('refunds')
  async refund(@Body() body: unknown, @Req() req: AuthedRequest) {
    const v = refundRecordSchema.parse(body);
    return this.db.tx(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        'refund:' + v.idempotencyKey,
      ]);
      const replay = (
        await c.query('SELECT * FROM payment_refunds WHERE idempotency_key=$1', [
          v.idempotencyKey,
        ])
      ).rows[0];
      if (replay) return { ...replay, replayed: true };
      const payment = (
        await c.query('SELECT * FROM payment_records WHERE id=$1 FOR UPDATE', [v.paymentId])
      ).rows[0];
      if (!payment) throw new ConflictException('Payment record does not exist');
      const refundable = Number(payment.amount_minor) - Number(payment.refunded_amount_minor);
      if (v.amountMinor > refundable)
        throw new UnprocessableEntityException('Refund exceeds the remaining refundable amount');
      const refund = (
        await c.query(
          `INSERT INTO payment_refunds(payment_id,idempotency_key,amount_minor,reason,recorded_by)
           VALUES($1,$2,$3,$4,$5) RETURNING *`,
          [v.paymentId, v.idempotencyKey, v.amountMinor, v.reason, req.actor.id],
        )
      ).rows[0];
      const newRefunded = Number(payment.refunded_amount_minor) + v.amountMinor;
      await c.query(
        `UPDATE payment_records
         SET refunded_amount_minor=$2,status=$3
         WHERE id=$1`,
        [
          v.paymentId,
          newRefunded,
          newRefunded === Number(payment.amount_minor) ? 'refunded' : 'partially_refunded',
        ],
      );
      const installment = (
        await c.query('SELECT * FROM fee_installments WHERE id=$1 FOR UPDATE', [
          payment.installment_id,
        ])
      ).rows[0]!;
      const newPaid = Math.max(0, Number(installment.paid_amount_minor) - v.amountMinor);
      const status =
        newPaid === 0
          ? new Date(installment.due_date) < new Date()
            ? 'overdue'
            : 'scheduled'
          : newPaid === Number(installment.amount_minor)
            ? 'paid'
            : 'part_paid';
      await c.query(
        'UPDATE fee_installments SET paid_amount_minor=$2,status=$3 WHERE id=$1',
        [installment.id, newPaid, status],
      );
      await c.query(
        `UPDATE fee_schedules
         SET status=CASE WHEN status='completed' THEN 'active' ELSE status END,
             version=version+1,updated_at=now()
         WHERE id=$1`,
        [payment.schedule_id],
      );
      const eventId = randomUUID();
      await c.query(
        `INSERT INTO outbox(event_id,type,aggregate_id,payload)
         VALUES($1,'payment.refund_recorded',$2,$3)`,
        [eventId, refund.id, { paymentId: v.paymentId, amountMinor: v.amountMinor }],
      );
      await this.db.audit(c, req.actor.id, 'fees.refund.record', refund.id, {
        paymentId: v.paymentId,
        amountMinor: v.amountMinor,
        eventId,
      });
      return { ...refund, replayed: false };
    });
  }

  @Get('mandates')
  mandates() {
    return this.db.query(
      `SELECT m.*,s.account_reference
       FROM payment_mandates m JOIN fee_schedules s ON s.id=m.schedule_id
       ORDER BY m.last_event_at DESC LIMIT 300`,
    );
  }

  @Post('mandates')
  async mandate(@Body() body: unknown, @Req() req: AuthedRequest) {
    const v = mandateRecordSchema.parse(body);
    return this.db.tx(async (c) => {
      const schedule = (
        await c.query('SELECT id,status FROM fee_schedules WHERE id=$1', [v.scheduleId])
      ).rows[0];
      if (!schedule) throw new ConflictException('Fee schedule does not exist');
      const old = (
        await c.query(
          `SELECT * FROM payment_mandates
           WHERE provider='external' AND provider_reference=$1 FOR UPDATE`,
          [v.providerReference],
        )
      ).rows[0];
      const row = old
        ? (
            await c.query(
              `UPDATE payment_mandates
               SET status=$2,last_event_at=now(),recorded_by=$3
               WHERE id=$1 RETURNING *`,
              [old.id, v.status, req.actor.id],
            )
          ).rows[0]
        : (
            await c.query(
              `INSERT INTO payment_mandates(schedule_id,rail,provider_reference,status,recorded_by)
               VALUES($1,$2,$3,$4,$5) RETURNING *`,
              [v.scheduleId, v.rail, v.providerReference, v.status, req.actor.id],
            )
          ).rows[0];
      await this.db.audit(c, req.actor.id, 'fees.mandate.record', row.id, {
        scheduleId: v.scheduleId,
        rail: v.rail,
        status: v.status,
      });
      return row;
    });
  }

  @Get('settlements')
  settlements() {
    return this.db.query(
      `SELECT s.*,
        coalesce(
          json_agg(json_build_object('paymentId',sp.payment_id,'amountMinor',sp.amount_minor))
          FILTER (WHERE sp.payment_id IS NOT NULL),
          '[]'::json
        ) AS allocations
       FROM settlement_records s
       LEFT JOIN settlement_payments sp ON sp.settlement_id=s.id
       GROUP BY s.id
       ORDER BY s.created_at DESC
       LIMIT 200`,
    );
  }

  @Post('settlements')
  async settlement(@Body() body: unknown, @Req() req: AuthedRequest) {
    const v = settlementSchema.parse(body);
    return this.db.tx(async (c) => {
      const row = (
        await c.query(
          `INSERT INTO settlement_records(
             provider_reference,currency,amount_minor,expected_on,settled_at,status,recorded_by
           ) VALUES($1,$2,$3,$4,CASE WHEN $5='settled' THEN now() ELSE NULL END,$5,$6)
           RETURNING *`,
          [
            v.providerReference,
            v.currency,
            v.amountMinor,
            v.expectedOn || null,
            v.status,
            req.actor.id,
          ],
        )
      ).rows[0];
      for (const allocation of v.allocations) {
        const payment = (
          await c.query('SELECT id,currency FROM payment_records WHERE id=$1', [
            allocation.paymentId,
          ])
        ).rows[0];
        if (!payment) throw new ConflictException('Settlement references an unknown payment');
        if (payment.currency !== v.currency)
          throw new ConflictException('Settlement currency does not match payment currency');
        await c.query(
          `INSERT INTO settlement_payments(settlement_id,payment_id,amount_minor)
           VALUES($1,$2,$3)`,
          [row.id, allocation.paymentId, allocation.amountMinor],
        );
        await c.query(
          `INSERT INTO reconciliation_entries(payment_id,settlement_id,status,reason,created_by)
           VALUES($1,$2,'matched','Explicit operator allocation',$3)`,
          [allocation.paymentId, row.id, req.actor.id],
        );
      }
      await this.db.audit(c, req.actor.id, 'fees.settlement.record', row.id, {
        providerReference: v.providerReference,
        amountMinor: v.amountMinor,
        status: v.status,
        allocationCount: v.allocations.length,
      });
      return row;
    });
  }

  @Get('reconciliation')
  reconciliation() {
    return this.db.query(
      `SELECT r.*,p.provider_reference AS payment_reference,s.provider_reference AS settlement_reference
       FROM reconciliation_entries r
       LEFT JOIN payment_records p ON p.id=r.payment_id
       LEFT JOIN settlement_records s ON s.id=r.settlement_id
       ORDER BY r.created_at DESC
       LIMIT 300`,
    );
  }
}
