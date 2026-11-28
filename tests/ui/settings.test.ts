import { afterEach, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { defineComponent } from 'vue';
vi.mock('../../packages/ui/src/utils/api', () => ({ request: vi.fn() }));
import { request } from '../../packages/ui/src/utils/api';
import AiSettingsPanel from '../../packages/ui/src/components/AiSettingsPanel.vue';
import ConfirmDialog from '../../packages/ui/src/components/ConfirmDialog.vue';
import { useConfirm } from '../../packages/ui/src/composables/useConfirm';
const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => { wrappers.splice(0).forEach(w => w.unmount()); vi.mocked(request).mockReset(); document.body.innerHTML = ''; });
const profile = {id:'connection-1', name:'日常整理',provider:'custom',baseUrl:'https://example.test/v1',model:'model',timeoutSeconds:30,maxRetries:1,apiKeyConfigured:true,apiKeyMasked:'***'};
const settings = () => ({ enabled:false,defaultProfileId:profile.id,profiles:[{...profile}],providers:[{key:'custom',label:'自定义',defaultBaseUrl:'',defaultModel:''}],statistics:{totalCalls:0,successfulCalls:0,failedCalls:0,totalTokens:0} });
async function edit(w: ReturnType<typeof mount>) { await w.get('[aria-label="编辑连接 日常整理"]').trigger('click'); await flushPromises(); }
function modelInput() { return document.querySelector('input[placeholder="选择或手动填写模型 ID"]') as HTMLInputElement; }
async function setup() {
  const router = createRouter({history:createMemoryHistory(),routes:[{path:'/ai',component:AiSettingsPanel},{path:'/other',component:{template:'<div>其他页</div>'}}]});
  await router.push('/ai'); await router.isReady();
  const Host = defineComponent({ components:{ConfirmDialog}, setup(){return useConfirm();}, template:'<RouterView/><ConfirmDialog :open="!!confirmState" :title="confirmState?.title || \'\'" :message="confirmState?.message || \'\'" @cancel="resolveConfirm(false)" @confirm="resolveConfirm(true)" />' });
  const w=mount(Host,{global:{plugins:[router]},attachTo:document.body});wrappers.push(w);await flushPromises();return {w,router};
}
it('blocks leaving changed settings until the user decides', async () => {
  vi.mocked(request).mockResolvedValueOnce(settings()); const {w,router}=await setup();
  await edit(w); const model=modelInput(); model.value='edited'; model.dispatchEvent(new Event('input',{bubbles:true})); await flushPromises();
  const leaving=router.push('/other'); await flushPromises();
  expect(router.currentRoute.value.path).toBe('/ai'); expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
  (document.querySelector('.confirm-dialog .cancel') as HTMLElement).click(); await leaving;
  expect(model.value).toBe('edited'); expect(router.currentRoute.value.path).toBe('/ai');
  const approved=router.push('/other'); await flushPromises(); (document.querySelector('.confirm-dialog .confirm') as HTMLElement).click(); await approved;
  expect(router.currentRoute.value.path).toBe('/other');
});
it('does not expose default settings as editable when loading fails', async () => {
  vi.mocked(request).mockRejectedValueOnce(new Error('服务不可用')); const {w}=await setup();
  expect(w.text()).toContain('服务不可用'); expect(w.text()).toContain('重试'); expect(w.text()).not.toContain('保存配置');
});
it('rapid double save submits once and retains edits after failure', async () => {
  vi.mocked(request).mockResolvedValueOnce(settings()); const {w}=await setup();
  await edit(w); const model=modelInput(); model.value='edited'; model.dispatchEvent(new Event('input',{bubbles:true})); await flushPromises();
  let reject!: (reason: unknown) => void; vi.mocked(request).mockImplementationOnce(()=>new Promise((_resolve,r)=>{reject=r;}));
  const form=document.querySelector('.connection-editor')!;
  form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await flushPromises(); expect(request).toHaveBeenCalledTimes(2);
  reject(new Error('保存失败'));await flushPromises();expect(model.value).toBe('edited');expect(document.body.textContent).toContain('保存失败');
});

it('fetching models and connection tests preserve the unsaved editor', async () => {
  vi.mocked(request).mockResolvedValueOnce(settings()); const {w}=await setup(); await edit(w);
  vi.mocked(request).mockResolvedValueOnce({models:['model-a','model-b']});
  [...document.querySelectorAll('button')].find(b=>b.textContent==='获取模型列表')!.click(); await flushPromises();
  expect(document.body.textContent).toContain('已获取 2 个模型');
  expect(modelInput().value).toBe('model');
  vi.mocked(request).mockResolvedValueOnce({model:'model',elapsedMs:12});
  [...document.querySelectorAll('button')].find(b=>b.textContent==='测试连接')!.click(); await flushPromises();
  expect(document.body.textContent).toContain('连接正常'); expect(modelInput().value).toBe('model'); expect(request).toHaveBeenCalledTimes(3);
});
it('deleting the default connection saves a replacement as default', async () => {
  const data=settings();data.profiles.push({...profile,id:'connection-2',name:'备用'});
  vi.mocked(request).mockResolvedValueOnce(data); const {w}=await setup();
  await w.get('[aria-label="删除连接 日常整理"]').trigger('click'); await flushPromises();
  vi.mocked(request).mockResolvedValueOnce({...data,profiles:[data.profiles[1]],defaultProfileId:'connection-2'});
  (document.querySelector('.confirm-dialog .confirm') as HTMLElement).click(); await flushPromises();
  const body=JSON.parse(String(vi.mocked(request).mock.calls[1][1]?.body));
  expect(body.defaultProfileId).toBe('connection-2'); expect(body.profiles).toHaveLength(1);
});
it('adds an independent connection and chooses it as the first default', async () => {
  const data=settings(); data.profiles=[]; data.defaultProfileId='';
  vi.mocked(request).mockResolvedValueOnce(data); const {w}=await setup();
  await w.findAll('button').find(b=>b.text()==='添加连接配置')!.trigger('click'); await flushPromises();
  const set=(selector:string,value:string)=>{const el=document.querySelector(selector) as HTMLInputElement;el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));};
  set('input[placeholder="例如：本地模型、日常整理"]','备用连接'); set('input[placeholder="https://…/v1"]','https://backup.test/v1'); set('input[placeholder="选择或手动填写模型 ID"]','backup-model');
  vi.mocked(request).mockResolvedValueOnce({...data,profiles:[{...profile,name:'备用连接',model:'backup-model'}],defaultProfileId:profile.id});
  document.querySelector('.connection-editor')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); await flushPromises();
  expect(vi.mocked(request).mock.calls[1][0]).toBe('ai/settings');
  expect(vi.mocked(request).mock.calls[1][1]?.method).toBe('PUT');
  const submitted=JSON.parse(String(vi.mocked(request).mock.calls[1][1]?.body));
  expect(submitted.profiles[0].name).toBe('备用连接');expect(submitted.defaultProfileId).toBe(submitted.profiles[0].id);
  expect(document.querySelector('.connection-editor')).toBeNull();expect(w.text()).toContain('备用连接');expect(w.text()).toContain('连接已添加并保存');
});
it('edits header rows without mutating saved profiles and includes them in preview and save', async()=>{
  const data={...settings(),profiles:[{...profile,headers:[{name:'x-project',value:'',configured:true}]}]};
  vi.mocked(request).mockResolvedValueOnce(data); const {w}=await setup();await edit(w);
  const input=document.querySelector('[aria-label="请求头值 1"]') as HTMLInputElement;
  expect(input.placeholder).toBe('已配置，留空保持不变');
  input.value='draft';input.dispatchEvent(new Event('input',{bubbles:true}));await flushPromises();
  expect(data.profiles[0].headers[0].value).toBe('');
  [...document.querySelectorAll('button')].find(b=>b.textContent==='添加 Header')!.click();await flushPromises();
  expect(document.querySelector('[aria-label="请求头名称 2"]')).not.toBeNull();
  (document.querySelector('[aria-label="删除请求头 2"]') as HTMLElement).click();await flushPromises();
  vi.mocked(request).mockResolvedValueOnce({models:[]});
  [...document.querySelectorAll('button')].find(b=>b.textContent==='获取模型列表')!.click();await flushPromises();
  expect(JSON.parse(String(vi.mocked(request).mock.calls[1][1]?.body)).headers).toEqual([{name:'x-project',value:'draft',configured:true}]);
  vi.mocked(request).mockResolvedValueOnce(data);
  document.querySelector('.connection-editor')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await flushPromises();
  expect(JSON.parse(String(vi.mocked(request).mock.calls[2][1]?.body)).profiles[0].headers[0].value).toBe('draft');
});

it('warns before discarding a new connection and keeps the draft when closing is cancelled', async()=>{
  vi.mocked(request).mockResolvedValueOnce(settings()); const {w}=await setup();
  await w.findAll('button').find(b=>b.text()==='添加连接配置')!.trigger('click');await flushPromises();
  expect(document.body.textContent).toContain('保存并添加');
  const input=document.querySelector('input[placeholder="例如：本地模型、日常整理"]') as HTMLInputElement;
  input.value='未保存连接';input.dispatchEvent(new Event('input',{bubbles:true}));await flushPromises();
  (document.querySelector('.modal-header [aria-label="关闭"]') as HTMLElement).click();await flushPromises();
  expect(document.body.textContent).toContain('放弃未保存的连接？');
  (document.querySelector('.confirm-dialog .cancel') as HTMLElement).click();await flushPromises();
  expect(input.value).toBe('未保存连接');expect(document.querySelector('.connection-editor')).not.toBeNull();expect(request).toHaveBeenCalledTimes(1);
});
