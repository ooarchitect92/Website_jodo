import 'reflect-metadata';
import { notifyStaff } from './notifications';
import { Pool, PoolClient } from 'pg';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHmac } from 'node:crypto';
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
      await db.tx(async (c) => {
        if (job.type === 'lead.accepted') {
          await c.query(
            "INSERT INTO tasks(lead_id,title,execution_key) VALUES($1,'Review new enquiry and arrange follow-up',$2) ON CONFLICT(execution_key) DO NOTHING",
            [job.aggregate_id, 'lead:' + job.event_id],
          );
          await c.query(
            'INSERT INTO workflow_runs(workflow_id,lead_id,definition) SELECT id,$1,definition FROM workflows WHERE active=true ON CONFLICT(workflow_id,lead_id) DO NOTHING',
            [job.aggregate_id],
          );
        }
        const blocked = job.type.startsWith('lead.') && delivery !== 'provider_accepted';
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
    const due = (
      await c.query(
        "SELECT r.*,l.stage,w.active FROM workflow_runs r JOIN leads l ON l.id=r.lead_id JOIN workflows w ON w.id=r.workflow_id WHERE r.status='running' AND r.due_at<=now() ORDER BY r.due_at FOR UPDATE OF r SKIP LOCKED LIMIT 30",
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
          'INSERT INTO tasks(lead_id,title,execution_key) VALUES($1,$2,$3) ON CONFLICT(execution_key) DO NOTHING',
          [run.lead_id, node.title, 'workflow:' + run.id + ':' + run.next_node],
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
