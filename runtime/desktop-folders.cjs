'use strict';
const {execFile}=require('node:child_process');const path=require('node:path');
function captureDesktopFolders(){return new Promise((resolve,reject)=>{execFile(path.join(__dirname,'bin/desktop-folders.exe'),[],{windowsHide:true,encoding:'utf8',timeout:10000,maxBuffer:16*1024*1024},(error,stdout)=>{if(error)return reject(error);try{const v=JSON.parse(stdout.replace(/^\uFEFF/,''));if(!Array.isArray(v.folders))throw Error('Invalid desktop snapshot');resolve(v);}catch(e){reject(e);}});});}
function mapDesktopFolders(snapshot,work,{radius=20,screenBounds=work,includeAll=false,pocketRadius=radius*1.8}={}){
 if(!snapshot||!Array.isArray(snapshot.folders)||!Number.isFinite(radius)||radius<=0)throw Error('Invalid folder snapshot or radius');
 const seen=new Set(),seeds=[];const cols=Math.max(1,Math.floor((work.width-160)/(radius*3.5)));let fallback=0;
 for(const folder of snapshot.folders){if(typeof folder.id!=='string'||seen.has(folder.id))continue;seen.add(folder.id);const exact=Number.isFinite(folder.x)&&Number.isFinite(folder.y);
 const onScreen=exact&&folder.x>=screenBounds.x&&folder.x<screenBounds.x+screenBounds.width&&folder.y>=screenBounds.y&&folder.y<screenBounds.y+screenBounds.height;
 if(exact&&!onScreen&&!includeAll)continue;
 const home=exact?{x:folder.x-work.x,y:folder.y-work.y}:{x:80+(fallback%cols)*radius*3.5,y:160+Math.floor(fallback++/cols)*radius*3.5};
 let x=onScreen?Math.max(radius*2.3,Math.min(work.width-radius*2.3,home.x)):80+(fallback%cols)*radius*3.5;
 let y=onScreen?Math.max(radius*2.3,Math.min(work.height-radius*2.3,home.y)):160+Math.floor(fallback++/cols)*radius*3.5;
 let attempts=0;
 while(seeds.some(s=>Math.hypot(s.x-x,s.y-y)<radius*2.1)&&attempts++<500){x=80+(fallback%cols)*radius*3.5;y=160+Math.floor(fallback++/cols)*radius*3.5;}
 x=Math.max(radius*2.3,Math.min(work.width-radius*2.3,x));y=Math.max(radius*2.3,Math.min(work.height-radius*2.3,y));
 const pockets=[[0,0],[work.width/2,0],[work.width,0],[0,work.height],[work.width/2,work.height],[work.width,work.height]];
 for(const [px,py]of pockets){const dx=x-px,dy=y-py,d=Math.hypot(dx,dy),safe=pocketRadius+radius*.4;if(d<safe){const len=d||1;x=px+(dx/len||1)*safe;y=py+(dy/len)*safe;}}
 x=Math.max(radius+5,Math.min(work.width-radius-5,x));y=Math.max(radius+5,Math.min(work.height-radius-5,y));
 seeds.push({id:seeds.length+1,sourceId:folder.id,name:String(folder.name||''),x,y,home:{...home},radius,iconDataUrl:typeof folder.iconDataUrl==='string'&&/^data:image\/png;base64,[a-z0-9+/=]+$/i.test(folder.iconDataUrl)?folder.iconDataUrl:undefined});}
 return seeds;
}
module.exports={captureDesktopFolders,mapDesktopFolders};
