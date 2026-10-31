migrate((app) => {
  const COLLECTION_NAME = "checky_base_sessions"

  let usersCollection

  try {
    usersCollection = app.findCollectionByNameOrId("users")
  } catch {
    return
  }

  let sessionsCollection

  try {
    sessionsCollection = app.findCollectionByNameOrId(COLLECTION_NAME)
  } catch {
    sessionsCollection = new Collection({
      type: "base",
      name: COLLECTION_NAME,
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
          max: 120,
          presentable: true,
        },
        {
          type: "relation",
          name: "user",
          required: true,
          maxSelect: 1,
          collectionId: usersCollection.id,
        },
        {
          type: "text",
          name: "expiresAt",
          required: true,
          max: 80,
        },
        {
          type: "text",
          name: "lastSeenAt",
          required: false,
          max: 80,
        },
        {
          type: "text",
          name: "createdByIp",
          required: false,
          max: 120,
        },
        {
          type: "text",
          name: "createdByUserAgent",
          required: false,
          max: 500,
        },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_checky_base_sessions_key ON checky_base_sessions (key)",
      ],
    })
    app.save(sessionsCollection)
  }
}, (_app) => {
  // Intentionally no destructive rollback.
});
