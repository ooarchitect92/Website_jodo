-- Keep existing public paths unchanged while allowing each institution its own CMS paths.
-- Every row already has tenant_id after 016_content_tenant_ownership.sql.
ALTER TABLE content
  ADD CONSTRAINT content_tenant_slug_key UNIQUE (tenant_id,slug);
ALTER TABLE content DROP CONSTRAINT IF EXISTS content_slug_key;
