// Prove the menu survives a controller crash (the bug that left a dead menu entry).
const {execFileSync}=require('node:child_process'),{spawn}=require('node:child_process'),path=require('node:path'),fs=require('node:fs'),os=require('node:os');
const home=process.env.DSH_HOME||path.join(os.homedir(),'.dsh'),base='http://127.0.0.1:3080/dsh-pet-7340';
const ps=cmd=>execFileSync('powershell',['-NoProfile','-Command',cmd],{encoding:'utf8',windowsHide:true});
const controllerPid=()=>{const out=ps('(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq "node.exe" -and $_.CommandLine -like "*scripts*menu.cjs*" }).ProcessId');return Number(String(out).trim().split(/\s+/)[0])||0;};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function menuAlive(){try{const r=await fetch(base+'/menu/events?owner=dsh-tableball&wait=0');return r.status===200;}catch{return false;}}
(async()=>{
 const before=controllerPid();if(!before)throw Error('controller not running');
 ps('Stop-Process -Id '+before+' -Force');
 let after=0;for(let i=0;i<40;i++){await delay(250);after=controllerPid();if(after&&after!==before)break;}
 if(!after||after===before)throw Error('supervisor did not restart controller');
 let ok=false;for(let i=0;i<40;i++){if(await menuAlive()){ok=true;break;}await delay(250);}
 if(!ok)throw Error('menu not re-registered after restart');
 console.log('PASS: killed controller '+before+' -> supervisor restarted '+after+' and menu re-registered.');
})().catch(e=>{console.error(e);process.exitCode=1;});
