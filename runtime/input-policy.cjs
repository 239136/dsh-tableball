(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.TableBallInput=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 function stick(cue,aim){if(!cue||!aim)return null;const start=cue.radius+18+Math.max(0,Math.min(1,aim.charge||0))*65,length=220;return {start,length,near:{x:cue.x-aim.dx*start,y:cue.y-aim.dy*start},far:{x:cue.x-aim.dx*(start+length),y:cue.y-aim.dy*(start+length)}};}
 function segmentDistance(p,a,b){const dx=b.x-a.x,dy=b.y-a.y,d=dx*dx+dy*dy,t=d?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/d)):0;return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);}
 function hit(cue,aim,pointer,mode='cue'){if(!cue||cue.pocketed||!pointer||![pointer.x,pointer.y,cue.x,cue.y,cue.radius].every(Number.isFinite))return false;if(Math.hypot(pointer.x-cue.x,pointer.y-cue.y)<=cue.radius+7)return true;const rod=stick(cue,aim);return mode==='cue'&&rod&&segmentDistance(pointer,rod.near,rod.far)<=12;}
 class InputPolicy{
  constructor(){this.armed=false;}
  reset(){this.armed=false;}
  evaluate(s){
   const result=(capture,reason,aim=false,escape=false)=>({capture,reason,aim,escape,armed:this.armed});
   if(s.closing){this.reset();return result(false,'inactive');}
   if(s.menu){this.reset();return result(true,'menu',false,true);}
   if(s.paused||s.closing||s.transition||s.desktopPass){this.reset();return result(false,s.desktopPass?'desktop':'inactive');}
   if(s.charging||s.dragging||s.placing)return result(true,'gesture',true,true);
   if(s.policy==='focus')return result(true,'focus',true,false);
   if(!s.canShoot||!s.cue||s.cue.pocketed){this.reset();return result(false,'rolling');}
   const target=hit(s.cue,s.aim,s.pointer,s.mode);
   if(target)this.armed=true;
   const rod=stick(s.cue,s.aim),range=s.mode==='cue'?(rod?.start||s.cue.radius)+220+16:s.cue.radius+7;
   if(!s.pointer||Math.hypot(s.pointer.x-s.cue.x,s.pointer.y-s.cue.y)>range)this.reset();
   return target||this.armed?result(true,'cue',true):result(false,'applications');
  }
 }
 function escapeAction({enabled=true,menu=false,gesture=false,closing=false}={}){if(closing)return 'none';if(enabled)return 'quit';if(menu)return 'menu';return gesture?'cancel':'none';}
 return {stick,hit,segmentDistance,InputPolicy,escapeAction};
});
