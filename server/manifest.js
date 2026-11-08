import { fileURLToPath } from 'node:url';
import { YoloStore } from './store.js';
import { yoloFile } from './data-dir.js';
import { makePrepare, launchContext, onPurge } from './hooks.js';
import { yoloTools } from './tools/index.js';

// The root index.js only re-exports this: the wrangler's import scanner
// quarantines any own file importing `../index.js`, so tests import THIS module.
export const dir = fileURLToPath(new URL('..', import.meta.url));

// No `default` on a def (the loader refuses one): an unset value reads as
// undefined and each consumer applies its own fallback.
export const SETTINGS = [
  { key: 'mergeMethod', type: 'select', label: 'Merge method', help: 'How YOLO sessions merge PRs and what the branch ruleset allows (default squash).', options: [{ value: 'squash', label: 'Squash' }, { value: 'rebase', label: 'Rebase' }, { value: 'merge', label: 'Merge commit' }] },
  { key: 'requireSignedCommits', type: 'toggle', label: 'Require signed commits', help: 'Add "require signed commits" to the default-branch ruleset. Off unless turned on.' },
  { key: 'maxFixAttempts', type: 'number', label: 'Fix attempts before escalating', help: 'How many times a session retries the same failing check before asking you (1–10, default 3).', min: 1, max: 10, step: 1 },
];

export const REQUIRES = ['sessions:read'];

export default {
  id: 'yolo',
  label: 'YOLO',
  description: 'Lets an opted-in session own its repo end to end: design, delegate, merge, release and harden.',
  help: 'Opt a session in from the dispatch dialog. It may then make its own design decisions, spawn and brief child sessions, merge its PRs once checks pass, cut SemVer releases, and harden its repo (rulesets, immutable tags, security features), all scoped to the one repo it was launched in. pre-commit gates every commit, local merge and push. It asks you only before weakening a protection, rewriting history or tags, or when it is stuck.',
  author: 'PortSwigger',
  homepage: 'https://github.com/portswigger-tim/agent-wrangler-yolo',
  defaultEnabled: false,
  engines: { wranglerApi: '^1.57.0' },
  dir,
  requires: REQUIRES,
  stores: { yolo: (bag) => new YoloStore({ file: yoloFile(bag), log: bag.log }) },
  hooks: {
    'session.prepare': makePrepare(),
    'session.launchContext': launchContext,
  },
  tools: yoloTools,
  session: { onPurge },
  settings: SETTINGS,
  skills: ['yolo'],
};
