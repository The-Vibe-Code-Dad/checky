migrate((app) => {
  const APP_ADMINS_COLLECTION = "checky_base_admins"
  const PRIMARY_APP_ADMIN_KEY = "primary"

  function getCreatedSortKey(record) {
    if (!record || typeof record.get !== "function") {
      return ""
    }

    try {
      const value = record.get("created")
      return typeof value === "string" ? value : ""
    } catch {
      return ""
    }
  }

  function findOldestUserRecord() {
    let userRecords = []

    try {
      userRecords = app.findRecordsByFilter("users", "", "", 0, 0)
    } catch {
      userRecords = []
    }

    if (!Array.isArray(userRecords) || userRecords.length <= 0) {
      return null
    }

    userRecords.sort((a, b) => {
      const aCreated = getCreatedSortKey(a)
      const bCreated = getCreatedSortKey(b)
      const aId = typeof a?.id === "string" ? a.id : ""
      const bId = typeof b?.id === "string" ? b.id : ""

      if (aCreated < bCreated) {
        return -1
      }

      if (aCreated > bCreated) {
        return 1
      }

      if (aId < bId) {
        return -1
      }

      if (aId > bId) {
        return 1
      }

      return 0
    })

    return userRecords[0] || null
  }

  let usersCollection

  try {
    usersCollection = app.findCollectionByNameOrId("users")
  } catch {
    return
  }

  let appAdminsCollection

  try {
    appAdminsCollection = app.findCollectionByNameOrId(APP_ADMINS_COLLECTION)
  } catch {
    appAdminsCollection = new Collection({
      type: "base",
      name: APP_ADMINS_COLLECTION,
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        {
          type: "text",
          name: "key",
          required: true,
          max: 80,
          presentable: true,
        },
        {
          type: "relation",
          name: "user",
          required: true,
          maxSelect: 1,
          collectionId: usersCollection.id,
        },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_checky_base_admins_key ON checky_base_admins (key)",
      ],
    })
    app.save(appAdminsCollection)
  }

  try {
    app.findFirstRecordByData(APP_ADMINS_COLLECTION, "key", PRIMARY_APP_ADMIN_KEY)
    return
  } catch {}

  const oldestUserRecord = findOldestUserRecord()
  if (!oldestUserRecord || typeof oldestUserRecord.id !== "string" || !oldestUserRecord.id) {
    return
  }

  const primaryAdminRecord = new Record(appAdminsCollection)
  primaryAdminRecord.set("key", PRIMARY_APP_ADMIN_KEY)
  primaryAdminRecord.set("user", oldestUserRecord.id)
  app.save(primaryAdminRecord)
}, (_app) => {
  // Intentionally no destructive rollback.
});
