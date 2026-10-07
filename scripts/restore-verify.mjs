import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { Pool } from 'pg';
import { resolve } from 'node:path';
if (!process.env.RESTORE_VERIFY_URL)
  throw Error('Set RESTORE_VERIFY_URL to a separately created *_restore_verify database.');
const u = new URL(process.env.RESTORE_VERIFY_URL);
if (!u.pathname.endsWith('_restore_verify'))
  throw Error('Refusing a target without _restore_verify suffix');
const p = new Pool({ connectionString: process.env.RESTORE_VERIFY_URL });
const count = await p.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'");
if (count.rows[0].n) throw Error('Verification database must be empty; no overwrite is allowed');
const files = (await readdir('backups')).filter((n) => n.endsWith('.dump')).sort();
const file = process.argv[2] || resolve('backups', files.at(-1) || 'missing');
const env = {
  ...process.env,
  PGHOST: u.hostname,
  PGPORT: u.port || '5432',
  PGUSER: decodeURIComponent(u.username),
  PGPASSWORD: decodeURIComponent(u.password),
  PGDATABASE: u.pathname.slice(1),
};
await new Promise((ok, fail) => {
  const c = spawn(
    'pg_restore',
    ['--no-owner', '--no-acl', '--exit-on-error', '--dbname', u.pathname.slice(1), file],
    { env, stdio: ['ignore', 'inherit', 'pipe'] },
  );
  c.on('error', fail);
  c.on('exit', (code) =>
    code === 0
      ? ok()
      : fail(Error('Restore failed; the isolated verification database is not production-ready')),
  );
});
const rows = await p.query(
  'SELECT (SELECT count(*) FROM content) AS content,(SELECT count(*) FROM revisions) AS revisions,(SELECT count(*) FROM leads) AS leads,(SELECT count(*) FROM audit) AS audit',
);
console.log('Restored relationships/counts:', rows.rows[0]);
const broken = await p.query(
  'SELECT c.id FROM content c LEFT JOIN revisions r ON r.id=c.published_revision AND r.content_id=c.id WHERE c.published_revision IS NOT NULL AND r.id IS NULL',
);
if (broken.rowCount) throw Error('Broken published revision references');
await p.end();
console.log(
  'Database restoration verified in isolation. Media, key recovery, later privacy deletions and production RTO still require separate evidence.',
);
