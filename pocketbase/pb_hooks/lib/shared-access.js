function updateAccess(app, listId, userId, add) {
  if (!listId) return
  let list
  try { list = app.findRecordById('shared_checklists', listId) } catch (_) { return }
  if (list.getString('owner') === userId) return
  const members = Array.from(list.getStringSlice('sharedWith'))
  if (members.includes(userId) === add) return
  list.set('sharedWith', add ? members.concat(userId) : members.filter(id => id !== userId))
  app.save(list)
}
function inTransaction(e, work) {
  const app = e.app
  try {
    return app.runInTransaction(tx => {
      e.app = tx
      return work(tx)
    })
  } finally { e.app = app }
}
function save(e, creating) {
  const next = e.record.getString('assignedSharedChecklist')
  if (!creating) e.record.ignoreUnchangedFields(true)
  const original = creating ? '' : e.record.original().getString('assignedSharedChecklist')
  if (original === next) return e.next()

  return inTransaction(e, tx => {
    const previous = creating ? '' : tx.findRecordById('users', e.record.id).getString('assignedSharedChecklist')
    e.next()
    if (previous === next) return
    updateAccess(tx, previous, e.record.id, false)
    updateAccess(tx, next, e.record.id, true)
  })
}
function sameAccess(before, after) {
  if (before.getString('owner') !== after.getString('owner')) return false
  const previous = Array.from(before.getStringSlice('sharedWith'))
  const current = Array.from(after.getStringSlice('sharedWith'))
  return previous.length === current.length && previous.every((id, i) => id === current[i])
}
function clearRevokedAssignments(e) {
  const record = e.record
  if (sameAccess(record.original(), record)) return e.next()
  return inTransaction(e, tx => {
    e.next()
    const list = tx.findRecordById('shared_checklists', record.id)
    const members = new Set(list.getStringSlice('sharedWith'))
    members.add(list.getString('owner'))
    const assigned = tx.findRecordsByFilter('users', 'assignedSharedChecklist = {:list}', '', 0, 0, { list: list.id })
    for (const user of assigned) {
      if (members.has(user.id)) continue
      user.set('assignedSharedChecklist', '')
      tx.save(user)
    }
  })
}
module.exports = { save, sameAccess, clearRevokedAssignments }
