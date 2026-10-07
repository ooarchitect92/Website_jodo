import test from 'node:test';
import assert from 'node:assert/strict';
import {
  blockSchema,
  pageSchema,
  leadSchema,
  eventSchema,
  safeLink,
  sanitizeCampaign,
  estimateCost,
  scoreLead,
  csvCell,
  simulateWorkflow,
  feeScheduleCreateSchema,
  externalPaymentRecordSchema,
  refundRecordSchema,
  mandateRecordSchema,
  feePayerProfileSchema,
  payerLinkSchema,
  paymentProviderEventSchema,
  feeHeadSchema,
  installmentComponentSchema,
  feeAdjustmentSchema,
  collectionPageCreateSchema,
  collectionIntentSchema,
} from '../../packages/core/src/contracts';
import { encrypt, decrypt, equal, bucket } from '../../packages/core/src/security';
import { seedPages } from '../../packages/core/src/site';
process.env.DATA_ENCRYPTION_KEY = '8'.repeat(64);
process.env.SESSION_SECRET = 'unit-test-secret-'.repeat(5);
const lead = {
  name: 'Synthetic Visitor',
  email: 'visitor@example.invalid',
  phone: '+919999999999',
  institute: 'Synthetic Institute',
  role: 'Owner',
  students: 500,
  city: 'Demo City',
  interest: 'Flex',
  noticeAccepted: true,
  formRevision: 'demo-v1',
};
test('all seed pages use the shared rendering schema', () => {
  assert.equal(seedPages.length, 42);
  for (const p of seedPages) assert.ok(pageSchema.safeParse(p.body).success);
});
test('source routes are unique', () =>
  assert.equal(new Set(seedPages.map((p) => p.slug)).size, seedPages.length));
test('valid lead does not require marketing consent', () =>
  assert.equal(leadSchema.parse(lead).marketingOptIn, false));
test('invalid lead never becomes a valid submission', () =>
  assert.equal(leadSchema.safeParse({ ...lead, email: 'bad' }).success, false));
test('unknown contact fields are rejected', () =>
  assert.equal(leadSchema.safeParse({ ...lead, cardNumber: '4111' }).success, false));
test('honeypot is rejected', () =>
  assert.equal(leadSchema.safeParse({ ...lead, website: 'spam' }).success, false));
test('business conversions cannot be asserted through browser collector', () =>
  assert.equal(
    eventSchema.safeParse({
      id: crypto.randomUUID(),
      name: 'purchase',
      route: '/',
      occurredAt: new Date().toISOString(),
    }).success,
    false,
  ));
test('PII in event payload is rejected', () =>
  assert.equal(
    eventSchema.safeParse({
      id: crypto.randomUUID(),
      name: 'page_view',
      route: '/',
      email: 'secret@example.invalid',
      occurredAt: new Date().toISOString(),
    }).success,
    false,
  ));
test('unknown executable block type is rejected', () =>
  assert.equal(blockSchema.safeParse({ id: 'x', type: 'script', title: 'Unsafe' }).success, false));
test('remote image tracker cannot enter a content item', () =>
  assert.equal(
    blockSchema.safeParse({
      id: 'x',
      type: 'logos',
      items: [{ title: 'x', image: 'https://tracker.invalid/pixel' }],
    }).success,
    false,
  ));
test('javascript links rejected', () =>
  assert.equal(safeLink.safeParse('javascript:alert(1)').success, false));
test('protocol-relative links rejected', () =>
  assert.equal(safeLink.safeParse('//evil.invalid').success, false));
test('control characters in links rejected', () =>
  assert.equal(safeLink.safeParse('/\n/evil.invalid').success, false));
test('campaign fields are allowlisted', () =>
  assert.deepEqual(
    sanitizeCampaign({
      utm_source: 'google',
      email: 'secret@example.invalid',
      utm_campaign: 'school_demo',
    }),
    { utm_source: 'google', utm_campaign: 'school_demo' },
  ));
test('identifying UTMs are excluded', () =>
  assert.deepEqual(sanitizeCampaign({ utm_source: 'x@y.com', utm_content: '9999999999' }), {}));
test('calculator values are transparent and reproducible', () => {
  const r = estimateCost({
    students: 400,
    annualFee: 10000,
    onTime: 50,
    delayDays: 365,
    capitalRate: 10,
    staffMonthly: 10000,
    staffShare: 50,
  });
  assert.equal(r.financing, 200000);
  assert.equal(r.administration, 120000);
  assert.equal(r.total, 320000);
});
test('calculator rejects impossible percentages', () =>
  assert.throws(() =>
    estimateCost({
      students: 100,
      annualFee: 100,
      onTime: 120,
      delayDays: 1,
      capitalRate: 2,
      staffMonthly: 0,
      staffShare: 0,
    }),
  ));
test('calculator rejects NaN', () =>
  assert.throws(() =>
    estimateCost({
      students: NaN,
      annualFee: 100,
      onTime: 20,
      delayDays: 1,
      capitalRate: 2,
      staffMonthly: 0,
      staffShare: 0,
    }),
  ));
test('lead score explains contributions without qualification', () => {
  const s = scoreLead({ interest: 'Flex', role: 'Owner' });
  assert.equal(s.score, 40);
  assert.equal(s.qualification, 'Not inferred from score');
});
test('unknown interest does not invent engagement', () =>
  assert.equal(scoreLead({ interest: 'Not sure', role: 'Other' }).score, 10));
test('CSV formula values neutralised', () =>
  assert.equal(csvCell('=HYPERLINK("bad")'), '"\'=HYPERLINK(""bad"")"'));
test('authenticated encryption round trips', () => {
  const c = encrypt({ email: 'test@example.invalid' });
  assert.ok(!c.includes('test'));
  assert.deepEqual(decrypt(c), { email: 'test@example.invalid' });
});
test('tampered ciphertext fails closed', () => {
  const c = encrypt('x');
  assert.throws(() => decrypt(c.slice(0, -2) + 'AA'));
});
test('constant-time helper rejects unequal length', () => assert.equal(equal('abc', 'ab'), false));
test('deterministic assignment primitive stable', () =>
  assert.equal(bucket('unit', 'experiment'), bucket('unit', 'experiment')));
test('workflow simulation has durable-time semantics', () => {
  const t = simulateWorkflow(
    {
      name: 'demo',
      nodes: [
        { type: 'delay', minutes: 60 },
        { type: 'task', title: 'Call' },
      ],
    },
    new Date('2026-01-01T00:00:00Z'),
  );
  assert.equal(t[0]!.at, '2026-01-01T01:00:00.000Z');
});
test('workflow exits on contacted state', () => {
  const t = simulateWorkflow(
    { name: 'demo', nodes: [{ type: 'exit_if_contacted' }, { type: 'task', title: 'Call' }] },
    new Date(),
    true,
  );
  assert.equal(t.length, 1);
  assert.equal(t[0]!.type, 'cancelled');
});

test('fee schedule contract requires bounded positive installments', () => {
  const parsed = feeScheduleCreateSchema.parse({
    accountReference: 'student_001',
    currency: 'INR',
    installments: [
      { dueDate: '2027-01-10', amountMinor: 2500000 },
      { dueDate: '2027-02-10', amountMinor: 2500000 },
    ],
  });
  assert.equal(parsed.installments.length, 2);
});
test('fee schedule rejects duplicate due dates', () =>
  assert.equal(
    feeScheduleCreateSchema.safeParse({
      accountReference: 'student_001',
      currency: 'INR',
      installments: [
        { dueDate: '2027-01-10', amountMinor: 100 },
        { dueDate: '2027-01-10', amountMinor: 100 },
      ],
    }).success,
    false,
  ));
test('external payment evidence requires idempotency and reference', () =>
  assert.equal(
    externalPaymentRecordSchema.safeParse({
      installmentId: crypto.randomUUID(),
      amountMinor: 10000,
      currency: 'INR',
      providerReference: 'BANK:UTR:123',
      idempotencyKey: crypto.randomUUID(),
      evidenceNote: 'Verified in synthetic provider report',
    }).success,
    true,
  ));
test('refund cannot be zero or negative', () =>
  assert.equal(
    refundRecordSchema.safeParse({
      paymentId: crypto.randomUUID(),
      amountMinor: 0,
      idempotencyKey: crypto.randomUUID(),
      reason: 'Synthetic correction',
    }).success,
    false,
  ));
test('mandate rail is restricted to supported autopay classes', () =>
  assert.equal(
    mandateRecordSchema.safeParse({
      scheduleId: crypto.randomUUID(),
      rail: 'card',
      providerReference: 'MANDATE-123',
      status: 'active',
    }).success,
    false,
  ));

test('payer profile requires the destination for the selected reminder channel', () => {
  assert.equal(
    feePayerProfileSchema.safeParse({
      accountReference: 'payer_001',
      displayName: 'Synthetic Parent',
      preferredChannel: 'email',
      locale: 'en-IN',
    }).success,
    false,
  );
  assert.equal(
    feePayerProfileSchema.safeParse({
      accountReference: 'payer_001',
      displayName: 'Synthetic Parent',
      email: 'payer@example.invalid',
      preferredChannel: 'email',
      locale: 'en-IN',
    }).success,
    true,
  );
});
test('payer portal links have bounded expiry', () => {
  assert.equal(payerLinkSchema.safeParse({ expiresHours: 1 }).success, true);
  assert.equal(payerLinkSchema.safeParse({ expiresHours: 24 * 31 }).success, false);
});

test('normalized payment provider events allow only bounded authoritative states', () => {
  assert.equal(
    paymentProviderEventSchema.safeParse({
      eventId: 'evt_123',
      type: 'payment_confirmed',
      installmentId: crypto.randomUUID(),
      providerReference: 'pay_123',
      amountMinor: 250000,
      currency: 'INR',
      occurredAt: new Date().toISOString(),
    }).success,
    true,
  );
  assert.equal(
    paymentProviderEventSchema.safeParse({
      eventId: 'evt_123',
      type: 'payment_confirmed',
      installmentId: crypto.randomUUID(),
      providerReference: 'pay_123',
      amountMinor: 250000,
      currency: 'USD',
      cardNumber: '4111111111111111',
      occurredAt: new Date().toISOString(),
    }).success,
    false,
  );
});

test('fee head contract prevents bank credentials from being stored as routing configuration', () => {
  assert.equal(
    feeHeadSchema.safeParse({
      code: 'TUITION',
      name: 'Tuition',
      settlementAccountKey: 'tuition_primary',
    }).success,
    true,
  );
  assert.equal(
    feeHeadSchema.safeParse({
      code: 'TUITION',
      name: 'Tuition',
      settlementAccountKey: 'account 1234 / IFSC ABC',
    }).success,
    false,
  );
});
test('installment fee-head structure rejects duplicate heads', () => {
  const id = crypto.randomUUID();
  assert.equal(
    installmentComponentSchema.safeParse({
      installmentId: crypto.randomUUID(),
      components: [
        { feeHeadId: id, amountMinor: 10000 },
        { feeHeadId: id, amountMinor: 5000 },
      ],
    }).success,
    false,
  );
});
test('financial adjustments are bounded and typed', () => {
  assert.equal(
    feeAdjustmentSchema.safeParse({
      installmentId: crypto.randomUUID(),
      kind: 'late_fee',
      amountMinor: 10000,
      reason: 'Late payment policy',
    }).success,
    true,
  );
  assert.equal(
    feeAdjustmentSchema.safeParse({
      installmentId: crypto.randomUUID(),
      kind: 'arbitrary_credit',
      amountMinor: 10000,
      reason: 'Unknown',
    }).success,
    false,
  );
});
test('collection pages require at least one amount mode', () =>
  assert.equal(
    collectionPageCreateSchema.safeParse({
      scheduleId: crypto.randomUUID(),
      title: 'Trip fee',
      allowFull: false,
      allowPartial: false,
      allowCustom: false,
    }).success,
    false,
  ));
test('collection intent does not contain payment credentials', () =>
  assert.equal(
    collectionIntentSchema.safeParse({
      installmentId: crypto.randomUUID(),
      mode: 'full',
      idempotencyKey: crypto.randomUUID(),
      upiPin: '1234',
    }).success,
    false,
  ));
