import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { DATA_DIR } from './data-dir.js';

const run = promisify(execFile);

// The pinned CLI's package.json + lockfile ship in the repo; the install lives
// in the data dir so the extension itself stays dependency-light.
export const TOOL_SRC = fileURLToPath(new URL('../tools/release-please/', import.meta.url));
export const TOOL_DIR = path.join(DATA_DIR, 'yolo', 'release-please');
export const CONFIG_FILE = 'release-please-config.json';
export const MANIFEST_FILE = '.release-please-manifest.json';
export const PENDING_LABEL = 'autorelease: pending';

function lockHash(dir) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, 'package-lock.json'))).digest('hex');
}

// Install (or reinstall, when the shipped lockfile changed) with npm ci, which
// verifies every package against the lockfile's integrity hashes, and with
// install scripts off.
export async function ensureReleasePlease({ src = TOOL_SRC, dir = TOOL_DIR, exec = run } = {}) {
  const bin = path.join(dir, 'node_modules', '.bin', 'release-please');
  const stamp = path.join(dir, '.lock-sha256');
  const want = lockHash(src);
  if (fs.existsSync(bin) && fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === want) return bin;
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(src, f), path.join(dir, f));
  await exec('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--silent'], { cwd: dir, timeout: 180_000 });
  fs.writeFileSync(stamp, want);
  return bin;
}

// Open or update the release PR as the user, so it starts CI like any PR of
// theirs and no workflow needs permission to create pull requests. The token
// goes to the CLI as a 0600 file path (release-please reads a path-shaped
// --token from disk), never in argv, and is removed straight after.
export async function openReleasePr({ repoDir, repo, defaultBranch, exec = run, ensure = ensureReleasePlease } = {}) {
  for (const f of [CONFIG_FILE, MANIFEST_FILE]) {
    if (!fs.existsSync(path.join(repoDir, f))) throw new Error(`${f} is missing: add release-please config to the repo first`);
  }
  const bin = await ensure({ exec });
  const { stdout: token } = await exec('gh', ['auth', 'token'], { cwd: repoDir });
  if (!token.trim()) throw new Error('gh auth token returned nothing: is gh logged in?');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yolo-rp-'));
  const tokenFile = path.join(tmp, 'token');
  try {
    fs.writeFileSync(tokenFile, token.trim(), { mode: 0o600 });
    const { stdout, stderr } = await exec(bin, [
      'release-pr',
      '--token', tokenFile,
      '--repo-url', repo,
      '--target-branch', defaultBranch,
      '--config-file', CONFIG_FILE,
      '--manifest-file', MANIFEST_FILE,
    ], { cwd: repoDir, timeout: 180_000 });
    const { stdout: list } = await exec('gh', ['pr', 'list', '--repo', repo, '--state', 'open', '--label', PENDING_LABEL, '--json', 'number,url,title,headRefName'], { cwd: repoDir });
    return { pulls: JSON.parse(list || '[]'), log: `${stdout}${stderr}`.trim().split('\n').slice(-20).join('\n') };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
