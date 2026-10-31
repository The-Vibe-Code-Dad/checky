migrate((app) => {
  const SETTINGS_COLLECTION = "checky_base_settings";
  const DEFAULT_SETTINGS_KEY = "default";

  let settings;

  try {
    settings = app.findCollectionByNameOrId(SETTINGS_COLLECTION);
  } catch {
    settings = new Collection({
      type: "base",
      name: SETTINGS_COLLECTION,
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
          type: "select",
          name: "checklistSizePreset",
          required: true,
          maxSelect: 1,
          values: ["small", "medium", "large"],
          presentable: true,
        },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_checky_base_settings_key ON checky_base_settings (key)",
      ],
    });
    app.save(settings);
  }

  let defaultSettings;

  try {
    defaultSettings = app.findFirstRecordByData(SETTINGS_COLLECTION, "key", DEFAULT_SETTINGS_KEY);
  } catch {
    defaultSettings = new Record(settings);
    defaultSettings.set("key", DEFAULT_SETTINGS_KEY);
  }

  defaultSettings.set("checklistSizePreset", "small");
  app.save(defaultSettings);
}, (_app) => {
  // Intentionally no destructive rollback.
  // Existing installs may already rely on the settings collection and
  // deleting it on downgrade would discard admin configuration.
});
