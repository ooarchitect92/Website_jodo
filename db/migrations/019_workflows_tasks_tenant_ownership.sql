-- Assign every existing workflow and follow-up task to its owning institution.
-- Cross-tenant workflow-to-lead references fail at the database boundary.
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
UPDATE workflows SET tenant_id=(SELECT id FROM tenants WHERE slug='default') WHERE tenant_id IS NULL;
ALTER TABLE workflows ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
UPDATE workflow_runs r SET tenant_id=w.tenant_id
FROM workflows w WHERE r.workflow_id=w.id AND r.tenant_id IS NULL;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM workflow_runs r JOIN leads l ON l.id=r.lead_id
    WHERE r.tenant_id IS NULL OR r.tenant_id<>l.tenant_id
  ) THEN
    RAISE EXCEPTION 'Cross-tenant workflow runs require review before migration';
  END IF;
END $$;
ALTER TABLE workflow_runs ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
UPDATE tasks t SET tenant_id=l.tenant_id FROM leads l
WHERE t.lead_id=l.id AND t.tenant_id IS NULL;
UPDATE tasks SET tenant_id=(SELECT id FROM tenants WHERE slug='default') WHERE tenant_id IS NULL;
ALTER TABLE tasks ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE workflows ADD CONSTRAINT workflows_id_tenant_unique UNIQUE(id,tenant_id);
ALTER TABLE leads ADD CONSTRAINT leads_id_tenant_unique UNIQUE(id,tenant_id);
ALTER TABLE workflow_runs ADD CONSTRAINT workflow_runs_workflow_tenant_fk
  FOREIGN KEY(workflow_id,tenant_id) REFERENCES workflows(id,tenant_id);
ALTER TABLE workflow_runs ADD CONSTRAINT workflow_runs_lead_tenant_fk
  FOREIGN KEY(lead_id,tenant_id) REFERENCES leads(id,tenant_id);
ALTER TABLE tasks ADD CONSTRAINT tasks_lead_tenant_fk
  FOREIGN KEY(lead_id,tenant_id) REFERENCES leads(id,tenant_id);
CREATE INDEX IF NOT EXISTS workflows_tenant_created_idx ON workflows(tenant_id,created_at DESC,id);
CREATE INDEX IF NOT EXISTS workflow_runs_tenant_due_idx ON workflow_runs(tenant_id,due_at DESC,id);
CREATE INDEX IF NOT EXISTS tasks_tenant_due_idx ON tasks(tenant_id,due_at,id);
