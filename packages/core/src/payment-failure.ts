/**
 * Failure callbacks are authoritative only when an exact outstanding financial
 * attempt was transitioned. Signature validity does not imply target validity.
 */
export function hasMatchedPaymentFailure(
  checkoutUpdatedRows: number | null | undefined,
  debitUpdatedRows: number | null | undefined,
): boolean {
  return (checkoutUpdatedRows ?? 0) > 0 || (debitUpdatedRows ?? 0) > 0;
}
