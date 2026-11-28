import {defineEventHandler,getQuery} from 'h3';
import {agentCallLogs} from '../../../services/agent-access.service';
import {agentManagementUser} from '../../../utils/agent-management';
import {ok} from '../../../utils/api-response';
export default defineEventHandler(event=>ok(agentCallLogs(agentManagementUser(event),getQuery(event))));
