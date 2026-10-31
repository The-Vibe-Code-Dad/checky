(function () {
  // Legacy key names are intentionally retained so existing hosted browser data is not lost.
  const SETTINGS_KEY = "checky.android.settings";
  const SYNC_PASSWORD_FALLBACK_KEY = "checky.android.syncPassword";
  const SYNC_TOKEN_FALLBACK_KEY = "checky.android.syncToken";
  const SYNC_META_KEY = "checky.android.syncMeta";
  const LAST_CHECKLIST_SELECTIONS_KEY = "checky.base.lastChecklistSelections";
  const SHELL_READY_CLASS = "checkys-base-shell-ready";
  let hostedSetupRequired = false;
  let hostedSetupResolved = false;

  function isHostedRuntime() {
    return !window.Capacitor && window.location?.protocol !== "file:";
  }

  if (!isHostedRuntime()) {
    return;
  }

  function getHostedServerUrl() {
    return window.location.origin.replace(/\/+$/, "");
  }

  function normalizeOrigin(value) {
    return (typeof value === "string" ? value.trim() : "").replace(/\/+$/, "");
  }

  function isLocalHostedRuntime() {
    const host = (window.location.hostname || "").toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
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

  function syncHostedServerUrlSetting() {
    const hostedServerUrl = getHostedServerUrl();
    const current = readJson(SETTINGS_KEY, {});
    const advanced = current && typeof current.advanced === "object" ? current.advanced : {};
    const currentServerUrl = normalizeOrigin(advanced.serverUrl);

    if (currentServerUrl === hostedServerUrl && !advanced.password) {
      return;
    }

    writeJson(SETTINGS_KEY, {
      ...current,
      advanced: {
        ...advanced,
        serverUrl: hostedServerUrl,
        password: ""
      }
    });
  }

  function readResponsePayload(response) {
    return response.text().then((text) => {
      if (!text) {
        return null;
      }

      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    });
  }

  function getErrorMessage(payload, fallback) {
    if (payload && typeof payload === "object" && typeof payload.message === "string" && payload.message) {
      return payload.message;
    }
    if (typeof payload === "string" && payload) {
      return payload;
    }
    return fallback;
  }

  async function postJson(path, body) {
    const response = await fetch(new URL(path, `${getHostedServerUrl()}/`).toString(), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      credentials: "same-origin"
    });

    const payload = await readResponsePayload(response);
    return { response, payload };
  }

  async function getJson(path) {
    const response = await fetch(new URL(path, `${getHostedServerUrl()}/`).toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-store"
      },
      cache: "no-store",
      credentials: "same-origin"
    });

    const payload = await readResponsePayload(response);
    return { response, payload };
  }

  function persistHostedCredentials(email) {
    const current = readJson(SETTINGS_KEY, {});
    writeJson(SETTINGS_KEY, {
      showDoneTab: !!current?.showDoneTab,
      advanced: {
        serverUrl: getHostedServerUrl(),
        email: email.trim(),
        password: ""
      }
    });
  }

  function clearHostedAuth() {
    const syncMeta = readJson(SYNC_META_KEY, {});
    const userId = typeof syncMeta?.userId === "string" ? syncMeta.userId.trim() : "";
    const checklistId = typeof syncMeta?.recordId === "string" ? syncMeta.recordId.trim() : "";
    if (userId && checklistId) {
      const selections = readJson(LAST_CHECKLIST_SELECTIONS_KEY, {});
      writeJson(LAST_CHECKLIST_SELECTIONS_KEY, {
        ...(selections && typeof selections === "object" && !Array.isArray(selections) ? selections : {}),
        [userId]: checklistId
      });
    }

    localStorage.removeItem(SYNC_PASSWORD_FALLBACK_KEY);
    localStorage.removeItem(SYNC_TOKEN_FALLBACK_KEY);
    localStorage.removeItem(SYNC_META_KEY);

    const current = readJson(SETTINGS_KEY, {});
    const advanced = current && typeof current.advanced === "object" ? current.advanced : {};
    writeJson(SETTINGS_KEY, {
      ...current,
      advanced: {
        ...advanced,
        serverUrl: getHostedServerUrl(),
        password: ""
      }
    });
  }

  function getLoginElements() {
    return {
      overlay: document.getElementById("loginOverlay"),
      card: document.querySelector(".login-card"),
      eyebrow: document.querySelector(".login-eyebrow"),
      title: document.querySelector(".login-title"),
      copy: document.querySelector(".login-copy"),
      submitBtn: document.getElementById("loginSubmitBtn"),
      actions: document.querySelector("#loginOverlay .inline"),
      emailInput: document.getElementById("loginEmailInput"),
      passwordInput: document.getElementById("loginPasswordInput"),
      status: document.getElementById("loginStatus")
    };
  }

  function getSettingsElements() {
    return {
      settingsPanel: document.getElementById("settingsPanel"),
      settingsStatus: document.getElementById("settingsStatus"),
      advancedPanel: document.getElementById("advancedSettingsPanel"),
      advancedSummary: document.getElementById("advancedSummary"),
      syncEmailInput: document.getElementById("syncEmailInput"),
      syncPasswordInput: document.getElementById("syncPasswordInput"),
      serverUrlInput: document.getElementById("serverUrlInput")
    };
  }

  function openHostedLoginOverlay() {
    const { overlay } = getLoginElements();
    if (overlay) {
      overlay.classList.remove("hidden");
      overlay.setAttribute("aria-hidden", "false");
    }
    document.body.classList.add("login-open");
  }

  function closeHostedLoginOverlay() {
    const { overlay } = getLoginElements();
    if (overlay) {
      overlay.classList.add("hidden");
      overlay.setAttribute("aria-hidden", "true");
    }
    document.body.classList.remove("login-open");
  }

  function showHostedBootOverlay() {
    const { card, eyebrow, title, copy, status } = getLoginElements();
    openHostedLoginOverlay();
    if (card) {
      card.dataset.mode = "loading";
    }
    if (eyebrow) {
      eyebrow.textContent = "Hosted Checky's List";
    }
    if (title) {
      title.textContent = "Checking session";
    }
    if (copy) {
      copy.textContent = "Checking your hosted session...";
    }
    if (status) {
      status.textContent = "";
    }
  }

  function markHostedShellReady() {
    document.documentElement.classList.add(SHELL_READY_CLASS);
  }

  function setStatus(message, isError) {
    const { status } = getLoginElements();
    if (!status) {
      return;
    }

    status.textContent = typeof message === "string" ? message : "";
    status.style.color = isError ? "#ffb0b0" : "#b7b7b7";
  }

  function setBusy(isBusy, label) {
    const { submitBtn } = getLoginElements();
    if (!submitBtn) {
      return;
    }

    submitBtn.disabled = !!isBusy;
    submitBtn.textContent = label;
  }

  function ensureHostedLoginNotice() {
    const { card, copy } = getLoginElements();
    if (!card || !copy) {
      return null;
    }

    let notice = document.getElementById("checkysBaseLoginNotice");
    if (notice) {
      return notice;
    }

    notice = document.createElement("div");
    notice.id = "checkysBaseLoginNotice";
    notice.className = "checkys-base-login-notice hidden";
    copy.insertAdjacentElement("afterend", notice);
    return notice;
  }

  function ensureHostedLoginAdminButton() {
    let button = document.getElementById("checkysBaseLoginAdminBtn");
    if (button) {
      button.remove();
    }

    return null;
  }

  function setHostedLoginTitle(title, setupMode) {
    if (!title) {
      return;
    }

    title.replaceChildren();

    if (setupMode) {
      title.textContent = "Create the first Checky's List user";
      return;
    }
    title.textContent = "Sign in";
  }

  function applyHostedLoginUi() {
    const { card, eyebrow, title, copy, submitBtn } = getLoginElements();
    const setupMode = hostedSetupResolved && hostedSetupRequired;
    const notice = ensureHostedLoginNotice();
    const adminButton = ensureHostedLoginAdminButton();

    if (card) {
      card.dataset.mode = setupMode ? "setup" : "signin";
    }
    if (eyebrow) {
      eyebrow.textContent = setupMode ? "" : "Hosted Checky's List";
    }

    setHostedLoginTitle(title, setupMode);
    if (copy) {
      copy.textContent = setupMode
        ? "No admin detected. Set your account as the admin to continue."
        : "Use the email and password assigned to your Checky's List account to open the checklist data you can access.";
    }
    if (notice) {
      notice.classList.add("hidden");
      notice.textContent = "";
    }
    if (submitBtn && !submitBtn.disabled) {
      submitBtn.textContent = setupMode ? "Create" : "Sign in";
    }
    if (adminButton) {
      const showAdminButton = setupMode && isLocalHostedRuntime();
      adminButton.classList.toggle("hidden", !showAdminButton);
    }
  }

  function ensurePocketBaseAdminButton() {
    const existing = document.getElementById("checkysBasePocketBaseAdminRow");
    if (existing) {
      existing.remove();
    }
  }

  function ensureHostedSettingsUi() {
    const {
      advancedPanel,
      advancedSummary,
      syncEmailInput,
      syncPasswordInput,
      serverUrlInput
    } = getSettingsElements();

    const hint = advancedPanel?.querySelector(".hint");
    if (hint) {
      hint.textContent = "Hosted sign-in uses a base-managed session cookie. Passwords and auth tokens are not stored in this browser.";
    }

    if (serverUrlInput) {
      serverUrlInput.value = getHostedServerUrl();
      serverUrlInput.readOnly = true;
    }

    if (syncEmailInput) {
      syncEmailInput.readOnly = true;
    }

    if (advancedSummary) {
      const email = syncEmailInput?.value?.trim() || "";
      advancedSummary.textContent = email ? `${email} @ ${getHostedServerUrl()}` : getHostedServerUrl();
    }

    const passwordRow = syncPasswordInput?.closest(".setting-row");
    if (passwordRow) {
      passwordRow.classList.add("hidden");
    }
  }

  function ensureHostedLogoutButton() {
    const { settingsPanel } = getSettingsElements();
    if (!settingsPanel) {
      return null;
    }

    let row = document.getElementById("checkysBaseHostedLogoutRow");
    if (row) {
      return row.querySelector("button");
    }

    row = document.createElement("div");
    row.className = "setting-row";
    row.id = "checkysBaseHostedLogoutRow";

    const button = document.createElement("button");
    button.type = "button";
    button.id = "checkysBaseHostedLogoutBtn";
    button.className = "btn btn-ghost";
    button.textContent = "Sign out";

    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = "Ends the hosted browser session for this Checky's List user.";

    row.appendChild(button);
    row.appendChild(hint);
    settingsPanel.insertBefore(row, document.getElementById("settingsStatus"));
    return button;
  }

  async function signIn(email, password) {
    const authenticated = await window.checkyAuth.authenticate(async (path, body) => {
      const result = await postJson(path, body);
      if (!result.response.ok) {
        const error = new Error(getErrorMessage(result.payload, 'Could not sign in.'));
        error.payload = result.payload;
        throw error;
      }
      return result.payload;
    }, email, password, window.requestCheckyVerificationCode);
    const authResult = await postJson('/api/checkys-base/session/login', { token: authenticated.token });

    if (!authResult.response.ok || authResult.payload?.ok === false) {
      throw new Error(getErrorMessage(authResult.payload, "Incorrect email or password."));
    }

    return authResult.payload;
  }

  async function createFirstUser(email, password) {
    const createResult = await postJson("/api/checkys-base/first-user", {
      email,
      password,
      passwordConfirm: password
    });

    if (!createResult.response.ok || createResult.payload?.ok === false) {
      throw new Error(getErrorMessage(createResult.payload, "Could not create the first user."));
    }

    await signIn(email, password);
    return createResult.payload;
  }

  async function loadHostedSessionSnapshot() {
    const result = await getJson("/api/checkys-base/session");
    const payload = result.payload && typeof result.payload === "object" ? result.payload : null;

    if (payload && typeof payload.setupRequired === "boolean") {
      hostedSetupRequired = payload.setupRequired;
      hostedSetupResolved = true;
    } else {
      hostedSetupRequired = false;
      hostedSetupResolved = false;
    }

    return {
      response: result.response,
      payload,
      authenticated: !!(result.response.ok && payload?.authenticated === true && payload?.user?.id)
    };
  }

  async function refreshHostedSetupState() {
    try {
      const result = await loadHostedSessionSnapshot();
      return result.payload?.setupRequired === true;
    } catch {}

    hostedSetupRequired = false;
    hostedSetupResolved = false;
    return hostedSetupRequired;
  }

  async function confirmHostedSession() {
    const result = await loadHostedSessionSnapshot();
    if (!result.authenticated) {
      throw new Error("Sign-in succeeded, but the hosted session could not be confirmed.");
    }

    return result.payload || null;
  }

  async function submitHostedSignIn(event) {
    if (event) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    const { emailInput, passwordInput } = getLoginElements();
    const email = (emailInput?.value || "").trim();
    const password = passwordInput?.value || "";

    if (!email || !password) {
      setStatus("Enter your email and password to sign in.", true);
      applyHostedLoginUi();
      return;
    }

    const setupMode = hostedSetupResolved && hostedSetupRequired;
    setBusy(true, setupMode ? "Creating user..." : "Signing in...");
    setStatus(setupMode ? "Creating the first user..." : "Signing you in...", false);
    persistHostedCredentials(email);
    clearHostedAuth();

    try {
      if (setupMode) {
        await createFirstUser(email, password);
      } else {
        await signIn(email, password);
      }
      await confirmHostedSession();
      setStatus("Opening Checky's List...", false);
      window.location.reload();
    } catch (error) {
      clearHostedAuth();
      await refreshHostedSetupState();
      setBusy(false, hostedSetupResolved && hostedSetupRequired ? "Create" : "Sign in");
      setStatus(error?.message || (hostedSetupResolved && hostedSetupRequired ? "Could not create the first user." : "Could not sign in."), true);
      applyHostedLoginUi();
    }
  }

  function bindHostedLoginHandlers() {
    const { submitBtn, emailInput, passwordInput } = getLoginElements();
    if (submitBtn && !submitBtn.dataset.checkysBaseBound) {
      submitBtn.dataset.checkysBaseBound = "true";
      submitBtn.addEventListener("click", submitHostedSignIn, true);
    }

    const bindEnter = (input) => {
      if (!input || input.dataset.checkysBaseBound) {
        return;
      }

      input.dataset.checkysBaseBound = "true";
      input.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") {
          return;
        }

        submitHostedSignIn(event);
      }, true);
    };

    bindEnter(emailInput);
    bindEnter(passwordInput);
  }

  function bindPocketBaseAdminButton() {
    const bind = (buttonId) => {
      const button = document.getElementById(buttonId);
      if (!button || button.dataset.checkysBaseBound) {
        return;
      }

      button.dataset.checkysBaseBound = "true";
      button.addEventListener("click", () => {
        window.location.href = "http://localhost:8090/_/";
      });
    };

    bind("checkysBasePocketBaseAdminBtn");
    bind("checkysBaseLoginAdminBtn");
  }

  async function signOutHostedSession() {
    const result = await postJson("/api/checkys-base/session/logout", {});
    if (!result.response.ok) {
      throw new Error(getErrorMessage(result.payload, "Could not sign out right now."));
    }

    clearHostedAuth();
    window.location.reload();
  }

  function bindHostedLogoutButton() {
    const button = ensureHostedLogoutButton();
    if (!button || button.dataset.checkysBaseBound) {
      return;
    }

    button.dataset.checkysBaseBound = "true";
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await signOutHostedSession();
      } catch (error) {
        button.disabled = false;
        const { settingsStatus } = getSettingsElements();
        if (settingsStatus) {
          settingsStatus.textContent = error?.message || "Could not sign out right now.";
          settingsStatus.style.color = "#ff9494";
        }
      }
    });
  }

  syncHostedServerUrlSetting();
  showHostedBootOverlay();

  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) {
      return;
    }

    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      applyHostedLoginUi();
      bindHostedLoginHandlers();
      ensurePocketBaseAdminButton();
      ensureHostedSettingsUi();
      ensureHostedLogoutButton();
      bindHostedLogoutButton();
      bindPocketBaseAdminButton();
    });
  });

  let initialHostedSessionAuthenticated = false;
  loadHostedSessionSnapshot()
    .then((result) => {
      initialHostedSessionAuthenticated = result.authenticated;
    })
    .catch(() => {
      hostedSetupRequired = false;
      hostedSetupResolved = false;
      initialHostedSessionAuthenticated = false;
    })
    .finally(() => {
      applyHostedLoginUi();
      bindHostedLoginHandlers();
      ensurePocketBaseAdminButton();
      ensureHostedSettingsUi();
      ensureHostedLogoutButton();
      bindHostedLogoutButton();
      bindPocketBaseAdminButton();

      if (initialHostedSessionAuthenticated) {
        closeHostedLoginOverlay();
      } else {
        openHostedLoginOverlay();
      }

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
      });

      markHostedShellReady();
    });
})();



