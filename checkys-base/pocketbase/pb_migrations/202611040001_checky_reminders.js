migrate((app) => {
  const users = app.findCollectionByNameOrId('users')
  const subscriptions = new Collection({ name: 'checky_push_subscriptions', type: 'base', fields: [
    { type: 'relation', name: 'user', required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: true },
    { type: 'text', name: 'endpointHash', required: true, max: 64 },
    { type: 'json', name: 'subscription', required: true, maxSize: 4096 },
    { type: 'text', name: 'credentialStamp', required: true, max: 64 },
    { type: 'text', name: 'sessionKey', max: 64 },
    { type: 'date', name: 'enabledAt', required: true }
  ], indexes: ['CREATE UNIQUE INDEX idx_checky_push_endpoint ON checky_push_subscriptions (endpointHash)'] })
  app.save(subscriptions)
  app.save(new Collection({ name: 'checky_push_deliveries', type: 'base', fields: [
    { type: 'relation', name: 'subscription', required: true, collectionId: subscriptions.id, maxSelect: 1, cascadeDelete: true },
    { type: 'text', name: 'eventKey', required: true, max: 64 },
    { type: 'date', name: 'dueAt', required: true },
    { type: 'date', name: 'retryAt', required: true },
    { type: 'bool', name: 'sent' },
    { type: 'number', name: 'attempts' }
  ], indexes: ['CREATE UNIQUE INDEX idx_checky_push_delivery ON checky_push_deliveries (subscription, eventKey)'] }))
}, (app) => {
  app.delete(app.findCollectionByNameOrId('checky_push_deliveries'))
  app.delete(app.findCollectionByNameOrId('checky_push_subscriptions'))
})
