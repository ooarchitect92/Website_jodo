import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
export const digest = (s: string) => createHash('sha256').update(s).digest('hex');
export const keyed = (s: string) =>
  createHmac('sha256', process.env.SESSION_SECRET || 'test-only')
    .update(s)
    .digest('hex');
export const token = () => randomBytes(32).toString('base64url');
export function equal(a: string, b: string) {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
export function encrypt(value: unknown) {
  const key = Buffer.from(process.env.DATA_ENCRYPTION_KEY || '', 'hex');
  if (key.length !== 32) throw Error('DATA_ENCRYPTION_KEY must be 32 bytes');
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const bytes = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), bytes].map((b) => b.toString('base64url')).join('.');
}
export function decrypt<T = Record<string, unknown>>(value: string): T {
  const parts = value.split('.').map((s) => Buffer.from(s, 'base64url'));
  const d = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(process.env.DATA_ENCRYPTION_KEY || '', 'hex'),
    parts[0]!,
  );
  d.setAuthTag(parts[1]!);
  return JSON.parse(Buffer.concat([d.update(parts[2]!), d.final()]).toString()) as T;
}
export function bucket(unit: string, experiment: string) {
  return parseInt(digest(experiment + ':' + unit).slice(0, 8), 16) % 10000;
}
