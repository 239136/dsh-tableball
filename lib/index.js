import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const { MenuController }=createRequire(import.meta.url)('../runtime/menu-controller.cjs');
export function apply(ctx) {
  if (process.platform !== 'win32') return;
  const home=process.env.DSH_HOME||join(homedir(),'.dsh');
  const root=join(dirname(fileURLToPath(import.meta.url)),'..');
  const controller=new MenuController({
    base:process.env.TABLEBALL_PET_URL||'http://127.0.0.1:3080/dsh-pet-7340',
    electron:join(home,'electron','electron.exe'),entry:join(root,'runtime','main.cjs'),leaseFile:join(home,'tableball/menu-owner.json'),
    env:{...process.env,TABLEBALL_HOST_PID:String(process.pid)},
    log:error=>console.error('[tableball menu]',error.message||error),
  });
  // Register only the menu. No game window/tracker/tray until the user enters.
  void controller.run();ctx.on('dispose',()=>controller.dispose());
}
