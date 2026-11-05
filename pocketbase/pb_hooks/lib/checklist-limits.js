const CHECKLIST_COLLECTIONS = ["checklists", "shared_checklists"]
const SETTINGS_COLLECTION = "checky_base_settings"
const DEFAULT_SETTINGS_KEY = "default"
const LEGACY_PRESET_FIELD = "checklistSizePreset"
const PER_USER_PRESET_FIELD = "perUserChecklistSizePreset"
const DATABASE_PRESET_FIELD = "databaseChecklistSizePreset"

const PER_USER_LIMITS = {
  small: 1 * 1024 * 1024,
  medium: 5 * 1024 * 1024,
  large: 10 * 1024 * 1024,
}

const DATABASE_LIMITS = {
  small: 25 * 1024 * 1024,
  medium: 50 * 1024 * 1024,
  large: 100 * 1024 * 1024,
}

function normalizePreset(value) {
  if (value === "small" || value === "medium" || value === "large") {
    return value
  }

  return "small"
}

function safeRecordGet(record, fieldName) {
  if (!record || typeof record.get !== "function" || !fieldName) {
    return ""
  }

  try {
    return record.get(fieldName)
  } catch (_err) {
    return ""
  }
}

function getSettings(app) {
  try {
    const settings = app.findFirstRecordByFilter(
      SETTINGS_COLLECTION,
      "key = {:key}",
      { key: DEFAULT_SETTINGS_KEY },
    )
    const legacyPreset = normalizePreset(safeRecordGet(settings, LEGACY_PRESET_FIELD))

    return {
      perUserPreset: normalizePreset(
        safeRecordGet(settings, PER_USER_PRESET_FIELD) || legacyPreset,
      ),
      databasePreset: normalizePreset(
        safeRecordGet(settings, DATABASE_PRESET_FIELD) || legacyPreset,
      ),
    }
  } catch (_err) {
    return {
      perUserPreset: "small",
      databasePreset: "small",
    }
  }
}

function getLimitLabel(preset, kind) {
  if (kind === "database") {
    if (preset === "medium") {
      return "50 MB"
    }

    if (preset === "large") {
      return "100 MB"
    }

    return "25 MB"
  }

  if (preset === "medium") {
    return "5 MB"
  }

  if (preset === "large") {
    return "10 MB"
  }

  return "1 MB"
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function parseChecklistPayloadString(value) {
  if (typeof value !== "string") {
    return null
  }

  try {
    const parsed = JSON.parse(value)
    return isPlainObject(parsed) ? parsed : null
  } catch (_err) {
    return null
  }
}

function isByteValue(value) {
  return Number.isInteger(value) && value >= 0 && value <= 255
}

function isContinuationByte(value) {
  return isByteValue(value) && (value & 0xC0) === 0x80
}

function flushDecodedParts(codeUnits, parts) {
  if (codeUnits.length <= 0) {
    return
  }

  parts.push(String.fromCharCode.apply(null, codeUnits))
  codeUnits.length = 0
}

function pushDecodedCodePoint(codePoint, codeUnits, parts) {
  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10FFFF) {
    throw new Error("Invalid UTF-8 code point.")
  }

  if (codePoint <= 0xFFFF) {
    codeUnits.push(codePoint)
  } else {
    const adjusted = codePoint - 0x10000
    codeUnits.push(0xD800 + (adjusted >> 10))
    codeUnits.push(0xDC00 + (adjusted & 0x3FF))
  }

  if (codeUnits.length >= 4096) {
    flushDecodedParts(codeUnits, parts)
  }
}

function decodeUtf8ByteArray(value) {
  if (!Array.isArray(value)) {
    return null
  }

  const codeUnits = []
  const parts = []

  try {
    for (let i = 0; i < value.length; i += 1) {
      const byte1 = value[i]
      if (!isByteValue(byte1)) {
        return null
      }

      if (byte1 <= 0x7F) {
        pushDecodedCodePoint(byte1, codeUnits, parts)
        continue
      }

      if (byte1 >= 0xC2 && byte1 <= 0xDF) {
        const byte2 = value[i + 1]
        if (!isContinuationByte(byte2)) {
          return null
        }

        pushDecodedCodePoint(
          ((byte1 & 0x1F) << 6) | (byte2 & 0x3F),
          codeUnits,
          parts,
        )
        i += 1
        continue
      }

      if (byte1 >= 0xE0 && byte1 <= 0xEF) {
        const byte2 = value[i + 1]
        const byte3 = value[i + 2]
        if (!isContinuationByte(byte2) || !isContinuationByte(byte3)) {
          return null
        }
        if ((byte1 === 0xE0 && byte2 < 0xA0) || (byte1 === 0xED && byte2 > 0x9F)) {
          return null
        }

        pushDecodedCodePoint(
          ((byte1 & 0x0F) << 12) | ((byte2 & 0x3F) << 6) | (byte3 & 0x3F),
          codeUnits,
          parts,
        )
        i += 2
        continue
      }

      if (byte1 >= 0xF0 && byte1 <= 0xF4) {
        const byte2 = value[i + 1]
        const byte3 = value[i + 2]
        const byte4 = value[i + 3]
        if (
          !isContinuationByte(byte2)
          || !isContinuationByte(byte3)
          || !isContinuationByte(byte4)
        ) {
          return null
        }
        if ((byte1 === 0xF0 && byte2 < 0x90) || (byte1 === 0xF4 && byte2 > 0x8F)) {
          return null
        }

        pushDecodedCodePoint(
          ((byte1 & 0x07) << 18)
            | ((byte2 & 0x3F) << 12)
            | ((byte3 & 0x3F) << 6)
            | (byte4 & 0x3F),
          codeUnits,
          parts,
        )
        i += 3
        continue
      }

      return null
    }
  } catch (_err) {
    return null
  }

  flushDecodedParts(codeUnits, parts)
  return parts.join("")
}

function normalizeChecklistPayload(value) {
  if (isPlainObject(value)) {
    return value
  }

  if (typeof value === "string") {
    return parseChecklistPayloadString(value)
  }

  if (Array.isArray(value)) {
    const decoded = decodeUtf8ByteArray(value)
    return typeof decoded === "string" ? parseChecklistPayloadString(decoded) : null
  }

  return null
}

function isChecklistPayload(value) {
  if (!isPlainObject(value) || !Array.isArray(value.tabs)) {
    return false
  }

  for (let i = 0; i < value.tabs.length; i += 1) {
    const tab = value.tabs[i]
    if (!isPlainObject(tab) || typeof tab.name !== "string" || !Array.isArray(tab.items)) {
      return false
    }
  }

  return true
}

function getPayloadSizeBytes(value) {
  const normalizedValue = normalizeChecklistPayload(value)
  if (!normalizedValue) {
    return 0
  }

  const serialized = JSON.stringify(normalizedValue)
  return typeof serialized === "string" ? toBytes(serialized).length : 0
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

function getRecordId(record) {
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

function getCombinedPayloadSizeBytes(app, collectionName, pendingRecordId, pendingPayload, filter, params) {
  const pendingPayloadSize = getPayloadSizeBytes(pendingPayload)
  let totalSize = 0

  for (let i = 0; i < CHECKLIST_COLLECTIONS.length; i += 1) {
    const targetCollection = CHECKLIST_COLLECTIONS[i]
    const existingRecords = params
      ? app.findRecordsByFilter(targetCollection, filter || "", "", 0, 0, params)
      : app.findRecordsByFilter(targetCollection, filter || "", "", 0, 0)
    let replacedExistingRecord = false

    for (let j = 0; j < existingRecords.length; j += 1) {
      const existingRecord = existingRecords[j]
      if (
        targetCollection === collectionName
        && getRecordId(existingRecord) === pendingRecordId
      ) {
        totalSize += pendingPayloadSize
        replacedExistingRecord = true
        continue
      }

      totalSize += getPayloadSizeBytes(existingRecord.get("data"))
    }

    if (targetCollection === collectionName && !replacedExistingRecord) {
      totalSize += pendingPayloadSize
    }
  }

  return totalSize
}


function validate(app, record) {
  const name = record.collection().name;
  const payload = normalizeChecklistPayload(record.get('data'));
  if (!isChecklistPayload(payload)) throw new BadRequestError("Checklist data must stay in the Checky's List JSON format with a tabs array.");
  const settings = getSettings(app);
  const total = getCombinedPayloadSizeBytes(app, name, record.id, payload);
  if (total > DATABASE_LIMITS[settings.databasePreset]) throw new BadRequestError('Combined hosted checklist data exceeds the database size limit.');
  const owner = record.getString('owner');
  if (owner && getCombinedPayloadSizeBytes(app, name, record.id, payload, 'owner = {:owner}', {owner}) > PER_USER_LIMITS[settings.perUserPreset]) throw new BadRequestError('Combined hosted checklist data for this user exceeds the per-user size limit.');
}
function save(e) {
  if (e.type === 'update') {
    const previous = e.record.original();
    // Older desktop/PWA builds omit unknown task fields on save. An omitted
    // reminder keeps its existing value; updated clients clear it with null.
    const before = normalizeChecklistPayload(previous.get('data'));
    const after = normalizeChecklistPayload(e.record.get('data'));
    if (isChecklistPayload(before) && isChecklistPayload(after)) {
      const reminders = {};
      for (const tab of before.tabs) for (const item of tab.items) {
        if (typeof item?.id === 'string' && typeof item.reminderAt === 'string' && Number.isFinite(Date.parse(item.reminderAt))) {
          reminders['item:' + item.id] = { reminderAt: item.reminderAt,
            reminderRepeat: item.reminderRepeat || 'none', reminderTimeZone: item.reminderTimeZone || null,
            reminderDays: item.reminderDays == null ? null : item.reminderDays };
        }
      }
      let changed = false;
      for (const tab of after.tabs) for (const item of tab.items) {
        if (item && typeof item === 'object' && reminders['item:' + item.id]) {
          const old = reminders['item:' + item.id];
          for (const field of ['reminderAt', 'reminderRepeat', 'reminderTimeZone', 'reminderDays']) {
            if (!Object.prototype.hasOwnProperty.call(item, field)) {
              item[field] = field !== 'reminderAt' && !item.reminderAt ? (field === 'reminderRepeat' ? 'none' : null) : old[field];
              changed = true;
            }
          }
        }
      }
      if (changed) e.record.set('data', after);
    }
    // Access revocation must remain possible even for legacy over-quota data.
    if (previous.getString('data') === e.record.getString('data') && previous.getString('owner') === e.record.getString('owner')) return e.next();
  }
  // Initial schema migrations create these collections in stages, before the API starts.
  try {
    if (!e.app.findCollectionByNameOrId('checky_base_sessions').fields.getByName('credentialStamp')) return e.next();
    e.app.findCollectionByNameOrId('checky_base_settings');
    e.app.findCollectionByNameOrId('checklists');
  } catch (_) { return e.next(); }
  const originalApp = e.app;
  try {
    return originalApp.runInTransaction((tx) => {
      e.app = tx;
      validate(tx, e.record);
      return e.next();
    });
  } finally { e.app = originalApp; }
}
module.exports = {save, normalizeChecklistPayload};
