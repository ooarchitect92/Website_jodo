import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { PaymentProviderController } from '../../apps/api/src/payment-provider';

test('rejected inconsistent success event preserves existing checkout state', async () => {
  const before = {
    mode: process.env.PAYMENT_PROVIDER_MODE,
    secret: process.env.PAYMENT_WEBHOOK_SECRET,
    name: process.env.PAYMENT_PROVIDER_NAME,
  };
  process.env.PAYMENT_PROVIDER_MODE = 'signed_hmac';
  process.env.PAYMENT_WEBHOOK_SECRET = 'isolated-test-secret';
  process.env.PAYMENT_PROVIDER_NAME = 'test-provider';

  const event = {
    eventId: 'mismatch-confirmed-001',
    type: 'payment_confirmed' as const,
    installmentId: 'b274d80b-3601-49c2-a54b-ff9b5b8da03d',
    providerReference: 'reference-abc-123',
    amountMinor: 5000,
    currency: 'INR' as const,
    occurredAt: '2026-10-08T10:00:00Z',
  };
  const statements: string[] = [];
  const audits: string[] = [];
  const conn = {
    query: async (sql: string) => {
      statements.push(sql);
      if (sql.includes('SELECT s.tenant_id')) return { rows: [{ tenant_id: 'tenant-one' }] };
      if (sql.includes('INSERT INTO payment_provider_events'))
        return { rows: [{ id: 'event-one' }] };
      if (sql.includes('FROM fee_installments i') && sql.includes('FOR UPDATE'))
        return {
          rows: [
            {
              schedule_id: 'schedule-one',
              schedule_status: 'active',
              status: 'due',
              currency: 'USD',
              amount_minor: 5000,
              paid_amount_minor: 0,
            },
          ],
        };
      if (sql.includes('FROM payment_checkout_sessions') && sql.includes('FOR UPDATE'))
        return {
          rows: [
            {
              id: 'checkout-one',
              schedule_id: 'schedule-one',
              installment_id: event.installmentId,
              amount_minor: 5000,
              status: 'created',
            },
          ],
        };
      return { rows: [], rowCount: 1 };
    },
  };
  const db = {
    tx: async (fn: (c: typeof conn) => Promise<unknown>) => fn(conn),
    audit: async (_c: unknown, _a: string, action: string) => {
      audits.push(action);
    },
  };
  try {
    const rawBody = Buffer.from(JSON.stringify(event));
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac('sha256', process.env.PAYMENT_WEBHOOK_SECRET!)
      .update(timestamp)
      .update('.')
      .update(rawBody)
      .digest('hex');
    const result = await new PaymentProviderController(db as never).webhook(
      { rawBody } as never,
      event,
      signature,
      timestamp,
    );
    assert.deepEqual(result, {
      accepted: false,
      duplicate: false,
      status: 'failed',
      code: 'CURRENCY_MISMATCH',
    });
    assert.ok(statements.some((sql) => sql.includes('failure_code=$2')));
    assert.ok(!statements.some((sql) => sql.includes('UPDATE payment_checkout_sessions')));
    assert.deepEqual(audits, ['payment.provider_rejected']);
  } finally {
    for (const [key, value] of [
      ['PAYMENT_PROVIDER_MODE', before.mode],
      ['PAYMENT_WEBHOOK_SECRET', before.secret],
      ['PAYMENT_PROVIDER_NAME', before.name],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
