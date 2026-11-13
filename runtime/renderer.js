'use strict';
const canvas=document.getElementById('table'),ctx=canvas.getContext('2d');
let state=null,effects=[],images=new Map(),homeAnimation=null,rolls=new Map(),roundKey=null,viewport=null;
let skinVideo=null,skinFrame=document.createElement('canvas'),skinContext=skinFrame.getContext('2d',{willReadFrequently:true}),skinBounds=null,skinTime=-1,skinReported=false;
function processSkin(){if(!skinVideo||skinVideo.readyState<2)return;const w=skinVideo.videoWidth,h=skinVideo.videoHeight;if(!w||!h||w>4096||h>4096)return;if(skinTime===skinVideo.currentTime)return;skinTime=skinVideo.currentTime;if(skinFrame.width!==w||skinFrame.height!==h){skinFrame.width=w;skinFrame.height=h;}skinContext.clearRect(0,0,w,h);skinContext.drawImage(skinVideo,0,0);const image=skinContext.getImageData(0,0,w,h);const bounds=window.TableBallSkin.alphaBounds(image.data,w,h);skinContext.putImageData(image,0,0);if(bounds){skinBounds=bounds;if(!skinReported){skinReported=true;window.tableball.skinReady({ready:true,width:w,height:h,bounds});}}}
window.tableball.onSkin(asset=>{try{skinVideo=document.createElement('video');skinVideo.muted=true;skinVideo.loop=true;skinVideo.playsInline=true;skinVideo.preload='auto';skinVideo.addEventListener('loadeddata',()=>{try{processSkin();}catch(e){window.tableball.skinReady({error:e.message});}});skinVideo.addEventListener('error',()=>window.tableball.skinReady({error:'宠物动画无法解码，保留原桌宠'}));skinVideo.src=URL.createObjectURL(new Blob([new Uint8Array(asset.bytes)],{type:asset.mime}));const scan=()=>{if(skinReported)return;try{processSkin();}catch(e){window.tableball.skinReady({error:e.message});return;}if(!skinReported){if(skinVideo.requestVideoFrameCallback)skinVideo.requestVideoFrameCallback(scan);else requestAnimationFrame(scan);}};if(skinVideo.requestVideoFrameCallback)skinVideo.requestVideoFrameCallback(scan);else requestAnimationFrame(scan);void skinVideo.play().catch(e=>window.tableball.skinReady({error:e.message}));}catch(e){window.tableball.skinReady({error:e.message});}});
window.tableball.onShutdown(()=>{if(skinVideo){skinVideo.pause();const url=skinVideo.src;skinVideo.removeAttribute('src');skinVideo.load();URL.revokeObjectURL(url);}skinFrame.width=skinFrame.height=0;images.clear();canvas.width=canvas.height=0;});
function drawPet(cue){processSkin();window.TableBallArt.cueBase(ctx,cue,(window.devicePixelRatio||1)*(viewport?.scale||1));const fit=window.TableBallSkin.fitSkin(skinBounds,cue);if(fit){ctx.save();circle(cue.x,cue.y,cue.radius*.98);ctx.clip();ctx.drawImage(skinFrame,fit.sx,fit.sy,fit.sw,fit.sh,fit.x,fit.y,fit.width,fit.height);ctx.restore();}window.TableBallArt.coat(ctx,cue,.45);}
const menuShield=document.createElement('div'),menuPanel=document.createElement('div');let popupOpen=false,sceneVisible=true;
menuShield.style.cssText='position:fixed;inset:0;z-index:1000;display:none;background:rgba(0,0,0,.004)';menuPanel.style.cssText='position:absolute;width:290px;background:#10212f;color:#edf7ff;border:1px solid #6bdcb7;border-radius:9px;padding:7px;box-shadow:0 12px 35px #0009;font:14px Microsoft YaHei,sans-serif';
menuShield.append(menuPanel);document.body.append(menuShield);
function syncSceneVisibility(){canvas.style.visibility=sceneVisible&&!popupOpen&&!state?.paused&&!state?.menuOpen?'visible':'hidden';}
window.tableball.onSceneVisible(visible=>{sceneVisible=visible;syncSceneVisibility();});
window.tableball.onMenu(({items,x,y})=>{
 popupOpen=true;syncSceneVisibility();menuShield.style.display='block';menuPanel.replaceChildren();
 for(const item of items){if(item.type==='separator'){const hr=document.createElement('hr');hr.style.border='0';hr.style.borderTop='1px solid #456171';menuPanel.append(hr);continue;}
 const button=document.createElement('button');button.textContent=item.label;button.disabled=!item.enabled;button.style.cssText='display:block;width:100%;text-align:left;padding:10px 9px;background:transparent;border:0;border-radius:5px;color:inherit;font:inherit;cursor:pointer';if(!item.enabled)button.style.opacity='.5';button.onmouseenter=()=>{if(!button.disabled)button.style.background='#2c4b5c';};button.onmouseleave=()=>{button.style.background='transparent';};button.onclick=()=>window.tableball.menuAction(item.id);menuPanel.append(button);}
 menuPanel.style.left=Math.max(4,Math.min(window.innerWidth-310,x))+'px';menuPanel.style.top=Math.max(4,Math.min(window.innerHeight-menuPanel.offsetHeight-8,y))+'px';
});
window.tableball.onMenuDismiss(()=>{popupOpen=false;menuShield.style.display='none';syncSceneVisibility();draw();});
menuShield.addEventListener('pointerdown',event=>{if(event.target===menuShield){event.preventDefault();window.tableball.closeMenu();}});
window.tableball.onState(s=>{const key=(s.lan?'lan:':'offline:')+s.settings.ballMode+':'+s.round+':'+s.radius;if(key!==roundKey){rolls.clear();roundKey=key;}if(!!state?.lan!==!!s.lan){effects=[];homeAnimation=null;}state=s;syncSceneVisibility();canvas.style.cursor=s.interaction?.capture?(s.settings.controlMode==='cue'?'crosshair':'grab'):'default';if(skinVideo){if(s.paused||s.menuOpen)skinVideo.pause();else if(skinVideo.paused)void skinVideo.play().catch(()=>{});}draw();});
window.tableball.onAssets(assets=>{for(const [id,url]of Object.entries(assets)){if(!/^data:image\/png;base64,[a-z0-9+/=]+$/i.test(url))continue;const image=new Image();image.onload=draw;image.src=url;images.set(Number(id),image);}});
window.tableball.onEffect(e=>{
 if(!state)return;
 if(!state.lan&&(e.type==='clear'||e.type==='restore')&&state.settings.ballMode==='folders')homeAnimation={start:performance.now(),balls:state.balls.filter(b=>b.home).map(b=>({...b,image:images.get(b.id)}))};
 const p=state.pockets.find(p=>p.id===e.pocketId);if(p)effects.push({...p,text:state.lan?(e.type==='scratch'?'犯规':'进球'):(e.type==='scratch'?'犯规 −'+e.penalty:'+'+e.points),start:performance.now(),bad:e.type==='scratch'});
});
const interactive=()=>!popupOpen&&!!state&&!state.paused&&!!state.interaction?.capture;
const input=(action,e)=>{const point=e&&viewport?window.TableBallViewport.toWorld(viewport,{x:e.clientX??0,y:e.clientY??0}):{x:0,y:0};window.tableball.input({action,...point,token:state?.interaction?.token});};
canvas.addEventListener('pointerdown',e=>{if(!interactive()||e.button!==0)return;e.preventDefault();canvas.setPointerCapture(e.pointerId);input('down',e);});
canvas.addEventListener('pointermove',e=>{if(state&&!popupOpen&&!state.paused)input('move',e);});
canvas.addEventListener('pointerup',e=>{if(!interactive()||e.button!==0)return;e.preventDefault();input('up',e);if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);});
canvas.addEventListener('pointercancel',e=>input('cancel',e));
canvas.addEventListener('lostpointercapture',()=>input('cancel'));
window.addEventListener('blur',()=>input('cancel'));
window.addEventListener('contextmenu',e=>{if(interactive()||popupOpen){e.preventDefault();input('cancel',e);window.tableball.contextMenu();}});
function circle(x,y,r,fill,stroke){ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.stroke();}}
function ball(b,image=images.get(b.id)){
 const roll=window.TableBallArt.advanceRoll(rolls.get(b.id),b);rolls.set(b.id,roll);
 window.TableBallArt.drawBall(ctx,b,{image,phase:roll.phase,dpr:(window.devicePixelRatio||1)*(viewport?.scale||1)});
 if(typeof b.name==='string'){ctx.save();ctx.font='11px Microsoft YaHei,sans-serif';ctx.textAlign='center';ctx.textBaseline='top';ctx.lineWidth=2;ctx.strokeStyle='rgba(6,16,24,.7)';const name=Array.from(b.name).slice(0,10).join('');ctx.strokeText(name,b.x,b.y+b.radius+5);ctx.fillStyle='#eef5ee';ctx.fillText(name,b.x,b.y+b.radius+5);ctx.restore();}
}
// All geometry below is in table/world pixels; the DOM menu stays in screen pixels.
function cueStick(c,aim,{color='#69d9eb',active=true,guide=true,named=false}={}){
 if(!aim||![aim.dx,aim.dy].every(Number.isFinite)||Math.hypot(aim.dx,aim.dy)===0)return null;
 const rod=window.TableBallInput.stick(c,aim),{start,length}=rod,dx=aim.dx,dy=aim.dy;
 ctx.save();ctx.globalAlpha*=active?1:.38;
 if(guide){ctx.setLineDash([5,8]);ctx.lineWidth=1.5;ctx.strokeStyle=named?color:'#c3f8ff9c';ctx.beginPath();ctx.moveTo(c.x+dx*(c.radius+5),c.y+dy*(c.radius+5));ctx.lineTo(c.x+dx*420,c.y+dy*420);ctx.stroke();ctx.setLineDash([]);}
 ctx.translate(c.x,c.y);ctx.rotate(Math.atan2(dy,dx));
 const wood=ctx.createLinearGradient(-start-length,0,-start,0);wood.addColorStop(0,'#6d3920');wood.addColorStop(.7,'#e4bd78');wood.addColorStop(1,'#f7e6b8');ctx.fillStyle=wood;ctx.strokeStyle='#1b120e';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-start,-3);ctx.lineTo(-start-length,-6);ctx.lineTo(-start-length,6);ctx.lineTo(-start,3);ctx.closePath();ctx.fill();ctx.stroke();ctx.fillStyle=color;ctx.fillRect(-start-6,-3,6,6);
 if(named){ctx.fillRect(-start-length+12,-5.6,28,11.2);ctx.fillStyle='#eefbff';ctx.fillRect(-start-length+42,-5,2,10);}
 ctx.restore();return rod;
}
function localAimUI(s,aim,color='#bfeaff'){
 if(s.interaction?.capture&&aim.pointer&&[aim.pointer.x,aim.pointer.y].every(Number.isFinite))circle(aim.pointer.x,aim.pointer.y,4,null,color);
 if(!(s.interaction?.capture||aim.charging||s.settings.inputMode==='focus'))return;
 const charge=Math.max(0,Math.min(1,aim.charge||0)),x=(s.table.x||0)+s.table.width/2-130,y=(s.table.y||0)+(s.lan?140:112);
 ctx.fillStyle='#091723db';ctx.fillRect(x-10,y-8,280,43);ctx.fillStyle='#2b3b4c';ctx.fillRect(x,y,260,9);ctx.fillStyle=charge>.8?'#ffab59':'#67eac4';ctx.fillRect(x,y,260*charge,9);ctx.fillStyle='#eefbff';ctx.font='12px sans-serif';ctx.textAlign='center';ctx.textBaseline='top';ctx.fillText(aim.charging?'蓄力 '+Math.round(charge*100)+'% · 松手击球':(s.interaction?.capture?('左键蓄力 · 松手击球 · Esc '+(s.settings.escapeExit?'退出':'取消')):'移到母球或球杆击球 · 其他位置可操作应用'),x+130,y+15);
}
function cueLabel(s,aim,rod,{name,color,active,player}){
 if(!rod)return;
 const charge=Math.max(0,Math.min(1,aim.charge||0)),charging=aim.charging||charge>0;
 const text=Array.from(String(name)).slice(0,16).join('')+(charging?' · 蓄力 '+Math.round(charge*100)+'%':'');
 ctx.save();ctx.font='bold 12px Microsoft YaHei,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
 const width=Math.min(s.table.width-16,Math.max(60,ctx.measureText(text).width+22)),left=s.table.x||0,top=s.table.y||0;
 const x=Math.max(left+width/2+8,Math.min(left+s.table.width-width/2-8,rod.far.x)),y=Math.max(top+18,Math.min(top+s.table.height-22,rod.far.y+(player===1?22:-22)));
 ctx.globalAlpha=active||charging?1:.65;ctx.fillStyle='#0b1b28e8';ctx.beginPath();ctx.roundRect(x-width/2,y-12,width,charging?31:24,5);ctx.fill();ctx.strokeStyle=color;ctx.lineWidth=1;ctx.stroke();ctx.fillStyle=color;ctx.fillText(text,x,y,width-12);
 if(charging){ctx.fillStyle='#314454';ctx.fillRect(x-width/2+7,y+9,width-14,4);ctx.fillStyle=color;ctx.fillRect(x-width/2+7,y+9,(width-14)*charge,4);}
 ctx.restore();
}
function cueAndStick(s){
 if(!s.cue||(s.cue.pocketed&&!s.cue.placementPreview))return;
 const c=s.cue,lan=s.lan;if(c.placementPreview){ctx.save();ctx.globalAlpha=.82;drawPet(c);ctx.restore();ctx.save();ctx.setLineDash([6,5]);ctx.lineWidth=2;circle(c.x,c.y,c.radius+5,null,s.localCanPlace?'#ffe59a':'#a8c9db');ctx.restore();return;}drawPet(c); // One physical mother ball, using this device's own pet skin.
 if(lan&&s.canShoot){
  const cues=[0,1].map(player=>{
   const synced=lan.aims?.find(aim=>aim.player===player);if(!synced)return null;
   // Only the current local player's controller may bypass synchronized geometry.
   const localCurrent=player===lan.localPlayer&&player===lan.current;
   return {player,aim:localCurrent&&s.aim?{...synced,...s.aim}:synced,name:synced.name||lan.names[player],color:synced.color||(player===0?'#68dcb8':'#8fbdff'),active:player===lan.current&&synced.active!==false&&lan.connected&&lan.phase==='playing',localCurrent};
  }).filter(Boolean).sort((a,b)=>Number(a.active)-Number(b.active));
  for(const cue of cues){const rod=cueStick(c,cue.aim,{...cue,guide:cue.active,named:true});cueLabel(s,cue.aim,rod,cue);}
  const local=cues.find(cue=>cue.localCurrent&&cue.active);
  if(local&&!s.interaction?.desktopPass)localAimUI(s,local.aim,local.color);
 }else if(!lan&&s.settings.controlMode==='cue'&&s.aim&&s.canShoot&&!s.interaction?.desktopPass){
  cueStick(c,s.aim);localAimUI(s,s.aim);
 }
 ctx.save();ctx.setLineDash([3.5,4]);ctx.lineWidth=1.1;circle(c.x,c.y,c.radius,null,lan||s.settings.controlMode==='cue'?'rgba(255,255,247,.82)':'rgba(156,243,212,.8)');ctx.setLineDash([]);ctx.restore();
}
function lanStatus(lan){
 const name=player=>String(lan.names[player]||('玩家 '+(player+1)));
 let status;
 if(lan.phase==='finished')status=lan.winner===0||lan.winner===1?'对局结束 · '+name(lan.winner)+' 获胜':'对局结束';
 else if(lan.phase==='disconnected')status='连接已断开 · 等待重新连接';
 else if(!lan.connected)status=lan.phase==='lobby'?'等待对手连接':'连接已断开 · 对局已暂停';
 else if(lan.phase==='lobby')status=lan.ready.every(Boolean)?'双方已准备 · 等待开局':'等待双方准备';
 else if(lan.ballInHand)status=lan.localPlayer===lan.current?'自由球 · 轮到你摆白球：点白球确认，右键→手动摆母球换位置':'当前回合：'+name(lan.current)+' · 等待对手摆白球';
 else status='当前回合：'+name(lan.current)+(lan.localPlayer===lan.current?' · 轮到你击球':' · 等待对手击球');
 if(!lan.connected&&lan.phase==='finished')status+=' · 连接已断开';
 return status;
}
function onlineHUD(s){
 const lan=s.lan,w=s.table.width,left=s.table.x||0,top=s.table.y||0,hw=Math.min(980,w-24),x=left+(w-hw)/2,y=top+28;
 ctx.save();ctx.fillStyle='rgba(8,19,29,.94)';ctx.fillRect(x,y,hw,90);ctx.textBaseline='middle';ctx.textAlign='left';ctx.font='bold 17px sans-serif';ctx.fillStyle='#69e8bd';ctx.fillText('TABLEBALL · 局域网',x+16,y+20,hw*.36);ctx.font='13px sans-serif';ctx.fillStyle='#dbeaf0';ctx.textAlign='right';ctx.fillText((lan.rules===0?'8 球规则':'9 球规则')+' · 本机：'+(lan.role==='host'?'房主':'客人'),x+hw-16,y+20,hw*.6);
 const names=lan.names.map((name,player)=>(player===0?'房主：':'客人：')+Array.from(String(name)).slice(0,18).join('')+' · '+(lan.ready[player]?'已准备':'未准备')+(lan.phase==='playing'&&lan.current===player?' · 当前回合':''));
 ctx.textAlign='left';ctx.font='bold 14px sans-serif';
 for(let player=0;player<2;player++){ctx.fillStyle=lan.aims?.find(aim=>aim.player===player)?.color||(player===0?'#68dcb8':'#8fbdff');ctx.fillText(names[player],x+16+player*hw/2,y+46,hw/2-30);}
 ctx.font='12px sans-serif';ctx.fillStyle=!lan.connected||lan.phase==='disconnected'?'#ffb1a4':'#abc3cc';ctx.fillText([lanStatus(lan),s.placing&&s.localCanPlace?'在桌内空位点击放置':'',lan.message,s.error].filter(Boolean).join(' · ').slice(0,140),x+16,y+72,hw-32);ctx.restore();
}
function offlineHUD(s){
 const w=s.table.width,left=s.table.x||0,top=s.table.y||0;ctx.fillStyle='rgba(8,19,29,.92)';const hw=580;ctx.fillRect(left+(w-hw)/2,top+42,hw,58);ctx.textBaseline='middle';ctx.textAlign='left';ctx.font='bold 18px sans-serif';ctx.fillStyle='#69e8bd';ctx.fillText('TABLEBALL',left+w/2-270,top+62);ctx.font='14px sans-serif';ctx.fillStyle='#e5f0f6';ctx.fillText('本局 '+s.roundScore+'  ·  剩余 '+s.remaining+'/'+s.totalBalls+'  ·  '+s.combo+' 连击  ·  '+s.shots+' 杆',left+w/2-125,top+62);ctx.font='12px sans-serif';ctx.fillStyle=s.error?'#ffb1a4':'#abc3cc';ctx.fillText((s.error||((s.settings.controlMode==='cue'?'统一母球 / 球杆':'统一母球 / 拖动')+' / '+(s.settings.ballMode==='folders'?'文件夹视觉副本（原文件不动）':'常规台球')+' / '+(s.interaction?.desktopPass?'完全穿透，游戏不停':s.settings.inputMode==='focus'?'专注击球':'桌面优先')+' / Ctrl+Alt+D 穿透'+(s.settings.escapeExit?' / Esc退出':''))).slice(0,80),left+w/2-270,top+84);
}
function resultBanner(s,returning){
 const lan=s.lan;if(lan?lan.phase!=='finished':!s.cleared&&!returning)return;
 const x=(s.table.x||0)+s.table.width/2,y=(s.table.y||0)+s.table.height/2;
 ctx.save();ctx.fillStyle='#0c202ee8';ctx.fillRect(x-230,y-60,460,120);ctx.font='bold 25px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#7ff4c6';
 ctx.fillText(lan?lanStatus(lan):(s.settings.ballMode==='folders'?'清台！文件夹副本回到原位':'清台！ +'+s.roundScore),x,y,440);ctx.restore();
}
function draw(){
 if(!state)return;
 const s=state,dpr=window.devicePixelRatio||1,w=s.table.width,h=s.table.height,left=s.table.x||0,top=s.table.y||0;
 viewport=window.TableBallViewport.fit(s.table,s.work);
 const pixelWidth=Math.round(viewport.width*dpr),pixelHeight=Math.round(viewport.height*dpr);
 if(canvas.width!==pixelWidth||canvas.height!==pixelHeight){canvas.width=pixelWidth;canvas.height=pixelHeight;}
 canvas.style.width=viewport.width+'px';canvas.style.height=viewport.height+'px';
 // Clear the complete backing store, including letterboxing, before applying world geometry.
 ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);
 if(s.paused||s.menuOpen||popupOpen||!sceneVisible)return;
 ctx.setTransform(dpr,0,0,dpr,0,0);ctx.translate(viewport.x,viewport.y);ctx.scale(viewport.scale,viewport.scale);ctx.translate(-viewport.worldX,-viewport.worldY);
 // Windows layered windows pass clicks through alpha=0 pixels even with ignoreMouseEvents=false.
 ctx.fillStyle='rgba(0,0,0,.004)';ctx.fillRect(left,top,w,h);
 if(s.settings.ballMode==='folders'){ctx.fillStyle='rgba(8,28,23,.16)';ctx.fillRect(left,top,w,h);}
 const edge=Math.min(s.borderWidth,24);ctx.strokeStyle='rgba(20,57,46,.82)';ctx.lineWidth=edge;ctx.strokeRect(left+edge/2,top+edge/2,w-edge,h-edge);ctx.strokeStyle='rgba(110,227,189,.45)';ctx.lineWidth=1;ctx.strokeRect(left+edge,top+edge,w-edge*2,h-edge*2);
 for(const p of s.pockets){ctx.shadowColor='#46d7ad';ctx.shadowBlur=10;circle(p.x,p.y,p.radius,'#050e14','#678478');ctx.shadowBlur=0;circle(p.x,p.y,p.radius*.7,'#03070b');}
 const returning=!s.lan&&homeAnimation&&(performance.now()-homeAnimation.start<1900);
 if(!returning)for(const b of s.balls)if(!b.pocketed)ball(b);
 if(returning){const t=Math.min(1,(performance.now()-homeAnimation.start)/1500),ease=1-Math.pow(1-t,3);for(const b of homeAnimation.balls){ctx.globalAlpha=t>.85?(1-t)/.15:1;ball({...b,x:b.x+(b.home.x-b.x)*ease,y:b.y+(b.home.y-b.y)*ease},b.image);}ctx.globalAlpha=1;}
 if(s.lan)onlineHUD(s);else offlineHUD(s);
 effects=effects.filter(e=>performance.now()-e.start<1500);for(const e of effects){const t=(performance.now()-e.start)/1500;ctx.globalAlpha=1-t;ctx.lineWidth=3;circle(e.x,e.y,e.radius*(1+t*3),null,e.bad?'#ff876b':'#71ffd1');ctx.fillStyle=e.bad?'#ff876b':'#71ffd1';ctx.font='bold 22px sans-serif';ctx.textAlign='center';ctx.fillText(e.text,Math.max(left+60,Math.min(left+w-60,e.x)),Math.max(top+170,Math.min(top+h-60,e.y))-t*30);ctx.globalAlpha=1;}
 cueAndStick(s);resultBanner(s,returning);
}
window.tableball.ready();
