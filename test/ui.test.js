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
  return {
    createElement: (t) => new FakeNode(t),
    createTextNode: (s) => txt(s),
    getElementById: () => null,
    addEventListener: () => {},
  };
}

function allText(node) {
  if (node.nodeType === 3) return node.textContent || '';
  if (node.children.length === 0) return node._text || '';
  return node.children.map(allText).join(' ');
}

async function mount() {
  globalThis.document = fakeDocument();
  const { createApp } = await import('../src/ui/app.js');
  const roots = {
    rail: new FakeNode('aside'),
    stage: new FakeNode('section'),
    panel: new FakeNode('aside'),
    callout: new FakeNode('div'),
    mute: new FakeNode('button'),
  };
  roots.mute.append(new FakeNode('span')); // a stand-in for the .mute__label
  const app = createApp(roots, { keyboard: false });
  return { app, roots };
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

test('picking a scenario re-arms the timeline to the start', async () => {
  const { app } = await mount();
  app.stepForward();
  app.stepForward();
  assert.ok(app.state.stepper.cursor > 0);
  app.pickScenario('phantom-read');
  assert.equal(app.state.stepper.cursor, 0, 'a new scenario starts fresh');
  assert.equal(app.state.scenario.id, 'phantom-read');
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
