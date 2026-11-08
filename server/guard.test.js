import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verdict, decide } from '../skills/yolo/hooks/guard.mjs';

const GUARD = fileURLToPath(new URL('../skills/yolo/hooks/guard.mjs', import.meta.url));

const BLOCKED = [
  'git commit --no-verify -m "wip"',
  'git commit -n -m "wip"',
  'git commit -nm "wip"',
  'git push --no-verify',
  'git merge --no-verify feature',
  'SKIP=eslint git commit -m "x"',
  'SKIP=npm-test,eslint pre-commit run --all-files',
  'pre-commit uninstall',
  'git config core.hooksPath /dev/null',
  'rm -rf .git/hooks',
  'git push --force',
  'git push -f origin feat/x',
  'git push origin +main',
  'git push --force-with-lease origin main',
  'git push origin --delete v1.2.3',
  'git push origin :refs/tags/v1.2.3',
  'git push origin :v1.2.3',
  'gh release delete v1.2.3 --yes',
  'gh api -X DELETE repos/o/r/releases/123',
  'gh api --method DELETE repos/o/r/git/refs/tags/v1.0.0',
  'gh api -X DELETE repos/o/r/rulesets/42',
  'gh api repos/o/r/rulesets/42 -X PUT --input ruleset.json',
  'gh api -X PUT repos/o/r/actions/permissions -F sha_pinning_required=false',
  'gh api -X DELETE repos/o/r/vulnerability-alerts',
  'gh api repos/o/r/code-scanning/default-setup -X PATCH -f state=not-configured',
  'gh api -X DELETE repos/o/r/immutable-releases',
  'gh pr merge 12 --squash --admin',
  'gh repo edit --visibility public',
  'gh repo delete o/r --yes',
  'gh ruleset delete 42',
  'npm test && git commit --no-verify -m x',
  'gh api -X DELETE "repos/o/r/rulesets/42"',
  "gh api --method PUT 'repos/o/r/immutable-releases'",
];

const ALLOWED = [
  'git commit -m "fix: handle --no-verify in docs"',
  'git commit -m "docs: explain git commit -n"',
  'git commit --amend --no-edit',
  'git commit -am "feat: x"',
  'git push -u origin feat/thing',
  'git push --force-with-lease origin feat/thing',
  'git push --follow-tags',
  'git push origin v1.2.3',
  'git tag v1.2.3',
  'git branch -d feat/merged',
  'git push origin --delete feat/merged',
  'gh api repos/o/r/rulesets',
  'gh api repos/o/r/actions/permissions',
  'gh api -X DELETE repos/o/r/git/refs/heads/feat/old',
  'gh pr merge 12 --squash --auto',
  'gh pr close 7 && gh pr reopen 7',
  'gh release view v1.2.3',
  'gh repo edit --enable-auto-merge',
  'pre-commit install -t pre-commit -t pre-push',
  'pre-commit run --all-files',
  'echo SKIP=nothing',
  'git commit -m "docs: never git push --force or git push origin :v1.0.0"',
  'git commit -m "ci: SKIP=x is banned; git config core.hooksPath too"',
  'echo "gh api -X DELETE repos/o/r/rulesets/1"',
  '',
];

for (const cmd of BLOCKED) {
  test(`blocks: ${cmd}`, () => assert.match(verdict(cmd) ?? '', /^YOLO guard: /));
}
for (const cmd of ALLOWED) {
  test(`allows: ${cmd || '(empty)'}`, () => assert.equal(verdict(cmd), null));
}

test('decide does nothing outside YOLO or for other tools', () => {
  const input = { tool_name: 'Bash', tool_input: { command: 'git push --force' } };
  assert.equal(decide(input, {}), null);
  assert.equal(decide(input, { AW_YOLO: '0' }), null);
  assert.equal(decide({ tool_name: 'Edit', tool_input: {} }, { AW_YOLO: '1' }), null);
  const out = decide(input, { AW_YOLO: '1' });
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /hard stop/);
});

test('the script denies over stdin in YOLO and stays silent otherwise', () => {
  const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push --force' } });
  const yolo = spawnSync(process.execPath, [GUARD], { input, env: { ...process.env, AW_YOLO: '1' }, encoding: 'utf8' });
  assert.equal(yolo.status, 0);
  assert.equal(JSON.parse(yolo.stdout).hookSpecificOutput.permissionDecision, 'deny');
  const off = spawnSync(process.execPath, [GUARD], { input, env: { ...process.env, AW_YOLO: '' }, encoding: 'utf8' });
  assert.equal(off.status, 0);
  assert.equal(off.stdout, '');
  const junk = spawnSync(process.execPath, [GUARD], { input: 'not json', env: { ...process.env, AW_YOLO: '1' }, encoding: 'utf8' });
  assert.equal(junk.status, 0);
  assert.equal(junk.stdout, '');
});

test('hooks.json runs the guard from the plugin root on Bash', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(path.dirname(GUARD), 'hooks.json'), 'utf8'));
  const [entry] = hooks.hooks.PreToolUse;
  assert.equal(entry.matcher, 'Bash');
  assert.equal(entry.hooks[0].command, 'node "${CLAUDE_PLUGIN_ROOT}/hooks/guard.mjs"');
});
