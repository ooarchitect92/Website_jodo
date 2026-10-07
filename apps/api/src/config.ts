export function checkConfig() {
  for (const key of [
    'DATABASE_URL',
    'SESSION_SECRET',
    'DATA_ENCRYPTION_KEY',
    'SITE_URL',
    'AUDIT_CHECKPOINT_SECRET',
  ])
    if (!process.env[key] || process.env[key]!.includes('CHANGE_ME'))
      throw Error(`Missing safe ${key}`);
  if (!/^[a-f0-9]{64}$/i.test(process.env.DATA_ENCRYPTION_KEY!))
    throw Error('Encryption key must be 64 hex characters');
  if (process.env.SESSION_SECRET!.length < 48 || process.env.AUDIT_CHECKPOINT_SECRET!.length < 48)
    throw Error('Secrets too short');
  if (process.env.BLOG_AUTO_DELETE_ENABLED !== 'false')
    throw Error('Automatic source-content deletion is prohibited');
  if (process.env.NOTIFICATION_MODE === 'smtp' || process.env.PAYER_NOTIFICATION_MODE === 'smtp') {
    for (const key of ['SMTP_HOST', 'SMTP_FROM'])
      if (!process.env[key] || /[\r\n]/.test(process.env[key]!)) throw Error('Missing safe ' + key);
    if (process.env.NOTIFICATION_MODE === 'smtp' && (!process.env.NOTIFICATION_TO || /[\r\n]/.test(process.env.NOTIFICATION_TO)))
      throw Error('Missing safe NOTIFICATION_TO');
  }
  if (!['disabled', 'smtp'].includes(process.env.PAYER_NOTIFICATION_MODE || 'disabled'))
    throw Error('Unsupported payer notification mode');
  if (process.env.DEPLOYMENT_MODE === 'production') {
    if (!process.env.SITE_URL!.startsWith('https://') || process.env.SITE_APPROVED !== 'true')
      throw Error('Production requires HTTPS and owner approval');
    if (process.env.DATABASE_URL!.includes('jodo_owner'))
      throw Error('Runtime must not use the migration owner');
  }
}
