import { test } from 'node:test';
import assert from 'node:assert/strict';
import client, { yoloField, FIELD_ID } from './index.js';

// Just enough DOM for the field: elements with children, a checkbox and
// querySelector by the one selector the field uses.
function fakeHost() {
  const doc = {
    createElement(tag) {
      const node = { tag, children: [], dataset: {}, checked: false, append(...kids) { this.children.push(...kids); } };
      return node;
    },
  };
  const find = (node) => {
    for (const k of node.children ?? []) {
      if (typeof k === 'object' && k.tag === 'input' && k.dataset.yolo) return k;
      const hit = typeof k === 'object' && find(k);
      if (hit) return hit;
    }
    return null;
  };
  const el = {
    ownerDocument: doc, children: [],
    replaceChildren() { this.children = []; },
    append(...kids) { this.children.push(...kids); },
    querySelector: (sel) => (sel === 'input[data-yolo]' ? find(el) : null),
  };
  return el;
}

test('registers one dispatch.field in the advanced block', () => {
  const seen = [];
  client.register({ register: (slot, c) => seen.push([slot, c.id, c.at]) });
  assert.deepEqual(seen, [['dispatch.field', FIELD_ID, 'advanced']]);
});

test('off: sends nothing, neither ext data nor fields', () => {
  const el = fakeHost();
  yoloField.mount(el);
  yoloField.open(el, { saved: null });
  assert.equal(yoloField.ext(el), undefined);
  assert.equal(yoloField.fields(el), undefined);
});

test('on: opts the session in and turns on auto-merge', () => {
  const el = fakeHost();
  yoloField.mount(el);
  el.querySelector('input[data-yolo]').checked = true;
  assert.deepEqual(yoloField.ext(el), { enabled: true });
  assert.deepEqual(yoloField.fields(el), { autoMergeOnPass: true });
});

test('open restores a saved slice and a fresh dialog opens off', () => {
  const el = fakeHost();
  yoloField.mount(el);
  yoloField.open(el, { saved: { enabled: true } });
  assert.equal(el.querySelector('input[data-yolo]').checked, true);
  yoloField.open(el, { saved: null });
  assert.equal(el.querySelector('input[data-yolo]').checked, false);
});
