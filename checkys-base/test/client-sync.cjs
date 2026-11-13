// Runs the real sync implementations with isolated storage and a disposable localhost backend.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const {createRequire} = require('node:module');
const base = process.env.CHECKY_TEST_URL || 'http://127.0.0.1:18090';
if (!['127.0.0.1','localhost'].includes(new URL(base).hostname)) throw Error('Disposable localhost backend required.');
const root = path.resolve(__dirname, '../..');
const password = 'Test-Only-20261030-password';
let counter = 0;
async function direct(url, options={}) {
  return fetch(new URL(url,base),{...options,headers:{'X-Checky-Client-IP':'198.51.100.'+(++counter%240+1),...options.headers}});
}
async function api(url, body, token, method='POST') {
  const r = await direct(url,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:token}:{})},body:JSON.stringify(body)});
  const data = await r.json(); assert.equal(r.status,200,JSON.stringify(data)); return data;
}
async function desktop(dir,email) {
  const main = path.join(root,'checkys-app/main.js');
  const realRequire = createRequire(main);
  const electron = {
    app:{requestSingleInstanceLock:()=>true,on(){},whenReady:()=>({then(){}}),getPath:()=>dir,setLoginItemSettings(){},getVersion:()=>'1.0.7'},
    safeStorage:{isEncryptionAvailable:()=>false},session:{defaultSession:{fetch:direct}},
  };
  const context = vm.createContext({require:name=>name==='electron'?electron:realRequire(name),__dirname:path.dirname(main),
    console,Buffer,URL,URLSearchParams,crypto:require('node:crypto'),setTimeout:()=>0,clearTimeout(){},process:{on(){},platform:'win32',env:{}}});
  vm.runInContext(await fs.readFile(main,'utf8'),context,{filename:main});
  await context.ensureDataFiles();
  await context.saveSettings({advanced:{serverUrl:base,email,password}});
  return context;
}
const browserSessions = new Map();
async function browser(email) {
  let cookie=browserSessions.get(email)||''; const store=new Map();
  const window={location:new URL(base)};
  const context=vm.createContext({window,console,URL,URLSearchParams,crypto:require('node:crypto').webcrypto,
    localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},
    setTimeout:()=>0,clearTimeout(){},atob,fetch:async(url,opts={})=>{
      const r=await direct(url,{...opts,headers:{...opts.headers,...(cookie?{Cookie:cookie}:{}),Origin:base}});
      if(r.headers.get('set-cookie')) cookie=r.headers.get('set-cookie').split(';')[0]; return r;
    }});
  for(const file of ['auth-client.js','reminder-state.js','mobile-storage.js']) vm.runInContext(await fs.readFile(path.join(root,'checkys-base/web',file),'utf8'),context,{filename:file});
  const storage=window.checkyStorage;
  if (!cookie) await storage.signInHostedSession(email,password);
  browserSessions.set(email, cookie);
  return storage;
}
const textOf = checklist=>checklist.tabs[0].items[0]?.text;
const reminderAt = '2030-01-02T15:04:00.000Z';
const reminderCheckedAt = '2030-01-02T12:00:00.000Z';
const data = text=>({active:0,tabs:[{id:'stable-tab',name:'Tasks',items:[{id:'stable-task',text,done:true,reminderAt,reminderRepeat:'weekly',reminderTimeZone:'America/New_York',reminderDays:[1,3,5],reminderCheckedAt,reminderSkipToday:true}]}]});
(async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'checky-client-test-'));
  try {
    const admin=await api('/api/collections/_superusers/auth-with-password',{identity:'admin@security.invalid',password});
    const email='clients-'+Date.now()+'@security.invalid';
    const user=await api('/api/collections/users/records',{email,password,passwordConfirm:password},admin.token);
    const desk=await desktop(dir,email), web=await browser(email);
    let pulled=await desk.pullChecklistFromRemote(); assert.equal(pulled.ok,true,pulled.message);
    let state=await web.syncNow(); assert.equal(state.ok,true,state.message);
    await desk.saveChecklist(data('personal from desktop')); await desk.markLocalChecklistDirty();
    state=await desk.syncNow(data('personal from desktop')); assert.equal(state.ok,true,state.message);
    state=await web.syncNow(); assert.equal(state.ok,true,state.message); assert.equal(textOf(state.checklist),'personal from desktop');
    assert.equal(state.checklist.tabs[0].items[0].reminderAt, reminderAt);
    assert.equal(state.checklist.tabs[0].items[0].reminderRepeat, 'weekly');
    assert.equal(state.checklist.tabs[0].items[0].reminderTimeZone, 'America/New_York');
    assert.deepEqual(Array.from(state.checklist.tabs[0].items[0].reminderDays), [1,3,5]);
    assert.equal(state.checklist.tabs[0].items[0].reminderCheckedAt, reminderCheckedAt);
    assert.equal(state.checklist.tabs[0].items[0].reminderSkipToday, true);
    assert.equal(state.checklist.tabs[0].items[0].reminderResetAt, '2030-01-04T15:04:00.000Z');
    await web.saveChecklist(data('personal from Base'));
    state=await web.syncNow(data('personal from Base')); assert.equal(state.ok,true,state.message);
    pulled=await desk.pullChecklistFromRemote(); assert.equal(textOf(pulled.checklist),'personal from Base');
    assert.equal(pulled.checklist.tabs[0].items[0].reminderAt, reminderAt);
    assert.equal(pulled.checklist.tabs[0].items[0].reminderRepeat, 'weekly');
    assert.equal(pulled.checklist.tabs[0].items[0].reminderTimeZone, 'America/New_York');
    assert.deepEqual(Array.from(pulled.checklist.tabs[0].items[0].reminderDays), [1,3,5]);
    assert.equal(pulled.checklist.tabs[0].items[0].reminderCheckedAt, reminderCheckedAt);
    assert.equal(pulled.checklist.tabs[0].items[0].reminderSkipToday, true);
    assert.equal(pulled.checklist.tabs[0].items[0].reminderResetAt, '2030-01-04T15:04:00.000Z');
    console.log('PASS real Base and desktop personal sync in both directions');
    const shared=await api('/api/collections/shared_checklists/records',{shareKey:'client-'+Date.now(),name:'Client shared',owner:user.id,version:1,data:data('shared seed')},admin.token);
    await api('/api/collections/users/records/'+user.id,{assignedSharedChecklist:shared.id},admin.token,'PATCH');
    pulled=await desk.pullChecklistFromRemote(); assert.equal(textOf(pulled.checklist),'shared seed');
    state=await web.syncNow(); assert.equal(textOf(state.checklist),'shared seed');
    await desk.saveChecklist(data('shared from desktop')); await desk.markLocalChecklistDirty();
    state=await desk.syncNow(data('shared from desktop')); assert.equal(state.ok,true,state.message);
    state=await web.syncNow(); assert.equal(textOf(state.checklist),'shared from desktop');
    await web.saveChecklist(data('shared from Base'));
    state=await web.syncNow(data('shared from Base')); assert.equal(state.ok,true,state.message);
    pulled=await desk.pullChecklistFromRemote(); assert.equal(textOf(pulled.checklist),'shared from Base');
    console.log('PASS assigned shared checklist switching and real sync in both directions');
    const current=await api('/api/collections/users/records/'+user.id,undefined,admin.token,'GET');
    const selected=await desk.useAccessibleChecklist('checklists:'+current.defaultChecklist,pulled.checklist);
    assert.equal(selected.ok,true,selected.message); assert.equal(textOf(selected.checklist),'personal from Base');
    state=await web.useAccessibleChecklist('checklists:'+current.defaultChecklist,state.checklist);
    assert.equal(state.ok,true,state.message); assert.equal(textOf(state.checklist),'personal from Base');
    console.log('PASS device-selected personal checklist overrides shared assignment on both clients');
    // Both clients hold the same base version; a conflicting edit must preserve the remote write.
    await web.saveChecklist(data('winning Base edit')); state=await web.syncNow(data('winning Base edit')); assert.equal(state.ok,true,state.message);
    await desk.saveChecklist(data('conflicting desktop edit')); await desk.markLocalChecklistDirty();
    const conflict=await desk.syncNow(data('conflicting desktop edit')); assert.equal(conflict.ok,false);
    pulled=await desk.pullChecklistFromRemote(); assert.equal(textOf(pulled.checklist),'winning Base edit');
    console.log('PASS stale desktop writes cannot overwrite newer Base edits');
    const clone = value => JSON.parse(JSON.stringify(value));
    for (const collection of ['checklists', 'shared_checklists']) {
      const recordId = collection === 'checklists' ? current.defaultChecklist : shared.id;
      const recordPath = '/api/collections/' + collection + '/records/' + recordId;
      const readRecord = () => api(recordPath, undefined, admin.token, 'GET');
      const writeRecord = async checklist => {
        const record = await readRecord();
        return api(recordPath, { data: checklist, version: record.version + 1 }, admin.token, 'PATCH');
      };
      for (const surface of ['Base', 'desktop']) {
        for (const scenario of ['different tasks', 'reminder completion', 'already accepted', 'navigation only', 'same task conflict', 'new task preview']) {
          const seedChecklist = { active: 0, tabs: [
            { id: 'meds', name: 'Meds', items: [{ id: 'sun', text: 'Sunday', done: false }, { id: 'mon', text: 'Monday', done: false }] },
            { id: 'other', name: 'Other', items: [] }
          ] };
          if (scenario === 'reminder completion') Object.assign(seedChecklist.tabs[0].items[0], { reminderAt, reminderRepeat: 'weekly', reminderDays: [1,3,5], reminderTimeZone: 'America/New_York' });
          await writeRecord(seedChecklist);
          const client = surface === 'Base' ? await browser(email) : await desktop(path.join(dir, 'merge-' + (++counter)), email);
          if (surface === 'desktop') await client.persistStoredToken(await desk.readStoredToken());
          const initial = await client.useAccessibleChecklist(collection + ':' + recordId);
          assert.equal(initial.ok, true, initial.message);
          const local = clone(initial.checklist), remote = clone(initial.checklist);
          if (scenario === 'navigation only') local.active = 1;
          else local.tabs[0].items[0].done = true;
          if (scenario === 'reminder completion') Object.assign(local.tabs[0].items[0], { reminderCheckedAt, reminderSkipToday: true });
          if (scenario === 'already accepted') remote.tabs[0].items[0].done = true;
          else if (scenario === 'same task conflict') remote.tabs[0].items[0].text = 'Changed Sunday';
          else remote.tabs[0].items[1].text = 'Changed Monday';
          if (scenario === 'new task preview') local.tabs[0].items.push({ id: 'tue', text: 'Tuesday', done: false });
          await client.saveChecklist(local);
          if (surface === 'desktop') await client.markLocalChecklistDirty();
          const before = await writeRecord(remote);
          const result = await client.syncNow(local);
          const stored = surface === 'Base' ? (await client.loadState()).checklist : (await client.loadAppState()).checklist;
          if (scenario === 'same task conflict' || scenario === 'new task preview') {
            assert.equal(result.ok, false, scenario);
            assert.equal(result.mergeRequired, scenario === 'new task preview');
            assert.equal(stored.tabs[0].items[0].done, true, 'Keep the offline checkbox on conflict');
            assert.equal((await readRecord()).version, before.version, 'A conflict must not write to the server');
            if (scenario === 'new task preview') {
              const approved = await client.syncNow(local, { allowNewItemMerge: true });
              assert.equal(approved.ok, true, approved.message);
              assert.deepEqual(Array.from(approved.checklist.tabs[0].items, item => item.text), ['Sunday', 'Changed Monday', 'Tuesday']);
              const cached = surface === 'Base' ? (await client.loadState()).checklist : (await client.loadAppState()).checklist;
              assert.equal(cached.tabs[0].items[1].text, 'Changed Monday', 'Confirmed recovery persists the server copy too');
            }
            continue;
          }
          assert.equal(result.ok, true, surface + " " + collection + " " + scenario + ": " + result.message);
          assert.equal(result.checklist.tabs[0].items[0].done, scenario !== 'navigation only');
          assert.equal(stored.tabs[0].items[1].text, scenario === 'already accepted' ? 'Monday' : 'Changed Monday');
          assert.equal(stored.tabs[0].items[0].done, scenario !== 'navigation only', 'Reconciled checkbox is saved locally');
          if (scenario === 'reminder completion') {
            assert.equal(stored.tabs[0].items[0].reminderSkipToday, true);
            assert.equal(stored.tabs[0].items[0].reminderResetAt, '2030-01-04T15:04:00.000Z', 'Server reset metadata persists with the merged checklist');
          }
          const after = await readRecord();
          assert.equal(after.version, before.version + (['different tasks', 'reminder completion'].includes(scenario) ? 1 : 0), 'Already accepted/unchanged content needs no extra write');
          assert.equal((await client.syncNow()).ok, true, 'The next sync must not get stuck on the same conflict');
          const again = clone(result.checklist); again.tabs[1].items.push({ id: 'next', text: 'Next edit', done: false });
          await client.saveChecklist(again);
          if (surface === 'desktop') await client.markLocalChecklistDirty();
          assert.equal((await client.syncNow(again)).ok, true);
          assert.equal((await readRecord()).data.tabs[0].items[1].text, stored.tabs[0].items[1].text, 'The next save retains merged server edits');
        }
        console.log('PASS ' + surface + ' ' + collection + ': different-task recovery, acknowledged saves, navigation, conflict protection, confirmed additions and cache persistence');
      }
    }

  } finally {
    if(path.dirname(dir)!==path.resolve(os.tmpdir()) || !path.basename(dir).startsWith('checky-client-test-')) throw Error('Unexpected test cleanup path.');
    await fs.rm(dir,{recursive:true,force:true});
  }
})().catch(e=>{console.error(e);process.exitCode=1});
