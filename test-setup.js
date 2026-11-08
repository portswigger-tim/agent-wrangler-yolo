import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Loaded via `node --test --import ./test-setup.js`, before any test file in
// every subprocess. data-dir.js resolves DATA_DIR from AW_DATA_DIR at import
// time, so this keeps every store a test builds off the real
// ~/.agent-wrangler/yolo.json.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yolo-test-'));
process.env.AW_DATA_DIR = dataDir;
process.on('exit', () => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});
