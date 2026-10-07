import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import { createHmac } from 'node:crypto';
@Injectable()
export class Db implements OnModuleDestroy {
  readonly pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    statement_timeout: 8000,
  });
  async query<T extends QueryResultRow = Record<string, any>>(sql: string, args: unknown[] = []) {
    return (await this.pool.query<T>(sql, args)).rows;
  }
  async tx<T>(f: (c: PoolClient) => Promise<T>) {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const v = await f(c);
      await c.query('COMMIT');
      return v;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
  async audit(
    c: PoolClient,
    actor: string,
    action: string,
    objectId: string,
    details: Record<string, unknown> = {},
  ) {
    await c.query('SELECT pg_advisory_xact_lock(908701)');
    const last = await c.query('SELECT hash FROM audit ORDER BY id DESC LIMIT 1');
    const previous = last.rows[0]?.hash || 'genesis';
    const message = JSON.stringify({ actor, action, objectId, details, previous });
    const hash = createHmac('sha256', process.env.AUDIT_CHECKPOINT_SECRET!)
      .update(message)
      .digest('hex');
    await c.query(
      'INSERT INTO audit(actor,action,object_id,details,previous_hash,hash) VALUES($1,$2,$3,$4,$5,$6)',
      [actor, action, objectId, details, previous, hash],
    );
  }
  async onModuleDestroy() {
    await this.pool.end();
  }
}
