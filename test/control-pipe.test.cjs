const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os'),{randomUUID}=require('node:crypto');
const {listen,send}=require('../runtime/control-pipe.cjs');
test('native local control pipe delivers exit without waiting for stdin or kill fallback',async t=>{
 const pipe=process.platform==='win32'?'\\\\.\\pipe\\tableball-test-'+randomUUID():path.join(os.tmpdir(),'tableball-test-'+randomUUID()+'.sock');
 let command;const server=listen(pipe,value=>{command=value;});await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});t.after(()=>new Promise(resolve=>server.close(resolve)));
 await send(pipe,'exit');assert.equal(command,'exit');
});
