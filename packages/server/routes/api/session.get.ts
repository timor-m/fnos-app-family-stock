import { defineEventHandler } from "h3";
import { ok } from "../../utils/api-response";
import { getRequestUser } from "../../utils/request-user";

export default defineEventHandler((event) => {
  const user = getRequestUser(event);
  return ok({
    authenticated: user.isGatewayAuthenticated,
    uid: user.id,
    username: user.displayName,
    isAdmin: user.isGatewayAdmin
  });
});
