migrate((app) => {
  const users = app.findCollectionByNameOrId("users")
  const personal = app.findCollectionByNameOrId("checklists")
  const shared = app.findCollectionByNameOrId("shared_checklists")
  // getByName returns null for absent fields; older migrations only handled thrown errors.
  for (const pair of [["defaultChecklist", personal.id], ["assignedSharedChecklist", shared.id]]) {
    if (!users.fields.getByName(pair[0])) users.fields.add(new RelationField({ name: pair[0], maxSelect: 1, collectionId: pair[1] }))
  }
  app.save(users)
  for (const collection of [personal, shared]) {
    collection.fields.getByName("data").maxSize = 10 * 1024 * 1024
    app.save(collection)
  }
  const settings = app.findCollectionByNameOrId("checky_base_settings")
  for (const name of ["perUserChecklistSizePreset", "databaseChecklistSizePreset"]) {
    if (!settings.fields.getByName(name)) settings.fields.add(new SelectField({ name, values: ["small", "medium", "large"], maxSelect: 1 }))
  }
  app.save(settings)
  const limits = app.findFirstRecordByData(settings.id, "key", "default")
  for (const name of ["perUserChecklistSizePreset", "databaseChecklistSizePreset"]) {
    if (!limits.getString(name)) limits.set(name, limits.getString("checklistSizePreset") || "small")
  }
  app.save(limits)
  const sessions = app.findCollectionByNameOrId("checky_base_sessions")
  if (!sessions.fields.getByName("credentialStamp")) sessions.fields.add(new TextField({ name: "credentialStamp", max: 64 }))
  app.save(sessions)
  // Existing cookies lack a stamp and must sign in once after upgrading.
  for (const user of app.findRecordsByFilter("users", "defaultChecklist = ''", "", 0, 0)) {
    try {
      const list = app.findFirstRecordByFilter("checklists", "owner = {:id}", { id: user.id })
      user.set("defaultChecklist", list.id)
      app.save(user)
    } catch (_) {}
  }
}, () => { /* Security fields and repaired relations are intentionally retained. */ })
