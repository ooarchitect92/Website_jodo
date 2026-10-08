import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasMatchedPaymentFailure } from '../../packages/core/src/payment-failure';

test('unmatched signed failure must not be applied', () => {
  assert.equal(hasMatchedPaymentFailure(0, 0), false);
});
test('a checkout transition can make a failure applicable', () => {
  assert.equal(hasMatchedPaymentFailure(1, 0), true);
});
test('a recurring debit transition can make a failure applicable', () => {
  assert.equal(hasMatchedPaymentFailure(0, 1), true);
});
test('null/undefined counts do not indicate a matched transaction', () => {
  assert.equal(hasMatchedPaymentFailure(null, undefined), false);
});
