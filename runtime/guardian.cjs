// Independent watchdog: restore configuration if the overlay crashes or is killed.
const fs=require('node:fs');const {PetBridge}=require('./pet-bridge.cjs');
const [pid,journal,base,file]=process.argv.slice(2);
const timer=setInterval(async()=>{try{process.kill(Number(pid),0);}catch{clearInterval(timer);if(fs.existsSync(journal)){try{await new PetBridge({journal,base,file}).recover();}catch(e){console.error(e.message);}}process.exit();}},1000);
