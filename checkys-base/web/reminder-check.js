(function () {
  window.checkyConfirmEarlyCheck = item => new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'reminder-check-dialog';
    const title = document.createElement('h2');
    title.id = 'earlyReminderTitle'; title.textContent = 'Skip today’s reminder?';
    const description = document.createElement('p');
    description.textContent = (item.text || 'This item').slice(0, 200) + ' has a reminder later today. Skip it and keep this item checked until the following occurrence?';
    const hint = document.createElement('p'); hint.className = 'hint';
    hint.textContent = 'Future reminders will continue. This choice applies to everyone using this checklist.';
    const actions = document.createElement('div'); actions.className = 'inline';
    let finished = false;
    const finish = value => {
      if (finished) return;
      finished = true; dialog.close(); dialog.remove(); resolve(value);
    };
    for (const [text, value, style] of [['Skip today’s reminder', true, 'btn-primary'], ['Keep reminder', false, 'btn-ghost'], ['Cancel', null, 'btn-ghost']]) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'btn ' + style;
      button.textContent = text; button.onclick = () => finish(value); actions.append(button);
    }
    dialog.oncancel = event => { event.preventDefault(); finish(null); };
    dialog.onclose = () => finish(null);
    dialog.setAttribute('aria-labelledby', title.id);
    title.tabIndex = -1;
    dialog.append(title, description, hint, actions); document.body.append(dialog);
    dialog.showModal(); title.focus();
  });
})();
