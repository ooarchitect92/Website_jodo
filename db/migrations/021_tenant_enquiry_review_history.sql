-- Preserve existing tenant enquiries; append protected review history.
-- Notes remain encrypted and never enter the shared audit payload.
CREATE TABLE IF NOT EXISTS tenant_enquiry_activities(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enquiry_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id),
  from_stage text NOT NULL,
  to_stage text NOT NULL,
  encrypted_reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_enquiry_activity_owner_fk
    FOREIGN KEY(enquiry_id,tenant_id) REFERENCES tenant_enquiries(id,tenant_id)
);
CREATE INDEX IF NOT EXISTS tenant_enquiry_activity_order_idx
  ON tenant_enquiry_activities(tenant_id,enquiry_id,created_at,id);
