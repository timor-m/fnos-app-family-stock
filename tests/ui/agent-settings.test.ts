import { afterEach, expect, it, vi } from 'vitest';
import { flushPromises,mount } from '@vue/test-utils';
import { createMemoryHistory,createRouter } from 'vue-router';
import {defineComponent} from 'vue';
vi.mock('../../packages/ui/src/utils/api',()=>({request:vi.fn()}));
import {request} from '../../packages/ui/src/utils/api';
import AgentAccessPanel from '../../packages/ui/src/components/AgentAccessPanel.vue';
import ConfirmDialog from '../../packages/ui/src/components/ConfirmDialog.vue';
import {useConfirm} from '../../packages/ui/src/composables/useConfirm';
const wrappers:ReturnType<typeof mount>[]=[];
afterEach(()=>{wrappers.splice(0).forEach(w=>w.unmount());vi.mocked(request).mockReset();document.body.innerHTML='';});
const state=()=>({enabled:false,publicUrl:'https://nas.test/app/fnos-app-family-stock/mcp',canManage:true,grants:[],operations:[],logs:[]});
async function setup(){const router=createRouter({history:createMemoryHistory(),routes:[{path:'/',component:{template:'<div/>'}}]});await router.push('/');await router.isReady();const Host=defineComponent({components:{AgentAccessPanel,ConfirmDialog},setup(){return useConfirm();},template:`<AgentAccessPanel :families="[{id:'family-1',name:'家庭'}]" selected-family-id="family-1"/><ConfirmDialog :open="!!confirmState" :title="confirmState?.title||''" :message="confirmState?.message||''" @confirm="resolveConfirm(true)" @cancel="resolveConfirm(false)"/>`});const w=mount(Host,{attachTo:document.body,global:{plugins:[router]}});wrappers.push(w);await flushPromises();return w;}
it('creates a read-only family-bound grant immediately and only shows token in the issued dialog',async()=>{
 vi.mocked(request).mockResolvedValueOnce(state());const w=await setup();await w.findAll('button').find(b=>b.text()==='新增授权')!.trigger('click');await flushPromises();
 const name=document.querySelector('input[placeholder="例如：飞书家庭助手"]') as HTMLInputElement;name.value='测试助手';name.dispatchEvent(new Event('input',{bubbles:true}));
 vi.mocked(request).mockResolvedValueOnce({token:'test-token-one-time',expiresAt:'2026-12-01T00:00:00Z'}).mockResolvedValueOnce(state());
 document.querySelector('.agent-form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await flushPromises();
 expect(vi.mocked(request).mock.calls[1][0]).toBe('agent/grants');expect(JSON.parse(String(vi.mocked(request).mock.calls[1][1]?.body))).toEqual({name:'测试助手',familyId:'family-1',days:30,scopes:['inventory:read']});
 expect((document.querySelector('[aria-label="新建的授权 Token"]') as HTMLTextAreaElement).value).toBe('test-token-one-time');
 (document.querySelector('.modal-header [aria-label="关闭"]') as HTMLElement).click();await flushPromises();expect(document.querySelector('[aria-label="新建的授权 Token"]')).toBeNull();expect(document.body.textContent).not.toContain('test-token-one-time');
});
it('keeps grant form content after create failure and does not create a phantom grant',async()=>{
 vi.mocked(request).mockResolvedValueOnce(state());const w=await setup();await w.findAll('button').find(b=>b.text()==='新增授权')!.trigger('click');await flushPromises();
 const name=document.querySelector('input[placeholder="例如：飞书家庭助手"]') as HTMLInputElement;name.value='保存失败的助手';name.dispatchEvent(new Event('input',{bubbles:true}));
 vi.mocked(request).mockRejectedValueOnce(new Error('保存失败'));document.querySelector('.agent-form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await flushPromises();
 expect(name.value).toBe('保存失败的助手');expect(document.body.textContent).toContain('保存失败');expect(document.querySelector('[aria-label="新建的授权 Token"]')).toBeNull();expect(request).toHaveBeenCalledTimes(2);
});

it('shows local independent port controls and submits the chosen port without requiring fnOS',async()=>{
 const saved={...state(),publicUrl:'',consoleUrl:'http://localhost/app/fnos-app-family-stock',listenMode:'local',listenPort:3335,listener:{available:true,listening:false,host:null,port:null,error:''}};
 vi.mocked(request).mockResolvedValueOnce(saved);const w=await setup();
 expect(w.text()).toContain('独立端口');expect(w.text()).toContain('仅本机');
 await w.get('input[type="number"]').setValue('34567');
 await w.findAll('button').find(b=>b.text()==='使用同机地址')!.trigger('click');
 await w.get('.agent-check input').setValue(true);
 vi.mocked(request).mockResolvedValueOnce({}).mockResolvedValueOnce({...saved,enabled:true,publicUrl:'http://127.0.0.1:34567/mcp',listenPort:34567,listener:{...saved.listener,listening:true,host:'127.0.0.1',port:34567}});
 await w.get('.agent-band form').trigger('submit');await flushPromises();
 expect(JSON.parse(String(vi.mocked(request).mock.calls[1][1]?.body))).toMatchObject({enabled:true,listenMode:'local',listenPort:34567,publicUrl:'http://127.0.0.1:34567/mcp'});
 expect(w.text()).toContain('已监听 127.0.0.1:34567');
});
