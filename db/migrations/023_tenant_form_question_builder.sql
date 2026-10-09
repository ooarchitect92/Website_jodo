-- Versioned tenant-owned custom enquiry questions; preserve existing submissions.
ALTER TABLE tenant_form_settings
  ADD COLUMN IF NOT EXISTS fields jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS tenant_form_revisions(
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  revision integer NOT NULL CHECK(revision > 0),
  definition jsonb NOT NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,revision)
);
INSERT INTO tenant_form_revisions(tenant_id,revision,definition,created_by,created_at)
SELECT tenant_id,revision,
       jsonb_build_object('revision',revision,'title',title,'notice',notice,
                          'success',success,'enabled',enabled,'fields',fields),
       updated_by,updated_at
FROM tenant_form_settings
ON CONFLICT(tenant_id,revision) DO NOTHING;
