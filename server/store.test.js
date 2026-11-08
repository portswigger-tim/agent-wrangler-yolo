import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { YoloStore } from './store.js';

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'yolo-store-')), 'yolo.json');

test('enrol records the repo and survives a reload', () => {
  const file = tmpFile();
  const store = new YoloStore({ file, now: () => 42 });
  assert.deepEqual(store.enrol('s1', { repo: '/repo' }), { repo: '/repo', parent: null, enrolledAt: 42 });
  assert.deepEqual(new YoloStore({ file }).get('s1'), { repo: '/repo', parent: null, enrolledAt: 42 });
});

test('a second enrol cannot change the repo', () => {
  const store = new YoloStore({ file: tmpFile() });
  store.enrol('s1', { repo: '/repo' });
  assert.equal(store.enrol('s1', { repo: '/elsewhere' }).repo, '/repo');
});

test('enrol refuses a relative repo or missing sid', () => {
  const store = new YoloStore({ file: tmpFile() });
  assert.throws(() => store.enrol('s1', { repo: 'repo' }), /absolute/);
  assert.throws(() => store.enrol('', { repo: '/repo' }), /sid/);
});

test('forget removes the row', () => {
  const store = new YoloStore({ file: tmpFile() });
  store.enrol('s1', { repo: '/repo' });
  assert.equal(store.forget('s1'), true);
  assert.equal(store.get('s1'), null);
  assert.equal(store.forget('s1'), false);
});

test('a corrupt file starts empty and logs', () => {
  const file = tmpFile();
  fs.writeFileSync(file, '{nope');
  const logs = [];
  const store = new YoloStore({ file, log: (m) => logs.push(m) });
  assert.equal(store.get('s1'), null);
  assert.match(logs[0], /unreadable/);
});
