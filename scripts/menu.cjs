// Same controller as the plugin, for immediate use without restarting DSH.
const {MenuController}=require('../runtime/menu-controller.cjs');const {homedir}=require('node:os');const {join}=require('node:path');
const home=process.env.DSH_HOME||join(homedir(),'.dsh');
const controller=new MenuController({base:process.env.TABLEBALL_PET_URL||'http://127.0.0.1:3080/dsh-pet-7340',electron:join(home,'electron/electron.exe'),entry:join(__dirname,'../runtime/main.cjs'),leaseFile:join(home,'tableball/menu-owner.json'),env:{...process.env,TABLEBALL_HOST_PID:String(process.pid)}});
controller.run().catch(console.error);
let stopping=false;for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{if(stopping)return;stopping=true;await controller.dispose();process.exit();});
