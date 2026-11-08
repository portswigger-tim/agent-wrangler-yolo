// Client half of YOLO (extension id `yolo`): one switch in the dispatch
// dialog. On, the launch carries `ext.yolo = { enabled: true }` for the server
// half (session.prepare enrols the card against its repo) and turns on core's
// auto-merge for the session. Off, it sends nothing at all.

export const FIELD_ID = 'yolo-mode';

export const yoloField = {
  id: FIELD_ID,
  at: 'advanced',
  mount(el) {
    el.replaceChildren();
    const label = el.ownerDocument.createElement('label');
    label.className = 'check-row';
    label.title = 'The session may make its own design decisions, spawn child sessions, merge its PRs once checks pass, cut releases and harden this repo. It asks you only at the hard stops.';
    const box = el.ownerDocument.createElement('input');
    box.type = 'checkbox';
    box.dataset.yolo = 'enabled';
    label.append(box, ' YOLO: own this repo end to end (merges, releases, hardening)');
    el.append(label);
  },
  // A scheduled dispatch being edited reopens with its saved slice; a fresh
  // dialog always opens off, so YOLO is never on by accident.
  open(el, ctx) {
    const box = el.querySelector('input[data-yolo]');
    if (box) box.checked = ctx?.saved?.enabled === true;
  },
  ext(el) {
    return el.querySelector('input[data-yolo]')?.checked ? { enabled: true } : undefined;
  },
  fields(el) {
    return el.querySelector('input[data-yolo]')?.checked ? { autoMergeOnPass: true } : undefined;
  },
};

export default {
  register(reg) {
    reg.register('dispatch.field', yoloField);
  },
};
