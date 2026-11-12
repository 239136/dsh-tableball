// Real public menu API round trip; exits the game at the end.
const assert=require('node:assert/strict');const {execFileSync}=require('node:child_process');
const base='http://127.0.0.1:3080/dsh-pet-7340';
async function api(route,body){const r=await fetch(base+route,{method:body?'POST':'GET',headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const v=await r.json();assert.notEqual(v.ok,false,JSON.stringify(v));return v;}
const count=()=>Number(execFileSync('powershell',['-NoProfile','-Command',"@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'electron.exe' -and $_.CommandLine -like '*tableball*runtime*main.cjs*' }).Count"],{encoding:'utf8',windowsHide:true}).trim());
const menu=async()=>((await api('/state')).sections.menu.data.items).filter(i=>i.owner==='dsh-tableball').map(i=>i.label);
async function until(test){const end=Date.now()+12000;while(Date.now()<end){if(await test())return;await new Promise(r=>setTimeout(r,150));}throw Error('menu transition timeout');}
(async()=>{assert.equal(count(),0,'idle must not launch game process');assert.deepEqual(await menu(),['进入台球模式']);
 assert.equal((await api('/menu/click',{owner:'dsh-tableball',label:'进入台球模式',pet:'main'})).delivered,true);
 await until(async()=>count()===1&&(await menu()).includes('退出台球模式'));
 assert.equal((await api('/menu/click',{owner:'dsh-tableball',label:'退出台球模式',pet:'main'})).delivered,true);
 await until(async()=>count()===0&&(await menu()).includes('进入台球模式'));
 console.log('PASS: idle has no game process; menu enter launches one; menu exit removes it and returns entry.');
})().catch(e=>{console.error(e);process.exitCode=1;});
