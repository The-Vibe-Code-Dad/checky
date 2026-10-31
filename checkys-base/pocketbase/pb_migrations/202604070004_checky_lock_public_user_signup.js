migrate((app) => {
  let users

  try {
    users = app.findCollectionByNameOrId("users")
  } catch {
    return
  }

  users.createRule = null
  app.save(users)
}, (app) => {
  let users

  try {
    users = app.findCollectionByNameOrId("users")
  } catch {
    return
  }

  users.createRule = ""
  app.save(users)
})
