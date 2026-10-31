// Run ONLY against the disposable local backend created by test-security.ps1.
const assert = require('node:assert/strict');
const base = process.env.CHECKY_TEST_URL || 'http://127.0.0.1:18090';
if (!['127.0.0.1','localhost'].includes(new URL(base).hostname)) throw new Error('Security tests require a disposable localhost server.');
const password = 'Test-Only-20261030-password';
let sequence = 0;
const suffix = Date.now().toString(36);
async function request(url, method='GET', body, headers={}) {
  const response = await fetch(base+url,{method,headers:{'Content-Type':'application/json','X-Checky-Client-IP':'192.0.2.'+(++sequence%240+1),...headers},body:body===undefined?undefined:JSON.stringify(body)});
  const raw = await response.text();
  return {status:response.status,data:raw?JSON.parse(raw):{},cookie:(response.headers.get('set-cookie')||'').split(';')[0]};
}
const check = (name) => console.log('PASS '+name);
const data = text => ({active:0,tabs:[{id:'tab',name:'Tasks',items:[{id:'task',text,done:false}]}]});
(async()=>{
  await request('/api/checkys-base/first-user','POST',{email:'admin@security.invalid',password,passwordConfirm:password});
  const admin = await request('/api/collections/_superusers/auth-with-password','POST',{identity:'admin@security.invalid',password});
  assert.ok(admin.data.token,'test administrator must authenticate');
  const ah = {Authorization:admin.data.token};
  async function createUser(name) {
    const email=name+'-'+suffix+'@security.invalid';
    const r=await request('/api/collections/users/records','POST',{email,password,passwordConfirm:password},ah);
    assert.equal(r.status,200,JSON.stringify(r.data)); return {...r.data,email};
  }
  const alice=await createUser('alice'), bob=await createUser('bob');
  const native=await request('/api/collections/users/auth-with-password','POST',{identity:alice.email,password});
  assert.ok(native.data.token);
  const bh={Authorization:native.data.token};
  const login=await request('/api/checkys-base/session/login','POST',{token:native.data.token});
  assert.equal(login.data.authenticated,true,JSON.stringify(login.data));
  const ch={Cookie:login.cookie};
  const user=await request('/api/collections/users/records/'+alice.id,'GET',undefined,ch);
  assert.ok(user.data.defaultChecklist,'personal checklist relation repaired');
  const id=user.data.defaultChecklist;
  const personal=await request('/api/collections/checklists/records/'+id,'GET',undefined,ch);
  const cid=personal.data.collectionId;
  assert.equal((await request('/api/collections/users/records/'+bob.id,'GET',undefined,ch)).status,404);
  check('cookie authentication and personal checklist isolation');
  const firstWrite = await request('/api/collections/checklists/records/'+id,'PATCH',{data:data('from desktop'),version:2},bh);
  assert.equal(firstWrite.status,200,JSON.stringify(firstWrite.data));
  assert.equal((await request('/api/collections/checklists/records/'+id,'GET',undefined,ch)).data.data.tabs[0].items[0].text,'from desktop');
  assert.equal((await request('/api/collections/checklists/records/'+id,'PATCH',{data:data('from Base'),version:3},ch)).status,200);
  assert.equal((await request('/api/collections/checklists/records/'+id,'GET',undefined,bh)).data.data.tabs[0].items[0].text,'from Base');
  assert.equal((await request('/api/collections/checklists/records/'+id,'PATCH',{data:data('stale'),version:3},bh)).status,404);
  check('desktop bearer / Base cookie round trip and stale-write rejection');
  const shared=await request('/api/collections/shared_checklists/records','POST',{shareKey:'shared-'+suffix,name:'Shared',owner:bob.id,sharedWith:[alice.id],version:1,data:data('shared')},ah);
  assert.equal(shared.status,200,JSON.stringify(shared.data));
  assert.equal((await request('/api/collections/users/records/'+alice.id,'PATCH',{assignedSharedChecklist:shared.data.id},ah)).status,200);
  assert.equal((await request('/api/collections/users/records/'+alice.id,'PATCH',{assignedSharedChecklist:''},ch)).status,404);
  assert.equal((await request('/api/collections/shared_checklists/records/'+shared.data.id,'PATCH',{data:data('shared desktop'),version:2},bh)).status,200);
  assert.equal((await request('/api/collections/shared_checklists/records/'+shared.data.id,'GET',undefined,ch)).data.data.tabs[0].items[0].text,'shared desktop');
  assert.equal((await request('/api/collections/shared_checklists/records/'+shared.data.id,'PATCH',{data:data('shared Base'),version:3},ch)).status,200);
  assert.equal((await request('/api/collections/shared_checklists/records/'+shared.data.id,'GET',undefined,bh)).data.data.tabs[0].items[0].text,'shared Base');
  check('shared checklist compatibility and admin-controlled assignment');
  for(const collection of ['checklists',cid]) assert.equal((await request('/api/collections/'+collection+'/records/'+id,'PATCH',{data:{invalid:true},version:4},ch)).status,400);
  const owned=await request('/api/collections/shared_checklists/records','POST',{shareKey:'quota-'+suffix,name:'Quota',owner:alice.id,version:1,data:data('x'.repeat(600000))},ah);
  assert.equal(owned.status,200,JSON.stringify(owned.data));
  for(const collection of ['checklists',cid]) assert.equal((await request('/api/collections/'+collection+'/records/'+id,'PATCH',{data:data('x'.repeat(700000)),version:4},ch)).status,400);
  check('format and combined quotas enforced by collection name and ID');
  assert.equal((await request('/api/settings','PATCH',{batch:{enabled:true,maxRequests:10,timeout:3,maxBodySize:5*1024*1024}},ah)).status,200);
  const batch=await request('/api/batch','POST',{requests:[{method:'PATCH',url:'/api/collections/'+cid+'/records/'+id,body:{data:{invalid:true},version:4}}]},ch);
  assert.equal(batch.status,400,JSON.stringify(batch.data));
  assert.equal((await request('/api/collections/checklists/records/'+id,'GET',undefined,ch)).data.version,3);
  const concurrent=await createUser('concurrent');
  const concurrentUser=(await request('/api/collections/users/records/'+concurrent.id,'GET',undefined,ah)).data;
  const second=await request('/api/collections/shared_checklists/records','POST',{shareKey:'race-'+suffix,name:'Race',owner:concurrent.id,version:1,data:data('seed')},ah);
  const race=await Promise.all([
    request('/api/collections/checklists/records/'+concurrentUser.defaultChecklist,'PATCH',{data:data('x'.repeat(600000)),version:2},ah),
    request('/api/collections/shared_checklists/records/'+second.data.id,'PATCH',{data:data('y'.repeat(600000)),version:2},ah)
  ]);
  assert.deepEqual(race.map(r=>r.status).sort(),[200,400]);
  check('batch rollback and concurrent writes cannot bypass the combined quota');
  assert.equal((await request('/api/collections/users/records/'+alice.id,'PATCH',{password:password+'-new',passwordConfirm:password+'-new'},ah)).status,200);
  assert.equal((await request('/api/checkys-base/session','GET',undefined,ch)).data.authenticated,false);
  assert.notEqual((await request('/api/collections/users/records/'+alice.id,'GET',undefined,ch)).status,200);
  check('password reset revokes old hosted cookies');
  assert.equal((await request('/api/collections/users','PATCH',{authRule:'verified = true'},ah)).status,200);
  const restricted=await request('/api/collections/users/auth-with-password','POST',{identity:alice.email,password:password+'-new'});
  assert.notEqual(restricted.status,200); assert.ok(!restricted.data.token);
  assert.notEqual((await request('/api/checkys-base/session/login','POST',{email:alice.email,password:password+'-new'})).status,200);
  await request('/api/collections/users','PATCH',{authRule:'',otp:{enabled:true,duration:180,length:8},mfa:{enabled:true,duration:1800,rule:''}},ah);
  const challenge=await request('/api/collections/users/auth-with-password','POST',{identity:alice.email,password:password+'-new'});
  assert.equal(challenge.status,401); assert.ok(challenge.data.mfaId); assert.ok(!challenge.data.token);
  assert.notEqual((await request('/api/checkys-base/session/login','POST',{email:alice.email,password:password+'-new'})).status,200);
  assert.notEqual((await request('/api/checkys-base/session/login','POST',{token:challenge.data.mfaId})).status,200);
  check('authRule and MFA cannot be bypassed through hosted login');
  if (process.env.CHECKY_TEST_MAIL === 'true') {
    const authClient = require('../web/auth-client.js');
    const authenticated = await authClient.authenticate(async(path,body)=>{
      const r=await request(path,'POST',body);
      if(r.status!==200) { const error=new Error(r.data.message);error.payload=r.data;throw error; }
      return r.data;
    }, alice.email,password+'-new',async()=>{
      for(let i=0;i<50;i++) {
        const delivered=await request('/api/checky-test/otp','POST',{email:alice.email},ah);
        if(delivered.data.password) return delivered.data.password;
        await new Promise(resolve=>setTimeout(resolve,50));
      }
      throw Error('Test-only email sink did not receive an OTP.');
    });
    const mfaSession=await request('/api/checkys-base/session/login','POST',{token:authenticated.token});
    assert.equal(mfaSession.data.authenticated,true);
    assert.equal((await request('/api/checkys-base/session','GET',undefined,{Cookie:mfaSession.cookie})).data.authenticated,true);
    check('complete native password + emailed OTP login and hosted token exchange');
  }
  await request('/api/collections/users','PATCH',{authRule:'',otp:{enabled:false,duration:180,length:8},mfa:{enabled:false,duration:1800,rule:''}},ah);
  const fresh = await request('/api/collections/users/auth-with-password','POST',{identity:alice.email,password:password+'-new'});
  const freshHeaders = {Authorization:fresh.data.token};
  assert.equal((await request('/api/collections/shared_checklists/records/'+shared.data.id,'GET',undefined,freshHeaders)).status,200);
  await request('/api/collections/users/records/'+alice.id,'PATCH',{assignedSharedChecklist:''},ah);
  assert.equal((await request('/api/collections/shared_checklists/records/'+shared.data.id,'GET',undefined,freshHeaders)).status,404);
  check('removing an assignment revokes shared checklist access');
  console.log('All backend security and sync protocol checks passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
