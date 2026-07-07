// Headless render test. A tiny DOM shim lets the real controller mount and step
// under node:test, so we verify the UI builds without throwing and that the wow
// moment surfaces the right callout — without a browser or any dependency.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ISO } from '../src/engine/mvcc.js';

function txt(s) {
  return { nodeType: 3, textContent: String(s), children: [], _class: '' };
}

class FakeNode {
  constructor(tag) {
    this.tagName = (tag || '').toUpperCase();
    this.nodeType = 1;
    this.children = [];
    this.attrs = {};
    this._class = '';
    this._text = '';
    this.listeners = {};
    this.hidden = false;
  }
  set className(v) { this._class = v; }
  get className() { return this._class; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() {
    if (this.children.length) return this.children.map((c) => c.textContent).join('');
    return this._text;
  }
  set innerHTML(v) { this._html = v; this.children = []; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'class') this._class = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener(type, fn) { (this.listeners[type] || (this.listeners[type] = [])).push(fn); }
  dispatch(type, ev = {}) { (this.listeners[type] || []).forEach((fn) => fn(ev)); }
  append(...kids) {
    for (const k of kids) {
      if (k == null || k === false) continue;
      this.children.push(typeof k === 'object' ? k : txt(k));
    }
  }
  appendChild(k) { this.children.push(k); return k; }
  replaceChildren(...kids) { this.children = []; this.append(...kids); }
  get classList() {
    const self = this;
    const list = () => self._class.split(/\s+/).filter(Boolean);
    return {
      contains: (c) => list().includes(c),
      add: (c) => { if (!list().includes(c)) self._class = [...list(), c].join(' '); },
      remove: (c) => { self._class = list().filter((x) => x !== c).join(' '); },
      toggle: (c, on) => {
        const want = on == null ? !list().includes(c) : on;
        if (want) self._class = [...new Set([...list(), c])].join(' ');
        else self._class = list().filter((x) => x !== c).join(' ');
      },
    };
  }
  querySelector(sel) {
    const cls = sel.replace(/^\./, '');
    const walk = (n) => {
      for (const c of n.children) {
        if (c._class && c._class.split(/\s+/).includes(cls)) return c;
        const f = walk(c);
        if (f) return f;
      }
      return null;
    };
    return walk(this);
  }
}

function fakeDocument() {
  const listeners = {};
  return {
    createElement: (t) => new FakeNode(t),
    createTextNode: (s) => txt(s),
    getElementById: () => null,
    addEventListener: (type, fn) => (listeners[type] || (listeners[type] = [])).push(fn),
    // Test helper: fire a keydown at the document, as the browser would.
    fireKey(key, target = {}) {
      const ev = { key, target, preventDefault() {} };
      (listeners.keydown || []).forEach((fn) => fn(ev));
    },
  };
}

function allText(node) {
  if (node.nodeType === 3) return node.textContent || '';
  if (node.children.length === 0) return node._text || '';
  return node.children.map(allText).join(' ');
}

async function mount(appOpts = { keyboard: false }) {
  const doc = fakeDocument();
  globalThis.document = doc;
  const { createApp } = await import('../src/ui/app.js');
  const roots = {
    rail: new FakeNode('aside'),
    stage: new FakeNode('section'),
    panel: new FakeNode('aside'),
    callout: new FakeNode('div'),
    mute: new FakeNode('button'),
    live: new FakeNode('div'),
  };
  roots.mute.append(new FakeNode('span')); // a stand-in for the .mute__label
  const app = createApp(roots, appOpts);
  return { app, roots, doc };
}

test('the app mounts and renders all three regions', async () => {
  const { roots } = await mount();
  assert.match(allText(roots.rail), /Scenario/);
  assert.match(allText(roots.rail), /Isolation level/);
  assert.match(allText(roots.stage), /Shared table/);
  assert.match(allText(roots.panel), /What just happened/);
});

test('stepping the write-skew wow moment shows the anomaly then the prevention', async () => {
  const { app, roots } = await mount();
  app.pickScenario('write-skew');

  // Default is Repeatable Read for both lanes — step to the end.
  while (!app.state.stepper.atEnd) app.stepForward();
  assert.equal(roots.callout.hidden, false, 'callout shows at the end');
  assert.match(allText(roots.callout), /WRITE SKEW/, 'the anomaly is named');
  assert.match(allText(roots.callout), /Replay/, 'a next action is offered');

  // Raise both lanes to Serializable and replay — now it is prevented.
  app.setLevel('T1', ISO.SERIALIZABLE);
  app.setLevel('T2', ISO.SERIALIZABLE);
  while (!app.state.stepper.atEnd) app.stepForward();
  assert.match(allText(roots.callout), /PREVENTED/, 'Serializable prevents it');
});

test('the shared table renders version chains with xmin/xmax stamps', async () => {
  const { app, roots } = await mount();
  app.pickScenario('dirty-read');
  app.stepForward(); // T1 begins
  app.stepForward(); // T2 begins
  app.stepForward(); // T1 writes 999 — a new version appears
  assert.match(allText(roots.stage), /xmin/, 'version stamps are drawn');
  assert.match(allText(roots.stage), /999/, 'the new version value shows');
});

test('scenario pills expose the active one with aria-pressed', async () => {
  const { app, roots } = await mount();
  const pills = (node, out = []) => {
    for (const c of node.children || []) {
      if (c._class && c._class.split(/\s+/).includes('pill')) out.push(c);
      pills(c, out);
    }
    return out;
  };
  app.pickScenario('write-skew');
  const found = pills(roots.rail);
  assert.equal(found.length, 4, 'one pill per scenario');
  const pressed = found.filter((p) => p.getAttribute('aria-pressed') === 'true');
  assert.equal(pressed.length, 1, 'exactly one pill is pressed');
  assert.match(pressed[0].textContent, /Write skew/, 'the active scenario is the pressed one');
});

test('picking a scenario re-arms the timeline to the start', async () => {
  const { app } = await mount();
  app.stepForward();
  app.stepForward();
  assert.ok(app.state.stepper.cursor > 0);
  app.pickScenario('phantom-read');
  assert.equal(app.state.stepper.cursor, 0, 'a new scenario starts fresh');
  assert.equal(app.state.scenario.id, 'phantom-read');
});

test('the module boot wires the real DOM and opens the hash-linked scenario', async () => {
  // Drive app.js's top-level boot the way a browser would: real element ids,
  // a deep-link hash, a window with addEventListener, and querySelectorAll for
  // the landing CTAs. It must mount without throwing and render into #rail.
  const ids = {};
  for (const id of ['rail', 'stage', 'panel', 'mute', 'callout', 'live']) ids[id] = new FakeNode('div');
  ids.mute.append(new FakeNode('span'));
  const doc = fakeDocument();
  const cards = [];
  globalThis.document = {
    ...doc,
    getElementById: (id) => ids[id] ?? null,
    querySelectorAll: () => cards,
  };
  globalThis.window = { addEventListener() {} };
  globalThis.location = { hash: '#phantom-read' };
  await import('../src/ui/app.js?boot=1');
  assert.ok(ids.rail.children.length > 0, 'the rail rendered');
  assert.match(allText(ids.rail), /Phantom read/i, 'the deep-linked scenario is active');
  delete globalThis.window;
  delete globalThis.location;
});

test('scenarioIdFromHash accepts known ids and rejects junk', async () => {
  globalThis.document = fakeDocument();
  const { scenarioIdFromHash } = await import('../src/ui/app.js');
  assert.equal(scenarioIdFromHash('#write-skew'), 'write-skew');
  assert.equal(scenarioIdFromHash('phantom-read'), 'phantom-read');
  assert.equal(scenarioIdFromHash('#nope'), null);
  assert.equal(scenarioIdFromHash(''), null);
  assert.equal(scenarioIdFromHash(undefined), null);
});

test('mashing the controls past the boundaries never escapes the valid range', async () => {
  const fakeSound = { play() {}, resume() {}, toggleMute() {}, get muted() { return false; } };
  const { app } = await mount({ keyboard: false, sound: fakeSound });
  const len = app.state.stepper.length;
  for (let i = 0; i < 50; i++) app.stepForward();
  assert.equal(app.state.stepper.cursor, len, 'cannot step past the end');
  for (let i = 0; i < 50; i++) app.stepBack();
  assert.equal(app.state.stepper.cursor, 0, 'cannot step before the start');
  // Rapidly toggle play; it must never leave more than one live timer or wedge.
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  let live = 0;
  globalThis.setTimeout = () => { live += 1; return live; };
  globalThis.clearTimeout = () => { live = Math.max(0, live - 1); };
  try {
    for (let i = 0; i < 10; i++) app.togglePlay();
    assert.ok(live <= 1, `at most one pending timer, saw ${live}`);
    app.reset();
    assert.equal(app.state.playing, false, 'reset stops playback');
  } finally {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
  }
});

test('the live region narrates each step and the final verdict', async () => {
  const { app, roots } = await mount();
  app.pickScenario('write-skew');
  assert.match(allText(roots.live), /Step 0 of/, 'starts with the step count');
  app.stepForward();
  assert.match(allText(roots.live), /Step 1 of/, 'updates the step count');
  assert.ok(allText(roots.live).length > 12, 'includes the action explanation');
  while (!app.state.stepper.atEnd) app.stepForward();
  assert.match(allText(roots.live), /WRITE SKEW/, 'announces the anomaly verdict at the end');
});

test('arrow keys and space drive the timeline; r resets', async () => {
  const fakeSound = { play() {}, resume() {}, toggleMute() {}, get muted() { return false; } };
  const { app, doc } = await mount({ keyboard: true, sound: fakeSound });
  doc.fireKey('ArrowRight');
  doc.fireKey('ArrowRight');
  assert.equal(app.state.stepper.cursor, 2, 'ArrowRight steps forward');
  doc.fireKey('ArrowLeft');
  assert.equal(app.state.stepper.cursor, 1, 'ArrowLeft steps back');
  doc.fireKey(' ');
  assert.equal(app.state.stepper.cursor, 2, 'space steps forward');
  doc.fireKey('r');
  assert.equal(app.state.stepper.cursor, 0, 'r resets to the start');
});

test('Home and End jump to the start and end of the timeline', async () => {
  const fakeSound = { play() {}, resume() {}, toggleMute() {}, get muted() { return false; } };
  const { app, doc } = await mount({ keyboard: true, sound: fakeSound });
  doc.fireKey('End');
  assert.equal(app.state.stepper.cursor, app.state.stepper.length, 'End jumps to the last frame');
  assert.equal(app.state.stepper.atEnd, true);
  doc.fireKey('Home');
  assert.equal(app.state.stepper.cursor, 0, 'Home jumps back to the start');
});

test('space is ignored when a button is focused so it activates the button', async () => {
  const fakeSound = { play() {}, resume() {}, toggleMute() {}, get muted() { return false; } };
  const { app, doc } = await mount({ keyboard: true, sound: fakeSound });
  doc.fireKey(' ', { tagName: 'BUTTON' });
  assert.equal(app.state.stepper.cursor, 0, 'space on a button does not double-fire a step');
});

test('m toggles mute from the keyboard', async () => {
  let muted = false;
  const fakeSound = {
    play() {}, resume() {},
    toggleMute() { muted = !muted; },
    get muted() { return muted; },
  };
  const { doc } = await mount({ keyboard: true, sound: fakeSound });
  doc.fireKey('m');
  assert.equal(muted, true, 'm mutes');
  doc.fireKey('m');
  assert.equal(muted, false, 'm unmutes');
});

test('p toggles play from the keyboard without leaking a timer', async () => {
  const fakeSound = { play() {}, resume() {}, toggleMute() {}, get muted() { return false; } };
  const { app, doc } = await mount({ keyboard: true, sound: fakeSound });
  doc.fireKey('p');
  assert.equal(app.state.playing, true, 'p starts playback');
  doc.fireKey('p');
  assert.equal(app.state.playing, false, 'p pauses and clears the timer');
});

test('play runs to the end then stops on its own', async () => {
  const fakeSound = { play() {}, resume() {}, toggleMute() {}, get muted() { return false; } };
  // Run the play loop synchronously by making setTimeout fire immediately.
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = (fn) => { fn(); return 0; };
  globalThis.clearTimeout = () => {};
  try {
    const { app } = await mount({ keyboard: false, sound: fakeSound });
    app.togglePlay();
    assert.equal(app.state.stepper.atEnd, true, 'play advances to the end');
    assert.equal(app.state.playing, false, 'and stops itself at the end');
  } finally {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
  }
});

test('createApp honours an initial scenarioId', async () => {
  globalThis.document = fakeDocument();
  const { createApp } = await import('../src/ui/app.js');
  const roots = {
    rail: new FakeNode('aside'), stage: new FakeNode('section'),
    panel: new FakeNode('aside'), callout: new FakeNode('div'), mute: new FakeNode('button'),
  };
  roots.mute.append(new FakeNode('span'));
  const app = createApp(roots, { keyboard: false, scenarioId: 'write-skew' });
  assert.equal(app.state.scenario.id, 'write-skew');
});

test('a deep-linked scenarioId in the roots is honoured (boot wiring)', async () => {
  // The boot passes the hash-derived scenarioId alongside the DOM roots. This
  // guards initial deep-linking: loading #write-skew must open write-skew, not
  // fall back to the first scenario.
  globalThis.document = fakeDocument();
  const { createApp } = await import('../src/ui/app.js');
  const roots = {
    rail: new FakeNode('aside'), stage: new FakeNode('section'),
    panel: new FakeNode('aside'), callout: new FakeNode('div'), mute: new FakeNode('button'),
    scenarioId: 'write-skew',
  };
  roots.mute.append(new FakeNode('span'));
  const app = createApp(roots, { keyboard: false });
  assert.equal(app.state.scenario.id, 'write-skew');
});
