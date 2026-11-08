import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TEMPLATES = path.join(ROOT, 'skills/yolo/templates');
const read = (rel) => fs.readFileSync(path.join(TEMPLATES, rel), 'utf8');

test('every template the skill names exists', () => {
  const skill = fs.readFileSync(path.join(ROOT, 'skills/yolo/SKILL.md'), 'utf8');
  const named = [...skill.matchAll(/^\| `([^`]+)` \| /gm)].map((m) => m[1]);
  assert.ok(named.length >= 7, `skill table names ${named.length} templates`);
  for (const rel of named) assert.ok(fs.existsSync(path.join(TEMPLATES, rel)), rel);
});

test('workflow templates pin every action to a full commit SHA and default to read-only', () => {
  for (const rel of ['.github/workflows/ci.yml', '.github/workflows/release-please.yml']) {
    const text = read(rel);
    const uses = [...text.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1]);
    assert.ok(uses.length, `${rel} uses actions`);
    for (const u of uses) assert.match(u, /@[0-9a-f]{40}$/, `${rel}: ${u}`);
    assert.match(text, /^permissions:( \{\}|\n {2}contents: read)/m, `${rel} top-level permissions`);
  }
});

test('the release workflow never opens PRs', () => {
  assert.match(read('.github/workflows/release-please.yml'), /skip-github-pull-request: true/);
});

test('pre-commit template: frozen SHAs, every hook type, conventional commits, secrets', () => {
  const text = read('.pre-commit-config.yaml');
  for (const rev of text.matchAll(/^\s+rev:\s*(\S+)/gm)) assert.match(rev[1], /^[0-9a-f]{40}$/, rev[1]);
  assert.match(text, /default_install_hook_types: \[pre-commit, pre-merge-commit, pre-push, commit-msg\]/);
  for (const id of ['gitleaks', 'actionlint', 'zizmor', 'conventional-pre-commit', 'detect-private-key', 'no-commit-to-branch']) {
    assert.match(text, new RegExp(`id: ${id}\\b`), id);
  }
  // Nothing specific to this repo leaked into the template.
  assert.doesNotMatch(text, /AW_REPO|validate-manifest|npx --no-install eslint/);
});

test('release config starts pre-1.0 and the JSON templates parse', () => {
  const config = JSON.parse(read('release-please-config.json'));
  assert.equal(config['initial-version'], '0.1.0');
  assert.equal(config['include-v-in-tag'], true);
  assert.deepEqual(JSON.parse(read('.release-please-manifest.json')), { '.': '0.0.0' });
});
