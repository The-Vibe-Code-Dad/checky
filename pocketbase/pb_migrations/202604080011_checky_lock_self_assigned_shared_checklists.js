migrate((app) => {
  let users

  try {
    users = app.findCollectionByNameOrId("users")
  } catch {
    return
  }

  users.updateRule = "id = @request.auth.id && @request.body.assignedSharedChecklist:isset = false"
  app.save(users)
}, (app) => {
  let users

  try {
    users = app.findCollectionByNameOrId("users")
  } catch {
    return
  }

  users.updateRule = "id = @request.auth.id"
  app.save(users)
})
