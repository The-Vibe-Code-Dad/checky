migrate((app) => {
  // Old clients could submit any larger version. Leave ample safe-integer headroom
  // after repair, and use a fresh revision so a cached initial version cannot match.
  for (const table of ['checklists', 'shared_checklists']) {
    app.db().newQuery(`UPDATE ${table} SET version = {:revision}
      WHERE version < 1 OR version != CAST(version AS INTEGER) OR version >= 4503599627370496`)
      .bind({ revision: Date.now() }).execute()
  }
  // The list ACL is authoritative. Never turn a stale selection into a new grant.
  app.db().newQuery(`UPDATE users SET assignedSharedChecklist = ''
    WHERE assignedSharedChecklist != '' AND NOT EXISTS (
      SELECT 1 FROM shared_checklists AS list WHERE list.id = users.assignedSharedChecklist
      AND (list.owner = users.id OR EXISTS (SELECT 1 FROM json_each(list.sharedWith) WHERE value = users.id))
    )`).execute()
}, () => { /* Keep repaired versions and revoked memberships on downgrade. */ })
