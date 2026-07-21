import type { H3Event } from "h3";
import { getDatabase } from "../database/client";
import { getGatewayUser } from "./gateway-user";

export type RequestUser = {
  id: string;
  displayName: string;
  isGatewayAuthenticated: boolean;
  isGatewayAdmin: boolean;
};

export function getRequestUser(event: H3Event): RequestUser {
  const gatewayUser = getGatewayUser(event);
  const id = gatewayUser.uid || "local-owner";
  const displayName = gatewayUser.username || (gatewayUser.uid ? gatewayUser.uid : "家庭管理员");

  getDatabase().prepare(`
    INSERT INTO users (id, display_name)
    VALUES (?, ?)
    ON CONFLICT(id) DO UPDATE SET
      display_name = excluded.display_name,
      updated_at = CURRENT_TIMESTAMP
  `).run(id, displayName);

  return {
    id,
    displayName,
    isGatewayAuthenticated: gatewayUser.authenticated,
    isGatewayAdmin: gatewayUser.isAdmin
  };
}
