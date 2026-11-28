// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
vi.mock('../../packages/server/utils/runtime-config',()=>({getAppConfig:()=>({accessMode:'port'})}));
import { sendFeedbackRequest } from '../../packages/server/services/feedback-remote.service';
import { resolveFeedbackAppsIdentity } from '../../packages/server/services/feedback-installation.service';
import { feedbackEnvironment } from '../../packages/server/services/about.service';
it('uses persistent application-scoped installation identity',()=>{const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE app_settings(setting_key TEXT PRIMARY KEY,value_json TEXT)');const a=resolveFeedbackAppsIdentity(db,{machineId:null}),b=resolveFeedbackAppsIdentity(db,{machineId:null});expect(a.clientId).toBe(b.clientId);expect(a.headers['x-app-id']).toBe('fnos-app-family-stock');expect(a.headers['x-client-id']).toBe(a.clientId);expect(a.headers).not.toHaveProperty('x-device-id');db.close();});
it('maps the unified feedback route and forwards idempotency with application identity',async()=>{const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({success:true,data:{number:'B0001'}})));const result=await sendFeedbackRequest('/tickets',{method:'POST',json:true,key:'operation-001',body:'{}'},{fetch:fetcher,resolveIdentity:()=>({headers:{'x-app-id':'fnos-app-family-stock','x-client-id':'test'},clientId:'test',deviceId:null,localKey:'test'})});expect(result).toEqual({number:'B0001'});expect(fetcher.mock.calls[0][0]).toBe('https://gateway.lby.link/apps/v1/feedbacks');expect(fetcher.mock.calls[0][1].headers['Idempotency-Key']).toBe('operation-001');});
it('does not expose upstream credentials or raw error text',async()=>{const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({success:false,message:'private-token-123'}),{status:500}));await expect(sendFeedbackRequest('/tickets',{}, {fetch:fetcher,resolveIdentity:()=>({headers:{},clientId:null,deviceId:null,localKey:'test'})})).rejects.toThrow('反馈服务暂不可用');});
it('diagnostic snapshot excludes file paths, keys and inventory data',()=>{const data=feedbackEnvironment();expect(Object.keys(data)).toEqual(['app','deployment','server','database']);expect(JSON.stringify(data)).not.toContain('storageDir');expect(JSON.stringify(data)).not.toContain('apiKey');});
it('identifies missing application registration without exposing upstream internals',async()=>{const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({success:false,message:'应用不存在'}),{status:404}));await expect(sendFeedbackRequest('/tickets',{}, {fetch:fetcher,resolveIdentity:()=>({headers:{},clientId:null,deviceId:null,localKey:'test'})})).rejects.toThrow('统一反馈服务尚未登记家藏');});
it('records successful device-id transmission without retaining its raw value',async()=>{const {getFeedbackTransportStatus}=await import('../../packages/server/services/feedback-remote.service');const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({success:true,data:{items:[],total:0}})));await sendFeedbackRequest('/tickets',{}, {fetch:fetcher,resolveIdentity:()=>({headers:{'x-device-id':'private-machine-id'},clientId:null,deviceId:'private-machine-id',localKey:'private-machine-id'})});const status=getFeedbackTransportStatus();expect(status?.deviceIdSent).toBe(true);expect(status?.status).toBe(200);expect(JSON.stringify(status)).not.toContain('private-machine-id');});

afterEach(()=>vi.unstubAllEnvs());
it('uses device identity exclusively on fnOS even when a client id is already stored',async()=>{
 vi.stubEnv('NODE_ENV','production');
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE app_settings(setting_key TEXT PRIMARY KEY,value_json TEXT)');
 const oldId='A'.repeat(43);db.prepare('INSERT INTO app_settings VALUES (?,?)').run('x-client-id',JSON.stringify(oldId));
 const machineId='fnos-device-test-0001';const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({success:true,data:{items:[]}})));
 try{
  const identity=resolveFeedbackAppsIdentity(db,{machineId});
  expect(identity.localKey).toBe(machineId);expect(identity.clientId).toBeNull();
  await sendFeedbackRequest('/tickets',{}, {fetch:fetcher,resolveIdentity:()=>identity});
  const headers=fetcher.mock.calls[0][1].headers;
  expect(headers['x-device-id']).toBe(machineId);expect(headers).not.toHaveProperty('x-client-id');expect(headers).not.toHaveProperty('x-debug');
  expect(db.prepare('SELECT value_json FROM app_settings WHERE setting_key=?').get('x-client-id')?.value_json).toBe(JSON.stringify(oldId));
  const {getFeedbackTransportStatus}=await import('../../packages/server/services/feedback-remote.service');
  expect(getFeedbackTransportStatus()).toMatchObject({deviceIdSent:true,clientIdSent:false,status:200});
 }finally{db.close();}
});
it('does not read a malformed old client identity when a valid fnOS device identity is present',()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE app_settings(setting_key TEXT PRIMARY KEY,value_json TEXT)');db.prepare('INSERT INTO app_settings VALUES (?,?)').run('x-client-id','broken-json');
 try{expect(resolveFeedbackAppsIdentity(db,{machineId:'fnos-device-test-0002'}).headers).toEqual({'x-app-id':'fnos-app-family-stock','x-device-id':'fnos-device-test-0002'});}finally{db.close();}
});
