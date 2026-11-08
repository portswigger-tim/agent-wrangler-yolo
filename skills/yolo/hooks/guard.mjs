#!/usr/bin/env node
// PreToolUse guard for YOLO sessions. The skill directory is a --plugin-dir on
// EVERY Claude launch while the extension is on, so this does nothing unless
// AW_YOLO=1. In a YOLO session it denies the shell commands that would skip
// the pre-commit gate, rewrite history or tags, or weaken a repo protection
// behind the baseline's back. Server-side rulesets still hold if a command
// slips past a pattern here; this is the early, explained refusal.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ESCALATE = 'This is a hard stop in YOLO mode: if it is really needed, ask the human (request_human_input, or your parent session if AW_YOLO_PARENT is set).';

// Security endpoints only yolo_harden_repo may write to.
const PROTECTED_API = /\b(rulesets|actions\/permissions|code-scanning\/default-setup|vulnerability-alerts|automated-security-fixes|private-vulnerability-reporting|immutable-releases|branches\/[^\s/]+\/protection|security-and-analysis)\b/;

// The command with quoted strings emptied, so a commit message that mentions
// a flag is not mistaken for the flag.
function unquoted(c) {
  return c.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, "''");
}

// Each test gets the raw command `c` and `u`, the same with quoted strings
// emptied. Flags and command words are read from `u`, so a commit message or
// echo that mentions them is not mistaken for them; API paths, which are often
// quoted, are read from `c`.
const RULES = [
  {
    test: (c, u) => /\bgit\b[^\n|;&]*\s--no-verify\b/.test(u) || /\bgit\s+commit\b[^\n|;&]*\s-[a-zA-Z]*n[a-zA-Z]*\b/.test(u),
    why: 'skips the pre-commit gate (--no-verify). Fix what the hook reports instead.',
  },
  {
    test: (c, u) => /(^|[;&|]\s*)SKIP=\S/.test(u) && /\b(git|pre-commit)\b/.test(u),
    why: 'skips pre-commit hooks (SKIP=). Fix what the hook reports instead.',
  },
  {
    test: (c, u) => /\bpre-commit\s+uninstall\b/.test(u) || /\bgit\s+config\b[^\n|;&]*\bcore\.hooksPath\b/.test(u) || /\brm\b[^\n|;&]*\.git\/hooks\b/.test(c),
    why: 'removes or redirects the pre-commit hooks.',
  },
  {
    // --force-with-lease on your own branch is fine; a bare force is not.
    test: (c, u) => /\bgit\s+push\b[^\n|;&]*\s(--force(?!-with-lease|-if-includes)\b|-[a-zA-Z]*f[a-zA-Z]*\b|\+\S)/.test(u),
    why: 'force-pushes without a lease. Use --force-with-lease on your own branch, never on the default branch.',
  },
  {
    test: (c, u) => /\bgit\s+push\b[^\n|;&]*(--force-with-lease|--force-if-includes)[^\n|;&]*\b(main|master)\b/.test(u)
      || /\bgit\s+push\b[^\n|;&]*\b(main|master)\b[^\n|;&]*(--force-with-lease|--force-if-includes)/.test(u),
    why: 'force-pushes the default branch.',
  },
  {
    test: (c, u) => /\bgit\s+push\b[^\n|;&]*(\s(--delete|-d)\b[^\n|;&]*(\brefs\/tags\/|\sv\d)|\s:(refs\/tags\/|v\d))/.test(u),
    why: 'deletes a pushed tag. Version tags are immutable.',
  },
  {
    test: (c, u) => /\bgh\s+release\s+delete\b/.test(u) || (/\bgh\s+api\b[^\n|;&]*(-X|--method)\s*DELETE\b/.test(u) && /\b(releases|git\/refs\/tags)\b/.test(c)),
    why: 'deletes a release or tag.',
  },
  {
    test: (c, u) => /\bgh\s+api\b/.test(u) && PROTECTED_API.test(c) && /(-X|--method)\s*(POST|PUT|PATCH|DELETE)\b|\s(-f|-F|--field|--raw-field|--input)\b/.test(u),
    why: 'writes a repo security setting directly. Use yolo_harden_repo, which only tightens.',
  },
  {
    test: (c, u) => /\bgh\s+pr\s+merge\b[^\n|;&]*\s--admin\b/.test(u),
    why: 'merges past the branch ruleset (--admin).',
  },
  {
    test: (c, u) => /\bgh\s+repo\s+(edit\b[^\n|;&]*--visibility|delete\b|archive\b)/.test(u),
    why: 'changes repo visibility, or deletes or archives the repo.',
  },
  {
    test: (c, u) => /\bgh\s+ruleset\b[^\n|;&]*\b(delete|disable)\b/.test(u),
    why: 'deletes or disables a ruleset.',
  },
];

export function verdict(command) {
  if (typeof command !== 'string' || !command.trim()) return null;
  const u = unquoted(command);
  for (const rule of RULES) if (rule.test(command, u)) return `YOLO guard: this command ${rule.why} ${ESCALATE}`;
  return null;
}

export function decide(input, env = process.env) {
  if (env.AW_YOLO !== '1') return null;
  if (input?.tool_name !== 'Bash') return null;
  const reason = verdict(input.tool_input?.command);
  return reason ? { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } } : null;
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let input;
  try { input = JSON.parse(raw); } catch { return; }
  const out = decide(input);
  if (out) process.stdout.write(JSON.stringify(out));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();
