'use strict';
/** Hide synchronously; bound process teardown without dropping the recovery journal.
 * An independent guardian retries any unfinished configuration reload after exit. */
function createShutdown({hide,stop,waitForMode,restore,finish,log=()=>{},deadlineMs=350}) {
 let task;
 return function shutdown(){
  if(task)return task;
  // No network, renderer unload or pending mode operation on the visual exit path.
  try{hide();}catch(error){log(error);}
  try{stop();}catch(error){log(error);}
  task=(async()=>{
   let timer;
   const cleanup=Promise.resolve().then(waitForMode).catch(log).then(restore).catch(log);
   const deadline=new Promise(resolve=>{timer=setTimeout(resolve,deadlineMs);});
   try{await Promise.race([cleanup,deadline]);}finally{clearTimeout(timer);finish();}
  })();
  return task;
 };
}
module.exports={createShutdown};
