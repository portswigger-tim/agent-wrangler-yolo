import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { YoloStore } from './store.js';
import { makePrepare, launchContext, installPreCommit, onPurge, wantsYolo, pruneMergedBranches, HOOK_TYPES } from './hooks.js';

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

// Real git, fake gh: a bare "origin", a clone with three branches whose
// remotes are gone, and one still pushed.
async function repoWithBranches() {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  // Inside a git hook (pre-commit runs these tests on commit) git exports
  // GIT_DIR, GIT_INDEX_FILE and friends; inherited, they would point these
  // commands at the outer repo. Strip them.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  const exe = promisify(execFile);
  const run = (cmd, args, opts = {}) => exe(cmd, args, { ...opts, env });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yolo-prune-'));
  const origin = path.join(tmp, 'origin.git');
  const repo = path.join(tmp, 'repo');
  const git = (cwd, ...args) => run('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd });
  await run('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  await run('git', ['clone', '-q', origin, repo]);
  await git(repo, 'config', 'user.email', 't@example.com');
  await git(repo, 'config', 'user.name', 't');
  await git(repo, 'commit', '-q', '--allow-empty', '-m', 'init');
  await git(repo, 'push', '-q', 'origin', 'main');
  const sha = {};
  for (const b of ['merged', 'unpushed-after-merge', 'never-a-pr', 'still-open']) {
    await git(repo, 'switch', '-q', '-c', b, 'main');
    await git(repo, 'commit', '-q', '--allow-empty', '-m', b);
    await git(repo, 'push', '-q', '-u', 'origin', b);
    sha[b] = (await git(repo, 'rev-parse', 'HEAD')).stdout.trim();
  }
  // Work committed locally after the PR merged: the tip no longer matches.
  await git(repo, 'switch', '-q', 'unpushed-after-merge');
  await git(repo, 'commit', '-q', '--allow-empty', '-m', 'more work');
  await git(repo, 'switch', '-q', 'main');
  // GitHub deleted these on merge (or someone did by hand).
  for (const b of ['merged', 'unpushed-after-merge', 'never-a-pr']) await git(repo, 'push', '-q', 'origin', '--delete', b);
  const merged = { merged: sha.merged, 'unpushed-after-merge': sha['unpushed-after-merge'] };
  const exec = (cmd, args, opts) => (cmd === 'gh'
    ? Promise.resolve({ stdout: JSON.stringify(merged[args[args.indexOf('--head') + 1]] ? [{ headRefOid: merged[args[args.indexOf('--head') + 1]] }] : []) })
    : run(cmd, args, opts));
  const branches = async () => (await git(repo, 'branch', '--format=%(refname:short)')).stdout.split('\n').filter(Boolean).sort();
  return { repo, exec, branches };
}

test('pruneMergedBranches deletes only branches whose merged PR head is the local tip', async () => {
  const { repo, exec, branches } = await repoWithBranches();
  assert.deepEqual(await pruneMergedBranches(repo, { exec }), ['merged']);
  assert.deepEqual(await branches(), ['main', 'never-a-pr', 'still-open', 'unpushed-after-merge']);
});

test('pruneMergedBranches leaves a branch checked out in a worktree', async () => {
  const { repo, exec, branches } = await repoWithBranches();
  await exec('git', ['worktree', 'add', '-q', path.join(repo, '..', 'wt'), 'merged'], { cwd: repo });
  assert.deepEqual(await pruneMergedBranches(repo, { exec }), []);
  assert.ok((await branches()).includes('merged'));
});

test('prepare prunes as housekeeping and never warns about it', async () => {
  const { repo, store, host, logs } = setup();
  const calls = [];
  const exec = async (cmd, args) => {
    calls.push([cmd, ...args].join(' '));
    if (args[0] === 'for-each-ref') throw new Error('boom');
    return { stdout: '' };
  };
  const r = await makePrepare({ exec })({ sessionId: 's1', repoRoot: repo, ext: { enabled: true }, host });
  assert.equal(r, undefined);
  assert.ok(calls.includes('git fetch --prune --quiet'));
  assert.match(logs.join('\n'), /branch prune skipped/);
  assert.ok(store.get('s1'));
});
