import { defineEventHandler, readBody, setResponseStatus } from "h3";
import { createManualStockIn, parseManualStockInInput } from "../../../services/inventory.service";
import { ok } from "../../../utils/api-response";
import { getRequestUser } from "../../../utils/request-user";

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event);
  const input = parseManualStockInInput(body || {});
  const result = createManualStockIn(input, getRequestUser(event));
  setResponseStatus(event, 201);
  return ok(result);
});
