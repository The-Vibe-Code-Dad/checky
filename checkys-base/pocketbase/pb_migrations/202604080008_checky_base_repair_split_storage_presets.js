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

  let schemaChanged = false;

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
    schemaChanged = true;
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
    schemaChanged = true;
  }

  if (schemaChanged) {
    app.save(settings);
  }

  let defaultSettings;

  try {
    defaultSettings = app.findFirstRecordByData(SETTINGS_COLLECTION, "key", DEFAULT_SETTINGS_KEY);
  } catch {
    defaultSettings = new Record(settings);
    defaultSettings.set("key", DEFAULT_SETTINGS_KEY);
  }

  let legacyPreset = "small";

  try {
    legacyPreset = normalizePreset(defaultSettings.get(LEGACY_PRESET_FIELD));
  } catch {}

  let perUserPreset = "";
  let databasePreset = "";

  try {
    perUserPreset = normalizePreset(defaultSettings.get(PER_USER_PRESET_FIELD));
  } catch {}

  try {
    databasePreset = normalizePreset(defaultSettings.get(DATABASE_PRESET_FIELD));
  } catch {}

  defaultSettings.set(PER_USER_PRESET_FIELD, normalizePreset(perUserPreset || legacyPreset));
  defaultSettings.set(DATABASE_PRESET_FIELD, normalizePreset(databasePreset || legacyPreset));
  app.save(defaultSettings);
}, (_app) => {
  // Intentionally no destructive rollback.
});
