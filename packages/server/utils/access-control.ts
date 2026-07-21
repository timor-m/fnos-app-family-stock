import { createError } from "h3";
import { getDatabase } from "../database/client";
import type { RequestUser } from "./request-user";

export type FamilyRole = "owner" | "admin" | "member";

export function getFamilyRole(user: RequestUser, familyId: string) {
  const membership = getDatabase().prepare(`
    SELECT role
    FROM family_members
    WHERE family_id = ? AND user_id = ?
  `).get(familyId, user.id) as { role: FamilyRole } | undefined;

  return membership?.role || null;
}

export function requireFamilyAccess(user: RequestUser, familyId: string) {
  const role = getFamilyRole(user, familyId);
  if (!role) {
    throw createError({
      statusCode: 404,
      statusMessage: "家庭不存在"
    });
  }
  return role;
}

export function requireFamilyRole(
  user: RequestUser,
  familyId: string,
  roles: FamilyRole[] = ["owner", "admin"]
) {
  const role = requireFamilyAccess(user, familyId);
  if (!user.isGatewayAdmin && !roles.includes(role)) {
    throw createError({
      statusCode: 403,
      statusMessage: "没有管理该家庭的权限"
    });
  }
  return role;
}

export function requireAppAdmin(user: RequestUser) {
  if (user.isGatewayAdmin || (!user.isGatewayAuthenticated && user.id === "local-owner")) {
    return;
  }

  throw createError({
    statusCode: 403,
    statusMessage: "仅管理员可以修改应用配置"
  });
}
