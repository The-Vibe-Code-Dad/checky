(() => {
  const $ = id => document.getElementById(id);
  const apiRoot = '/api/checkys-base/baby';
  const amounts = window.checkyBabyAmounts;
  const params = new URLSearchParams(location.search);
  const embedded = window.parent !== window && params.get('embedded') === '1';
  document.body.classList.toggle('embedded', embedded);
  const notifyLists = () => { if (embedded) parent.postMessage({ type: 'checky-addon-lists-changed' }, location.origin); };
  let canManage = false, managed = null, caregivers = [], managerDirty = false, managerSaving = false;
  let user, lists = [], entries = [], current = '', more = false, loading = false, saving = false;
  let editing = null, requestId = '', dirty = false, canonical = {}, unit = 'ml', editorUnit = 'ml';
  function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
  async function api(path, method = 'GET', body) {
    let response;
    try {
      response = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (_) { throw Error('Cannot reach Checky Base. Check your connection and try again.'); }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = Error(payload.message || 'Checky Base could not complete this request.');
      error.payload = payload; error.status = response.status;
      throw error;
    }
    return payload;
  }
  function fail(error) {
    status(error.message, true);
    if (error.status === 401 || error.status === 403 || error.status === 404) {
      entries = []; $('entries').replaceChildren(); $('tracker').hidden = true; notifyLists();
      if (error.status === 401) { user = null; $('login').hidden = false; }
    }
  }
  const preferenceKey = () => 'checky-baby-unit:' + user.id;
  function activeList() { return lists.find(list => list.ref === current); }
  function controls() {
    $('addEntry').disabled = loading || !activeList()?.writable;
    $('listPicker').disabled = loading;
    $('refresh').disabled = loading;
    $('loadMore').disabled = loading;
  }
  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function render() {
    $('entries').replaceChildren();
    $('loadMore').hidden = !more;
    if (!entries.length) $('entries').append(node('p', 'empty', 'No entries yet. Add a feeding, diaper change or note.'));
    let lastMonth = '', lastDay = '';
    for (const record of entries) {
      const data = record.entry;
      const date = new Date(data.occurredAt);
      const month = date.getFullYear() + '-' + date.getMonth();
      const day = month + '-' + date.getDate();
      if (month !== lastMonth) {
        $('entries').append(node('h2', 'archive-month', date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })));
        lastMonth = month;
      }
      if (day !== lastDay) {
        $('entries').append(node('h3', 'archive-day', date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })));
        lastDay = day;
      }
      const card = node('article', 'entry');
      const heading = node('div', 'entry-heading');
      const time = node('time', '', date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }));
      time.dateTime = data.occurredAt;
      const timestamp = date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
      time.title = timestamp;
      const edit = node('button', '', 'Edit'); edit.type = 'button'; edit.disabled = !activeList()?.writable;
      edit.setAttribute('aria-label', 'Edit entry from ' + timestamp);
      edit.onclick = () => openEditor(record);
      heading.append(time, edit); card.append(heading);
      const feeding = node('div', 'feed-summary');
      for (const [key, label] of [['breastMilkMl', 'Breast milk'], ['formulaMl', 'Formula']]) {
        const value = node('div', 'feed-value');
        value.append(node('span', '', label), node('strong', '', data[key] === null ? '—' : amounts.fromMl(data[key], unit) + ' ' + unit));
        feeding.append(value);
      }
      card.append(feeding);
      if (data.feedingNotes) card.append(node('p', 'notes', data.feedingNotes));
      for (const [key, label] of [['pee', 'Pee'], ['poop', 'Poop']]) {
        const row = node('div', 'diaper-summary');
        const checkLabel = node('label', 'check');
        const check = node('input'); check.type = 'checkbox'; check.checked = data[key]; check.disabled = true;
        checkLabel.append(check, document.createTextNode(label));
        row.append(checkLabel, node('p', 'notes', data[key + 'Notes'] || '—')); card.append(row);
      }
      $('entries').append(card);
    }
  }
  async function load(append = false, quiet = false) {
    if (loading || !current) return;
    loading = true; controls();
    try {
      const cursor = append && entries.length ? '&before=' + encodeURIComponent(entries.at(-1).id) : '';
      const result = await api(apiRoot + '/entries?list=' + encodeURIComponent(current) + cursor);
      entries = append ? [...entries, ...result.items.filter(item => !entries.some(old => old.id === item.id))] : result.items;
      more = result.more; render();
      if (!quiet) status('Up to date. Grouped by day, newest first.');
    } finally { loading = false; controls(); }
  }
  async function start() {
    const session = await api('/api/checkys-base/session');
    if (!session.authenticated) {
      $('login').hidden = false; $('tracker').hidden = true;
      status(session.setupRequired ? 'Set up Checky Base from the main app first.' : 'Sign in to open your log.'); return;
    }
    user = session.user; $('login').hidden = true;
    await refreshLists();
    const requested = params.get('list');
    current = lists.some(list => list.ref === requested) ? requested : requested ? '' : lists[0]?.ref || '';
    try { unit = localStorage.getItem(preferenceKey()) === 'oz' ? 'oz' : 'ml'; } catch (_) {}
    $('units').value = unit; updateScope();
    if (current) await load();
    else status(canManage ? 'Create a baby list and choose its caregivers.' : 'No baby list assigned. Ask your admin to add you to a baby list.');
    if (canManage && params.get('manage') === '1') await openManager();
  }
  async function refreshLists() {
    const result = await api(apiRoot + '/lists'); lists = result.items; canManage = result.canManage === true;
    $('manageLists').hidden = !canManage;
    $('listPicker').replaceChildren();
    for (const list of lists) {
      const option = node('option', '', list.name); option.value = list.ref; $('listPicker').append(option);
    }
  }
  function updateScope() {
    $('tracker').hidden = !activeList();
    $('listPicker').value = current;
    $('sharingHint').textContent = 'Shared only with caregivers assigned to this baby list by the admin.';
    document.querySelector('h1').textContent = activeList()?.name || 'Baby tracker';
    const address = new URL(location.href);
    if (current) address.searchParams.set('list', current); else address.searchParams.delete('list');
    history.replaceState(null, '', address);
    controls();
  }
  function fillManager(ref) {
    managed = lists.find(list => list.ref === ref) || null;
    $('managedList').value = managed?.ref || '';
    $('babyListName').value = managed?.name || '';
    $('memberChoices').replaceChildren();
    for (const user of caregivers) {
      const label = node('label', 'check');
      const checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.value = user.id;
      checkbox.checked = managed?.members.includes(user.id) || false;
      label.append(checkbox, document.createTextNode(user.email)); $('memberChoices').append(label);
    }
    $('saveList').textContent = managed ? 'Save list and caregivers' : 'Create baby list';
    $('listError').textContent = ''; managerDirty = false;
  }
  async function openManager() {
    try {
      await refreshLists();
      caregivers = (await api(apiRoot + '/admin/users')).items;
      $('managedList').replaceChildren();
      const create = node('option', '', '+ New baby list'); create.value = ''; $('managedList').append(create);
      for (const list of lists) { const option = node('option', '', list.name); option.value = list.ref; $('managedList').append(option); }
      fillManager(current);
      $('listManager').showModal(); $('listManagerTitle').focus();
    } catch (error) { fail(error); }
  }
  function closeManager() {
    if (managerSaving || managerDirty && !confirm('Discard changes to this baby list?')) return;
    managerDirty = false; $('listManager').close();
  }
  $('manageLists').onclick = openManager;
  $('closeListManager').onclick = closeManager;
  $('listManager').oncancel = event => { event.preventDefault(); closeManager(); };
  $('managedList').onchange = () => {
    if (managerDirty && !confirm('Discard changes to this baby list?')) { $('managedList').value = managed?.ref || ''; return; }
    fillManager($('managedList').value);
  };
  $('listForm').oninput = event => { if (event.target.id !== 'managedList') managerDirty = true; };
  $('listForm').onsubmit = async event => {
    event.preventDefault(); if (managerSaving) return;
    $('listError').textContent = ''; managerSaving = true;
    for (const field of $('listForm').elements) field.disabled = true;
    try {
      const body = { name: $('babyListName').value, members: [...$('memberChoices').querySelectorAll('input:checked')].map(input => input.value) };
      if (managed) body.version = managed.version;
      const saved = await api(apiRoot + '/lists' + (managed ? '/' + managed.ref.split(':')[1] : ''), managed ? 'PATCH' : 'POST', body);
      managerDirty = false; $('listManager').close();
      await refreshLists(); current = saved.ref; entries = []; more = false; updateScope(); render();
      notifyLists(); await load(); status('Baby list saved. Only assigned caregivers and the admin can open it.');
      if (embedded) parent.postMessage({ type: 'checky-addon-selected-list', ref: current, name: saved.name }, location.origin);
    } catch (error) {
      if ($('listManager').open) $('listError').textContent = error.message;
      else { status('Baby list saved. Reopen it after reconnecting to refresh access and entries.', true); notifyLists(); }
    }
    finally { managerSaving = false; for (const field of $('listForm').elements) field.disabled = false; }
  };
  window.checkyAddonBusy = () => saving || managerSaving || $('editor').open || $('listManager').open;
  window.checkyCanLeave = () => {
    if (saving || managerSaving) { status('Wait for your changes to finish saving.', true); return false; }
    if ((dirty || managerDirty) && !confirm('Discard unsaved changes before switching lists?')) return false;
    dirty = false; managerDirty = false; return true;
  };
  function localDateTime(iso) {
    const date = new Date(iso);
    const pad = value => String(value).padStart(2, '0');
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + 'T' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }
  function displayAmounts() {
    $('breastMilk').value = amounts.fromMl(canonical.breastMilkMl, editorUnit);
    $('formula').value = amounts.fromMl(canonical.formulaMl, editorUnit);
    $('entryUnits').value = editorUnit;
    document.querySelectorAll('.amount-unit').forEach(span => { span.textContent = '(' + editorUnit + ')'; });
  }
  function openEditor(record) {
    // getRandomValues also works on a local HTTP/LAN Base installation, where
    // randomUUID is unavailable outside a secure browser context.
    editing = record;
    requestId = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
    dirty = false;
    const data = record?.entry || { occurredAt: new Date().toISOString(), breastMilkMl: null, formulaMl: null, feedingNotes: '', pee: false, peeNotes: '', poop: false, poopNotes: '' };
    canonical = { breastMilkMl: data.breastMilkMl, formulaMl: data.formulaMl }; editorUnit = unit;
    $('editorTitle').textContent = record ? 'Edit entry' : 'Add entry';
    $('occurredAt').value = localDateTime(data.occurredAt);
    for (const key of ['feedingNotes', 'peeNotes', 'poopNotes']) $(key).value = data[key];
    for (const key of ['pee', 'poop']) $(key).checked = data[key];
    $('editorError').textContent = ''; $('deleteEntry').hidden = !record; $('deleteEntry').textContent = 'Delete entry';
    displayAmounts(); $('editor').showModal(); $('editorTitle').focus();
  }
  function closeEditor() {
    if (saving) return;
    if (dirty && !confirm('Discard changes to this entry?')) return;
    dirty = false; $('editor').close();
  }
  function entryData() {
    const value = $('occurredAt').value;
    const date = new Date(value);
    if (!value || !Number.isFinite(date.getTime()) || localDateTime(date.toISOString()) !== value) throw Error('Enter a valid local date and time.');
    const data = { occurredAt: date.toISOString(), ...canonical };
    // Preserve seconds/offset on an unchanged existing timestamp, including the
    // repeated hour at the end of daylight saving time.
    if (editing && value === localDateTime(editing.entry.occurredAt)) data.occurredAt = editing.entry.occurredAt;
    for (const key of ['breastMilkMl', 'formulaMl']) if (data[key] !== null && (!Number.isFinite(data[key]) || data[key] < 0 || data[key] > 10000)) throw Error('Enter a nonnegative amount no larger than 10,000 ml.');
    for (const key of ['feedingNotes', 'peeNotes', 'poopNotes']) data[key] = $(key).value;
    for (const key of ['pee', 'poop']) data[key] = $(key).checked;
    if (data.breastMilkMl === null && data.formulaMl === null && !data.pee && !data.poop && ![data.feedingNotes, data.peeNotes, data.poopNotes].some(note => note.trim())) throw Error('Add a feeding amount, diaper check or note.');
    return data;
  }
  function editorBusy(value) {
    saving = value;
    for (const field of $('entryForm').elements) field.disabled = value;
    $('saveEntry').textContent = value ? 'Saving…' : 'Save entry';
  }
  async function save(deleting = false) {
    if (saving) return;
    $('editorError').textContent = '';
    try {
      const entry = deleting ? null : entryData();
      editorBusy(true);
      const record = editing
        ? await api(apiRoot + '/entries/' + editing.id, deleting ? 'DELETE' : 'PATCH', deleting ? { version: editing.version } : { version: editing.version, entry })
        : await api(apiRoot + '/entries', 'POST', { list: current, requestId, entry });
      entries = entries.filter(item => item.id !== (editing?.id || record.id));
      if (!deleting) entries.push(record);
      entries.sort((a, b) => b.entry.occurredAt.localeCompare(a.entry.occurredAt) || b.id.localeCompare(a.id));
      dirty = false; $('editor').close(); render();
      status(deleting ? 'Entry deleted.' : 'Entry saved and shared with this baby list.');
      try { await load(false, true); } catch (_) { status('Saved. Refresh when your connection returns to see the latest log.'); }
    } catch (error) {
      $('editorError').textContent = error.status === 401 ? 'Your session expired. Your changes are still here; sign in to Checky in another tab, then try saving again.' : error.message;
    } finally { editorBusy(false); }
  }
  $('login').onsubmit = async event => {
    event.preventDefault(); const button = $('login').querySelector('button'); button.disabled = true;
    try {
      const result = await window.checkyAuth.authenticate((path, body) => api(path, 'POST', body), $('email').value.trim(), $('password').value, window.requestCheckyVerificationCode);
      await api('/api/checkys-base/session/login', 'POST', { token: result.token }); $('password').value = ''; await start();
    } catch (error) { fail(error); } finally { button.disabled = false; }
  };
  $('listPicker').onchange = async () => { current = $('listPicker').value; entries = []; more = false; render(); updateScope(); try { await load(); } catch (error) { fail(error); } };
  $('refresh').onclick = () => load().catch(fail);
  $('loadMore').onclick = () => load(true).catch(fail);
  $('addEntry').onclick = () => openEditor(null);
  $('units').onchange = () => { unit = $('units').value; try { localStorage.setItem(preferenceKey(), unit); } catch (_) {} render(); };
  $('entryUnits').onchange = () => { editorUnit = $('entryUnits').value; displayAmounts(); };
  for (const [id, key] of [['breastMilk', 'breastMilkMl'], ['formula', 'formulaMl']]) $(id).oninput = () => { canonical[key] = $(id).value === '' ? null : amounts.toMl($(id).valueAsNumber, editorUnit); };
  $('entryForm').oninput = () => { dirty = true; $('deleteEntry').textContent = 'Delete entry'; };
  $('entryForm').onsubmit = event => { event.preventDefault(); void save(); };
  $('cancel').onclick = closeEditor;
  $('editor').oncancel = event => { event.preventDefault(); closeEditor(); };
  $('deleteEntry').onclick = () => {
    if ($('deleteEntry').textContent !== 'Confirm delete') { $('deleteEntry').textContent = 'Confirm delete'; return; }
    void save(true);
  };
  window.addEventListener('beforeunload', event => { if (dirty || saving || managerDirty || managerSaving) { event.preventDefault(); event.returnValue = ''; } });
  const refreshIfIdle = () => { if (user && current && !$('editor').open && !$('listManager').open && !document.hidden) load(false, true).catch(fail); };
  window.addEventListener('online', refreshIfIdle);
  document.addEventListener('visibilitychange', refreshIfIdle);
  setInterval(refreshIfIdle, 30000);
  start().catch(fail);
})();
