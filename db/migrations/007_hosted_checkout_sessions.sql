-- Provider-backed hosted checkout sessions.
-- The platform owns intent, idempotency, amount validation, lifecycle evidence and allocation metadata.
-- Card/bank/UPI credentials remain with the selected hosted payment provider.

CREATE TABLE IF NOT EXISTS payment_checkout_sessions(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES fee_schedules(id),
  installment_id uuid NOT NULL REFERENCES fee_installments(id),
  payer_id uuid NOT NULL REFERENCES fee_payers(id),
  idempotency_key uuid NOT NULL UNIQUE,
  provider text NOT NULL,
  provider_reference text,
  amount_minor bigint NOT NULL CHECK(amount_minor>0),
  currency text NOT NULL CHECK(currency='INR'),
  checkout_url text,
  status text NOT NULL DEFAULT 'requested'
    CHECK(status IN('requested','created','completed','failed','cancelled','expired')),
  failure_code text,
  expires_at timestamptz,
  completed_payment_id uuid REFERENCES payment_records(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider,provider_reference)
);

CREATE INDEX IF NOT EXISTS payment_checkout_sessions_schedule_idx
  ON payment_checkout_sessions(schedule_id,created_at DESC);
CREATE INDEX IF NOT EXISTS payment_checkout_sessions_status_idx
  ON payment_checkout_sessions(status,expires_at);

CREATE TABLE IF NOT EXISTS payment_checkout_allocations(
  session_id uuid NOT NULL REFERENCES payment_checkout_sessions(id),
  component_code text NOT NULL,
  amount_minor bigint NOT NULL CHECK(amount_minor>0),
  PRIMARY KEY(session_id,component_code)
);

CREATE TABLE IF NOT EXISTS payment_component_allocations(
  payment_id uuid NOT NULL REFERENCES payment_records(id),
  component_code text NOT NULL,
  amount_minor bigint NOT NULL CHECK(amount_minor>0),
  PRIMARY KEY(payment_id,component_code)
);

CREATE INDEX IF NOT EXISTS payment_component_allocations_code_idx
  ON payment_component_allocations(component_code,payment_id);
