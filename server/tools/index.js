import { z } from 'zod';
import { makeGh } from '../github/gh.js';
import { runBaseline, detectRequiredChecks, MERGE_METHODS } from '../github/baseline.js';
import { okResult, errorResult, NOT_ENROLLED } from './result.js';
import { yoloSpawnTool } from './spawn.js';
import { yoloReleasePrTool } from './release-pr.js';

export { okResult, errorResult, NOT_ENROLLED };

// The caller's enrolled repo, never an argument: narrowness of signature is
// the access control, so a session can only ever touch the repo it was
// launched in.
function enrolledRepo(host, caller) {
  return caller == null ? null : host.stores.yolo.get(caller);
}

function settingsCtx(host) {
  const s = host.settings?.all?.() ?? {};
  return {
    mergeMethod: MERGE_METHODS.includes(s.mergeMethod) ? s.mergeMethod : 'squash',
    signedCommits: s.requireSignedCommits === true,
  };
}

async function baselineFor(host, caller, { apply, requiredChecks, makeClient }) {
  const row = enrolledRepo(host, caller);
  if (!row) return errorResult(NOT_ENROLLED);
  const gh = makeClient({ cwd: row.repo });
  const { repo, defaultBranch } = await gh.repoFor(row.repo);
  const checks = requiredChecks ?? await detectRequiredChecks(gh, repo);
  const ctx = { repo, defaultBranch, requiredChecks: checks, ...settingsCtx(host) };
  const results = await runBaseline(gh, ctx, { apply });
  const unavailable = results.filter((r) => r.action === 'unavailable').length;
  const failing = results.filter((r) => !r.ok).length - unavailable;
  const parts = [failing
    ? `${failing} of ${results.length} controls ${apply ? 'still failing' : 'failing'}`
    : `${results.length - unavailable} of ${results.length} controls pass`];
  if (unavailable) parts.push(`${unavailable} not available on this repo's GitHub plan (needs a public repo, GitHub Pro/Team or Advanced Security; tell the human, don't work around it)`);
  const lead = `${repo}: ${parts.join('; ')}.`;
  return okResult({ repo, defaultBranch, mergeMethod: ctx.mergeMethod, requiredChecks: checks, applied: apply, results }, lead);
}

export function makeTools({ makeClient = makeGh } = {}) {
  return [
    {
      name: 'yolo_audit_repo',
      description:
        'Check your YOLO repo against the security baseline: default-branch ruleset (PRs only, required checks, '
        + 'linear history, no force-push or deletion), immutable v* tags, immutable releases, secret scanning with '
        + 'push protection, Dependabot alerts and security updates, CodeQL, private vulnerability reporting, a '
        + 'read-only workflow token and SHA-pinned actions. Read-only. Acts on the repo this session was launched '
        + 'in; there is no repo parameter. Only available in YOLO sessions.',
      inputSchema: {},
      async handler({ host, caller }) {
        try {
          return await baselineFor(host, caller, { apply: false, makeClient });
        } catch (err) {
          return errorResult(`audit failed: ${err.message}`);
        }
      },
    },
    {
      name: 'yolo_harden_repo',
      description:
        'Bring your YOLO repo up to the security baseline (see yolo_audit_repo). Without apply: true it is a dry '
        + 'run that lists what would change. It only ever tightens: it never deletes or loosens a ruleset, never '
        + 'adds a bypass and never disables a feature, and when it updates its own ruleset it keeps anything '
        + 'stricter already there. Required checks default to the GitHub Actions checks on the most recent PR, '
        + 'so open a PR with CI first; pass required_checks to override. Acts on the repo this session was launched '
        + 'in; there is no repo parameter. Only available in YOLO sessions.',
      inputSchema: {
        apply: z.boolean().optional().describe('true applies the changes; omitted or false is a dry run.'),
        required_checks: z.array(z.string().min(1).max(200)).max(50).optional().describe(
          'Exact check names the default branch must pass, e.g. ["pre-commit", "test (22)"]. Omit to detect them.',
        ),
      },
      async handler({ host, caller }, args = {}) {
        try {
          return await baselineFor(host, caller, { apply: args.apply === true, requiredChecks: args.required_checks, makeClient });
        } catch (err) {
          return errorResult(`harden failed: ${err.message}`);
        }
      },
    },
    yoloSpawnTool,
    yoloReleasePrTool,
  ];
}

export const yoloTools = makeTools();
