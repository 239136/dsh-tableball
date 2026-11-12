'use strict';
const fs=require('node:fs');const path=require('node:path');
const {createPetFetch}=require('./pet-auth.cjs');
function atomic(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.tmp-'+process.pid;fs.writeFileSync(temp,JSON.stringify(value,null,2));fs.renameSync(temp,file);}
function restore(journal,{retain=false}={}){
 if(!fs.existsSync(journal))return false;
 const j=JSON.parse(fs.readFileSync(journal,'utf8'));if(j.phase==='restored'){if(!retain)fs.unlinkSync(journal);return true;}const current=JSON.parse(fs.readFileSync(j.file,'utf8'));
 for(const [key,value] of Object.entries(j.applied)){
  const actual=key==='physics'?current.physics:current[key];
  if(JSON.stringify(actual)!==JSON.stringify(value))throw Error('桌宠配置已被其他程序修改：保留恢复记录，请手工核对 '+journal);
 }
 for(const key of Object.keys(j.applied)){if(Object.hasOwn(j.original,key))current[key]=j.original[key];else delete current[key];}
 atomic(j.file,current);if(retain)atomic(journal,{...j,phase:'restored'});else fs.unlinkSync(journal);return true;
}
class PetBridge{
 constructor({base,file,journal,env=process.env,runtimeFile=env.TABLEBALL_PET_RUNTIME_FILE,fetchImpl}){this.base=base;this.file=file;this.journal=journal;this.protected=runtimeFile!==undefined;this.fetch=createPetFetch(base,{runtimeFile,env,fetchImpl});}
 async request(suffix,method='GET',body){try{const u=new URL(this.base);if(u.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(u.hostname))throw Error('只允许本机桌宠 API');
  const r=await this.fetch(this.base+suffix,{method,redirect:'error',headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(4000)});
  if(!r.ok)throw Error('桌宠 API HTTP '+r.status);const value=await r.json();if(value?.ok===false||value?.error)throw Error('桌宠拒绝操作：'+JSON.stringify(value));return value;}catch(error){if(this.protected)throw Error('Protected pet API request failed');throw error;}}
 async reload(){return this.request('/reload','POST');}
 async flat(){
  if(fs.existsSync(this.journal))throw Error('已有配置恢复记录，请先恢复');
  const effective=await this.request('/config');const config=JSON.parse(fs.readFileSync(this.file,'utf8'));
  // Fail closed for JSONC instead of silently stripping user comments.
  const applied={physics:{...effective.main.physics,gravity:0,restitution:0.94,groundFriction:0.4,tiltGravity:false},confineToScreen:true};
  const original={};for(const key of Object.keys(applied))if(Object.hasOwn(config,key))original[key]=config[key];
  atomic(this.journal,{file:this.file,original,applied});atomic(this.file,{...config,...applied});
  try{await this.reload();}catch(e){restore(this.journal,{retain:true});throw e;}
 }
 async setSessionMode(flat=false){
  const effective=await this.request('/config');
  const config=JSON.parse(fs.readFileSync(this.file,'utf8'));
  let journal;
  if(fs.existsSync(this.journal)){
   journal=JSON.parse(fs.readFileSync(this.journal,'utf8'));
   if(journal.phase==='restored'||!journal.baselinePhysics)throw Error('先完成上次配置恢复');
   for(const [key,value]of Object.entries(journal.applied))if(JSON.stringify(config[key])!==JSON.stringify(value))throw Error('桌宠配置已被其他程序修改，拒绝覆盖');
  }else{
   const original={};for(const key of ['physics','confineToScreen'])if(Object.hasOwn(config,key))original[key]=config[key];
   journal={file:this.file,original,baselinePhysics:effective.main.physics,applied:{}};
  }
  const physics=flat?{...journal.baselinePhysics,gravity:0,restitution:.94,groundFriction:.4,tiltGravity:false}:{...journal.baselinePhysics};
  journal.applied={physics,confineToScreen:true};
  atomic(this.journal,journal);atomic(this.file,{...config,...journal.applied});
  try{await this.reload();}catch(error){restore(this.journal,{retain:true});throw error;}
 }
 async recover(){const changed=restore(this.journal,{retain:true});if(changed){await this.reload();fs.unlinkSync(this.journal);}return changed;}
 async position(point,displays,petId){
  const areas=displays.map(d=>d.workArea);const x0=Math.min(...areas.map(a=>a.x)),y0=Math.min(...areas.map(a=>a.y));
  const width=Math.max(...areas.map(a=>a.x+a.width))-x0,height=Math.max(...areas.map(a=>a.y+a.height))-y0;
  return this.request('/position?surface=desktop&pet='+encodeURIComponent(petId),'POST',{x:(point.x-x0)/width,y:(point.y-y0)/height,mode:'instant'});
 }
}
module.exports={PetBridge,restore,atomic};
