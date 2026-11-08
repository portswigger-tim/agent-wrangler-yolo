---
name: yolo
description: Use when AW_YOLO=1 is set in your environment, meaning the human opted this session into YOLO mode, the operating procedure for owning a repo end to end. You decide the design, delegate to subagents or child sessions, merge your own PRs once the gates pass, cut SemVer releases and harden the repo, escalating to the human only on the hard stops listed here. Read it before your first change in a YOLO session.
---

# YOLO mode

`AW_YOLO=1` means the human gave you an **outcome**, not a task list, and
trusts you to get there without them. `AW_YOLO_REPO` is the one repository you
may change. Everything outside it is read-only to you.

If `AW_YOLO` is not `1`, this skill does not apply: work normally and ask
before merging, releasing or changing repo settings.

## You own the decisions

- **Design.** Pick the approach, write it down in the PR description (what,
  why, the alternative you rejected), and move on. Don't ask the human to choose
  between options you can evaluate yourself.
- **Scope.** Break the outcome into PR-sized steps. Each PR does one thing,
  passes the gate on its own, and leaves `main` releasable.
- **Delegation.** Choose per piece of work:
  - Do it yourself when it's small or tightly coupled to what you're doing.
  - Use a **subagent** (Agent tool) for a bounded search, review or analysis
    whose result you only need summarised.
  - Spawn a **child session** with `yolo_spawn` (never plain `spawn_session`,
    which drops YOLO and auto-merge) for an independent workstream that
    deserves its own branch, PR and context window. It gets a worktree off
    current `main`, auto-merge and auto-fix, and sits under you on the board.
    Brief it fully in `intent`: outcome, constraints, files, how you'll judge
    it done, and "mail me with questions and when your PR merges". Split work
    so children don't edit the same files. You may have a few live children
    and the tree stops three levels deep.
- **If you are a child** (`AW_YOLO_PARENT` is set): your parent is your
  human. Send questions and your final report to it with `send_message`
  (to: `$AW_YOLO_PARENT`); never raise `request_human_input` yourself. A hard
  stop goes to your parent, which decides whether it reaches the human.
- **Escalation.** You raise `request_human_input` only for the hard stops
  below. Everything else you decide, record in the PR, and continue.

## The gate: never bypass it

1. Before your first commit, make sure `.pre-commit-config.yaml` exists and
   `pre-commit install -t pre-commit -t pre-merge-commit -t pre-push -t commit-msg`
   has run. If the config is missing, add one as your first PR: baseline
   hygiene (`pre-commit-hooks`), secret scanning (`gitleaks`), workflow linting
   (`actionlint`, `zizmor`) when `.github/workflows` exists, a conventional
   commit check, and the repo's own linters and tests. Pin every `rev` to a
   commit SHA with `pre-commit autoupdate --freeze`.
2. CI must run `pre-commit run --all-files` and that job must be a required
   check, so a commit that skipped the local hooks still can't reach `main`.
3. Never use `--no-verify`, `SKIP=`, `git push --force` to the default branch,
   or `--admin` merges. If a hook fails, fix the cause. In Claude sessions a
   `YOLO guard` hook refuses these (and tag deletion, direct writes to
   security settings, repo deletion) with a reason. A refusal is a hard stop,
   not a puzzle: don't rephrase the command to get past it.

## Bootstrapping a repo

A repo without the gate, CI or release config gets them in your **first PR**,
before any feature work. Start from the templates in `templates/` next to
this file. They are this extension's own working setup, generalised:

| Template | Put it at | Then |
| --- | --- | --- |
| `.pre-commit-config.yaml` | repo root | Add the repo's linters and tests where it says `REPLACE`. |
| `.github/workflows/ci.yml` | same path | Add toolchain setup for the local hooks; add build and test jobs beside `pre-commit`. |
| `.github/workflows/release-please.yml` | same path | Use as is. |
| `release-please-config.json` | repo root | Set `release-type` (`node`, `python`, `go`, `rust`, `simple`, …). |
| `.release-please-manifest.json` | repo root | Use as is, or the current version if the repo already ships releases. |
| `.github/dependabot.yml` | same path | Swap the `npm` entry for the repo's ecosystems. |
| `SECURITY.md` | repo root | Replace `OWNER/REPO`. |

Then run `pre-commit install -t pre-commit -t pre-merge-commit -t pre-push -t commit-msg`
and `pre-commit run --all-files`, and fix what it finds (in the same PR, or a
follow-up if it's large). Don't drop a baseline hook to get green. Re-freeze
with `pre-commit autoupdate --freeze` so every `rev` is a SHA. Once that PR's
CI has run, call `yolo_harden_repo` with `apply: true` so its checks become
required. A repo that already ships releases with tags keeps its version in the
manifest; don't restart at 0.1.0.

## Keep the repo hardened

- At the start of a YOLO session, run `yolo_audit_repo`. If anything fails,
  run `yolo_harden_repo` (a dry run), read what it would change, then run it
  with `apply: true`. It only ever tightens, so this needs no human sign-off.
- Required checks are detected from the most recent PR's GitHub Actions
  checks. A repo with no CI yet gets a ruleset without required checks: add CI
  (with a `pre-commit` job) in your first PR, then run `yolo_harden_repo` again
  once that PR's checks have run, so they become required.
- When you add, rename or remove a CI job, run `yolo_harden_repo` again
  afterwards (adding is automatic; a renamed or removed check stays required
  and blocks every PR until a human loosens it, so prefer adding over
  renaming).
- A control that reports `error` usually means the plan or permissions don't
  allow it (for example secret scanning on a private repo without GitHub
  Advanced Security). Note it in your summary; don't work around it.

## The loop

1. `git pull --ff-only`, branch from up-to-date `main`.
2. Make the change. Commit with **conventional commits**
   (`feat:`, `fix:`, `feat!:`/`BREAKING CHANGE:` …): the release tooling derives
   the SemVer bump from them.
3. Push, open a PR, attach it to your session with `set_links`.
4. Review before merge:
   - Security-relevant change (auth, secrets, IaC, new trust boundary,
     workflows): run the `ps-security-review` skill and fix what it finds.
   - Non-trivial change: run `adversarial-pr-review` and resolve every concern
     (fix it, or reply in the thread with why not).
5. Let auto-fix and auto-merge drive it: end your turn after attaching the PR
   and yield to the wrangler's PR notices. Don't poll.
   When a check fails before any of the repo's own steps run (runner setup,
   an action's download or self-test, HTTP 5xx or timeouts talking to
   GitHub), it's infrastructure, not your code: check
   `https://www.githubstatus.com/api/v2/summary.json`, then
   `gh run rerun <id> --failed`. Don't change code or loosen CI for it. A
   same-commit re-run may bring no new notice, so check the PR once when you
   next resume.
6. **Releasing.** When `main` holds something worth shipping, call
   `yolo_release_pr`. It runs release-please as the human: SemVer bump from
   your conventional commits, `CHANGELOG.md`, and a PR labelled
   `autorelease: pending`. It starts CI like any PR of yours. Attach it with
   `set_links`, `gh pr merge <n> --auto --squash`, and yield. After it merges,
   the Release workflow tags `vX.Y.Z` and publishes the release; check both
   exist (`gh release view vX.Y.Z`). Never create or move a `v*` tag by hand.
   Calling it again later refreshes the open release PR with newer commits.

## Hard stops: ask the human first

- Weakening any protection: deleting or loosening a ruleset, disabling a
  security feature, adding a bypass actor, widening token permissions.
- Rewriting history or tags: force-pushes, deleting or moving a tag or release.
- Anything outside `AW_YOLO_REPO`, or that spends money, or that publishes to a
  registry for the first time.
- A high-severity security finding you can't fix.
- The same check failing after the configured number of fix attempts.
- An outcome so ambiguous that two reasonable readings would build different
  things.

When you stop, say what you tried, what you recommend, and what you need.
