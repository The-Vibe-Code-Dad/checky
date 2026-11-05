migrate((app) => {
  // Add-on records are separate from checklist JSON so older clients cannot
  // erase the log. Custom routes check the parent checklist's access rules.
  app.save(new Collection({ name: 'checky_baby_entries', type: 'base', fields: [
    { type: 'relation', name: 'personalChecklist', collectionId: app.findCollectionByNameOrId('checklists').id, maxSelect: 1, cascadeDelete: true },
    { type: 'relation', name: 'sharedChecklist', collectionId: app.findCollectionByNameOrId('shared_checklists').id, maxSelect: 1, cascadeDelete: true },
    { type: 'relation', name: 'createdBy', collectionId: app.findCollectionByNameOrId('users').id, maxSelect: 1 },
    { type: 'text', name: 'requestId', required: true, max: 80 },
    { type: 'date', name: 'occurredAt', required: true },
    { type: 'number', name: 'version', required: true, min: 1, onlyInt: true },
    { type: 'json', name: 'data', required: true, maxSize: 32768 }
  ], indexes: [
    'CREATE UNIQUE INDEX idx_checky_baby_request ON checky_baby_entries (requestId)',
    'CREATE INDEX idx_checky_baby_personal ON checky_baby_entries (personalChecklist, occurredAt, id)',
    'CREATE INDEX idx_checky_baby_shared ON checky_baby_entries (sharedChecklist, occurredAt, id)'
  ] }))
}, (app) => {
  app.delete(app.findCollectionByNameOrId('checky_baby_entries'))
})
