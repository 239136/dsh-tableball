const {execFileSync}=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {PetBridge}=require('../runtime/pet-bridge.cjs');const home=path.join(os.homedir(),'.dsh'),base='http://127.0.0.1:3080/dsh-pet-7340';
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const output=execFileSync(path.join(home,'electron/electron.exe'),[path.join(__dirname,'display-info.cjs')],{env,encoding:'utf8',windowsHide:true});
const displays=JSON.parse(output.split(/\r?\n/).find(l=>l.startsWith('TABLEBALL_DISPLAYS=')).slice('TABLEBALL_DISPLAYS='.length));
const target=displays.find(d=>d.workArea.x!==0);if(!target)throw Error('本验证需要副屏');
const b=new PetBridge({base});const status=path.join(home,'tableball/status.json');const before=()=>JSON.parse(fs.readFileSync(status,'utf8'));
const menus=async()=>((await b.request('/state')).sections.menu.data.items).filter(i=>i.owner==='dsh-tableball').map(i=>i.label);
const click=label=>b.request('/menu/click','POST',{owner:'dsh-tableball',label,pet:'main'});
async function until(fn){const deadline=Date.now()+15000;while(Date.now()<deadline){if(await fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('等待状态超时');}
(async()=>{const original=(await b.request('/config')).main;const a=target.workArea;
 await b.position({x:a.x+a.width/2,y:a.y+a.height/2},displays,'main');await new Promise(r=>setTimeout(r,500));
 await click('进入台球模式');await until(()=>{const s=before();return Date.now()-Date.parse(s.updatedAt)<1500&&s.lockedDisplayId===target.id;});
 const s=before();assert.equal(s.work.x,a.x);assert.equal((await b.request('/config')).main.confineToScreen,true);
 // Throw toward the monitor seam from inside the selected secondary screen.
 await b.position({x:a.x+150,y:a.y+a.height*.5},displays,'main');
 await b.request('/throw?surface=desktop&pet=main','POST',{angle:180,power:3});
 await new Promise(r=>setTimeout(r,1500));const after=before();assert.equal(after.lockedDisplayId,target.id);assert.equal(after.work.x,a.x);if(after.cue)assert.ok(after.cue.x>=0&&after.cue.x<=a.width,'cue crossed locked display');
 const started=performance.now();await click('退出台球模式');await until(async()=>(await menus()).includes('进入台球模式'));const exitMs=Math.round(performance.now()-started);
 await until(async()=>{const m=(await b.request('/config')).main;return m.confineToScreen===original.confineToScreen&&m.physics.gravity===original.physics.gravity;});
 console.log(JSON.stringify({result:'PASS',lockedDisplayId:target.id,work:a,observedCue:after.cue,exitMs,restored:true}));
})().catch(async e=>{console.error(e);try{await click('退出台球模式');}catch{}process.exitCode=1;});
