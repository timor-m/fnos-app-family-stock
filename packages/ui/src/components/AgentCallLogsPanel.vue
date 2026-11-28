<script setup lang="ts">
import {computed,onMounted,onUnmounted,ref} from 'vue';
import {RouterLink} from 'vue-router';
import {RefreshCw,Search,ScrollText} from '@lucide/vue';
import {request} from '../utils/api';
import PageSkeleton from './PageSkeleton.vue';
import FormSelect from './form/FormSelect.vue';
const toolNames:Record<string,string>={get_context:'查询家庭信息',search_inventory:'搜索库存',get_inventory_item:'查看批次',list_expiring_inventory:'查询临期',get_inventory_history:'查询流水',prepare_stock_in:'提出入库',prepare_stock_operation:'提出库存变更',get_operation:'查询执行结果'};
type Log={id:string;tool:string;status:string;elapsedMs:number;operationId:string|null;createdAt:string;agentName:string;familyName:string};
type Page={items:Log[];total:number;limit:number;offset:number;hasMore:boolean};
const page=ref<Page>(),pending=ref(false),error=ref(''),search=ref(''),status=ref(''),tool=ref(''),offset=ref(0);
const pageNumber=computed(()=>Math.floor((page.value?.offset||0)/20)+1),pageCount=computed(()=>Math.max(1,Math.ceil((page.value?.total||0)/20)));
let controller:AbortController|undefined,sequence=0;
async function load(reset=false){if(reset)offset.value=0;controller?.abort();const own=new AbortController();controller=own;const seq=++sequence;pending.value=true;error.value='';try{const query=new URLSearchParams({limit:'20',offset:String(offset.value),search:search.value.trim(),status:status.value,tool:tool.value});const result=await request<Page>(`agent/logs?${query}`,{signal:own.signal});if(seq===sequence)page.value=result;}catch(e){if(!own.signal.aborted&&seq===sequence)error.value=e instanceof Error?e.message:'调用记录加载失败';}finally{if(seq===sequence)pending.value=false;}}
function changePage(next:number){if(pending.value)return;offset.value=Math.max(0,next);void load();}
function time(value:string){return new Date(value).toLocaleString('zh-CN');}
onMounted(()=>load());onUnmounted(()=>{++sequence;controller?.abort();});
</script>
<template>
 <section class="agent-logs" aria-label="Agent 调用记录">
  <form class="log-filters" @submit.prevent="load(true)"><label class="log-search"><Search :size="17"/><input v-model="search" maxlength="80" aria-label="搜索连接名称" placeholder="搜索连接名称"/><button type="submit" class="secondary-action">搜索</button></label><FormSelect v-model="status" :options="[{value:'',label:'全部状态'},{value:'success',label:'成功'},{value:'failed',label:'失败'}]" aria-label="调用状态" @update:model-value="load(true)"/><FormSelect v-model="tool" :options="[{value:'',label:'全部操作'},...Object.entries(toolNames).map(([value,label])=>({value,label}))]" aria-label="调用操作" @update:model-value="load(true)"/><button class="secondary-action" type="button" :disabled="pending" @click="load()"><RefreshCw :size="16"/>{{pending?'刷新中':'刷新'}}</button></form>
  <p v-if="error" class="inline-error" role="alert">{{error}}<button type="button" @click="load()">重试</button></p>
  <PageSkeleton v-if="!page&&pending"/>
  <template v-else-if="page">
   <div class="log-meta"><span>共 {{page.total}} 条</span><span>保留最近 90 天</span></div>
   <div v-if="!page.items.length" class="empty-state compact"><ScrollText :size="30"/><strong>{{search||status||tool?'没有匹配的调用记录':'暂无调用记录'}}</strong><span>Agent 调用后会在这里显示</span></div>
   <div v-else class="log-list" :aria-busy="pending||undefined"><article v-for="log in page.items" :key="log.id" class="log-row"><div class="log-main"><strong>{{toolNames[log.tool]||log.tool}}</strong><span class="log-status" :class="{'is-failed':log.status==='failed'}">{{log.status==='success'?'成功':'失败'}}</span><span class="log-duration">{{log.elapsedMs}}ms</span></div><div class="log-detail"><span>{{log.agentName}} · {{log.familyName}}</span><time :datetime="log.createdAt">{{time(log.createdAt)}}</time><RouterLink v-if="log.operationId" :to="{path:'/me/agent',query:{operation:log.operationId}}">查看处理结果</RouterLink></div></article></div>
   <nav v-if="page.total>20" class="log-pagination" aria-label="调用记录分页"><button class="secondary-action" type="button" :disabled="pending||page.offset===0" @click="changePage(page.offset-20)">上一页</button><span>{{pageNumber}} / {{pageCount}}</span><button class="secondary-action" type="button" :disabled="pending||!page.hasMore" @click="changePage(page.offset+20)">下一页</button></nav>
  </template>
 </section>
</template>
<style scoped>
.agent-logs{min-width:0;}.log-filters{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:16px;}.log-search{display:flex;align-items:center;gap:8px;flex:1;min-width:200px;}.log-search>svg{color:var(--muted);flex-shrink:0;}.log-search input{width:100%;min-width:0;height:40px;border:1px solid var(--line-strong);border-radius:10px;padding:0 12px;background:var(--surface);color:var(--text);font:inherit;outline:0;}.log-search input:focus{border-color:var(--green);box-shadow:0 0 0 3px var(--green-soft);}.log-filters>.form-select{width:150px;}.log-meta{display:flex;justify-content:space-between;gap:12px;font-size:12px;color:var(--muted);padding-bottom:10px;border-bottom:1px solid var(--line);}.log-row{padding:13px 0;border-bottom:1px solid var(--line);}.log-main{display:flex;align-items:center;gap:10px;min-width:0;}.log-main strong{font-size:14px;overflow-wrap:anywhere;}.log-status{font-size:12px;color:var(--green);background:var(--green-soft);border-radius:5px;padding:2px 6px;flex-shrink:0;}.log-status.is-failed{color:var(--red);background:var(--red-soft);}.log-duration{font-size:12px;color:var(--muted);margin-left:auto;}.log-detail{display:flex;gap:8px 16px;align-items:center;flex-wrap:wrap;font-size:12px;color:var(--muted);margin-top:7px;overflow-wrap:anywhere;}.log-detail a{color:var(--green);text-decoration:none;}.log-pagination{display:flex;align-items:center;justify-content:center;gap:16px;padding-top:18px;}.log-pagination span{font-size:13px;color:var(--muted);}@media(max-width:760px){.log-search{flex-basis:100%;min-width:0;}.log-search input{font-size:16px;}.log-filters>.form-select{flex:1;min-width:0;width:auto;}.log-filters>button{padding:0 10px;}.log-detail time{flex-basis:100%;}.log-main{gap:8px;}}
</style>
