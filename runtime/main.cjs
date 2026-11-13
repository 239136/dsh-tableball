'use strict';
const {app,BrowserWindow,ipcMain,screen,Tray,nativeImage,globalShortcut}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{performance}=require('node:perf_hooks');
const {InputPolicy,escapeAction}=require('./input-policy.cjs');
const {fit,toWorld}=require('./viewport.cjs');const {createRackSession}=require('./rack-session.cjs');
const {PhysicsEngine}=require('./physics.cjs');const {CueController}=require('./cue-controller.cjs');
const {createShutdown}=require('./shutdown.cjs');const {createMenuGuard}=require('./menu-guard.cjs');const {listen}=require('./control-pipe.cjs');
const {selectGameDisplay}=require('./screen-lock.cjs');const {captureDesktopFolders,mapDesktopFolders}=require('./desktop-folders.cjs');
const {PetBridge,atomic}=require('./pet-bridge.cjs');const {PetVisibility}=require('./pet-visibility.cjs');const {loadSkin}=require('./skin-assets.cjs');
const home=process.env.DSH_HOME||path.join(os.homedir(),'.dsh'),store=path.join(home,'tableball');fs.mkdirSync(store,{recursive:true});
app.setPath('userData',path.join(store,'electron'));app.setName('TableBall');app.commandLine.appendSwitch('force-device-scale-factor','1');
const settingsFile=path.join(store,'settings.json'),statsFile=path.join(store,'stats.json');const read=(f,v)=>{try{return JSON.parse(fs.readFileSync(f,'utf8'));}catch{return v;}};
const settings={escapeExit:true,inputMode:'smart',controlMode:'cue',ballMode:'normal',ballScale:1,pocketScale:1,cueScale:1,debug:true,...read(settingsFile,{})};
if(settings.schemaVersion!==2){settings.cueScale=1;settings.offsetX=0;settings.offsetY=0;settings.schemaVersion=2;}
for(const [key,min,max,fallback]of [['ballScale',.6,1.6,1],['pocketScale',.8,2,1],['cueScale',.5,3,1]])if(!Number.isFinite(settings[key])||settings[key]<min||settings[key]>max)settings[key]=fallback;
if(typeof settings.escapeExit!=='boolean')settings.escapeExit=true;
if(!['smart','focus'].includes(settings.inputMode))settings.inputMode='smart';
if(!['cue','throw'].includes(settings.controlMode))settings.controlMode='cue';if(!['normal','folders'].includes(settings.ballMode))settings.ballMode='normal';
const stats={total:0,best:0,rounds:0,...read(statsFile,{})};for(const k of ['total','best','rounds'])if(!Number.isFinite(stats[k])||stats[k]<0)stats[k]=0;
const petBase=process.env.TABLEBALL_PET_URL||'http://127.0.0.1:3080/dsh-pet-7340';
const bridge=new PetBridge({base:petBase,file:process.env.TABLEBALL_PET_CONFIG||path.join(home,'dsh-pet/main-config.jsonc'),journal:path.join(store,'physics-restore.json')});
let overlay,control,tray,controlServer,game,work,lockedDisplayId,gameTimer,hostTimer;
let lan=null,offlineBackup=null,lanBusy=false,lanAttempt=0;
let paused=false,quitting=false,running=false,transition=false,error='',shots=0,frame=0,previousTick=performance.now(),mode='俯视无重力',petId=process.env.TABLEBALL_PET_ID||'main';
let folderSnapshot=null,folderAssets={},folderInfo=null,skinPayload=null,skinReady={ready:false},skinResolve,skinReject,drag=null,menuItems=[];
const menuActions=new Map(),cueController=new CueController(),inputPolicy=new InputPolicy();let desktopPass=false,placing=false,pointer={x:-1000,y:-1000},interaction={capture:false,escape:false,reason:'inactive'},appliedCapture=null,inputEpoch=0;
const visibility=new PetVisibility({broker:process.env.TABLEBALL_VISIBILITY_BROKER||null,journal:path.join(store,'pet-window-restore.json'),onLost:()=>{if(!quitting){log(Error('原桌宠窗口或恢复守护发生变化，安全退出'));app.quit();}}});
const menuGuard=createMenuGuard({localMenu:true,window:()=>overlay,isPaused:()=>paused,isClosing:()=>quitting,setSceneVisible:v=>overlay?.webContents.send('scene-visible',v),cancelCharge:()=>{cueController.cancel();drag=null;},syncInput:()=>syncInputMode(),resetMotion:()=>{previousTick=performance.now();}});
app.requestSingleInstanceLock()||app.exit(0);app.on('second-instance',()=>{if(running)openSettings();});
function lifecycle(phase){fs.appendFileSync(path.join(store,'lifecycle.log'),new Date().toISOString()+' '+process.pid+' '+phase+'\n');}
function log(e){error=String(e?.message||e);fs.appendFileSync(path.join(store,'runtime.log'),new Date().toISOString()+' '+error+'\n');console.error(error);}
function send(){if(!running||!overlay||overlay.isDestroyed())return;const snapshot=game.snapshot();snapshot.balls=snapshot.balls.map(({iconDataUrl,sourceId,...ball})=>ball);const state={...snapshot,settings:lan?{...settings,controlMode:'cue',ballMode:'normal'}:settings,stats,paused,placing,mode:lan?'局域网 · Rack':mode,error,shots:lan?lan.shots:shots,lan:lan?lan.info():null,lanBusy,work,lockedDisplayId,aim:cueController.snapshot(game.cue),folderInfo:lan?null:folderInfo,skinReady,petHidden:visibility.hidden,trackingExternalPet:false,menuOpen:menuGuard.active,interaction:{...interaction,desktopPass,policy:settings.inputMode},mouseThrough:!interaction.capture};overlay.webContents.send('state',state);if(control&&!control.isDestroyed()&&frame%6===0)control.webContents.send('state',state);if(frame%30===0)atomic(path.join(store,'status.json'),{...state,updatedAt:new Date().toISOString(),mouseThrough:!interaction.capture});}
function makeGame(){if(lan)throw Error('请先离开联机再修改单机球局');const prior=game?.snapshot(),radius=Math.min(work.width,work.height)*.016*settings.ballScale;const options={ownedCue:true,table:{width:work.width,height:work.height},ballScale:settings.ballScale,pocketScale:settings.pocketScale,cueRadius:radius*settings.cueScale,friction:1.1,gravity:mode==='重力甩抛'?1200:0};let seeds=[];
 if(settings.ballMode==='folders'){seeds=mapDesktopFolders(folderSnapshot,work,{radius,includeAll:true,pocketRadius:radius*1.8*settings.pocketScale});if(!seeds.length)throw Error('桌面上没有可用文件夹，真实文件没有被改动');options.balls=seeds;options.roundLayout='original';options.clearDelay=2.4;}
 game=new PhysicsEngine(options);game.score=prior?.score??stats.total;game.rounds=prior?.rounds??stats.rounds;game.round=prior?.round??1;folderAssets=Object.fromEntries(seeds.filter(b=>b.iconDataUrl).map(b=>[b.id,b.iconDataUrl]));cueController.cancel();drag=null;placing=false;inputPolicy.reset();overlay?.webContents.send('assets',folderAssets);
}
async function folderData(){folderSnapshot=await captureDesktopFolders();folderInfo={count:folderSnapshot.folders.length,positionsExact:folderSnapshot.positionsExact,positioned:folderSnapshot.folders.filter(f=>Number.isFinite(f.x)&&Number.isFinite(f.y)).length,reason:folderSnapshot.reason,readOnly:true};}
async function enterLan(role,options){
 if(lanBusy||lan)throw Error('请先离开当前房间或等待连接完成');lanBusy=true;transition=true;const attempt=++lanAttempt;
 try{const port=options.port===undefined?46321:Number(options.port);if(!Number.isInteger(port)||port<0||port>65535)throw Error('端口无效');const room=await createRackSession(role,{name:options.name,port,address:String(options.address||'').trim(),code:String(options.code||'').replace(/\s/g,'').toUpperCase()||undefined,rules:Number(options.rules)===0?0:1,bind:process.env.TABLEBALL_LAN_BIND||'0.0.0.0'});
 if(quitting||attempt!==lanAttempt){await room.close();throw Error('已取消联机');}
 offlineBackup={game,folderAssets,folderInfo,shots,paused,desktopPass};lan=room;game=room.adapter();folderAssets={};paused=false;desktopPass=false;placing=false;drag=null;cueController.cancel();inputPolicy.reset();overlay.webContents.send('assets',{});overlay.setOpacity(1);room.on('error',log);room.on('change',()=>{if(lan===room&&room.phase==='disconnected'){cueController.cancel();drag=null;placing=false;inputPolicy.reset();}});error='';menu();
 }finally{lanBusy=false;transition=false;syncInputMode();send();}
}
async function leaveLan(){lanAttempt++;if(!lan)return;const room=lan;lan=null;const backup=offlineBackup;offlineBackup=null;if(backup){game=backup.game;folderAssets=backup.folderAssets;folderInfo=backup.folderInfo;shots=backup.shots;paused=backup.paused;desktopPass=backup.desktopPass;const t=game.snapshot().table;if(t.width!==work.width||t.height!==work.height)makeGame();}placing=false;drag=null;cueController.cancel();inputPolicy.reset();overlay.webContents.send('assets',folderAssets);overlay.setOpacity(paused&&!menuGuard.active?0:1);await room.close();error='';menu();syncInputMode();send();}
function currentEscapeAction(){return escapeAction({enabled:settings.escapeExit,menu:menuGuard.active,gesture:cueController.snapshot(game?.cue).charging||!!drag||placing,closing:quitting});}
function syncEscapeKey(){const action=currentEscapeAction();if(action==='none'){globalShortcut.unregister('Escape');return;}if(!globalShortcut.isRegistered('Escape'))globalShortcut.register('Escape',()=>{const now=currentEscapeAction();if(now==='quit'){if(quitting)return;quitting=true;overlay?.setIgnoreMouseEvents(true,{forward:true});overlay?.hide();app.quit();}else if(now==='menu')dismissGameMenu();else if(now==='cancel'){cueController.cancel();drag=null;placing=false;inputPolicy.reset();refreshInteraction();}});}
function refreshInteraction(sample=true){
 if(!overlay||overlay.isDestroyed()||!game||!work)return;if(sample){const p=screen.getCursorScreenPoint();pointer={x:p.x-work.x,y:p.y-work.y};pointer=toWorld(fit(lan?{width:1600,height:800}:(game.table||work),work),pointer);}
 if(lan&&!lan.canShoot){cueController.cancel();drag=null;}if(lan&&placing&&!lan.canPlace){placing=false;inputPolicy.reset();}
 const priorPlacement=interaction.reason==='placement';const before=cueController.snapshot(game.cue);interaction=inputPolicy.evaluate({cue:game.cue,aim:before,pointer,canShoot:game.canShoot,canPlace:!!lan?.canPlace,mode:lan?'cue':settings.controlMode,policy:settings.inputMode,paused,closing:quitting||!running,transition,desktopPass,charging:before.charging,dragging:!!drag,placing,menu:menuGuard.active});
 if(appliedCapture!==interaction.capture||priorPlacement!==(interaction.reason==='placement'))inputEpoch++;interaction.token=inputEpoch;
 if(interaction.aim&&!placing)cueController.move(pointer.x,pointer.y);
 if(appliedCapture!==interaction.capture){appliedCapture=interaction.capture;if(interaction.capture)overlay.setIgnoreMouseEvents(false);else overlay.setIgnoreMouseEvents(true,{forward:true});}
 syncEscapeKey();
}
function syncInputMode(){refreshInteraction();}
function menu(){if(!tray)return;const template=[{label:'TableBall · 统一宠物母球',enabled:false},{label:'设置 / 母球和皮肤',click:openSettings},{label:'局域网对战 / 建房加入',click:openSettings},{label:'离开联机，返回单机',enabled:!!lan,click:()=>command('lan-leave')},{label:lan?(paused?'显示本机球台（联机）':'隐藏本机（对局不停）'):(paused?'继续球台':'暂停球台'),click:()=>command('pause')},{label:settings.controlMode==='cue'?'改为拖动皮肤甩球':'改为鼠标球杆蓄力',enabled:!lan,click:()=>command('setting',{key:'controlMode',value:settings.controlMode==='cue'?'throw':'cue'})},{label:settings.ballMode==='folders'?'改为常规台球':'桌面文件夹球（只读副本）',enabled:!lan,click:()=>command('setting',{key:'ballMode',value:settings.ballMode==='folders'?'normal':'folders'})},{label:desktopPass?'返回桌面优先击球（Ctrl+Alt+D）':'完全穿透，游戏不停（Ctrl+Alt+D）',click:()=>command('desktop')},{label:'手动摆母球',enabled:lan?lan.canPlace:!!game?.cue.pocketed,click:()=>command('place')},{label:lan?'开始 / 重开（房主）':'重摆 / 副本归位',enabled:!lan||lan.role==='host',click:()=>command('reset')},{label:mode==='重力甩抛'?'切换俯视无重力':'切换游戏内重力（不改桌宠配置）',enabled:!lan,click:()=>command('mode')},{type:'separator'},{label:'退出并恢复原桌宠',click:()=>app.quit()}];menuActions.clear();menuItems=template.map((item,index)=>{const id=String(index);if(item.click)menuActions.set(id,item.click);return {id,label:item.label||'',enabled:item.enabled!==false,type:item.type||'normal'};});}
function showGameMenu(){if(!running||quitting)return;menu();menuGuard.enter();overlay.moveTop();syncInputMode();const p=screen.getCursorScreenPoint();overlay.webContents.send('popup-menu',{items:menuItems,x:p.x-work.x,y:p.y-work.y});}
function dismissGameMenu(){menuGuard.leave();overlay?.webContents.send('dismiss-menu');}
function openSettings(){if(!running)return;if(control&&!control.isDestroyed()){control.show();control.moveTop();control.focus();return;}control=new BrowserWindow({width:640,height:760,title:'TableBall 设置',autoHideMenuBar:true,backgroundColor:'#101b28',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});control.setAlwaysOnTop(true,'screen-saver');control.on('focus',()=>{cueController.cancel();drag=null;});control.on('closed',()=>{control=null;syncInputMode();});control.webContents.setWindowOpenHandler(()=>({action:'deny'}));control.loadFile(path.join(__dirname,'settings.html'));}
async function command(cmd,value){if(quitting)throw Error('正在退出');if(!running)throw Error('游戏正在准备');
 if(cmd==='lan-host'||cmd==='lan-join'){await enterLan(cmd==='lan-host'?'host':'guest',value||{});}
 else if(cmd==='lan-leave'){await leaveLan();}
 else if(cmd==='lan-start'){if(!lan)throw Error('未加入房间');lan.start();}
 else if(cmd==='lan-ready'){if(!lan)throw Error('未加入房间');lan.setReady(value!==false);}
 else if(cmd==='lan-rematch'){if(!lan)throw Error('未加入房间');if(lan.role==='host')lan.start();else lan.transport.send({t:'rematch'});}
 else if(cmd==='pause'){paused=!paused;drag=null;placing=false;inputPolicy.reset();cueController.cancel();overlay.setOpacity(paused&&!menuGuard.active?0:1);syncInputMode();menu();}
 else if(cmd==='desktop'){desktopPass=!desktopPass;placing=false;drag=null;cueController.cancel();inputPolicy.reset();syncInputMode();menu();}
 else if(cmd==='place'){if(lan){if(!lan.canPlace)throw Error('当前不是你的摆球回合');}else if(!game.cue.pocketed)throw Error('母球尚未落袋');desktopPass=false;placing=true;syncInputMode();}
 else if(cmd==='reset'){overlay.webContents.send('effect',{type:'restore'});game.resetRound();shots=0;drag=null;placing=false;inputPolicy.reset();cueController.cancel();}
 else if(cmd==='debug'){settings.debug=!settings.debug;atomic(settingsFile,settings);}
 else if(cmd==='mode'){if(lan)throw Error('联机采用Rack固定物理，单机设置已保留');mode=mode==='重力甩抛'?'俯视无重力':'重力甩抛';game.gravity=mode==='重力甩抛'?1200:0;menu();}
 else if(cmd==='setting'){
  const key=value?.key,v=value?.value;if(lan&&!['escapeExit','inputMode'].includes(key))throw Error('联机球局使用统一尺寸和球杆；离开联机后恢复单机设置');if(transition)throw Error('正在读取模式，请稍候');
  if(key==='escapeExit'){if(typeof v!=='boolean')throw Error('Esc开关值无效');settings.escapeExit=v;syncEscapeKey();}
  else if(key==='inputMode'){if(!['smart','focus'].includes(v))throw Error('交互模式无效');settings.inputMode=v;desktopPass=false;placing=false;drag=null;cueController.cancel();inputPolicy.reset();}
  else if(key==='controlMode'){if(!['cue','throw'].includes(v))throw Error('操作模式无效');settings.controlMode=v;drag=null;cueController.cancel();}
  else if(key==='ballMode'){if(!['normal','folders'].includes(v))throw Error('球类型无效');transition=true;const prior=settings.ballMode;try{if(v==='folders')await folderData();if(quitting)return;settings.ballMode=v;makeGame();}catch(e){settings.ballMode=prior;throw e;}finally{transition=false;}}
  else{const ranges={ballScale:[.6,1.6],pocketScale:[.8,2],cueScale:[.5,3]};const r=ranges[key];if(!r||!Number.isFinite(v)||v<r[0]||v>r[1])throw Error('设置值无效；统一皮肤不再使用外部窗口偏移');settings[key]=v;makeGame();}
  atomic(settingsFile,settings);error='';syncInputMode();menu();
 }else if(cmd==='quit')app.quit();else throw Error('未知操作');send();return true;
}
function tick(){const now=performance.now(),dt=Math.min(.1,(now-previousTick)/1000);previousTick=now;frame++;if(lan){lan.tick(dt);}else if(!paused&&!menuGuard.active&&!transition&&!drag){for(const event of game.step(dt)){overlay.webContents.send('effect',event);if(event.type==='pocket'){stats.total+=event.points;stats.best=Math.max(stats.best,game.roundScore);}if(event.type==='scratch')stats.total=Math.max(0,stats.total-event.penalty);if(event.type==='clear')stats.rounds++;if(['pocket','scratch','clear'].includes(event.type))atomic(statsFile,stats);}}refreshInteraction();if(lan){const a=cueController.snapshot(game.cue);lan.aim(a.dx,a.dy,a.charge,a.charging);}send();}
function onInput(payload){
 if(!running||paused||menuGuard.active||transition||quitting)return;const action=payload?.action;if(action==='down'&&(!interaction.capture||payload.token!==interaction.token))return;if(action==='cancel'){cueController.cancel();drag=null;refreshInteraction();return;}
 const x=payload?.x,y=payload?.y;if(!Number.isFinite(x)||!Number.isFinite(y))return;pointer={x,y};refreshInteraction(false);if(desktopPass||!interaction.capture||(action==='down'&&payload.token!==interaction.token))return;
 if(placing){if(action==='down'){if(game.placeCue(x,y)){placing=false;error='';cueController.cancel();inputPolicy.reset();inputEpoch++;}else error='此处不能摆白球，请选桌内未被占用的位置';}refreshInteraction(false);return;}
 if(lan?.canPlace){const c=game.cue;if(action==='down'&&Math.hypot(x-c.x,y-c.y)<=c.radius+7){if(game.placeCue(c.x,c.y)){error='';cueController.cancel();drag=null;inputPolicy.reset();inputEpoch++;}else error='此处不能摆白球，请右键选择手动摆母球换位置';}refreshInteraction(false);return;}
 if(game.cue.pocketed)return;
 if(lan||settings.controlMode==='cue'){
  if(action==='down'&&game.canShoot)cueController.begin(game.cue);
  if(action==='up'){const shot=cueController.release(game.cue);if(shot){if(game.shoot(shot.angle,shot.power)){if(!lan)shots++;error='';inputPolicy.reset();}else error=lan?'请等待自己的回合及球停稳':'请等待球停稳';}}
 }else{
  if(action==='down'&&game.canShoot&&Math.hypot(x-game.cue.x,y-game.cue.y)<=game.cue.radius+8){drag={dx:game.cue.x-x,dy:game.cue.y-y,trail:[{x:game.cue.x,y:game.cue.y,t:performance.now()}]};game.cue.vx=game.cue.vy=0;}
  if(drag&&(action==='move'||action==='up')){const nx=x+drag.dx,ny=y+drag.dy;if(game.placeCue(nx,ny)){const t=performance.now();drag.trail.push({x:nx,y:ny,t});drag.trail=drag.trail.filter(p=>t-p.t<180).slice(-12);}if(action==='up'){const a=drag.trail[0],b=drag.trail[drag.trail.length-1],dt=(b.t-a.t)/1000;if(dt>.015&&game.throwCue((b.x-a.x)/dt,(b.y-a.y)/dt))shots++;drag=null;inputPolicy.reset();}}
 }
 refreshInteraction(false);
}
ipcMain.handle('command',(event,cmd,value)=>{if(event.sender!==control?.webContents)throw Error('只允许设置窗口操作');return command(cmd,value);});
ipcMain.on('cue-input',(event,data)=>{if(event.sender===overlay?.webContents)onInput(data);});
ipcMain.on('cue-menu',event=>{if(event.sender===overlay?.webContents)showGameMenu();});
ipcMain.on('popup-dismiss',event=>{if(event.sender===overlay?.webContents)dismissGameMenu();});
ipcMain.on('popup-command',(event,id)=>{if(event.sender!==overlay?.webContents||!menuGuard.active)return;const action=menuActions.get(String(id));dismissGameMenu();if(action)Promise.resolve().then(action).catch(log);});
ipcMain.on('ready',event=>{if(event.sender===overlay?.webContents){overlay.webContents.send('assets',folderAssets);overlay.webContents.send('skin',skinPayload);}send();});
ipcMain.on('skin-ready',(event,info)=>{if(event.sender!==overlay?.webContents)return;if(info?.error){skinReject?.(Error(info.error));return;}if(info?.ready&&Number.isFinite(info.width)&&Number.isFinite(info.height)&&info.bounds?.width>0&&info.bounds?.height>0){skinReady={...info,ready:true};skinResolve?.();}});
app.whenReady().then(async()=>{
 syncEscapeKey();
 if(process.env.TABLEBALL_CONTROL_PIPE){controlServer=listen(process.env.TABLEBALL_CONTROL_PIPE,line=>{if(line==='exit')app.quit();else if(line==='raise')overlay?.moveTop();else if(line==='desktop')void command('desktop').catch(log);else if(line==='settings')openSettings();else if(line.startsWith('lan:')){try{const p=JSON.parse(line.slice(4));if(['lan-host','lan-join','lan-start','lan-leave','lan-ready','lan-rematch'].includes(p.cmd))void command(p.cmd,p.value).catch(log);}catch(e){log(e);}}else if(line==='reset')void command('reset').catch(log);else if(line.startsWith('set:')){try{void command('setting',JSON.parse(line.slice(4))).catch(log);}catch(e){log(e);}}});controlServer.on('error',log);}
 if(!process.env.TABLEBALL_VISIBILITY_BROKER)throw Error('请从右键菜单或受保护的启动器进入，不能无守护地隐藏桌宠');
 await visibility.recover();await bridge.recover();const config=await bridge.request('/config');const selectedPet=config.main.pets.find(p=>p.id===petId);if(!selectedPet)throw Error('未找到所选桌宠');
 const original=await visibility.inspect();if(!original.found)throw Error('未找到可恢复的原桌宠窗口');const displays=screen.getAllDisplays();let launch=screen.getCursorScreenPoint();
 try{const pose=await bridge.request('/pose?pet='+encodeURIComponent(petId));const a=displays.map(d=>d.workArea),x=Math.min(...a.map(a=>a.x)),y=Math.min(...a.map(a=>a.y)),w=Math.max(...a.map(a=>a.x+a.width))-x,h=Math.max(...a.map(a=>a.y+a.height))-y;if(Number.isFinite(pose.x)&&Number.isFinite(pose.y))launch={x:x+pose.x*w,y:y+pose.y*h};}catch{launch={x:original.window.x+original.window.width/2,y:original.window.y+original.window.height*.65};}
 const selected=selectGameDisplay(displays,launch,screen.getPrimaryDisplay().id);lockedDisplayId=selected.id;work=selected.workArea;
 skinPayload=await loadSkin(config,petId,petBase);if(quitting)return;
 if(settings.ballMode==='folders'){try{await folderData();}catch(e){log(e);settings.ballMode='normal';}}
 try{makeGame();}catch(e){log(e);settings.ballMode='normal';makeGame();}
 const decoded=new Promise((resolve,reject)=>{skinResolve=resolve;skinReject=reject;});
 overlay=new BrowserWindow({...work,show:false,frame:false,transparent:true,alwaysOnTop:true,skipTaskbar:true,focusable:false,resizable:false,hasShadow:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});overlay.setIgnoreMouseEvents(true,{forward:true});overlay.setAlwaysOnTop(true,'screen-saver');overlay.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 const timeout=setTimeout(()=>skinReject(Error('宠物动画解码超时，原桌宠未隐藏')),12000);try{await overlay.loadFile(path.join(__dirname,'index.html'));await decoded;}finally{clearTimeout(timeout);}if(quitting)return;
 await visibility.hold(original.window);if(quitting)return;
 running=true;atomic(settingsFile,settings);const p=screen.getCursorScreenPoint();pointer={x:p.x-work.x,y:p.y-work.y};cueController.move(pointer.x,pointer.y);overlay.showInactive();syncInputMode();
 overlay.webContents.on('render-process-gone',()=>{if(quitting)return;log(Error('游戏绘制进程退出，恢复原桌宠'));app.quit();});
 const icon=nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGUlEQVQ4T2Nk+M/wn4ECwESJ5lEDRg0YDQAAkEQf8bF2AUQAAAAASUVORK5CYII=');tray=new Tray(icon);tray.setToolTip('TableBall · 统一宠物母球');tray.on('double-click',openSettings);tray.on('right-click',showGameMenu);menu();
 previousTick=performance.now();gameTimer=setInterval(tick,1000/60);send();
 for(const [key,fn]of [['D',()=>command('desktop').catch(log)],['B',()=>command('pause').catch(log)],['T',openSettings],['M',()=>command('mode').catch(log)],['R',()=>command('reset').catch(log)],['Q',()=>app.quit()]])globalShortcut.register('CommandOrControl+Alt+'+key,fn);
 const updateDisplay=()=>{const d=screen.getAllDisplays().find(d=>d.id===lockedDisplayId);if(!d){app.quit();return;}work=d.workArea;overlay.setBounds(work);if(!lan)makeGame();else{inputPolicy.reset();syncInputMode();send();}};screen.on('display-metrics-changed',updateDisplay);screen.on('display-removed',updateDisplay);
 if(process.env.TABLEBALL_HOST_PID)hostTimer=setInterval(()=>{try{process.kill(Number(process.env.TABLEBALL_HOST_PID),0);}catch{app.quit();}},2000);
}).catch(e=>{log(e);app.quit();});
app.on('window-all-closed',()=>{});
const shutdown=createShutdown({hide:()=>{lifecycle('hide-start');overlay?.hide();control?.hide();lifecycle('hide-done');},stop:()=>{lifecycle('stop-start');lanAttempt++;if(lan){const room=lan;lan=null;void room.close().catch(log);}overlay?.webContents.send('stop-skin');running=false;paused=true;cueController.cancel();drag=null;clearInterval(gameTimer);clearInterval(hostTimer);controlServer?.close();globalShortcut.unregisterAll();lifecycle('stop-done');},waitForMode:()=>Promise.resolve(),restore:()=>visibility.release(),finish:()=>{lifecycle('exit');process.exit(0);},log,deadlineMs:350});
app.on('before-quit',event=>{event.preventDefault();quitting=true;lifecycle('before-quit');void shutdown();});
