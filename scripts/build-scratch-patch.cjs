'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process'),{createHash,randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'..');
const base='e495cc96427cc24c95b7275c48722e1b670019d6';
const version='0.5.1';
const paths=['package.json','SBOM.json','runtime/rack-session.cjs','runtime/input-policy.cjs','runtime/main.cjs','runtime/renderer.js'];
const hash=data=>createHash('sha256').update(data).digest('hex');
function git(args){const r=spawnSync('git',args,{cwd:root,windowsHide:true,maxBuffer:16*1024*1024});if(r.status!==0)throw Error('Base source unavailable');return r.stdout;}
function write(file,bytes){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);}
function powershell(script,env){const r=spawnSync('powershell',['-NoProfile','-Command',script],{env:{...process.env,...env},encoding:'utf8',windowsHide:true,timeout:60000});if(r.status!==0)throw Error('Patch archive operation failed: '+r.stderr.slice(-600));}
function build(){
 if(JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version!==version)throw Error('This patch builder targets 0.5.1 only');
 const stage=path.join(root,'.dsh/patch-build',randomUUID());fs.mkdirSync(stage,{recursive:true});
 const manifest={baseVersion:'0.5.0',version,baseCommit:base,files:[]};
 for(const relative of paths){const data=fs.readFileSync(path.join(root,relative));write(path.join(stage,relative),data);manifest.files.push({path:relative,baseSha256:hash(git(['show',base+':'+relative])),sha256:hash(data)});}
 write(path.join(stage,'PATCH-0.5.1.md'),fs.readFileSync(path.join(root,'PATCH-0.5.1.md')));
 write(path.join(stage,'PATCH-MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n');
 const finalPath=path.join(root,'dist/TableBall-0.5.1-scratch-fix.zip');fs.mkdirSync(path.dirname(finalPath),{recursive:true});if(fs.existsSync(finalPath))throw Error('Patch already exists; do not overwrite an accepted file');const out=stage+'.zip';
 powershell('Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory($env:PATCH_SOURCE,$env:PATCH_ZIP,[IO.Compression.CompressionLevel]::Optimal,$false)',{PATCH_SOURCE:stage,PATCH_ZIP:out});
 // Validate the actual ZIP applied to isolated 0.5.0 source, never the live application.
 const target=fs.mkdtempSync(path.join(os.tmpdir(),'tableball-patch-check-'));
 for(const relative of paths)write(path.join(target,relative),git(['show',base+':'+relative]));
 const names=git(['ls-tree','-r','--name-only',base,'runtime','vendor/rack']).toString('utf8').trim().split('\n');
 for(const relative of names)if((relative.startsWith('runtime/')&&/\.(cjs|js)$/.test(relative))||relative.startsWith('vendor/rack/'))write(path.join(target,relative),git(['show',base+':'+relative]));
 for(const name of ['lan-placement.test.cjs','rack-scratch.test.cjs'])write(path.join(target,'test',name),fs.readFileSync(path.join(root,'test',name)));
 for(const record of manifest.files)if(hash(fs.readFileSync(path.join(target,record.path)))!==record.baseSha256)throw Error('Wrong base for patch test');
 const extract='Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[IO.Compression.ZipFile]::OpenRead($env:PATCH_ZIP); try { foreach($e in $z.Entries){ $p=[IO.Path]::GetFullPath((Join-Path $env:PATCH_TARGET $e.FullName)); if(-not $p.StartsWith($env:PATCH_TARGET+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw "Unsafe patch entry"}; [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($p))|Out-Null; [IO.Compression.ZipFileExtensions]::ExtractToFile($e,$p,$true) }} finally {$z.Dispose()}';
 powershell(extract,{PATCH_ZIP:out,PATCH_TARGET:target});
 for(const record of manifest.files)if(hash(fs.readFileSync(path.join(target,record.path)))!==record.sha256)throw Error('Patched byte mismatch');
 const result=spawnSync(process.execPath,['--test',path.join(target,'test/lan-placement.test.cjs'),path.join(target,'test/rack-scratch.test.cjs')],{cwd:target,env:require('../runtime/unified-layout.cjs').safeEnvironment(),encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:2*1024*1024});
 if(result.status!==0)throw Error('Patch regression failed: '+result.stdout.slice(-4000));
 const sha256=hash(fs.readFileSync(out));fs.renameSync(out,finalPath);fs.writeFileSync(finalPath+'.sha256',sha256+'  '+path.basename(finalPath)+'\n');
 const tests=Number(result.stdout.match(/tests ([0-9]+)/)?.[1]);if(!Number.isSafeInteger(tests)||tests<17)throw Error('Incomplete patch regression output');const receipt={zip:finalPath,sha256,bytes:fs.statSync(finalPath).size,files:paths.length,verifiedAgainstBase:'0.5.0',isolatedPatchTests:tests,personalDataTouched:false};
 fs.writeFileSync(path.join(root,'.dsh/latest-scratch-patch.json'),JSON.stringify(receipt,null,2));
 console.log(JSON.stringify(receipt));
}
try{build();}catch(e){console.error(e.message);process.exitCode=1;}
