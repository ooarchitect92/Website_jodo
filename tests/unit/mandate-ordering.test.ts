import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNewerMandateEvent } from '../../packages/core/src/mandate-events';

test('first valid provider mandate status may be applied', () => {
  assert.equal(isNewerMandateEvent('2026-10-08T09:00:00Z', null), true);
});
test('strictly newer provider event is accepted', () => {
  assert.equal(isNewerMandateEvent('2026-10-08T10:00:00Z', new Date('2026-10-08T09:00:00Z')), true);
});
test('out-of-order provider event cannot roll back mandate status', () => {
  assert.equal(
    isNewerMandateEvent('2026-10-08T08:00:00Z', new Date('2026-10-08T09:00:00Z')),
    false,
  );
});
test('equal provider timestamp is not treated as newer', () => {
  assert.equal(isNewerMandateEvent('2026-10-08T09:00:00Z', '2026-10-08T09:00:00+00:00'), false);
});
test('invalid provider date never advances financial state', () => {
  assert.equal(isNewerMandateEvent('invalid', new Date('2026-10-08T09:00:00Z')), false);
  assert.equal(isNewerMandateEvent('invalid', null), false);
});
