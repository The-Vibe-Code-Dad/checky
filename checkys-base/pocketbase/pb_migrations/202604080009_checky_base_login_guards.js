migrate((app) => {
  const COLLECTION_NAME = "checky_base_login_guards";

  let guardsCollection;

  try {
    guardsCollection = app.findCollectionByNameOrId(COLLECTION_NAME);
  } catch {
    guardsCollection = new Collection({
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
          max: 200,
          presentable: true,
        },
        {
          type: "text",
          name: "failureCount",
          required: true,
          max: 20,
        },
        {
          type: "text",
          name: "lockedUntil",
          required: false,
          max: 80,
        },
        {
          type: "text",
          name: "lastIdentity",
          required: false,
          max: 200,
        },
        {
          type: "text",
          name: "lastIp",
          required: false,
          max: 120,
        },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_checky_base_login_guards_key ON checky_base_login_guards (key)",
      ],
    });
    app.save(guardsCollection);
  }
}, (_app) => {
  // Intentionally no destructive rollback.
});
