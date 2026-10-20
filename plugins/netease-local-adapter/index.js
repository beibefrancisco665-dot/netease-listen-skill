import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';
import {DATA_DIR,getConfig} from '../../src/config.js';
import {createBroker,localHttp} from './broker.mjs?v=1.0.0';
import {nodeCommand} from './launch.mjs?v=1.0.1';
const state=globalThis[Symbol.for('qqa.netease.local-service.v1')] ||= {child:null,starting:null,lastStart:0,last:'未检查'};
let api,broker,timer,closed=true;
const settingsOf=id=>getConfig().skills?.[id]||{};
export function setup(a){api=a;broker=createBroker({dataDir:DATA_DIR,getConfig,settingsOf,isActive:id=>api.isSkillActive(id)});}
async function health(){try{const cfg=settingsOf('netease-listen-together'),u=new URL(cfg.bridgeUrl);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!u.port||u.pathname!=='/'||u.username||u.password||u.search||u.hash)return false;const r=await localHttp(u.origin+'/health',{signal:AbortSignal.timeout(2000)});const j=await r.json();return r.ok&&j.ok===true&&j.service==='qqa-netease-together'&&path.resolve(j.hostDataDir||'').toLowerCase()===path.resolve(DATA_DIR).toLowerCase();}catch{return false;}}
async function maintain(){
 if(closed||api.config().autoStartBridge===false)return;
 if(await health()){state.last='本机音乐桥接在线';return;}
 if(closed||api.config().autoStartBridge===false||state.starting||state.child&&!state.child.killed||Date.now()-state.lastStart<120000)return;
 const root=path.join(DATA_DIR,'netease-bridge'),entry=path.join(root,'src/server.mjs');
 if(!fs.existsSync(entry)||!fs.existsSync(path.join(root,'runtime/1014_qqa专用会话_v2.json'))){state.last='桥接文件或专用会话缺失';return;}
 state.lastStart=Date.now();state.last='正在启动本机音乐桥接';
 state.starting=(async()=>{fs.mkdirSync(path.join(root,'logs'),{recursive:true});const log=fs.openSync(path.join(root,'logs/bridge.log'),'a');try{const nodeExe=nodeCommand(api.config());const child=spawn(nodeExe,[entry],{cwd:root,windowsHide:true,env:{...process.env,ELECTRON_RUN_AS_NODE:'1',QQA_HOST_DATA_DIR:DATA_DIR,QQA_BRIDGE_NO_ROOM_RESTORE:'1'},stdio:['ignore',log,log]});state.child=child;child.once('exit',()=>{if(state.child===child){state.child=null;state.last='桥接进程已结束，等待下次检查';}});child.on('error',()=>{state.last='桥接进程启动失败，请检查Node路径和桥接依赖';});child.unref();}finally{fs.closeSync(log);}})().finally(()=>state.starting=null);
 await state.starting;
}
function arm(){if(closed||timer)return;timer=setTimeout(async()=>{timer=null;try{await maintain();}finally{arm();}},60000);timer.unref?.();}
export function activate(){closed=false;maintain().catch(()=>{state.last='桥接检查暂不可用';});arm();}
export function deactivate(context={}){closed=true;clearTimeout(timer);timer=null;broker?.close();if(context.reason!=='reload'&&state.child){state.child.kill();state.child=null;}}
export function dispose(){closed=true;clearTimeout(timer);timer=null;broker?.close();}
export const providers={
 'netease.local.fetch':input=>{if(closed||api.config().enabled===false)throw Error('网易云本机适配已关闭');return broker.fetch(input);},
 'status.netease-local-adapter':()=>({icon:'🎵',title:'网易云本机通信',priority:50,lines:[['连接',state.last],['控制台',(()=>{try{return broker.consoleBase();}catch{return '等待当前实例端口';}})()]]})
};
