# agent-wrangler-yolo

An [Agent Wrangler](https://github.com/PortSwigger/agent-wrangler) extension that lets an opted-in
session own its repository end to end. You give it an outcome; it makes the design calls, decides
whether to use subagents or child sessions, merges its own PRs once the gates pass, cuts SemVer
releases and keeps the repo hardened. It asks you only at a short list of hard stops.

> **Status: early.** Phase 1 (scaffold, enrolment, pre-commit enforcement) is in place. Repo
> hardening tools, the dispatch-dialog switch and child-session spawning follow. See
> [the plan](#roadmap).

## How it works

- **Opt-in per session, scoped to one repo.** A session is enrolled when it is launched with YOLO
  on. It is then bound to the git repo it was launched in, for its whole life, and gets `AW_YOLO=1`
  and `AW_YOLO_REPO` in its environment. Sessions without it are untouched, and so is everything
  when the extension is disabled.
- **Children inherit, within the same repo.** A fork of an enrolled session, or a child it spawns,
  is enrolled against the same repo. A child pointed at a different repo is refused.
- **pre-commit is enforced, not suggested.** Before an enrolled session's worktree is created, the
  extension runs `git pull --ff-only` and `pre-commit install` for the `pre-commit`,
  `pre-merge-commit`, `pre-push` and `commit-msg` hook types. Worktrees share the repo's hooks, so
  every child is gated too. CI runs the same hooks as a required check.
- **The `yolo` skill** is the operating procedure: own the decisions, delegate deliberately, never
  bypass the gate, conventional commits for SemVer, review before merge, and the hard stops that
  go to you.

## Hard stops

The session asks you before it weakens a protection, rewrites history or tags, acts outside its
repo, spends money or publishes somewhere new, leaves a high-severity security finding unfixed, or
keeps failing the same check.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| Merge method | squash | How sessions merge, and what the branch ruleset allows. |
| Require signed commits | off | Adds signed commits to the default-branch ruleset. |
| Fix attempts before escalating | 3 | Retries on the same failing check before asking you. |

## Install

**Settings → Extensions → + Add extension → Git URL**, then paste
`https://github.com/portswigger-tim/agent-wrangler-yolo.git`. It is off by default: turn it on in
its detail pane.

## Develop

```sh
npm ci
pre-commit install
npm run verify
AW_REPO=../agent-wrangler node scripts/validate-manifest.mjs   # the real loader
```

## Roadmap

1. Scaffold, enrolment and the pre-commit gate (this release).
2. Skills: `repo-hardening`, `pre-commit`, `release`, and orchestration guidance.
3. Tools: `yolo_audit_repo`, `yolo_harden_repo` (rulesets, immutable `v*` tags, immutable
   releases, security features, Actions policy), `yolo_bootstrap_repo`.
4. The dispatch-dialog switch, and `yolo_spawn` so children inherit YOLO, auto-merge and
   auto-fix.
5. A guardrail hook against destructive commands.
6. An end-to-end run on a sandbox repo.
