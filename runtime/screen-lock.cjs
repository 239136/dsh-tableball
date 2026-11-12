'use strict';
function selectGameDisplay(displays,point,primaryId){
 const hit=displays.find(d=>point.x>=d.workArea.x&&point.x<d.workArea.x+d.workArea.width&&point.y>=d.workArea.y&&point.y<d.workArea.y+d.workArea.height);
 return hit||displays.find(d=>d.id===primaryId)||displays[0];
}
function returnToLockedScreen(cue,work){
 if(cue.down||cue.x>=0&&cue.x<=work.width&&cue.y>=0&&cue.y<=work.height)return null;
 const margin=Math.min(cue.radius,work.width/4,work.height/4);
 return {x:Math.min(work.width-margin,Math.max(margin,cue.x)),y:Math.min(work.height-margin,Math.max(margin,cue.y))};
}
module.exports={selectGameDisplay,returnToLockedScreen};
