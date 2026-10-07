-- Provider-backed recurring mandate setup and automated debit lifecycle.
-- The platform stores mandate/payment state and idempotency evidence; payer bank/UPI credentials
-- remain with the approved hosted provider.

CREATE TABLE IF NOT EXISTS payment_mandate_setup_requests(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES fee_schedules(id),
  payer_id uuid NOT NULL REFERENCES fee_payers(id),
  idempotency_key uuid NOT NULL UNIQUE,
  provider text NOT NULL,
  rail text NOT NULL CHECK(rail IN('upi_autopay','enach')),
  return_token_hash text NOT NULL UNIQUE,
  provider_reference text,
  authorization_url text,
  status text NOT NULL DEFAULT 'requested'
    CHECK(status IN('requested','created','active','failed','cancelled','expired')),
  failure_code text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider,provider_reference)
);

CREATE INDEX IF NOT EXISTS payment_mandate_setup_schedule_idx
  ON payment_mandate_setup_requests(schedule_id,created_at DESC);
CREATE INDEX IF NOT EXISTS payment_mandate_setup_status_idx
  ON payment_mandate_setup_requests(status,expires_at);

CREATE TABLE IF NOT EXISTS autopay_debit_attempts(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES fee_schedules(id),
  installment_id uuid NOT NULL REFERENCES fee_installments(id),
  mandate_id uuid NOT NULL REFERENCES payment_mandates(id),
  idempotency_key uuid NOT NULL UNIQUE,
  provider text NOT NULL,
  provider_reference text,
  amount_minor bigint NOT NULL CHECK(amount_minor>0),
  currency text NOT NULL CHECK(currency='INR'),
  attempt_no integer NOT NULL CHECK(attempt_no BETWEEN 1 AND 10),
  status text NOT NULL DEFAULT 'queued'
    CHECK(status IN('queued','submitted','confirmed','failed','uncertain','cancelled')),
  failure_code text,
  next_retry_at timestamptz,
  submitted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(installment_id,attempt_no),
  UNIQUE(provider,provider_reference)
);

CREATE INDEX IF NOT EXISTS autopay_debit_due_idx
  ON autopay_debit_attempts(status,next_retry_at,created_at);
CREATE INDEX IF NOT EXISTS autopay_debit_installment_idx
  ON autopay_debit_attempts(installment_id,attempt_no DESC);
