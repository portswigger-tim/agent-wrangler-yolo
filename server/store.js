import fs from 'node:fs';
import path from 'node:path';

// Which cards are running in YOLO mode, and the one repo each may act on.
// The dispatch-field slice only reaches the launch hooks, and core's session
// projection does not carry it, so this file is the extension's own record:
// tools ask it "is my caller enrolled, and for which repo?".
//
// { sessions: { [sid]: { repo, parent, enrolledAt } } }
export class YoloStore {
  constructor({ file, log = () => {}, now = Date.now } = {}) {
    this.file = file;
    this.log = log;
    this.now = now;
    this.state = this.#load();
  }

  #load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (raw && typeof raw.sessions === 'object' && raw.sessions) return { sessions: raw.sessions };
    } catch (err) {
      if (err.code !== 'ENOENT') this.log(`yolo store unreadable, starting empty: ${err.message}`);
    }
    return { sessions: {} };
  }

  #save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(this.state, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  get(sid) {
    const row = this.state.sessions[sid];
    return row ? { ...row } : null;
  }

  // A repo is fixed at first enrolment: a later launch of the same card
  // (resume, a cwd change) cannot widen what it was granted.
  enrol(sid, { repo, parent = null }) {
    if (typeof sid !== 'string' || !sid) throw new Error('sid is required');
    if (typeof repo !== 'string' || !path.isAbsolute(repo)) throw new Error('repo must be an absolute path');
    const existing = this.state.sessions[sid];
    if (existing) return { ...existing };
    const row = { repo, parent, enrolledAt: this.now() };
    this.state.sessions[sid] = row;
    this.#save();
    return { ...row };
  }

  childrenOf(sid) {
    return Object.entries(this.state.sessions).filter(([, row]) => row.parent === sid).map(([id]) => id);
  }

  forget(sid) {
    if (!(sid in this.state.sessions)) return false;
    delete this.state.sessions[sid];
    this.#save();
    return true;
  }
}
