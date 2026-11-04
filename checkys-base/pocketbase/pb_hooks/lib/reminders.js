const SUBS = 'checky_push_subscriptions'
const DELIVERIES = 'checky_push_deliveries'
function auth(e) {
  if (!e.auth || e.auth.collection().name !== 'users') throw new UnauthorizedError('Sign in to manage reminders.')
  require(__hooks + '/lib/hosted-auth.js').requireSameOrigin(e)
  e.response.header().set('Cache-Control', 'no-store')
}
function transport(path, body) {
  const token = $os.getenv('CHECKY_PUSH_TOKEN')
  if (!token) return { statusCode: 503, json: { error: 'Install the current Checky Docker image to enable web reminders.' } }
  return $http.send({ url: 'http://127.0.0.1:' + ($os.getenv('CHECKY_PUSH_PORT') || '8091') + path,
    method: body ? 'POST' : 'GET', headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : '', timeout: 12 })
}
function status(e) {
  auth(e)
  const result = transport('/status')
  return e.json(result.statusCode, result.json)
}
function sessionKey(e) {
  try { return $security.sha256(e.request.cookie('checky_base_session').value) } catch (_) { return '' }
}
function subscribe(e) {
  auth(e)
  const result = transport('/validate', { subscription: e.requestInfo().body.subscription })
  if (result.statusCode !== 200) return e.json(result.statusCode, result.json)
  const subscription = result.json.subscription
  const hash = $security.sha256(subscription.endpoint)
  e.app.runInTransaction((tx) => {
    let record
    try { record = tx.findFirstRecordByData(SUBS, 'endpointHash', hash) } catch (_) {}
    if (record && record.getString('user') !== e.auth.id) {
      // An explicit enable transfers this browser endpoint to its current account.
      tx.delete(record)
      record = null
    }
    if (!record) {
      if (tx.countRecords(SUBS, $dbx.exp('user = {:user}', { user: e.auth.id })) >= 20) throw new BadRequestError('This account already has 20 notification devices.')
      record = new Record(tx.findCollectionByNameOrId(SUBS))
      record.set('enabledAt', new Date().toISOString())
    }
    record.set('user', e.auth.id)
    record.set('endpointHash', hash)
    record.set('subscription', subscription)
    record.set('credentialStamp', require(__hooks + '/lib/hosted-auth.js').stamp(e.auth))
    record.set('sessionKey', sessionKey(e))
    tx.save(record)
  })
  return e.json(200, { ok: true })
}
function unsubscribe(e) {
  auth(e)
  const endpoint = e.requestInfo().body.endpoint
  if (typeof endpoint !== 'string' || endpoint.length > 2048) throw new BadRequestError('A subscription endpoint is required.')
  for (const record of e.app.findRecordsByFilter(SUBS, 'user = {:user} && endpointHash = {:hash}', '', 0, 0,
    { user: e.auth.id, hash: $security.sha256(endpoint) })) e.app.delete(record)
  return e.json(200, { ok: true })
}
function logout(e) {
  const key = sessionKey(e)
  if (!key) return
  for (const record of e.app.findRecordsByFilter(SUBS, 'sessionKey = {:key}', '', 0, 0, { key })) e.app.delete(record)
}
function dueItems(data, now, enabledAt) {
  const due = []
  for (const tab of data?.tabs || []) {
    if (tab.system === 'done') continue
    for (const item of tab.items || []) {
      if (!item?.id || item.done || typeof item.reminderAt !== 'string') continue
      const at = item.reminderRepeat && item.reminderRepeat !== 'none'
        ? require(__hooks + '/lib/reminder-schedule.js').latestOccurrence(item, now)
        : Date.parse(item.reminderAt)
      if (!item?.id || item.done || !Number.isFinite(at) || at > now || at < enabledAt || at < now - 86400000) continue
      due.push({ id: item.id, at: new Date(at).toISOString(), text: String(item.text || 'Checklist event').slice(0, 160), tab: String(tab.name || '').slice(0, 120) })
    }
  }
  return due
}
function queryValue(value) {
  // Preserve emoji and replace only unpaired UTF-16 surrogates from imported JSON.
  return encodeURIComponent(value.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g, part => part.length === 2 ? part : '\uFFFD'))
}
function deliver(app) {
  if (!$os.getenv('CHECKY_PUSH_TOKEN')) return
  if (require(__hooks + '/lib/deployment-config.js').read(app).remindersEnabled === false) return
  const start = Date.now()
  // A bounded lease prevents overlapping cron executions from duplicating sends.
  if (Number(app.store().get('checkyPushRunningUntil') || 0) > start) return
  app.store().set('checkyPushRunningUntil', start + 120000)
  try {
    for (const old of app.findRecordsByFilter(DELIVERIES, 'dueAt < {:cutoff}', '', 0, 0, { cutoff: new Date(start - 2 * 86400000).toISOString() })) app.delete(old)
    for (const sub of app.findRecordsByFilter(SUBS, '', '', 0, 0)) {
      if (Date.now() - start > 45000) break
      let user
      try { user = app.findRecordById('users', sub.getString('user')) } catch (_) { app.delete(sub); continue }
      const info = new RequestInfo({ auth: user, method: 'GET' })
      if (sub.getString('credentialStamp') !== require(__hooks + '/lib/hosted-auth.js').stamp(user) ||
          !app.canAccessRecord(user, info, user.collection().authRule)) { app.delete(sub); continue }
      let gone = false
      for (const collection of ['checklists', 'shared_checklists']) {
        const filter = collection === 'checklists' ? 'owner = {:user}' : 'owner = {:user} || sharedWith.id ?= {:user}'
        for (const list of app.findRecordsByFilter(collection, filter, '', 0, 0, { user: user.id })) {
          if (!app.canAccessRecord(list, info, list.collection().viewRule)) continue
          const data = require(__hooks + '/lib/checklist-limits.js').normalizeChecklistPayload(list.get('data'))
          for (const item of dueItems(data, start, Date.parse(sub.getString('enabledAt')))) {
            if (Date.now() - start > 45000) return
            const eventKey = $security.sha256(JSON.stringify([collection, list.id, item.id, item.at]))
            let delivery
            app.runInTransaction((tx) => {
              try { delivery = tx.findFirstRecordByFilter(DELIVERIES, 'subscription = {:sub} && eventKey = {:key}', { sub: sub.id, key: eventKey }) } catch (_) {}
              if (delivery && (delivery.getBool('sent') || Date.parse(delivery.getString('retryAt')) > Date.now())) { delivery = null; return }
              if (!delivery) {
                delivery = new Record(tx.findCollectionByNameOrId(DELIVERIES))
                delivery.set('subscription', sub.id)
                delivery.set('eventKey', eventKey)
                delivery.set('dueAt', item.at)
              }
              const attempts = delivery.getInt('attempts') + 1
              delivery.set('attempts', attempts)
              delivery.set('retryAt', new Date(Date.now() + Math.min(3600000, 60000 * Math.pow(2, Math.min(attempts, 6)))).toISOString())
              tx.save(delivery)
            })
            if (!delivery) continue
            let result
            try {
              result = transport('/send', { subscription: JSON.parse(sub.getString('subscription')), payload: {
                title: "Checky's List reminder", body: item.text, tag: eventKey,
                url: '/?reminder=' + encodeURIComponent(collection + ':' + list.id) + '&tab=' + queryValue(item.tab)
              } })
            } catch (_) { continue }
            if (result.json?.gone) { app.delete(sub); gone = true; break }
            if (result.statusCode === 200 && result.json?.ok) { delivery.set('sent', true); app.save(delivery) }
          }
          if (gone) break
        }
        if (gone) break
      }
    }
  } finally { app.store().set('checkyPushRunningUntil', 0) }
}
module.exports = { status, subscribe, unsubscribe, logout, deliver, dueItems }
