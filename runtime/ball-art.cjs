(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.TableBallArt=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const PALETTE=Object.freeze(['#e9b629','#3068be','#bd3039','#79529f','#e4772c','#278169','#913b47','#18232d','#e9b629']);
 const cache=new Map();let shadow=null;
 const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
 function rgb(hex){return [parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16)];}
 function shade(nx,ny,color,kind='solid'){
  const d=nx*nx+ny*ny;if(d>1+1e-9)return [0,0,0,0];const z=Math.sqrt(Math.max(0,1-d));let base=color;
  if(kind==='stripe'&&Math.abs(ny)>.46)base='#f3f1e8';
  const source=rgb(base),light=Math.max(0,-.42*nx-.53*ny+.737*z),lambert=.28+.76*light;
  const half=Math.max(0,-.31*nx-.4*ny+.8625*z),spec=Math.pow(half,100)*.6;
  const ribbon=Math.exp(-Math.pow((nx+.08)/.48,2)-Math.pow((ny+.64)/.12,2))*.045;
  const rim=Math.pow(1-z,4)*.07;const bounce=Math.max(0,nx*.4+ny*.3)*.035;
  return source.map((v,i)=>Math.round(255*Math.pow(clamp(Math.pow(v/255,2.2)*lambert+spec+ribbon+rim+(i===2?bounce:bounce*.6)),1/2.2))).concat(255);
 }
 function raster(size,color,kind='solid'){
  if(!Number.isInteger(size)||size<4||size>512)throw Error('Invalid sphere texture size');const data=new Uint8ClampedArray(size*size*4),r=size/2;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){const nx=(x+.5-r)/r,ny=(y+.5-r)/r,d=Math.hypot(nx,ny);if(d>1+.5/r)continue;const c=shade(nx/Math.max(1,d),ny/Math.max(1,d),color,kind);const i=(y*size+x)*4;data[i]=c[0];data[i+1]=c[1];data[i+2]=c[2];data[i+3]=Math.round(255*clamp((1-d)*r+.5));}return data;
 }
 function texture(color,kind,r,dpr){const size=Math.max(96,Math.min(384,Math.ceil(r*2*Math.max(1,dpr)*1.8/32)*32)),key=color+':'+kind+':'+size;if(cache.has(key))return cache.get(key);const canvas=document.createElement('canvas');canvas.width=canvas.height=size;const c=canvas.getContext('2d'),image=c.createImageData(size,size);image.data.set(raster(size,color,kind));c.putImageData(image,0,0);cache.set(key,canvas);return canvas;}
 function shadowTexture(){if(shadow)return shadow;shadow=document.createElement('canvas');shadow.width=128;shadow.height=40;const c=shadow.getContext('2d');c.translate(64,20);c.scale(64,20);const g=c.createRadialGradient(0,0,0,0,0,1);g.addColorStop(0,'rgba(2,9,13,.38)');g.addColorStop(.3,'rgba(2,9,13,.25)');g.addColorStop(.65,'rgba(2,9,13,.09)');g.addColorStop(1,'rgba(2,9,13,0)');c.fillStyle=g;c.fillRect(-1,-1,2,2);return shadow;}
 function circle(c,x,y,r){c.beginPath();c.arc(x,y,r,0,Math.PI*2);}
 function base(c,b,color,kind='solid',dpr=1){c.save();c.drawImage(shadowTexture(),b.x-b.radius*1.05,b.y+b.radius*.57,b.radius*2.3,b.radius*.65);c.drawImage(texture(color,kind,b.radius,dpr),b.x-b.radius,b.y-b.radius,b.radius*2,b.radius*2);c.restore();}
 function coat(c,b,strength=1){c.save();c.globalAlpha*=strength;circle(c,b.x,b.y,b.radius*.995);c.clip();
  // A reflection belongs to the light source, not to the rolling decal.
  const glow=c.createRadialGradient(b.x-b.radius*.29,b.y-b.radius*.37,0,b.x-b.radius*.29,b.y-b.radius*.37,b.radius*.22);glow.addColorStop(0,'rgba(255,255,255,.44)');glow.addColorStop(.38,'rgba(255,255,255,.17)');glow.addColorStop(1,'rgba(255,255,255,0)');c.fillStyle=glow;c.fillRect(b.x-b.radius,b.y-b.radius,b.radius*2,b.radius*2);
  c.save();c.translate(b.x-b.radius*.34,b.y-b.radius*.47);c.rotate(-.5);c.fillStyle='rgba(255,255,255,.7)';c.beginPath();c.ellipse(0,0,b.radius*.105,b.radius*.045,0,0,Math.PI*2);c.fill();c.restore();
  c.lineWidth=Math.max(.55,b.radius*.018);c.strokeStyle='rgba(255,255,255,.28)';c.beginPath();c.arc(b.x,b.y,b.radius*.96,Math.PI*1.08,Math.PI*1.72);c.stroke();c.restore();
 }
 function drawBall(c,b,{image,phase=0,dpr=1}={}){
  const folder=typeof b.name==='string';const color=folder?'#dce8e6':PALETTE[b.id>=9?(b.id-9)%7:(Math.max(1,b.id)-1)%9];base(c,b,color,!folder&&b.id>=9?'stripe':'solid',dpr);c.save();circle(c,b.x,b.y,b.radius*.96);c.clip();c.translate(b.x,b.y);c.rotate(phase*(folder?.12:.7));
  if(folder){
   if(image?.complete&&image.naturalWidth){const w=b.radius*1.28,h=w*(image.naturalHeight/image.naturalWidth);c.imageSmoothingEnabled=true;c.imageSmoothingQuality='high';c.drawImage(image,-w/2,-h/2,w,h);}
   else{c.fillStyle='#e2ae30';c.beginPath();c.roundRect(-b.radius*.58,-b.radius*.35,b.radius*1.16,b.radius*.82,b.radius*.08);c.fill();c.fillStyle='#f4ce62';c.fillRect(-b.radius*.58,-b.radius*.49,b.radius*.48,b.radius*.23);}
  }else{
   const r=b.radius*.385,g=c.createLinearGradient(-r,-r,r,r);g.addColorStop(0,'#fffef4');g.addColorStop(1,'#d9d8c9');c.fillStyle=g;c.beginPath();c.ellipse(0,b.radius*.015,r,r*.95,0,0,Math.PI*2);c.fill();c.strokeStyle='rgba(37,43,39,.12)';c.lineWidth=.6;c.stroke();c.fillStyle='#1a2730';c.textAlign='center';c.textBaseline='middle';c.font='600 '+Math.max(10,Math.round(b.radius*.7))+'px Arial,sans-serif';c.fillText(String(b.id),0,b.radius*.035);
  }
  c.restore();coat(c,b);
 }
 function cueBase(c,b,dpr=1){base(c,b,'#e8efed','solid',dpr);}
 function advanceRoll(previous,b){if(!previous||previous.radius!==b.radius)return {x:b.x,y:b.y,radius:b.radius,phase:0};const dx=b.x-previous.x,dy=b.y-previous.y,d=Math.hypot(dx,dy);return {x:b.x,y:b.y,radius:b.radius,phase:d>b.radius*6?previous.phase:(previous.phase+d/b.radius)%(Math.PI*2)};}
 return {PALETTE,shade,raster,drawBall,cueBase,coat,advanceRoll};
});
