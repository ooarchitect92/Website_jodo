/**
 * A provider can deliver separate signed events for the same mandate out of order.
 * Signature validation and event-ID deduplication do not solve status rollback.
 * Refuse a status update whose provider occurrence time is not strictly newer.
 */
export function isNewerMandateEvent(
  incomingOccurredAt: string,
  currentOccurredAt: Date | string | null | undefined,
): boolean {
  if (!currentOccurredAt) return Number.isFinite(Date.parse(incomingOccurredAt));
  const incoming = Date.parse(incomingOccurredAt);
  const current =
    currentOccurredAt instanceof Date ? currentOccurredAt.getTime() : Date.parse(currentOccurredAt);
  return Number.isFinite(incoming) && Number.isFinite(current) && incoming > current;
}
