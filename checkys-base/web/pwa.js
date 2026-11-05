(() => {
  const BUILD = '__CHECKY_BUILD__';
  const banner = document.getElementById('appUpdateBanner');
  const notice = document.getElementById('appUpdateNotice');
  const status = document.getElementById('appUpdateStatus');
  const checkButton = document.getElementById('appUpdateCheck');
  const updateButton = document.getElementById('appUpdateApply');
  let registration, registering, checking = false, applying = false, readyVersion = '', lastCheck = 0;
  function message(text) { status.textContent = text; }
  if (!window.isSecureContext || !('serviceWorker' in navigator)) {
    checkButton.disabled = true;
    message('Open Checky over HTTPS to use installed-app updates.');
    return;
  }
  function workerVersion(worker) {
    return new Promise(resolve => {
      if (!worker) { resolve(''); return; }
      const channel = new MessageChannel();
      const finish = value => { clearTimeout(timer); channel.port1.close(); resolve(value); };
      const timer = setTimeout(() => finish(''), 2000);
      channel.port1.onmessage = event => finish(typeof event.data?.version === 'string' ? event.data.version : '');
      try { worker.postMessage({ type: 'CHECKY_VERSION' }, [channel.port2]); }
      catch (_) { finish(''); }
    });
  }
  async function refreshReady() {
    const version = await workerVersion(registration?.active);
    if (!version || version === BUILD) return false;
    readyVersion = version;
    banner.hidden = false;
    notice.textContent = 'A Checky update is ready.';
    message('An update is ready. Choose Update now to save your checklist and reload.');
    return true;
  }
  function watch(worker) {
    if (!worker) return;
    let activated = worker.state === 'activated';
    worker.addEventListener('statechange', () => {
      if (worker.state === 'activated') { activated = true; void refreshReady(); }
      if (worker.state === 'redundant' && !activated) message('The update could not download. Check again when connected.');
    });
  }
  function register() {
    if (registration) return Promise.resolve(registration);
    if (!registering) registering = navigator.serviceWorker.register('./service-worker.js', { updateViaCache: 'none' }).then(reg => {
      registration = reg;
      reg.addEventListener('updatefound', () => watch(reg.installing));
      watch(reg.installing);
      return reg;
    }).catch(error => { registering = null; throw error; });
    return registering;
  }
  // Check the server even when an installed app resumes the same page for days.
  async function check(manual = false) {
    if (checking || applying || (!manual && Date.now() - lastCheck < 60000)) return;
    if (!navigator.onLine) { if (manual) message('You are offline. Check for updates when connected.'); return; }
    checking = true; lastCheck = Date.now(); checkButton.disabled = true;
    if (manual) message('Checking for app updates…');
    try {
      const reg = await register();
      const response = await fetch('./version.json', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('The update check could not reach Checky. Try again when connected.');
      const latest = await response.json();
      if (typeof latest.version !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(latest.version)) throw new Error('The server did not return a valid app version. Try again later.');
      await reg.update();
      if (await refreshReady()) return;
      if (latest.version !== BUILD) message('Downloading the new version. Update now will appear when it is ready.');
      else if (manual) message('Checky is up to date.');
    } catch (error) {
      if (manual) message(error.name === 'TimeoutError' ? 'The update check timed out. Try again when connected.' :
        error.name === 'TypeError' ? 'Could not reach Checky. Check your connection and try again.' : (error.message || 'Could not check for updates.'));
    } finally { checking = false; checkButton.disabled = false; }
  }
  async function apply() {
    if (applying || !readyVersion) return;
    applying = true; updateButton.disabled = true;
    const app = document.getElementById('app');
    app.inert = true;
    try {
      notice.textContent = 'Saving your checklist…';
      if (typeof window.checkyPrepareForUpdate !== 'function') throw new Error('Checky is still opening. Try Update now again in a moment.');
      await window.checkyPrepareForUpdate();
      // No storage, cookies or push subscriptions are deleted by an app update.
      window.location.reload();
    } catch (error) {
      notice.textContent = error.message || 'Could not save your checklist. Try Update now again.';
      message(notice.textContent);
      applying = false; updateButton.disabled = false; app.inert = false;
    }
  }
  checkButton.onclick = () => { void check(true); };
  updateButton.onclick = () => { void apply(); };
  navigator.serviceWorker.addEventListener('controllerchange', () => { void refreshReady(); });
  window.addEventListener('online', () => { lastCheck = 0; void check(); });
  window.addEventListener('pageshow', () => { void check(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void check(); });
  // A failed registration must not become an unhandled rejection while offline.
  register().catch(() => message('App updates are unavailable right now. Check again when connected.'));
  void check();
})();
