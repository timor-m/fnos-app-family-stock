import { createError, defineEventHandler, getHeader, getQuery, getRouterParam, setHeader } from 'h3';
import { getRequestUser } from '../../../utils/request-user';
import { ok } from '../../../utils/api-response';
import { sendFeedbackRequest } from '../../../services/feedback-remote.service';
import { feedbackEnvironment } from '../../../services/about.service';

export default defineEventHandler(async event=>{
  const user=getRequestUser(event);
  if(process.env.FNOS_SOCKET_PATH && !user.isGatewayAuthenticated) throw createError({statusCode:401,statusMessage:'请先登录应用'});
  setHeader(event,'Cache-Control','private, no-store');
  const path='/'+(getRouterParam(event,'path')||'');
  const ticket='[BSO]\\d{4,20}|FB-\\d{4}-\\d{6,20}';
  if(event.req.method==='GET') {
    if(/^\/attachments\/[1-9]\d{0,15}$/.test(path)) {
      const image=await sendFeedbackRequest(path,{image:true}) as {bytes:Buffer;mimeType:string};
      return new Response(new Uint8Array(image.bytes),{headers:{'Content-Type':image.mimeType,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
    }
    if(path!=='/tickets' && !new RegExp(`^/tickets/(${ticket})$`).test(path)) throw createError({statusCode:404,statusMessage:'反馈接口不存在'});
    const params=new URLSearchParams();
    for(const [key,value] of Object.entries(getQuery(event))) {
      if(!['page','pageSize','q','number','eventPage','eventPageSize'].includes(key)||typeof value!=='string'||value.length>120) throw createError({statusCode:400,statusMessage:'查询参数无效'});
      if(['page','pageSize','eventPage','eventPageSize'].includes(key)&&(!/^\d+$/.test(value)||Number(value)<1||Number(value)>10000)) throw createError({statusCode:400,statusMessage:'分页参数无效'});
      params.set(key,value);
    }
    return ok(await sendFeedbackRequest(path+(params.size?'?'+params:'')));
  }
  if(event.req.method!=='POST'||!(path==='/upload'||path==='/tickets'||new RegExp(`^/tickets/(${ticket})/(messages|resolution)$`).test(path))) throw createError({statusCode:404,statusMessage:'反馈接口不存在'});
  const origin=getHeader(event,'origin');
  if(origin && new URL(origin).host!==(getHeader(event,'host') || new URL(event.req.url).host)) throw createError({statusCode:403,statusMessage:'请求来源无效'});
  const key=getHeader(event,'idempotency-key')||'';
  if(!/^[A-Za-z0-9_-]{8,80}$/.test(key)) throw createError({statusCode:400,statusMessage:'缺少有效请求标识'});
  const limit=path==='/upload'?10*1024*1024+65536:65536;
  const reader=event.req.body?.getReader();const chunks:Uint8Array[]=[];let size=0;
  if(reader) {try {while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw createError({statusCode:413,statusMessage:'反馈内容过大'});}chunks.push(value);}}finally{reader.releaseLock();}}
  const bytes=new Uint8Array(Buffer.concat(chunks));
  if(path==='/upload') {
    let form:FormData;
    try {form=await new Response(bytes,{headers:{'content-type':getHeader(event,'content-type')||''}}).formData();}catch{throw createError({statusCode:400,statusMessage:'附件格式无效'});}
    const file=form.get('file');
    if(!(file instanceof File)||!['image/png','image/jpeg','image/webp','application/pdf'].includes(file.type)||file.size===0||file.size>10*1024*1024) throw createError({statusCode:400,statusMessage:'请选择 10 MB 以内的 JPG、PNG、WebP 或 PDF'});
    const body=new FormData();body.set('appKey','family-stock');body.set('file',file,'attachment.'+({'image/png':'png','image/jpeg':'jpg','image/webp':'webp','application/pdf':'pdf'}[file.type]));
    const result=await sendFeedbackRequest(path,{method:'POST',key,body}) as {id:number};return ok({id:result.id});
  }
  if(!getHeader(event,'content-type')?.startsWith('application/json')) throw createError({statusCode:415,statusMessage:'请求格式无效'});
  let body:Record<string,unknown>;
  try {body=JSON.parse(Buffer.from(bytes).toString());if(!body||typeof body!=='object'||Array.isArray(body))throw Error();}catch{throw createError({statusCode:400,statusMessage:'反馈格式无效'});}
  const allowed=path==='/tickets'?['title','category','description','reproductionSteps','attachmentIds','environment']:path.endsWith('/messages')?['content','attachmentIds']:['action','expectedVersion','content'];
  if(Object.keys(body).some(k=>!allowed.includes(k))) throw createError({statusCode:400,statusMessage:'反馈包含不支持的字段'});
  if(body.attachmentIds !== undefined && (!Array.isArray(body.attachmentIds)||body.attachmentIds.length>5||body.attachmentIds.some(id=>!Number.isSafeInteger(id)||Number(id)<1))) throw createError({statusCode:400,statusMessage:'附件参数无效'});
  if(body.content !== undefined && (typeof body.content!=='string'||body.content.length>10000)) throw createError({statusCode:400,statusMessage:'补充说明格式无效'});
  if(path.endsWith('/resolution') && (!['confirm','reopen'].includes(String(body.action))||!Number.isSafeInteger(body.expectedVersion)||Number(body.expectedVersion)<1)) throw createError({statusCode:400,statusMessage:'反馈版本或操作无效，请刷新进度'});
  if(path==='/tickets') {if(typeof body.title!=='string'||!body.title.trim()||body.title.length>120||typeof body.description!=='string'||!body.description.trim()||body.description.length>10000||!['problem','suggestion','other'].includes(String(body.category)))throw createError({statusCode:400,statusMessage:'请填写有效标题、分类和描述'});body.appKey='family-stock';body.environment=feedbackEnvironment();}
  return ok(await sendFeedbackRequest(path,{method:'POST',key,json:true,body:JSON.stringify(body)}));
});
