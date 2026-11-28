export const schemaVersion = 6;

export const schemaSql = `
CREATE TABLE IF NOT EXISTS agent_grants (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), family_id TEXT NOT NULL REFERENCES families(id),
 name TEXT NOT NULL, scopes_json TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, token_hint TEXT NOT NULL,
 created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT, last_used_at TEXT
);
CREATE TABLE IF NOT EXISTS agent_operations (
 id TEXT PRIMARY KEY, grant_id TEXT NOT NULL REFERENCES agent_grants(id), request_id TEXT NOT NULL,
 tool TEXT NOT NULL, params_json TEXT NOT NULL, snapshot_json TEXT NOT NULL DEFAULT '{}', fingerprint TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
 created_at TEXT NOT NULL, expires_at TEXT NOT NULL, result_json TEXT, decided_at TEXT,
 UNIQUE(grant_id, request_id)
);
CREATE TABLE IF NOT EXISTS agent_call_logs (
 id TEXT PRIMARY KEY, grant_id TEXT NOT NULL REFERENCES agent_grants(id), tool TEXT NOT NULL,
 status TEXT NOT NULL, elapsed_ms INTEGER NOT NULL, operation_id TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_call_logs_grant_time ON agent_call_logs(grant_id, created_at);
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS families (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS family_members (
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (family_id, user_id)
);

CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'home',
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (family_id, name)
);

CREATE TABLE IF NOT EXISTS storage_places (
  id TEXT PRIMARY KEY,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (location_id, name)
);

CREATE TABLE IF NOT EXISTS category_templates (
  id TEXT PRIMARY KEY,
  system_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  icon TEXT NOT NULL,
  fields_json TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES category_templates(id),
  name TEXT NOT NULL,
  brand TEXT,
  barcode TEXT,
  specification TEXT,
  ingredients TEXT,
  default_unit TEXT NOT NULL DEFAULT '件',
  low_stock_threshold REAL,
  cover_image_id TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS products_family_barcode_unique
  ON products(family_id, barcode)
  WHERE barcode IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS products_family_name_idx ON products(family_id, name);

CREATE TABLE IF NOT EXISTS inventory_batches (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  location_id TEXT NOT NULL REFERENCES locations(id),
  storage_place_id TEXT REFERENCES storage_places(id),
  current_quantity REAL NOT NULL DEFAULT 0 CHECK (current_quantity >= 0),
  unit TEXT NOT NULL,
  purchased_at TEXT,
  production_date TEXT,
  shelf_life_value INTEGER,
  shelf_life_unit TEXT CHECK (shelf_life_unit IS NULL OR shelf_life_unit IN ('day', 'month', 'year')),
  expiration_date TEXT,
  unit_price REAL,
  channel TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'depleted', 'discarded')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS inventory_batches_location_idx ON inventory_batches(location_id, status);
CREATE INDEX IF NOT EXISTS inventory_batches_expiration_idx ON inventory_batches(expiration_date, status);

CREATE TABLE IF NOT EXISTS inventory_transactions (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  batch_id TEXT NOT NULL REFERENCES inventory_batches(id),
  transaction_type TEXT NOT NULL CHECK (
    transaction_type IN ('stock_in', 'consume', 'discard', 'transfer_out', 'transfer_in', 'adjust')
  ),
  quantity REAL NOT NULL,
  unit TEXT NOT NULL,
  from_location_id TEXT REFERENCES locations(id),
  to_location_id TEXT REFERENCES locations(id),
  reason TEXT,
  operator_user_id TEXT NOT NULL REFERENCES users(id),
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS inventory_transactions_batch_idx
  ON inventory_transactions(batch_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS intake_drafts (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id),
  location_id TEXT REFERENCES locations(id),
  category_id TEXT REFERENCES category_templates(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (
    status IN (
      'draft', 'uploading', 'queued', 'ocr_processing', 'rule_parsing',
      'ai_processing', 'needs_review', 'completed', 'failed', 'cancelled'
    )
  ),
  processing_stage TEXT,
  user_values_json TEXT NOT NULL DEFAULT '{}',
  field_versions_json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  review_required INTEGER NOT NULL DEFAULT 0 CHECK (review_required IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  intake_id TEXT NOT NULL REFERENCES intake_drafts(id) ON DELETE CASCADE,
  image_role TEXT NOT NULL CHECK (image_role IN ('product', 'label', 'date')),
  storage_path TEXT NOT NULL,
  thumbnail_path TEXT,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS media_assets_intake_role_unique
  ON media_assets(intake_id, image_role);

CREATE TABLE IF NOT EXISTS processing_jobs (
  id TEXT PRIMARY KEY,
  intake_id TEXT NOT NULL REFERENCES intake_drafts(id) ON DELETE CASCADE,
  image_id TEXT REFERENCES media_assets(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (
    status IN ('queued', 'processing', 'completed', 'failed', 'cancelled')
  ),
  stage TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  pipeline_version TEXT NOT NULL,
  deduplication_key TEXT NOT NULL UNIQUE,
  locked_at TEXT,
  lease_expires_at TEXT,
  next_retry_at TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS processing_jobs_claim_idx
  ON processing_jobs(status, next_retry_at, created_at);

CREATE TABLE IF NOT EXISTS ocr_results (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE REFERENCES processing_jobs(id) ON DELETE CASCADE,
  image_id TEXT NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  engine TEXT NOT NULL,
  model_version TEXT NOT NULL,
  lines_json TEXT NOT NULL,
  elapsed_ms INTEGER,
  raw_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ocr_results_image_idx
  ON ocr_results(image_id, created_at DESC);

CREATE TABLE IF NOT EXISTS field_candidates (
  id TEXT PRIMARY KEY,
  intake_id TEXT NOT NULL REFERENCES intake_drafts(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('barcode', 'ocr_rule', 'ai', 'computed')),
  confidence REAL,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  based_on_version INTEGER NOT NULL,
  accepted_at TEXT,
  rejected_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS field_candidates_intake_idx
  ON field_candidates(intake_id, field_key, created_at DESC);

CREATE TABLE IF NOT EXISTS app_settings (
  setting_key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ai_extraction_runs (
  id TEXT PRIMARY KEY,
  job_id TEXT UNIQUE REFERENCES processing_jobs(id) ON DELETE SET NULL,
  intake_id TEXT REFERENCES intake_drafts(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('extraction', 'connection_test')),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  based_on_version INTEGER,
  status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'cancelled')),
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  elapsed_ms INTEGER,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS ai_extraction_runs_intake_idx
  ON ai_extraction_runs(intake_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_extraction_runs_stats_idx
  ON ai_extraction_runs(created_at, status);
`;

export const systemCategories = [
  {
    id: "category-medicine",
    key: "medicine",
    name: "药品保健",
    icon: "pill",
    sortOrder: 10,
    fields: {
      enabled: ["batchNumber", "specification", "expirationDate", "notes"],
      required: ["expirationDate"],
      defaultUnit: "盒",
      expirationEnabled: true
    }
  },
  {
    id: "category-food",
    key: "food",
    name: "囤货食品",
    icon: "utensils",
    sortOrder: 20,
    fields: {
      enabled: ["ingredients", "productionDate", "shelfLife", "expirationDate", "storageCondition"],
      required: [],
      defaultUnit: "件",
      expirationEnabled: true
    }
  },
  {
    id: "category-consumable",
    key: "consumable",
    name: "家电耗材",
    icon: "filter",
    sortOrder: 25,
    fields: {
      enabled: ["model", "specification", "expirationDate", "notes"],
      required: [],
      defaultUnit: "个",
      expirationEnabled: true
    }
  },
  {
    id: "category-daily",
    key: "daily",
    name: "日化母婴",
    icon: "spray-can",
    sortOrder: 30,
    fields: {
      enabled: ["productionDate", "shelfLife", "expirationDate", "openedShelfLife"],
      required: [],
      defaultUnit: "件",
      expirationEnabled: true
    }
  },
  {
    id: "category-tool",
    key: "tool",
    name: "工具设备",
    icon: "wrench",
    sortOrder: 40,
    fields: {
      enabled: ["model", "serialNumber", "warrantyUntil"],
      required: [],
      defaultUnit: "件",
      expirationEnabled: false
    }
  },
  {
    id: "category-digital",
    key: "digital",
    name: "数码家电",
    icon: "monitor-smartphone",
    sortOrder: 50,
    fields: {
      enabled: ["model", "serialNumber", "warrantyUntil", "purchasePrice"],
      required: [],
      defaultUnit: "件",
      expirationEnabled: false
    }
  },
  {
    id: "category-clothing",
    key: "clothing",
    name: "换季收纳",
    icon: "shirt",
    sortOrder: 60,
    fields: {
      enabled: ["size", "color", "material"],
      required: [],
      defaultUnit: "件",
      expirationEnabled: false
    }
  },
  {
    id: "category-other",
    key: "other",
    name: "其他",
    icon: "package",
    sortOrder: 99,
    fields: {
      enabled: ["notes"],
      required: [],
      defaultUnit: "件",
      expirationEnabled: false
    }
  }
] as const;
