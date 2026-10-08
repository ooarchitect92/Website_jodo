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
import { z } from 'zod';
import { Db } from './db';
import { AuthGuard, AuthedRequest, Roles } from './auth';

const money = z.number().int().positive().max(1_000_000_000_000);
const componentSchema = z
  .object({
    code: z.string().trim().regex(/^[A-Za-z0-9_-]{2,40}$/),
    label: z.string().trim().min(2).max(100),
    amountMinor: money,
    category: z.enum(['fee', 'deposit', 'transport', 'hostel', 'exam', 'other']).default('fee'),
  })
  .strict();
const installmentSchema = z
  .object({
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    amountMinor: money,
  })
  .strict();

const planSchema = z
  .object({
    planKey: z.string().trim().regex(/^[A-Za-z0-9._/-]{2,80}$/),
    name: z.string().trim().min(2).max(160),
    academicYearId: z.uuid().optional(),
    branchId: z.uuid().optional(),
    eligibility: z.record(z.string().max(80), z.union([z.string().max(200), z.boolean(), z.number()])).default({}),
    components: z.array(componentSchema).min(1).max(40),
    installments: z.array(installmentSchema).min(1).max(60),
    note: z.string().trim().max(500).default(''),
  })
  .strict()
  .superRefine((value, ctx) => {
    const componentTotal = value.components.reduce((sum, item) => sum + item.amountMinor, 0);
    const installmentTotal = value.installments.reduce((sum, item) => sum + item.amountMinor, 0);
    if (componentTotal !== installmentTotal)
      ctx.addIssue({
        code: 'custom',
        path: ['installments'],
        message: 'Installment total must equal fee-component total',
      });
    const componentCodes = value.components.map((item) => item.code);
    if (new Set(componentCodes).size !== componentCodes.length)
      ctx.addIssue({
        code: 'custom',
        path: ['components'],
        message: 'Fee component codes must be unique',
      });
    const dates = value.installments.map((item) => item.dueDate);
    if (new Set(dates).size !== dates.length)
      ctx.addIssue({
        code: 'custom',
        path: ['installments'],
        message: 'Installment due dates must be unique',
      });
  });

const assignSchema = z
  .object({
    studentId: z.uuid(),
    accountReference: z.string().trim().regex(/^[A-Za-z0-9_-]{2,80}$/),
    payerId: z.uuid().optional(),
  })
  .strict();

const adjustmentRequestSchema = z
  .object({
    scheduleId: z.uuid(),
    kind: z.enum(['concession', 'scholarship', 'waiver', 'write_off']),
    amountMinor: money,
    effectiveOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

const decisionSchema = z
  .object({
    decision: z.enum(['approve', 'reject']),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

const creditSchema = z
  .object({
    payerId: z.uuid().optional(),
    accountReference: z.string().trim().min(2).max(120),
    source: z.enum(['external_advance', 'opening_balance', 'transfer_credit']),
    amountMinor: money,
    evidenceReference: z.string().trim().max(160).optional(),
    note: z.string().trim().max(500).default(''),
  })
  .strict();

const allocateCreditSchema = z
  .object({
    installmentId: z.uuid(),
    amountMinor: money,
  })
  .strict();

const changeSchema = z
  .object({
    assignmentId: z.uuid().optional(),
    scheduleId: z.uuid(),
    changeType: z.enum(['withdrawal', 'transfer', 'plan_change', 'write_off']),
    reason: z.string().trim().min(3).max(500),
    payload: z.record(z.string().max(80), z.unknown()).default({}),
  })
  .strict();

function parseUuid(value: string) {
  return z.uuid().parse(value);
}

@Controller('v1/admin/fee-plans')
@UseGuards(AuthGuard)
@Roles('owner')
export class FeePlanController {
  constructor(@Inject(Db) private db: Db) {}

  @Get('overview')
  async overview(@Req() req: AuthedRequest) {
    const tenantId = req.actor.tenantId;
    const [plans, assignments, adjustments, credits, changes, ageing] = await Promise.all([
      this.db.query(
        `SELECT p.*,
          coalesce((SELECT sum(amount_minor) FROM fee_plan_components WHERE plan_id=p.id),0)::bigint AS total_minor,
          coalesce((SELECT count(*) FROM fee_plan_components WHERE plan_id=p.id),0)::int AS component_count,
          coalesce((SELECT count(*) FROM fee_plan_installments WHERE plan_id=p.id),0)::int AS installment_count
         FROM fee_plan_versions p
         WHERE p.tenant_id=$1
         ORDER BY p.plan_key,p.version DESC
         LIMIT 200`,
        [tenantId],
      ),
      this.db.query(
        `SELECT a.id,a.status,a.assigned_on,a.ended_on,a.student_id,a.plan_id,a.schedule_id,
                s.student_reference,s.full_name,p.plan_key,p.version,p.name
         FROM student_fee_plan_assignments a
         JOIN academic_students s ON s.id=a.student_id
         JOIN fee_plan_versions p ON p.id=a.plan_id
         WHERE a.tenant_id=$1
         ORDER BY a.created_at DESC LIMIT 200`,
        [tenantId],
      ),
      this.db.query(
        `SELECT a.*,s.account_reference
         FROM fee_adjustment_requests a
         JOIN fee_schedules s ON s.id=a.schedule_id
         WHERE a.tenant_id=$1 ORDER BY a.created_at DESC LIMIT 200`,
        [tenantId],
      ),
      this.db.query(
        `SELECT * FROM fee_credits
         WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 200`,
        [tenantId],
      ),
      this.db.query(
        `SELECT r.*,s.account_reference
         FROM receivable_change_requests r
         JOIN fee_schedules s ON s.id=r.schedule_id
         WHERE r.tenant_id=$1 ORDER BY r.created_at DESC LIMIT 200`,
        [tenantId],
      ),
      this.ageingRows(tenantId),
    ]);
    return { plans, assignments, adjustments, credits, changes, ageing };
  }

  @Get()
  plans(@Req() req: AuthedRequest) {
    return this.db.query(
      `SELECT p.*,
        coalesce((SELECT json_agg(json_build_object(
          'id',c.id,'code',c.code,'label',c.label,'amountMinor',c.amount_minor,'category',c.category
        ) ORDER BY c.code) FROM fee_plan_components c WHERE c.plan_id=p.id),'[]'::json) AS components,
        coalesce((SELECT json_agg(json_build_object(
          'id',i.id,'sequence',i.sequence,'dueDate',i.due_date,'amountMinor',i.amount_minor
        ) ORDER BY i.sequence) FROM fee_plan_installments i WHERE i.plan_id=p.id),'[]'::json) AS installments
       FROM fee_plan_versions p
       WHERE p.tenant_id=$1
       ORDER BY p.plan_key,p.version DESC`,
      [req.actor.tenantId],
    );
  }

  @Post()
  async create(@Req() req: AuthedRequest, @Body() body: unknown) {
    const input = planSchema.parse(body);
    await this.validateScope(req.actor.tenantId, input.academicYearId, input.branchId);
    return this.db.tx(async (c) => {
      const version = Number(
        (
          await c.query(
            'SELECT coalesce(max(version),0)+1 AS version FROM fee_plan_versions WHERE tenant_id=$1 AND plan_key=$2',
            [req.actor.tenantId, input.planKey],
          )
        ).rows[0]!.version,
      );
      const plan = (
        await c.query(
          `INSERT INTO fee_plan_versions(
             tenant_id,plan_key,version,name,academic_year_id,branch_id,eligibility,note,created_by
           ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
           RETURNING *`,
          [
            req.actor.tenantId,
            input.planKey,
            version,
            input.name,
            input.academicYearId || null,
            input.branchId || null,
            JSON.stringify(input.eligibility),
            input.note,
            req.actor.id,
          ],
        )
      ).rows[0];
      for (const component of input.components)
        await c.query(
          `INSERT INTO fee_plan_components(
             tenant_id,plan_id,code,label,amount_minor,category
           ) VALUES($1,$2,$3,$4,$5,$6)`,
          [
            req.actor.tenantId,
            plan.id,
            component.code,
            component.label,
            component.amountMinor,
            component.category,
          ],
        );
      for (let index = 0; index < input.installments.length; index++) {
        const installment = input.installments[index]!;
        await c.query(
          `INSERT INTO fee_plan_installments(
             tenant_id,plan_id,sequence,due_date,amount_minor
           ) VALUES($1,$2,$3,$4,$5)`,
          [req.actor.tenantId, plan.id, index + 1, installment.dueDate, installment.amountMinor],
        );
      }
      await this.db.audit(c, req.actor.id, 'fee_plan.create', plan.id, {
        planKey: input.planKey,
        version,
        componentCount: input.components.length,
        installmentCount: input.installments.length,
      });
      return plan;
    });
  }

  @Post(':id/validate')
  async validatePlan(@Req() req: AuthedRequest, @Param('id') id: string) {
    const planId = parseUuid(id);
    return this.db.tx(async (c) => {
      const plan = (
        await c.query(
          `SELECT p.*,
             coalesce((SELECT sum(amount_minor) FROM fee_plan_components WHERE plan_id=p.id),0)::bigint AS component_total,
             coalesce((SELECT sum(amount_minor) FROM fee_plan_installments WHERE plan_id=p.id),0)::bigint AS installment_total
           FROM fee_plan_versions p
           WHERE p.id=$1 AND p.tenant_id=$2 FOR UPDATE`,
          [planId, req.actor.tenantId],
        )
      ).rows[0];
      if (!plan) throw new ConflictException('Fee plan does not exist in this workspace');
      if (plan.status !== 'draft') throw new ConflictException('Only a draft plan can be validated');
      if (BigInt(plan.component_total) !== BigInt(plan.installment_total))
        throw new ConflictException('Fee plan component and installment totals do not balance');

      if (plan.academic_year_id) {
        const year = (
          await c.query('SELECT starts_on,ends_on FROM academic_years WHERE id=$1 AND tenant_id=$2', [
            plan.academic_year_id,
            req.actor.tenantId,
          ])
        ).rows[0];
        const invalid = (
          await c.query(
            `SELECT count(*)::int AS count FROM fee_plan_installments
             WHERE plan_id=$1 AND (due_date<$2 OR due_date>$3)`,
            [planId, year.starts_on, year.ends_on],
          )
        ).rows[0]!.count;
        if (invalid) throw new ConflictException('An installment due date is outside the academic year');
      }

      const updated = (
        await c.query(
          `UPDATE fee_plan_versions
           SET status='validated',validated_by=$3,updated_at=now()
           WHERE id=$1 AND tenant_id=$2 RETURNING *`,
          [planId, req.actor.tenantId, req.actor.id],
        )
      ).rows[0];
      await this.db.audit(c, req.actor.id, 'fee_plan.validate', planId);
      return updated;
    });
  }

  @Post(':id/request-approval')
  async requestApproval(@Req() req: AuthedRequest, @Param('id') id: string) {
    const planId = parseUuid(id);
    return this.db.tx(async (c) => {
      const row = (
        await c.query(
          `UPDATE fee_plan_versions SET status='pending_approval',updated_at=now()
           WHERE id=$1 AND tenant_id=$2 AND status='validated'
           RETURNING *`,
          [planId, req.actor.tenantId],
        )
      ).rows[0];
      if (!row) throw new ConflictException('Only a validated fee plan can be submitted');
      await this.db.audit(c, req.actor.id, 'fee_plan.request_approval', planId);
      return row;
    });
  }

  @Post(':id/approve')
  async approve(@Req() req: AuthedRequest, @Param('id') id: string) {
    const planId = parseUuid(id);
    return this.db.tx(async (c) => {
      const plan = (
        await c.query(
          'SELECT * FROM fee_plan_versions WHERE id=$1 AND tenant_id=$2 FOR UPDATE',
          [planId, req.actor.tenantId],
        )
      ).rows[0];
      if (!plan || plan.status !== 'pending_approval')
        throw new ConflictException('Fee plan is not pending approval');
      if (plan.created_by === req.actor.id)
        throw new ConflictException('Fee-plan maker cannot approve their own plan');
      const row = (
        await c.query(
          `UPDATE fee_plan_versions
           SET status='approved',approved_by=$3,updated_at=now()
           WHERE id=$1 AND tenant_id=$2 RETURNING *`,
          [planId, req.actor.tenantId, req.actor.id],
        )
      ).rows[0];
      await this.db.audit(c, req.actor.id, 'fee_plan.approve', planId, {
        createdBy: plan.created_by,
      });
      return row;
    });
  }

  @Post(':id/effective')
  async makeEffective(@Req() req: AuthedRequest, @Param('id') id: string) {
    const planId = parseUuid(id);
    return this.db.tx(async (c) => {
      const plan = (
        await c.query(
          'SELECT * FROM fee_plan_versions WHERE id=$1 AND tenant_id=$2 FOR UPDATE',
          [planId, req.actor.tenantId],
        )
      ).rows[0];
      if (!plan || plan.status !== 'approved')
        throw new ConflictException('Only an approved fee plan can become effective');
      await c.query(
        `UPDATE fee_plan_versions
         SET status='superseded',updated_at=now()
         WHERE tenant_id=$1 AND plan_key=$2 AND status='effective' AND id<>$3`,
        [req.actor.tenantId, plan.plan_key, planId],
      );
      const row = (
        await c.query(
          `UPDATE fee_plan_versions
           SET status='effective',effective_from=current_date,updated_at=now()
           WHERE id=$1 AND tenant_id=$2 RETURNING *`,
          [planId, req.actor.tenantId],
        )
      ).rows[0];
      await this.db.audit(c, req.actor.id, 'fee_plan.effective', planId);
      return row;
    });
  }

  @Post(':id/assign')
  async assign(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) {
    const planId = parseUuid(id);
    const input = assignSchema.parse(body);
    return this.db.tx(async (c) => {
      const plan = (
        await c.query(
          'SELECT * FROM fee_plan_versions WHERE id=$1 AND tenant_id=$2 AND status=$3',
          [planId, req.actor.tenantId, 'effective'],
        )
      ).rows[0];
      const student = (
        await c.query(
          'SELECT id,student_reference,branch_id,academic_year_id FROM academic_students WHERE id=$1 AND tenant_id=$2 AND status=$3',
          [input.studentId, req.actor.tenantId, 'active'],
        )
      ).rows[0];
      if (!plan || !student)
        throw new ConflictException('Effective plan and active student must belong to this workspace');
      if (plan.branch_id && plan.branch_id !== student.branch_id)
        throw new ConflictException('Student branch is not eligible for this fee plan');
      if (plan.academic_year_id && plan.academic_year_id !== student.academic_year_id)
        throw new ConflictException('Student academic year is not eligible for this fee plan');
      if (input.payerId) {
        const payer = (
          await c.query('SELECT id FROM fee_payers WHERE id=$1 AND tenant_id=$2 AND active=true', [
            input.payerId,
            req.actor.tenantId,
          ])
        ).rows[0];
        if (!payer) throw new ConflictException('Payer is outside this workspace or inactive');
      }

      const components = (
        await c.query('SELECT * FROM fee_plan_components WHERE plan_id=$1 ORDER BY code', [planId])
      ).rows;
      const installments = (
        await c.query('SELECT * FROM fee_plan_installments WHERE plan_id=$1 ORDER BY sequence', [
          planId,
        ])
      ).rows;
      const total = installments.reduce((sum, item) => sum + Number(item.amount_minor), 0);
      const schedule = (
        await c.query(
          `INSERT INTO fee_schedules(
             tenant_id,account_reference,payer_id,scope_type,scope_reference,currency,total_amount_minor,
             gross_amount_minor,concession_amount_minor,note,status,version,created_by
           ) VALUES($1,$2,$3,'student',$4,'INR',$5,$5,0,$6,'active',2,$7)
           RETURNING *`,
          [
            req.actor.tenantId,
            input.accountReference,
            input.payerId || null,
            student.student_reference,
            total,
            'Assigned from fee plan ' + plan.plan_key + ' v' + plan.version,
            req.actor.id,
          ],
        )
      ).rows[0];

      for (const component of components)
        await c.query(
          `INSERT INTO fee_schedule_components(tenant_id,schedule_id,code,label,amount_minor)
           VALUES($1,$2,$3,$4,$5)`,
          [
            req.actor.tenantId,
            schedule.id,
            component.code,
            component.label,
            component.amount_minor,
          ],
        );
      for (const installment of installments)
        await c.query(
          `INSERT INTO fee_installments(
             tenant_id,schedule_id,sequence,due_date,amount_minor
           ) VALUES($1,$2,$3,$4,$5)`,
          [
            req.actor.tenantId,
            schedule.id,
            installment.sequence,
            installment.due_date,
            installment.amount_minor,
          ],
        );
      const assignment = (
        await c.query(
          `INSERT INTO student_fee_plan_assignments(
             tenant_id,student_id,plan_id,schedule_id,created_by
           ) VALUES($1,$2,$3,$4,$5)
           RETURNING *`,
          [req.actor.tenantId, student.id, planId, schedule.id, req.actor.id],
        )
      ).rows[0];
      await this.db.audit(c, req.actor.id, 'fee_plan.assign', assignment.id, {
        studentId: student.id,
        planId,
        scheduleId: schedule.id,
      });
      return { assignment, schedule };
    });
  }

  @Get('receivables/ageing')
  async ageing(@Req() req: AuthedRequest) {
    return this.ageingRows(req.actor.tenantId);
  }

  @Get('statements/students/:id')
  async studentStatement(@Req() req: AuthedRequest, @Param('id') id: string) {
    const studentId = parseUuid(id);
    const student = (
      await this.db.query(
        'SELECT id,student_reference,full_name FROM academic_students WHERE id=$1 AND tenant_id=$2',
        [studentId, req.actor.tenantId],
      )
    )[0];
    if (!student) throw new ConflictException('Student does not exist in this workspace');
    const assignments = await this.db.query(
      `SELECT a.*,p.plan_key,p.version,p.name,s.account_reference
       FROM student_fee_plan_assignments a
       JOIN fee_plan_versions p ON p.id=a.plan_id
       JOIN fee_schedules s ON s.id=a.schedule_id
       WHERE a.tenant_id=$1 AND a.student_id=$2
       ORDER BY a.assigned_on,a.created_at`,
      [req.actor.tenantId, studentId],
    );
    const scheduleIds = assignments.map((item: any) => item.schedule_id);
    const movements = scheduleIds.length
      ? await this.db.query(
          `SELECT 'charge' AS kind,i.schedule_id,i.id AS reference_id,i.due_date::text AS occurred_on,
                  (i.amount_minor-i.adjustment_amount_minor)::bigint AS debit_minor,0::bigint AS credit_minor,
                  'Installment #'||i.sequence AS description
           FROM fee_installments i
           WHERE i.tenant_id=$1 AND i.schedule_id=ANY($2::uuid[])
           UNION ALL
           SELECT 'payment',p.schedule_id,p.id,p.recorded_at::date::text,0::bigint,
                  (p.amount_minor-p.refunded_amount_minor)::bigint,'Confirmed payment'
           FROM payment_records p
           WHERE p.tenant_id=$1 AND p.schedule_id=ANY($2::uuid[])
           UNION ALL
           SELECT 'adjustment',a.schedule_id,a.id,a.effective_on::text,0::bigint,a.amount_minor::bigint,
                  initcap(replace(a.kind,'_',' '))||' adjustment'
           FROM fee_adjustment_requests a
           WHERE a.tenant_id=$1 AND a.schedule_id=ANY($2::uuid[]) AND a.status='applied'
           ORDER BY occurred_on,reference_id`,
          [req.actor.tenantId, scheduleIds],
        )
      : [];
    const totals = movements.reduce(
      (acc: { debitMinor: number; creditMinor: number }, row: any) => ({
        debitMinor: acc.debitMinor + Number(row.debit_minor),
        creditMinor: acc.creditMinor + Number(row.credit_minor),
      }),
      { debitMinor: 0, creditMinor: 0 },
    );
    return {
      student,
      assignments,
      movements,
      totals: { ...totals, balanceMinor: totals.debitMinor - totals.creditMinor },
      asOf: new Date().toISOString(),
    };
  }

  @Get('statements/payers/:id')
  async familyStatement(@Req() req: AuthedRequest, @Param('id') id: string) {
    const payerId = parseUuid(id);
    const payer = (
      await this.db.query(
        'SELECT id,account_reference,display_name FROM fee_payers WHERE id=$1 AND tenant_id=$2',
        [payerId, req.actor.tenantId],
      )
    )[0];
    if (!payer) throw new ConflictException('Payer does not exist in this workspace');
    const schedules = await this.db.query(
      `SELECT s.id,s.account_reference,s.scope_reference,
              coalesce(sum(i.amount_minor-i.adjustment_amount_minor-i.paid_amount_minor),0)::bigint AS outstanding_minor
       FROM fee_schedules s
       LEFT JOIN fee_installments i ON i.schedule_id=s.id AND i.status<>'cancelled'
       WHERE s.tenant_id=$1 AND s.payer_id=$2
       GROUP BY s.id ORDER BY s.created_at`,
      [req.actor.tenantId, payerId],
    );
    return {
      payer,
      schedules,
      outstandingMinor: schedules.reduce((sum: number, row: any) => sum + Number(row.outstanding_minor), 0),
      asOf: new Date().toISOString(),
    };
  }

  @Post('adjustments')
  async requestAdjustment(@Req() req: AuthedRequest, @Body() body: unknown) {
    const input = adjustmentRequestSchema.parse(body);
    const schedule = (
      await this.db.query(
        "SELECT id FROM fee_schedules WHERE id=$1 AND tenant_id=$2 AND status IN('active','completed')",
        [input.scheduleId, req.actor.tenantId],
      )
    )[0];
    if (!schedule) throw new ConflictException('Schedule is outside this workspace or unavailable');
    return this.db.tx(async (c) => {
      const row = (
        await c.query(
          `INSERT INTO fee_adjustment_requests(
             tenant_id,schedule_id,kind,amount_minor,effective_on,reason,requested_by
           ) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [
            req.actor.tenantId,
            input.scheduleId,
            input.kind,
            input.amountMinor,
            input.effectiveOn || new Date().toISOString().slice(0, 10),
            input.reason,
            req.actor.id,
          ],
        )
      ).rows[0];
      await this.db.audit(c, req.actor.id, 'fees.adjustment.request', row.id, {
        scheduleId: input.scheduleId,
        kind: input.kind,
        amountMinor: input.amountMinor,
      });
      return row;
    });
  }

  @Post('adjustments/:id/decide')
  async decideAdjustment(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const adjustmentId = parseUuid(id);
    const input = decisionSchema.parse(body);
    return this.db.tx(async (c) => {
      const request = (
        await c.query(
          'SELECT * FROM fee_adjustment_requests WHERE id=$1 AND tenant_id=$2 FOR UPDATE',
          [adjustmentId, req.actor.tenantId],
        )
      ).rows[0];
      if (!request || request.status !== 'pending')
        throw new ConflictException('Adjustment is not pending');
      if (request.requested_by === req.actor.id)
        throw new ConflictException('Adjustment maker cannot decide their own request');
      const status = input.decision === 'approve' ? 'approved' : 'rejected';
      const row = (
        await c.query(
          `UPDATE fee_adjustment_requests
           SET status=$3,decided_by=$4,decision_reason=$5,decided_at=now()
           WHERE id=$1 AND tenant_id=$2 RETURNING *`,
          [adjustmentId, req.actor.tenantId, status, req.actor.id, input.reason],
        )
      ).rows[0];
      await this.db.audit(c, req.actor.id, 'fees.adjustment.decide', adjustmentId, {
        status,
      });
      return row;
    });
  }

  @Post('adjustments/:id/apply')
  async applyAdjustment(@Req() req: AuthedRequest, @Param('id') id: string) {
    const adjustmentId = parseUuid(id);
    return this.db.tx(async (c) => {
      const request = (
        await c.query(
          'SELECT * FROM fee_adjustment_requests WHERE id=$1 AND tenant_id=$2 FOR UPDATE',
          [adjustmentId, req.actor.tenantId],
        )
      ).rows[0];
      if (!request || request.status !== 'approved')
        throw new ConflictException('Only an approved adjustment can be applied');

      const installments = (
        await c.query(
          `SELECT id,amount_minor,adjustment_amount_minor,paid_amount_minor,status
           FROM fee_installments
           WHERE schedule_id=$1 AND tenant_id=$2 AND status<>'cancelled'
           ORDER BY due_date DESC,sequence DESC FOR UPDATE`,
          [request.schedule_id, req.actor.tenantId],
        )
      ).rows;
      let remaining = Number(request.amount_minor);
      for (const installment of installments) {
        if (remaining <= 0) break;
        const room =
          Number(installment.amount_minor) -
          Number(installment.adjustment_amount_minor) -
          Number(installment.paid_amount_minor);
        if (room <= 0) continue;
        const applied = Math.min(room, remaining);
        const nextAdjustment = Number(installment.adjustment_amount_minor) + applied;
        const settled =
          Number(installment.paid_amount_minor) + nextAdjustment === Number(installment.amount_minor);
        await c.query(
          `UPDATE fee_installments
           SET adjustment_amount_minor=$2,status=CASE WHEN $3 THEN 'paid' ELSE status END
           WHERE id=$1`,
          [installment.id, nextAdjustment, settled],
        );
        remaining -= applied;
      }
      if (remaining > 0)
        throw new ConflictException('Adjustment exceeds the remaining receivable balance');
      const row = (
        await c.query(
          `UPDATE fee_adjustment_requests
           SET status='applied',applied_at=now()
           WHERE id=$1 AND tenant_id=$2 RETURNING *`,
          [adjustmentId, req.actor.tenantId],
        )
      ).rows[0];
      await this.db.audit(c, req.actor.id, 'fees.adjustment.apply', adjustmentId, {
        amountMinor: request.amount_minor,
        scheduleId: request.schedule_id,
      });
      return row;
    });
  }

  @Post('credits')
  async createCredit(@Req() req: AuthedRequest, @Body() body: unknown) {
    const input = creditSchema.parse(body);
    if (input.payerId) {
      const payer = (
        await this.db.query('SELECT id FROM fee_payers WHERE id=$1 AND tenant_id=$2', [
          input.payerId,
          req.actor.tenantId,
        ])
      )[0];
      if (!payer) throw new ConflictException('Payer does not exist in this workspace');
    }
    return this.db.tx(async (c) => {
      const row = (
        await c.query(
          `INSERT INTO fee_credits(
             tenant_id,payer_id,account_reference,source,amount_minor,evidence_reference,note,created_by
           ) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [
            req.actor.tenantId,
            input.payerId || null,
            input.accountReference,
            input.source,
            input.amountMinor,
            input.evidenceReference || null,
            input.note,
            req.actor.id,
          ],
        )
      ).rows[0];
      await this.db.audit(c, req.actor.id, 'fees.credit.create', row.id, {
        source: input.source,
        amountMinor: input.amountMinor,
      });
      return row;
    });
  }

  @Post('credits/:id/allocate')
  async allocateCredit(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const creditId = parseUuid(id);
    const input = allocateCreditSchema.parse(body);
    return this.db.tx(async (c) => {
      const credit = (
        await c.query('SELECT * FROM fee_credits WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [
          creditId,
          req.actor.tenantId,
        ])
      ).rows[0];
      const installment = (
        await c.query(
          `SELECT i.*,s.status AS schedule_status
           FROM fee_installments i JOIN fee_schedules s ON s.id=i.schedule_id
           WHERE i.id=$1 AND i.tenant_id=$2 FOR UPDATE`,
          [input.installmentId, req.actor.tenantId],
        )
      ).rows[0];
      if (!credit || credit.status !== 'active' || !installment)
        throw new ConflictException('Active credit and installment must belong to this workspace');
      const available = Number(credit.amount_minor) - Number(credit.applied_minor);
      const due =
        Number(installment.amount_minor) -
        Number(installment.adjustment_amount_minor) -
        Number(installment.paid_amount_minor);
      if (input.amountMinor > available || input.amountMinor > due)
        throw new ConflictException('Credit allocation exceeds available credit or receivable');
      const row = (
        await c.query(
          `INSERT INTO fee_credit_allocations(
             tenant_id,credit_id,installment_id,amount_minor,created_by
           ) VALUES($1,$2,$3,$4,$5) RETURNING *`,
          [req.actor.tenantId, creditId, input.installmentId, input.amountMinor, req.actor.id],
        )
      ).rows[0];
      const nextApplied = Number(credit.applied_minor) + input.amountMinor;
      await c.query(
        `UPDATE fee_credits
         SET applied_minor=$2,status=CASE WHEN $2=amount_minor THEN 'fully_applied' ELSE 'active' END,
             updated_at=now()
         WHERE id=$1`,
        [creditId, nextApplied],
      );
      const nextPaid = Number(installment.paid_amount_minor) + input.amountMinor;
      const settled =
        nextPaid + Number(installment.adjustment_amount_minor) === Number(installment.amount_minor);
      await c.query(
        `UPDATE fee_installments
         SET paid_amount_minor=$2,status=CASE WHEN $3 THEN 'paid' ELSE 'part_paid' END
         WHERE id=$1`,
        [input.installmentId, nextPaid, settled],
      );
      await this.db.audit(c, req.actor.id, 'fees.credit.allocate', row.id, {
        creditId,
        installmentId: input.installmentId,
        amountMinor: input.amountMinor,
      });
      return row;
    });
  }

  @Post('changes')
  async requestChange(@Req() req: AuthedRequest, @Body() body: unknown) {
    const input = changeSchema.parse(body);
    const schedule = (
      await this.db.query(
        "SELECT id FROM fee_schedules WHERE id=$1 AND tenant_id=$2 AND status IN('active','completed')",
        [input.scheduleId, req.actor.tenantId],
      )
    )[0];
    if (!schedule) throw new ConflictException('Schedule does not exist in this workspace');
    if (input.assignmentId) {
      const assignment = (
        await this.db.query(
          'SELECT id FROM student_fee_plan_assignments WHERE id=$1 AND tenant_id=$2 AND schedule_id=$3',
          [input.assignmentId, req.actor.tenantId, input.scheduleId],
        )
      )[0];
      if (!assignment) throw new ConflictException('Assignment does not match this schedule');
    }
    return this.db.tx(async (c) => {
      const row = (
        await c.query(
          `INSERT INTO receivable_change_requests(
             tenant_id,assignment_id,schedule_id,change_type,payload,reason,requested_by
           ) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [
            req.actor.tenantId,
            input.assignmentId || null,
            input.scheduleId,
            input.changeType,
            JSON.stringify(input.payload),
            input.reason,
            req.actor.id,
          ],
        )
      ).rows[0];
      await this.db.audit(c, req.actor.id, 'fees.receivable_change.request', row.id, {
        changeType: input.changeType,
        scheduleId: input.scheduleId,
      });
      return row;
    });
  }

  @Post('changes/:id/decide')
  async decideChange(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) {
    const requestId = parseUuid(id);
    const input = decisionSchema.parse(body);
    return this.db.tx(async (c) => {
      const request = (
        await c.query(
          'SELECT * FROM receivable_change_requests WHERE id=$1 AND tenant_id=$2 FOR UPDATE',
          [requestId, req.actor.tenantId],
        )
      ).rows[0];
      if (!request || request.status !== 'pending')
        throw new ConflictException('Receivable change is not pending');
      if (request.requested_by === req.actor.id)
        throw new ConflictException('Change maker cannot decide their own request');
      const status = input.decision === 'approve' ? 'approved' : 'rejected';
      const row = (
        await c.query(
          `UPDATE receivable_change_requests
           SET status=$3,decided_by=$4,decided_at=now(),
               payload=payload||jsonb_build_object('decisionReason',$5::text)
           WHERE id=$1 AND tenant_id=$2 RETURNING *`,
          [requestId, req.actor.tenantId, status, req.actor.id, input.reason],
        )
      ).rows[0];
      await this.db.audit(c, req.actor.id, 'fees.receivable_change.decide', requestId, {
        status,
      });
      return row;
    });
  }

  @Post('changes/:id/execute')
  async executeChange(@Req() req: AuthedRequest, @Param('id') id: string) {
    const requestId = parseUuid(id);
    return this.db.tx(async (c) => {
      const request = (
        await c.query(
          'SELECT * FROM receivable_change_requests WHERE id=$1 AND tenant_id=$2 FOR UPDATE',
          [requestId, req.actor.tenantId],
        )
      ).rows[0];
      if (!request || request.status !== 'approved')
        throw new ConflictException('Only an approved receivable change can be executed');

      const activeAttempts = (
        await c.query(
          `SELECT count(*)::int AS count
           FROM autopay_debit_attempts
           WHERE tenant_id=$1 AND schedule_id=$2 AND status IN('queued','submitted','unknown')`,
          [req.actor.tenantId, request.schedule_id],
        )
      ).rows[0]!.count;
      if (activeAttempts)
        throw new ConflictException('Pending or uncertain debit attempt blocks receivable closure');

      if (request.change_type === 'withdrawal' || request.change_type === 'transfer') {
        await c.query(
          `UPDATE fee_installments
           SET status='cancelled'
           WHERE tenant_id=$1 AND schedule_id=$2
             AND status IN('scheduled','due','overdue') AND paid_amount_minor=0`,
          [req.actor.tenantId, request.schedule_id],
        );
        if (request.assignment_id)
          await c.query(
            `UPDATE student_fee_plan_assignments
             SET status=$3,ended_on=current_date
             WHERE id=$1 AND tenant_id=$2`,
            [
              request.assignment_id,
              req.actor.tenantId,
              request.change_type === 'withdrawal' ? 'withdrawn' : 'transferred',
            ],
          );
      } else if (request.change_type === 'plan_change') {
        if (request.assignment_id)
          await c.query(
            `UPDATE student_fee_plan_assignments
             SET status='superseded',ended_on=current_date
             WHERE id=$1 AND tenant_id=$2`,
            [request.assignment_id, req.actor.tenantId],
          );
      } else if (request.change_type === 'write_off') {
        throw new ConflictException(
          'Write-off execution requires a separately approved fee adjustment so payer payment is never fabricated',
        );
      }

      const row = (
        await c.query(
          `UPDATE receivable_change_requests
           SET status='executed',executed_by=$3,executed_at=now()
           WHERE id=$1 AND tenant_id=$2 RETURNING *`,
          [requestId, req.actor.tenantId, req.actor.id],
        )
      ).rows[0];
      await this.db.audit(c, req.actor.id, 'fees.receivable_change.execute', requestId, {
        changeType: request.change_type,
        scheduleId: request.schedule_id,
      });
      return row;
    });
  }

  private async ageingRows(tenantId: string) {
    return this.db.query(
      `SELECT
         CASE
           WHEN i.due_date>=current_date THEN 'not_due'
           WHEN current_date-i.due_date BETWEEN 1 AND 30 THEN '1_30'
           WHEN current_date-i.due_date BETWEEN 31 AND 60 THEN '31_60'
           WHEN current_date-i.due_date BETWEEN 61 AND 90 THEN '61_90'
           ELSE '90_plus'
         END AS bucket,
         count(*)::int AS obligations,
         coalesce(sum(i.amount_minor-i.adjustment_amount_minor-i.paid_amount_minor),0)::bigint AS outstanding_minor
       FROM fee_installments i
       JOIN fee_schedules s ON s.id=i.schedule_id
       WHERE i.tenant_id=$1
         AND s.status IN('active','completed')
         AND i.status<>'cancelled'
         AND i.amount_minor-i.adjustment_amount_minor-i.paid_amount_minor>0
       GROUP BY 1
       ORDER BY CASE
         WHEN CASE
           WHEN i.due_date>=current_date THEN 'not_due'
           WHEN current_date-i.due_date BETWEEN 1 AND 30 THEN '1_30'
           WHEN current_date-i.due_date BETWEEN 31 AND 60 THEN '31_60'
           WHEN current_date-i.due_date BETWEEN 61 AND 90 THEN '61_90'
           ELSE '90_plus'
         END='not_due' THEN 0
         WHEN CASE
           WHEN i.due_date>=current_date THEN 'not_due'
           WHEN current_date-i.due_date BETWEEN 1 AND 30 THEN '1_30'
           WHEN current_date-i.due_date BETWEEN 31 AND 60 THEN '31_60'
           WHEN current_date-i.due_date BETWEEN 61 AND 90 THEN '61_90'
           ELSE '90_plus'
         END='1_30' THEN 1
         WHEN CASE
           WHEN i.due_date>=current_date THEN 'not_due'
           WHEN current_date-i.due_date BETWEEN 1 AND 30 THEN '1_30'
           WHEN current_date-i.due_date BETWEEN 31 AND 60 THEN '31_60'
           WHEN current_date-i.due_date BETWEEN 61 AND 90 THEN '61_90'
           ELSE '90_plus'
         END='31_60' THEN 2
         WHEN CASE
           WHEN i.due_date>=current_date THEN 'not_due'
           WHEN current_date-i.due_date BETWEEN 1 AND 30 THEN '1_30'
           WHEN current_date-i.due_date BETWEEN 31 AND 60 THEN '31_60'
           WHEN current_date-i.due_date BETWEEN 61 AND 90 THEN '61_90'
           ELSE '90_plus'
         END='61_90' THEN 3 ELSE 4 END`,
      [tenantId],
    );
  }

  private async validateScope(tenantId: string, academicYearId?: string, branchId?: string) {
    if (academicYearId) {
      const year = (
        await this.db.query('SELECT id FROM academic_years WHERE id=$1 AND tenant_id=$2', [
          academicYearId,
          tenantId,
        ])
      )[0];
      if (!year) throw new ConflictException('Academic year is outside this workspace');
    }
    if (branchId) {
      const branch = (
        await this.db.query('SELECT id FROM branches WHERE id=$1 AND tenant_id=$2', [
          branchId,
          tenantId,
        ])
      )[0];
      if (!branch) throw new ConflictException('Branch is outside this workspace');
    }
  }
}
