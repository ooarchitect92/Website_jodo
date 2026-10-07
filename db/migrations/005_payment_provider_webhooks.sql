-- Signed payment-provider webhook intake and replay-safe event ledger.
-- Provider payloads are stored only after signature verification and normalized allowlisting.

CREATE TABLE IF NOT EXISTS payment_provider_events(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  event_type text NOT NULL CHECK(event_type IN('payment_confirmed','payment_failed','refund_confirmed','mandate_status')),
  body_hash text NOT NULL,
  normalized_payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'received' CHECK(status IN('received','applied','ignored','failed')),
  failure_code text,
  received_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  UNIQUE(provider,provider_event_id)
);
CREATE INDEX IF NOT EXISTS payment_provider_events_status_idx
  ON payment_provider_events(status,received_at DESC);

ALTER TABLE payment_records
  ADD COLUMN IF NOT EXISTS provider_event_id uuid REFERENCES payment_provider_events(id);

CREATE INDEX IF NOT EXISTS payment_records_provider_event_idx
  ON payment_records(provider_event_id)
  WHERE provider_event_id IS NOT NULL;
