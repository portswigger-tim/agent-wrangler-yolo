#!/usr/bin/env node
// Open or update the release PR outside the wrangler: the same code the
// yolo_release_pr tool runs.
//
//   node scripts/release-pr.mjs [repo-dir]
import { makeGh } from '../server/github/gh.js';
import { openReleasePr } from '../server/release.js';

const dir = process.argv[2] ?? process.cwd();
const { repo, defaultBranch } = await makeGh({ cwd: dir }).repoFor(dir);
const { pulls, log } = await openReleasePr({ repoDir: dir, repo, defaultBranch });
if (log) console.log(log);
if (!pulls.length) console.log(`${repo}: nothing to release.`);
for (const p of pulls) console.log(`#${p.number} ${p.title} ${p.url}`);
