import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { YoloStore } from './store.js';
import { ensureReleasePlease, openReleasePr, TOOL_SRC, CONFIG_FILE, MANIFEST_FILE } from './release.js';
import { makeReleasePrTool } from './tools/release-pr.js';

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

test('the shipped tool pins release-please exactly and has a lockfile', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(TOOL_SRC, 'package.json'), 'utf8'));
  assert.match(pkg.dependencies['release-please'], /^\d+\.\d+\.\d+$/);
  const lock = JSON.parse(fs.readFileSync(path.join(TOOL_SRC, 'package-lock.json'), 'utf8'));
  assert.equal(lock.packages['node_modules/release-please'].version, pkg.dependencies['release-please']);
  assert.match(lock.packages['node_modules/release-please'].integrity, /^sha512-/);
});

test('ensureReleasePlease runs npm ci without scripts once, and again only when the lockfile changes', async () => {
  const src = tmp('yolo-rp-src-');
  const dir = path.join(tmp('yolo-rp-dir-'), 'rp');
  fs.writeFileSync(path.join(src, 'package.json'), '{}');
  fs.writeFileSync(path.join(src, 'package-lock.json'), '{"v":1}');
  const calls = [];
  const exec = async (cmd, args, opts) => {
    calls.push([cmd, ...args]);
    fs.mkdirSync(path.join(opts.cwd, 'node_modules/.bin'), { recursive: true });
    fs.writeFileSync(path.join(opts.cwd, 'node_modules/.bin/release-please'), '');
    return { stdout: '' };
  };
  const bin = await ensureReleasePlease({ src, dir, exec });
  assert.equal(bin, path.join(dir, 'node_modules/.bin/release-please'));
  assert.deepEqual(calls, [['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund', '--silent']]);
  await ensureReleasePlease({ src, dir, exec });
  assert.equal(calls.length, 1);
  fs.writeFileSync(path.join(src, 'package-lock.json'), '{"v":2}');
  await ensureReleasePlease({ src, dir, exec });
  assert.equal(calls.length, 2);
});

function repoWithConfig() {
  const repoDir = tmp('yolo-rp-repo-');
  fs.writeFileSync(path.join(repoDir, CONFIG_FILE), '{}');
  fs.writeFileSync(path.join(repoDir, MANIFEST_FILE), '{}');
  return repoDir;
}

test('openReleasePr passes the token as a 0600 file, never in argv, and removes it', async () => {
  const repoDir = repoWithConfig();
  const seen = {};
  const exec = async (cmd, args) => {
    if (cmd === 'gh' && args[0] === 'auth') return { stdout: 'gho_secret\n' };
    if (cmd === 'gh' && args[0] === 'pr') {
      seen.list = args;
      return { stdout: JSON.stringify([
        { number: 8, url: 'https://x/8', title: 'feat: unrelated', headRefName: 'feat/x' },
        { number: 9, url: 'https://x/9', title: 'chore(main): release 0.1.0', headRefName: 'release-please--branches--main--components--r' },
      ]) };
    }
    seen.argv = [cmd, ...args];
    const file = args[args.indexOf('--token') + 1];
    seen.file = file;
    seen.content = fs.readFileSync(file, 'utf8');
    seen.mode = fs.statSync(file).mode & 0o777;
    return { stdout: 'ok', stderr: '' };
  };
  const r = await openReleasePr({ repoDir, repo: 'o/r', defaultBranch: 'main', exec, ensure: async () => '/bin/release-please' });
  assert.equal(seen.argv[0], '/bin/release-please');
  assert.deepEqual(seen.argv.slice(1, 2), ['release-pr']);
  assert.equal(seen.argv.some((a) => a.includes('gho_secret')), false);
  assert.equal(seen.content, 'gho_secret');
  assert.equal(seen.mode, 0o600);
  assert.equal(fs.existsSync(seen.file), false);
  assert.ok(seen.argv.includes('--target-branch') && seen.argv.includes('main'));
  assert.deepEqual(seen.list.slice(seen.list.indexOf('--base'), seen.list.indexOf('--base') + 2), ['--base', 'main']);
  assert.deepEqual(r.pulls.map((p) => p.number), [9], 'only release-please\'s branch, found without waiting for its label');
});

test('openReleasePr removes the token file even when the CLI fails', async () => {
  const repoDir = repoWithConfig();
  let file;
  const exec = async (cmd, args) => {
    if (cmd === 'gh') return { stdout: 'gho_secret' };
    file = args[args.indexOf('--token') + 1];
    throw new Error('release-please: 422');
  };
  await assert.rejects(openReleasePr({ repoDir, repo: 'o/r', defaultBranch: 'main', exec, ensure: async () => 'rp' }), /422/);
  assert.equal(fs.existsSync(file), false);
});

test('openReleasePr refuses a repo without release-please config', async () => {
  await assert.rejects(openReleasePr({ repoDir: tmp('yolo-rp-bare-'), repo: 'o/r', defaultBranch: 'main', ensure: async () => 'rp' }), /release-please-config\.json is missing/);
});

test('yolo_release_pr: refuses the unenrolled, runs in the enrolled repo, reports nothing to release', async () => {
  const store = new YoloStore({ file: path.join(tmp('yolo-rp-store-'), 'yolo.json') });
  const host = { stores: { yolo: store } };
  const opened = [];
  const tool = makeReleasePrTool({
    makeClient: () => ({ repoFor: async () => ({ repo: 'o/r', defaultBranch: 'main' }) }),
    open: async (opts) => { opened.push(opts); return { pulls: [], log: '' }; },
  });
  assert.equal((await tool.handler({ host, caller: 'x' })).isError, true);
  store.enrol('s1', { repo: '/work/repo' });
  const r = await tool.handler({ host, caller: 's1' });
  assert.deepEqual(opened, [{ repoDir: '/work/repo', repo: 'o/r', defaultBranch: 'main' }]);
  assert.match(r.content[0].text, /nothing to release/);
});
