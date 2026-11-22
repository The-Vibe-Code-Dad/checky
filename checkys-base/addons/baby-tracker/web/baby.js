(() => {
  const $ = id => document.getElementById(id);
  const apiRoot = '/api/checkys-base/baby';
  const amounts = window.checkyBabyAmounts;
  const cache = window.checkyOfflineCache;
  const params = new URLSearchParams(location.search);
  const embedded = window.parent !== window && params.get('embedded') === '1';
  document.body.classList.toggle('embedded', embedded);
  const notifyLists = () => { if (embedded) parent.postMessage({ type: 'checky-addon-lists-changed' }, location.origin); };
  let user, lists = [], entries = [], current = '', more = false, loading = false, saving = false, offline = false;
  let renderedDay, pagesLoaded = 1;
  let editing = null, requestId = '', dirty = false, canonical = {}, unit = 'ml', editorUnit = 'ml';
  function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
  async function api(path, method = 'GET', body) {
    let response;
    try {
      response = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store',
        signal: AbortSignal.timeout(method === 'GET' ? 10000 : 30000), headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
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
      if (user && current) cache.remove(user.id, 'baby-log:' + current);
      if (user) {
        lists = lists.filter(list => list.ref !== current);
        try { cache.write(user.id, 'baby-lists', lists); } catch (_) {}
      }
      entries = []; renderedDay = undefined; pagesLoaded = 1;
      $('entries').replaceChildren(); $('tracker').hidden = true; notifyLists();
      if (error.status === 401) { cache.session({ authenticated: false }); user = null; $('login').hidden = false; }
    }
  }
  const preferenceKey = () => 'checky-baby-unit:' + user.id;
  function activeList() { return lists.find(list => list.ref === current); }
  function controls() {
    $('addEntry').disabled = loading || offline || !activeList()?.writable;
    $('listPicker').disabled = loading;
    $('loadMore').disabled = loading || offline;
  }
  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function entryCard(record) {
    const data = record.entry, date = new Date(data.occurredAt);
    const card = node('article', 'entry');
    const heading = node('div', 'entry-heading');
    const time = node('time', '', date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }));
    time.dateTime = data.occurredAt;
    const timestamp = date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    time.title = timestamp;
    const edit = node('button', '', 'Edit'); edit.type = 'button'; edit.disabled = offline || !activeList()?.writable;
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
    return card;
  }
  const localDay = value => new Date(value).setHours(0, 0, 0, 0);
  function render() {
    const log = $('entries');
    const openDays = new Set(Array.from(log.querySelectorAll('details[open]'), el => el.dataset.day));
    const focusedDay = document.activeElement?.closest('summary')?.parentElement.dataset.day;
    renderedDay = localDay(Date.now());
    const days = new Map([[renderedDay, []]]);
    for (const record of entries) {
      const day = localDay(record.entry.occurredAt);
      if (!days.has(day)) days.set(day, []);
      days.get(day).push(record);
    }
    const fragment = document.createDocumentFragment();
    for (const day of [...days.keys()].sort((a, b) => b - a)) {
      const date = new Date(day);
      const label = date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric',
        year: date.getFullYear() === new Date(renderedDay).getFullYear() ? undefined : 'numeric' });
      const today = day === renderedDay;
      const group = node(today ? 'section' : 'details', today ? 'today' : 'day-folder');
      if (today) {
        const heading = node('h2', 'today-heading', 'Today ');
        heading.append(node('small', '', label)); group.append(heading);
        if (!days.get(day).length) group.append(node('p', 'empty', entries.length ? 'No entries today.' : 'No entries yet. Add a feeding, diaper change or note.'));
      } else {
        group.dataset.day = String(day);
        group.open = openDays.has(group.dataset.day);
        group.append(node('summary', '', label));
      }
      for (const record of days.get(day)) group.append(entryCard(record));
      fragment.append(group);
    }
    log.replaceChildren(fragment);
    if (focusedDay) log.querySelector('details[data-day="' + focusedDay + '"] summary')?.focus({ preventScroll: true });
    $('loadMore').hidden = !more;
  }
  async function load(append = false) {
    if (loading || !current) return;
    loading = true; controls();
    try {
      // Refresh the pages already on screen so polling doesn't close older history.
      const next = append ? [...entries] : [];
      const seen = new Set(next.map(record => record.id));
      let pages = append ? pagesLoaded : 0, hasMore;
      do {
        const cursor = next.length ? '&before=' + encodeURIComponent(next.at(-1).id) : '';
        const result = await api(apiRoot + '/entries?list=' + encodeURIComponent(current) + cursor);
        for (const item of result.items) {
          if (!seen.has(item.id)) { next.push(item); seen.add(item.id); }
        }
        pages++;
        hasMore = result.more;
      } while (!append && hasMore && pages < pagesLoaded);
      const changed = offline || more !== hasMore || renderedDay !== localDay(Date.now()) || entries.length !== next.length ||
        next.some((item, i) => entries[i].id !== item.id || entries[i].version !== item.version);
      entries = next; pagesLoaded = pages; more = hasMore; offline = false;
      if (changed) render();
      try { saveLog(); status(''); }
      catch (_) { status('Log loaded. This device has no space to save an offline copy.', true); }
    } catch (error) {
      if (!cache.unavailable(error)) throw error;
      if (!restoreLog()) throw error;
    } finally { loading = false; controls(); }
  }
  function saveLog() { cache.write(user.id, 'baby-log:' + current, { entries, more, pagesLoaded }); }
  function restoreLog() {
    const saved = cache.read(user?.id, 'baby-log:' + current);
    if (!saved || !activeList()) return false;
    entries = saved.entries; more = saved.more; pagesLoaded = saved.pagesLoaded;
    offline = true; render(); controls();
    status('Offline. Showing saved entries. Connect to add or edit entries or load earlier history.');
    return true;
  }
  async function start() {
    try {
      const session = await api('/api/checkys-base/session');
      if (typeof session.authenticated !== 'boolean') throw Error('Cannot reach Checky Base.');
      cache.session(session);
      if (!session.authenticated) {
        $('login').hidden = false; $('tracker').hidden = true;
        status(session.setupRequired ? 'Set up Checky Base from the main app first.' : 'Sign in to open your log.'); return;
      }
      user = session.user;
      await refreshLists();
      offline = false;
    } catch (error) {
      if (!cache.unavailable(error)) throw error;
      const id = cache.account(), saved = cache.read(id, 'baby-lists');
      if (!saved) throw Error('Connect to Checky to open this baby log on this device for the first time.');
      user = { id }; lists = saved; offline = true; renderLists();
    }
    $('login').hidden = true;
    const requested = params.get('list');
    const remembered = cache.read(user.id, 'baby-last-list');
    current = requested ? (lists.some(list => list.ref === requested) ? requested : '')
      : lists.find(list => list.ref === remembered)?.ref || lists[0]?.ref || '';
    try { unit = localStorage.getItem(preferenceKey()) === 'oz' ? 'oz' : 'ml'; } catch (_) {}
    $('units').value = unit; updateScope();
    if (current) {
      if (offline) {
        if (!restoreLog()) status('This log has not been saved on this device yet. Connect to Checky to open it.');
      } else await load();
    }
    else status('No baby list assigned. Ask your PocketBase admin to add you to a baby list.');
  }
  async function refreshLists() {
    const result = await api(apiRoot + '/lists'); lists = result.items;
    for (const list of cache.read(user.id, 'baby-lists') || []) {
      if (!lists.some(item => item.ref === list.ref)) cache.remove(user.id, 'baby-log:' + list.ref);
    }
    try { cache.write(user.id, 'baby-lists', lists); } catch (_) {}
    renderLists();
  }
  function renderLists() {
    $('listPicker').replaceChildren();
    for (const list of lists) {
      const option = node('option', '', list.name); option.value = list.ref; $('listPicker').append(option);
    }
  }
  function updateScope() {
    $('tracker').hidden = !activeList();
    if (activeList()) { try { cache.write(user.id, 'baby-last-list', current); } catch (_) {} }
    $('listPicker').value = current;
    document.querySelector('h1').textContent = activeList()?.name || 'Baby tracker';
    const address = new URL(location.href);
    if (current) address.searchParams.set('list', current); else address.searchParams.delete('list');
    history.replaceState(null, '', address);
    controls();
  }
  window.checkyAddonBusy = () => saving || $('editor').open;
  window.checkyCanLeave = () => {
    if (saving) { status('Wait for your changes to finish saving.', true); return false; }
    if (dirty && !confirm('Discard unsaved changes before switching lists?')) return false;
    dirty = false; return true;
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
      try { saveLog(); } catch (_) {}
      try { await load(); status(deleting ? 'Entry deleted.' : 'Entry saved.'); }
      catch (error) {
        if ([401, 403, 404].includes(error.status)) fail(error);
        else status('Change saved. Could not refresh the log.', true);
      }
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
  $('listPicker').onchange = async () => {
    current = $('listPicker').value; entries = []; more = false; pagesLoaded = 1;
    render(); updateScope(); try { await load(); } catch (error) { fail(error); }
  };
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
  // The embedded log has its own scrolling document; its touches don't reach
  // the checklist's pull handler. Match its 84px threshold and drag resistance.
  const indicator = $('pullIndicator');
  let pull = null;
  function showPull(label, height = 0) {
    indicator.firstElementChild.textContent = label;
    indicator.style.height = height + 'px';
  }
  function cancelPull() {
    if (!pull) return;
    pull = null; showPull('');
  }
  function canPull() {
    return !$('tracker').hidden && !$('editor').open && !loading && !saving && document.scrollingElement.scrollTop <= 0;
  }
  document.addEventListener('touchstart', event => {
    cancelPull();
    if (!canPull() || event.touches.length !== 1 || event.target.closest('button, input, select, textarea, label, a, dialog')) return;
    const touch = event.touches[0];
    pull = { id: touch.identifier, x: touch.clientX, y: touch.clientY, ready: false };
  }, { passive: true });
  document.addEventListener('touchmove', event => {
    if (!pull) return;
    const touch = event.touches[0];
    if (!canPull() || event.touches.length !== 1 || touch.identifier !== pull.id) return cancelPull();
    const dy = touch.clientY - pull.y, dx = Math.abs(touch.clientX - pull.x);
    if (dy < 0 || (dx > 8 && dx > dy)) return cancelPull();
    pull.ready = dy >= 84;
    if (dy < 8 && !indicator.offsetHeight) return;
    if (event.cancelable) event.preventDefault();
    showPull(pull.ready ? 'Release to refresh' : 'Pull down to refresh', Math.min(108, dy * 0.6));
  }, { passive: false });
  document.addEventListener('touchcancel', cancelPull);
  document.addEventListener('touchend', async event => {
    if (!pull) return;
    const refresh = pull.ready && canPull() && !event.touches.length && event.changedTouches[0]?.identifier === pull.id;
    cancelPull();
    if (!refresh) return;
    showPull('Refreshing…', 52);
    try { await load(); } catch (error) { fail(error); } finally { showPull(''); }
  });
  window.addEventListener('beforeunload', event => { if (dirty || saving) { event.preventDefault(); event.returnValue = ''; } });
  const refreshIfIdle = () => { if (user && current && !$('editor').open && !saving && !document.hidden) load().catch(fail); };
  window.addEventListener('online', refreshIfIdle);
  window.addEventListener('offline', refreshIfIdle);
  window.addEventListener('storage', () => {
    if (user && cache.account() !== user.id) {
      user = null; entries = []; $('entries').replaceChildren(); $('tracker').hidden = true;
      $('editor').close(); $('login').hidden = false; status('Sign in to open your log.');
    }
  });
  document.addEventListener('visibilitychange', refreshIfIdle);
  setInterval(refreshIfIdle, 30000);
  if ('serviceWorker' in navigator) void navigator.serviceWorker.register('./service-worker.js', { scope: './' }).catch(() => {});
  start().catch(fail);
})();
