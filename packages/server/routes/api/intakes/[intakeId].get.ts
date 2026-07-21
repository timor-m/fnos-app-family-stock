import { defineEventHandler, getRouterParam } from "h3";
import { getIntakeDetail } from "../../../services/intake.service";
import { ok } from "../../../utils/api-response";
import { getRequestUser } from "../../../utils/request-user";

export default defineEventHandler((event) => {
  return ok(getIntakeDetail(getRequestUser(event), getRouterParam(event, "intakeId") || ""));
});
