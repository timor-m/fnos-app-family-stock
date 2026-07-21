import { createError, defineEventHandler, getQuery } from "h3";
import { listIntakeDrafts } from "../../services/intake.service";
import { ok } from "../../utils/api-response";
import { getRequestUser } from "../../utils/request-user";

export default defineEventHandler((event) => {
  const query = getQuery(event);
  const familyId = typeof query.familyId === "string" ? query.familyId : "";
  if (!familyId) {
    throw createError({ statusCode: 400, statusMessage: "familyId 不能为空" });
  }
  return ok(listIntakeDrafts(getRequestUser(event), familyId));
});
