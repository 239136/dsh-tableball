const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const compiler = path.join(process.env.WINDIR || 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
fs.mkdirSync(path.join(root,'runtime/bin'),{recursive:true});
const r=spawnSync(compiler,['/nologo','/optimize+','/target:exe','/out:'+path.join(root,'runtime/bin/pet-tracker.exe'),path.join(root,'native/PetTracker.cs')],{encoding:'utf8',windowsHide:true});
process.stdout.write(r.stdout||''); process.stderr.write(r.stderr||'');
if(r.error) console.error(r.error.message); process.exit(r.status ?? 1);
