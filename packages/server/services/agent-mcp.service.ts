import { defineEventHandler, assertBodySize } from "h3";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { agentSettings, authenticateAgent } from "./agent-access.service";
import { callAgentTool, listAgentTools } from "./agent-tools.service";

export const handleAgentMcp = defineEventHandler(async event=>{
 const settings=agentSettings(),origin=event.req.headers.get('origin');
 if(origin && (!settings.publicUrl || origin!==new URL(settings.publicUrl).origin)) return new Response('Origin is not allowed',{status:403});
 let grant;
 try {grant=authenticateAgent(event.req.headers.get('authorization'));}
 catch {return new Response(JSON.stringify({error:'invalid_token',error_description:'A valid, enabled family-scoped Bearer Token is required.'}),{status:401,headers:{'content-type':'application/json','www-authenticate':'Bearer realm="family-stock"','cache-control':'no-store'}});}
 if(event.req.method!=='POST') return new Response(null,{status:405,headers:{Allow:'POST'}});
 await assertBodySize(event,65536);
 const server=new Server({name:'family-stock',version:'1.0.0'},{capabilities:{tools:{}}});
 server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:listAgentTools(grant)}));
 server.setRequestHandler(CallToolRequestSchema,async request=>{
  try {const data=callAgentTool(grant,request.params.name,request.params.arguments||{});return {content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data};}
  catch(error) {return {isError:true,content:[{type:'text',text:error instanceof Error&&!("code" in error&&String(error.code).startsWith('ERR_SQLITE'))?error.message:'处理失败，请查看家藏运行日志'}]};}
 });
 const transport=new WebStandardStreamableHTTPServerTransport({enableJsonResponse:true});
 try {await server.connect(transport);const response=await transport.handleRequest(event.req);response.headers.set('cache-control','no-store');return response;}
 finally {await transport.close();await server.close();}
});

