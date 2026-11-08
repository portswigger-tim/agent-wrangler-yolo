// The security baseline a YOLO repo is held to, as a list of controls. Each
// control can `check` the live repo and `apply` itself. Every apply only ever
// TIGHTENS: it sets the fields it owns to their strict value, and when it
// updates one of its own rulesets it keeps anything stricter a human added.
// Nothing here deletes, disables or adds a bypass.

export const BRANCH_RULESET = 'yolo: protect default branch';
export const TAG_RULESET = 'yolo: immutable version tags';
export const GITHUB_ACTIONS_APP_ID = 15368;
export const MERGE_METHODS = ['squash', 'rebase', 'merge'];

export function branchRuleset({ mergeMethod = 'squash', requiredChecks = [], signedCommits = false } = {}) {
  const rules = [
    { type: 'deletion' },
    { type: 'non_fast_forward' },
    { type: 'required_linear_history' },
    {
      type: 'pull_request',
      parameters: {
        // No human approval: checks, the adversarial review and these rules
        // are the gate, and GitHub won't let an author approve their own PR.
        required_approving_review_count: 0,
        dismiss_stale_reviews_on_push: true,
        require_code_owner_review: false,
        require_last_push_approval: false,
        required_review_thread_resolution: true,
        allowed_merge_methods: [mergeMethod],
      },
    },
  ];
  if (requiredChecks.length) {
    rules.push({
      type: 'required_status_checks',
      parameters: {
        strict_required_status_checks_policy: true,
        do_not_enforce_on_create: false,
        required_status_checks: requiredChecks.map((context) => ({ context, integration_id: GITHUB_ACTIONS_APP_ID })),
      },
    });
  }
  if (signedCommits) rules.push({ type: 'required_signatures' });
  return {
    name: BRANCH_RULESET,
    target: 'branch',
    enforcement: 'active',
    conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
    rules,
  };
}

// Version tags can be created (by the release workflow) but never moved or
// deleted, by anyone.
export function tagRuleset() {
  return {
    name: TAG_RULESET,
    target: 'tag',
    enforcement: 'active',
    conditions: { ref_name: { include: ['refs/tags/v*'], exclude: [] } },
    rules: [{ type: 'deletion' }, { type: 'non_fast_forward' }, { type: 'update' }],
  };
}

// Does `have` contain everything `want` asks for? Arrays: every wanted element
// is contained in some element we have.
export function contains(have, want) {
  if (Array.isArray(want)) return Array.isArray(have) && want.every((w) => have.some((h) => contains(h, w)));
  if (want && typeof want === 'object') return Boolean(have) && typeof have === 'object' && Object.entries(want).every(([k, v]) => contains(have[k], v));
  return have === want;
}

// Is the live parameter at least as strict as the one we want?
function atLeast(key, have, want) {
  if (have === undefined) return false;
  if (key === 'allowed_merge_methods') return Array.isArray(have) && have.length > 0 && have.every((m) => want.includes(m));
  if (Array.isArray(want)) return contains(have, want);
  return JSON.stringify(stricter(key, have, want)) === JSON.stringify(have);
}

export function rulesetSatisfies(current, desired) {
  if (!current || current.enforcement !== 'active') return false;
  if (!contains(current.conditions?.ref_name?.include ?? [], desired.conditions.ref_name.include)) return false;
  return desired.rules.every((d) => (current.rules ?? []).some((c) => c.type === d.type
    && Object.entries(d.parameters ?? {}).every(([k, v]) => atLeast(k, c.parameters?.[k], v))));
}

// The stricter of two values for one ruleset parameter.
function stricter(key, a, b) {
  if (a === undefined) return b;
  if (b === undefined) return a;
  if (key === 'allowed_merge_methods') {
    const both = a.filter((m) => b.includes(m));
    return both.length ? both : b;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const seen = new Set(a.map((x) => JSON.stringify(x)));
    return [...a, ...b.filter((x) => !seen.has(JSON.stringify(x)))];
  }
  if (typeof a === 'number' && typeof b === 'number') return Math.max(a, b);
  if (typeof a === 'boolean' && typeof b === 'boolean') {
    // The two parameters where true is the looser value.
    return key === 'do_not_enforce_on_create' ? a && b : a || b;
  }
  return b;
}

// Our desired ruleset folded into the live one: every rule from both, and for a
// rule in both, the stricter of each parameter. Bypass actors are kept as the
// human left them; the audit reports them.
export function mergeRuleset(current, desired) {
  const rules = (current.rules ?? []).map((r) => ({ ...r }));
  for (const d of desired.rules) {
    const i = rules.findIndex((r) => r.type === d.type);
    if (i === -1) { rules.push(d); continue; }
    if (!d.parameters) continue;
    const merged = { ...(rules[i].parameters ?? {}) };
    for (const [k, v] of Object.entries(d.parameters)) merged[k] = stricter(k, merged[k], v);
    rules[i] = { type: d.type, parameters: merged };
  }
  const include = stricter('include', current.conditions?.ref_name?.include ?? [], desired.conditions.ref_name.include);
  return {
    name: desired.name,
    target: desired.target,
    enforcement: 'active',
    bypass_actors: current.bypass_actors ?? [],
    conditions: { ref_name: { include, exclude: current.conditions?.ref_name?.exclude ?? [] } },
    rules,
  };
}

async function findRuleset(gh, repo, name) {
  const list = await gh.api('GET', `/repos/${repo}/rulesets?includes_parents=false&per_page=100`);
  const hit = (list ?? []).find((r) => r.name === name);
  return hit ? gh.api('GET', `/repos/${repo}/rulesets/${hit.id}`) : null;
}

function rulesetControl(id, label, build) {
  return {
    id,
    label,
    async check(gh, ctx) {
      const current = await findRuleset(gh, ctx.repo, build(ctx).name);
      const desired = build(ctx);
      const ok = rulesetSatisfies(current, desired);
      const notes = [];
      if (!current) notes.push('missing');
      else if (!ok) notes.push('present but weaker than the baseline');
      if (current?.bypass_actors?.length) notes.push(`${current.bypass_actors.length} bypass actor(s): review them`);
      return { ok, detail: notes.join('; ') || 'in place', current };
    },
    async apply(gh, ctx, { current }) {
      const desired = build(ctx);
      if (!current) return gh.api('POST', `/repos/${ctx.repo}/rulesets`, desired);
      return gh.api('PUT', `/repos/${ctx.repo}/rulesets/${current.id}`, mergeRuleset(current, desired));
    },
  };
}

// A boolean feature with a GET (404 when off, or `{ enabled }`) and a PUT to turn it on.
function toggleControl(id, label, path, { enabledFrom = (p) => p.found && (p.body?.enabled ?? true) } = {}) {
  return {
    id,
    label,
    async check(gh, ctx) {
      const ok = enabledFrom(await gh.probe(`/repos/${ctx.repo}${path}`));
      return { ok, detail: ok ? 'enabled' : 'disabled' };
    },
    apply: (gh, ctx) => gh.api('PUT', `/repos/${ctx.repo}${path}`),
  };
}

export function mergeSettings(mergeMethod) {
  return {
    allow_auto_merge: true,
    delete_branch_on_merge: true,
    allow_update_branch: true,
    allow_squash_merge: mergeMethod === 'squash',
    allow_rebase_merge: mergeMethod === 'rebase',
    allow_merge_commit: mergeMethod === 'merge',
    // The PR title becomes the commit subject, so a conventional PR title is
    // what release-please reads.
    ...(mergeMethod === 'squash' ? { squash_merge_commit_title: 'PR_TITLE', squash_merge_commit_message: 'PR_BODY' } : {}),
  };
}

export function buildControls() {
  return [
    {
      id: 'merge-settings',
      label: 'Auto-merge, branch clean-up and one merge method',
      async check(gh, ctx) {
        const r = await gh.api('GET', `/repos/${ctx.repo}`);
        const want = mergeSettings(ctx.mergeMethod);
        const off = Object.entries(want).filter(([k, v]) => r[k] !== undefined && r[k] !== v).map(([k]) => k);
        return { ok: off.length === 0, detail: off.length ? `differs: ${off.join(', ')}` : 'in place' };
      },
      apply: (gh, ctx) => gh.api('PATCH', `/repos/${ctx.repo}`, mergeSettings(ctx.mergeMethod)),
    },
    {
      id: 'secret-scanning',
      label: 'Secret scanning with push protection',
      async check(gh, ctx) {
        const s = (await gh.api('GET', `/repos/${ctx.repo}`)).security_and_analysis ?? {};
        const ok = s.secret_scanning?.status === 'enabled' && s.secret_scanning_push_protection?.status === 'enabled';
        return { ok, detail: `scanning ${s.secret_scanning?.status ?? 'unavailable'}, push protection ${s.secret_scanning_push_protection?.status ?? 'unavailable'}` };
      },
      apply: (gh, ctx) => gh.api('PATCH', `/repos/${ctx.repo}`, {
        security_and_analysis: { secret_scanning: { status: 'enabled' }, secret_scanning_push_protection: { status: 'enabled' } },
      }),
    },
    toggleControl('dependabot-alerts', 'Dependabot alerts', '/vulnerability-alerts', { enabledFrom: (p) => p.found }),
    toggleControl('dependabot-security-updates', 'Dependabot security updates', '/automated-security-fixes'),
    toggleControl('private-vulnerability-reporting', 'Private vulnerability reporting', '/private-vulnerability-reporting'),
    toggleControl('immutable-releases', 'Immutable releases', '/immutable-releases'),
    {
      id: 'codeql',
      label: 'CodeQL default setup',
      async check(gh, ctx) {
        const s = await gh.api('GET', `/repos/${ctx.repo}/code-scanning/default-setup`);
        return { ok: s?.state === 'configured', detail: s?.state ?? 'unknown' };
      },
      apply: (gh, ctx) => gh.api('PATCH', `/repos/${ctx.repo}/code-scanning/default-setup`, { state: 'configured' }),
    },
    {
      id: 'actions-token',
      label: 'Workflow token read-only, and Actions cannot approve PRs',
      async check(gh, ctx) {
        const p = await gh.api('GET', `/repos/${ctx.repo}/actions/permissions/workflow`);
        const ok = p.default_workflow_permissions === 'read' && p.can_approve_pull_request_reviews === false;
        return { ok, detail: `token ${p.default_workflow_permissions}, can approve ${p.can_approve_pull_request_reviews}` };
      },
      apply: (gh, ctx) => gh.api('PUT', `/repos/${ctx.repo}/actions/permissions/workflow`, { default_workflow_permissions: 'read', can_approve_pull_request_reviews: false }),
    },
    {
      id: 'actions-sha-pinning',
      label: 'Actions must be pinned to a full commit SHA',
      async check(gh, ctx) {
        const p = await gh.api('GET', `/repos/${ctx.repo}/actions/permissions`);
        return { ok: p.sha_pinning_required === true, detail: `sha pinning ${p.sha_pinning_required ? 'required' : 'not required'}`, current: p };
      },
      // PUT replaces the whole policy: carry the allowed-actions choice over.
      apply: (gh, ctx, { current }) => gh.api('PUT', `/repos/${ctx.repo}/actions/permissions`, {
        enabled: true, allowed_actions: current?.allowed_actions ?? 'all', sha_pinning_required: true,
      }),
    },
    rulesetControl('branch-ruleset', 'Default branch: PRs only, required checks, linear, no force-push or delete', (ctx) => branchRuleset(ctx)),
    rulesetControl('tag-ruleset', 'Version tags (v*) immutable', () => tagRuleset()),
  ];
}

// The check runs GitHub Actions reported on the most recently updated PR's
// head: what CI actually runs on a PR, so nothing push-only (a release job)
// becomes a check no PR can ever pass.
export async function detectRequiredChecks(gh, repo) {
  const pulls = await gh.api('GET', `/repos/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=1`);
  const sha = pulls?.[0]?.head?.sha;
  if (!sha) return [];
  const runs = await gh.api('GET', `/repos/${repo}/commits/${sha}/check-runs?per_page=100`);
  const names = (runs?.check_runs ?? []).filter((r) => r.app?.id === GITHUB_ACTIONS_APP_ID).map((r) => r.name);
  return [...new Set(names)].sort();
}

// Check every control; with `apply`, fix the ones that fail. One control's
// error never stops the rest.
export async function runBaseline(gh, ctx, { apply = false, controls = buildControls() } = {}) {
  const results = [];
  for (const c of controls) {
    let row;
    try {
      const state = await c.check(gh, ctx);
      row = { id: c.id, label: c.label, ok: state.ok, detail: state.detail, action: state.ok ? 'none' : (apply ? 'applied' : 'would-apply') };
      if (!state.ok && apply) {
        await c.apply(gh, ctx, state);
        const after = await c.check(gh, ctx);
        row.ok = after.ok;
        row.detail = after.detail;
        if (!after.ok) row.action = 'applied-but-still-failing';
      }
    } catch (err) {
      row = { id: c.id, label: c.label, ok: false, action: 'error', detail: err.message };
    }
    results.push(row);
  }
  return results;
}
