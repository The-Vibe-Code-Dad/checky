migrate((app) => {
  let sharedChecklists;

  try {
    sharedChecklists = app.findCollectionByNameOrId("shared_checklists");
  } catch {
    return;
  }

  sharedChecklists.listRule = null;
  sharedChecklists.viewRule = null;
  sharedChecklists.createRule = null;
  sharedChecklists.updateRule = null;
  sharedChecklists.deleteRule = null;
  app.save(sharedChecklists);
}, (app) => {
  let sharedChecklists;

  try {
    sharedChecklists = app.findCollectionByNameOrId("shared_checklists");
  } catch {
    return;
  }

  sharedChecklists.listRule = "@request.auth.id != \"\"";
  sharedChecklists.viewRule = "@request.auth.id != \"\"";
  sharedChecklists.createRule = null;
  sharedChecklists.updateRule = "@request.auth.id != \"\"";
  sharedChecklists.deleteRule = null;
  app.save(sharedChecklists);
});
