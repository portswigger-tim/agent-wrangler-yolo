import { z } from 'zod';
import { okResult, errorResult, NOT_ENROLLED } from './result.js';

export const DEFAULT_MAX_CHILDREN = 5;
// Root, child, grandchild. Deeper trees are almost always a briefing problem.
export const MAX_DEPTH = 3;

function depthOf(store, sid) {
  let depth = 1;
  for (let row = store.get(sid); row?.parent && depth <= MAX_DEPTH; row = store.get(row.parent)) depth++;
  return depth;
}

// Enrolled children of `sid` whose cards are still live on the board.
function liveChildren(host, sid) {
  return host.stores.yolo.childrenOf(sid).filter((c) => {
    const s = host.sessions.get(c);
    return s && !s.archived;
  });
}

// Launch a child session that inherits YOLO for the caller's repo. Core's
// spawn_session carries no extension data, so a child launched that way
// silently loses YOLO, auto-merge and its parent link; this is the way to
// delegate a workstream.
export const yoloSpawnTool = {
  name: 'yolo_spawn',
  description:
    'Launch a child session that inherits YOLO mode for your repo: its own worktree off up-to-date main, '
    + 'auto-merge and auto-fix on, nested under you on the board, on your task. Use it instead of spawn_session '
    + 'for any workstream that should open and merge its own PR. Brief it completely in `intent`: the outcome, '
    + 'constraints, key files, how you will judge it done, and that it should mail you (send_message) with '
    + 'questions and when its PR merges. The child cannot reach the human; you answer it. Limited to a few live '
    + 'children per session and three levels deep. Only available in YOLO sessions.',
  inputSchema: {
    intent: z.string().min(20).max(20000).describe('The child\'s launch prompt and complete handoff.'),
    branch: z.string().min(1).max(100).regex(/^[A-Za-z0-9._/-]+$/).optional().describe('Worktree branch name; omit to let the wrangler name it.'),
    agent: z.string().min(1).max(40).optional().describe('Agent id, e.g. "claude" or "codex". Defaults to the wrangler default.'),
    model: z.string().min(1).max(80).optional().describe('Model for the child; omit for the agent default.'),
    effort: z.string().min(1).max(20).optional().describe('Reasoning effort for the child; omit for the default.'),
  },
  async handler({ host, caller }, args = {}) {
    const store = host.stores.yolo;
    const me = caller == null ? null : store.get(caller);
    if (!me) return errorResult(NOT_ENROLLED);
    if (depthOf(store, caller) >= MAX_DEPTH) {
      return errorResult(`You are already ${MAX_DEPTH - 1} levels below a human-launched session. Do this work yourself, or with a subagent.`);
    }
    const max = Number(host.settings?.all?.().maxChildren) || DEFAULT_MAX_CHILDREN;
    const live = liveChildren(host, caller);
    if (live.length >= max) {
      return errorResult(`You already have ${live.length} live child sessions (limit ${max}): ${live.join(', ')}. Wait for one to finish, or archive one you no longer need.`);
    }
    const self = host.sessions.get(caller);
    try {
      const result = await host.sessions.spawn({
        cwd: me.repo,
        intent: args.intent,
        agent: args.agent,
        model: args.model,
        effort: args.effort,
        parentSession: caller,
        taskId: self?.taskId ?? undefined,
        worktree: { auto: true, ...(args.branch ? { branch: args.branch } : {}) },
        autoMergeOnPass: true,
        autoFixPrChecks: true,
        // session.prepare reads `parent` to link the child and hold it to
        // this repo.
        ext: { yolo: { enabled: true, parent: caller } },
      });
      return okResult({
        sessionId: result.sessionId,
        repo: me.repo,
        worktree: result.worktree ?? null,
        liveChildren: live.length + 1,
        maxChildren: max,
      }, `Spawned YOLO child ${result.sessionId} in ${me.repo}. It will mail you; answer with send_message.`);
    } catch (err) {
      return errorResult(`spawn failed: ${err.message}`);
    }
  },
};
