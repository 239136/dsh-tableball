'use strict';
// Supervisor: keeps exactly one menu controller alive, independent of any terminal.
// If another controller (e.g. the one the DSH plugin starts) owns the menu, we stand
// by instead of spawning a competitor and fighting over the same menu events.
const {spawn}=require('node:child_process'),path=require('node:path'),fs=require('node:fs'),os=require('node:os');
const home=process.env.DSH_HOME||path.join(os.homedir(),'.dsh');
const dir=path.join(home,'tableball');fs.mkdirSync(dir,{recursive:true});
const stopFile=path.join(dir,'menu-stop'),logFile=path.join(dir,'menu-daemon.log'),leaseFile=path.join(dir,'menu-owner.json');
const log=message=>{try{fs.appendFileSync(logFile,new Date().toISOString()+' '+message+'\n');}catch{}};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function alive(pid){try{process.kill(pid,0);return true;}catch{return false;}}
function foreignOwner(){
 try{const {pid,token}=JSON.parse(fs.readFileSync(leaseFile,'utf8'));return alive(pid)?{pid,token}:null;}catch{return null;}
}
(async()=>{
 let mine=null;
 for(;;){
  if(fs.existsSync(stopFile)){log('stop requested');return;}
  if(mine&&!alive(mine))mine=null;
  const other=foreignOwner();
  if(other&&other.pid!==mine){log('standing by; controller pid='+other.pid+' owns menu');await delay(2000);continue;}
  if(mine){await delay(500);continue;}
  const child=spawn(process.execPath,[path.join(__dirname,'menu.cjs')],{stdio:'ignore',windowsHide:true,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}});
  mine=child.pid;log('controller started pid='+child.pid);
  child.on('error',error=>log('spawn failed '+error.message));
  const code=await new Promise(resolve=>child.once('exit',(c,s)=>resolve(c??s)));
  log('controller exited '+code+' restarting');
  mine=null;await delay(1000);
 }
})();
