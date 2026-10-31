migrate((app) => {
  let users;

  try {
    users = app.findCollectionByNameOrId("users");
  } catch {
    users = new Collection({
      type: "auth",
      name: "users",
      listRule: null,
      viewRule: "id = @request.auth.id",
      createRule: null,
      updateRule: "id = @request.auth.id",
      deleteRule: null,
      fields: [],
    });
    app.save(users);
  }

  let sharedChecklists;

  try {
    sharedChecklists = app.findCollectionByNameOrId("shared_checklists");
  } catch {
    sharedChecklists = new Collection({
      type: "base",
      name: "shared_checklists",
      listRule: "@request.auth.id != \"\"",
      viewRule: "@request.auth.id != \"\"",
      createRule: null,
      updateRule: "@request.auth.id != \"\"",
      deleteRule: null,
      fields: [
        {
          type: "text",
          name: "slug",
          required: true,
          max: 64,
          presentable: true,
        },
        {
          type: "json",
          name: "data",
          required: true,
        },
        {
          type: "relation",
          name: "updatedBy",
          required: false,
          maxSelect: 1,
          collectionId: users.id,
        },
        {
          type: "number",
          name: "version",
          required: false,
          min: 0,
          onlyInt: true,
        },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_shared_checklists_slug ON shared_checklists (slug)",
      ],
    });
    app.save(sharedChecklists);
  }

  try {
    app.findFirstRecordByData("shared_checklists", "slug", "main");
  } catch {
    const mainChecklist = new Record(sharedChecklists);
    mainChecklist.set("slug", "main");
    mainChecklist.set("data", {
      active: 0,
      tabs: [{ name: "Tab 1", items: [] }],
    });
    mainChecklist.set("version", 1);
    app.save(mainChecklist);
  }
}, (app) => {
  try {
    const mainChecklist = app.findFirstRecordByData("shared_checklists", "slug", "main");
    app.delete(mainChecklist);
  } catch {
    // Already removed or never created.
  }

  try {
    const sharedChecklists = app.findCollectionByNameOrId("shared_checklists");
    app.delete(sharedChecklists);
  } catch {
    // Already removed or never created.
  }

  try {
    const users = app.findCollectionByNameOrId("users");
    app.delete(users);
  } catch {
    // Already removed or never created.
  }
});
