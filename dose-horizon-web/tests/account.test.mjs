import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import account from '../netlify/functions/account.mjs';
const origin='https://tracker.test';
const fresh=()=>({schema:4,shots:[],weights:[],journal:[],medication:'Tirzepatide',goalWeightLb:0,waterGoalMl:0,proteinGoalG:0,weightUnit:'lb',reminders:[],stock:{},theme:'system'});
test('accounts: real SQL authentication, isolation, revocation, recovery, rate limits and validation',async()=>{
 const db=new PGlite({extensions:{pgcrypto}});await db.exec('create role anon; create role authenticated; create role service_role;');await db.exec(await readFile(new URL('../database/setup.sql',import.meta.url),'utf8'));
 const originalFetch=globalThis.fetch;
 Object.assign(process.env,{SUPABASE_URL:'https://test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-only-service-key',PIN_PEPPER:'test-only-'.repeat(5),APP_ORIGIN:origin});
 globalThis.fetch=async(url,opts)=>{assert.equal(url,'https://test.supabase.co/rest/v1/rpc/dh_account');const {p_action,p}=JSON.parse(opts.body);const r=await db.query('select public.dh_account($1,$2::jsonb) as result',[p_action,JSON.stringify(p)]);return Response.json(r.rows[0].result);};
 async function call(action,body={},cookie='',customOrigin=origin){const response=await account(new Request(origin+'/.netlify/functions/account',{method:'POST',headers:{origin:customOrigin,'content-type':'application/json',cookie},body:JSON.stringify({action,...body})}),{ip:'127.0.0.1'});return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0],headers:response.headers};}
 try{
 assert.equal((await call('session')).status,401);
 for(const pin of ['248','2468135790246'])assert.equal((await call('signup',{username:'boundary',pin})).status,400);
 assert.equal((await call('signup',{username:'alice',pin:'2468'},'', 'https://evil.test')).status,403);
 assert.equal((await call('signup',{username:'alice',pin:'111111'})).status,400);
 const a=await call('signup',{username:'Alice',pin:'2468'});assert.equal(a.status,200);assert.equal(a.body.username,'alice');assert(a.cookie);assert.match(a.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Strict/);assert.equal(a.body.recoveryCode.length,48);
 const b=await call('signup',{username:'bob',pin:'864209'});assert.equal(b.status,200);
 assert.equal((await call('signup',{username:'alice',pin:'2468'})).status,409);
 assert.equal((await call('login',{username:'missing',pin:'2468'})).status,401);
 assert.equal((await call('login',{username:'alice',pin:'246819'})).status,401);
 const data=fresh();data.journal=[{id:'entry',time:Date.now(),water:750,protein:60,nausea:0,constipation:0,fatigue:0,appetite:3,notes:'private',symptomsRecorded:true}];
 assert.equal((await call('save',{accountId:a.body.id,revision:0,data},a.cookie)).status,200);
 assert.equal((await call('session',{},b.cookie)).body.data.journal,undefined);
 assert.equal((await call('save',{accountId:a.body.id,revision:0,data},b.cookie)).status,401);
 assert.equal((await call('save',{accountId:a.body.id,revision:0,data},a.cookie)).status,409);
 assert.equal((await call('save',{accountId:a.body.id,revision:1,data:{}},a.cookie)).status,400);
 const login=await call('login',{username:'alice',pin:'2468'});assert.equal(login.body.data.journal[0].water,750);
 assert.equal((await call('logout',{},login.cookie)).status,200);assert.equal((await call('session',{},login.cookie)).status,401);
 assert.equal((await call('change-pin',{accountId:a.body.id,username:'alice',oldPin:'2468',pin:'7539'},a.cookie)).status,200);
 assert.equal((await call('login',{username:'alice',pin:'2468'})).status,401);
 await db.exec('delete from dh_private.limits');
 const recovered=await call('recover',{username:'alice',pin:'3579',recoveryCode:a.body.recoveryCode});assert.equal(recovered.status,200);assert.equal((await call('session',{},a.cookie)).status,401);assert.equal(recovered.body.data.journal[0].protein,60);assert.notEqual(recovered.body.recoveryCode,a.body.recoveryCode);
 assert.equal((await call('recover',{username:'alice',pin:'3579',recoveryCode:a.body.recoveryCode})).status,401);
 const rows=(await db.query('select pin_hash,recovery_hash from dh_private.accounts')).rows;assert(rows.every(r=>r.pin_hash.startsWith('$2a$12$')&&!r.recovery_hash.includes(a.body.recoveryCode)));
 await db.exec("update dh_private.sessions set expires_at=now()-interval '1 second'");assert.equal((await call('session',{},recovered.cookie)).status,401);
 await db.exec('delete from dh_private.limits');for(let i=0;i<8;i++)assert.equal((await call('login',{username:'missing',pin:'112358'})).status,401);assert.equal((await call('login',{username:'missing',pin:'112358'})).status,429);
 const permissions=(await db.query("select has_function_privilege('anon','public.dh_account(text,jsonb)','execute') as anon, has_function_privilege('authenticated','public.dh_account(text,jsonb)','execute') as auth, has_function_privilege('service_role','public.dh_account(text,jsonb)','execute') as service")).rows[0];assert.deepEqual(permissions,{anon:false,auth:false,service:true});
 }finally{globalThis.fetch=originalFetch;await db.close();}
});
