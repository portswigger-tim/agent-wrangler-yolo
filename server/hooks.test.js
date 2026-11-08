import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { YoloStore } from './store.js';
import { makePrepare, launchContext, installPreCommit, onPurge, wantsYolo, HOOK_TYPES } from './hooks.js';

function setup({ config = true } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yolo-hooks-'));
  const repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo);
  if (config) fs.writeFileSync(path.join(repo, '.pre-commit-config.yaml'), 'repos: []\n');
  const store = new YoloStore({ file: path.join(tmp, 'yolo.json') });
  const logs = [];
  const host = { stores: { yolo: store }, log: (m) => logs.push(m) };
  return { repo, store, host, logs };
}

// Records each command and answers like a clean repo with no core.hooksPath.
function fakeExec(fail = {}) {
  const calls = [];
  const exec = async (cmd, args, opts) => {
    calls.push({ cmd, args, cwd: opts?.cwd });
    if (cmd === 'git' && args[0] === 'config') return { stdout: fail.hooksPath ?? '' };
    if (fail[cmd]) throw fail[cmd];
    return { stdout: '' };
  };
  return { exec, calls };
}

test('wantsYolo is true only for { enabled: true }', () => {
  assert.equal(wantsYolo({ enabled: true }), true);
  for (const v of [null, undefined, {}, { enabled: 'true' }, { enabled: 1 }, true]) assert.equal(wantsYolo(v), false);
});

test('prepare ignores a session that did not opt in', async () => {
  const { repo, store, host } = setup();
  const { exec, calls } = fakeExec();
  assert.equal(await makePrepare({ exec })({ sessionId: 's1', repoRoot: repo, ext: null, host }), undefined);
  assert.equal(store.get('s1'), null);
  assert.equal(calls.length, 0);
});

test('prepare aborts outside a git repo', async () => {
  const { host } = setup();
  const r = await makePrepare({ exec: fakeExec().exec })({ sessionId: 's1', repoRoot: null, ext: { enabled: true }, host });
  assert.match(r.abort, /git repository/);
});

test('prepare enrols, pulls and installs every hook type', async () => {
  const { repo, store, host } = setup();
  const { exec, calls } = fakeExec();
  const r = await makePrepare({ exec })({ sessionId: 's1', repoRoot: repo, ext: { enabled: true }, host });
  assert.equal(r, undefined);
  assert.equal(store.get('s1').repo, repo);
  assert.deepEqual(calls.find((c) => c.cmd === 'git' && c.args[0] === 'pull').args, ['pull', '--ff-only', '--quiet']);
  const install = calls.find((c) => c.cmd === 'pre-commit');
  assert.deepEqual(install.args, ['install', ...HOOK_TYPES.flatMap((t) => ['-t', t])]);
  assert.equal(install.cwd, repo);
});

test('prepare warns, not aborts, when pull or install fails', async () => {
  const { repo, host } = setup();
  const enoent = Object.assign(new Error('spawn pre-commit ENOENT'), { code: 'ENOENT' });
  const { exec } = fakeExec({ git: Object.assign(new Error('x'), { stderr: 'fatal: Not possible to fast-forward' }), 'pre-commit': enoent });
  const r = await makePrepare({ exec })({ sessionId: 's1', repoRoot: repo, ext: { enabled: true }, host });
  assert.equal(r.warnings.length, 2);
  assert.match(r.warnings[0], /fast-forward/);
  assert.match(r.warnings[1], /not installed/);
});

test('prepare enrols a child of a YOLO parent in the same repo, and refuses another repo', async () => {
  const { repo, store, host } = setup();
  store.enrol('parent', { repo });
  const prepare = makePrepare({ exec: fakeExec().exec });
  await prepare({ sessionId: 'child', repoRoot: repo, ext: { enabled: true }, spawnedBy: 'parent', host });
  assert.equal(store.get('child').parent, 'parent');
  const r = await prepare({ sessionId: 'stray', repoRoot: '/other', ext: { enabled: true }, spawnedBy: 'parent', host });
  assert.match(r.abort, /must work in/);
  assert.equal(store.get('stray'), null);
});

test('prepare links a yolo_spawn child through the slice\'s parent, and refuses an unknown parent', async () => {
  const { repo, store, host } = setup();
  store.enrol('parent', { repo });
  const prepare = makePrepare({ exec: fakeExec().exec });
  await prepare({ sessionId: 'child', repoRoot: repo, ext: { enabled: true, parent: 'parent' }, spawnedBy: null, host });
  assert.equal(store.get('child').parent, 'parent');
  const r = await prepare({ sessionId: 'orphan', repoRoot: repo, ext: { enabled: true, parent: 'ghost' }, host });
  assert.match(r.abort, /ghost is not in YOLO mode/);
  assert.equal(store.get('orphan'), null);
});

test('launchContext tells a child who its parent is', () => {
  const { store, host } = setup();
  store.enrol('p', { repo: '/repo' });
  store.enrol('c', { repo: '/repo', parent: 'p' });
  assert.equal(launchContext({ sid: 'c', reason: 'spawn', host }).env.AW_YOLO_PARENT, 'p');
  assert.equal('AW_YOLO_PARENT' in launchContext({ sid: 'p', reason: 'resume', host }).env, false);
});

test('installPreCommit warns when the config is missing or core.hooksPath is set', async () => {
  const bare = setup({ config: false });
  assert.match((await installPreCommit(bare.repo, { exec: fakeExec().exec })).warning, /no \.pre-commit-config\.yaml/);
  const { repo } = setup();
  const { exec, calls } = fakeExec({ hooksPath: '.githooks\n' });
  assert.match((await installPreCommit(repo, { exec })).warning, /core\.hooksPath is set \(\.githooks\)/);
  assert.equal(calls.some((c) => c.cmd === 'pre-commit'), false);
});

test('launchContext gives env only to enrolled cards and their forks', () => {
  const { store, host } = setup();
  assert.deepEqual(launchContext({ sid: 's1', reason: 'dispatch', host }), {});
  store.enrol('s1', { repo: '/repo' });
  assert.deepEqual(launchContext({ sid: 's1', reason: 'resume', host }), { env: { AW_YOLO: '1', AW_YOLO_REPO: '/repo' } });
  assert.deepEqual(launchContext({ sid: 'f1', reason: 'fork', parentId: 's1', host }).env.AW_YOLO_REPO, '/repo');
  assert.equal(store.get('f1').parent, 's1');
  assert.deepEqual(launchContext({ sid: 'f2', reason: 'fork', parentId: 'nobody', host }), {});
});

test('onPurge forgets the card', () => {
  const { store, host } = setup();
  store.enrol('s1', { repo: '/repo' });
  onPurge({ sessionId: 's1', host });
  assert.equal(store.get('s1'), null);
});
