import { defineEventHandler } from "h3";
import { listFamiliesForUser } from "../../services/catalog.service";
import { ok } from "../../utils/api-response";
import { getRequestUser } from "../../utils/request-user";

export default defineEventHandler((event) => ok(listFamiliesForUser(getRequestUser(event))));
