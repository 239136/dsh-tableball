'use strict';
function scopeFromEnv(env=process.env,petId=env.TABLEBALL_PET_ID||'main'){
 const tag=env.TABLEBALL_PET_SCOPE_TAG;if(tag===undefined)return null;
 if(typeof tag!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(tag))throw Error('Invalid owned-pet scope tag');
 if(typeof petId!=='string'||!petId||petId.length>64||/[\x00-\x1f\x7f]/.test(petId))throw Error('Invalid owned-pet identifier');
 let encoded;try{encoded=encodeURIComponent(petId);}catch{throw Error('Invalid owned-pet identifier');}
 return Object.freeze({tag,petId,suffix:'[tableball:'+tag+':'+encoded+']'});
}
function inspectArgs(scope){if(scope==null)return ['inspect'];const expected=scopeFromEnv({TABLEBALL_PET_SCOPE_TAG:scope.tag},scope.petId);if(scope.suffix!==expected.suffix)throw Error('Invalid owned-pet scope');return ['inspect',expected.suffix];}
module.exports={scopeFromEnv,inspectArgs};
