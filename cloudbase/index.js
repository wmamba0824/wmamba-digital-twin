// Event function entry. Use CloudBase's injected temporary function credentials.
// No API key is read from clients or stored in this code package.
let running;
exports.main=async(event,context)=>{
 try{
  if(!running){const cloudbase=require('@cloudbase/node-sdk');const fs=require('node:fs');const envId=process.env.CLOUDBASE_ENV_ID||process.env.TCB_ENV||context?.namespace;if(!envId)throw new Error('Missing environment');const app=cloudbase.init({env:envId});const {createCloudbaseHandler}=await import('./handler.mjs');running=createCloudbaseHandler({corpus:JSON.parse(fs.readFileSync(__dirname+'/data/persona-corpus.json','utf8')),db:app.database({throwOnCode:true}),env:process.env});}
  return await running(event);
 }catch{return {statusCode:503,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify({aiEnabled:false,code:'SERVICE_UNAVAILABLE',message:'服务端配置或数据库暂不可用，AI暂停。'})};}
};
