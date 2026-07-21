import { defineEventHandler } from "h3";
import { listCategories } from "../../services/catalog.service";
import { ok } from "../../utils/api-response";

export default defineEventHandler(() => ok(listCategories()));
