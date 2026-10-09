-- Establish tenant ownership for CMS content, retaining every existing page and revision.
-- Global slug uniqueness is deliberately retained until tenant domain routing is available.
ALTER TABLE content ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
UPDATE content SET tenant_id=(SELECT id FROM tenants WHERE slug='default') WHERE tenant_id IS NULL;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM content WHERE tenant_id IS NULL) THEN
    RAISE EXCEPTION 'Cannot migrate CMS content without the default tenant';
  END IF;
END $$;
ALTER TABLE content ALTER COLUMN tenant_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS content_tenant_updated_idx ON content(tenant_id,updated_at DESC,id);
