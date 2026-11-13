// Completion of one occurrence is separate from permanently finishing an item.
(function () {
  function repeating(item) {
    return Number.isFinite(Date.parse(item?.reminderAt)) && ['daily', 'weekly', 'monthly', 'yearly'].includes(item?.reminderRepeat);
  }
  function isChecked(item, now = Date.now()) {
    const checked = Date.parse(item?.reminderCheckedAt), reset = Date.parse(item?.reminderResetAt);
    return !!item?.done && !(repeating(item) && Number.isFinite(checked) && Number.isFinite(reset) && reset > checked && now >= reset);
  }
  function setChecked(item, checked, now = Date.now(), skipToday = false) {
    item.done = !!checked;
    item.reminderCheckedAt = checked && repeating(item) ? new Date(now).toISOString() : null;
    item.reminderSkipToday = !!item.reminderCheckedAt && skipToday === true;
    item.reminderResetAt = null;
  }
  // Only offer to skip a real occurrence later on the schedule's calendar day.
  // Resolve both offsets around DST changes and use the first matching instant.
  function hasReminderLaterToday(item, now = Date.now()) {
    if (!repeating(item) || !item.reminderTimeZone || item.reminderTimeZone === 'Local') return false;
    try {
      const format = new Intl.DateTimeFormat('en-US', { timeZone: item.reminderTimeZone,
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
      const parts = time => Object.fromEntries(format.formatToParts(time).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
      const day = value => Date.UTC(value.year, value.month - 1, value.day);
      const first = Date.parse(item.reminderAt), anchor = parts(first), today = parts(now);
      if (day(today) < day(anchor)) return false;
      const lastDay = new Date(Date.UTC(today.year, today.month, 0)).getUTCDate();
      if (item.reminderRepeat === 'weekly') {
        const days = item.reminderDays == null ? [new Date(day(anchor)).getUTCDay()] : item.reminderDays;
        if (!Array.isArray(days) || days.some(value => !Number.isInteger(value) || value < 0 || value > 6) || !days.includes(new Date(day(today)).getUTCDay())) return false;
      } else if (item.reminderRepeat === 'monthly' || item.reminderRepeat === 'yearly') {
        if (today.day !== Math.min(anchor.day, lastDay) || (item.reminderRepeat === 'yearly' && today.month !== anchor.month)) return false;
      }
      if (day(today) === day(anchor)) return first > now;
      const wall = day(today) + ((anchor.hour * 60 + anchor.minute) * 60 + anchor.second) * 1000 + first % 1000;
      const candidates = [];
      for (const probe of [now - 86400000, now, now + 86400000]) {
        const local = parts(probe);
        const offset = day(local) + ((local.hour * 60 + local.minute) * 60 + local.second) * 1000 - Math.floor(probe / 1000) * 1000;
        const at = wall - offset, resolved = parts(at);
        if (day(resolved) === day(today) && resolved.hour === anchor.hour && resolved.minute === anchor.minute && resolved.second === anchor.second) candidates.push(at);
      }
      return candidates.length > 0 && Math.min(...candidates) > now;
    } catch (_) { return false; }
  }
  function identity(item) {
    return JSON.stringify([!!item.done, item.reminderAt, item.reminderRepeat, item.reminderTimeZone, item.reminderDays, item.reminderCheckedAt, item.reminderSkipToday === true]);
  }
  function mergeResetTimes(target, source) {
    const byId = new Map();
    for (const tab of source?.tabs || []) for (const item of tab.items || []) byId.set(JSON.stringify([tab.id, item.id]), item);
    let changed = false;
    for (const tab of target?.tabs || []) for (const item of tab.items || []) {
      const server = byId.get(JSON.stringify([tab.id, item.id]));
      if (!server || identity(item) !== identity(server)) continue;
      const reset = Number.isFinite(Date.parse(server.reminderResetAt)) ? new Date(server.reminderResetAt).toISOString() : null;
      if (item.reminderResetAt !== reset) { item.reminderResetAt = reset; changed = true; }
    }
    return changed;
  }
  const api = { repeating, isChecked, setChecked, hasReminderLaterToday, identity, mergeResetTimes };
  if (typeof module !== 'undefined') module.exports = api;
  else window.checkyReminderState = api;
})();
