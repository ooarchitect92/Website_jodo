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
import { randomBytes } from 'node:crypto';
import { Db } from './db';
import { AuthGuard, AuthedRequest, Roles } from './auth';
import { uuid } from './content';
import {
  collectionIntentSchema,
  collectionPageCreateSchema,
  feeAdjustmentReverseSchema,
  feeAdjustmentSchema,
  feeHeadSchema,
  installmentComponentSchema,
} from '../../../packages/core/src/contracts';

@Controller('v1/admin/fees/structure')
@UseGuards(AuthGuard)
@Roles('owner')
export class FeeStructureController {
  constructor(@Inject(Db) private db: Db) {}

  @Get('heads')
  heads() {
    return this.db.query(
      `SELECT h.*,
        (SELECT count(*)::int FROM fee_installment_components c WHERE c.fee_head_id=h.id) AS usages
       FROM fee_heads h
       ORDER BY h.active DESC,h.name`,
    );
  }

  @Post('heads')
  async createHead(@Body() body: unknown, @Req() req: AuthedRequest) {
    const v = feeHeadSchema.parse(body);
    return this.db.tx(async (c) => {
      const row = (
        await c.query(
          `INSERT INTO fee_heads(code,name,settlement_account_key,created_by)
           VALUES($1,$2,$3,$4) RETURNING *`,
          [v.code, v.name, v.settlementAccountKey || null, req.actor.id],
        )
      ).rows[0];
      await this.db.audit(c, req.actor.id, 'fees.head.create', row.id, {
        code: v.code,
        settlementAccountConfigured: Boolean(v.settlementAccountKey),
      });
      return row;
    });
  }

  @Post('components')
  async setComponents(@Body() body: unknown, @Req() req: AuthedRequest) {
    const v = installmentComponentSchema.parse(body);
    return this.db.tx(async (c) => {
      const installment = (
        await c.query(
          `SELECT i.*,s.status AS schedule_status
           FROM fee_installments i
           JOIN fee_schedules s ON s.id=i.schedule_id
           WHERE i.id=$1 FOR UPDATE OF i,s`,
          [v.installmentId],
        )
      ).rows[0];
      if (!installment) throw new ConflictException('Installment does not exist');
      if (installment.schedule_status !== 'draft')
        throw new ConflictException(
          'Fee-head structure can only be set while the schedule is a draft',
        );

      const existing = (
        await c.query(
          'SELECT count(*)::int AS count FROM fee_installment_components WHERE installment_id=$1',
          [v.installmentId],
        )
      ).rows[0]!.count;
      if (existing > 0)
        throw new ConflictException('Fee-head structure is already set for this installment');

      const total = v.components.reduce((sum, item) => sum + item.amountMinor, 0);
      if (total !== Number(installment.amount_minor))
        throw new UnprocessableEntityException(
          'Fee-head component total must equal the installment amount',
        );

      const known = await c.query(
        `SELECT id FROM fee_heads WHERE id = ANY($1::uuid[]) AND active=true`,
        [v.components.map((item) => item.feeHeadId)],
      );
      if (known.rowCount !== v.components.length)
        throw new UnprocessableEntityException('Every fee head must exist and be active');

      for (const component of v.components)
        await c.query(
          `INSERT INTO fee_installment_components(installment_id,fee_head_id,amount_minor)
           VALUES($1,$2,$3)`,
          [v.installmentId, component.feeHeadId, component.amountMinor],
        );

      await this.db.audit(c, req.actor.id, 'fees.components.set', v.installmentId, {
        count: v.components.length,
        totalAmountMinor: total,
      });
      return { installmentId: v.installmentId, components: v.components };
    });
  }

  @Get('adjustments')
  adjustments() {
    return this.db.query(
      `SELECT a.*,s.account_reference,i.sequence
       FROM fee_adjustments a
       JOIN fee_schedules s ON s.id=a.schedule_id
       JOIN fee_installments i ON i.id=a.installment_id
       ORDER BY a.applied_at DESC
       LIMIT 300`,
    );
  }

  @Post('adjustments')
  async adjust(@Body() body: unknown, @Req() req: AuthedRequest) {
    const v = feeAdjustmentSchema.parse(body);
    const direction = v.kind === 'late_fee' ? 1 : -1;
    return this.db.tx(async (c) => {
      const installment = (
        await c.query(
          `SELECT i.*,s.id AS schedule_id,s.status AS schedule_status
           FROM fee_installments i
           JOIN fee_schedules s ON s.id=i.schedule_id
           WHERE i.id=$1 FOR UPDATE OF i,s`,
          [v.installmentId],
        )
      ).rows[0];
      if (!installment) throw new ConflictException('Installment does not exist');
      if (installment.status === 'cancelled')
        throw new ConflictException('Cancelled installments cannot be adjusted');
      if (installment.schedule_status === 'draft')
        throw new ConflictException(
          'Activate the fee schedule before applying financial adjustments',
        );

      const nextAmount = Number(installment.amount_minor) + direction * v.amountMinor;
      if (nextAmount <= 0 || nextAmount < Number(installment.paid_amount_minor))
        throw new UnprocessableEntityException(
          'Adjustment cannot reduce the installment below zero or its already-paid amount',
        );

      const adjustment = (
        await c.query(
          `INSERT INTO fee_adjustments(
             schedule_id,installment_id,kind,amount_minor,direction,reason,applied_by
           ) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [
            installment.schedule_id,
            v.installmentId,
            v.kind,
            v.amountMinor,
            direction,
            v.reason,
            req.actor.id,
          ],
        )
      ).rows[0];

      const nextStatus =
        Number(installment.paid_amount_minor) === nextAmount
          ? 'paid'
          : Number(installment.paid_amount_minor) > 0
            ? 'part_paid'
            : installment.status === 'paid'
              ? 'scheduled'
              : installment.status;

      await c.query(`UPDATE fee_installments SET amount_minor=$2,status=$3 WHERE id=$1`, [
        v.installmentId,
        nextAmount,
        nextStatus,
      ]);
      await c.query(
        `UPDATE fee_schedules
         SET total_amount_minor=total_amount_minor+$2,version=version+1,updated_at=now(),
             status=CASE WHEN status='completed' AND $2>0 THEN 'active' ELSE status END
         WHERE id=$1`,
        [installment.schedule_id, direction * v.amountMinor],
      );
      await this.db.audit(c, req.actor.id, 'fees.adjustment.apply', adjustment.id, {
        installmentId: v.installmentId,
        kind: v.kind,
        amountMinor: v.amountMinor,
        direction,
        nextAmountMinor: nextAmount,
      });
      return adjustment;
    });
  }

  @Post('adjustments/:id/reverse')
  async reverse(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const adjustmentId = uuid(id);
    const v = feeAdjustmentReverseSchema.parse(body);
    return this.db.tx(async (c) => {
      const adjustment = (
        await c.query('SELECT * FROM fee_adjustments WHERE id=$1 FOR UPDATE', [adjustmentId])
      ).rows[0];
      if (!adjustment) throw new ConflictException('Adjustment does not exist');
      if (adjustment.status !== 'active')
        throw new ConflictException('Adjustment has already been reversed');

      const installment = (
        await c.query('SELECT * FROM fee_installments WHERE id=$1 FOR UPDATE', [
          adjustment.installment_id,
        ])
      ).rows[0]!;
      const delta = -Number(adjustment.direction) * Number(adjustment.amount_minor);
      const nextAmount = Number(installment.amount_minor) + delta;
      if (nextAmount <= 0 || nextAmount < Number(installment.paid_amount_minor))
        throw new ConflictException('Reversal would invalidate the installment balance');

      await c.query(
        `UPDATE fee_adjustments
         SET status='reversed',reversed_by=$2,reversed_at=now(),reversal_reason=$3
         WHERE id=$1`,
        [adjustmentId, req.actor.id, v.reason],
      );
      const nextStatus =
        Number(installment.paid_amount_minor) === nextAmount
          ? 'paid'
          : Number(installment.paid_amount_minor) > 0
            ? 'part_paid'
            : 'scheduled';
      await c.query('UPDATE fee_installments SET amount_minor=$2,status=$3 WHERE id=$1', [
        adjustment.installment_id,
        nextAmount,
        nextStatus,
      ]);
      await c.query(
        `UPDATE fee_schedules
         SET total_amount_minor=total_amount_minor+$2,version=version+1,updated_at=now()
         WHERE id=$1`,
        [adjustment.schedule_id, delta],
      );
      await this.db.audit(c, req.actor.id, 'fees.adjustment.reverse', adjustmentId, {
        reason: v.reason,
        deltaMinor: delta,
        nextAmountMinor: nextAmount,
      });
      return { id: adjustmentId, status: 'reversed' };
    });
  }
}

@Controller('v1/admin/fees/collection-pages')
@UseGuards(AuthGuard)
@Roles('owner')
export class CollectionPageAdminController {
  constructor(@Inject(Db) private db: Db) {}

  @Get()
  pages() {
    return this.db.query(
      `SELECT p.*,s.account_reference,
        (SELECT count(*)::int FROM fee_collection_intents i WHERE i.collection_page_id=p.id) AS intents
       FROM fee_collection_pages p
       JOIN fee_schedules s ON s.id=p.schedule_id
       ORDER BY p.created_at DESC
       LIMIT 300`,
    );
  }

  @Post()
  async create(@Body() body: unknown, @Req() req: AuthedRequest) {
    const v = collectionPageCreateSchema.parse(body);
    const slug = 'collect-' + randomBytes(16).toString('hex');
    return this.db.tx(async (c) => {
      const schedule = (
        await c.query('SELECT id,status FROM fee_schedules WHERE id=$1', [v.scheduleId])
      ).rows[0];
      if (!schedule) throw new ConflictException('Fee schedule does not exist');
      if (schedule.status !== 'active')
        throw new ConflictException('Only active fee schedules can publish collection pages');

      const row = (
        await c.query(
          `INSERT INTO fee_collection_pages(
             slug,schedule_id,title,description,allow_full,allow_partial,allow_custom,
             minimum_minor,maximum_minor,expires_at,created_by
           ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           RETURNING *`,
          [
            slug,
            v.scheduleId,
            v.title,
            v.description,
            v.allowFull,
            v.allowPartial,
            v.allowCustom,
            v.minimumMinor || null,
            v.maximumMinor || null,
            v.expiresAt || null,
            req.actor.id,
          ],
        )
      ).rows[0];
      await this.db.audit(c, req.actor.id, 'fees.collection_page.create', row.id, {
        scheduleId: v.scheduleId,
        slug,
        modes: {
          full: v.allowFull,
          partial: v.allowPartial,
          custom: v.allowCustom,
        },
      });
      return { ...row, path: '/collect/' + slug + '/' };
    });
  }

  @Post(':id/pause')
  async pause(@Param('id') id: string, @Req() req: AuthedRequest) {
    const pageId = uuid(id);
    return this.db.tx(async (c) => {
      const row = (
        await c.query(
          `UPDATE fee_collection_pages
           SET status='paused',updated_at=now()
           WHERE id=$1 AND status='active' RETURNING *`,
          [pageId],
        )
      ).rows[0];
      if (!row) throw new ConflictException('Collection page is not active');
      await this.db.audit(c, req.actor.id, 'fees.collection_page.pause', pageId);
      return row;
    });
  }
}

@Controller('v1/collections')
export class CollectionPagePublicController {
  constructor(@Inject(Db) private db: Db) {}

  @Get(':slug')
  async page(@Param('slug') slug: string) {
    if (!/^collect-[a-f0-9]{32}$/.test(slug))
      throw new ConflictException('Collection page is unavailable');
    const page = (
      await this.db.query(
        `SELECT p.id,p.slug,p.title,p.description,p.allow_full,p.allow_partial,p.allow_custom,
                p.minimum_minor,p.maximum_minor,p.expires_at,p.status,
                s.id AS schedule_id,s.currency,s.status AS schedule_status
         FROM fee_collection_pages p
         JOIN fee_schedules s ON s.id=p.schedule_id
         WHERE p.slug=$1`,
        [slug],
      )
    )[0];
    if (
      !page ||
      page.status !== 'active' ||
      (page.expires_at && new Date(page.expires_at).getTime() <= Date.now())
    )
      throw new ConflictException('Collection page is unavailable');

    const installments = await this.db.query(
      `SELECT i.id,i.sequence,i.due_date,i.amount_minor,i.paid_amount_minor,
        (i.amount_minor-i.paid_amount_minor)::bigint AS outstanding_minor,
        CASE
          WHEN i.status='paid' THEN 'paid'
          WHEN i.due_date<current_date AND i.status NOT IN('paid','cancelled') THEN 'overdue'
          WHEN i.due_date=current_date AND i.status NOT IN('paid','cancelled') THEN 'due'
          ELSE i.status
        END AS status,
        coalesce(
          json_agg(
            json_build_object('code',h.code,'name',h.name,'amountMinor',c.amount_minor)
            ORDER BY h.name
          ) FILTER (WHERE c.id IS NOT NULL),
          '[]'::json
        ) AS components
       FROM fee_installments i
       LEFT JOIN fee_installment_components c ON c.installment_id=i.id
       LEFT JOIN fee_heads h ON h.id=c.fee_head_id
       WHERE i.schedule_id=$1 AND i.status<>'cancelled'
       GROUP BY i.id
       ORDER BY i.sequence`,
      [page.schedule_id],
    );
    return {
      page: {
        slug: page.slug,
        title: page.title,
        description: page.description,
        currency: page.currency,
        modes: {
          full: page.allow_full,
          partial: page.allow_partial,
          custom: page.allow_custom,
        },
        minimumMinor: page.minimum_minor,
        maximumMinor: page.maximum_minor,
      },
      installments,
      paymentProviderMode:
        process.env.PAYMENT_PROVIDER_MODE === 'signed_hmac'
          ? 'callback_ready_checkout_not_configured'
          : 'disabled',
      note: 'Choose an amount only. The platform never asks for card, bank, UPI PIN or OTP credentials on this page.',
    };
  }

  @Post(':slug/intents')
  async intent(@Param('slug') slug: string, @Body() body: unknown) {
    if (!/^collect-[a-f0-9]{32}$/.test(slug))
      throw new ConflictException('Collection page is unavailable');
    const v = collectionIntentSchema.parse(body);
    return this.db.tx(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        'collection-intent:' + v.idempotencyKey,
      ]);
      const replay = (
        await c.query('SELECT * FROM fee_collection_intents WHERE idempotency_key=$1', [
          v.idempotencyKey,
        ])
      ).rows[0];
      if (replay) return { ...replay, replayed: true };

      const page = (
        await c.query(
          `SELECT p.*,s.currency,s.status AS schedule_status
           FROM fee_collection_pages p
           JOIN fee_schedules s ON s.id=p.schedule_id
           WHERE p.slug=$1 FOR UPDATE OF p`,
          [slug],
        )
      ).rows[0];
      if (
        !page ||
        page.status !== 'active' ||
        (page.expires_at && new Date(page.expires_at).getTime() <= Date.now())
      )
        throw new ConflictException('Collection page is unavailable');
      if (page.schedule_status !== 'active')
        throw new ConflictException('Fee schedule is not open for collection');

      if (
        (v.mode === 'full' && !page.allow_full) ||
        (v.mode === 'partial' && !page.allow_partial) ||
        (v.mode === 'custom' && !page.allow_custom)
      )
        throw new ConflictException('Selected collection mode is not enabled');

      if (!v.installmentId)
        throw new UnprocessableEntityException(
          'Select an installment before creating a collection intent',
        );

      const installment = (
        await c.query(
          `SELECT * FROM fee_installments
           WHERE id=$1 AND schedule_id=$2 FOR UPDATE`,
          [v.installmentId, page.schedule_id],
        )
      ).rows[0];
      if (!installment || ['paid', 'cancelled'].includes(installment.status))
        throw new ConflictException('Installment is not available for collection');

      const outstanding = Number(installment.amount_minor) - Number(installment.paid_amount_minor);
      const amount = v.mode === 'full' ? outstanding : v.amountMinor;
      if (!amount || amount <= 0 || amount > outstanding)
        throw new UnprocessableEntityException('Collection amount exceeds the available balance');
      if (page.minimum_minor && amount < Number(page.minimum_minor))
        throw new UnprocessableEntityException('Collection amount is below the configured minimum');
      if (page.maximum_minor && amount > Number(page.maximum_minor))
        throw new UnprocessableEntityException('Collection amount exceeds the configured maximum');

      const row = (
        await c.query(
          `INSERT INTO fee_collection_intents(
             collection_page_id,schedule_id,installment_id,mode,amount_minor,currency,idempotency_key
           ) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [
            page.id,
            page.schedule_id,
            v.installmentId,
            v.mode,
            amount,
            page.currency,
            v.idempotencyKey,
          ],
        )
      ).rows[0];

      await this.db.audit(c, 'public_collection_page', 'fees.collection_intent.create', row.id, {
        collectionPageId: page.id,
        scheduleId: page.schedule_id,
        installmentId: v.installmentId,
        mode: v.mode,
        amountMinor: amount,
      });

      return {
        ...row,
        replayed: false,
        checkoutAvailable: false,
        message:
          'Amount selection is saved, but no payment has been taken. Configure a hosted payment provider before enabling checkout.',
      };
    });
  }
}
