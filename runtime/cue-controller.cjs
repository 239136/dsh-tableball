'use strict';
class CueController {
 constructor({chargeMs=1500,minPower=.12,maxPower=3.5,clock=()=>performance.now()}={}){this.chargeMs=chargeMs;this.minPower=minPower;this.maxPower=maxPower;this.clock=clock;this.pointer={x:0,y:0};this.started=null;}
 move(x,y){if(!Number.isFinite(x)||!Number.isFinite(y))return false;this.pointer={x,y};return true;}
 begin(cue){if(!cue||this.started!==null)return false;this.started=this.clock();return true;}
 cancel(){this.started=null;}
 snapshot(cue){const charge=this.started===null?0:Math.min(1,Math.max(0,(this.clock()-this.started)/this.chargeMs));const dx=(cue?.x||0)-this.pointer.x,dy=(cue?.y||0)-this.pointer.y;const length=Math.hypot(dx,dy);return {pointer:{...this.pointer},charging:this.started!==null,charge,dx:length>1?dx/length:1,dy:length>1?dy/length:0};}
 release(cue){if(this.started===null)return null;const s=this.snapshot(cue),held=this.clock()-this.started;this.cancel();if(!cue||held<50)return null;return {angle:Math.atan2(-s.dy,s.dx)*180/Math.PI,power:this.minPower+(this.maxPower-this.minPower)*s.charge};}
}
module.exports={CueController};
