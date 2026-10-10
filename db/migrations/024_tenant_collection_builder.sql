-- Tenant-owned private custom collections: append-only versions and encrypted entries.
-- No public access, payment rails or automatic personal-data collection.
CREATE TABLE IF NOT EXISTS tenant_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  slug text NOT NULL CHECK(slug ~ '^[a-z][a-z0-9_]{2,39}$'),
  title text NOT NULL CHECK(length(title) BETWEEN 3 AND 100),
  version integer NOT NULL DEFAULT 1 CHECK(version >= 1),
  fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,slug),
  UNIQUE (id,tenant_id)
);
CREATE INDEX IF NOT EXISTS tenant_collections_order
  ON tenant_collections(tenant_id,created_at DESC,id);

CREATE TABLE IF NOT EXISTS tenant_collection_versions (
  tenant_id uuid NOT NULL,
  collection_id uuid NOT NULL,
  version integer NOT NULL CHECK(version >= 1),
  title text NOT NULL,
  fields jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,collection_id,version),
  FOREIGN KEY (collection_id,tenant_id) REFERENCES tenant_collections(id,tenant_id)
);

CREATE TABLE IF NOT EXISTS tenant_collection_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  collection_id uuid NOT NULL,
  schema_version integer NOT NULL CHECK(schema_version >= 1),
  submission_key uuid NOT NULL,
  fingerprint text NOT NULL,
  encrypted_data text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (collection_id,submission_key),
  FOREIGN KEY (collection_id,tenant_id) REFERENCES tenant_collections(id,tenant_id),
  FOREIGN KEY (tenant_id,collection_id,schema_version)
    REFERENCES tenant_collection_versions(tenant_id,collection_id,version)
);
CREATE INDEX IF NOT EXISTS tenant_collection_entries_order
  ON tenant_collection_entries(tenant_id,collection_id,created_at DESC,id);
