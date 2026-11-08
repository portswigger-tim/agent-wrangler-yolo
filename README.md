# agent-wrangler-yolo

An [Agent Wrangler](https://github.com/PortSwigger/agent-wrangler) extension that lets an opted-in
session own its repository end to end. You give it an outcome; it makes the design calls, decides
whether to use subagents or child sessions, merges its own PRs once the gates pass, cuts SemVer
releases and keeps the repo hardened. It asks you only at a short list of hard stops.

> **Status: early.** Enrolment, pre-commit enforcement, repo hardening, the dispatch-dialog switch
> and child-session spawning are in place. See
> [the plan](#roadmap).

## How it works

- **Opt-in per session, scoped to one repo.** Tick **YOLO** under the dispatch dialog's advanced
  options (it always opens off). That also turns on auto-merge for the session. A session is enrolled
  when it is launched with YOLO on. It is then bound to the git repo it was launched in, for its whole life, and gets `AW_YOLO=1`
  and `AW_YOLO_REPO` in its environment. Sessions without it are untouched, and so is everything
  when the extension is disabled.
- **Children inherit, within the same repo.** `yolo_spawn` launches a child in its own worktree off
  current `main`, with YOLO, auto-merge and auto-fix on, nested under its parent and on its task. The
  child gets `AW_YOLO_PARENT` and reports to its parent by mail; it never asks you directly. A fork
  is enrolled the same way. A child pointed at a different repo is refused. A session may have a
  few live children (setting, default 5) and the tree stops three levels deep. Core `spawn_session`
  carries no extension data, so a child launched with it is not in YOLO mode.
- **pre-commit is enforced, not suggested.** Before an enrolled session's worktree is created, the
  extension runs `git pull --ff-only` and `pre-commit install` for the `pre-commit`,
  `pre-merge-commit`, `pre-push` and `commit-msg` hook types. Worktrees share the repo's hooks, so
  every child is gated too. CI runs the same hooks as a required check.
- **Merged branches don't linger.** The baseline deletes a branch on GitHub when its PR merges,
  and each new YOLO session prunes local branches whose PR has merged. A branch is deleted only when
  its remote is gone and a merged PR's head is exactly the local tip, so unpushed work survives (and
  squash merges, which `git branch -d` can't recognise, are handled). Branches checked out in a
  worktree are left alone.
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

A control GitHub doesn't offer on the repo's plan reports `unavailable` rather than failing: on a
private repo on GitHub Free that's rulesets and GitHub auto-merge; secret scanning and CodeQL on a
private repo need Advanced Security. The wrangler's own auto-merge still waits for green checks, but
nothing on GitHub enforces them.

Run it outside the wrangler with `node scripts/harden.mjs [repo-dir] [--apply]`.

## Guardrail hook

In Claude sessions, the `yolo` skill directory ships a `PreToolUse` hook (`skills/yolo/hooks/`).
The wrangler loads it on every Claude launch while the extension is on, so it does nothing unless
`AW_YOLO=1`. In a YOLO session it refuses, with a reason, any shell command that:

- skips the gate: `--no-verify`, `git commit -n`, `SKIP=`, `pre-commit uninstall`, changing `core.hooksPath`
- force-pushes without a lease, or force-pushes `main`/`master` at all
- deletes a pushed tag or a release
- writes a repo security setting directly with `gh api` (rulesets, Actions policy, CodeQL, Dependabot,
  immutable releases, …), instead of through `yolo_harden_repo`
- merges with `gh pr merge --admin`, or deletes, archives or changes the visibility of the repo

It reads flags with quoted strings removed, so a commit message that mentions them still goes through.
It's an early, explained refusal: if a command slips past a pattern, the server-side rulesets still
hold. Codex sessions don't load Claude plugin hooks, so for them only the rulesets apply.

## Releases

SemVer from conventional commits, with release-please, split so that no workflow needs permission to
open pull requests (the baseline keeps "Allow GitHub Actions to create and approve pull requests" off):

1. The session calls `yolo_release_pr` (or `node scripts/release-pr.mjs`). It runs release-please as
   the human's `gh` login and opens or refreshes a release PR labelled `autorelease: pending`. Because a
   person opened it, CI runs like on any PR.
2. The session sets auto-merge on that PR. Once it merges, the Release workflow
   (`skip-github-pull-request: true`, `contents: write`) tags `vX.Y.Z` and publishes the GitHub release.
   The tag ruleset makes the tag immutable, and immutable releases do the same for its assets.

The CLI is pinned by `tools/release-please/package-lock.json` and installed on first use into the
wrangler data dir with `npm ci --ignore-scripts`, so the extension itself stays light. The token
goes to the CLI as a 0600 temp file, never on the command line. A repo needs
`release-please-config.json` and `.release-please-manifest.json`.

## Hard stops

The session asks you before it weakens a protection, rewrites history or tags, acts outside its
repo, spends money or publishes somewhere new, leaves a high-severity security finding unfixed, or
keeps failing the same check.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| Merge method | squash | How sessions merge, and what the branch ruleset allows. |
| Require signed commits | off | Adds signed commits to the default-branch ruleset. |
| Live child sessions per session | 5 | How many `yolo_spawn` children one session may have running. |
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
2. Skill: operating procedure, delegation, hard stops, releases, infra-flake handling, and
   bootstrap templates (`skills/yolo/templates/`). Done.
3. Tools: `yolo_audit_repo`, `yolo_harden_repo`, `yolo_release_pr`. Done. Bootstrap is
   templates plus the agent's judgement rather than a tool, since each repo's linters differ.
4. The dispatch-dialog switch, and `yolo_spawn` so children inherit YOLO, auto-merge and
   auto-fix. Done.
5. A guardrail hook against destructive commands. Done.
6. An end-to-end run on a sandbox repo: a YOLO session from the dispatch dialog, bootstrap,
   harden, child sessions, merge and release.
