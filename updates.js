'use strict';

const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const repo = 'GamingCat9439/Aether';
const releases = 'https://github.com/' + repo + '/releases';
const latestApi = 'https://api.github.com/repos/' + repo + '/releases/latest';

function parseVersion(text, installed = false) {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?(-[\w.-]+)?(?:\+[\w.-]+)?$/i.exec(String(text).trim());
  if (!match || (!installed && match[4])) throw new Error('Unrecognized version: ' + text);
  const parts = [match[1], match[2], match[3] || '0'].map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error('Invalid version number');
  return { parts, version: parts.join('.'), prerelease: Boolean(match[4]) };
}

function readRelease(release, installed, arch) {
  if (release.draft || release.prerelease) throw new Error('No stable release was returned');
  const latest = parseVersion(release.tag_name);
  const current = parseVersion(installed, true);
  const difference = latest.parts.map((part, i) => part - current.parts[i]).find(Boolean);
  const tag = encodeURIComponent(release.tag_name);
  const assets = Array.isArray(release.assets) ? release.assets : [];
  // electron-builder publishes the unqualified NSIS installer for the project's default x64 build.
  const stem = 'aether.setup.' + latest.version;
  const names = [stem + '.' + arch + '.exe'];
  if (arch === 'x64') names.push(stem + '.exe');
  let installer;
  for (const name of names) {
    installer = assets.find(asset => {
      const url = releases + '/download/' + tag + '/' + encodeURIComponent(asset.name);
      return String(asset.name).toLowerCase().replace(/[ -]/g, '.') === name &&
        asset.browser_download_url === url && /^sha256:[a-f0-9]{64}$/i.test(asset.digest) &&
        Number.isSafeInteger(asset.size) && asset.size > 0;
    });
    if (installer) break;
  }
  return {
    newer: difference === undefined ? current.prerelease : difference > 0,
    latest: latest.version,
    url: releases + '/tag/' + tag,
    installer,
  };
}

async function downloadInstaller(fetch, asset, directory, progress) {
  await fs.promises.mkdir(directory, { recursive: true });
  const dir = await fs.promises.mkdtemp(path.join(directory, 'aether-update-'));
  const file = path.join(dir, 'Aether-Setup.exe');
  try {
    const signal = AbortSignal.timeout(15 * 60 * 1000);
    const response = await fetch(asset.browser_download_url, { signal });
    if (!response.ok || !response.body) throw new Error('Installer download failed (HTTP ' + response.status + ')');
    const hash = createHash('sha256');
    let bytes = 0;
    let lastPercent = -1;
    const verify = new Transform({
      transform(chunk, _, done) {
        bytes += chunk.length;
        if (bytes > asset.size) return done(new Error('Installer exceeds the published size'));
        hash.update(chunk);
        const percent = Math.floor(bytes / asset.size * 100);
        if (percent !== lastPercent) {
          lastPercent = percent;
          progress(percent);
        }
        done(null, chunk);
      },
    });
    await pipeline(response.body, verify, fs.createWriteStream(file, { flags: 'wx', mode: 0o600 }), { signal });
    if (bytes !== asset.size || 'sha256:' + hash.digest('hex') !== asset.digest.toLowerCase()) {
      throw new Error('The downloaded installer did not match the GitHub release');
    }
    return file;
  } catch (error) {
    await fs.promises.rm(dir, { recursive: true, force: true });
    throw error;
  }
}

// Setup can outlive Aether. Give it time to finish before reclaiming old downloads.
async function cleanOldDownloads(directory) {
  const entries = await fs.promises.readdir(directory, { withFileTypes: true });
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  await Promise.all(entries.filter(entry => entry.isDirectory() && /^aether-update-[A-Za-z0-9]{6}$/.test(entry.name))
    .map(async entry => {
      const dir = path.join(directory, entry.name);
      if ((await fs.promises.stat(dir)).mtimeMs < cutoff) {
        await fs.promises.rm(dir, { recursive: true, force: true });
      }
    }));
}

function createUpdater({ version, windowsInstall, arch, fetch, tempDir, openInstaller, notify }) {
  let state = { phase: 'idle', current: version, url: releases };
  let asset, file, pending;
  if (windowsInstall) cleanOldDownloads(tempDir).catch(() => {});
  function publish(changes) {
    state = { ...state, ...changes };
    notify(state);
    return state;
  }
  async function check() {
    if (pending) return pending;
    if (['downloading', 'ready', 'opening'].includes(state.phase)) return state;
    publish({ phase: 'checking', error: '' });
    pending = (async () => {
      const response = await fetch(latestApi, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Aether/' + version },
        signal: AbortSignal.timeout(15000), cache: 'no-store',
      });
      if (response.status === 404) throw new Error('GitHub has no published release available');
      if ([403, 429].includes(response.status)) throw new Error('GitHub limited this request. Try again later.');
      if (!response.ok) throw new Error('GitHub returned HTTP ' + response.status);
      const release = readRelease(await response.json(), version, arch);
      asset = windowsInstall && release.newer ? release.installer : null;
      return publish({ phase: release.newer ? 'available' : 'current', latest: release.latest,
        url: release.url, canDownload: Boolean(asset), error: '' });
    })().catch(error => publish({ phase: 'error', error: error.message, url: releases, canDownload: false }))
      .finally(() => { pending = null; });
    return pending;
  }
  async function download() {
    if (state.phase !== 'available' || !asset) return state;
    publish({ phase: 'downloading', percent: 0, error: '' });
    try {
      file = await downloadInstaller(fetch, asset, tempDir, percent => publish({ percent }));
      return publish({ phase: 'ready' });
    } catch (error) {
      return publish({ phase: 'available', error: error.message });
    }
  }
  async function install() {
    if (state.phase !== 'ready' || !file) return state;
    publish({ phase: 'opening', error: '' });
    try {
      const hash = createHash('sha256');
      for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
      if ('sha256:' + hash.digest('hex') !== asset.digest.toLowerCase()) {
        return publish({ phase: 'available', error: 'The installer changed. Download the update again.' });
      }
      const error = await openInstaller(file);
      if (error) throw new Error(error);
      return publish({ phase: 'ready', opened: true });
    } catch (error) {
      return publish({ phase: error.code === 'ENOENT' ? 'available' : 'ready', opened: false, error: error.message });
    }
  }
  return { check, download, install, status: () => state };
}

module.exports = { createUpdater, readRelease };
