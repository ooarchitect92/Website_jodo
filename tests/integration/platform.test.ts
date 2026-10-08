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
  chatCookie = '',
  primaryTenantId = '',
  secondaryTenantId = '';
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
  assert.ok(r.data.tenant?.id);
  assert.equal(r.data.tenant.role, 'owner');
  assert.ok(Array.isArray(r.data.workspaces));
  primaryTenantId = r.data.tenant.id;
});
test('workspace membership context is explicit and tenant switching is membership-bound', async () => {
  const second = (
    await owner.query(
      `INSERT INTO tenants(slug,display_name,legal_name,status)
       VALUES($1,$2,$2,'profile_draft')
       RETURNING id`,
      ['qa-' + randomUUID().slice(0, 8), 'Synthetic Second Workspace'],
    )
  ).rows[0]!;
  secondaryTenantId = second.id;
  await owner.query('INSERT INTO onboarding_cases(tenant_id) VALUES($1)', [second.id]);
  const user = (
    await owner.query('SELECT id FROM users WHERE lower(email)=lower($1)', [
      process.env.OWNER_EMAIL,
    ])
  ).rows[0]!;
  await owner.query(
    `INSERT INTO memberships(tenant_id,user_id,role_key,status)
     VALUES($1,$2,'owner','active')`,
    [second.id, user.id],
  );

  const switched = await call('/v1/auth/switch-tenant', 'POST', { tenantId: second.id }, {}, true);
  assert.equal(switched.r.status, 201, JSON.stringify(switched.data));
  assert.equal(switched.data.tenant.id, second.id);

  const me = await call('/v1/auth/me', 'GET', undefined, {}, true);
  assert.equal(me.r.status, 200, JSON.stringify(me.data));
  assert.equal(me.data.tenant.id, second.id);
  assert.ok(me.data.workspaces.some((workspace: any) => workspace.id === primaryTenantId));
  assert.ok(me.data.workspaces.some((workspace: any) => workspace.id === second.id));

  // Legacy operations have no tenant-owned rows yet: deny access rather than leak
  // the primary institution's content, tasks, campaigns, or operational records.
  for (const route of [
    '/v1/admin/overview',
    '/v1/admin/tasks',
    '/v1/admin/audit',
    '/v1/admin/outbox',
    '/v1/admin/campaigns',
    '/v1/admin/workflows',
    '/v1/admin/workflows/runs',
    '/v1/admin/conversations',
    '/v1/admin/privacy-requests',
    '/v1/admin/content',
    '/v1/admin/settings',
    '/v1/admin/leads',
    '/v1/admin/media',
  ]) {
    const denied = await call(route, 'GET', undefined, {}, true);
    assert.equal(denied.r.status, 403, route + ': ' + JSON.stringify(denied.data));
  }
  // Record lookup is also tenant-protected, not just the collection index.
  const deniedDetail = await call('/v1/admin/content/' + randomUUID(), 'GET', undefined, {}, true);
  assert.equal(deniedDetail.r.status, 403);

  const deniedExport = await call('/v1/admin/content-export', 'POST', {}, {}, true);
  assert.equal(deniedExport.r.status, 403);

  // A second workspace must not modify global legacy tasks, campaigns or workflows.
  // These fail-closed checks happen before business payload validation.
  for (const [route, method, payload] of [
    ['/v1/admin/tasks/' + randomUUID() + '/complete', 'POST', {}],
    ['/v1/admin/campaigns', 'POST', {}],
    ['/v1/admin/workflows', 'POST', {}],
    ['/v1/admin/workflows/' + randomUUID(), 'PATCH', {}],
    ['/v1/admin/outbox/' + randomUUID() + '/retry', 'POST', {}],
    ['/v1/admin/leads/' + randomUUID() + '/stage', 'POST', {}],
    ['/v1/admin/leads/export', 'POST', {}],
    ['/v1/admin/content', 'POST', {}],
    ['/v1/admin/content/' + randomUUID() + '/draft', 'PATCH', {}],
    ['/v1/admin/content/' + randomUUID() + '/action', 'POST', {}],
    ['/v1/admin/settings/brand', 'PATCH', {}],
  ] as const) {
    const denied = await call(route, method, payload, {}, true);
    assert.equal(denied.r.status, 403, route + ': ' + JSON.stringify(denied.data));
  }

  const back = await call(
    '/v1/auth/switch-tenant',
    'POST',
    { tenantId: primaryTenantId },
    {},
    true,
  );
  assert.equal(back.r.status, 201, JSON.stringify(back.data));
  assert.equal(back.data.tenant.id, primaryTenantId);
});

test('tenant organisation, brand and maker-checker role controls are functional', async () => {
  const overview = await call('/v1/admin/tenant/overview', 'GET', undefined, {}, true);
  assert.equal(overview.r.status, 200, JSON.stringify(overview.data));
  assert.equal(overview.data.tenant.id, primaryTenantId);
  assert.equal(overview.data.workspaceRole, 'owner');
  assert.ok(overview.data.permissionCatalogue.includes('role.publish'));

  const onboarding = await call(
    '/v1/admin/tenant/onboarding',
    'POST',
    {
      section: 'organisation',
      data: {
        legalName: 'Synthetic Education Trust',
        institutionType: 'school',
        intendedCollectionModel: 'one_time_and_recurring',
        supportEmail: 'support@example.invalid',
      },
    },
    {},
    true,
  );
  assert.equal(onboarding.r.status, 201, JSON.stringify(onboarding.data));
  assert.equal(onboarding.data.current_step, 'organisation');

  const entity = await call(
    '/v1/admin/tenant/organisation/entities',
    'POST',
    {
      name: 'Synthetic Education Trust',
      registrationReference: 'SYNTH-REG-001',
      taxReferenceMasked: 'GST-***001',
    },
    {},
    true,
  );
  assert.equal(entity.r.status, 201, JSON.stringify(entity.data));

  const branch = await call(
    '/v1/admin/tenant/organisation/branches',
    'POST',
    {
      legalEntityId: entity.data.id,
      code: 'MAIN',
      name: 'Main Campus',
      city: 'Test City',
      state: 'Test State',
    },
    {},
    true,
  );
  assert.equal(branch.r.status, 201, JSON.stringify(branch.data));
  assert.equal(branch.data.tenant_id, primaryTenantId);

  const year = await call(
    '/v1/admin/tenant/organisation/academic-years',
    'POST',
    {
      label: '2026-27',
      startsOn: '2026-04-01',
      endsOn: '2027-03-31',
    },
    {},
    true,
  );
  assert.equal(year.r.status, 201, JSON.stringify(year.data));

  const brand = await call(
    '/v1/admin/tenant/brand',
    'POST',
    {
      name: 'Synthetic Academy Payments',
      primaryColour: '#0f766e',
      accentColour: '#f97316',
      supportEmail: 'support@example.invalid',
      locale: 'en-IN',
    },
    {},
    true,
  );
  assert.equal(brand.r.status, 201, JSON.stringify(brand.data));
  assert.equal(brand.data.status, 'draft');

  const domain = await call(
    '/v1/admin/tenant/domains',
    'POST',
    { hostname: 'fees.synthetic-example.invalid' },
    {},
    true,
  );
  assert.equal(domain.r.status, 201, JSON.stringify(domain.data));
  assert.equal(domain.data.status, 'pending');
  assert.equal(domain.data.dns.type, 'TXT');
  assert.match(domain.data.dns.value, /^platform-verify=/);

  const role = await call(
    '/v1/admin/tenant/roles',
    'POST',
    {
      roleKey: 'qa_reconciler',
      name: 'QA Reconciler',
      description: 'Synthetic restricted reconciliation role',
      grants: ['tenant.read', 'fee.read', 'reconciliation.read'],
      explicitDenies: ['refund.approve'],
    },
    {},
    true,
  );
  assert.equal(role.r.status, 201, JSON.stringify(role.data));
  assert.equal(role.data.status, 'draft');

  const requested = await call(
    '/v1/admin/tenant/roles/' + role.data.id + '/request-publish',
    'POST',
    {},
    {},
    true,
  );
  assert.equal(requested.r.status, 201, JSON.stringify(requested.data));
  assert.equal(requested.data.status, 'pending');

  const selfApproval = await call(
    '/v1/admin/tenant/approvals/' + requested.data.id + '/decide',
    'POST',
    { decision: 'approve', reason: 'Synthetic self approval must be rejected' },
    {},
    true,
  );
  assert.equal(selfApproval.r.status, 403);

  const latest = await call('/v1/admin/tenant/overview', 'GET', undefined, {}, true);
  assert.equal(latest.r.status, 200, JSON.stringify(latest.data));
  assert.ok(latest.data.entities.some((row: any) => row.id === entity.data.id));
  assert.ok(latest.data.branches.some((row: any) => row.id === branch.data.id));
  assert.ok(latest.data.roles.some((row: any) => row.id === role.data.id));
  assert.ok(latest.data.approvals.some((row: any) => row.id === requested.data.id));
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
  const sensitive = await call(
    '/v1/attribution/touches',
    'POST',
    { route: '/privacy', fields: { utm_source: 'google' } },
    { Cookie: consentCookie },
  );
  assert.equal(sensitive.r.status, 201);
  assert.deepEqual(sensitive.data, { status: 'suppressed', reason: 'sensitive_route' });
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

  const messageId = randomUUID();
  const first = await call(
    '/v1/chat/messages',
    'POST',
    { clientId: messageId, topic: 'Pay' },
    { Cookie: chatCookie },
  );
  assert.equal(first.r.status, 201);
  const replay = await call(
    '/v1/chat/messages',
    'POST',
    { clientId: messageId, topic: 'Pay' },
    { Cookie: chatCookie },
  );
  assert.equal(replay.r.status, 201);
  assert.equal(replay.data.answer, first.data.answer);
  const conflict = await call(
    '/v1/chat/messages',
    'POST',
    { clientId: messageId, topic: 'Cred' },
    { Cookie: chatCookie },
  );
  assert.equal(conflict.r.status, 409);
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

test('academic customer context is tenant-scoped, relationship-explicit and import-safe', async () => {
  const branchRow = (
    await db.query('SELECT id FROM branches WHERE tenant_id=$1 ORDER BY created_at LIMIT 1', [
      primaryTenantId,
    ])
  )[0]!;
  const yearRow = (
    await db.query('SELECT id FROM academic_years WHERE tenant_id=$1 ORDER BY created_at LIMIT 1', [
      primaryTenantId,
    ])
  )[0]!;

  const studentRef = 'STU-' + randomUUID().slice(0, 8);
  const student = await call(
    '/v1/admin/academic/students',
    'POST',
    {
      studentReference: studentRef,
      fullName: 'Synthetic Learner',
      branchId: branchRow.id,
      academicYearId: yearRow.id,
    },
    {},
    true,
  );
  assert.equal(student.r.status, 201, JSON.stringify(student.data));
  assert.equal(student.data.tenant_id, primaryTenantId);

  const guardian = await call(
    '/v1/admin/academic/guardians',
    'POST',
    {
      displayName: 'Synthetic Guardian',
      email: 'guardian@example.invalid',
    },
    {},
    true,
  );
  assert.equal(guardian.r.status, 201, JSON.stringify(guardian.data));
  assert.equal(guardian.data.verification_status, 'unverified');

  const relationship = await call(
    '/v1/admin/academic/students/' + student.data.id + '/guardians',
    'POST',
    {
      guardianId: guardian.data.id,
      relationship: 'guardian',
      payerRole: 'primary',
      verified: true,
    },
    {},
    true,
  );
  assert.equal(relationship.r.status, 201, JSON.stringify(relationship.data));
  assert.equal(relationship.data.visibility_status, 'active');

  const catalogue = await call(
    '/v1/admin/academic/catalogue',
    'POST',
    {
      kind: 'course',
      code: 'COURSE-' + randomUUID().slice(0, 6),
      label: 'Synthetic Course',
    },
    {},
    true,
  );
  assert.equal(catalogue.r.status, 201, JSON.stringify(catalogue.data));

  const assignment = await call(
    '/v1/admin/academic/students/' + student.data.id + '/catalogue',
    'POST',
    { catalogueId: catalogue.data.id, effectiveOn: '2026-04-01' },
    {},
    true,
  );
  assert.equal(assignment.r.status, 201, JSON.stringify(assignment.data));

  const detail = await call(
    '/v1/admin/academic/students/' + student.data.id,
    'GET',
    undefined,
    {},
    true,
  );
  assert.equal(detail.r.status, 200, JSON.stringify(detail.data));
  assert.equal(detail.data.relationships.length, 1);
  assert.equal(detail.data.assignments.length, 1);

  const importedRef = 'IMP-' + randomUUID().slice(0, 8);
  const previewBody = {
    sourceSystem: 'synthetic_erp',
    rows: [
      {
        studentReference: importedRef,
        fullName: 'Imported Student',
        externalId: 'ERP-' + randomUUID().slice(0, 8),
      },
      {
        studentReference: importedRef,
        fullName: 'Duplicate Imported Student',
      },
    ],
  };
  const preview = await call('/v1/admin/academic/imports/preview', 'POST', previewBody, {}, true);
  assert.equal(preview.r.status, 201, JSON.stringify(preview.data));
  assert.equal(preview.data.batch.valid_count, 1);
  assert.equal(preview.data.batch.error_count, 1);

  const previewReplay = await call(
    '/v1/admin/academic/imports/preview',
    'POST',
    previewBody,
    {},
    true,
  );
  assert.equal(previewReplay.r.status, 201, JSON.stringify(previewReplay.data));
  assert.equal(previewReplay.data.replayed, true);
  assert.equal(previewReplay.data.batch.id, preview.data.batch.id);

  const committed = await call(
    '/v1/admin/academic/imports/' + preview.data.batch.id + '/commit',
    'POST',
    {},
    {},
    true,
  );
  assert.equal(committed.r.status, 201, JSON.stringify(committed.data));
  assert.equal(committed.data.committed_count, 1);
  assert.equal(committed.data.status, 'partial_failed');

  const switched = await call(
    '/v1/auth/switch-tenant',
    'POST',
    { tenantId: secondaryTenantId },
    {},
    true,
  );
  assert.equal(switched.r.status, 201, JSON.stringify(switched.data));

  const secondaryOverview = await call('/v1/admin/academic/overview', 'GET', undefined, {}, true);
  assert.equal(secondaryOverview.r.status, 200, JSON.stringify(secondaryOverview.data));
  assert.ok(!secondaryOverview.data.students.some((row: any) => row.id === student.data.id));

  const crossTenantDetail = await call(
    '/v1/admin/academic/students/' + student.data.id,
    'GET',
    undefined,
    {},
    true,
  );
  assert.equal(crossTenantDetail.r.status, 409);

  const sameContactDifferentWorkspace = await call(
    '/v1/admin/academic/guardians',
    'POST',
    {
      displayName: 'Independent Guardian Identity',
      email: 'guardian@example.invalid',
    },
    {},
    true,
  );
  assert.equal(
    sameContactDifferentWorkspace.r.status,
    201,
    JSON.stringify(sameContactDifferentWorkspace.data),
  );
  assert.equal(sameContactDifferentWorkspace.data.tenant_id, secondaryTenantId);

  const back = await call(
    '/v1/auth/switch-tenant',
    'POST',
    { tenantId: primaryTenantId },
    {},
    true,
  );
  assert.equal(back.r.status, 201, JSON.stringify(back.data));
});

test('fee plans require maker-checker approval and project receivables safely', async () => {
  const student = await call(
    '/v1/admin/academic/students',
    'POST',
    {
      studentReference: 'PLAN-' + randomUUID().slice(0, 8),
      fullName: 'Synthetic Fee Plan Student',
    },
    {},
    true,
  );
  assert.equal(student.r.status, 201, JSON.stringify(student.data));

  const planKey = 'plan_' + randomUUID().slice(0, 8);
  const plan = await call(
    '/v1/admin/fee-plans',
    'POST',
    {
      planKey,
      name: 'Synthetic Annual Fee Plan',
      components: [{ code: 'tuition', label: 'Tuition', amountMinor: 100000, category: 'fee' }],
      installments: [
        { dueDate: '2027-01-10', amountMinor: 50000 },
        { dueDate: '2027-02-10', amountMinor: 50000 },
      ],
      eligibility: {},
      note: 'Synthetic fee-plan fixture',
    },
    {},
    true,
  );
  assert.equal(plan.r.status, 201, JSON.stringify(plan.data));
  assert.equal(plan.data.status, 'draft');

  const validated = await call(
    '/v1/admin/fee-plans/' + plan.data.id + '/validate',
    'POST',
    {},
    {},
    true,
  );
  assert.equal(validated.r.status, 201, JSON.stringify(validated.data));
  assert.equal(validated.data.status, 'validated');

  const requested = await call(
    '/v1/admin/fee-plans/' + plan.data.id + '/request-approval',
    'POST',
    {},
    {},
    true,
  );
  assert.equal(requested.r.status, 201, JSON.stringify(requested.data));
  assert.equal(requested.data.status, 'pending_approval');

  const selfApproval = await call(
    '/v1/admin/fee-plans/' + plan.data.id + '/approve',
    'POST',
    {},
    {},
    true,
  );
  assert.equal(selfApproval.r.status, 409);

  const originalCookie = cookie;
  const originalCsrf = csrf;
  const checkerEmail = 'checker-' + randomUUID().slice(0, 8) + '@example.invalid';
  const checkerPassword = 'Checker-' + randomUUID() + '-Password!';
  const checkerTotp = authenticator.generateSecret();
  const checkerUser = (
    await owner.query(
      `INSERT INTO users(email,password_hash,totp_secret,role,active)
       VALUES($1,$2,$3,'owner',true)
       RETURNING id`,
      [checkerEmail, await argon2.hash(checkerPassword), encrypt(checkerTotp)],
    )
  ).rows[0]!;
  await owner.query(
    `INSERT INTO memberships(tenant_id,user_id,role_key,status)
     VALUES($1,$2,'owner','active')`,
    [primaryTenantId, checkerUser.id],
  );

  const checkerLogin = await call('/v1/auth/login', 'POST', {
    email: checkerEmail,
    password: checkerPassword,
    otp: authenticator.generate(checkerTotp),
  });
  assert.equal(checkerLogin.r.status, 201, JSON.stringify(checkerLogin.data));
  cookie = checkerLogin.r.headers.getSetCookie()[0]!.split(';')[0]!;
  csrf = checkerLogin.data.csrf;

  const approved = await call(
    '/v1/admin/fee-plans/' + plan.data.id + '/approve',
    'POST',
    {},
    {},
    true,
  );
  assert.equal(approved.r.status, 201, JSON.stringify(approved.data));
  assert.equal(approved.data.status, 'approved');

  const effective = await call(
    '/v1/admin/fee-plans/' + plan.data.id + '/effective',
    'POST',
    {},
    {},
    true,
  );
  assert.equal(effective.r.status, 201, JSON.stringify(effective.data));
  assert.equal(effective.data.status, 'effective');

  cookie = originalCookie;
  csrf = originalCsrf;

  const assignment = await call(
    '/v1/admin/fee-plans/' + plan.data.id + '/assign',
    'POST',
    {
      studentId: student.data.id,
      accountReference: 'PLANACC_' + randomUUID().slice(0, 8),
    },
    {},
    true,
  );
  assert.equal(assignment.r.status, 201, JSON.stringify(assignment.data));
  assert.equal(assignment.data.assignment.status, 'active');
  const scheduleId = assignment.data.schedule.id;

  const schedules = (await call('/v1/admin/fees/schedules', 'GET', undefined, {}, true)).data;
  const assignedSchedule = schedules.find((row: any) => row.id === scheduleId);
  assert.equal(assignedSchedule.status, 'active');
  assert.equal(assignedSchedule.installments.length, 2);

  const credit = await call(
    '/v1/admin/fee-plans/credits',
    'POST',
    {
      accountReference: assignment.data.schedule.account_reference,
      source: 'external_advance',
      amountMinor: 10000,
      evidenceReference: 'ADV-' + randomUUID().slice(0, 8),
      note: 'Synthetic confirmed advance',
    },
    {},
    true,
  );
  assert.equal(credit.r.status, 201, JSON.stringify(credit.data));

  const allocated = await call(
    '/v1/admin/fee-plans/credits/' + credit.data.id + '/allocate',
    'POST',
    { installmentId: assignedSchedule.installments[0].id, amountMinor: 10000 },
    {},
    true,
  );
  assert.equal(allocated.r.status, 201, JSON.stringify(allocated.data));

  const adjustment = await call(
    '/v1/admin/fee-plans/adjustments',
    'POST',
    {
      scheduleId,
      kind: 'scholarship',
      amountMinor: 15000,
      reason: 'Synthetic approved scholarship',
    },
    {},
    true,
  );
  assert.equal(adjustment.r.status, 201, JSON.stringify(adjustment.data));

  cookie = checkerLogin.r.headers.getSetCookie()[0]!.split(';')[0]!;
  csrf = checkerLogin.data.csrf;
  const adjustmentApproved = await call(
    '/v1/admin/fee-plans/adjustments/' + adjustment.data.id + '/decide',
    'POST',
    { decision: 'approve', reason: 'Independent checker approval' },
    {},
    true,
  );
  assert.equal(adjustmentApproved.r.status, 201, JSON.stringify(adjustmentApproved.data));
  assert.equal(adjustmentApproved.data.status, 'approved');

  cookie = originalCookie;
  csrf = originalCsrf;
  const adjustmentApplied = await call(
    '/v1/admin/fee-plans/adjustments/' + adjustment.data.id + '/apply',
    'POST',
    {},
    {},
    true,
  );
  assert.equal(adjustmentApplied.r.status, 201, JSON.stringify(adjustmentApplied.data));
  assert.equal(adjustmentApplied.data.status, 'applied');

  const statement = await call(
    '/v1/admin/fee-plans/statements/students/' + student.data.id,
    'GET',
    undefined,
    {},
    true,
  );
  assert.equal(statement.r.status, 200, JSON.stringify(statement.data));
  assert.equal(statement.data.student.id, student.data.id);
  assert.ok(statement.data.movements.some((row: any) => row.kind === 'adjustment'));

  const ageing = await call('/v1/admin/fee-plans/receivables/ageing', 'GET', undefined, {}, true);
  assert.equal(ageing.r.status, 200, JSON.stringify(ageing.data));

  const change = await call(
    '/v1/admin/fee-plans/changes',
    'POST',
    {
      assignmentId: assignment.data.assignment.id,
      scheduleId,
      changeType: 'withdrawal',
      reason: 'Synthetic withdrawal case',
      payload: {},
    },
    {},
    true,
  );
  assert.equal(change.r.status, 201, JSON.stringify(change.data));

  cookie = checkerLogin.r.headers.getSetCookie()[0]!.split(';')[0]!;
  csrf = checkerLogin.data.csrf;
  const changeApproved = await call(
    '/v1/admin/fee-plans/changes/' + change.data.id + '/decide',
    'POST',
    { decision: 'approve', reason: 'Independent withdrawal approval' },
    {},
    true,
  );
  assert.equal(changeApproved.r.status, 201, JSON.stringify(changeApproved.data));

  cookie = originalCookie;
  csrf = originalCsrf;
  const executed = await call(
    '/v1/admin/fee-plans/changes/' + change.data.id + '/execute',
    'POST',
    {},
    {},
    true,
  );
  assert.equal(executed.r.status, 201, JSON.stringify(executed.data));
  assert.equal(executed.data.status, 'executed');

  const assignmentRow = (
    await db.query('SELECT status FROM student_fee_plan_assignments WHERE id=$1', [
      assignment.data.assignment.id,
    ])
  )[0]!;
  assert.equal(assignmentRow.status, 'withdrawn');

  await owner.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1', [checkerUser.id]);
});

test('fee administration is isolated by active workspace', async () => {
  assert.ok(primaryTenantId);
  assert.ok(secondaryTenantId);

  const sharedReference = 'tenant_scope_' + randomUUID().slice(0, 8);
  const primarySchedule = await call(
    '/v1/admin/fees/schedules',
    'POST',
    {
      accountReference: sharedReference,
      currency: 'INR',
      note: 'Primary workspace isolation fixture',
      installments: [{ dueDate: '2027-01-15', amountMinor: 50000 }],
    },
    {},
    true,
  );
  assert.equal(primarySchedule.r.status, 201, JSON.stringify(primarySchedule.data));
  assert.equal(primarySchedule.data.tenant_id, primaryTenantId);

  const switched = await call(
    '/v1/auth/switch-tenant',
    'POST',
    { tenantId: secondaryTenantId },
    {},
    true,
  );
  assert.equal(switched.r.status, 201, JSON.stringify(switched.data));

  const secondaryList = await call('/v1/admin/fees/schedules', 'GET', undefined, {}, true);
  assert.equal(secondaryList.r.status, 200, JSON.stringify(secondaryList.data));
  assert.ok(!secondaryList.data.some((row: any) => row.id === primarySchedule.data.id));

  const crossTenantActivation = await call(
    '/v1/admin/fees/schedules/' + primarySchedule.data.id + '/activate',
    'POST',
    { expectedVersion: 1 },
    {},
    true,
  );
  assert.equal(crossTenantActivation.r.status, 409);

  const secondaryPayer = await call(
    '/v1/admin/payers',
    'POST',
    {
      accountReference: sharedReference,
      displayName: 'Secondary Tenant Payer',
      email: 'secondary-payer@example.invalid',
      preferredChannel: 'email',
      locale: 'en-IN',
    },
    {},
    true,
  );
  assert.equal(secondaryPayer.r.status, 201, JSON.stringify(secondaryPayer.data));

  const secondarySchedule = await call(
    '/v1/admin/fees/schedules',
    'POST',
    {
      accountReference: sharedReference,
      payerId: secondaryPayer.data.id,
      currency: 'INR',
      note: 'Secondary workspace isolation fixture',
      installments: [{ dueDate: '2027-01-15', amountMinor: 50000 }],
    },
    {},
    true,
  );
  assert.equal(secondarySchedule.r.status, 201, JSON.stringify(secondarySchedule.data));
  assert.equal(secondarySchedule.data.tenant_id, secondaryTenantId);

  const secondaryPayments = await call('/v1/admin/fees/payments', 'GET', undefined, {}, true);
  assert.equal(secondaryPayments.r.status, 200, JSON.stringify(secondaryPayments.data));
  assert.ok(
    !secondaryPayments.data.some((row: any) => row.schedule_id === primarySchedule.data.id),
  );

  const back = await call(
    '/v1/auth/switch-tenant',
    'POST',
    { tenantId: primaryTenantId },
    {},
    true,
  );
  assert.equal(back.r.status, 201, JSON.stringify(back.data));
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
    const fullBalanceLink = await call(
      '/v1/admin/fees/schedules/' + schedule.data.id + '/payer-link',
      'POST',
      {
        expiresHours: 1,
        paymentMode: 'full_balance',
        allowCustomAmount: false,
        allowComponentSelection: false,
      },
      {},
      true,
    );
    assert.equal(fullBalanceLink.r.status, 201, JSON.stringify(fullBalanceLink.data));
    const fullBalanceToken = String(fullBalanceLink.data.path).split('/').filter(Boolean).pop()!;
    const rejectedPartial = await call('/v1/payer/' + fullBalanceToken + '/checkout', 'POST', {
      installmentId,
      amountMinor: 50000,
      idempotencyKey: randomUUID(),
      allocations: [],
    });
    assert.equal(rejectedPartial.r.status, 409, JSON.stringify(rejectedPartial.data));
    assert.equal(providerCalls, 0);

    const link = await call(
      '/v1/admin/fees/schedules/' + schedule.data.id + '/payer-link',
      'POST',
      {
        expiresHours: 1,
        paymentMode: 'flexible',
        allowCustomAmount: true,
        allowComponentSelection: true,
        minAmountMinor: 100,
      },
      {},
      true,
    );
    assert.equal(link.r.status, 201, JSON.stringify(link.data));
    assert.equal(link.data.paymentPolicy.mode, 'flexible');
    const payerToken = String(link.data.path).split('/').filter(Boolean).pop()!;

    const portal = await call('/v1/payer/' + payerToken);
    assert.equal(portal.r.status, 200, JSON.stringify(portal.data));
    assert.equal(portal.data.paymentPolicy.mode, 'flexible');
    assert.equal(portal.data.paymentPolicy.allowCustomAmount, true);
    assert.equal(portal.data.paymentPolicy.allowComponentSelection, true);
    assert.equal(portal.data.components.length, 2);

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

test('recurring mandate setup and due-date autopay reconcile through verified callbacks', async () => {
  let mandateCalls = 0;
  let debitCalls = 0;
  let providerReturnUrl = '';
  let debitReference = '';
  const mandateReference = 'mandate_' + randomUUID().replaceAll('-', '');

  const providerServer = createHttpServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};

    if (req.url === '/mandates') {
      mandateCalls++;
      assert.equal(req.method, 'POST');
      assert.equal(req.headers.authorization, 'Bearer synthetic-autopay-api-key-123456789');
      providerReturnUrl = body.returnUrl;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          providerReference: mandateReference,
          authorizationUrl:
            'http://127.0.0.1:' + (providerServer.address() as any).port + '/authorize',
          expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        }),
      );
      return;
    }

    if (req.url === '/debits') {
      debitCalls++;
      assert.equal(req.method, 'POST');
      assert.equal(req.headers.authorization, 'Bearer synthetic-autopay-api-key-123456789');
      assert.equal(body.mandateReference, mandateReference);
      debitReference = 'debit_' + randomUUID().replaceAll('-', '');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ providerReference: debitReference, status: 'accepted' }));
      return;
    }

    res.writeHead(404).end();
  });

  await new Promise<void>((resolve) => providerServer.listen(0, '127.0.0.1', resolve));
  const providerPort = (providerServer.address() as { port: number }).port;
  const previous = {
    autopayMode: process.env.AUTOPAY_PROVIDER_MODE,
    mandateUrl: process.env.AUTOPAY_MANDATE_CREATE_URL,
    debitUrl: process.env.AUTOPAY_DEBIT_CREATE_URL,
    allowedHosts: process.env.AUTOPAY_ALLOWED_HOSTS,
    apiKey: process.env.AUTOPAY_API_KEY,
    timeout: process.env.AUTOPAY_TIMEOUT_MS,
    maxAttempts: process.env.AUTOPAY_MAX_ATTEMPTS,
    webhookMode: process.env.PAYMENT_PROVIDER_MODE,
    providerName: process.env.PAYMENT_PROVIDER_NAME,
    webhookSecret: process.env.PAYMENT_WEBHOOK_SECRET,
  };
  Object.assign(process.env, {
    AUTOPAY_PROVIDER_MODE: 'mandate_api',
    AUTOPAY_MANDATE_CREATE_URL: 'http://127.0.0.1:' + providerPort + '/mandates',
    AUTOPAY_DEBIT_CREATE_URL: 'http://127.0.0.1:' + providerPort + '/debits',
    AUTOPAY_ALLOWED_HOSTS: '127.0.0.1',
    AUTOPAY_API_KEY: 'synthetic-autopay-api-key-123456789',
    AUTOPAY_TIMEOUT_MS: '5000',
    AUTOPAY_MAX_ATTEMPTS: '3',
    PAYMENT_PROVIDER_MODE: 'signed_hmac',
    PAYMENT_PROVIDER_NAME: 'qa_autopay_gateway',
    PAYMENT_WEBHOOK_SECRET: 'autopay-webhook-secret-'.repeat(3),
  });

  const send = async (body: any) => {
    const raw = JSON.stringify(body);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac('sha256', process.env.PAYMENT_WEBHOOK_SECRET!)
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
    const reference = 'autopay_' + randomUUID().slice(0, 8);
    const payer = await call(
      '/v1/admin/payers',
      'POST',
      {
        accountReference: reference,
        displayName: 'Synthetic AutoPay Parent',
        email: 'autopay@example.invalid',
        preferredChannel: 'email',
        locale: 'en-IN',
      },
      {},
      true,
    );
    assert.equal(payer.r.status, 201, JSON.stringify(payer.data));

    const dueDate = new Date().toISOString().slice(0, 10);
    const schedule = await call(
      '/v1/admin/fees/schedules',
      'POST',
      {
        accountReference: reference,
        payerId: payer.data.id,
        scopeType: 'student',
        scopeReference: reference,
        currency: 'INR',
        components: [{ code: 'tuition', label: 'Tuition', amountMinor: 90000 }],
        installments: [{ dueDate, amountMinor: 90000 }],
        note: 'Synthetic recurring collection schedule',
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

    const schedules = (await call('/v1/admin/fees/schedules', 'GET', undefined, {}, true)).data;
    const active = schedules.find((row: any) => row.id === schedule.data.id);
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

    const setupBody = { rail: 'upi_autopay', idempotencyKey: randomUUID() };
    const setup = await call('/v1/payer/' + payerToken + '/mandates', 'POST', setupBody);
    assert.equal(setup.r.status, 201, JSON.stringify(setup.data));
    assert.equal(setup.data.status, 'created');
    assert.equal(mandateCalls, 1);

    const setupRetry = await call('/v1/payer/' + payerToken + '/mandates', 'POST', setupBody);
    assert.equal(setupRetry.r.status, 201, JSON.stringify(setupRetry.data));
    assert.equal(setupRetry.data.setupId, setup.data.setupId);
    assert.equal(mandateCalls, 1);

    const mandateEvent = {
      eventId: 'evt_' + randomUUID(),
      type: 'mandate_status',
      scheduleId: schedule.data.id,
      rail: 'upi_autopay',
      providerReference: mandateReference,
      status: 'active',
      occurredAt: new Date().toISOString(),
    };
    const activated = await send(mandateEvent);
    assert.equal(activated.r.status, 202, JSON.stringify(activated.data));
    assert.equal(activated.data.status, 'applied');

    const returnToken = new URL(providerReturnUrl).pathname.split('/').filter(Boolean).pop()!;
    const returned = await call('/v1/mandate-return/' + returnToken);
    assert.equal(returned.r.status, 200, JSON.stringify(returned.data));
    assert.equal(returned.data.status, 'active');

    const portal = await call('/v1/payer/' + payerToken);
    assert.equal(portal.r.status, 200, JSON.stringify(portal.data));
    assert.equal(portal.data.autopayProviderConnected, true);
    assert.ok(portal.data.mandates.some((row: any) => row.status === 'active'));

    await tick(db);
    let attempts = await db.query(
      'SELECT * FROM autopay_debit_attempts WHERE installment_id=$1 ORDER BY attempt_no',
      [installmentId],
    );
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0]!.status, 'queued');

    await tick(db);
    attempts = await db.query(
      'SELECT * FROM autopay_debit_attempts WHERE installment_id=$1 ORDER BY attempt_no',
      [installmentId],
    );
    assert.equal(debitCalls, 1);
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0]!.status, 'submitted');
    assert.equal(attempts[0]!.provider_reference, debitReference);

    const paymentEvent = {
      eventId: 'evt_' + randomUUID(),
      type: 'payment_confirmed',
      installmentId,
      providerReference: debitReference,
      amountMinor: 90000,
      currency: 'INR',
      occurredAt: new Date().toISOString(),
    };
    const confirmed = await send(paymentEvent);
    assert.equal(confirmed.r.status, 202, JSON.stringify(confirmed.data));
    assert.equal(confirmed.data.status, 'applied');

    attempts = await db.query(
      'SELECT * FROM autopay_debit_attempts WHERE installment_id=$1 ORDER BY attempt_no',
      [installmentId],
    );
    assert.equal(attempts[0]!.status, 'confirmed');
    assert.ok(attempts[0]!.completed_at);

    const installment = (
      await db.query('SELECT * FROM fee_installments WHERE id=$1', [installmentId])
    )[0]!;
    assert.equal(installment.status, 'paid');
    assert.equal(Number(installment.paid_amount_minor), 90000);

    await tick(db);
    assert.equal(
      (
        await db.query(
          'SELECT count(*)::int AS count FROM autopay_debit_attempts WHERE installment_id=$1',
          [installmentId],
        )
      )[0]!.count,
      1,
    );

    const adminAttempts = await call('/v1/admin/fees/autopay-attempts', 'GET', undefined, {}, true);
    assert.equal(adminAttempts.r.status, 200);
    assert.ok(adminAttempts.data.some((row: any) => row.id === attempts[0]!.id));
  } finally {
    for (const [key, value] of Object.entries({
      AUTOPAY_PROVIDER_MODE: previous.autopayMode,
      AUTOPAY_MANDATE_CREATE_URL: previous.mandateUrl,
      AUTOPAY_DEBIT_CREATE_URL: previous.debitUrl,
      AUTOPAY_ALLOWED_HOSTS: previous.allowedHosts,
      AUTOPAY_API_KEY: previous.apiKey,
      AUTOPAY_TIMEOUT_MS: previous.timeout,
      AUTOPAY_MAX_ATTEMPTS: previous.maxAttempts,
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
