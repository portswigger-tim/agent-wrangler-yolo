#!/usr/bin/env node
// Validate this extension against the REAL wrangler loader, the way a boot
// would: discovery (id/dir-name check + the leaf-import scan), validateManifest,
// loadExtensions (collisions, quarantine reasons), buildHostApi (capability
// names + engines.wranglerApi against the served version), the store factory,
// and the hooks and skills it must register.
//
//   AW_REPO=<agent-wrangler checkout> node scripts/validate-manifest.mjs
//
// AW_REPO must have its node_modules (npm ci --ignore-scripts there).
// Exits 1 on any refusal, 2 if AW_REPO is not a loader checkout.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = process.env.AW_REPO && path.resolve(process.env.AW_REPO.replace(/^~/, os.homedir()));
if (!repo || !fs.existsSync(path.join(repo, 'server/extensions/index.js'))) {
  console.error('Set AW_REPO to an agent-wrangler checkout that has server/extensions/index.js');
  process.exit(2);
}
// The loader's config-store and this extension's store read DATA_DIR at
// import: point both somewhere harmless, removed at the end.
const madeDataDir = !process.env.AW_DATA_DIR && fs.mkdtempSync(path.join(os.tmpdir(), 'yolo-validate-'));
if (madeDataDir) process.env.AW_DATA_DIR = madeDataDir;
const mod = (rel) => import(pathToFileURL(path.join(repo, rel)).href);
const { validateManifest, loadExtensions, CAPABILITIES } = await mod('server/extensions/index.js');
const { discoverExternal } = await mod('server/extensions/external.js');
const { buildHostApi, buildExtSettings } = await mod('server/host-api/index.js');
const { HOST_API_VERSION } = await mod('server/host-api/version.js');
let coreToolNames = [];
try { coreToolNames = (await mod('server/mcp/tools/index.js')).TOOLS.map((t) => t.name); } catch (e) { console.warn('(core tool names unavailable:', e.message.split('\n')[0], ')'); }

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failed = false;
const fail = (msg) => { failed = true; console.error('✗', msg); };
const ok = (msg) => console.log('✓', msg);

// 1. Discovery over an extensions dir holding a COPY named after the id, as an
//    install lays it out (discovery skips symlinks).
const extDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yolo-ext-'));
const declared = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).wranglerExtension;
fs.cpSync(root, path.join(extDir, declared.id), { recursive: true, filter: (src) => !src.includes(`${path.sep}.git`) && !src.includes(`${path.sep}node_modules`) });
const [found] = await discoverExternal({ dir: extDir, provenance: {} });
if (!found) fail('discoverExternal found nothing');
else if (found.quarantine) fail(`discovery quarantined: ${found.quarantine}`);
else ok(`discovered as "${found.id}"`);

// 2. The manifest, against the declaration a human consents to.
const { default: manifest } = await import(pathToFileURL(path.join(root, 'server/manifest.js')).href);
try { validateManifest(manifest); ok('validateManifest'); } catch (e) { fail(e.message); }
if (manifest.id !== declared.id) fail(`manifest id "${manifest.id}" != package.json id "${declared.id}"`);
if (JSON.stringify(manifest.requires) !== JSON.stringify(declared.requires)) fail('manifest requires != package.json wranglerExtension.requires');
else ok('requires match the disclosed requires');
if (manifest.engines?.wranglerApi !== declared.engines?.wranglerApi) fail('manifest engines.wranglerApi != package.json');
for (const c of manifest.requires || []) if (!CAPABILITIES.has(c)) fail(`unknown capability ${c}`);

// 3. The loader, with core tool names so a collision is visible.
// Off by default, so stage it as a human who turned it on would.
const loaded = loadExtensions({ cfg: { extensions: { [manifest.id]: true } }, builtin: [{ ...manifest, external: true }], coreToolNames });
const entry = loaded.list.find((e) => e.id === manifest.id);
if (!entry) fail('loadExtensions produced no entry');
else if (entry.quarantine) fail(`loadExtensions quarantined: ${entry.quarantine}`);
else ok(`loadExtensions: ${loaded.tools.length} tools, ${Object.keys(loaded.stores).length} store(s), ${entry.settings.length} settings, skills [${entry.skills.join(', ')}]`);

// 4. The store factory and the façade, as activation builds them.
let store;
try {
  const settings = buildExtSettings({ id: manifest.id, settingDefs: manifest.settings, readSettings: () => ({}) });
  store = manifest.stores.yolo({ id: 'yolo', extId: manifest.id, settings, log: () => {} });
  ok(`store factory → ${store.constructor.name} at ${store.file}`);
  const core = { sessionManager: { activeEntries: () => [], entryFor: () => null }, taskStore: { taskFor: () => null, snapshot: () => ({ tasks: [] }) } };
  const host = buildHostApi({
    id: manifest.id, requires: manifest.requires, range: manifest.engines?.wranglerApi, core,
    rebuild: () => {}, broadcast: () => {}, deliver: async () => ({ mode: 'live' }), archiveSession: () => {},
    stores: { yolo: store }, settingDefs: manifest.settings, readSettings: () => ({}), log: () => {},
  });
  ok(`buildHostApi: serves ${HOST_API_VERSION}, keys [${Object.keys(host).join(', ')}]`);
} catch (e) { fail(e.message); }

// 5. What must be registered, by name: a dropped entry loads cleanly and is
//    only missed at runtime.
for (const hook of ['session.prepare', 'session.launchContext']) {
  if ((loaded.hooks?.[hook] ?? []).some((h) => h.extId === manifest.id)) ok(`hook ${hook}`);
  else fail(`hook ${hook} not registered`);
}
for (const skill of ['yolo']) {
  if (entry?.skills?.includes(skill) && fs.existsSync(path.join(root, 'skills', skill, 'SKILL.md'))) ok(`skill ${skill}`);
  else fail(`skill ${skill} missing from the manifest or skills/${skill}/SKILL.md`);
}

fs.rmSync(extDir, { recursive: true, force: true });
if (madeDataDir) fs.rmSync(madeDataDir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
