'use strict';
/** TableBall adapter for Rack's Game/snapshot and native TCP state/aim/shoot/place scheme.
 * Upstream Copyright (c) 2026 Nick7612, MIT: vendor/rack/LICENSE.
 * Pinned source: 6383542887caa822296c883e72391adba86ca82c.
 * Only transport/platform, validation, viewport conversion and desktop lifecycle are adapted.
 */
const {EventEmitter}=require('node:events'),{randomBytes}=require('node:crypto'),{performance}=require('node:perf_hooks');
const SCALE=1600/2.54,HEIGHT=800;
const finite=(v,min,max)=>Number.isFinite(v)&&v>=min&&v<=max;
const nickname=v=>String(v||'玩家').replace(/[\x00-\x1f\x7f]/g,'').slice(0,24);
function validateSnapshot(s){
 if(!s||![0,1].includes(s.rules)||![0,1,2,3].includes(s.phase)||![0,1].includes(s.current)||![-1,0,1].includes(s.winner)||![0,1,2].includes(s.group0)||![0,1,2].includes(s.group1)||!Array.isArray(s.balls)||s.balls.length!==(s.rules===1?10:16)||!Array.isArray(s.names)||s.names.length!==2||!Array.isArray(s.cue)||s.cue.length!==2||!finite(s.cue[0],-.1,2.64)||!finite(s.cue[1],-.1,1.37))throw Error('无效的Rack球局快照');
 const ids=new Set(),balls=s.balls.map(b=>{if(!b||!Number.isInteger(b.i)||b.i<0||b.i>(s.rules===1?9:15)||ids.has(b.i)||!finite(b.x,-.2,2.74)||!finite(b.y,-.2,1.47)||typeof b.a!=='boolean')throw Error('无效的Rack球坐标');ids.add(b.i);return {i:b.i,x:b.x,y:b.y,a:b.a};});
 return {rules:s.rules,phase:s.phase,current:s.current,group0:s.group0,group1:s.group1,winner:s.winner,message:String(s.message||'').slice(0,400),breaking:!!s.breaking,names:s.names.map(nickname),balls,cue:[s.cue[0],s.cue[1]]};
}
function roomCode(){const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';return [...randomBytes(6)].map(v=>alphabet[v%alphabet.length]).join('');}
class RackSession extends EventEmitter{
 constructor(module,role,options={}){super();this.module=module;this.role=role;this.localPlayer=role==='host'?0:1;this.names=[nickname(options.name||'房主'),'玩家'];if(role==='guest')this.names=['房主',nickname(options.name)];this.rules=options.rules===0?0:1;this.ready=[true,false];this.phase='lobby';this.connected=false;this.closed=false;this.epoch=0;this.shots=0;this.error='';this.code=role==='host'?(options.code||roomCode()):String(options.code||'');this.address=options.address||'';this.port=options.port??46321;this.addresses=[];this.clock=options.clock||(()=>performance.now());this.lastFrame=0;this.lastAim=-Infinity;this.accumulator=0;this.aims=[{angle:0,power:0,charging:false},{angle:Math.PI,power:0,charging:false}];this.frames=[];this.game=new module.Game();this.game.start(this.rules,...this.names,1);this.game.setMyPlayer(-1);this.transport=null;this.pendingRematch=false;}
 changed(){this.emit('change');}
 report(error){this.error=String(error?.message||error||'连接中断');if(this.listenerCount('error'))this.emit('error',Error(this.error));this.changed();}
 async connect(options){const {RackServer,RackClient}=require('./rack-transport.cjs');
  if(this.role==='host'){
   this.transport=new RackServer({name:this.names[0],code:this.code,rules:this.rules,port:this.port,bind:options.bind||'0.0.0.0'});
   this.transport.on('join',({name})=>{if(this.closed)return;this.connected=true;this.names[1]=nickname(name);this.ready=[true,false];this.phase='lobby';this.epoch++;this.game.start(this.rules,...this.names,randomBytes(4).readUInt32LE());this.game.setMyPlayer(-1);this.publishLobby();this.publish('state');this.changed();});
   this.transport.on('message',p=>this.guestMessage(p));
   const endpoint=await this.transport.listen();this.port=endpoint.port;this.addresses=endpoint.addresses||[];
  }else{
   this.transport=new RackClient({address:this.address,port:this.port,code:this.code,name:this.names[1]});this.transport.on('message',p=>this.hostMessage(p));
   const welcome=await this.transport.connect();if(![0,1].includes(welcome.rules))throw Error('不支持的联机规则');this.rules=welcome.rules;this.names[0]=nickname(welcome.host);this.connected=true;this.transport.send({t:'ready',ready:true});this.ready[1]=true;
  }
  this.transport.on('leave',reason=>{if(this.closed)return;this.connected=false;this.phase='disconnected';for(const a of this.aims)a.charging=false;this.error=String(reason||'对方已离开，球局已停止');this.changed();});
  this.transport.on('error',e=>this.report(e));this.changed();return this;
 }
 publishLobby(){if(this.role!=='host'||!this.connected)return;this.transport.send({t:'lobby',rules:this.rules,players:this.names.map((name,i)=>({name,host:i===0,ready:this.ready[i],connected:i===0||this.connected}))});}
 publish(type='state'){if(this.role!=='host'||!this.connected)return false;this.lastFrame=this.clock();return this.transport.send({t:type,epoch:this.epoch,shots:this.shots,snapshot:this.game.snapshot()});}
 start(){if(this.role!=='host')throw Error('只有房主能开始或重开');if(!this.connected||!this.ready[1])throw Error('等待另一台设备加入并准备');this.epoch++;this.shots=0;this.accumulator=0;this.phase='playing';this.error='';this.pendingRematch=false;this.game.start(this.rules,...this.names,randomBytes(4).readUInt32LE());this.game.setMyPlayer(-1);for(const a of this.aims){a.power=0;a.charging=false;}this.publish('start');this.changed();return true;}
 setReady(value=true){if(this.role==='host')this.ready[0]=!!value;else{this.ready[1]=!!value;this.transport.send({t:'ready',ready:!!value});}this.publishLobby();this.changed();}
 guestMessage(p){try{if(!p||typeof p.t!=='string')return;
  if(p.t==='ready'){this.ready[1]=p.ready===true;this.publishLobby();this.changed();return;}
  if(p.t==='aim'){this.acceptAim(1,p);return;}
  if(p.t==='rematch'){this.pendingRematch=true;this.changed();return;}
  if(p.t==='shoot'){if(p.epoch!==this.epoch||!this.shootAs(1,p.angle,p.power))this.publish();return;}
  if(p.t==='place'){if(p.epoch!==this.epoch||!this.placeAs(1,p.x,p.y))this.publish();return;}
 }catch(e){this.report(e);}}
 hostMessage(p){try{if(!p||typeof p.t!=='string')return;
  if(p.t==='lobby'){if(!Array.isArray(p.players)||p.players.length!==2)throw Error('无效的联机大厅');this.names=p.players.map(v=>nickname(v.name));this.ready=p.players.map(v=>v.ready===true);this.changed();return;}
  if(p.t==='aim'){if(p.from===0||p.from===1)this.acceptAim(p.from,p,false);return;}
  if(p.t==='start'||p.t==='state'){if(!Number.isSafeInteger(p.epoch)||p.epoch<0||p.epoch<this.epoch)return;const snapshot=validateSnapshot(p.snapshot);if(p.epoch!==this.epoch)this.frames=[];this.epoch=p.epoch;this.shots=Number.isSafeInteger(p.shots)&&p.shots>=0?p.shots:0;this.game.applySnapshot(snapshot);this.game.setMyPlayer(-1);this.names=[...snapshot.names];this.rules=snapshot.rules;if(p.t==='start')this.phase='playing';this.frames.push({snapshot,at:this.clock()});this.frames=this.frames.slice(-4);this.changed();return;}
 }catch(e){this.report(e);this.phase='disconnected';this.connected=false;void this.transport.close();}}
 acceptAim(player,p,broadcast=true){if(!finite(p.angle,-1e6,1e6))return;this.aims[player]={angle:p.angle,power:finite(p.power,0,1)?p.power:0,charging:p.charging===true};if(this.role==='host'&&broadcast&&this.connected)this.transport.send({t:'aim',from:player,angle:p.angle,power:this.aims[player].power,charging:this.aims[player].charging});this.changed();}
 aim(dx,dy,charge=0,charging=false){if(!finite(dx,-1.001,1.001)||!finite(dy,-1.001,1.001)||this.closed)return;const p={t:'aim',angle:Math.atan2(-dy,dx),power:Math.max(0,Math.min(1,charge)),charging:!!charging};this.aims[this.localPlayer]={angle:p.angle,power:p.power,charging:p.charging};if(this.clock()-this.lastAim<45&&!charging)return;this.lastAim=this.clock();if(this.role==='host')this.acceptAim(0,p);else if(this.connected)this.transport.send(p);}
 shootAs(player,angle,power){if(!this.connected||this.phase!=='playing'||this.game.current!==player||!finite(angle,-1e6,1e6)||!finite(power,0,1))return false;if(!this.game.shoot(angle,power))return false;this.shots++;this.aims[player].power=0;this.aims[player].charging=false;this.transport.send({t:'shot',by:player,angle,power,epoch:this.epoch});this.publish();this.changed();return true;}
 shoot(angleDegrees,power){const angle=angleDegrees*Math.PI/180,normalized=Math.max(0,Math.min(1,power/3.5));if(!this.canShoot)return false;if(this.role==='host')return this.shootAs(0,angle,normalized);return this.transport.send({t:'shoot',angle,power:normalized,epoch:this.epoch});}
 placeAs(player,x,y){if(!this.connected||this.phase!=='playing'||this.game.current!==player||!finite(x,0,2.54)||!finite(y,0,1.27)||!this.game.placeCueBall(x,y))return false;this.publish();this.changed();return true;}
 placeWorld(x,y){const px=x/SCALE,py=(HEIGHT-y)/SCALE;if(!this.canPlace||!this.game.canPlaceCueBall(px,py))return false;if(this.role==='host')return this.placeAs(0,px,py);return this.transport.send({t:'place',x:px,y:py,epoch:this.epoch});}
 get canShoot(){return !this.closed&&this.connected&&this.phase==='playing'&&this.game.current===this.localPlayer&&this.game.phase===this.module.PHASE.AIMING&&this.game.canShoot();}
 get canPlace(){return !this.closed&&this.connected&&this.phase==='playing'&&this.game.current===this.localPlayer&&this.game.phase===this.module.PHASE.BALL_IN_HAND;}
 tick(dt){if(this.closed||this.role!=='host'||!this.connected||this.phase!=='playing')return;this.accumulator+=Math.max(0,Math.min(.25,dt));while(this.accumulator>=1/60){this.game.advanceFrame();this.accumulator-=1/60;}if(this.clock()-this.lastFrame>=40)this.publish();}
 displaySnapshot(){const latest=this.game.snapshot();if(this.role==='host'||this.frames.length<2)return latest;const a=this.frames.at(-2),b=this.frames.at(-1);if(a.snapshot.phase!==1||b.snapshot.phase!==1)return latest;const t=Math.max(0,Math.min(1,(this.clock()-60-a.at)/Math.max(1,b.at-a.at)));return {...latest,balls:latest.balls.map(ball=>{const old=a.snapshot.balls.find(v=>v.i===ball.i),next=b.snapshot.balls.find(v=>v.i===ball.i);return !ball.a||!old?.a||!next?.a?ball:{...ball,x:old.x+(next.x-old.x)*t,y:old.y+(next.y-old.y)*t};})};}
 scene(){const s=this.displaySnapshot(),r=this.module.TABLE.ballRadius*SCALE,white=s.balls.find(b=>b.i===0),hand=s.phase===2,point=hand?{x:s.cue[0],y:s.cue[1]}:white||{x:.635,y:.635};const body=b=>({x:b.x*SCALE,y:HEIGHT-b.y*SCALE,radius:r,vx:0,vy:0,pocketed:!b.a});const cue=body({...point,a:!!white?.a}),balls=s.balls.filter(b=>b.i!==0).map(b=>({id:b.i,...body(b)}));const canShoot=this.phase==='playing'&&this.connected&&s.phase===0;const phase=this.phase==='playing'&&s.phase===3?'finished':this.phase;const aims=this.aims.map((a,player)=>{const dx=Math.cos(a.angle),dy=-Math.sin(a.angle);return {player,name:this.names[player],color:player===0?'#5de5d0':'#ffbd6c',active:player===s.current,dx,dy,charge:a.power,charging:a.charging,pointer:{x:cue.x-dx*(r+130),y:cue.y-dy*(r+130)}};});return {table:{x:0,y:0,width:1600,height:800},radius:r,pocketRadius:this.module.TABLE.cornerPocketRadius*SCALE,borderWidth:r*2.5,pockets:[{x:0,y:0},{x:800,y:0},{x:1600,y:0},{x:0,y:800},{x:800,y:800},{x:1600,y:800}].map((p,id)=>({...p,id,radius:(p.x===800?this.module.TABLE.sidePocketRadius:this.module.TABLE.cornerPocketRadius)*SCALE})),cue,balls,canShoot,localCanShoot:this.canShoot,needsPlacement:hand,localCanPlace:this.canPlace,cueSource:'owned',score:0,roundScore:0,round:Math.max(1,this.epoch),rounds:0,remaining:balls.filter(b=>!b.pocketed).length,totalBalls:balls.length,combo:0,cleared:s.phase===3,shots:this.shots,lan:{role:this.role,localPlayer:this.localPlayer,connected:this.connected,phase,current:s.current,winner:s.winner,rules:s.rules,names:[...this.names],ready:[...this.ready],message:this.error||s.message,aims}};}
 info(){return {...this.scene().lan,port:this.port,addresses:this.addresses,address:this.address,code:this.code,canStart:this.role==='host'&&this.connected&&this.ready.every(Boolean),canRestart:this.role==='host'&&this.connected,pendingRematch:this.pendingRematch,protocol:2};}
 adapter(){const session=this;return {snapshot:()=>session.scene(),get cue(){return session.scene().cue;},get canShoot(){return session.canShoot;},get radius(){return session.module.TABLE.ballRadius*SCALE;},shoot:(a,p)=>session.shoot(a,p),placeCue:(x,y)=>session.placeWorld(x,y),resetRound:()=>session.start(),step:()=>[]};}
 async close(){if(this.closed)return;this.closed=true;this.connected=false;this.phase='disconnected';for(const a of this.aims)a.charging=false;await this.transport?.close();this.changed();}
}
async function createRackSession(role,options={}){if(!['host','guest'].includes(role))throw Error('联机角色无效');const module=await import('../vendor/rack/web/js/game.js');const session=new RackSession(module,role,options);try{return await session.connect(options);}catch(e){await session.close();throw e;}}
module.exports={createRackSession,RackSession,validateSnapshot,roomCode,SCALE};
