import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { authenticator } from 'otplib';
import * as argon2 from 'argon2';
import { createApp } from '../../apps/api/src/main';
import { Db } from '../../apps/api/src/db';
import { tick, checkpoint } from '../../apps/worker/src/main';
import { notifyStaff } from '../../apps/worker/src/notifications';
import { encrypt } from '../../packages/core/src/security';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { createHmac, randomUUID } from 'node:crypto';
let app: any,
  base: string,
  db: Db,
  owner: Pool,
  cookie = '',
  csrf = '',
  contentId = '',
  version = 0,
  receipt = '',
  eventId = '',
  leadId = '',
  consentCookie = '',
  chatCookie = '';
const input = {
  name: 'Synthetic Visitor',
  email: 'synthetic@example.invalid',
  phone: '+919999999999',
  institute: 'Synthetic QA Institute',
  role: 'Owner',
  students: 500,
  city: 'Test City',
  interest: 'Flex',
  noticeAccepted: true,
  marketingOptIn: false,
  formRevision: 'demo-v1',
  source: 'form',
};
const key = randomUUID();
async function call(
  path: string,
  method = 'GET',
  body?: unknown,
  extra: Record<string, string> = {},
  auth = false,
) {
  const r = await fetch(base + path, {
    method,
    headers: {
      Origin: process.env.SITE_URL!,
      'Content-Type': 'application/json',
      ...(auth ? { Cookie: cookie, 'X-CSRF-Token': csrf } : {}),
      ...extra,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { r, data };
}
before(async () => {
  assert.ok(
    ['test', 'demo'].includes(process.env.DEPLOYMENT_MODE || ''),
    'Integration tests require isolated test/demo mode',
  );
  owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await owner.query('UPDATE users SET last_totp_step=0 WHERE email=$1', [process.env.OWNER_EMAIL]);
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  base = 'http://127.0.0.1:' + app.getHttpServer().address().port;
  db = app.get(Db);
});
after(async () => {
  await app?.close();
  await owner?.end();
});
test('database readiness is real', async () =>
  assert.equal((await call('/health/ready')).r.status, 200));
test('public config contains no secrets', async () => {
  const r = await call('/v1/public/site');
  assert.equal(r.r.status, 200);
  assert.ok(!JSON.stringify(r.data).includes(process.env.DATA_ENCRYPTION_KEY!));
});
test('unauthenticated administration denied', async () =>
  assert.equal((await call('/v1/admin/content')).r.status, 401));
test('cross-origin mutation denied', async () =>
  assert.equal(
    (
      await call(
        '/v1/consent/choices',
        'POST',
        { analytics: false, advertising: false, policyVersion: '2026-10-v1' },
        { Origin: 'https://evil.invalid' },
      )
    ).r.status,
    403,
  ));
test('MFA staff login returns secure session contract', async () => {
  const r = await call('/v1/auth/login', 'POST', {
    email: process.env.OWNER_EMAIL,
    password: process.env.OWNER_PASSWORD,
    otp: authenticator.generate(process.env.OWNER_TOTP_SECRET!),
  });
  assert.equal(r.r.status, 201, JSON.stringify(r.data));
  cookie = r.r.headers.getSetCookie()[0]!.split(';')[0]!;
  csrf = r.data.csrf;
  assert.match(r.r.headers.getSetCookie()[0]!, /HttpOnly/);
  assert.match(r.r.headers.getSetCookie()[0]!, /SameSite=Strict/i);
  assert.ok(csrf);
});
test('CSRF prevents authenticated writes', async () => {
  const r = await call('/v1/admin/campaigns', 'POST', {}, { Cookie: cookie });
  assert.equal(r.r.status, 403);
});
test('consent denial does not prevent a committed lead', async () => {
  const r = await call('/v1/forms/demo/submissions', 'POST', input, { 'Idempotency-Key': key });
  assert.equal(r.r.status, 201, JSON.stringify(r.data));
  receipt = r.data.receipt;
  eventId = r.data.eventId;
  const rows = await db.query('SELECT * FROM leads WHERE event_id=$1', [eventId]);
  assert.equal(rows.length, 1);
  leadId = rows[0]!.id;
  assert.equal(rows[0]!.acquisition_id, null);
  assert.ok(!rows[0]!.encrypted_fields.includes(input.email));
  assert.equal((await db.query('SELECT * FROM outbox WHERE event_id=$1', [eventId])).length, 1);
});
test('concurrent retries produce one lead and one event', async () => {
  const replies = await Promise.all(
    Array.from({ length: 12 }, () =>
      call('/v1/forms/demo/submissions', 'POST', input, { 'Idempotency-Key': key }),
    ),
  );
  for (const r of replies) {
    assert.equal(r.data.receipt, receipt);
    assert.equal(r.data.eventId, eventId);
  }
  assert.equal((await db.query('SELECT * FROM leads WHERE submission_key=$1', [key])).length, 1);
});
test('same key with different data conflicts', async () =>
  assert.equal(
    (
      await call(
        '/v1/forms/demo/submissions',
        'POST',
        { ...input, name: 'Different' },
        { 'Idempotency-Key': key },
      )
    ).r.status,
    409,
  ));
test('invalid form produces no accepted lead', async () => {
  const k = randomUUID();
  assert.equal(
    (
      await call(
        '/v1/forms/demo/submissions',
        'POST',
        { ...input, email: 'bad' },
        { 'Idempotency-Key': k },
      )
    ).r.status,
    422,
  );
  assert.equal((await db.query('SELECT * FROM leads WHERE submission_key=$1', [k])).length, 0);
});
test('audit failure rolls back lead and outbox', async () => {
  await owner.query(
    "CREATE FUNCTION qa_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='lead.accepted' THEN RAISE EXCEPTION 'QA controlled audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_fail_audit BEFORE INSERT ON audit FOR EACH ROW EXECUTE FUNCTION qa_fail_audit();",
  );
  const k = randomUUID();
  try {
    const r = await call('/v1/forms/demo/submissions', 'POST', input, { 'Idempotency-Key': k });
    assert.equal(r.r.status, 500);
    assert.equal((await db.query('SELECT * FROM leads WHERE submission_key=$1', [k])).length, 0);
  } finally {
    await owner.query('DROP TRIGGER qa_fail_audit ON audit; DROP FUNCTION qa_fail_audit();');
  }
});
test('worker retries cannot duplicate follow-up tasks', async () => {
  await tick(db);
  await db.query("UPDATE outbox SET status='pending' WHERE event_id=$1", [eventId]);
  await tick(db);
  assert.equal(
    (await db.query('SELECT * FROM tasks WHERE execution_key=$1', ['lead:' + eventId])).length,
    1,
  );
  assert.equal(
    (await db.query('SELECT status FROM outbox WHERE event_id=$1', [eventId]))[0]!.status,
    'blocked',
  );
});
test('expired worker lease is recovered', async () => {
  await db.query(
    "UPDATE outbox SET status='processing',lease_until=now()-interval '1 minute' WHERE event_id=$1",
    [eventId],
  );
  await tick(db);
  assert.equal(
    (await db.query('SELECT status FROM outbox WHERE event_id=$1', [eventId]))[0]!.status,
    'blocked',
  );
});
test('create draft, preserve private/public boundary', async () => {
  const r = await call(
    '/v1/admin/content',
    'POST',
    {
      slug: '/qa-page-' + randomUUID().slice(0, 8) + '/',
      kind: 'post',
      body: {
        title: 'QA private draft',
        description: 'A synthetic unpublished draft for verification.',
        blocks: [
          {
            id: 'qa-hero',
            type: 'hero',
            title: 'Private draft',
            text: 'Do not expose this before publication.',
          },
        ],
      },
    },
    {},
    true,
  );
  assert.equal(r.r.status, 201, JSON.stringify(r.data));
  contentId = r.data.id;
  version = r.data.version;
  const publicRows = (await call('/v1/public/pages')).data;
  assert.ok(!publicRows.some((p: any) => p.id === contentId));
});
test('stale CMS write rejected without lost update', async () => {
  const current = (await call('/v1/admin/content/' + contentId, 'GET', undefined, {}, true)).data;
  const r = await call(
    '/v1/admin/content/' + contentId + '/draft',
    'PATCH',
    { expectedVersion: version, body: { ...current.draft, title: 'QA updated draft' } },
    {},
    true,
  );
  assert.equal(r.r.status, 200);
  assert.equal(
    (
      await call(
        '/v1/admin/content/' + contentId + '/draft',
        'PATCH',
        { expectedVersion: version, body: current.draft },
        {},
        true,
      )
    ).r.status,
    409,
  );
  version = r.data.version;
});
test('review and approval are required before publication', async () => {
  assert.equal(
    (
      await call(
        '/v1/admin/content/' + contentId + '/action',
        'POST',
        { action: 'publish', expectedVersion: version, reason: 'QA check' },
        {},
        true,
      )
    ).r.status,
    409,
  );
  for (const action of ['review', 'approve', 'publish']) {
    const r = await call(
      '/v1/admin/content/' + contentId + '/action',
      'POST',
      { action, expectedVersion: version, reason: 'QA approved synthetic content' },
      {},
      true,
    );
    assert.equal(r.r.status, 201, JSON.stringify(r.data));
    version = r.data.version;
  }
  const rows = (await call('/v1/public/pages')).data;
  assert.ok(rows.some((p: any) => p.id === contentId && p.body.title === 'QA updated draft'));
});
test('published revisions are immutable at the database', async () => {
  await assert.rejects(db.query("UPDATE revisions SET body='{}' WHERE content_id=$1", [contentId]));
  await assert.rejects(db.query('DELETE FROM content WHERE id=$1', [contentId]));
  await assert.rejects(db.query('TRUNCATE audit'));
});
test('manual trash removes public access but retains source', async () => {
  const r = await call(
    '/v1/admin/content/' + contentId + '/action',
    'POST',
    { action: 'trash', expectedVersion: version, reason: 'QA manual preservation exercise' },
    {},
    true,
  );
  assert.equal(r.r.status, 201);
  version = r.data.version;
  assert.ok(!(await call('/v1/public/pages')).data.some((p: any) => p.id === contentId));
  await owner.query("UPDATE content SET deleted_at=now()-interval '2 years' WHERE id=$1", [
    contentId,
  ]);
  await tick(db);
  assert.equal(
    (await db.query('SELECT * FROM revisions WHERE content_id=$1', [contentId])).length,
    1,
  );
});
test('manual restore returns to unpublished draft', async () => {
  const r = await call(
    '/v1/admin/content/' + contentId + '/action',
    'POST',
    { action: 'restore', expectedVersion: version, reason: 'QA restore' },
    {},
    true,
  );
  assert.equal(r.r.status, 201);
  assert.equal(r.data.published_revision, null);
  assert.equal(r.data.state, 'draft');
});
test('browser cannot assert purchase or include PII', async () => {
  for (const body of [
    { id: randomUUID(), name: 'purchase', route: '/', occurredAt: new Date().toISOString() },
    {
      id: randomUUID(),
      name: 'page_view',
      route: '/',
      occurredAt: new Date().toISOString(),
      email: 'private@example.invalid',
    },
  ])
    assert.equal((await call('/v1/events', 'POST', body)).r.status, 422);
});
test('event collection is denied before consent', async () =>
  assert.equal(
    (
      await call('/v1/events', 'POST', {
        id: randomUUID(),
        name: 'page_view',
        route: '/',
        occurredAt: new Date().toISOString(),
      })
    ).r.status,
    403,
  ));
test('consent, event dedupe and attribution sanitisation', async () => {
  const r = await call('/v1/consent/choices', 'POST', {
    analytics: true,
    advertising: false,
    policyVersion: '2026-10-v1',
  });
  consentCookie = r.r.headers.getSetCookie()[0]!.split(';')[0]!;
  const event = {
    id: randomUUID(),
    name: 'page_view',
    route: '/',
    occurredAt: new Date().toISOString(),
  };
  await call('/v1/events', 'POST', event, { Cookie: consentCookie });
  await call('/v1/events', 'POST', event, { Cookie: consentCookie });
  assert.equal((await db.query('SELECT * FROM events WHERE id=$1', [event.id])).length, 1);
  const t = await call(
    '/v1/attribution/touches',
    'POST',
    {
      route: '/',
      fields: {
        utm_source: 'google',
        utm_campaign: 'safe_campaign',
        utm_content: 'private@example.invalid',
      },
    },
    { Cookie: consentCookie },
  );
  assert.equal(t.r.status, 201);
  const touch = (await db.query('SELECT * FROM acquisition WHERE id=$1', [t.data.reference]))[0]!;
  assert.deepEqual(touch.fields, { utm_source: 'google', utm_campaign: 'safe_campaign' });
});
test('withdrawal stops further events', async () => {
  await call(
    '/v1/consent/choices',
    'POST',
    { analytics: false, advertising: false, policyVersion: '2026-10-v1' },
    { Cookie: consentCookie },
  );
  assert.equal(
    (
      await call(
        '/v1/events',
        'POST',
        { id: randomUUID(), name: 'page_view', route: '/', occurredAt: new Date().toISOString() },
        { Cookie: consentCookie },
      )
    ).r.status,
    403,
  );
});
test('chat requires a scoped operational session', async () => {
  assert.equal((await call('/v1/chat/messages')).r.status, 403);
  const r = await call('/v1/chat/start', 'POST', {});
  chatCookie = r.r.headers.getSetCookie()[0]!.split(';')[0]!;
  const message = await call(
    '/v1/chat/messages',
    'POST',
    { clientId: randomUUID(), topic: 'Flex' },
    { Cookie: chatCookie },
  );
  assert.equal(message.r.status, 201);
  assert.match(message.data.answer, /instalments|scheduled/i);
});
test('chat lead uses same durable capture and a conversation link', async () => {
  const r = await call(
    '/v1/chat/leads',
    'POST',
    { ...input, source: 'chat' },
    { Cookie: chatCookie, 'Idempotency-Key': randomUUID() },
  );
  assert.equal(r.r.status, 201);
  const lead = (await db.query('SELECT * FROM leads WHERE event_id=$1', [r.data.eventId]))[0]!;
  assert.ok(lead.chat_id);
});
test('handoff request is not represented as an agent joining', async () => {
  const r = await call('/v1/chat/handoff', 'POST', {}, { Cookie: chatCookie });
  assert.equal(r.data.status, 'awaiting_agent');
  assert.match(r.data.message, /No agent has joined/);
});
test('workflow enrollment and task actions remain idempotent', async () => {
  const taskTitle = 'QA task ' + randomUUID();
  const workflow = await call(
    '/v1/admin/workflows',
    'POST',
    {
      name: 'QA follow-up',
      nodes: [{ type: 'task', title: taskTitle }, { type: 'exit_if_contacted' }],
    },
    {},
    true,
  );
  await call(
    '/v1/admin/workflows/' + workflow.data.id,
    'PATCH',
    { active: true, expectedVersion: 1 },
    {},
    true,
  );
  const r = await call('/v1/forms/demo/submissions', 'POST', input, {
    'Idempotency-Key': randomUUID(),
  });
  await tick(db);
  await tick(db);
  const id = (await db.query('SELECT id FROM leads WHERE event_id=$1', [r.data.eventId]))[0]!.id;
  assert.equal(
    (await db.query('SELECT * FROM tasks WHERE lead_id=$1 AND title=$2', [id, taskTitle])).length,
    1,
  );
});
test('lead qualification requires audited stage transitions', async () => {
  assert.equal(
    (
      await call(
        '/v1/admin/leads/' + leadId + '/stage',
        'POST',
        { stage: 'won', expectedVersion: 1, reason: 'invalid shortcut' },
        {},
        true,
      )
    ).r.status,
    409,
  );
  await call(
    '/v1/admin/leads/' + leadId + '/stage',
    'POST',
    { stage: 'contacted', expectedVersion: 1, reason: 'Synthetic operator contact' },
    {},
    true,
  );
  const r = await call(
    '/v1/admin/leads/' + leadId + '/stage',
    'POST',
    { stage: 'qualified', expectedVersion: 2, reason: 'Synthetic business review' },
    {},
    true,
  );
  assert.equal(r.r.status, 201);
  assert.equal(
    (
      await db.query("SELECT * FROM outbox WHERE aggregate_id=$1 AND type='lead.qualified'", [
        leadId,
      ])
    ).length,
    1,
  );
});
test('staff SMTP acceptance is recorded once without customer PII', async () => {
  let messages = 0;
  const bodies: string[] = [];
  const server = createServer((socket) => {
    socket.write('220 local-test ESMTP\r\n');
    let buffer = '',
      data = false,
      body = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      while (buffer.includes('\r\n')) {
        const i = buffer.indexOf('\r\n'),
          line = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        if (data) {
          if (line === '.') {
            data = false;
            messages++;
            bodies.push(body);
            body = '';
            socket.write('250 queued\r\n');
          } else body += line + '\n';
        } else if (/^EHLO|^HELO/.test(line)) socket.write('250-local-test\r\n250 SIZE 1000000\r\n');
        else if (/^DATA/.test(line)) {
          data = true;
          socket.write('354 send data\r\n');
        } else if (/^QUIT/.test(line)) {
          socket.end('221 bye\r\n');
        } else socket.write('250 OK\r\n');
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const original = { ...process.env };
  Object.assign(process.env, {
    NOTIFICATION_MODE: 'smtp',
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(port),
    SMTP_FROM: 'staff@example.invalid',
    NOTIFICATION_TO: 'owner@example.invalid',
  });
  try {
    const id = randomUUID();
    assert.equal(await notifyStaff(db, id), 'provider_accepted');
    assert.equal(await notifyStaff(db, id), 'provider_accepted');
    assert.equal(messages, 1);
    assert.ok(!bodies.join('').includes(input.email));
  } finally {
    for (const k of [
      'NOTIFICATION_MODE',
      'SMTP_HOST',
      'SMTP_PORT',
      'SMTP_FROM',
      'NOTIFICATION_TO',
    ]) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
    await new Promise<void>((r) => server.close(() => r()));
  }
});
test('audit checkpoint is signed without claiming independent storage', async () => {
  const r = await checkpoint(db);
  assert.ok(r.count > 0);
  assert.match(r.filename, /^audit-/);
});

test('fee schedule, payment evidence and refund remain auditable and balanced', async () => {
  const created = await call(
    '/v1/admin/fees/schedules',
    'POST',
    {
      accountReference: 'qa_' + randomUUID().slice(0, 8),
      currency: 'INR',
      note: 'Synthetic integration schedule',
      installments: [
        { dueDate: '2027-01-10', amountMinor: 100000 },
        { dueDate: '2027-02-10', amountMinor: 100000 },
      ],
    },
    {},
    true,
  );
  assert.equal(created.r.status, 201, JSON.stringify(created.data));
  const scheduleId = created.data.id;
  const activated = await call(
    '/v1/admin/fees/schedules/' + scheduleId + '/activate',
    'POST',
    { expectedVersion: 1 },
    {},
    true,
  );
  assert.equal(activated.r.status, 201, JSON.stringify(activated.data));
  const schedules = (await call('/v1/admin/fees/schedules', 'GET', undefined, {}, true)).data;
  const schedule = schedules.find((s: any) => s.id === scheduleId);
  assert.equal(schedule.status, 'active');
  const installmentId = schedule.installments[0].id;
  const payment = await call(
    '/v1/admin/fees/payments/external-confirmation',
    'POST',
    {
      installmentId,
      amountMinor: 100000,
      currency: 'INR',
      providerReference: 'QA:' + randomUUID(),
      idempotencyKey: randomUUID(),
      evidenceNote: 'Synthetic bank confirmation',
    },
    {},
    true,
  );
  assert.equal(payment.r.status, 201, JSON.stringify(payment.data));
  const refund = await call(
    '/v1/admin/fees/refunds',
    'POST',
    {
      paymentId: payment.data.id,
      amountMinor: 25000,
      idempotencyKey: randomUUID(),
      reason: 'Synthetic partial refund',
    },
    {},
    true,
  );
  assert.equal(refund.r.status, 201, JSON.stringify(refund.data));
  const row = (
    await db.query(
      `SELECT i.paid_amount_minor,p.refunded_amount_minor,p.status
       FROM fee_installments i
       JOIN payment_records p ON p.installment_id=i.id
       WHERE p.id=$1`,
      [payment.data.id],
    )
  )[0]!;
  assert.equal(Number(row.paid_amount_minor), 75000);
  assert.equal(Number(row.refunded_amount_minor), 25000);
  assert.equal(row.status, 'partially_refunded');
  assert.ok(
    (
      await db.query(
        "SELECT * FROM outbox WHERE aggregate_id=$1 AND type='payment.external_confirmed'",
        [payment.data.id],
      )
    ).length === 1,
  );
  assert.ok(
    (
      await db.query(
        "SELECT * FROM audit WHERE object_id=$1 AND action='fees.payment.external_confirmed'",
        [payment.data.id],
      )
    ).length === 1,
  );
});

test('payer portal exposes only linked schedule data and queues reminders durably', async () => {
  const ref = 'payer_' + randomUUID().slice(0, 8);
  const payer = await call(
    '/v1/admin/payers',
    'POST',
    {
      accountReference: ref,
      displayName: 'Synthetic Parent',
      email: 'payer@example.invalid',
      preferredChannel: 'email',
      locale: 'en-IN',
    },
    {},
    true,
  );
  assert.equal(payer.r.status, 201, JSON.stringify(payer.data));
  const due = new Date();
  due.setUTCDate(due.getUTCDate() + 3);
  const dueDate = due.toISOString().slice(0, 10);
  const schedule = await call(
    '/v1/admin/fees/schedules',
    'POST',
    {
      accountReference: ref,
      payerId: payer.data.id,
      currency: 'INR',
      note: 'Synthetic payer portal schedule',
      installments: [{ dueDate, amountMinor: 125000 }],
    },
    {},
    true,
  );
  assert.equal(schedule.r.status, 201, JSON.stringify(schedule.data));
  assert.equal(
    (
      await call(
        '/v1/admin/fees/schedules/' + schedule.data.id + '/activate',
        'POST',
        { expectedVersion: 1 },
        {},
        true,
      )
    ).r.status,
    201,
  );
  const link = await call(
    '/v1/admin/fees/schedules/' + schedule.data.id + '/payer-link',
    'POST',
    { expiresHours: 1 },
    {},
    true,
  );
  assert.equal(link.r.status, 201, JSON.stringify(link.data));
  const rawToken = String(link.data.path).split('/').filter(Boolean).pop()!;
  const portal = await call('/v1/payer/' + rawToken);
  assert.equal(portal.r.status, 200, JSON.stringify(portal.data));
  assert.equal(portal.data.payer.accountReference, ref);
  assert.equal(portal.data.installments.length, 1);
  assert.ok(!JSON.stringify(portal.data).includes('payer@example.invalid'));

  await tick(db);
  const reminders = await db.query(
    `SELECT c.status,c.kind,o.status AS outbox_status
     FROM fee_communication_log c
     JOIN outbox o ON o.event_id=c.event_id
     WHERE c.schedule_id=$1 AND c.kind='upcoming_3d'`,
    [schedule.data.id],
  );
  assert.equal(reminders.length, 1);
  await tick(db);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS count FROM fee_reminder_runs WHERE installment_id=(SELECT id FROM fee_installments WHERE schedule_id=$1 LIMIT 1) AND reminder_key='upcoming_3d'",
        [schedule.data.id],
      )
    )[0]!.count,
    1,
  );

  const revoked = await call(
    '/v1/admin/fees/schedules/' + schedule.data.id + '/revoke-payer-links',
    'POST',
    {},
    {},
    true,
  );
  assert.equal(revoked.r.status, 201);
  assert.equal((await call('/v1/payer/' + rawToken)).r.status, 409);
});

test('signed provider webhooks verify authenticity and apply payment exactly once', async () => {
  const schedule = await call(
    '/v1/admin/fees/schedules',
    'POST',
    {
      accountReference: 'provider_' + randomUUID().slice(0, 8),
      currency: 'INR',
      note: 'Synthetic signed-provider schedule',
      installments: [{ dueDate: '2027-06-10', amountMinor: 175000 }],
    },
    {},
    true,
  );
  assert.equal(schedule.r.status, 201, JSON.stringify(schedule.data));
  await call(
    '/v1/admin/fees/schedules/' + schedule.data.id + '/activate',
    'POST',
    { expectedVersion: 1 },
    {},
    true,
  );
  const schedules = (await call('/v1/admin/fees/schedules', 'GET', undefined, {}, true)).data;
  const active = schedules.find((s: any) => s.id === schedule.data.id);
  const installmentId = active.installments[0].id;

  const previous = {
    mode: process.env.PAYMENT_PROVIDER_MODE,
    name: process.env.PAYMENT_PROVIDER_NAME,
    secret: process.env.PAYMENT_WEBHOOK_SECRET,
  };
  Object.assign(process.env, {
    PAYMENT_PROVIDER_MODE: 'signed_hmac',
    PAYMENT_PROVIDER_NAME: 'qa_gateway',
    PAYMENT_WEBHOOK_SECRET: 'provider-webhook-test-secret-'.repeat(3),
  });

  const send = async (body: any, signatureOverride?: string) => {
    const raw = JSON.stringify(body);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature =
      signatureOverride ||
      createHmac('sha256', process.env.PAYMENT_WEBHOOK_SECRET!)
        .update(timestamp)
        .update('.')
        .update(raw)
        .digest('hex');
    const r = await fetch(base + '/v1/provider/payments/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Payment-Timestamp': timestamp,
        'X-Payment-Signature': signature,
      },
      body: raw,
    });
    return { r, data: await r.json() };
  };

  try {
    const event = {
      eventId: 'evt_' + randomUUID(),
      type: 'payment_confirmed',
      installmentId,
      providerReference: 'pay_' + randomUUID(),
      amountMinor: 175000,
      currency: 'INR',
      occurredAt: new Date().toISOString(),
    };
    const invalid = await send({ ...event, eventId: 'evt_' + randomUUID() }, '0'.repeat(64));
    assert.equal(invalid.r.status, 403);

    const first = await send(event);
    assert.equal(first.r.status, 202, JSON.stringify(first.data));
    assert.equal(first.data.status, 'applied');
    const second = await send(event);
    assert.equal(second.r.status, 202, JSON.stringify(second.data));
    assert.equal(second.data.duplicate, true);

    const payments = await db.query(
      "SELECT * FROM payment_records WHERE provider='qa_gateway' AND provider_reference=$1",
      [event.providerReference],
    );
    assert.equal(payments.length, 1);
    assert.equal(payments[0]!.recorded_via, 'provider');
    assert.equal(Number(payments[0]!.amount_minor), 175000);

    const providerEvents = await db.query(
      "SELECT * FROM payment_provider_events WHERE provider='qa_gateway' AND provider_event_id=$1",
      [event.eventId],
    );
    assert.equal(providerEvents.length, 1);
    assert.equal(providerEvents[0]!.status, 'applied');

    const adminEvents = await call('/v1/admin/fees/provider-events', 'GET', undefined, {}, true);
    assert.equal(adminEvents.r.status, 200);
    assert.ok(adminEvents.data.some((row: any) => row.provider_event_id === event.eventId));
  } finally {
    for (const [key, value] of Object.entries({
      PAYMENT_PROVIDER_MODE: previous.mode,
      PAYMENT_PROVIDER_NAME: previous.name,
      PAYMENT_WEBHOOK_SECRET: previous.secret,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('flexible fee components, concessions, analytics and late-fee assessment remain consistent', async () => {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const reference = 'structure_' + randomUUID().slice(0, 8);
  const created = await call(
    '/v1/admin/fees/schedules',
    'POST',
    {
      accountReference: reference,
      scopeType: 'course',
      scopeReference: 'qa_course',
      currency: 'INR',
      components: [
        { code: 'tuition', label: 'Tuition', amountMinor: 120000 },
        {
          code: 'transport',
          label: 'Transport',
          amountMinor: 30000,
          bankRouteKey: 'transport_route',
        },
      ],
      concessions: [
        {
          code: 'merit',
          label: 'Merit scholarship',
          amountMinor: 20000,
          reason: 'Synthetic approved concession',
        },
      ],
      lateFee: { mode: 'fixed_once', graceDays: 0, amountMinor: 5000, capMinor: 5000 },
      installments: [{ dueDate: yesterday, amountMinor: 130000 }],
      note: 'Synthetic flexible fee schedule',
    },
    {},
    true,
  );
  assert.equal(created.r.status, 201, JSON.stringify(created.data));
  assert.equal(
    (
      await call(
        '/v1/admin/fees/schedules/' + created.data.id + '/activate',
        'POST',
        { expectedVersion: 1 },
        {},
        true,
      )
    ).r.status,
    201,
  );

  await tick(db);
  await tick(db);

  const schedules = (await call('/v1/admin/fees/schedules', 'GET', undefined, {}, true)).data;
  const schedule = schedules.find((s: any) => s.id === created.data.id);
  assert.equal(schedule.scope_type, 'course');
  assert.equal(schedule.scope_reference, 'qa_course');
  assert.equal(Number(schedule.gross_amount_minor), 150000);
  assert.equal(Number(schedule.concession_amount_minor), 20000);
  assert.equal(schedule.components.length, 2);
  assert.equal(schedule.concessions.length, 1);
  assert.equal(schedule.late_fee.mode, 'fixed_once');

  const assessments = await db.query('SELECT * FROM late_fee_assessments WHERE schedule_id=$1', [
    created.data.id,
  ]);
  assert.equal(assessments.length, 1);
  assert.equal(Number(assessments[0]!.amount_minor), 5000);

  const analytics = await call('/v1/admin/fees/analytics', 'GET', undefined, {}, true);
  assert.equal(analytics.r.status, 200);
  assert.ok(
    analytics.data.byScope.some(
      (row: any) => row.scope_type === 'course' && row.scope_reference === 'qa_course',
    ),
  );

  const waived = await call(
    '/v1/admin/fees/late-fees/' + assessments[0]!.id + '/waive',
    'POST',
    { reason: 'Synthetic operator-approved waiver' },
    {},
    true,
  );
  assert.equal(waived.r.status, 201, JSON.stringify(waived.data));
  assert.equal(waived.data.status, 'waived');
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS count FROM audit WHERE object_id=$1 AND action='fees.late_fee.waive'",
        [assessments[0]!.id],
      )
    )[0]!.count,
    1,
  );
});


test('hosted checkout is idempotent, provider-gated and reconciles to the fee ledger', async () => {
  let providerCalls = 0;
  let providerReturnUrl = '';
  const providerReference = 'checkout_' + randomUUID().replaceAll('-', '');
  const providerServer = createHttpServer(async (req, res) => {
    providerCalls++;
    assert.equal(req.method, 'POST');
    assert.equal(req.headers.authorization, 'Bearer synthetic-checkout-api-key-123456789');
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    providerReturnUrl = body.returnUrl;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        providerReference,
        checkoutUrl: 'http://127.0.0.1:' + (providerServer.address() as any).port + '/checkout',
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      }),
    );
  });
  await new Promise<void>((resolve) => providerServer.listen(0, '127.0.0.1', resolve));
  const providerPort = (providerServer.address() as { port: number }).port;

  const previous = {
    checkoutMode: process.env.PAYMENT_CHECKOUT_MODE,
    createUrl: process.env.PAYMENT_CHECKOUT_CREATE_URL,
    allowedHosts: process.env.PAYMENT_CHECKOUT_ALLOWED_HOSTS,
    checkoutKey: process.env.PAYMENT_CHECKOUT_API_KEY,
    checkoutTimeout: process.env.PAYMENT_CHECKOUT_TIMEOUT_MS,
    webhookMode: process.env.PAYMENT_PROVIDER_MODE,
    providerName: process.env.PAYMENT_PROVIDER_NAME,
    webhookSecret: process.env.PAYMENT_WEBHOOK_SECRET,
  };
  Object.assign(process.env, {
    PAYMENT_CHECKOUT_MODE: 'redirect_api',
    PAYMENT_CHECKOUT_CREATE_URL: 'http://127.0.0.1:' + providerPort + '/sessions',
    PAYMENT_CHECKOUT_ALLOWED_HOSTS: '127.0.0.1',
    PAYMENT_CHECKOUT_API_KEY: 'synthetic-checkout-api-key-123456789',
    PAYMENT_CHECKOUT_TIMEOUT_MS: '5000',
    PAYMENT_PROVIDER_MODE: 'signed_hmac',
    PAYMENT_PROVIDER_NAME: 'qa_checkout_gateway',
    PAYMENT_WEBHOOK_SECRET: 'checkout-webhook-secret-'.repeat(3),
  });

  try {
    const reference = 'checkout_' + randomUUID().slice(0, 8);
    const payer = await call(
      '/v1/admin/payers',
      'POST',
      {
        accountReference: reference,
        displayName: 'Synthetic Checkout Parent',
        email: 'checkout@example.invalid',
        preferredChannel: 'email',
        locale: 'en-IN',
      },
      {},
      true,
    );
    assert.equal(payer.r.status, 201, JSON.stringify(payer.data));

    const schedule = await call(
      '/v1/admin/fees/schedules',
      'POST',
      {
        accountReference: reference,
        payerId: payer.data.id,
        scopeType: 'student',
        scopeReference: reference,
        currency: 'INR',
        components: [
          { code: 'tuition', label: 'Tuition', amountMinor: 100000 },
          { code: 'transport', label: 'Transport', amountMinor: 50000 },
        ],
        installments: [{ dueDate: '2027-09-10', amountMinor: 150000 }],
        note: 'Synthetic hosted checkout schedule',
      },
      {},
      true,
    );
    assert.equal(schedule.r.status, 201, JSON.stringify(schedule.data));
    assert.equal(
      (
        await call(
          '/v1/admin/fees/schedules/' + schedule.data.id + '/activate',
          'POST',
          { expectedVersion: 1 },
          {},
          true,
        )
      ).r.status,
      201,
    );

    const list = (await call('/v1/admin/fees/schedules', 'GET', undefined, {}, true)).data;
    const active = list.find((row: any) => row.id === schedule.data.id);
    const installmentId = active.installments[0].id;
    const link = await call(
      '/v1/admin/fees/schedules/' + schedule.data.id + '/payer-link',
      'POST',
      { expiresHours: 1 },
      {},
      true,
    );
    assert.equal(link.r.status, 201, JSON.stringify(link.data));
    const payerToken = String(link.data.path).split('/').filter(Boolean).pop()!;
    const idempotencyKey = randomUUID();
    const checkoutBody = {
      installmentId,
      amountMinor: 150000,
      idempotencyKey,
      allocations: [
        { componentCode: 'tuition', amountMinor: 100000 },
        { componentCode: 'transport', amountMinor: 50000 },
      ],
    };

    const checkout = await call('/v1/payer/' + payerToken + '/checkout', 'POST', checkoutBody);
    assert.equal(checkout.r.status, 201, JSON.stringify(checkout.data));
    assert.equal(checkout.data.status, 'created');
    assert.equal(providerCalls, 1);
    assert.match(checkout.data.checkoutUrl, /^http:\/\/127\.0\.0\.1:/);

    const retry = await call('/v1/payer/' + payerToken + '/checkout', 'POST', checkoutBody);
    assert.equal(retry.r.status, 201, JSON.stringify(retry.data));
    assert.equal(retry.data.sessionId, checkout.data.sessionId);
    assert.equal(providerCalls, 1);

    const sessions = await db.query('SELECT * FROM payment_checkout_sessions WHERE id=$1', [
      checkout.data.sessionId,
    ]);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]!.status, 'created');
    assert.equal(
      (
        await db.query('SELECT * FROM payment_checkout_allocations WHERE session_id=$1', [
          checkout.data.sessionId,
        ])
      ).length,
      2,
    );

    const event = {
      eventId: 'evt_' + randomUUID(),
      type: 'payment_confirmed',
      installmentId,
      providerReference,
      amountMinor: 150000,
      currency: 'INR',
      occurredAt: new Date().toISOString(),
    };
    const raw = JSON.stringify(event);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac('sha256', process.env.PAYMENT_WEBHOOK_SECRET!)
      .update(timestamp)
      .update('.')
      .update(raw)
      .digest('hex');
    const webhook = await fetch(base + '/v1/provider/payments/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Payment-Timestamp': timestamp,
        'X-Payment-Signature': signature,
      },
      body: raw,
    });
    assert.equal(webhook.status, 202, await webhook.text());

    const completed = (
      await db.query('SELECT * FROM payment_checkout_sessions WHERE id=$1', [
        checkout.data.sessionId,
      ])
    )[0]!;
    assert.equal(completed.status, 'completed');
    assert.ok(completed.completed_payment_id);
    assert.equal(
      (
        await db.query('SELECT * FROM payment_component_allocations WHERE payment_id=$1', [
          completed.completed_payment_id,
        ])
      ).length,
      2,
    );

    const returnToken = new URL(providerReturnUrl).pathname.split('/').filter(Boolean).pop()!;
    const returned = await call('/v1/payment-return/' + returnToken);
    assert.equal(returned.r.status, 200, JSON.stringify(returned.data));
    assert.equal(returned.data.status, 'completed');
    assert.ok(returned.data.receiptNumber);
  } finally {
    for (const [key, value] of Object.entries({
      PAYMENT_CHECKOUT_MODE: previous.checkoutMode,
      PAYMENT_CHECKOUT_CREATE_URL: previous.createUrl,
      PAYMENT_CHECKOUT_ALLOWED_HOSTS: previous.allowedHosts,
      PAYMENT_CHECKOUT_API_KEY: previous.checkoutKey,
      PAYMENT_CHECKOUT_TIMEOUT_MS: previous.checkoutTimeout,
      PAYMENT_PROVIDER_MODE: previous.webhookMode,
      PAYMENT_PROVIDER_NAME: previous.providerName,
      PAYMENT_WEBHOOK_SECRET: previous.webhookSecret,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await new Promise<void>((resolve) => providerServer.close(() => resolve()));
  }
});

test('session revocation invalidates subsequent access', async () => {
  await call('/v1/auth/logout', 'POST', {}, {}, true);
  assert.equal((await call('/v1/admin/content', 'GET', undefined, {}, true)).r.status, 401);
});
