// Validate actual record values in the write transaction, including ID URLs and batch writes.
onRecordCreate((e) => require(__hooks + '/lib/checklist-limits.js').save(e), 'checklists', 'shared_checklists')
onRecordUpdate((e) => require(__hooks + '/lib/checklist-limits.js').save(e), 'checklists', 'shared_checklists')
