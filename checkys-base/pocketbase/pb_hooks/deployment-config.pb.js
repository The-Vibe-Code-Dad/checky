onBootstrap((e) => {
  e.next()
  require(__hooks + '/lib/deployment-config.js').ensure(e.app)
})
