'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const root=path.resolve(__dirname,'..'),home=process.env.DSH_HOME||path.join(os.homedir(),'.dsh');
const profile=path.join(home,'profiles/web'),manifest=path.join(profile,'package.json'),lockfile=path.join(profile,'pnpm-lock.yaml');
const jsonText=fs.readFileSync(manifest,'utf8'),data=JSON.parse(jsonText),lock=fs.readFileSync(lockfile,'utf8');
if(!Array.isArray(data.dsh?.profile?.bundles))throw Error('不是支持的 DSH profile');
const link='link:'+root.replaceAll('\\','/');
const node=path.join(profile,'node_modules/dsh-tableball');
if(fs.existsSync(node)&&fs.realpathSync(node).toLowerCase()!==root.toLowerCase())throw Error('已有其他同名插件，拒绝覆盖');
const stamp=Date.now(),backup=path.join(home,'tableball','install-backup-'+stamp);fs.mkdirSync(backup,{recursive:true});
fs.writeFileSync(path.join(backup,'package.json'),jsonText);fs.writeFileSync(path.join(backup,'pnpm-lock.yaml'),lock);
data.dependencies||={};data.dependencies['dsh-tableball']=link;
if(!data.dsh.profile.bundles.includes('dsh-tableball'))data.dsh.profile.bundles.push('dsh-tableball');
let next=lock;
if(!/^      dsh-tableball:/m.test(next)){
 const anchor='  .:\n    dependencies:\n';if(!next.includes(anchor))throw Error('未知的 pnpm importer 格式');
 const relative=path.relative(profile,root).replaceAll('\\','/');
 next=next.replace(anchor,anchor+'      dsh-tableball:\n        specifier: '+link+'\n        version: link:'+relative+'\n');
}
if(!fs.existsSync(node))fs.symlinkSync(root,node,'junction');
fs.writeFileSync(manifest,JSON.stringify(data,null,2)+'\n');fs.writeFileSync(lockfile,next);
console.log('Installed local dsh-tableball link. Restart DSH manually for auto-start. Backup: '+backup);
