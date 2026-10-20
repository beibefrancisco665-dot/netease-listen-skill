import fs from 'node:fs';import path from 'node:path';import http from 'node:http';
export const BASE='netease-listen-together',REVIEW='netease-song-review';
const actions={
 [BASE]:new Set(['search','join','create','push','choose','like','favorites','next','mode','auto-mode','mode-state','control','state','context','leave','invitation-status','suspend']),
 [REVIEW]:new Set(['context','watch','preference','favorites','search','inspect','auto-like','auto-like-search'])
};
export function localHttp(url,{method='GET',headers={},body,signal}={}){
 return new Promise((resolve,reject)=>{
  if(signal?.aborted)return reject(signal.reason||new Error('请求已取消'));
  const req=http.request(url,{method,headers},res=>{const chunks=[];let size=0;res.on('data',chunk=>{size+=chunk.length;if(size>4*1024*1024){req.destroy(new Error('本机响应超过读取上限'));return;}chunks.push(chunk);});res.on('end',()=>{const status=res.statusCode||500;if(status>=300&&status<400)return reject(new Error('本机接口不允许重定向'));resolve(new Response(Buffer.concat(chunks),{status,headers:{'content-type':'application/json; charset=utf-8'}}));});res.on('error',reject);});
  const abort=()=>req.destroy(signal.reason||new Error('请求已取消'));signal?.addEventListener('abort',abort,{once:true});
  req.setTimeout(45000,()=>req.destroy(new Error('本机接口请求超时')));req.on('error',reject);req.on('close',()=>signal?.removeEventListener('abort',abort));if(body)req.write(body);req.end();
 });
}
export function createBroker({dataDir,getConfig,settingsOf,isActive,transport=localHttp,now=Date.now}){
 let closed=false;const controllers=new Set();
 const live=()=>{if(closed)throw Error('网易云本机适配已停用');};
 const chats=s=>String(s.allowedChats||'').split(/[\s,，]+/).filter(Boolean);
 function consoleBase(){const raw=fs.readFileSync(path.join(dataDir,'console-port'),'utf8').trim(),p=Number(raw);if(!/^\d+$/.test(raw)||!Number.isInteger(p)||p<1024||p>65535)throw Error('当前实例端口未就绪');return 'http://127.0.0.1:'+p;}
 async function send(url,init){live();const c=new AbortController();controllers.add(c);try{return await transport(url,{...init,signal:AbortSignal.any([c.signal,...(init.signal?[init.signal]:[])] )});}finally{controllers.delete(c);}}
 const hostHeaders=()=>({origin:consoleBase(),...(getConfig().server?.token?{'x-console-token':getConfig().server.token}:{})});
 async function panel(route,init={}){return send(consoleBase()+route,{...init,headers:{...hostHeaders(),...(init.body?{'content-type':'application/json'}:{})}});}
 async function identity(signal){const r=await panel('/api/status',{signal});if(!r.ok)throw Error('无法核验当前QQA实例');const s=await r.json();if(path.resolve(s.dataDir||'').toLowerCase()!==path.resolve(dataDir).toLowerCase())throw Error('控制台实例身份不匹配');return s;}
 function permitChat(skillId,chatKey){const cfg=getConfig(),[kind,id]=String(chatKey).split(':');if(!/^(private|group):[1-9]\d{0,19}$/.test(chatKey)||!chats(settingsOf(skillId)).includes(chatKey))throw Error('网易云会话未授权');const allow=cfg.allow?.[kind]??cfg.allow?.[kind+'s']??[],deny=cfg.deny?.[kind]??cfg.deny?.[kind+'s']??[];if(!Array.isArray(allow)||!Array.isArray(deny)||deny.map(String).includes(id)||(allow.length?!allow.map(String).includes(id):cfg.allowAllWhenEmpty!==true))throw Error('QQA会话权限已撤销');}
 async function fetchLocal({skillId,url,init={}}={}){
  live();if(!Object.hasOwn(actions,skillId))throw Error('本机适配仅供网易云模块使用');
  const u=new URL(String(url));if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!u.port||u.username||u.password||u.hash)throw Error('本机适配拒绝该地址');
  const method=String(init.method||'GET').toUpperCase(),headers=new Headers(init.headers||{}),body=init.body===undefined?undefined:String(init.body);
  if(body&&Buffer.byteLength(body)>16384)throw Error('网易云本机请求过长');
  const settings=settingsOf(skillId),bridge=new URL(settings.bridgeUrl||'http://127.0.0.1:32630');
  if(bridge.protocol!=='http:'||bridge.hostname!=='127.0.0.1'||!bridge.port||bridge.pathname!=='/'||bridge.username||bridge.password||bridge.search||bridge.hash)throw Error('网易云桥接地址无效');
  const bridgeAction=u.origin===bridge.origin&&u.pathname.startsWith('/v1/')?u.pathname.slice(4):null;
  if(bridgeAction){
   if(u.search||method!=='POST'||!actions[skillId].has(bridgeAction))throw Error('网易云桥接操作不在授权范围');
   if(!settings.bridgeToken||headers.get('authorization')!=='Bearer '+settings.bridgeToken)throw Error('网易云连接密钥不匹配');
   const cleanup=bridgeAction==='suspend';if(!cleanup&&!isActive(skillId))throw Error('网易云模块未启用');
   if(!cleanup){let input;try{input=JSON.parse(body||'{}');}catch{throw Error('网易云请求不是JSON');}permitChat(skillId,input.chatKey);const status=await identity(init.signal);if(status.paused||status.orchestrator?.paused||!status.onebot?.connected||String(status.onebot.self?.userId)!==String(input.botId))throw Error('QQA已暂停、离线或机器人身份变化');}
   return send(bridge.origin+u.pathname,{method,headers:{'content-type':'application/json',authorization:'Bearer '+settings.bridgeToken},body,signal:init.signal});
  }
  if(!isActive(skillId))throw Error('网易云模块未启用');
  const port=Number(u.port),actual=Number(new URL(consoleBase()).port);if(![3210,Number(getConfig().server?.port),actual].includes(port))throw Error('控制台地址不属于当前实例');
  const route=u.pathname+u.search;
  const publicRead=['/api/status','/api/config','/api/skills','/api/chats'].includes(route);
  const history=u.pathname.match(/^\/api\/chats\/private_([1-9]\d{0,19})\/messages$/);
  if(method==='GET'&&(publicRead||history&&/^\?limit=(?:20|1000)$/.test(u.search))){if(history)permitChat(skillId,'private:'+history[1]);const status=await identity(init.signal);if(route==='/api/status')return new Response(JSON.stringify(status),{headers:{'content-type':'application/json'}});return panel(route,{signal:init.signal});}
  const recipient=u.pathname.match(/^\/api\/chats\/private_([1-9]\d{0,19})\/test-send$/);
  if(method==='POST'&&recipient&&!u.search){
   const chatKey='private:'+recipient[1];permitChat(skillId,chatKey);const status=await identity(init.signal),cfg=getConfig();
   if(status.paused||status.orchestrator?.paused||!status.onebot?.connected||cfg.tools?.enabled===false||cfg.tools?.categories?.messaging===false||cfg.tools?.overrides?.send_message===false)throw Error('QQA当前不允许发送');
   let payload;try{payload=JSON.parse(body||'{}');}catch{throw Error('消息格式无效');}
   if(Object.keys(payload).some(k=>k!=='text')||typeof payload.text!=='string'||!payload.text.trim()||payload.text.length>500||/\[CQ:/i.test(payload.text))throw Error('消息超出网易云文本范围');
   const historyReply=await panel(`/api/chats/private_${recipient[1]}/messages?limit=1000`,{signal:init.signal});if(!historyReply.ok)throw Error('无法核验发送限额');const messages=(await historyReply.json()).messages;if(!Array.isArray(messages))throw Error('无法核验发送记录');const sent=messages.filter(m=>m.self===true);if(sent.filter(m=>now()-m.ts<60000).length>=Math.max(1,Number(cfg.send?.maxPerMinute)||80)||sent.filter(m=>now()-m.ts<3600000).length>=Math.max(1,Number(cfg.send?.maxPerHour)||80))throw Error('QQA发送限额已用完');
   return panel(route,{method:'POST',body:JSON.stringify({text:payload.text}),signal:init.signal});
  }
  throw Error('控制台接口不在网易云本机白名单');
 }
 return {fetch:fetchLocal,consoleBase,close(){closed=true;for(const c of controllers)c.abort();}};
}
