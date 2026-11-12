'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),{EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const {spawnSync}=require('node:child_process');
const {scopeFromEnv,inspectArgs}=require('../runtime/pet-window-scope.cjs');
const {PetVisibility}=require('../runtime/pet-visibility.cjs');
const {createVisibilityBroker}=require('../runtime/visibility-broker.cjs');
const tag='owned_scope_1234567890',otherTag='another_scope_1234567';
const scope=scopeFromEnv({TABLEBALL_PET_SCOPE_TAG:tag},'猫 /main]');
const original={hwnd:'101',pid:2001,started:'123:456',title:'dsh-pet 桌宠 '+scope.suffix,visible:true,x:1,y:2,width:40,height:40};

// Isolated CommonJS wrappers stub executables, not global child_process or the real desktop.
function load(relative,mocks={},env=process.env){
 const filename=path.join(__dirname,'..',relative),module={exports:{}},realRequire=createRequire(filename);
 vm.compileFunction(fs.readFileSync(filename,'utf8'),['require','module','exports','__dirname','process'],{filename})(
  id=>Object.hasOwn(mocks,id)?mocks[id]:realRequire(id),module,module.exports,path.dirname(filename),{...process,env});
 return module.exports;
}
function fakeInspector(windows,env={}){
 const calls=[];
 const {PetVisibility:Visibility}=load('runtime/pet-visibility.cjs',{'node:child_process':{
  execFile(exe,args,options,done){
   calls.push({exe,args,options});assert.equal(args[0],'inspect');
   const window=windows.find(w=>w.title.startsWith('dsh-pet')&&w.title.includes('桌宠')&&(args.length===1||w.title.endsWith(args[1])))||null;
   done(null,JSON.stringify({found:!!window,window}));
  },spawn(){throw Error('A real guard must not spawn in an inspect test');}
 }},env);
 return {Visibility,calls};
}
function temp(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tableball-scope-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}

test('scope helper preserves the exact legacy inspect ABI and canonical encoded suffix',()=>{
 assert.equal(scopeFromEnv({}),null);assert.deepEqual(inspectArgs(null),['inspect']);assert.deepEqual(inspectArgs(undefined),['inspect']);
 assert.equal(scope.suffix,'[tableball:'+tag+':'+encodeURIComponent(scope.petId)+']');
 assert.deepEqual(inspectArgs(scope),['inspect',scope.suffix]);
 assert.equal(scopeFromEnv({TABLEBALL_PET_SCOPE_TAG:tag}).petId,'main');
 assert.ok(Object.isFrozen(scope));
});

test('scope parsing and visibility constructors fail closed before invoking any executable',async()=>{
 for(const value of ['',null,123,'short','x'.repeat(81),'owned_scope_1234\n'])assert.throws(()=>scopeFromEnv({TABLEBALL_PET_SCOPE_TAG:value}));
 for(const pet of ['',123,'x'.repeat(65),'bad\npet','\ud800'])assert.throws(()=>scopeFromEnv({TABLEBALL_PET_SCOPE_TAG:tag},pet));
 const {Visibility,calls}=fakeInspector([original]);
 for(const malformed of [{},false,'',0,{...scope,tag:''},{...scope,petId:''},{...scope,suffix:''},{...scope,suffix:scope.suffix+' '},{...scope,suffix:scope.suffix.replace(tag,otherTag)}]){
  assert.throws(()=>inspectArgs(malformed));assert.throws(()=>new Visibility({scope:malformed}));
  await assert.rejects(createVisibilityBroker({scope:malformed,expectedOwner:()=>42}));
 }
 assert.deepEqual(calls,[]);
 const invalid=fakeInspector([original],{TABLEBALL_PET_SCOPE_TAG:''});assert.throws(()=>new invalid.Visibility());assert.deepEqual(invalid.calls,[]);
});

test('PetVisibility uses scoped inspect args, never an untagged or another owner window',async()=>{
 const windows=[{...original,hwnd:'legacy',title:'dsh-pet 桌宠'},
  {...original,hwnd:'other',title:'dsh-pet 桌宠 '+scopeFromEnv({TABLEBALL_PET_SCOPE_TAG:otherTag},scope.petId).suffix},
  {...original,hwnd:'another-pet',title:'dsh-pet 桌宠 '+scopeFromEnv({TABLEBALL_PET_SCOPE_TAG:tag},'other').suffix},original];
 const {Visibility,calls}=fakeInspector(windows);
 const visible=new Visibility({scope,exe:'fake-visibility.exe'});assert.deepEqual(await visible.inspect(),{found:true,window:original});
 assert.deepEqual(calls[0].args,['inspect',scope.suffix]);assert.equal(calls[0].exe,'fake-visibility.exe');
 const missing=fakeInspector(windows.slice(0,-1));assert.deepEqual(await new missing.Visibility({scope}).inspect(),{found:false,window:null});
 assert.deepEqual(missing.calls[0].args,['inspect',scope.suffix]);
 const legacy=new Visibility({scope:null});assert.equal((await legacy.inspect()).window.hwnd,'legacy');assert.deepEqual(calls[1].args,['inspect']);
 const inherited=fakeInspector(windows,{TABLEBALL_PET_SCOPE_TAG:tag,TABLEBALL_PET_ID:scope.petId});
 assert.deepEqual(await new inherited.Visibility().inspect(),{found:true,window:original});assert.deepEqual(inherited.calls[0].args,['inspect',scope.suffix]);
 const defaultLegacy=fakeInspector(windows,{});await new defaultLegacy.Visibility().inspect();assert.deepEqual(defaultLegacy.calls[0].args,['inspect']);
});

test('accepted scopes are snapshots, not mutable scope objects that can broaden discovery',async()=>{
 const mutable={...scope},{Visibility,calls}=fakeInspector([original]);const visibility=new Visibility({scope:mutable});
 mutable.tag=otherTag;mutable.suffix='';await visibility.inspect();assert.deepEqual(calls[0].args,['inspect',scope.suffix]);
});

test('broker independently rejects unscoped, wrong-tag, wrong-pet and non-pet originals',async()=>{
 const badTitles=[undefined,'dsh-pet 桌宠','dsh-pet 桌宠 '+scopeFromEnv({TABLEBALL_PET_SCOPE_TAG:otherTag},scope.petId).suffix,
  'dsh-pet 桌宠 '+scopeFromEnv({TABLEBALL_PET_SCOPE_TAG:tag},'other').suffix,original.title+' trailing',
  original.title.replace(tag,tag.toUpperCase()),'not-pet 桌宠 '+scope.suffix,'dsh-pet unrelated '+scope.suffix];
 for(const title of badTitles){
  let held=0;const seen=[];class Fake{constructor(options){seen.push(options);}async recover(){}async inspect(){return {found:true,window:{...original,title}};}async hold(){held++;}async release(){}}
  const broker=await createVisibilityBroker({scope,expectedOwner:()=>1234,Visibility:Fake});
  try{const client=new PetVisibility({broker:broker.pipe,owner:1234,scope});
   await assert.rejects(client.request('hold',{window:original}),/Original pet window changed/);assert.equal(held,0);assert.deepEqual(seen[0].scope,scope);
  }finally{await broker.close();}
 }
});

test('scoped broker re-inspects through the scoped helper and accepts only its authoritative record',async()=>{
 const {Visibility,calls}=fakeInspector([original]);const held=[];
 class Guard extends Visibility{async recover(){}async hold(window){held.push(window);this.record={...window,owner:this.owner,session:'fake-session'};}async release(){}}
 const mutable={...scope};const broker=await createVisibilityBroker({scope:mutable,expectedOwner:()=>1234,Visibility:Guard});mutable.suffix='';
 try{const client=new PetVisibility({broker:broker.pipe,owner:1234,scope});
  await assert.rejects(client.request('hold',{window:{...original,hwnd:'other'}}),/Original pet window changed/);assert.deepEqual(held,[]);
  const response=await client.request('hold',{window:{hwnd:original.hwnd,pid:-1,started:'forged',title:'forged'}});
  assert.equal(response.hidden,true);assert.deepEqual(response.record,{...original,owner:1234,session:'fake-session'});
  assert.deepEqual(held,[original]);assert.deepEqual(calls.map(c=>c.args),[['inspect',scope.suffix],['inspect',scope.suffix]]);
 }finally{await broker.close();}
});

test('unscoped broker keeps legacy inspect arguments and original selection unchanged',async()=>{
 const legacy={...original,title:'dsh-pet 桌宠'}, {Visibility,calls}=fakeInspector([legacy],{TABLEBALL_PET_SCOPE_TAG:tag});let held;
 class Guard extends Visibility{async recover(){}async hold(window){held=window;this.record=window;}async release(){}}
 const broker=await createVisibilityBroker({expectedOwner:()=>1234,Visibility:Guard});
 try{const response=await new PetVisibility({broker:broker.pipe,owner:1234,scope:null}).request('hold',{window:legacy});
  assert.deepEqual(response.record,legacy);assert.deepEqual(held,legacy);assert.deepEqual(calls[0].args,['inspect']);
 }finally{await broker.close();}
});

function launchFixture(){
 const events=[],game=new EventEmitter();game.pid=42001;game.kill=()=>{events.push('game.kill');};let options,spawnOptions;
 const broker={pipe:'fake-broker',async close(){events.push('broker.close');}};
 const {launchGame}=load('runtime/launch-game.cjs',{
  './visibility-broker.cjs':{async createVisibilityBroker(value){events.push('broker');options=value;assert.equal(value.expectedOwner(),undefined);return broker;}},
  'node:child_process':{spawn(executable,args,value){events.push('game');spawnOptions=value;assert.equal(executable,'fake-electron');assert.deepEqual(args,['fake-entry']);return game;}}
 });
 return {launchGame,events,game,broker,get options(){return options;},get spawnOptions(){return spawnOptions;}};
}
test('launchGame derives scope from its own env, opens parent-side broker before game and closes after exit',async()=>{
 const fixture=launchFixture(),env={TABLEBALL_PET_SCOPE_TAG:tag,TABLEBALL_PET_ID:scope.petId,ELECTRON_RUN_AS_NODE:'1',DSH_HOME:'fake-home'};
 const result=await fixture.launchGame({electron:'fake-electron',entry:'fake-entry',env});
 assert.deepEqual(fixture.events,['broker','game']);assert.deepEqual(fixture.options.scope,scope);assert.equal(fixture.options.expectedOwner(),fixture.game.pid);
 assert.equal(fixture.spawnOptions.env.TABLEBALL_VISIBILITY_BROKER,fixture.broker.pipe);assert.equal(fixture.spawnOptions.env.ELECTRON_RUN_AS_NODE,undefined);
 assert.equal(env.ELECTRON_RUN_AS_NODE,'1');assert.equal(fixture.spawnOptions.env.TABLEBALL_PET_SCOPE_TAG,tag);
 fixture.game.emit('exit',0);assert.equal(await result.done,0);assert.deepEqual(fixture.events,['broker','game','broker.close']);
});
test('launchGame omits null scope in legacy mode and rejects malformed env before broker or spawn',async()=>{
 const fixture=launchFixture(),result=await fixture.launchGame({electron:'fake-electron',entry:'fake-entry',env:{}});
 assert.equal(Object.hasOwn(fixture.options,'scope'),false);fixture.game.emit('exit',0);await result.done;
 for(const env of [{TABLEBALL_PET_SCOPE_TAG:''},{TABLEBALL_PET_SCOPE_TAG:'invalid'},{TABLEBALL_PET_SCOPE_TAG:tag,TABLEBALL_PET_ID:'bad\npet'}]){
  const invalid=launchFixture();await assert.rejects(invalid.launchGame({electron:'fake-electron',entry:'fake-entry',env}));assert.deepEqual(invalid.events,[]);
 }
});

test('broker owns the native guard outside the fake game process tree and preserves owner identity/restoration',async t=>{
 const dir=temp(t),events=[],nativeCalls=[],guard=new EventEmitter();guard.stdout=new PassThrough();t.after(()=>guard.stdout.destroy());
 const game=new EventEmitter();game.pid=44001;game.kill=()=>assert.fail('No game termination should be needed');
 const {PetVisibility:Visibility}=load('runtime/pet-visibility.cjs',{'node:child_process':{
  execFile(exe,args,options,done){nativeCalls.push(args);if(args[0]==='inspect')done(null,JSON.stringify({found:true,window:original}));
   else if(args[0]==='identity')done(null,JSON.stringify({started:'owner-start'}));
   else if(args[0]==='signal'){done(null,JSON.stringify({released:true}));guard.stdout.write(JSON.stringify({restored:true})+'\n');}
   else if(args[0]==='restore')done(null,JSON.stringify({restored:true}));else assert.fail('Unexpected command '+args[0]);},
  spawn(exe,args,options){events.push('broker.guard');assert.notEqual(process.pid,game.pid);assert.equal(args[0],'hold');
   const record=JSON.parse(Buffer.from(args[1],'base64').toString('utf8'));assert.equal(record.owner,game.pid);assert.equal(record.ownerStarted,'owner-start');
   assert.equal(record.title,original.title);assert.deepEqual(options,{windowsHide:true,stdio:['ignore','pipe','ignore']});
   queueMicrotask(()=>guard.stdout.write(JSON.stringify({hidden:true})+'\n'));return guard;}
 }},{});
 const {launchGame}=load('runtime/launch-game.cjs',{
  './visibility-broker.cjs':{async createVisibilityBroker(options){events.push('broker');return createVisibilityBroker({...options,Visibility});}},
  'node:child_process':{spawn(){events.push('game');return game;}}
 });
 const result=await launchGame({electron:'fake-electron',entry:'fake-entry',env:{DSH_HOME:dir,TABLEBALL_PET_SCOPE_TAG:tag,TABLEBALL_PET_ID:scope.petId}});
 const client=new PetVisibility({broker:result.broker.pipe,owner:game.pid,scope});
 try{await client.hold(original);assert.deepEqual(events,['broker','game','broker.guard']);assert.equal(client.child,null);
  assert.deepEqual(nativeCalls.slice(0,2),[['inspect',scope.suffix],['identity',String(game.pid)]]);
  game.emit('exit',0);assert.equal(await result.done,0);
  assert.ok(nativeCalls.some(args=>args[0]==='restore'&&args[2]===String(game.pid)));assert.equal(fs.existsSync(path.join(dir,'tableball/pet-window-restore.json')),false);
 }finally{await result.broker.close();}
});

const compiler=path.join(process.env.WINDIR||'C:/Windows','Microsoft.NET/Framework64/v4.0.30319/csc.exe');
test('native source compiles only in TEMP and pure title/suffix predicates reject malformed scopes',{
 skip:process.platform!=='win32'||!fs.existsSync(compiler)?'Windows .NET compiler unavailable':false
},t=>{
 const dir=temp(t),probe=path.join(dir,'ScopeProbe.cs'),exe=path.join(dir,'ScopeProbe.exe');
 // Only reflection over pure predicates: never call native Main, enumerate windows or hide a window.
 fs.writeFileSync(probe,'using System;using System.Reflection;class ScopeProbe{static int Main(string[] args){var flags=BindingFlags.Static|BindingFlags.NonPublic;var type=typeof(PetVisibility);if(args[0]=="suffix"){var method=type.GetMethod("ValidSuffix",flags);for(int i=1;i<args.Length;i++)Console.WriteLine(method.Invoke(null,new object[]{args[i]}));}else{var method=type.GetMethod("CandidateTitle",flags);for(int i=1;i<args.Length;i+=2)Console.WriteLine(method.Invoke(null,new object[]{args[i],args[i+1]=="<legacy>"?null:args[i+1]}));}return 0;}}');
 const compiled=spawnSync(compiler,['/nologo','/optimize+','/r:System.Web.Extensions.dll','/main:ScopeProbe','/out:'+exe,path.join(__dirname,'../native/PetVisibility.cs'),probe],{encoding:'utf8',windowsHide:true});
 assert.equal(compiled.error,undefined);assert.equal(compiled.status,0,compiled.stdout+'\n'+compiled.stderr);
 const valid=['main',scope.petId,"!~*'()._-",'😀','x'.repeat(64)].map(pet=>scopeFromEnv({TABLEBALL_PET_SCOPE_TAG:tag},pet).suffix);
 const invalid=['','garbage','[tableball:short:main]','[tableball:'+tag+':]',scope.suffix+' ','[tableball:'+tag+':%00]','[tableball:'+tag+':%0A]',
  '[tableball:'+tag+':%FF]','[tableball:'+tag+':%ED%A0%80]','[tableball:'+tag+':%ZZ]','[tableball:'+tag+':%6Dain]','[tableball:'+tag+':'+('x'.repeat(65))+']'];
 const checked=spawnSync(exe,['suffix',...valid,...invalid],{encoding:'utf8',windowsHide:true});assert.equal(checked.error,undefined);assert.equal(checked.status,0,checked.stderr);
 assert.deepEqual(checked.stdout.trim().split(/\r?\n/),[...valid.map(()=> 'True'),...invalid.map(()=> 'False')]);
 const cases=[['dsh-pet 桌宠','<legacy>',true],[original.title,scope.suffix,true],['dsh-pet 桌宠',scope.suffix,false],
  [original.title+' extra',scope.suffix,false],[original.title.replace(tag,otherTag),scope.suffix,false],['other 桌宠 '+scope.suffix,scope.suffix,false],['dsh-pet '+scope.suffix,scope.suffix,false],
  [original.title.replace(tag,tag.toUpperCase()),scope.suffix,false]];
 const titles=spawnSync(exe,['title',...cases.flatMap(([title,suffix])=>[title,suffix])],{encoding:'utf8',windowsHide:true});assert.equal(titles.error,undefined);assert.equal(titles.status,0,titles.stderr);
 assert.deepEqual(titles.stdout.trim().split(/\r?\n/),cases.map(([, ,expected])=>expected?'True':'False'));
});
