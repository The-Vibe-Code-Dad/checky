onRecordAfterCreateSuccess((e) => {
  const DEFAULT_PERSONAL_CHECKLIST = {
    active: 0,
    tabs: [{ name: "Tab 1", items: [] }],
  }

  function getUserId(record) {
    if (record && typeof record.id === "string" && record.id) {
      return record.id
    }

    if (record && typeof record.get === "function") {
      const value = record.get("id")
      if (typeof value === "string" && value) {
        return value
      }
    }

    return ""
  }

  function getRelationId(value) {
    if (typeof value === "string") {
      return value
    }

    if (Array.isArray(value) && value.length > 0) {
      return getRelationId(value[0])
    }

    if (value && typeof value === "object" && typeof value.id === "string") {
      return value.id
    }

    return ""
  }

  function ensurePersonalChecklistForUser(userRecord) {
    const userId = getUserId(userRecord)
    if (!userId) {
      return
    }

    const currentDefaultChecklistId = getRelationId(userRecord.get("defaultChecklist"))
    if (currentDefaultChecklistId) {
      return
    }

    let personalChecklist = null
    const personalShareKey = "personal-" + userId

    try {
      personalChecklist = e.app.findFirstRecordByFilter(
        "checklists",
        "shareKey = {:shareKey} && owner = {:owner}",
        {
          shareKey: personalShareKey,
          owner: userId,
        },
      )
    } catch (_err) {}

    if (!personalChecklist) {
      const checklistCollection = e.app.findCollectionByNameOrId("checklists")
      personalChecklist = new Record(checklistCollection)
      personalChecklist.set("shareKey", personalShareKey)

      const email = typeof userRecord.get("email") === "string" && userRecord.get("email")
        ? userRecord.get("email")
        : userId
      personalChecklist.set("name", email + " checklist")
      personalChecklist.set("owner", userId)
      personalChecklist.set("data", DEFAULT_PERSONAL_CHECKLIST)
      personalChecklist.set("version", 1)
      personalChecklist.set("updatedBy", userId)
      e.app.save(personalChecklist)
    }

    userRecord.set("defaultChecklist", personalChecklist.id)
    e.app.save(userRecord)
  }

  try {
    ensurePersonalChecklistForUser(e.record)
  } catch (err) {
    console.log("failed to create personal checklist for new user:", err)
  }

  e.next()
}, "users")
