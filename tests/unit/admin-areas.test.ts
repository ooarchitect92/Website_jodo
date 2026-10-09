import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allowedAdminAreas,
  canViewAdminArea,
  safeAdminArea,
} from '../../apps/web/src/components/admin/access';

test('owner sees every registered admin area', () => {
  assert.equal(allowedAdminAreas.owner.length, 20);
  for (const area of allowedAdminAreas.owner) {
    assert.equal(canViewAdminArea('owner', area), true);
  }
});

test('editor cannot carry fee administration into a different tenant', () => {
  assert.equal(canViewAdminArea('editor', 'fees'), false);
  assert.equal(safeAdminArea('editor', 'fees'), 'overview');
  assert.equal(safeAdminArea('editor', 'content'), 'content');
});

test('sales and analysts do not retain owner navigation after role change', () => {
  assert.equal(safeAdminArea('sales', 'audit'), 'overview');
  assert.equal(safeAdminArea('analyst', 'tenant'), 'overview');
  assert.equal(canViewAdminArea('sales', 'leads'), true);
  assert.equal(canViewAdminArea('sales', 'enquiries'), true);
  assert.equal(canViewAdminArea('sales', 'notifications'), true);
  assert.equal(canViewAdminArea('editor', 'notifications'), false);
  assert.equal(safeAdminArea('editor', 'enquiries'), 'overview');
  assert.equal(safeAdminArea('analyst', 'enquiries'), 'overview');
});

test('unknown or revoked roles fail closed to the overview', () => {
  assert.equal(canViewAdminArea('custom_grant', 'users'), false);
  assert.equal(safeAdminArea('custom_grant', 'users'), 'overview');
});
