// @vitest-environment node
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
const {database}=vi.hoisted(()=>({database:{value:null as DatabaseSync|null}}));
vi.mock('../../packages/server/database/client',()=>({getDatabase:()=>database.value}));
import {schemaSql} from '../../packages/server/database/schema';
import {authenticateAgent,createAgentGrant,requireAgentScope,revokeAgentGrant,updateAgentSettings} from '../../packages/server/services/agent-access.service';
const user={id:'test-user',displayName:'测试用户',isGatewayAuthenticated:true,isGatewayAdmin:true};
beforeEach(()=>{
 database.value=new DatabaseSync(':memory:');database.value.exec(schemaSql);
 database.value.prepare('INSERT INTO users(id,display_name) VALUES(?,?)').run(user.id,user.displayName);
 database.value.prepare('INSERT INTO families(id,name,owner_user_id) VALUES(?,?,?)').run('family','家庭',user.id);
 database.value.prepare('INSERT INTO family_members(family_id,user_id,role) VALUES(?,?,?)').run('family',user.id,'owner');
 updateAgentSettings(user,{enabled:true,publicUrl:'https://nas.test/app/fnos-app-family-stock/mcp'});
});
afterEach(()=>{database.value?.close();database.value=null;});
function authorizedSnapshot(){const issued=createAgentGrant(user,{name:'助手',familyId:'family',scopes:['inventory:read','inventory:propose'],days:7});return {issued,snapshot:authenticateAgent(`Bearer ${issued.token}`)};}
it('rejects a previously authenticated request immediately after token revocation',()=>{
 const {issued,snapshot}=authorizedSnapshot();revokeAgentGrant(user,issued.id);
 expect(()=>requireAgentScope(snapshot,'inventory:read')).toThrow('授权已停用、撤销、到期或不再拥有家庭权限');
});
it('rechecks expiry and scope at tool execution instead of trusting an earlier snapshot',()=>{
 const {issued,snapshot}=authorizedSnapshot();
 database.value!.prepare('UPDATE agent_grants SET scopes_json=? WHERE id=?').run('["inventory:read"]',issued.id);
 expect(()=>requireAgentScope(snapshot,'inventory:propose')).toThrow('授权范围不足');
 database.value!.prepare('UPDATE agent_grants SET expires_at=? WHERE id=?').run('2000-01-01T00:00:00Z',issued.id);
 expect(()=>requireAgentScope(snapshot,'inventory:read')).toThrow('授权已停用、撤销、到期或不再拥有家庭权限');
});
