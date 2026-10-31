migrate((app) => {
  const AUTH_COLLECTION = "users";
  const CHECKLIST_COLLECTION = "checklists";
  const DEFAULT_CHECKLIST_SHARE_KEY = "main";
  const USER_DEFAULT_CHECKLIST_FIELD = "defaultChecklist";

  const users = app.findCollectionByNameOrId(AUTH_COLLECTION);

  let checklists;
  try {
    checklists = app.findCollectionByNameOrId(CHECKLIST_COLLECTION);
  } catch {
    checklists = new Collection({
      type: "base",
      name: CHECKLIST_COLLECTION,
      listRule: "@request.auth.id != \"\" && (owner = @request.auth.id || sharedWith.id ?= @request.auth.id)",
      viewRule: "@request.auth.id != \"\" && (owner = @request.auth.id || sharedWith.id ?= @request.auth.id)",
      createRule: "@request.auth.id != \"\" && @request.body.owner = @request.auth.id && @request.body.shareKey != \"\" && @request.body.version = 1",
      updateRule: "@request.auth.id != \"\" && (owner = @request.auth.id || sharedWith.id ?= @request.auth.id) && @request.body.owner:isset = false && @request.body.sharedWith:isset = false && @request.body.shareKey:isset = false && @request.body.version:isset = true && @request.body.version > version",
      deleteRule: "@request.auth.id != \"\" && owner = @request.auth.id",
      fields: [
        {
          type: "text",
          name: "shareKey",
          required: true,
          max: 120,
          presentable: true,
        },
        {
          type: "text",
          name: "name",
          required: false,
          max: 120,
          presentable: true,
        },
        {
          type: "json",
          name: "data",
          required: true,
        },
        {
          type: "relation",
          name: "owner",
          required: false,
          maxSelect: 1,
          collectionId: users.id,
        },
        {
          type: "relation",
          name: "sharedWith",
          required: false,
          maxSelect: 500,
          collectionId: users.id,
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
          required: true,
          min: 1,
          onlyInt: true,
        },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_checklists_share_key ON checklists (shareKey)",
      ],
    });
    app.save(checklists);
  }

  try {
    users.fields.getByName(USER_DEFAULT_CHECKLIST_FIELD);
  } catch {
    users.fields.add(new RelationField({
      name: USER_DEFAULT_CHECKLIST_FIELD,
      required: false,
      maxSelect: 1,
      collectionId: checklists.id,
    }));
    app.save(users);
  }

  let seededChecklistData = {
    active: 0,
    tabs: [{ name: "Tab 1", items: [] }],
  };
  let seededChecklistVersion = 1;

  try {
    const legacyMain = app.findFirstRecordByData("shared_checklists", "slug", "main");
    const legacyData = legacyMain.get("data");
    const legacyVersion = legacyMain.getInt("version");

    if (legacyData && typeof legacyData === "object") {
      seededChecklistData = legacyData;
    }
    if (legacyVersion > 0) {
      seededChecklistVersion = legacyVersion;
    }
  } catch {
    // No legacy shared checklist to migrate.
  }

  let mainChecklist;
  try {
    mainChecklist = app.findFirstRecordByData(CHECKLIST_COLLECTION, "shareKey", DEFAULT_CHECKLIST_SHARE_KEY);
  } catch {
    mainChecklist = new Record(checklists);
    mainChecklist.set("shareKey", DEFAULT_CHECKLIST_SHARE_KEY);
    mainChecklist.set("name", "Shared main");
    mainChecklist.set("data", seededChecklistData);
    mainChecklist.set("version", seededChecklistVersion);
    app.save(mainChecklist);
  }

  // Keep the seeded shared checklist available for admins, but do not
  // auto-assign users to it. New and upgraded installs stay personal-first
  // until an admin explicitly points a user at a shared checklist.
}, (_app) => {
  // Intentionally no destructive rollback.
  // The new hybrid checklist model stores user assignments and checklist data,
  // so automatically deleting it on downgrade would risk data loss.
});
