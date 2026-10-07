-- Flexible fee structures, concessions, routing metadata and late-fee policy.
-- All monetary values are integer minor units. Provider/bank routing remains a logical mapping
-- until a verified settlement provider is activated.

ALTER TABLE fee_schedules
  ADD COLUMN IF NOT EXISTS scope_type text NOT NULL DEFAULT 'custom'
    CHECK(scope_type IN('course','batch','year','student','custom')),
  ADD COLUMN IF NOT EXISTS scope_reference text NOT NULL DEFAULT 'custom',
  ADD COLUMN IF NOT EXISTS gross_amount_minor bigint,
  ADD COLUMN IF NOT EXISTS concession_amount_minor bigint NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS fee_schedule_components(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES fee_schedules(id),
  code text NOT NULL,
  label text NOT NULL,
  amount_minor bigint NOT NULL CHECK(amount_minor>0),
  bank_route_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(schedule_id,code)
);
CREATE INDEX IF NOT EXISTS fee_schedule_components_schedule_idx
  ON fee_schedule_components(schedule_id,code);

CREATE TABLE IF NOT EXISTS fee_schedule_concessions(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES fee_schedules(id),
  code text NOT NULL,
  label text NOT NULL,
  amount_minor bigint NOT NULL CHECK(amount_minor>0),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(schedule_id,code)
);
CREATE INDEX IF NOT EXISTS fee_schedule_concessions_schedule_idx
  ON fee_schedule_concessions(schedule_id,code);

CREATE TABLE IF NOT EXISTS late_fee_rules(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid UNIQUE NOT NULL REFERENCES fee_schedules(id),
  mode text NOT NULL CHECK(mode IN('fixed_once','daily_fixed')),
  grace_days integer NOT NULL DEFAULT 0 CHECK(grace_days BETWEEN 0 AND 60),
  amount_minor bigint NOT NULL CHECK(amount_minor>0),
  cap_minor bigint,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(cap_minor IS NULL OR cap_minor>=amount_minor)
);

CREATE TABLE IF NOT EXISTS late_fee_assessments(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES fee_schedules(id),
  installment_id uuid NOT NULL REFERENCES fee_installments(id),
  rule_id uuid NOT NULL REFERENCES late_fee_rules(id),
  assessment_date date NOT NULL DEFAULT current_date,
  amount_minor bigint NOT NULL CHECK(amount_minor>0),
  status text NOT NULL DEFAULT 'assessed' CHECK(status IN('assessed','waived','paid')),
  waived_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(installment_id,assessment_date)
);
CREATE INDEX IF NOT EXISTS late_fee_assessments_schedule_idx
  ON late_fee_assessments(schedule_id,status,assessment_date);

CREATE TABLE IF NOT EXISTS fee_bank_routes(
  route_key text PRIMARY KEY,
  display_name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  provider_mapping text,
  created_at timestamptz NOT NULL DEFAULT now()
);
