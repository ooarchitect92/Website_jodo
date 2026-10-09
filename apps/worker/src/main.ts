import 'reflect-metadata';
import { notifyFeePayer, notifyStaff } from './notifications';
import { submitAutopayDebit } from './payments';
import { Pool, PoolClient } from 'pg';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHmac, randomUUID } from 'node:crypto';
import { Db } from '../../api/src/db';
import { checkConfig } from '../../api/src/config';
import { workflowSchema, pageSchema } from '../../../packages/core/src/contracts';
export async function tick(db: Db) {
  // SKIP LOCKED leases allow multiple workers; source business records are never deleted.
  const jobs = await db.tx(
    async (c) =>
      (
        await c.query(
          "UPDATE outbox SET status='processing',attempts=attempts+1,lease_until=now()+interval '30 seconds' WHERE id IN (SELECT id FROM outbox WHERE (status IN('pending','retry') AND available_at<=now()) OR (status='processing' AND lease_until<now()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 20) RETURNING *",
        )
      ).rows,
  );
  for (const job of jobs) {
    try {
      let delivery = 'disabled';
      if (job.type === 'lead.accepted') delivery = await notifyStaff(db, job.event_id);
      if (job.type.startsWith('fee.reminder.') || job.type === 'payment.external_confirmed')
        delivery = await notifyFeePayer(db, job.event_id);
      if (job.type === 'autopay.debit.requested')
        delivery = await submitAutopayDebit(db, job.event_id);
      await db.tx(async (c) => {
        if (job.type === 'lead.accepted') {
          await c.query(
            "INSERT INTO tasks(lead_id,title,execution_key,tenant_id) SELECT id,'Review new enquiry and arrange follow-up',$2,tenant_id FROM leads WHERE id=$1 ON CONFLICT(execution_key) DO NOTHING",
            [job.aggregate_id, 'lead:' + job.event_id],
          );
          await c.query(
            'INSERT INTO workflow_runs(workflow_id,lead_id,definition,tenant_id) SELECT w.id,l.id,w.definition,l.tenant_id FROM leads l JOIN workflows w ON w.tenant_id=l.tenant_id WHERE l.id=$1 AND w.active=true ON CONFLICT(workflow_id,lead_id) DO NOTHING',
            [job.aggregate_id],
          );
        }
        const requiresDelivery =
          job.type.startsWith('lead.') ||
          job.type.startsWith('fee.reminder.') ||
          (job.type === 'payment.external_confirmed' && job.payload?.payerCommunication === true) ||
          job.type === 'autopay.debit.requested';
        const blocked = requiresDelivery && delivery !== 'provider_accepted';
        await c.query('UPDATE outbox SET status=$2,last_error=$3,lease_until=NULL WHERE id=$1', [
          job.id,
          blocked ? 'blocked' : 'completed',
          blocked
            ? delivery === 'disabled'
              ? 'EXTERNAL_DELIVERY_NOT_ACTIVATED'
              : 'DELIVERY_REQUIRES_RECONCILIATION'
            : null,
        ]);
        await db.audit(c, 'worker', 'outbox.processed', job.id, {
          type: job.type,
          status: blocked ? 'blocked' : 'completed',
        });
      });
    } catch {
      await db.query(
        "UPDATE outbox SET status=CASE WHEN attempts>=5 THEN 'dead_letter' ELSE 'retry' END,available_at=now()+interval '30 seconds',lease_until=NULL,last_error='PROCESSING_FAILED' WHERE id=$1",
        [job.id],
      );
    }
  }
  await db.tx(async (c) => {
    const expiredCheckouts = (
      await c.query(
        `UPDATE payment_checkout_sessions
         SET status='expired',updated_at=now()
         WHERE status='created' AND expires_at IS NOT NULL AND expires_at<now()
         RETURNING id`,
      )
    ).rows;
    for (const row of expiredCheckouts)
      await db.audit(c, 'worker', 'fees.checkout.expired', row.id);

    const lateFeeRows = (
      await c.query(
        `SELECT i.id AS installment_id,i.schedule_id,i.due_date,i.status,
                r.id AS rule_id,r.mode,r.grace_days,r.amount_minor,r.cap_minor,
                coalesce((
                  SELECT sum(a.amount_minor) FROM late_fee_assessments a
                  WHERE a.installment_id=i.id AND a.status<>'waived'
                ),0)::bigint AS assessed_minor,
                coalesce((
                  SELECT count(*) FROM late_fee_assessments a
                  WHERE a.installment_id=i.id
                ),0)::int AS assessment_count
         FROM fee_installments i
         JOIN fee_schedules s ON s.id=i.schedule_id
         JOIN late_fee_rules r ON r.schedule_id=s.id
         WHERE s.status='active'
           AND r.active=true
           AND i.status NOT IN('paid','cancelled','adjusted')
           AND current_date > i.due_date + r.grace_days
         ORDER BY i.due_date
         FOR UPDATE OF i SKIP LOCKED
         LIMIT 100`,
      )
    ).rows;
    for (const row of lateFeeRows) {
      if (row.mode === 'fixed_once' && Number(row.assessment_count) > 0) continue;
      const already = Number(row.assessed_minor || 0);
      const cap = row.cap_minor === null ? null : Number(row.cap_minor);
      if (cap !== null && already >= cap) continue;
      const amount =
        cap === null ? Number(row.amount_minor) : Math.min(Number(row.amount_minor), cap - already);
      if (amount <= 0) continue;
      const assessed = await c.query(
        `INSERT INTO late_fee_assessments(
           schedule_id,installment_id,rule_id,assessment_date,amount_minor
         ) VALUES($1,$2,$3,current_date,$4)
         ON CONFLICT(installment_id,assessment_date) DO NOTHING
         RETURNING id`,
        [row.schedule_id, row.installment_id, row.rule_id, amount],
      );
      if (!assessed.rowCount) continue;
      await db.audit(c, 'worker', 'fees.late_fee.assessed', assessed.rows[0].id, {
        scheduleId: row.schedule_id,
        installmentId: row.installment_id,
        mode: row.mode,
        amountMinor: amount,
      });
    }

    const reminderRows = (
      await c.query(
        `SELECT i.id AS installment_id,i.schedule_id,s.payer_id,p.preferred_channel,
                CASE
                  WHEN i.due_date=current_date+3 THEN 'upcoming_3d'
                  WHEN i.due_date=current_date THEN 'due_today'
                  WHEN i.due_date<current_date THEN 'overdue'
                  ELSE NULL
                END AS reminder_key
         FROM fee_installments i
         JOIN fee_schedules s ON s.id=i.schedule_id
         JOIN fee_payers p ON p.id=s.payer_id
         WHERE s.status='active'
           AND p.active=true
           AND p.preferred_channel<>'none'
           AND i.status NOT IN('paid','cancelled','adjusted')
           AND (i.due_date=current_date+3 OR i.due_date=current_date OR i.due_date<current_date)
         ORDER BY i.due_date
         FOR UPDATE OF i SKIP LOCKED
         LIMIT 100`,
      )
    ).rows;
    for (const row of reminderRows) {
      const eventId = randomUUID();
      const inserted = await c.query(
        `INSERT INTO fee_reminder_runs(installment_id,reminder_key,reminder_date,event_id)
         VALUES($1,$2,current_date,$3)
         ON CONFLICT(installment_id,reminder_key,reminder_date) DO NOTHING
         RETURNING id`,
        [row.installment_id, row.reminder_key, eventId],
      );
      if (!inserted.rowCount) continue;
      await c.query(
        `INSERT INTO fee_communication_log(
           event_id,schedule_id,installment_id,payer_id,channel,kind,status
         ) VALUES($1,$2,$3,$4,$5,$6,'pending')`,
        [
          eventId,
          row.schedule_id,
          row.installment_id,
          row.payer_id,
          row.preferred_channel,
          row.reminder_key,
        ],
      );
      await c.query(
        `INSERT INTO outbox(event_id,type,aggregate_id,payload)
         VALUES($1,$2,$3,$4)`,
        [
          eventId,
          'fee.reminder.' + row.reminder_key,
          row.installment_id,
          { scheduleId: row.schedule_id, reminderKey: row.reminder_key },
        ],
      );
      await db.audit(c, 'worker', 'fees.reminder.queued', row.installment_id, {
        scheduleId: row.schedule_id,
        reminderKey: row.reminder_key,
        eventId,
      });
    }

    if (process.env.AUTOPAY_PROVIDER_MODE === 'mandate_api') {
      const maxAttempts = Math.max(1, Math.min(10, Number(process.env.AUTOPAY_MAX_ATTEMPTS || 3)));
      const autopayRows = (
        await c.query(
          `SELECT i.id AS installment_id,i.schedule_id,i.amount_minor,i.adjustment_amount_minor,i.paid_amount_minor,
                  s.currency,m.id AS mandate_id,m.provider,
                  coalesce(last_attempt.attempt_no,0)::int AS last_attempt_no,
                  last_attempt.status AS last_attempt_status,
                  last_attempt.next_retry_at
           FROM fee_installments i
           JOIN fee_schedules s ON s.id=i.schedule_id
           JOIN LATERAL (
             SELECT pm.id,pm.provider,pm.last_event_at
             FROM payment_mandates pm
             WHERE pm.schedule_id=s.id AND pm.status='active'
             ORDER BY pm.last_event_at DESC
             LIMIT 1
           ) m ON true
           LEFT JOIN LATERAL (
             SELECT a.attempt_no,a.status,a.next_retry_at
             FROM autopay_debit_attempts a
             WHERE a.installment_id=i.id
             ORDER BY a.attempt_no DESC
             LIMIT 1
           ) last_attempt ON true
           WHERE s.status='active'
             AND i.status NOT IN('paid','cancelled','adjusted')
             AND i.due_date<=current_date
             AND (
               last_attempt.attempt_no IS NULL
               OR (
                 last_attempt.status='failed'
                 AND last_attempt.next_retry_at IS NOT NULL
                 AND last_attempt.next_retry_at<=now()
                 AND last_attempt.attempt_no<$1
               )
             )
           ORDER BY i.due_date,i.sequence
           FOR UPDATE OF i SKIP LOCKED
           LIMIT 100`,
          [maxAttempts],
        )
      ).rows;
      for (const row of autopayRows) {
        const remaining =
          Number(row.amount_minor) -
          Number(row.adjustment_amount_minor || 0) -
          Number(row.paid_amount_minor);
        if (remaining <= 0) continue;
        const attemptNo = Number(row.last_attempt_no || 0) + 1;
        const eventId = randomUUID();
        const idempotencyKey = randomUUID();
        const attempt = (
          await c.query(
            `INSERT INTO autopay_debit_attempts(
               schedule_id,installment_id,mandate_id,idempotency_key,provider,
               amount_minor,currency,attempt_no,status
             ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'queued')
             ON CONFLICT(installment_id,attempt_no) DO NOTHING
             RETURNING id`,
            [
              row.schedule_id,
              row.installment_id,
              row.mandate_id,
              idempotencyKey,
              row.provider,
              remaining,
              row.currency,
              attemptNo,
            ],
          )
        ).rows[0];
        if (!attempt) continue;
        await c.query(
          `INSERT INTO outbox(event_id,type,aggregate_id,payload)
           VALUES($1,'autopay.debit.requested',$2,$3)`,
          [
            eventId,
            attempt.id,
            {
              scheduleId: row.schedule_id,
              installmentId: row.installment_id,
              attemptNo,
              amountMinor: remaining,
            },
          ],
        );
        await db.audit(c, 'worker', 'fees.autopay.queued', attempt.id, {
          scheduleId: row.schedule_id,
          installmentId: row.installment_id,
          attemptNo,
          amountMinor: remaining,
          eventId,
        });
      }
    }

    const due = (
      await c.query(
        "SELECT r.*,l.stage,w.active FROM workflow_runs r JOIN leads l ON l.id=r.lead_id AND l.tenant_id=r.tenant_id JOIN workflows w ON w.id=r.workflow_id AND w.tenant_id=r.tenant_id WHERE r.status='running' AND r.due_at<=now() ORDER BY r.due_at FOR UPDATE OF r SKIP LOCKED LIMIT 30",
      )
    ).rows;
    for (const run of due) {
      if (!run.active) continue;
      const graph = workflowSchema.parse(run.definition);
      const node = graph.nodes[run.next_node];
      if (!node) {
        await c.query("UPDATE workflow_runs SET status='completed' WHERE id=$1", [run.id]);
        continue;
      }
      if (node.type === 'exit_if_contacted' && run.stage !== 'new') {
        await c.query("UPDATE workflow_runs SET status='cancelled' WHERE id=$1", [run.id]);
        continue;
      }
      if (node.type === 'task')
        await c.query(
          'INSERT INTO tasks(lead_id,title,execution_key,tenant_id) VALUES($1,$2,$3,$4) ON CONFLICT(execution_key) DO NOTHING',
          [run.lead_id, node.title, 'workflow:' + run.id + ':' + run.next_node, run.tenant_id],
        );
      await c.query(
        "UPDATE workflow_runs SET next_node=next_node+1,due_at=now()+($2::int*interval '1 minute') WHERE id=$1",
        [run.id, node.type === 'delay' ? node.minutes : 0],
      );
      await db.audit(c, 'worker', 'workflow.node', run.id, {
        node: run.next_node,
        type: node.type,
      });
    }
    const scheduled = (
      await c.query(
        "SELECT * FROM content WHERE state='scheduled' AND scheduled_at<=now() AND deleted_at IS NULL FOR UPDATE SKIP LOCKED LIMIT 10",
      )
    ).rows;
    for (const row of scheduled) {
      pageSchema.parse(row.draft);
      const rev = (
        await c.query(
          'INSERT INTO revisions(content_id,body,created_by) VALUES($1,$2,$3) RETURNING id',
          [row.id, row.draft, row.approved_by],
        )
      ).rows[0];
      await c.query(
        "UPDATE content SET published_revision=$2,state='published',scheduled_at=NULL,version=version+1,updated_at=now() WHERE id=$1",
        [row.id, rev.id],
      );
      await c.query(
        "INSERT INTO outbox(event_id,type,aggregate_id) VALUES(gen_random_uuid(),'content.published',$1)",
        [row.id],
      );
      await db.audit(c, 'worker', 'content.scheduled_publish', row.id, {
        approver: row.approved_by,
        revision: rev.id,
      });
    }
  });
}
export async function checkpoint(db: Db) {
  const rows = await db.query('SELECT * FROM audit ORDER BY id');
  const data = JSON.stringify(rows);
  const signature = createHmac('sha256', process.env.AUDIT_CHECKPOINT_SECRET!)
    .update(data)
    .digest('hex');
  const dir = resolve(process.env.AUDIT_EXPORT_DIRECTORY || '.data/audit-export');
  await mkdir(dir, { recursive: true });
  const filename = 'audit-' + Date.now() + '.json';
  await writeFile(
    resolve(dir, filename),
    JSON.stringify({
      format: 1,
      note: 'Local checkpoint, not independent WORM storage',
      signature,
      rows,
    }),
    { flag: 'wx', mode: 0o600 },
  );
  return { filename, count: rows.length };
}
async function main() {
  checkConfig();
  const db = new Db();
  let stopped = false;
  process.on('SIGTERM', () => {
    stopped = true;
  });
  process.on('SIGINT', () => {
    stopped = true;
  });
  let last = 0;
  while (!stopped) {
    try {
      await tick(db);
      if (Date.now() - last > 300000) {
        await checkpoint(db);
        last = Date.now();
      }
    } catch {
      console.error('Worker cycle failed; durable jobs remain available for retry.');
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  await db.onModuleDestroy();
}
if (require.main === module)
  main().catch(() => {
    process.exitCode = 1;
  });
