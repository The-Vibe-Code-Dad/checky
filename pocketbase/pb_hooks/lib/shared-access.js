function updateAccess(app, listId, userId, add) {
  if (!listId) return
  let list
  try { list = app.findRecordById('shared_checklists', listId) } catch (_) { return }
  if (list.getString('owner') === userId) return
  const members = Array.from(list.getStringSlice('sharedWith'))
  const next = members.filter(id => id !== userId)
  if (add) next.push(userId)
  if (JSON.stringify(members) !== JSON.stringify(next)) {
    list.set('sharedWith', next)
    app.save(list)
  }
}
function save(e, creating) {
  const originalApp = e.app
  try {
    return originalApp.runInTransaction(tx => {
      const previous = creating ? '' : tx.findRecordById('users', e.record.id).getString('assignedSharedChecklist')
      const next = e.record.getString('assignedSharedChecklist')
      e.app = tx
      e.next()
      // Capture the stored relation before saving, using the current transaction.
      if (previous && previous !== next) updateAccess(tx, previous, e.record.id, false)
      if (next) updateAccess(tx, next, e.record.id, true)
    })
  } finally { e.app = originalApp }
}
module.exports = { save }
