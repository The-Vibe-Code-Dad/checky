migrate((app) => {
  const lists = app.findCollectionByNameOrId('checky_baby_lists')
  // PocketBase superusers manage name/members through the normal dashboard.
  // Every app account needs explicit membership, including the first user.
  for (const rule of ['listRule', 'viewRule', 'createRule', 'updateRule', 'deleteRule']) lists[rule] = null
  // This field only supported the retired in-app membership editor. Entry
  // versions remain intact for concurrent feeding/diaper edits.
  lists.fields.removeByName('version')
  app.save(lists)
}, (_app) => {
  // Preserve baby lists, membership and entries when removing the add-on.
})
