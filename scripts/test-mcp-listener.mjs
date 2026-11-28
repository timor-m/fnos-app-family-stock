#!/usr/bin/env node
// Exercise the fnOS Unix socket management plane and independent MCP TCP plane together.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {request} from 'node:http';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const local=process.argv.includes('--local')||process.argv.includes('--local-no-vite');
const managementReservation=createServer();await new Promise(resolve=>managementReservation.listen(0,'127.0.0.1',resolve));const managementPort=managementReservation.address().port;await new Promise(resolve=>managementReservation.close(resolve));
const devOrigin=`http://127.0.0.1:${managementPort+1}`;
const storage=mkdtempSync(join(tmpdir(),'stock-mcp-socket-')),socketPath=local?'':join(storage,'app.sock');
let output='',client,child,reserved;
function start(){output='';child=spawn(process.execPath,['scripts/start.mjs'],{cwd:process.cwd(),env:{...process.env,NODE_ENV:local?'development':'production',PORT:String(managementPort),NITRO_PORT:String(managementPort),WEB_PORT:String(managementPort+1),STORAGE_DIR:storage,LOG_DIR:join(storage,'logs'),FNOS_SOCKET_PATH:socketPath,VITE_DEV_SERVER_URL:local&&!process.argv.includes('--local-no-vite')?devOrigin:''},stdio:['ignore','pipe','pipe']});child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c);}
async function ready(){await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(output)),15000);const poll=()=>{if(output.includes(local?'Nitro listening':'fnOS gateway socket listening')){clearTimeout(timer);resolve();}else if(child.exitCode!==null){clearTimeout(timer);reject(Error(output));}else setTimeout(poll,30);};poll();});}
start();
async function socketApi(path,method='GET',body,extraHeaders={}){return new Promise((resolve,reject)=>{const req=request({...(local?{hostname:'127.0.0.1',port:managementPort}:{socketPath}),path:`/app/fnos-app-family-stock/api/${path}`,method,headers:{host:local?`127.0.0.1:${managementPort}`:'gateway.local',origin:local?devOrigin:'https://gateway.local','x-trim-userid':'1000','x-trim-username':'test-user','x-trim-isadmin':'true','content-type':'application/json','x-family-stock-request':'1',...extraHeaders}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>{try{resolve({status:res.statusCode,...JSON.parse(text)});}catch{reject(Error(text));}});});req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));});}
try{
 await ready();
 assert.equal((await socketApi('agent/settings')).data.listener.listening,false);
 assert.equal((await socketApi('agent/settings')).data.listener.available,true);
 if(!local)assert.equal((await socketApi('agent/settings','PUT',{enabled:false},{'x-family-stock-request':''})).status,403);
 assert.equal((await socketApi('agent/settings','PUT',{enabled:false},{'sec-fetch-site':'cross-site'})).status,403);
 if(local)assert.equal((await socketApi('agent/settings','PUT',{enabled:false},{origin:'https://cross-site.invalid','x-forwarded-host':'cross-site.invalid'})).status,403);
 if(!local)assert.equal((await socketApi('agent/settings','PUT',{enabled:false},{host:'internal-gateway.local',origin:'https://browser-gateway.test','sec-fetch-site':'same-origin'})).status,200);

 const family=(await socketApi('families','POST',{name:'MCP 隔离家庭'})).data;
 reserved=createServer();await new Promise(resolve=>reserved.listen(0,'127.0.0.1',resolve));const port=reserved.address().port;
 const endpoint=`http://127.0.0.1:${port}/mcp`,consoleUrl='https://nas.test/app/fnos-app-family-stock';
 const config={enabled:true,publicUrl:endpoint,consoleUrl,listenMode:'local',listenPort:port};
 assert.equal((await socketApi('agent/settings','PUT',config)).status,409);
 assert.equal((await socketApi('agent/settings')).data.enabled,false);
 await new Promise(resolve=>reserved.close(resolve));
 assert.equal((await socketApi('agent/settings','PUT',config)).status,200);
 const state=(await socketApi('agent/settings')).data;assert.equal(state.listener.listening,true);assert.equal(state.listener.port,port);assert.equal(state.listener.host,'127.0.0.1');
 assert.equal((await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,401);
 const issued=(await socketApi('agent/grants','POST',{name:'同机测试助手',familyId:family.familyId,scopes:['inventory:read','inventory:propose'],days:7})).data;
 client=new Client({name:'fnos-direct-listener-test',version:'1.0.0'});await client.connect(new StreamableHTTPClientTransport(new URL(endpoint),{requestInit:{headers:{Authorization:`Bearer ${issued.token}`}}}));
 assert.equal((await client.listTools()).tools.length,7);
 const context=(await client.callTool({name:'get_context',arguments:{}})).structuredContent;assert.equal(context.family.id,family.familyId);
 if(process.argv.includes('--codex')){
  const issuedRead=(await socketApi('agent/grants','POST',{name:'Codex 独立端口只读验收',familyId:family.familyId,scopes:['inventory:read'],days:7})).data;
  let raw='';const args=['exec','--ephemeral','--ignore-user-config','--skip-git-repo-check','-C',storage,'-s','read-only','-c','approval_policy="never"','-c',`mcp_servers.family_stock_test={url="${endpoint}",bearer_token_env_var="FAMILY_STOCK_MCP_TEST_TOKEN",required=true}`,'--json'];
  if(process.env.CODEX_TEST_CREDENTIALS_STORE)args.push('-c',`cli_auth_credentials_store=${JSON.stringify(process.env.CODEX_TEST_CREDENTIALS_STORE)}`);
  args.push('仅用 family_stock_test MCP，真实调用 get_context、search_inventory（query=牛奶）、list_expiring_inventory。禁止 shell、文件修改、其他 MCP 或模拟结果。只报告连接的家庭、三个工具是否成功及结果数量，不要输出凭据。');
  console.log(`CODEX: connecting directly to independent MCP ${endpoint}`);
  const codex=spawn(process.env.CODEX_BIN||'codex',args,{env:{...process.env,FAMILY_STOCK_MCP_TEST_TOKEN:issuedRead.token},stdio:['ignore','pipe','pipe']});codex.stdout.on('data',c=>raw+=c);codex.stderr.on('data',c=>raw+=c);
  const timer=setTimeout(()=>codex.kill('SIGTERM'),180000);const code=await new Promise((resolve,reject)=>{codex.once('exit',resolve);codex.once('error',reject);});clearTimeout(timer);
  await socketApi('agent/grants/'+issuedRead.id,'DELETE');
  const safe=raw.replaceAll(issuedRead.token,'[REDACTED]');assert.equal(code,0,safe.slice(-2000));
  const events=safe.split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
  const calls=events.filter(e=>e.type==='item.completed'&&e.item?.type==='mcp_tool_call').map(e=>e.item);
  for(const tool of ['get_context','search_inventory','list_expiring_inventory'])assert.ok(calls.some(c=>c.server==='family_stock_test'&&c.tool===tool&&c.status==='completed'&&!c.error));
  assert.ok(calls.every(c=>c.status==='completed'&&!c.error));
  const evidence={passed:true,isolated:true,mode:local?'local':'fnos',endpoint,tools:calls.map(c=>c.tool),codexExitCode:code,temporaryGrantRevoked:true,answer:events.filter(e=>e.type==='item.completed'&&e.item?.type==='agent_message').at(-1)?.item.text};
  if(process.env.CODEX_TEST_EVIDENCE_PATH)writeFileSync(process.env.CODEX_TEST_EVIDENCE_PATH,JSON.stringify(evidence,null,2),{mode:0o600});
  console.log('CODEX_PASS '+JSON.stringify(evidence));
 }

 const prepared=await client.callTool({name:'prepare_stock_in',arguments:{requestId:'socket-stock',categoryId:context.categories[0].id,locationId:family.locationId,name:'隔离测试物品',quantity:1,unit:'件'}});
 assert.equal(prepared.structuredContent.status,'pending');assert.ok(prepared.structuredContent.confirmationUrl.startsWith(consoleUrl+'/me/agent?'));
 const headers={Authorization:`Bearer ${issued.token}`,'x-trim-userid':'1000','x-trim-isadmin':'true',Cookie:'pretend-session'};
 for(const path of ['/app/fnos-app-family-stock/api/agent/settings','/api/agent/settings','/app/fnos-app-family-stock/me/agent','/me/agent'])assert.equal((await fetch(new URL(path,endpoint),{headers})).status,404);
 assert.equal((await socketApi('agent/settings','PUT',{...config,listenMode:'lan'})).status,200);
 assert.equal((await socketApi('agent/settings')).data.listener.host,'0.0.0.0');
 assert.equal((await client.callTool({name:'get_context',arguments:{}})).structuredContent.family.id,family.familyId);
 await client.close();client=null;
 child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));start();await ready();
 // No gateway requests before these checks: the listener must restore on process startup alone.
 assert.equal((await fetch(endpoint,{method:'POST',body:'{}'})).status,401);
 client=new Client({name:'fnos-restart-test',version:'1.0.0'});await client.connect(new StreamableHTTPClientTransport(new URL(endpoint),{requestInit:{headers:{Authorization:`Bearer ${issued.token}`}}}));
 assert.equal((await client.callTool({name:'get_context',arguments:{}})).structuredContent.family.id,family.familyId);
 await client.close();client=null;
 assert.equal((await socketApi('agent/settings','PUT',{...config,enabled:false})).status,200);
 assert.equal((await socketApi('agent/settings')).data.listener.listening,false);
 await assert.rejects(fetch(endpoint),/fetch failed/);
 console.log(`PASS: ${local?'local HTTP + dev frontend Origin':'fnOS Unix socket'} + independent MCP TCP, authenticated official client, separate approval URL, occupied port rollback, local/LAN switch, startup restore without browser request, private route isolation and disable shutdown.`);
}catch(error){console.error(error);console.error(output.slice(-3000));process.exitCode=1;}
finally{await client?.close().catch(()=>{});if(reserved?.listening)await new Promise(resolve=>reserved.close(resolve));if(child.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}rmSync(storage,{recursive:true,force:true});}
