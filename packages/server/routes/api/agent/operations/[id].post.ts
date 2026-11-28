import { defineEventHandler,getRouterParam,readBody,createError } from 'h3';
import { decideAgentOperation } from '../../../../services/agent-tools.service';
import { agentManagementUser } from '../../../../utils/agent-management';
import { ok } from '../../../../utils/api-response';
export default defineEventHandler(async event=>{const user=agentManagementUser(event),body=await readBody(event);if(typeof body?.approve!=='boolean')throw createError({statusCode:400,statusMessage:'请选择确认或拒绝'});return ok(decideAgentOperation(user,getRouterParam(event,'id')||'',body.approve));});
