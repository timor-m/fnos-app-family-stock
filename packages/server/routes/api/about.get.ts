import { defineEventHandler } from 'h3';
import { ok } from '../../utils/api-response';
import { getRequestUser } from '../../utils/request-user';
import { getAboutSummary } from '../../services/about.service';
export default defineEventHandler(event=>{getRequestUser(event);return ok(getAboutSummary());});
