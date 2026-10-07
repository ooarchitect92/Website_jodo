import { Pool } from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
async function main() {
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
  });
  const c = await pool.connect();
  try {
    await c.query('SELECT pg_advisory_lock(908700)');
    await c.query(
      'CREATE TABLE IF NOT EXISTS migrations(name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    for (const name of (await readdir('db/migrations')).filter((n) => n.endsWith('.sql')).sort()) {
      const sql = await readFile('db/migrations/' + name, 'utf8');
      const hash = createHash('sha256').update(sql).digest('hex');
      const old = await c.query('SELECT checksum FROM migrations WHERE name=$1', [name]);
      if (old.rowCount) {
        if (old.rows[0].checksum !== hash) throw Error('Migration checksum changed: ' + name);
        continue;
      }
      await c.query('BEGIN');
      try {
        await c.query(sql);
        await c.query('INSERT INTO migrations(name,checksum) VALUES($1,$2)', [name, hash]);
        await c.query('COMMIT');
        console.log('Applied', name);
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    }
    const user = process.env.APP_DB_USER;
    const password = process.env.APP_DB_PASSWORD;
    if (user && password) {
      if (!/^[a-z_][a-z0-9_]{2,40}$/.test(user) || password.length < 20)
        throw Error('Invalid app role configuration');
      const found = await c.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [user]);
      if (!found.rowCount)
        await c.query(`CREATE ROLE "${user}" LOGIN PASSWORD '${password.replaceAll("'", "''")}'`);
      await c.query(
        `GRANT USAGE ON SCHEMA public TO "${user}"; GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA public TO "${user}"; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO "${user}"; REVOKE UPDATE ON audit,revisions,form_revisions,migrations FROM "${user}"; REVOKE ALL ON migrations FROM "${user}"; GRANT SELECT ON migrations TO "${user}"; GRANT DELETE ON sessions,events,acquisition,consent_history,consent,rate_limits TO "${user}";`,
      );
    }
  } finally {
    await c.query('SELECT pg_advisory_unlock(908700)');
    c.release();
    await pool.end();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
