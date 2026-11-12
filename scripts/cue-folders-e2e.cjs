const {launchGame}=require('../runtime/launch-game.cjs');
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawn,execFileSync}=require('node:child_process'),{randomUUID}=require('node:crypto');
const {send}=require('../runtime/control-pipe.cjs');const {captureDesktopFolders}=require('../runtime/desktop-folders.cjs');
const home=process.env.DSH_HOME||path.join(os.homedir(),'.dsh');const file=path.join(home,'tableball/status.json');
const read=()=>JSON.parse(fs.readFileSync(file,'utf8'));const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const comparable=s=>s.folders.map(f=>({id:f.id,x:f.x,y:f.y})).sort((a,b)=>a.id.localeCompare(b.id));
async function until(predicate,ms=20000){const end=Date.now()+ms;while(Date.now()<end){try{const value=read();if(await predicate(value))return value;}catch{}await sleep(80);}throw Error('等待真实球台状态超时');}
(async()=>{
 const before=await captureDesktopFolders();const env={...process.env,TABLEBALL_CONTROL_PIPE:'\\\\.\\pipe\\tableball-e2e-'+randomUUID(),TABLEBALL_HOST_PID:String(process.pid)};delete env.ELECTRON_RUN_AS_NODE;
 const start=Date.now();const child=(await launchGame({electron:path.join(home,'electron/electron.exe'),entry:path.join(__dirname,'../runtime/main.cjs'),env})).child;
 let exited=false;child.once('exit',()=>{exited=true;});
 try{
  let s=await until(s=>Date.parse(s.updatedAt)>start&&s.cue);
  await send(env.TABLEBALL_CONTROL_PIPE,'set:'+JSON.stringify({key:'controlMode',value:'cue'}));
  s=await until(s=>s.settings.controlMode==='cue'&&s.cue&&s.mouseThrough===false);
  assert.ok(Math.abs(s.cue.radius-s.radius)<.001,'母球必须与彩球同样大小');
  const shots=s.shots;
  execFileSync('powershell',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'charge-mouse.ps1'),'-X',String(Math.round(s.work.x+Math.max(30,s.cue.x-220))),'-Y',String(Math.round(s.work.y+s.cue.y))],{windowsHide:true,timeout:20000});
  s=await until(s=>s.shots>shots);assert.ok(s.shots>shots,'真实鼠标蓄力松手必须调用桌宠击球');
  await send(env.TABLEBALL_CONTROL_PIPE,'set:'+JSON.stringify({key:'ballMode',value:'folders'}));
  s=await until(s=>s.settings.ballMode==='folders'&&s.totalBalls>0);
  assert.equal(s.totalBalls,new Set(before.folders.map(f=>f.id)).size);
  assert.ok(s.balls.every(b=>b.home&&typeof b.name==='string'));
  execFileSync('powershell',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'capture-game.ps1')],{windowsHide:true,timeout:15000});
  await send(env.TABLEBALL_CONTROL_PIPE,'reset');await sleep(250);
  await send(env.TABLEBALL_CONTROL_PIPE,'settings');await sleep(600);
  execFileSync('powershell',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'capture-game.ps1'),'-Output','cue-settings-check.png'],{windowsHide:true,timeout:15000});
  await send(env.TABLEBALL_CONTROL_PIPE,'exit');for(let i=0;i<100&&!exited;i++)await sleep(25);assert.equal(exited,true,'必须快速退出');
  const after=await captureDesktopFolders();assert.deepEqual(comparable(after),comparable(before),'真实桌面文件夹名称、身份、位置必须完全不变');
  console.log(JSON.stringify({result:'PASS',chargedShot:true,folders:s.totalBalls,positionsExact:before.positionsExact,desktopUnchanged:true,exitClean:true}));
 }finally{if(!exited){try{await send(env.TABLEBALL_CONTROL_PIPE,'exit');}catch{child.kill();}}}
})().catch(e=>{console.error(e);process.exitCode=1;});
