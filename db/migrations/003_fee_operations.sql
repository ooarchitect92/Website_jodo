-- Core fee-operations domain. This records schedules and externally confirmed payment evidence.
-- It does not move money, create credit, or assert a live provider connection.

CREATE TABLE IF NOT EXISTS fee_schedules(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_reference text NOT NULL,
  currency text NOT NULL DEFAULT 'INR' CHECK(currency='INR'),
  total_amount_minor bigint NOT NULL CHECK(total_amount_minor>0),
  note text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','active','completed','cancelled')),
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fee_schedules_status_idx ON fee_schedules(status,created_at DESC);

CREATE TABLE IF NOT EXISTS fee_installments(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES fee_schedules(id),
  sequence integer NOT NULL CHECK(sequence>0),
  due_date date NOT NULL,
  amount_minor bigint NOT NULL CHECK(amount_minor>0),
  paid_amount_minor bigint NOT NULL DEFAULT 0 CHECK(paid_amount_minor>=0 AND paid_amount_minor<=amount_minor),
  status text NOT NULL DEFAULT 'scheduled' CHECK(status IN('scheduled','due','part_paid','paid','overdue','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(schedule_id,sequence),
  UNIQUE(schedule_id,due_date)
);
CREATE INDEX IF NOT EXISTS fee_installments_due_idx ON fee_installments(status,due_date);

CREATE TABLE IF NOT EXISTS payment_records(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES fee_schedules(id),
  installment_id uuid NOT NULL REFERENCES fee_installments(id),
  idempotency_key uuid UNIQUE NOT NULL,
  provider text NOT NULL DEFAULT 'manual_external',
  provider_reference text NOT NULL,
  amount_minor bigint NOT NULL CHECK(amount_minor>0),
  refunded_amount_minor bigint NOT NULL DEFAULT 0 CHECK(refunded_amount_minor>=0 AND refunded_amount_minor<=amount_minor),
  currency text NOT NULL CHECK(currency='INR'),
  status text NOT NULL DEFAULT 'confirmed_external' CHECK(status IN('confirmed_external','partially_refunded','refunded')),
  evidence_note text NOT NULL,
  recorded_by uuid NOT NULL REFERENCES users(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider,provider_reference)
);
CREATE INDEX IF NOT EXISTS payment_records_schedule_idx ON payment_records(schedule_id,recorded_at DESC);

CREATE TABLE IF NOT EXISTS payment_refunds(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES payment_records(id),
  idempotency_key uuid UNIQUE NOT NULL,
  amount_minor bigint NOT NULL CHECK(amount_minor>0),
  reason text NOT NULL,
  recorded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_mandates(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES fee_schedules(id),
  rail text NOT NULL CHECK(rail IN('upi_autopay','enach')),
  provider text NOT NULL DEFAULT 'external',
  provider_reference text NOT NULL,
  status text NOT NULL CHECK(status IN('pending','active','paused','revoked','failed')),
  last_event_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid NOT NULL REFERENCES users(id),
  UNIQUE(provider,provider_reference)
);
CREATE INDEX IF NOT EXISTS payment_mandates_schedule_idx ON payment_mandates(schedule_id,last_event_at DESC);

CREATE TABLE IF NOT EXISTS settlement_records(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'external',
  provider_reference text NOT NULL,
  currency text NOT NULL CHECK(currency='INR'),
  amount_minor bigint NOT NULL CHECK(amount_minor>0),
  expected_on date,
  settled_at timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','settled','failed')),
  recorded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider,provider_reference)
);

CREATE TABLE IF NOT EXISTS settlement_payments(
  settlement_id uuid NOT NULL REFERENCES settlement_records(id),
  payment_id uuid NOT NULL REFERENCES payment_records(id),
  amount_minor bigint NOT NULL CHECK(amount_minor>0),
  PRIMARY KEY(settlement_id,payment_id)
);

CREATE TABLE IF NOT EXISTS reconciliation_entries(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid REFERENCES payment_records(id),
  settlement_id uuid REFERENCES settlement_records(id),
  status text NOT NULL CHECK(status IN('matched','unmatched','needs_review')),
  reason text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(payment_id IS NOT NULL OR settlement_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS reconciliation_status_idx ON reconciliation_entries(status,created_at DESC);
