import { defineEventHandler } from 'h3';
import { getRequestUser } from '../../utils/request-user';
import { ok } from '../../utils/api-response';
import { getAboutSummary } from '../../services/about.service';
export default defineEventHandler(event=>{getRequestUser(event);return ok(getAboutSummary());});
