const DEFAULT_DATA = {
  active: 0,
  tabs: [{ name: "Tab 1", items: [] }]
};
const DONE_TAB_SYSTEM = "done";
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
  dataLocation: "",
  appVersion: "",
  syncTarget: "",
  syncRestorePoint: normalizeSyncRestorePointInfo(null),
  availableChecklists: [],
  assignedChecklistId: "",
  currentChecklistId: "",
  desktopUpdate: null,
  ui: {
    tabDeleteConfirmIndex: null,
    itemDeleteConfirmIndex: null,
    editingTabIndex: null,
    draggedTabIndex: null,
    draggedItemIndex: null,
    settingsOpen: false,
    captureHotkey: false,
    resetConfirmArmed: false,
    itemContextMenu: null,
    doneSearch: "",
    doneViewOpen: false,
    lastChecklistTabIndex: 0,
    advancedSettingsOpen: false,
    syncInProgress: false,
    availableChecklistsLoading: false,
    availableChecklistsMessage: "",
    availableChecklistsError: false,
    checklistFoldersOpen: {},
    updateInProgress: false,
    updateInstalling: false
  }
};

let saveTimer = null;
let lastChecklistSaveRequestId = 0;
let draggedItemPointerIndex = null;
let queuedManualSync = false;
let connectionLossAlertVisible = false;

function isUserRequestedRefresh(source) {
  return source === "manual" || source === "pull_latest";
}

function notifyConnectionLoss(message) {
  if (connectionLossAlertVisible) return;
  connectionLossAlertVisible = true;
  window.alert(
    "Checky's List could not reach Checky Base.\n\n" +
    "Your current checklist is still open and saved on this desktop. " +
    "Check the server or network connection, then refresh again.\n\n" +
    (message || "The server connection is unavailable.")
  );
  connectionLossAlertVisible = false;
}

const els = {
  app: document.getElementById("app"),
  mainView: document.getElementById("mainView"),
  tabs: document.getElementById("tabs"),
  list: document.getElementById("list"),
  addTabBtn: document.getElementById("addTabBtn"),
  addItemBtn: document.getElementById("addItemBtn"),
  settingsPanel: document.getElementById("settingsPanel"),
  topbarViewTitle: document.getElementById("topbarViewTitle"),
  updateAvailableBtn: document.getElementById("updateAvailableBtn"),
  doneToggle: document.getElementById("doneToggle"),
  quickSyncBtn: document.getElementById("quickSyncBtn"),
  settingsToggle: document.getElementById("settingsToggle"),
  settingsCloseBtn: document.getElementById("settingsCloseBtn"),
  closeWindowBtn: document.getElementById("closeWindowBtn"),
  hotkeyInput: document.getElementById("hotkeyInput"),
  hotkeyCaptureBtn: document.getElementById("hotkeyCaptureBtn"),
  hotkeyHint: document.getElementById("hotkeyHint"),
  runOnStartup: document.getElementById("runOnStartup"),
  alwaysOnTop: document.getElementById("alwaysOnTop"),
  autoHideOnBlur: document.getElementById("autoHideOnBlur"),
  showDoneTab: document.getElementById("showDoneTab"),
  syncTarget: document.getElementById("syncTarget"),
  advancedSettingsToggle: document.getElementById("advancedSettingsToggle"),
  advancedSummary: document.getElementById("advancedSummary"),
  advancedSettingsPanel: document.getElementById("advancedSettingsPanel"),
  serverUrlInput: document.getElementById("serverUrlInput"),
  syncEmailInput: document.getElementById("syncEmailInput"),
  syncPasswordInput: document.getElementById("syncPasswordInput"),
  connectSyncBtn: document.getElementById("connectSyncBtn"),
  disconnectSyncBtn: document.getElementById("disconnectSyncBtn"),
  verifySyncBtn: document.getElementById("verifySyncBtn"),
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
  backupNowBtn: document.getElementById("backupNowBtn"),
  backupSelect: document.getElementById("backupSelect"),
  restoreBackupBtn: document.getElementById("restoreBackupBtn"),
  resetChecklistBtn: document.getElementById("resetChecklistBtn"),
  instructionsBtn: document.getElementById("instructionsBtn"),
  desktopVersionSummary: document.getElementById("desktopVersionSummary"),
  checkForUpdatesBtn: document.getElementById("checkForUpdatesBtn"),
  downloadUpdateBtn: document.getElementById("downloadUpdateBtn"),
  desktopUpdateStatus: document.getElementById("desktopUpdateStatus"),
  settingsStatus: document.getElementById("settingsStatus"),
  itemContextMenu: document.getElementById("itemContextMenu")
};

function createEntityId(prefix) {
  if (window.crypto?.randomUUID) return prefix + "-" + window.crypto.randomUUID();
  return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
}

function normalizeData(data) {
  const safe = data && typeof data === "object" ? data : {};
  const tabs = Array.isArray(safe.tabs) && safe.tabs.length ? safe.tabs : [{ name: "Tab 1", items: [] }];
  tabs.forEach((tab, i) => {
    tab.id = typeof tab.id === "string" && tab.id.trim() ? tab.id.trim().slice(0, 120) : "legacy-tab-" + i;
    if (typeof tab.name !== "string" || !tab.name.trim()) tab.name = `Tab ${i + 1}`;
    if (!Array.isArray(tab.items)) tab.items = [];
    tab.system = tab.system === DONE_TAB_SYSTEM ? DONE_TAB_SYSTEM : undefined;
    tab.items = tab.items.map((item, itemIndex) => ({
      id: typeof item?.id === "string" && item.id.trim()
        ? item.id.trim().slice(0, 120)
        : "legacy-item-" + i + "-" + itemIndex,
      text: typeof item?.text === "string" ? item.text : "",
      done: !!item?.done,
      completedAt: typeof item?.completedAt === "string" && item.completedAt.trim() ? item.completedAt : null,
      reminderAt: typeof item?.reminderAt === "string" && Number.isFinite(Date.parse(item.reminderAt)) ? new Date(item.reminderAt).toISOString() : null,
      reminderRepeat: ['daily', 'weekly', 'monthly', 'yearly'].includes(item?.reminderRepeat) ? item.reminderRepeat : 'none',
      reminderTimeZone: typeof item?.reminderTimeZone === 'string' ? item.reminderTimeZone.slice(0, 120) : null,
      originalTabName: typeof item?.originalTabName === "string" && item.originalTabName.trim() ? item.originalTabName.trim() : null
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

function getVisibleTabEntries() {
  return state.data.tabs
    .map((tab, index) => ({ tab, index }))
    .filter(({ tab }) => !isDoneTab(tab));
}

function getFirstChecklistTabIndex() {
  return state.data.tabs.findIndex((tab) => !isDoneTab(tab));
}

function getSafeChecklistTabIndex(preferredIndex = state.ui.lastChecklistTabIndex) {
  if (
    Number.isInteger(preferredIndex) &&
    preferredIndex >= 0 &&
    preferredIndex < state.data.tabs.length &&
    !isDoneTab(state.data.tabs[preferredIndex])
  ) {
    return preferredIndex;
  }
  const firstChecklistTabIndex = getFirstChecklistTabIndex();
  return firstChecklistTabIndex === -1 ? 0 : firstChecklistTabIndex;
}

function openDoneView() {
  const doneTabIndex = getDoneTabIndex();
  if (doneTabIndex === -1) return;
  if (!isDoneTab(state.data.tabs[state.data.active])) {
    state.ui.lastChecklistTabIndex = getSafeChecklistTabIndex(state.data.active);
  }
  state.ui.doneViewOpen = true;
  state.data.active = doneTabIndex;
}

function closeDoneView() {
  state.ui.doneViewOpen = false;
  state.data.active = getSafeChecklistTabIndex();
}

function ensureDoneTabState() {
  let doneTabIndex = getDoneTabIndex();
  if (state.settings.showDoneTab && doneTabIndex === -1) {
    state.data.tabs.push({ id: createEntityId("tab"), name: "Done", system: DONE_TAB_SYSTEM, items: [] });
    doneTabIndex = state.data.tabs.length - 1;
  }
  if (doneTabIndex !== -1) {
    if (!state.data.tabs[doneTabIndex].name || !state.data.tabs[doneTabIndex].name.trim()) {
      state.data.tabs[doneTabIndex].name = "Done";
    }
    state.data.tabs[doneTabIndex].system = DONE_TAB_SYSTEM;
    if (doneTabIndex !== state.data.tabs.length - 1) {
      const [doneTab] = state.data.tabs.splice(doneTabIndex, 1);
      state.data.tabs.push(doneTab);
      if (state.data.active === doneTabIndex) state.data.active = state.data.tabs.length - 1;
      else if (state.data.active > doneTabIndex) state.data.active -= 1;
      doneTabIndex = state.data.tabs.length - 1;
    }
  }

  if (state.data.tabs.every((tab) => isDoneTab(tab))) {
    state.data.tabs.unshift({ name: "Tab 1", items: [] });
    if (state.data.active >= 0) state.data.active += 1;
  }

  const activeTab = state.data.tabs[state.data.active];
  if (!state.settings.showDoneTab && isDoneTab(activeTab)) {
    state.data.active = getSafeChecklistTabIndex();
  }
  if (!state.settings.showDoneTab) {
    state.ui.doneViewOpen = false;
  }
  if (state.ui.doneViewOpen && doneTabIndex !== -1) {
    state.data.active = doneTabIndex;
  } else if (!isDoneTab(state.data.tabs[state.data.active])) {
    state.ui.lastChecklistTabIndex = getSafeChecklistTabIndex(state.data.active);
  }
}

function getNewTabInsertIndex() {
  const doneTabIndex = getDoneTabIndex();
  return doneTabIndex === -1 ? state.data.tabs.length : doneTabIndex;
}

function formatDoneTimestamp(date = new Date()) {
  return date.toLocaleString();
}

function stripDoneStamp(text) {
  if (typeof text !== "string") return "";
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return "";
  const lastLine = lines[lines.length - 1].trim();
  if (lastLine.startsWith("Completed: ")) {
    return lines.slice(0, -1).join("\n").trim();
  }
  return text.trim();
}

function findTabIndexByName(name) {
  if (!name) return -1;
  return state.data.tabs.findIndex((tab) => !isDoneTab(tab) && tab.name === name);
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

function renderDoneArchiveRow(item, index) {
  const row = document.createElement("div");
  row.className = "item";
  row.dataset.itemIndex = String(index);
  const doneTabIndex = getDoneTabIndex();
  row.oncontextmenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    openItemContextMenu(doneTabIndex, index, e.clientX, e.clientY);
  };

  const meta = document.createElement("div");
  meta.className = "done-meta";
  const completedDate = getCompletedDate(item);
  meta.textContent = completedDate ? formatArchiveTime(completedDate) : "Unknown time";

  const text = document.createElement("textarea");
  text.value = item.text || "";
  text.placeholder = "Completed item...";
  text.oninput = () => {
    item.text = text.value;
    debounceSaveChecklist();
  };

  row.appendChild(meta);
  row.appendChild(text);

  return row;
}

function renderDoneArchive(tab) {
  els.list.innerHTML = "";
  const query = state.ui.doneSearch.trim().toLowerCase();

  const filtered = tab.items
    .map((item, index) => ({ item, index, date: getCompletedDate(item) }))
    .filter(({ item }) => !query || (item.text || "").toLowerCase().includes(query))
    .sort((a, b) => {
      const aTime = a.date ? a.date.getTime() : 0;
      const bTime = b.date ? b.date.getTime() : 0;
      return bTime - aTime;
    });

  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "archive-empty";
    empty.textContent = query ? "No completed items match that search." : "No completed items yet.";
    els.list.appendChild(empty);
    return;
  }

  let lastMonthKey = "";
  let lastDayKey = "";

  filtered.forEach(({ item, index, date }) => {
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

    els.list.appendChild(renderDoneArchiveRow(item, index));
  });
}

function setStatus(msg, isError = false) {
  els.settingsStatus.textContent = msg;
  els.settingsStatus.style.color = isError ? "#ff9494" : "#b7b7b7";
}

function getAdvancedSyncSummary() {
  const advanced = normalizeSettings(state.settings).advanced;
  const serverUrl = normalizeServerUrl(advanced.serverUrl);
  const email = advanced.email.trim();
  const password = advanced.password;

  if (email && serverUrl && password) {
    return `${email} @ ${serverUrl}`;
  }
  if (email && serverUrl) {
    return `${email} @ ${serverUrl} (password required)`;
  }
  if (serverUrl) {
    return `${serverUrl} (email/password required)`;
  }
  if (email) {
    return `${email} (server URL required)`;
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
    heading.className = "folder-tab-heading" + (current?.isPersonal === isPersonal ? " active" : "");
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
      if (group.open && items.length === 1 && items[0].id !== state.currentChecklistId && !busy) {
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
        button.disabled = busy || isCurrent;
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

function clearAvailableChecklists(message = "") {
  state.availableChecklists = [];
  state.assignedChecklistId = "";
  state.currentChecklistId = "";
  state.ui.availableChecklistsMessage = message;
  state.ui.availableChecklistsError = false;
}

function updateAdvancedSettings(field, value) {
  const normalized = normalizeSettings(state.settings);
  state.settings = normalizeSettings({
    ...normalized,
    advanced: {
      ...normalized.advanced,
      [field]: value
    }
  });
}

function syncVisibleAdvancedSettingsToState() {
  updateAdvancedSettings("serverUrl", els.serverUrlInput.value.trim());
  updateAdvancedSettings("email", els.syncEmailInput.value.trim());
  updateAdvancedSettings("password", els.syncPasswordInput.value);
}

async function persistChecklist({ updateStatus = true } = {}) {
  const requestId = ++lastChecklistSaveRequestId;
  try {
    const savedChecklist = await window.checkyApi.saveChecklist(state.data);
    if (requestId === lastChecklistSaveRequestId) {
      state.data = normalizeData(savedChecklist);
    }
    if (updateStatus) {
      setStatus("Saved.");
    }
    return true;
  } catch {
    if (updateStatus) {
      setStatus("Failed to save checklist.", true);
    }
    return false;
  }
}

function debounceSaveChecklist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    await persistChecklist();
  }, 400);
}

async function flushPendingSave() {
  if (!saveTimer) {
    return true;
  }

  clearTimeout(saveTimer);
  saveTimer = null;
  return await persistChecklist({ updateStatus: false });
}

async function persistSettings({ showStatus = true } = {}) {
  syncVisibleAdvancedSettingsToState();

  try {
    const result = await window.checkyApi.saveSettings(state.settings);
    state.settings = normalizeSettings(result.settings);
    if (typeof result?.syncTarget === "string") {
      state.syncTarget = result.syncTarget;
    }
    renderSettings();
    if (!result.ok) {
      if (showStatus) {
        setStatus(result.message, true);
      }
      return false;
    }
    if (showStatus) {
      setStatus("Settings saved.");
    }
    return true;
  } catch {
    renderSettings();
    if (showStatus) {
      setStatus("Failed to save settings.", true);
    }
    return false;
  }
}

async function loadAvailableChecklists({ notifyOnConnectionLoss = false } = {}) {
  if (state.ui.availableChecklistsLoading) return;
  state.ui.availableChecklistsLoading = true;
  state.ui.availableChecklistsError = false;
  state.ui.availableChecklistsMessage = "";
  renderSettings();

  try {
    const result = await window.checkyApi.listAccessibleChecklists();
    if (result?.ok === false) throw new Error("Checklist refresh failed");
    state.availableChecklists = Array.isArray(result?.checklists)
      ? result.checklists.map((item) => normalizeChecklistBrowserItem(item))
      : [];
    state.assignedChecklistId = typeof result?.assignedChecklistId === "string" ? result.assignedChecklistId : "";
    state.currentChecklistId = typeof result?.currentChecklistId === "string" ? result.currentChecklistId : "";
    state.ui.availableChecklistsMessage = "";
    if (typeof result?.syncTarget === "string") {
      state.syncTarget = result.syncTarget;
    }
  } catch {
    state.ui.availableChecklistsMessage = "Could not refresh checklists. Your current checklist is still open.";
    state.ui.availableChecklistsError = true;
    if (notifyOnConnectionLoss) {
      notifyConnectionLoss("The checklist list could not be refreshed.");
    }
  } finally {
    state.ui.availableChecklistsLoading = false;
    renderSettings();
  }
}

async function useSelectedChecklist(selectedChecklistId) {
  if (state.ui.syncInProgress || state.ui.availableChecklistsLoading || !selectedChecklistId || selectedChecklistId === state.currentChecklistId) return;

  state.ui.syncInProgress = true;
  state.ui.availableChecklistsError = false;
  state.ui.availableChecklistsMessage = "Opening checklist...";
  renderChecklistPicker();
  let switched = false;
  try {
    syncVisibleItemsToState();
    if (!await flushPendingSave()) throw new Error("Could not save your current checklist. Please try again.");
    if (!await persistSettings({ showStatus: false })) throw new Error("Could not save settings. Please try again.");
    const result = await window.checkyApi.useAccessibleChecklist(selectedChecklistId, state.data);
    if (!result?.ok) throw new Error(result?.message || "Could not open that checklist. Please try again.");
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
  if (typeof result?.syncTarget === "string") {
    state.syncTarget = result.syncTarget;
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

async function runSync(source = "manual") {
  if (state.ui.syncInProgress) {
    queuedManualSync = true;
    return;
  }

  syncVisibleItemsToState();
  const didFlushPendingSave = await flushPendingSave();
  if (!didFlushPendingSave) {
    setStatus("Failed to save checklist.", true);
    return;
  }

  if (source === "connect") {
    const sessionStatus = await window.checkyApi.getSyncSessionStatus();
    if (sessionStatus?.hasUnsyncedChanges) {
      const approved = window.confirm(
        "This desktop has checklist changes that have not reached Checky Base yet.\n\n" +
        "Connecting again will start a fresh server session and pull the server checklist. A Safety copy will be saved first, but the unsynced local version will no longer remain on screen.\n\n" +
        "Continue connecting?"
      );
      if (!approved) {
        setStatus("Connect cancelled. Your unsynced checklist remains on this desktop.");
        return;
      }
    }
  }

  const didPersistSettings = await persistSettings({ showStatus: false });
  if (!didPersistSettings) {
    setStatus("Failed to save settings.", true);
    return;
  }

  state.ui.syncInProgress = true;
  renderSettings();

  try {
    if (source === "connect") {
      await window.checkyApi.resetSyncSession();
    }

    let result = await window.checkyApi.syncNow(state.data, {
      source,
      saveRestorePoint: source === "manual" || source === "connect" || source === "pull_latest"
    });
    if (result?.mergeRequired) {
      const additions = Array.isArray(result.mergeAdditions) ? result.mergeAdditions : [];
      const preview = additions
        .map((item) => "- " + (item.text?.trim() || "(empty task)") + " [" + (item.tabName || "Checklist") + "]")
        .join("\n");
      const approved = window.confirm(
        "This checklist changed on the server while this desktop was offline.\n\n" +
        "Only these new offline tasks will be added to the newer server list:\n\n" +
        preview +
        "\n\nOffline edits and deletions will not be applied. Merge these new tasks?"
      );
      if (!approved) {
        setStatus("Merge cancelled. Your offline checklist remains saved on this desktop.", true);
        return;
      }
      result = await window.checkyApi.syncNow(state.data, {
        source,
        saveRestorePoint: false,
        allowNewItemMerge: true
      });
    }
    if (result?.checklist) {
      state.data = normalizeData(result.checklist);
    }
    if (result?.settings) {
      state.settings = normalizeSettings(result.settings);
    }
    if (typeof result?.dataLocation === "string") {
      state.dataLocation = result.dataLocation;
    }
    if (typeof result?.syncTarget === "string") {
      state.syncTarget = result.syncTarget;
    }
    if (result?.syncRestorePoint) {
      state.syncRestorePoint = normalizeSyncRestorePointInfo(result.syncRestorePoint);
    }
    render();
    if (result?.ok) {
      await loadAvailableChecklists();
    }

    if (result?.ok) {
      setStatus(result.message || "Synced.");
      return;
    }

    const failureMessage = result?.message || "Sync is not available right now.";
    setStatus(failureMessage, !!result?.isError);
    if (result?.isError && isUserRequestedRefresh(source)) {
      notifyConnectionLoss(failureMessage);
    }
  } catch {
    setStatus("Sync failed.", true);
    if (isUserRequestedRefresh(source)) {
      notifyConnectionLoss("The refresh could not be completed.");
    }
  } finally {
    state.ui.syncInProgress = false;
    renderSettings();
    if (queuedManualSync) {
      queuedManualSync = false;
      await runSync(source);
    }
  }
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
  handle.draggable = true;
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
  document.querySelectorAll(".item").forEach((el) => {
    el.classList.remove("dragging");
    el.classList.remove("drag-over");
  });
}

function closeItemContextMenu() {
  state.ui.itemContextMenu = null;
  els.itemContextMenu.classList.add("hidden");
  els.itemContextMenu.innerHTML = "";
}

function positionContextMenu(menuState) {
  const menu = els.itemContextMenu;
  const padding = 8;
  const menuRect = menu.getBoundingClientRect();
  let left = menuState.x;
  let top = menuState.y;

  if (left + menuRect.width > window.innerWidth - padding) {
    left = Math.max(padding, window.innerWidth - menuRect.width - padding);
  }
  if (top + menuRect.height > window.innerHeight - padding) {
    top = Math.max(padding, window.innerHeight - menuRect.height - padding);
  }

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function renderItemContextMenu() {
  const menuState = state.ui.itemContextMenu;
  if (!menuState) {
    closeItemContextMenu();
    return;
  }

  const sourceTab = state.data.tabs[menuState.tabIndex];
  const item = sourceTab?.items?.[menuState.itemIndex];
  if (!sourceTab || !item) {
    closeItemContextMenu();
    return;
  }

  const canMoveUp = menuState.itemIndex > 0;
  const canMoveDown = menuState.itemIndex < sourceTab.items.length - 1;
  const confirmDelete = !!menuState.confirmDelete;
  const confirmUndo = !!menuState.confirmUndo;

  els.itemContextMenu.innerHTML = "";
  els.itemContextMenu.classList.remove("hidden");

  const createMenuButton = (label, onClick, disabled = false, extraClass = "") => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `context-menu-item ${extraClass}`.trim();
    btn.textContent = label;
    btn.disabled = disabled;
    btn.onclick = (e) => {
      e.stopPropagation();
      if (disabled) return;
      onClick();
    };
    return btn;
  };

  els.itemContextMenu.appendChild(
    createMenuButton("Move up", () => moveItemByOffset(menuState.tabIndex, menuState.itemIndex, -1), !canMoveUp)
  );
  els.itemContextMenu.appendChild(
    createMenuButton("Move down", () => moveItemByOffset(menuState.tabIndex, menuState.itemIndex, 1), !canMoveDown)
  );
  if (isDoneTab(sourceTab)) {
    if (confirmUndo) {
      els.itemContextMenu.appendChild(
        createMenuButton("Confirm undo", () => undoDoneItem(menuState.itemIndex), false, "danger")
      );
      els.itemContextMenu.appendChild(
        createMenuButton("Cancel", () => {
          state.ui.itemContextMenu = { ...menuState, confirmUndo: false };
          renderItemContextMenu();
        })
      );
    } else {
      els.itemContextMenu.appendChild(
        createMenuButton("Undo done", () => {
          state.ui.itemContextMenu = { ...menuState, confirmUndo: true };
          renderItemContextMenu();
        })
      );
    }
  } else {
    els.itemContextMenu.appendChild(
      createMenuButton("Mark done", () => markItemDone(menuState.tabIndex, menuState.itemIndex))
    );
    const moveGroup = document.createElement("div");
    moveGroup.className = "context-menu-group";

    const moveHeader = document.createElement("button");
    moveHeader.type = "button";
    moveHeader.className = "context-menu-item context-menu-parent";
    moveHeader.textContent = "Move to";
    moveGroup.appendChild(moveHeader);

    const submenu = document.createElement("div");
    submenu.className = "context-submenu";

    getVisibleTabEntries().forEach(({ tab, index: tabIndex }) => {
      submenu.appendChild(
        createMenuButton(
          tab.name,
          () => moveItemBetweenTabs(menuState.tabIndex, menuState.itemIndex, tabIndex),
          tabIndex === menuState.tabIndex
        )
      );
    });

    moveGroup.appendChild(submenu);
    els.itemContextMenu.appendChild(moveGroup);
  }
  if (confirmDelete) {
    els.itemContextMenu.appendChild(
      createMenuButton("Confirm delete", () => deleteItemAt(menuState.tabIndex, menuState.itemIndex), false, "danger")
    );
    els.itemContextMenu.appendChild(
      createMenuButton("Cancel", () => {
        state.ui.itemContextMenu = { ...menuState, confirmDelete: false };
        renderItemContextMenu();
      })
    );
  } else {
    els.itemContextMenu.appendChild(
      createMenuButton("Delete", () => {
        state.ui.itemContextMenu = { ...menuState, confirmDelete: true };
        renderItemContextMenu();
      }, false, "danger")
    );
  }

  positionContextMenu(menuState);
}

function moveItem(fromIndex, toIndex) {
  const tab = state.data.tabs[state.data.active];
  if (!tab || !Array.isArray(tab.items)) return;
  if (fromIndex === null || toIndex === null) return;
  if (fromIndex < 0 || toIndex < 0) return;
  if (fromIndex >= tab.items.length || toIndex >= tab.items.length) return;
  syncVisibleItemsToState();
  moveInArray(tab.items, fromIndex, toIndex);
  clearItemDragState();
  renderItems();
  debounceSaveChecklist();
}

function moveItemBetweenTabs(sourceTabIndex, fromIndex, targetTabIndex) {
  const sourceTab = state.data.tabs[sourceTabIndex];
  const targetTab = state.data.tabs[targetTabIndex];
  if (!sourceTab || !targetTab || !Array.isArray(sourceTab.items) || !Array.isArray(targetTab.items)) return;
  if (fromIndex === null || fromIndex < 0 || fromIndex >= sourceTab.items.length) return;
  if (sourceTabIndex === targetTabIndex) return;

  syncVisibleItemsToState();
  const [movedItem] = sourceTab.items.splice(fromIndex, 1);
  if (!movedItem) {
    clearItemDragState();
    closeItemContextMenu();
    return;
  }

  targetTab.items.push(movedItem);
  if (isDoneTab(targetTab)) {
    openDoneView();
  } else {
    state.data.active = targetTabIndex;
    state.ui.lastChecklistTabIndex = getSafeChecklistTabIndex(targetTabIndex);
  }
  state.ui.itemDeleteConfirmIndex = null;
  clearItemDragState();
  closeItemContextMenu();
  render();
  debounceSaveChecklist();
}

function markItemDone(sourceTabIndex, itemIndex) {
  const doneTabIndex = getDoneTabIndex();
  const sourceTab = state.data.tabs[sourceTabIndex];
  const doneTab = doneTabIndex === -1 ? null : state.data.tabs[doneTabIndex];
  if (!sourceTab || !doneTab || !Array.isArray(sourceTab.items) || !Array.isArray(doneTab.items)) return;
  if (itemIndex < 0 || itemIndex >= sourceTab.items.length) return;

  syncVisibleItemsToState();
  const [item] = sourceTab.items.splice(itemIndex, 1);
  if (!item) {
    closeItemContextMenu();
    return;
  }

  const stamp = `Completed: ${formatDoneTimestamp()}`;
  item.done = true;
  item.completedAt = new Date().toISOString();
  item.originalTabName = sourceTab.name;
  item.text = item.text.trim() ? `${item.text}\n${stamp}` : stamp;
  doneTab.items.push(item);

  state.ui.itemDeleteConfirmIndex = null;
  closeItemContextMenu();
  render();
  debounceSaveChecklist();
}

function undoDoneItem(itemIndex) {
  const doneTabIndex = getDoneTabIndex();
  const doneTab = doneTabIndex === -1 ? null : state.data.tabs[doneTabIndex];
  if (!doneTab || !Array.isArray(doneTab.items) || itemIndex < 0 || itemIndex >= doneTab.items.length) return;

  syncVisibleItemsToState();
  const [item] = doneTab.items.splice(itemIndex, 1);
  if (!item) {
    closeItemContextMenu();
    return;
  }

  const targetTabIndex = findTabIndexByName(item.originalTabName);
  const safeTargetTabIndex = targetTabIndex === -1 ? getSafeChecklistTabIndex() : targetTabIndex;
  const targetTab = state.data.tabs[safeTargetTabIndex];
  if (!targetTab || isDoneTab(targetTab)) {
    closeItemContextMenu();
    return;
  }

  item.done = false;
  item.completedAt = null;
  item.text = stripDoneStamp(item.text);
  item.originalTabName = null;
  targetTab.items.push(item);

  closeDoneView();
  state.data.active = safeTargetTabIndex;
  state.ui.lastChecklistTabIndex = getSafeChecklistTabIndex(safeTargetTabIndex);
  closeItemContextMenu();
  render();
  debounceSaveChecklist();
}

function moveItemByOffset(tabIndex, itemIndex, offset) {
  const tab = state.data.tabs[tabIndex];
  if (!tab || !Array.isArray(tab.items)) return;
  const targetIndex = itemIndex + offset;
  if (targetIndex < 0 || targetIndex >= tab.items.length) return;

  syncVisibleItemsToState();
  moveInArray(tab.items, itemIndex, targetIndex);
  state.data.active = tabIndex;
  closeItemContextMenu();
  render();
  debounceSaveChecklist();
}

function deleteItemAt(tabIndex, itemIndex) {
  const tab = state.data.tabs[tabIndex];
  if (!tab || !Array.isArray(tab.items) || itemIndex < 0 || itemIndex >= tab.items.length) return;

  syncVisibleItemsToState();
  tab.items.splice(itemIndex, 1);
  state.ui.itemDeleteConfirmIndex = null;
  closeItemContextMenu();
  render();
  debounceSaveChecklist();
}

function openItemContextMenu(tabIndex, itemIndex, clientX, clientY) {
  syncVisibleItemsToState();
  state.ui.itemContextMenu = {
    tabIndex,
    itemIndex,
    x: clientX,
    y: clientY,
    confirmDelete: false,
    confirmUndo: false
  };
  renderItemContextMenu();
}

function syncVisibleItemsToState() {
  const tab = state.data.tabs[state.data.active];
  const rows = els.list.querySelectorAll(".item");
  rows.forEach((row) => {
    const idx = Number.parseInt(row.dataset.itemIndex || "", 10);
    if (Number.isNaN(idx) || !tab.items[idx]) return;
    const textarea = row.querySelector("textarea");
    if (!textarea) return;
    tab.items[idx].text = textarea.value;
  });
}

function renderSettings() {
  state.settings = normalizeSettings(state.settings);
  const advanced = state.settings.advanced;

  els.mainView.classList.toggle("hidden", !!state.ui.settingsOpen);
  els.settingsPanel.classList.toggle("hidden", !state.ui.settingsOpen);
  els.topbarViewTitle.classList.toggle("hidden", !state.ui.settingsOpen);
  els.hotkeyInput.value = state.settings.hotkey;
  els.runOnStartup.checked = state.settings.runOnStartup;
  els.alwaysOnTop.checked = state.settings.alwaysOnTop;
  els.autoHideOnBlur.checked = state.settings.autoHideOnBlur;
  els.showDoneTab.checked = state.settings.showDoneTab;
  els.doneSearchInput.value = state.ui.doneSearch;
  const doneTabIndex = getDoneTabIndex();
  const doneTabName = doneTabIndex === -1 ? "Done" : state.data.tabs[doneTabIndex].name;
  els.doneToggle.textContent = "\u2611";
  els.doneToggle.title = doneTabName;
  els.doneToggle.classList.toggle("hidden", state.ui.settingsOpen || !state.settings.showDoneTab);
  els.doneToggle.classList.toggle("btn-primary", !!state.ui.doneViewOpen && state.settings.showDoneTab);
  els.doneToggle.classList.toggle("btn-ghost", !state.ui.doneViewOpen || !state.settings.showDoneTab);
  els.quickSyncBtn.classList.toggle("hidden", !!state.ui.settingsOpen);
  els.settingsToggle.classList.toggle("hidden", !!state.ui.settingsOpen);
  els.settingsCloseBtn.classList.toggle("hidden", !state.ui.settingsOpen);
  els.closeWindowBtn.classList.toggle("hidden", !!state.ui.settingsOpen);
  els.quickSyncBtn.disabled = state.ui.syncInProgress;
  els.quickSyncBtn.classList.toggle("syncing", state.ui.syncInProgress);
  els.quickSyncBtn.title = state.ui.syncInProgress ? "Syncing now" : "Sync now";
  els.syncTarget.textContent = state.syncTarget || "Local cache only";
  els.serverUrlInput.value = advanced.serverUrl;
  els.syncEmailInput.value = advanced.email;
  els.syncPasswordInput.value = advanced.password;
  els.connectSyncBtn.disabled = state.ui.syncInProgress;
  els.connectSyncBtn.textContent = state.ui.syncInProgress ? "Connecting..." : "Connect";
  els.disconnectSyncBtn.disabled = state.ui.syncInProgress;
  els.verifySyncBtn.disabled = state.ui.syncInProgress;
  renderChecklistPicker();
  els.syncNowBtn.disabled = state.ui.syncInProgress;
  els.syncNowBtn.textContent = state.ui.syncInProgress ? "Syncing..." : "Pull latest";
  els.syncRestorePointSummary.textContent = getSyncRestorePointSummary();
  els.restoreSyncRestorePointBtn.disabled = state.ui.syncInProgress || !normalizeSyncRestorePointInfo(state.syncRestorePoint).available;
  els.advancedSummary.textContent = getAdvancedSyncSummary();
  els.advancedSettingsToggle.setAttribute("aria-expanded", String(state.ui.advancedSettingsOpen));
  els.advancedSettingsPanel.classList.toggle("hidden", !state.ui.advancedSettingsOpen);
  els.dataLocation.textContent = state.dataLocation;
  els.desktopVersionSummary.textContent = state.appVersion
    ? `Current version: ${state.appVersion}`
    : "Current version";
  els.checkForUpdatesBtn.disabled = state.ui.updateInProgress;
  els.checkForUpdatesBtn.textContent = state.ui.updateInProgress && !state.ui.updateInstalling
    ? "Checking..."
    : "Check for updates";
  const updateAvailable = !!state.desktopUpdate?.updateAvailable;
  els.updateAvailableBtn.classList.toggle("hidden", !updateAvailable);
  els.updateAvailableBtn.disabled = state.ui.updateInProgress;
  els.updateAvailableBtn.textContent = state.ui.updateInstalling ? "Installing..." : "Update";
  els.updateAvailableBtn.title = updateAvailable
    ? `Install Checky's List ${state.desktopUpdate.latestVersion}`
    : "Install available update";
  els.downloadUpdateBtn.classList.toggle("hidden", !updateAvailable);
  els.downloadUpdateBtn.disabled = state.ui.updateInProgress || !state.desktopUpdate?.downloadUrl;
  els.downloadUpdateBtn.textContent = state.ui.updateInstalling ? "Downloading..." : "Download and install";
  els.desktopUpdateStatus.textContent = state.desktopUpdate?.message ||
    "Updates are downloaded from the connected Checky Base server and verified before Windows opens the installer.";
  els.hotkeyCaptureBtn.textContent = state.ui.captureHotkey ? "Press keys..." : "Change";
  els.hotkeyHint.textContent = state.ui.captureHotkey ? "Press desired combination now." : "";
}

function beginTabRename(index) {
  state.ui.editingTabIndex = index;
  renderTabs();
}

function commitTabRename(index, value) {
  const clean = (value || "").trim();
  state.ui.editingTabIndex = null;
  if (!clean) {
    renderTabs();
    return;
  }
  state.data.tabs[index].name = clean;
  renderTabs();
  debounceSaveChecklist();
}

function renderTabs() {
  renderAlwaysVisibleShortcuts();
  els.tabs.innerHTML = "";
  const visibleTabs = getVisibleTabEntries();

  visibleTabs.forEach(({ tab: tabData, index: i }) => {
    const tab = document.createElement("div");
    tab.className = "tab" + (i === state.data.active ? " active" : "");
    if (state.ui.editingTabIndex === i) {
      const input = document.createElement("input");
      input.className = "tab-name-input";
      input.value = tabData.name;
      input.onkeydown = (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commitTabRename(i, input.value);
        }
        if (e.key === "Escape") {
          e.preventDefault();
          state.ui.editingTabIndex = null;
          renderTabs();
        }
      };
      input.onblur = (event) => {
        if (event.relatedTarget && tab.contains(event.relatedTarget)) return;
        commitTabRename(i, input.value);
      };

      const saveBtn = document.createElement("button");
      saveBtn.className = "btn btn-primary";
      saveBtn.textContent = "Save";
      saveBtn.onclick = (e) => {
        e.stopPropagation();
        commitTabRename(i, input.value);
      };

      tab.appendChild(input);
      tab.appendChild(saveBtn);
      addAlwaysShowOption(tab, tabData, input);
      setTimeout(() => input.focus(), 0);
    } else {
      const label = document.createElement("span");
      label.className = "tab-label";
      label.textContent = tabData.name;
      label.title = tabData.name;

      const editBtn = document.createElement("button");
      editBtn.className = "btn btn-ghost";
      editBtn.textContent = "Edit";
      editBtn.onclick = (e) => {
        e.stopPropagation();
        state.ui.tabDeleteConfirmIndex = null;
        beginTabRename(i);
      };

      tab.appendChild(label);
      tab.appendChild(editBtn);

      if (state.ui.tabDeleteConfirmIndex === i && !isDoneTab(tabData)) {
        const confirmBtn = document.createElement("button");
        confirmBtn.className = "btn btn-danger";
        confirmBtn.textContent = "Confirm";
        confirmBtn.onclick = (e) => {
          e.stopPropagation();
          const regularTabs = state.data.tabs.filter((tab) => !isDoneTab(tab));
          if (regularTabs.length === 1) {
            state.data = normalizeData(DEFAULT_DATA);
            if (state.settings.showDoneTab) {
              ensureDoneTabState();
            }
          } else {
            state.data.tabs.splice(i, 1);
            if (state.data.active >= state.data.tabs.length) state.data.active = state.data.tabs.length - 1;
          }
          state.ui.tabDeleteConfirmIndex = null;
          render();
          debounceSaveChecklist();
        };

        const cancelBtn = document.createElement("button");
        cancelBtn.className = "btn btn-ghost";
        cancelBtn.textContent = "Cancel";
        cancelBtn.onclick = (e) => {
          e.stopPropagation();
          state.ui.tabDeleteConfirmIndex = null;
          renderTabs();
        };

        tab.appendChild(confirmBtn);
        tab.appendChild(cancelBtn);
      } else if (!isDoneTab(tabData)) {
        const deleteBtn = document.createElement("button");
        deleteBtn.className = "btn btn-danger";
        deleteBtn.textContent = "Del";
        deleteBtn.onclick = (e) => {
          e.stopPropagation();
          state.ui.tabDeleteConfirmIndex = i;
          renderTabs();
        };
        tab.appendChild(deleteBtn);
      }

      if (!isDoneTab(tabData)) {
        const dragHandle = createDragHandle("Drag tab");
        tab.appendChild(dragHandle);

        tab.draggable = true;
        tab.ondragstart = (e) => {
          if (!canStartTabDrag(e)) {
            e.preventDefault();
            return;
          }
          state.ui.draggedTabIndex = i;
          tab.classList.add("dragging");
          e.dataTransfer.setData("text/plain", String(i));
          e.dataTransfer.effectAllowed = "move";
        };
      }
      tab.ondragover = (e) => {
        const draggingTab = !isDoneTab(tabData) && state.ui.draggedTabIndex !== null && state.ui.draggedTabIndex !== i;
        if (!draggingTab) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      };
      tab.ondragenter = (e) => {
        const draggingTab = !isDoneTab(tabData) && state.ui.draggedTabIndex !== null && state.ui.draggedTabIndex !== i;
        if (!draggingTab) return;
        e.preventDefault();
        tab.classList.add("drag-over");
      };
      tab.ondragleave = () => tab.classList.remove("drag-over");
      tab.ondrop = (e) => {
        if (state.ui.draggedTabIndex === null) return;
        e.preventDefault();
        e.stopPropagation();
        tab.classList.remove("drag-over");

        const from = state.ui.draggedTabIndex;
        const to = i;
        const activeBefore = state.data.active;
        moveInArray(state.data.tabs, from, to);

        if (activeBefore === from) state.data.active = to;
        else if (from < activeBefore && to >= activeBefore) state.data.active = activeBefore - 1;
        else if (from > activeBefore && to <= activeBefore) state.data.active = activeBefore + 1;

        render();
        debounceSaveChecklist();
      };
      tab.ondragend = () => {
        state.ui.draggedTabIndex = null;
        document.querySelectorAll(".tab").forEach((el) => {
          el.classList.remove("dragging");
          el.classList.remove("drag-over");
        });
      };
    }

    tab.onclick = () => {
      state.ui.doneViewOpen = false;
      state.data.active = i;
      state.ui.lastChecklistTabIndex = getSafeChecklistTabIndex(i);
      state.ui.itemDeleteConfirmIndex = null;
      render();
      debounceSaveChecklist();
    };

    (isTabAlwaysVisible(tabData.id) ? els.alwaysVisibleTabs : els.tabs).appendChild(tab);
  });

  els.tabs.ondragover = (e) => {
    if (state.ui.draggedTabIndex === null) return;
    e.preventDefault();
  };
  els.tabs.ondrop = (e) => {
    if (state.ui.draggedTabIndex === null) return;
    if (e.target.closest(".tab")) return;
    e.preventDefault();
    const from = state.ui.draggedTabIndex;
    const to = getNewTabInsertIndex() - 1;
    if (from === to) return;

    const activeBefore = state.data.active;
    moveInArray(state.data.tabs, from, to);
    if (activeBefore === from) state.data.active = to;
    else if (from < activeBefore) state.data.active = activeBefore - 1;

    render();
    debounceSaveChecklist();
  };
}

function renderItems() {
  els.list.innerHTML = "";
  els.list.ondragover = null;
  els.list.ondrop = null;
  els.doneArchiveTools.classList.toggle("hidden", !state.ui.doneViewOpen || !state.settings.showDoneTab);
  els.addItemBtn.classList.toggle("hidden", !!state.ui.doneViewOpen);
  const tab = state.data.tabs[state.data.active];
  if (state.settings.showDoneTab && state.ui.doneViewOpen) {
    const doneTabIndex = getDoneTabIndex();
    const doneTab = doneTabIndex === -1 ? null : state.data.tabs[doneTabIndex];
    if (doneTab) {
      renderDoneArchive(doneTab);
      return;
    }
  }

  tab.items.forEach((item, i) => {
    const row = document.createElement("div");
    row.className = "item";
    row.dataset.itemIndex = String(i);
    row.oncontextmenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      openItemContextMenu(state.data.active, i, e.clientX, e.clientY);
    };

    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = !!item.done;
    check.onchange = () => {
      item.done = check.checked;
      persistChecklistImmediately();
    };

    const text = document.createElement("textarea");
    text.value = item.text || "";
    text.placeholder = "Checklist description...";
    text.oninput = () => {
      item.text = text.value;
      debounceSaveChecklist();
    };

    row.appendChild(check);
    row.appendChild(text);

    if (state.ui.itemDeleteConfirmIndex === i) {
      const confirmBtn = document.createElement("button");
      confirmBtn.className = "btn btn-danger";
      confirmBtn.textContent = "Confirm";
      confirmBtn.onclick = () => {
        tab.items.splice(i, 1);
        state.ui.itemDeleteConfirmIndex = null;
        renderItems();
        debounceSaveChecklist();
      };

      const cancelBtn = document.createElement("button");
      cancelBtn.className = "btn btn-ghost";
      cancelBtn.textContent = "Cancel";
      cancelBtn.onclick = () => {
        state.ui.itemDeleteConfirmIndex = null;
        renderItems();
      };

      row.appendChild(confirmBtn);
      row.appendChild(cancelBtn);
    } else {
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "btn btn-danger";
      deleteBtn.textContent = "Del";
      deleteBtn.onclick = () => {
        state.ui.itemDeleteConfirmIndex = i;
        renderItems();
      };
      row.appendChild(deleteBtn);
    }

    const dragHandle = createDragHandle("Drag item");
    row.appendChild(dragHandle);

    row.draggable = true;
      row.ondragstart = (e) => {
        if (!canStartItemDrag(e)) {
          e.preventDefault();
          return;
        }
        syncVisibleItemsToState();
        state.ui.draggedItemIndex = i;
        row.classList.add("dragging");
        e.dataTransfer.setData("text/plain", String(i));
        e.dataTransfer.effectAllowed = "move";
      };
    row.ondragover = (e) => {
      if (state.ui.draggedItemIndex === null || state.ui.draggedItemIndex === i) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    };
    row.ondragenter = (e) => {
      if (state.ui.draggedItemIndex === null || state.ui.draggedItemIndex === i) return;
      e.preventDefault();
      row.classList.add("drag-over");
    };
    row.ondragleave = () => row.classList.remove("drag-over");
      row.ondrop = (e) => {
        if (state.ui.draggedItemIndex === null) return;
        e.preventDefault();
        e.stopPropagation();
        row.classList.remove("drag-over");
        syncVisibleItemsToState();
        moveInArray(tab.items, state.ui.draggedItemIndex, i);
        clearItemDragState();
        renderItems();
        debounceSaveChecklist();
      };
    row.ondragend = () => clearItemDragState();

    dragHandle.onpointerdown = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      syncVisibleItemsToState();
      draggedItemPointerIndex = i;
      state.ui.draggedItemIndex = i;
      row.classList.add("dragging");
    };
    row.onpointerenter = () => {
      if (draggedItemPointerIndex === null || draggedItemPointerIndex === i) return;
      row.classList.add("drag-over");
    };
    row.onpointerleave = () => {
      row.classList.remove("drag-over");
    };
    row.onpointerup = (e) => {
      if (draggedItemPointerIndex === null) return;
      e.preventDefault();
      moveItem(draggedItemPointerIndex, i);
    };

    els.list.appendChild(row);
  });

  els.list.ondragover = (e) => {
    if (state.ui.draggedItemIndex === null) return;
    e.preventDefault();
  };
  els.list.ondrop = (e) => {
    if (state.ui.draggedItemIndex === null) return;
    if (e.target.closest(".item")) return;
    e.preventDefault();
    syncVisibleItemsToState();
    const from = state.ui.draggedItemIndex;
    const to = tab.items.length - 1;
    if (from === to) {
      clearItemDragState();
      return;
    }
    moveInArray(tab.items, from, to);
    clearItemDragState();
    renderItems();
    debounceSaveChecklist();
  };
}

function render() {
  state.data = normalizeData(state.data);
  state.settings = normalizeSettings(state.settings);
  ensureDoneTabState();
  document.body.classList.toggle("done-view", !!state.ui.doneViewOpen && state.settings.showDoneTab);
  renderSettings();
  renderTabs();
  renderItems();
  renderItemContextMenu();
}

function openSettingsPanel() {
  state.ui.settingsOpen = true;
  render();
  els.settingsPanel.scrollTop = 0;
}

function closeSettingsPanel() {
  state.ui.settingsOpen = false;
  render();
}

function mapKeyToken(key) {
  const lower = key.toLowerCase();
  const specialMap = {
    " ": "Space",
    spacebar: "Space",
    arrowup: "Up",
    arrowdown: "Down",
    arrowleft: "Left",
    arrowright: "Right",
    escape: "Esc",
    enter: "Enter",
    tab: "Tab",
    backspace: "Backspace",
    delete: "Delete"
  };
  if (specialMap[lower]) return specialMap[lower];
  if (/^f([1-9]|1[0-2])$/i.test(key)) return key.toUpperCase();
  if (key.length === 1) return key.toUpperCase();
  return key;
}

function isModifierKey(key) {
  const lower = key.toLowerCase();
  return lower === "control" || lower === "shift" || lower === "alt" || lower === "meta";
}

function toAcceleratorFromEvent(e) {
  if (isModifierKey(e.key)) return null;
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push("CommandOrControl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  const key = mapKeyToken(e.key);
  if (!key) return null;
  if (parts.length === 0) return null;
  return `${parts.join("+")}+${key}`;
}

async function reloadBackups() {
  const backups = await window.checkyApi.listBackups();
  els.backupSelect.innerHTML = "";
  backups.forEach((b) => {
    const opt = document.createElement("option");
    const dt = new Date(b.mtimeMs).toLocaleString();
    opt.value = b.name;
    opt.textContent = `${dt} - ${b.name}`;
    els.backupSelect.appendChild(opt);
  });
}

async function refreshDesktopUpdate({ silent = true } = {}) {
  if (state.ui.updateInProgress) return state.desktopUpdate;
  if (!normalizeServerUrl(state.settings?.advanced?.serverUrl)) return null;

  if (!silent) {
    state.ui.updateInProgress = true;
    renderSettings();
  }

  try {
    const result = await window.checkyApi.checkForUpdates();
    state.desktopUpdate = result;
    renderSettings();
    if (!silent) {
      setStatus(result?.message || "Update check finished.");
    }
    return result;
  } catch (error) {
    if (!silent) {
      state.desktopUpdate = {
        updateAvailable: false,
        message: error?.message || "Could not check for updates."
      };
      renderSettings();
      setStatus(state.desktopUpdate.message, true);
    }
    return null;
  } finally {
    if (!silent) {
      state.ui.updateInProgress = false;
      renderSettings();
    }
  }
}

async function installAvailableDesktopUpdate() {
  if (!state.desktopUpdate?.updateAvailable || state.ui.updateInProgress) return;
  const approved = window.confirm(
    `Download Checky's List ${state.desktopUpdate.latestVersion} from Checky Base, verify it, open the Windows installer, and close this app?`
  );
  if (!approved) return;

  state.ui.updateInProgress = true;
  state.ui.updateInstalling = true;
  state.desktopUpdate.message = `Downloading Checky's List ${state.desktopUpdate.latestVersion}...`;
  renderSettings();
  try {
    const result = await window.checkyApi.installUpdate();
    state.desktopUpdate = result;
    renderSettings();
    setStatus(result?.message || "The verified update installer is opening.");
  } catch (error) {
    setStatus(error?.message || "Could not download and verify the update.", true);
    state.desktopUpdate.message = error?.message || "Could not download and verify the update.";
  } finally {
    state.ui.updateInProgress = false;
    state.ui.updateInstalling = false;
    renderSettings();
  }
}

function bindEvents() {
  const commitAdvancedInput = async (field, value) => {
    updateAdvancedSettings(field, value);
    renderSettings();
    await persistSettings();
  };

  window.checkyApi.onWindowSyncRequested(async (payload) => {
    await runSync(typeof payload?.reason === "string" && payload.reason ? payload.reason : "window");
    if (payload?.action === "show") {
      await refreshDesktopUpdate({ silent: true });
    }
  });

  els.updateAvailableBtn.onclick = async () => {
    await installAvailableDesktopUpdate();
  };

  els.settingsToggle.onclick = () => {
    if (state.ui.settingsOpen) {
      closeSettingsPanel();
      return;
    }
    openSettingsPanel();
  };
  els.settingsCloseBtn.onclick = () => {
    closeSettingsPanel();
  };
  els.doneToggle.onclick = () => {
    if (!state.settings.showDoneTab) return;
    if (state.ui.doneViewOpen) closeDoneView();
    else openDoneView();
    render();
  };
  els.quickSyncBtn.onclick = async () => {
    await runSync("manual");
  };
  els.closeWindowBtn.onclick = async () => {
    await window.checkyApi.hideWindow();
  };

  els.addTabBtn.onclick = () => {
    const insertAt = getNewTabInsertIndex();
    state.data.tabs.splice(insertAt, 0, { name: `Tab ${getVisibleTabEntries().length + 1}`, items: [] });
    state.data.tabs[insertAt].id = createEntityId("tab");
    state.data.active = insertAt;
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

  els.runOnStartup.onchange = async () => {
    state.settings.runOnStartup = els.runOnStartup.checked;
    await persistSettings();
  };
  els.alwaysOnTop.onchange = async () => {
    state.settings.alwaysOnTop = els.alwaysOnTop.checked;
    await persistSettings();
  };
  els.autoHideOnBlur.onchange = async () => {
    state.settings.autoHideOnBlur = els.autoHideOnBlur.checked;
    await persistSettings();
  };
  els.showDoneTab.onchange = async () => {
    state.settings.showDoneTab = els.showDoneTab.checked;
    ensureDoneTabState();
    if (!state.settings.showDoneTab) {
      closeDoneView();
    }
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

  els.connectSyncBtn.onclick = async () => {
    await runSync("connect");
  };
  els.disconnectSyncBtn.onclick = async () => {
    if (state.ui.syncInProgress) {
      return;
    }

    try {
      const result = await window.checkyApi.disconnectSync();
      if (result?.settings) {
        state.settings = normalizeSettings(result.settings);
      }
      if (typeof result?.syncTarget === "string") {
        state.syncTarget = result.syncTarget;
      }
      clearAvailableChecklists();
      renderSettings();
      setStatus(result?.message || "Disconnected PocketBase sync on this desktop.");
    } catch {
      setStatus("Could not disconnect PocketBase sync.", true);
    }
  };
  els.verifySyncBtn.onclick = async () => {
    if (state.ui.syncInProgress) {
      return;
    }

    const didPersistSettings = await persistSettings({ showStatus: false });
    if (!didPersistSettings) {
      setStatus("Failed to save settings.", true);
      return;
    }

    try {
      const result = await window.checkyApi.openSyncVerification();
      setStatus(result?.message || "Opened the verification window.");
    } catch {
      setStatus("Could not open the verification window.", true);
    }
  };
  els.refreshChecklistsBtn.onclick = async () => {
    await loadAvailableChecklists({ notifyOnConnectionLoss: true });
  };

  els.doneSearchInput.oninput = () => {
    state.ui.doneSearch = els.doneSearchInput.value;
    render();
  };

  els.hotkeyCaptureBtn.onclick = () => {
    state.ui.captureHotkey = !state.ui.captureHotkey;
    renderSettings();
  };

  document.addEventListener("keydown", async (e) => {
    if (e.key === "Escape" && state.ui.settingsOpen) {
      closeSettingsPanel();
      return;
    }
    if (e.key === "Escape" && state.ui.itemContextMenu) {
      closeItemContextMenu();
      return;
    }
    if (!state.ui.captureHotkey) return;
    e.preventDefault();
    const accelerator = toAcceleratorFromEvent(e);
    if (!accelerator) {
      setStatus("Use at least one modifier (Ctrl/Alt/Shift).", true);
      return;
    }
    state.ui.captureHotkey = false;
    state.settings.hotkey = accelerator;
    await persistSettings();
  });

  document.addEventListener("click", (e) => {
    if (!state.ui.itemContextMenu) return;
    if (e.target.closest("#itemContextMenu")) return;
    closeItemContextMenu();
  });

  document.addEventListener("contextmenu", (e) => {
    if (e.target.closest(".item")) return;
    closeItemContextMenu();
  });

  window.addEventListener("resize", () => {
    if (!state.ui.itemContextMenu) return;
    renderItemContextMenu();
  });

  els.syncNowBtn.onclick = async () => {
    await runSync("pull_latest");
  };

  els.restoreSyncRestorePointBtn.onclick = async () => {
    const didFlushPendingSave = await flushPendingSave();
    if (!didFlushPendingSave) {
      setStatus("Failed to save checklist.", true);
      return;
    }

    const result = await window.checkyApi.restoreSyncRestorePoint();
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

  els.backupNowBtn.onclick = async () => {
    const didFlushPendingSave = await flushPendingSave();
    if (!didFlushPendingSave) {
      setStatus("Failed to save checklist.", true);
      return;
    }
    await window.checkyApi.createBackup();
    await reloadBackups();
    setStatus("Backup created.");
  };

  els.restoreBackupBtn.onclick = async () => {
    const name = els.backupSelect.value;
    if (!name) return;
    const didFlushPendingSave = await flushPendingSave();
    if (!didFlushPendingSave) {
      setStatus("Failed to save checklist.", true);
      return;
    }
    const result = await window.checkyApi.restoreBackup(name);
    if (result.ok) {
      state.data = normalizeData(result.checklist);
      if (result.settings) {
        state.settings = normalizeSettings(result.settings);
      }
      render();
      setStatus("Backup restored, including the Done archive.");
    }
  };

  els.resetChecklistBtn.onclick = async () => {
    if (!state.ui.resetConfirmArmed) {
      state.ui.resetConfirmArmed = true;
      els.resetChecklistBtn.textContent = "Confirm reset";
      setStatus("Click again to reset checklist.");
      return;
    }
    const didFlushPendingSave = await flushPendingSave();
    if (!didFlushPendingSave) {
      state.ui.resetConfirmArmed = false;
      els.resetChecklistBtn.textContent = "Reset checklist";
      setStatus("Failed to save checklist.", true);
      return;
    }
    const checklist = await window.checkyApi.resetChecklist();
    state.data = normalizeData(checklist);
    state.ui.resetConfirmArmed = false;
    els.resetChecklistBtn.textContent = "Reset checklist";
    render();
    setStatus("Checklist reset.");
  };

  els.instructionsBtn.onclick = async () => {
    const result = await window.checkyApi.openInstructions();
    if (!result.ok) {
      setStatus("Could not open instructions.", true);
      return;
    }
    setStatus("Instructions opened.");
  };

  els.checkForUpdatesBtn.onclick = async () => {
    const didPersistSettings = await persistSettings({ showStatus: false });
    if (!didPersistSettings) {
      setStatus("Failed to save settings before checking for updates.", true);
      return;
    }
    await refreshDesktopUpdate({ silent: false });
  };

  els.downloadUpdateBtn.onclick = async () => {
    await installAvailableDesktopUpdate();
  };
}

async function init() {
  bindEvents();
  const loaded = await window.checkyApi.loadState();
  state.data = normalizeData(loaded.checklist);
  state.appVersion = typeof loaded.appVersion === "string" ? loaded.appVersion : "";
  state.settings = normalizeSettings(loaded.settings);
  state.dataLocation = loaded.dataLocation || "";
  state.syncTarget = typeof loaded.syncTarget === "string" ? loaded.syncTarget : "";
  state.syncRestorePoint = normalizeSyncRestorePointInfo(loaded.syncRestorePoint);
  render();
  await reloadBackups();
  await runSync("startup");
  void refreshDesktopUpdate({ silent: true });
}

init();






window.checkyApi.onVerificationCodeRequested(async ({id, email}) => {
  const code = await window.requestCheckyVerificationCode(email);
  await window.checkyApi.submitVerificationCode(id, code);
});
