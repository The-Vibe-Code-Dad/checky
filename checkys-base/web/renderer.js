const DEFAULT_DATA = {
  active: 0,
  tabs: [{ name: "Tab 1", items: [] }]
};
const DONE_TAB_SYSTEM = "done";
const DEFAULT_SETTINGS = {
  showDoneTab: false,
  advanced: {
    serverUrl: "",
    email: "",
    password: ""
  }
};
const MAX_TABS = 100;
const MAX_ITEMS_PER_TAB = 1000;
const MAX_TAB_NAME_LENGTH = 120;
const MAX_ITEM_TEXT_LENGTH = 20000;

function normalizeHostedSession(session) {
  const safe = session && typeof session === "object" ? session : {};
  const user = safe.user && typeof safe.user === "object" ? safe.user : {};
  return {
    authenticated: !!safe.authenticated,
    setupRequired: !!safe.setupRequired,
    user: {
      id: typeof user.id === "string" ? user.id : "",
      email: typeof user.email === "string" ? user.email : ""
    }
  };
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

function normalizeServerUrl(serverUrl) {
  const trimmed = (typeof serverUrl === "string" ? serverUrl.trim() : "").replace(/\/+$/, "");
  if (!trimmed) {
    return "";
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function normalizeSyncRestorePointInfo(info) {
  const safe = info && typeof info === "object" ? info : {};
  return {
    available: !!safe.available,
    createdAt: typeof safe.createdAt === "string" ? safe.createdAt : "",
    source: typeof safe.source === "string" ? safe.source : ""
  };
}

function normalizeChecklistBrowserItem(item) {
  const safe = item && typeof item === "object" ? item : {};
  return {
    id: typeof safe.id === "string" ? safe.id : "",
    name: typeof safe.name === "string" ? safe.name : "",
    shareKey: typeof safe.shareKey === "string" ? safe.shareKey : "",
    label: typeof safe.label === "string" ? safe.label : "",
    role: typeof safe.role === "string" ? safe.role : "",
    isPersonal: !!safe.isPersonal,
    isAssigned: !!safe.isAssigned
  };
}

const state = {
  data: DEFAULT_DATA,
  settings: normalizeSettings(DEFAULT_SETTINGS),
  hostedSession: normalizeHostedSession(null),
  dataLocation: "",
  syncRestorePoint: normalizeSyncRestorePointInfo(null),
  availableChecklists: [],
  assignedChecklistId: "",
  currentChecklistId: "",
  ui: {
    tabDeleteConfirmIndex: null,
    itemDeleteConfirmIndex: null,
    editingTabIndex: null,
    draggedTabIndex: null,
    draggedItemIndex: null,
    itemContextMenu: null,
    doneSearch: "",
    doneViewOpen: false,
    settingsViewOpen: false,
    lastChecklistTabIndex: 0,
    resetConfirmArmed: false,
    syncInProgress: false,
    pullSyncDistance: 0,
    pullSyncArmed: false,
    lastSyncedAt: null,
    drawerOpen: false,
    advancedSettingsOpen: false,
    availableChecklistsLoading: false,
    availableChecklistsMessage: "",
    availableChecklistsError: false,
    checklistFoldersOpen: {},
    loginOverlayOpen: false,
    loginBusy: false,
    loginStatus: ""
  }
};

let saveTimer = null;
let lastChecklistSaveRequestId = 0;
let draggedItemPointerIndex = null;
let draggedTabPointerIndex = null;
let tabPointerDragState = null;
let itemPointerDragState = null;
let longPressTimer = null;
const LONG_PRESS_MS = 350;
const LONG_PRESS_MOVE_PX = 12;
let longPressPointerId = null;
let longPressStartX = 0;
let longPressStartY = 0;
let suppressCheckboxClick = false;
let suppressNextDocumentClick = false;
let suppressContextMenuFromDragHandle = false;
let pullSyncTouchId = null;
let pullSyncStartY = 0;
let pullSyncFeedbackTimer = null;
const PULL_SYNC_TRIGGER_PX = 84;
const PULL_SYNC_MAX_PX = 108;
const PULL_SYNC_DAMPING = 0.6;

const els = {
  navToggle: document.getElementById("navToggle"),
  navBackdrop: document.getElementById("navBackdrop"),
  navDrawer: document.getElementById("navDrawer"),
  navCloseBtn: document.getElementById("navCloseBtn"),
  contentScroll: document.getElementById("contentScroll"),
  pullSyncIndicator: document.getElementById("pullSyncIndicator"),
  pullSyncLabel: document.getElementById("pullSyncLabel"),
  specialViewHeader: document.getElementById("specialViewHeader"),
  specialViewTitle: document.getElementById("specialViewTitle"),
  specialViewCloseBtn: document.getElementById("specialViewCloseBtn"),
  tabs: document.getElementById("tabs"),
  list: document.getElementById("list"),
  addTabBtn: document.getElementById("addTabBtn"),
  installedAddonLinks: document.getElementById("installedAddonLinks"),
  addonView: document.getElementById("addonView"),
  addonFrame: document.getElementById("addonFrame"),
  addItemBtn: document.getElementById("addItemBtn"),
  settingsPanel: document.getElementById("settingsPanel"),
  doneToggle: document.getElementById("doneToggle"),
  settingsToggle: document.getElementById("settingsToggle"),
  showDoneTab: document.getElementById("showDoneTab"),
  advancedSettingsToggle: document.getElementById("advancedSettingsToggle"),
  advancedSummary: document.getElementById("advancedSummary"),
  advancedSettingsPanel: document.getElementById("advancedSettingsPanel"),
  serverUrlInput: document.getElementById("serverUrlInput"),
  syncEmailInput: document.getElementById("syncEmailInput"),
  syncPasswordInput: document.getElementById("syncPasswordInput"),
  checklistNavigation: document.getElementById("checklistNavigation"),
  checklistTabPanel: document.getElementById("checklistTabPanel"),
  alwaysVisibleTabs: document.getElementById("alwaysVisibleTabs"),
  checklistFolders: document.getElementById("checklistFolders"),
  refreshChecklistsBtn: document.getElementById("refreshChecklistsBtn"),
  availableChecklistsStatus: document.getElementById("availableChecklistsStatus"),
  doneArchiveTools: document.getElementById("doneArchiveTools"),
  doneSearchInput: document.getElementById("doneSearchInput"),
  dataLocation: document.getElementById("dataLocation"),
  syncNowBtn: document.getElementById("syncNowBtn"),
  syncRestorePointSummary: document.getElementById("syncRestorePointSummary"),
  restoreSyncRestorePointBtn: document.getElementById("restoreSyncRestorePointBtn"),
  exportChecklistBtn: document.getElementById("exportChecklistBtn"),
  importChecklistInput: document.getElementById("importChecklistInput"),
  resetChecklistBtn: document.getElementById("resetChecklistBtn"),
  settingsStatus: document.getElementById("settingsStatus"),
  currentViewTitle: document.getElementById("currentViewTitle"),
  mainDivider: document.getElementById("mainDivider"),
  itemContextMenu: document.getElementById("itemContextMenu"),
  loginOverlay: document.getElementById("loginOverlay"),
  loginServerUrlInput: document.getElementById("loginServerUrlInput"),
  loginEmailInput: document.getElementById("loginEmailInput"),
  loginPasswordInput: document.getElementById("loginPasswordInput"),
  loginSubmitBtn: document.getElementById("loginSubmitBtn"),
  loginSettingsBtn: document.getElementById("loginSettingsBtn"),
  loginStatus: document.getElementById("loginStatus")
};

function createEntityId(prefix) {
  if (window.crypto?.randomUUID) return prefix + "-" + window.crypto.randomUUID();
  return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
}

function normalizeData(data) {
  const safe = data && typeof data === "object" ? data : {};
  const tabs = Array.isArray(safe.tabs) && safe.tabs.length ? safe.tabs.slice(0, MAX_TABS) : [{ name: "Tab 1", items: [] }];
  tabs.forEach((tab, index) => {
    const normalizedName = sanitizeSingleLineText(tab?.name, MAX_TAB_NAME_LENGTH);
    tab.id = typeof tab.id === "string" && tab.id.trim() ? tab.id.trim().slice(0, 120) : "legacy-tab-" + index;
    tab.name = normalizedName || `Tab ${index + 1}`;
    if (!Array.isArray(tab.items)) tab.items = [];
    tab.items = tab.items.slice(0, MAX_ITEMS_PER_TAB);
    tab.system = tab.system === DONE_TAB_SYSTEM ? DONE_TAB_SYSTEM : undefined;
    tab.items = tab.items.map((item, itemIndex) => ({
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
      reminderCheckedAt: typeof item?.reminderCheckedAt === 'string' && Number.isFinite(Date.parse(item.reminderCheckedAt)) ? new Date(item.reminderCheckedAt).toISOString() : null,
      reminderResetAt: typeof item?.reminderResetAt === 'string' && Number.isFinite(Date.parse(item.reminderResetAt)) ? new Date(item.reminderResetAt).toISOString() : null,
      originalTabName: sanitizeSingleLineText(item?.originalTabName, MAX_TAB_NAME_LENGTH) || null
    }));
  });
  let active = Number.isInteger(safe.active) ? safe.active : 0;
  if (active < 0 || active >= tabs.length) active = 0;
  return { active, tabs };
}

function isDoneTab(tab) {
  return tab?.system === DONE_TAB_SYSTEM;
}

function getDoneTabIndex() {
  return state.data.tabs.findIndex((tab) => isDoneTab(tab));
}

function getVisibleTabs() {
  return state.data.tabs.map((tab, index) => ({ tab, index })).filter(({ tab }) => !isDoneTab(tab));
}

function getSafeChecklistTabIndex(preferredIndex = state.ui.lastChecklistTabIndex) {
  if (Number.isInteger(preferredIndex) && preferredIndex >= 0 && preferredIndex < state.data.tabs.length) {
    if (!isDoneTab(state.data.tabs[preferredIndex])) return preferredIndex;
  }
  const firstRegular = state.data.tabs.findIndex((tab) => !isDoneTab(tab));
  return firstRegular === -1 ? 0 : firstRegular;
}

function ensureDoneTabState() {
  let doneTabIndex = getDoneTabIndex();
  if (state.settings.showDoneTab && doneTabIndex === -1) {
    state.data.tabs.push({ id: createEntityId("tab"), name: "Done", system: DONE_TAB_SYSTEM, items: [] });
    doneTabIndex = state.data.tabs.length - 1;
  }

  if (doneTabIndex !== -1 && doneTabIndex !== state.data.tabs.length - 1) {
    const [doneTab] = state.data.tabs.splice(doneTabIndex, 1);
    state.data.tabs.push(doneTab);
    if (state.data.active === doneTabIndex) state.data.active = state.data.tabs.length - 1;
    else if (state.data.active > doneTabIndex) state.data.active -= 1;
    if (state.ui.lastChecklistTabIndex > doneTabIndex) state.ui.lastChecklistTabIndex -= 1;
  }

  if (state.data.tabs.every((tab) => isDoneTab(tab))) {
    state.data.tabs.unshift({ id: createEntityId("tab"), name: "Tab 1", items: [] });
    state.data.active += 1;
  }

  // This device's display preference must never delete synced archive data.
  if (!state.settings.showDoneTab) {
    state.ui.doneViewOpen = false;
    if (isDoneTab(state.data.tabs[state.data.active])) {
      state.data.active = getSafeChecklistTabIndex();
    }
  }
}

function setStatus(message, isError = false) {
  els.settingsStatus.textContent = message;
  els.settingsStatus.style.color = isError ? "#ff9494" : "#b7b7b7";
}

function setLoginStatus(message, isError = false) {
  state.ui.loginStatus = typeof message === "string" ? message : "";
  els.loginStatus.textContent = state.ui.loginStatus;
  els.loginStatus.style.color = isError ? "#ffb0b0" : "#b7b7b7";
}

function isHostedWebRuntime() {
  return !window.Capacitor && window.location?.protocol !== "file:";
}

function getHostedServerUrl() {
  if (!isHostedWebRuntime()) return "";
  return window.location.origin.replace(/\/+$/, "");
}

function hasHostedLoginCredentials() {
  return !!state.hostedSession?.authenticated;
}

function syncLoginOverlayInputs() {
  const advanced = normalizeSettings(state.settings).advanced;
  els.loginServerUrlInput.value = advanced.serverUrl || getHostedServerUrl();
  els.loginEmailInput.value = advanced.email;
  els.loginPasswordInput.value = advanced.password;
  els.loginSubmitBtn.disabled = state.ui.loginBusy;
  els.loginSubmitBtn.textContent = state.ui.loginBusy ? "Signing in..." : "Sign in";
  setLoginStatus(state.ui.loginStatus);
}

function getAdvancedSyncSummary() {
  const advanced = normalizeSettings(state.settings).advanced;
  const serverUrl = normalizeServerUrl(advanced.serverUrl);
  const email = advanced.email.trim();

  if (email && serverUrl) {
    return `${email} @ ${serverUrl}`;
  }
  if (email) {
    return email;
  }
  if (serverUrl) {
    return serverUrl;
  }
  return "No server configured";
}

function getSyncRestorePointSummary() {
  const info = normalizeSyncRestorePointInfo(state.syncRestorePoint);
  if (!info.available || !info.createdAt) {
    return "No pre-sync backup yet";
  }

  const createdAt = new Date(info.createdAt);
  if (Number.isNaN(createdAt.getTime())) {
    return "Pre-sync backup available";
  }
  return `Saved ${createdAt.toLocaleString()}`;
}

function ensureNavigationPreferences() {
  const advanced = normalizeSettings(state.settings).advanced;
  const account = state.hostedSession?.user?.id || advanced.email.trim().toLowerCase();
  const scope = "checkys-navigation-v1:" + JSON.stringify([advanced.serverUrl, account]);
  if (state.ui.navigationScope === scope) return;
  state.ui.navigationScope = scope;
  state.ui.checklistFoldersOpen = {};
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(scope) || "{}"); } catch {}
  const order = Array.isArray(saved?.folderOrder) ? saved.folderOrder : [];
  state.ui.navigationPreferences = {
    folderOrder: [...new Set([...order.filter((key) => key === "personal" || key === "shared"), "personal", "shared"])],
    alwaysVisibleTabs: Array.isArray(saved?.alwaysVisibleTabs) ? saved.alwaysVisibleTabs.filter((pin) =>
      pin && typeof pin.checklistId === "string" && typeof pin.tabId === "string" && typeof pin.name === "string"
    ).slice(0, 200) : []
  };
}

function saveNavigationPreferences() {
  try { localStorage.setItem(state.ui.navigationScope, JSON.stringify(state.ui.navigationPreferences)); } catch {}
}

function isTabAlwaysVisible(tabId) {
  ensureNavigationPreferences();
  return state.ui.navigationPreferences.alwaysVisibleTabs.some((pin) =>
    pin.checklistId === (state.currentChecklistId || "local") && pin.tabId === tabId
  );
}

function addAlwaysShowOption(container, tab, input) {
  const label = document.createElement("label");
  label.className = "tab-always-show-option";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = isTabAlwaysVisible(tab.id);
  label.append(checkbox, document.createTextNode("Always show"));
  label.title = "Keep this tab above the folders, even when they are collapsed";
  label.onclick = (event) => event.stopPropagation();
  label.onpointerdown = (event) => event.stopPropagation();
  checkbox.onchange = () => {
    const cleanName = input.value.trim().slice(0, 120);
    if (cleanName) tab.name = cleanName;
    const checklistId = state.currentChecklistId || "local";
    const pins = state.ui.navigationPreferences.alwaysVisibleTabs.filter((pin) =>
      pin.checklistId !== checklistId || pin.tabId !== tab.id
    );
    if (checkbox.checked) pins.push({ checklistId, tabId: tab.id, name: tab.name });
    state.ui.navigationPreferences.alwaysVisibleTabs = pins;
    saveNavigationPreferences();
    renderTabs();
    debounceSaveChecklist();
  };
  container.appendChild(label);
}

async function openAlwaysVisibleTab(pin) {
  if (!leaveInstalledAddon()) return;
  if (state.ui.syncInProgress || state.ui.availableChecklistsLoading) return;
  if (pin.checklistId !== (state.currentChecklistId || "local")) {
    if (!await useSelectedChecklist(pin.checklistId)) return;
  }
  const index = state.data.tabs.findIndex((tab) => tab.id === pin.tabId && !isDoneTab(tab));
  if (index === -1) {
    state.ui.navigationPreferences.alwaysVisibleTabs = state.ui.navigationPreferences.alwaysVisibleTabs.filter((item) =>
      item.checklistId !== pin.checklistId || item.tabId !== pin.tabId
    );
    saveNavigationPreferences();
    renderTabs();
    return;
  }
  state.data.active = index;
  state.ui.lastChecklistTabIndex = index;
  state.ui.doneViewOpen = false;
  state.ui.settingsViewOpen = false;
  if (typeof closeDrawer === "function") closeDrawer();
  render();
  debounceSaveChecklist();
}

function renderAlwaysVisibleShortcuts() {
  ensureNavigationPreferences();
  els.alwaysVisibleTabs.replaceChildren();
  const checklistId = state.currentChecklistId || "local";
  const previous = JSON.stringify(state.ui.navigationPreferences.alwaysVisibleTabs);
  state.ui.navigationPreferences.alwaysVisibleTabs = state.ui.navigationPreferences.alwaysVisibleTabs.filter((pin) => {
    if (pin.checklistId !== checklistId) return true;
    const tab = state.data.tabs.find((item) => item.id === pin.tabId && !isDoneTab(item));
    if (!tab) return false;
    pin.name = tab.name;
    return true;
  });
  if (previous !== JSON.stringify(state.ui.navigationPreferences.alwaysVisibleTabs)) saveNavigationPreferences();
  for (const pin of state.ui.navigationPreferences.alwaysVisibleTabs) {
    if (pin.checklistId === checklistId) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tab always-visible-shortcut";
    button.textContent = pin.name;
    button.title = "Always shown tab: " + pin.name;
    button.onclick = () => void openAlwaysVisibleTab(pin);
    els.alwaysVisibleTabs.appendChild(button);
  }
}

function reorderChecklistFolder(folderKey, targetKey) {
  const order = state.ui.navigationPreferences.folderOrder;
  const from = order.indexOf(folderKey);
  const to = order.indexOf(targetKey);
  if (from < 0 || to < 0 || from === to) return;
  order.splice(to, 0, ...order.splice(from, 1));
  saveNavigationPreferences();
  renderChecklistPicker();
  els.checklistFolders.querySelector('[data-folder="' + folderKey + '"] > summary')?.focus();
}

function renderChecklistPicker() {
  ensureNavigationPreferences();
  const current = state.availableChecklists.find((item) => item.id === state.currentChecklistId);
  const busy = state.ui.syncInProgress || state.ui.availableChecklistsLoading;
  const advanced = normalizeSettings(state.settings).advanced;
  const connected = !!(advanced.serverUrl && advanced.email);
  els.checklistNavigation.setAttribute("aria-busy", String(busy));
  for (const folder of els.checklistFolders.querySelectorAll(".checklist-folder")) {
    state.ui.checklistFoldersOpen[folder.dataset.folder] = folder.open;
  }
  // Keep the live tab controls intact when rebuilding the surrounding folders.
  els.checklistNavigation.insertBefore(els.checklistTabPanel, els.availableChecklistsStatus);
  els.checklistFolders.replaceChildren();
  for (const folderKey of state.ui.navigationPreferences.folderOrder) {
    const isPersonal = folderKey === "personal";
    const items = state.availableChecklists.filter((item) => item.isPersonal === isPersonal);
    if (!items.length) continue;
    const name = isPersonal ? "Personal" : "Shared";
    const group = document.createElement("details");
    group.className = "checklist-folder";
    group.dataset.folder = folderKey;
    group.open = state.ui.checklistFoldersOpen[folderKey] ?? (current?.isPersonal === isPersonal);
    const heading = document.createElement("summary");
    heading.className = "folder-tab-heading" + (!activeAddon && current?.isPersonal === isPersonal ? " active" : "");
    heading.draggable = true;
    heading.title = "Expand " + name + "; drag to reorder";
    const triangle = document.createElement("span");
    triangle.className = "folder-disclosure";
    triangle.textContent = "\u25b8";
    triangle.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.className = "folder-tab-label";
    label.textContent = name;
    heading.append(triangle, label);
    const move = document.createElement("button");
    move.type = "button";
    move.className = "btn btn-ghost folder-move-button";
    const position = state.ui.navigationPreferences.folderOrder.indexOf(folderKey);
    move.textContent = position === 0 ? "\u2193" : "\u2191";
    move.title = "Move " + name + (position === 0 ? " down" : " up");
    move.setAttribute("aria-label", move.title);
    move.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      reorderChecklistFolder(folderKey, isPersonal ? "shared" : "personal");
    };
    heading.appendChild(move);
    heading.onclick = (event) => {
      if (event.target.closest("button")) return;
      event.preventDefault();
      group.open = !group.open;
      state.ui.checklistFoldersOpen[folderKey] = group.open;
      if (group.open && items.length === 1 && (activeAddon || items[0].id !== state.currentChecklistId) && !busy) {
        void useSelectedChecklist(items[0].id);
      }
    };
    heading.ondragstart = (event) => {
      state.ui.draggedChecklistFolder = folderKey;
      event.dataTransfer.setData("text/plain", folderKey);
      event.dataTransfer.effectAllowed = "move";
    };
    heading.ondragover = (event) => {
      if (!state.ui.draggedChecklistFolder) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    };
    heading.ondrop = (event) => {
      if (!state.ui.draggedChecklistFolder) return;
      event.preventDefault();
      event.stopPropagation();
      reorderChecklistFolder(state.ui.draggedChecklistFolder, folderKey);
      state.ui.draggedChecklistFolder = null;
    };
    heading.ondragend = () => { state.ui.draggedChecklistFolder = null; };
    group.appendChild(heading);
    const contents = document.createElement("div");
    contents.className = "folder-tab-contents";
    for (const item of items) {
      const isCurrent = item.id === state.currentChecklistId;
      if (!isCurrent || items.length > 1) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "tab checklist-choice" + (isCurrent ? " active" : "");
        button.setAttribute("aria-current", String(isCurrent));
        button.disabled = busy || (isCurrent && !activeAddon);
        button.textContent = item.label || item.name || name + " checklist";
        button.onclick = () => void useSelectedChecklist(item.id);
        contents.appendChild(button);
      }
      if (isCurrent) contents.appendChild(els.checklistTabPanel);
    }
    group.appendChild(contents);
    els.checklistFolders.appendChild(group);
  }
  els.refreshChecklistsBtn.disabled = busy;
  els.refreshChecklistsBtn.classList.toggle("hidden", !connected && !state.availableChecklists.length);
  els.availableChecklistsStatus.textContent = state.ui.availableChecklistsLoading
    ? "Loading checklists..." : state.ui.availableChecklistsMessage;
  els.availableChecklistsStatus.style.color = state.ui.availableChecklistsError ? "#ffb0b0" : "";
}

function isSettingsOpen() {
  return state.ui.settingsViewOpen;
}

function isSpecialViewOpen() {
  return state.ui.settingsViewOpen || state.ui.doneViewOpen || !!activeAddon;
}

function rememberCurrentChecklistTab() {
  if (isSpecialViewOpen()) return;
  state.ui.lastChecklistTabIndex = getSafeChecklistTabIndex(state.data.active);
}

function setDrawerOpen(isOpen) {
  state.ui.drawerOpen = isOpen;
  els.navDrawer.classList.toggle("hidden", !isOpen);
  els.navBackdrop.classList.toggle("hidden", !isOpen);
  els.navDrawer.setAttribute("aria-hidden", String(!isOpen));
}

function closeDrawer() {
  setDrawerOpen(false);
}

function openDrawer() {
  void loadInstalledAddons();
  closeItemContextMenu();
  setDrawerOpen(true);
  if (!state.ui.syncInProgress) void loadAvailableChecklists();
}

function openSettingsView() {
  if (!leaveInstalledAddon()) return;
  rememberCurrentChecklistTab();
  state.ui.settingsViewOpen = true;
  state.ui.doneViewOpen = false;
  closeDrawer();
  els.contentScroll.scrollTop = 0;
  render();
}

function openDoneView() {
  if (!leaveInstalledAddon()) return;
  const doneTabIndex = getDoneTabIndex();
  if (doneTabIndex === -1) return;
  rememberCurrentChecklistTab();
  state.ui.settingsViewOpen = false;
  state.ui.doneViewOpen = true;
  state.data.active = doneTabIndex;
  closeDrawer();
  els.contentScroll.scrollTop = 0;
  render();
}

function closeSpecialView() {
  if (!isSpecialViewOpen()) return;
  state.ui.settingsViewOpen = false;
  state.ui.doneViewOpen = false;
  state.data.active = getSafeChecklistTabIndex(state.ui.lastChecklistTabIndex);
  render();
}

function clearPendingSave() {
  clearTimeout(saveTimer);
  saveTimer = null;
}

function createChecklistSnapshot() {
  return normalizeData(JSON.parse(JSON.stringify(state.data)));
}

async function persistChecklistSnapshot(snapshot, requestId, { updateStatus = true } = {}) {
  try {
    await window.checkyStorage.saveChecklist(snapshot);
    if (updateStatus && requestId === lastChecklistSaveRequestId) {
      setStatus("Saved.");
    }
    return true;
  } catch {
    if (updateStatus && requestId === lastChecklistSaveRequestId) {
      setStatus("Failed to save checklist.", true);
    }
    return false;
  }
}

function persistChecklistImmediately() {
  clearPendingSave();
  const requestId = ++lastChecklistSaveRequestId;
  const snapshot = createChecklistSnapshot();
  void persistChecklistSnapshot(snapshot, requestId, { updateStatus: false });
}

async function flushPendingSave() {
  if (!saveTimer) {
    return true;
  }

  clearPendingSave();
  const requestId = ++lastChecklistSaveRequestId;
  const snapshot = createChecklistSnapshot();
  const ok = await persistChecklistSnapshot(snapshot, requestId, { updateStatus: false });
  if (!ok) {
    setStatus("Failed to save checklist.", true);
  }
  return ok;
}

function debounceSaveChecklist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    const requestId = ++lastChecklistSaveRequestId;
    const snapshot = createChecklistSnapshot();
    await persistChecklistSnapshot(snapshot, requestId);
  }, 300);
}

async function persistSettings() {
  state.settings = normalizeSettings(state.settings);
  const result = await window.checkyStorage.saveSettings(state.settings);
  if (!result.ok) {
    setStatus("Failed to save settings.", true);
    return;
  }
  state.settings = normalizeSettings(result.settings);
  if (result?.dataLocation) {
    state.dataLocation = result.dataLocation;
  }
  renderSettings();
  setStatus("Settings saved.");
}

function updateAdvancedSettings(field, value) {
  state.settings = normalizeSettings({
    ...state.settings,
    advanced: {
      ...state.settings.advanced,
      [field]: value
    }
  });
}

async function persistVisibleAdvancedSettings() {
  const advanced = normalizeSettings(state.settings).advanced;
  const nextSettings = normalizeSettings({
    ...state.settings,
    advanced: {
      ...state.settings.advanced,
      serverUrl: isHostedWebRuntime()
        ? (advanced.serverUrl || getHostedServerUrl())
        : els.serverUrlInput.value.trim(),
      email: isHostedWebRuntime()
        ? advanced.email.trim()
        : els.syncEmailInput.value.trim(),
      password: isHostedWebRuntime() ? "" : els.syncPasswordInput.value
    }
  });

  state.settings = nextSettings;
  const result = await window.checkyStorage.saveSettings(nextSettings);
  if (!result.ok) {
    setStatus("Failed to save settings.", true);
    return false;
  }

  state.settings = normalizeSettings(result.settings);
  if (result?.dataLocation) {
    state.dataLocation = result.dataLocation;
  }
  renderSettings();
  return true;
}

async function loadAvailableChecklists() {
  if (state.ui.availableChecklistsLoading) return;
  state.ui.availableChecklistsLoading = true;
  state.ui.availableChecklistsError = false;
  state.ui.availableChecklistsMessage = "";
  renderSettings();

  try {
    const result = await window.checkyStorage.listAccessibleChecklists();
    if (result?.ok === false) throw new Error("Checklist refresh failed");
    state.availableChecklists = Array.isArray(result?.checklists)
      ? result.checklists.map((item) => normalizeChecklistBrowserItem(item))
      : [];
    state.assignedChecklistId = typeof result?.assignedChecklistId === "string" ? result.assignedChecklistId : "";
    state.currentChecklistId = typeof result?.currentChecklistId === "string" ? result.currentChecklistId : "";
    state.ui.availableChecklistsMessage = "";
    // The response carries settings from before the request. Keep newer local choices.
    if (typeof result?.dataLocation === "string") {
      state.dataLocation = result.dataLocation;
    }
  } catch {
    state.ui.availableChecklistsMessage = "Could not refresh checklists. Your current checklist is still open.";
    state.ui.availableChecklistsError = true;
  } finally {
    state.ui.availableChecklistsLoading = false;
    renderSettings();
  }
}

async function useSelectedChecklist(selectedChecklistId) {
  if (state.ui.syncInProgress || state.ui.availableChecklistsLoading || !selectedChecklistId) return;
  if (!leaveInstalledAddon()) return false;
  if (selectedChecklistId === state.currentChecklistId) {
    state.ui.settingsViewOpen = false; state.ui.doneViewOpen = false; closeDrawer(); render(); return true;
  }

  state.ui.syncInProgress = true;
  state.ui.availableChecklistsError = false;
  state.ui.availableChecklistsMessage = "Opening checklist...";
  renderChecklistPicker();
  let switched = false;
  try {
    if (!await flushPendingSave()) throw new Error("Could not save your current checklist. Please try again.");
    if (!await persistVisibleAdvancedSettings()) throw new Error("Could not save settings. Please try again.");
    const result = await window.checkyStorage.useAccessibleChecklist(selectedChecklistId, state.data);
    if (!result?.ok) throw new Error(result?.message || "Could not open that checklist. Please try again.");
    state.ui.settingsViewOpen = false;
    state.ui.doneViewOpen = false;
    state.ui.doneSearch = "";
    state.ui.editingTabIndex = null;
    state.ui.tabDeleteConfirmIndex = null;
    state.ui.itemDeleteConfirmIndex = null;
    closeItemContextMenu();
    applyChecklistSwitchResult(result);
    state.ui.lastChecklistTabIndex = state.data.active;
    switched = true;
    setStatus(result.message || "Checklist opened.");
  } catch (error) {
    state.ui.availableChecklistsMessage = error?.message || "Could not open that checklist. Please try again.";
    state.ui.availableChecklistsError = true;
  } finally {
    state.ui.syncInProgress = false;
    renderSettings();
    if (switched) {
      const current = state.availableChecklists.find((item) => item.id === state.currentChecklistId);
      const key = current?.isPersonal ? "personal" : "shared";
      els.checklistFolders.querySelector('[data-folder="' + key + '"] > summary')?.focus();
    }
  }
  return switched;
}

function applyChecklistSwitchResult(result) {
  if (result?.checklist) {
    state.data = normalizeData(result.checklist);
  }
  if (result?.settings) {
    state.settings = normalizeSettings(result.settings);
  }
  if (typeof result?.dataLocation === "string") {
    state.dataLocation = result.dataLocation;
  }
  if (result?.syncRestorePoint) {
    state.syncRestorePoint = normalizeSyncRestorePointInfo(result.syncRestorePoint);
  }
  state.availableChecklists = Array.isArray(result?.checklists)
    ? result.checklists.map((item) => normalizeChecklistBrowserItem(item))
    : state.availableChecklists;
  state.assignedChecklistId = typeof result?.assignedChecklistId === "string" ? result.assignedChecklistId : state.assignedChecklistId;
  state.currentChecklistId = typeof result?.currentChecklistId === "string" ? result.currentChecklistId : state.currentChecklistId;
  state.ui.availableChecklistsMessage = "";
  render();
}

function formatSyncTime(date = new Date()) {
  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });
}

function setPullSyncIndicator(message, { height = state.ui.pullSyncDistance, visible = height > 0, ready = false, loading = false, error = false } = {}) {
  const safeHeight = Math.max(0, Math.round(height));
  els.pullSyncIndicator.style.height = visible ? `${safeHeight}px` : "0px";
  els.pullSyncIndicator.classList.toggle("visible", visible);
  els.pullSyncIndicator.classList.toggle("ready", ready);
  els.pullSyncIndicator.classList.toggle("loading", loading);
  els.pullSyncIndicator.classList.toggle("error", error);
  els.pullSyncLabel.textContent = message;
}

function resetPullSyncIndicator() {
  clearTimeout(pullSyncFeedbackTimer);
  pullSyncFeedbackTimer = null;
  state.ui.pullSyncDistance = 0;
  state.ui.pullSyncArmed = false;
  setPullSyncIndicator("Pull down to sync", { height: 0, visible: false });
}

function flashPullSyncIndicator(message, isError = false, duration = 1200) {
  clearTimeout(pullSyncFeedbackTimer);
  setPullSyncIndicator(message, {
    height: 52,
    visible: true,
    error: isError
  });
  pullSyncFeedbackTimer = setTimeout(() => {
    pullSyncFeedbackTimer = null;
    if (state.ui.syncInProgress) return;
    resetPullSyncIndicator();
  }, duration);
}

function findTouchById(touchList, touchId) {
  if (touchId === null) return null;
  for (let index = 0; index < touchList.length; index += 1) {
    if (touchList[index].identifier === touchId) {
      return touchList[index];
    }
  }
  return null;
}

function canStartPullSync(target) {
  if (state.ui.syncInProgress) return false;
  if (state.ui.drawerOpen) return false;
  if (state.ui.itemContextMenu) return false;
  if (state.ui.draggedItemIndex !== null || state.ui.draggedTabIndex !== null) return false;
  if (itemPointerDragState || tabPointerDragState) return false;
  if (els.contentScroll.scrollTop > 0) return false;
  return !target.closest("textarea, input, button, .drag-handle, .context-menu");
}

function cancelPullSyncGesture(keepIndicator = false) {
  pullSyncTouchId = null;
  pullSyncStartY = 0;
  if (!keepIndicator && !state.ui.syncInProgress) {
    resetPullSyncIndicator();
  }
}

async function runManualSync(source = "settings") {
  if (state.ui.syncInProgress) return;

  const didFlushPendingSave = await flushPendingSave();
  if (!didFlushPendingSave) {
    flashPullSyncIndicator("Failed to save checklist.", true, 1600);
    return;
  }
  closeItemContextMenu();
  clearTimeout(pullSyncFeedbackTimer);
  pullSyncFeedbackTimer = null;
  state.ui.syncInProgress = true;
  renderSettings();
  setPullSyncIndicator("Syncing...", {
    height: 52,
    visible: true,
    loading: true
  });

  try {
    const didPersistVisibleSettings = await persistVisibleAdvancedSettings();
    if (!didPersistVisibleSettings) {
      flashPullSyncIndicator("Failed to save settings.", true, 1600);
      return;
    }

    let result = await window.checkyStorage.syncNow(state.data);
    if (result?.mergeRequired) {
      const additions = Array.isArray(result.mergeAdditions) ? result.mergeAdditions : [];
      const preview = additions
        .map((item) => "- " + (item.text?.trim() || "(empty task)") + " [" + (item.tabName || "Checklist") + "]")
        .join("\n");
      const approved = window.confirm(
        "This checklist changed on the server while this device was offline.\n\n" +
        "Only these new offline tasks will be added to the newer server list:\n\n" +
        preview +
        "\n\nOffline edits and deletions will not be applied. Merge these new tasks?"
      );
      if (!approved) {
        setStatus("Merge cancelled. Your offline checklist remains saved on this device.", true);
        flashPullSyncIndicator("Merge cancelled.", true, 1600);
        return;
      }
      result = await window.checkyStorage.syncNow(state.data, { allowNewItemMerge: true });
    }
    if (result?.checklist) {
      state.data = normalizeData(result.checklist);
    }
    if (result?.settings) {
      state.settings = normalizeSettings(result.settings);
    }
    if (result?.dataLocation) {
      state.dataLocation = result.dataLocation;
    }
    if (result?.syncRestorePoint) {
      state.syncRestorePoint = normalizeSyncRestorePointInfo(result.syncRestorePoint);
    }
    render();
    if (result?.ok) {
      await loadAvailableChecklists();
    }

    if (result?.ok) {
      state.ui.lastSyncedAt = new Date();
      const message = `${result.message || "Synced."} ${formatSyncTime(state.ui.lastSyncedAt)}.`;
      setStatus(message);
      flashPullSyncIndicator("Synced just now.");
      return;
    }

    const message = result?.message || "Sync is not available right now.";
    setStatus(message, !!result?.isError);
    flashPullSyncIndicator(message, !!result?.isError, 1600);
  } catch {
    setStatus("Sync failed.", true);
    flashPullSyncIndicator("Sync failed.", true, 1600);
  } finally {
    state.ui.syncInProgress = false;
    renderSettings();
    if (source !== "pull" && !pullSyncFeedbackTimer) {
      resetPullSyncIndicator();
    }
  }
}

function formatDoneTimestamp(date = new Date()) {
  return date.toLocaleString();
}

function getCompletedDate(item) {
  if (!item?.completedAt) return null;
  const date = new Date(item.completedAt);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatArchiveMonth(date) {
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function formatArchiveDay(date) {
  return date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

function formatArchiveTime(date) {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function getUnknownArchiveLabel() {
  return "Unknown completion date";
}

function createArchiveHeading(text, className) {
  const heading = document.createElement("div");
  heading.className = className;
  heading.textContent = text;
  return heading;
}

function moveInArray(arr, fromIndex, toIndex) {
  if (fromIndex === toIndex) return;
  const moved = arr.splice(fromIndex, 1)[0];
  arr.splice(toIndex, 0, moved);
}

function createDragHandle(title) {
  const handle = document.createElement("div");
  handle.className = "drag-handle";
  handle.title = title;
  handle.draggable = false;
  handle.style.touchAction = "none";
  for (let index = 0; index < 3; index += 1) {
    const line = document.createElement("span");
    line.className = "line";
    handle.appendChild(line);
  }
  return handle;
}

function canStartTabDrag(event) {
  return !!event.target.closest(".drag-handle");
}

function canStartItemDrag(event) {
  return !!event.target.closest(".drag-handle");
}

function clearItemDragState() {
  state.ui.draggedItemIndex = null;
  draggedItemPointerIndex = null;
  itemPointerDragState = null;
  endDragHandlePress();
  clearTimeout(longPressTimer);
  longPressTimer = null;
  document.querySelectorAll(".item").forEach((el) => {
    el.classList.remove("dragging");
    el.classList.remove("drag-over");
  });
}

function clearTabDragState() {
  state.ui.draggedTabIndex = null;
  draggedTabPointerIndex = null;
  tabPointerDragState = null;
  endDragHandlePress();
  clearTimeout(longPressTimer);
  longPressTimer = null;
  document.querySelectorAll(".tab").forEach((el) => {
    el.classList.remove("dragging");
    el.classList.remove("drag-over");
  });
}

function clearLongPressTimer() {
  clearTimeout(longPressTimer);
  longPressTimer = null;
  longPressPointerId = null;
}

function beginDragHandlePress() {
  suppressContextMenuFromDragHandle = true;
}

function endDragHandlePress() {
  suppressContextMenuFromDragHandle = false;
}

function startLongPress(event, callback) {
  clearLongPressTimer();
  longPressPointerId = event.pointerId;
  longPressStartX = event.clientX;
  longPressStartY = event.clientY;
  longPressTimer = setTimeout(() => {
    suppressNextDocumentClick = true;
    const point = { x: longPressStartX, y: longPressStartY };
    clearLongPressTimer();
    callback(point);
  }, LONG_PRESS_MS);
}

function cancelLongPressOnMove(event) {
  if (longPressTimer === null || longPressPointerId !== event.pointerId) return;
  if (Math.abs(event.clientX - longPressStartX) > LONG_PRESS_MOVE_PX) {
    clearLongPressTimer();
    return;
  }
  if (Math.abs(event.clientY - longPressStartY) > LONG_PRESS_MOVE_PX) {
    clearLongPressTimer();
  }
}

function openItemContextMenuNearTarget(tabIndex, itemIndex, target, point) {
  const rect = target?.getBoundingClientRect?.();
  const x = rect ? rect.left + rect.width / 2 : point.x;
  const y = rect ? rect.top + rect.height / 2 : point.y;
  openItemContextMenu(tabIndex, itemIndex, x, y);
}

function shouldIgnoreRowLongPress(target) {
  return !!target.closest(".drag-handle, .btn, input, select, textarea, #itemContextMenu");
}

function blockRowLongPress(event) {
  clearLongPressTimer();
  event.stopPropagation();
}

function stripDoneStamp(text) {
  const value = typeof text === "string" ? text : "";
  const lines = value.split(/\r?\n/);
  if (lines.at(-1)?.startsWith("Completed: ")) {
    return lines.slice(0, -1).join("\n").trim();
  }
  return value.trim();
}

function closeItemContextMenu() {
  state.ui.itemContextMenu = null;
  els.itemContextMenu.classList.add("hidden");
  els.itemContextMenu.innerHTML = "";
}

function renderItemContextMenu() {
  const menuState = state.ui.itemContextMenu;
  if (!menuState) {
    closeItemContextMenu();
    return;
  }
  const tab = state.data.tabs[menuState.tabIndex];
  const item = tab?.items?.[menuState.itemIndex];
  if (!tab || !item) {
    closeItemContextMenu();
    return;
  }

  els.itemContextMenu.innerHTML = "";
  els.itemContextMenu.classList.remove("hidden");
  els.itemContextMenu.style.left = `${Math.min(menuState.x, window.innerWidth - 190)}px`;
  els.itemContextMenu.style.top = `${Math.min(menuState.y, window.innerHeight - 180)}px`;

  const addAction = (label, handler, danger = false, disabled = false, closeAfter = true) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `context-menu-item${danger ? " danger" : ""}`;
    button.textContent = label;
    button.disabled = disabled;
    button.onclick = () => {
      if (disabled) return;
      handler();
      if (closeAfter) closeItemContextMenu();
    };
    els.itemContextMenu.appendChild(button);
  };

  if (isDoneTab(tab)) {
    addAction("Move up", () => moveItemByOffset(menuState.tabIndex, menuState.itemIndex, -1), false, menuState.itemIndex === 0);
    addAction(
      "Move down",
      () => moveItemByOffset(menuState.tabIndex, menuState.itemIndex, 1),
      false,
      menuState.itemIndex === tab.items.length - 1
    );
    addAction("Undo done", () => undoDoneItem(menuState.itemIndex));
  } else {
    addAction("Move up", () => moveItemByOffset(menuState.tabIndex, menuState.itemIndex, -1), false, menuState.itemIndex === 0);
    addAction(
      "Move down",
      () => moveItemByOffset(menuState.tabIndex, menuState.itemIndex, 1),
      false,
      menuState.itemIndex === tab.items.length - 1
    );
    addAction("Mark done", () => markItemDone(menuState.tabIndex, menuState.itemIndex));
    addAction("Remind", () => editItemReminder(tab.id, item.id).catch(() => {
      flashPullSyncIndicator("Reminder options could not open. Reopen Checky while online to update the app.", true, 8000);
    }), false, window.checkyReminderState.isChecked(item));
  }
  addAction("Delete", () => armItemDeleteConfirm(menuState.tabIndex, menuState.itemIndex), true);
  positionItemContextMenu();
}

function positionItemContextMenu() {
  const menuState = state.ui.itemContextMenu;
  if (!menuState) return;
  const bounds = els.itemContextMenu.getBoundingClientRect();
  els.itemContextMenu.style.left = `${Math.max(8, Math.min(menuState.x, window.innerWidth - bounds.width - 8))}px`;
  els.itemContextMenu.style.top = `${Math.max(8, Math.min(menuState.y, window.innerHeight - bounds.height - 8))}px`;
}

function openItemContextMenu(tabIndex, itemIndex, x, y) {
  // Some touch browsers can still emit a context-menu event from a drag-handle hold.
  // Refuse to open the item menu while any drag-handle press or item drag is active.
  if (suppressContextMenuFromDragHandle || draggedItemPointerIndex !== null || state.ui.draggedItemIndex !== null) {
    return;
  }
  state.ui.itemContextMenu = { tabIndex, itemIndex, x, y };
  renderItemContextMenu();
}

function updateTabPointerDragTarget(clientX, clientY) {
  if (!tabPointerDragState) return;
  let overIndex = null;
  const target = document.elementFromPoint(clientX, clientY)?.closest(".tab");
  document.querySelectorAll(".tab").forEach((el) => el.classList.remove("drag-over"));
  if (target) {
    const candidate = Number.parseInt(target.dataset.tabIndex || "", 10);
    if (!Number.isNaN(candidate) && candidate !== state.ui.draggedTabIndex) {
      overIndex = candidate;
      target.classList.add("drag-over");
    }
  }
  tabPointerDragState.overIndex = overIndex;
}

function updateItemPointerDragTarget(clientX, clientY) {
  if (!itemPointerDragState) return;
  let overIndex = null;
  const target = document.elementFromPoint(clientX, clientY)?.closest(".item");
  document.querySelectorAll(".item").forEach((el) => el.classList.remove("drag-over"));
  if (target) {
    const candidate = Number.parseInt(target.dataset.itemIndex || "", 10);
    if (!Number.isNaN(candidate) && candidate !== state.ui.draggedItemIndex) {
      overIndex = candidate;
      target.classList.add("drag-over");
    }
  }
  itemPointerDragState.overIndex = overIndex;
}

function finishTabEditing(index, input) {
  const tab = state.data.tabs[index];
  if (!tab) return;
  tab.name = input.value.trim() || tab.name;
  state.ui.editingTabIndex = null;
  renderTabs();
  debounceSaveChecklist();
}

function moveItemByOffset(tabIndex, itemIndex, offset) {
  const tab = state.data.tabs[tabIndex];
  if (!tab || !Array.isArray(tab.items)) return;
  const targetIndex = itemIndex + offset;
  if (targetIndex < 0 || targetIndex >= tab.items.length) return;
  moveInArray(tab.items, itemIndex, targetIndex);
  render();
  debounceSaveChecklist();
}

function markItemDone(tabIndex, itemIndex) {
  const doneTabIndex = getDoneTabIndex();
  if (!state.settings.showDoneTab || doneTabIndex === -1) {
    const item = state.data.tabs[tabIndex]?.items[itemIndex];
    if (!item) return;
    item.done = true; item.reminderCheckedAt = null; item.reminderResetAt = null;
    render(); persistChecklistImmediately(); return;
  }
  const sourceTab = state.data.tabs[tabIndex];
  const doneTab = state.data.tabs[doneTabIndex];
  const [item] = sourceTab.items.splice(itemIndex, 1);
  if (!item) return;
  item.done = true;
  item.reminderCheckedAt = null;
  item.reminderResetAt = null;
  item.completedAt = new Date().toISOString();
  item.originalTabName = sourceTab.name;
  item.text = item.text.trim() ? `${item.text}\nCompleted: ${formatDoneTimestamp()}` : `Completed: ${formatDoneTimestamp()}`;
  doneTab.items.push(item);
  render();
  debounceSaveChecklist();
}

function undoDoneItem(itemIndex) {
  const doneTabIndex = getDoneTabIndex();
  if (doneTabIndex === -1) return;
  const doneTab = state.data.tabs[doneTabIndex];
  const [item] = doneTab.items.splice(itemIndex, 1);
  if (!item) return;
  const targetIndex = state.data.tabs.findIndex((tab) => !isDoneTab(tab) && tab.name === item.originalTabName);
  const safeTargetIndex = targetIndex === -1 ? getSafeChecklistTabIndex() : targetIndex;
  item.done = false;
  item.reminderCheckedAt = null;
  item.reminderResetAt = null;
  item.completedAt = null;
  item.originalTabName = null;
  item.text = stripDoneStamp(item.text);
  state.data.tabs[safeTargetIndex].items.push(item);
  state.data.active = safeTargetIndex;
  state.ui.doneViewOpen = false;
  render();
  debounceSaveChecklist();
}

function syncVisibleItemsToState() {
  const tab = state.data.tabs[state.data.active];
  if (!tab || !Array.isArray(tab.items)) return;
  const rows = els.list.querySelectorAll(".item");
  rows.forEach((row) => {
    const idx = Number.parseInt(row.dataset.itemIndex || "", 10);
    if (Number.isNaN(idx) || !tab.items[idx]) return;
    const textarea = row.querySelector("textarea");
    if (textarea) {
      tab.items[idx].text = textarea.value;
    }
  });
}

function deleteItemAt(tabIndex, itemIndex) {
  const tab = state.data.tabs[tabIndex];
  if (!tab?.items) return;
  tab.items.splice(itemIndex, 1);
  state.ui.itemDeleteConfirmIndex = null;
  closeItemContextMenu();
  render();
  debounceSaveChecklist();
}

function deleteTabAt(index) {
  if (getVisibleTabs().length === 1) {
    state.data = normalizeData(DEFAULT_DATA);
  } else {
    state.data.tabs.splice(index, 1);
    state.data.active = getSafeChecklistTabIndex(index - 1);
  }
  state.ui.tabDeleteConfirmIndex = null;
  render();
  debounceSaveChecklist();
}

function armItemDeleteConfirm(tabIndex, itemIndex) {
  state.ui.itemDeleteConfirmIndex = { tabIndex, itemIndex };
  closeItemContextMenu();
  render();
}

function isItemDeleteConfirmPending(tabIndex, itemIndex) {
  return state.ui.itemDeleteConfirmIndex?.tabIndex === tabIndex && state.ui.itemDeleteConfirmIndex?.itemIndex === itemIndex;
}

let installedAddons = [], activeAddon = null, addonLoadGeneration = 0;
async function loadInstalledAddons() {
  const generation = ++addonLoadGeneration;
  const account = state.hostedSession.user.id;
  if (!state.hostedSession.authenticated) { installedAddons = []; renderInstalledAddons(); return; }
  try {
    const response = await fetch('./addons.json', { cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(10000) });
    const manifest = response.ok ? await response.json() : [];
    const candidates = Array.isArray(manifest) ? manifest.slice(0, 16) : [];
    const endpoint = value => typeof value === 'string' && /^\/api\/checkys-base\/[a-z0-9/-]+$/.test(value);
    const available = await Promise.all(candidates.map(async addon => {
      if (!addon || !/^[a-z0-9-]{1,60}$/.test(addon.id) || typeof addon.name !== 'string' ||
          !/^\/[a-z0-9-]+(?:\/[a-z0-9-]+)*\/$/.test(addon.href) || !endpoint(addon.probe) || (addon.lists && !endpoint(addon.lists))) return null;
      try {
        const options = { cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(10000) };
        const check = await fetch(addon.probe, options);
        if (!check.ok || (await check.json()).installed !== true) return null;
        let data = { items: [], canManage: false };
        if (addon.lists) {
          const result = await fetch(addon.lists, options);
          if (!result.ok) return null;
          data = await result.json();
        }
        return { ...addon, canManage: data.canManage === true, items: Array.isArray(data.items) ? data.items.filter(item =>
          item && /^[a-z_]+:[a-z0-9]{15}$/.test(item.ref) && typeof item.name === 'string') : [] };
      } catch (_) { return null; }
    }));
    if (generation !== addonLoadGeneration || state.hostedSession.user.id !== account) return;
    installedAddons = available.filter(Boolean);
  } catch (_) { return; }
  renderInstalledAddons();
  if (!activeAddon) {
    const params = new URLSearchParams(location.search);
    const addon = installedAddons.find(item => item.id === params.get('addon'));
    const item = addon?.items.find(item => item.ref === params.get('list'));
    if (addon && (item || addon.canManage && params.get('manage') === '1')) void openInstalledAddon(addon, item, !item);
  }
}
function leaveInstalledAddon() {
  if (!activeAddon) return true;
  if (els.addonFrame.contentWindow?.checkyCanLeave && !els.addonFrame.contentWindow.checkyCanLeave()) return false;
  activeAddon = null;
  els.addonFrame.src = 'about:blank';
  const url = new URL(location.href);
  for (const key of ['addon', 'list', 'manage']) url.searchParams.delete(key);
  history.replaceState(null, '', url);
  return true;
}
async function openInstalledAddon(addon, item, manage = false) {
  if (state.ui.syncInProgress || !leaveInstalledAddon()) return;
  if (!await flushPendingSave()) { setStatus('Could not save your checklist. Try again before opening the list.', true); render(); return; }
  rememberCurrentChecklistTab();
  activeAddon = { id: addon.id, ref: item?.ref || '', manage };
  state.ui.settingsViewOpen = false; state.ui.doneViewOpen = false;
  const url = new URL(addon.href, location.origin);
  url.searchParams.set('embedded', '1');
  if (item) url.searchParams.set('list', item.ref);
  if (manage) url.searchParams.set('manage', '1');
  els.addonFrame.title = item?.name || addon.name;
  els.addonFrame.src = url.href;
  const address = new URL(location.href);
  address.searchParams.set('addon', addon.id);
  address.searchParams.delete('list'); address.searchParams.delete('manage');
  if (item) address.searchParams.set('list', item.ref);
  if (manage) address.searchParams.set('manage', '1');
  history.replaceState(null, '', address);
  closeDrawer(); render();
}
function renderInstalledAddons() {
  const opened = new Map([...els.installedAddonLinks.querySelectorAll('details')].map(group => [group.dataset.addonId, group.open]));
  els.installedAddonLinks.replaceChildren();
  for (const addon of installedAddons) {
    const group = document.createElement('details'); group.className = 'checklist-folder'; group.dataset.addonId = addon.id;
    group.open = opened.get(addon.id) ?? true;
    const heading = document.createElement('summary');
    heading.className = 'folder-tab-heading' + (activeAddon?.id === addon.id ? ' active' : '');
    const arrow = document.createElement('span'); arrow.className = 'folder-disclosure'; arrow.textContent = '\u25b8'; arrow.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span'); label.className = 'folder-tab-label'; label.textContent = addon.name.slice(0, 120);
    heading.append(arrow, label); group.append(heading);
    const contents = document.createElement('div'); contents.className = 'folder-tab-contents';
    const addButton = (name, item, manage) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'tab addon-link';
      button.textContent = name.slice(0, 120); button.disabled = state.ui.syncInProgress;
      const selected = activeAddon?.id === addon.id && activeAddon.ref === (item?.ref || '') && activeAddon.manage === manage;
      button.classList.toggle('active', selected); button.setAttribute('aria-current', String(selected));
      if (item) button.dataset.listRef = item.ref;
      button.onclick = () => void openInstalledAddon(addon, item, manage);
      contents.append(button);
    };
    for (const item of addon.items) addButton(item.name, item, false);
    if (addon.canManage) addButton('Manage ' + addon.name.toLowerCase() + ' lists', null, true);
    else if (!addon.items.length) {
      const hint = document.createElement('div'); hint.className = 'hint'; hint.textContent = 'No lists assigned. Ask your admin to add you.'; contents.append(hint);
    }
    group.append(contents); els.installedAddonLinks.append(group);
  }
}
window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== els.addonFrame.contentWindow || !activeAddon) return;
  if (event.data?.type === 'checky-addon-lists-changed') void loadInstalledAddons();
  if (event.data?.type === 'checky-addon-selected-list' && /^[a-z_]+:[a-z0-9]{15}$/.test(event.data.ref)) {
    activeAddon.ref = event.data.ref; activeAddon.manage = false;
    const address = new URL(location.href);
    address.searchParams.set('list', activeAddon.ref); address.searchParams.delete('manage');
    history.replaceState(null, '', address); renderInstalledAddons();
  }
});

function renderSettings() {
  const activeTab = state.data.tabs[state.data.active];
  const specialViewTitle = state.ui.settingsViewOpen ? "Settings" : "Done list";
  const advanced = normalizeSettings(state.settings).advanced;
  els.showDoneTab.checked = state.settings.showDoneTab;
  els.advancedSettingsToggle.setAttribute("aria-expanded", String(state.ui.advancedSettingsOpen));
  els.advancedSummary.textContent = getAdvancedSyncSummary();
  els.advancedSettingsPanel.classList.toggle("hidden", !state.ui.advancedSettingsOpen);
  els.serverUrlInput.value = advanced.serverUrl;
  els.syncEmailInput.value = advanced.email;
  els.syncPasswordInput.value = isHostedWebRuntime() ? "" : advanced.password;
  const passwordRow = els.syncPasswordInput?.closest(".setting-row");
  if (passwordRow) {
    passwordRow.classList.toggle("hidden", isHostedWebRuntime());
  }
  renderChecklistPicker();
  els.doneSearchInput.value = state.ui.doneSearch;
  ensureNavigationPreferences();
  renderInstalledAddons();
  els.dataLocation.textContent = state.dataLocation || "Device local cache only";
  els.syncNowBtn.disabled = state.ui.syncInProgress;
  els.syncNowBtn.textContent = state.ui.syncInProgress ? "Syncing..." : "Pull latest";
  els.syncRestorePointSummary.textContent = getSyncRestorePointSummary();
  els.restoreSyncRestorePointBtn.disabled = state.ui.syncInProgress || !normalizeSyncRestorePointInfo(state.syncRestorePoint).available;
  els.currentViewTitle.textContent = state.ui.doneViewOpen ? "Done list" : (activeTab?.name || "Checklist");
  els.doneToggle.disabled = !state.settings.showDoneTab;
  els.doneToggle.classList.toggle("btn-primary", state.ui.doneViewOpen && state.settings.showDoneTab);
  els.doneToggle.classList.toggle("btn-ghost", !state.ui.doneViewOpen || !state.settings.showDoneTab);
  els.settingsToggle.classList.toggle("btn-primary", state.ui.settingsViewOpen);
  els.settingsToggle.classList.toggle("btn-ghost", !state.ui.settingsViewOpen);
  els.specialViewHeader.classList.toggle("hidden", !state.ui.settingsViewOpen && !state.ui.doneViewOpen);
  els.addonView.classList.toggle("hidden", !activeAddon);
  document.body.classList.toggle("addon-open", !!activeAddon);
  els.list.classList.toggle("hidden", !!activeAddon);
  els.addItemBtn.parentElement.classList.toggle("hidden", !!activeAddon);
  els.specialViewTitle.textContent = specialViewTitle;
  els.settingsPanel.classList.toggle("hidden", !state.ui.settingsViewOpen);
  els.currentViewTitle.parentElement.classList.toggle("hidden", isSpecialViewOpen());
  els.mainDivider.classList.toggle("hidden", state.ui.settingsViewOpen || !!activeAddon);
  els.addItemBtn.classList.toggle("hidden", isSpecialViewOpen());
}

function renderLoginOverlay() {
  const isOpen = !!state.ui.loginOverlayOpen;
  els.loginOverlay.classList.toggle("hidden", !isOpen);
  els.loginOverlay.setAttribute("aria-hidden", String(!isOpen));
  document.body.classList.toggle("login-open", isOpen);
  syncLoginOverlayInputs();
}

function renderTabs() {
  renderAlwaysVisibleShortcuts();
  els.tabs.innerHTML = "";
  getVisibleTabs().forEach(({ tab, index }) => {
    const container = document.createElement("div");
    container.className = `tab${!activeAddon && index === state.data.active ? " active" : ""}`;
    container.dataset.tabIndex = String(index);

    if (state.ui.editingTabIndex === index) {
      const input = document.createElement("input");
      input.className = "tab-name-input";
      input.value = tab.name;
      input.onpointerdown = (event) => event.stopPropagation();
      input.onclick = (event) => event.stopPropagation();
      input.onkeydown = (event) => {
        if (event.key === "Enter") {
          finishTabEditing(index, input);
        }
      };
      input.onblur = (event) => {
        if (event.relatedTarget && container.contains(event.relatedTarget)) return;
        finishTabEditing(index, input);
      };
      container.appendChild(input);

      const done = document.createElement("button");
      done.className = "btn btn-primary";
      done.textContent = "Done";
      done.onpointerdown = (event) => event.preventDefault();
      done.onclick = (event) => {
        event.stopPropagation();
        finishTabEditing(index, input);
      };
      container.appendChild(done);
      addAlwaysShowOption(container, tab, input);
    } else {
      const label = document.createElement("span");
      label.className = "tab-label";
      label.textContent = tab.name;
      container.appendChild(label);

      const edit = document.createElement("button");
      edit.className = "btn btn-ghost";
      edit.textContent = "Edit";
      edit.onclick = (event) => {
        event.stopPropagation();
        state.ui.editingTabIndex = index;
        renderTabs();
      };
      container.appendChild(edit);

      if (state.ui.tabDeleteConfirmIndex === index) {
        const yes = document.createElement("button");
        yes.className = "btn btn-danger";
        yes.textContent = "Yes";
        yes.onclick = (event) => {
          event.stopPropagation();
          deleteTabAt(index);
        };
        container.appendChild(yes);

        const no = document.createElement("button");
        no.className = "btn btn-ghost";
        no.textContent = "No";
        no.onclick = (event) => {
          event.stopPropagation();
          state.ui.tabDeleteConfirmIndex = null;
          renderTabs();
        };
        container.appendChild(no);
      }

      const dragHandle = createDragHandle("Hold to move tab");
      container.appendChild(dragHandle);

      container.draggable = true;
      container.ondragstart = (event) => {
        if (!canStartTabDrag(event)) {
          event.preventDefault();
          return;
        }
        state.ui.draggedTabIndex = index;
        container.classList.add("dragging");
        event.dataTransfer.setData("text/plain", String(index));
        event.dataTransfer.effectAllowed = "move";
      };
      container.ondragover = (event) => {
        if (state.ui.draggedTabIndex === null || state.ui.draggedTabIndex === index) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      };
      container.ondragenter = (event) => {
        if (state.ui.draggedTabIndex === null || state.ui.draggedTabIndex === index) return;
        event.preventDefault();
        container.classList.add("drag-over");
      };
      container.ondragleave = () => container.classList.remove("drag-over");
      container.ondrop = (event) => {
        if (state.ui.draggedTabIndex === null) return;
        event.preventDefault();
        event.stopPropagation();
        container.classList.remove("drag-over");

        const from = state.ui.draggedTabIndex;
        const to = index;
        const activeBefore = state.data.active;
        moveInArray(state.data.tabs, from, to);

        if (activeBefore === from) state.data.active = to;
        else if (from < activeBefore && to >= activeBefore) state.data.active = activeBefore - 1;
        else if (from > activeBefore && to <= activeBefore) state.data.active = activeBefore + 1;

        render();
        persistChecklistImmediately();
      };
      container.ondragend = () => {
        clearTabDragState();
      };

      dragHandle.onpointerdown = (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        beginDragHandlePress();
        blockRowLongPress(event);
        longPressTimer = setTimeout(() => {
          suppressNextDocumentClick = true;
          state.ui.draggedTabIndex = index;
          draggedTabPointerIndex = index;
          tabPointerDragState = { pointerId: event.pointerId, overIndex: null };
          container.classList.add("dragging");
        }, LONG_PRESS_MS);
      };
      dragHandle.oncontextmenu = (event) => {
        event.preventDefault();
        event.stopPropagation();
      };
      dragHandle.onpointerup = () => { clearLongPressTimer(); if (!tabPointerDragState) endDragHandlePress(); };
      dragHandle.onpointercancel = () => { clearLongPressTimer(); if (!tabPointerDragState) endDragHandlePress(); };
      dragHandle.onpointerleave = () => { clearLongPressTimer(); if (!tabPointerDragState) endDragHandlePress(); };

      container.onpointerdown = (event) => {
        if (event.button !== 0) return;
        if (shouldIgnoreRowLongPress(event.target)) return;
        startLongPress(event, () => {
          state.ui.tabDeleteConfirmIndex = index;
          renderTabs();
        });
      };
      container.onpointermove = (event) => cancelLongPressOnMove(event);
      container.onpointerup = () => clearLongPressTimer();
      container.onpointercancel = () => clearLongPressTimer();
      container.onpointerleave = () => clearLongPressTimer();
    }

    container.onclick = (event) => {
      if (suppressNextDocumentClick) {
        suppressNextDocumentClick = false;
        return;
      }
      if (state.ui.editingTabIndex === index) {
        return;
      }
      if (event.target.closest("input, button")) {
        return;
      }
      state.ui.doneViewOpen = false;
      state.ui.settingsViewOpen = false;
      state.data.active = index;
      state.ui.lastChecklistTabIndex = index;
      closeDrawer();
      persistChecklistImmediately();
      render();
    };
    (isTabAlwaysVisible(tab.id) ? els.alwaysVisibleTabs : els.tabs).appendChild(container);
  });

  els.tabs.ondragover = (event) => {
    if (state.ui.draggedTabIndex === null) return;
    event.preventDefault();
  };
  els.tabs.ondrop = (event) => {
    if (state.ui.draggedTabIndex === null) return;
    if (event.target.closest(".tab")) return;
    event.preventDefault();
    const from = state.ui.draggedTabIndex;
    const doneTabIndex = getDoneTabIndex();
    const to = (doneTabIndex === -1 ? state.data.tabs.length : doneTabIndex) - 1;
    if (from === to || to < 0) return;
    const activeBefore = state.data.active;
    moveInArray(state.data.tabs, from, to);
    if (activeBefore === from) state.data.active = to;
    else if (from < activeBefore) state.data.active = activeBefore - 1;
    render();
    debounceSaveChecklist();
  };
}

function renderArchive(doneTab) {
  els.list.innerHTML = "";
  const query = state.ui.doneSearch.trim().toLowerCase();
  const items = doneTab.items
    .map((item, index) => ({ item, index, date: getCompletedDate(item) }))
    .filter(({ item }) => !query || (item.text || "").toLowerCase().includes(query))
    .sort((a, b) => {
      const aTime = a.date ? a.date.getTime() : 0;
      const bTime = b.date ? b.date.getTime() : 0;
      return bTime - aTime;
    });

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "archive-empty";
    empty.textContent = query ? "No completed items match that search." : "No completed items yet.";
    els.list.appendChild(empty);
    return;
  }

  let lastMonthKey = "";
  let lastDayKey = "";

  items.forEach(({ item, index, date }) => {
    if (!date) {
      if (lastMonthKey !== "unknown") {
        els.list.appendChild(createArchiveHeading(getUnknownArchiveLabel(), "archive-month"));
        lastMonthKey = "unknown";
        lastDayKey = "";
      }
    } else {
      const monthKey = `${date.getFullYear()}-${date.getMonth()}`;
      const dayKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

      if (monthKey !== lastMonthKey) {
        els.list.appendChild(createArchiveHeading(formatArchiveMonth(date), "archive-month"));
        lastMonthKey = monthKey;
        lastDayKey = "";
      }

      if (dayKey !== lastDayKey) {
        els.list.appendChild(createArchiveHeading(formatArchiveDay(date), "archive-day"));
        lastDayKey = dayKey;
      }
    }

    const row = document.createElement("div");
    row.className = "item";
    row.dataset.itemIndex = String(index);
    row.oncontextmenu = (event) => {
      event.preventDefault();
      if (suppressContextMenuFromDragHandle) return;
      const dragHandleTarget = event.target.closest(".drag-handle") || document.elementFromPoint(event.clientX, event.clientY)?.closest(".drag-handle");
      if (dragHandleTarget) return;
      openItemContextMenu(getDoneTabIndex(), index, event.clientX, event.clientY);
    };

    const meta = document.createElement("div");
    meta.className = "done-meta";
    meta.textContent = date ? formatArchiveTime(date) : "Unknown time";
    row.appendChild(meta);

    const text = document.createElement("textarea");
    text.value = item.text;
    text.oninput = () => {
      item.text = text.value;
      persistChecklistImmediately();
    };
    text.onpointerdown = (event) => {
      if (event.button !== 0) return;
      startLongPress(event, (point) => {
        openItemContextMenuNearTarget(getDoneTabIndex(), index, text, point);
      });
    };
    text.onpointermove = (event) => cancelLongPressOnMove(event);
    text.onpointerup = () => clearLongPressTimer();
    text.onpointercancel = () => clearLongPressTimer();
    text.onpointerleave = () => clearLongPressTimer();
    row.appendChild(text);

    if (isItemDeleteConfirmPending(getDoneTabIndex(), index)) {
      const yes = document.createElement("button");
      yes.className = "btn btn-danger";
      yes.textContent = "Yes";
      yes.onpointerdown = blockRowLongPress;
      yes.onclick = () => deleteItemAt(getDoneTabIndex(), index);
      row.appendChild(yes);

      const no = document.createElement("button");
      no.className = "btn btn-ghost";
      no.textContent = "No";
      no.onpointerdown = blockRowLongPress;
      no.onclick = () => {
        state.ui.itemDeleteConfirmIndex = null;
        renderArchive(doneTab);
      };
      row.appendChild(no);
    }

    els.list.appendChild(row);
  });
}

function renderItems() {
  els.list.innerHTML = "";
  els.doneArchiveTools.classList.toggle("hidden", !state.ui.doneViewOpen || !state.settings.showDoneTab);

  if (state.ui.settingsViewOpen || activeAddon) {
    return;
  }

  const doneTabIndex = getDoneTabIndex();
  if (state.ui.doneViewOpen && doneTabIndex !== -1) {
    renderArchive(state.data.tabs[doneTabIndex]);
    return;
  }

  const tab = state.data.tabs[state.data.active];
  tab.items.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "item";
    row.dataset.itemIndex = String(index);
    row.oncontextmenu = (event) => {
      event.preventDefault();
      if (suppressContextMenuFromDragHandle) return;
      const dragHandleTarget = event.target.closest(".drag-handle") || document.elementFromPoint(event.clientX, event.clientY)?.closest(".drag-handle");
      if (dragHandleTarget) return;
      openItemContextMenu(state.data.active, index, event.clientX, event.clientY);
    };

    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = window.checkyReminderState.isChecked(item);
    check.onchange = () => {
      if (suppressCheckboxClick) {
        suppressCheckboxClick = false;
        check.checked = window.checkyReminderState.isChecked(item);
        return;
      }
      window.checkyReminderState.setChecked(item, check.checked);
      persistChecklistImmediately();
    };
    check.onpointerdown = (event) => {
      if (event.button !== 0) return;
      blockRowLongPress(event);
      startLongPress(event, (point) => {
        suppressCheckboxClick = true;
        openItemContextMenuNearTarget(state.data.active, index, check, point);
      });
    };
    check.onpointermove = (event) => cancelLongPressOnMove(event);
    check.onpointerup = () => clearLongPressTimer();
    check.onpointercancel = () => clearLongPressTimer();
    check.onpointerleave = () => clearLongPressTimer();
    row.appendChild(check);

    const textarea = document.createElement("textarea");
    textarea.value = item.text;
    textarea.placeholder = "Checklist description...";
    textarea.oninput = () => {
      item.text = textarea.value;
      persistChecklistImmediately();
    };
    textarea.onpointerdown = (event) => {
      if (event.button !== 0) return;
      startLongPress(event, (point) => {
        openItemContextMenuNearTarget(state.data.active, index, textarea, point);
      });
    };
    textarea.onpointermove = (event) => cancelLongPressOnMove(event);
    textarea.onpointerup = () => clearLongPressTimer();
    textarea.onpointercancel = () => clearLongPressTimer();
    textarea.onpointerleave = () => clearLongPressTimer();
    row.appendChild(textarea);

    if (isItemDeleteConfirmPending(state.data.active, index)) {
      const yes = document.createElement("button");
      yes.className = "btn btn-danger";
      yes.textContent = "Yes";
      yes.onpointerdown = blockRowLongPress;
      yes.onclick = () => deleteItemAt(state.data.active, index);
      row.appendChild(yes);

      const no = document.createElement("button");
      no.className = "btn btn-ghost";
      no.textContent = "No";
      no.onpointerdown = blockRowLongPress;
      no.onclick = () => {
        state.ui.itemDeleteConfirmIndex = null;
        renderItems();
      };
      row.appendChild(no);
    }

    const dragHandle = createDragHandle("Hold to move item");
    row.appendChild(dragHandle);

    row.draggable = true;
    row.ondragstart = (event) => {
      if (!canStartItemDrag(event)) {
        event.preventDefault();
        return;
      }
      syncVisibleItemsToState();
      state.ui.draggedItemIndex = index;
      row.classList.add("dragging");
      event.dataTransfer.setData("text/plain", String(index));
      event.dataTransfer.effectAllowed = "move";
    };
    row.ondragover = (event) => {
      if (state.ui.draggedItemIndex === null || state.ui.draggedItemIndex === index) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    };
    row.ondragenter = (event) => {
      if (state.ui.draggedItemIndex === null || state.ui.draggedItemIndex === index) return;
      event.preventDefault();
      row.classList.add("drag-over");
    };
    row.ondragleave = () => row.classList.remove("drag-over");
    row.ondrop = (event) => {
      if (state.ui.draggedItemIndex === null) return;
      event.preventDefault();
      event.stopPropagation();
      row.classList.remove("drag-over");
      syncVisibleItemsToState();
      moveInArray(tab.items, state.ui.draggedItemIndex, index);
      clearItemDragState();
      renderItems();
      persistChecklistImmediately();
    };
    row.ondragend = () => clearItemDragState();

    dragHandle.onpointerdown = (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      beginDragHandlePress();
      blockRowLongPress(event);
      longPressTimer = setTimeout(() => {
        suppressNextDocumentClick = true;
        syncVisibleItemsToState();
        draggedItemPointerIndex = index;
        state.ui.draggedItemIndex = index;
        itemPointerDragState = { pointerId: event.pointerId, overIndex: null };
        row.classList.add("dragging");
      }, LONG_PRESS_MS);
    };
    dragHandle.oncontextmenu = (event) => {
      if (suppressContextMenuFromDragHandle) event.preventDefault();
      event.preventDefault();
      event.stopPropagation();
    };
    dragHandle.onpointerup = () => { clearLongPressTimer(); if (!itemPointerDragState) endDragHandlePress(); };
    dragHandle.onpointercancel = () => { clearLongPressTimer(); if (!itemPointerDragState) endDragHandlePress(); };
    dragHandle.onpointerleave = () => { clearLongPressTimer(); if (!itemPointerDragState) endDragHandlePress(); };

    row.onpointerenter = () => {
      if (draggedItemPointerIndex === null || draggedItemPointerIndex === index) return;
      row.classList.add("drag-over");
    };
    row.onpointerleave = () => {
      row.classList.remove("drag-over");
      if (draggedItemPointerIndex === null) endDragHandlePress();
    };
    row.onpointerup = () => {
      clearLongPressTimer();
    };
    row.onpointercancel = () => {
      clearLongPressTimer();
      if (draggedItemPointerIndex === null) endDragHandlePress();
    };

    els.list.appendChild(row);
  });

  els.list.ondragover = (event) => {
    if (state.ui.draggedItemIndex === null) return;
    event.preventDefault();
  };
  els.list.ondrop = (event) => {
    if (state.ui.draggedItemIndex === null) return;
    if (event.target.closest(".item")) return;
    event.preventDefault();
    const from = state.ui.draggedItemIndex;
    const to = tab.items.length - 1;
    if (from === to) {
      clearItemDragState();
      return;
    }
    syncVisibleItemsToState();
    moveInArray(tab.items, from, to);
    clearItemDragState();
    renderItems();
    debounceSaveChecklist();
  };
}

async function editItemReminder(tabId, itemId) {
  const checklistId = state.currentChecklistId;
  const item = state.data.tabs.find(tab => tab.id === tabId)?.items.find(item => item.id === itemId);
  if (!item || window.checkyReminderState.isChecked(item)) return;
  const value = await window.checkyReminders.edit(item);
  if (value === undefined) return;
  const current = state.data.tabs.find(tab => tab.id === tabId)?.items.find(item => item.id === itemId);
  if (checklistId !== state.currentChecklistId || !current || window.checkyReminderState.isChecked(current)) return;
  current.done = false;
  current.reminderCheckedAt = null;
  current.reminderResetAt = null;
  current.reminderAt = value?.at || null;
  current.reminderRepeat = value?.repeat || 'none';
  current.reminderTimeZone = value?.timeZone || null;
  current.reminderDays = value?.days || null;
  clearPendingSave();
  const saved = await persistChecklistSnapshot(createChecklistSnapshot(), ++lastChecklistSaveRequestId);
  renderItems();
  if (saved) await runManualSync('reminder');
}

async function prepareForAppUpdate() {
  if (activeAddon && els.addonFrame.contentWindow?.checkyAddonBusy?.()) {
    throw new Error('Finish the open list edit before updating Checky.');
  }
  if (state.ui.syncInProgress || state.ui.loginBusy || state.ui.availableChecklistsLoading) {
    throw new Error('Wait for the current sync or sign-in to finish, then choose Update now.');
  }
  if (document.querySelector('dialog[open]') || state.ui.editingTabIndex !== null) {
    throw new Error('Finish the open reminder or tab edit, then choose Update now.');
  }
  if (!hasHostedLoginCredentials()) return;
  syncVisibleItemsToState();
  clearPendingSave();
  if (!await persistChecklistSnapshot(createChecklistSnapshot(), ++lastChecklistSaveRequestId, { updateStatus: false }) ||
      !await persistVisibleAdvancedSettings()) {
    throw new Error('Could not save your changes. Try Update now again.');
  }
}

function render() {
  state.data = normalizeData(state.data);
  state.settings = normalizeSettings(state.settings);
  ensureDoneTabState();
  document.body.classList.toggle("done-view", !!state.ui.doneViewOpen && state.settings.showDoneTab);
  setDrawerOpen(state.ui.drawerOpen);
  renderSettings();
  renderTabs();
  renderItems();
  renderItemContextMenu();
  renderLoginOverlay();
}

async function submitHostedLogin() {
  if (!isHostedWebRuntime() || state.ui.loginBusy) return;

  const serverUrl = (els.loginServerUrlInput.value || getHostedServerUrl()).trim();
  const email = els.loginEmailInput.value.trim();
  const password = els.loginPasswordInput.value;

  if (!email || !password) {
    setLoginStatus("Enter your email and password to sign in.", true);
    renderLoginOverlay();
    return;
  }

  state.settings = normalizeSettings({
    ...state.settings,
    advanced: {
      ...normalizeSettings(state.settings).advanced,
      serverUrl,
      email,
      password
    }
  });
  state.ui.loginBusy = true;
  setLoginStatus("Signing in...");
  render();

  try {
    const didPersistVisibleSettings = await persistVisibleAdvancedSettings();
    if (!didPersistVisibleSettings) {
      setLoginStatus("Could not save your login details.", true);
      return;
    }

    const loginResult = await window.checkyStorage.signInHostedSession(email, password);
    state.hostedSession = normalizeHostedSession(loginResult?.hostedSession);
    void loadInstalledAddons();
    await loadAvailableChecklists();
    if (state.availableChecklists.length === 0) {
      setLoginStatus(state.ui.availableChecklistsMessage || "No accessible checklists are available for this account.", true);
      return;
    }

    await runManualSync("login");
    state.ui.loginOverlayOpen = false;
    state.ui.loginStatus = "";
    render();
  } catch (error) {
    setLoginStatus(error?.message || "Could not sign in right now.", true);
  } finally {
    state.ui.loginBusy = false;
    renderLoginOverlay();
  }
}

function bindEvents() {
  const commitAdvancedInput = async (field, value) => {
    updateAdvancedSettings(field, value);
    renderSettings();
    await persistSettings();
  };

  els.navToggle.onclick = () => {
    openDrawer();
  };

  els.navCloseBtn.onclick = () => {
    closeDrawer();
  };

  els.navBackdrop.onclick = () => {
    closeDrawer();
  };

  for (const tabs of [els.checklistTabPanel, els.alwaysVisibleTabs]) tabs.addEventListener('click', event => {
    if (!activeAddon) return;
    if (!leaveInstalledAddon()) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    renderSettings(); renderItems();
  }, true);
  els.settingsToggle.onclick = () => {
    openSettingsView();
  };

  els.doneToggle.onclick = () => {
    openDoneView();
  };

  els.specialViewCloseBtn.onclick = () => {
    closeSpecialView();
  };

  els.addTabBtn.onclick = () => {
    if (!leaveInstalledAddon()) return;
    state.ui.settingsViewOpen = false; state.ui.doneViewOpen = false;
    const insertIndex = getDoneTabIndex() === -1 ? state.data.tabs.length : getDoneTabIndex();
    state.data.tabs.splice(insertIndex, 0, { name: `Tab ${getVisibleTabs().length + 1}`, items: [] });
    state.data.tabs[insertIndex].id = createEntityId("tab");
    state.data.active = insertIndex;
    state.ui.tabDeleteConfirmIndex = null;
    state.ui.itemDeleteConfirmIndex = null;
    state.ui.editingTabIndex = null;
    render();
    debounceSaveChecklist();
  };

  els.addItemBtn.onclick = () => {
    syncVisibleItemsToState();
    state.data.tabs[state.data.active].items.push({ id: createEntityId("item"), text: "", done: false });
    state.ui.itemDeleteConfirmIndex = null;
    renderItems();
    debounceSaveChecklist();
  };

  els.showDoneTab.onchange = async () => {
    state.settings.showDoneTab = els.showDoneTab.checked;
    ensureDoneTabState();
    render();
    await persistSettings();
  };

  els.advancedSettingsToggle.onclick = () => {
    state.ui.advancedSettingsOpen = !state.ui.advancedSettingsOpen;
    renderSettings();
  };

  els.serverUrlInput.oninput = () => {
    updateAdvancedSettings("serverUrl", els.serverUrlInput.value.trim());
  };
  els.serverUrlInput.onkeydown = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      els.serverUrlInput.blur();
    }
  };
  els.serverUrlInput.onblur = async () => {
    await commitAdvancedInput("serverUrl", els.serverUrlInput.value.trim());
  };

  els.syncEmailInput.oninput = () => {
    updateAdvancedSettings("email", els.syncEmailInput.value.trim());
  };
  els.syncEmailInput.onkeydown = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      els.syncEmailInput.blur();
    }
  };
  els.syncEmailInput.onblur = async () => {
    await commitAdvancedInput("email", els.syncEmailInput.value.trim());
  };

  els.syncPasswordInput.oninput = () => {
    updateAdvancedSettings("password", els.syncPasswordInput.value);
  };
  els.syncPasswordInput.onkeydown = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      els.syncPasswordInput.blur();
    }
  };
  els.syncPasswordInput.onblur = async () => {
    await commitAdvancedInput("password", els.syncPasswordInput.value);
  };

  els.loginEmailInput.oninput = () => {
    updateAdvancedSettings("email", els.loginEmailInput.value.trim());
  };
  els.loginEmailInput.onkeydown = async (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      await submitHostedLogin();
    }
  };

  els.loginPasswordInput.oninput = () => {
    updateAdvancedSettings("password", els.loginPasswordInput.value);
  };
  els.loginPasswordInput.onkeydown = async (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      await submitHostedLogin();
    }
  };

  els.loginSubmitBtn.onclick = async () => {
    await submitHostedLogin();
  };

  els.loginSettingsBtn.onclick = () => {
    state.ui.loginOverlayOpen = false;
    state.ui.loginStatus = "";
    openSettingsView();
    state.ui.advancedSettingsOpen = true;
    render();
    els.syncEmailInput.focus();
  };

  els.refreshChecklistsBtn.onclick = async () => {
    await Promise.all([loadAvailableChecklists(), loadInstalledAddons()]);
  };

  els.doneSearchInput.oninput = () => {
    state.ui.doneSearch = els.doneSearchInput.value;
    renderItems();
  };

  els.syncNowBtn.onclick = async () => {
    await runManualSync("settings");
  };

  els.restoreSyncRestorePointBtn.onclick = async () => {
    const result = await window.checkyStorage.restoreSyncRestorePoint();
    if (!result?.ok) {
      setStatus(result?.message || "Could not restore the local backup.", true);
      return;
    }
    state.data = normalizeData(result.checklist);
    if (result?.syncRestorePoint) {
      state.syncRestorePoint = normalizeSyncRestorePointInfo(result.syncRestorePoint);
    }
    render();
    setStatus(result.message || "Restored the local pre-sync backup.");
  };

  els.exportChecklistBtn.onclick = async () => {
    try {
      const result = await window.checkyStorage.exportChecklist(state.data);
      if (result?.cancelled) {
        setStatus("Export canceled.");
        return;
      }
      if (result?.ok === false) {
        setStatus("Export failed.", true);
        return;
      }
      setStatus("Checklist exported.");
    } catch {
      setStatus("Export failed.", true);
    }
  };

  els.importChecklistInput.onchange = async () => {
    const file = els.importChecklistInput.files?.[0];
    if (!file) return;
    try {
      state.data = normalizeData(await window.checkyStorage.importChecklistFromFile(file));
      render();
      setStatus("Checklist imported.");
    } catch {
      setStatus("Import failed. Use a valid JSON export.", true);
    } finally {
      els.importChecklistInput.value = "";
    }
  };

  els.resetChecklistBtn.onclick = async () => {
    if (!state.ui.resetConfirmArmed) {
      state.ui.resetConfirmArmed = true;
      els.resetChecklistBtn.textContent = "Confirm reset";
      setStatus("Click again to reset checklist.");
      return;
    }
    state.data = normalizeData(await window.checkyStorage.resetChecklist());
    state.ui.resetConfirmArmed = false;
    els.resetChecklistBtn.textContent = "Reset checklist";
    render();
    setStatus("Checklist reset.");
  };

  document.addEventListener("click", (event) => {
    if (suppressNextDocumentClick) {
      suppressNextDocumentClick = false;
      return;
    }
    if (!state.ui.itemContextMenu) return;
    if (event.target.closest("#itemContextMenu")) return;
    closeItemContextMenu();
  });

  document.addEventListener("contextmenu", (event) => {
    if (suppressContextMenuFromDragHandle || event.target.closest(".drag-handle")) {
      event.preventDefault();
      return;
    }
    if (event.target.closest(".item")) return;
    closeItemContextMenu();
  });

  window.addEventListener("resize", () => {
    if (!state.ui.itemContextMenu) return;
    // Keyboard/browser-chrome resizing must not replace a button under a finger.
    positionItemContextMenu();
  });

  els.contentScroll.addEventListener("touchstart", (event) => {
    if (event.touches.length !== 1) {
      cancelPullSyncGesture();
      return;
    }
    if (!canStartPullSync(event.target)) return;
    clearTimeout(pullSyncFeedbackTimer);
    pullSyncFeedbackTimer = null;
    const touch = event.touches[0];
    pullSyncTouchId = touch.identifier;
    pullSyncStartY = touch.clientY;
    state.ui.pullSyncDistance = 0;
    state.ui.pullSyncArmed = false;
  }, { passive: true });

  els.contentScroll.addEventListener("touchmove", (event) => {
    const touch = findTouchById(event.touches, pullSyncTouchId);
    if (!touch) return;
    if (event.touches.length !== 1 || els.contentScroll.scrollTop > 0) {
      cancelPullSyncGesture();
      return;
    }

    const deltaY = touch.clientY - pullSyncStartY;
    if (deltaY <= 0) {
      state.ui.pullSyncDistance = 0;
      state.ui.pullSyncArmed = false;
      setPullSyncIndicator("Pull down to sync", { height: 0, visible: false });
      return;
    }

    const distance = Math.min(PULL_SYNC_MAX_PX, deltaY * PULL_SYNC_DAMPING);
    if (distance < 8) return;

    event.preventDefault();
    state.ui.pullSyncDistance = distance;
    state.ui.pullSyncArmed = deltaY >= PULL_SYNC_TRIGGER_PX;
    setPullSyncIndicator(state.ui.pullSyncArmed ? "Release to sync" : "Pull down to sync", {
      height: distance,
      visible: true,
      ready: state.ui.pullSyncArmed
    });
  }, { passive: false });

  els.contentScroll.addEventListener("touchend", async (event) => {
    const touch = findTouchById(event.changedTouches, pullSyncTouchId);
    if (!touch) return;
    const shouldSync = state.ui.pullSyncArmed;
    pullSyncTouchId = null;
    pullSyncStartY = 0;
    state.ui.pullSyncDistance = 0;
    state.ui.pullSyncArmed = false;
    if (!shouldSync) {
      resetPullSyncIndicator();
      return;
    }
    await runManualSync("pull");
  });

  els.contentScroll.addEventListener("touchcancel", () => {
    cancelPullSyncGesture();
  });

  document.addEventListener("pointermove", (event) => {
    if (tabPointerDragState?.pointerId === event.pointerId) {
      event.preventDefault();
      updateTabPointerDragTarget(event.clientX, event.clientY);
    }
    if (itemPointerDragState?.pointerId === event.pointerId) {
      event.preventDefault();
      updateItemPointerDragTarget(event.clientX, event.clientY);
    }
  }, { passive: false });

  document.addEventListener("pointerup", (event) => {
    if (tabPointerDragState?.pointerId === event.pointerId && state.ui.draggedTabIndex !== null) {
      const from = state.ui.draggedTabIndex;
      const to = tabPointerDragState.overIndex;
      const activeBefore = state.data.active;
      if (Number.isInteger(to) && to >= 0 && to < state.data.tabs.length && from !== to) {
        moveInArray(state.data.tabs, from, to);
        if (activeBefore === from) state.data.active = to;
        else if (from < activeBefore && to >= activeBefore) state.data.active = activeBefore - 1;
        else if (from > activeBefore && to <= activeBefore) state.data.active = activeBefore + 1;
        clearTabDragState();
        render();
        debounceSaveChecklist();
      } else {
        clearTabDragState();
        renderTabs();
      }
    }

    if (itemPointerDragState?.pointerId === event.pointerId && draggedItemPointerIndex !== null) {
      const tab = state.data.tabs[state.data.active];
      const from = draggedItemPointerIndex;
      const to = itemPointerDragState.overIndex;
      if (tab && Number.isInteger(to) && to >= 0 && to < tab.items.length && from !== to) {
        syncVisibleItemsToState();
        moveInArray(tab.items, from, to);
        clearItemDragState();
        renderItems();
        debounceSaveChecklist();
      } else {
        clearItemDragState();
        renderItems();
      }
    }
  });

  document.addEventListener("pointercancel", (event) => {
    if (tabPointerDragState?.pointerId === event.pointerId) {
      clearTabDragState();
      renderTabs();
    }
    if (itemPointerDragState?.pointerId === event.pointerId) {
      clearItemDragState();
      renderItems();
    }
  });
}

async function init() {
  bindEvents();
  const loaded = await window.checkyStorage.loadState();
  state.data = normalizeData(loaded.checklist);
  state.settings = normalizeSettings(loaded.settings);
  state.hostedSession = normalizeHostedSession(loaded.hostedSession);
  if (isHostedWebRuntime() && !normalizeSettings(state.settings).advanced.serverUrl) {
    state.settings = normalizeSettings({
      ...state.settings,
      advanced: {
        ...normalizeSettings(state.settings).advanced,
        serverUrl: getHostedServerUrl()
      }
    });
  }
  state.dataLocation = loaded.dataLocation;
  state.syncRestorePoint = normalizeSyncRestorePointInfo(loaded.syncRestorePoint);
  state.ui.loginOverlayOpen = isHostedWebRuntime()
    ? !hasHostedLoginCredentials()
    : false;
  render();
  window.checkyPrepareForUpdate = prepareForAppUpdate;
  void window.checkyReminders?.init(state.hostedSession.user.id);
  void loadInstalledAddons();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void loadInstalledAddons();
  });
  if (navigator.onLine && hasHostedLoginCredentials()) {
    setTimeout(async () => {
      await runManualSync("startup");
      const params = new URLSearchParams(location.search);
      const checklistId = params.get('reminder');
      if (checklistId && state.availableChecklists.some(item => item.id === checklistId)) {
        if (state.currentChecklistId !== checklistId) await useSelectedChecklist(checklistId);
        if (state.currentChecklistId === checklistId) {
          const index = state.data.tabs.findIndex(tab => tab.name === params.get('tab'));
          if (index >= 0) state.data.active = index;
          state.ui.settingsViewOpen = false;
          render();
        }
        history.replaceState(null, '', location.pathname);
      }
    }, 500);
  }
  window.addEventListener("online", () => {
    if (hasHostedLoginCredentials()) void runManualSync("reconnect");
  });
}

init();











function refreshRepeatingCheckboxes() {
  if (document.visibilityState === 'hidden' || state.ui.settingsViewOpen || state.ui.doneViewOpen) return;
  const tab = state.data.tabs[state.data.active];
  for (const row of els.list.querySelectorAll('.item')) {
    const item = tab?.items[Number(row.dataset.itemIndex)];
    const checkbox = row.querySelector('input[type="checkbox"]');
    if (item && checkbox) checkbox.checked = window.checkyReminderState.isChecked(item);
  }
}
window.addEventListener('checky-reminder-reset', event => {
  if (event.detail.recordRef !== state.currentChecklistId) return;
  window.checkyReminderState.mergeResetTimes(state.data, event.detail.checklist);
  refreshRepeatingCheckboxes();
});
setInterval(refreshRepeatingCheckboxes, 1000);
document.addEventListener('visibilitychange', refreshRepeatingCheckboxes);
