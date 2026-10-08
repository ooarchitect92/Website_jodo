import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const valid = {
  DEPLOYMENT_MODE: 'production',
  NODE_ENV: 'production',
  SITE_URL: 'https://payments.example.org',
  API_INTERNAL_URL: 'http://127.0.0.1:4000',
  SITE_APPROVED: 'true',
  PRODUCTION_RELEASE_APPROVED: 'true',
  PRODUCTION_SECURITY_REVIEW_ID: 'SEC-2026-1234',
  PRODUCTION_PRIVACY_REVIEW_ID: 'PRIV-2026-1234',
  PRODUCTION_RESTORE_TEST_ID: 'REST-2026-1234',
  PRODUCTION_TENANT_ISOLATION_TEST_ID: 'TENANT-2026-1234',
  BLOG_AUTO_DELETE_ENABLED: 'false',
  PAYMENT_PROVIDER_MODE: 'disabled',
  PAYMENT_CHECKOUT_MODE: 'disabled',
  AUTOPAY_PROVIDER_MODE: 'disabled',
  PUBLIC_INDEXING_ENABLED: 'false',
};

function gate(override = {}) {
  // Isolate inherited developer credentials/configuration from the test fixture.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      !key.startsWith('PRODUCTION_') &&
      !['SITE_URL','API_INTERNAL_URL','DEPLOYMENT_MODE','NODE_ENV','SITE_APPROVED',
        'BLOG_AUTO_DELETE_ENABLED','PAYMENT_PROVIDER_MODE','PAYMENT_CHECKOUT_MODE',
        'AUTOPAY_PROVIDER_MODE','PUBLIC_INDEXING_ENABLED'].includes(key),
    ),
  );
  return spawnSync(process.execPath, [resolve('scripts/production-gate.mjs')], {
    env: { ...env, ...valid, ...override },
    encoding: 'utf8',
  });
}
test('baseline evidence-shaped production fixture permits startup checks', () => {
  const result = gate();
  assert.equal(result.status, 0, result.stderr);
});
test('demo deployment can never pass a production startup check', () => {
  const result = gate({ DEPLOYMENT_MODE: 'demo' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /DEPLOYMENT_MODE/);
});
test('missing security evidence blocks startup', () => {
  const result = gate({ PRODUCTION_SECURITY_REVIEW_ID: '' });
  assert.equal(result.status, 1);
});
test('placeholder evidence is rejected', () => {
  const result = gate({ PRODUCTION_SECURITY_REVIEW_ID: 'PLACEHOLDER' });
  assert.equal(result.status, 1);
});
test('public HTTP URLs are rejected', () => {
  const result = gate({ SITE_URL: 'http://payments.example.org' });
  assert.equal(result.status, 1);
});
test('indexing requires brand-rights review', () => {
  const result = gate({ PUBLIC_INDEXING_ENABLED: 'true' });
  assert.equal(result.status, 1);
});
test('enabled payment rails require partner approval and UAT evidence', () => {
  const result = gate({ PAYMENT_CHECKOUT_MODE: 'enabled' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /PRODUCTION_PAYMENT_UAT_ID/);
});
test('automatic blog deletion must remain disabled', () => {
  assert.equal(gate({ BLOG_AUTO_DELETE_ENABLED: 'true' }).status, 1);
});
