// Shared expectations for the browser scheduler and real PocketBase runtime.
const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function weeklyCase(day, now, expected, overrides = {}, resetDay = 0) {
  return {
    item: { id: names[day], text: names[day], done: false,
      reminderAt: '2026-11-14T23:30:00.000Z', reminderRepeat: 'weekly', reminderDays: [day],
      reminderTimeZone: 'America/New_York', reminderFollowUpMinutes: 25, ...overrides },
    weeklyChecklist: { resetDay, time: '18:30', timeZone: 'America/New_York', days: [0,1,2,3,4,5,6], itemIds: names },
    now, expected: expected ? [new Date(expected).toISOString()] : []
  };
}
const cases = [];
for (const resetDay of [0, 1]) {
  const earlyCheck = { done: true, reminderCheckedAt: '2026-11-21T22:00:00Z', reminderSkipToday: true };
  cases.push(
    weeklyCase(6, '2026-11-21T23:30:00Z', null, earlyCheck, resetDay),
    weeklyCase(6, '2026-11-21T23:55:00Z', null, earlyCheck, resetDay),
    weeklyCase(6, '2026-11-28T23:30:00Z', '2026-11-28T23:30:00Z', earlyCheck, resetDay),
    weeklyCase(6, '2026-11-21T23:30:00Z', '2026-11-21T23:30:00Z', { done: false, reminderCheckedAt: null, reminderSkipToday: false }, resetDay)
  );
  for (let day = 0; day < 7; day++) {
    // Saturday evening: only Saturday can follow up, even though UTC is Sunday.
    cases.push(weeklyCase(day, '2026-11-22T02:46:00Z', day === 6 ? '2026-11-22T02:25:00Z' : null, {}, resetDay));
    cases.push(weeklyCase(day, '2026-11-22T02:46:00Z', null,
      { done: true, reminderCheckedAt: '2026-11-21T22:00:00Z' }, resetDay));
    // Clearing the weekly checkmarks never sends a backlog of weekday alerts.
    cases.push(weeklyCase(day, '2026-11-22T05:00:00Z', null, {}, resetDay));
    cases.push(weeklyCase(day, '2026-11-22T23:35:00Z', day === 0 ? '2026-11-22T23:30:00Z' : null, {}, resetDay));
  }
}
cases.push(
  weeklyCase(6, '2026-11-22T04:59:59Z', '2026-11-22T04:55:00Z'),
  weeklyCase(5, '2026-11-21T17:00:00Z', null, { reminderFollowUpMinutes: null }),
  // A stale per-item weekday must not turn another row into a Saturday reminder.
  weeklyCase(2, '2026-11-22T02:46:00Z', null, { reminderDays: [6] }),
  weeklyCase(6, '2026-11-22T02:46:00Z', null, { done: true, reminderCheckedAt: '2026-11-22T02:30:00Z' }),
  weeklyCase(0, '2026-11-02T04:59:59Z', '2026-11-02T04:55:00Z', { reminderAt: '2026-10-31T22:30:00Z' }),
  weeklyCase(0, '2026-11-02T05:00:00Z', null, { reminderAt: '2026-10-31T22:30:00Z' }),
  weeklyCase(0, '2030-03-11T03:59:59Z', '2030-03-11T03:55:00Z', { reminderAt: '2030-03-09T23:30:00Z' }),
  weeklyCase(0, '2030-03-11T04:00:00Z', null, { reminderAt: '2030-03-09T23:30:00Z' })
);
module.exports = { cases };
