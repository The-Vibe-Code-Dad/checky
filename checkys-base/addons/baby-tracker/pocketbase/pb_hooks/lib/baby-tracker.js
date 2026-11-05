const COLLECTION = 'checky_baby_entries'
const LISTS = 'checky_baby_lists'
function auth(e) {
  e.response.header().set('Cache-Control', 'no-store')
  if (!e.auth || e.auth.collection().name !== 'users') throw new UnauthorizedError('Sign in to open the baby tracker.')
  require(__hooks + '/lib/hosted-auth.js').requireSameOrigin(e)
}
function isAdmin(app, user) {
  try { return app.findFirstRecordByData('checky_base_admins', 'key', 'primary').getString('user') === user.id } catch (_) { return false }
}
function requireAdmin(app, e) {
  if (!isAdmin(app, e.auth)) throw new ForbiddenError('Only the Checky admin can manage baby lists and caregivers.')
}
function parent(app, e, ref) {
  const match = /^checky_baby_lists:([a-z0-9]{15})$/.exec(String(ref || ''))
  if (!match) throw new BadRequestError('Choose a baby list assigned by your admin.')
  let record
  try { record = app.findRecordById(LISTS, match[1]) } catch (_) { throw new NotFoundError('This baby list is unavailable.') }
  if (!isAdmin(app, e.auth) && !Array.from(record.getStringSlice('members')).includes(e.auth.id)) throw new NotFoundError('This baby list is unavailable. Ask your admin to add you.')
  return { record, field: 'babyList', ref: match[0] }
}
function entryParent(record) { return LISTS + ':' + record.getString('babyList') }
function serializeList(record, admin) {
  const item = { ref: LISTS + ':' + record.id, name: record.getString('name'), writable: true }
  if (admin) { item.version = record.getInt('version'); item.members = Array.from(record.getStringSlice('members')) }
  return item
}
function lists(e) {
  auth(e)
  const admin = isAdmin(e.app, e.auth)
  const records = e.app.findRecordsByFilter(LISTS, admin ? '' : 'members.id ?= {:user}', 'name,id', 0, 0, { user: e.auth.id })
  return e.json(200, { items: records.map(record => serializeList(record, admin)), canManage: admin })
}
function users(e) {
  auth(e); requireAdmin(e.app, e)
  return e.json(200, { items: e.app.findRecordsByFilter('users', '', 'email,id', 0, 0).map(record => ({ id: record.id, email: record.getString('email') })) })
}
function saveList(e, creating) {
  auth(e); requireAdmin(e.app, e)
  const body = e.requestInfo().body || {}
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name || name.length > 120 || /[\u0000-\u001F\u007F]/.test(name)) throw new BadRequestError('Enter a baby list name of 1–120 characters.')
  if (!Array.isArray(body.members) || body.members.length > 1000 || body.members.some(id => typeof id !== 'string' || !/^[a-z0-9]{15}$/.test(id))) throw new BadRequestError('Choose valid Checky users.')
  const members = [...new Set(body.members)]
  let result
  e.app.runInTransaction(app => {
    requireAdmin(app, e)
    for (const id of members) {
      try { app.findRecordById('users', id) } catch (_) { throw new BadRequestError('One of these users no longer exists. Reopen the list and try again.') }
    }
    let record
    if (creating) record = new Record(app.findCollectionByNameOrId(LISTS))
    else {
      try { record = app.findRecordById(LISTS, e.request.pathValue('id')) } catch (_) { throw new NotFoundError('This baby list is unavailable.') }
      if (record.getInt('version') !== body.version) throw new ApiError(409, 'This baby list changed. Reopen it before saving caregivers again.')
    }
    record.set('name', name); record.set('members', members); record.set('version', creating ? 1 : record.getInt('version') + 1)
    app.save(record); result = serializeList(record, true)
  })
  return e.json(200, result)
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
    const scope = parent(app, e, body.list)
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
    parent(app, e, entryParent(record))
    if (body.version !== record.getInt('version')) throw new ApiError(409, 'Another caregiver changed this entry. Cancel and refresh the log before editing it again.')
    if (deleting) { app.delete(record); saved = { ok: true }; return }
    record.set('occurredAt', data.occurredAt); record.set('data', data); record.set('version', body.version + 1)
    app.save(record); saved = serialize(record)
  })
  return e.json(200, saved)
}
module.exports = { status: e => { auth(e); return e.json(200, { installed: true }) }, lists, users, createList: e => saveList(e, true), updateList: e => saveList(e, false), list, create, update: e => mutate(e, false), remove: e => mutate(e, true) }
