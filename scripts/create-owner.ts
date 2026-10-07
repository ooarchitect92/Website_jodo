import { Pool } from 'pg';
import * as argon2 from 'argon2';
import { authenticator } from 'otplib';
import { encrypt } from '../packages/core/src/security';
async function main() {
  const role = process.env.STAFF_ROLE || 'owner';
  if (!['owner', 'editor', 'sales', 'analyst'].includes(role)) throw Error('Invalid STAFF_ROLE');
  const email = process.env.OWNER_EMAIL,
    password = process.env.OWNER_PASSWORD;
  const secret = process.env.OWNER_TOTP_SECRET || authenticator.generateSecret();
  if (!email || !password || password.length < 16)
    throw Error('Set OWNER_EMAIL and a unique OWNER_PASSWORD of at least 16 characters');
  const p = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
  });
  try {
    await p.query('INSERT INTO users(email,password_hash,totp_secret,role) VALUES($1,$2,$3,$4)', [
      email.toLowerCase(),
      await argon2.hash(password, { type: argon2.argon2id }),
      encrypt(secret),
      role,
    ]);
    console.log('Staff account created. Existing accounts are never overwritten.');
    if (!process.env.OWNER_TOTP_SECRET)
      console.log('Add this secret to your authenticator now; it is shown only once:', secret);
  } finally {
    await p.end();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
