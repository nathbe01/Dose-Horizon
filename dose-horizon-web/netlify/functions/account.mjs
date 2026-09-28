import {createHash,createHmac,randomBytes} from 'node:crypto';
const COOKIE='__Host-dh_session',MAX=2*1024*1024;
const digest=s=>createHash('sha256').update(s).digest('hex');
const messages={rate:'Too many attempts. Please wait 15 minutes before trying again (new accounts may take an hour).',unavailable:'That username is unavailable. Choose another.',credentials:'The username, PIN, or recovery code is incorrect.',session:'Please log in again.',conflict:'Your records changed elsewhere. Load the latest records and try again.',request:'Invalid request.'};
const reply=(status,body,cookie)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store, private','Netlify-CDN-Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(cookie?{'Set-Cookie':cookie}:{})}});
const cookie=(token,age=604800)=>`${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
const pinOK=p=>typeof p==='string'&&/^\d{4,12}$/.test(p);
function validData(d){
 if(!d||typeof d!=='object'||Array.isArray(d))return false;
 for(const key of ['shots','weights','journal'])if(!Array.isArray(d[key])||d[key].length>10000)return false;
 const finite=(x,min,max)=>Number.isFinite(x)&&x>=min&&x<=max;
 for(const key of ['shots','weights','journal'])for(const r of d[key]){
  if(!r||typeof r.id!=='string'||r.id.length>100||!finite(r.time,1,Date.now()+60000))return false;
  if(key==='shots'&&(!['Tirzepatide','Semaglutide'].includes(r.med)||!finite(r.dose,.01,100)||typeof r.site!=='string'||typeof r.symptoms!=='string'))return false;
  if(key==='weights'&&!finite(r.lb,30,1500))return false;
  if(key==='journal'&&(!['water','protein','nausea','constipation','fatigue','appetite'].every(k=>finite(r[k],0,k==='water'?30000:k==='protein'?2000:k==='appetite'?5:3))||typeof r.notes!=='string'))return false;
 }
 if(!['system','light','dark'].includes(d.theme)||!['lb','kg'].includes(d.weightUnit)||!['Tirzepatide','Semaglutide'].includes(d.medication))return false;
 for(const [k,max] of [['goalWeightLb',1500],['waterGoalMl',30000],['proteinGoalG',2000]])if(!finite(d[k],0,max))return false;
 if(!Array.isArray(d.reminders)||d.reminders.length>6||!d.stock||typeof d.stock!=='object'||Array.isArray(d.stock))return false;
 for(const r of d.reminders)if(!r||typeof r.id!=='string'||!/^\d{2}:\d{2}$/.test(r.time)||!finite(Number(r.time.slice(0,2)),0,23)||!finite(Number(r.time.slice(3)),0,59)||typeof r.enabled!=='boolean'||!['water','protein','shot'].includes(r.kind)||(r.kind==='shot'&&(!['Tirzepatide','Semaglutide'].includes(r.med)||!Number.isInteger(r.day)||r.day<0||r.day>6)))return false;
 for(const [k,v] of Object.entries(d.stock))if(!['Tirzepatide','Semaglutide'].includes(k)||!Number.isInteger(v)||v<0||v>10000)return false;
 return true;
}
export default async function account(request,context){
 const {SUPABASE_URL:url,SUPABASE_SERVICE_ROLE_KEY:key,PIN_PEPPER:pepper,APP_ORIGIN:origin}=process.env;
 if(!url||!key||!pepper||pepper.length<32||!origin)return reply(503,{error:'Account setup is not complete. The site owner needs to finish the included setup guide.'});
 if(request.method!=='POST')return reply(405,{error:'Use POST.'});
 if(request.headers.get('origin')!==origin||request.headers.get('sec-fetch-site')==='cross-site')return reply(403,{error:'Request origin is not allowed.'});
 if(!request.headers.get('content-type')?.startsWith('application/json'))return reply(415,{error:'JSON required.'});
 let b;try{const raw=await request.text();if(Buffer.byteLength(raw)>MAX)return reply(413,{error:'Records exceed the 2 MB account limit.'});b=JSON.parse(raw);if(!b||typeof b!=='object'||Array.isArray(b))throw Error();}catch{return reply(400,{error:'Invalid request.'});}
 const action=b.action,allowed=['signup','login','recover','session','save','logout','change-pin'];if(!allowed.includes(action))return reply(400,{error:'Invalid request.'});
 const token=request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1)||'';
 const p={sessionHash:digest(token),accountId:b.accountId};let newToken,recoveryCode;
 const proof=(u,pin)=>createHmac('sha256',pepper).update(`pin:${u}:${pin}`).digest('hex');
 if(['signup','login','recover'].includes(action)){
  const username=typeof b.username==='string'?b.username.trim().toLowerCase():'';
  if(!/^[a-z0-9_]{3,24}$/.test(username)||!pinOK(b.pin))return reply(400,{error:'Use a username with 3–24 letters, numbers, or underscores and a 4–12 digit PIN.'});
  if(!context?.ip)return reply(503,{error:'Account service is temporarily unavailable.'});
  p.username=username;p.ip=createHmac('sha256',pepper).update('ip:'+context.ip).digest('hex');p.proof=proof(username,b.pin);
  newToken=randomBytes(32).toString('hex');p.newSessionHash=digest(newToken);
  if(action==='signup'||action==='recover'){
   if(/^(\d)\1+$/.test(b.pin)||'01234567890123456789'.includes(b.pin)||'98765432109876543210'.includes(b.pin))return reply(400,{error:'Choose a PIN that is not repeated or sequential digits.'});
   recoveryCode=randomBytes(24).toString('hex');
   if(action==='signup')p.recoveryHash=digest(recoveryCode);else{if(typeof b.recoveryCode!=='string'||! /^[a-f0-9]{48}$/i.test(b.recoveryCode.trim()))return reply(400,{error:'Enter your 48-character recovery code.'});p.recoveryHash=digest(b.recoveryCode.trim().toLowerCase());p.newRecoveryHash=digest(recoveryCode);}
  }
 }else if(!/^[a-f0-9]{64}$/.test(token)){return reply(401,{error:messages.session,code:'session'},cookie('',0));}
 if(action==='save'){
  if(!Number.isInteger(b.revision)||b.revision<0||!validData(b.data))return reply(400,{error:'Some records are invalid. Check your entries or backup.'});
  p.revision=b.revision;p.data=b.data;
 }
 if(action==='change-pin'){
  if(!pinOK(b.pin)||!pinOK(b.oldPin)||typeof b.username!=='string'||!/^[a-z0-9_]{3,24}$/.test(b.username)||/^(\d)\1+$/.test(b.pin)||'01234567890123456789'.includes(b.pin)||'98765432109876543210'.includes(b.pin))return reply(400,{error:'Use a 4–12 digit PIN without repeated or sequential digits.'});
  p.proof=proof(b.username,b.pin);p.oldProof=proof(b.username,b.oldPin);
 }
 try{
  const response=await fetch(url.replace(/\/$/,'')+'/rest/v1/rpc/dh_account',{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({p_action:action,p}),signal:AbortSignal.timeout(15000)});
  if(!response.ok)return reply(503,{error:'Account service is unavailable. Please try again shortly.'});
  const result=await response.json();
  if(result.error)return reply(result.status||400,{error:messages[result.error]||messages.request,code:result.error},result.error==='session'?cookie('',0):undefined);
  return reply(200,{...result,...(recoveryCode?{recoveryCode}:{})},newToken?cookie(newToken):action==='logout'?cookie('',0):undefined);
 }catch{return reply(503,{error:'Cannot reach the account service. Please try again.'});}
}
