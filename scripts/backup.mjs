import { spawn } from 'node:child_process';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
const u = new URL(process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL || '');
const dir = resolve('backups');
await mkdir(dir, { recursive: true, mode: 0o700 });
const path = resolve(dir, 'website-' + new Date().toISOString().replaceAll(':', '-') + '.dump');
const env = {
  ...process.env,
  PGHOST: u.hostname,
  PGPORT: u.port || '5432',
  PGUSER: decodeURIComponent(u.username),
  PGPASSWORD: decodeURIComponent(u.password),
  PGDATABASE: u.pathname.slice(1),
};
await new Promise((ok, fail) => {
  const c = spawn('pg_dump', ['--format=custom', '--no-owner', '--no-acl', '--file', path], {
    env,
    stdio: ['ignore', 'inherit', 'pipe'],
  });
  c.on('error', fail);
  c.on('exit', (code) =>
    code === 0
      ? ok()
      : fail(Error('pg_dump failed. Check client version, credentials and server.')),
  );
});
const bytes = (await stat(path)).size;
await writeFile(
  path + '.json',
  JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      bytes,
      contains: 'Database only. Copy .data/media and retain encryption-key recovery separately.',
      restore: 'Use an isolated *_restore_verify database. Do not replay external sends.',
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log('Database backup created:', path, 'Bytes:', bytes);
