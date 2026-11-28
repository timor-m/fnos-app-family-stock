import { defineEventHandler,getRouterParam } from 'h3';
import { revokeAgentGrant } from '../../../../services/agent-access.service';
import { agentManagementUser } from '../../../../utils/agent-management';
import { ok } from '../../../../utils/api-response';
export default defineEventHandler(event=>ok(revokeAgentGrant(agentManagementUser(event),getRouterParam(event,'id')||'')));
