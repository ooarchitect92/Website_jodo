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
} from '@nestjs/common';
import { Db } from './db';
import { AuthGuard, AuthedRequest, Roles } from './auth';
import { uuid } from './content';
import { feePayerProfileSchema, payerLinkSchema } from '../../../packages/core/src/contracts';
import { decrypt, digest, encrypt, token } from '../../../packages/core/src/security';
import { checkoutProviderEnabled } from './payment-checkout';

type PayerProfile = {
  accountReference: string;
  displayName: string;
  email?: string;
  phone?: string;
  preferredChannel: 'email' | 'whatsapp' | 'none';
  locale: 'en-IN';
};

function maskEmail(email?: string) {
  if (!email) return null;
  const [name, domain] = email.split('@');
  return (name?.slice(0, 2) || '*') + '***@' + domain;
}
function maskPhone(phone?: string) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  return '••••••' + digits.slice(-4);
}

@Controller('v1/admin/payers')
@UseGuards(AuthGuard)
@Roles('owner')
export class PayerAdminController {
  constructor(@Inject(Db) private db: Db) {}

  @Get()
  async list() {
    const rows = await this.db.query(
      `SELECT p.id,p.account_reference,p.encrypted_profile,p.preferred_channel,p.locale,p.active,
              p.created_at,p.updated_at,
              count(s.id)::int AS schedules
       FROM fee_payers p
       LEFT JOIN fee_schedules s ON s.payer_id=p.id
       GROUP BY p.id
       ORDER BY p.created_at DESC
       LIMIT 300`,
    );
    return rows.map((row) => {
      const profile = decrypt<PayerProfile>(row.encrypted_profile);
      return {
        id: row.id,
        accountReference: row.account_reference,
        displayName: profile.displayName,
        email: maskEmail(profile.email),
        phone: maskPhone(profile.phone),
        preferredChannel: row.preferred_channel,
        locale: row.locale,
        active: row.active,
        schedules: row.schedules,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
  }

  @Post()
  async create(@Body() body: unknown, @Req() req: AuthedRequest) {
    const v = feePayerProfileSchema.parse(body);
    return this.db.tx(async (c) => {
      const row = (
        await c.query(
          `INSERT INTO fee_payers(
             account_reference,encrypted_profile,preferred_channel,locale,created_by
           ) VALUES($1,$2,$3,$4,$5)
           RETURNING id,account_reference,preferred_channel,locale,active,created_at`,
          [v.accountReference, encrypt(v), v.preferredChannel, v.locale, req.actor.id],
        )
      ).rows[0];
      await this.db.audit(c, req.actor.id, 'fees.payer.create', row.id, {
        accountReference: v.accountReference,
        preferredChannel: v.preferredChannel,
      });
      return {
        id: row.id,
        accountReference: row.account_reference,
        displayName: v.displayName,
        email: maskEmail(v.email),
        phone: maskPhone(v.phone),
        preferredChannel: row.preferred_channel,
        locale: row.locale,
        active: row.active,
        createdAt: row.created_at,
      };
    });
  }

  @Post(':id/deactivate')
  async deactivate(@Param('id') id: string, @Req() req: AuthedRequest) {
    const payerId = uuid(id);
    return this.db.tx(async (c) => {
      const row = (
        await c.query(
          `UPDATE fee_payers SET active=false,updated_at=now()
           WHERE id=$1 AND active=true RETURNING id`,
          [payerId],
        )
      ).rows[0];
      if (!row) throw new ConflictException('Payer profile is already inactive or missing');
      await c.query(
        'UPDATE payer_access_tokens SET revoked_at=now() WHERE schedule_id IN (SELECT id FROM fee_schedules WHERE payer_id=$1) AND revoked_at IS NULL',
        [payerId],
      );
      await this.db.audit(c, req.actor.id, 'fees.payer.deactivate', payerId);
      return { status: 'inactive' };
    });
  }
}

@Controller('v1/admin/fees')
@UseGuards(AuthGuard)
@Roles('owner')
export class PayerLinkAdminController {
  constructor(@Inject(Db) private db: Db) {}

  @Post('schedules/:id/payer-link')
  async link(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const scheduleId = uuid(id);
    const v = payerLinkSchema.parse(body);
    const raw = token();
    const hash = digest(raw);
    return this.db.tx(async (c) => {
      const schedule = (
        await c.query(
          `SELECT s.id,s.payer_id,p.active
           FROM fee_schedules s
           LEFT JOIN fee_payers p ON p.id=s.payer_id
           WHERE s.id=$1`,
          [scheduleId],
        )
      ).rows[0];
      if (!schedule) throw new ConflictException('Fee schedule does not exist');
      if (!schedule.payer_id)
        throw new ConflictException('Link a payer profile before creating portal access');
      if (!schedule.active) throw new ConflictException('Payer profile is inactive');

      await c.query(
        `INSERT INTO payer_access_tokens(schedule_id,token_hash,expires_at,created_by)
         VALUES($1,$2,now()+($3::int*interval '1 hour'),$4)`,
        [scheduleId, hash, v.expiresHours, req.actor.id],
      );
      await this.db.audit(c, req.actor.id, 'fees.payer_link.create', scheduleId, {
        expiresHours: v.expiresHours,
      });
      return {
        path: '/payer/' + raw + '/',
        expiresHours: v.expiresHours,
      };
    });
  }

  @Post('schedules/:id/revoke-payer-links')
  async revoke(@Param('id') id: string, @Req() req: AuthedRequest) {
    const scheduleId = uuid(id);
    return this.db.tx(async (c) => {
      const r = await c.query(
        `UPDATE payer_access_tokens SET revoked_at=now()
         WHERE schedule_id=$1 AND revoked_at IS NULL AND expires_at>now()`,
        [scheduleId],
      );
      await this.db.audit(c, req.actor.id, 'fees.payer_link.revoke_all', scheduleId, {
        count: r.rowCount,
      });
      return { revoked: r.rowCount };
    });
  }
}

@Controller('v1/payer')
export class PayerPortalController {
  constructor(@Inject(Db) private db: Db) {}

  private async access(rawToken: string) {
    if (!/^[A-Za-z0-9_-]{30,100}$/.test(rawToken))
      throw new ConflictException('Portal link is invalid or expired');
    const rows = await this.db.query(
      `SELECT t.schedule_id,s.account_reference,s.currency,s.total_amount_minor,s.status,
              p.id AS payer_id,p.encrypted_profile,p.active
       FROM payer_access_tokens t
       JOIN fee_schedules s ON s.id=t.schedule_id
       JOIN fee_payers p ON p.id=s.payer_id
       WHERE t.token_hash=$1 AND t.revoked_at IS NULL AND t.expires_at>now()`,
      [digest(rawToken)],
    );
    const row = rows[0];
    if (!row || !row.active) throw new ConflictException('Portal link is invalid or expired');
    return row;
  }

  @Get(':token')
  async portal(@Param('token') rawToken: string) {
    const access = await this.access(rawToken);
    const [installments, payments, refunds, checkoutSessions] = await Promise.all([
      this.db.query(
        `SELECT id,sequence,due_date,amount_minor,paid_amount_minor,
          CASE
            WHEN status='paid' THEN 'paid'
            WHEN due_date<current_date AND status NOT IN('paid','cancelled') THEN 'overdue'
            WHEN due_date=current_date AND status NOT IN('paid','cancelled') THEN 'due'
            ELSE status
          END AS status
         FROM fee_installments WHERE schedule_id=$1 ORDER BY sequence`,
        [access.schedule_id],
      ),
      this.db.query(
        `SELECT p.id,p.installment_id,p.amount_minor,p.refunded_amount_minor,p.currency,
                p.status,p.recorded_at,r.receipt_number,r.issued_at
         FROM payment_records p
         LEFT JOIN fee_receipts r ON r.payment_id=p.id
         WHERE p.schedule_id=$1 ORDER BY p.recorded_at DESC`,
        [access.schedule_id],
      ),
      this.db.query(
        `SELECT f.id,f.payment_id,f.amount_minor,f.reason,f.created_at
         FROM payment_refunds f
         JOIN payment_records p ON p.id=f.payment_id
         WHERE p.schedule_id=$1 ORDER BY f.created_at DESC`,
        [access.schedule_id],
      ),
      this.db.query(
        `SELECT id,installment_id,amount_minor,currency,
                CASE
                  WHEN status='created' AND expires_at<now() THEN 'expired'
                  ELSE status
                END AS status,
                expires_at,created_at,updated_at
         FROM payment_checkout_sessions
         WHERE schedule_id=$1
         ORDER BY created_at DESC
         LIMIT 20`,
        [access.schedule_id],
      ),
    ]);
    const profile = decrypt<PayerProfile>(access.encrypted_profile);
    return {
      payer: { displayName: profile.displayName, accountReference: access.account_reference },
      schedule: {
        id: access.schedule_id,
        currency: access.currency,
        totalAmountMinor: access.total_amount_minor,
        status: access.status,
      },
      installments,
      payments,
      refunds,
      checkoutSessions,
      providerConnected: checkoutProviderEnabled(),
      note: checkoutProviderEnabled()
        ? 'Hosted checkout is activated. The selected provider collects payment credentials; this platform records only validated payment outcomes.'
        : 'This portal shows the platform ledger. Payment actions are enabled only after a verified payment provider is configured.',
    };
  }

  @Get(':token/receipts/:receiptNumber')
  async receipt(@Param('token') rawToken: string, @Param('receiptNumber') receiptNumber: string) {
    const access = await this.access(rawToken);
    if (!/^RCP-[A-Z0-9]{8}$/.test(receiptNumber))
      throw new ConflictException('Receipt does not exist');
    const row = (
      await this.db.query(
        `SELECT r.receipt_number,r.issued_at,r.snapshot,p.amount_minor,p.currency,
                p.provider_reference,p.recorded_at
         FROM fee_receipts r
         JOIN payment_records p ON p.id=r.payment_id
         WHERE r.receipt_number=$1 AND p.schedule_id=$2`,
        [receiptNumber, access.schedule_id],
      )
    )[0];
    if (!row) throw new ConflictException('Receipt does not exist');
    return row;
  }
}
