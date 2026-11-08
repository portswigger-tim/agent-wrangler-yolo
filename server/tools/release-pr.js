import { makeGh } from '../github/gh.js';
import { openReleasePr } from '../release.js';
import { okResult, errorResult, NOT_ENROLLED } from './result.js';

export function makeReleasePrTool({ makeClient = makeGh, open = openReleasePr } = {}) {
  return {
    name: 'yolo_release_pr',
    description:
      'Open or update the release PR for your YOLO repo with release-please, as the human\'s gh login: it '
      + 'reads conventional commits since the last release, bumps the SemVer version, updates CHANGELOG.md, '
      + 'and opens (or refreshes) a PR labelled "autorelease: pending". Because it is opened as the human, its '
      + 'CI runs like any PR. Attach it with set_links and turn on auto-merge; once it merges, the Release '
      + 'workflow tags vX.Y.Z and publishes the GitHub release. Returns no PR when there is nothing to '
      + 'release. Needs release-please-config.json and .release-please-manifest.json in the repo. The first '
      + 'call installs the pinned release-please CLI, which takes a minute. Acts on the repo this session was '
      + 'launched in; only available in YOLO sessions.',
    inputSchema: {},
    async handler({ host, caller }) {
      const row = caller == null ? null : host.stores.yolo.get(caller);
      if (!row) return errorResult(NOT_ENROLLED);
      try {
        const { repo, defaultBranch } = await makeClient({ cwd: row.repo }).repoFor(row.repo);
        const { pulls, log } = await open({ repoDir: row.repo, repo, defaultBranch });
        const lead = pulls.length
          ? `Release PR ready: ${pulls.map((p) => `#${p.number} ${p.title} ${p.url}`).join('; ')}`
          : `${repo}: nothing to release (no releasable commits since the last release).`;
        return okResult({ repo, defaultBranch, pulls, log }, lead);
      } catch (err) {
        return errorResult(`release PR failed: ${err.message}`);
      }
    },
  };
}

export const yoloReleasePrTool = makeReleasePrTool();
