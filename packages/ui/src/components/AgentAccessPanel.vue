<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { Plus, Trash2, Copy, RefreshCw, Bot } from '@lucide/vue';
import { request } from '../utils/api';
import { copyTextToClipboard } from '../utils/clipboard';
import { useConfirm } from '../composables/useConfirm';
import { useUnsavedChanges } from '../composables/useUnsavedChanges';
import PageSkeleton from './PageSkeleton.vue';
import ModalFrame from './form/ModalFrame.vue';
import FormSelect from './form/FormSelect.vue';
const props=defineProps<{families:Array<{id:string;name:string}>;selectedFamilyId:string}>();
const scopeNames:Record<string,string>={'inventory:read':'查询库存','history:read':'查询流水','inventory:propose':'提出入库及库存变更'};
const statusNames:Record<string,string>={pending:'待确认',unavailable:'授权已失效或接入已停用',expired:'已过期',completed:'已完成',rejected:'已拒绝',conflict:'库存已变动，请重新提出'};
type Operation={operationId:string;status:string;agentName:string;familyId:string;summary:Record<string,any>;expiresAt:string;result:Record<string,any>|null};
type Grant={id:string;name:string;familyName:string;scopes:string[];tokenHint:string;expiresAt:string;revokedAt:string|null;lastUsedAt:string|null};
type Connection={enabled:boolean;publicUrl:string;consoleUrl:string;listenMode:string;listenPort:number};
type Settings=Connection & {listener?:{available:boolean;listening:boolean;host:string|null;port:number|null;error:string};canManage:boolean;grants:Grant[];operations:Operation[]};
const state=ref<Settings>(),loading=ref(true),busy=ref(false),message=ref(''),editorMessage=ref('');
const connection=ref<Connection>({enabled:false,publicUrl:'',consoleUrl:'',listenMode:'local',listenPort:3335}),editor=ref<{name:string;familyId:string;days:string;history:boolean;write:boolean}|null>(null);
const issued=ref<{token:string;expiresAt:string}|null>(null),route=useRoute();
const {askConfirm}=useConfirm();
const {markSaved}=useUnsavedChanges(()=>({connection:connection.value,editor:editor.value}),busy);
let baseline='';
function connectionFrom(value:Settings):Connection{return {enabled:value.enabled,publicUrl:value.publicUrl,consoleUrl:value.consoleUrl||new URL(import.meta.env.BASE_URL,window.location.origin).toString().replace(/\/$/,''),listenMode:value.listenMode||'local',listenPort:value.listenPort||3335};}
function useLocalAddress(){connection.value.publicUrl=`http://127.0.0.1:${connection.value.listenPort}/mcp`;}
async function load(resetConnection=true){loading.value=!state.value;try {state.value=await request<Settings>('agent/settings');if(resetConnection){connection.value=connectionFrom(state.value);markSaved();}}catch(e){message.value=e instanceof Error?e.message:'加载失败';}finally{loading.value=false;}}
async function refresh(){if(state.value&&JSON.stringify(connection.value)!==JSON.stringify(connectionFrom(state.value))&&!await askConfirm({title:'放弃未保存的接入设置？',message:'刷新会恢复已保存的配置。',confirmText:'刷新',danger:true}))return;await load();}
function openEditor(){editor.value={name:'',familyId:props.selectedFamilyId||props.families[0]?.id||'',days:'30',history:false,write:false};baseline=JSON.stringify(editor.value);editorMessage.value='';}
async function closeEditor(){if(busy.value)return;if(JSON.stringify(editor.value)!==baseline&&!await askConfirm({title:'放弃未保存的授权？',message:'填写的内容将不会保存。',confirmText:'放弃',danger:true}))return;editor.value=null;}
async function action(run:()=>Promise<void>,inEditor=false){if(busy.value)return;busy.value=true;if(inEditor)editorMessage.value='';else message.value='';try{await run();}catch(e){const text=e instanceof Error?e.message:'操作失败';if(inEditor)editorMessage.value=text;else message.value=text;}finally{busy.value=false;}}
async function saveConnection(){await action(async()=>{await request('agent/settings',{method:'PUT',body:JSON.stringify(connection.value)});await load();message.value='MCP 接入配置已保存';});}
async function createGrant(){if(!editor.value)return;const draft=editor.value;await action(async()=>{const scopes=['inventory:read',...(draft.history?['history:read']:[]),...(draft.write?['inventory:propose']:[])];issued.value=await request('agent/grants',{method:'POST',body:JSON.stringify({name:draft.name,familyId:draft.familyId,days:Number(draft.days),scopes})});editor.value=null;await load(false);},true);}
async function revoke(grant:Grant){if(!await askConfirm({title:`撤销「${grant.name}」？`,message:'此 Token 将立即失效，未执行的操作也不能再确认。',confirmText:'撤销授权',danger:true}))return;await action(async()=>{await request(`agent/grants/${grant.id}`,{method:'DELETE'});await load(false);message.value='授权已撤销';});}
function readable(op:Operation){const s=op.summary;return !s.operationType?`${s.displayName||s.name} · 入库 ${s.quantity} ${s.unit} · ${s.locationName||s.locationId}`:`${s.displayName||'物品'} · ${({consume:'消耗',discard:'丢弃',transfer:'移动'} as Record<string,string>)[s.operationType]} ${s.quantity} ${s.unit||''} · ${s.locationName||''} · ${s.beforeQuantity} → ${s.afterQuantity}${s.toLocationName?' · 移至 '+s.toLocationName:''}${s.reason?' · '+s.reason:''}`;}

async function decide(op:Operation,approve:boolean){if(approve&&!await askConfirm({title:'确认执行库存变更？',message:readable(op),confirmText:'确认执行'}))return;await action(async()=>{const result=await request<Operation>(`agent/operations/${op.operationId}`,{method:'POST',body:JSON.stringify({approve})});await load(false);message.value=statusNames[result.status]||result.status;});}
async function copy(value:string){message.value=await copyTextToClipboard(value)?'已复制':'复制失败，请手动复制';}
function time(value:string|null){return value?new Date(value).toLocaleString('zh-CN'):'尚未使用';}
function active(grant:Grant){return !grant.revokedAt&&Date.parse(grant.expiresAt)>Date.now();}
onMounted(()=>load());
</script>
<template>
 <div class="agent-access">
  <PageSkeleton v-if="loading" />
  <template v-else-if="state">
   <section class="agent-band"><header><Bot :size="21"/><div><h2>Agent 接入</h2><p>通过 MCP 查询家藏，或提出入库与库存变更。</p></div><button type="button" class="icon-button" aria-label="刷新 Agent 接入状态" :disabled="busy" @click="refresh"><RefreshCw :size="18"/></button></header>
    <p class="agent-hint">使用支持 Streamable HTTP 和 Bearer Token 的客户端。Token 绑定当前用户与指定家庭；客户端及其模型服务可能获得授权范围内的数据。库存变更需在家藏中确认。</p>
    <form v-if="state.canManage" @submit.prevent="saveConnection"><fieldset :disabled="busy"><label class="agent-check"><input v-model="connection.enabled" type="checkbox"/>启用 MCP 接入</label><label class="field"><span>MCP 接入地址</span><input v-model.trim="connection.publicUrl" placeholder="http://设备局域网IP:3335/mcp" maxlength="500"/><small>外部 Agent 使用独立端口，统一网关地址需要飞牛登录。HTTP 仅用于可信局域网，公网需 HTTPS 代理。</small></label><template v-if="state.listener?.available"><div class="listener-fields"><label class="field"><span>访问范围</span><FormSelect v-model="connection.listenMode" :options="[{value:'local',label:'仅本机'},{value:'lan',label:'允许局域网访问'}]" aria-label="MCP 访问范围"/></label><label class="field"><span>独立端口</span><input v-model.number="connection.listenPort" type="number" min="1024" max="65535" required/></label></div><button v-if="connection.listenMode==='local'" class="secondary-action" type="button" @click="useLocalAddress">使用同机地址</button><small>独立入口只提供 MCP，不开放管理页面或确认接口。{{state.listener.listening?`已监听 ${state.listener.host}:${state.listener.port}`:'当前未监听'}}{{state.listener.error?' · '+state.listener.error:''}}</small></template><label class="field"><span>家藏确认页面地址</span><input v-model.trim="connection.consoleUrl" maxlength="500" required/><small>使用应用页面入口打开待确认操作；飞牛部署时仍需登录，与 MCP 独立地址分开。</small></label><button class="primary-button" type="submit">{{busy?'正在保存':'保存接入设置'}}</button></fieldset></form>
    <p v-else class="agent-hint">MCP 接入{{state.enabled?'已启用':'未启用，请联系设备管理员'}}。</p>
    <button v-if="state.publicUrl" type="button" class="secondary-action" @click="copy(state!.publicUrl)"><Copy :size="15"/>复制 MCP 地址</button>
   </section>
   <section class="agent-band"><header><div><h2>我的授权</h2><p>Token 仅在创建时展示，请妥善保存。</p></div><button class="secondary-action" type="button" :disabled="busy" @click="openEditor"><Plus :size="16"/>新增授权</button></header>
    <div v-if="!state.grants.length" class="empty-state compact"><Bot :size="28"/><strong>尚未创建授权</strong><span>创建后将 Token 配置到你的 Agent 客户端</span></div>
    <article v-for="grant in state.grants" :key="grant.id" class="agent-row"><div><strong>{{grant.name}}</strong><span>{{grant.familyName}} · {{grant.scopes.map(s=>scopeNames[s]).join('、')}}</span><small>尾号 {{grant.tokenHint}} · {{grant.revokedAt?'已撤销':active(grant)?'有效':'已到期'}} · 到期 {{time(grant.expiresAt)}}</small><small>最近调用：{{time(grant.lastUsedAt)}}</small></div><button v-if="active(grant)" class="icon-button" type="button" :aria-label="`撤销授权 ${grant.name}`" :disabled="busy" @click="revoke(grant)"><Trash2 :size="17"/></button></article>
   </section>
   <section class="agent-band"><header><div><h2>待确认与执行结果</h2><p>仅展示你授权的 Agent 所提出的操作</p></div></header>
    <div v-if="!state.operations.length" class="empty-state compact"><strong>暂无待处理操作</strong></div>
    <article v-for="op in state.operations" :key="op.operationId" class="operation-row" :class="{'operation-selected':route.query.operation===op.operationId}"><strong>{{readable(op)}}</strong><small>{{op.agentName}} · {{statusNames[op.status]||op.status}} · 有效至 {{time(op.expiresAt)}}</small><div v-if="op.status==='pending'" class="operation-actions"><button class="secondary-action" type="button" :disabled="busy" @click="decide(op,false)">拒绝</button><button class="primary-button" type="button" :disabled="busy" @click="decide(op,true)">确认执行</button></div><p v-if="op.result">{{op.result.currentQuantity!==undefined?`执行后剩余：${op.result.currentQuantity}`:'已入库'}} · 批次 {{op.result.batchId}}</p></article>
   </section>
   <RouterLink class="agent-log-entry" to="/me/agent/logs"><span><strong>调用记录</strong><small>查看调用状态、耗时，按连接和操作筛选</small></span><span aria-hidden="true">›</span></RouterLink>
  </template>
  <p v-if="message" role="status" class="agent-message">{{message}}</p><button v-if="!loading&&!state" type="button" class="secondary-action" @click="refresh">重新加载</button>
  <ModalFrame :open="!!editor" title="新增 Agent 授权" :busy="busy" @close="closeEditor"><form v-if="editor" class="agent-form" @submit.prevent="createGrant"><fieldset :disabled="busy"><label class="field"><span>连接名称</span><input v-model.trim="editor.name" required maxlength="80" placeholder="例如：飞书家庭助手"/></label><label class="field"><span>授权家庭</span><FormSelect v-model="editor.familyId" :options="families.map(f=>({value:f.id,label:f.name}))" aria-label="授权家庭"/></label><label class="field"><span>有效期</span><FormSelect v-model="editor.days" :options="[{value:'7',label:'7 天'},{value:'30',label:'30 天'},{value:'90',label:'90 天'}]" aria-label="授权有效期"/></label><p>默认允许查询库存</p><label class="agent-check"><input v-model="editor.history" type="checkbox"/>允许查询库存流水</label><label class="agent-check"><input v-model="editor.write" type="checkbox"/>允许提出入库及库存变更（需确认）</label><small>将 Token 交给客户端即授权其访问上述家庭数据，不要在群聊中分享。</small><p v-if="editorMessage" role="alert">{{editorMessage}}</p><button class="primary-button" type="submit">{{busy?'正在创建':'创建并保存授权'}}</button></fieldset></form></ModalFrame>
  <ModalFrame :open="!!issued" title="授权已创建" @close="issued=null"><div v-if="issued" class="agent-form"><p>Token 仅显示这一次，请复制保存。关闭后无法再次查看。</p><textarea class="issued-token" readonly aria-label="新建的授权 Token" :value="issued.token"/><small>到期：{{time(issued.expiresAt)}}</small><button class="primary-button" type="button" @click="copy(issued.token)"><Copy :size="16"/>复制 Token</button><p>客户端请求头：Authorization: Bearer &lt;Token&gt;</p><p v-if="message" role="status">{{message}}</p></div></ModalFrame>
 </div>
</template>
<style scoped>
.agent-log-entry{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 0;border-top:1px solid var(--line);color:var(--text);text-decoration:none;}.agent-log-entry>span:first-child{display:grid;gap:5px;}.agent-log-entry strong{font-size:14px;}.agent-log-entry>span:last-child{font-size:24px;color:var(--muted);}
.listener-fields{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;}
.agent-access,.agent-form,fieldset {display:grid;gap:16px;min-width:0;}fieldset{border:0;padding:0;margin:0;}.agent-band+ .agent-band{border-top:1px solid var(--line);padding-top:18px;}header{display:flex;align-items:center;gap:10px;margin-bottom:14px;}header>div{flex:1;min-width:0;}header svg{color:var(--green);}h2,p{margin:0;}h2{font-size:16px;}header p,small,.agent-hint{color:var(--muted);font-size:12px;line-height:1.65;}header p{margin-top:4px;}.agent-hint{margin-bottom:14px;}.agent-band form{margin-bottom:14px;}.agent-band form button{justify-self:start;}.agent-check{display:flex;gap:8px;align-items:center;font-size:14px;}.agent-check input{width:18px;height:18px;accent-color:var(--green);flex-shrink:0;}.agent-row{display:flex;gap:12px;align-items:center;padding:12px 0;border-bottom:1px solid var(--line);}.agent-row>div{display:grid;gap:5px;flex:1;min-width:0;}.agent-row strong,.operation-row strong{font-size:14px;}.agent-row span{font-size:13px;color:var(--muted);}.agent-row small,.agent-row span,.operation-row{overflow-wrap:anywhere;}.agent-form{padding:20px;}.agent-form p,.operation-row p,.agent-message{font-size:13px;line-height:1.7;overflow-wrap:anywhere;}.issued-token{width:100%;min-height:100px;border:1px solid var(--line-strong);border-radius:10px;padding:12px;resize:none;background:var(--surface);color:var(--text);font:inherit;overflow-wrap:anywhere;}.operation-row{display:grid;gap:8px;padding:14px 0;border-bottom:1px solid var(--line);}.operation-actions{display:flex;gap:10px;justify-content:flex-end;}.operation-selected{background:var(--green-soft);border-radius:8px;padding:12px;}.field input{height:44px;border-radius:10px;}@media(max-width:760px){.agent-form{padding:16px;}.issued-token{font-size:16px;}}
</style>
