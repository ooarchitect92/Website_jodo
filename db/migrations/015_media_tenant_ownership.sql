-- Add explicit tenant ownership to legacy uploaded media without deleting files.
ALTER TABLE media ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
UPDATE media SET tenant_id=(SELECT id FROM tenants WHERE slug='default') WHERE tenant_id IS NULL;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM media WHERE tenant_id IS NULL) THEN
    RAISE EXCEPTION 'Cannot migrate media without the default tenant';
  END IF;
END $$;
ALTER TABLE media ALTER COLUMN tenant_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS media_tenant_created_idx ON media(tenant_id,created_at DESC,id);
