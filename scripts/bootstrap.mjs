import { access, readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
try {
  await access('.env');
  console.log('Existing .env preserved. No secrets or data were changed.');
} catch {
  const owner = randomBytes(24).toString('hex'),
    app = randomBytes(24).toString('hex');
  let env = await readFile('.env.example', 'utf8');
  const values = {
    DATABASE_URL: `postgresql://jodo_app:${app}@127.0.0.1:5432/website_jodo`,
    MIGRATION_DATABASE_URL: `postgresql://jodo_owner:${owner}@127.0.0.1:5432/website_jodo`,
    POSTGRES_PASSWORD: owner,
    APP_DB_PASSWORD: app,
    SESSION_SECRET: randomBytes(32).toString('hex'),
    DATA_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    AUDIT_CHECKPOINT_SECRET: randomBytes(32).toString('hex'),
  };
  for (const [key, value] of Object.entries(values))
    env = env.replace(new RegExp('^' + key + '=.*$', 'm'), key + '=' + value);
  await writeFile('.env', env, { flag: 'wx', mode: 0o600 });
  console.log(
    'Created private .env with unique secrets. Start PostgreSQL, then run migrate and seed:demo.',
  );
}
await mkdir('.data/media', { recursive: true });
await mkdir('.data/audit-export', { recursive: true });
