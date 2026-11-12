'use strict';
// The Windows helper permits its transparent margin outside the work area.
// Sprite bottom margin is half its stage width; stage is 640x360.
function cueFromWindow(rect, work, screenToDip, settings={}) {
 if(!rect?.found || ![rect.x,rect.y,rect.width,rect.height,work.x,work.y].every(Number.isFinite) || !(rect.width>0) || !(rect.height>0)) return null;
 const topLeft=screenToDip({x:rect.x,y:rect.y});
 const bottomRight=screenToDip({x:rect.x+rect.width,y:rect.y+rect.height});
 const w=bottomRight.x-topLeft.x, h=bottomRight.y-topLeft.y;
 if(![w,h,topLeft.x,topLeft.y].every(Number.isFinite)||w<=0||h<=0)return null;
 const size=w/2, margin=size/2, stageH=size*9/16, bottomPad=stageH/12;
 const stageTop=topLeft.y+h-margin-stageH-bottomPad;
 return {x:topLeft.x+w/2-work.x+(settings.offsetX||0),
 y:stageTop+bottomPad+((50+335)/2/360)*stageH-work.y+(settings.offsetY||0),
 radius:size*(240/640)/2*(settings.cueScale||1),down:!!rect.down};
}
module.exports={cueFromWindow};
