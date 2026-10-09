-- Move legacy CRM leads to explicit tenant ownership without removing records.
-- Public demo enquiry remains owned by the default website workspace.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
UPDATE leads
SET tenant_id = (SELECT id FROM tenants WHERE slug='default')
WHERE tenant_id IS NULL;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM leads WHERE tenant_id IS NULL) THEN
    RAISE EXCEPTION 'Cannot migrate leads without a default tenant';
  END IF;
END $$;
ALTER TABLE leads ALTER COLUMN tenant_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS leads_tenant_created_idx ON leads(tenant_id,created_at DESC,id);
CREATE INDEX IF NOT EXISTS leads_tenant_stage_idx ON leads(tenant_id,stage);
