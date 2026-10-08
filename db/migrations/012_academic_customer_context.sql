-- Academic/customer context, catalogue, imports and ERP identity mappings.
-- Implements the education-context foundation required before richer fee-plan assignment.

CREATE TABLE IF NOT EXISTS academic_students(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid REFERENCES branches(id),
  academic_year_id uuid REFERENCES academic_years(id),
  student_reference text NOT NULL CHECK(student_reference ~ '^[A-Za-z0-9._/-]{2,80}$'),
  full_name text NOT NULL CHECK(length(full_name) BETWEEN 2 AND 160),
  date_of_birth date,
  status text NOT NULL DEFAULT 'active' CHECK(status IN('active','inactive','withdrawn','graduated')),
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,student_reference)
);
CREATE INDEX IF NOT EXISTS academic_students_tenant_scope_idx
  ON academic_students(tenant_id,status,branch_id,student_reference);

CREATE TABLE IF NOT EXISTS academic_guardians(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  display_name text NOT NULL CHECK(length(display_name) BETWEEN 2 AND 160),
  email text,
  phone text,
  verification_status text NOT NULL DEFAULT 'unverified'
    CHECK(verification_status IN('unverified','pending','verified','revoked')),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS academic_guardians_tenant_idx
  ON academic_guardians(tenant_id,verification_status,created_at DESC);

CREATE TABLE IF NOT EXISTS academic_guardian_links(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  student_id uuid NOT NULL REFERENCES academic_students(id),
  guardian_id uuid NOT NULL REFERENCES academic_guardians(id),
  relationship text NOT NULL CHECK(relationship IN('mother','father','guardian','self','sponsor','other')),
  payer_role text NOT NULL DEFAULT 'authorised'
    CHECK(payer_role IN('primary','authorised','view_only','none')),
  visibility_status text NOT NULL DEFAULT 'active'
    CHECK(visibility_status IN('pending','active','restricted','revoked')),
  verified_at timestamptz,
  revoked_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,student_id,guardian_id)
);
CREATE INDEX IF NOT EXISTS academic_guardian_links_student_idx
  ON academic_guardian_links(tenant_id,student_id,visibility_status);
CREATE INDEX IF NOT EXISTS academic_guardian_links_guardian_idx
  ON academic_guardian_links(tenant_id,guardian_id,visibility_status);

CREATE TABLE IF NOT EXISTS academic_catalogue(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  kind text NOT NULL CHECK(kind IN('course','grade','batch','transport','hostel')),
  code text NOT NULL CHECK(code ~ '^[A-Za-z0-9._/-]{2,60}$'),
  label text NOT NULL CHECK(length(label) BETWEEN 2 AND 160),
  parent_id uuid REFERENCES academic_catalogue(id),
  status text NOT NULL DEFAULT 'active' CHECK(status IN('active','retired')),
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  UNIQUE(tenant_id,kind,code)
);
CREATE INDEX IF NOT EXISTS academic_catalogue_tenant_idx
  ON academic_catalogue(tenant_id,kind,status,label);

CREATE TABLE IF NOT EXISTS student_catalogue_assignments(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  student_id uuid NOT NULL REFERENCES academic_students(id),
  catalogue_id uuid NOT NULL REFERENCES academic_catalogue(id),
  effective_on date NOT NULL DEFAULT current_date,
  ended_on date,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(ended_on IS NULL OR ended_on>=effective_on),
  UNIQUE(tenant_id,student_id,catalogue_id,effective_on)
);
CREATE INDEX IF NOT EXISTS student_catalogue_assignments_student_idx
  ON student_catalogue_assignments(tenant_id,student_id,effective_on DESC);

CREATE TABLE IF NOT EXISTS academic_import_batches(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  source_system text NOT NULL CHECK(length(source_system) BETWEEN 2 AND 80),
  checksum text NOT NULL CHECK(checksum ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'previewed'
    CHECK(status IN('previewed','committing','committed','partial_failed','failed')),
  row_count integer NOT NULL CHECK(row_count BETWEEN 1 AND 5000),
  valid_count integer NOT NULL DEFAULT 0 CHECK(valid_count>=0),
  error_count integer NOT NULL DEFAULT 0 CHECK(error_count>=0),
  committed_count integer NOT NULL DEFAULT 0 CHECK(committed_count>=0),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz,
  UNIQUE(tenant_id,source_system,checksum)
);
CREATE INDEX IF NOT EXISTS academic_import_batches_tenant_idx
  ON academic_import_batches(tenant_id,created_at DESC);

CREATE TABLE IF NOT EXISTS academic_import_rows(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  batch_id uuid NOT NULL REFERENCES academic_import_batches(id),
  row_number integer NOT NULL CHECK(row_number>0),
  payload jsonb NOT NULL,
  status text NOT NULL CHECK(status IN('valid','error','committed','skipped')),
  errors jsonb NOT NULL DEFAULT '[]',
  student_id uuid REFERENCES academic_students(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(batch_id,row_number)
);
CREATE INDEX IF NOT EXISTS academic_import_rows_batch_idx
  ON academic_import_rows(tenant_id,batch_id,row_number);

CREATE TABLE IF NOT EXISTS external_id_mappings(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  source_system text NOT NULL CHECK(length(source_system) BETWEEN 2 AND 80),
  entity_type text NOT NULL CHECK(entity_type IN('student','guardian','catalogue')),
  entity_id uuid NOT NULL,
  external_id text NOT NULL CHECK(length(external_id) BETWEEN 1 AND 160),
  source_version text,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,source_system,entity_type,external_id),
  UNIQUE(tenant_id,source_system,entity_type,entity_id)
);
CREATE INDEX IF NOT EXISTS external_id_mappings_entity_idx
  ON external_id_mappings(tenant_id,entity_type,entity_id);

CREATE TABLE IF NOT EXISTS erp_sync_conflicts(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  mapping_id uuid NOT NULL REFERENCES external_id_mappings(id),
  field_key text NOT NULL CHECK(field_key ~ '^[a-z][a-z0-9_.-]{1,79}$'),
  local_value jsonb,
  remote_value jsonb,
  status text NOT NULL DEFAULT 'open' CHECK(status IN('open','resolved_local','resolved_remote','dismissed')),
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS erp_sync_conflicts_tenant_idx
  ON erp_sync_conflicts(tenant_id,status,created_at DESC);

CREATE OR REPLACE FUNCTION enforce_academic_tenant_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_tenant uuid;
DECLARE second_tenant uuid;
BEGIN
  IF TG_TABLE_NAME='academic_students' THEN
    IF NEW.branch_id IS NOT NULL THEN
      SELECT tenant_id INTO parent_tenant FROM branches WHERE id=NEW.branch_id;
    END IF;
    IF NEW.academic_year_id IS NOT NULL THEN
      SELECT tenant_id INTO second_tenant FROM academic_years WHERE id=NEW.academic_year_id;
      parent_tenant := coalesce(parent_tenant,second_tenant);
    END IF;
  ELSIF TG_TABLE_NAME='academic_guardian_links' THEN
    SELECT tenant_id INTO parent_tenant FROM academic_students WHERE id=NEW.student_id;
    SELECT tenant_id INTO second_tenant FROM academic_guardians WHERE id=NEW.guardian_id;
  ELSIF TG_TABLE_NAME='academic_catalogue' THEN
    IF NEW.parent_id IS NOT NULL THEN
      SELECT tenant_id INTO parent_tenant FROM academic_catalogue WHERE id=NEW.parent_id;
    END IF;
  ELSIF TG_TABLE_NAME='student_catalogue_assignments' THEN
    SELECT tenant_id INTO parent_tenant FROM academic_students WHERE id=NEW.student_id;
    SELECT tenant_id INTO second_tenant FROM academic_catalogue WHERE id=NEW.catalogue_id;
  ELSIF TG_TABLE_NAME='academic_import_rows' THEN
    SELECT tenant_id INTO parent_tenant FROM academic_import_batches WHERE id=NEW.batch_id;
    IF NEW.student_id IS NOT NULL THEN
      SELECT tenant_id INTO second_tenant FROM academic_students WHERE id=NEW.student_id;
    END IF;
  ELSIF TG_TABLE_NAME='erp_sync_conflicts' THEN
    SELECT tenant_id INTO parent_tenant FROM external_id_mappings WHERE id=NEW.mapping_id;
  END IF;

  IF parent_tenant IS NOT NULL AND parent_tenant<>NEW.tenant_id THEN
    RAISE EXCEPTION 'Cross-tenant academic reference rejected for %', TG_TABLE_NAME;
  END IF;
  IF second_tenant IS NOT NULL AND second_tenant<>NEW.tenant_id THEN
    RAISE EXCEPTION 'Cross-tenant academic reference rejected for %', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'academic_students','academic_guardian_links','academic_catalogue',
    'student_catalogue_assignments','academic_import_rows','erp_sync_conflicts'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_tenant_guard ON %I',t,t);
    EXECUTE format(
      'CREATE TRIGGER %I_tenant_guard BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION enforce_academic_tenant_consistency()',
      t,t
    );
  END LOOP;
END $$;
