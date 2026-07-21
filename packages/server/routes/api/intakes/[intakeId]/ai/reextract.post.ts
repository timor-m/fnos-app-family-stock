import { defineEventHandler, getRouterParam, setResponseStatus } from "h3";
import { reextractIntakeAi } from "../../../../../services/intake.service";
import { ok } from "../../../../../utils/api-response";
import { getRequestUser } from "../../../../../utils/request-user";

export default defineEventHandler((event) => {
  const result = reextractIntakeAi(getRequestUser(event), getRouterParam(event, "intakeId") || "");
  setResponseStatus(event, 202);
  return ok(result);
});
