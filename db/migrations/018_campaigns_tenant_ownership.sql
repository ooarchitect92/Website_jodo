-- Existing marketing links are preserved and attributed to the original public site.
-- New campaigns are owned by the active institution, not by their creator's global identity.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
UPDATE campaigns
SET tenant_id = (SELECT id FROM tenants WHERE slug='default')
WHERE tenant_id IS NULL;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM campaigns WHERE tenant_id IS NULL) THEN
    RAISE EXCEPTION 'Cannot migrate campaigns without a default tenant';
  END IF;
END $$;
ALTER TABLE campaigns ALTER COLUMN tenant_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS campaigns_tenant_created_idx
  ON campaigns(tenant_id,created_at DESC,id);
