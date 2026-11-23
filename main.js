'use strict';

const { app, BrowserWindow, Menu, ipcMain, clipboard, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { BridgeServer } = require('./bridge');
const { fetchHub } = require('./hub-providers');

app.setName('Aether');

const runtime = {
  win: null,
  config: null,
  bridge: new BridgeServer(),
  bridgeError: '',
  loader: '',
  updateCheck: null,
};

const THEMES = new Set(['graphite', 'midnight', 'forest', 'ember', 'plum', 'paper']);
const ACCENT_RE = /^#[0-9a-f]{6}$/i;
const EXTERNAL_HOSTS = new Set([
  'scriptblox.com',
  'www.scriptblox.com',
  'docs.scriptblox.com',
  'robloxscripts.com',
  'www.robloxscripts.com',
  'docs.robloxscripts.com',
  'github.com',
  'www.github.com',
]);

const GITHUB_OWNER = 'GamingCat9439';
const GITHUB_REPO = 'Aether';
const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`;
const GITHUB_LATEST_API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

const DEFAULTS = {
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
  bridge: {
    port: 7963,
    enabled: true,
  },
};

function storagePath(name) {
  return path.join(app.getPath('userData'), name);
}

function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(storagePath(name), 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(name, value) {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(storagePath(name), JSON.stringify(value, null, 2), 'utf8');
  } catch (error) {
    console.error(`Could not write ${name}:`, error.message);
  }
}

const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback);
const clampInt = (value, min, max, fallback) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
};

function mergeConfig(input) {
  const source = input && typeof input === 'object' ? input : {};
  const editor = source.editor && typeof source.editor === 'object' ? source.editor : {};
  const bridge = source.bridge && typeof source.bridge === 'object' ? source.bridge : {};
  const base = runtime.config || DEFAULTS;
  const displayName = typeof source.displayName === 'string'
    ? source.displayName.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 40)
    : base.displayName;

  return {
    theme: THEMES.has(source.theme) ? source.theme : base.theme,
    displayName,
    accent: ACCENT_RE.test(String(source.accent || '')) ? source.accent : base.accent,
    glow: bool(source.glow, base.glow),
    motion: bool(source.motion, base.motion),
    compact: bool(source.compact, base.compact),
    restoreTabs: bool(source.restoreTabs, base.restoreTabs),
    confirmDelete: bool(source.confirmDelete, base.confirmDelete),
    editor: {
      fontSize: clampInt(editor.fontSize, 11, 20, base.editor.fontSize),
      tabSize: editor.tabSize === 4 ? 4 : 2,
      wrap: bool(editor.wrap, base.editor.wrap),
      lineNumbers: bool(editor.lineNumbers, base.editor.lineNumbers),
      highlightLine: bool(editor.highlightLine, base.editor.highlightLine),
      autoIndent: bool(editor.autoIndent, base.editor.autoIndent),
    },
    bridge: {
      port: clampInt(bridge.port, 1024, 65535, base.bridge.port),
      enabled: bool(bridge.enabled, base.bridge.enabled),
    },
  };
}

// The accent used to default to this blue. Saved settings that still hold it are moved
// to the new white default, because the old default cannot be told apart from a choice.
const LEGACY_ACCENT = '#7c9cff';

function loadConfig() {
  const stored = readJson('config.json', {});
  if (String(stored?.accent || '').toLowerCase() === LEGACY_ACCENT) {
    stored.accent = DEFAULTS.accent;
  }
  runtime.config = mergeConfig(stored);
  return runtime.config;
}

function saveConfig(next) {
  runtime.config = next;
  writeJson('config.json', runtime.config);
  return runtime.config;
}

function userInfo() {
  let windowsUsername = '';
  try {
    windowsUsername = os.userInfo().username || '';
  } catch {
    windowsUsername = process.env.USERNAME || process.env.USER || 'user';
  }
  windowsUsername = windowsUsername || 'user';

  let hostname = '';
  try {
    hostname = os.hostname();
  } catch {
    hostname = '';
  }

  return {
    windowsUsername,
    username: runtime.config.displayName || windowsUsername,
    hostname,
    platform: process.platform,
  };
}

function loaderScript(port) {
  if (!runtime.loader) {
    try {
      runtime.loader = fs.readFileSync(path.join(__dirname, 'bridge-script.lua'), 'utf8');
    } catch {
      runtime.loader = '-- bridge-script.lua is missing';
    }
  }
  return runtime.loader.replace('__PORT__', String(port));
}

function friendlyBridgeError(error, port) {
  if (!error) return '';
  if (error.code === 'EADDRINUSE') return `Port ${port} is already in use`;
  if (error.code === 'EACCES') return `Port ${port} needs elevated permission`;
  return error.message || 'The bridge could not start';
}

function bridgeState() {
  return {
    running: runtime.bridge.running,
    port: runtime.bridge.port || runtime.config.bridge.port,
    enabled: runtime.config.bridge.enabled,
    error: runtime.bridgeError,
    clients: runtime.bridge.listClients(),
    loader: loaderScript(runtime.config.bridge.port),
  };
}

function send(channel, payload) {
  if (runtime.win && !runtime.win.isDestroyed()) {
    runtime.win.webContents.send(channel, payload);
  }
}

function versionParts(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/i.exec(String(version || '').trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function isNewerVersion(latest, current) {
  const left = versionParts(latest);
  const right = versionParts(current);
  if (!left || !right) return false;
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return false;
}

async function checkForUpdates(manual = false) {
  if (runtime.updateCheck) return runtime.updateCheck;

  runtime.updateCheck = (async () => {
    try {
      const response = await fetch(GITHUB_LATEST_API_URL, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `Aether-${app.getVersion()}`,
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        throw new Error(response.status === 403
          ? 'GitHub update checks are temporarily unavailable'
          : `GitHub returned HTTP ${response.status}`);
      }

      const release = await response.json();
      const latestVersion = String(release.tag_name || '').trim();
      const available = Boolean(latestVersion && isNewerVersion(latestVersion, app.getVersion()));
      const result = {
        ok: true,
        available,
        currentVersion: app.getVersion(),
        latestVersion: latestVersion || 'Unknown',
        releaseName: String(release.name || latestVersion || 'Aether release'),
        releaseUrl: String(release.html_url || GITHUB_RELEASES_URL),
        publishedAt: String(release.published_at || ''),
        checkedAt: new Date().toISOString(),
      };

      if (available && !manual) send('app:update-available', result);
      return result;
    } catch (error) {
      return {
        ok: false,
        available: false,
        currentVersion: app.getVersion(),
        latestVersion: 'Unknown',
        releaseName: '',
        releaseUrl: GITHUB_RELEASES_URL,
        checkedAt: new Date().toISOString(),
        error: error?.message || 'Could not check for updates',
      };
    }
  })();

  const result = await runtime.updateCheck;
  runtime.updateCheck = null;
  return result;
}

async function applyBridge() {
  const { enabled, port } = runtime.config.bridge;

  if (!enabled) {
    await runtime.bridge.stop().catch(() => {});
    runtime.bridgeError = '';
    send('bridge:state', bridgeState());
    return;
  }

  try {
    await runtime.bridge.start(port);
    runtime.bridgeError = '';
  } catch (error) {
    runtime.bridgeError = friendlyBridgeError(error, port);
  }

  send('bridge:state', bridgeState());
}

function sanitizeScripts(input) {
  if (!Array.isArray(input)) return [];

  return input.slice(0, 500).map((entry) => {
    const item = entry && typeof entry === 'object' ? entry : {};
    const id =
      typeof item.id === 'string' && /^[a-zA-Z0-9_-]{4,64}$/.test(item.id)
        ? item.id
        : crypto.randomUUID();
    const image = String(item.image || '');
    const url = String(item.url || '');
    const source = String(item.source || '');

    return {
      id,
      name: String(item.name || 'Untitled').slice(0, 100),
      code: String(item.code || '').slice(0, 2 * 1024 * 1024),
      category: String(item.category || '').slice(0, 40),
      updatedAt: Number(item.updatedAt) || Date.now(),
      image:
        image.length <= 1200 && /^https:\/\/[^\s]+$/i.test(image) ? image : '',
      source: ['scriptblox', 'robloxscripts', 'builtin'].includes(source) ? source : '',
      game: String(item.game || '').slice(0, 100),
      author: String(item.author || '').slice(0, 80),
      views: Math.max(0, Number(item.views) || 0),
      url:
        url.length <= 1200 &&
        /^https:\/\/(?:www\.)?(?:scriptblox|robloxscripts)\.com\//i.test(url)
          ? url
          : '',
    };
  });
}

function sanitizeSession(input) {
  const source = input && typeof input === 'object' ? input : {};
  const docs = Array.isArray(source.docs) ? source.docs : [];

  const cleanDocs = docs
    .slice(0, 30)
    .filter((doc) => doc && typeof doc === 'object')
    .map((doc, index) => ({
      id:
        typeof doc.id === 'string' && /^[a-zA-Z0-9_-]{4,64}$/.test(doc.id)
          ? doc.id
          : crypto.randomUUID(),
      name: String(doc.name || `Untitled ${index + 1}`).slice(0, 100),
      code: String(doc.code || '').slice(0, 2 * 1024 * 1024),
      dirty: Boolean(doc.dirty),
      originId:
        typeof doc.originId === 'string' && /^[a-zA-Z0-9_-]{4,64}$/.test(doc.originId)
          ? doc.originId
          : null,
    }));

  if (!cleanDocs.length) {
    cleanDocs.push({
      id: crypto.randomUUID(),
      name: 'Untitled',
      code: '',
      dirty: false,
    });
  }

  return {
    docs: cleanDocs,
    active: clampInt(source.active, 0, cleanDocs.length - 1, 0),
  };
}

function createWindow() {
  const saved = readJson('window.json', {});
  const width = clampInt(saved.width, 1000, 3840, 1240);
  const height = clampInt(saved.height, 680, 2160, 830);

  const win = new BrowserWindow({
    width,
    height,
    icon: path.join(__dirname, 'assets', 'app-icon.png'),
    minWidth: 1000,
    minHeight: 680,
    frame: false,
    show: false,
    title: 'Aether',
    // On Windows the see-through look comes from the acrylic material below. Electron
    // already treats a window with a material as translucent, and adding
    // `transparent: true` on top of it switches Chromium to a different alpha surface
    // that can stop Windows from drawing the blur. Other platforms still need it.
    transparent: process.platform !== 'win32',
    backgroundColor: '#00000000',
    ...(process.platform === 'win32' ? { backgroundMaterial: 'acrylic' } : {}),
    ...(process.platform === 'darwin'
      ? { vibrancy: 'under-window', visualEffectState: 'active' }
      : {}),
    roundedCorners: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  runtime.win = win;

  // Windows can drop the material when the window is first shown, maximized or
  // restored, so it is (re)applied at those moments instead of only once at startup.
  const applyMaterial = () => {
    if (process.platform !== 'win32' || typeof win.setBackgroundMaterial !== 'function') return;
    if (win.isDestroyed()) return;
    try {
      win.setBackgroundMaterial('acrylic');
    } catch {
      // Windows builds older than 11 22H2 have no acrylic; the window stays plain.
    }
  };

  // Printed in the terminal on startup. Acrylic needs Windows 11 22H2 (build 22621) or newer.
  console.log(`[aether] electron ${process.versions.electron}, windows build ${os.release()}`);

  applyMaterial();
  win.on('show', applyMaterial);
  win.on('restore', applyMaterial);
  win.on('unmaximize', applyMaterial);

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => {
    if (saved.maximized) win.maximize();
    win.show();
  });

  win.webContents.on('did-finish-load', () => {
    send('win:state', { maximized: win.isMaximized() });
  });

  win.on('maximize', () => send('win:state', { maximized: true }));
  win.on('unmaximize', () => send('win:state', { maximized: false }));
  win.on('closed', () => {
    runtime.win = null;
  });

  win.on('close', () => {
    const bounds = win.getNormalBounds();
    writeJson('window.json', {
      width: bounds.width,
      height: bounds.height,
      maximized: win.isMaximized(),
    });
  });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
}

function registerIpc() {
  ipcMain.handle('config:get', () => runtime.config);

  ipcMain.handle('config:set', (_event, input) => {
    const next = mergeConfig(input);
    saveConfig(next);
    return next;
  });

  ipcMain.handle('config:reset', async () => {
    runtime.config = JSON.parse(JSON.stringify(DEFAULTS));
    writeJson('config.json', runtime.config);
    await applyBridge();
    return { config: runtime.config, bridge: bridgeState() };
  });

  ipcMain.handle('session:get', () => sanitizeSession(readJson('session.json', null)));
  ipcMain.handle('session:set', (_event, session) => {
    writeJson('session.json', sanitizeSession(session));
    return true;
  });

  ipcMain.handle('scripts:get', () => sanitizeScripts(readJson('scripts.json', [])));
  ipcMain.handle('scripts:set', (_event, scripts) => {
    writeJson('scripts.json', sanitizeScripts(scripts));
    return true;
  });

  ipcMain.handle('user:get', () => userInfo());

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    dataFolder: app.getPath('userData'),
  }));

  ipcMain.handle('app:open-data', async () => {
    const result = await shell.openPath(app.getPath('userData'));
    return { ok: !result, message: result };
  });

  ipcMain.handle('app:check-updates', async (_event, manual) => checkForUpdates(Boolean(manual)));

  ipcMain.handle('clipboard:write', (_event, text) => {
    clipboard.writeText(String(text || '').slice(0, 2 * 1024 * 1024));
    return true;
  });

  ipcMain.handle('app:open-external', async (_event, value) => {
    try {
      const url = new URL(String(value || ''));
      if (url.protocol !== 'https:' || !EXTERNAL_HOSTS.has(url.hostname.toLowerCase())) {
        return { ok: false, message: 'That link is not allowed' };
      }
      await shell.openExternal(url.toString());
      return { ok: true };
    } catch {
      return { ok: false, message: 'Invalid link' };
    }
  });

  ipcMain.handle('hub:fetch', async (_event, input) => {
    const source = input && typeof input === 'object' ? input : {};
    const provider =
      source.provider === 'scriptblox' || source.provider === 'robloxscripts' ? source.provider : '';

    if (!provider) {
      return {
        ok: false,
        provider: '',
        label: 'Unknown',
        items: [],
        page: 1,
        hasMore: false,
        error: 'Unknown provider',
      };
    }

    return fetchHub(provider, {
      query: String(source.query || '').slice(0, 80),
      page: clampInt(source.page, 1, 50, 1),
    });
  });

  ipcMain.handle('bridge:get', () => bridgeState());
  ipcMain.handle('bridge:loader', (_event, port) => {
    const value = clampInt(port, 1024, 65535, runtime.config.bridge.port);
    return loaderScript(value);
  });

  ipcMain.handle('bridge:set', async (_event, input) => {
    const source = input && typeof input === 'object' ? input : {};
    const port = clampInt(source.port, 1024, 65535, runtime.config.bridge.port);
    const enabled = bool(source.enabled, runtime.config.bridge.enabled);

    saveConfig({
      ...runtime.config,
      bridge: { port, enabled },
    });

    await applyBridge();
    return { ok: !runtime.bridgeError, state: bridgeState() };
  });

  ipcMain.handle('bridge:disconnect', (_event, id) => {
    const ok = runtime.bridge.disconnect(String(id || ''));
    return { ok, state: bridgeState() };
  });

  ipcMain.handle('bridge:disconnect-all', () => {
    runtime.bridge.disconnectAll();
    return { ok: true };
  });

  ipcMain.handle('exec:run', (_event, payload) => {
    const source = payload && typeof payload === 'object' ? payload : {};
    const code = String(source.code || '');
    const ids = Array.isArray(source.ids)
      ? source.ids.filter((id) => typeof id === 'string').slice(0, 50)
      : [];

    if (!runtime.bridge.running) {
      return { ok: false, message: runtime.bridgeError || 'The bridge is not running' };
    }

    try {
      const count = runtime.bridge.send(ids, code);
      return {
        ok: true,
        count,
        message: `Sent to ${count} ${count === 1 ? 'client' : 'clients'}`,
      };
    } catch (error) {
      return { ok: false, message: error.message };
    }
  });

  ipcMain.on('win:min', () => runtime.win?.minimize());
  ipcMain.on('win:max', () => {
    if (!runtime.win) return;
    if (runtime.win.isMaximized()) runtime.win.unmaximize();
    else runtime.win.maximize();
  });
  ipcMain.on('win:close', () => runtime.win?.close());
  ipcMain.handle('win:is-maximized', () => Boolean(runtime.win?.isMaximized()));
}

function wireBridge() {
  runtime.bridge.on('clients', (clients) => send('bridge:clients', clients));
  runtime.bridge.on('log', (entry) => send('bridge:log', entry));
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  loadConfig();
  wireBridge();
  registerIpc();
  createWindow();

  if (runtime.config.bridge.enabled) {
    applyBridge();
  } else {
    send('bridge:state', bridgeState());
  }

  setTimeout(() => checkForUpdates(), 2500);
  setInterval(() => checkForUpdates(), 6 * 60 * 60 * 1000);
});

app.on('window-all-closed', async () => {
  try {
    await runtime.bridge.stop();
  } catch {
    // The process is exiting anyway.
  }
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
