'use strict';
function bounded(operation,ms,onTimeout=()=>{}){let timer;const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{try{onTimeout();}finally{reject(Error('Owned service deadline exceeded'));}},ms);});return Promise.race([Promise.resolve().then(operation),timeout]).finally(()=>clearTimeout(timer));}
async function ownedJson(fetcher,url,ms=1500){const abort=new AbortController();return bounded(async()=>{const response=await fetcher(url,{signal:abort.signal});if(!response.ok)throw Error('Owned service unavailable');return response.json();},ms,()=>abort.abort());}
async function ownedShutdown(fetcher,url,ms=2000){const abort=new AbortController();return bounded(()=>fetcher(url,{method:'POST',signal:abort.signal}),ms,()=>abort.abort());}
module.exports={bounded,ownedJson,ownedShutdown};
