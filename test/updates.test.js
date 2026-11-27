'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createUpdater, readRelease } = require('../updates');

const bytes = Buffer.from('test fixture, never executed');
const digest = 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const name = 'Aether.Setup.1.2.0.exe';
const release = { tag_name: '1.2', assets: [{ name, digest, size: bytes.length,
  browser_download_url: 'https://github.com/GamingCat9439/Aether/releases/download/1.2/' + name }] };

test('matches the published 1.2 tag and compares versions numerically', () => {
  assert.equal(readRelease(release, '1.1.9', 'x64').installer.name, name);
  for (const [tag, current, newer] of [
    ['1.2', '1.1.9', true], ['1.2', '1.2.0', false], ['1.2', '1.2.0-beta.1', true],
    ['v1.2.0', '1.2.1', false], ['v1.10.0', '1.9.10', true],
  ]) assert.equal(readRelease({ tag_name: tag }, current, 'x64').newer, newer);
  for (const tag_name of ['stable', '1.2.0foo', '1.2.0-beta']) {
    assert.throws(() => readRelease({ tag_name }, '1.1.9', 'x64'));
  }
});

test('requires a matching architecture, release asset URL, size and digest', () => {
  assert.equal(readRelease(release, '1.1.9', 'arm64').installer, undefined);
  for (const change of [{ digest: null }, { size: 0 }, { name: 'different.exe' },
    { browser_download_url: 'https://example.com/setup.exe' }]) {
    assert.equal(readRelease({ ...release, assets: [{ ...release.assets[0], ...change }] }, '1.0.0', 'x64').installer, undefined);
  }
});

async function fixture(t, overrides = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'updater-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const launched = [], phases = [];
  const updater = createUpdater({ version: '1.1.9', windowsInstall: true, arch: 'x64', tempDir: dir,
    fetch: async url => url.endsWith('/latest') ? Response.json(release) : new Response(bytes),
    openInstaller: async file => { launched.push(file); return ''; },
    notify: state => phases.push(state.phase), ...overrides });
  return { updater, dir, launched, phases };
}

test('coalesces checks, verifies the download, and only launches after an install request', async t => {
  const { updater, launched, phases } = await fixture(t);
  const [a, b] = await Promise.all([updater.check(), updater.check()]);
  assert.equal(a.phase, 'available'); assert.deepEqual(a, b);
  assert.equal(phases.filter(p => p === 'checking').length, 1);
  await Promise.all([updater.download(), updater.download()]);
  assert.equal(updater.status().phase, 'ready');
  assert.equal(launched.length, 0);
  await Promise.all([updater.install(), updater.install()]);
  assert.equal(launched.length, 1); assert.deepEqual(await fs.readFile(launched[0]), bytes);
});

test('corrupt, truncated, and oversized downloads can be retried', async t => {
  let contents = Buffer.alloc(bytes.length);
  const { updater, dir, launched } = await fixture(t, {
    fetch: async url => url.endsWith('/latest') ? Response.json(release) : new Response(contents),
  });
  await updater.check();
  for (const length of [bytes.length, bytes.length - 1, bytes.length + 1]) {
    contents = Buffer.alloc(length);
    assert.equal((await updater.download()).phase, 'available');
    await updater.install(); assert.deepEqual(launched, []); assert.deepEqual(await fs.readdir(dir), []);
  }
  contents = bytes; assert.equal((await updater.download()).phase, 'ready');
  const [folder] = await fs.readdir(dir);
  await fs.writeFile(path.join(dir, folder, 'Aether-Setup.exe'), 'changed after download');
  assert.equal((await updater.install()).phase, 'available'); assert.deepEqual(launched, []);
});

test('reports a failed check and recovers on retry', async t => {
  let status = 403;
  const { updater } = await fixture(t, { fetch: async () => status ? new Response(null, { status }) : Response.json(release) });
  for (status of [403, 404, 429, 500]) assert.equal((await updater.check()).phase, 'error');
  status = 0; assert.equal((await updater.check()).phase, 'available');
});

test('source builds can view the release and cannot launch an installer', async t => {
  const { updater, launched } = await fixture(t, { windowsInstall: false });
  const result = await updater.check();
  assert.equal(result.canDownload, false); assert.match(result.url, /releases\/tag\/1\.2$/);
  assert.equal((await updater.download()).phase, 'available'); await updater.install();
  assert.deepEqual(launched, []);
});
