import { defineEventHandler, getRouterParam, readBody } from "h3";
import {
  parseInventoryBatchUpdateInput,
  updateInventoryBatchInfo
} from "../../../../services/inventory.service";
import { ok } from "../../../../utils/api-response";
import { getRequestUser } from "../../../../utils/request-user";

export default defineEventHandler(async (event) => {
  const batchId = getRouterParam(event, "batchId");
  const body = await readBody<Record<string, unknown>>(event);
  const input = parseInventoryBatchUpdateInput(body || {});
  return ok(updateInventoryBatchInfo(batchId || "", input, getRequestUser(event)));
});
