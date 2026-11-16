(async () => {
  const invoke = window.__TAURI__.core.invoke;
  const form = document.getElementById('preferences'), status = document.getElementById('status');
  const site = document.getElementById('site'), shortcut = document.getElementById('shortcut');
  const submit = form.querySelector('button');
  const sync = () => { site.disabled = form.elements.mode.value === 'local'; };
  form.onchange = sync;
  submit.disabled = true;
  try {
    const { settings, registered } = await invoke('read_preferences');
    form.elements.mode.value = settings.local ? 'local' : 'hosted';
    site.value = settings.site; shortcut.value = settings.shortcut;
    if (!registered) status.textContent = 'The global shortcut is unavailable. Choose another combination or use the tray menu.';
    sync(); submit.disabled = false;
  } catch (error) { status.textContent = String(error); }
  form.onsubmit = async event => {
    event.preventDefault(); submit.disabled = true;
    try {
      await invoke('save_preferences', { settings: {site: site.value.trim(), local: site.disabled, shortcut: shortcut.value.trim()} });
      await invoke('open_workspace');
    } catch (error) { status.textContent = String(error); }
    finally { submit.disabled = false; }
  };
})();
