migrate((app) => {
  const settings = app.settings()
  const rateLimits = settings.rateLimits || {}
  const existingRules = []
  const configuredRules = rateLimits.rules
  if (configuredRules && typeof configuredRules.length === "number") {
    for (let index = 0; index < configuredRules.length; index += 1) {
      existingRules.push(configuredRules[index])
    }
  }
  const existingLabels = {}
  for (let index = 0; index < existingRules.length; index += 1) {
    const rule = existingRules[index]
    if (rule && typeof rule.label === "string") {
      existingLabels[rule.label] = true
    }
  }
  const defaultRules = [
    { label: "*:auth", audience: "", duration: 3, maxRequests: 2 },
    { label: "*:create", audience: "", duration: 5, maxRequests: 20 },
    { label: "/api/batch", audience: "", duration: 1, maxRequests: 3 },
    { label: "/api/", audience: "", duration: 10, maxRequests: 300 },
  ]

  for (let index = 0; index < defaultRules.length; index += 1) {
    const rule = defaultRules[index]
    if (!existingLabels[rule.label]) {
      existingRules.push(rule)
    }
  }

  rateLimits.enabled = true
  rateLimits.rules = existingRules
  settings.rateLimits = rateLimits
  app.save(settings)
}, () => {
  // Intentionally do not disable rate limiting during rollback.
})


