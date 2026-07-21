import { getHeader, type H3Event } from "h3";

export type GatewayUser = {
  authenticated: boolean;
  uid: string | null;
  username: string | null;
  isAdmin: boolean;
};

export function getGatewayUser(event: H3Event): GatewayUser {
  if (!process.env.FNOS_SOCKET_PATH) {
    return {
      authenticated: false,
      uid: null,
      username: null,
      isAdmin: false
    };
  }

  const uid = getHeader(event, "x-trim-userid")?.trim() || null;
  const username = getHeader(event, "x-trim-username")?.trim() || null;
  const adminHeader = (getHeader(event, "x-trim-isadmin") || "").trim().toLowerCase();

  return {
    authenticated: Boolean(uid),
    uid,
    username,
    isAdmin: ["true", "1", "yes"].includes(adminHeader)
  };
}
