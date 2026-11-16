// The browser and native wrapper use the same HTML, storage and renderer.
(() => {
  const byId = id => document.getElementById(id);
  const native = window.checkyDesktop;
  const ua = navigator.userAgent;
  const platform = /Android|iPhone|iPod|iPad|CrOS/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)
    ? '' : /Windows NT/.test(ua) ? 'windows' : /Macintosh|Mac OS X/.test(ua) ? 'macos' : /Linux/.test(ua) ? 'linux' : '';
  const release = 'https://github.com/The-Vibe-Code-Dad/checky/releases/download/desktop-v2.0.0/';
  const installers = { windows: 'checkys-list-2.0.0-x64.exe', macos: 'checkys-list-2.0.0-universal.dmg', linux: 'checkys-list-2.0.0-x86_64.AppImage' };
  const offerKey = 'checky.desktop.install-offered.v1';

  window.checkyDesktopReady = () => {
    if (!platform && !native) return;
    byId('desktopSettingsRow').hidden = false;
    if (native) {
      byId('desktopDownload').hidden = true;
      byId('desktopPreferences').hidden = false;
      byId('desktopPreferences').onclick = () => native.preferences();
      return;
    }
    const offer = byId('desktopInstallOffer');
    for (const link of [byId('desktopDownload'), byId('desktopInstallNow')]) {
      link.href = release + installers[platform];
      link.textContent = 'Install Checky for ' + ({windows: 'Windows', macos: 'macOS', linux: 'Linux'})[platform];
      link.onclick = () => { offer.hidden = true; };
    }
    byId('desktopInstallLater').onclick = () => { offer.hidden = true; };
    try {
      if (!localStorage.getItem(offerKey)) {
        localStorage.setItem(offerKey, '1');
        offer.hidden = false;
      }
    } catch (_) { /* Settings still offers the download in private mode. */ }
  };

  if (!native) return;
  let account = '', running = false;
  const preferenceKey = () => 'checky.desktop.notifications.' + account;
  window.checkyDesktopReminders = id => {
    account = native.local ? 'local' : (id || state.hostedSession?.user?.id || '');
    const button = byId('notificationsToggle');
    const dialog = byId('notificationSettingsDialog');
    const path = byId('systemNotificationPath');
    byId('notificationSettings').onclick = () => {
      path.textContent = 'Checky can remind you about the open checklist while it is running in the tray.';
      button.textContent = localStorage.getItem(preferenceKey()) ? 'Turn off notifications' : 'Enable notifications';
      button.disabled = !account;
      dialog.showModal();
    };
    button.onclick = async () => {
      if (!account) return;
      if (localStorage.getItem(preferenceKey())) {
        localStorage.removeItem(preferenceKey());
      } else {
        try { await native.notify('Notifications are enabled for this checklist.'); }
        catch (_) { path.textContent = 'Could not show a notification. Check the system notification permissions for Checky.'; return; }
        localStorage.setItem(preferenceKey(), String(Date.now()));
      }
      button.textContent = localStorage.getItem(preferenceKey()) ? 'Turn off notifications' : 'Enable notifications';
    };
  };
  window.checkyDesktopTick = async () => {
    if (running || !account || (!native.local && !(state.hostedSession.authenticated || state.hostedSession.offline))) return;
    const enabledAt = Number(localStorage.getItem(preferenceKey()));
    if (!enabledAt) return;
    const scope = JSON.stringify([account, state.currentChecklistId || state.hostedSession.recordId || 'local']);
    const key = 'checky.desktop.delivered.' + scope;
    running = true;
    try {
      const delivered = JSON.parse(localStorage.getItem(key) || '{}'), now = Date.now();
      for (const [id, at] of Object.entries(delivered)) if (at < now - 86400000) delete delivered[id];
      for (const tab of state.data.tabs) {
        if (tab.system === 'done') continue;
        for (const item of tab.items) {
          const slot = window.checkyWeekly.notificationSlot(item, tab, now, enabledAt);
          const id = JSON.stringify([tab.id, item.id]);
          if (Number.isFinite(slot) && slot > (delivered[id] || 0)) {
            await native.notify((item.text || 'Checklist event').slice(0,160));
            delivered[id] = slot;
            localStorage.setItem(key, JSON.stringify(delivered));
          }
        }
      }
    } finally { running = false; }
  };
})();
