'use strict';

(() => {
  const api = window.api;

  /* ------------------------------------------------------------------ *
   * Helpers
   * ------------------------------------------------------------------ */

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char]);

  const icon = (name, className = 'icon') =>
    `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-${name}"></use></svg>`;

  const uid = () =>
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const lineCount = (code) => (code ? code.split('\n').length : 1);

  const truncate = (value, limit) => {
    const text = String(value ?? '');
    return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
  };

  const pad2 = (value) => String(value).padStart(2, '0');

  function formatClock(timestamp) {
    const date = new Date(timestamp || Date.now());
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
  }

  function timeAgo(timestamp) {
    const seconds = Math.max(0, Math.round((Date.now() - Number(timestamp || 0)) / 1000));
    if (seconds < 45) return 'just now';
    if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.round(seconds / 86400)}d ago`;
    return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function formatCount(value) {
    const count = Number(value) || 0;
    if (count >= 1000000) {
      return `${(count / 1000000).toFixed(count >= 10000000 ? 0 : 1).replace(/\.0$/, '')}M`;
    }
    if (count >= 1000) {
      return `${(count / 1000).toFixed(count >= 10000 ? 0 : 1).replace(/\.0$/, '')}k`;
    }
    return String(count);
  }

  function initials(name, fallback = '?') {
    const parts = String(name || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) return fallback;
    return parts
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase();
  }

  function avatarTone(key) {
    let hash = 0;
    const text = String(key || '');
    for (let index = 0; index < text.length; index += 1) {
      hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
    }
    return `tone-${hash % 6}`;
  }

  const FALLBACK_CONFIG = {
    theme: 'graphite',
    displayName: '',
    accent: '#ffffff',
    glow: true,
    motion: true,
    compact: false,
    restoreTabs: true,
    confirmDelete: true,
    editor: {
      fontSize: 13,
      tabSize: 2,
      wrap: false,
      lineNumbers: true,
      highlightLine: true,
      autoIndent: true,
    },
    bridge: { port: 7963, enabled: true },
  };

  const THEMES = [
    { id: 'graphite', name: 'Graphite', accent: '#ffffff', bg: '#0a0b0d', panel: '#121417', elev: '#1a1d21' },
    { id: 'midnight', name: 'Midnight', accent: '#6ea8ff', bg: '#080d1a', panel: '#0e1524', elev: '#172133' },
    { id: 'forest', name: 'Forest', accent: '#57cf9a', bg: '#090f0c', panel: '#101813', elev: '#18231b' },
    { id: 'ember', name: 'Ember', accent: '#f0a061', bg: '#100c09', panel: '#1a1410', elev: '#241c16' },
    { id: 'plum', name: 'Plum', accent: '#e07ba8', bg: '#0f0a10', panel: '#18101a', elev: '#221724' },
    { id: 'paper', name: 'Paper', accent: '#4f63e8', bg: '#f2f3f6', panel: '#ffffff', elev: '#e8eaf0' },
  ];

  const ACCENTS = [
    '#ffffff', '#6ea8ff', '#57cf9a', '#67d4d4', '#f0a061',
    '#e07ba8', '#b18cff', '#f2c94c', '#e06c6c', '#a8b0bd',
  ];

  const CATEGORY_META = {
    utility: { label: 'Utility', icon: 'sliders' },
    performance: { label: 'Performance', icon: 'zap' },
    server: { label: 'Server', icon: 'server' },
    character: { label: 'Character', icon: 'user' },
    visual: { label: 'Visual', icon: 'palette' },
  };

  const HUB_PROVIDERS = {
    scriptblox: { label: 'ScriptBlox' },
    robloxscripts: { label: 'RobloxScripts' },
  };

  const HUB_SOURCES = [
    { id: 'all', label: 'All sources' },
    { id: 'builtin', label: 'Built-in' },
    { id: 'scriptblox', label: 'ScriptBlox' },
    { id: 'robloxscripts', label: 'RobloxScripts' },
  ];

  const hubItemSource = (script) => script.source || script.provider || 'builtin';

  const BRIDGE_TEST_SCRIPT = [
    'local player = game:GetService("Players").LocalPlayer',
    'print("[Aether] bridge test", game.Name, player and player.Name or "no local player")',
  ].join('\n');

  const SETTINGS_META = {
    general: { title: 'General', sub: 'Your profile and workspace behaviour.' },
    appearance: { title: 'Appearance', sub: 'Themes, accent colour, and interface density.' },
    editor: { title: 'Editor', sub: 'Typography, indentation, and the code surface.' },
    connection: { title: 'Connection', sub: 'The bridge server and the loader your executor runs.' },
    about: { title: 'About', sub: 'Build details and keyboard shortcuts.' },
  };

  const PLATFORM_LABELS = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };

  const DEFAULT_DOC = () => ({
    id: uid(),
    name: 'Untitled',
    code: '',
    dirty: false,
    originId: null,
  });

  const createHubProviderState = () => ({
    scriptblox: { items: [], page: 1, hasMore: true, loaded: false, query: '', error: '' },
    robloxscripts: { items: [], page: 1, hasMore: true, loaded: false, query: '', error: '' },
  });

  /* ------------------------------------------------------------------ *
   * DOM + state
   * ------------------------------------------------------------------ */

  const el = {
    root: document.documentElement,
    brandVersion: $('#brandVersion'),
    nav: $('#nav'),
    pages: $$('.page'),

    winMin: $('#winMin'),
    winMax: $('#winMax'),
    winMaxIcon: $('#winMaxIcon'),
    winClose: $('#winClose'),

    bridgePill: $('#bridgePill'),
    bridgeDot: $('#bridgeDot'),
    bridgeLabel: $('#bridgeLabel'),
    accountBtn: $('#accountBtn'),
    accountAvatar: $('#accountAvatar'),
    accountName: $('#accountName'),

    homeDate: $('#homeDate'),
    greeting: $('#greeting'),
    userNameInline: $('#userNameInline'),
    homeDot: $('#homeDot'),
    homeBridgeLabel: $('#homeBridgeLabel'),
    homeCopyLoader: $('#homeCopyLoader'),
    homeClients: $('#homeClients'),
    homeRuns: $('#homeRuns'),
    homePort: $('#homePort'),
    homeConnect: $('#homeConnect'),
    homeRecent: $('#homeRecent'),
    homePicks: $('#homePicks'),
    homeClientCount: $('#homeClientCount'),
    homeClientsList: $('#homeClientsList'),
    homeActivity: $('#homeActivity'),

    explorerNew: $('#explorerNew'),
    explorerFilter: $('#explorerFilter'),
    explorerTree: $('#explorerTree'),
    explorerCount: $('#explorerCount'),
    explorerOpen: $('#explorerOpen'),
    fileInput: $('#fileInput'),

    docTabs: $('#docTabs'),
    targetChip: $('#targetChip'),
    targetDot: $('#targetDot'),
    targetLabel: $('#targetLabel'),
    saveDoc: $('#saveDoc'),
    runBtn: $('#runBtn'),

    editorPanel: $('#editorPanel'),
    editorStage: $('#editorStage'),
    gutter: $('#gutter'),
    currentLine: $('#currentLine'),
    highlight: $('#highlight'),
    code: $('#code'),
    cursorInfo: $('#cursorInfo'),
    dirtyState: $('#dirtyState'),
    sbBridge: $('#sbBridge'),
    toggleConsole: $('#toggleConsole'),

    consolePanel: $('#consolePanel'),
    consoleBody: $('#consoleBody'),
    consoleEmpty: $('#consoleEmpty'),
    logCount: $('#logCount'),
    logFilters: $('#logFilters'),
    clearLogs: $('#clearLogs'),

    scriptsTabs: $('#scriptsTabs'),
    hubView: $('#hubView'),
    libraryView: $('#libraryView'),
    hubSearch: $('#hubSearch'),
    hubSources: $('#hubSources'),
    hubCategories: $('#hubCategories'),
    hubFeedStatus: $('#hubFeedStatus'),
    hubGrid: $('#hubGrid'),
    librarySearch: $('#librarySearch'),
    libraryNew: $('#libraryNew'),
    libraryGrid: $('#libraryGrid'),
    libraryBadge: $('#libraryBadge'),

    settingsNav: $('#settingsNav'),
    settingsTitle: $('#settingsTitle'),
    settingsSub: $('#settingsSub'),
    settingsScroll: $('#settingsScroll'),
    settingsUserFoot: $('#settingsUserFoot'),
    profileAvatar: $('#profileAvatar'),
    profileName: $('#profileName'),
    profileMeta: $('#profileMeta'),
    profileNameInput: $('#profileNameInput'),
    saveProfileName: $('#saveProfileName'),
    themeGrid: $('#themeGrid'),
    accentRow: $('#accentRow'),
    fontSize: $('#fontSize'),
    fontSizeVal: $('#fontSizeVal'),
    tabSize: $('#tabSize'),
    bridgeBadge: $('#bridgeBadge'),
    settingsDot: $('#settingsDot'),
    settingsBridgeText: $('#settingsBridgeText'),
    bridgePort: $('#bridgePort'),
    bridgeEnabled: $('#bridgeEnabled'),
    applyBridge: $('#applyBridge'),
    restartBridge: $('#restartBridge'),
    bridgeApplyResult: $('#bridgeApplyResult'),
    copyLoader: $('#copyLoader'),
    clientManageList: $('#clientManageList'),
    disconnectAllClients: $('#disconnectAllClients'),
    loaderPreview: $('#loaderPreview'),
    loaderVersion: $('#loaderVersion'),
    aboutVersion: $('#aboutVersion'),
    aboutElectron: $('#aboutElectron'),
    aboutChrome: $('#aboutChrome'),
    aboutPlatform: $('#aboutPlatform'),
    openData: $('#openData'),
    resetSettings: $('#resetSettings'),
    checkUpdates: $('#checkUpdates'),
    updateAction: $('#updateAction'),
    viewRelease: $('#viewRelease'),
    updateStatus: $('#updateStatus'),

    clientsPopover: $('#clientsPopover'),
    popoverSub: $('#popoverSub'),
    popoverClients: $('#popoverClients'),
    popoverClose: $('#popoverClose'),
    selectAllClients: $('#selectAllClients'),
    testClients: $('#testClients'),
    connectionSettings: $('#connectionSettings'),

    modalRoot: $('#modalRoot'),
    toastHost: $('#toastHost'),
  };

  const state = {
    user: { username: 'user', hostname: '', platform: 'win32' },
    app: {},
    config: { ...FALLBACK_CONFIG },
    scripts: [],
    docs: [],
    active: 0,
    editor: null,
    clients: [],
    targets: new Set(),
    targetAll: true,
    logs: [],
    logFilter: 'all',
    runs: 0,
    activity: [],
    bridge: { running: false, port: 7963, enabled: true, error: '', loader: '', clients: [] },
    page: 'home',
    settingsSection: 'general',
    hubSource: 'all',
    hubCategory: 'all',
    hubQuery: '',
    homePicks: [],
    homePicksLoading: false,
    hubProviders: createHubProviderState(),
    hubLoading: false,
    hubNotice: '',
    hubRequest: 0,
    hubTimer: null,
    libraryQuery: '',
    scriptsView: 'hub',
    update: null,
    promptedVersion: '',
    sessionTimer: null,
    configTimer: null,
    portTimer: null,
    lastBridgeError: '',
  };

  const currentDoc = () => state.docs[state.active] || null;

  /* ------------------------------------------------------------------ *
   * Theme and configuration
   * ------------------------------------------------------------------ */

  function setAccent(hex) {
    const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!match) return;
    const value = parseInt(match[1], 16);
    const red = (value >> 16) & 255;
    const green = (value >> 8) & 255;
    const blue = value & 255;
    const luma = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;

    el.root.style.setProperty('--accent', `#${match[1].toLowerCase()}`);
    el.root.style.setProperty('--accent-rgb', `${red}, ${green}, ${blue}`);
    el.root.style.setProperty('--accent-contrast', luma > 0.62 ? '#0a0b0d' : '#ffffff');
  }

  function applyConfig() {
    const config = state.config;
    el.root.dataset.theme = config.theme;
    el.root.dataset.glow = config.glow ? 'on' : 'off';
    el.root.dataset.motion = config.motion ? 'on' : 'off';
    el.root.dataset.density = config.compact ? 'compact' : 'comfortable';
    el.root.style.setProperty('--code-size', `${config.editor.fontSize}px`);
    setAccent(config.accent);
    if (state.editor) state.editor.setOptions(config.editor);
  }

  function persistConfig() {
    clearTimeout(state.configTimer);
    state.configTimer = setTimeout(() => {
      api.setConfig(state.config).catch(() => {});
    }, 260);
  }

  function setSwitch(button, active) {
    if (!button) return;
    button.setAttribute('aria-checked', active ? 'true' : 'false');
    button.classList.toggle('on', Boolean(active));
  }

  /* ------------------------------------------------------------------ *
   * Boot
   * ------------------------------------------------------------------ */

  async function init() {
    const [config, user, appInfo, session, bridge, scripts] = await Promise.all([
      api.getConfig().catch(() => FALLBACK_CONFIG),
      api.getUser().catch(() => ({
        username: 'user',
        hostname: '',
        platform: 'win32',
      })),
      api.getAppInfo().catch(() => ({})),
      api.getSession().catch(() => null),
      api.getBridge().catch(() => ({
        running: false,
        port: 7963,
        enabled: true,
        error: '',
        loader: '',
        clients: [],
      })),
      api.getScripts().catch(() => []),
    ]);

    state.config = { ...FALLBACK_CONFIG, ...(config || {}) };
    state.config.editor = { ...FALLBACK_CONFIG.editor, ...(config?.editor || {}) };
    state.config.bridge = { ...FALLBACK_CONFIG.bridge, ...(config?.bridge || {}) };
    state.user = user;
    state.app = appInfo;
    state.scripts = Array.isArray(scripts) ? scripts : [];
    state.bridge = {
      ...state.bridge,
      ...(bridge || {}),
      clients: bridge?.clients || [],
    };
    state.clients = state.bridge.clients;

    if (state.config.restoreTabs && session?.docs?.length) {
      state.docs = session.docs.map((doc) => ({
        id: doc.id || uid(),
        name: doc.name || 'Untitled',
        code: doc.code || '',
        dirty: Boolean(doc.dirty),
        originId: doc.originId || null,
      }));
      state.active = clamp(Number(session.active) || 0, 0, state.docs.length - 1);
    } else {
      state.docs = [DEFAULT_DOC()];
      state.active = 0;
    }

    state.editor = new LuaEditor(
      {
        textarea: el.code,
        highlight: el.highlight,
        gutter: el.gutter,
        currentLine: el.currentLine,
        stage: el.editorStage,
        cursorInfo: el.cursorInfo,
        dirtyState: el.dirtyState,
      },
      {
        onChange: handleEditorChange,
        onSave: saveCurrent,
        onRun: runCurrent,
      },
      state.config.editor,
    );

    bindUI();
    applyConfig();
    renderIdentity();
    renderAll();
    loadHomePicks();
    setSettingsSection(state.settingsSection);

    el.brandVersion.textContent = state.app.version || '—';
    el.aboutVersion.textContent = state.app.version || '—';
    el.aboutElectron.textContent = state.app.electron || '—';
    el.aboutChrome.textContent = state.app.chrome || '—';
    el.aboutPlatform.textContent = `${PLATFORM_LABELS[state.app.platform] || state.app.platform || 'Unknown'} · ${
      state.app.arch || '—'
    }`;

    el.bridgePort.value = state.config.bridge.port;
    el.loaderPreview.textContent = state.bridge.loader || 'Loading…';
    setSwitch(el.bridgeEnabled, state.config.bridge.enabled);

    loadDocIntoEditor();
    pushActivity('clock', 'Workspace loaded');

    if (state.bridge.error) {
      state.lastBridgeError = state.bridge.error;
      toast(state.bridge.error, 'error');
    }

    checkForUpdates(false);


    subscribeToBridge();
    const freshBridge = await api.getBridge().catch(() => null);
    if (freshBridge) {
      setBridgeState(freshBridge);
      setClients(freshBridge.clients || []);
    }
    setInterval(renderHome, 60_000);
  }

  /* ------------------------------------------------------------------ *
   * Identity and navigation
   * ------------------------------------------------------------------ */

  function renderIdentity() {
    const username = state.user.username || 'user';
    const initial = initials(username, 'A').slice(0, 1) || 'A';

    el.accountAvatar.textContent = initial;
    el.accountName.textContent = username;
    el.accountBtn.title = `Signed in as ${username}${
      state.user.hostname ? ` on ${state.user.hostname}` : ''
    }`;
    el.userNameInline.textContent = username;

    el.profileAvatar.textContent = initial;
    el.profileName.textContent = username;
    el.profileMeta.textContent = `${state.user.hostname || 'This machine'} · ${
      PLATFORM_LABELS[state.user.platform] || 'Local'
    } account`;
    el.settingsUserFoot.textContent = `${username} · local account`;
  }

  const navUnderline = document.createElement('span');
  navUnderline.className = 'nav-underline';
  navUnderline.setAttribute('aria-hidden', 'true');
  el.nav.append(navUnderline);

  function positionNavUnderline(animate) {
    const tab = el.nav.querySelector('button.active');
    if (!tab) return;
    // Match the original 27% inset on either side of each tab.
    const width = tab.offsetWidth;
    navUnderline.classList.toggle('moving', animate);
    navUnderline.style.top = (tab.offsetTop + tab.offsetHeight - 4) + 'px';
    navUnderline.style.width = (width * 0.46) + 'px';
    navUnderline.style.transform = `translateX(${tab.offsetLeft + width * 0.27}px)`;
  }

  const navResize = new ResizeObserver(() => positionNavUnderline(false));
  navResize.observe(el.nav);
  for (const tab of el.nav.querySelectorAll('button')) navResize.observe(tab);
  positionNavUnderline(false);

  function go(page) {
    if (!['home', 'editor', 'scripts', 'settings'].includes(page)) return;

    state.page = page;
    $$('#nav button').forEach((button) => {
      button.classList.toggle('active', button.dataset.page === page);
    });
    positionNavUnderline(true);
    el.pages.forEach((section) => {
      section.classList.toggle('active', section.dataset.page === page);
    });

    if (page === 'home') renderHome();
    if (page === 'scripts') {
      renderHub();
      renderLibrary();
    }
    if (page === 'settings') {
      fillSettings();
      setSettingsSection(state.settingsSection);
    }
    if (page === 'editor') {
      requestAnimationFrame(() => state.editor?.refresh());
    }
  }

  async function jumpToLine() {
    const editor = state.editor;
    const input = await promptDialog({
      title: 'Go to line', label: 'Line or line:column',
      placeholder: '2941:42', confirmText: 'Go',
    });
    if (!input) return;
    const match = /^(\d+)(?:\s*:\s*(\d+))?$/.exec(input);
    if (!match || Number(match[1]) < 1 || Number(match[1]) > editor.model.count || Number(match[2]) === 0) {
      toast(`Enter a line from 1 to ${editor.model.count} and an optional column.`, 'warn');
      return;
    }
    editor.goTo(Number(match[1]) - 1, Number(match[2] || 1) - 1);
  }

  function bindUI() {
    el.code.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'g') {
        event.preventDefault();
        jumpToLine();
      }
    });
    el.nav.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-page]');
      if (button) go(button.dataset.page);
    });

    document.addEventListener('click', (event) => {
      const button = event.target.closest('[data-go]');
      if (!button) return;
      go(button.dataset.go);
    });

    el.winMin.addEventListener('click', () => api.minimize());
    el.winMax.addEventListener('click', () => api.maximize());
    el.winClose.addEventListener('click', () => api.close());

    $('.titlebar')?.addEventListener('dblclick', (event) => {
      if (event.target.closest('button, nav, .account, .bridge-pill, .win-controls')) return;
      api.maximize();
    });

    api
      .isMaximized()
      .then((maximized) => {
        document.documentElement.dataset.maximized = maximized ? 'true' : 'false';
      })
      .catch(() => {});

    el.accountBtn.addEventListener('click', () => {
      setSettingsSection('general');
      go('settings');
    });

    el.bridgePill.addEventListener('click', () => {
      if (!state.bridge.running) {
        setSettingsSection('connection');
        go('settings');
        toast(state.bridge.error || 'Start the bridge to accept clients', 'warn');
        return;
      }
      if (!state.clients.length) openConnectModal();
      else toggleClientsPopover(el.bridgePill);
    });

    el.targetChip.addEventListener('click', () => {
      if (!state.clients.length) openConnectModal();
      else toggleClientsPopover(el.targetChip);
    });

    el.homeConnect.addEventListener('click', () => {
      if (state.clients.length) toggleClientsPopover(el.bridgePill);
      else openConnectModal();
    });
    el.homeCopyLoader.addEventListener('click', () => copyLoader());

    el.explorerNew.addEventListener('click', () => newDocument());
    el.libraryNew.addEventListener('click', () => {
      newDocument();
      go('editor');
    });
    el.explorerOpen.addEventListener('click', () => el.fileInput.click());
    el.fileInput.addEventListener('change', async () => {
      const file = el.fileInput.files?.[0];
      if (file) await openLocalFile(file);
      el.fileInput.value = '';
    });
    el.explorerFilter.addEventListener('input', debounce(renderExplorer, 80));

    el.docTabs.addEventListener('click', (event) => {
      if (event.target.closest('[data-new-doc]')) {
        newDocument();
        return;
      }

      const close = event.target.closest('[data-close-doc]');
      if (close) {
        event.stopPropagation();
        closeDocument(Number(close.dataset.closeDoc));
        return;
      }

      const tab = event.target.closest('[data-doc-index]');
      if (tab) switchDocument(Number(tab.dataset.docIndex));
    });

    el.docTabs.addEventListener('auxclick', (event) => {
      if (event.button !== 1) return;
      const tab = event.target.closest('[data-doc-index]');
      if (tab) {
        event.preventDefault();
        closeDocument(Number(tab.dataset.docIndex));
      }
    });

    el.saveDoc.addEventListener('click', () => saveCurrent());
    el.runBtn.addEventListener('click', () => runCurrent());

    el.toggleConsole.addEventListener('click', () => {
      const collapsed = el.consolePanel.classList.toggle('collapsed');
      el.toggleConsole.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      setTimeout(() => state.editor?.refresh(), 220);
    });

    el.logFilters.addEventListener('click', (event) => {
      const button = event.target.closest('[data-filter]');
      if (!button) return;
      state.logFilter = button.dataset.filter;
      $$('button', el.logFilters).forEach((item) => {
        item.classList.toggle('active', item === button);
      });
      renderConsole();
    });

    el.clearLogs.addEventListener('click', () => {
      state.logs = [];
      renderConsole();
    });

    el.scriptsTabs.addEventListener('click', (event) => {
      const button = event.target.closest('[data-view]');
      if (button) setScriptsView(button.dataset.view);
    });

    el.hubSearch.addEventListener('input', () => {
      state.hubQuery = el.hubSearch.value;
      resetHubProvidersForQuery(state.hubQuery.trim());
      state.hubLoading = state.hubSource !== 'builtin';
      renderHubGrid();
      scheduleHubFetch();
    });

    el.librarySearch.addEventListener(
      'input',
      debounce(() => {
        state.libraryQuery = el.librarySearch.value;
        renderLibrary();
      }, 70),
    );

    el.hubSources.addEventListener('click', (event) => {
      const button = event.target.closest('[data-source]');
      if (!button || button.dataset.source === state.hubSource) return;

      state.hubSource = button.dataset.source;
      state.hubLoading = false;
      renderHubSources();
      renderHubGrid();

      if (state.hubSource === 'builtin') return;

      const query = state.hubQuery.trim();
      const needs = hubActiveProviders().some((id) => {
        const provider = state.hubProviders[id];
        return !provider.loaded || provider.query !== query;
      });

      if (needs) {
        state.hubLoading = true;
        loadHubExternal();
      }
    });

    el.hubCategories.addEventListener('click', (event) => {
      const button = event.target.closest('[data-cat]');
      if (!button) return;
      state.hubCategory = button.dataset.cat;
      $$('button', el.hubCategories).forEach((item) => {
        item.classList.toggle('active', item === button);
      });
      renderHubGrid();
    });

    el.hubFeedStatus.addEventListener('click', (event) => {
      if (!event.target.closest('[data-hub-retry]')) return;
      retryHub();
    });

    el.homeRecent.addEventListener('click', (event) => {
      const button = event.target.closest('[data-open-script]');
      if (button) openSavedScript(button.dataset.openScript);
    });

    el.homePicks.addEventListener('click', event => {
      if (event.target.closest('[data-retry-picks]')) loadHomePicks();
      else handleHubAction(event);
    });
    el.hubGrid.addEventListener('click', handleHubAction);
    const detail = $('#hubDetail');
    $('#hubBack').addEventListener('click', () => detail.close());
    detail.addEventListener('keydown', event => event.stopPropagation());
    detail.addEventListener('click', event => {
      const box = detail.getBoundingClientRect();
      if (event.target === detail && (event.clientX < box.left || event.clientX > box.right ||
          event.clientY < box.top || event.clientY > box.bottom)) detail.close();
    });
    el.libraryGrid.addEventListener('click', handleLibraryAction);
    el.explorerTree.addEventListener('click', handleLibraryAction);

    document.addEventListener('click', (event) => {
      const link = event.target.closest('[data-hub-link]');
      if (!link) return;
      event.preventDefault();
      api
        .openExternal(link.dataset.hubLink)
        .then((result) => {
          if (result && result.ok === false) {
            toast(result.message || 'Could not open that link', 'warn');
          }
        })
        .catch(() => {});
    });

    document.addEventListener(
      'load',
      (event) => {
        const image = event.target;
        if (image instanceof HTMLImageElement) {
          image.closest('.cover')?.classList.add('has-image');
        }
      },
      true,
    );

    document.addEventListener(
      'error',
      (event) => {
        const image = event.target;
        if (image instanceof HTMLImageElement && image.closest('.cover')) {
          image.remove();
        }
      },
      true,
    );

    el.settingsNav.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-sec]');
      if (button) setSettingsSection(button.dataset.sec);
    });

    el.themeGrid.addEventListener('click', (event) => {
      const card = event.target.closest('[data-theme-id]');
      if (!card) return;
      const theme = THEMES.find((item) => item.id === card.dataset.themeId);
      if (!theme) return;
      state.config.theme = theme.id;
      state.config.accent = theme.accent;
      applyConfig();
      persistConfig();
      renderThemeGrid();
      renderAccents();
      updateAppearanceControls();
    });

    el.accentRow.addEventListener('click', (event) => {
      const swatch = event.target.closest('[data-accent]');
      if (!swatch) return;
      state.config.accent = swatch.dataset.accent;
      applyConfig();
      persistConfig();
      renderAccents();
      updateAppearanceControls();
    });

    $$('[data-toggle]').forEach((button) => {
      button.addEventListener('click', () => {
        const path = button.dataset.toggle.split('.');
        const key = path.pop();
        const target = path.length ? state.config[path[0]] : state.config;
        if (!target) return;
        target[key] = !target[key];
        setSwitch(button, target[key]);
        applyConfig();
        persistConfig();
      });
    });

    el.saveProfileName?.addEventListener('click', async () => {
      const displayName = el.profileNameInput.value.trim().slice(0, 40);
      state.config.displayName = displayName;
      const saved = await api.setConfig(state.config).catch(() => null);
      if (!saved) {
        toast('Could not save your username', 'error');
        return;
      }
      state.config = saved;
      const freshUser = await api.getUser().catch(() => state.user);
      state.user = freshUser;
      renderIdentity();
      fillSettings();
      toast(displayName ? 'Username updated' : 'Using Windows username', 'success');
    });

    el.profileNameInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        el.saveProfileName.click();
      }
    });

    el.fontSize.addEventListener('input', () => {
      const size = clamp(Number(el.fontSize.value) || 13, 11, 20);
      state.config.editor.fontSize = size;
      el.fontSizeVal.textContent = String(size);
      el.root.style.setProperty('--code-size', `${size}px`);
      state.editor?.setOptions(state.config.editor);
      persistConfig();
    });

    el.tabSize.addEventListener('change', () => {
      state.config.editor.tabSize = Number(el.tabSize.value) === 4 ? 4 : 2;
      state.editor?.setOptions(state.config.editor);
      persistConfig();
    });

    el.bridgeEnabled.addEventListener('click', async () => {
      const next = !(el.bridgeEnabled.getAttribute('aria-checked') === 'true');
      await applyBridgeSettings({ enabled: next, port: Number(el.bridgePort.value) });
    });

    el.applyBridge.addEventListener('click', () =>
      applyBridgeSettings({
        enabled: el.bridgeEnabled.getAttribute('aria-checked') === 'true',
        port: Number(el.bridgePort.value),
      }),
    );

    el.restartBridge.addEventListener('click', () =>
      applyBridgeSettings({
        enabled: true,
        port: Number(el.bridgePort.value),
      }),
    );

    el.bridgePort.addEventListener('input', () => {
      clearTimeout(state.portTimer);
      el.bridgeApplyResult.textContent = '';
      const port = Number(el.bridgePort.value);
      if (!Number.isInteger(port) || port < 1024 || port > 65535) {
        el.bridgeApplyResult.textContent = 'Port must be 1024–65535';
        return;
      }
      state.portTimer = setTimeout(async () => {
        try {
          const script = await api.getLoader(port);
          if (Number(el.bridgePort.value) === port) el.loaderPreview.textContent = script;
        } catch {
          // Keep the previous preview.
        }
      }, 220);
    });

    el.bridgePort.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') el.applyBridge.click();
    });

    el.copyLoader.addEventListener('click', () => copyLoader(true));

    el.clientManageList.addEventListener('click', (event) => {
      const button = event.target.closest('[data-manage-disconnect]');
      if (button) disconnectClient(button.dataset.manageDisconnect);
    });

    el.disconnectAllClients.addEventListener('click', async () => {
      if (!state.clients.length) return;
      const confirmed = await confirmDialog({
        title: 'Disconnect every client?',
        message:
          'Each executor will stop its loader. Run the loader again inside the executor to reconnect.',
        confirmText: 'Disconnect all',
      });
      if (!confirmed) return;
      await api.disconnectAll();
      toast('Disconnected all clients', 'info');
    });

    el.popoverClose.addEventListener('click', () => closeClientsPopover());
    el.selectAllClients.addEventListener('click', () => {
      state.targetAll = true;
      state.targets.clear();
      updateTargetUI();
      renderClientsPopover();
      renderHome();
    });
    el.testClients.addEventListener('click', () => {
      closeClientsPopover();
      executeScript(BRIDGE_TEST_SCRIPT, 'Bridge test');
    });
    el.connectionSettings.addEventListener('click', () => {
      closeClientsPopover();
      setSettingsSection('connection');
      go('settings');
    });

    el.popoverClients.addEventListener('click', (event) => {
      const all = event.target.closest('[data-client-all]');
      if (all) {
        state.targetAll = true;
        state.targets.clear();
        updateTargetUI();
        renderClientsPopover();
        return;
      }

      const row = event.target.closest('[data-client-toggle]');
      if (!row) return;
      toggleClientTarget(row.dataset.clientToggle);
    });

    document.addEventListener('click', (event) => {
      if (el.clientsPopover.hidden) return;
      if (el.clientsPopover.contains(event.target)) return;
      if (event.target.closest('#bridgePill') || event.target.closest('#targetChip')) return;
      closeClientsPopover();
    });

    el.modalRoot.addEventListener('mousedown', (event) => {
      if (event.target === el.modalRoot) closeModal();
    });

    el.openData.addEventListener('click', async () => {
      const result = await api.openDataFolder();
      if (!result.ok) toast(result.message || 'Could not open the folder', 'error');
    });

    el.checkUpdates.addEventListener('click', () => checkForUpdates(true));

    api.onUpdateStatus(handleUpdateResult);
    el.updateAction.addEventListener('click', runUpdateAction);
    el.viewRelease.addEventListener('click', openRelease);

    el.resetSettings.addEventListener('click', async () => {
      const confirmed = await confirmDialog({
        title: 'Reset all settings?',
        message:
          'Theme, editor preferences, and connection settings return to their defaults. Your scripts and open tabs are kept.',
        confirmText: 'Reset settings',
      });
      if (!confirmed) return;

      const result = await api.resetConfig();
      state.config = result.config;
      state.clients = result.bridge?.clients || [];
      state.bridge = { ...state.bridge, ...result.bridge, clients: state.clients };
      state.user = await api.getUser().catch(() => state.user);
      applyConfig();
      fillSettings();
      if (result.bridge?.loader) el.loaderPreview.textContent = result.bridge.loader;
      renderIdentity();
      renderAll();
      toast('Settings reset', 'success');
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        if (!el.modalRoot.hidden) {
          closeModal();
          return;
        }
        if (!el.clientsPopover.hidden) closeClientsPopover();
        return;
      }

      const inEditor = document.activeElement === el.code;
      const mod = event.ctrlKey || event.metaKey;
      if (!mod || inEditor) return;

      if (event.key.toLowerCase() === 's' && state.page === 'editor') {
        event.preventDefault();
        saveCurrent();
      }
      if (event.key === 'Enter' && state.page === 'editor') {
        event.preventDefault();
        runCurrent();
      }
    });

    window.addEventListener('resize', closeClientsPopover);

    el.editorStage.addEventListener('dragover', (event) => {
      if (!event.dataTransfer?.types?.includes('Files')) return;
      event.preventDefault();
      el.editorStage.classList.add('dropping');
    });
    el.editorStage.addEventListener('dragleave', () => {
      el.editorStage.classList.remove('dropping');
    });
    el.editorStage.addEventListener('drop', async (event) => {
      if (!event.dataTransfer?.files?.length) return;
      event.preventDefault();
      el.editorStage.classList.remove('dropping');
      const file = event.dataTransfer.files[0];
      if (file) await openLocalFile(file);
    });
  }

  function debounce(fn, wait) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  }

  /* ------------------------------------------------------------------ *
   * Home
   * ------------------------------------------------------------------ */

  function renderHome() {
    if (!el.homeDate) return;

    const now = new Date();
    const hour = now.getHours();
    const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

    el.homeDate.textContent = now.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
    const first = el.greeting.firstChild;
    if (first && first.nodeType === Node.TEXT_NODE) first.nodeValue = `${part}, `;

    el.userNameInline.textContent = state.user.username || 'there';
    el.homeClients.textContent = String(state.clients.length);
    el.homeRuns.textContent = String(state.runs);
    el.homePort.textContent = String(state.bridge.port || state.config.bridge.port);
    el.homeClientCount.textContent = String(state.clients.length);

    const running = state.bridge.running;
    const connected = state.clients.length > 0;
    let bridgeLabel = 'Bridge stopped';
    let dotClass = 'bad';

    if (running && connected) {
      bridgeLabel = `${state.clients.length} client${state.clients.length === 1 ? '' : 's'} connected`;
      dotClass = 'ok';
    } else if (running) {
      bridgeLabel = `Bridge listening on ${state.bridge.port}`;
      dotClass = 'idle';
    } else if (state.bridge.error) {
      bridgeLabel = state.bridge.error;
    }

    el.homeDot.className = `status-dot ${dotClass}`;
    el.homeBridgeLabel.textContent = bridgeLabel;
    el.homeBridgeLabel.title = bridgeLabel;
    el.homeConnect.textContent = connected ? 'Manage clients' : 'Connect a client';

    renderHomeRecent();

    renderHomeClients();
    renderHomeActivity();
  }

  function renderHomeRecent() {
    const scripts = [...state.scripts]
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, 4);

    if (!scripts.length) {
      el.homeRecent.innerHTML = `
        <div class="empty-block">
          <span class="empty-icon">${icon('file')}</span>
          <div>
            <strong>No saved scripts yet</strong>
            <span>Save from the editor or pull something from the hub.</span>
          </div>
          <button class="btn small" data-go="scripts">Browse the hub</button>
        </div>`;
      return;
    }

    el.homeRecent.innerHTML = scripts
      .map((script) => {
        const meta = CATEGORY_META[script.category] || CATEGORY_META.utility;
        return `
          <button class="recent-card" data-open-script="${esc(script.id)}">
            ${scriptCover(script, true)}
            <span class="recent-copy">
              <span class="recent-name">${esc(script.name)}</span>
              <span class="recent-meta">${meta.label} · ${lineCount(script.code)} lines · ${timeAgo(
          script.updatedAt,
        )}</span>
            </span>
            ${icon('chevron-right', 'icon recent-arrow')}
          </button>`;
      })
      .join('');
  }

  function choosePopularPicks(items) {
    const eligible = items.filter(item => item.id && item.title && !item.patched && (item.views > 0 || item.likes > 0));
    eligible.sort((a, b) => b.views - a.views || b.likes - a.likes);
    // Providers can list the same script. Keep the higher-ranked copy.
    const seen = new Set();
    const ranked = eligible.filter(item => {
      const key = item.title.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const pool = ranked.slice(0, Math.max(3, Math.ceil(ranked.length / 2)));
    const picks = [];
    while (pool.length && picks.length < 3) {
      const index = Math.floor(Math.random() * pool.length);
      picks.push(pool.splice(index, 1)[0]);
    }
    return picks;
  }

  async function loadHomePicks() {
    if (state.homePicksLoading) return;
    state.homePicksLoading = true;
    el.homePicks.textContent = 'Loading community picks…';
    el.homePicks.setAttribute('aria-busy', 'true');
    const feeds = await Promise.allSettled(Object.keys(HUB_PROVIDERS).map(provider =>
      api.fetchHub({ provider, page: 1, query: '' })
    ));
    const items = feeds.flatMap(feed =>
      feed.status === 'fulfilled' && feed.value?.ok ? feed.value.items || [] : []
    );
    const picks = choosePopularPicks(items);
    state.homePicks = picks;
    state.homePicksLoading = false;
    el.homePicks.removeAttribute('aria-busy');
    if (!picks.length) {
      const message = items.length ? 'No ranked community picks available.' : 'No community picks available right now.';
      el.homePicks.innerHTML = `<p class="hub-feed">${message} <button class="link tiny" data-retry-picks>Retry</button></p>`;
      return;
    }
    el.homePicks.innerHTML = picks
      .map((script) => {
        const stat = script.views ? formatCount(script.views) + ' views' : formatCount(script.likes) + ' likes';
        return `
          <button class="pick" aria-haspopup="dialog" data-detail-id="${esc(script.id)}">
            ${scriptCover(script, true)}
            <span class="pick-copy">
              <strong>${esc(script.title)}</strong>
              <span>${esc(script.blurb)}</span>
            </span>
            <span class="pick-meta">${esc(stat)}</span>
            ${icon('arrow-right', 'icon pick-arrow')}
          </button>`;
      })
      .join('');
  }

  function renderHomeClients() {
    if (!state.clients.length) {
      el.homeClientsList.innerHTML = `
        <button class="empty-inline" data-connect-client="1">
          <span class="empty-icon small">${icon('plug')}</span>
          <span><strong>No clients connected</strong><span>Run the loader in your executor to attach one.</span></span>
          ${icon('plus', 'icon')}
        </button>`;
      const connect = el.homeClientsList.querySelector('[data-connect-client]');
      connect.addEventListener('click', () => openConnectModal());
      return;
    }

    el.homeClientsList.innerHTML = state.clients
      .slice(0, 3)
      .map(
        (client) => `
        <button class="client-mini-row" data-connect-client="1">
          <span class="client-avatar ${avatarTone(client.id)}">${esc(initials(client.game))}</span>
          <span class="client-copy">
            <strong>${esc(client.game)}</strong>
            <span>${esc(client.player)} · ${esc(client.executor)}</span>
          </span>
          <span class="status-dot ok"></span>
        </button>`,
      )
      .join('');

    $$('[data-connect-client]', el.homeClientsList).forEach((row) => {
      row.addEventListener('click', () => toggleClientsPopover(el.bridgePill));
    });
  }

  function renderHomeActivity() {
    if (!state.activity.length) {
      el.homeActivity.innerHTML = '<li class="activity-empty">Nothing has happened yet.</li>';
      return;
    }

    el.homeActivity.innerHTML = state.activity
      .slice(0, 6)
      .map(
        (item) => `
        <li>
          <span class="activity-icon">${icon(item.icon || 'clock')}</span>
          <span class="activity-text">${esc(item.text)}</span>
          <span class="activity-time">${esc(timeAgo(item.at))}</span>
        </li>`,
      )
      .join('');
  }

  function pushActivity(iconName, text) {
    state.activity.unshift({ icon: iconName, text, at: Date.now() });
    state.activity = state.activity.slice(0, 12);
    if (state.page === 'home') renderHomeActivity();
  }

  /* ------------------------------------------------------------------ *
   * Bridge, clients, targeting
   * ------------------------------------------------------------------ */

  function subscribeToBridge() {
    api.onClients((clients) => {
      setClients(clients);
    });

    api.onLog((entry) => {
      handleBridgeLog(entry);
    });

    api.onBridgeState((next) => {
      setBridgeState(next);
    });

    api.onWindowState(({ maximized }) => {
      document.documentElement.dataset.maximized = maximized ? 'true' : 'false';
      const use = el.winMaxIcon.querySelector('use');
      if (use) use.setAttribute('href', maximized ? '#i-restore' : '#i-maximize');
      el.winMax.title = maximized ? 'Restore' : 'Maximize';
    });
  }

  function setBridgeState(next) {
    const previousError = state.lastBridgeError;
    state.bridge = { ...state.bridge, ...(next || {}) };

    if (!state.bridge.running) {
      state.clients = [];
      state.targets.clear();
      state.targetAll = true;
    }

    renderBridgeGlobal();
    updateTargetUI();
    renderHome();
    renderConnectionStatus();
    if (!el.clientsPopover.hidden) renderClientsPopover();

    if (state.bridge.loader) el.loaderPreview.textContent = state.bridge.loader;

    if (state.bridge.error && state.bridge.error !== previousError) {
      state.lastBridgeError = state.bridge.error;
      toast(state.bridge.error, 'error');
    }
    if (!state.bridge.error) state.lastBridgeError = '';
  }

  function setClients(clients) {
    state.clients = Array.isArray(clients) ? clients : [];

    if (!state.targetAll) {
      const valid = new Set(state.clients.map((client) => client.id));
      state.targets = new Set([...state.targets].filter((id) => valid.has(id)));
    }

    if (state.clients.length === 0) {
      state.targetAll = true;
      state.targets.clear();
    }

    renderBridgeGlobal();
    updateTargetUI();
    renderHome();
    renderConnectionStatus();
    if (!el.clientsPopover.hidden) renderClientsPopover();
  }

  function renderBridgeGlobal() {
    const running = state.bridge.running;
    const count = state.clients.length;

    let label = 'Bridge off';
    let tone = 'bad';
    if (running && count > 0) {
      label = `${count} client${count === 1 ? '' : 's'}`;
      tone = 'ok';
    } else if (running) {
      label = 'No clients';
      tone = 'idle';
    }

    el.bridgeLabel.textContent = label;
    el.bridgeDot.className = `status-dot ${tone}`;
    el.bridgePill.title = running
      ? `Bridge listening on 127.0.0.1:${state.bridge.port || state.config.bridge.port}`
      : state.bridge.error || 'Bridge is not running';

    el.sbBridge.textContent = count
      ? `${count} client${count === 1 ? '' : 's'}`
      : running
        ? 'No clients'
        : 'Bridge off';
  }

  function updateTargetUI() {
    const count = state.clients.length;
    let label = 'No clients';
    let tone = 'bad';

    if (!count) {
      label = 'No clients';
      tone = 'bad';
    } else if (state.targetAll) {
      label = count === 1 ? 'All clients' : `All clients (${count})`;
      tone = 'ok';
    } else {
      label = `${state.targets.size} of ${count} selected`;
      tone = state.targets.size ? 'ok' : 'bad';
    }

    el.targetLabel.textContent = label;
    el.targetDot.className = `status-dot ${tone}`;
    el.runBtn.disabled = !count || (!state.targetAll && state.targets.size === 0);
  }

  function toggleClientTarget(id) {
    if (state.targetAll) {
      state.targetAll = false;
      state.targets = new Set(
        state.clients.filter((client) => client.id !== id).map((client) => client.id),
      );
    } else if (state.targets.has(id)) {
      state.targets.delete(id);
    } else {
      state.targets.add(id);
    }

    updateTargetUI();
    renderClientsPopover();
    renderHome();
  }

  function renderClientsPopover() {
    const count = state.clients.length;
    el.popoverSub.textContent = count
      ? `${count} client${count === 1 ? '' : 's'} connected`
      : 'No clients connected';
    el.popoverClients.innerHTML = '';

    if (!count) {
      el.popoverClients.innerHTML = `
        <div class="popover-empty">
          <span class="empty-icon">${icon('plug')}</span>
          <strong>No clients attached</strong>
          <span>Run the loader script inside your executor, then it will appear here.</span>
          <button class="btn small" data-popover-connect>Show loader</button>
        </div>`;
      const connect = el.popoverClients.querySelector('[data-popover-connect]');
      connect.addEventListener('click', () => {
        closeClientsPopover();
        openConnectModal();
      });
      return;
    }

    const master = document.createElement('button');
    master.className = `client-row master ${state.targetAll ? 'selected' : ''}`;
    master.dataset.clientAll = '1';
    master.innerHTML = `
      <span class="check">${icon('check')}</span>
      <span class="client-copy">
        <strong>All connected clients</strong>
        <span>${count} target${count === 1 ? '' : 's'} on the next run</span>
      </span>`;
    el.popoverClients.appendChild(master);

    for (const client of state.clients) {
      const selected = state.targetAll || state.targets.has(client.id);
      const readiness = client.unresponsive
        ? ' <em class="client-state bad">not answering</em>'
        : Number(client.loader) < 2
          ? ' <em class="client-state bad">stale loader</em>'
          : client.verified
            ? ''
            : ' <em class="client-state pending">handshaking…</em>';
      const row = document.createElement('button');
      row.className = `client-row ${selected ? 'selected' : ''}`;
      row.dataset.clientToggle = client.id;
      row.innerHTML = `
        <span class="check">${icon('check')}</span>
        <span class="client-avatar ${avatarTone(client.id)}">${esc(
          initials(client.game),
        )}</span>
        <span class="client-copy">
          <strong>${esc(client.game)}</strong>
          <span>${esc(client.player)} · ${esc(client.executor)}${readiness}</span>
        </span>
        <span class="client-place">PID ${esc(client.placeId || '—')}</span>`;
      el.popoverClients.appendChild(row);
    }
  }

  function positionClientsPopover(anchor) {
    const rect = anchor.getBoundingClientRect();
    const width = el.clientsPopover.offsetWidth || 390;
    const height = el.clientsPopover.offsetHeight || 360;

    let left = Math.round(rect.right - width);
    left = clamp(left, 12, window.innerWidth - width - 12);

    let top = Math.round(rect.bottom + 10);
    if (top + height > window.innerHeight - 14) {
      top = Math.max(14, Math.round(rect.top - height - 10));
    }

    el.clientsPopover.style.left = `${left}px`;
    el.clientsPopover.style.top = `${top}px`;
  }

  function toggleClientsPopover(anchor) {
    if (!el.clientsPopover.hidden) {
      closeClientsPopover();
      return;
    }
    renderClientsPopover();
    el.clientsPopover.hidden = false;
    positionClientsPopover(anchor);
  }

  function closeClientsPopover() {
    if (el.clientsPopover.hidden) return;
    el.clientsPopover.hidden = true;
  }

  function handleBridgeLog(entry) {
    if (!entry) return;

    const level = ['info', 'warn', 'error', 'success', 'system'].includes(entry.level)
      ? entry.level
      : 'info';

    const log = {
      level,
      message: String(entry.message || ''),
      source: entry.source || 'Aether',
      at: Number(entry.at) || Date.now(),
    };

    state.logs.push(log);
    if (state.logs.length > 500) state.logs.shift();

    if (logMatchesFilter(log.level, state.logFilter)) appendLogRow(log);
    updateLogCount();

    if (level === 'system' && /(connected|disconnected)/i.test(log.message)) {
      pushActivity('plug', log.message);
    }

    if (level === 'error' && entry.source) {
      toast(`${entry.source}: ${truncate(log.message, 110)}`, 'error');
    }
  }

  /* ------------------------------------------------------------------ *
   * Editor documents
   * ------------------------------------------------------------------ */

  function loadDocIntoEditor() {
    const doc = currentDoc() || DEFAULT_DOC();
    if (!currentDoc()) {
      state.docs = [doc];
      state.active = 0;
    }

    state.editor.setValue(doc.code, true);
    state.editor.setDirty(doc.dirty);
    renderTabs();
    renderExplorer();
    updateDirtyUI();
    scheduleSessionSave();
  }

  function handleEditorChange(value) {
    const doc = currentDoc();
    if (!doc) return;

    doc.code = value;
    if (!doc.dirty) {
      doc.dirty = true;
      updateDirtyUI();
    }
    scheduleSessionSave();
  }

  function updateDirtyUI() {
    const doc = currentDoc();
    if (!doc) return;
    const label = doc.dirty ? 'Unsaved' : doc.originId ? 'Saved' : doc.code.trim() ? 'Draft' : 'Ready';
    el.dirtyState.textContent = label;
    el.dirtyState.classList.toggle('is-dirty', Boolean(doc.dirty));

    const activeTab = $(`.doc-tab[data-doc-index="${state.active}"]`, el.docTabs);
    if (activeTab) {
      const dot = $('.tab-dot', activeTab);
      if (dot) dot.classList.toggle('on', Boolean(doc.dirty));
    }

    const activeRow = $('.tree-row.active', el.explorerTree);
    if (activeRow) activeRow.classList.toggle('has-dirty', Boolean(doc.dirty));
  }

  function syncEditorToDoc() {
    const doc = currentDoc();
    if (doc && state.editor) doc.code = state.editor.getValue();
  }

  function scheduleSessionSave() {
    clearTimeout(state.sessionTimer);
    state.sessionTimer = setTimeout(() => {
      syncEditorToDoc();
      api
        .setSession({
          docs: state.docs,
          active: state.active,
        })
        .catch(() => {});
    }, 500);
  }

  function uniqueDocName(name) {
    const base = String(name || 'Untitled').trim() || 'Untitled';
    const taken = new Set(state.docs.map((doc) => doc.name.toLowerCase()));
    if (!taken.has(base.toLowerCase())) return base;

    let index = 2;
    while (taken.has(`${base} ${index}`.toLowerCase())) index += 1;
    return `${base} ${index}`;
  }

  function newDocument(name = 'Untitled', code = '', originId = null) {
    const doc = {
      id: uid(),
      name: uniqueDocName(name),
      code,
      dirty: false,
      originId,
    };
    state.docs.push(doc);
    switchDocument(state.docs.length - 1, true);
    go('editor');
    return doc;
  }

  function switchDocument(index, focus = false) {
    if (index < 0 || index >= state.docs.length) return;
    if (index === state.active) {
      if (focus) state.editor?.focus();
      return;
    }

    syncEditorToDoc();
    state.active = index;
    state.editor.setValue(currentDoc().code, true);
    state.editor.setDirty(currentDoc().dirty);
    renderTabs();
    renderExplorer();
    updateDirtyUI();
    scheduleSessionSave();
    if (focus) {
      requestAnimationFrame(() => {
        state.editor.refresh();
        state.editor.focus();
      });
    }
  }

  async function closeDocument(index) {
    const doc = state.docs[index];
    if (!doc) return;

    if (doc.dirty) {
      const confirmed = await confirmDialog({
        title: 'Discard changes?',
        message: `“${doc.name}” has unsaved changes. Closing this tab will lose them.`,
        confirmText: 'Discard',
      });
      if (!confirmed) return;
    }

    syncEditorToDoc();

    if (state.docs.length === 1) {
      state.docs = [DEFAULT_DOC()];
      state.active = 0;
    } else {
      state.docs.splice(index, 1);
      if (state.active > index) state.active -= 1;
      else if (state.active === index) state.active = Math.min(index, state.docs.length - 1);
    }

    state.editor.setValue(currentDoc().code, true);
    state.editor.setDirty(currentDoc().dirty);
    renderTabs();
    renderExplorer();
    updateDirtyUI();
    scheduleSessionSave();
  }

  /* ------------------------------------------------------------------ *
   * Tabs
   *
   * Tabs are keyed by document id and reused between renders, so only the
   * tab that actually changed animates:
   *   - a new tab fades and scales in,
   *   - a closed tab fades out while the others slide into the gap (FLIP),
   *   - one shared "pill" glides to whichever tab is active.
   * ------------------------------------------------------------------ */

  const TAB_MS = 260;
  const TAB_EASE = 'cubic-bezier(0.22, 0.82, 0.2, 1)';
  const TAB_ADD_KEY = '__add__';

  const tabView = {
    nodes: new Map(), // doc.id -> tab element
    indicator: null, // the sliding active pill
    add: null, // the "+" button
    ready: false, // false until the first render, which must not animate
  };

  const motionOn = () =>
    el.root.dataset.motion !== 'off' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function createTabNode() {
    const tab = document.createElement('div');
    tab.className = 'doc-tab';

    const dot = document.createElement('span');
    dot.className = 'tab-dot';

    const name = document.createElement('button');
    name.className = 'tab-name';

    const close = document.createElement('button');
    close.className = 'tab-close';
    close.title = 'Close tab';
    close.innerHTML = icon('x');

    tab.append(dot, name, close);
    return tab;
  }

  function updateTabNode(tab, doc, index) {
    const [dot, name, close] = tab.children;
    tab.classList.toggle('active', index === state.active);
    tab.dataset.docIndex = String(index);
    dot.classList.toggle('on', Boolean(doc.dirty));
    if (name.textContent !== doc.name) {
      name.textContent = doc.name;
      name.title = doc.name;
    }
    close.dataset.closeDoc = String(index);
    close.setAttribute('aria-label', `Close ${doc.name}`);
  }

  // Moves the pill under the active tab. It uses layout positions (offsetLeft), which
  // ignore transforms, so it always aims at where the tab is going to rest.
  function placeTabIndicator(animated) {
    const { indicator, nodes } = tabView;
    if (!indicator) return;

    const node = nodes.get(currentDoc()?.id);
    if (!node) {
      indicator.style.opacity = '0';
      return;
    }

    if (!animated) indicator.classList.add('instant');
    indicator.style.width = `${node.offsetWidth}px`;
    indicator.style.transform = `translateX(${node.offsetLeft}px)`;
    indicator.style.opacity = '1';
    if (!animated) {
      void indicator.offsetWidth; // flush styles so the jump happens without a transition
      indicator.classList.remove('instant');
    }
  }

  // Takes a closed tab out of the flow so its neighbours can slide over it while it fades.
  function retireTab(node) {
    node.classList.add('leaving');
    node.removeAttribute('data-doc-index');
    node.querySelector('[data-close-doc]')?.removeAttribute('data-close-doc');
    node.style.position = 'absolute';
    node.style.left = `${node.offsetLeft}px`;
    node.style.top = `${node.offsetTop}px`;
    node.style.width = `${node.offsetWidth}px`;
    node.style.margin = '0';
    node.style.pointerEvents = 'none';

    node
      .animate(
        [
          { opacity: 1, transform: 'none' },
          { opacity: 0, transform: 'translateY(4px) scale(0.92)' },
        ],
        { duration: 170, easing: 'ease-out', fill: 'forwards' },
      )
      .addEventListener('finish', () => node.remove());
  }

  function renderTabs() {
    const container = el.docTabs;

    if (!tabView.indicator) {
      tabView.indicator = document.createElement('span');
      tabView.indicator.className = 'tab-indicator';
      tabView.indicator.setAttribute('aria-hidden', 'true');

      tabView.add = document.createElement('button');
      tabView.add.className = 'tab-add';
      tabView.add.dataset.newDoc = '1';
      tabView.add.title = 'New file';
      tabView.add.innerHTML = icon('plus');

      container.append(tabView.indicator, tabView.add);

      // Tabs have no size while the editor page is hidden, and flex-shrink resizes them
      // with the window, so the pill is re-placed (without animating) whenever that changes.
      new ResizeObserver(() => placeTabIndicator(false)).observe(container);
    }

    const animate = tabView.ready && motionOn();

    // FIRST: where every tab is on screen right now, including any animation in flight.
    const first = new Map();
    const scrollBefore = container.scrollLeft;
    if (animate) {
      tabView.nodes.forEach((node, key) => first.set(key, node.getBoundingClientRect().left));
      first.set(TAB_ADD_KEY, tabView.add.getBoundingClientRect().left);
    }

    // Retire tabs whose document is gone.
    const alive = new Set(state.docs.map((doc) => doc.id));
    [...tabView.nodes].forEach(([key, node]) => {
      if (alive.has(key)) return;
      tabView.nodes.delete(key);
      if (animate) retireTab(node);
      else node.remove();
    });

    // Create or update one tab per document, in document order.
    const ordered = [];
    const created = [];
    state.docs.forEach((doc, index) => {
      let node = tabView.nodes.get(doc.id);
      if (!node) {
        node = createTabNode();
        tabView.nodes.set(doc.id, node);
        created.push(node);
      }
      updateTabNode(node, doc, index);
      ordered.push(node);
    });

    // Only touch the DOM when needed: moving a node cancels its animations.
    const present = [...container.children].filter(
      (node) => node.classList.contains('doc-tab') && !node.classList.contains('leaving'),
    );
    const inOrder = present.every((node, index) => node === ordered[index]);
    (inOrder ? ordered.slice(present.length) : ordered).forEach((node) =>
      container.insertBefore(node, tabView.add),
    );

    // Keep the active tab visible when there are more tabs than fit.
    const active = tabView.nodes.get(currentDoc()?.id);
    if (active) {
      const left = active.offsetLeft;
      const right = left + active.offsetWidth;
      if (left < container.scrollLeft) container.scrollLeft = Math.max(0, left - 8);
      else if (right > container.scrollLeft + container.clientWidth) {
        container.scrollLeft = right - container.clientWidth + 8;
      }
    }

    placeTabIndicator(animate);

    // LAST + PLAY: slide each surviving tab from where it was to where it is now.
    if (animate && container.scrollLeft === scrollBefore) {
      tabView.nodes.forEach((node, key) => {
        if (!first.has(key)) return;
        const shift = first.get(key) - node.getBoundingClientRect().left;
        if (Math.abs(shift) < 0.5) return;
        node.animate([{ transform: `translateX(${shift}px)` }, { transform: 'none' }], {
          duration: TAB_MS,
          easing: TAB_EASE,
        });
      });

      const addShift = first.get(TAB_ADD_KEY) - tabView.add.getBoundingClientRect().left;
      if (Math.abs(addShift) >= 0.5) {
        tabView.add.animate([{ transform: `translateX(${addShift}px)` }, { transform: 'none' }], {
          duration: TAB_MS,
          easing: TAB_EASE,
        });
      }
    }

    if (animate) {
      created.forEach((node) =>
        node.animate(
          [
            { opacity: 0, transform: 'translateY(6px) scale(0.9)' },
            { opacity: 1, transform: 'none' },
          ],
          { duration: TAB_MS, easing: TAB_EASE },
        ),
      );
    }

    tabView.ready = true;
  }

  function renderExplorer() {
    const query = el.explorerFilter.value.trim().toLowerCase();
    const scripts = [...state.scripts]
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .filter((script) => !query || script.name.toLowerCase().includes(query));

    el.explorerCount.textContent = `${state.scripts.length} file${
      state.scripts.length === 1 ? '' : 's'
    }`;

    if (!scripts.length) {
      el.explorerTree.innerHTML = `
        <div class="explorer-empty">
          <span>${query ? 'No matches' : 'No saved scripts'}</span>
          <p>${query ? 'Try a different filter.' : 'Save the current tab to keep it here.'}</p>
        </div>`;
      return;
    }

    const activeDoc = currentDoc();
    el.explorerTree.innerHTML = scripts
      .map((script) => {
        const active = activeDoc?.originId === script.id;
        const dirty = state.docs.some((doc) => doc.originId === script.id && doc.dirty);
        return `
          <div class="explorer-file">
            <button class="tree-row ${active ? 'active' : ''} ${dirty ? 'has-dirty' : ''}"
              data-open-script="${esc(script.id)}">
              ${icon('file')}
              <span class="tree-name">${esc(script.name)}</span>
              <span class="tree-dot"></span>
            </button>
            ${savedScriptButtons(script)}
          </div>`;
      })
      .join('');

  }

  function openSavedScript(id) {
    const script = state.scripts.find((item) => item.id === id);
    if (!script) return;

    const existing = state.docs.findIndex((doc) => doc.originId === script.id);
    if (existing >= 0) {
      switchDocument(existing, true);
    } else {
      state.docs.push({
        id: uid(),
        name: uniqueDocName(script.name),
        code: script.code,
        dirty: false,
        originId: script.id,
      });
      switchDocument(state.docs.length - 1, true);
    }

    go('editor');
    pushActivity('file', `Opened ${script.name}`);
  }

  async function openLocalFile(file) {
    if (file.size > 2 * 1024 * 1024) {
      toast('That file is larger than 2 MB', 'error');
      return;
    }

    try {
      const code = await file.text();
      newDocument(file.name, code);
      pushActivity('file', `Opened ${file.name}`);
    } catch (error) {
      toast(error.message || 'Could not read that file', 'error');
    }
  }

  async function saveCurrent() {
    const doc = currentDoc();
    if (!doc) return;
    doc.code = state.editor.getValue();

    if (!doc.code.trim()) {
      toast('Add some code before saving', 'warn');
      return;
    }

    let script = doc.originId
      ? state.scripts.find((item) => item.id === doc.originId)
      : null;

    let name = script?.name;
    if (!script) {
      const suggested = /^Untitled/.test(doc.name) ? '' : doc.name.replace(/\.(lua|txt)$/i, '');
      name = await promptDialog({
        title: 'Save to library',
        subtitle: 'Give this script a name you will recognise later.',
        label: 'Script name',
        value: suggested,
        placeholder: 'My script',
        confirmText: 'Save',
      });
      if (!name) return;
    }

    const code = doc.code;
    const id = script?.id || uid();
    const saved = await persistScripts(scripts => {
      const existing = scripts.find(item => item.id === id);
      script = {
        ...existing, id, code,
        name: existing?.name || uniqueScriptName(name),
        category: existing?.category || '',
        updatedAt: Date.now(),
      };
      return existing ? scripts.map(item => item.id === id ? script : item) : [...scripts, script];
    });
    if (!saved) return;
    doc.originId = id;
    doc.name = script.name;
    doc.dirty = doc.code !== code;
    renderTabs();
    renderExplorer();
    updateDirtyUI();
    toast('Saved to library', 'success');
    pushActivity('save', `Saved ${script.name}`);
    scheduleSessionSave();
  }

  function uniqueScriptName(name, excludeId = null) {
    const base = String(name || 'Untitled').trim().slice(0, 90) || 'Untitled';
    const taken = new Set(
      state.scripts
        .filter((script) => script.id !== excludeId)
        .map((script) => script.name.toLowerCase()),
    );

    if (!taken.has(base.toLowerCase())) return base;
    let index = 2;
    while (taken.has(`${base} ${index}`.toLowerCase())) index += 1;
    return `${base} ${index}`;
  }

  // Serialize library edits. Publish each new list only after the disk write
  // succeeds, so simultaneous saves and deletes cannot drop another edit.
  let libraryWrite = Promise.resolve();
  function persistScripts(update) {
    const work = libraryWrite.then(async () => {
      const next = update(state.scripts);
      if (await api.setScripts(next) === false) throw new Error('Write failed');
      state.scripts = next;
      renderLibrary();
      renderExplorer();
      renderHome();
      return true;
    });
    libraryWrite = work.catch(() => {
      toast('Could not update saved scripts. Check the data folder and try again.', 'error');
      return false;
    });
    return libraryWrite;
  }

  async function runCurrent() {
    const doc = currentDoc();
    if (!doc) return;
    await executeScript(state.editor.getValue(), doc.name);
  }

  async function executeScript(code, label) {
    if (!String(code || '').trim()) {
      toast('Nothing to run yet', 'warn');
      return;
    }
    if (!state.bridge.running) {
      openConnectModal('The bridge is not running, so there is nowhere to send this script.');
      return;
    }
    if (!state.clients.length) {
      openConnectModal('Connect an executor before running a script.');
      return;
    }
    if (!state.targetAll && state.targets.size === 0) {
      toast('Select at least one client', 'warn');
      return;
    }

    const ids = state.targetAll ? [] : [...state.targets];
    const result = await api.run({ code, ids });

    if (!result.ok) {
      toast(result.message || 'Could not send the script', 'error');
      return;
    }

    state.runs += 1;
    pushActivity('play', `Ran ${label} on ${result.count} client${result.count === 1 ? '' : 's'}`);
    handleBridgeLog({
      level: 'system',
      source: 'Aether',
      message: `Sent ${label} to ${result.count} client${result.count === 1 ? '' : 's'}`,
      at: Date.now(),
    });
    toast(result.message, 'success');
    renderHome();
  }

  /* ------------------------------------------------------------------ *
   * Console
   * ------------------------------------------------------------------ */

  function logMatchesFilter(level, filter) {
    if (filter === 'all') return true;
    if (filter === 'info') return level === 'info' || level === 'success' || level === 'system';
    return level === filter;
  }

  function logRow(log) {
    const row = document.createElement('div');
    row.className = `log-row level-${log.level}`;

    const time = document.createElement('span');
    time.className = 'log-time';
    time.textContent = formatClock(log.at);

    const marker = document.createElement('span');
    marker.className = 'log-marker';

    const source = document.createElement('span');
    source.className = 'log-source';
    source.textContent = log.source;
    source.title = log.source;

    const message = document.createElement('span');
    message.className = 'log-message';
    message.textContent = log.message;

    row.append(time, marker, source, message);
    return row;
  }

  function appendLogRow(log) {
    el.consoleEmpty.style.display = 'none';
    const nearBottom =
      el.consoleBody.scrollHeight - el.consoleBody.scrollTop - el.consoleBody.clientHeight < 56;

    el.consoleBody.appendChild(logRow(log));

    const rows = el.consoleBody.querySelectorAll('.log-row');
    if (rows.length > 500) rows[0].remove();

    if (nearBottom) el.consoleBody.scrollTop = el.consoleBody.scrollHeight;
    updateLogCount();
  }

  function renderConsole() {
    const filtered = state.logs.filter((log) => logMatchesFilter(log.level, state.logFilter));
    el.consoleBody.innerHTML = '';

    if (!filtered.length) {
      el.consoleEmpty.style.display = 'block';
      el.consoleBody.appendChild(el.consoleEmpty);
    } else {
      el.consoleEmpty.style.display = 'none';
      const fragment = document.createDocumentFragment();
      filtered.slice(-500).forEach((log) => fragment.appendChild(logRow(log)));
      el.consoleBody.appendChild(fragment);
      el.consoleBody.scrollTop = el.consoleBody.scrollHeight;
    }

    updateLogCount();
  }

  function updateLogCount() {
    el.logCount.textContent = String(state.logs.length);
  }

  /* ------------------------------------------------------------------ *
   * Script hub and library
   * ------------------------------------------------------------------ */

  function setScriptsView(view) {
    state.scriptsView = view === 'library' ? 'library' : 'hub';
    $$('button', el.scriptsTabs).forEach((button) => {
      button.classList.toggle('active', button.dataset.view === state.scriptsView);
    });
    el.hubView.hidden = state.scriptsView !== 'hub';
    el.libraryView.hidden = state.scriptsView !== 'library';
    if (state.scriptsView === 'hub') renderHub();
    else renderLibrary();
  }

  function renderAll() {
    renderBridgeGlobal();
    updateTargetUI();
    renderHome();
    renderTabs();
    renderExplorer();
    renderHub();
    renderLibrary();
    renderConsole();
    fillSettings();
    renderThemeGrid();
    renderAccents();
    updateAppearanceControls();
  }

  function renderHub() {
    renderHubSources();
    renderHubCategories();
    renderHubGrid();
    ensureHubFeed();
  }

  function renderHubSources() {
    el.hubSources.innerHTML = HUB_SOURCES.map((source) => {
      const dot =
        source.id === 'scriptblox' || source.id === 'robloxscripts'
          ? '<span class="source-dot"></span>'
          : '';
      return `
        <button class="chip source-chip ${state.hubSource === source.id ? 'active' : ''}" data-source="${source.id}">
          ${dot}${esc(source.label)}
        </button>`;
    }).join('');
  }

  function renderHubCategories() {
    const categories = ['all', ...Object.keys(CATEGORY_META)];
    el.hubCategories.innerHTML = categories
      .map(
        (category) => `
        <button class="chip ${state.hubCategory === category ? 'active' : ''}" data-cat="${category}">
          ${category === 'all' ? 'All scripts' : CATEGORY_META[category].label}
        </button>`,
      )
      .join('');
  }

  function hubActiveProviders() {
    if (state.hubSource === 'builtin') return [];
    if (state.hubSource === 'all') return Object.keys(HUB_PROVIDERS);
    return HUB_PROVIDERS[state.hubSource] ? [state.hubSource] : [];
  }

  function hubExternalItems() {
    return Object.values(state.hubProviders).flatMap((provider) => provider.items);
  }

  function findHubScript(id) {
    return (
      window.HUB_SCRIPTS.find((script) => script.id === id) ||
      hubExternalItems().find((script) => script.id === id) ||
      state.homePicks.find(script => script.id === id) ||
      null
    );
  }

  function resetHubProvidersForQuery(query) {
    state.hubRequest += 1;

    for (const provider of Object.values(state.hubProviders)) {
      if (provider.query === query) continue;
      provider.items = [];
      provider.page = 1;
      provider.hasMore = true;
      provider.loaded = false;
      provider.query = query;
      provider.error = '';
    }
    state.hubNotice = '';
  }

  function ensureHubFeed() {
    if (state.page !== 'scripts' || state.hubSource === 'builtin' || state.hubLoading) return;

    const query = state.hubQuery.trim();
    const needs = hubActiveProviders().some((id) => {
      const provider = state.hubProviders[id];
      return !provider.loaded || provider.query !== query;
    });

    if (needs) loadHubExternal();
  }

  function scheduleHubFetch() {
    clearTimeout(state.hubTimer);
    if (state.hubSource === 'builtin') return;

    state.hubTimer = setTimeout(() => {
      state.hubTimer = null;
      loadHubExternal();
    }, 380);
  }

  function retryHub() {
    const query = state.hubQuery.trim();

    for (const id of hubActiveProviders()) {
      const provider = state.hubProviders[id];
      if (provider.query !== query) {
        provider.items = [];
        provider.page = 1;
        provider.hasMore = true;
        provider.query = query;
      }
      provider.loaded = false;
      provider.error = '';
    }

    state.hubNotice = '';
    loadHubExternal();
  }

  async function loadHubExternal({ append = false } = {}) {
    const query = state.hubQuery.trim();
    const providers = hubActiveProviders().filter((id) => {
      const provider = state.hubProviders[id];
      if (provider.query !== query) return false;
      if (append) return provider.loaded && provider.hasMore && !provider.error;
      return !provider.loaded || Boolean(provider.error);
    });

    if (!providers.length) {
      state.hubLoading = false;
      renderHubGrid();
      return;
    }

    const token = ++state.hubRequest;
    state.hubLoading = true;
    state.hubNotice = '';
    renderHubGrid();

    const requests = providers.map((id) => {
      const provider = state.hubProviders[id];
      const page = append ? provider.page : 1;

      return api
        .fetchHub({ provider: id, query, page })
        .then((result) => ({ id, result, page, query }))
        .catch((error) => ({
          id,
          page,
          query,
          result: { ok: false, provider: id, items: [], error: error.message || 'Request failed' },
        }));
    });

    const results = await Promise.all(requests);
    if (token !== state.hubRequest) return;

    const notes = [];

    for (const entry of results) {
      const provider = state.hubProviders[entry.id];
      if (!provider || provider.query !== entry.query) continue;

      const result = entry.result || {};
      if (result.ok) {
        const items = Array.isArray(result.items) ? result.items : [];

        if (append) {
          const seen = new Set(provider.items.map((item) => item.id));
          provider.items.push(...items.filter((item) => item.id && !seen.has(item.id)));
        } else {
          provider.items = items;
        }

        provider.page = Math.max(1, Number(result.page) || entry.page) + 1;
        provider.hasMore = Boolean(result.hasMore) && provider.page <= 50;
        provider.loaded = true;
        provider.error = '';

        if (result.stale) {
          notes.push(`${HUB_PROVIDERS[entry.id].label} is offline — cached results shown`);
        }
      } else {
        provider.loaded = true;
        provider.error = result.error || 'Provider unavailable';
        provider.hasMore = false;
        if (!append) provider.items = [];
        notes.push(`${HUB_PROVIDERS[entry.id].label}: ${provider.error}`);
      }
    }

    state.hubLoading = false;
    state.hubNotice = notes.join(' · ');
    renderHubGrid();
  }

  function updateHubStatus() {
    if (state.hubSource === 'builtin') {
      el.hubFeedStatus.textContent = '';
      return;
    }

    if (state.hubLoading) {
      const label =
        state.hubSource === 'all'
          ? 'ScriptBlox and RobloxScripts'
          : HUB_PROVIDERS[state.hubSource]?.label || 'community providers';
      el.hubFeedStatus.innerHTML = `<span class="hub-spinner"></span><span>Searching ${esc(label)}…</span>`;
      return;
    }

    if (state.hubNotice) {
      el.hubFeedStatus.innerHTML = `<span class="hub-feed-error">${icon('alert')}${esc(
        state.hubNotice,
      )}</span><button class="link tiny" data-hub-retry>Retry</button>`;
      return;
    }

    const count = hubExternalItems().filter(
      (item) => state.hubSource === 'all' || hubItemSource(item) === state.hubSource,
    ).length;

    el.hubFeedStatus.textContent = count
      ? `${count} community script${count === 1 ? '' : 's'} loaded`
      : '';
  }

  function renderHubGrid() {
    const query = state.hubQuery.trim().toLowerCase();
    const source = state.hubSource;
    const external = hubExternalItems();
    let scripts;

    if (source === 'builtin') {
      scripts = [...window.HUB_SCRIPTS];
    } else if (source === 'all') {
      scripts = [...window.HUB_SCRIPTS, ...external];
    } else {
      scripts = external.filter((item) => hubItemSource(item) === source);
    }

    scripts = scripts.filter((script) => {
      const categoryOk = state.hubCategory === 'all' || script.category === state.hubCategory;
      if (!categoryOk) return false;
      if (!query) return true;

      const tags = Array.isArray(script.tags) ? script.tags.join(' ') : '';
      return `${script.title} ${script.blurb} ${tags} ${script.category} ${script.game || ''} ${
        script.author || ''
      }`
        .toLowerCase()
        .includes(query);
    });

    const seen = new Set();
    scripts = scripts.filter((script) => {
      const key = String(script.title || '').toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const showSkeletons = state.hubLoading && source !== 'builtin' && !scripts.length;

    if (!scripts.length && !showSkeletons) {
      const filtered = Boolean(query) || state.hubCategory !== 'all';
      el.hubGrid.innerHTML = `
        <div class="empty-wide">
          <span class="empty-icon">${icon('search')}</span>
          <strong>${filtered ? 'No scripts match that search' : 'No community scripts loaded'}</strong>
          <span>${
            filtered
              ? 'Try another term or clear the category filter.'
              : 'Check the provider connection, then retry.'
          }</span>
          ${filtered
            ? '<button class="btn small" data-clear-hub>Clear filters</button>'
            : '<button class="btn small" data-hub-retry>Retry providers</button>'}
        </div>`;
      el.hubGrid.querySelector('[data-clear-hub]')?.addEventListener('click', () => {
        state.hubQuery = '';
        state.hubCategory = 'all';
        el.hubSearch.value = '';
        resetHubProvidersForQuery('');
        state.hubLoading = state.hubSource !== 'builtin';
        renderHubCategories();
        renderHubGrid();
        scheduleHubFetch();
      });
      updateHubStatus();
      return;
    }

    const canMore =
      !state.hubLoading &&
      hubActiveProviders().some((id) => {
        const provider = state.hubProviders[id];
        return provider.loaded && provider.hasMore && provider.query === state.hubQuery.trim();
      });

    const cards = scripts.map(hubCard).join('');
    const skeletons = showSkeletons ? Array.from({ length: 3 }, hubSkeleton).join('') : '';
    const more = canMore
      ? `<div class="hub-more"><button class="btn small ghost" data-hub-more>Load more community scripts</button></div>`
      : '';

    el.hubGrid.innerHTML = cards + skeletons + more;
    updateHubStatus();
  }

  function scriptCover(script, compact = false) {
    const category = script.category || 'utility';
    const meta = CATEGORY_META[category] || CATEGORY_META.utility;
    const image =
      typeof script.image === 'string' && /^https:\/\/[^\s]+$/i.test(script.image)
        ? script.image
        : '';

    return `
      <div class="cover${compact ? ' compact' : ''}" data-category="${esc(category)}">
        <div class="cover-art" aria-hidden="true">
          <span class="cover-glyph">${icon(meta.icon)}</span>
          ${compact ? '' : `<span class="cover-cat">${esc(meta.label)}</span>`}
        </div>
        ${
          image
            ? `<img class="cover-img" src="${esc(image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`
            : ''
        }
      </div>`;
  }

  function hubCard(script) {
    const source = hubItemSource(script);
    const meta = CATEGORY_META[script.category] || CATEGORY_META.utility;
    const external = source !== 'builtin';
    const providerLabel = external ? HUB_PROVIDERS[source]?.label || source : 'Built-in';
    const views = Number(script.views) || 0;
    const heading = external
      ? `${script.game || 'Unknown game'}${views ? ` · ${formatCount(views)} views` : ''}`
      : `${meta.label} · ${lineCount(script.code)} lines`;
    const badge = `<span class="tag source-tag" data-source="${esc(source)}">${esc(providerLabel)}</span>`;
    const flags = external
      ? [
          script.verified ? { tone: 'verified', label: 'Verified' } : null,
          script.keyless && !/keyless|no[ -]?key/i.test(`${script.title} ${script.blurb}`)
            ? { tone: 'keyless', label: 'Keyless' }
            : null,
          script.patched ? { tone: 'patched', label: 'Patched' } : null,
        ].filter(Boolean)
      : [];
    const flagRow = flags.length
      ? `<div class="hub-flags">${flags
          .map((flag) => `<span class="hub-flag ${flag.tone}">${esc(flag.label)}</span>`)
          .join('')}</div>`
      : '';

    return `
      <article class="hub-card" data-detail-id="${esc(script.id)}" data-category="${esc(script.category || 'utility')}" data-source="${esc(
        source,
      )}">
        <button class="cover-button" aria-haspopup="dialog" aria-label="View details for ${esc(
          script.title,
        )}">${scriptCover(script)}</button>
        <div class="hub-card-body">
          <div class="hub-top">
            <div class="hub-heading">
              <h3 title="${esc(script.title)}">${esc(script.title)}</h3>
              <span>${esc(heading)}</span>
            </div>
            <button class="icon-btn tiny" data-save-hub="${esc(script.id)}" title="Save to library"
              aria-label="Save ${esc(script.title)} to library">${icon('bookmark')}</button>
          </div>
          <p class="hub-blurb">${esc(script.blurb)}</p>
          ${flagRow}
          <div class="hub-foot">
            ${badge}
            <div class="hub-actions">
              <button class="btn small ghost" data-open-hub="${esc(script.id)}">Open in editor</button>
              <button class="btn small accent" data-run-hub="${esc(script.id)}">${icon('play')} Run</button>
            </div>
          </div>
        </div>
      </article>`;
  }

  function hubSkeleton() {
    return `
      <article class="hub-card skeleton" aria-hidden="true">
        <span class="skeleton-block skeleton-cover"></span>
        <div class="hub-card-body">
          <div class="hub-top">
            <div class="hub-heading">
              <span class="skeleton-block title"></span>
              <span class="skeleton-block meta"></span>
            </div>
          </div>
          <span class="skeleton-block blurb"></span>
          <span class="skeleton-block blurb short"></span>
          <div class="hub-foot">
            <span class="skeleton-block tag"></span>
            <span class="skeleton-block action"></span>
          </div>
        </div>
      </article>`;
  }

  function handleHubAction(event) {
    if (event.target.closest('[data-hub-retry]')) {
      retryHub();
      return;
    }

    const open = event.target.closest('[data-open-hub]');
    if (open) {
      openHubScript(open.dataset.openHub);
      return;
    }

    const run = event.target.closest('[data-run-hub]');
    if (run) {
      const script = findHubScript(run.dataset.runHub);
      if (script) executeScript(script.code, script.title);
      return;
    }

    const save = event.target.closest('[data-save-hub]');
    if (save) {
      const script = findHubScript(save.dataset.saveHub);
      if (script) saveHubScript(script);
      return;
    }

    if (event.target.closest('[data-hub-more]')) {
      loadHubExternal({ append: true });
      return;
    }
    const card = event.target.closest('[data-detail-id]');
    if (card) showHubDetail(card);
  }

  function showHubDetail(card) {
    const script = findHubScript(card.dataset.detailId);
    if (!script) return;
    const dialog = $('#hubDetail');
    const fromHome = el.homePicks.contains(card);
    $('#hubBack').lastChild.textContent = fromHome ? ' Back to home' : ' Back to hub';
    const provider = HUB_PROVIDERS[hubItemSource(script)]?.label || 'Built-in';
    const meta = CATEGORY_META[script.category] || CATEGORY_META.utility;
    const date = new Date(script.updatedAt);
    const facts = [
      ['Category', meta.label], ['Game', script.game], ['Author', script.author],
      ['Views', script.views ? formatCount(script.views) : ''],
      ['Updated', script.updatedAt && Number.isFinite(date.getTime()) ? date.toLocaleDateString() : ''],
    ].filter(([, value]) => value);
    $('#hubDetailProvider').textContent = provider;
    $('#hubDetailBody').innerHTML = `
      ${scriptCover(script)}
      <div class="detail-copy">
        <h1 id="hubDetailTitle">${esc(script.title)}</h1>
        <p>${esc(script.blurb || '')}</p>
        <dl>${facts.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>
        <div class="detail-tags">${(script.tags || []).map(tag => `<span class="tag">${esc(tag)}</span>`).join('')}</div>
        <button class="btn primary" id="hubDetailEdit">Open in editor</button>
      </div>`;
    $('#hubDetailEdit').onclick = () => { dialog.close(); openHubScript(script.id); };
    const id = script.id;
    dialog.addEventListener('close', () => {
      if (fromHome && state.page === 'home') card.focus({ preventScroll: true });
      if (state.page !== 'scripts') return;
      el.hubGrid.querySelector(`[data-detail-id="${CSS.escape(id)}"] .cover-button`)?.focus({ preventScroll: true });
    }, { once: true });
    dialog.showModal();
    dialog.scrollTop = 0;
  }

  function openHubScript(id) {
    const script = findHubScript(id);
    if (!script) return;
    newDocument(script.title, script.code);
    go('editor');
    pushActivity('file', `Opened ${script.title}`);
  }

  async function saveHubScript(script) {
    if (
      state.scripts.some(
        (item) => String(item.name).toLowerCase() === String(script.title).toLowerCase(),
      )
    ) {
      toast('That script is already in your library', 'info');
      return;
    }

    const saved = {
      id: uid(),
      name: uniqueScriptName(script.title),
      code: script.code,
      category: script.category,
      updatedAt: Date.now(),
      image: script.image || '',
      source: hubItemSource(script),
      game: script.game || '',
      author: script.author || '',
      views: Number(script.views) || 0,
      url: script.url || '',
    };

    if (!await persistScripts(scripts => [...scripts, saved])) return;
    toast(`Saved ${saved.name}`, 'success');
    pushActivity('bookmark', `Saved ${saved.name}`);
  }

  function renderLibrary() {
    const query = state.libraryQuery.trim().toLowerCase();
    const scripts = [...state.scripts]
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .filter((script) => !query || script.name.toLowerCase().includes(query));

    el.libraryBadge.textContent = String(state.scripts.length);

    if (!scripts.length) {
      el.libraryGrid.innerHTML = `
        <div class="empty-wide">
          <span class="empty-icon">${icon('bookmark')}</span>
          <strong>${query ? 'No saved scripts match' : 'Your library is empty'}</strong>
          <span>${query ? 'Try another name.' : 'Save a tab from the editor, or add something from the hub.'}</span>
          <button class="btn small" data-library-browse>Browse the hub</button>
        </div>`;
      el.libraryGrid.querySelector('[data-library-browse]').addEventListener('click', () => {
        setScriptsView('hub');
      });
      return;
    }

    el.libraryGrid.innerHTML = scripts
      .map((script) => {
        const preview =
          script.code
            .split('\n')
            .filter((line) => line.trim())
            .slice(0, 2)
            .join('\n') || 'Empty script';
        const origin =
          script.source && HUB_PROVIDERS[script.source]
            ? `${HUB_PROVIDERS[script.source].label} · `
            : '';

        return `
          <article class="library-card" data-category="${esc(script.category || 'utility')}">
            <button class="cover-button" data-open-library="${esc(script.id)}" aria-label="Open ${esc(
              script.name,
            )}">${scriptCover(script)}</button>
            <div class="lib-body">
              <div class="lib-top">
                <div class="lib-heading">
                  <h3>${esc(script.name)}</h3>
                  <span>${origin}${lineCount(script.code)} lines · ${timeAgo(script.updatedAt)}</span>
                </div>
                ${savedScriptButtons(script)}
              </div>
              <pre class="lib-preview">${esc(truncate(preview, 140))}</pre>
              <div class="lib-foot">
                <button class="btn small ghost" data-open-library="${esc(script.id)}">Open</button>
                <button class="btn small accent" data-run-library="${esc(script.id)}">${icon('play')} Run</button>
              </div>
            </div>
          </article>`;
      })
      .join('');
  }

  function savedScriptButtons(script) {
    const id = esc(script.id);
    const name = esc(script.name);
    return `
      <button class="icon-btn tiny" data-rename-library="${id}" title="Rename saved script"
        aria-label="Rename ${name}">${icon('pencil')}</button>
      <button class="icon-btn tiny" data-delete-library="${id}" title="Delete saved script"
        aria-label="Delete ${name}">${icon('trash')}</button>`;
  }

  function handleLibraryAction(event) {
    const button = event.target.closest('button');
    if (!button) return;
    const { openScript, openLibrary, renameLibrary, deleteLibrary, runLibrary } = button.dataset;
    const id = openScript || openLibrary || renameLibrary || deleteLibrary || runLibrary;
    const script = state.scripts.find(item => item.id === id);
    if (!script) return;

    if (renameLibrary) renameSavedScript(script);
    else if (deleteLibrary) deleteScript(script);
    else if (runLibrary) executeScript(script.code, script.name);
    else openSavedScript(script.id);
  }

  async function renameSavedScript(script) {
    const requested = await promptDialog({
      title: 'Rename script',
      label: 'Script name',
      value: script.name,
      confirmText: 'Rename',
    });
    if (!requested || requested === script.name) return;

    let name;
    const saved = await persistScripts(scripts => {
      if (!scripts.some(item => item.id === script.id)) return scripts;
      name = uniqueScriptName(requested, script.id);
      return scripts.map(item => item.id === script.id ? { ...item, name } : item);
    });
    if (!saved || !name) return;

    // An open tab may have unsaved edits. Only its label follows the rename.
    for (const doc of state.docs) {
      if (doc.originId === script.id) doc.name = name;
    }
    renderTabs();
    scheduleSessionSave();
    toast(`Renamed to ${name}`, 'success');
  }

  async function deleteScript(script) {
    if (state.config.confirmDelete) {
      const confirmed = await confirmDialog({
        title: 'Delete script?',
        message: `“${script.name}” will be removed from your library. Open tabs are kept.`,
        confirmText: 'Delete',
      });
      if (!confirmed) return;
    }

    if (!await persistScripts(scripts => scripts.filter(item => item.id !== script.id))) return;
    state.docs.forEach((doc) => {
      if (doc.originId === script.id) doc.originId = null;
    });

    scheduleSessionSave();
    renderTabs();
    renderExplorer();
    updateDirtyUI();
    toast('Script deleted', 'info');
    pushActivity('trash', `Deleted ${script.name}`);
  }

  /* ------------------------------------------------------------------ *
   * Settings
   * ------------------------------------------------------------------ */

  function fillSettings() {
    el.profileAvatar.textContent = initials(state.user.username, 'A').slice(0, 1);
    el.profileName.textContent = state.user.username;
    el.profileMeta.textContent = `${state.user.hostname || 'This machine'} · ${
      PLATFORM_LABELS[state.user.platform] || 'Local'
    } account`;
    el.settingsUserFoot.textContent = `${state.user.username} · local account`;
    if (el.profileNameInput) {
      el.profileNameInput.value = state.config.displayName || '';
      el.profileNameInput.placeholder = state.user.windowsUsername || 'Windows username';
    }

    setSwitch($('#toggleRestore'), state.config.restoreTabs);
    setSwitch($('#toggleConfirm'), state.config.confirmDelete);
    setSwitch($('#toggleGlow'), state.config.glow);
    setSwitch($('#toggleCompact'), state.config.compact);
    setSwitch($('#toggleMotion'), state.config.motion);
    setSwitch($('#toggleWrap'), state.config.editor.wrap);
    setSwitch($('#toggleLineNumbers'), state.config.editor.lineNumbers);
    setSwitch($('#toggleHighlightLine'), state.config.editor.highlightLine);
    setSwitch($('#toggleAutoIndent'), state.config.editor.autoIndent);

    el.fontSize.value = String(state.config.editor.fontSize);
    el.fontSizeVal.textContent = String(state.config.editor.fontSize);
    el.tabSize.value = String(state.config.editor.tabSize);

    el.bridgePort.value = String(state.config.bridge.port);
    setSwitch(el.bridgeEnabled, state.config.bridge.enabled);

    if (!el.loaderPreview.textContent || el.loaderPreview.textContent === 'Loading…') {
      el.loaderPreview.textContent = state.bridge.loader || 'Loading…';
    }

    el.aboutVersion.textContent = state.app.version || '—';
    el.aboutElectron.textContent = state.app.electron || '—';
    el.aboutChrome.textContent = state.app.chrome || '—';
    el.aboutPlatform.textContent = `${PLATFORM_LABELS[state.app.platform] || state.app.platform || 'Unknown'} · ${
      state.app.arch || '—'
    }`;

    renderThemeGrid();
    renderAccents();
    updateAppearanceControls();
    renderConnectionStatus();
  }

  function setSettingsSection(section) {
    if (!SETTINGS_META[section]) return;
    state.settingsSection = section;

    $$('button', el.settingsNav).forEach((button) => {
      button.classList.toggle('active', button.dataset.sec === section);
    });
    $$('.settings-section', el.settingsScroll).forEach((panel) => {
      panel.classList.toggle('active', panel.dataset.sec === section);
    });

    el.settingsTitle.textContent = SETTINGS_META[section].title;
    el.settingsSub.textContent = SETTINGS_META[section].sub;
    el.settingsScroll.scrollTop = 0;
  }

  function renderThemeGrid() {
    el.themeGrid.innerHTML = THEMES.map(
      (theme) => `
      <button class="theme-card ${state.config.theme === theme.id ? 'selected' : ''}"
        data-theme-id="${theme.id}" aria-pressed="${state.config.theme === theme.id}">
        <span class="theme-preview" style="--tp-bg:${theme.bg};--tp-panel:${theme.panel};--tp-elev:${theme.elev};--tp-accent:${theme.accent}">
          <span class="tp-bar"></span>
          <span class="tp-side"></span>
          <span class="tp-body"><i></i><i></i><i></i></span>
          <span class="tp-pill"></span>
        </span>
        <span class="theme-label">${theme.name}${state.config.theme === theme.id ? icon('check') : ''}</span>
      </button>`,
    ).join('');
  }

  function renderAccents() {
    el.accentRow.innerHTML = ACCENTS.map(
      (accent) => `
      <button class="swatch ${state.config.accent.toLowerCase() === accent.toLowerCase() ? 'selected' : ''}"
        data-accent="${accent}" style="--swatch:${accent}" title="${accent}"
        aria-label="Use accent ${accent}" aria-pressed="${
          state.config.accent.toLowerCase() === accent.toLowerCase()
        }"><span></span></button>`,
    ).join('');
  }

  function updateAppearanceControls() {
    setSwitch($('#toggleGlow'), state.config.glow);
    setSwitch($('#toggleCompact'), state.config.compact);
    setSwitch($('#toggleMotion'), state.config.motion);
  }

  function renderConnectionStatus() {
    const running = state.bridge.running;
    const enabled = state.config.bridge.enabled;
    const count = state.clients.length;

    el.bridgeBadge.textContent = running ? 'Running' : state.bridge.error ? 'Error' : 'Stopped';
    el.bridgeBadge.className = `badge ${running ? 'ok' : state.bridge.error ? 'bad' : 'muted'}`;

    let dotTone = 'bad';
    if (running) dotTone = count ? 'ok' : 'idle';
    el.settingsDot.className = `status-dot ${dotTone}`;

    el.settingsBridgeText.textContent = running
      ? `127.0.0.1:${state.bridge.port} · ${count} client${count === 1 ? '' : 's'}`
      : state.bridge.error || (enabled ? 'Not running' : 'Disabled');

    setSwitch(el.bridgeEnabled, enabled);
    if (state.bridge.loader) el.loaderPreview.textContent = state.bridge.loader;

    const loaderVersion = /LOADER_VERSION\s*=\s*(\d+)/.exec(state.bridge.loader || '');
    if (loaderVersion && el.loaderVersion) {
      el.loaderVersion.textContent = `v${loaderVersion[1]}`;
    }

    renderClientManager();
  }

  function renderClientManager() {
    if (!el.clientManageList) return;

    const count = state.clients.length;
    el.disconnectAllClients.disabled = count === 0;

    if (!count) {
      el.clientManageList.innerHTML = `
        <div class="client-manage-empty">
          No clients connected. Run the loader inside your executor to attach one.
        </div>`;
      return;
    }

    el.clientManageList.innerHTML = state.clients
      .map((client) => {
        const readiness = client.unresponsive
          ? '<span class="client-state-badge bad">Not answering</span>'
          : Number(client.loader) < 2
            ? '<span class="client-state-badge bad">Stale loader</span>'
            : client.verified
              ? '<span class="client-state-badge ok">Ready</span>'
              : '<span class="client-state-badge pending">Handshaking</span>';

        return `
        <div class="client-manage-row">
          <span class="client-avatar ${avatarTone(client.id)}">${esc(initials(client.game))}</span>
          <div class="client-manage-copy">
            <strong>${esc(client.game)}</strong>
            <span>${esc(client.player)} · ${esc(client.executor)}</span>
          </div>
          ${readiness}
          <span class="client-place">PID ${esc(client.placeId || '—')}</span>
          <button class="btn small ghost" data-manage-disconnect="${esc(client.id)}">Disconnect</button>
        </div>`;
      })
      .join('');
  }

  async function disconnectClient(id) {
    const client = state.clients.find((item) => item.id === id);

    try {
      const result = await api.disconnectClient(id);
      if (result && result.ok) {
        toast(`Disconnected ${client?.game || 'client'}`, 'success');
      } else {
        toast('That client is already disconnected', 'info');
      }
    } catch (error) {
      toast(error.message || 'Could not disconnect that client', 'error');
    }
  }

  async function applyBridgeSettings({ enabled, port }) {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      el.bridgeApplyResult.textContent = 'Port must be between 1024 and 65535';
      return;
    }

    const previousPort = state.config.bridge.port;
    el.bridgeApplyResult.textContent = 'Applying…';
    setSwitch(el.bridgeEnabled, enabled);

    try {
      const result = await api.setBridge({ port, enabled });
      state.config.bridge = { port, enabled };
      const nextClients = result.state.running ? result.state.clients || [] : [];
      state.clients = nextClients;
      state.bridge = { ...state.bridge, ...result.state, clients: nextClients };
      if (!result.state.running) {
        state.targets.clear();
        state.targetAll = true;
      }

      if (result.state.running) {
        el.bridgeApplyResult.textContent = `Listening on ${result.state.port}`;
        toast(
          previousPort !== port ? 'Bridge applied — copy the new loader' : 'Bridge applied',
          'success',
        );
      } else {
        el.bridgeApplyResult.textContent = result.state.error || 'Bridge stopped';
        if (result.state.error) toast(result.state.error, 'error');
        else toast('Bridge stopped', 'info');
      }

      renderConnectionStatus();
      updateTargetUI();
      renderBridgeGlobal();
      renderHome();
      if (!el.clientsPopover.hidden) renderClientsPopover();
    } catch (error) {
      el.bridgeApplyResult.textContent = error.message || 'Could not apply the setting';
      toast(error.message || 'Could not apply the setting', 'error');
    }
  }

  /* ------------------------------------------------------------------ *
   * Loader + modals
   * ------------------------------------------------------------------ */

  function handleUpdateResult(result) {
    state.update = result;
    const { phase, latest, current, percent, error, canDownload, opened } = result;
    const labels = {
      checking: 'Checking for updates…',
      current: `Up to date (${current})`,
      available: `Update available: ${current} → ${latest}`,
      downloading: `Downloading Aether ${latest} · ${percent}%`,
      ready: opened ? 'Installer opened. Follow the Windows setup prompts.' : `Aether ${latest} is ready to install.`,
      opening: 'Opening the installer…',
    };
    el.updateStatus.textContent = error || labels[phase] || 'Could not check for updates';
    el.checkUpdates.disabled = ['checking', 'downloading', 'ready', 'opening'].includes(phase);
    el.updateAction.hidden = !(phase === 'available' && canDownload || phase === 'ready');
    el.updateAction.textContent = phase === 'ready' ? 'Run installer' : 'Download update';
    el.viewRelease.hidden = !['available', 'error', 'ready'].includes(phase);
    if (phase === 'available' && state.promptedVersion !== latest && el.modalRoot.hidden) {
      state.promptedVersion = latest;
      openModal({
        title: 'Aether update available',
        subtitle: `${current} → ${latest}`,
        content: '<p class="modal-text">' + (canDownload
          ? 'Download the Windows installer now. You can start setup when you are ready.'
          : 'Open the GitHub release for downloads and release details.') + '</p>',
        actions: [
          { label: canDownload ? 'Download update' : 'View release', kind: 'primary',
            onClick: () => { if (canDownload) void runUpdateAction(); else void openRelease(); } },
          { label: 'Later', kind: 'ghost' },
        ],
      });
    }
  }

  async function openRelease() {
    try {
      const result = await api.openExternal(state.update.url);
      if (!result.ok) throw new Error(result.message);
    } catch (error) {
      toast(error.message || 'Could not open GitHub', 'error');
    }
  }

  async function runUpdateAction() {
    try {
      if (state.update.phase === 'ready') {
        syncEditorToDoc();
        const saved = await api.setSession({ docs: state.docs, active: state.active });
        if (!saved) throw new Error('Could not save your open tabs before starting setup.');
        await api.installUpdate();
      } else if (state.update.phase === 'available') {
        const result = await api.downloadUpdate();
        if (result.phase === 'ready') toast('Download verified. Run the installer from Settings → About.', 'success');
        else if (result.error) toast(result.error, 'error');
      }
    } catch (error) {
      toast(error.message || 'Update action failed', 'error');
    }
  }

  async function checkForUpdates(manual = false) {
    try {
      const result = await api.checkForUpdates();
      handleUpdateResult(result);
      if (manual && result.phase === 'current') toast(`Aether ${result.current} is up to date`, 'success');
    } catch (error) {
      handleUpdateResult({ phase: 'error', error: error.message, url: 'https://github.com/GamingCat9439/Aether/releases' });
    }
  }

  async function copyLoader(usePreview = false) {
    let loader = usePreview ? el.loaderPreview.textContent : state.bridge.loader;
    if (!loader || loader === 'Loading…') {
      const info = await api.getBridge().catch(() => null);
      loader = info?.loader || '';
    }
    if (!loader) {
      toast('The loader is not available yet', 'error');
      return;
    }
    await api.copyText(loader);
    toast('Loader script copied to the clipboard', 'success');
  }

  function openConnectModal(note = '') {
    const running = state.bridge.running;
    const loader = state.bridge.loader || '-- Loader is still loading --';

    const content = `
      <div class="connect-state ${running ? 'ok' : 'bad'}">
        ${icon(running ? 'plug' : 'alert')}
        <span>${
          running
            ? `Bridge listening on <code>127.0.0.1:${state.bridge.port}</code>`
            : esc(state.bridge.error || 'The bridge is not running yet')
        }</span>
      </div>
      ${note ? `<p class="modal-text">${esc(note)}</p>` : ''}
      <ol class="steps">
        <li><span>1</span><div><strong>Open your executor</strong><p>Attach Potassium, or any executor with <code>WebSocket</code> support, to the game.</p></div></li>
        <li><span>2</span><div><strong>Run the loader</strong><p>Paste the script below into the executor's editor and execute it once.</p></div></li>
        <li><span>3</span><div><strong>Pick a target</strong><p>The client appears here automatically. Run on one client or all of them.</p></div></li>
      </ol>
      <div class="loader-block">
        <div class="loader-block-head">
          <span>bridge.lua</span>
          <button class="link tiny" data-copy-inline>${icon('copy')} Copy</button>
        </div>
        <pre class="loader-code" id="connectLoader">${esc(loader)}</pre>
      </div>
      <p class="modal-note">The loader stays connected and retries if Aether restarts. Run it again after rejoining a game. A client shows <strong>Ready</strong> once it answers the bridge.</p>
    `;

    openModal({
      title: 'Connect a client',
      subtitle: 'One loader, every executor.',
      content,
      actions: [
        {
          label: 'Copy loader script',
          kind: 'primary',
          close: false,
          onClick: () => copyLoader(),
        },
        {
          label: 'Connection settings',
          kind: 'ghost',
          onClick: () => {
            setSettingsSection('connection');
            go('settings');
          },
        },
        { label: 'Done', kind: 'ghost' },
      ],
      onMount: (modal) => {
        modal.querySelector('[data-copy-inline]')?.addEventListener('click', copyLoader);
      },
    });
  }

  let modalInstance = null;

  function openModal({
    title,
    subtitle = '',
    content = '',
    actions = [],
    onMount = null,
    onClose = null,
  }) {
    closeModal();

    el.modalRoot.hidden = false;
    el.modalRoot.innerHTML = '';

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.tabIndex = -1;
    modal.innerHTML = `
      <header class="modal-head">
        <div>
          <h2>${esc(title)}</h2>
          ${subtitle ? `<p>${esc(subtitle)}</p>` : ''}
        </div>
        <button class="icon-btn" data-modal-close aria-label="Close dialog">${icon('x')}</button>
      </header>
      <div class="modal-body">${content}</div>
    `;

    if (actions.length) {
      const footer = document.createElement('footer');
      footer.className = 'modal-actions';

      actions.forEach((action) => {
        const button = document.createElement('button');
        button.className = `btn ${action.kind || 'ghost'}`.trim();
        button.textContent = action.label;
        button.addEventListener('click', async () => {
          const outcome = action.onClick ? await action.onClick(modal) : undefined;
          if (action.close !== false && outcome !== false) closeModal();
        });
        footer.appendChild(button);
      });

      modal.appendChild(footer);
    }

    el.modalRoot.appendChild(modal);
    modal.querySelector('[data-modal-close]').addEventListener('click', closeModal);

    modalInstance = { onClose };
    if (typeof onMount === 'function') onMount(modal);

    const input = modal.querySelector('input');
    const focusTarget = input || modal;
    requestAnimationFrame(() => {
      focusTarget.focus({ preventScroll: true });
      if (input) input.select?.();
    });
  }

  function closeModal() {
    if (el.modalRoot.hidden) return;
    const instance = modalInstance;
    modalInstance = null;
    el.modalRoot.hidden = true;
    el.modalRoot.innerHTML = '';
    if (instance?.onClose) instance.onClose();
  }

  function confirmDialog({ title, message, confirmText = 'Confirm' }) {
    return new Promise((resolve) => {
      let settled = false;

      const finish = (value) => {
        if (settled) return;
        settled = true;
        closeModal();
        resolve(value);
      };

      openModal({
        title,
        content: `<p class="modal-text">${esc(message)}</p>`,
        actions: [
          { label: 'Cancel', kind: 'ghost', close: false, onClick: () => finish(false) },
          {
            label: confirmText,
            kind: 'danger',
            close: false,
            onClick: () => finish(true),
          },
        ],
        onClose: () => finish(false),
      });
    });
  }

  function promptDialog({ title, subtitle = '', label, value = '', placeholder = '', confirmText = 'Save' }) {
    return new Promise((resolve) => {
      let settled = false;

      const finish = (result) => {
        if (settled) return;
        settled = true;
        closeModal();
        resolve(result);
      };

      const submit = () => {
        const input = $('#modalInput', el.modalRoot);
        const result = input?.value.trim();
        if (!result) {
          input?.focus();
          return;
        }
        finish(result);
      };

      openModal({
        title,
        subtitle,
        content: `
          <label class="field modal-field">
            <span>${esc(label)}</span>
            <input id="modalInput" value="${esc(value)}" placeholder="${esc(placeholder)}" />
          </label>`,
        actions: [
          { label: 'Cancel', kind: 'ghost', close: false, onClick: () => finish(null) },
          { label: confirmText, kind: 'primary', close: false, onClick: submit },
        ],
        onMount: (modal) => {
          const input = modal.querySelector('#modalInput');
          input?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submit();
            }
          });
        },
        onClose: () => finish(null),
      });
    });
  }

  function toast(message, kind = 'success') {
    while (el.toastHost.children.length >= 3) {
      el.toastHost.firstElementChild.remove();
    }

    const node = document.createElement('div');
    node.className = `toast toast-${kind}`;
    const iconName = kind === 'error' || kind === 'warn' ? 'alert' : 'check';
    node.innerHTML = `${icon(iconName)}<span></span><button class="toast-close" aria-label="Dismiss">${icon(
      'x',
    )}</button>`;

    const text = node.querySelector('span');
    text.textContent = message;

    const remove = () => {
      node.classList.remove('show');
      setTimeout(() => node.remove(), 180);
    };

    node.querySelector('.toast-close').addEventListener('click', remove);
    el.toastHost.appendChild(node);
    requestAnimationFrame(() => node.classList.add('show'));
    setTimeout(remove, 4200);
  }

  /* ------------------------------------------------------------------ *
   * Go
   * ------------------------------------------------------------------ */

  init().catch((error) => {
    console.error(error);
    toast(error.message || 'The interface failed to start', 'error');
  });
})();
