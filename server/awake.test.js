import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { WakeLock, makeAwakeGraph, sessionsKeepingAwake, caffeinateArgs, CAFFEINATE } from './awake.js';

const NOW = 1_000_000_000;
const MIN = 60_000;

function fakeSpawn() {
  const children = [];
  const spawn = (cmd, args) => {
    const child = Object.assign(new EventEmitter(), { cmd, args, killed: false, unref() {} });
    child.kill = () => { child.killed = true; child.emit('exit', null, 'SIGTERM'); };
    children.push(child);
    return child;
  };
  return { spawn, children };
}

function host({ enrolled = ['y1'], settings = {} } = {}) {
  return {
    stores: { yolo: { get: (sid) => (enrolled.includes(sid) ? { repo: '/r' } : null) } },
    settings: { all: () => settings },
  };
}

test('caffeinate holds idle, disk and system sleep, and the display only when asked', () => {
  assert.deepEqual(caffeinateArgs({ pid: 42 }), ['-ims', '-w', '42']);
  assert.deepEqual(caffeinateArgs({ display: true, pid: 42 }), ['-dims', '-w', '42']);
});

test('only enrolled sessions that are busy or recently active keep the Mac awake', () => {
  const isYolo = (sid) => sid.startsWith('y');
  const sessions = [
    { sessionId: 'y-working', status: 'working', lastActivity: NOW - 120 * MIN },
    { sessionId: 'y-shell', status: 'idle', hasBackgroundShell: true },
    { sessionId: 'y-waiting-ci', status: 'idle', lastActivity: NOW - 10 * MIN },
    { sessionId: 'y-stale', status: 'idle', lastActivity: NOW - 31 * MIN },
    { sessionId: 'y-snoozed', status: 'idle', lastActivity: NOW - MIN, snooze: { until: NOW + MIN } },
    { sessionId: 'y-snooze-over', status: 'idle', lastActivity: NOW - MIN, snooze: { until: NOW - MIN } },
    { sessionId: 'n-working', status: 'working', lastActivity: NOW },
    { status: 'working' },
  ];
  assert.deepEqual(sessionsKeepingAwake({ sessions, isYolo, now: NOW, graceMs: 30 * MIN }), ['y-working', 'y-shell', 'y-waiting-ci', 'y-snooze-over']);
  assert.deepEqual(sessionsKeepingAwake({ sessions, isYolo, now: NOW, graceMs: 0 }), ['y-working', 'y-shell']);
});

test('the lock starts caffeinate once, tied to the server pid, and releases it', () => {
  const { spawn, children } = fakeSpawn();
  const lock = new WakeLock({ spawn, platform: 'darwin', pid: 7 });
  assert.equal(lock.hold(), true);
  assert.equal(lock.hold(), true);
  assert.equal(children.length, 1);
  assert.equal(children[0].cmd, CAFFEINATE);
  assert.deepEqual(children[0].args, ['-ims', '-w', '7']);
  lock.release();
  assert.equal(children[0].killed, true);
  assert.equal(lock.held, false);
});

test('changing the display choice restarts caffeinate', () => {
  const { spawn, children } = fakeSpawn();
  const lock = new WakeLock({ spawn, platform: 'darwin', pid: 7 });
  lock.hold({ display: false });
  lock.hold({ display: true });
  assert.equal(children.length, 2);
  assert.equal(children[0].killed, true);
  assert.deepEqual(children[1].args, ['-dims', '-w', '7']);
});

test('a caffeinate that exits on its own is started again on the next hold', () => {
  const { spawn, children } = fakeSpawn();
  const lock = new WakeLock({ spawn, platform: 'darwin' });
  lock.hold();
  children[0].emit('exit', 0, null);
  assert.equal(lock.held, false);
  lock.hold();
  assert.equal(children.length, 2);
});

test('a missing caffeinate is logged once and never retried', () => {
  const logs = [];
  const { spawn, children } = fakeSpawn();
  const lock = new WakeLock({ spawn, platform: 'darwin', log: (m) => logs.push(m) });
  lock.hold();
  children[0].emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }));
  assert.equal(lock.held, false);
  assert.equal(lock.hold(), false);
  assert.equal(children.length, 1);
  assert.equal(logs.filter((m) => m.startsWith('cannot keep')).length, 1);
});

test('off macOS the lock does nothing', () => {
  const { spawn, children } = fakeSpawn();
  const lock = new WakeLock({ spawn, platform: 'linux' });
  assert.equal(lock.hold(), false);
  assert.equal(children.length, 0);
});

test('the graph contributor holds the lock while YOLO work is in flight and lets go after', () => {
  const { spawn, children } = fakeSpawn();
  const lock = new WakeLock({ spawn, platform: 'darwin' });
  let now = NOW;
  const graph = makeAwakeGraph({ lock, now: () => now });
  const h = host();
  const sessions = [{ sessionId: 'y1', status: 'working', lastActivity: NOW }, { sessionId: 'other', status: 'working' }];

  assert.deepEqual(graph({ host: h, graph: { sessions } }), { yoloAwake: { held: true, sessions: ['y1'] } });
  sessions[0].status = 'idle';
  now = NOW + 29 * MIN;
  assert.equal(graph({ host: h, graph: { sessions } }).yoloAwake.held, true);
  now = NOW + 31 * MIN;
  assert.deepEqual(graph({ host: h, graph: { sessions } }), { yoloAwake: { held: false, sessions: [] } });
  assert.equal(children.length, 1);
  assert.equal(children[0].killed, true);
});

test('settings: allowSleep turns it off, keepDisplayAwake adds -d, the grace period is configurable', () => {
  const sessions = [{ sessionId: 'y1', status: 'idle', lastActivity: NOW - 10 * MIN }];
  const run = (settings) => {
    const { spawn, children } = fakeSpawn();
    const lock = new WakeLock({ spawn, platform: 'darwin' });
    const out = makeAwakeGraph({ lock, now: () => NOW })({ host: host({ settings }), graph: { sessions } });
    return { held: out.yoloAwake.held, args: children[0]?.args };
  };
  assert.equal(run({ allowSleep: true }).held, false);
  assert.deepEqual(run({ keepDisplayAwake: true }).args, ['-dims', '-w', String(process.pid)]);
  assert.equal(run({ awakeGraceMinutes: 5 }).held, false);
  assert.equal(run({ awakeGraceMinutes: 15 }).held, true);
});

test('the activation probe and a throwing host leave the lock alone', () => {
  const { spawn, children } = fakeSpawn();
  const lock = new WakeLock({ spawn, platform: 'darwin' });
  const graph = makeAwakeGraph({ lock, now: () => NOW });
  lock.hold();
  assert.deepEqual(graph({ host: host(), graph: {} }), { yoloAwake: { held: true, sessions: [] } });
  const bad = { stores: { yolo: { get() { throw new Error('boom'); } } }, settings: { all: () => ({}) } };
  assert.deepEqual(graph({ host: bad, graph: { sessions: [{ sessionId: 'y1', status: 'working' }] } }), { yoloAwake: { held: true, sessions: [] } });
  assert.equal(children[0].killed, false);
});
