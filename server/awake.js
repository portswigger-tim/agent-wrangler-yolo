import { spawn as childSpawn } from 'node:child_process';

// Keep the Mac awake while YOLO work is in flight, so a session left to get on
// with it isn't halted by idle sleep (and the credential caches that go with
// it). macOS only: `caffeinate` takes the same IOKit power assertions as the
// screen-lock APIs, and `-w` ties it to the wrangler server's pid, so a crashed
// server can never leave the Mac pinned awake.

export const CAFFEINATE = '/usr/bin/caffeinate';
export const DEFAULT_GRACE_MINUTES = 30;

// -i idle sleep, -m disk sleep, -s system sleep (honoured on AC power only);
// -d also keeps the display on, so the screen never locks.
export function caffeinateArgs({ display = false, pid = process.pid } = {}) {
  return [display ? '-dims' : '-ims', '-w', String(pid)];
}

// Which enrolled sessions need the Mac awake: one that is working or has a
// background shell, or was active within the grace window. The window covers a
// session that ended its turn to wait for CI, auto-fix and auto-merge: the
// wrangler's PR watch has to stay awake to wake it again. A session waiting on
// you (`needs-you`) only counts while it is inside the window.
export function sessionsKeepingAwake({ sessions, isYolo, now = Date.now(), graceMs = DEFAULT_GRACE_MINUTES * 60_000 }) {
  const out = [];
  for (const s of sessions) {
    if (!s?.sessionId || !isYolo(s.sessionId)) continue;
    const busy = s.status === 'working' || s.hasBackgroundShell === true;
    const recent = typeof s.lastActivity === 'number' && now - s.lastActivity < graceMs;
    if (busy || (recent && !s.snooze)) out.push(s.sessionId);
  }
  return out;
}

export class WakeLock {
  constructor({ spawn = childSpawn, platform = process.platform, pid = process.pid, log = () => {} } = {}) {
    this.spawn = spawn;
    this.supported = platform === 'darwin';
    this.pid = pid;
    this.log = log;
    this.child = null;
    this.display = null;
  }

  get held() {
    return this.child !== null;
  }

  // Idempotent: called every board tick. Restarts caffeinate only when the
  // display choice changes, or when it died underneath us.
  hold({ display = false } = {}) {
    if (!this.supported) return false;
    if (this.child && this.display === display) return true;
    this.release();
    let child;
    try {
      child = this.spawn(CAFFEINATE, caffeinateArgs({ display, pid: this.pid }), { stdio: 'ignore' });
    } catch (err) {
      this.#unavailable(err);
      return false;
    }
    child.on('error', (err) => { if (this.child === child) { this.child = null; this.#unavailable(err); } });
    child.on('exit', () => { if (this.child === child) this.child = null; });
    child.unref?.();
    this.child = child;
    this.display = display;
    this.log(`keeping the Mac awake for YOLO sessions${display ? ' (display on)' : ''}`);
    return true;
  }

  release() {
    const child = this.child;
    if (!child) return;
    this.child = null;
    this.display = null;
    try { child.kill(); } catch { /* already gone */ }
    this.log('YOLO sessions idle: the Mac may sleep again');
  }

  #unavailable(err) {
    this.supported = false;
    this.log(`cannot keep the Mac awake: ${err?.message ?? err}`);
  }
}

function settingsFor(host) {
  const s = host?.settings?.all?.() ?? {};
  const minutes = Number(s.awakeGraceMinutes);
  return {
    // Awake unless turned off: walking away is the point of YOLO.
    enabled: s.allowSleep !== true,
    display: s.keepDisplayAwake === true,
    graceMs: (Number.isFinite(minutes) && minutes >= 0 ? minutes : DEFAULT_GRACE_MINUTES) * 60_000,
  };
}

// A graph contributor: it runs on every ~4s board rebuild while the extension
// is on, sees each session's live status, and must never throw or log per
// tick. It publishes `yoloAwake` so the board can say why the Mac is awake.
export function makeAwakeGraph({ lock, now = Date.now } = {}) {
  return function awakeGraph({ host, graph } = {}) {
    try {
      // Activation probes the keys with an empty graph: leave the lock alone.
      if (!Array.isArray(graph?.sessions)) return { yoloAwake: { held: lock.held, sessions: [] } };
      const store = host?.stores?.yolo;
      const { enabled, display, graceMs } = settingsFor(host);
      const ids = enabled && store
        ? sessionsKeepingAwake({ sessions: graph.sessions, isYolo: (sid) => Boolean(store.get(sid)), now: now(), graceMs })
        : [];
      if (ids.length) lock.hold({ display }); else lock.release();
      return { yoloAwake: { held: lock.held, sessions: ids } };
    } catch {
      return { yoloAwake: { held: lock.held, sessions: [] } };
    }
  };
}
