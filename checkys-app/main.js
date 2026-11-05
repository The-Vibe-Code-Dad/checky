const { app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu, nativeImage, safeStorage, shell, session } = require("electron");
const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { verifyManifest, requireHttps, readBoundedBody } = require('./lib/desktop-update.cjs');
const UPDATE_PUBLIC_KEY = require('./lib/update-public-key.json').publicKey;

const AUTH_COLLECTION = "users";
const PERSONAL_CHECKLIST_COLLECTION = "checklists";
const SHARED_CHECKLIST_COLLECTION = "shared_checklists";
const USER_DEFAULT_CHECKLIST_FIELD = "defaultChecklist";
const USER_ASSIGNED_SHARED_CHECKLIST_FIELD = "assignedSharedChecklist";
const REMOTE_PUSH_DELAY_MS = 1200;
const MAX_TABS = 100;
const MAX_ITEMS_PER_TAB = 1000;
const MAX_TAB_NAME_LENGTH = 120;
const MAX_ITEM_TEXT_LENGTH = 20000;
const MAX_DESKTOP_UPDATE_BYTES = 500 * 1024 * 1024;

const DEFAULT_SETTINGS = {
  hotkey: "CommandOrControl+Space",
  runOnStartup: false,
  alwaysOnTop: true,
  autoHideOnBlur: false,
  showDoneTab: false,
  advanced: {
    serverUrl: "",
    email: "",
    password: ""
  }
};

const DEFAULT_CHECKLIST = {
  active: 0,
  tabs: [{ name: "Tab 1", items: [] }]
};

let mainWindow = null;
let verificationWindow = null;
let tray = null;
let currentHotkey = DEFAULT_SETTINGS.hotkey;
let lastAutoBackupAt = 0;
let remotePushTimer = null;
let queuedRemoteChecklist = null;
let remotePushPromise = Promise.resolve();
const APP_NAME = "Checky's List";
const APP_USER_MODEL_ID = "com.checkys.app";
const gotSingleInstanceLock = app.requestSingleInstanceLock();
let pendingSecondInstanceFocus = false;
let pendingVerification = null;

function requestVerificationCode(email) {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error('Open the app to verify your sign-in.');
  if (pendingVerification) pendingVerification.finish(null);
  return new Promise((resolve) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => finish(null), 180000);
    function finish(code) {
      clearTimeout(timer);
      pendingVerification = null;
      resolve(code);
    }
    pendingVerification = { id, finish };
    mainWindow.webContents.send('auth:code-requested', { id, email });
    mainWindow.show();
  });
}

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      pendingSecondInstanceFocus = true;
      return;
    }

    showWindow("second-instance");
  });
}

function getDataDir() {
  return path.join(app.getPath("userData"), "data");
}

function getBackupsDir() {
  return path.join(getDataDir(), "backups");
}

function getChecklistPath() {
  return path.join(getDataDir(), "checkTabs.json");
}

function getSettingsPath() {
  return path.join(getDataDir(), "settings.json");
}

function getSecureStatePath() {
  return path.join(getDataDir(), "secure-state.json");
}

function getSyncMetaPath() {
  return path.join(getDataDir(), "sync-meta.json");
}

function getSyncRestorePointPath() {
  return path.join(getDataDir(), "sync-restore-point.json");
}

function getDesktopUpdatesDir() {
  return path.join(getDataDir(), "updates");
}

function getReadmePath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "README.md")
    : path.join(__dirname, "README.md");
}

function cloneValue(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function sanitizeSingleLineText(value, maxLength = MAX_TAB_NAME_LENGTH) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function sanitizeMultilineText(value, maxLength = MAX_ITEM_TEXT_LENGTH) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .slice(0, maxLength);
}

function normalizeCompletedAt(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function ensureDataFiles() {
  await fs.mkdir(getDataDir(), { recursive: true });
  await fs.mkdir(getBackupsDir(), { recursive: true });

  try {
    await fs.access(getChecklistPath());
  } catch {
    await fs.writeFile(getChecklistPath(), JSON.stringify(DEFAULT_CHECKLIST, null, 2), "utf8");
  }

  try {
    await fs.access(getSettingsPath());
  } catch {
    await fs.writeFile(getSettingsPath(), JSON.stringify(getPersistedSettings(DEFAULT_SETTINGS), null, 2), "utf8");
  }
}

async function readJsonFile(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath, value) {
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
  return value;
}

function normalizeChecklist(data) {
  const safe = data && typeof data === "object" ? data : {};
  const tabs = Array.isArray(safe.tabs) ? safe.tabs.slice(0, MAX_TABS) : [];
  const normalizedTabs = tabs.length > 0 ? tabs : [{ name: "Tab 1", items: [] }];
  normalizedTabs.forEach((tab, index) => {
    if (!tab || typeof tab !== "object") normalizedTabs[index] = { name: `Tab ${index + 1}`, items: [] };
    const normalizedName = sanitizeSingleLineText(normalizedTabs[index].name, MAX_TAB_NAME_LENGTH);
    if (!normalizedName) {
      normalizedTabs[index].name = `Tab ${index + 1}`;
    } else {
      normalizedTabs[index].name = normalizedName;
    }
    if (!Array.isArray(normalizedTabs[index].items)) normalizedTabs[index].items = [];
    normalizedTabs[index].id = typeof normalizedTabs[index].id === "string" && normalizedTabs[index].id.trim()
      ? normalizedTabs[index].id.trim().slice(0, 120)
      : "legacy-tab-" + index;
    normalizedTabs[index].items = normalizedTabs[index].items.slice(0, MAX_ITEMS_PER_TAB);
    normalizedTabs[index].system = normalizedTabs[index].system === "done" ? "done" : undefined;
    normalizedTabs[index].items = normalizedTabs[index].items.map((item, itemIndex) => ({
      id: typeof item?.id === "string" && item.id.trim()
        ? item.id.trim().slice(0, 120)
        : "legacy-item-" + index + "-" + itemIndex,
      text: sanitizeMultilineText(item?.text, MAX_ITEM_TEXT_LENGTH),
      done: !!item?.done,
      completedAt: normalizeCompletedAt(item?.completedAt),
      reminderAt: normalizeCompletedAt(item?.reminderAt),
      reminderRepeat: ['daily', 'weekly', 'monthly', 'yearly'].includes(item?.reminderRepeat) ? item.reminderRepeat : 'none',
      reminderTimeZone: typeof item?.reminderTimeZone === 'string' ? item.reminderTimeZone.slice(0, 120) : null,
      reminderDays: Array.isArray(item?.reminderDays) ? [...new Set(item.reminderDays.filter(day => Number.isInteger(day) && day >= 0 && day <= 6))].sort() : null,
      originalTabName: sanitizeSingleLineText(item?.originalTabName, MAX_TAB_NAME_LENGTH) || null
    }));
  });

  let active = Number.isInteger(safe.active) ? safe.active : 0;
  if (active < 0 || active >= normalizedTabs.length) active = 0;

  return { active, tabs: normalizedTabs };
}

function normalizeSettings(settings) {
  const safe = settings && typeof settings === "object" ? settings : {};
  const advanced = safe.advanced && typeof safe.advanced === "object" ? safe.advanced : {};
  return {
    hotkey: typeof safe.hotkey === "string" && safe.hotkey.trim() ? safe.hotkey.trim() : DEFAULT_SETTINGS.hotkey,
    runOnStartup: !!safe.runOnStartup,
    alwaysOnTop: safe.alwaysOnTop === undefined ? true : !!safe.alwaysOnTop,
    autoHideOnBlur: !!safe.autoHideOnBlur,
    showDoneTab: !!safe.showDoneTab,
    advanced: {
      serverUrl: typeof advanced.serverUrl === "string" ? advanced.serverUrl : DEFAULT_SETTINGS.advanced.serverUrl,
      email: typeof advanced.email === "string" ? advanced.email : DEFAULT_SETTINGS.advanced.email,
      password: typeof advanced.password === "string" ? advanced.password : DEFAULT_SETTINGS.advanced.password
    }
  };
}

function normalizeServerUrl(serverUrl) {
  const trimmed = (typeof serverUrl === "string" ? serverUrl.trim() : "").replace(/\/+$/, "");
  if (!trimmed) {
    return "";
  }

  try {
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function getPersistedSettings(settings) {
  const normalized = normalizeSettings(settings);
  return {
    hotkey: normalized.hotkey,
    runOnStartup: normalized.runOnStartup,
    alwaysOnTop: normalized.alwaysOnTop,
    autoHideOnBlur: normalized.autoHideOnBlur,
    showDoneTab: normalized.showDoneTab,
    advanced: {
      serverUrl: normalized.advanced.serverUrl,
      email: normalized.advanced.email
    }
  };
}

function withPassword(settings, password) {
  const normalized = normalizeSettings(settings);
  return normalizeSettings({
    ...normalized,
    advanced: {
      ...normalized.advanced,
      password: typeof password === "string" ? password : ""
    }
  });
}

function normalizeProtectedEntry(entry) {
  if (typeof entry === "string") {
    return {
      encrypted: false,
      value: entry
    };
  }

  const safe = entry && typeof entry === "object" ? entry : {};
  return {
    encrypted: !!safe.encrypted,
    value: typeof safe.value === "string" ? safe.value : ""
  };
}

function canEncryptSecureValues() {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function encodeSecureValue(value) {
  const safeValue = typeof value === "string" ? value : "";
  if (!safeValue) {
    return { encrypted: false, value: "" };
  }
  if (canEncryptSecureValues()) {
    return {
      encrypted: true,
      value: safeStorage.encryptString(safeValue).toString("base64")
    };
  }
  return {
    encrypted: false,
    value: safeValue
  };
}

function decodeSecureValue(entry) {
  const normalized = normalizeProtectedEntry(entry);
  if (!normalized.value) {
    return "";
  }
  if (normalized.encrypted) {
    if (!canEncryptSecureValues()) {
      return "";
    }
    try {
      return safeStorage.decryptString(Buffer.from(normalized.value, "base64"));
    } catch {
      return "";
    }
  }
  return normalized.value;
}

async function readSecureState() {
  const safe = await readJsonFile(getSecureStatePath(), {});
  return {
    password: normalizeProtectedEntry(safe?.password),
    token: normalizeProtectedEntry(safe?.token)
  };
}

async function writeSecureState(state) {
  const safe = state && typeof state === "object" ? state : {};
  return await writeJsonFile(getSecureStatePath(), {
    password: normalizeProtectedEntry(safe.password),
    token: normalizeProtectedEntry(safe.token)
  });
}

async function readStoredPassword() {
  const secureState = await readSecureState();
  return decodeSecureValue(secureState.password);
}

async function persistStoredPassword(password) {
  const secureState = await readSecureState();
  secureState.password = encodeSecureValue(password);
  await writeSecureState(secureState);
  return typeof password === "string" ? password : "";
}

async function readStoredToken() {
  const secureState = await readSecureState();
  return decodeSecureValue(secureState.token);
}

async function persistStoredToken(token) {
  const safeToken = typeof token === "string" ? token : "";
  const secureState = await readSecureState();
  secureState.token = encodeSecureValue(safeToken);
  await writeSecureState(secureState);
  if (!safeToken) {
    await writeSyncMeta({ userId: "" });
  }
  return safeToken;
}

function normalizeSyncMeta(meta) {
  const safe = meta && typeof meta === "object" ? meta : {};
  return {
    recordId: typeof safe.recordId === "string" ? safe.recordId : "",
    version: Number.isFinite(safe.version) ? safe.version : null,
    userId: typeof safe.userId === "string" ? safe.userId : "",
    preferredChecklistId: typeof safe.preferredChecklistId === "string" ? safe.preferredChecklistId : "",
    dirty: !!safe.dirty,
    baseChecklist: safe.baseChecklist && typeof safe.baseChecklist === "object"
      ? normalizeChecklist(cloneValue(safe.baseChecklist))
      : null
  };
}

async function readSyncMeta() {
  return normalizeSyncMeta(await readJsonFile(getSyncMetaPath(), {}));
}

async function writeSyncMeta(meta) {
  const next = { ...(await readSyncMeta()) };
  if (meta && Object.prototype.hasOwnProperty.call(meta, "recordId")) {
    next.recordId = typeof meta.recordId === "string" ? meta.recordId : "";
  }
  if (meta && Object.prototype.hasOwnProperty.call(meta, "version")) {
    next.version = Number.isFinite(meta.version) ? meta.version : null;
  }
  if (meta && Object.prototype.hasOwnProperty.call(meta, "userId")) {
    next.userId = typeof meta.userId === "string" ? meta.userId : "";
  }
  if (meta && Object.prototype.hasOwnProperty.call(meta, "preferredChecklistId")) {
    next.preferredChecklistId = typeof meta.preferredChecklistId === "string" ? meta.preferredChecklistId : "";
  }
  if (meta && Object.prototype.hasOwnProperty.call(meta, "dirty")) {
    next.dirty = !!meta.dirty;
  }
  if (meta && Object.prototype.hasOwnProperty.call(meta, "baseChecklist")) {
    next.baseChecklist = meta.baseChecklist && typeof meta.baseChecklist === "object"
      ? normalizeChecklist(cloneValue(meta.baseChecklist))
      : null;
  }
  return await writeJsonFile(getSyncMetaPath(), next);
}

function getPreferredChecklistId(meta) {
  return sanitizeSingleLineText(meta?.preferredChecklistId, MAX_TAB_NAME_LENGTH);
}

async function clearSyncMeta() {
  await fs.rm(getSyncMetaPath(), { force: true }).catch(() => {});
}

async function resetSyncSession() {
  await persistStoredToken("");
  await clearSyncMeta();
  clearQueuedRemotePush();
}

function normalizeSyncRestorePointValue(value) {
  const safe = value && typeof value === "object" ? value : {};
  const checklist = safe.checklist && typeof safe.checklist === "object"
    ? cloneValue(safe.checklist)
    : null;
  return {
    createdAt: typeof safe.createdAt === "string" ? safe.createdAt : "",
    source: typeof safe.source === "string" ? safe.source : "",
    checklist
  };
}

async function readSyncRestorePoint() {
  const point = normalizeSyncRestorePointValue(await readJsonFile(getSyncRestorePointPath(), null));
  return point.checklist ? point : null;
}

async function getSyncRestorePointInfo() {
  const point = await readSyncRestorePoint();
  if (!point) {
    return {
      available: false,
      createdAt: "",
      source: ""
    };
  }
  return {
    available: true,
    createdAt: point.createdAt,
    source: point.source
  };
}

async function saveSyncRestorePoint(checklist, source = "manual_sync") {
  const point = {
    createdAt: new Date().toISOString(),
    source: typeof source === "string" ? source : "manual_sync",
    checklist: cloneValue(normalizeChecklist(checklist))
  };
  await writeJsonFile(getSyncRestorePointPath(), point);
  return await getSyncRestorePointInfo();
}

function decodeBase64Url(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4;
  const padded = padding ? normalized + "=".repeat(4 - padding) : normalized;
  return Buffer.from(padded, "base64").toString("utf8");
}

function decodeJwtPayload(token) {
  if (typeof token !== "string" || !token.includes(".")) {
    return null;
  }

  try {
    return JSON.parse(decodeBase64Url(token.split(".")[1]));
  } catch {
    return null;
  }
}

function extractUserIdFromToken(token) {
  const payload = decodeJwtPayload(token);
  if (typeof payload?.id === "string" && payload.id) {
    return payload.id;
  }
  if (typeof payload?.sub === "string" && payload.sub) {
    return payload.sub;
  }
  return "";
}

function isTokenFresh(token, minimumRemainingMs = 60 * 1000) {
  const payload = decodeJwtPayload(token);
  if (typeof payload?.exp !== "number") {
    return false;
  }
  return payload.exp * 1000 - Date.now() > minimumRemainingMs;
}

async function loadSettings() {
  const storedSettings = normalizeSettings(await readJsonFile(getSettingsPath(), DEFAULT_SETTINGS));
  const legacyPassword = storedSettings.advanced.password;
  let password = await readStoredPassword();
  let migratedLegacyPassword = false;

  if (!password && legacyPassword) {
    password = await persistStoredPassword(legacyPassword);
    migratedLegacyPassword = true;
  }

  if (legacyPassword && migratedLegacyPassword) {
    await writeJsonFile(getSettingsPath(), getPersistedSettings(storedSettings));
  }

  return withPassword(storedSettings, password);
}

async function loadSyncContext() {
  const settings = await loadSettings();
  const advanced = normalizeSettings(settings).advanced;
  const token = await readStoredToken();
  const meta = await readSyncMeta();
  return {
    settings,
    credentials: {
      serverUrl: normalizeServerUrl(advanced.serverUrl),
      email: advanced.email.trim(),
      password: advanced.password,
      token,
      userId: meta.userId || extractUserIdFromToken(token)
    }
  };
}

function hasSyncCredentials(credentials) {
  return !!(credentials.serverUrl && credentials.email && (credentials.password || credentials.token));
}

function hasCompleteAdvancedSyncSettings(settings) {
  const advanced = normalizeSettings(settings).advanced;
  return !!(
    normalizeServerUrl(advanced.serverUrl) &&
    advanced.email.trim() &&
    advanced.password
  );
}

function getSyncTargetDescription(settings) {
  if (!hasCompleteAdvancedSyncSettings(settings)) {
    return "Local cache only";
  }
  const advanced = normalizeSettings(settings).advanced;
  const serverUrl = normalizeServerUrl(advanced.serverUrl);
  return `PocketBase checklist @ ${serverUrl}`;
}

async function loadAppState() {
  const checklist = normalizeChecklist(await readJsonFile(getChecklistPath(), DEFAULT_CHECKLIST));
  const settings = await loadSettings();
  const syncRestorePoint = await getSyncRestorePointInfo();
  return { checklist, settings, syncRestorePoint };
}

async function saveChecklist(checklist) {
  const normalized = normalizeChecklist(checklist);
  await writeJsonFile(getChecklistPath(), normalized);
  return normalized;
}

function didSyncIdentityChange(previousSettings, nextSettings) {
  const previous = normalizeSettings(previousSettings).advanced;
  const next = normalizeSettings(nextSettings).advanced;
  return normalizeServerUrl(previous.serverUrl) !== normalizeServerUrl(next.serverUrl) ||
    previous.email.trim() !== next.email.trim() ||
    previous.password !== next.password;
}

async function saveSettings(settings) {
  const normalized = normalizeSettings(settings);
  const previousSettings = await loadSettings();
  const authChanged = didSyncIdentityChange(previousSettings, normalized);
  const hasCompleteAdvancedCredentials = hasCompleteAdvancedSyncSettings(normalized);

  await persistStoredPassword(normalized.advanced.password);
  if (authChanged || !hasCompleteAdvancedCredentials) {
    await persistStoredToken("");
    await clearSyncMeta();
    clearQueuedRemotePush();
  }

  await writeJsonFile(getSettingsPath(), getPersistedSettings(normalized));
  applyLoginItemSetting(normalized.runOnStartup);
  if (mainWindow) {
    mainWindow.setAlwaysOnTop(normalized.alwaysOnTop);
  }
  return normalized;
}

async function disconnectSync() {
  const currentSettings = await loadSettings();
  const disconnectedSettings = normalizeSettings({
    ...currentSettings,
    advanced: {
      serverUrl: "",
      email: "",
      password: ""
    }
  });

  await persistStoredPassword("");
  await persistStoredToken("");
  await clearSyncMeta();
  clearQueuedRemotePush();
  await writeJsonFile(getSettingsPath(), getPersistedSettings(disconnectedSettings));

  return {
    ok: true,
    settings: disconnectedSettings,
    syncTarget: getSyncTargetDescription(disconnectedSettings),
    message: "Disconnected PocketBase sync on this desktop."
  };
}

async function useAccessibleChecklist(checklistId, currentChecklist) {
  const safeChecklistId = sanitizeSingleLineText(checklistId, MAX_TAB_NAME_LENGTH);
  const { settings, credentials } = await loadSyncContext();
  if (!hasSyncCredentials(credentials)) {
    return {
      ok: false,
      isError: true,
      checklist: await getFallbackChecklist(currentChecklist),
      settings,
      dataLocation: getDataDir(),
      syncTarget: getSyncTargetDescription(settings),
      syncRestorePoint: await getSyncRestorePointInfo(),
      checklists: [],
      assignedChecklistId: "",
      currentChecklistId: "",
      message: "Enter the PocketBase URL, email, and password in Advanced sync settings first."
    };
  }
  if (!safeChecklistId) {
    return {
      ok: false,
      isError: true,
      checklist: await getFallbackChecklist(currentChecklist),
      settings,
      dataLocation: getDataDir(),
      syncTarget: getSyncTargetDescription(settings),
      syncRestorePoint: await getSyncRestorePointInfo(),
      checklists: [],
      assignedChecklistId: "",
      currentChecklistId: "",
      message: "Select a checklist first."
    };
  }

  clearQueuedRemotePush();

  try {
    const localChecklist = normalizeChecklist(
      currentChecklist && typeof currentChecklist === "object"
        ? currentChecklist
        : await getCachedChecklist()
    );
    await saveSyncRestorePoint(localChecklist, "switch_checklist");

    const auth = await getAuthContext(credentials);
    const userRecord = await fetchCurrentUserRecord(credentials, auth);
    const assignedChecklistId = getAssignedChecklistId(userRecord);
    const selectedRecord = await fetchChecklistRecordById(credentials, auth, safeChecklistId);
    const selectedChecklistId = getChecklistRef(selectedRecord);
    const preferredChecklistId = selectedChecklistId && selectedChecklistId !== assignedChecklistId
      ? selectedChecklistId
      : "";
    const selectedChecklist = normalizeChecklist(cloneValue(extractChecklistData(selectedRecord)));
    await writeJsonFile(getChecklistPath(), selectedChecklist);
    await writeSyncMeta({
      preferredChecklistId,
      recordId: selectedChecklistId || safeChecklistId,
      version: getChecklistRecordVersion(selectedRecord),
      userId: auth.userId || extractUserIdFromToken(auth.token),
      dirty: false,
      baseChecklist: selectedChecklist
    });

    const browser = await listAccessibleChecklistState(credentials, auth).catch(() => ({
      items: [toChecklistBrowserItem(selectedRecord, auth.userId || "", selectedChecklistId || safeChecklistId)],
      assignedChecklistId,
      currentChecklistId: selectedChecklistId || safeChecklistId,
      message: "Checklist switched."
    }));
    return {
      ok: true,
      checklist: selectedChecklist,
      settings,
      dataLocation: getDataDir(),
      syncTarget: getSyncTargetDescription(settings),
      syncRestorePoint: await getSyncRestorePointInfo(),
      checklists: browser.items,
      assignedChecklistId: browser.assignedChecklistId || assignedChecklistId || "",
      currentChecklistId: browser.currentChecklistId || selectedChecklistId || safeChecklistId,
      message: preferredChecklistId
        ? `This desktop will use ${getChecklistRecordLabel(selectedRecord)}.`
        : `This desktop will follow ${getChecklistRecordLabel(selectedRecord)} again.`
    };
  } catch (error) {
    if (isCloudflareChallengeError(error)) {
      return {
        ok: false,
        isError: true,
        verificationRequired: true,
        checklist: await getFallbackChecklist(currentChecklist),
        settings,
        dataLocation: getDataDir(),
        syncTarget: getSyncTargetDescription(settings),
        syncRestorePoint: await getSyncRestorePointInfo(),
        checklists: [],
        assignedChecklistId: "",
        currentChecklistId: "",
        message: "Cloudflare blocked this desktop request. Try Verify access in Advanced sync if needed, then try switching checklists again."
      };
    }
    return {
      ok: false,
      isError: true,
      checklist: await getFallbackChecklist(currentChecklist),
      settings,
      dataLocation: getDataDir(),
      syncTarget: getSyncTargetDescription(settings),
      syncRestorePoint: await getSyncRestorePointInfo(),
      checklists: [],
      assignedChecklistId: "",
      currentChecklistId: "",
      message: error?.message || "Could not switch the selected PocketBase checklist on this desktop."
    };
  }
}

async function createChecklistBackup() {
  const ts = new Date().toISOString().replace(/[.:]/g, "-");
  const backupPath = path.join(getBackupsDir(), `checkTabs-${ts}.json`);
  await fs.copyFile(getChecklistPath(), backupPath);
  await cleanupBackups(5);
}

async function cleanupBackups(maxCount) {
  const files = await listBackups();
  if (files.length <= maxCount) return;
  const removeList = files.slice(maxCount);
  await Promise.all(removeList.map((file) => fs.unlink(path.join(getBackupsDir(), file.name)).catch(() => {})));
}

async function listBackups() {
  const entries = await fs.readdir(getBackupsDir(), { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name);

  const withMeta = await Promise.all(
    files.map(async (name) => {
      const fullPath = path.join(getBackupsDir(), name);
      const stat = await fs.stat(fullPath);
      return { name, mtimeMs: stat.mtimeMs };
    })
  );

  withMeta.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return withMeta;
}

async function restoreBackup(name) {
  if (typeof name !== "string" || path.basename(name) !== name || !name.endsWith(".json")) {
    throw new Error("Select a valid checklist backup.");
  }

  const backups = await listBackups();
  if (!backups.some((backup) => backup.name === name)) {
    throw new Error("The selected checklist backup is no longer available.");
  }

  const backupPath = path.join(getBackupsDir(), name);
  await fs.copyFile(backupPath, getChecklistPath());
  return normalizeChecklist(await readJsonFile(getChecklistPath(), DEFAULT_CHECKLIST));
}

function getChecklistSignature(checklist) {
  return JSON.stringify(cloneValue(normalizeChecklist(checklist)));
}

async function getCachedChecklist() {
  return normalizeChecklist(await readJsonFile(getChecklistPath(), DEFAULT_CHECKLIST));
}

async function markLocalChecklistDirty() {
  await writeSyncMeta({ dirty: true });
}

async function clearDirtyIfChecklistStillCurrent(checklist) {
  if (getChecklistSignature(await getCachedChecklist()) === getChecklistSignature(checklist)) {
    await writeSyncMeta({ dirty: false });
  }
}

function buildApiUrl(serverUrl, requestPath, query) {
  const url = new URL(requestPath.replace(/^\/+/, ""), `${normalizeServerUrl(serverUrl)}/`);
  if (query && typeof query === "object") {
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    });
  }
  return url.toString();
}

async function readResponsePayload(response) {
  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function looksLikeCloudflareChallenge(payload) {
  if (typeof payload !== "string" || !payload) {
    return false;
  }

  const normalized = payload.toLowerCase();
  return (
    normalized.includes("<html") &&
    (
      normalized.includes("just a moment") ||
      normalized.includes("cf_chl") ||
      normalized.includes("cloudflare") ||
      normalized.includes("enable javascript and cookies to continue")
    )
  );
}

function isCloudflareChallengeError(error) {
  return !!error?.isCloudflareChallenge;
}

function getResponseErrorMessage(payload, fallback, status) {
  if (payload && typeof payload === "object" && typeof payload.message === "string" && payload.message) {
    return payload.message;
  }
  if (looksLikeCloudflareChallenge(payload)) {
    return "Cloudflare is blocking PocketBase API access. Allow this device to reach the PocketBase API without a browser challenge, especially for /api/ requests.";
  }
  if (typeof payload === "string" && payload) {
    return payload;
  }
  return status ? `${fallback} (${status})` : fallback;
}

async function rawJsonRequest({ credentials, requestPath, query, method = "GET", token = "", body, errorMessage }) {
  const headers = {
    Accept: "application/json"
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (token) {
    headers.Authorization = token;
  }

  const response = await getApiSession().fetch(buildApiUrl(credentials.serverUrl, requestPath, query), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await readResponsePayload(response);

  if (response.ok) {
    return payload;
  }

  const error = new Error(getResponseErrorMessage(payload, errorMessage || "PocketBase request failed.", response.status));
  error.status = response.status;
  error.payload = payload;
  error.isCloudflareChallenge = looksLikeCloudflareChallenge(payload);
  throw error;
}

function getApiSession() {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
    return mainWindow.webContents.session;
  }
  return session.defaultSession;
}

async function openDesktopVerificationWindow(serverUrl) {
  const normalizedUrl = normalizeServerUrl(serverUrl);
  if (!normalizedUrl) {
    throw new Error("Enter the PocketBase URL in Advanced sync settings first.");
  }

  if (verificationWindow && !verificationWindow.isDestroyed()) {
    verificationWindow.focus();
    return {
      ok: true,
      message: "Use the verification window if this network needs a Cloudflare check, then return here and press Connect again."
    };
  }

  verificationWindow = new BrowserWindow({
    title: "Verify PocketBase Access",
    width: 520,
    height: 720,
    parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : null,
    modal: false,
    show: false,
    autoHideMenuBar: true,
    resizable: true,
    minimizable: true,
    maximizable: true,
    icon: path.join(__dirname, "logo.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });

  verificationWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url && /^https?:/i.test(url)) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  verificationWindow.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });

  verificationWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  verificationWindow.once("ready-to-show", () => {
    if (verificationWindow && !verificationWindow.isDestroyed()) {
      verificationWindow.show();
      verificationWindow.focus();
    }
  });

  verificationWindow.on("closed", () => {
    verificationWindow = null;
  });

  await verificationWindow.loadURL(normalizedUrl);

  return {
    ok: true,
    message: "Complete any Cloudflare check in the verification window. When the site loads normally, close that window and press Connect again."
  };
}

async function authenticateWithPassword(credentials) {
  const result = await require('./renderer/auth-client.js').authenticate((requestPath, body) => rawJsonRequest({
    credentials, requestPath, method: 'POST', body, errorMessage: 'Could not log in to PocketBase.'
  }), credentials.email, credentials.password, requestVerificationCode);

  const token = typeof result?.token === "string" ? result.token : "";
  if (!token) {
    throw new Error("PocketBase login did not return an auth token.");
  }

  await persistStoredToken(token);
  const userId = typeof result?.record?.id === "string" ? result.record.id : extractUserIdFromToken(token);
  if (userId) {
    await writeSyncMeta({ userId });
  }

  return { token, userId };
}

async function refreshAuthToken(credentials) {
  const result = await rawJsonRequest({
    credentials,
    requestPath: `/api/collections/${AUTH_COLLECTION}/auth-refresh`,
    method: "POST",
    token: credentials.token,
    errorMessage: "Could not refresh PocketBase auth."
  });

  const token = typeof result?.token === "string" ? result.token : credentials.token;
  if (!token) {
    throw new Error("PocketBase auth refresh did not return a token.");
  }

  await persistStoredToken(token);
  const userId = typeof result?.record?.id === "string" ? result.record.id : credentials.userId || extractUserIdFromToken(token);
  if (userId) {
    await writeSyncMeta({ userId });
  }

  return { token, userId };
}

function createSyncConflictError(message, code) {
  const error = new Error(message);
  error.isConflict = true;
  error.code = code;
  return error;
}

function buildNewItemMerge(baseChecklist, localChecklist, remoteChecklist) {
  if (!baseChecklist) return null;
  const base = normalizeChecklist(cloneValue(baseChecklist));
  const local = normalizeChecklist(cloneValue(localChecklist));
  const merged = normalizeChecklist(cloneValue(remoteChecklist));
  const baseIds = new Set(base.tabs.flatMap((tab) => tab.items.map((item) => item.id)));
  const mergedIds = new Set(merged.tabs.flatMap((tab) => tab.items.map((item) => item.id)));
  const additions = [];

  local.tabs.forEach((localTab) => {
    const newItems = localTab.items.filter((item) => !baseIds.has(item.id) && !mergedIds.has(item.id));
    if (!newItems.length) return;
    let targetTab = merged.tabs.find((tab) => tab.id === localTab.id);
    if (!targetTab) {
      targetTab = { id: localTab.id, name: localTab.name, system: localTab.system, items: [] };
      merged.tabs.push(targetTab);
    }
    newItems.forEach((item) => {
      targetTab.items.push(cloneValue(item));
      mergedIds.add(item.id);
      additions.push({ id: item.id, text: item.text, tabName: targetTab.name });
    });
  });

  return additions.length ? { checklist: normalizeChecklist(merged), additions } : null;
}

function getRelationRecordId(value) {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && value.length > 0) {
    return getRelationRecordId(value[0]);
  }
  if (value && typeof value === "object" && typeof value.id === "string") {
    return value.id;
  }
  return "";
}

function normalizeChecklistCollectionName(value) {
  return value === SHARED_CHECKLIST_COLLECTION
    ? SHARED_CHECKLIST_COLLECTION
    : PERSONAL_CHECKLIST_COLLECTION;
}

function getChecklistRecordCollectionName(record, fallback = PERSONAL_CHECKLIST_COLLECTION) {
  const collectionName = typeof record?.collectionName === "string"
    ? record.collectionName
    : fallback;
  return normalizeChecklistCollectionName(collectionName);
}

function withChecklistCollection(record, collectionName) {
  if (!record || typeof record !== "object") {
    return null;
  }

  return {
    ...record,
    collectionName: getChecklistRecordCollectionName(record, collectionName)
  };
}

function encodeChecklistRef(collectionName, recordId) {
  const safeRecordId = sanitizeSingleLineText(recordId, 80);
  if (!safeRecordId) {
    return "";
  }

  return `${normalizeChecklistCollectionName(collectionName)}:${safeRecordId}`;
}

function parseChecklistRef(value) {
  const raw = sanitizeSingleLineText(value, 160);
  if (!raw) {
    return {
      collectionName: "",
      recordId: ""
    };
  }

  const separatorIndex = raw.indexOf(":");
  if (separatorIndex > 0) {
    const collectionName = raw.slice(0, separatorIndex);
    const recordId = raw.slice(separatorIndex + 1);
    if (
      (collectionName === PERSONAL_CHECKLIST_COLLECTION || collectionName === SHARED_CHECKLIST_COLLECTION) &&
      recordId
    ) {
      return {
        collectionName,
        recordId
      };
    }
  }

  return {
    collectionName: "",
    recordId: raw
  };
}

function getChecklistRef(record, fallbackCollection = PERSONAL_CHECKLIST_COLLECTION) {
  return encodeChecklistRef(
    getChecklistRecordCollectionName(record, fallbackCollection),
    typeof record?.id === "string" ? record.id : ""
  );
}

function checklistRefMatchesRecord(checklistRef, record) {
  const parsedRef = parseChecklistRef(checklistRef);
  const recordId = typeof record?.id === "string" ? record.id : "";

  if (!parsedRef.recordId || !recordId) {
    return false;
  }

  if (parsedRef.collectionName) {
    return (
      parsedRef.collectionName === getChecklistRecordCollectionName(record) &&
      parsedRef.recordId === recordId
    );
  }

  return parsedRef.recordId === recordId;
}

function getExpandedSingleRecord(record, fieldName) {
  const expanded = record?.expand?.[fieldName];
  if (Array.isArray(expanded)) {
    return expanded[0] && typeof expanded[0] === "object" ? expanded[0] : null;
  }
  return expanded && typeof expanded === "object" ? expanded : null;
}

function getExpandedChecklistRecord(userRecord, fieldName, collectionName) {
  return withChecklistCollection(getExpandedSingleRecord(userRecord, fieldName), collectionName);
}

function getPersonalChecklistId(userRecord) {
  return getRelationRecordId(userRecord?.[USER_DEFAULT_CHECKLIST_FIELD]);
}

function getAssignedSharedChecklistId(userRecord) {
  return getRelationRecordId(userRecord?.[USER_ASSIGNED_SHARED_CHECKLIST_FIELD]);
}

function getAssignedChecklistId(userRecord) {
  const assignedSharedChecklistId = getAssignedSharedChecklistId(userRecord);
  if (assignedSharedChecklistId) {
    return encodeChecklistRef(SHARED_CHECKLIST_COLLECTION, assignedSharedChecklistId);
  }

  const personalChecklistId = getPersonalChecklistId(userRecord);
  if (personalChecklistId) {
    return encodeChecklistRef(PERSONAL_CHECKLIST_COLLECTION, personalChecklistId);
  }

  return "";
}

function getChecklistRecordVersion(record) {
  return Number.isFinite(record?.version) ? record.version : null;
}

function getChecklistRecordLabel(record) {
  const name = sanitizeSingleLineText(record?.name, MAX_TAB_NAME_LENGTH);
  const shareKey = sanitizeSingleLineText(record?.shareKey, MAX_TAB_NAME_LENGTH);
  if (name) {
    return name;
  }
  if (getChecklistRecordCollectionName(record) === PERSONAL_CHECKLIST_COLLECTION || shareKey.startsWith("personal-")) {
    return "Personal checklist";
  }
  if (shareKey) {
    return "Shared checklist";
  }
  return "Checklist";
}

function isPersonalChecklistRecord(record, userId = "") {
  if (getChecklistRecordCollectionName(record) === PERSONAL_CHECKLIST_COLLECTION) {
    return true;
  }

  const shareKey = sanitizeSingleLineText(record?.shareKey, MAX_TAB_NAME_LENGTH);
  return !!(userId && shareKey === `personal-${userId}`);
}

function getChecklistAccessRole(record, userId = "") {
  const ownerId = getRelationRecordId(record?.owner);
  if (userId && ownerId === userId) {
    return "owner";
  }

  const sharedWith = Array.isArray(record?.sharedWith)
    ? record.sharedWith.map((value) => getRelationRecordId(value)).filter((value) => !!value)
    : [];
  if (userId && sharedWith.includes(userId)) {
    return "shared";
  }
  return "";
}

function toChecklistBrowserItem(record, userId = "", currentChecklistId = "") {
  const id = getChecklistRef(record);
  const name = sanitizeSingleLineText(record?.name, MAX_TAB_NAME_LENGTH);
  const shareKey = sanitizeSingleLineText(record?.shareKey, MAX_TAB_NAME_LENGTH);
  const isPersonal = isPersonalChecklistRecord(record, userId);
  const role = getChecklistAccessRole(record, userId);
  return {
    id,
    name,
    shareKey,
    label: name || (isPersonal ? "Personal checklist" : "Shared checklist"),
    role,
    isPersonal,
    isAssigned: !!(id && id === currentChecklistId)
  };
}

function compareChecklistBrowserItems(a, b) {
  if (!!a?.isAssigned !== !!b?.isAssigned) {
    return a?.isAssigned ? -1 : 1;
  }
  if (!!a?.isPersonal !== !!b?.isPersonal) {
    return a?.isPersonal ? -1 : 1;
  }

  const left = typeof a?.label === "string" ? a.label : "";
  const right = typeof b?.label === "string" ? b.label : "";
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

async function listAccessibleChecklistState(credentials, auth) {
  const meta = await readSyncMeta();
  const preferredChecklistId = getPreferredChecklistId(meta);
  const userRecord = await fetchCurrentUserRecord(credentials, auth);
  const assignedChecklistId = getAssignedChecklistId(userRecord);
  const personalRecord = getExpandedChecklistRecord(
    userRecord,
    USER_DEFAULT_CHECKLIST_FIELD,
    PERSONAL_CHECKLIST_COLLECTION
  ) || await findPersonalChecklistRecord(credentials, auth).catch(() => null);
  const sharedRecords = await listAccessibleSharedChecklistRecords(credentials, auth).catch(() => []);

  const seen = new Set();
  const records = [];
  const appendRecord = (record) => {
    const checklistRef = getChecklistRef(record);
    if (!record || typeof record !== "object" || !checklistRef || seen.has(checklistRef)) {
      return;
    }
    seen.add(checklistRef);
    records.push(record);
  };

  appendRecord(personalRecord);
  sharedRecords.forEach((record) => appendRecord(record));

  if (assignedChecklistId && !seen.has(assignedChecklistId)) {
    appendRecord(await tryFetchChecklistRecordById(credentials, auth, assignedChecklistId).catch(() => null));
  }

  if (preferredChecklistId && !seen.has(preferredChecklistId)) {
    appendRecord(await tryFetchChecklistRecordById(credentials, auth, preferredChecklistId).catch(() => null));
  }

  const effectivePreferredChecklistId = preferredChecklistId && seen.has(preferredChecklistId)
    ? preferredChecklistId
    : "";
  if (preferredChecklistId && !effectivePreferredChecklistId) {
    await writeSyncMeta({ preferredChecklistId: "" });
  }

  const currentChecklistId = effectivePreferredChecklistId || assignedChecklistId || getChecklistRef(personalRecord);
  const items = records
    .map((record) => toChecklistBrowserItem(
      record,
      auth?.userId || "",
      currentChecklistId
    ))
    .sort(compareChecklistBrowserItems);

  let message = "";
  if (items.length === 0) {
    message = "No accessible checklists yet. New users should receive a personal checklist automatically. Refresh list in a moment, or ask an admin to assign one.";
  } else if (effectivePreferredChecklistId && effectivePreferredChecklistId !== assignedChecklistId) {
    message = "This desktop is using its own selected checklist.";
  } else if (getAssignedSharedChecklistId(userRecord)) {
    message = "This desktop is following its assigned shared checklist.";
  } else if (personalRecord) {
    message = "This desktop is following its personal checklist.";
  } else {
    message = `${items.length} accessible checklist${items.length === 1 ? "" : "s"} loaded.`;
  }

  return {
    items,
    assignedChecklistId,
    currentChecklistId,
    message
  };
}

async function browseAccessibleChecklists() {
  const { settings, credentials } = await loadSyncContext();
  if (!hasSyncCredentials(credentials)) {
    return {
      ok: false,
      checklists: [],
      assignedChecklistId: "",
      currentChecklistId: "",
      syncTarget: getSyncTargetDescription(settings),
      message: "Enter the PocketBase URL, email, and password in Advanced sync settings first."
    };
  }

  try {
    const auth = await getAuthContext(credentials);
    let browser = await listAccessibleChecklistState(credentials, auth);
    if (!browser.currentChecklistId && browser.items.length === 0) {
      await createPersonalChecklistRecord(credentials, auth, await getCachedChecklist());
      browser = await listAccessibleChecklistState(credentials, auth);
      if (browser.currentChecklistId) {
        browser = {
          ...browser,
          message: "Created a personal checklist for this PocketBase user."
        };
      }
    }
    return {
      ok: true,
      checklists: browser.items,
      assignedChecklistId: browser.assignedChecklistId,
      currentChecklistId: browser.currentChecklistId,
      syncTarget: getSyncTargetDescription(settings),
      message: browser.message
    };
  } catch (error) {
    if (isCloudflareChallengeError(error)) {
      return {
        ok: false,
        isError: true,
        verificationRequired: true,
        checklists: [],
        assignedChecklistId: "",
        currentChecklistId: "",
        syncTarget: getSyncTargetDescription(settings),
        message: "Cloudflare blocked this desktop request. Try Verify access in Advanced sync if needed, then refresh the list."
      };
    }
    return {
      ok: false,
      checklists: [],
      assignedChecklistId: "",
      currentChecklistId: "",
      syncTarget: getSyncTargetDescription(settings),
      message: error?.message || "Could not load the available PocketBase checklists."
    };
  }
}

async function getAuthContext(credentials) {
  if (!credentials.serverUrl) {
    throw new Error("Enter the PocketBase URL in Advanced sync settings.");
  }
  if (!credentials.email) {
    throw new Error("Enter the PocketBase login email in Advanced sync settings.");
  }

  if (credentials.token) {
    try {
      return await refreshAuthToken(credentials);
    } catch (error) {
      if (error?.status !== 401) {
        if (isTokenFresh(credentials.token)) {
          const userId = credentials.userId || extractUserIdFromToken(credentials.token);
          if (userId) await writeSyncMeta({ userId });
          return { token: credentials.token, userId };
        }
        throw error;
      }
      await persistStoredToken("");
    }
  }

  if (!credentials.password) {
    throw new Error("Enter the PocketBase password in Advanced sync settings.");
  }

  return await authenticateWithPassword(credentials);
}

async function requestWithAuth({ credentials, auth, requestPath, query, method = "GET", body, errorMessage }) {
  try {
    return await rawJsonRequest({
      credentials,
      requestPath,
      query,
      method,
      token: auth.token,
      body,
      errorMessage
    });
  } catch (error) {
    if (error?.status !== 401 || !credentials.password) {
      throw error;
    }

    await persistStoredToken("");
    const freshAuth = await authenticateWithPassword(credentials);
    return await rawJsonRequest({
      credentials,
      requestPath,
      query,
      method,
      token: freshAuth.token,
      body,
      errorMessage
    });
  }
}

async function cacheChecklistRecord(record, userId = "") {
  if (!record || typeof record !== "object") {
    return;
  }

  const meta = await readSyncMeta();
  await writeSyncMeta({
    recordId: getChecklistRef(record),
    version: getChecklistRecordVersion(record),
    userId: userId || meta.userId
  });
}

async function fetchCurrentUserRecord(credentials, auth) {
  if (!auth?.userId) {
    throw new Error("PocketBase auth did not include a user id.");
  }

  return await requestWithAuth({
    credentials,
    auth,
    requestPath: `/api/collections/${AUTH_COLLECTION}/records/${auth.userId}`,
    query: {
      expand: `${USER_DEFAULT_CHECKLIST_FIELD},${USER_ASSIGNED_SHARED_CHECKLIST_FIELD}`
    },
    errorMessage: "Could not load the current PocketBase user."
  });
}

async function fetchChecklistRecordById(
  credentials,
  auth,
  checklistRef,
  accessMessage = "This PocketBase user cannot access the selected checklist on this desktop anymore."
) {
  const resolvedRecord = await tryFetchChecklistRecordById(credentials, auth, checklistRef);
  if (resolvedRecord) {
    return resolvedRecord;
  }
  throw new Error(accessMessage);
}

async function tryFetchChecklistRecordFromCollection(credentials, auth, collectionName, recordId) {
  if (!recordId) {
    return null;
  }

  try {
    const record = await requestWithAuth({
      credentials,
      auth,
      requestPath: `/api/collections/${collectionName}/records/${recordId}`,
      errorMessage: "Could not load the checklist."
    });
    return withChecklistCollection(record, collectionName);
  } catch (error) {
    if (error?.status === 403 || error?.status === 404) {
      return null;
    }
    throw error;
  }
}

async function tryFetchChecklistRecordById(credentials, auth, checklistRef) {
  const parsedRef = parseChecklistRef(checklistRef);
  if (!parsedRef.recordId) {
    return null;
  }

  if (parsedRef.collectionName) {
    return await tryFetchChecklistRecordFromCollection(
      credentials,
      auth,
      parsedRef.collectionName,
      parsedRef.recordId
    );
  }

  return await tryFetchChecklistRecordFromCollection(
    credentials,
    auth,
    PERSONAL_CHECKLIST_COLLECTION,
    parsedRef.recordId
  ) || await tryFetchChecklistRecordFromCollection(
    credentials,
    auth,
    SHARED_CHECKLIST_COLLECTION,
    parsedRef.recordId
  );
}

async function assignChecklistToUser(credentials, auth, checklistId) {
  if (!auth?.userId || !checklistId) {
    throw new Error("Could not assign a checklist to this PocketBase user.");
  }

  await requestWithAuth({
    credentials,
    auth,
    requestPath: `/api/collections/${AUTH_COLLECTION}/records/${auth.userId}`,
    method: "PATCH",
    body: {
      [USER_DEFAULT_CHECKLIST_FIELD]: checklistId
    },
    errorMessage: "Could not assign a checklist to this PocketBase user."
  });
}

async function findPersonalChecklistRecord(credentials, auth) {
  if (!auth?.userId) {
    return null;
  }

  const result = await requestWithAuth({
    credentials,
    auth,
    requestPath: `/api/collections/${PERSONAL_CHECKLIST_COLLECTION}/records`,
    query: {
      page: 1,
      perPage: 1,
      filter: `shareKey="personal-${auth.userId}" && owner="${auth.userId}"`
    },
      errorMessage: "Could not load the checklist."
  });

  return Array.isArray(result?.items)
    ? withChecklistCollection(result.items[0] || null, PERSONAL_CHECKLIST_COLLECTION)
    : null;
}

async function createPersonalChecklistRecord(credentials, auth, checklist) {
  const userId = auth?.userId || extractUserIdFromToken(auth?.token || "");
  if (!userId) {
    throw new Error("PocketBase auth did not include a user id.");
  }

  const normalizedChecklist = normalizeChecklist(
    checklist && typeof checklist === "object"
      ? checklist
      : await getCachedChecklist()
  );
  const body = {
    shareKey: `personal-${userId}`,
    name: sanitizeSingleLineText(`${credentials.email.trim() || userId} checklist`, MAX_TAB_NAME_LENGTH) || "Personal checklist",
    owner: userId,
    data: cloneValue(normalizedChecklist),
    version: 1
  };

  body.updatedBy = userId;

  try {
    const created = await requestWithAuth({
      credentials,
      auth,
      requestPath: `/api/collections/${PERSONAL_CHECKLIST_COLLECTION}/records`,
      method: "POST",
      body,
      errorMessage: "Could not create a personal PocketBase checklist for this user."
    });
    const personalRecord = withChecklistCollection(created, PERSONAL_CHECKLIST_COLLECTION);
    await assignChecklistToUser(credentials, auth, created.id);
    await cacheChecklistRecord(personalRecord, userId);
    await clearDirtyIfChecklistStillCurrent(normalizedChecklist);
    return personalRecord;
  } catch (error) {
    const existing = await findPersonalChecklistRecord(credentials, auth).catch(() => null);
    if (existing) {
      await assignChecklistToUser(credentials, auth, existing.id);
      await cacheChecklistRecord(existing, userId);
      return existing;
    }
    throw error;
  }
}

async function listAccessibleSharedChecklistRecords(credentials, auth) {
  const result = await requestWithAuth({
    credentials,
    auth,
    requestPath: `/api/collections/${SHARED_CHECKLIST_COLLECTION}/records`,
    query: {
      page: 1,
      perPage: 200
    },
    errorMessage: "Could not load the available PocketBase checklists."
  });

  return Array.isArray(result?.items)
    ? result.items.map((record) => withChecklistCollection(record, SHARED_CHECKLIST_COLLECTION)).filter((record) => !!record)
    : [];
}

async function resolveChecklistRecord(credentials, auth, currentChecklist, { cacheRecord = false } = {}) {
  const meta = await readSyncMeta();
  const preferredChecklistId = getPreferredChecklistId(meta);
  const userRecord = await fetchCurrentUserRecord(credentials, auth);
  const assignedSharedChecklistId = getAssignedSharedChecklistId(userRecord);
  let personalRecord = getExpandedChecklistRecord(
    userRecord,
    USER_DEFAULT_CHECKLIST_FIELD,
    PERSONAL_CHECKLIST_COLLECTION
  );
  if (!personalRecord) {
    personalRecord = await findPersonalChecklistRecord(credentials, auth);
  }

  let createdPersonal = false;
  if (!personalRecord) {
    personalRecord = await createPersonalChecklistRecord(credentials, auth, currentChecklist);
    createdPersonal = true;
  }

  const assignedChecklistId = assignedSharedChecklistId
    ? encodeChecklistRef(SHARED_CHECKLIST_COLLECTION, assignedSharedChecklistId)
    : getChecklistRef(personalRecord, PERSONAL_CHECKLIST_COLLECTION);
  const expandedAssignedSharedChecklist = assignedSharedChecklistId
    ? getExpandedChecklistRecord(
      userRecord,
      USER_ASSIGNED_SHARED_CHECKLIST_FIELD,
      SHARED_CHECKLIST_COLLECTION
    )
    : null;
  const assignedRecord = assignedSharedChecklistId
    ? expandedAssignedSharedChecklist || await fetchChecklistRecordById(
      credentials,
      auth,
      assignedChecklistId,
      "This PocketBase user cannot access its assigned shared checklist. Add the user to shared access or make them the owner in PocketBase."
    )
    : personalRecord;

  if (preferredChecklistId) {
    const preferredRecord = preferredChecklistId === assignedChecklistId && assignedRecord
      ? assignedRecord
      : await tryFetchChecklistRecordById(credentials, auth, preferredChecklistId);
    if (preferredRecord) {
      if (cacheRecord) {
        await cacheChecklistRecord(preferredRecord, auth.userId || meta.userId);
      }
      return {
        record: preferredRecord,
        assignmentChanged: !!meta.recordId && !checklistRefMatchesRecord(meta.recordId, preferredRecord),
        createdDefault: false,
        usingPreferred: preferredChecklistId !== assignedChecklistId
      };
    }

    await writeSyncMeta({ preferredChecklistId: "" });
  }

  if (assignedRecord) {
    if (cacheRecord) {
      await cacheChecklistRecord(assignedRecord, auth.userId || meta.userId);
    }
    return {
      record: assignedRecord,
      assignmentChanged: !!meta.recordId && !checklistRefMatchesRecord(meta.recordId, assignedRecord),
      createdDefault: createdPersonal && !assignedSharedChecklistId,
      usingPreferred: false
    };
  }

  throw new Error("This PocketBase user does not have a usable checklist assignment right now.");
}

function extractChecklistData(record) {
  const rawData = record?.data;
  if (rawData && typeof rawData === "object") {
    return rawData;
  }
  if (typeof rawData === "string" && rawData.trim()) {
    return JSON.parse(rawData);
  }
  throw new Error("The current PocketBase checklist for this desktop does not contain valid checklist JSON.");
}

async function pushChecklistToRemote(checklist, options = {}) {
  const { credentials } = await loadSyncContext();
  if (!hasSyncCredentials(credentials)) {
    return;
  }

  let normalizedChecklist = normalizeChecklist(checklist);
  const auth = await getAuthContext(credentials);
  const resolved = await resolveChecklistRecord(credentials, auth, normalizedChecklist);
  const meta = await readSyncMeta();
  const record = resolved.record;
  const userId = auth.userId || meta.userId || extractUserIdFromToken(auth.token);
  const remoteVersion = getChecklistRecordVersion(record);
  const recordRef = getChecklistRef(record);
  const recordCollectionName = getChecklistRecordCollectionName(record);
  let knownVersion = checklistRefMatchesRecord(meta.recordId, record) ? meta.version : null;

  if (resolved.createdDefault) {
    await clearDirtyIfChecklistStillCurrent(normalizedChecklist);
    return;
  }

  if (resolved.assignmentChanged && meta.dirty) {
    throw createSyncConflictError(
      "This PocketBase user was reassigned to a different checklist. Pull latest to switch over safely.",
      "assigned_changed"
    );
  }

  if (!Number.isFinite(knownVersion)) {
      throw createSyncConflictError(
      "This desktop has not synced its current PocketBase checklist yet. Pull latest before pushing more changes.",
        "unknown_base"
      );
  }

  if (Number.isFinite(remoteVersion) && remoteVersion !== knownVersion) {
    const merge = buildNewItemMerge(meta.baseChecklist, normalizedChecklist, extractChecklistData(record));
    if (!merge) {
      throw createSyncConflictError(
        "The server checklist changed, and there are no safe new offline tasks to merge automatically.",
        "remote_changed"
      );
    }
    if (!options.allowNewItemMerge) {
      const error = createSyncConflictError(
        "The server checklist changed while this desktop was offline. Review the new offline tasks before merging.",
        "merge_required"
      );
      error.mergeRequired = true;
      error.mergeAdditions = merge.additions;
      throw error;
    }
    normalizedChecklist = merge.checklist;
    knownVersion = remoteVersion;
  }

  const nextVersion = knownVersion + 1;
  const body = {
    data: cloneValue(normalizedChecklist),
    version: nextVersion
  };

  if (userId) {
    body.updatedBy = userId;
  }

  const updated = await requestWithAuth({
    credentials,
    auth,
    requestPath: `/api/collections/${recordCollectionName}/records/${record.id}`,
    method: "PATCH",
    body,
    errorMessage: "Could not push the checklist to PocketBase."
  });

  if (updated && typeof updated === "object") {
    await cacheChecklistRecord(updated, userId);
  } else {
    await writeSyncMeta({
      recordId: recordRef,
      version: nextVersion,
      userId
    });
  }
  await clearDirtyIfChecklistStillCurrent(normalizedChecklist);
  await writeSyncMeta({ baseChecklist: normalizedChecklist });
  return normalizedChecklist;
}

function clearQueuedRemotePush() {
  clearTimeout(remotePushTimer);
  remotePushTimer = null;
  queuedRemoteChecklist = null;
}

function queueRemotePush(checklist) {
  queuedRemoteChecklist = cloneValue(normalizeChecklist(checklist));
  clearTimeout(remotePushTimer);
  remotePushTimer = setTimeout(() => {
    remotePushTimer = null;
    remotePushPromise = remotePushPromise
      .catch(() => {})
      .then(async () => {
        const nextChecklist = queuedRemoteChecklist;
        queuedRemoteChecklist = null;
        if (!nextChecklist) {
          return;
        }

        try {
          await pushChecklistToRemote(nextChecklist);
        } catch {
          // Keep local saves fast even if the remote sync is unavailable.
        }
      });
  }, REMOTE_PUSH_DELAY_MS);
}

async function getFallbackChecklist(currentChecklist) {
  if (currentChecklist && typeof currentChecklist === "object") {
    return normalizeChecklist(currentChecklist);
  }
  return await getCachedChecklist();
}

async function pullChecklistFromRemote(currentChecklist) {
  const { settings, credentials } = await loadSyncContext();
  if (!hasSyncCredentials(credentials)) {
    return {
      ok: false,
      isError: false,
      checklist: await getFallbackChecklist(currentChecklist),
      settings,
      dataLocation: getDataDir(),
      syncTarget: getSyncTargetDescription(settings),
      syncRestorePoint: await getSyncRestorePointInfo(),
      message: "Enter the PocketBase URL, email, and password in Advanced sync settings."
    };
  }

  const auth = await getAuthContext(credentials);
  const resolved = await resolveChecklistRecord(credentials, auth, currentChecklist, { cacheRecord: false });
  const record = resolved.record;
  const checklist = normalizeChecklist(cloneValue(extractChecklistData(record)));
  await writeJsonFile(getChecklistPath(), checklist);
  await writeSyncMeta({
    recordId: getChecklistRef(record),
    version: getChecklistRecordVersion(record),
    userId: auth.userId || extractUserIdFromToken(auth.token),
    dirty: false,
    baseChecklist: checklist
  });

  return {
    ok: true,
    checklist,
    settings,
    dataLocation: getDataDir(),
    syncTarget: getSyncTargetDescription(settings),
    syncRestorePoint: await getSyncRestorePointInfo(),
    message: resolved.createdDefault
      ? "Created and synced a personal PocketBase checklist for this user."
      : resolved.usingPreferred
        ? `Pulled ${getChecklistRecordLabel(record)} for this desktop.`
        : `Pulled ${getChecklistRecordLabel(record)}.`
  };
}

async function restoreSyncRestorePoint() {
  const point = await readSyncRestorePoint();
  if (!point) {
    return {
      ok: false,
      message: "No local pre-sync backup is available right now.",
      syncRestorePoint: await getSyncRestorePointInfo()
    };
  }

  clearQueuedRemotePush();
  const checklist = normalizeChecklist(cloneValue(point.checklist));
  await writeJsonFile(getChecklistPath(), checklist);
  await markLocalChecklistDirty();

  return {
    ok: true,
    checklist,
    syncRestorePoint: await getSyncRestorePointInfo(),
    message: "Restored the local pre-sync backup. Review it, then sync when you are ready."
  };
}

async function syncNow(currentChecklist, options = {}) {
  clearQueuedRemotePush();
  try {
    await remotePushPromise.catch(() => {});
    const localChecklist = normalizeChecklist(
      currentChecklist && typeof currentChecklist === "object"
        ? currentChecklist
        : await getCachedChecklist()
    );
    const syncSource = typeof options?.source === "string" && options.source.trim()
      ? options.source.trim()
      : "manual_sync";
    const shouldSaveRestorePoint = options?.saveRestorePoint !== false;
    if (shouldSaveRestorePoint) {
      await saveSyncRestorePoint(localChecklist, syncSource);
    }
    const syncMeta = await readSyncMeta();
    const hasLocalChanges = !!syncMeta.dirty || (
      !!syncMeta.baseChecklist &&
      getChecklistSignature(localChecklist) !== getChecklistSignature(syncMeta.baseChecklist)
    );
    if (hasLocalChanges) {
      const pushedChecklist = await pushChecklistToRemote(localChecklist, options);
      const { settings } = await loadSyncContext();
      return {
        ok: true,
        checklist: normalizeChecklist(pushedChecklist || localChecklist),
        settings,
        dataLocation: getDataDir(),
        syncTarget: getSyncTargetDescription(settings),
        syncRestorePoint: await getSyncRestorePointInfo(),
        message: "Pushed local checklist changes."
      };
    }
    return await pullChecklistFromRemote(localChecklist);
  } catch (error) {
    const { settings } = await loadSyncContext();
    if (isCloudflareChallengeError(error)) {
      return {
        ok: false,
        isError: true,
        verificationRequired: true,
        checklist: await getFallbackChecklist(currentChecklist),
        settings,
        dataLocation: getDataDir(),
        syncTarget: getSyncTargetDescription(settings),
        syncRestorePoint: await getSyncRestorePointInfo(),
        message: "Cloudflare blocked this desktop request. Try Verify access in Advanced sync if needed, then try Connect or Pull latest again."
      };
    }
    return {
      ok: false,
      isError: true,
      checklist: await getFallbackChecklist(currentChecklist),
      settings,
      dataLocation: getDataDir(),
      syncTarget: getSyncTargetDescription(settings),
      syncRestorePoint: await getSyncRestorePointInfo(),
      mergeRequired: !!error?.mergeRequired,
      mergeAdditions: Array.isArray(error?.mergeAdditions) ? error.mergeAdditions : [],
      message: error?.message || "Could not sync the current PocketBase checklist for this desktop."
    };
  }
}

function getDesktopUpdateManifestUrl(settings) {
  const serverUrl = normalizeServerUrl(normalizeSettings(settings).advanced.serverUrl);
  if (!serverUrl) {
    throw new Error("Connect this desktop to Checky Base before checking for updates.");
  }

  const baseUrl = new URL(`${serverUrl}/`);
  requireHttps(baseUrl.toString());
  baseUrl.pathname = baseUrl.pathname.replace(/\/api\/?$/i, "/");
  return new URL("desktop-updates/latest.json", baseUrl);
}

function compareVersions(leftVersion, rightVersion) {
  const parse = (value) => {
    const match = String(value || "").trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
    if (!match) return null;
    return {
      parts: [Number(match[1]), Number(match[2]), Number(match[3])],
      prerelease: match[4] || ""
    };
  };
  const left = parse(leftVersion);
  const right = parse(rightVersion);
  if (!left || !right) return 0;
  for (let index = 0; index < left.parts.length; index += 1) {
    if (left.parts[index] !== right.parts[index]) {
      return left.parts[index] > right.parts[index] ? 1 : -1;
    }
  }
  if (left.prerelease === right.prerelease) return 0;
  if (!left.prerelease) return 1;
  if (!right.prerelease) return -1;
  return left.prerelease.localeCompare(right.prerelease, undefined, { numeric: true });
}

async function checkForDesktopUpdate() {
  const { settings, credentials } = await loadSyncContext();
  if (!hasSyncCredentials(credentials)) {
    throw new Error("Connect this desktop to Checky Base before checking for updates.");
  }
  const auth = await getAuthContext(credentials);
  await fetchCurrentUserRecord(credentials, auth);
  const manifestUrl = getDesktopUpdateManifestUrl(settings);
  const response = await getApiSession().fetch(manifestUrl.toString(), {
    method: "GET",
    redirect: 'error',
    headers: {
      Accept: "application/json",
      "Cache-Control": "no-cache"
    }
  });
  const payload = JSON.parse((await readBoundedBody(response, 64 * 1024)).toString('utf8'));
  if (!response.ok || !payload || typeof payload !== "object") {
    throw new Error(getResponseErrorMessage(payload, "Could not read the desktop update information.", response.status));
  }

  const currentVersion = app.getVersion();
  verifyManifest(payload, UPDATE_PUBLIC_KEY);
  const latestVersion = typeof payload.version === "string" ? payload.version.trim() : "";
  if (!latestVersion || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(latestVersion)) {
    throw new Error("The Checky Base update file does not contain a valid version.");
  }

  const updateAvailable = compareVersions(latestVersion, currentVersion) > 0;
  let downloadUrl = "";
  let fileName = "";
  if (updateAvailable) {
    const configuredDownloadUrl = typeof payload.downloadUrl === "string" ? payload.downloadUrl.trim() : "";
    if (!configuredDownloadUrl) {
      throw new Error(`Version ${latestVersion} is listed, but its installer is not available yet.`);
    }
    const resolvedDownloadUrl = requireHttps(new URL(configuredDownloadUrl, manifestUrl).toString(), manifestUrl.origin);
    downloadUrl = resolvedDownloadUrl.toString();
    const manifestFileName = typeof payload.fileName === "string" ? payload.fileName.trim() : "";
    const urlFileName = decodeURIComponent(path.basename(resolvedDownloadUrl.pathname));
    fileName = manifestFileName || urlFileName;
    if (
      !/^[0-9A-Za-z._-]+\.(?:exe|msi)$/i.test(fileName) ||
      fileName !== urlFileName
    ) {
      throw new Error("The Checky Base update manifest contains an invalid installer filename.");
    }
  }

  return {
    ok: true,
    updateAvailable,
    currentVersion,
    latestVersion,
    fileName,
    downloadUrl,
    sha256: typeof payload.sha256 === "string" ? payload.sha256.trim().toLowerCase() : "",
    releaseNotes: typeof payload.releaseNotes === "string" ? payload.releaseNotes.trim() : "",
    message: updateAvailable
      ? `Checky's List ${latestVersion} is available.`
      : `Checky's List ${currentVersion} is up to date.`
  };
}

async function downloadAndInstallDesktopUpdate() {
  if (process.platform !== "win32") {
    throw new Error("Automatic desktop installation is currently available only on Windows.");
  }

  const update = await checkForDesktopUpdate();
  if (!update.updateAvailable) {
    return update;
  }
  if (!/^[a-f0-9]{64}$/i.test(update.sha256)) {
    throw new Error("The Checky Base update manifest is missing a valid SHA-256 checksum.");
  }

  const response = await getApiSession().fetch(update.downloadUrl, {
    method: "GET",
    redirect: 'error',
    headers: {
      Accept: "application/octet-stream",
      "Cache-Control": "no-cache"
    }
  });
  if (!response.ok) {
    await readBoundedBody(response, 64 * 1024);
    throw new Error(`Could not download the desktop update (${response.status}).`);
  }
  const finalDownloadUrl = typeof response.url === "string" && response.url.trim()
    ? new URL(response.url, update.downloadUrl)
    : new URL(update.downloadUrl);
  if (finalDownloadUrl.origin !== new URL(update.downloadUrl).origin) {
    throw new Error("The desktop update download was redirected away from the connected Checky Base server.");
  }

  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_DESKTOP_UPDATE_BYTES) {
    throw new Error("The desktop update is larger than the 500 MB safety limit.");
  }

  const installer = await readBoundedBody(response, MAX_DESKTOP_UPDATE_BYTES);
  if (!installer.length) {
    throw new Error("The downloaded desktop update is empty.");
  }
  if (installer.length > MAX_DESKTOP_UPDATE_BYTES) {
    throw new Error("The desktop update is larger than the 500 MB safety limit.");
  }

  const actualSha256 = crypto.createHash("sha256").update(installer).digest("hex");
  if (actualSha256 !== update.sha256.toLowerCase()) {
    throw new Error("The desktop update checksum does not match the Checky Base manifest. The installer was not opened.");
  }

  const updatesDir = getDesktopUpdatesDir();
  const installerPath = path.join(updatesDir, update.fileName);
  const temporaryPath = `${installerPath}.download`;
  await fs.mkdir(updatesDir, { recursive: true });
  await fs.rm(temporaryPath, { force: true });
  await fs.writeFile(temporaryPath, installer);
  await fs.rm(installerPath, { force: true });
  await fs.rename(temporaryPath, installerPath);

  const openError = await shell.openPath(installerPath);
  if (openError) {
    throw new Error(`The update was verified but Windows could not open the installer: ${openError}`);
  }

  app.isQuiting = true;
  setTimeout(() => app.quit(), 750);
  return {
    ...update,
    ok: true,
    installerPath,
    message: `Verified Checky's List ${update.latestVersion}. The installer is opening now.`
  };
}

function registerHotkey(accelerator) {
  globalShortcut.unregisterAll();
  const ok = globalShortcut.register(accelerator, () => {
    toggleWindow("hotkey");
  });
  if (!ok) {
    return false;
  }
  currentHotkey = accelerator;
  return true;
}

function applyLoginItemSetting(enabled) {
  app.setLoginItemSettings({
    openAtLogin: !!enabled
  });
}

function requestRendererSync(reason = "window", action = "refresh") {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const sendSyncRequest = () => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
      return;
    }
    mainWindow.webContents.send("window:sync-requested", { reason, action });
  };

  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once("did-finish-load", sendSyncRequest);
    return;
  }

  sendSyncRequest();
}

function hideWindow(reason = "window") {
  if (!mainWindow) return;
  requestRendererSync(reason, "hide");
  mainWindow.hide();
}

function showWindow(reason = "window") {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  pendingSecondInstanceFocus = false;
  mainWindow.show();
  mainWindow.focus();
  requestRendererSync(reason, "show");
}

function toggleWindow(reason = "window") {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) {
    hideWindow(reason);
  } else {
    showWindow(reason);
  }
}

function createTray() {
  const iconPath = path.join(__dirname, "logo.png");
  let trayIcon = nativeImage.createFromPath(iconPath);
  if (trayIcon.isEmpty()) {
    trayIcon = nativeImage.createFromDataURL(
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAIUlEQVR42mNkYGD4z0AEMFGKMGrAqAGjBowasGrAqAEEAEtvAhP6TSGYAAAAAElFTkSuQmCC"
    );
  } else {
    trayIcon = trayIcon.resize({ width: 16, height: 16 });
  }
  tray = new Tray(trayIcon);
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Toggle ${APP_NAME}`, click: () => toggleWindow("tray-menu") },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() }
    ])
  );
  tray.on("click", () => toggleWindow("tray"));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: APP_NAME,
    width: 430,
    height: 650,
    show: false,
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    icon: path.join(__dirname, "logo.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });
  mainWindow.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  mainWindow.once("ready-to-show", () => {
    if (pendingSecondInstanceFocus) {
      showWindow("second-instance");
    }
  });

  mainWindow.on("blur", async () => {
    const settings = await loadSettings();
    if (settings.autoHideOnBlur) {
      mainWindow.hide();
    }
  });

  mainWindow.on("close", (event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      hideWindow("window-close");
    }
  });
}

function registerIpcHandlers() {
  ipcMain.handle('auth:submit-code', (event, id, code) => {
    if (event.sender !== mainWindow?.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) return false;
    if (!pendingVerification || id !== pendingVerification.id) return false;
    pendingVerification.finish(typeof code === 'string' && /^\d{4,12}$/.test(code) ? code : null);
    return true;
  });
  ipcMain.handle("state:load", async () => {
    await ensureDataFiles();
    const state = await loadAppState();
    return {
      ...state,
      appVersion: app.getVersion(),
      dataLocation: getDataDir(),
      syncTarget: getSyncTargetDescription(state.settings)
    };
  });

  ipcMain.handle("checklist:save", async (_event, checklist) => {
    await ensureDataFiles();
    const saved = await saveChecklist(checklist);
    await markLocalChecklistDirty();
    queueRemotePush(saved);
    const now = Date.now();
    if (now - lastAutoBackupAt > 10 * 60 * 1000) {
      await createChecklistBackup();
      lastAutoBackupAt = now;
    }
    return saved;
  });

  ipcMain.handle("settings:save", async (_event, settings) => {
    await ensureDataFiles();
    const previous = await loadSettings();
    const saved = await saveSettings(settings);
    const syncTarget = getSyncTargetDescription(saved);
    if (saved.hotkey !== previous.hotkey) {
      const ok = registerHotkey(saved.hotkey);
      if (!ok) {
        const revertedSettings = await saveSettings({ ...saved, hotkey: previous.hotkey });
        registerHotkey(previous.hotkey);
        return {
          ok: false,
          message: "Hotkey is in use by another app.",
          settings: revertedSettings,
          syncTarget: getSyncTargetDescription(revertedSettings)
        };
      }
    }
    return { ok: true, settings: saved, syncTarget };
  });

  ipcMain.handle("backups:list", async () => {
    const backups = await listBackups();
    return backups.map((backup) => ({ name: backup.name, mtimeMs: backup.mtimeMs }));
  });

  ipcMain.handle("backups:create", async () => {
    await createChecklistBackup();
    return { ok: true };
  });

  ipcMain.handle("backups:restore", async (_event, name) => {
    const checklist = await restoreBackup(name);
    let settings = await loadSettings();
    const restoredDoneItems = checklist.tabs.some((tab) => tab.system === "done" && tab.items.length > 0);
    if (restoredDoneItems && !settings.showDoneTab) {
      settings = await saveSettings({ ...settings, showDoneTab: true });
    }
    await markLocalChecklistDirty();
    queueRemotePush(checklist);
    return { ok: true, checklist, settings };
  });

  ipcMain.handle("checklist:reset", async () => {
    const checklist = await saveChecklist(DEFAULT_CHECKLIST);
    await createChecklistBackup();
    await markLocalChecklistDirty();
    queueRemotePush(checklist);
    return checklist;
  });

  ipcMain.handle("sync:now", async (_event, currentChecklist, options) => {
    await ensureDataFiles();
    return await syncNow(currentChecklist, options);
  });

  ipcMain.handle("sync:session-status", async () => {
    await ensureDataFiles();
    const meta = await readSyncMeta();
    return { hasUnsyncedChanges: !!meta.dirty };
  });

  ipcMain.handle("sync:reset-session", async () => {
    await ensureDataFiles();
    await resetSyncSession();
    return { ok: true };
  });

  ipcMain.handle("sync:disconnect", async () => {
    await ensureDataFiles();
    return await disconnectSync();
  });

  ipcMain.handle("sync:list-checklists", async () => {
    await ensureDataFiles();
    return await browseAccessibleChecklists();
  });

  ipcMain.handle("sync:use-checklist", async (_event, checklistId, currentChecklist) => {
    await ensureDataFiles();
    return await useAccessibleChecklist(checklistId, currentChecklist);
  });

  ipcMain.handle("sync:restore-point:restore", async () => {
    await ensureDataFiles();
    return await restoreSyncRestorePoint();
  });

  ipcMain.handle("sync:open-verification", async () => {
    await ensureDataFiles();
    const settings = await loadSettings();
    return await openDesktopVerificationWindow(settings?.advanced?.serverUrl);
  });

  ipcMain.handle("window:toggle-always-on-top", async (_event, value) => {
    if (mainWindow) mainWindow.setAlwaysOnTop(!!value);
    return { ok: true };
  });

  ipcMain.handle("window:hide", async () => {
    hideWindow("header-close");
    return { ok: true };
  });

  ipcMain.handle("instructions:open", async () => {
    const readmePath = getReadmePath();
    const result = await shell.openPath(readmePath);
    return { ok: !result, message: result };
  });

  ipcMain.handle("updates:check", async () => {
    return await checkForDesktopUpdate();
  });

  ipcMain.handle("updates:install", async () => {
    return await downloadAndInstallDesktopUpdate();
  });
}

app.whenReady().then(async () => {
  try {
    app.setAppUserModelId(APP_USER_MODEL_ID);
    await ensureDataFiles();
    const { settings } = await loadAppState();

    registerIpcHandlers();
    createWindow();
    createTray();
    applyLoginItemSetting(settings.runOnStartup);
    mainWindow.setAlwaysOnTop(settings.alwaysOnTop);

    if (!registerHotkey(settings.hotkey)) {
      registerHotkey(DEFAULT_SETTINGS.hotkey);
      await saveSettings({ ...settings, hotkey: DEFAULT_SETTINGS.hotkey });
    }
  } catch (error) {
    console.error("Startup failed:", error);
  }
});

app.on("window-all-closed", (event) => {
  event.preventDefault();
});

app.on("before-quit", () => {
  app.isQuiting = true;
  globalShortcut.unregisterAll();
});

process.on("unhandledRejection", (error) => {
  console.error("Unhandled rejection:", error);
});
