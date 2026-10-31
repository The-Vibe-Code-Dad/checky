onRecordCreateRequest((e) => {
  const APP_ADMINS_COLLECTION = "checky_base_admins"
  const PRIMARY_APP_ADMIN_KEY = "primary"

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

  function hasAppAdminAuth(record) {
    const authUserId = getUserId(record)
    if (!authUserId) {
      return false
    }

    let adminRecord = null

    try {
      adminRecord = e.app.findFirstRecordByData(APP_ADMINS_COLLECTION, "key", PRIMARY_APP_ADMIN_KEY)
    } catch (_err) {
      adminRecord = null
    }

    if (!adminRecord || typeof adminRecord.get !== "function") {
      return false
    }

    try {
      return getRelationId(adminRecord.get("user")) === authUserId
    } catch (_err) {
      return false
    }
  }

  if (e.hasSuperuserAuth() || hasAppAdminAuth(e.auth)) {
    return e.next()
  }

  throw new ForbiddenError("Only an admin can create shared checklists.")
}, "shared_checklists")

onRecordCreateRequest((e) => {
  const PERSONAL_CHECKLIST_COLLECTION = "checklists"

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

  function getString(value, maxLength) {
    if (typeof value !== "string") {
      return ""
    }

    const normalized = value.trim()
    if (!normalized) {
      return ""
    }

    return typeof maxLength === "number" && maxLength > 0
      ? normalized.slice(0, maxLength)
      : normalized
  }

  function getInt(value) {
    const parsed = parseInt(typeof value === "string" ? value : String(value ?? ""), 10)
    return Number.isFinite(parsed) ? parsed : 0
  }

  if (e.hasSuperuserAuth()) {
    return e.next()
  }

  const authUserId = getUserId(e.auth)
  const ownerId = getRelationId(e.record.get("owner"))
  const shareKey = getString(e.record.get("shareKey"), 120)
  const version = getInt(e.record.get("version"))
  const updatedBy = getRelationId(e.record.get("updatedBy"))
  const personalShareKey = ownerId ? `personal-${ownerId}` : ""
  const isAutomaticPersonalChecklist = (
    !!ownerId
    && shareKey === personalShareKey
    && version === 1
    && updatedBy === ownerId
  )

  if (!isAutomaticPersonalChecklist) {
    throw new ForbiddenError("Only the automatic personal checklist can be created for this user.")
  }

  if (authUserId && ownerId !== authUserId) {
    throw new ForbiddenError("Only the automatic personal checklist can be created for this user.")
  }

  let existing = null

  try {
    existing = e.app.findFirstRecordByFilter(
      PERSONAL_CHECKLIST_COLLECTION,
      "shareKey = {:shareKey} && owner = {:owner}",
      {
        shareKey: personalShareKey,
        owner: ownerId,
      },
    )
  } catch (_err) {
    existing = null
  }

  if (existing) {
    throw new ForbiddenError("This user already has a personal checklist.")
  }

  e.record.set("updatedBy", ownerId)
  return e.next()
}, "checklists")
