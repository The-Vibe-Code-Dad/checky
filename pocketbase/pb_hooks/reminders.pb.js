routerAdd('GET', '/api/checkys-base/push', (e) => {
  return require(__hooks + '/lib/reminders.js').status(e)
})
routerAdd('POST', '/api/checkys-base/push', (e) => {
  return require(__hooks + '/lib/reminders.js').subscribe(e)
})
routerAdd('DELETE', '/api/checkys-base/push', (e) => {
  return require(__hooks + '/lib/reminders.js').unsubscribe(e)
})
cronAdd('checky-event-reminders', '* * * * *', () => {
  require(__hooks + '/lib/reminders.js').deliver($app)
})
