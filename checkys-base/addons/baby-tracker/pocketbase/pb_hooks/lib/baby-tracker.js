const COLLECTION = 'checky_baby_entries'
function auth(e) {
  e.response.header().set('Cache-Control', 'no-store')
  if (!e.auth || e.auth.collection().name !== 'users') throw new UnauthorizedError('Sign in to open the baby tracker.')
  require(__hooks + '/lib/hosted-auth.js').requireSameOrigin(e)
}
function canUse(app, e, record, write) {
  const info = e.requestInfo()
  // Checklist update rules also require a newer JSON version. Evaluate the
  // equivalent update request without changing the parent checklist itself.
  info.body = write ? { version: record.getInt('version') + 1 } : {}
  info.method = write ? 'PATCH' : 'GET'
  return app.canAccessRecord(record, info, write ? record.collection().updateRule : record.collection().viewRule)
}
function parent(app, e, ref, write = false) {
  const match = /^(checklists|shared_checklists):([a-z0-9]{15})$/.exec(String(ref || ''))
  if (!match) throw new BadRequestError('Choose a personal or shared list.')
  let record
  try { record = app.findRecordById(match[1], match[2]) } catch (_) { throw new NotFoundError('This list is unavailable.') }
  if (!canUse(app, e, record, write)) throw new NotFoundError('This list is unavailable.')
  return { record, field: match[1] === 'checklists' ? 'personalChecklist' : 'sharedChecklist', ref: match[0] }
}
function entryParent(record) {
  return record.getString('personalChecklist') ? 'checklists:' + record.getString('personalChecklist') : 'shared_checklists:' + record.getString('sharedChecklist')
}
function payload(value) {
  const data = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const at = typeof data.occurredAt === 'string' ? Date.parse(data.occurredAt) : NaN
  if (!Number.isFinite(at) || at < Date.UTC(1900, 0, 1) || at >= Date.UTC(10000, 0, 1)) throw new BadRequestError('Enter a valid date and time.')
  const clean = { occurredAt: new Date(at).toISOString() }
  for (const key of ['breastMilkMl', 'formulaMl']) {
    const value = data[key]
    if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 10000)) throw new BadRequestError('Amounts must be between 0 and 10,000 ml.')
    clean[key] = value
  }
  for (const key of ['feedingNotes', 'peeNotes', 'poopNotes']) {
    if (typeof data[key] !== 'string' || data[key].length > 2000) throw new BadRequestError('Each note must be 2,000 characters or fewer.')
    clean[key] = data[key].replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
  }
  for (const key of ['pee', 'poop']) {
    if (typeof data[key] !== 'boolean') throw new BadRequestError('Pee and poop must be checkboxes.')
    clean[key] = data[key]
  }
  if (clean.breastMilkMl === null && clean.formulaMl === null && !clean.pee && !clean.poop && ![clean.feedingNotes, clean.peeNotes, clean.poopNotes].some(note => note.trim())) throw new BadRequestError('Add a feeding amount, diaper check or note.')
  return clean
}
function serialize(record) {
  return { id: record.id, version: record.getInt('version'), entry: JSON.parse(record.getString('data')) }
}
function lists(e) {
  auth(e)
  const items = []
  for (const collection of ['checklists', 'shared_checklists']) {
    const filter = collection === 'checklists' ? 'owner = {:user}' : 'owner = {:user} || sharedWith.id ?= {:user}'
    for (const record of e.app.findRecordsByFilter(collection, filter, 'name,id', 0, 0, { user: e.auth.id })) {
      if (!canUse(e.app, e, record, false)) continue
      items.push({ ref: collection + ':' + record.id, name: record.getString('name') || (collection === 'checklists' ? 'Personal' : 'Shared'),
        shared: collection === 'shared_checklists', writable: canUse(e.app, e, record, true) })
    }
  }
  const assigned = e.auth.getString('assignedSharedChecklist')
  const preferred = assigned ? 'shared_checklists:' + assigned : 'checklists:' + e.auth.getString('defaultChecklist')
  return e.json(200, { items, preferred })
}
function list(e) {
  auth(e)
  const query = e.request.url.query()
  const scope = parent(e.app, e, query.get('list'))
  let filter = scope.field + ' = {:list}'
  const params = { list: scope.record.id }
  const cursor = query.get('before')
  if (cursor) {
    let previous
    try { previous = e.app.findRecordById(COLLECTION, cursor) } catch (_) { throw new BadRequestError('Refresh the log to load more entries.') }
    if (entryParent(previous) !== scope.ref) throw new BadRequestError('Refresh the log to load more entries.')
    filter += ' && (occurredAt < {:at} || (occurredAt = {:at} && id < {:id}))'
    params.at = previous.getString('occurredAt'); params.id = previous.id
  }
  const records = e.app.findRecordsByFilter(COLLECTION, filter, '-occurredAt,-id', 51, 0, params)
  return e.json(200, { items: records.slice(0, 50).map(serialize), more: records.length > 50 })
}
function create(e) {
  auth(e)
  const body = e.requestInfo().body || {}
  const data = payload(body.entry)
  if (typeof body.requestId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(body.requestId)) throw new BadRequestError('A save identifier is required.')
  let saved
  e.app.runInTransaction(app => {
    const scope = parent(app, e, body.list, true)
    let record
    try { record = app.findFirstRecordByData(COLLECTION, 'requestId', body.requestId) } catch (_) {}
    if (record) {
      const stored = JSON.parse(record.getString('data'))
      if (entryParent(record) !== scope.ref || record.getString('createdBy') !== e.auth.id || Object.keys(data).some(key => stored[key] !== data[key])) throw new ApiError(409, 'This save already completed. Refresh the log before adding another entry.')
    } else {
      record = new Record(app.findCollectionByNameOrId(COLLECTION))
      record.set(scope.field, scope.record.id); record.set('createdBy', e.auth.id)
      record.set('requestId', body.requestId); record.set('occurredAt', data.occurredAt)
      record.set('data', data); record.set('version', 1)
      app.save(record)
    }
    saved = serialize(record)
  })
  return e.json(200, saved)
}
function mutate(e, deleting) {
  auth(e)
  const body = e.requestInfo().body || {}
  const data = deleting ? null : payload(body.entry)
  let saved
  e.app.runInTransaction(app => {
    let record
    try { record = app.findRecordById(COLLECTION, e.request.pathValue('id')) } catch (_) { throw new NotFoundError('This entry is unavailable.') }
    parent(app, e, entryParent(record), true)
    if (body.version !== record.getInt('version')) throw new ApiError(409, 'Another caregiver changed this entry. Cancel and refresh the log before editing it again.')
    if (deleting) { app.delete(record); saved = { ok: true }; return }
    record.set('occurredAt', data.occurredAt); record.set('data', data); record.set('version', body.version + 1)
    app.save(record); saved = serialize(record)
  })
  return e.json(200, saved)
}
module.exports = { status: e => { auth(e); return e.json(200, { installed: true }) }, lists, list, create, update: e => mutate(e, false), remove: e => mutate(e, true) }
