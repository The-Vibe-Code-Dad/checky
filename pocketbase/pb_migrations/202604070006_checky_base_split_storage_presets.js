migrate((app) => {
  const SETTINGS_COLLECTION = "checky_base_settings";
  const DEFAULT_SETTINGS_KEY = "default";
  const LEGACY_PRESET_FIELD = "checklistSizePreset";
  const PER_USER_PRESET_FIELD = "perUserChecklistSizePreset";
  const DATABASE_PRESET_FIELD = "databaseChecklistSizePreset";

  function normalizePreset(value) {
    if (value === "small" || value === "medium" || value === "large") {
      return value;
    }

    return "small";
  }

  let settings;

  try {
    settings = app.findCollectionByNameOrId(SETTINGS_COLLECTION);
  } catch {
    return;
  }

  let defaultSettings;
  let legacyPreset = "small";

  try {
    defaultSettings = app.findFirstRecordByData(SETTINGS_COLLECTION, "key", DEFAULT_SETTINGS_KEY);
  } catch {
    defaultSettings = new Record(settings);
    defaultSettings.set("key", DEFAULT_SETTINGS_KEY);
  }

  try {
    settings.fields.getByName(LEGACY_PRESET_FIELD);
    try {
      legacyPreset = normalizePreset(defaultSettings.get(LEGACY_PRESET_FIELD));
    } catch {}
  } catch {}

  try {
    settings.fields.getByName(PER_USER_PRESET_FIELD);
  } catch {
    settings.fields.add(new SelectField({
      name: PER_USER_PRESET_FIELD,
      required: true,
      maxSelect: 1,
      values: ["small", "medium", "large"],
      presentable: true,
    }));
  }

  try {
    settings.fields.getByName(DATABASE_PRESET_FIELD);
  } catch {
    settings.fields.add(new SelectField({
      name: DATABASE_PRESET_FIELD,
      required: true,
      maxSelect: 1,
      values: ["small", "medium", "large"],
      presentable: true,
    }));
  }

  app.save(settings);
  let existingPerUserPreset = "";
  let existingDatabasePreset = "";

  try {
    existingPerUserPreset = normalizePreset(defaultSettings.get(PER_USER_PRESET_FIELD));
  } catch {}

  try {
    existingDatabasePreset = normalizePreset(defaultSettings.get(DATABASE_PRESET_FIELD));
  } catch {}

  const perUserPreset = normalizePreset(existingPerUserPreset || legacyPreset);
  const databasePreset = normalizePreset(existingDatabasePreset || legacyPreset);

  defaultSettings.set(PER_USER_PRESET_FIELD, perUserPreset);
  defaultSettings.set(DATABASE_PRESET_FIELD, databasePreset);
  app.save(defaultSettings);
}, (_app) => {
  // Intentionally no destructive rollback.
  // Existing installs may already rely on the split settings. The legacy
  // single-preset field is intentionally left in place for upgrade
  // compatibility so older databases don't fail while moving to the new
  // per-user and database presets.
});
