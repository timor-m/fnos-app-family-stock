import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
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

  database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA busy_timeout = 5000");
  migrate(database);
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
