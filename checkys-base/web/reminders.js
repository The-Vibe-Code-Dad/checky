(() => {
  let userId = '';
  let busy = false;
  const button = document.getElementById('notificationsToggle');
  const settingsDialog = document.getElementById('notificationSettingsDialog');
  const status = document.getElementById('notificationsStatus');
  const supported = () => window.isSecureContext && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
  const key = () => 'checky-notifications-' + userId;
  const optedIn = () => { try { return localStorage.getItem(key()) === 'on'; } catch (_) { return false; } };
  function remember(enabled) { try { enabled ? localStorage.setItem(key(), 'on') : localStorage.removeItem(key()); } catch (_) {} }
  function message(text) {
    status.textContent = text;
    status.hidden = !text;
  }
  function refreshToggle() {
    button.textContent = optedIn() ? 'Turn off notifications' : 'Enable notifications';
    button.disabled = busy || !userId || !supported();
  }
  function openSettings() {
    const link = document.getElementById('systemNotificationSettings');
    const path = document.getElementById('systemNotificationPath');
    const agent = navigator.userAgent;
    if (/Android/i.test(agent)) {
      // A web fallback can relaunch an installed PWA. A package fallback can open the store.
      link.href = 'intent:#Intent;action=android.settings.NOTIFICATION_SETTINGS;end';
      link.textContent = 'Open notification settings';
      link.hidden = false;
      path.textContent = '';
      link.onclick = () => {
        path.textContent = 'If Settings stays closed, hold the Checky app icon and tap App info → Notifications.';
      };
    } else if (/Windows NT/i.test(agent)) {
      link.href = 'ms-settings:notifications';
      link.textContent = 'Open Windows notification settings';
      link.hidden = false;
    } else if (/iPhone|iPad|iPod/.test(agent) || (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1)) {
      path.textContent = 'Settings → Notifications → Checky’s List';
    } else {
      path.textContent = 'Manage notification permissions in your browser’s site settings.';
    }
    refreshToggle();
    settingsDialog.showModal();
  }
  document.getElementById('notificationSettings').onclick = openSettings;
  async function api(method, body) {
    const response = await fetch('/api/checkys-base/push', {
      method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, cache: 'no-store'
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || result.message || 'Could not update notifications. Try again when connected.');
    return result;
  }
  async function registration() {
    await navigator.serviceWorker.register('./service-worker.js', { updateViaCache: 'none' });
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Notifications are still starting. Please try again.')), 10000))
    ]);
  }
  function decodeKey(value) {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(base64), char => char.charCodeAt(0));
  }
  async function enable() {
    const config = await api('GET');
    const reg = await registration();
    let subscription = await reg.pushManager.getSubscription();
    const publicKey = decodeKey(config.publicKey);
    if (subscription && String(new Uint8Array(subscription.options.applicationServerKey || [])) !== String(publicKey)) {
      await subscription.unsubscribe(); subscription = null;
    }
    subscription ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey });
    await api('POST', { subscription: subscription.toJSON() });
    remember(true);
    message('');
  }
  async function disable() {
    const reg = await registration();
    const subscription = await reg.pushManager.getSubscription();
    if (subscription) {
      await api('DELETE', { endpoint: subscription.endpoint });
      await subscription.unsubscribe();
    }
    remember(false);
    message('');
  }
  async function init(id) {
    if (window.checkyDesktop) {
      window.checkyDesktopReminders?.(id);
      return;
    }
    userId = id || '';
    refreshToggle();
    if (!supported()) {
      message(!window.isSecureContext ? 'Open Checky over HTTPS to enable notifications.' : 'Web push is unavailable in this browser.');
      return;
    }
    button.onclick = async () => {
      if (busy) return;
      busy = true; refreshToggle();
      message('');
      try {
        if (optedIn()) await disable();
        else {
          // Permission is requested only from this explicit user click.
          const permission = await Notification.requestPermission();
          if (permission !== 'granted') throw new Error('Notifications were not allowed.');
          await enable();
        }
      } catch (error) { message(error.message); }
      finally { busy = false; refreshToggle(); }
    };
    if (userId && optedIn() && Notification.permission === 'granted') {
      busy = true; refreshToggle();
      try { await enable(); } catch (error) { message(error.message); }
      finally { busy = false; refreshToggle(); }
    } else {
      remember(false);
      refreshToggle();
    }
  }
  window.checkyReminders = { init, edit: window.checkyEditReminder };
})();
