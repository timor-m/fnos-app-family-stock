// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
const { db } = vi.hoisted(() => ({ db: { value: null as any } }));
vi.mock('../../packages/server/database/client', () => ({getDatabase:()=>db.value}));
vi.mock('../../packages/server/utils/runtime-config', () => ({getAppConfig:()=>({aiProvider:'deepseek',aiEnabled:false,aiTimeoutSeconds:30,aiMaxRetries:1})}));
vi.mock('../../packages/server/services/ai-secret.service', () => ({encryptAiSecret:(s:string)=>s ? `encrypted:${s}` : '',decryptAiSecret:(s:string)=>s.replace(/^encrypted:/,'')}));
import { getPublicAiSettings, getResolvedAiSettings, updateAiSettings, listAiModels } from '../../packages/server/services/ai-settings.service';
beforeEach(()=>{ db.value?.close(); db.value=new DatabaseSync(':memory:'); db.value.exec(`CREATE TABLE app_settings(setting_key TEXT PRIMARY KEY,value_json TEXT,updated_at TEXT); CREATE TABLE ai_extraction_runs(status TEXT,total_tokens INTEGER,created_at TEXT);`); });
const profile=(id:string,model='model')=>({id,name:id,provider:'custom',baseUrl:'https://example.test/v1',model,apiKey:'secret',timeoutSeconds:600,maxRetries:1});
it('supports same-provider independent connections, encrypted secrets and default selection',()=>{
  const a=profile('new-a'),b=profile('new-b','second');
  const result=updateAiSettings({enabled:true,profiles:[a,b],defaultProfileId:b.id});
  expect(result.profiles).toHaveLength(2); expect(JSON.stringify(result)).not.toContain('secret');expect(getResolvedAiSettings().model).toBe('second');
  const stored=JSON.parse(db.value.prepare('SELECT value_json FROM app_settings').get().value_json);
  expect(stored.profiles[0].apiKeyEncrypted).toBe('encrypted:secret'); expect(stored.profiles[0].apiKey).toBeUndefined();
  updateAiSettings({enabled:true,profiles:[result.profiles[0]],defaultProfileId:a.id}); expect(getResolvedAiSettings().apiKey).toBe('secret');
});
it('converts existing provider settings without losing credentials',()=>{
  db.value.prepare('INSERT INTO app_settings VALUES(?,?,NULL)').run('ai.extraction',JSON.stringify({enabled:true,provider:'custom',providers:{custom:{baseUrl:'https://example.test/v1',model:'old',apiKey:'old-secret'}}}));
  const result=getPublicAiSettings();expect(result.profiles[0].id).toBe('legacy-custom');
  updateAiSettings({...result});expect(getResolvedAiSettings().apiKey).toBe('old-secret');expect(getResolvedAiSettings().model).toBe('old');
});
it('rejects invalid defaults and never sends a retained key to a changed endpoint',async()=>{
  const p=profile('new-a');const result=updateAiSettings({enabled:true,profiles:[p],defaultProfileId:p.id});
  expect(()=>updateAiSettings({...result,defaultProfileId:'missing'})).toThrow('请选择默认连接');
  const fetcher=vi.spyOn(globalThis,'fetch');
  await expect(listAiModels({...result.profiles[0],baseUrl:'https://another.test/v1'})).rejects.toThrow('请填写 API Key');expect(fetcher).not.toHaveBeenCalled();
});
it('model discovery uses draft input and stored key, deduplicates models without saving',async()=>{
  const p=profile('new-a');updateAiSettings({profiles:[p],defaultProfileId:p.id});
  const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({data:[{id:'a'},{id:'a'},{id:'b'}]})));
  expect(await listAiModels({...getPublicAiSettings().profiles[0],model:''})).toEqual({models:['a','b']});
  expect(fetcher.mock.calls[0][0]).toBe('https://example.test/v1/models');expect(getResolvedAiSettings().model).toBe('model');
});
it('empty connections disable AI without resurrecting legacy settings',()=>{
  const p=profile('new-a');updateAiSettings({profiles:[p],defaultProfileId:p.id});
  updateAiSettings({profiles:[],defaultProfileId:'',enabled:false});expect(getPublicAiSettings().profiles).toEqual([]);expect(getResolvedAiSettings().enabled).toBe(false);
});
it('encrypts header values, keeps blank values, and supports edits and deletion independently',()=>{
  const a={...profile('new-a'),headers:[{name:'x-api-key',value:'header-secret'}]};
  const result=updateAiSettings({profiles:[a,profile('new-b')],defaultProfileId:a.id});
  expect(JSON.stringify(result)).not.toContain('header-secret');
  const stored=JSON.parse(db.value.prepare('SELECT value_json FROM app_settings').get().value_json);
  expect(stored.profiles[0].headers).toEqual([{name:'x-api-key',valueEncrypted:'encrypted:header-secret'}]);
  const saved=updateAiSettings({...result});
  expect(getResolvedAiSettings().headers).toEqual(a.headers);
  saved.profiles[0].headers[0].value='replacement';updateAiSettings({...saved});
  expect(getResolvedAiSettings().headers?.[0].value).toBe('replacement');
  updateAiSettings({...saved,profiles:[{...saved.profiles[0],headers:[]},saved.profiles[1]]});
  expect(getResolvedAiSettings().headers).toEqual([]);
});
it('supports header authentication without API Key and applies overrides during model discovery',async()=>{
  const a={...profile('new-a'),apiKey:'',headers:[{name:'Authorization',value:'Custom header-secret'},{name:'x-project',value:'project-a'}]};
  updateAiSettings({enabled:true,profiles:[a],defaultProfileId:a.id});
  const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({data:[]})));
  await listAiModels(getPublicAiSettings().profiles[0]);
  const headers=new Headers(fetcher.mock.calls.at(-1)?.[1]?.headers);
  expect(headers.get('authorization')).toBe('Custom header-secret');expect(headers.get('x-project')).toBe('project-a');
  expect(getPublicAiSettings().configured).toBe(true);
});
it('rejects invalid headers and prevents saved header secrets from following renamed headers or endpoints',async()=>{
  const a={...profile('new-a'),headers:[{name:'x-api-key',value:'header-secret'}]};
  const result=updateAiSettings({profiles:[a],defaultProfileId:a.id});
  for (const headers of [[{name:'x-a',value:'a\r\nb'}],[{name:'host',value:'example.test'}],[{name:'x-a',value:'1'},{name:'X-A',value:'2'}],[{name:'x-renamed',value:''}]]) {
    expect(()=>updateAiSettings({...result,profiles:[{...result.profiles[0],headers}]})).toThrow();
  }
  const fetcher=vi.spyOn(globalThis,'fetch');fetcher.mockClear();
  await expect(listAiModels({...result.profiles[0],baseUrl:'https://another.test/v1'})).rejects.toThrow('需重新填写');
  expect(fetcher).not.toHaveBeenCalled();
});
