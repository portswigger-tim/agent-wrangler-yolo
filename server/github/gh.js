import { spawn } from 'node:child_process';

export class GhError extends Error {
  constructor(message, { status = null, stderr = '' } = {}) {
    super(message);
    this.status = status;
    this.stderr = stderr;
  }
}

// One `gh` invocation. The body goes on stdin, never argv, so nothing a
// request carries shows up in `ps`.
export function runGh(args, { cwd, input, timeout = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('gh', args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], timeout });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => reject(err.code === 'ENOENT' ? new GhError('gh is not installed') : err));
    child.on('close', (code) => {
      if (code === 0) return resolve(stdout);
      const status = Number(/\(HTTP (\d{3})\)/.exec(stderr)?.[1]) || null;
      reject(new GhError(stderr.trim().split('\n')[0] || `gh exited ${code}`, { status, stderr }));
    });
    child.stdin.end(input ?? '');
  });
}

// A tiny REST client over the user's authenticated gh. `api` returns parsed
// JSON, or null for an empty body (204s).
export function makeGh({ run = runGh, cwd } = {}) {
  async function api(method, path, body) {
    const args = ['api', '-X', method, path, '-H', 'Accept: application/vnd.github+json', '-H', 'X-GitHub-Api-Version: 2022-11-28'];
    if (body !== undefined) args.push('--input', '-');
    const out = await run(args, { cwd, input: body === undefined ? undefined : JSON.stringify(body) });
    return out.trim() ? JSON.parse(out) : null;
  }
  // GET that maps a 404 to null: "not enabled" for the toggle endpoints.
  async function probe(path) {
    try {
      return { found: true, body: await api('GET', path) };
    } catch (err) {
      if (err.status === 404) return { found: false, body: null };
      throw err;
    }
  }
  async function repoFor(dir) {
    const out = await run(['repo', 'view', '--json', 'nameWithOwner,defaultBranchRef,visibility'], { cwd: dir });
    const r = JSON.parse(out);
    return { repo: r.nameWithOwner, defaultBranch: r.defaultBranchRef?.name ?? 'main', visibility: r.visibility };
  }
  return { api, probe, repoFor };
}
