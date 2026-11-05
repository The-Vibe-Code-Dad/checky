migrate((app) => {
  const lists = new Collection({ name: 'checky_baby_lists', type: 'base', fields: [
    { type: 'text', name: 'name', required: true, max: 120, presentable: true },
    { type: 'relation', name: 'members', collectionId: app.findCollectionByNameOrId('users').id, maxSelect: 1000 },
    { type: 'number', name: 'version', required: true, min: 1, onlyInt: true }
  ] })
  // All public collection rules stay locked; routes enforce admin/membership.
  app.save(lists)
  const entries = app.findCollectionByNameOrId('checky_baby_entries')
  entries.fields.add(new RelationField({ name: 'babyList', collectionId: lists.id, maxSelect: 1, cascadeDelete: true }))
  app.save(entries)
  const migrated = {}
  for (let offset = 0; ; offset += 200) {
    const records = app.findRecordsByFilter(entries.id, '', 'id', 200, offset)
    if (!records.length) break
    for (const record of records) {
      const personal = record.getString('personalChecklist')
      const parentId = personal || record.getString('sharedChecklist')
      const collection = personal ? 'checklists' : 'shared_checklists'
      const key = collection + ':' + parentId
      if (!migrated[key]) {
        let name = 'Recovered baby log'
        try { name = 'Baby · ' + (app.findRecordById(collection, parentId).getString('name') || (personal ? 'Personal log' : 'Shared log')) } catch (_) {}
        const list = new Record(lists)
        list.set('name', name.slice(0, 120)); list.set('version', 1)
        // Preserve records without inheriting checklist access. The admin must
        // explicitly choose caregivers for these independent baby lists.
        list.set('members', [])
        app.save(list); migrated[key] = list.id
      }
      record.set('babyList', migrated[key]); app.save(record)
    }
  }
  entries.fields.getByName('babyList').required = true
  entries.fields.removeByName('personalChecklist')
  entries.fields.removeByName('sharedChecklist')
  entries.indexes = [
    'CREATE UNIQUE INDEX idx_checky_baby_request ON checky_baby_entries (requestId)',
    'CREATE INDEX idx_checky_baby_list ON checky_baby_entries (babyList, occurredAt, id)'
  ]
  app.save(entries)
}, (_app) => {
  // Keep independent lists, assignments and entries when uninstalling the code.
})
