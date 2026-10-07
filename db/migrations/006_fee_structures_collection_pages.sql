-- Fee heads, installment components, and auditable adjustments.
-- These records support course/batch/student fee structures without storing bank credentials.

CREATE TABLE IF NOT EXISTS fee_heads(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL CHECK(code ~ '^[A-Z0-9_]{2,40}$'),
  name text NOT NULL CHECK(char_length(name) BETWEEN 2 AND 100),
  settlement_account_key text CHECK(settlement_account_key IS NULL OR settlement_account_key ~ '^[A-Za-z0-9_-]{2,80}$'),
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fee_installment_components(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installment_id uuid NOT NULL REFERENCES fee_installments(id),
  fee_head_id uuid NOT NULL REFERENCES fee_heads(id),
  amount_minor bigint NOT NULL CHECK(amount_minor>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(installment_id,fee_head_id)
);
CREATE INDEX IF NOT EXISTS fee_installment_components_installment_idx
  ON fee_installment_components(installment_id);

CREATE TABLE IF NOT EXISTS fee_adjustments(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES fee_schedules(id),
  installment_id uuid NOT NULL REFERENCES fee_installments(id),
  kind text NOT NULL CHECK(kind IN('discount','concession','late_fee','waiver')),
  amount_minor bigint NOT NULL CHECK(amount_minor>0),
  direction smallint NOT NULL CHECK(direction IN(-1,1)),
  reason text NOT NULL CHECK(char_length(reason) BETWEEN 3 AND 300),
  status text NOT NULL DEFAULT 'active' CHECK(status IN('active','reversed')),
  applied_by uuid NOT NULL REFERENCES users(id),
  applied_at timestamptz NOT NULL DEFAULT now(),
  reversed_by uuid REFERENCES users(id),
  reversed_at timestamptz,
  reversal_reason text,
  CHECK(
    (status='active' AND reversed_by IS NULL AND reversed_at IS NULL) OR
    (status='reversed' AND reversed_by IS NOT NULL AND reversed_at IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS fee_adjustments_installment_idx
  ON fee_adjustments(installment_id,applied_at DESC);

CREATE TABLE IF NOT EXISTS fee_collection_pages(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL CHECK(slug ~ '^[a-z0-9][a-z0-9-]{7,80}$'),
  schedule_id uuid NOT NULL REFERENCES fee_schedules(id),
  title text NOT NULL CHECK(char_length(title) BETWEEN 3 AND 120),
  description text NOT NULL DEFAULT '',
  allow_full boolean NOT NULL DEFAULT true,
  allow_partial boolean NOT NULL DEFAULT false,
  allow_custom boolean NOT NULL DEFAULT false,
  minimum_minor bigint CHECK(minimum_minor IS NULL OR minimum_minor>0),
  maximum_minor bigint CHECK(maximum_minor IS NULL OR maximum_minor>0),
  status text NOT NULL DEFAULT 'active' CHECK(status IN('active','paused','expired')),
  expires_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(maximum_minor IS NULL OR minimum_minor IS NULL OR maximum_minor>=minimum_minor)
);
CREATE INDEX IF NOT EXISTS fee_collection_pages_schedule_idx
  ON fee_collection_pages(schedule_id,status);

CREATE TABLE IF NOT EXISTS fee_collection_intents(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_page_id uuid NOT NULL REFERENCES fee_collection_pages(id),
  schedule_id uuid NOT NULL REFERENCES fee_schedules(id),
  installment_id uuid REFERENCES fee_installments(id),
  mode text NOT NULL CHECK(mode IN('full','partial','custom')),
  amount_minor bigint NOT NULL CHECK(amount_minor>0),
  currency text NOT NULL DEFAULT 'INR' CHECK(currency='INR'),
  idempotency_key uuid UNIQUE NOT NULL,
  status text NOT NULL DEFAULT 'provider_required'
    CHECK(status IN('provider_required','confirmed','expired','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes'
);
CREATE INDEX IF NOT EXISTS fee_collection_intents_page_idx
  ON fee_collection_intents(collection_page_id,created_at DESC);
