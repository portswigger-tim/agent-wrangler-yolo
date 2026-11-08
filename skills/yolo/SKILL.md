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
  - Spawn a **child session** for an independent workstream that deserves its
    own branch, PR and context window. Brief it fully: outcome, constraints,
    files, how you'll judge it done. Children cannot ask the human; they mail
    you, and you answer. Review and merge their PRs as you would your own.
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
   or `--admin` merges. If a hook fails, fix the cause.

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
6. When a release PR is open and `main` is in the state you want to ship, merge
   it. Check that the tag and GitHub release appeared.

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
