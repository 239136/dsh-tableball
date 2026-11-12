'use strict';
const {spawn}=require('node:child_process');
const {send}=require('./control-pipe.cjs');
const {createVisibilityBroker}=require('./visibility-broker.cjs');
const {PetBridge,atomic}=require('./pet-bridge.cjs');
const fs=require('node:fs');const {randomUUID}=require('node:crypto');
const OWNER='dsh-tableball';
const ENTER='进入台球模式', EXIT='退出台球模式', SETTINGS='台球设置';
class MenuController {
 constructor({base,electron,entry,env=process.env,launch=spawn,log=console.error,leaseFile,sendCommand=send,brokerFactory=createVisibilityBroker}) {
  this.bridge=new PetBridge({base});this.electron=electron;this.entry=entry;
  this.brokerFactory=brokerFactory;this.broker=null;this.brokerClosing=Promise.resolve();this.sendCommand=sendCommand;this.leaseFile=leaseFile;this.token=randomUUID();this.env=env;this.launch=launch;this.log=log;this.child=null;this.closed=false;this.running=false;
 }
 ownsLease(){if(!this.leaseFile)return true;try{return JSON.parse(fs.readFileSync(this.leaseFile,'utf8')).token===this.token;}catch{return false;}}
 /** Another (live) controller already serves this menu: never fight it for the same events. */
 foreignOwner(){if(!this.leaseFile)return false;try{const {pid}=JSON.parse(fs.readFileSync(this.leaseFile,'utf8'));if(pid===process.pid)return false;process.kill(Number(pid),0);return true;}catch{return false;}}
 labels(){return this.child?[EXIT,SETTINGS]:[ENTER];}
 async register(){if(this.closed)return;await this.bridge.request('/menu/item','POST',{owner:OWNER,target:'desktop',labels:this.labels()});}
 async start(pet){
  if(this.closed||this.child)return;
  this.controlPipe=process.platform==='win32'?'\\\\.\\pipe\\tableball-'+randomUUID():require('node:path').join(require('node:os').tmpdir(),'tableball-'+randomUUID()+'.sock');
  await this.brokerClosing;const home=this.env.DSH_HOME||require('node:path').join(require('node:os').homedir(),'.dsh');this.broker=await this.brokerFactory({journal:require('node:path').join(home,'tableball/pet-window-restore.json'),expectedOwner:()=>this.child?.pid,log:this.log,onLost:()=>{if(this.child)void this.sendCommand(this.controlPipe,'exit').catch(this.log);}});
  const env={...this.env,TABLEBALL_PET_ID:pet,TABLEBALL_CONTROL_PIPE:this.controlPipe,TABLEBALL_VISIBILITY_BROKER:this.broker.pipe};delete env.ELECTRON_RUN_AS_NODE;
  const child=this.launch(this.electron,[this.entry],{env,windowsHide:true,stdio:'ignore'});this.child=child;
  child.stdin?.on('error',()=>{});
  const finished=()=>{if(this.child!==child)return;this.child=null;const broker=this.broker;this.broker=null;this.brokerClosing=broker?broker.close():Promise.resolve();if(!this.closed)this.register().catch(this.log);};
  child.once('error',error=>{this.log(error);finished();});child.once('exit',finished);
  await this.register();
 }
 async stop(){
  const child=this.child;if(!child)return;
  await new Promise(resolve=>{
   const timer=setTimeout(()=>{child.kill();},1500);
   const finish=()=>{clearTimeout(timer);resolve();};
   child.once('exit',finish);child.once('error',finish);
   this.sendCommand(this.controlPipe,'exit').catch(error=>{this.log(error);child.kill();});
  });
 }
 async handle(events){
  // Events are the documented {label:petId|null} mapping, not an event array.
  if(events[EXIT])await this.stop();
  else if(events[ENTER])await this.start(events[ENTER]);
  else if(events[SETTINGS]&&this.child){await this.sendCommand(this.controlPipe,'settings').catch(this.log);}
 }
 async run(){
  if(this.running)return;this.running=true;
  if(this.foreignOwner()){this.closed=true;this.running=false;return;}
  if(this.leaseFile)atomic(this.leaseFile,{pid:process.pid,token:this.token});
  let registered=false;
  while(!this.closed){
   if(!this.ownsLease()){this.closed=true;await this.stop();break;}
   try{
    if(!registered){await this.register();registered=true;}
    const result=await this.bridge.request('/menu/events?owner='+OWNER+'&wait=1000');
    if(!this.closed&&this.ownsLease())await this.handle(result.events||{});
   }catch(error){
    if(this.closed)break;this.log(error);registered=false;
    await new Promise(resolve=>{this.retry=setTimeout(resolve,1000);this.wake=resolve;});
   }
  }
 }
 async dispose(){
  if(this.closed)return;this.closed=true;clearTimeout(this.retry);this.wake?.();
  await this.stop();if(this.ownsLease()){await this.bridge.request('/menu/item?owner='+OWNER,'DELETE').catch(this.log);if(this.leaseFile&&this.ownsLease())fs.unlinkSync(this.leaseFile);}
 }
}
module.exports={MenuController,OWNER,ENTER,EXIT,SETTINGS};
