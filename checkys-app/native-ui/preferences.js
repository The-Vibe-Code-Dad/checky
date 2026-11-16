(async () => {
  const invoke = window.__TAURI__.core.invoke;
  const form = document.getElementById('preferences'), status = document.getElementById('status');
  const site = document.getElementById('site'), shortcut = document.getElementById('shortcut');
  const submit = form.querySelector('[type=submit]');
  const sync = () => { site.disabled = form.elements.mode.value === 'local'; };
  const startup = document.getElementById('startup'), top = document.getElementById('top'), blur = document.getElementById('blur');
  document.getElementById('releases').onclick = () => invoke('open_releases').catch(e => { status.textContent = String(e); });
  form.onchange = sync;
  submit.disabled = true;
  try {
    const { settings, registered, startup: launch } = await invoke('read_preferences');
    form.elements.mode.value = settings.local ? 'local' : 'hosted';
    startup.checked = launch; top.checked = settings.always_on_top; blur.checked = settings.hide_on_blur;
    site.value = settings.site; shortcut.value = settings.shortcut;
    if (!registered) status.textContent = 'The global shortcut is unavailable. Choose another combination or use the tray menu.';
    sync(); submit.disabled = false;
  } catch (error) { status.textContent = String(error); }
  form.onsubmit = async event => {
    event.preventDefault(); submit.disabled = true;
    try {
      await invoke('save_preferences', { startup: startup.checked, settings: {always_on_top: top.checked, hide_on_blur: blur.checked, site: site.value.trim(), local: site.disabled, shortcut: shortcut.value.trim()} });
      await invoke('open_workspace');
    } catch (error) { status.textContent = String(error); }
    finally { submit.disabled = false; }
  };
})();
