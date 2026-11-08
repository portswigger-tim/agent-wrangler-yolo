#!/usr/bin/env node
// Audit (default) or harden a repository against the YOLO baseline, outside
// the wrangler: the same code the yolo_audit_repo / yolo_harden_repo tools run.
//
//   node scripts/harden.mjs [repo-dir] [--apply] [--checks "a,b"] [--merge-method squash] [--signed]
import { makeGh } from '../server/github/gh.js';
import { runBaseline, detectRequiredChecks, MERGE_METHODS } from '../server/github/baseline.js';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => { const i = args.indexOf(name); return i === -1 ? undefined : args[i + 1]; };
const dir = args.find((a, i) => !a.startsWith('--') && !['--checks', '--merge-method'].includes(args[i - 1])) ?? process.cwd();

const mergeMethod = opt('--merge-method') ?? 'squash';
if (!MERGE_METHODS.includes(mergeMethod)) {
  console.error(`--merge-method must be one of ${MERGE_METHODS.join(', ')}`);
  process.exit(2);
}
const gh = makeGh({ cwd: dir });
const { repo, defaultBranch } = await gh.repoFor(dir);
const requiredChecks = opt('--checks')?.split(',').map((s) => s.trim()).filter(Boolean) ?? await detectRequiredChecks(gh, repo);
const ctx = { repo, defaultBranch, mergeMethod, requiredChecks, signedCommits: flag('--signed') };

console.log(`${repo} (${defaultBranch}), merge ${mergeMethod}, required checks [${requiredChecks.join(', ') || 'none detected'}]${flag('--apply') ? '' : ', dry run'}`);
const results = await runBaseline(gh, ctx, { apply: flag('--apply') });
for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.label}: ${r.detail}${r.action === 'none' ? '' : ` [${r.action}]`}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
