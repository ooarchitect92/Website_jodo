-- Smart collection-link policy for payer portal links.
-- Existing links preserve full-outstanding-payment behavior by default.

ALTER TABLE payer_access_tokens
  ADD COLUMN IF NOT EXISTS payment_mode text NOT NULL DEFAULT 'full_balance'
    CHECK(payment_mode IN('full_balance','flexible')),
  ADD COLUMN IF NOT EXISTS allow_custom_amount boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allow_component_selection boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS min_amount_minor bigint;

ALTER TABLE payer_access_tokens
  DROP CONSTRAINT IF EXISTS payer_access_tokens_payment_policy_check;

ALTER TABLE payer_access_tokens
  ADD CONSTRAINT payer_access_tokens_payment_policy_check CHECK(
    (payment_mode='full_balance'
      AND allow_custom_amount=false
      AND allow_component_selection=false
      AND min_amount_minor IS NULL)
    OR
    (payment_mode='flexible'
      AND (allow_custom_amount=true OR allow_component_selection=true)
      AND (min_amount_minor IS NULL OR min_amount_minor>0))
  );

CREATE INDEX IF NOT EXISTS payer_access_policy_idx
  ON payer_access_tokens(schedule_id,payment_mode,expires_at DESC)
  WHERE revoked_at IS NULL;
