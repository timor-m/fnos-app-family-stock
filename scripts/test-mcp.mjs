#!/usr/bin/env node
// Isolated real HTTP + official MCP client test. Never uses the developer or NAS database.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {DatabaseSync} from 'node:sqlite';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const storage=mkdtempSync(join(tmpdir(),'stock-mcp-test-'));
const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
const base=`http://127.0.0.1:${port}/app/fnos-app-family-stock`,endpoint=`${base}/mcp`;
const listenerReservation=createServer();await new Promise(resolve=>listenerReservation.listen(0,'127.0.0.1',resolve));const listenerPort=listenerReservation.address().port;await new Promise(resolve=>listenerReservation.close(resolve));
let serverOutput='',db;const clients=[];
const child=spawn(process.execPath,['scripts/start.mjs'],{cwd:process.cwd(),env:{...process.env,NODE_ENV:'development',PORT:String(port),STORAGE_DIR:storage,LOG_DIR:join(storage,'logs'),FNOS_SOCKET_PATH:'',VITE_DEV_SERVER_URL:'',OCR_POLL_INTERVAL_MS:'60000'},stdio:['ignore','pipe','pipe']});
child.stdout.on('data',chunk=>serverOutput+=chunk);child.stderr.on('data',chunk=>serverOutput+=chunk);
async function api(path,method='GET',body,headers={}){const response=await fetch(`${base}/api/${path}`,{method,headers:{'content-type':'application/json',origin:new URL(base).origin,...headers},body:body===undefined?undefined:JSON.stringify(body)});const payload=await response.json();return {status:response.status,data:payload.data,payload};}
async function grant(name,scopes=['inventory:read','history:read','inventory:propose'],familyId='default-family'){const result=await api('agent/grants','POST',{name,scopes,familyId,days:7});assert.equal(result.status,200);return result.data;}
async function connect(token){const client=new Client({name:'family-stock-integration-test',version:'1.0.0'});await client.connect(new StreamableHTTPClientTransport(new URL(endpoint),{requestInit:{headers:{Authorization:`Bearer ${token}`}}}));clients.push(client);return client;}
async function call(client,name,args={}){return client.callTool({name,arguments:args});}
function data(result){assert.equal(result.isError,undefined,JSON.stringify(result.content));return result.structuredContent;}
async function approved(operation){const res=await api(`agent/operations/${operation.operationId}`,'POST',{approve:true});assert.equal(res.status,200,JSON.stringify(res.payload));return res.data;}
try {
 await new Promise((resolve,reject)=>{const deadline=setTimeout(()=>reject(Error(serverOutput)),15000);const check=()=>{if(serverOutput.includes('Nitro listening')){clearTimeout(deadline);resolve();}else setTimeout(check,30);};check();});
 assert.equal((await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,401);
 assert.equal((await api('agent/settings')).data.enabled,false);
 assert.equal((await api('agent/settings','PUT',{enabled:true,publicUrl:endpoint,listenPort:listenerPort})).status,200);
 const owner=await grant('实例测试助手'),client=await connect(owner.token);
 db=new DatabaseSync(join(storage,'db/family-stock.sqlite'));
 assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 assert.equal(JSON.stringify(db.prepare('SELECT * FROM agent_grants').all()).includes(owner.token),false);
 const listed=await client.listTools();assert.equal(listed.tools.length,8);
 assert.match(listed.tools.find(tool=>tool.name==='get_inventory_history').description,/ISO 8601 UTC/);
 assert.match(listed.tools.find(tool=>tool.name==='get_inventory_history').description,/Asia\/Shanghai/);
 const context=data(await call(client,'get_context'));assert.equal(context.family.id,'default-family');
 const categoryId=context.categories[0].id;
 const bad=await call(client,'prepare_stock_in',{requestId:'invalid',name:'牛奶',categoryId,locationId:'default-location',quantity:1,unit:'盒',userId:'forged'});assert.equal(bad.isError,true);
 const input={requestId:'milk-1',name:'MCP 测试牛奶',categoryId,locationId:'default-location',quantity:6,unit:'盒',expirationDate:'2026-12-01'};
 const prepared=data(await call(client,'prepare_stock_in',input));assert.equal(prepared.status,'pending');assert.match(prepared.confirmationUrl,/me\/agent\?operation=/);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM inventory_batches').get().n,0);
 assert.equal(data(await call(client,'prepare_stock_in',input)).operationId,prepared.operationId);
 assert.equal((await call(client,'prepare_stock_in',{...input,quantity:7})).isError,true);
 const first=await approved(prepared);assert.equal(first.status,'completed');assert.equal((await approved(prepared)).result.batchId,first.result.batchId);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM inventory_transactions').get().n,1);
 const batchId=first.result.batchId,item=data(await call(client,'get_inventory_item',{batchId}));assert.equal(item.quantity,6);
 assert.equal(data(await call(client,'search_inventory',{query:'测试牛奶'})).items.length,1);
 assert.equal(data(await call(client,'get_inventory_history',{batchId})).items.length,1);
 const originalHistoryTime=db.prepare('SELECT occurred_at FROM inventory_transactions WHERE batch_id=?').get(batchId).occurred_at;
 const timestampCases=[
  ['2026-11-28 12:37:06','2026-11-28T12:37:06.000Z','2026-11-28 20:37:06'],
  ['2026-11-28T12:37:06.123Z','2026-11-28T12:37:06.123Z','2026-11-28 20:37:06'],
  ['2026-11-28T20:37:06+08:00','2026-11-28T12:37:06.000Z','2026-11-28 20:37:06'],
  ['2026-11-28 23:45:00','2026-11-28T23:45:00.000Z','2026-11-29 07:45:00'],
  ['not-a-date',null,null]
 ];
 for(const [stored,iso,shanghai] of timestampCases){
  db.prepare('UPDATE inventory_transactions SET occurred_at=? WHERE batch_id=?').run(stored,batchId);
  const history=data(await call(client,'get_inventory_history',{batchId}));
  assert.equal(history.timeZone,'Asia/Shanghai');assert.equal(history.items[0].occurredAt,iso);
  if(iso)assert.equal(new Intl.DateTimeFormat('sv-SE',{timeZone:history.timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(history.items[0].occurredAt)),shanghai);
  assert.equal(db.prepare('SELECT occurred_at FROM inventory_transactions WHERE batch_id=?').get(batchId).occurred_at,stored);
 }
 db.prepare('UPDATE inventory_transactions SET occurred_at=? WHERE batch_id=?').run(originalHistoryTime,batchId);

 const beforeFailure=data(await call(client,'get_inventory_item',{batchId}));
 const failOp=data(await call(client,'prepare_stock_operation',{requestId:'failure-injection',batchId,expectedVersion:beforeFailure.version,operationType:'consume',quantity:1,reason:'test-rollback'}));
 db.exec("CREATE TRIGGER test_abort_transaction BEFORE INSERT ON inventory_transactions WHEN NEW.reason='test-rollback' BEGIN SELECT RAISE(ABORT,'injected failure'); END;");
 assert.equal((await api(`agent/operations/${failOp.operationId}`,'POST',{approve:true})).status,500);
 assert.equal(data(await call(client,'get_inventory_item',{batchId})).quantity,6);
 assert.equal(data(await call(client,'get_operation',{operationId:failOp.operationId})).status,'pending');
 db.exec('DROP TRIGGER test_abort_transaction');
 await api(`agent/operations/${failOp.operationId}`,'POST',{approve:false});
 const read=await grant('只读助手',['inventory:read']),readClient=await connect(read.token);assert.equal((await readClient.listTools()).tools.length,4);
 assert.equal((await call(readClient,'prepare_stock_in',input)).isError,true);
 const consume={requestId:'consume-1',batchId,expectedVersion:item.version,operationType:'consume',quantity:1};
 const consumeOp=data(await call(client,'prepare_stock_operation',consume));
 db.prepare('UPDATE inventory_batches SET current_quantity=5 WHERE id=?').run(batchId);
 assert.ok(db.prepare('SELECT version FROM inventory_batches WHERE id=?').get(batchId).version>item.version);
 assert.equal((await approved(consumeOp)).status,'conflict');assert.equal(data(await call(client,'get_inventory_item',{batchId})).quantity,5);
 const current=data(await call(client,'get_inventory_item',{batchId}));
 const next=data(await call(client,'prepare_stock_operation',{...consume,requestId:'consume-2',expectedVersion:current.version}));
 assert.equal((await approved(next)).result.currentQuantity,4);await approved(next);assert.equal(data(await call(client,'get_inventory_item',{batchId})).quantity,4);
 assert.ok(Array.isArray(data(await call(client,'list_expiring_inventory',{withinDays:30,includeExpired:true})).items));
 db.prepare("INSERT INTO locations(id,family_id,name,kind,is_default) VALUES('test-kitchen','default-family','测试厨房','home',0)").run();
 const beforeTransfer=data(await call(client,'get_inventory_item',{batchId}));
 const transfer=data(await call(client,'prepare_stock_operation',{requestId:'transfer-1',batchId,expectedVersion:beforeTransfer.version,operationType:'transfer',quantity:1,toLocationId:'test-kitchen'}));
 assert.equal(transfer.summary.displayName,'MCP 测试牛奶');assert.equal(transfer.summary.unit,'盒');
 const moved=await approved(transfer);assert.equal(moved.result.currentQuantity,3);assert.ok(moved.result.destinationBatchId);
 const beforeDiscard=data(await call(client,'get_inventory_item',{batchId}));
 const discarded=data(await call(client,'prepare_stock_operation',{requestId:'discard-1',batchId,expectedVersion:beforeDiscard.version,operationType:'discard',quantity:1,reason:'测试丢弃'}));
 assert.equal((await approved(discarded)).result.currentQuantity,2);
 db.prepare("INSERT INTO families(id,name,owner_user_id) VALUES('other-family','其他家庭','local-owner')").run();
 db.prepare("INSERT INTO family_members(family_id,user_id,role) VALUES('other-family','local-owner','owner')").run();
 const other=await grant('隔离助手',['inventory:read','inventory:propose'],'other-family'),otherClient=await connect(other.token);
 assert.equal((await call(otherClient,'get_inventory_item',{batchId})).isError,true);
 assert.equal((await call(otherClient,'get_operation',{operationId:prepared.operationId})).isError,true);
 assert.equal((await api('agent/settings','GET',undefined,{Authorization:`Bearer ${owner.token}`})).status,403);
 assert.equal((await fetch(endpoint,{method:'POST',headers:{Authorization:`Bearer ${owner.token}`,origin:'https://untrusted.invalid','content-type':'application/json'},body:'{}'})).status,403);
 assert.equal((await api(`agent/grants/${read.id}`,'DELETE')).status,200);
 assert.equal((await fetch(endpoint,{method:'POST',headers:{Authorization:`Bearer ${read.token}`,'content-type':'application/json'},body:'{}'})).status,401);
 db.prepare('DELETE FROM family_members WHERE family_id=? AND user_id=?').run('other-family','local-owner');
 assert.equal((await fetch(endpoint,{method:'POST',headers:{Authorization:`Bearer ${other.token}`,'content-type':'application/json'},body:'{}'})).status,401);
 const expired=await grant('过期助手',['inventory:read']);
 db.prepare('UPDATE agent_grants SET expires_at=? WHERE id=?').run('2000-01-01T00:00:00Z',expired.id);
 assert.equal((await fetch(endpoint,{method:'POST',headers:{Authorization:`Bearer ${expired.token}`,'content-type':'application/json'},body:'{}'})).status,401);
 assert.equal((await fetch(`${base}/api/agent/grants`,{method:'POST',headers:{'content-type':'application/json',origin:'https://untrusted.invalid'},body:JSON.stringify({name:'forged',familyId:'default-family'})})).status,403);
 const rejected=data(await call(client,'prepare_stock_in',{...input,requestId:'rejected-stock'}));
 assert.equal((await api(`agent/operations/${rejected.operationId}`,'POST',{approve:false})).data.status,'rejected');
 assert.equal((await approved(rejected)).status,'rejected');
 assert.equal((await call(client,'prepare_stock_in',{...input,requestId:'rate-limited-stock'})).isError,true);
 db.prepare('UPDATE agent_call_logs SET created_at=? WHERE grant_id=?').run(new Date(Date.now()-61000).toISOString(),owner.id);
 const expiredOp=data(await call(client,'prepare_stock_in',{...input,requestId:'expired-stock'}));
 db.prepare('UPDATE agent_operations SET expires_at=? WHERE id=?').run('2000-01-01T00:00:00Z',expiredOp.operationId);
 assert.equal((await api(`agent/operations/${expiredOp.operationId}`,'POST',{approve:true})).status,409);
 const revokedOp=data(await call(client,'prepare_stock_in',{...input,requestId:'revoked-stock'}));
 assert.equal((await api(`agent/grants/${owner.id}`,'DELETE')).status,200);
 assert.equal((await api(`agent/operations/${revokedOp.operationId}`,'POST',{approve:true})).status,401);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM inventory_transactions').get().n,5);
 const logPage=(await api('agent/logs?limit=2')).data;assert.equal(logPage.items.length,2);assert.ok(logPage.total>2);assert.equal(logPage.hasMore,true);
 const secondPage=(await api('agent/logs?limit=2&offset=2')).data;assert.notEqual(secondPage.items[0].id,logPage.items[0].id);
 const failures=(await api('agent/logs?status=failed')).data;assert.ok(failures.items.length>0);assert.ok(failures.items.every(row=>row.status==='failed'));
 assert.equal((await api('agent/logs?limit=200')).status,400);
 assert.ok((await api('agent/logs?search=%E5%AE%9E%E4%BE%8B')).data.items.every(row=>row.agentName.includes('实例')));
 assert.equal((await api('agent/settings')).data.logs,undefined);
 const logs=(await api('agent/logs')).data.items;assert.ok(logs.length>0);assert.equal(JSON.stringify(logs).includes(owner.token),false);
 const enabled=await grant('停用验证助手',['inventory:read']);await connect(enabled.token);
 assert.equal((await api('agent/settings','PUT',{enabled:false,publicUrl:endpoint})).status,200);
 assert.equal((await fetch(endpoint,{method:'POST',headers:{Authorization:`Bearer ${enabled.token}`,'content-type':'application/json'},body:'{}'})).status,401);
 console.log('PASS: official MCP client initialization, 8 tools, hashed tokens, isolated family/scopes, pending confirmation, idempotency, version conflict, stock-in/consume/transfer/discard, expired/rejected operations, audit, origin, revocation, membership change and global disable.');
} catch(error) {console.error(error);console.error(serverOutput.slice(-3500));process.exitCode=1;}
finally {for(const client of clients)await client.close().catch(()=>{});db?.close();child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));rmSync(storage,{recursive:true,force:true});}
