(function () {
  // Legacy key names are intentionally retained so existing hosted browser data is not lost.
  const CHECKLIST_KEY = "checky.android.checklist";
  const SETTINGS_KEY = "checky.android.settings";
  const SYNC_PASSWORD_FALLBACK_KEY = "checky.android.syncPassword";
  const SYNC_TOKEN_FALLBACK_KEY = "checky.android.syncToken";
  const SYNC_META_KEY = "checky.android.syncMeta";
  const LAST_CHECKLIST_SELECTIONS_KEY = "checky.base.lastChecklistSelections";
  const SYNC_RESTORE_POINT_KEY = "checky.android.syncRestorePoint";
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
  const HOSTED_SESSION_PATH = "/api/checkys-base/session";

  function isHostedWebRuntime() {
    return !window.Capacitor && window.location?.protocol !== "file:";
  }

  function getHostedServerUrl() {
    if (!isHostedWebRuntime()) {
      return "";
    }

    return window.location.origin.replace(/\/+$/, "");
  }
  const DEFAULT_SETTINGS = {
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

  let remotePushTimer = null;
  let queuedRemoteChecklist = null;
  let remotePushPromise = Promise.resolve();

  function getSecureSettingsPlugin() {
    return window.Capacitor?.Plugins?.SecureSettings || null;
  }

  function getStoragePickerPlugin() {
    return window.Capacitor?.Plugins?.StoragePicker || null;
  }

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
    return value;
  }

  function cloneValue(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeEntityId(value, fallback) {
    const id = typeof value === "string" ? value.trim().slice(0, 120) : "";
    return id || fallback;
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

  function normalizeChecklistData(data) {
    const safe = data && typeof data === "object" ? data : {};
    const tabs = Array.isArray(safe.tabs) ? safe.tabs.slice(0, MAX_TABS) : [];
    const normalizedTabs = tabs.length > 0 ? tabs : [{ name: "Tab 1", items: [] }];

    normalizedTabs.forEach((tab, index) => {
      if (!tab || typeof tab !== "object") {
        normalizedTabs[index] = { name: `Tab ${index + 1}`, items: [] };
      }

      const normalizedName = sanitizeSingleLineText(normalizedTabs[index].name, MAX_TAB_NAME_LENGTH);
      normalizedTabs[index].id = normalizeEntityId(normalizedTabs[index].id, "legacy-tab-" + index);
      normalizedTabs[index].name = normalizedName || `Tab ${index + 1}`;
      if (!Array.isArray(normalizedTabs[index].items)) {
        normalizedTabs[index].items = [];
      }

      normalizedTabs[index].items = normalizedTabs[index].items
        .slice(0, MAX_ITEMS_PER_TAB)
        .map((item, itemIndex) => ({
          id: normalizeEntityId(item?.id, "legacy-item-" + index + "-" + itemIndex),
          text: sanitizeMultilineText(item?.text, MAX_ITEM_TEXT_LENGTH),
          done: !!item?.done,
          completedAt: normalizeCompletedAt(item?.completedAt),
          reminderAt: normalizeCompletedAt(item?.reminderAt),
          reminderRepeat: ['daily', 'weekly', 'monthly', 'yearly'].includes(item?.reminderRepeat) ? item.reminderRepeat : 'none',
          reminderTimeZone: typeof item?.reminderTimeZone === 'string' ? item.reminderTimeZone.slice(0, 120) : null,
          reminderDays: Array.isArray(item?.reminderDays) ? [...new Set(item.reminderDays.filter(day => Number.isInteger(day) && day >= 0 && day <= 6))].sort() : null,
          originalTabName: sanitizeSingleLineText(item?.originalTabName, MAX_TAB_NAME_LENGTH) || null
        }));

      normalizedTabs[index].system = normalizedTabs[index].system === "done" ? "done" : undefined;
    });

    let active = Number.isInteger(safe.active) ? safe.active : 0;
    if (active < 0 || active >= normalizedTabs.length) active = 0;

    return { active, tabs: normalizedTabs };
  }

  function normalizeSettings(settings) {
    const safe = settings && typeof settings === "object" ? settings : {};
    const advanced = safe.advanced && typeof safe.advanced === "object" ? safe.advanced : {};
    return {
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

  function readSyncMeta() {
    const safe = readJson(SYNC_META_KEY, {});
    return {
      recordId: typeof safe?.recordId === "string" ? safe.recordId : "",
      version: Number.isFinite(safe?.version) ? safe.version : null,
      userId: typeof safe?.userId === "string" ? safe.userId : "",
      preferredChecklistId: typeof safe?.preferredChecklistId === "string" ? safe.preferredChecklistId : "",
      dirty: !!safe?.dirty,
      baseChecklist: safe?.baseChecklist && typeof safe.baseChecklist === "object"
        ? normalizeChecklistData(cloneValue(safe.baseChecklist))
        : null
    };
  }

  function writeSyncMeta(meta) {
    const next = { ...readSyncMeta() };
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
    if (meta && meta.baseChecklist !== undefined) {
      next.baseChecklist = meta.baseChecklist && typeof meta.baseChecklist === "object"
        ? normalizeChecklistData(cloneValue(meta.baseChecklist))
        : null;
    }
    localStorage.setItem(SYNC_META_KEY, JSON.stringify(next));
    return next;
  }

  function getPreferredChecklistId(meta = readSyncMeta()) {
    return sanitizeSingleLineText(meta?.preferredChecklistId, MAX_TAB_NAME_LENGTH);
  }

  function readLastChecklistSelections() {
    const safe = readJson(LAST_CHECKLIST_SELECTIONS_KEY, {});
    return safe && typeof safe === "object" && !Array.isArray(safe) ? safe : {};
  }

  function getLastChecklistSelection(userId) {
    const safeUserId = sanitizeSingleLineText(userId, MAX_TAB_NAME_LENGTH);
    if (!safeUserId) return "";
    return sanitizeSingleLineText(readLastChecklistSelections()[safeUserId], MAX_TAB_NAME_LENGTH);
  }

  function rememberLastChecklistSelection(userId, checklistId) {
    const safeUserId = sanitizeSingleLineText(userId, MAX_TAB_NAME_LENGTH);
    if (!safeUserId) return;

    const selections = readLastChecklistSelections();
    const safeChecklistId = sanitizeSingleLineText(checklistId, MAX_TAB_NAME_LENGTH);
    if (safeChecklistId) {
      selections[safeUserId] = safeChecklistId;
    } else {
      delete selections[safeUserId];
    }
    writeJson(LAST_CHECKLIST_SELECTIONS_KEY, selections);
  }

  function clearSyncMeta() {
    localStorage.removeItem(SYNC_META_KEY);
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

  function getCachedChecklist(fallback = DEFAULT_CHECKLIST) {
    return normalizeChecklistData(readJson(CHECKLIST_KEY, fallback));
  }

  function getChecklistSignature(checklist) {
    return JSON.stringify(cloneValue(normalizeChecklistData(checklist && typeof checklist === "object" ? checklist : DEFAULT_CHECKLIST)));
  }

  function markLocalChecklistDirty() {
    writeSyncMeta({ dirty: true });
  }

  function clearDirtyIfChecklistStillCurrent(checklist) {
    if (getChecklistSignature(getCachedChecklist()) === getChecklistSignature(checklist)) {
      writeSyncMeta({ dirty: false });
    }
  }

  function readSyncRestorePoint() {
    const point = normalizeSyncRestorePointValue(readJson(SYNC_RESTORE_POINT_KEY, null));
    return point.checklist ? point : null;
  }

  function getSyncRestorePointInfo() {
    const point = readSyncRestorePoint();
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

  function saveSyncRestorePoint(checklist, source = "manual_sync") {
    const point = {
      createdAt: new Date().toISOString(),
      source: typeof source === "string" ? source : "manual_sync",
      checklist: cloneValue(normalizeChecklistData(checklist && typeof checklist === "object" ? checklist : DEFAULT_CHECKLIST))
    };
    localStorage.setItem(SYNC_RESTORE_POINT_KEY, JSON.stringify(point));
    return getSyncRestorePointInfo();
  }

  async function readSecureValue(getMethodName, fallbackKey, valueField) {
    if (isHostedWebRuntime()) {
      localStorage.removeItem(fallbackKey);
      return "";
    }

    const securePlugin = getSecureSettingsPlugin();
    if (securePlugin && typeof securePlugin[getMethodName] === "function") {
      try {
        const result = await securePlugin[getMethodName]();
        return typeof result?.[valueField] === "string" ? result[valueField] : "";
      } catch {
        return "";
      }
    }

    return localStorage.getItem(fallbackKey) || "";
  }

  async function persistSecureValue(setMethodName, clearMethodName, fallbackKey, valueField, value) {
    if (isHostedWebRuntime()) {
      localStorage.removeItem(fallbackKey);
      return "";
    }

    const safeValue = typeof value === "string" ? value : "";
    const securePlugin = getSecureSettingsPlugin();
    if (
      securePlugin &&
      typeof securePlugin[setMethodName] === "function" &&
      typeof securePlugin[clearMethodName] === "function"
    ) {
      if (safeValue) {
        await securePlugin[setMethodName]({ [valueField]: safeValue });
      } else {
        await securePlugin[clearMethodName]();
      }
      localStorage.removeItem(fallbackKey);
      return safeValue;
    }

    if (safeValue) {
      localStorage.setItem(fallbackKey, safeValue);
    } else {
      localStorage.removeItem(fallbackKey);
    }
    return safeValue;
  }

  async function readStoredPassword() {
    return await readSecureValue("getSyncPassword", SYNC_PASSWORD_FALLBACK_KEY, "password");
  }

  async function persistStoredPassword(password) {
    return await persistSecureValue("setSyncPassword", "clearSyncPassword", SYNC_PASSWORD_FALLBACK_KEY, "password", password);
  }

  async function readStoredToken() {
    return await readSecureValue("getSyncToken", SYNC_TOKEN_FALLBACK_KEY, "token");
  }

  async function persistStoredToken(token) {
    const storedToken = await persistSecureValue("setSyncToken", "clearSyncToken", SYNC_TOKEN_FALLBACK_KEY, "token", token);
    if (!storedToken) {
      writeSyncMeta({ userId: "" });
    }
    return storedToken;
  }

  async function loadSettings() {
    const storedSettings = readJson(SETTINGS_KEY, DEFAULT_SETTINGS);
    const normalized = normalizeSettings(storedSettings);
    if (isHostedWebRuntime()) {
      const hostedSettings = normalizeSettings({
        ...normalized,
        advanced: {
          ...normalized.advanced,
          serverUrl: normalizeServerUrl(normalized.advanced.serverUrl) || getHostedServerUrl(),
          password: ""
        }
      });
      writeJson(SETTINGS_KEY, getPersistedSettings(hostedSettings));
      localStorage.removeItem(SYNC_PASSWORD_FALLBACK_KEY);
      localStorage.removeItem(SYNC_TOKEN_FALLBACK_KEY);
      return withPassword(hostedSettings, "");
    }

    const legacyPassword = normalized.advanced.password;
    let password = await readStoredPassword();
    let migratedLegacyPassword = false;

    if (!password && legacyPassword) {
      try {
        password = await persistStoredPassword(legacyPassword);
        migratedLegacyPassword = true;
      } catch {
        password = legacyPassword;
      }
    }

    if (legacyPassword && migratedLegacyPassword) {
      writeJson(SETTINGS_KEY, getPersistedSettings(normalized));
    }

    return withPassword(normalized, password);
  }

  async function loadSyncContext() {
    const settings = await loadSettings();
    const advanced = normalizeSettings(settings).advanced;
    const token = await readStoredToken();
    const meta = readSyncMeta();
    const serverUrl = normalizeServerUrl(advanced.serverUrl) || getHostedServerUrl();
    return {
      settings,
      credentials: {
        serverUrl,
        email: advanced.email.trim(),
        password: advanced.password,
        token,
        userId: meta.userId || extractUserIdFromToken(token)
      }
    };
  }

  function hasSyncCredentials(credentials) {
    if (isHostedWebRuntime()) {
      return !!credentials.serverUrl;
    }

    return !!(credentials.serverUrl && credentials.email && (credentials.password || credentials.token));
  }

  function getDataLocationDescription(settings) {
    const advanced = normalizeSettings(settings).advanced;
    const serverUrl = normalizeServerUrl(advanced.serverUrl);
    if (!serverUrl) {
      return "Device local cache only";
    }
    return `PocketBase assigned checklist @ ${serverUrl}`;
  }

  async function getLocalState() {
    let { settings, credentials } = await loadSyncContext();
    let hostedSession = null;

    if (isHostedWebRuntime()) {
      try {
        hostedSession = await authApi.readHostedSession(credentials);
        const hostedEmail = hostedSession?.user?.email;
        if (typeof hostedEmail === "string" && hostedEmail && hostedEmail !== normalizeSettings(settings).advanced.email) {
          settings = normalizeSettings({
            ...settings,
            advanced: {
              ...normalizeSettings(settings).advanced,
              email: hostedEmail,
              password: ""
            }
          });
          writeJson(SETTINGS_KEY, getPersistedSettings(settings));
          credentials = {
            ...credentials,
            email: hostedEmail
          };
        }
      } catch {
        hostedSession = {
          authenticated: false,
          setupRequired: false,
          user: null
        };
      }
    }

    return {
      checklist: getCachedChecklist(),
      settings,
      dataLocation: getDataLocationDescription(settings),
      syncRestorePoint: getSyncRestorePointInfo(),
      hostedSession
    };
  }

  // Runtime context helpers keep local cache, credentials, and hosted state loading together.
  const syncContextApi = {
    async loadSettings() {
      return await loadSettings();
    },
    async load() {
      return await loadSyncContext();
    },
    hasCredentials(credentials) {
      return hasSyncCredentials(credentials);
    },
    describeDataLocation(settings) {
      return getDataLocationDescription(settings);
    },
    async loadLocalState() {
      return await getLocalState();
    }
  };

  function getFallbackChecklist(currentChecklist) {
    if (currentChecklist && typeof currentChecklist === "object") {
      return writeJson(CHECKLIST_KEY, normalizeChecklistData(currentChecklist));
    }
    return getCachedChecklist();
  }

  function downloadText(filename, text) {
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  function decodeBase64Url(value) {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padding = normalized.length % 4;
    const padded = padding ? normalized + "=".repeat(4 - padding) : normalized;
    return atob(padded);
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

  function buildApiUrl(serverUrl, path, query) {
    const url = new URL(path.replace(/^\/+/, ""), `${normalizeServerUrl(serverUrl)}/`);
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

  function getNetworkRequestErrorMessage(serverUrl, fallback) {
    const normalizedServerUrl = normalizeServerUrl(serverUrl);
    const target = normalizedServerUrl ? ` at ${normalizedServerUrl}` : "";
    return `${fallback || "PocketBase request failed."} Could not reach PocketBase${target}. Check that the server URL is correct, the LAN IP is current, the server is running, and this device can reach the port on the same network.`;
  }

  async function rawJsonRequest({ credentials, path, query, method = "GET", token = "", body, errorMessage }) {
    const headers = {
      Accept: "application/json"
    };

    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    if (token) {
      headers.Authorization = token;
    }

    const requestUrl = buildApiUrl(credentials.serverUrl, path, query);
    let response;
    try {
      response = await fetch(requestUrl, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: isHostedWebRuntime() ? "same-origin" : "omit"
      });
    } catch (fetchError) {
      const error = new Error(getNetworkRequestErrorMessage(credentials.serverUrl, errorMessage));
      error.isNetworkError = true;
      error.cause = fetchError;
      throw error;
    }
    const payload = await readResponsePayload(response);

    if (response.ok) {
      return payload;
    }

    const error = new Error(getResponseErrorMessage(payload, errorMessage || "PocketBase request failed.", response.status));
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  async function authenticateWithPassword(credentials) {
    const result = await rawJsonRequest({
      credentials,
      path: `/api/collections/${AUTH_COLLECTION}/auth-with-password`,
      method: "POST",
      body: {
        identity: credentials.email,
        password: credentials.password
      },
      errorMessage: "Could not log in to PocketBase."
    });

    const token = typeof result?.token === "string" ? result.token : "";
    if (!token) {
      throw new Error("PocketBase login did not return an auth token.");
    }

    await persistStoredToken(token);
    const userId = typeof result?.record?.id === "string" ? result.record.id : extractUserIdFromToken(token);
    if (userId) {
      writeSyncMeta({ userId });
    }

    return { token, userId };
  }

  async function readHostedSession(credentials) {
    const result = await rawJsonRequest({
      credentials,
      path: HOSTED_SESSION_PATH,
      method: "GET",
      errorMessage: "Could not load the hosted session."
    });

    return {
      authenticated: !!result?.authenticated,
      setupRequired: !!result?.setupRequired,
      user: result?.user && typeof result.user === "object"
        ? {
          id: typeof result.user.id === "string" ? result.user.id : "",
          email: typeof result.user.email === "string" ? result.user.email : ""
        }
        : null
      };
  }

  async function authenticateHostedSession(credentials, email, password) {
    const identity = typeof email === "string" ? email.trim() : "";
    const secret = typeof password === "string" ? password : "";
    if (!identity) {
      throw new Error("Enter your email to sign in.");
    }
    if (!secret) {
      throw new Error("Enter your password to sign in.");
    }

    const loginCredentials = {
      ...credentials,
      email: identity,
      password: secret
    };
    const auth = await window.checkyAuth.authenticate((path, body) => rawJsonRequest({
      credentials: loginCredentials, path, method: 'POST', body,
      errorMessage: 'Could not sign in.'
    }), identity, secret, window.requestCheckyVerificationCode);
    const result = await rawJsonRequest({
      credentials: loginCredentials, path: '/api/checkys-base/session/login', method: 'POST',
      body: { token: auth.token }, errorMessage: 'Could not create a hosted session.'
    });
    if (result?.ok === false) {
      throw new Error(getResponseErrorMessage(result, "Could not sign in to hosted Checky's List."));
    }

    const session = await authApi.readHostedSession(loginCredentials);
    if (!session?.authenticated || !session?.user?.id) {
      throw new Error("Sign-in succeeded, but the hosted session could not be confirmed.");
    }

    writeSyncMeta({ userId: session.user.id });
    return session;
  }

  async function getHostedSessionAuth(credentials) {
    const session = await authApi.readHostedSession(credentials);
    if (!session?.authenticated || !session?.user?.id) {
      throw new Error(session?.setupRequired
        ? "Create the first hosted Checky's List user to continue."
        : "Sign in to hosted Checky's List first.");
    }

    writeSyncMeta({ userId: session.user.id });
    return {
      token: "",
      userId: session.user.id
    };
  }

  async function refreshAuthToken(credentials) {
    const result = await rawJsonRequest({
      credentials,
      path: `/api/collections/${AUTH_COLLECTION}/auth-refresh`,
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
      writeSyncMeta({ userId });
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
    const base = normalizeChecklistData(cloneValue(baseChecklist));
    const local = normalizeChecklistData(cloneValue(localChecklist));
    const merged = normalizeChecklistData(cloneValue(remoteChecklist));
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

    return additions.length ? { checklist: normalizeChecklistData(merged), additions } : null;
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

  async function getAuthContext(credentials) {
    if (isHostedWebRuntime()) {
      if (!credentials.serverUrl) {
        throw new Error("Hosted Checky's List is missing its server URL.");
      }

      return await getHostedSessionAuth(credentials);
    }

    if (!credentials.serverUrl) {
      throw new Error("Enter the PocketBase URL in Advanced settings.");
    }
    if (!credentials.email) {
      throw new Error("Enter the PocketBase login email in Advanced settings.");
    }

    if (credentials.token && isTokenFresh(credentials.token)) {
      const userId = credentials.userId || extractUserIdFromToken(credentials.token);
      if (userId) {
        writeSyncMeta({ userId });
      }
      return {
        token: credentials.token,
        userId
      };
    }

    if (credentials.token) {
      try {
        return await refreshAuthToken(credentials);
      } catch (error) {
        if (error?.status !== 401) {
          throw error;
        }
        await persistStoredToken("");
      }
    }

    if (!credentials.password) {
      throw new Error("Enter the PocketBase password in Advanced settings.");
    }

    return await authenticateWithPassword(credentials);
  }

  async function requestWithAuth({ credentials, auth, path, query, method = "GET", body, errorMessage }) {
    try {
      return await rawJsonRequest({
        credentials,
        path,
        query,
        method,
        token: auth.token,
        body,
        errorMessage
      });
    } catch (error) {
      if (error?.status !== 401 || !credentials.password || isHostedWebRuntime()) {
        throw error;
      }

      await persistStoredToken("");
      const freshAuth = await authenticateWithPassword(credentials);
      return await rawJsonRequest({
        credentials,
        path,
        query,
        method,
        token: freshAuth.token,
        body,
        errorMessage
      });
    }
  }

  // Auth helpers centralize the PocketBase token path and hosted cookie-session path.
  const authApi = {
    async readHostedSession(credentials) {
      return await readHostedSession(credentials);
    },
    async signInHostedSession(credentials, email, password) {
      return await authenticateHostedSession(credentials, email, password);
    },
    async getContext(credentials) {
      return await getAuthContext(credentials);
    },
    async request(options) {
      return await requestWithAuth(options);
    }
  };

  function cacheChecklistRecord(record, userId = readSyncMeta().userId) {
    if (!record || typeof record !== "object") {
      return;
    }

    writeSyncMeta({
      recordId: getChecklistRef(record),
      version: getChecklistRecordVersion(record),
      userId
    });
  }

  async function fetchCurrentUserRecord(credentials, auth) {
    if (!auth?.userId) {
      throw new Error("PocketBase auth did not include a user id.");
    }

    return await authApi.request({
      credentials,
      auth,
      path: `/api/collections/${AUTH_COLLECTION}/records/${auth.userId}`,
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
    accessMessage = "This PocketBase user cannot access the selected checklist on this device anymore."
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
      const record = await authApi.request({
        credentials,
        auth,
        path: `/api/collections/${collectionName}/records/${recordId}`,
        errorMessage: "Could not load the assigned checklist."
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

    await authApi.request({
      credentials,
      auth,
      path: `/api/collections/${AUTH_COLLECTION}/records/${auth.userId}`,
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

    const result = await authApi.request({
      credentials,
      auth,
      path: `/api/collections/${PERSONAL_CHECKLIST_COLLECTION}/records`,
      query: {
        page: 1,
        perPage: 1,
        filter: `shareKey="personal-${auth.userId}" && owner="${auth.userId}"`
      },
      errorMessage: "Could not load the assigned checklist."
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

    const normalizedChecklist = normalizeChecklistData(
      checklist && typeof checklist === "object"
        ? checklist
        : getCachedChecklist()
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
      const created = await authApi.request({
        credentials,
        auth,
        path: `/api/collections/${PERSONAL_CHECKLIST_COLLECTION}/records`,
        method: "POST",
        body,
        errorMessage: "Could not create a personal PocketBase checklist for this user."
      });
      const personalRecord = withChecklistCollection(created, PERSONAL_CHECKLIST_COLLECTION);
      await assignChecklistToUser(credentials, auth, created.id);
      cacheChecklistRecord(personalRecord, userId);
      clearDirtyIfChecklistStillCurrent(normalizedChecklist);
      return personalRecord;
    } catch (error) {
      const existing = await findPersonalChecklistRecord(credentials, auth).catch(() => null);
      if (existing) {
        await assignChecklistToUser(credentials, auth, existing.id);
        cacheChecklistRecord(existing, userId);
        return existing;
      }
      throw error;
    }
  }

  async function listAccessibleSharedChecklistRecords(credentials, auth) {
    const result = await authApi.request({
      credentials,
      auth,
      path: `/api/collections/${SHARED_CHECKLIST_COLLECTION}/records`,
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

  async function listAccessibleChecklistState(credentials, auth) {
    const meta = readSyncMeta();
    const preferredChecklistId = getPreferredChecklistId(meta) || getLastChecklistSelection(auth?.userId);
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
      writeSyncMeta({ preferredChecklistId: "" });
      rememberLastChecklistSelection(auth?.userId, "");
    }

    const currentChecklistId = effectivePreferredChecklistId || assignedChecklistId || getChecklistRef(personalRecord);
    const items = records
      .map((record) => toChecklistBrowserItem(record, auth?.userId || "", currentChecklistId))
      .sort(compareChecklistBrowserItems);

    let message = "";
    if (items.length === 0) {
      message = "No accessible checklists yet. New users should receive a personal checklist automatically. Refresh list in a moment, or ask an admin to assign one.";
    } else if (effectivePreferredChecklistId && effectivePreferredChecklistId !== assignedChecklistId) {
      message = "This device is using its own selected checklist.";
    } else if (getAssignedSharedChecklistId(userRecord)) {
      message = "This device is following its assigned shared checklist.";
    } else if (personalRecord) {
      message = "This device is following its personal checklist.";
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

  function getCurrentChecklistForSync(currentChecklist) {
    return normalizeChecklistData(cloneValue(
      currentChecklist && typeof currentChecklist === "object"
        ? currentChecklist
        : getCachedChecklist()
    ));
  }

  async function browseAccessibleChecklists() {
    const { settings, credentials } = await syncContextApi.load();
    if (!syncContextApi.hasCredentials(credentials)) {
      return {
        ok: false,
        checklists: [],
        assignedChecklistId: "",
        currentChecklistId: "",
        settings,
        dataLocation: syncContextApi.describeDataLocation(settings),
        message: "Enter the PocketBase URL, email, and password in Advanced settings first."
      };
    }

    try {
      const auth = await authApi.getContext(credentials);
      let browser = await listAccessibleChecklistState(credentials, auth);
      if (!browser.currentChecklistId && browser.items.length === 0) {
        await createPersonalChecklistRecord(credentials, auth, getCachedChecklist());
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
        settings,
        dataLocation: syncContextApi.describeDataLocation(settings),
        message: browser.message
      };
    } catch (error) {
      return {
        ok: false,
        checklists: [],
        assignedChecklistId: "",
        currentChecklistId: "",
        settings,
        dataLocation: syncContextApi.describeDataLocation(settings),
        message: error?.message || "Could not load the available PocketBase checklists."
      };
    }
  }

  async function useAccessibleChecklist(checklistId, currentChecklist) {
    const safeChecklistId = sanitizeSingleLineText(checklistId, MAX_TAB_NAME_LENGTH);
    const { settings, credentials } = await syncContextApi.load();
    if (!syncContextApi.hasCredentials(credentials)) {
      return {
        ok: false,
        isError: true,
        checklist: getFallbackChecklist(currentChecklist),
        settings,
        dataLocation: syncContextApi.describeDataLocation(settings),
        syncRestorePoint: getSyncRestorePointInfo(),
        checklists: [],
        assignedChecklistId: "",
        currentChecklistId: "",
        message: "Enter the PocketBase URL, email, and password in Advanced settings first."
      };
    }
    if (!safeChecklistId) {
      return {
        ok: false,
        isError: true,
        checklist: getFallbackChecklist(currentChecklist),
        settings,
        dataLocation: syncContextApi.describeDataLocation(settings),
        syncRestorePoint: getSyncRestorePointInfo(),
        checklists: [],
        assignedChecklistId: "",
        currentChecklistId: "",
        message: "Select a checklist first."
      };
    }

    remoteSyncApi.clearQueue();

    try {
      await remoteSyncApi.settleQueue();
      const localChecklist = getCurrentChecklistForSync(currentChecklist);
      saveSyncRestorePoint(localChecklist, "switch_checklist");

      const auth = await authApi.getContext(credentials);
      const userRecord = await fetchCurrentUserRecord(credentials, auth);
      const assignedChecklistId = getAssignedChecklistId(userRecord);
      const selectedRecord = await fetchChecklistRecordById(credentials, auth, safeChecklistId);
      const selectedChecklistId = getChecklistRef(selectedRecord);
      const preferredChecklistId = selectedChecklistId && selectedChecklistId !== assignedChecklistId
        ? selectedChecklistId
        : "";
      const selectedChecklist = cloneValue(extractChecklistData(selectedRecord));
      writeJson(CHECKLIST_KEY, selectedChecklist);
      writeSyncMeta({
        preferredChecklistId,
        recordId: selectedChecklistId || safeChecklistId,
        version: getChecklistRecordVersion(selectedRecord),
        userId: auth.userId || extractUserIdFromToken(auth.token),
        dirty: false
      });
      rememberLastChecklistSelection(auth.userId, selectedChecklistId || safeChecklistId);

      const browser = await listAccessibleChecklistState(credentials, auth).catch(() => ({
        items: [toChecklistBrowserItem(selectedRecord, auth.userId || "", safeChecklistId)],
        assignedChecklistId,
        currentChecklistId: selectedChecklistId || safeChecklistId,
        message: "Checklist switched."
      }));
      return {
        ok: true,
        checklist: selectedChecklist,
        settings,
        dataLocation: syncContextApi.describeDataLocation(settings),
        syncRestorePoint: getSyncRestorePointInfo(),
        checklists: browser.items,
        assignedChecklistId: browser.assignedChecklistId || assignedChecklistId || "",
        currentChecklistId: browser.currentChecklistId || selectedChecklistId || safeChecklistId,
        message: preferredChecklistId
          ? `This device will use ${getChecklistRecordLabel(selectedRecord)}.`
          : `This device will follow ${getChecklistRecordLabel(selectedRecord)} again.`
      };
    } catch (error) {
      return {
        ok: false,
        isError: true,
        checklist: getFallbackChecklist(currentChecklist),
        settings,
        dataLocation: syncContextApi.describeDataLocation(settings),
        syncRestorePoint: getSyncRestorePointInfo(),
        checklists: [],
        assignedChecklistId: "",
        currentChecklistId: "",
        message: error?.message || "Could not switch the assigned PocketBase checklist."
      };
    }
  }

  async function resolveChecklistRecord(credentials, auth, currentChecklist, { cacheRecord = false } = {}) {
    const meta = readSyncMeta();
    const preferredChecklistId = getPreferredChecklistId(meta) || getLastChecklistSelection(auth?.userId);
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
          cacheChecklistRecord(preferredRecord, auth.userId || meta.userId);
        }
        return {
          record: preferredRecord,
          assignmentChanged: !!meta.recordId && !checklistRefMatchesRecord(meta.recordId, preferredRecord),
          createdDefault: false,
          usingPreferred: preferredChecklistId !== assignedChecklistId
        };
      }

      writeSyncMeta({ preferredChecklistId: "" });
      rememberLastChecklistSelection(auth?.userId, "");
    }

    if (assignedRecord) {
      if (cacheRecord) {
        cacheChecklistRecord(assignedRecord, auth.userId || meta.userId);
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
      return normalizeChecklistData(rawData);
    }
    if (typeof rawData === "string" && rawData.trim()) {
      return normalizeChecklistData(JSON.parse(rawData));
    }
    throw new Error("The assigned PocketBase checklist does not contain valid checklist JSON.");
  }

  async function pushChecklistToRemote(checklist, options = {}) {
    const { credentials } = await syncContextApi.load();
    if (!syncContextApi.hasCredentials(credentials)) {
      return;
    }

    let normalizedChecklist = normalizeChecklistData(checklist);
    const auth = await authApi.getContext(credentials);
    const resolved = await resolveChecklistRecord(credentials, auth, normalizedChecklist);
    const meta = readSyncMeta();
    const record = resolved.record;
    const userId = auth.userId || meta.userId || extractUserIdFromToken(auth.token);
    const remoteVersion = getChecklistRecordVersion(record);
    const recordRef = getChecklistRef(record);
    const recordCollectionName = getChecklistRecordCollectionName(record);
    let knownVersion = checklistRefMatchesRecord(meta.recordId, record) ? meta.version : null;

    if (resolved.createdDefault) {
      clearDirtyIfChecklistStillCurrent(normalizedChecklist);
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
        "This device has not synced the assigned PocketBase checklist yet. Pull latest before pushing more changes.",
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
          "The server checklist changed while this device was offline. Review the new offline tasks before merging.",
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

    const updated = await authApi.request({
      credentials,
      auth,
      path: `/api/collections/${recordCollectionName}/records/${record.id}`,
      method: "PATCH",
      body,
      errorMessage: "Could not push the checklist to PocketBase."
    });

    if (updated && typeof updated === "object") {
      cacheChecklistRecord(updated, userId);
    } else {
      writeSyncMeta({
        recordId: recordRef,
        version: nextVersion,
        userId
      });
    }
    clearDirtyIfChecklistStillCurrent(normalizedChecklist);
    writeSyncMeta({ baseChecklist: normalizedChecklist });
    return normalizedChecklist;
  }

  function clearQueuedRemotePush() {
    clearTimeout(remotePushTimer);
    remotePushTimer = null;
    queuedRemoteChecklist = null;
  }

  function queueRemotePush(checklist) {
    queuedRemoteChecklist = cloneValue(normalizeChecklistData(checklist));
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
            await remoteSyncApi.push(nextChecklist);
          } catch {
            // Keep local saves fast even if the remote sync is unavailable.
          }
        });
    }, REMOTE_PUSH_DELAY_MS);
  }

  async function settlePendingRemotePush() {
    await remotePushPromise.catch(() => {});
  }

  // Remote sync helpers keep queue/push/pull orchestration grouped with the user-facing flow.
  const remoteSyncApi = {
    clearQueue() {
      clearQueuedRemotePush();
    },
    queue(checklist) {
      queueRemotePush(checklist);
    },
    async settleQueue() {
      await settlePendingRemotePush();
    },
    async push(checklist, options) {
      return await pushChecklistToRemote(checklist, options);
    },
    async pull(currentChecklist) {
      return await pullChecklistFromRemote(currentChecklist);
    },
    async syncNow(currentChecklist, options) {
      return await syncNow(currentChecklist, options);
    }
  };

  async function pullChecklistFromRemote(currentChecklist) {
    const { settings, credentials } = await syncContextApi.load();
    if (!syncContextApi.hasCredentials(credentials)) {
      return {
        ok: false,
        isError: false,
        checklist: getFallbackChecklist(currentChecklist),
        settings,
        dataLocation: syncContextApi.describeDataLocation(settings),
        message: "Enter the PocketBase URL, email, and password in Advanced settings to sync."
      };
    }

    const auth = await authApi.getContext(credentials);
    const resolved = await resolveChecklistRecord(credentials, auth, currentChecklist, { cacheRecord: false });
    const record = resolved.record;
    const checklist = cloneValue(extractChecklistData(record));
    writeJson(CHECKLIST_KEY, checklist);
    writeSyncMeta({
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
      dataLocation: syncContextApi.describeDataLocation(settings),
      syncRestorePoint: getSyncRestorePointInfo(),
      message: resolved.createdDefault
        ? "Created and synced a personal PocketBase checklist for this user."
        : resolved.usingPreferred
          ? `Pulled ${getChecklistRecordLabel(record)} for this device.`
          : `Pulled ${getChecklistRecordLabel(record)}.`
    };
  }

  function didSyncIdentityChange(previousSettings, nextSettings) {
    const previous = normalizeSettings(previousSettings).advanced;
    const next = normalizeSettings(nextSettings).advanced;
    return normalizeServerUrl(previous.serverUrl) !== normalizeServerUrl(next.serverUrl) ||
      previous.email.trim() !== next.email.trim() ||
      previous.password !== next.password;
  }

  async function syncNow(currentChecklist, options = {}) {
    remoteSyncApi.clearQueue();
    try {
      await remoteSyncApi.settleQueue();
      const localChecklist = getCurrentChecklistForSync(currentChecklist);
      saveSyncRestorePoint(localChecklist, "manual_sync");
      const syncMeta = readSyncMeta();
      const hasLocalChanges = !!syncMeta.dirty || (
        !!syncMeta.baseChecklist &&
        getChecklistSignature(localChecklist) !== getChecklistSignature(syncMeta.baseChecklist)
      );
      if (hasLocalChanges) {
        const pushedChecklist = await remoteSyncApi.push(localChecklist, options);
        const { settings } = await syncContextApi.load();
        return {
          ok: true,
          checklist: normalizeChecklistData(pushedChecklist || localChecklist),
          settings,
          dataLocation: syncContextApi.describeDataLocation(settings),
          syncRestorePoint: getSyncRestorePointInfo(),
          message: "Pushed local checklist changes."
        };
      }
      return await remoteSyncApi.pull(localChecklist);
    } catch (error) {
      const { settings } = await syncContextApi.load();
      return {
        ok: false,
        isError: true,
        checklist: getFallbackChecklist(currentChecklist),
        settings,
        dataLocation: syncContextApi.describeDataLocation(settings),
        syncRestorePoint: getSyncRestorePointInfo(),
        mergeRequired: !!error?.mergeRequired,
        mergeAdditions: Array.isArray(error?.mergeAdditions) ? error.mergeAdditions : [],
        message: error?.message || "Could not sync the assigned PocketBase checklist."
      };
    }
  }

  window.checkyStorage = {
    async loadState() {
      return await syncContextApi.loadLocalState();
    },
    async signInHostedSession(email, password) {
      const { settings, credentials } = await syncContextApi.load();
      const hostedSession = await authApi.signInHostedSession(credentials, email, password);
      return {
        ok: true,
        settings,
        dataLocation: syncContextApi.describeDataLocation(settings),
        hostedSession
      };
    },
    async saveChecklist(checklist) {
      const savedChecklist = writeJson(CHECKLIST_KEY, normalizeChecklistData(checklist));
      markLocalChecklistDirty();
      remoteSyncApi.queue(savedChecklist);
      return savedChecklist;
    },
    async saveSettings(settings) {
      const normalized = normalizeSettings(settings);
      const previousSettings = await syncContextApi.loadSettings();
      const authChanged = didSyncIdentityChange(previousSettings, normalized);

      try {
        await persistStoredPassword(normalized.advanced.password);
        if (authChanged) {
          await persistStoredToken("");
          clearSyncMeta();
          remoteSyncApi.clearQueue();
        }
      } catch {
        return {
          ok: false,
          settings: normalized,
          dataLocation: syncContextApi.describeDataLocation(normalized)
        };
      }

      return {
        ok: true,
        settings: withPassword(writeJson(SETTINGS_KEY, getPersistedSettings(normalized)), normalized.advanced.password),
        dataLocation: syncContextApi.describeDataLocation(normalized)
      };
    },
    async listAccessibleChecklists() {
      return await browseAccessibleChecklists();
    },
    async useAccessibleChecklist(checklistId, currentChecklist) {
      return await useAccessibleChecklist(checklistId, currentChecklist);
    },
    async resetChecklist() {
      const checklist = writeJson(CHECKLIST_KEY, normalizeChecklistData(DEFAULT_CHECKLIST));
      markLocalChecklistDirty();
      remoteSyncApi.queue(checklist);
      return checklist;
    },
    async exportChecklist(checklist) {
      const normalizedChecklist = normalizeChecklistData(checklist);
      const content = JSON.stringify(normalizedChecklist, null, 2);
      const storagePicker = getStoragePickerPlugin();
      if (storagePicker && typeof storagePicker.exportChecklist === "function") {
        return await storagePicker.exportChecklist({
          filename: "checkys-list-export.json",
          content
        });
      }

      downloadText("checkys-list-export.json", content);
      return { ok: true };
    },
    async importChecklistFromFile(file) {
      const text = await file.text();
      const parsed = normalizeChecklistData(JSON.parse(text));
      writeJson(CHECKLIST_KEY, parsed);
      markLocalChecklistDirty();
      remoteSyncApi.queue(parsed);
      return parsed;
    },
    async restoreSyncRestorePoint() {
      const point = readSyncRestorePoint();
      if (!point) {
        return {
          ok: false,
          message: "No local pre-sync backup is available right now.",
          syncRestorePoint: getSyncRestorePointInfo()
        };
      }

      remoteSyncApi.clearQueue();
      const checklist = writeJson(CHECKLIST_KEY, normalizeChecklistData(cloneValue(point.checklist)));
      markLocalChecklistDirty();

      return {
        ok: true,
        checklist,
        syncRestorePoint: getSyncRestorePointInfo(),
        message: "Restored the local pre-sync backup. Review it, then sync when you are ready."
      };
    },
    async syncNow(currentChecklist, options) {
      return await remoteSyncApi.syncNow(currentChecklist, options);
    }
  };
})();



