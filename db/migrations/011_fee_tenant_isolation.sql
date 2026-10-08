-- Tenant-isolate fee, payer, payment and reconciliation records.
-- Existing records are assigned to the oldest workspace so current installations keep working.
-- Child rows inherit tenant ownership from their financial parent through database triggers.

ALTER TABLE fee_payers ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE fee_schedules ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE fee_installments ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE payment_records ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE payment_refunds ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE payment_mandates ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE settlement_records ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE settlement_payments ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE reconciliation_entries ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE payer_access_tokens ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE fee_receipts ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE fee_reminder_runs ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE fee_communication_log ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE payment_provider_events ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE fee_schedule_components ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE fee_schedule_concessions ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE late_fee_rules ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE late_fee_assessments ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE payment_checkout_sessions ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE payment_checkout_allocations ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE payment_component_allocations ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE payment_mandate_setup_requests ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE autopay_debit_attempts ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);

DO $$
DECLARE default_tenant uuid;
BEGIN
  SELECT id INTO default_tenant FROM tenants ORDER BY created_at,id LIMIT 1;
  IF default_tenant IS NULL THEN
    RAISE EXCEPTION 'Tenant foundation must exist before fee tenant isolation';
  END IF;

  UPDATE fee_payers SET tenant_id=default_tenant WHERE tenant_id IS NULL;
  UPDATE fee_schedules SET tenant_id=default_tenant WHERE tenant_id IS NULL;

  UPDATE fee_installments i SET tenant_id=s.tenant_id
  FROM fee_schedules s WHERE i.schedule_id=s.id AND i.tenant_id IS NULL;
  UPDATE payment_records p SET tenant_id=s.tenant_id
  FROM fee_schedules s WHERE p.schedule_id=s.id AND p.tenant_id IS NULL;
  UPDATE payment_refunds r SET tenant_id=p.tenant_id
  FROM payment_records p WHERE r.payment_id=p.id AND r.tenant_id IS NULL;
  UPDATE payment_mandates m SET tenant_id=s.tenant_id
  FROM fee_schedules s WHERE m.schedule_id=s.id AND m.tenant_id IS NULL;
  UPDATE settlement_records SET tenant_id=default_tenant WHERE tenant_id IS NULL;
  UPDATE settlement_payments sp SET tenant_id=s.tenant_id
  FROM settlement_records s WHERE sp.settlement_id=s.id AND sp.tenant_id IS NULL;
  UPDATE reconciliation_entries r SET tenant_id=p.tenant_id
  FROM payment_records p
  WHERE r.tenant_id IS NULL AND r.payment_id=p.id;
  UPDATE reconciliation_entries r SET tenant_id=s.tenant_id
  FROM settlement_records s
  WHERE r.tenant_id IS NULL AND r.settlement_id=s.id;
  UPDATE payer_access_tokens t SET tenant_id=s.tenant_id
  FROM fee_schedules s WHERE t.schedule_id=s.id AND t.tenant_id IS NULL;
  UPDATE fee_receipts r SET tenant_id=p.tenant_id
  FROM payment_records p WHERE r.payment_id=p.id AND r.tenant_id IS NULL;
  UPDATE fee_reminder_runs r SET tenant_id=i.tenant_id
  FROM fee_installments i WHERE r.installment_id=i.id AND r.tenant_id IS NULL;
  UPDATE fee_communication_log c SET tenant_id=s.tenant_id
  FROM fee_schedules s WHERE c.schedule_id=s.id AND c.tenant_id IS NULL;
  UPDATE payment_provider_events SET tenant_id=default_tenant WHERE tenant_id IS NULL;
  UPDATE fee_schedule_components c SET tenant_id=s.tenant_id
  FROM fee_schedules s WHERE c.schedule_id=s.id AND c.tenant_id IS NULL;
  UPDATE fee_schedule_concessions c SET tenant_id=s.tenant_id
  FROM fee_schedules s WHERE c.schedule_id=s.id AND c.tenant_id IS NULL;
  UPDATE late_fee_rules r SET tenant_id=s.tenant_id
  FROM fee_schedules s WHERE r.schedule_id=s.id AND r.tenant_id IS NULL;
  UPDATE late_fee_assessments a SET tenant_id=s.tenant_id
  FROM fee_schedules s WHERE a.schedule_id=s.id AND a.tenant_id IS NULL;
  UPDATE payment_checkout_sessions x SET tenant_id=s.tenant_id
  FROM fee_schedules s WHERE x.schedule_id=s.id AND x.tenant_id IS NULL;
  UPDATE payment_checkout_allocations a SET tenant_id=x.tenant_id
  FROM payment_checkout_sessions x WHERE a.session_id=x.id AND a.tenant_id IS NULL;
  UPDATE payment_component_allocations a SET tenant_id=p.tenant_id
  FROM payment_records p WHERE a.payment_id=p.id AND a.tenant_id IS NULL;
  UPDATE payment_mandate_setup_requests r SET tenant_id=s.tenant_id
  FROM fee_schedules s WHERE r.schedule_id=s.id AND r.tenant_id IS NULL;
  UPDATE autopay_debit_attempts a SET tenant_id=s.tenant_id
  FROM fee_schedules s WHERE a.schedule_id=s.id AND a.tenant_id IS NULL;
END $$;

CREATE OR REPLACE FUNCTION inherit_fee_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_tenant uuid;
DECLARE other_tenant uuid;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'fee_installments' THEN
      SELECT tenant_id INTO parent_tenant FROM fee_schedules WHERE id=NEW.schedule_id;
    WHEN 'payment_records' THEN
      SELECT tenant_id INTO parent_tenant FROM fee_schedules WHERE id=NEW.schedule_id;
      SELECT tenant_id INTO other_tenant FROM fee_installments WHERE id=NEW.installment_id;
    WHEN 'payment_refunds' THEN
      SELECT tenant_id INTO parent_tenant FROM payment_records WHERE id=NEW.payment_id;
    WHEN 'payment_mandates' THEN
      SELECT tenant_id INTO parent_tenant FROM fee_schedules WHERE id=NEW.schedule_id;
    WHEN 'settlement_payments' THEN
      SELECT tenant_id INTO parent_tenant FROM settlement_records WHERE id=NEW.settlement_id;
      SELECT tenant_id INTO other_tenant FROM payment_records WHERE id=NEW.payment_id;
    WHEN 'reconciliation_entries' THEN
      IF NEW.payment_id IS NOT NULL THEN
        SELECT tenant_id INTO parent_tenant FROM payment_records WHERE id=NEW.payment_id;
      END IF;
      IF NEW.settlement_id IS NOT NULL THEN
        SELECT tenant_id INTO other_tenant FROM settlement_records WHERE id=NEW.settlement_id;
        parent_tenant := coalesce(parent_tenant,other_tenant);
      END IF;
    WHEN 'payer_access_tokens' THEN
      SELECT tenant_id INTO parent_tenant FROM fee_schedules WHERE id=NEW.schedule_id;
    WHEN 'fee_receipts' THEN
      SELECT tenant_id INTO parent_tenant FROM payment_records WHERE id=NEW.payment_id;
    WHEN 'fee_reminder_runs' THEN
      SELECT tenant_id INTO parent_tenant FROM fee_installments WHERE id=NEW.installment_id;
    WHEN 'fee_communication_log' THEN
      SELECT tenant_id INTO parent_tenant FROM fee_schedules WHERE id=NEW.schedule_id;
    WHEN 'fee_schedule_components' THEN
      SELECT tenant_id INTO parent_tenant FROM fee_schedules WHERE id=NEW.schedule_id;
    WHEN 'fee_schedule_concessions' THEN
      SELECT tenant_id INTO parent_tenant FROM fee_schedules WHERE id=NEW.schedule_id;
    WHEN 'late_fee_rules' THEN
      SELECT tenant_id INTO parent_tenant FROM fee_schedules WHERE id=NEW.schedule_id;
    WHEN 'late_fee_assessments' THEN
      SELECT tenant_id INTO parent_tenant FROM fee_schedules WHERE id=NEW.schedule_id;
      SELECT tenant_id INTO other_tenant FROM fee_installments WHERE id=NEW.installment_id;
    WHEN 'payment_checkout_sessions' THEN
      SELECT tenant_id INTO parent_tenant FROM fee_schedules WHERE id=NEW.schedule_id;
      SELECT tenant_id INTO other_tenant FROM fee_payers WHERE id=NEW.payer_id;
    WHEN 'payment_checkout_allocations' THEN
      SELECT tenant_id INTO parent_tenant FROM payment_checkout_sessions WHERE id=NEW.session_id;
    WHEN 'payment_component_allocations' THEN
      SELECT tenant_id INTO parent_tenant FROM payment_records WHERE id=NEW.payment_id;
    WHEN 'payment_mandate_setup_requests' THEN
      SELECT tenant_id INTO parent_tenant FROM fee_schedules WHERE id=NEW.schedule_id;
      SELECT tenant_id INTO other_tenant FROM fee_payers WHERE id=NEW.payer_id;
    WHEN 'autopay_debit_attempts' THEN
      SELECT tenant_id INTO parent_tenant FROM fee_schedules WHERE id=NEW.schedule_id;
      SELECT tenant_id INTO other_tenant FROM fee_installments WHERE id=NEW.installment_id;
    ELSE
      RAISE EXCEPTION 'Unsupported tenant inheritance table %', TG_TABLE_NAME;
  END CASE;

  IF parent_tenant IS NULL THEN
    RAISE EXCEPTION 'Financial parent is missing for %', TG_TABLE_NAME;
  END IF;
  IF other_tenant IS NOT NULL AND other_tenant<>parent_tenant THEN
    RAISE EXCEPTION 'Cross-tenant financial reference rejected for %', TG_TABLE_NAME;
  END IF;
  IF NEW.tenant_id IS NOT NULL AND NEW.tenant_id<>parent_tenant THEN
    RAISE EXCEPTION 'Explicit tenant conflicts with financial parent for %', TG_TABLE_NAME;
  END IF;
  NEW.tenant_id := parent_tenant;
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'fee_installments','payment_records','payment_refunds','payment_mandates',
    'settlement_payments','reconciliation_entries','payer_access_tokens','fee_receipts',
    'fee_reminder_runs','fee_communication_log','fee_schedule_components',
    'fee_schedule_concessions','late_fee_rules','late_fee_assessments',
    'payment_checkout_sessions','payment_checkout_allocations',
    'payment_component_allocations','payment_mandate_setup_requests','autopay_debit_attempts'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_tenant_inherit ON %I',t,t);
    EXECUTE format(
      'CREATE TRIGGER %I_tenant_inherit BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION inherit_fee_tenant()',
      t,t
    );
  END LOOP;
END $$;

ALTER TABLE fee_payers ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE fee_schedules ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE fee_installments ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE payment_records ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE payment_refunds ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE payment_mandates ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE settlement_records ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE settlement_payments ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE reconciliation_entries ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE payer_access_tokens ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE fee_receipts ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE fee_reminder_runs ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE fee_communication_log ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE payment_provider_events ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE fee_schedule_components ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE fee_schedule_concessions ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE late_fee_rules ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE late_fee_assessments ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE payment_checkout_sessions ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE payment_checkout_allocations ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE payment_component_allocations ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE payment_mandate_setup_requests ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE autopay_debit_attempts ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE fee_payers DROP CONSTRAINT IF EXISTS fee_payers_account_reference_key;
CREATE UNIQUE INDEX IF NOT EXISTS fee_payers_tenant_account_reference_key
  ON fee_payers(tenant_id,account_reference);
CREATE UNIQUE INDEX IF NOT EXISTS fee_payers_tenant_id_key ON fee_payers(tenant_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS fee_schedules_tenant_id_key ON fee_schedules(tenant_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS fee_installments_tenant_id_key ON fee_installments(tenant_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS payment_records_tenant_id_key ON payment_records(tenant_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS settlement_records_tenant_id_key ON settlement_records(tenant_id,id);

ALTER TABLE payment_records DROP CONSTRAINT IF EXISTS payment_records_idempotency_key_key;
ALTER TABLE payment_records DROP CONSTRAINT IF EXISTS payment_records_provider_provider_reference_key;
CREATE UNIQUE INDEX IF NOT EXISTS payment_records_tenant_idempotency_key
  ON payment_records(tenant_id,idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS payment_records_tenant_provider_reference_key
  ON payment_records(tenant_id,provider,provider_reference);

ALTER TABLE payment_refunds DROP CONSTRAINT IF EXISTS payment_refunds_idempotency_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS payment_refunds_tenant_idempotency_key
  ON payment_refunds(tenant_id,idempotency_key);

ALTER TABLE payment_mandates DROP CONSTRAINT IF EXISTS payment_mandates_provider_provider_reference_key;
CREATE UNIQUE INDEX IF NOT EXISTS payment_mandates_tenant_provider_reference_key
  ON payment_mandates(tenant_id,provider,provider_reference);

ALTER TABLE settlement_records DROP CONSTRAINT IF EXISTS settlement_records_provider_provider_reference_key;
CREATE UNIQUE INDEX IF NOT EXISTS settlement_records_tenant_provider_reference_key
  ON settlement_records(tenant_id,provider,provider_reference);

ALTER TABLE payment_provider_events DROP CONSTRAINT IF EXISTS payment_provider_events_provider_provider_event_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS payment_provider_events_tenant_provider_event_key
  ON payment_provider_events(tenant_id,provider,provider_event_id);

ALTER TABLE payment_checkout_sessions DROP CONSTRAINT IF EXISTS payment_checkout_sessions_idempotency_key_key;
ALTER TABLE payment_checkout_sessions DROP CONSTRAINT IF EXISTS payment_checkout_sessions_provider_provider_reference_key;
CREATE UNIQUE INDEX IF NOT EXISTS payment_checkout_sessions_tenant_idempotency_key
  ON payment_checkout_sessions(tenant_id,idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS payment_checkout_sessions_tenant_provider_reference_key
  ON payment_checkout_sessions(tenant_id,provider,provider_reference)
  WHERE provider_reference IS NOT NULL;

ALTER TABLE payment_mandate_setup_requests DROP CONSTRAINT IF EXISTS payment_mandate_setup_requests_idempotency_key_key;
ALTER TABLE payment_mandate_setup_requests DROP CONSTRAINT IF EXISTS payment_mandate_setup_requests_provider_provider_reference_key;
CREATE UNIQUE INDEX IF NOT EXISTS payment_mandate_setup_requests_tenant_idempotency_key
  ON payment_mandate_setup_requests(tenant_id,idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS payment_mandate_setup_requests_tenant_provider_reference_key
  ON payment_mandate_setup_requests(tenant_id,provider,provider_reference)
  WHERE provider_reference IS NOT NULL;

ALTER TABLE autopay_debit_attempts DROP CONSTRAINT IF EXISTS autopay_debit_attempts_idempotency_key_key;
ALTER TABLE autopay_debit_attempts DROP CONSTRAINT IF EXISTS autopay_debit_attempts_provider_provider_reference_key;
CREATE UNIQUE INDEX IF NOT EXISTS autopay_debit_attempts_tenant_idempotency_key
  ON autopay_debit_attempts(tenant_id,idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS autopay_debit_attempts_tenant_provider_reference_key
  ON autopay_debit_attempts(tenant_id,provider,provider_reference)
  WHERE provider_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS fee_schedules_tenant_status_idx
  ON fee_schedules(tenant_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS payment_records_tenant_schedule_idx
  ON payment_records(tenant_id,schedule_id,recorded_at DESC);
CREATE INDEX IF NOT EXISTS settlement_records_tenant_created_idx
  ON settlement_records(tenant_id,created_at DESC);
CREATE INDEX IF NOT EXISTS payment_provider_events_tenant_status_idx
  ON payment_provider_events(tenant_id,status,received_at DESC);
