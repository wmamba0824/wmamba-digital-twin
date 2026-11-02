import { createHash } from 'node:crypto';
import { createPersonaService,PublicError } from './lib/server/persona-service.mjs';
import { createDeepSeekTransport } from './lib/server/deepseek-transport.mjs';
import { checkProviderConnection } from './lib/server/provider-connection.mjs';
import { handleRequest } from './lib/server/http-handler.mjs';
import { createCloudbaseTrialGate } from './budget.mjs';
const FRONTEND='https://wmamba0824.github.io';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function createCloudbaseHandler({corpus,db,env,fetchImpl=(...args)=>fetch(...args)}){
 const origin=env.APP_PUBLIC_ORIGIN||'',prefix=env.API_PATH_PREFIX||'/persona';
 const parsed=new URL(origin);if(parsed.protocol!=='https:'||!['.app.tcloudbase.com','.service.tcloudbase.com','.run.tcloudbase.com'].some(suffix=>parsed.hostname.endsWith(suffix))||parsed.origin!==origin||!/^\/[a-z0-9-]+$/.test(prefix))throw new Error('Configure the exact CloudBase gateway origin and path prefix.');
 let cache;
 const connection=async()=>{if(cache?.until>Date.now())return cache.result;const result=await checkProviderConnection({apiKey:env.DEEPSEEK_API_KEY,fetchImpl});cache={until:Date.now()+60000,result};return result;};
 const configured=env.PERSONA_AI_ENABLED==='true'&&!!env.DEEPSEEK_API_KEY?.trim()&&!!db;
 return async event=>{
  let allowCors=false;
  const finish=(body,status=200)=>({statusCode:status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',Vary:'Origin',...(allowCors?{'Access-Control-Allow-Origin':FRONTEND,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, X-Persona-Visitor'}:{})},body:JSON.stringify(body),isBase64Encoded:false});
  try{
   const headers=new Headers(event?.headers||{}),method=String(event?.httpMethod||'').toUpperCase(),path=event?.path;
   if(headers.get('origin')!==FRONTEND)return finish({code:'ORIGIN_DENIED',message:'请从正式数字分身页面使用。'},403);allowCors=true;
   if(typeof path!=='string'||!(path===prefix||path.startsWith(prefix+'/')))return finish({code:'NOT_FOUND'},404);
   const route=path.slice(prefix.length)||'/';if(!['/api/status','/api/search','/api/chat'].includes(route))return finish({code:'NOT_FOUND'},404);
   if(method==='OPTIONS'){const allowed=headers.get('access-control-request-method'),requested=(headers.get('access-control-request-headers')||'').toLowerCase().split(',').map(v=>v.trim()).filter(Boolean);if(!['GET','POST'].includes(allowed)||requested.some(v=>!['content-type','x-persona-visitor'].includes(v)))return finish({code:'ORIGIN_DENIED'},403);const response=finish(null,204);response.body='';return response;}
   const id=headers.get('x-persona-visitor');if(!UUID.test(id||''))return finish({code:'VISITOR_UNAVAILABLE',message:'浏览器标识不可用，请刷新页面。'},400);
   const subject=createHash('sha256').update('wmamba-persona-browser-v2:'+id.toLowerCase()).digest('hex'),gate=db?createCloudbaseTrialGate(db,subject):null;
   const paid=async messages=>{if(!(await connection()).ok)throw new PublicError('MODEL_CONNECTION_UNAVAILABLE','模型连接检查未通过，未发送生成请求，不扣次数。',503);let lease;const transport=createDeepSeekTransport({apiKey:env.DEEPSEEK_API_KEY,model:'deepseek-flash',enabled:configured,approvedCallBudget:10,reserveCall:async()=>{lease=await gate.reserve();return true;},fetchImpl});try{return await transport(messages);}finally{if(lease)await gate.release(lease);}};
   const service=createPersonaService({corpus,enabled:configured,transport:configured?paid:null});
   if(route==='/api/status'&&method==='GET'){if(!gate)throw new PublicError('BUDGET_UNAVAILABLE','额度数据库未接通，AI暂停。',503);const budget=await gate.status();return finish({...service.status(),loginRequired:false,mode:'anonymous-browser-ten-global-hundred',aiEnabled:configured&&!budget.paused&&!budget.personal.paused,budget});}
   const raw=event.body??'';if(typeof raw!=='string'||Buffer.byteLength(raw)>24000)return finish({code:'TOO_LARGE',message:'请求过大。'},413);
   const body=event.isBase64Encoded?Buffer.from(raw,'base64'):Buffer.from(raw,'utf8');if(body.length>16000)return finish({code:'TOO_LARGE',message:'请求过大。'},413);
   const forwarded=new Headers(headers);forwarded.set('origin',origin);
   const request=new Request(origin+route,{method,headers:forwarded,...(!['GET','HEAD'].includes(method)?{body}:{})});
   const response=await handleRequest(request,{service,allowedOrigin:origin});return finish(await response.json(),response.status);
  }catch(e){return finish({aiEnabled:false,code:e instanceof PublicError?e.code:'SERVICE_UNAVAILABLE',message:e instanceof PublicError?e.message:'服务暂不可用，未自动重试。'},e instanceof PublicError?e.status:503);}
 };
}
