import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createError } from "h3";
import { isIP } from "node:net";
import { getAppConfig } from "../utils/runtime-config";
import { getDatabase } from "../database/client";
import { getFamilyRole, requireAppAdmin, requireFamilyAccess } from "../utils/access-control";
import type { RequestUser } from "../utils/request-user";

export const agentScopes = ["inventory:read", "history:read", "inventory:propose"] as const;
export type AgentGrant = { id:string; userId:string; familyId:string; name:string; scopesJson:string; expiresAt:string; revokedAt:string|null; userName:string };
const grantSelect = `SELECT g.id,g.user_id AS userId,g.family_id AS familyId,g.name,g.scopes_json AS scopesJson,
 g.expires_at AS expiresAt,g.revoked_at AS revokedAt,u.display_name AS userName FROM agent_grants g JOIN users u ON u.id=g.user_id`;
export function agentError(message:string,statusCode=400):never { throw createError({statusCode,statusMessage:message}); }
export function tokenHash(value:string) { return createHash("sha256").update(value).digest("hex"); }
export function grantUser(grant:AgentGrant):RequestUser { return {id:grant.userId,displayName:grant.userName,isGatewayAuthenticated:true,isGatewayAdmin:false}; }
export function agentSettings() {
 const row=getDatabase().prepare("SELECT value_json AS value FROM app_settings WHERE setting_key='agent.access'").get() as {value:string}|undefined;
 const stored=row?JSON.parse(row.value):{};
 return {enabled:stored.enabled===true,publicUrl:stored.publicUrl||"",consoleUrl:stored.consoleUrl||"",listenMode:stored.listenMode==='lan'?'lan':'local',listenPort:Number(stored.listenPort||3335)};
}
export function updateAgentSettings(user:RequestUser,body:Record<string,unknown>) {
 requireAppAdmin(user);
 const previous=agentSettings();
 const publicUrl=String(body.publicUrl||"").trim().replace(/\/$/,"");
 const listenMode=body.listenMode===undefined?previous.listenMode:body.listenMode;
 const listenPort=body.listenPort===undefined?previous.listenPort:Number(body.listenPort);
 if(!['local','lan'].includes(String(listenMode))||!Number.isInteger(listenPort)||listenPort<1024||listenPort>65535) agentError("请选择有效的访问范围和端口（1024–65535）");
 const consoleUrl=String(body.consoleUrl===undefined?(previous.consoleUrl||publicUrl.replace(/\/mcp$/,'')):body.consoleUrl).trim().replace(/\/$/,'');
 for(const [value,kind] of [[publicUrl,'mcp'],[consoleUrl,'console']]) {
  if(!value) continue;
  try {
   const url=new URL(value),host=url.hostname.replace(/^\[|\]$/g,'');
   const privateV4=isIP(host)===4&&(/^(127\.|10\.|192\.168\.)/.test(host)||/^172\.(1[6-9]|2\d|3[01])\./.test(host));
   const privateV6=isIP(host)===6&&(/^(fc|fd|fe80:)/i.test(host)||host==='::1');
   if(url.username||url.password||url.search||url.hash||!['http:','https:'].includes(url.protocol)||(url.protocol==='http:'&&host!=='localhost'&&!privateV4&&!privateV6)||(kind==='mcp'&&!url.pathname.endsWith('/mcp'))||(kind==='console'&&url.pathname!==getAppConfig().gatewayPrefix)) throw Error();
  } catch {agentError("MCP 地址需以 /mcp 结尾；确认页面需为家藏入口。HTTP 仅支持本机或私有 IP，公网需 HTTPS");}
 }
 if(body.enabled===true&&(!publicUrl||!consoleUrl)) agentError("请先配置 MCP 和家藏确认页面地址");
 getDatabase().prepare("INSERT INTO app_settings(setting_key,value_json) VALUES('agent.access',?) ON CONFLICT(setting_key) DO UPDATE SET value_json=excluded.value_json").run(JSON.stringify({enabled:body.enabled===true,publicUrl,consoleUrl,listenMode,listenPort}));
 return agentSettings();
}
export function checkGrant(grant:AgentGrant) {
 grant=getAgentGrant(grant.id);
 if(!agentSettings().enabled || grant.revokedAt || Date.parse(grant.expiresAt)<=Date.now() || !getFamilyRole(grantUser(grant),grant.familyId)) agentError("授权已停用、撤销、到期或不再拥有家庭权限",401);
 return grant;
}
export function getAgentGrant(id:string) {
 const row=getDatabase().prepare(`${grantSelect} WHERE g.id=?`).get(id) as AgentGrant|undefined;
 if(!row) agentError("授权不存在",404); return row;
}
export function authenticateAgent(header:string|null) {
 if(!header || !/^Bearer [A-Za-z0-9_-]{40,200}$/i.test(header)) agentError("请使用有效的 Bearer Token",401);
 const row=getDatabase().prepare(`${grantSelect} WHERE g.token_hash=?`).get(tokenHash(header.slice(7))) as AgentGrant|undefined;
 if(!row) agentError("授权 Token 无效",401);
 const current=checkGrant(row);
 getDatabase().prepare("UPDATE agent_grants SET last_used_at=? WHERE id=?").run(new Date().toISOString(),row.id);
 return current;
}
export function requireAgentScope(grant:AgentGrant,scope:string) { grant=checkGrant(grant); if(!JSON.parse(grant.scopesJson).includes(scope)) agentError("授权范围不足",403); return grant; }
export function listAgentGrants(user:RequestUser) {
 return getDatabase().prepare(`SELECT g.id,g.name,g.family_id AS familyId,f.name AS familyName,g.scopes_json AS scopesJson,g.token_hint AS tokenHint,
 g.created_at AS createdAt,g.expires_at AS expiresAt,g.revoked_at AS revokedAt,g.last_used_at AS lastUsedAt
 FROM agent_grants g JOIN families f ON f.id=g.family_id WHERE g.user_id=? ORDER BY g.created_at DESC LIMIT 100`).all(user.id)
 .map((row:any)=>({...row,scopes:JSON.parse(row.scopesJson),scopesJson:undefined}));
}
export function createAgentGrant(user:RequestUser,body:Record<string,unknown>) {
 const name=String(body.name||"").trim(),familyId=String(body.familyId||"");
 if(!name||name.length>80) agentError("请填写连接名称（80 字以内）");requireFamilyAccess(user,familyId);
 const scopes=body.scopes===undefined?["inventory:read"]:body.scopes;
 if(!Array.isArray(scopes)||!scopes.length||scopes.some(scope=>!agentScopes.includes(scope))||new Set(scopes).size!==scopes.length) agentError("授权范围无效");
 if(scopes.includes('inventory:propose')&&!scopes.includes('inventory:read')) agentError("提出变更需要查询库存权限");
 const days=Number(body.days||30);if(![7,30,90].includes(days)) agentError("授权有效期仅支持 7、30 或 90 天");
 const count=getDatabase().prepare("SELECT COUNT(*) AS total FROM agent_grants WHERE user_id=? AND revoked_at IS NULL AND expires_at>?").get(user.id,new Date().toISOString()) as {total:number};if(count.total>=20) agentError("最多保留 20 份有效授权");
 const token=`jz_${randomBytes(32).toString('base64url')}`,id=randomUUID(),createdAt=new Date().toISOString(),expiresAt=new Date(Date.now()+days*86400000).toISOString();
 getDatabase().prepare("INSERT INTO agent_grants(id,user_id,family_id,name,scopes_json,token_hash,token_hint,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)").run(id,user.id,familyId,name,JSON.stringify(scopes),tokenHash(token),token.slice(-6),createdAt,expiresAt);
 return {id,token,expiresAt};
}
export function revokeAgentGrant(user:RequestUser,id:string) {
 const grant=getAgentGrant(id);if(grant.userId!==user.id) agentError("授权不存在",404);
 getDatabase().prepare("UPDATE agent_grants SET revoked_at=COALESCE(revoked_at,?) WHERE id=?").run(new Date().toISOString(),id);
 return {revoked:true};
}
export function logAgentCall(grant:AgentGrant,tool:string,status:string,elapsedMs:number,operationId?:string) {
 const db=getDatabase(); db.prepare("INSERT INTO agent_call_logs(id,grant_id,tool,status,elapsed_ms,operation_id,created_at) VALUES(?,?,?,?,?,?,?)").run(randomUUID(),grant.id,tool,status,elapsedMs,operationId||null,new Date().toISOString());
 db.prepare("DELETE FROM agent_call_logs WHERE created_at<?").run(new Date(Date.now()-90*86400000).toISOString());
}
export function agentCallLogs(user:RequestUser, query:Record<string,unknown> = {}) {
 const limit=query.limit===undefined?20:Number(query.limit), offset=query.offset===undefined?0:Number(query.offset);
 if(!Number.isInteger(limit)||limit<1||limit>50||!Number.isInteger(offset)||offset<0||offset>1000000) agentError("分页参数无效");
 const status=String(query.status||''),tool=String(query.tool||''),search=String(query.search||'').trim();
 if(status&&!['success','failed'].includes(status)) agentError("调用状态无效");
 if(search.length>80||tool.length>80) agentError("筛选内容过长");
 const where=['g.user_id=?'],params:any[]=[user.id];
 if(status){where.push('l.status=?');params.push(status);}
 if(tool){where.push('l.tool=?');params.push(tool);}
 if(search){where.push("g.name LIKE ? ESCAPE '\\'");params.push('%'+search.replace(/[\\%_]/g,c=>'\\'+c)+'%');}
 const from=`FROM agent_call_logs l JOIN agent_grants g ON g.id=l.grant_id WHERE ${where.join(' AND ')}`;
 const total=Number((getDatabase().prepare(`SELECT COUNT(*) AS total ${from}`).get(...params) as {total:number}).total);
 const items=getDatabase().prepare(`SELECT l.id,l.tool,l.status,l.elapsed_ms AS elapsedMs,l.operation_id AS operationId,l.created_at AS createdAt,g.name AS agentName,f.name AS familyName
 FROM agent_call_logs l JOIN agent_grants g ON g.id=l.grant_id JOIN families f ON f.id=g.family_id WHERE ${where.join(' AND ')} ORDER BY l.created_at DESC,l.id DESC LIMIT ? OFFSET ?`).all(...params,limit,offset);
 return {items,total,limit,offset,hasMore:offset+items.length<total};
}
export function limitAgentCalls(grant:AgentGrant,tool:string) {
 const since=new Date(Date.now()-60000).toISOString(); const write=tool.startsWith('prepare_');
 const row=getDatabase().prepare(`SELECT COUNT(*) AS total FROM agent_call_logs WHERE grant_id=? AND created_at>? ${write?"AND tool LIKE 'prepare_%'":""}`).get(grant.id,since) as {total:number};
 if(row.total>=(write?10:60)) agentError("请求过于频繁，请在一分钟后重试",429);
}
