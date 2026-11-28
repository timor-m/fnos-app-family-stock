import { defineEventHandler,readBody,setResponseHeader } from 'h3';
import { createAgentGrant } from '../../../services/agent-access.service';
import { agentManagementUser } from '../../../utils/agent-management';
import { ok } from '../../../utils/api-response';
export default defineEventHandler(async event=>{const user=agentManagementUser(event);setResponseHeader(event,'cache-control','no-store');return ok(createAgentGrant(user,await readBody(event)||{}));});
