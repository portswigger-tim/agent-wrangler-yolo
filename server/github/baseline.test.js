import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  branchRuleset, tagRuleset, contains, rulesetSatisfies, mergeRuleset, mergeSettings,
  buildControls, runBaseline, detectRequiredChecks, planLimited, BRANCH_RULESET, TAG_RULESET, GITHUB_ACTIONS_APP_ID,
} from './baseline.js';

// An in-memory GitHub: just enough REST for the controls, recording writes.
function fakeGitHub(initial = {}) {
  const s = {
    repo: { allow_auto_merge: false, delete_branch_on_merge: false, allow_update_branch: false, allow_squash_merge: true, allow_rebase_merge: true, allow_merge_commit: true, squash_merge_commit_title: 'COMMIT_OR_PR_TITLE', squash_merge_commit_message: 'COMMIT_MESSAGES', security_and_analysis: { secret_scanning: { status: 'disabled' }, secret_scanning_push_protection: { status: 'disabled' } } },
    toggles: { '/vulnerability-alerts': false, '/automated-security-fixes': false, '/private-vulnerability-reporting': false, '/immutable-releases': false },
    codeql: 'not-configured',
    workflow: { default_workflow_permissions: 'write', can_approve_pull_request_reviews: true },
    actions: { enabled: true, allowed_actions: 'selected', sha_pinning_required: false },
    rulesets: [],
    pulls: [],
    checkRuns: {},
    ...initial,
  };
  const writes = [];
  const R = '/repos/o/r';
  const notFound = () => Object.assign(new Error('Not Found'), { status: 404 });
  async function api(method, path, body) {
    if (method !== 'GET') writes.push({ method, path, body });
    const p = path.replace(R, '');
    if (p === '' && method === 'GET') return s.repo;
    if (p === '' && method === 'PATCH') {
      const { security_and_analysis: sa, ...rest } = body;
      Object.assign(s.repo, rest);
      if (sa) Object.assign(s.repo.security_and_analysis, sa);
      return s.repo;
    }
    if (p in s.toggles) {
      if (method === 'PUT') { s.toggles[p] = true; return null; }
      if (p === '/vulnerability-alerts') { if (!s.toggles[p]) throw notFound(); return null; }
      return { enabled: s.toggles[p] };
    }
    if (p === '/code-scanning/default-setup') { if (method === 'PATCH') s.codeql = body.state; return { state: s.codeql }; }
    if (p === '/actions/permissions/workflow') { if (method === 'PUT') Object.assign(s.workflow, body); return s.workflow; }
    if (p === '/actions/permissions') { if (method === 'PUT') s.actions = { ...body }; return s.actions; }
    if (p.startsWith('/rulesets?')) return s.rulesets.map(({ id, name }) => ({ id, name }));
    if (p === '/rulesets' && method === 'POST') { const r = { ...body, id: s.rulesets.length + 1 }; s.rulesets.push(r); return r; }
    const m = /^\/rulesets\/(\d+)$/.exec(p);
    if (m) {
      const i = s.rulesets.findIndex((r) => r.id === Number(m[1]));
      if (method === 'PUT') s.rulesets[i] = { ...body, id: Number(m[1]) };
      return s.rulesets[i];
    }
    if (p.startsWith('/pulls?')) return s.pulls;
    const c = /^\/commits\/(\w+)\/check-runs/.exec(p);
    if (c) return { check_runs: s.checkRuns[c[1]] ?? [] };
    throw new Error(`unexpected ${method} ${path}`);
  }
  async function probe(path) {
    try { return { found: true, body: await api('GET', path) }; } catch (err) { if (err.status === 404) return { found: false, body: null }; throw err; }
  }
  return { gh: { api, probe }, state: s, writes };
}

const ctx = { repo: 'o/r', mergeMethod: 'squash', requiredChecks: ['pre-commit', 'test'], signedCommits: false };

test('branchRuleset: PR rules with zero approvals, checks pinned to GitHub Actions, signatures optional', () => {
  const r = branchRuleset(ctx);
  assert.equal(r.name, BRANCH_RULESET);
  assert.deepEqual(r.conditions.ref_name.include, ['~DEFAULT_BRANCH']);
  const pr = r.rules.find((x) => x.type === 'pull_request').parameters;
  assert.equal(pr.required_approving_review_count, 0);
  assert.deepEqual(pr.allowed_merge_methods, ['squash']);
  const checks = r.rules.find((x) => x.type === 'required_status_checks').parameters.required_status_checks;
  assert.deepEqual(checks, [{ context: 'pre-commit', integration_id: GITHUB_ACTIONS_APP_ID }, { context: 'test', integration_id: GITHUB_ACTIONS_APP_ID }]);
  assert.equal(r.rules.some((x) => x.type === 'required_signatures'), false);
  assert.equal(branchRuleset({ ...ctx, signedCommits: true }).rules.some((x) => x.type === 'required_signatures'), true);
  assert.equal(branchRuleset({ ...ctx, requiredChecks: [] }).rules.some((x) => x.type === 'required_status_checks'), false);
});

test('tagRuleset blocks update, deletion and force-push on v* tags', () => {
  const r = tagRuleset();
  assert.equal(r.name, TAG_RULESET);
  assert.deepEqual(r.conditions.ref_name.include, ['refs/tags/v*']);
  assert.deepEqual(r.rules.map((x) => x.type).sort(), ['deletion', 'non_fast_forward', 'update']);
});

test('contains: nested objects and arrays as subsets', () => {
  assert.equal(contains({ a: 1, b: [{ c: 1, d: 2 }, { c: 3 }] }, { b: [{ c: 3 }] }), true);
  assert.equal(contains({ a: 1 }, { a: 2 }), false);
  assert.equal(contains([1, 2], [3]), false);
});

test('rulesetSatisfies wants every rule active and at least as strict', () => {
  const desired = branchRuleset(ctx);
  assert.equal(rulesetSatisfies({ ...desired }, desired), true);
  assert.equal(rulesetSatisfies({ ...desired, enforcement: 'evaluate' }, desired), false);
  assert.equal(rulesetSatisfies({ ...desired, rules: desired.rules.slice(1) }, desired), false);
  assert.equal(rulesetSatisfies(null, desired), false);
});

test('mergeRuleset keeps what a human made stricter and adds what is missing', () => {
  const desired = branchRuleset(ctx);
  const current = {
    id: 7,
    enforcement: 'disabled',
    bypass_actors: [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }],
    conditions: { ref_name: { include: ['~DEFAULT_BRANCH', 'refs/heads/release/*'], exclude: [] } },
    rules: [
      { type: 'pull_request', parameters: { required_approving_review_count: 2, dismiss_stale_reviews_on_push: false, require_code_owner_review: true, require_last_push_approval: false, required_review_thread_resolution: false, allowed_merge_methods: ['squash', 'merge'] } },
      { type: 'required_status_checks', parameters: { strict_required_status_checks_policy: false, do_not_enforce_on_create: true, required_status_checks: [{ context: 'lint', integration_id: GITHUB_ACTIONS_APP_ID }] } },
      { type: 'required_signatures' },
    ],
  };
  const m = mergeRuleset(current, desired);
  assert.equal(m.enforcement, 'active');
  assert.deepEqual(m.bypass_actors, current.bypass_actors);
  assert.deepEqual(m.conditions.ref_name.include, ['~DEFAULT_BRANCH', 'refs/heads/release/*']);
  const pr = m.rules.find((r) => r.type === 'pull_request').parameters;
  assert.equal(pr.required_approving_review_count, 2);
  assert.equal(pr.require_code_owner_review, true);
  assert.equal(pr.dismiss_stale_reviews_on_push, true);
  assert.equal(pr.required_review_thread_resolution, true);
  assert.deepEqual(pr.allowed_merge_methods, ['squash']);
  const sc = m.rules.find((r) => r.type === 'required_status_checks').parameters;
  assert.equal(sc.strict_required_status_checks_policy, true);
  assert.equal(sc.do_not_enforce_on_create, false);
  assert.deepEqual(sc.required_status_checks.map((c) => c.context), ['lint', 'pre-commit', 'test']);
  assert.ok(m.rules.some((r) => r.type === 'required_signatures'));
  for (const t of ['deletion', 'non_fast_forward', 'required_linear_history']) assert.ok(m.rules.some((r) => r.type === t), t);
  assert.equal(rulesetSatisfies(m, desired), true);
});

test('mergeSettings allows exactly one merge method, PR title as the squash subject', () => {
  assert.deepEqual(
    [mergeSettings('squash').allow_squash_merge, mergeSettings('squash').allow_rebase_merge, mergeSettings('squash').allow_merge_commit],
    [true, false, false],
  );
  assert.equal(mergeSettings('squash').squash_merge_commit_title, 'PR_TITLE');
  assert.equal(mergeSettings('rebase').squash_merge_commit_title, undefined);
});

test('runBaseline dry run reports every gap and writes nothing', async () => {
  const { gh, writes } = fakeGitHub();
  const results = await runBaseline(gh, ctx);
  assert.equal(writes.length, 0);
  assert.equal(results.length, buildControls().length);
  assert.ok(results.every((r) => !r.ok && r.action === 'would-apply'), JSON.stringify(results));
});

test('runBaseline apply fixes everything, then a second run is a no-op', async () => {
  const { gh, state, writes } = fakeGitHub();
  const results = await runBaseline(gh, ctx, { apply: true });
  assert.ok(results.every((r) => r.ok && r.action === 'applied'), JSON.stringify(results, null, 2));
  assert.equal(state.actions.allowed_actions, 'selected', 'sha pinning keeps the allowed-actions choice');
  assert.equal(state.rulesets.length, 2);
  const before = writes.length;
  const again = await runBaseline(gh, ctx, { apply: true });
  assert.ok(again.every((r) => r.action === 'none'));
  assert.equal(writes.length, before);
});

test('runBaseline never deletes and never writes a weaker ruleset', async () => {
  const { gh, writes } = fakeGitHub();
  await runBaseline(gh, ctx, { apply: true });
  assert.equal(writes.some((w) => w.method === 'DELETE'), false);
});

test('one failing control does not stop the others', async () => {
  const { gh } = fakeGitHub();
  const boom = { id: 'boom', label: 'Boom', check: async () => { throw new Error('HTTP 403'); }, apply: async () => {} };
  const results = await runBaseline(gh, ctx, { apply: true, controls: [boom, ...buildControls()] });
  assert.equal(results[0].action, 'error');
  assert.match(results[0].detail, /403/);
  assert.ok(results.slice(1).every((r) => r.ok));
});

test('detectRequiredChecks reads GitHub Actions checks off the latest PR head', async () => {
  const { gh } = fakeGitHub({
    pulls: [{ head: { sha: 'abc' } }],
    checkRuns: { abc: [{ name: 'test (22)', app: { id: GITHUB_ACTIONS_APP_ID } }, { name: 'pre-commit', app: { id: GITHUB_ACTIONS_APP_ID } }, { name: 'test (22)', app: { id: GITHUB_ACTIONS_APP_ID } }, { name: 'External CI', app: { id: 99 } }] },
  });
  assert.deepEqual(await detectRequiredChecks(gh, 'o/r'), ['pre-commit', 'test (22)']);
  assert.deepEqual(await detectRequiredChecks(fakeGitHub().gh, 'o/r'), []);
});

test('a plan-limited refusal reads as unavailable, not an error', async () => {
  const { gh } = fakeGitHub();
  const paywalled = { id: 'branch-ruleset', label: 'Ruleset', check: async () => { throw Object.assign(new Error('gh: Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 403)'), { status: 403 }); }, apply: async () => {} };
  const broken = { id: 'x', label: 'X', check: async () => { throw new Error('gh: Bad credentials (HTTP 401)'); }, apply: async () => {} };
  const [a, b] = await runBaseline(gh, ctx, { controls: [paywalled, broken] });
  assert.equal(a.action, 'unavailable');
  assert.match(a.detail, /public repo, GitHub Pro\/Team, or Advanced Security/);
  assert.equal(b.action, 'error');
  assert.equal(planLimited(new Error('Secret scanning is not available for this repository')), true);
  assert.equal(planLimited(new Error('Not Found')), false);
});
