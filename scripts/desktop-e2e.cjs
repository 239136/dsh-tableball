// Opt-in test: moves the real pet into a corner, checks scratch deduction and respawn.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const status=path.join(os.homedir(),'.dsh/tableball/status.json');
const read=()=>JSON.parse(fs.readFileSync(status,'utf8'));
async function main(){const before=read();if(before.paused)throw Error('请先继续球台');if(before.score<=0)throw Error('本测试需已有得分，避免无法观察扣分');
 const wait=new Promise((resolve,reject)=>{const w=fs.watch(path.dirname(status),(_e,file)=>{if(file!==path.basename(status))return;try{const s=read();if(s.score===Math.max(0,before.score-20)&&s.cue&&Math.abs(s.cue.x-s.breakPoint.x)<5&&Math.abs(s.cue.y-s.breakPoint.y)<45){w.close();clearTimeout(timer);resolve(s);}}catch{}});const timer=setTimeout(()=>{w.close();reject(Error('未观察到母球进洞扣分和回位'));},10000);});
 const displays=[{workArea:{x:0,y:0,width:1920,height:1032}},{workArea:{x:1920,y:5,width:2048,height:1104}}];
 const {PetBridge}=require('../runtime/pet-bridge.cjs');const bridge=new PetBridge({base:'http://127.0.0.1:3080/dsh-pet-7340'});
 await bridge.position({x:20,y:20},displays,'main');const after=await wait;console.log(JSON.stringify({result:'PASS',before:before.score,after:after.score,cue:after.cue,remaining:after.remaining}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
