import { defineEventHandler } from 'h3';
import {agentListenerStatus} from '../../../services/agent-listener.service';
import { agentSettings, listAgentGrants } from '../../../services/agent-access.service';
import { listAgentOperations } from '../../../services/agent-tools.service';
import { agentManagementUser } from '../../../utils/agent-management';
import { ok } from '../../../utils/api-response';
export default defineEventHandler(event=>{const user=agentManagementUser(event);return ok({...agentSettings(),listener:agentListenerStatus(),grants:listAgentGrants(user),operations:listAgentOperations(user),canManage:user.isGatewayAdmin||(!user.isGatewayAuthenticated&&user.id==='local-owner')});});
