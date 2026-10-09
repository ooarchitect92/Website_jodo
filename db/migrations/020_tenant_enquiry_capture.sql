-- Institution-owned, deliberately opt-in enquiry capture.
-- Never reuse global demo-form consent, attribution or lead records for tenant traffic.
CREATE TABLE IF NOT EXISTS tenant_form_settings(
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
  revision integer NOT NULL DEFAULT 1,
  enabled boolean NOT NULL DEFAULT false,
  title text NOT NULL,
  notice text NOT NULL,
  success text NOT NULL,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tenant_enquiries(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  receipt text NOT NULL UNIQUE,
  event_id uuid NOT NULL UNIQUE,
  submission_key uuid NOT NULL,
  fingerprint text NOT NULL,
  encrypted_fields text NOT NULL,
  form_revision integer NOT NULL,
  stage text NOT NULL DEFAULT 'new'
    CHECK(stage IN('new','contacted','qualified','closed','spam')),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,submission_key),
  UNIQUE(id,tenant_id)
);
CREATE INDEX IF NOT EXISTS tenant_enquiries_tenant_created
  ON tenant_enquiries(tenant_id,created_at DESC,id);
