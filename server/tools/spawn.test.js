import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { YoloStore } from '../store.js';
import { yoloSpawnTool, DEFAULT_MAX_CHILDREN } from './spawn.js';
import { NOT_ENROLLED } from './result.js';

const BRIEF = 'Add a CHANGELOG lint job to CI and open a PR for it.';

function setup({ settings = {}, sessions = {} } = {}) {
  const store = new YoloStore({ file: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'yolo-spawn-')), 'yolo.json') });
  const spawned = [];
  let n = 0;
  const host = {
    stores: { yolo: store },
    settings: { all: () => settings },
    sessions: {
      get: (sid) => sessions[sid] ?? (store.get(sid) ? { sessionId: sid, archived: false, taskId: null } : null),
      spawn: async (opts) => {
        spawned.push(opts);
        const sessionId = `child-${++n}`;
        // What session.prepare does for a real spawn.
        store.enrol(sessionId, { repo: opts.cwd, parent: opts.ext.yolo.parent });
        return { sessionId, worktree: { branch: opts.worktree.branch ?? `auto-${n}` } };
      },
    },
  };
  return { store, host, spawned };
}

const call = (host, caller, args) => yoloSpawnTool.handler({ host, caller }, { intent: BRIEF, ...args });

test('refuses a caller that is not enrolled', async () => {
  const { host, spawned } = setup();
  assert.equal((await call(host, 'stranger')).content[0].text, NOT_ENROLLED);
  assert.equal((await call(host, null)).isError, true);
  assert.equal(spawned.length, 0);
});

test('spawns into the caller\'s repo with YOLO, auto-merge, auto-fix, a worktree, nesting and the task', async () => {
  const { store, host, spawned } = setup({ sessions: { root: { sessionId: 'root', taskId: 't1', archived: false } } });
  store.enrol('root', { repo: '/work/repo' });
  const r = await call(host, 'root', { branch: 'feat/changelog-lint', model: 'opus' });
  assert.equal(r.isError, undefined);
  assert.deepEqual(spawned[0], {
    cwd: '/work/repo',
    intent: BRIEF,
    agent: undefined,
    model: 'opus',
    effort: undefined,
    parentSession: 'root',
    taskId: 't1',
    worktree: { auto: true, branch: 'feat/changelog-lint' },
    autoMergeOnPass: true,
    autoFixPrChecks: true,
    ext: { yolo: { enabled: true, parent: 'root' } },
  });
  assert.equal(r.structuredContent.sessionId, 'child-1');
  assert.equal(store.get('child-1').parent, 'root');
});

test('caps live children per session, counting only live cards', async () => {
  const { store, host } = setup({ settings: { maxChildren: 2 } });
  store.enrol('root', { repo: '/work/repo' });
  await call(host, 'root');
  await call(host, 'root');
  const refused = await call(host, 'root');
  assert.equal(refused.isError, true);
  assert.match(refused.content[0].text, /2 live child sessions \(limit 2\)/);
  // An archived child frees its slot.
  host.sessions.get = (sid) => ({ sessionId: sid, archived: sid === 'child-1', taskId: null });
  assert.equal((await call(host, 'root')).isError, undefined);
});

test('defaults the cap', async () => {
  const { store, host } = setup();
  store.enrol('root', { repo: '/work/repo' });
  for (let i = 0; i < DEFAULT_MAX_CHILDREN; i++) assert.equal((await call(host, 'root')).isError, undefined);
  assert.equal((await call(host, 'root')).isError, true);
});

test('stops at three levels', async () => {
  const { store, host } = setup();
  store.enrol('root', { repo: '/r' });
  store.enrol('kid', { repo: '/r', parent: 'root' });
  store.enrol('grandkid', { repo: '/r', parent: 'kid' });
  assert.equal((await call(host, 'kid')).isError, undefined);
  const r = await call(host, 'grandkid');
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /levels below/);
});

test('a spawn failure comes back as a tool error', async () => {
  const { store, host } = setup();
  store.enrol('root', { repo: '/r' });
  host.sessions.spawn = async () => { throw new Error('model must be one of …'); };
  const r = await call(host, 'root');
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /spawn failed: model must be/);
});
