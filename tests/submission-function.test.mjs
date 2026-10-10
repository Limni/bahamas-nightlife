import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isolatedSource } from './helpers.mjs';
function handler(admin,salt='a'.repeat(32)) {
 let serve;
 isolatedSource('supabase/functions/submit-suggestion/index.ts',{Request,Response,File,TextDecoder,crypto,createClient:()=>admin,corsHeaders:{},Deno:{env:{get:key=>({SUBMISSION_RATE_SALT:salt,SUPABASE_ANON_KEY:'anon'})[key]},serve:fn=>serve=fn}});
 return serve;
}
function request(payload={},photos=[]) {
 const body=new FormData();body.set('request_id','11111111-1111-4111-8111-111111111111');body.set('suggestion',JSON.stringify({kind:'other',message:'Test tip',...payload}));
 photos.forEach(file=>body.append('photos',file));
 return new Request('https://example.test/suggestion',{method:'POST',headers:{Authorization:'Bearer anon','x-forwarded-for':'192.0.2.1'},body});
}
test('server enforces quota decisions and sanitizes caller-controlled identity',async()=>{
 let finish;
 const admin={rpc:async(name,args)=>{if(name==='reserve_suggestion')return{data:'ready'};finish=args;return{};}};
 const response=await handler(admin)(request({user_id:'forged',status:'done',admin_note:'forged'}));
 assert.equal(response.status,200);assert.equal(finish.p_payload.user_id,null);assert.equal(finish.p_payload.status,undefined);assert.equal(finish.p_payload.admin_note,undefined);
 assert.equal((await handler({rpc:async()=>({data:'limit'})})(request())).status,429);
});
test('completed retries do not insert or upload again',async()=>{
 let calls=0;
 assert.equal((await handler({rpc:async()=>{calls++;return{data:'done'};}})(request())).status,200);
 assert.equal(calls,1);
});
test('invalid photos and missing server configuration fail closed',async()=>{
 assert.equal((await handler({})(request({},[new File(['<svg>'],'bad.png',{type:'image/png'})]))).status,400);
 assert.equal((await handler({},'')(request())).status,503);
});
