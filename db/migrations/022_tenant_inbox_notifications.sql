-- Tenant-owned, non-sensitive in-app communication receipts.
-- Each staff member has independent read state; no customer data is stored here.
CREATE TABLE IF NOT EXISTS tenant_inbox_notifications(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  source_event_id uuid NOT NULL UNIQUE,
  enquiry_id uuid NOT NULL,
  title text NOT NULL CHECK(length(title) BETWEEN 3 AND 180),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,tenant_id),
  CONSTRAINT tenant_inbox_enquiry_fk
    FOREIGN KEY(enquiry_id,tenant_id) REFERENCES tenant_enquiries(id,tenant_id)
);
CREATE INDEX IF NOT EXISTS tenant_inbox_by_tenant
  ON tenant_inbox_notifications(tenant_id,created_at DESC,id DESC);

CREATE TABLE IF NOT EXISTS tenant_inbox_reads(
  tenant_id uuid NOT NULL,
  notification_id uuid NOT NULL,
  user_id uuid NOT NULL,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(notification_id,user_id),
  CONSTRAINT tenant_inbox_notification_fk
    FOREIGN KEY(notification_id,tenant_id) REFERENCES tenant_inbox_notifications(id,tenant_id),
  CONSTRAINT tenant_inbox_reader_fk
    FOREIGN KEY(tenant_id,user_id) REFERENCES memberships(tenant_id,user_id)
);
CREATE INDEX IF NOT EXISTS tenant_inbox_reads_user
  ON tenant_inbox_reads(tenant_id,user_id,read_at DESC);
