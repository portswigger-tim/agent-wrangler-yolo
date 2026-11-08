# agent-wrangler-yolo

An [Agent Wrangler](https://github.com/PortSwigger/agent-wrangler) extension that lets an opted-in
session own its repository end to end. You give it an outcome; it makes the design calls, decides
whether to use subagents or child sessions, merges its own PRs once the gates pass, cuts SemVer
releases and keeps the repo hardened. It asks you only at a short list of hard stops.

> **Status: early.** Enrolment, pre-commit enforcement and the repo-hardening tools are in place.
> The dispatch-dialog switch and child-session spawning follow. See
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

## Repo hardening

`yolo_audit_repo` checks the session's repo against the baseline below; `yolo_harden_repo` applies it
(a dry run unless `apply: true`). Both act only on the calling session's enrolled repo. Hardening only
ever tightens: it never deletes or loosens a ruleset, adds a bypass or disables a feature, and when
it updates its own ruleset it keeps anything stricter a human added.

| Control | Baseline |
| --- | --- |
| Default-branch ruleset | PRs only (0 approvals, threads resolved, stale reviews dismissed), required checks up to date, linear history, no force-push or deletion, one merge method, optional signed commits |
| Tag ruleset | `v*` tags can be created but never updated, moved or deleted |
| Immutable releases | On |
| Secret scanning | On, with push protection |
| Dependabot | Alerts and security updates on |
| CodeQL | Default setup |
| Private vulnerability reporting | On |
| Actions | Read-only workflow token, Actions can't approve PRs, SHA pinning required |
| Merge settings | Auto-merge on, branches deleted on merge, PR title as the squash subject |

Run it outside the wrangler with `node scripts/harden.mjs [repo-dir] [--apply]`.

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

1. Scaffold, enrolment and the pre-commit gate. Done.
2. Skills: `repo-hardening`, `pre-commit`, `release`, and orchestration guidance.
3. Tools: `yolo_audit_repo` and `yolo_harden_repo` (done); `yolo_bootstrap_repo`.
4. The dispatch-dialog switch, and `yolo_spawn` so children inherit YOLO, auto-merge and
   auto-fix.
5. A guardrail hook against destructive commands.
6. An end-to-end run on a sandbox repo.
