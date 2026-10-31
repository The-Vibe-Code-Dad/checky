onRecordCreate((e) => require(__hooks + '/lib/shared-access.js').save(e, true), 'users')
onRecordUpdate((e) => require(__hooks + '/lib/shared-access.js').save(e, false), 'users')
