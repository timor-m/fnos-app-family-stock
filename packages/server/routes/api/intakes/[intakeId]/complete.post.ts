import { defineEventHandler, getRouterParam, readBody } from "h3";
import { completeIntake } from "../../../../services/intake.service";
import { ok } from "../../../../utils/api-response";
import { getRequestUser } from "../../../../utils/request-user";

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    values?: Record<string, unknown>;
    acceptedCandidateIds?: unknown;
    rejectedCandidateIds?: unknown;
  }>(event);
  return ok(completeIntake(getRequestUser(event), getRouterParam(event, "intakeId") || "", body || {}));
});
