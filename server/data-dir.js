import os from 'node:os';
import path from 'node:path';

// The wrangler's own state dir, resolved the way agent-wrangler resolves it
// (AW_DATA_DIR, else ~/.agent-wrangler). Honouring AW_DATA_DIR keeps a dev
// instance and the test suite (test-setup.js) off the real one.
function expandTilde(p) {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

export const DATA_DIR = process.env.AW_DATA_DIR
  ? path.resolve(expandTilde(process.env.AW_DATA_DIR))
  : path.join(os.homedir(), '.agent-wrangler');

export function yoloFile() {
  return path.join(DATA_DIR, 'yolo.json');
}
