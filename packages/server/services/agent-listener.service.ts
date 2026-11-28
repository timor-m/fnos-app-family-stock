import {createServer,type Server} from 'node:http';
import {createApp,toNodeHandler,defineEventHandler} from 'h3';
import {agentError,agentSettings} from './agent-access.service';
import {handleAgentMcp} from './agent-mcp.service';
import {getAppConfig} from '../utils/runtime-config';

let listener:Server|undefined,activeKey='',lastError='';
let work=Promise.resolve();
export function agentListenerStatus(){return {available:true,listening:Boolean(listener?.listening),host:activeKey.split(':').slice(0,-1).join(':')||null,port:listener?.listening?(listener.address() as {port:number}).port:null,error:lastError};}
function close(server:Server){return new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections();});}
async function synchronize(){
 const settings=agentSettings();
 const key=settings.enabled?`${settings.listenMode==='lan'?'0.0.0.0':'127.0.0.1'}:${settings.listenPort}`:'';
 if(key===activeKey&&(!key||listener?.listening))return;
 if(!key){const previous=listener;listener=undefined;activeKey='';lastError='';if(previous)await close(previous);return;}
 if(listener?.listening&&(listener.address() as {port:number}).port===settings.listenPort){const previous=listener;listener=undefined;activeKey='';await close(previous);}
 const app=createApp().use(defineEventHandler(event=>{
  // This listener exposes only MCP. It never forwards browser routes, APIs or gateway identity headers.
  const path=new URL(event.req.url).pathname;
  if(path!=='/mcp'&&path!==`${getAppConfig().gatewayPrefix}/mcp`)return new Response('Not Found',{status:404});
  return handleAgentMcp(event);
 }));
 const next=createServer(toNodeHandler(app));next.requestTimeout=15000;next.headersTimeout=10000;
 try{
  await new Promise<void>((resolve,reject)=>{next.once('error',reject);next.listen(settings.listenPort,settings.listenMode==='lan'?'0.0.0.0':'127.0.0.1',()=>{next.removeListener('error',reject);resolve();});});
 }catch(error){lastError=error instanceof Error&&'code' in error&&error.code==='EADDRINUSE'?'MCP 端口已占用，请更换端口':'MCP 独立服务启动失败';agentError(lastError,409);}
 const previous=listener;listener=next;activeKey=key;lastError='';next.on('error',()=>{lastError='MCP 独立服务发生错误，请重新保存配置';});if(previous)await close(previous);
}
export function syncAgentListener(){const next=work.then(synchronize);work=next.catch(()=>{});return next;}

export function closeAgentListener(){return work.then(async()=>{const previous=listener;listener=undefined;activeKey='';if(previous)await close(previous);});}
