export function createLocalRequest(api,skillId){
 return async(url,init={})=>{
  const u=new URL(String(url));
  if(u.hostname==='127.0.0.1'){
   if(!api.capability)throw Error('网易云本机适配未安装，请检查netease-local-adapter');
   const response=await api.capability('netease.local.fetch',{skillId,url:String(url),init});
   if(!response||typeof response.json!=='function')throw Error('网易云本机适配未启用');
   return response;
  }
  return api.fetch(url,init);
 };
}
