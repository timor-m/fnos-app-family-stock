import {definePlugin} from 'nitro';
import {syncAgentListener,closeAgentListener} from '../services/agent-listener.service';

export default definePlugin(async app=>{
 app.hooks.hook('close',closeAgentListener);
 // Restore an enabled MCP listener at startup, without waiting for a browser request.
 await syncAgentListener().catch(error=>console.error(error instanceof Error?error.message:'MCP 启动失败'));
});
