-- Payer access, receipts and communication lifecycle.
-- Contact details are encrypted at the application layer. Portal tokens are stored only as digests.

CREATE TABLE IF NOT EXISTS fee_payers(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_reference text UNIQUE NOT NULL,
  encrypted_profile text NOT NULL,
  preferred_channel text NOT NULL CHECK(preferred_channel IN('email','whatsapp','none')),
  locale text NOT NULL DEFAULT 'en-IN',
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE fee_schedules ADD COLUMN IF NOT EXISTS payer_id uuid REFERENCES fee_payers(id);
CREATE INDEX IF NOT EXISTS fee_schedules_payer_idx ON fee_schedules(payer_id,created_at DESC);

CREATE TABLE IF NOT EXISTS payer_access_tokens(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES fee_schedules(id),
  token_hash text UNIQUE NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(expires_at>created_at)
);
CREATE INDEX IF NOT EXISTS payer_access_schedule_idx ON payer_access_tokens(schedule_id,expires_at DESC);

CREATE TABLE IF NOT EXISTS fee_receipts(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid UNIQUE NOT NULL REFERENCES payment_records(id),
  receipt_number text UNIQUE NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  snapshot jsonb NOT NULL,
  created_by text NOT NULL DEFAULT 'system'
);

CREATE TABLE IF NOT EXISTS fee_reminder_runs(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installment_id uuid NOT NULL REFERENCES fee_installments(id),
  reminder_key text NOT NULL CHECK(reminder_key IN('upcoming_3d','due_today','overdue')),
  reminder_date date NOT NULL DEFAULT current_date,
  event_id uuid UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(installment_id,reminder_key,reminder_date)
);

CREATE TABLE IF NOT EXISTS fee_communication_log(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid UNIQUE NOT NULL,
  schedule_id uuid NOT NULL REFERENCES fee_schedules(id),
  installment_id uuid NOT NULL REFERENCES fee_installments(id),
  payer_id uuid NOT NULL REFERENCES fee_payers(id),
  channel text NOT NULL CHECK(channel IN('email','whatsapp')),
  kind text NOT NULL CHECK(kind IN('upcoming_3d','due_today','overdue','receipt')),
  status text NOT NULL CHECK(status IN('pending','provider_accepted','blocked','uncertain','failed')),
  provider_reference text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fee_communication_status_idx ON fee_communication_log(status,created_at DESC);
