(() => {
  function edit(item, desktop = false) {
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
      const followLabel = document.createElement('label'); followLabel.textContent = 'Repeat until checked (minutes)';
      const follow = document.createElement('input'); follow.id = 'reminderFollowUp'; followLabel.htmlFor = follow.id;
      follow.type = 'number'; follow.min = '1'; follow.max = '150119987579'; follow.step = '1'; follow.placeholder = 'Off'; follow.inputMode = 'numeric';
      follow.value = item.reminderFollowUpMinutes || '';
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
        repeatHint.textContent = repeat.value === 'none' ? 'Starts at the date and time above.' :
          (repeat.value === 'weekly' ? 'Every ' + (chosenDays().map(day => weekdays[day]).join(', ') || 'selected day') + ', starting on or after the date above. ' : '') +
          'Repeats in ' + repeatZone() + '. Checking the item completes this occurrence; it resets at the next scheduled time. Checking early lets you skip today’s reminder. Mark done stops the series.' +
          (['monthly', 'yearly'].includes(repeat.value) ? ' Shorter months use their last day.' : '');
      }
      repeat.onchange = updateRepeatHint; input.oninput = updateRepeatHint; updateRepeatHint();
      const hint = document.createElement('p'); hint.className = 'hint';
      hint.textContent = desktop ? 'Reminders for this checklist appear while Checky is running, including in the tray.' : 'Date and time are shown in ' + localZone + '. Sync before closing Checky. People with checklist access can receive reminders on browsers where they enabled notifications.';
      const error = document.createElement('p'); error.className = 'hint'; error.setAttribute('role', 'alert');
      const actions = document.createElement('div'); actions.className = 'inline';
      const save = document.createElement('button'); save.type = 'submit'; save.className = 'btn btn-primary'; save.textContent = desktop ? 'Save reminder' : 'Save and sync';
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
          followUpMinutes: window.checkyReminderState.followUpMinutes(follow.valueAsNumber), repeat: repeat.value, timeZone: repeat.value === 'none' ? null : repeatZone(), days: repeat.value === 'weekly' ? chosenDays() : null });
      };
      actions.append(save, remove, cancel);
      form.append(title, description, label, input, repeatLabel, repeat, days, repeatHint, followLabel, follow, hint, error, actions);
      // Keep the phone's keyboard/date picker from opening over the options on entry.
      title.tabIndex = -1; title.autofocus = true;
      dialog.setAttribute('aria-labelledby', 'reminderDialogTitle'); title.id = 'reminderDialogTitle';
      dialog.append(form); document.body.append(dialog); dialog.showModal(); title.focus();
    });
  }
  window.checkyEditReminder = edit;
})();
