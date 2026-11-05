const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("checkyApi", {
  onVerificationCodeRequested: (callback) => {
    if (typeof callback === 'function') ipcRenderer.on('auth:code-requested', (_event, request) => callback(request));
  },
  submitVerificationCode: (id, code) => ipcRenderer.invoke('auth:submit-code', id, code),
  onReminderResetTimes: callback => {
    if (typeof callback === 'function') ipcRenderer.on('reminder:reset-times', (_event, data) => callback(data));
  },
  loadState: () => ipcRenderer.invoke("state:load"),
  saveChecklist: (checklist) => ipcRenderer.invoke("checklist:save", checklist),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  listBackups: () => ipcRenderer.invoke("backups:list"),
  createBackup: () => ipcRenderer.invoke("backups:create"),
  restoreBackup: (name) => ipcRenderer.invoke("backups:restore", name),
  resetChecklist: () => ipcRenderer.invoke("checklist:reset"),
  syncNow: (checklist, options = {}) => ipcRenderer.invoke("sync:now", checklist, options),
  getSyncSessionStatus: () => ipcRenderer.invoke("sync:session-status"),
  resetSyncSession: () => ipcRenderer.invoke("sync:reset-session"),
  disconnectSync: () => ipcRenderer.invoke("sync:disconnect"),
  listAccessibleChecklists: () => ipcRenderer.invoke("sync:list-checklists"),
  useAccessibleChecklist: (checklistId, checklist) => ipcRenderer.invoke("sync:use-checklist", checklistId, checklist),
  openSyncVerification: () => ipcRenderer.invoke("sync:open-verification"),
  restoreSyncRestorePoint: () => ipcRenderer.invoke("sync:restore-point:restore"),
  hideWindow: () => ipcRenderer.invoke("window:hide"),
  onWindowSyncRequested: (callback) => {
    if (typeof callback !== "function") {
      return;
    }
    ipcRenderer.on("window:sync-requested", (_event, payload) => {
      callback(payload);
    });
  },
  openInstructions: () => ipcRenderer.invoke("instructions:open"),
  checkForUpdates: () => ipcRenderer.invoke("updates:check"),
  installUpdate: () => ipcRenderer.invoke("updates:install")
});
