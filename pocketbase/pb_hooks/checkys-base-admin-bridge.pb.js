routerUse(new Middleware((e) => {
  // Do not catch e.next(): downstream failures must retain their actual status.
  if (e.request.url.path.startsWith('/api/')) require(__hooks + '/lib/hosted-auth.js').loadCookie(e)
  return e.next()
}, -1021))
routerAdd('GET', '/api/checkys-base/session', (e) => {
  e.response.header().set('Cache-Control', 'no-store')
  return e.json(200, require(__hooks + '/lib/hosted-auth.js').snapshot(e))
})
routerAdd('POST', '/api/checkys-base/session/login', (e) => {
  e.response.header().set('Cache-Control', 'no-store')
  return e.json(200, require(__hooks + '/lib/hosted-auth.js').login(e))
})
routerAdd('POST', '/api/checkys-base/session/logout', (e) => {
  e.response.header().set('Cache-Control', 'no-store')
  return e.json(200, require(__hooks + '/lib/hosted-auth.js').logout(e))
})
routerAdd('POST', '/api/checkys-base/first-user', (e) => {
  e.response.header().set('Cache-Control', 'no-store')
  return e.json(200, require(__hooks + '/lib/hosted-auth.js').bootstrap(e))
})
onBootstrap((e) => {
  e.next()
  if ($os.getenv('CHECKY_TRUST_PROXY') === 'true') {
    const settings = e.app.settings()
    settings.trustedProxy.headers = ['X-Checky-Client-IP']
    settings.trustedProxy.useLeftmostIP = false
    e.app.save(settings)
  }
})
