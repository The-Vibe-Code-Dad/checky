// Completion of one occurrence is separate from permanently finishing an item.
(function () {
  function repeating(item) {
    return Number.isFinite(Date.parse(item?.reminderAt)) && ['daily', 'weekly', 'monthly', 'yearly'].includes(item?.reminderRepeat);
  }
  function isChecked(item, now = Date.now()) {
    const checked = Date.parse(item?.reminderCheckedAt), reset = Date.parse(item?.reminderResetAt);
    return !!item?.done && !(repeating(item) && Number.isFinite(checked) && Number.isFinite(reset) && reset > checked && now >= reset);
  }
  function setChecked(item, checked, now = Date.now()) {
    item.done = !!checked;
    item.reminderCheckedAt = checked && repeating(item) ? new Date(now).toISOString() : null;
    item.reminderResetAt = null;
  }
  function identity(item) {
    return JSON.stringify([!!item.done, item.reminderAt, item.reminderRepeat, item.reminderTimeZone, item.reminderDays, item.reminderCheckedAt]);
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
  const api = { repeating, isChecked, setChecked, mergeResetTimes };
  if (typeof module !== 'undefined') module.exports = api;
  else window.checkyReminderState = api;
})();
