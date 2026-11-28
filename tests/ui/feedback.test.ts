import { afterEach, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
vi.mock('../../packages/ui/src/utils/api',()=>({request:vi.fn(),apiUrl:(p:string)=>'/api/'+p}));
import { request } from '../../packages/ui/src/utils/api';
import FeedbackPanel from '../../packages/ui/src/components/FeedbackPanel.vue';
import AboutPanel from '../../packages/ui/src/components/AboutPanel.vue';
const wrappers:ReturnType<typeof mount>[]=[];
afterEach(()=>{wrappers.splice(0).forEach(w=>w.unmount());vi.mocked(request).mockReset();document.body.innerHTML='';});
async function setup(){const router=createRouter({history:createMemoryHistory(),routes:[{path:'/',component:FeedbackPanel}]});await router.push('/');await router.isReady();const w=mount({template:"<RouterView/>"},{global:{plugins:[router]},attachTo:document.body});wrappers.push(w);await flushPromises();return w;}
const ticket={number:'B0001',title:'测试问题',category:'problem',status:'in_progress',version:2,updatedAt:'2026-11-28T00:00:00Z',createdAt:'2026-11-28T00:00:00Z',fixedVersion:null,description:'问题描述',events:[]};
it('shows retry on service failure without pretending the feedback list is empty',async()=>{vi.mocked(request).mockRejectedValueOnce(new Error('反馈服务暂不可用'));const w=await setup();expect(w.text()).toContain('反馈服务暂不可用');expect(w.text()).toContain('重试');expect(w.text()).not.toContain('暂无反馈');});
it('opens progress and preserves details if refreshing fails',async()=>{vi.mocked(request).mockResolvedValueOnce({items:[ticket],total:1}).mockResolvedValueOnce({...ticket,events:[{id:1,actorType:'admin',content:'已经定位',createdAt:ticket.updatedAt,attachments:[]}]});const w=await setup();await w.findAll('button').find(b=>b.text().includes('测试问题'))!.trigger('click');await flushPromises();expect(w.text()).toContain('已经定位');vi.mocked(request).mockRejectedValueOnce(new Error('重试连接'));await w.findAll('button').find(b=>b.attributes('aria-label')==='刷新进度')!.trigger('click');await flushPromises();expect(w.text()).toContain('已经定位');expect(w.text()).toContain('重试连接');});
it('failed submission keeps input and reuses the same idempotency key for retry',async()=>{vi.mocked(request).mockResolvedValueOnce({items:[],total:0});const w=await setup();await w.findAll('button').find(b=>b.text()==='提交反馈')!.trigger('click');await flushPromises();const title=document.querySelector('input[placeholder="用一句话概括问题或建议"]') as HTMLInputElement;const description=document.querySelector('textarea[required]') as HTMLTextAreaElement;for(const [el,value] of [[title,'保存失败'],[description,'详细说明']] as const){el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));}vi.mocked(request).mockRejectedValue(new Error('暂时断线'));const form=document.querySelector('.feedback-form')!;form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await flushPromises();expect(title.value).toBe('保存失败');expect(document.body.textContent).toContain('暂时断线');const submissions=()=>vi.mocked(request).mock.calls.filter(([path,init])=>path==='feedback/tickets'&&init?.method==='POST');const key=(submissions()[0][1]?.headers as any)['idempotency-key'];form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await flushPromises();expect((submissions()[1][1]?.headers as any)['idempotency-key']).toBe(key);});
it('about displays project metadata and no storage paths',async()=>{vi.mocked(request).mockResolvedValueOnce({appTitle:'家藏',appDescription:'家庭库存',appVersion:'1.0.1',appName:'fnos-app-family-stock',maintainer:'timor-m',sourceUrl:'https://github.com/timor-m/fnos-app-family-stock',osMinVersion:'1.1',runtime:{node:'v22',platform:'linux',arch:'arm64'},database:{schemaVersion:1}});const w=mount(AboutPanel);wrappers.push(w);await flushPromises();expect(w.text()).toContain('1.0.1');expect(w.text()).toContain('linux / arm64');expect(w.find('a').attributes('href')).toContain('fnos-app-family-stock');});
it('uses the unified category selector, collapsible fields and success number card',async()=>{
  vi.mocked(request).mockImplementation(async(path)=>{
    if(path==='feedback-diagnostics') return {appVersion:'1.0.1',accessMode:'port',runtime:{node:'v22',platform:'linux',arch:'arm64'},database:{schemaVersion:5}};
    if(path==='feedback/tickets') return {...ticket,status:'received',version:1};
    return {items:[],total:0};
  });
  const w=await setup();await w.findAll('button').find(b=>b.text()==='提交反馈')!.trigger('click');await flushPromises();
  expect(document.querySelectorAll('.type-options button')).toHaveLength(3);
  expect(document.querySelector('details.environment-preview')).not.toBeNull();expect(document.querySelector('.attachment-add')).not.toBeNull();
  const title=document.querySelector('input[placeholder="用一句话概括问题或建议"]') as HTMLInputElement;
  const description=document.querySelector('textarea[required]') as HTMLTextAreaElement;
  for(const [el,value] of [[title,'问题标题'],[description,'详细情况']] as const){el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));}
  document.querySelector('.feedback-form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await flushPromises();
  expect(document.querySelector('.success-card')?.textContent).toContain('反馈已提交');expect(document.querySelector('.number-box')?.textContent).toContain('B0001');
});
