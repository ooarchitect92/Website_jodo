-- Multi-tenant foundation, organisation hierarchy, scoped memberships and governed role releases.
-- This migration preserves existing single-installation data by attaching it to a generated default tenant.
-- Existing business-domain queries remain unchanged until their tenant-scope migrations are applied; therefore
-- only tenant-admin features introduced with this migration may create additional workspaces.

CREATE TABLE IF NOT EXISTS tenants(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL CHECK(slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  display_name text NOT NULL CHECK(length(display_name) BETWEEN 2 AND 120),
  legal_name text,
  status text NOT NULL DEFAULT 'profile_draft'
    CHECK(status IN(
      'created','contact_verified','profile_draft','partner_review','needs_information',
      'rejected','approved','sandbox_validated','pilot','live','restricted','suspended',
      'offboarding','archived'
    )),
  locale text NOT NULL DEFAULT 'en-IN' CHECK(locale IN('en-IN','hi-IN')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS onboarding_cases(
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
  current_step text NOT NULL DEFAULT 'organisation',
  draft jsonb NOT NULL DEFAULT '{}',
  version integer NOT NULL DEFAULT 1,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  review_reason text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS legal_entities(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL CHECK(length(name) BETWEEN 2 AND 160),
  registration_reference text,
  tax_reference_masked text,
  status text NOT NULL DEFAULT 'active' CHECK(status IN('active','inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,name)
);
CREATE INDEX IF NOT EXISTS legal_entities_tenant_idx ON legal_entities(tenant_id,status,name);

CREATE TABLE IF NOT EXISTS branches(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  legal_entity_id uuid NOT NULL REFERENCES legal_entities(id),
  code text NOT NULL CHECK(code ~ '^[A-Za-z0-9_-]{2,40}$'),
  name text NOT NULL CHECK(length(name) BETWEEN 2 AND 120),
  city text,
  state text,
  status text NOT NULL DEFAULT 'active' CHECK(status IN('active','inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,code)
);
CREATE INDEX IF NOT EXISTS branches_tenant_idx ON branches(tenant_id,status,code);

CREATE TABLE IF NOT EXISTS academic_years(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  label text NOT NULL CHECK(length(label) BETWEEN 2 AND 40),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  status text NOT NULL DEFAULT 'planned' CHECK(status IN('planned','active','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(ends_on>starts_on),
  UNIQUE(tenant_id,label)
);
CREATE INDEX IF NOT EXISTS academic_years_tenant_idx ON academic_years(tenant_id,status,starts_on);

CREATE TABLE IF NOT EXISTS memberships(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role_key text NOT NULL CHECK(role_key ~ '^[a-z][a-z0-9_.-]{1,79}$'),
  branch_id uuid REFERENCES branches(id),
  status text NOT NULL DEFAULT 'active' CHECK(status IN('invited','active','suspended','revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,user_id)
);
CREATE INDEX IF NOT EXISTS memberships_user_idx ON memberships(user_id,status,tenant_id);

CREATE TABLE IF NOT EXISTS tenant_roles(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  role_key text NOT NULL CHECK(role_key ~ '^[a-z][a-z0-9_.-]{1,79}$'),
  name text NOT NULL CHECK(length(name) BETWEEN 2 AND 100),
  description text NOT NULL DEFAULT '',
  grants jsonb NOT NULL DEFAULT '[]',
  explicit_denies jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','pending_approval','published','retired')),
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES users(id),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,role_key,version)
);
CREATE INDEX IF NOT EXISTS tenant_roles_tenant_idx ON tenant_roles(tenant_id,status,role_key);

CREATE TABLE IF NOT EXISTS tenant_role_releases(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  role_id uuid NOT NULL REFERENCES tenant_roles(id),
  payload_hash text NOT NULL,
  requested_by uuid NOT NULL REFERENCES users(id),
  decided_by uuid REFERENCES users(id),
  status text NOT NULL DEFAULT 'pending'
    CHECK(status IN('pending','approved','rejected','cancelled')),
  decision_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
CREATE INDEX IF NOT EXISTS tenant_role_releases_pending_idx
  ON tenant_role_releases(tenant_id,status,created_at);

CREATE TABLE IF NOT EXISTS tenant_brand_versions(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL CHECK(length(name) BETWEEN 2 AND 120),
  primary_colour text NOT NULL CHECK(primary_colour ~ '^#[0-9A-Fa-f]{6}$'),
  accent_colour text NOT NULL CHECK(accent_colour ~ '^#[0-9A-Fa-f]{6}$'),
  support_email text,
  locale text NOT NULL DEFAULT 'en-IN' CHECK(locale IN('en-IN','hi-IN')),
  status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','published','retired')),
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  UNIQUE(tenant_id,version)
);

CREATE TABLE IF NOT EXISTS tenant_domains(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  hostname text UNIQUE NOT NULL CHECK(hostname ~ '^[A-Za-z0-9.-]{4,253}$'),
  challenge text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','verified','active','removed')),
  verified_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);

INSERT INTO tenants(slug,display_name,legal_name,status)
SELECT
  'default',
  coalesce(nullif(current_setting('app.default_tenant_name', true),''),'Primary workspace'),
  coalesce(nullif(current_setting('app.default_tenant_name', true),''),'Primary workspace'),
  'profile_draft'
WHERE NOT EXISTS (SELECT 1 FROM tenants);

INSERT INTO onboarding_cases(tenant_id)
SELECT id FROM tenants
ON CONFLICT(tenant_id) DO NOTHING;

INSERT INTO memberships(tenant_id,user_id,role_key,status)
SELECT t.id,u.id,
  CASE
    WHEN u.role='owner' THEN 'owner'
    WHEN u.role='editor' THEN 'builder'
    WHEN u.role='sales' THEN 'support'
    ELSE 'auditor'
  END,
  'active'
FROM users u
CROSS JOIN LATERAL (SELECT id FROM tenants ORDER BY created_at,id LIMIT 1) t
ON CONFLICT(tenant_id,user_id) DO NOTHING;

UPDATE sessions s
SET tenant_id=m.tenant_id
FROM LATERAL (
  SELECT membership.tenant_id
  FROM memberships membership
  WHERE membership.user_id=s.user_id AND membership.status='active'
  ORDER BY membership.created_at
  LIMIT 1
) m
WHERE s.tenant_id IS NULL;

ALTER TABLE sessions ALTER COLUMN tenant_id SET NOT NULL;

INSERT INTO tenant_roles(
  tenant_id,role_key,name,description,grants,explicit_denies,status,created_by,published_at
)
SELECT
  t.id,
  seed.role_key,
  seed.name,
  seed.description,
  seed.grants::jsonb,
  '[]'::jsonb,
  'published',
  owner_user.id,
  now()
FROM tenants t
JOIN LATERAL (
  SELECT u.id
  FROM users u
  JOIN memberships m ON m.user_id=u.id AND m.tenant_id=t.id
  WHERE m.status='active'
  ORDER BY CASE WHEN u.role='owner' THEN 0 ELSE 1 END,u.created_at
  LIMIT 1
) owner_user ON true
CROSS JOIN (
  VALUES
    ('owner','Tenant owner','Commercial onboarding and membership administration within platform bounds',
      '["tenant.read","tenant.onboard.edit","organisation.edit","brand.edit","domain.manage","team.invite","membership.assign","membership.revoke","role.edit","role.publish","access.simulate"]'),
    ('finance_maker','Finance maker','Create governed finance and configuration requests',
      '["tenant.read","organisation.read","fee.read","fee.adjust.request","refund.request"]'),
    ('finance_checker','Finance checker','Independently approve governed finance requests',
      '["tenant.read","organisation.read","fee.read","refund.approve","approval.decide"]'),
    ('branch_accountant','Branch accountant','Scoped receipts, dues and reconciliation',
      '["tenant.read","fee.read","payment.evidence.record","reconciliation.read"]'),
    ('builder','Builder administrator','Draft content, forms and configuration',
      '["tenant.read","content.edit","brand.edit","builder.edit"]'),
    ('auditor','Auditor','Read-only scoped evidence access',
      '["tenant.read","audit.read","report.read"]'),
    ('support','Support','Scoped support and lead operations',
      '["tenant.read","lead.read","lead.edit","support.case.read","support.case.edit"]')
) AS seed(role_key,name,description,grants)
ON CONFLICT(tenant_id,role_key,version) DO NOTHING;
