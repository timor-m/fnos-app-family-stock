import { createError } from "h3";
import { getDatabase } from "../database/client";
import { requireFamilyRole } from "../utils/access-control";
import { createId } from "../utils/identifier";
import type { RequestUser } from "../utils/request-user";

type CategoryRow = {
  id: string;
  key: string;
  name: string;
  icon: string;
  fieldsJson: string;
};

type FamilyRow = {
  id: string;
  name: string;
  role: string;
  memberCount: number;
};

type LocationRow = {
  id: string;
  familyId: string;
  name: string;
  kind: string;
  isDefault: number;
};

type FamilyMemberRow = {
  userId: string;
  displayName: string;
  role: "owner" | "admin" | "member";
  joinedAt: string;
};

function requiredName(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw createError({
      statusCode: 400,
      statusMessage: `${label}不能为空`
    });
  }

  const name = value.trim();
  if (name.length > 50) {
    throw createError({
      statusCode: 400,
      statusMessage: `${label}不能超过 50 个字符`
    });
  }
  return name;
}

function requiredUserId(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw createError({
      statusCode: 400,
      statusMessage: "用户 ID 不能为空"
    });
  }

  const userId = value.trim();
  if (userId.length > 80) {
    throw createError({
      statusCode: 400,
      statusMessage: "用户 ID 不能超过 80 个字符"
    });
  }
  return userId;
}

function memberRole(value: unknown) {
  return value === "admin" ? "admin" : "member";
}

function throwConflict(error: unknown, message: string): never {
  if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
    throw createError({
      statusCode: 409,
      statusMessage: message
    });
  }
  throw error;
}

export function listCategories() {
  const rows = getDatabase().prepare(`
    SELECT
      id,
      system_key AS key,
      name,
      icon,
      fields_json AS fieldsJson
    FROM category_templates
    ORDER BY sort_order, name
  `).all() as CategoryRow[];

  return rows.map((row) => ({
    id: row.id,
    key: row.key,
    name: row.name,
    icon: row.icon,
    fields: JSON.parse(row.fieldsJson)
  }));
}

export function listFamiliesForUser(user: RequestUser) {
  const db = getDatabase();
  const families = db.prepare(`
    SELECT
      f.id,
      f.name,
      fm.role,
      COUNT(all_members.user_id) AS memberCount
    FROM families f
    JOIN family_members fm
      ON fm.family_id = f.id AND fm.user_id = ?
    LEFT JOIN family_members all_members ON all_members.family_id = f.id
    GROUP BY f.id, f.name, fm.role
    ORDER BY f.created_at
  `).all(user.id) as FamilyRow[];

  const locations = db.prepare(`
    SELECT
      l.id,
      l.family_id AS familyId,
      l.name,
      l.kind,
      l.is_default AS isDefault
    FROM locations l
    JOIN family_members fm
      ON fm.family_id = l.family_id AND fm.user_id = ?
    ORDER BY l.is_default DESC, l.created_at
  `).all(user.id) as LocationRow[];

  return families.map((family) => ({
    id: family.id,
    name: family.name,
    role: family.role,
    memberCount: Number(family.memberCount),
    locations: locations
      .filter((location) => location.familyId === family.id)
      .map((location) => ({
        id: location.id,
        name: location.name,
        kind: location.kind,
        isDefault: Boolean(location.isDefault)
      }))
  }));
}

export function listFamilyMembers(user: RequestUser, familyId: string) {
  requireFamilyRole(user, familyId);
  const rows = getDatabase().prepare(`
    SELECT
      u.id AS userId,
      u.display_name AS displayName,
      fm.role,
      fm.joined_at AS joinedAt
    FROM family_members fm
    JOIN users u ON u.id = fm.user_id
    WHERE fm.family_id = ?
    ORDER BY
      CASE fm.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END,
      fm.joined_at
  `).all(familyId) as FamilyMemberRow[];

  return rows.map((row) => ({
    userId: row.userId,
    displayName: row.displayName,
    role: row.role,
    joinedAt: row.joinedAt
  }));
}

export function createFamily(user: RequestUser, nameValue: unknown) {
  const name = requiredName(nameValue, "家庭名称");
  const db = getDatabase();
  const familyId = createId("family");
  const locationId = createId("location");

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      INSERT INTO families (id, name, owner_user_id)
      VALUES (?, ?, ?)
    `).run(familyId, name, user.id);
    db.prepare(`
      INSERT INTO family_members (family_id, user_id, role)
      VALUES (?, ?, 'owner')
    `).run(familyId, user.id);
    db.prepare(`
      INSERT INTO locations (id, family_id, name, kind, is_default)
      VALUES (?, ?, '家中', 'home', 1)
    `).run(locationId, familyId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throwConflict(error, "该家庭已经存在");
  }

  return {
    familyId,
    locationId
  };
}

export function addFamilyMember(user: RequestUser, familyId: string, body: Record<string, unknown>) {
  requireFamilyRole(user, familyId);
  const userId = requiredUserId(body.userId);
  const displayName = typeof body.displayName === "string" && body.displayName.trim()
    ? requiredName(body.displayName, "成员昵称")
    : userId;
  const role = memberRole(body.role);
  const db = getDatabase();

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      INSERT INTO users (id, display_name)
      VALUES (?, ?)
      ON CONFLICT(id) DO UPDATE SET
        display_name = excluded.display_name,
        updated_at = CURRENT_TIMESTAMP
    `).run(userId, displayName);
    db.prepare(`
      INSERT INTO family_members (family_id, user_id, role)
      VALUES (?, ?, ?)
    `).run(familyId, userId, role);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throwConflict(error, "该成员已在当前家庭分组中");
  }

  return { familyId, userId, displayName, role };
}

export function removeFamilyMember(user: RequestUser, familyId: string, userIdValue: string) {
  requireFamilyRole(user, familyId);
  const userId = requiredUserId(userIdValue);
  const db = getDatabase();
  const member = db.prepare(`
    SELECT role
    FROM family_members
    WHERE family_id = ? AND user_id = ?
  `).get(familyId, userId) as { role: string } | undefined;

  if (!member) {
    throw createError({
      statusCode: 404,
      statusMessage: "成员不存在"
    });
  }
  if (member.role === "owner") {
    throw createError({
      statusCode: 409,
      statusMessage: "不能移除家庭所有者"
    });
  }

  db.prepare("DELETE FROM family_members WHERE family_id = ? AND user_id = ?").run(familyId, userId);
  return { familyId, userId };
}

export function renameFamily(user: RequestUser, familyId: string, nameValue: unknown) {
  requireFamilyRole(user, familyId);
  const name = requiredName(nameValue, "家庭名称");
  getDatabase().prepare(`
    UPDATE families
    SET name = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(name, familyId);
  return { familyId, name };
}

export function createLocation(user: RequestUser, familyId: string, body: Record<string, unknown>) {
  requireFamilyRole(user, familyId);
  const name = requiredName(body.name, "地点名称");
  const kind = typeof body.kind === "string" && body.kind.trim() ? body.kind.trim() : "home";
  const db = getDatabase();
  const locationId = createId("location");

  try {
    db.prepare(`
      INSERT INTO locations (id, family_id, name, kind, is_default)
      VALUES (?, ?, ?, ?, 0)
    `).run(locationId, familyId, name, kind);
  } catch (error) {
    throwConflict(error, "当前家庭中已存在同名地点");
  }

  return {
    locationId,
    familyId,
    name,
    kind
  };
}

export function renameLocation(user: RequestUser, locationId: string, nameValue: unknown) {
  const db = getDatabase();
  const location = db.prepare(`
    SELECT family_id AS familyId
    FROM locations
    WHERE id = ?
  `).get(locationId) as { familyId: string } | undefined;

  if (!location) {
    throw createError({
      statusCode: 404,
      statusMessage: "地点不存在"
    });
  }

  requireFamilyRole(user, location.familyId);
  const name = requiredName(nameValue, "地点名称");

  try {
    db.prepare(`
      UPDATE locations
      SET name = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(name, locationId);
  } catch (error) {
    throwConflict(error, "当前家庭中已存在同名地点");
  }

  return { locationId, name };
}

export function deleteLocation(user: RequestUser, locationId: string) {
  const db = getDatabase();
  const location = db.prepare(`
    SELECT family_id AS familyId, is_default AS isDefault
    FROM locations
    WHERE id = ?
  `).get(locationId) as { familyId: string; isDefault: number } | undefined;

  if (!location) {
    throw createError({
      statusCode: 404,
      statusMessage: "地点不存在"
    });
  }

  requireFamilyRole(user, location.familyId);
  const locationCount = db.prepare(`
    SELECT COUNT(*) AS count
    FROM locations
    WHERE family_id = ?
  `).get(location.familyId) as { count: number };
  const batchCount = db.prepare(`
    SELECT COUNT(*) AS count
    FROM inventory_batches
    WHERE location_id = ? AND current_quantity > 0
  `).get(locationId) as { count: number };

  if (Number(locationCount.count) <= 1) {
    throw createError({
      statusCode: 409,
      statusMessage: "家庭至少需要保留一个地点"
    });
  }
  if (Number(batchCount.count) > 0) {
    throw createError({
      statusCode: 409,
      statusMessage: "请先转移或清空该地点的库存"
    });
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM locations WHERE id = ?").run(locationId);
    if (location.isDefault) {
      db.prepare(`
        UPDATE locations
        SET is_default = 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = (
          SELECT id FROM locations WHERE family_id = ? ORDER BY created_at LIMIT 1
        )
      `).run(location.familyId);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return { locationId };
}
