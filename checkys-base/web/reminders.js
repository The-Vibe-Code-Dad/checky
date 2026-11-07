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
      // Android exposes its main Settings activity to browser links.
      link.href = 'intent:#Intent;action=android.settings.SETTINGS;package=com.android.settings;end';
      link.textContent = 'Phone settings';
      link.hidden = false;
      path.textContent = ' → Notifications → App notifications → Checky or your browser.';
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
    if (!link.hidden && optedIn() && supported() && Notification.permission === 'granted') {
      // Keep the controls available when the user returns or the browser declines the handoff.
      link.click();
    }
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
  function edit(item) {
    return new Promise(resolve => {
      const dialog = document.createElement('dialog');
      dialog.className = 'reminder-dialog';
      const form = document.createElement('form');
      const title = document.createElement('h2'); title.textContent = 'Event reminder';
      const description = document.createElement('p'); description.textContent = (item.text || 'Checklist event').slice(0, 200);
      const label = document.createElement('label'); label.textContent = 'Date and time';
      const input = document.createElement('input'); input.type = 'datetime-local'; input.required = true; input.id = 'reminderDateTime'; label.htmlFor = input.id;
      const localDate = value => {
        const date = new Date(value);
        return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      };
      input.value = localDate(item.reminderAt || Date.now() + 3600000);
      const initialLocal = input.value;
      const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const repeatLabel = document.createElement('label'); repeatLabel.textContent = 'Repeat'; repeatLabel.htmlFor = 'reminderRepeat';
      const repeat = document.createElement('select'); repeat.id = 'reminderRepeat';
      for (const [value, text] of [['none', 'Does not repeat'], ['daily', 'Every day'], ['weekly', 'Every week'], ['monthly', 'Every month'], ['yearly', 'Every year']]) {
        const option = document.createElement('option'); option.value = value; option.textContent = text; repeat.append(option);
      }
      repeat.value = ['daily', 'weekly', 'monthly', 'yearly'].includes(item.reminderRepeat) ? item.reminderRepeat : 'none';
      const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const days = document.createElement('fieldset'); days.className = 'reminder-days';
      const legend = document.createElement('legend'); legend.textContent = 'Repeat on'; days.append(legend);
      const repeatZone = () => input.value === initialLocal && item.reminderTimeZone ? item.reminderTimeZone : localZone;
      const anchorDay = () => {
        // The existing schedule may belong to a different timezone than this phone.
        const date = input.value === initialLocal && item.reminderAt ? new Date(item.reminderAt) : new Date(input.value);
        return weekdays.indexOf(new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: repeatZone() }).format(date));
      };
      let daysEdited = Array.isArray(item.reminderDays) && item.reminderDays.length > 0;
      const selectedDays = daysEdited ? item.reminderDays : [anchorDay()];
      const dayInputs = weekdays.map((name, day) => {
        const choice = document.createElement('label');
        const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = String(day); checkbox.checked = selectedDays.includes(day);
        checkbox.setAttribute('aria-label', name);
        const text = document.createElement('span'); text.textContent = name.slice(0, 3);
        choice.append(checkbox, text); days.append(choice);
        checkbox.onchange = () => { daysEdited = true; updateRepeatHint(); };
        return checkbox;
      });
      const chosenDays = () => dayInputs.filter(checkbox => checkbox.checked).map(checkbox => Number(checkbox.value));
      const repeatHint = document.createElement('p'); repeatHint.className = 'hint'; repeatHint.setAttribute('aria-live', 'polite');
      function updateRepeatHint() {
        label.textContent = repeat.value === 'none' ? 'Date and time' : 'Starts';
        days.hidden = repeat.value !== 'weekly';
        if (!daysEdited && Number.isFinite(new Date(input.value).getTime())) {
          const day = anchorDay(); dayInputs.forEach((checkbox, index) => { checkbox.checked = index === day; });
        }
        repeatHint.textContent = repeat.value === 'none' ? 'Send one reminder.' :
          (repeat.value === 'weekly' ? 'Every ' + (chosenDays().map(day => weekdays[day]).join(', ') || 'selected day') + ', starting on or after the date above. ' : '') +
          'Repeats in ' + repeatZone() + '. Checking the item completes this occurrence; it resets at the next scheduled time. Mark done stops the series.' +
          (['monthly', 'yearly'].includes(repeat.value) ? ' Shorter months use their last day.' : '');
      }
      repeat.onchange = updateRepeatHint; input.oninput = updateRepeatHint; updateRepeatHint();
      const hint = document.createElement('p'); hint.className = 'hint';
      hint.textContent = 'Date and time are shown in ' + localZone + '. Sync before closing Checky. People with checklist access can receive reminders on browsers where they enabled notifications.';
      const error = document.createElement('p'); error.className = 'hint'; error.setAttribute('role', 'alert');
      const actions = document.createElement('div'); actions.className = 'inline';
      const save = document.createElement('button'); save.type = 'submit'; save.className = 'btn btn-primary'; save.textContent = 'Save and sync';
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'btn btn-danger'; remove.textContent = 'Remove reminder'; remove.hidden = !item.reminderAt;
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'btn btn-ghost'; cancel.textContent = 'Cancel';
      let finished = false;
      const finish = value => { if (finished) return; finished = true; dialog.close(); dialog.remove(); resolve(value); };
      cancel.onclick = () => finish(undefined);
      remove.onclick = () => finish(null);
      dialog.oncancel = event => { event.preventDefault(); finish(undefined); };
      form.onsubmit = event => {
        event.preventDefault();
        const date = new Date(input.value);
        const continuing = item.reminderAt && input.value === initialLocal;
        if (!Number.isFinite(date.getTime()) || (date.getTime() <= Date.now() && !continuing)) { error.textContent = 'Choose a future date and time.'; return; }
        if (localDate(date) !== input.value) { error.textContent = 'That time does not exist in your timezone because the clocks change. Choose another time.'; return; }
        if (repeat.value === 'weekly' && !chosenDays().length) { error.textContent = 'Choose at least one day of the week.'; return; }
        finish({ at: input.value === initialLocal && item.reminderAt ? item.reminderAt : date.toISOString(),
          repeat: repeat.value, timeZone: repeat.value === 'none' ? null : repeatZone(), days: repeat.value === 'weekly' ? chosenDays() : null });
      };
      actions.append(save, remove, cancel);
      form.append(title, description, label, input, repeatLabel, repeat, days, repeatHint, hint, error, actions);
      // Keep the phone's keyboard/date picker from opening over the options on entry.
      title.tabIndex = -1; title.autofocus = true;
      dialog.setAttribute('aria-labelledby', 'reminderDialogTitle'); title.id = 'reminderDialogTitle';
      dialog.append(form); document.body.append(dialog); dialog.showModal(); title.focus();
    });
  }
  window.checkyReminders = { init, edit };
})();
