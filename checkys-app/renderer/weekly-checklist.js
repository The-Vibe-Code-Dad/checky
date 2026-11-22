// Weekly rows are ordinary checklist items. The tab maps weekday numbers to
// stable item IDs so changing the first day never changes a task's identity.
(function () {
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const DAY = 86400000;
  const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  let lastZone, formatter;
  function calendar(zone) {
    if (zone !== lastZone || !formatter) {
      formatter = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
      lastZone = zone;
    }
    return formatter;
  }
  function normalize(value) {
    if (!value || ![0, 1].includes(value.resetDay) || typeof value.time !== "string" || !timePattern.test(value.time) ||
        typeof value.timeZone !== 'string' || !value.timeZone || value.timeZone.length > 120 ||
        !Array.isArray(value.days) || !Array.isArray(value.itemIds)) return null;
    try { calendar(value.timeZone); } catch (_) { return null; }
    const days = names.map((_, day) => day).filter(day => value.days.includes(day));
    const itemIds = names.map((_, day) => {
      const id = value.itemIds[day];
      return typeof id === 'string' && id.length <= 120 && id && value.itemIds.indexOf(id) === day ? id : null;
    });
    return { resetDay: value.resetDay, time: value.time, timeZone: value.timeZone, days, itemIds, ...(value.followUpMinutes !== undefined ? { followUpMinutes: (typeof module === 'undefined' ? window.checkyReminderState : require('./reminder-state.js')).followUpMinutes(value.followUpMinutes) } : {}) };
  }
  function wallTime(at, zone) {
    const p = Object.fromEntries(calendar(zone).formatToParts(at).map(part => [part.type, part.value]));
    return Date.UTC(+p.year, p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  }
  function weekStart(at, schedule) {
    const day = Math.floor(wallTime(at, schedule.timeZone) / DAY);
    const weekday = new Date(day * DAY).getUTCDay();
    return day - (weekday - schedule.resetDay + 7) % 7;
  }
  // Compare dates in the saved timezone and current reset week, not UTC days.
  function isFutureDay(item, schedule, now = Date.now()) {
    const day = schedule?.itemIds?.indexOf(item.id) ?? -1;
    if (day < 0 || !schedule.days.includes(day)) return false;
    const today = Math.floor(wallTime(now, schedule.timeZone) / DAY);
    return weekStart(now, schedule) + (day - schedule.resetDay + 7) % 7 > today;
  }
  function isChecked(item, schedule, now = Date.now()) {
    const checked = Date.parse(item.reminderCheckedAt || item.completedAt);
    return !!item.done && Number.isFinite(checked) && weekStart(checked, schedule) === weekStart(now, schedule);
  }
  // Find the next real occurrence of this wall clock time. PocketBase uses it
  // as a lower bound and restricts each row to its own weekly reminder day.
  function nextAnchor(time, zone, now) {
    const localDay = Math.floor(wallTime(now, zone) / DAY) * DAY;
    const [hour, minute] = time.split(':').map(Number);
    for (let day = 0; day < 8; day++) {
      const wall = localDay + day * DAY + (hour * 60 + minute) * 60000;
      const first = realInstant(wall, zone);
      if (Number.isFinite(first) && first >= now) return new Date(first).toISOString();
    }
    throw Error('Choose another reminder time.');
  }
  // Resolve a recurring wall-clock time using the offsets on both sides of a DST transition.
  function realInstant(wall, zone) {
    const candidates = [];
    for (const probe of [wall - DAY, wall, wall + DAY]) {
      const instant = wall - (wallTime(probe, zone) - probe);
      if (wallTime(instant, zone) === wall) candidates.push(instant);
    }
    return Math.min(...candidates);
  }
  function localOccurrence(item, now, next = false) {
    const first = Date.parse(item.reminderAt), repeat = item.reminderRepeat;
    if (!Number.isFinite(first)) return NaN;
    if (!repeat || repeat === 'none') return first;
    if (!['daily','weekly','monthly','yearly'].includes(repeat) || !item.reminderTimeZone || item.reminderTimeZone === 'Local') return NaN;
    try {
      const zone = item.reminderTimeZone, anchor = new Date(wallTime(first, zone));
      const current = new Date(wallTime(next ? Math.max(first, now) : now, zone));
      const clock = anchor.getTime() % DAY;
      const day = Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate());
      const days = item.reminderDays ?? [anchor.getUTCDay()];
      if (repeat === 'weekly' && (!Array.isArray(days) || !days.length || days.some(d => !Number.isInteger(d) || d < 0 || d > 6))) return NaN;
      for (let i = 0; i < (repeat === 'weekly' ? 15 : 3); i++) {
        const offset = next ? i : -i;
        let date;
        if (repeat === 'monthly' || repeat === 'yearly') {
          date = new Date(Date.UTC(current.getUTCFullYear() + (repeat === 'yearly' ? offset : 0),
            repeat === 'monthly' ? current.getUTCMonth() + offset : anchor.getUTCMonth(), 1));
          const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
          date.setUTCDate(Math.min(anchor.getUTCDate(), last));
        } else {
          date = new Date(day + offset * DAY);
          if (repeat === 'weekly' && !days.includes(date.getUTCDay())) continue;
        }
        const wall = date.getTime() + clock;
        const at = wall === anchor.getTime() ? first : realInstant(wall, zone) + first % 1000;
        if (Number.isFinite(at) && at >= first && (next ? at > now : at <= now)) return at;
      }
    } catch (_) { /* An invalid imported timezone has no occurrences. */ }
    return NaN;
  }
  function skipped(item, at) {
    const checked = Date.parse(item.reminderCheckedAt);
    return item.done && item.reminderSkipToday && at > checked &&
      Math.floor(wallTime(checked, item.reminderTimeZone) / DAY) === Math.floor(wallTime(at, item.reminderTimeZone) / DAY);
  }
  function notificationSlot(item, tab, now, enabledAt) {
    const at = localOccurrence(item, now);
    if (!Number.isFinite(at) || at > now) return NaN;
    const schedule = tab.weeklyChecklist, day = schedule?.itemIds?.indexOf(item.id) ?? -1;
    if (day >= 0) {
      if (!schedule.days.includes(day) || isChecked(item, schedule, now)) return NaN;
      // Follow up only on this row's local calendar day, never later in the week.
      const today = Math.floor(wallTime(now, schedule.timeZone) / DAY);
      if (Math.floor(wallTime(at, schedule.timeZone) / DAY) !== today || new Date(today * DAY).getUTCDay() !== day) return NaN;
    }
    const checked = Date.parse(item.reminderCheckedAt);
    if (item.done && (!Number.isFinite(checked) || !item.reminderRepeat || item.reminderRepeat === 'none' || at <= checked || skipped(item, at))) return NaN;
    const state = typeof module === 'undefined' ? window.checkyReminderState : require('./reminder-state.js');
    return state.dueSlot(at, item.reminderFollowUpMinutes, now, enabledAt);
  }
  function localReset(item, now) {
    let at = localOccurrence(item, now, true);
    if (Number.isFinite(at) && skipped(item, at)) at = localOccurrence(item, at, true);
    return Number.isFinite(at) ? new Date(at).toISOString() : null;
  }
  const order = first => names.map((_, i) => (first + i) % 7);
  function initial(tab) {
    const existing = normalize(tab.weeklyChecklist);
    if (existing) return existing;
    const itemIds = names.map(name => tab.items.find(item => item.text.trim().toLowerCase() === name.toLowerCase())?.id || null);
    return { resetDay: 0, time: '09:00', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      days: order(0).filter(day => itemIds[day]), itemIds };
  }
  function configure(tab, choices, createId, maxItems, now = Date.now()) {
    const previous = normalize(tab.weeklyChecklist);
    const schedule = normalize({ ...choices, itemIds: initial(tab).itemIds });
    if (!schedule) throw Error('Choose a valid reminder time and reset day.');
    const items = new Map(tab.items.map(item => [item.id, item]));
    const additions = schedule.days.filter(day => !items.has(schedule.itemIds[day]));
    if (tab.items.length + additions.length > maxItems) throw Error('This tab has no room for the selected days.');
    const anchor = nextAnchor(schedule.time, schedule.timeZone, now);
    for (const day of order(schedule.resetDay)) {
      const enabled = schedule.days.includes(day);
      let item = items.get(schedule.itemIds[day]);
      if (!item && !enabled) continue;
      if (!item) {
        item = { id: createId('item'), text: names[day], done: false };
        schedule.itemIds[day] = item.id;
        tab.items.push(item);
      }
      if (previous && item.weeklyArchivedAt && !archivedThisWeek(item, previous, now)) item.weeklyArchivedAt = null;
      const checked = previous ? isChecked(item, previous, now) : (typeof module === 'undefined' ? window.checkyReminderState : require('./reminder-state.js')).isChecked(item, now);
      const preserveAnchor = enabled && previous?.days.includes(day) && previous.time === schedule.time &&
        previous.timeZone === schedule.timeZone && Number.isFinite(Date.parse(item.reminderAt));
      // Reset-day edits carry the currently displayed checks into the new week.
      const oldStamp = item.reminderCheckedAt || item.completedAt;
      const stamp = checked && previous?.resetDay === schedule.resetDay && Number.isFinite(Date.parse(oldStamp)) ? oldStamp : new Date(now).toISOString();
      Object.assign(item, { done: checked, completedAt: checked ? stamp : null,
        reminderCheckedAt: enabled && checked ? stamp : null, reminderResetAt: null, reminderSkipToday: false,
        reminderFollowUpMinutes: enabled ? schedule.followUpMinutes || null : null,
        reminderAt: enabled ? (preserveAnchor ? item.reminderAt : anchor) : null,
        reminderDays: enabled ? [day] : null, reminderRepeat: enabled ? 'weekly' : 'none', reminderTimeZone: enabled ? schedule.timeZone : null });
    }
    tab.weeklyChecklist = schedule;
  }

  function edit(tab) {
    const schedule = initial(tab);
    const dialog = document.createElement('dialog');
    dialog.className = 'week-dialog';
    dialog.setAttribute('aria-labelledby', 'week-dialog-title');
    dialog.innerHTML = '<form><h2 id="week-dialog-title" tabindex="-1">Weekly checklist</h2><p class="week-tab-name"></p>' +
      '<fieldset><legend>Reset checklist on</legend><div class="week-choices week-start"></div></fieldset>' +
      '<fieldset><legend>Remind me on</legend><div class="week-choices week-days"></div></fieldset>' +
      '<label class="week-time">Reminder time <input type="time" required></label>' +
      '<label class="week-follow">Repeat until checked (minutes) <input type="number" min="1" max="150119987579" step="1" inputmode="numeric" placeholder="Off"></label>' +
      '<p class="hint week-summary" aria-live="polite"></p><div class="week-actions"><button type="button" class="btn btn-ghost">Cancel</button>' +
      '<button type="submit" class="btn btn-primary">Save weekly setup</button></div></form>';
    const get = selector => dialog.querySelector(selector);
    get('.week-tab-name').textContent = tab.name;
    const time = get('input[type=time]');
    time.value = schedule.time;
    const follow = get('.week-follow input');
    follow.value = schedule.followUpMinutes || '';
    function choices(container, days, selected, change) {
      const buttons = new Map(days.map(day => {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'btn btn-ghost'; button.textContent = container.matches('.week-days') ? names[day].slice(0,3) : names[day];
        button.setAttribute('aria-label', names[day]);
        button.onclick = () => { change(day); update(); };
        return [day, button];
      }));
      return () => {
        for (const day of order(schedule.resetDay)) {
          const button = buttons.get(day);
          if (!button) continue;
          button.setAttribute('aria-pressed', String(selected(day)));
          if (container.matches('.week-days') || !container.contains(button)) container.append(button);
        }
      };
    }
    const drawReset = choices(get('.week-start'), [0, 1], day => day === schedule.resetDay, day => { schedule.resetDay = day; });
    const drawDays = choices(get('.week-days'), order(0), day => schedule.days.includes(day), day => {
      schedule.days = schedule.days.includes(day) ? schedule.days.filter(value => value !== day) : [...schedule.days, day];
    });
    function update() {
      const focused = document.activeElement;
      drawReset(); drawDays();
      if (dialog.contains(focused) && document.activeElement !== focused) focused.focus();
      time.disabled = !schedule.days.length;
      get('.week-time').hidden = time.disabled;
      get('.week-follow').hidden = follow.disabled = time.disabled;
      get('.week-summary').textContent = schedule.days.length ?
        'Checkmarks clear every ' + names[schedule.resetDay] + ' at midnight (' + schedule.timeZone + '). Reminders repeat only on their selected day, until checked or midnight.' :
        'No reminder days selected.';
    }
    update();
    document.body.append(dialog);
    return new Promise(resolve => {
      let result;
      dialog.addEventListener('close', () => { dialog.remove(); resolve(result); }, { once: true });
      get('.week-actions button[type=button]').onclick = () => dialog.close();
      get('form').onsubmit = event => {
        event.preventDefault();
        result = { ...schedule, time: time.value || schedule.time, followUpMinutes: window.checkyReminderState.followUpMinutes(follow.valueAsNumber) };
        dialog.close();
      };
      dialog.showModal(); get('h2').focus();
    });
  }

  function setChecked(item, checked, now = Date.now(), skipToday = false) {
    const stamp = checked ? new Date(now).toISOString() : null;
    Object.assign(item, { done: checked, completedAt: stamp, reminderCheckedAt: stamp, reminderSkipToday: checked && skipToday === true, reminderResetAt: null, weeklyArchivedAt: null });
  }
  function archivedThisWeek(item, schedule, now = Date.now()) {
    const at = Date.parse(item.weeklyArchivedAt);
    return Number.isFinite(at) && weekStart(at, schedule) === weekStart(now, schedule);
  }
  function archiveDay(tab, item, archive, createId, capacity, now = Date.now()) {
    if (archivedThisWeek(item, tab.weeklyChecklist, now)) return;
    if (archive.items.length >= capacity) throw Error('The Done archive is full.');
    setChecked(item, true, now);
    item.weeklyArchivedAt = item.completedAt;
    archive.items.push({ id: createId('item'), text: tab.name + ' · ' + item.text, done: true,
      originalTabName: tab.name, completedAt: item.completedAt, weeklySourceId: item.id });
  }
  function renderRows(list, tab, editWeek, toggle, openMenu) {
    const schedule = normalize(tab.weeklyChecklist);
    if (!schedule) return null;
    const header = document.createElement('div'); header.className = 'week-header';
    header.dataset.week = weekStart(Date.now(), schedule);
    const hint = document.createElement('span'); hint.textContent = 'Resets '+names[schedule.resetDay]+' at midnight';
    const editButton = document.createElement('button'); editButton.type = 'button'; editButton.className = 'btn btn-ghost'; editButton.textContent = 'Edit week';
    editButton.onclick = editWeek; header.append(hint, editButton); list.append(header);
    const indices = new Map(tab.items.map((item, index) => [item.id, index]));
    for (const day of order(schedule.resetDay).filter(day => schedule.days.includes(day))) {
      const index = indices.get(schedule.itemIds[day]);
      if (index === undefined) continue;
      const item = tab.items[index];
      if (archivedThisWeek(item, schedule)) continue;
      const row = document.createElement('div'); row.className = 'week-row'; row.dataset.itemIndex = index;
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.id = 'weekly-day-' + day;
      box.checked = isChecked(item, schedule);
      box.onchange = () => toggle(item.id, box.checked);

      const label = document.createElement('label');
      label.htmlFor = box.id;
      label.textContent = names[day];

      const options = document.createElement('button');
      options.type = 'button';
      options.className = 'drag-handle week-menu-button';
      options.setAttribute('aria-label', 'Options for ' + names[day]);
      options.setAttribute('aria-controls', 'itemContextMenu');
      for (let i = 0; i < 3; i++) {
        const line = document.createElement('span');
        line.className = 'line';
        options.append(line);
      }
      options.onclick = event => {
        event.stopPropagation();
        const bounds = options.getBoundingClientRect();
        openMenu(index, bounds.left, bounds.bottom);
        if (event.detail === 0) document.querySelector('#itemContextMenu button')?.focus();
      };
      window.checkyContextMenu.bindHold(label, (x, y) => openMenu(index, x, y));
      row.oncontextmenu = event => {
        event.preventDefault();
        event.stopPropagation();
        openMenu(index, event.clientX, event.clientY);
      };
      row.append(box, label, options);
      list.append(row);
    }
    return new Set(schedule.itemIds);
  }
  const api = { notificationSlot, localReset, normalize, weekStart, isFutureDay, isChecked, nextAnchor, configure, edit, renderRows, setChecked, archiveDay, archivedThisWeek };
  if (typeof module !== 'undefined') module.exports = api;
  else window.checkyWeekly = api;
})();
