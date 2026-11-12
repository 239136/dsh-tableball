'use strict';
const net=require('node:net');
function listen(pipe,onCommand){
 const server=net.createServer(socket=>{socket.setEncoding('utf8');let buffer='';socket.on('error',()=>{});socket.on('data',chunk=>{buffer+=chunk;if(buffer.length>128){socket.destroy();return;}const end=buffer.indexOf('\n');if(end<0)return;const command=buffer.slice(0,end);buffer='';socket.end('ok\n');onCommand(command);});});
 server.listen(pipe);return server;
}
function send(pipe,command){return new Promise((resolve,reject)=>{
 const socket=net.connect(pipe);socket.setTimeout(500);socket.on('connect',()=>socket.end(command+'\n'));socket.on('data',()=>{});socket.on('end',resolve);socket.on('error',reject);socket.on('timeout',()=>socket.destroy(Error('control pipe timeout')));
});}
module.exports={listen,send};
