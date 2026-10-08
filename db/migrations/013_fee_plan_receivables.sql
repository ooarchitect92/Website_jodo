-- Versioned fee plans, assignments, receivable controls and advance-credit handling.
-- CAP-021..CAP-025. Money remains represented as obligations/evidence; no bank movement is asserted here.

ALTER TABLE fee_installments
  ADD COLUMN IF NOT EXISTS adjustment_amount_minor bigint NOT NULL DEFAULT 0
    CHECK(adjustment_amount_minor>=0 AND adjustment_amount_minor<=amount_minor);
ALTER TABLE fee_installments DROP CONSTRAINT IF EXISTS fee_installments_status_check;
ALTER TABLE fee_installments
  ADD CONSTRAINT fee_installments_status_check
  CHECK(status IN('scheduled','due','part_paid','paid','overdue','cancelled','adjusted'));

CREATE TABLE IF NOT EXISTS fee_plan_versions(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  plan_key text NOT NULL CHECK(plan_key ~ '^[A-Za-z0-9._/-]{2,80}$'),
  version integer NOT NULL CHECK(version>0),
  name text NOT NULL CHECK(length(name) BETWEEN 2 AND 160),
  academic_year_id uuid REFERENCES academic_years(id),
  branch_id uuid REFERENCES branches(id),
  currency text NOT NULL DEFAULT 'INR' CHECK(currency='INR'),
  status text NOT NULL DEFAULT 'draft'
    CHECK(status IN('draft','validated','pending_approval','approved','effective','superseded','closed')),
  eligibility jsonb NOT NULL DEFAULT '{}',
  note text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  validated_by uuid REFERENCES users(id),
  approved_by uuid REFERENCES users(id),
  effective_from date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,plan_key,version)
);
CREATE INDEX IF NOT EXISTS fee_plan_versions_tenant_idx
  ON fee_plan_versions(tenant_id,status,plan_key,version DESC);

CREATE TABLE IF NOT EXISTS fee_plan_components(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  plan_id uuid NOT NULL REFERENCES fee_plan_versions(id),
  code text NOT NULL CHECK(code ~ '^[A-Za-z0-9_-]{2,40}$'),
  label text NOT NULL CHECK(length(label) BETWEEN 2 AND 100),
  amount_minor bigint NOT NULL CHECK(amount_minor>0),
  category text NOT NULL DEFAULT 'fee'
    CHECK(category IN('fee','deposit','transport','hostel','exam','other')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(plan_id,code)
);

CREATE TABLE IF NOT EXISTS fee_plan_installments(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  plan_id uuid NOT NULL REFERENCES fee_plan_versions(id),
  sequence integer NOT NULL CHECK(sequence>0),
  due_date date NOT NULL,
  amount_minor bigint NOT NULL CHECK(amount_minor>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(plan_id,sequence),
  UNIQUE(plan_id,due_date)
);

CREATE TABLE IF NOT EXISTS student_fee_plan_assignments(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  student_id uuid NOT NULL REFERENCES academic_students(id),
  plan_id uuid NOT NULL REFERENCES fee_plan_versions(id),
  schedule_id uuid REFERENCES fee_schedules(id),
  status text NOT NULL DEFAULT 'active'
    CHECK(status IN('active','superseded','withdrawn','transferred','closed')),
  assigned_on date NOT NULL DEFAULT current_date,
  ended_on date,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(ended_on IS NULL OR ended_on>=assigned_on),
  UNIQUE(tenant_id,student_id,plan_id)
);
CREATE INDEX IF NOT EXISTS student_fee_plan_assignments_student_idx
  ON student_fee_plan_assignments(tenant_id,student_id,status,assigned_on DESC);

CREATE TABLE IF NOT EXISTS fee_adjustment_requests(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  schedule_id uuid NOT NULL REFERENCES fee_schedules(id),
  kind text NOT NULL CHECK(kind IN('concession','scholarship','waiver','write_off')),
  amount_minor bigint NOT NULL CHECK(amount_minor>0),
  effective_on date NOT NULL DEFAULT current_date,
  reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','rejected','applied','cancelled')),
  requested_by uuid NOT NULL REFERENCES users(id),
  decided_by uuid REFERENCES users(id),
  decision_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  applied_at timestamptz
);
CREATE INDEX IF NOT EXISTS fee_adjustment_requests_tenant_idx
  ON fee_adjustment_requests(tenant_id,status,created_at DESC);

CREATE TABLE IF NOT EXISTS fee_credits(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  payer_id uuid REFERENCES fee_payers(id),
  account_reference text NOT NULL,
  source text NOT NULL CHECK(source IN('external_advance','opening_balance','transfer_credit')),
  amount_minor bigint NOT NULL CHECK(amount_minor>0),
  applied_minor bigint NOT NULL DEFAULT 0 CHECK(applied_minor>=0 AND applied_minor<=amount_minor),
  currency text NOT NULL DEFAULT 'INR' CHECK(currency='INR'),
  evidence_reference text,
  note text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK(status IN('active','fully_applied','cancelled')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fee_credits_tenant_idx
  ON fee_credits(tenant_id,status,account_reference,created_at DESC);

CREATE TABLE IF NOT EXISTS fee_credit_allocations(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  credit_id uuid NOT NULL REFERENCES fee_credits(id),
  installment_id uuid NOT NULL REFERENCES fee_installments(id),
  amount_minor bigint NOT NULL CHECK(amount_minor>0),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fee_credit_allocations_credit_idx
  ON fee_credit_allocations(tenant_id,credit_id,created_at);

CREATE TABLE IF NOT EXISTS receivable_change_requests(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  assignment_id uuid REFERENCES student_fee_plan_assignments(id),
  schedule_id uuid NOT NULL REFERENCES fee_schedules(id),
  change_type text NOT NULL CHECK(change_type IN('withdrawal','transfer','plan_change','write_off')),
  payload jsonb NOT NULL DEFAULT '{}',
  reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),
  status text NOT NULL DEFAULT 'pending'
    CHECK(status IN('pending','approved','rejected','executed','cancelled')),
  requested_by uuid NOT NULL REFERENCES users(id),
  decided_by uuid REFERENCES users(id),
  executed_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  executed_at timestamptz
);
CREATE INDEX IF NOT EXISTS receivable_change_requests_tenant_idx
  ON receivable_change_requests(tenant_id,status,created_at DESC);

CREATE OR REPLACE FUNCTION enforce_fee_plan_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_tenant uuid;
DECLARE other_tenant uuid;
BEGIN
  IF TG_TABLE_NAME='fee_plan_versions' THEN
    IF NEW.academic_year_id IS NOT NULL THEN
      SELECT tenant_id INTO parent_tenant FROM academic_years WHERE id=NEW.academic_year_id;
    END IF;
    IF NEW.branch_id IS NOT NULL THEN
      SELECT tenant_id INTO other_tenant FROM branches WHERE id=NEW.branch_id;
      parent_tenant := coalesce(parent_tenant,other_tenant);
    END IF;
  ELSIF TG_TABLE_NAME IN ('fee_plan_components','fee_plan_installments') THEN
    SELECT tenant_id INTO parent_tenant FROM fee_plan_versions WHERE id=NEW.plan_id;
  ELSIF TG_TABLE_NAME='student_fee_plan_assignments' THEN
    SELECT tenant_id INTO parent_tenant FROM academic_students WHERE id=NEW.student_id;
    SELECT tenant_id INTO other_tenant FROM fee_plan_versions WHERE id=NEW.plan_id;
    IF NEW.schedule_id IS NOT NULL THEN
      IF other_tenant IS DISTINCT FROM (SELECT tenant_id FROM fee_schedules WHERE id=NEW.schedule_id) THEN
        RAISE EXCEPTION 'Cross-tenant fee assignment schedule rejected';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME='fee_adjustment_requests' THEN
    SELECT tenant_id INTO parent_tenant FROM fee_schedules WHERE id=NEW.schedule_id;
  ELSIF TG_TABLE_NAME='fee_credits' THEN
    IF NEW.payer_id IS NOT NULL THEN
      SELECT tenant_id INTO parent_tenant FROM fee_payers WHERE id=NEW.payer_id;
    END IF;
  ELSIF TG_TABLE_NAME='fee_credit_allocations' THEN
    SELECT tenant_id INTO parent_tenant FROM fee_credits WHERE id=NEW.credit_id;
    SELECT tenant_id INTO other_tenant FROM fee_installments WHERE id=NEW.installment_id;
  ELSIF TG_TABLE_NAME='receivable_change_requests' THEN
    SELECT tenant_id INTO parent_tenant FROM fee_schedules WHERE id=NEW.schedule_id;
    IF NEW.assignment_id IS NOT NULL THEN
      SELECT tenant_id INTO other_tenant FROM student_fee_plan_assignments WHERE id=NEW.assignment_id;
    END IF;
  END IF;

  IF parent_tenant IS NOT NULL AND parent_tenant<>NEW.tenant_id THEN
    RAISE EXCEPTION 'Cross-tenant reference rejected for %',TG_TABLE_NAME;
  END IF;
  IF other_tenant IS NOT NULL AND other_tenant<>NEW.tenant_id THEN
    RAISE EXCEPTION 'Cross-tenant reference rejected for %',TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'fee_plan_versions','fee_plan_components','fee_plan_installments',
    'student_fee_plan_assignments','fee_adjustment_requests','fee_credits',
    'fee_credit_allocations','receivable_change_requests'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_tenant_guard ON %I',t,t);
    EXECUTE format(
      'CREATE TRIGGER %I_tenant_guard BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION enforce_fee_plan_tenant()',
      t,t
    );
  END LOOP;
END $$;
