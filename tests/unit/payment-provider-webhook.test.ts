import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { PaymentProviderController } from '../../apps/api/src/payment-provider';

const payload = {
  eventId: 'test-webhook-failed-001',
  type: 'payment_failed' as const,
  installmentId: 'b274d80b-3601-49c2-a54b-ff9b5b8da03d',
  providerReference: 'sandbox-failure-001',
  amountMinor: 5000,
  currency: 'INR' as const,
  reasonCode: 'BANK_DECLINED',
  occurredAt: '2026-10-08T10:00:00Z',
};

test('valid signed webhook with no matching financial attempt remains an investigated failure', async () => {
  const old = {
    mode: process.env.PAYMENT_PROVIDER_MODE,
    secret: process.env.PAYMENT_WEBHOOK_SECRET,
    name: process.env.PAYMENT_PROVIDER_NAME,
  };
  process.env.PAYMENT_PROVIDER_MODE = 'signed_hmac';
  process.env.PAYMENT_WEBHOOK_SECRET = 'test-secret-only';
  process.env.PAYMENT_PROVIDER_NAME = 'test-gateway';
  const statements: string[] = [];
  const audits: string[] = [];
  const fakeConnection = {
    query: async (sql: string) => {
      statements.push(sql);
      if (sql.includes('SELECT s.tenant_id')) return { rows: [{ tenant_id: 'tenant-test' }], rowCount: 1 };
      if (sql.includes('INSERT INTO payment_provider_events')) return { rows: [{ id: 'event-test' }], rowCount: 1 };
      if (sql.includes('UPDATE payment_checkout_sessions')) return { rows: [], rowCount: 0 };
      if (sql.includes('UPDATE autopay_debit_attempts')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    },
  };
  const fakeDb = {
    tx: async (fn: (client: typeof fakeConnection) => Promise<unknown>) => fn(fakeConnection),
    audit: async (_client: unknown, _actor: string, action: string) => { audits.push(action); },
  };
  try {
    const rawBody = Buffer.from(JSON.stringify(payload));
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac('sha256', process.env.PAYMENT_WEBHOOK_SECRET)
      .update(timestamp).update('.').update(rawBody).digest('hex');
    const controller = new PaymentProviderController(fakeDb as never);
    const result = await controller.webhook({ rawBody } as never, payload, signature, timestamp);
    assert.deepEqual(result, {
      accepted: false,
      duplicate: false,
      status: 'failed',
      code: 'UNMATCHED_PAYMENT_FAILURE',
    });
    assert.ok(statements.some((sql) => sql.includes("failure_code='UNMATCHED_PAYMENT_FAILURE'")));
    assert.ok(!statements.some((sql) => sql.includes("SET status='applied'")));
    assert.deepEqual(audits, ['payment.provider_unmatched_failure']);
  } finally {
    for (const [key, value] of [
      ['PAYMENT_PROVIDER_MODE', old.mode],
      ['PAYMENT_WEBHOOK_SECRET', old.secret],
      ['PAYMENT_PROVIDER_NAME', old.name],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
