import { createError, getHeader, getRequestURL, type H3Event } from 'h3';
import { getRequestUser } from './request-user';
import { getAppConfig } from './runtime-config';
export function agentManagementUser(event:H3Event) {
 if(getHeader(event,'authorization')) throw createError({statusCode:403,statusMessage:'Agent 凭据不能管理授权或确认操作'});
 const user=getRequestUser(event);
 if(process.env.FNOS_SOCKET_PATH&&!user.isGatewayAuthenticated) throw createError({statusCode:401,statusMessage:'请先通过飞牛登录'});
 if(!['GET','HEAD'].includes(event.method)) {
  const origin=getHeader(event,'origin');
  // A non-simple header requires a CORS preflight for cross-origin browser requests.
  // This service grants no CORS access. fnOS may rewrite both scheme and host.
  const trustedGateway=Boolean(process.env.FNOS_SOCKET_PATH&&user.isGatewayAuthenticated);
  const validOrigin=Boolean(origin&&URL.canParse(origin)&&['https:','http:'].includes(new URL(origin).protocol)&&new URL(origin).origin===origin);
  const devOrigin=process.env.NODE_ENV!=='production'?new URL(process.env.VITE_DEV_SERVER_URL||`http://127.0.0.1:${Number(process.env.WEB_PORT||Number(getAppConfig().appPort)+1)}`).origin:null;
  const allowed=trustedGateway
   ? validOrigin&&getHeader(event,'x-family-stock-request')==='1'&&getHeader(event,'sec-fetch-site')!=='cross-site'
   : Boolean(origin&&(origin===getRequestURL(event).origin||origin===devOrigin));
  if(!allowed||getHeader(event,'sec-fetch-site')==='cross-site') throw createError({statusCode:403,statusMessage:'请从家藏页面提交操作'});
 }
 return user;
}
