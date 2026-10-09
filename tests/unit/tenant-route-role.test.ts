import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '../../apps/api/src/auth';

function fixture(
  accountRole: string,
  membershipRole: string,
  allowed: string[],
  tenantStatus = 'active',
  method = 'GET',
  path = '/v1/admin/tenant',
) {
  const auditActions: string[] = [];
  const db = {
    query: async () => [
      {
        id: 'user-id',
        email: 'test@example.invalid',
        role: accountRole,
        session_id: 'session-id',
        csrf_hash: 'not-needed-for-get',
        tenant_id: 'tenant-id',
        tenant_name: 'Institution',
        tenant_role: membershipRole,
        tenant_status: tenantStatus,
      },
    ],
    tx: async (fn: (client: object) => Promise<unknown>) => fn({}),
    audit: async (_client: unknown, _user: string, action: string) => {
      auditActions.push(action);
    },
  };
  const reflector = {
    getAllAndOverride: () => allowed,
  };
  const guard = new AuthGuard(db as never, reflector as never);
  const req = {
    cookies: { jodo_session: 'fake-session-token' },
    method,
    path,
    route: { path },
    headers: {},
  };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
    getClass: () => class Example {},
  };
  return { guard, ctx, req, auditActions };
}

test('global owner cannot access owner route in a tenant where they are analyst', async () => {
  const { guard, ctx, auditActions } = fixture('owner', 'analyst', ['owner']);
  await assert.rejects(() => guard.canActivate(ctx as never), ForbiddenException);
  assert.deepEqual(auditActions, ['access.denied']);
});

test('owner membership permits owner route even when global account role differs', async () => {
  const { guard, ctx, req } = fixture('analyst', 'owner', ['owner']);
  assert.equal(await guard.canActivate(ctx as never), true);
  assert.equal((req as typeof req & { actor: { tenantRole: string } }).actor.tenantRole, 'owner');
});

test('tenant analyst membership allows read-only analyst routes', async () => {
  const { guard, ctx } = fixture('owner', 'analyst', ['analyst', 'owner']);
  assert.equal(await guard.canActivate(ctx as never), true);
});

test('custom tenant role does not acquire global owner rights', async () => {
  const { guard, ctx } = fixture('owner', 'finance_maker', ['owner']);
  await assert.rejects(() => guard.canActivate(ctx as never), ForbiddenException);
});

test('suspended tenant cannot mutate configuration even with an owner membership', async () => {
  const { guard, ctx, auditActions } = fixture(
    'owner',
    'owner',
    ['owner'],
    'suspended',
    'POST',
    '/v1/admin/tenant/brand',
  );
  await assert.rejects(() => guard.canActivate(ctx as never), ForbiddenException);
  assert.deepEqual(auditActions, ['access.denied']);
});

test('suspended tenant retains read-only access for existing records', async () => {
  const { guard, ctx } = fixture('owner', 'owner', ['owner'], 'suspended');
  assert.equal(await guard.canActivate(ctx as never), true);
});
