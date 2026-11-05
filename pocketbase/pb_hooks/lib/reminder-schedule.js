// Calendar recurrence runs in PocketBase, using its IANA timezone support.
// Always calculate from the original date so Jan 31 -> Feb 28 -> Mar 31.
function latestOccurrence(item, now) {
  const first = Date.parse(item.reminderAt)
  if (!Number.isFinite(first) || first > now) return NaN
  const repeat = item.reminderRepeat
  if (!repeat || repeat === 'none') return first
  if (!['daily', 'weekly', 'monthly', 'yearly'].includes(repeat)) return NaN
  const zoneName = item.reminderTimeZone
  if (typeof zoneName !== 'string' || !zoneName || zoneName.length > 120 || zoneName === 'Local') return NaN
  try {
    const zone = new Timezone(zoneName)
    // PocketBase falls back to UTC for an invalid timezone; do not silently shift it.
    if (zone.string() !== zoneName) return NaN
    const anchor = new DateTime(new Date(first).toISOString()).time().in(zone)
    const current = new DateTime(new Date(now).toISOString()).time().in(zone)
    const year = anchor.year(), month = Number(anchor.month()), day = anchor.day()
    const anchorDay = Date.UTC(year, month - 1, day)
    const currentDay = Date.UTC(current.year(), Number(current.month()) - 1, current.day())
    // Weekly schedules can select several weekdays. Older schedules use the
    // original date's weekday; an explicitly empty/invalid selection sends nothing.
    if (repeat === 'weekly' && item.reminderDays != null) {
      if (!Array.isArray(item.reminderDays) || !item.reminderDays.length ||
          item.reminderDays.some(day => !Number.isInteger(day) || day < 0 || day > 6)) return NaN
      const clock = anchor.format('15:04:05.000')
      // Eight days covers the previous weekly occurrence and a skipped DST time.
      for (let offset = 0; offset <= 7; offset++) {
        const date = new Date(currentDay - offset * 86400000)
        if (date.getTime() < anchorDay) break
        if (!item.reminderDays.includes(date.getUTCDay())) continue
        if (date.getTime() === anchorDay) return first
        const wallTime = date.toISOString().slice(0, 10) + ' ' + clock
        const occurrence = new DateTime(wallTime, zoneName).time()
        if (occurrence.in(zone).format('2006-01-02 15:04:05.000') !== wallTime) continue
        const at = occurrence.unixMilli()
        if (at >= first && at <= now) return at
      }
      return NaN
    }
    let index
    if (repeat === 'daily' || repeat === 'weekly') index = Math.floor((currentDay - anchorDay) / (86400000 * (repeat === 'weekly' ? 7 : 1)))
    else if (repeat === 'monthly') index = (current.year() - year) * 12 + Number(current.month()) - month
    else index = current.year() - year
    const clock = anchor.format('15:04:05.000')
    // Only the most recent occurrence is eligible; never flood a returning device
    // with an entire missed series. Two earlier dates also cover a skipped DST day.
    for (let n = index; n >= Math.max(0, index - 2); n--) {
      if (n === 0) return first
      let date
      if (repeat === 'daily' || repeat === 'weekly') {
        date = new Date(anchorDay + n * 86400000 * (repeat === 'weekly' ? 7 : 1))
      } else {
        date = new Date(Date.UTC(year + (repeat === 'yearly' ? n : 0), month - 1 + (repeat === 'monthly' ? n : 0), 1))
        const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
        date.setUTCDate(Math.min(day, lastDay))
      }
      const wallTime = date.toISOString().slice(0, 10) + ' ' + clock
      const occurrence = new DateTime(wallTime, zoneName).time()
      // A nonexistent local time during spring-forward is skipped. Fall-back
      // selects one deterministic instant, which has one delivery key.
      if (occurrence.in(zone).format('2006-01-02 15:04:05.000') !== wallTime) continue
      const at = occurrence.unixMilli()
      if (at >= first && at <= now) return at
    }
  } catch (_) { /* Invalid imported schedules must not stop other reminders. */ }
  return NaN
}
function nextOccurrence(item, after) {
  const first = Date.parse(item.reminderAt)
  if (!Number.isFinite(first) || !Number.isFinite(after) || !['daily', 'weekly', 'monthly', 'yearly'].includes(item.reminderRepeat)) return NaN
  try {
    const name = item.reminderTimeZone, zone = new Timezone(name)
    if (!name || name === 'Local' || zone.string() !== name) return NaN
    const anchor = new DateTime(new Date(first).toISOString()).time().in(zone)
    const current = new DateTime(new Date(Math.max(first, after)).toISOString()).time().in(zone)
    const year = anchor.year(), month = Number(anchor.month()), day = anchor.day(), repeat = item.reminderRepeat
    const anchorDay = Date.UTC(year, month - 1, day)
    const currentDay = Date.UTC(current.year(), Number(current.month()) - 1, current.day())
    const clock = anchor.format('15:04:05.000')
    function instant(date) {
      if (date.getTime() === anchorDay) return first
      const wall = date.toISOString().slice(0, 10) + ' ' + clock
      const time = new DateTime(wall, name).time()
      return time.in(zone).format('2006-01-02 15:04:05.000') === wall ? time.unixMilli() : NaN
    }
    if (repeat === 'daily' || repeat === 'weekly') {
      const days = item.reminderDays == null ? [new Date(anchorDay).getUTCDay()] : item.reminderDays
      if (repeat === 'weekly' && (!Array.isArray(days) || !days.length || days.some(day => !Number.isInteger(day) || day < 0 || day > 6))) return NaN
      for (let offset = 0; offset <= 14; offset++) {
        const date = new Date(currentDay + offset * 86400000)
        if (repeat === 'weekly' && !days.includes(date.getUTCDay())) continue
        const at = instant(date)
        if (at >= first && at > after) return at
      }
    } else {
      const index = repeat === 'monthly' ? (current.year() - year) * 12 + Number(current.month()) - month : current.year() - year
      for (let n = Math.max(0, index); n <= index + 2; n++) {
        const date = new Date(Date.UTC(year + (repeat === 'yearly' ? n : 0), month - 1 + (repeat === 'monthly' ? n : 0), 1))
        date.setUTCDate(Math.min(day, new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()))
        const at = instant(date)
        if (at >= first && at > after) return at
      }
    }
  } catch (_) {}
  return NaN
}
module.exports = { latestOccurrence, nextOccurrence }
