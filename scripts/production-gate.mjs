// Production readiness guard. This only checks declared configuration and evidence
// references. It does NOT certify provider agreements, legal compliance or safety.
const missing = [];
if (process.env.DEPLOYMENT_MODE !== 'production')
  missing.push('DEPLOYMENT_MODE must be production for start:prod');
if (process.env.NODE_ENV && process.env.NODE_ENV !== 'production')
  missing.push('NODE_ENV must be production when set');
const isTrue = (key) => process.env[key] === 'true';
const evidence = (key) => {
  const id = process.env[key]?.trim() || '';
  const normalized = id.toLowerCase().replace(/[^a-z0-9]/g, '');
  const placeholders = new Set([
    'changeme',
    'todo',
    'pending',
    'example',
    'placeholder',
    'notrun',
    'none',
    'na',
  ]);
  return id.length >= 8 && !placeholders.has(normalized);
};
const requiredTrue = ['SITE_APPROVED', 'PRODUCTION_RELEASE_APPROVED'];
for (const key of requiredTrue)
  if (!isTrue(key)) missing.push(key + ' must be true after independent sign-off');
for (const key of [
  'PRODUCTION_SECURITY_REVIEW_ID',
  'PRODUCTION_PRIVACY_REVIEW_ID',
  'PRODUCTION_RESTORE_TEST_ID',
  'PRODUCTION_TENANT_ISOLATION_TEST_ID',
]) {
  if (!evidence(key)) missing.push(key + ' must refer to review/test evidence');
}
for (const key of ['SITE_URL', 'API_INTERNAL_URL']) {
  try {
    const url = new URL(process.env[key] || '');
    if (key === 'SITE_URL' && url.protocol !== 'https:') throw Error('HTTPS required');
    if (!['http:', 'https:'].includes(url.protocol)) throw Error('HTTP(S) required');
    if (key === 'SITE_URL' && ['localhost', '127.0.0.1', '0.0.0.0'].includes(url.hostname))
      throw Error('public hostname required');
  } catch {
    missing.push(key + ' must be a valid production URL (public SITE_URL requires HTTPS)');
  }
}
if (isTrue('PUBLIC_INDEXING_ENABLED') && !evidence('PRODUCTION_BRAND_RIGHTS_REVIEW_ID'))
  missing.push('PRODUCTION_BRAND_RIGHTS_REVIEW_ID required before indexing');
if (process.env.BLOG_AUTO_DELETE_ENABLED !== 'false')
  missing.push('BLOG_AUTO_DELETE_ENABLED must be false');
const financialModes = ['PAYMENT_PROVIDER_MODE', 'PAYMENT_CHECKOUT_MODE', 'AUTOPAY_PROVIDER_MODE'];
if (financialModes.some((key) => !['disabled', undefined, ''].includes(process.env[key]))) {
  if (!evidence('PRODUCTION_PAYMENT_PROVIDER_APPROVAL_ID'))
    missing.push('PRODUCTION_PAYMENT_PROVIDER_APPROVAL_ID required for financial rails');
  if (!evidence('PRODUCTION_PAYMENT_UAT_ID'))
    missing.push('PRODUCTION_PAYMENT_UAT_ID required for financial rails');
}
if (missing.length) {
  console.error('PRODUCTION START BLOCKED. Unverified release requirements:');
  for (const message of missing) console.error(' - ' + message);
  console.error(
    'Evidence identifiers are review references, not proof of compliance. See docs/acceptance/RELEASE.md.',
  );
  process.exitCode = 1;
} else {
  console.log(
    "Production configuration/evidence references present. External sign-offs remain the operator's responsibility.",
  );
}
