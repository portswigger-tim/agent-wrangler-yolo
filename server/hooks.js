import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

// Every hook type the gate needs: hygiene and tests on commit, the same again
// on a local merge and on push, and the conventional-commit check that feeds
// SemVer releases. Named explicitly so a repo's default_install_hook_types
// cannot narrow the gate.
export const HOOK_TYPES = ['pre-commit', 'pre-merge-commit', 'pre-push', 'commit-msg'];

// The dispatch dialog's slice for this extension: `{ enabled: true }` opts the
// session in. Anything else is off.
export function wantsYolo(ext) {
  return Boolean(ext && typeof ext === 'object' && ext.enabled === true);
}

// Worktrees share the main checkout's hooks dir, so installing once at the repo
// root covers the session's worktree and every child cut from it.
export async function installPreCommit(repoRoot, { exec = run } = {}) {
  if (!fs.existsSync(path.join(repoRoot, '.pre-commit-config.yaml'))) {
    return { installed: false, warning: 'YOLO: no .pre-commit-config.yaml yet. The session will add one before its first commit.' };
  }
  try {
    const { stdout } = await exec('git', ['config', '--get', 'core.hooksPath'], { cwd: repoRoot }).catch(() => ({ stdout: '' }));
    if (stdout.trim()) {
      return { installed: false, warning: `YOLO: core.hooksPath is set (${stdout.trim()}), so pre-commit cannot install its hooks. Unset it to enforce the gate locally; CI still enforces it.` };
    }
    const args = ['install', ...HOOK_TYPES.flatMap((t) => ['-t', t])];
    await exec('pre-commit', args, { cwd: repoRoot, timeout: 30_000 });
    return { installed: true };
  } catch (err) {
    const why = err.code === 'ENOENT' ? 'pre-commit is not installed (brew install pre-commit / pipx install pre-commit)' : (err.stderr || err.message || String(err)).trim().split('\n')[0];
    return { installed: false, warning: `YOLO: could not install pre-commit hooks: ${why}` };
  }
}

async function guarded(name, host, fn, fallback) {
  try {
    return await fn();
  } catch (err) {
    try { host?.log?.(`${name} failed: ${err?.message ?? err}`); } catch { /* nothing left to do */ }
    return fallback;
  }
}

function envFor(row) {
  return { AW_YOLO: '1', AW_YOLO_REPO: row.repo, ...(row.parent ? { AW_YOLO_PARENT: row.parent } : {}) };
}

// New dispatch only, before the worktree is cut: enrol the card against its
// repo, bring the repo up to date so the worktree branches from current main,
// and put the pre-commit gate in place.
export function makePrepare({ exec = run } = {}) {
  return async function prepare({ sessionId, repoRoot, ext, spawnedBy, host } = {}) {
    if (!wantsYolo(ext)) return undefined;
    if (!repoRoot) return { abort: 'YOLO needs a git repository: launch the session inside one.' };
    return guarded('session.prepare', host, async () => {
      const store = host.stores.yolo;
      // yolo_spawn names the parent in the slice (an extension spawn has no
      // core spawnedBy); spawn_session and the dialog set spawnedBy.
      const parentId = (typeof ext.parent === 'string' && ext.parent) || spawnedBy || null;
      const parent = parentId ? store.get(parentId) : null;
      if (typeof ext.parent === 'string' && !parent) return { abort: `YOLO: parent session ${ext.parent} is not in YOLO mode.` };
      // A child may only work on its parent's repo.
      if (parent && parent.repo !== repoRoot) {
        return { abort: `YOLO: a child of a YOLO session must work in ${parent.repo}, not ${repoRoot}.` };
      }
      store.enrol(sessionId, { repo: repoRoot, parent: parent ? parentId : null });
      const warnings = [];
      await exec('git', ['pull', '--ff-only', '--quiet'], { cwd: repoRoot, timeout: 20_000 })
        .catch((err) => warnings.push(`YOLO: git pull --ff-only failed, the worktree may branch from a stale base: ${(err.stderr || err.message || '').trim().split('\n')[0]}`));
      const hooks = await installPreCommit(repoRoot, { exec });
      if (hooks.warning) warnings.push(hooks.warning);
      return warnings.length ? { warnings } : undefined;
    }, { warnings: ['YOLO: setup failed; see the server log.'] });
  };
}

// Every launch of a card: an enrolled card (or a fork of one) gets the env that
// tells its skills they may act. A card that was never enrolled gets nothing.
export function launchContext({ sid, reason, parentId, host } = {}) {
  const store = host?.stores?.yolo;
  if (!store || !sid) return {};
  let row = store.get(sid);
  if (!row && reason === 'fork' && parentId) {
    const parent = store.get(parentId);
    if (parent) row = store.enrol(sid, { repo: parent.repo, parent: parentId });
  }
  return row ? { env: envFor(row) } : {};
}

export function onPurge({ sessionId, host } = {}) {
  try { host?.stores?.yolo?.forget(sessionId); } catch (err) { host?.log?.(`onPurge failed: ${err.message}`); }
}
