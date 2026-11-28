import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import metadata from "../../../package.json" with { type: "json" };
import { DatabaseSync } from "node:sqlite";
import { getAppConfig } from "../utils/runtime-config";
import { schemaSql, schemaVersion, systemCategories } from "./schema";

let database: DatabaseSync | null = null;

function ensureStorageDirectories(storageDir: string) {
  for (const directory of ["db", "images", "models", "backups", "logs"]) {
    mkdirSync(join(storageDir, directory), { recursive: true });
  }
}

function seedSystemData(db: DatabaseSync) {
  const insertCategory = db.prepare(`
    INSERT INTO category_templates (id, system_key, name, icon, fields_json, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(system_key) DO UPDATE SET
      name = excluded.name,
      icon = excluded.icon,
      fields_json = excluded.fields_json,
      sort_order = excluded.sort_order,
      updated_at = CURRENT_TIMESTAMP
  `);

  for (const category of systemCategories) {
    insertCategory.run(
      category.id,
      category.key,
      category.name,
      category.icon,
      JSON.stringify(category.fields),
      category.sortOrder
    );
  }

  db.prepare(`
    INSERT OR IGNORE INTO users (id, display_name)
    VALUES ('local-owner', '家庭管理员')
  `).run();
  db.prepare(`
    INSERT OR IGNORE INTO families (id, name, owner_user_id)
    VALUES ('default-family', '我的家庭', 'local-owner')
  `).run();
  db.prepare(`
    INSERT OR IGNORE INTO family_members (family_id, user_id, role)
    VALUES ('default-family', 'local-owner', 'owner')
  `).run();
  db.prepare(`
    INSERT OR IGNORE INTO locations (id, family_id, name, kind, is_default)
    VALUES ('default-location', 'default-family', '家中', 'home', 1)
  `).run();
}

function migrate(db: DatabaseSync) {
  db.exec(schemaSql);
  const operationColumns = db.prepare("PRAGMA table_info(agent_operations)").all() as Array<{name:string}>;
  if (!operationColumns.some(column => column.name === "snapshot_json")) db.exec("ALTER TABLE agent_operations ADD COLUMN snapshot_json TEXT NOT NULL DEFAULT '{}'");
  const batchColumns = db.prepare("PRAGMA table_info(inventory_batches)").all() as Array<{name:string}>;
  if (!batchColumns.some(column => column.name === "version")) db.exec("ALTER TABLE inventory_batches ADD COLUMN version INTEGER NOT NULL DEFAULT 1");
  db.exec(`CREATE TRIGGER IF NOT EXISTS inventory_batch_version AFTER UPDATE ON inventory_batches
    WHEN NEW.version = OLD.version BEGIN UPDATE inventory_batches SET version = OLD.version + 1 WHERE id = NEW.id; END;
    CREATE TRIGGER IF NOT EXISTS inventory_product_version AFTER UPDATE ON products
    BEGIN UPDATE inventory_batches SET version = version + 1 WHERE product_id = NEW.id; END;`);
  const draftColumns = db.prepare("PRAGMA table_info(intake_drafts)").all() as Array<{ name: string }>;
  if (!draftColumns.some((column) => column.name === "field_versions_json")) {
    db.exec("ALTER TABLE intake_drafts ADD COLUMN field_versions_json TEXT NOT NULL DEFAULT '{}'");
  }
  const productColumns = db.prepare("PRAGMA table_info(products)").all() as Array<{ name: string }>;
  if (!productColumns.some((column) => column.name === "ingredients")) {
    db.exec("ALTER TABLE products ADD COLUMN ingredients TEXT");
  }
  const mediaColumns = db.prepare("PRAGMA table_info(media_assets)").all() as Array<{ name: string }>;
  if (!mediaColumns.some((column) => column.name === "thumbnail_path")) {
    db.exec("ALTER TABLE media_assets ADD COLUMN thumbnail_path TEXT");
  }
  if (!mediaColumns.some((column) => column.name === "width")) {
    db.exec("ALTER TABLE media_assets ADD COLUMN width INTEGER");
  }
  if (!mediaColumns.some((column) => column.name === "height")) {
    db.exec("ALTER TABLE media_assets ADD COLUMN height INTEGER");
  }
  const current = db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as
    | { version: number | null }
    | undefined;

  if ((current?.version ?? 0) < schemaVersion) {
    db.prepare("INSERT INTO schema_migrations (version) VALUES (?)").run(schemaVersion);
  }

  seedSystemData(db);
}

export function getDatabase() {
  if (database) {
    return database;
  }

  const config = getAppConfig();
  ensureStorageDirectories(config.storageDir);
  const databasePath = join(config.storageDir, "db", "family-stock.sqlite");
  mkdirSync(dirname(databasePath), { recursive: true });

  const existing = existsSync(databasePath);
  const db = new DatabaseSync(databasePath);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    if (existing && process.env.NODE_ENV === "production") {
      const backup = join(config.storageDir, "backups", `before-update-${metadata.version}.sqlite`);
      if (!existsSync(backup)) { db.prepare("VACUUM INTO ?").run(backup); chmodSync(backup, 0o600); }
    }
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA journal_mode = WAL");
    migrate(db);
    database = db;
  } catch (error) { db.close(); throw error; }

  return database;
}

export function getDatabaseStatus() {
  const config = getAppConfig();
  const db = getDatabase();
  const result = db.prepare("PRAGMA integrity_check").get() as { integrity_check: string };

  return {
    driver: "node:sqlite",
    path: join(config.storageDir, "db", "family-stock.sqlite"),
    integrity: result.integrity_check,
    schemaVersion
  };
}
