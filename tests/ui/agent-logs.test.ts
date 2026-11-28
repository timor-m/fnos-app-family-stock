import {afterEach,expect,it,vi} from 'vitest';
import {flushPromises,mount} from '@vue/test-utils';
import {createMemoryHistory,createRouter} from 'vue-router';
vi.mock('../../packages/ui/src/utils/api',()=>({request:vi.fn()}));
import {request} from '../../packages/ui/src/utils/api';
import AgentCallLogsPanel from '../../packages/ui/src/components/AgentCallLogsPanel.vue';
const wrappers:ReturnType<typeof mount>[]=[];
afterEach(()=>{wrappers.splice(0).forEach(w=>w.unmount());vi.mocked(request).mockReset();});
const entry={id:'log-1',tool:'search_inventory',status:'success',elapsedMs:12,operationId:null,createdAt:'2026-11-28T00:00:00Z',agentName:'家庭助手',familyName:'我的家庭'};
async function setup(){const router=createRouter({history:createMemoryHistory(),routes:[{path:'/',component:AgentCallLogsPanel}]});await router.push('/');await router.isReady();const w=mount(AgentCallLogsPanel,{global:{plugins:[router]}});wrappers.push(w);await flushPromises();return w;}
it('paginates on the server and preserves current rows during refresh',async()=>{
 vi.mocked(request).mockResolvedValueOnce({items:[entry],total:21,limit:20,offset:0,hasMore:true});const w=await setup();
 expect(w.text()).toContain('搜索库存');expect(w.text()).toContain('家庭助手');
 vi.mocked(request).mockResolvedValueOnce({items:[{...entry,id:'log-2',agentName:'备用助手'}],total:21,limit:20,offset:20,hasMore:false});
 await w.findAll('button').find(b=>b.text()==='下一页')!.trigger('click');await flushPromises();
 expect(vi.mocked(request).mock.calls[1][0]).toContain('offset=20');expect(w.text()).toContain('备用助手');expect(w.text()).toContain('2 / 2');
 let resolve!:(value:unknown)=>void;vi.mocked(request).mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
 await w.findAll('button').find(b=>b.text()==='刷新')!.trigger('click');await flushPromises();
 expect(w.text()).toContain('备用助手');expect(w.findComponent({name:'PageSkeleton'}).exists()).toBe(false);
 resolve({items:[entry],total:21,limit:20,offset:20,hasMore:false});await flushPromises();
});
it('searches connection names and resets pagination',async()=>{
 vi.mocked(request).mockResolvedValueOnce({items:[entry],total:30,limit:20,offset:20,hasMore:false});const w=await setup();
 await w.get('[aria-label="搜索连接名称"]').setValue('测试助手');
 vi.mocked(request).mockResolvedValueOnce({items:[],total:0,limit:20,offset:0,hasMore:false});await w.get('form').trigger('submit');await flushPromises();
 const url=String(vi.mocked(request).mock.calls[1][0]);expect(url).toContain('offset=0');expect(decodeURIComponent(url)).toContain('search=测试助手');expect(w.text()).toContain('没有匹配的调用记录');
});
