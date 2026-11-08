import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { YoloStore } from '../store.js';
import { makeTools, NOT_ENROLLED } from './index.js';

function setup(settings = {}) {
  const store = new YoloStore({ file: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'yolo-tools-')), 'yolo.json') });
  const host = { stores: { yolo: store }, settings: { all: () => settings } };
  const seen = { cwd: null, applied: null, ctx: null };
  // A gh that reports a repo with every control already passing, except the
  // two rulesets, and records where it ran.
  const makeClient = ({ cwd }) => {
    seen.cwd = cwd;
    return {
      repoFor: async () => ({ repo: 'o/r', defaultBranch: 'main' }),
      probe: async () => ({ found: true, body: { enabled: true } }),
      api: async (method, p, body) => {
        if (method !== 'GET') seen.applied = { method, p, body };
        if (p === '/repos/o/r') return { allow_auto_merge: true, delete_branch_on_merge: true, allow_update_branch: true, allow_squash_merge: true, allow_rebase_merge: false, allow_merge_commit: false, squash_merge_commit_title: 'PR_TITLE', squash_merge_commit_message: 'PR_BODY', security_and_analysis: { secret_scanning: { status: 'enabled' }, secret_scanning_push_protection: { status: 'enabled' } } };
        if (p.endsWith('/default-setup')) return { state: 'configured' };
        if (p.endsWith('/actions/permissions/workflow')) return { default_workflow_permissions: 'read', can_approve_pull_request_reviews: false };
        if (p.endsWith('/actions/permissions')) return { sha_pinning_required: true };
        if (p.includes('/rulesets')) return method === 'GET' ? [] : {};
        if (p.includes('/pulls')) return [];
        throw new Error(`unexpected ${method} ${p}`);
      },
    };
  };
  const tools = Object.fromEntries(makeTools({ makeClient }).map((t) => [t.name, t]));
  return { store, host, seen, tools };
}

test('both tools refuse a caller that is not enrolled, or has no identity', async () => {
  const { host, tools } = setup();
  for (const t of Object.values(tools)) {
    assert.equal((await t.handler({ host, caller: 'stranger' }, {})).content[0].text, NOT_ENROLLED);
    assert.equal((await t.handler({ host, caller: null }, {})).isError, true);
  }
});

test('audit runs in the caller\'s enrolled repo and writes nothing', async () => {
  const { store, host, seen, tools } = setup();
  store.enrol('s1', { repo: '/work/repo' });
  const r = await tools.yolo_audit_repo.handler({ host, caller: 's1' }, {});
  assert.equal(seen.cwd, '/work/repo');
  assert.equal(seen.applied, null);
  assert.match(r.content[0].text, /^o\/r: 2 of 11 controls failing\./);
  assert.equal(r.structuredContent.applied, false);
});

test('harden is a dry run unless apply is true, and honours settings and required_checks', async () => {
  const { store, host, seen, tools } = setup({ mergeMethod: 'squash', requireSignedCommits: true });
  store.enrol('s1', { repo: '/work/repo' });
  await tools.yolo_harden_repo.handler({ host, caller: 's1' }, { required_checks: ['ci'] });
  assert.equal(seen.applied, null);
  const r = await tools.yolo_harden_repo.handler({ host, caller: 's1' }, { apply: true, required_checks: ['ci'] });
  assert.equal(r.structuredContent.applied, true);
  assert.deepEqual(r.structuredContent.requiredChecks, ['ci']);
  assert.equal(seen.applied.method, 'POST');
  assert.ok(seen.applied.body.rules.some((x) => x.type === 'required_signatures') || seen.applied.body.name.includes('tags'));
});

test('a gh failure comes back as a tool error, not a throw', async () => {
  const { store, host } = setup();
  store.enrol('s1', { repo: '/work/repo' });
  const [audit] = makeTools({ makeClient: () => ({ repoFor: async () => { throw new Error('gh: not logged in'); } }) });
  const r = await audit.handler({ host, caller: 's1' }, {});
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /not logged in/);
});
