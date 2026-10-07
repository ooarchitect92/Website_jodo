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
import { randomUUID } from 'node:crypto';
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
test('session revocation invalidates subsequent access', async () => {
  await call('/v1/auth/logout', 'POST', {}, {}, true);
  assert.equal((await call('/v1/admin/content', 'GET', undefined, {}, true)).r.status, 401);
});
