(function () {
  let nextId = 0;
  window.checkyConfirmEarlyCheck = (item, { weekly = false } = {}) => new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'reminder-check-dialog';
    const title = document.createElement('h2');
    title.id = 'earlyReminderTitle-' + ++nextId; title.textContent = 'Skip today’s reminder?';
    const description = document.createElement('p');
    description.textContent = (item.text || 'This item').slice(0, 200) + ' has a reminder later today. Skip it and keep this item checked until ' + (weekly ? 'the weekly reset?' : 'the following occurrence?');
    const hint = document.createElement('p'); hint.className = 'hint';
    hint.textContent = 'Future reminders will continue. This choice applies to everyone using this checklist.';
    const actions = document.createElement('form'); actions.method = 'dialog'; actions.className = 'inline';
    for (const [text, value, style] of [['Skip today’s reminder', 'skip', 'btn-primary'], ['Keep reminder', 'keep', 'btn-ghost'], ['Cancel', 'cancel', 'btn-ghost']]) {
      // Weekly completion already stops that day's reminders until the reset.
      if (weekly && value === 'keep') continue;
      const button = document.createElement('button'); button.type = 'submit'; button.className = 'btn ' + style;
      button.textContent = text; button.value = value; button.autofocus = value === 'cancel'; actions.append(button);
    }
    dialog.addEventListener('close', () => {
      const value = dialog.returnValue;
      dialog.returnValue = '';
      dialog.remove(); resolve(value === 'skip' ? true : value === 'keep' ? false : null);
    }, { once: true });
    dialog.setAttribute('aria-labelledby', title.id);
    dialog.append(title, description, hint, actions); document.body.append(dialog);
    dialog.showModal();
  });
})();
