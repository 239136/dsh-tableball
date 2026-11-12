(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.TableBallViewport=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 function fit(table,area){const width=area?.width||table.width,height=area?.height||table.height;if(![width,height,table.width,table.height].every(n=>Number.isFinite(n)&&n>0))throw Error('Invalid viewport');const scale=Math.min(width/table.width,height/table.height);return {width,height,scale,x:(width-table.width*scale)/2,y:(height-table.height*scale)/2,worldX:table.x||0,worldY:table.y||0};}
 function toWorld(view,p){return {x:(p.x-view.x)/view.scale+view.worldX,y:(p.y-view.y)/view.scale+view.worldY};}
 function toLocal(view,p){return {x:view.x+(p.x-view.worldX)*view.scale,y:view.y+(p.y-view.worldY)*view.scale};}
 return {fit,toWorld,toLocal};
});
