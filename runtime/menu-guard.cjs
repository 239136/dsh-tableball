'use strict';
// A native popup must never compete with the always-on-top game canvas.
function createMenuGuard({window,isPaused,isClosing,cancelCharge,syncInput,resetMotion,localMenu=false,setSceneVisible=()=>{}}){
 let active=false;
 return {
  get active(){return active;},
  enter(){if(active||isClosing())return;active=true;cancelCharge();resetMotion();const w=window();if(w&&!w.isDestroyed()){w.setIgnoreMouseEvents(!localMenu);if(localMenu){w.setOpacity(1);setSceneVisible(false);}else w.setOpacity(0);}},
  leave(){if(!active)return;active=false;resetMotion();const w=window();if(isClosing()||!w||w.isDestroyed())return;if(localMenu)setSceneVisible(true);w.setOpacity(isPaused()?0:1);syncInput();}
 };
}
module.exports={createMenuGuard};
