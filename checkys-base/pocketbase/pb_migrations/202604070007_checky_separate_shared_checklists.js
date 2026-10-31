migrate((app) => {
  const USERS_COLLECTION = "users";
  const PERSONAL_COLLECTION = "checklists";
  const SHARED_COLLECTION = "shared_checklists";
  const USER_DEFAULT_CHECKLIST_FIELD = "defaultChecklist";
  const USER_ASSIGNED_SHARED_CHECKLIST_FIELD = "assignedSharedChecklist";
  const DEFAULT_SHARED_SHARE_KEY = "main";
  const DEFAULT_PERSONAL_CHECKLIST = {
    active: 0,
    tabs: [{ name: "Tab 1", items: [] }],
  };

  function getString(value, maxLength) {
    if (typeof value !== "string") {
      return "";
    }

    const normalized = value.trim();
    if (!normalized) {
      return "";
    }

    return typeof maxLength === "number" && maxLength > 0
      ? normalized.slice(0, maxLength)
      : normalized;
  }

  function getUserId(record) {
    if (record && typeof record.id === "string" && record.id) {
      return record.id;
    }

    if (record && typeof record.get === "function") {
      return getString(record.get("id"), 64);
    }

    return "";
  }

  function getRelationId(value) {
    if (typeof value === "string") {
      return value;
    }

    if (Array.isArray(value) && value.length > 0) {
      return getRelationId(value[0]);
    }

    if (value && typeof value === "object" && typeof value.id === "string") {
      return value.id;
    }

    return "";
  }

  function getRelationIds(value) {
    const values = Array.isArray(value) ? value : value ? [value] : [];
    const seen = {};
    const ids = [];

    for (let i = 0; i < values.length; i += 1) {
      const id = getRelationId(values[i]);
      if (!id || seen[id]) {
        continue;
      }

      seen[id] = true;
      ids.push(id);
    }

    return ids;
  }

  function cloneChecklistData(value) {
    if (value && typeof value === "object") {
      return JSON.parse(JSON.stringify(value));
    }

    return JSON.parse(JSON.stringify(DEFAULT_PERSONAL_CHECKLIST));
  }

  function getChecklistVersion(record) {
    const value = Number(record && typeof record.get === "function" ? record.get("version") : record?.version);
    return Number.isInteger(value) && value > 0 ? value : 1;
  }

  function normalizeShareKey(value, fallback) {
    return getString(value, 120) || getString(fallback, 120) || `shared-${Date.now()}`;
  }

  function normalizeChecklistName(value, shareKey) {
    const explicit = getString(value, 120);
    if (explicit) {
      return explicit;
    }

    if (shareKey === DEFAULT_SHARED_SHARE_KEY) {
      return "Shared main";
    }

    return "Shared checklist";
  }

  function isPersonalChecklistRecord(record) {
    const shareKey = getString(record && typeof record.get === "function" ? record.get("shareKey") : record?.shareKey, 120);
    return shareKey.startsWith("personal-");
  }

  function ensurePersonalChecklistForUser(users, personalChecklists, personalRecordsByUserId, userRecord) {
    const userId = getUserId(userRecord);
    if (!userId) {
      return null;
    }

    if (personalRecordsByUserId[userId]) {
      return personalRecordsByUserId[userId];
    }

    let personalRecord = null;
    const shareKey = `personal-${userId}`;

    try {
      personalRecord = app.findFirstRecordByFilter(
        PERSONAL_COLLECTION,
        "shareKey = {:shareKey} && owner = {:owner}",
        {
          shareKey,
          owner: userId,
        },
      );
    } catch {}

    if (!personalRecord) {
      personalRecord = new Record(personalChecklists);
      personalRecord.set("shareKey", shareKey);
      personalRecord.set(
        "name",
        normalizeChecklistName(
          getString(userRecord.get("email"), 120) ? `${userRecord.get("email")} checklist` : "",
          shareKey,
        ),
      );
      personalRecord.set("owner", userId);
      personalRecord.set("data", cloneChecklistData(DEFAULT_PERSONAL_CHECKLIST));
      personalRecord.set("version", 1);
      personalRecord.set("updatedBy", userId);
      app.save(personalRecord);
    }

    personalRecordsByUserId[userId] = personalRecord;
    return personalRecord;
  }

  const users = app.findCollectionByNameOrId(USERS_COLLECTION);
  const personalChecklists = app.findCollectionByNameOrId(PERSONAL_COLLECTION);
  const personalRecords = app.findRecordsByFilter(PERSONAL_COLLECTION, "", "", 0, 0);
  const personalRecordsById = {};
  const personalRecordsByUserId = {};
  const sharedRecordsToMove = [];

  for (let i = 0; i < personalRecords.length; i += 1) {
    const record = personalRecords[i];
    if (isPersonalChecklistRecord(record)) {
      personalRecordsById[record.id] = record;
      const ownerId = getRelationId(record.get("owner"));
      if (ownerId && !personalRecordsByUserId[ownerId]) {
        personalRecordsByUserId[ownerId] = record;
      }
      continue;
    }

    sharedRecordsToMove.push(record);
  }

  let legacySharedRecords = [];
  try {
    legacySharedRecords = app.findRecordsByFilter(SHARED_COLLECTION, "", "", 0, 0);
  } catch {}

  try {
    const legacySharedCollection = app.findCollectionByNameOrId(SHARED_COLLECTION);
    app.delete(legacySharedCollection);
  } catch {}

  const sharedChecklists = new Collection({
    type: "base",
    name: SHARED_COLLECTION,
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
      "CREATE UNIQUE INDEX idx_shared_checklists_share_key ON shared_checklists (shareKey)",
    ],
  });
  app.save(sharedChecklists);

  try {
    users.fields.getByName(USER_ASSIGNED_SHARED_CHECKLIST_FIELD);
  } catch {
    users.fields.add(new RelationField({
      name: USER_ASSIGNED_SHARED_CHECKLIST_FIELD,
      required: false,
      maxSelect: 1,
      collectionId: sharedChecklists.id,
    }));
    app.save(users);
  }

  personalChecklists.listRule = "@request.auth.id != \"\" && owner = @request.auth.id";
  personalChecklists.viewRule = "@request.auth.id != \"\" && owner = @request.auth.id";
  personalChecklists.createRule = "@request.auth.id != \"\" && @request.body.owner = @request.auth.id && @request.body.shareKey != \"\" && @request.body.version = 1";
  personalChecklists.updateRule = "@request.auth.id != \"\" && owner = @request.auth.id && @request.body.owner:isset = false && @request.body.sharedWith:isset = false && @request.body.shareKey:isset = false && @request.body.version:isset = true && @request.body.version > version";
  personalChecklists.deleteRule = "@request.auth.id != \"\" && owner = @request.auth.id";
  app.save(personalChecklists);

  const sharedSourceByShareKey = {};
  const sharedSourceOrder = [];
  const oldSharedRecordIdToShareKey = {};

  function upsertSharedSource(source) {
    if (!source || !source.shareKey) {
      return;
    }

    if (!sharedSourceByShareKey[source.shareKey]) {
      sharedSourceByShareKey[source.shareKey] = source;
      sharedSourceOrder.push(source.shareKey);
      return;
    }

    const current = sharedSourceByShareKey[source.shareKey];
    current.name = source.name || current.name;
    current.data = source.data || current.data;
    current.owner = source.owner || current.owner;
    current.updatedBy = source.updatedBy || current.updatedBy;
    current.version = source.version > current.version ? source.version : current.version;
    current.sharedWith = getRelationIds((current.sharedWith || []).concat(source.sharedWith || []));
    current.sourceRecordIds = (current.sourceRecordIds || []).concat(source.sourceRecordIds || []);
  }

  for (let i = 0; i < legacySharedRecords.length; i += 1) {
    const record = legacySharedRecords[i];
    const shareKey = normalizeShareKey(record.get("shareKey") || record.get("slug"), `${DEFAULT_SHARED_SHARE_KEY}-${record.id}`);
    upsertSharedSource({
      shareKey,
      name: normalizeChecklistName(record.get("name"), shareKey),
      data: cloneChecklistData(record.get("data")),
      owner: getRelationId(record.get("owner")),
      sharedWith: getRelationIds(record.get("sharedWith")),
      updatedBy: getRelationId(record.get("updatedBy")),
      version: getChecklistVersion(record),
      sourceRecordIds: [],
    });
  }

  for (let i = 0; i < sharedRecordsToMove.length; i += 1) {
    const record = sharedRecordsToMove[i];
    const shareKey = normalizeShareKey(record.get("shareKey"), `shared-${record.id}`);
    oldSharedRecordIdToShareKey[record.id] = shareKey;
    upsertSharedSource({
      shareKey,
      name: normalizeChecklistName(record.get("name"), shareKey),
      data: cloneChecklistData(record.get("data")),
      owner: getRelationId(record.get("owner")),
      sharedWith: getRelationIds(record.get("sharedWith")),
      updatedBy: getRelationId(record.get("updatedBy")),
      version: getChecklistVersion(record),
      sourceRecordIds: [record.id],
    });
  }

  if (!sharedSourceByShareKey[DEFAULT_SHARED_SHARE_KEY]) {
    sharedSourceOrder.unshift(DEFAULT_SHARED_SHARE_KEY);
    sharedSourceByShareKey[DEFAULT_SHARED_SHARE_KEY] = {
      shareKey: DEFAULT_SHARED_SHARE_KEY,
      name: "Shared main",
      data: cloneChecklistData(DEFAULT_PERSONAL_CHECKLIST),
      owner: "",
      sharedWith: [],
      updatedBy: "",
      version: 1,
      sourceRecordIds: [],
    };
  }

  const sharedRecordIdByShareKey = {};

  for (let i = 0; i < sharedSourceOrder.length; i += 1) {
    const shareKey = sharedSourceOrder[i];
    const source = sharedSourceByShareKey[shareKey];
    const record = new Record(sharedChecklists);
    record.set("shareKey", shareKey);
    record.set("name", normalizeChecklistName(source.name, shareKey));
    record.set("data", cloneChecklistData(source.data));
    record.set("version", source.version > 0 ? source.version : 1);

    if (source.owner) {
      record.set("owner", source.owner);
    }
    if (source.sharedWith && source.sharedWith.length > 0) {
      record.set("sharedWith", getRelationIds(source.sharedWith));
    }
    if (source.updatedBy) {
      record.set("updatedBy", source.updatedBy);
    }

    app.save(record);
    sharedRecordIdByShareKey[shareKey] = record.id;
  }

  const userRecords = app.findRecordsByFilter(USERS_COLLECTION, "", "", 0, 0);
  for (let i = 0; i < userRecords.length; i += 1) {
    const userRecord = userRecords[i];
    const userId = getUserId(userRecord);
    if (!userId) {
      continue;
    }

    const personalRecord = ensurePersonalChecklistForUser(users, personalChecklists, personalRecordsByUserId, userRecord);
    const currentDefaultChecklistId = getRelationId(userRecord.get(USER_DEFAULT_CHECKLIST_FIELD));
    const currentAssignedSharedChecklistId = getRelationId(userRecord.get(USER_ASSIGNED_SHARED_CHECKLIST_FIELD));
    let nextAssignedSharedChecklistId = currentAssignedSharedChecklistId;
    let shouldSave = false;

    if (currentDefaultChecklistId && !personalRecordsById[currentDefaultChecklistId]) {
      const shareKey = oldSharedRecordIdToShareKey[currentDefaultChecklistId];
      if (shareKey && sharedRecordIdByShareKey[shareKey]) {
        nextAssignedSharedChecklistId = sharedRecordIdByShareKey[shareKey];
        shouldSave = true;
      }
    }

    if (!currentDefaultChecklistId || currentDefaultChecklistId !== personalRecord.id) {
      userRecord.set(USER_DEFAULT_CHECKLIST_FIELD, personalRecord.id);
      shouldSave = true;
    }

    if (nextAssignedSharedChecklistId) {
      userRecord.set(USER_ASSIGNED_SHARED_CHECKLIST_FIELD, nextAssignedSharedChecklistId);
    }

    if (shouldSave) {
      app.save(userRecord);
    }
  }

  for (let i = 0; i < sharedRecordsToMove.length; i += 1) {
    app.delete(sharedRecordsToMove[i]);
  }
}, (_app) => {
  // Intentionally no destructive rollback.
  // This migration separates personal and shared checklist storage and may
  // move existing records between collections, so auto-reverting it would
  // risk data loss and broken assignments.
});
