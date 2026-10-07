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
    if (
      process.env.NOTIFICATION_MODE === 'smtp' &&
      (!process.env.NOTIFICATION_TO || /[\r\n]/.test(process.env.NOTIFICATION_TO))
    )
      throw Error('Missing safe NOTIFICATION_TO');
  }
  if (!['disabled', 'smtp'].includes(process.env.PAYER_NOTIFICATION_MODE || 'disabled'))
    throw Error('Unsupported payer notification mode');
  if (!['disabled', 'signed_hmac'].includes(process.env.PAYMENT_PROVIDER_MODE || 'disabled'))
    throw Error('Unsupported payment provider mode');
  if (!['disabled', 'redirect_api'].includes(process.env.PAYMENT_CHECKOUT_MODE || 'disabled'))
    throw Error('Unsupported payment checkout mode');
  if (!['disabled', 'mandate_api'].includes(process.env.AUTOPAY_PROVIDER_MODE || 'disabled'))
    throw Error('Unsupported autopay provider mode');
  if (process.env.AUTOPAY_PROVIDER_MODE === 'mandate_api') {
    if (process.env.PAYMENT_PROVIDER_MODE !== 'signed_hmac')
      throw Error('AUTOPAY_PROVIDER_MODE requires signed payment provider callbacks');
    if (
      !process.env.PAYMENT_PROVIDER_NAME ||
      !/^[a-z0-9_-]{2,40}$/.test(process.env.PAYMENT_PROVIDER_NAME)
    )
      throw Error('Missing safe PAYMENT_PROVIDER_NAME');
    for (const key of ['AUTOPAY_MANDATE_CREATE_URL', 'AUTOPAY_DEBIT_CREATE_URL'])
      if (!process.env[key]) throw Error('Missing ' + key);
    if (!process.env.AUTOPAY_API_KEY || process.env.AUTOPAY_API_KEY.length < 24)
      throw Error('AUTOPAY_API_KEY is too short');
    const hosts = (process.env.AUTOPAY_ALLOWED_HOSTS || '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
    if (!hosts.length || hosts.some((host) => !/^[A-Za-z0-9.-]+$/.test(host)))
      throw Error('Missing safe AUTOPAY_ALLOWED_HOSTS');
    for (const key of ['AUTOPAY_MANDATE_CREATE_URL', 'AUTOPAY_DEBIT_CREATE_URL']) {
      let url: URL;
      try {
        url = new URL(process.env[key]!);
      } catch {
        throw Error('Invalid ' + key);
      }
      if (!hosts.map((h) => h.toLowerCase()).includes(url.hostname.toLowerCase()))
        throw Error(key + ' host is not allowlisted');
      if (process.env.DEPLOYMENT_MODE === 'production' && url.protocol !== 'https:')
        throw Error('Production autopay provider requires HTTPS');
    }
    const timeout = Number(process.env.AUTOPAY_TIMEOUT_MS || 5000);
    if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 15000)
      throw Error('Invalid AUTOPAY_TIMEOUT_MS');
    const attempts = Number(process.env.AUTOPAY_MAX_ATTEMPTS || 3);
    if (!Number.isInteger(attempts) || attempts < 1 || attempts > 10)
      throw Error('Invalid AUTOPAY_MAX_ATTEMPTS');
  }
  if (process.env.PAYMENT_CHECKOUT_MODE === 'redirect_api') {
    if (
      !process.env.PAYMENT_PROVIDER_NAME ||
      !/^[a-z0-9_-]{2,40}$/.test(process.env.PAYMENT_PROVIDER_NAME)
    )
      throw Error('Missing safe PAYMENT_PROVIDER_NAME');
    if (!process.env.PAYMENT_CHECKOUT_CREATE_URL)
      throw Error('Missing PAYMENT_CHECKOUT_CREATE_URL');
    if (!process.env.PAYMENT_CHECKOUT_API_KEY || process.env.PAYMENT_CHECKOUT_API_KEY.length < 24)
      throw Error('PAYMENT_CHECKOUT_API_KEY is too short');
    const hosts = (process.env.PAYMENT_CHECKOUT_ALLOWED_HOSTS || '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
    if (!hosts.length || hosts.some((host) => !/^[A-Za-z0-9.-]+$/.test(host)))
      throw Error('Missing safe PAYMENT_CHECKOUT_ALLOWED_HOSTS');
    const timeout = Number(process.env.PAYMENT_CHECKOUT_TIMEOUT_MS || 5000);
    if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 15000)
      throw Error('Invalid PAYMENT_CHECKOUT_TIMEOUT_MS');
    let createUrl: URL;
    try {
      createUrl = new URL(process.env.PAYMENT_CHECKOUT_CREATE_URL);
    } catch {
      throw Error('Invalid PAYMENT_CHECKOUT_CREATE_URL');
    }
    if (!hosts.map((h) => h.toLowerCase()).includes(createUrl.hostname.toLowerCase()))
      throw Error('PAYMENT_CHECKOUT_CREATE_URL host is not allowlisted');
    if (process.env.DEPLOYMENT_MODE === 'production' && createUrl.protocol !== 'https:')
      throw Error('Production checkout provider requires HTTPS');
  }
  if (process.env.PAYMENT_PROVIDER_MODE === 'signed_hmac') {
    if (
      !process.env.PAYMENT_PROVIDER_NAME ||
      !/^[a-z0-9_-]{2,40}$/.test(process.env.PAYMENT_PROVIDER_NAME)
    )
      throw Error('Missing safe PAYMENT_PROVIDER_NAME');
    if (!process.env.PAYMENT_WEBHOOK_SECRET || process.env.PAYMENT_WEBHOOK_SECRET.length < 48)
      throw Error('PAYMENT_WEBHOOK_SECRET is too short');
    const tolerance = Number(process.env.PAYMENT_WEBHOOK_TOLERANCE_SECONDS || 300);
    if (!Number.isInteger(tolerance) || tolerance < 30 || tolerance > 900)
      throw Error('Invalid PAYMENT_WEBHOOK_TOLERANCE_SECONDS');
  }
  if (process.env.DEPLOYMENT_MODE === 'production') {
    if (!process.env.SITE_URL!.startsWith('https://') || process.env.SITE_APPROVED !== 'true')
      throw Error('Production requires HTTPS and owner approval');
    if (process.env.DATABASE_URL!.includes('jodo_owner'))
      throw Error('Runtime must not use the migration owner');
  }
}
