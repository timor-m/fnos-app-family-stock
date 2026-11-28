import { defineEventHandler,readBody } from 'h3';
import {syncAgentListener} from '../../../services/agent-listener.service';
import { agentSettings, updateAgentSettings } from '../../../services/agent-access.service';
import { agentManagementUser } from '../../../utils/agent-management';
import { ok } from '../../../utils/api-response';
export default defineEventHandler(async event=>{const user=agentManagementUser(event);const previous=agentSettings();const settings=updateAgentSettings(user,await readBody(event)||{});try{await syncAgentListener();}catch(error){updateAgentSettings(user,previous);await syncAgentListener().catch(()=>{});throw error;}return ok(settings);});
