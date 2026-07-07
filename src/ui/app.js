// The controller. It owns a Stepper (the engine-backed trace) and a SoundBoard,
// and re-renders the three regions — controls rail, timeline stage, annotation
// panel — from the current frame. All database truth comes from the engine via
// the Stepper; nothing here re-implements visibility or anomaly logic.

import { ISO } from '../engine/mvcc.js';
import { SCENARIOS } from '../engine/scenarios.js';
import { Stepper, isoLabel, fmt } from '../engine/stepper.js';
import { SoundBoard } from './sound.js';

const ISO_ORDER = [ISO.READ_COMMITTED, ISO.REPEATABLE_READ, ISO.SERIALIZABLE];
const ISO_SHORT = {
  [ISO.READ_COMMITTED]: 'RC',
  [ISO.REPEATABLE_READ]: 'RR',
  [ISO.SERIALIZABLE]: 'SER',
};
const OP_LABEL = {
  begin: 'BEGIN',
  read: 'READ',
  scan: 'SCAN',
  write: 'WRITE',
  remove: 'DELETE',
  commit: 'COMMIT',
  abort: 'ABORT',
};

// ---- tiny DOM helper --------------------------------------------------------

export function el(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'aria') {
      for (const [ak, av] of Object.entries(v)) node.setAttribute(`aria-${ak}`, av);
    } else if (v != null && v !== false) {
      node.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

// ---- controller -------------------------------------------------------------

export function createApp(roots, opts = {}) {
  const sound = opts.sound ?? new SoundBoard();
  const state = {
    scenario: SCENARIOS[0],
    stepper: null,
    playing: false,
    playTimer: null,
  };
  // Accept the deep-link id from either opts or the roots bag: the boot threads
  // the hash-derived id in alongside the DOM roots.
  const scenarioId = opts.scenarioId ?? roots.scenarioId;
  const initial = SCENARIOS.find((s) => s.id === scenarioId) || SCENARIOS[0];
  arm(initial);

  function arm(scenario) {
    state.scenario = scenario;
    state.stepper = new Stepper(scenario, {
      T1: scenario.defaultIso,
      T2: scenario.defaultIso,
    });
    stopPlaying();
  }

  function pickScenario(id) {
    const s = SCENARIOS.find((x) => x.id === id);
    if (s) {
      arm(s);
      renderAll();
    }
  }

  function setLevel(actor, iso) {
    state.stepper.setLevel(actor, iso);
    stopPlaying();
    renderAll();
  }

  function announce(frame) {
    if (frame && frame.event) sound.play(frame.event);
    if (state.stepper.flaring && state.stepper.atEnd) {
      sound.play(state.stepper.flare.prevented ? 'win' : 'anomaly');
    }
  }

  function stepForward() {
    if (state.stepper.atEnd) return;
    sound.resume();
    const frame = state.stepper.stepForward();
    announce(frame);
    renderAll();
  }

  function stepBack() {
    state.stepper.stepBack();
    stopPlaying();
    renderAll();
  }

  function reset() {
    state.stepper.reset();
    stopPlaying();
    renderAll();
  }

  function togglePlay() {
    if (state.playing) return stopPlaying(), renderAll();
    if (state.stepper.atEnd) state.stepper.reset();
    sound.resume();
    state.playing = true;
    tick();
    renderAll();
  }

  function tick() {
    if (state.stepper.atEnd) return stopPlaying(), renderAll();
    stepForward();
    if (state.stepper.atEnd) return stopPlaying(), renderAll();
    state.playTimer = setTimeout(tick, 900);
  }

  function stopPlaying() {
    state.playing = false;
    if (state.playTimer) clearTimeout(state.playTimer);
    state.playTimer = null;
  }

  function toggleMute() {
    sound.toggleMute();
    syncMute();
  }

  // ---- rendering ------------------------------------------------------------

  function renderAll() {
    roots.rail.replaceChildren(renderRail());
    roots.stage.replaceChildren(renderStage());
    roots.panel.replaceChildren(renderPanel());
    renderCallout();
    updateLive();
  }

  // A persistent live region narrates each step for screen-reader users: the
  // step count, what the action did, and the anomaly verdict once it flares.
  function updateLive() {
    if (!roots.live) return;
    const st = state.stepper;
    const base = st.frame.explain || 'Ready — step or press the right arrow to run the first action.';
    let msg = `Step ${st.cursor} of ${st.length}. ${base}`;
    if (st.flaring && st.atEnd) msg += ` ${st.outcome.title}: ${st.outcome.detail}`;
    roots.live.textContent = msg;
  }

  function renderCallout() {
    const box = roots.callout;
    if (!box) return;
    const st = state.stepper;
    if (!st.flaring) {
      box.hidden = true;
      box.replaceChildren();
      return;
    }
    const { outcome } = st;
    const prevented = st.flare.prevented;
    box.hidden = false;
    box.className = `callout callout--show callout--${prevented ? 'safe' : 'anomaly'}`;
    const cta = el('div', { class: 'callout__cta' },
      el('button', { class: 'cbtn cbtn--primary', type: 'button', onClick: reset }, '↻ Replay'),
      renderContrastCta(prevented),
    );
    box.replaceChildren(
      el('div', { class: 'callout__card' },
        el('span', { class: 'callout__tag', text: prevented ? 'PREVENTED' : 'ANOMALY' }),
        el('h2', { class: 'callout__title', text: outcome.title }),
        el('p', { class: 'callout__detail', text: outcome.detail }),
        cta,
      ),
      prevented ? renderConfetti() : null,
    );
  }

  // The contrast CTA turns the wow moment into a two-click comparison: after the
  // anomaly fires, raise both lanes to the preventing level; after prevention,
  // drop back to see it break.
  function renderContrastCta(prevented) {
    const s = state.scenario;
    if (prevented) {
      return el('button', {
        class: 'cbtn', type: 'button',
        onClick: () => { state.stepper.setLevels({ T1: s.defaultIso, T2: s.defaultIso }); renderAll(); },
      }, `↓ See it break at ${isoLabel(s.defaultIso)}`);
    }
    return el('button', {
      class: 'cbtn', type: 'button',
      onClick: () => { state.stepper.setLevels({ T1: s.preventedAtOrAbove, T2: s.preventedAtOrAbove }); renderAll(); },
    }, `↑ Prevent it at ${isoLabel(s.preventedAtOrAbove)}`);
  }

  function renderConfetti() {
    const wrap = el('div', { class: 'confetti', aria: { hidden: 'true' } });
    for (let i = 0; i < 14; i++) {
      wrap.append(el('span', { class: 'confetti__bit', style: `--i:${i}` }));
    }
    return wrap;
  }

  function renderRail() {
    const rail = el('div', { class: 'rail__inner' });

    rail.append(el('h2', { class: 'rail__heading', text: 'Scenario' }));
    const picker = el('div', { class: 'picker', role: 'tablist', aria: { label: 'Scenario' } });
    for (const s of SCENARIOS) {
      const active = s.id === state.scenario.id;
      picker.append(
        el('button', {
          class: `pill ${active ? 'pill--on' : ''}`,
          type: 'button',
          role: 'tab',
          aria: { selected: String(active) },
          onClick: () => pickScenario(s.id),
        }, s.title),
      );
    }
    rail.append(picker);
    rail.append(el('p', { class: 'rail__blurb', text: state.scenario.blurb }));
    rail.append(renderHint());

    rail.append(el('h2', { class: 'rail__heading', text: 'Isolation level' }));
    rail.append(renderLevels('T1'));
    rail.append(renderLevels('T2'));

    rail.append(renderTransport());
    return rail;
  }

  function renderHint() {
    const s = state.scenario;
    return el('p', { class: 'hint' },
      el('span', { class: 'hint__fire', text: `fires ≤ ${isoLabel(s.defaultIso)}` }),
      el('span', { class: 'hint__sep', text: '·' }),
      el('span', { class: 'hint__safe', text: `safe ≥ ${isoLabel(s.preventedAtOrAbove)}` }),
    );
  }

  function renderLevels(actor) {
    const current = state.stepper.levels[actor];
    const group = el('div', {
      class: `seg seg--${actor.toLowerCase()}`,
      role: 'radiogroup',
      aria: { label: `${actor} isolation level` },
    });
    group.append(el('span', { class: 'seg__label', text: actor }));
    for (const iso of ISO_ORDER) {
      const on = iso === current;
      group.append(
        el('button', {
          class: `seg__opt ${on ? 'seg__opt--on' : ''}`,
          type: 'button',
          role: 'radio',
          aria: { checked: String(on), label: isoLabel(iso) },
          title: isoLabel(iso),
          onClick: () => setLevel(actor, iso),
        }, ISO_SHORT[iso]),
      );
    }
    return group;
  }

  function renderTransport() {
    const st = state.stepper;
    const box = el('div', { class: 'transport', role: 'group', aria: { label: 'Transport' } });
    const progress = `Step ${st.cursor} / ${st.length}`;
    box.append(el('div', { class: 'transport__count', text: progress }));
    const row = el('div', { class: 'transport__row' });
    row.append(
      el('button', {
        class: 'tbtn', type: 'button', aria: { label: 'Reset' }, title: 'Reset',
        disabled: st.atStart && !state.playing, onClick: reset,
      }, '⤺'),
      el('button', {
        class: 'tbtn', type: 'button', aria: { label: 'Step back' }, title: 'Step back',
        disabled: st.atStart, onClick: stepBack,
      }, '◀'),
      el('button', {
        class: 'tbtn tbtn--wide', type: 'button',
        onClick: togglePlay,
      }, state.playing ? '❚❚ Pause' : '▶ Play'),
      el('button', {
        class: 'tbtn tbtn--primary', type: 'button', aria: { label: 'Step forward' }, title: 'Step',
        disabled: st.atEnd, onClick: stepForward,
      }, 'Step ▶'),
    );
    box.append(row);
    return box;
  }

  function renderStage() {
    const st = state.stepper;
    const frame = st.frame;
    const stage = el('div', { class: 'stage__inner' });
    stage.append(renderLanes());
    stage.append(renderTable(frame));
    return stage;
  }

  function renderLanes() {
    const st = state.stepper;
    const scenario = state.scenario;
    const lanes = el('div', { class: 'lanes' });

    lanes.append(laneHeader('T1'), laneHeader('T2'));

    scenario.steps.forEach((step, i) => {
      const executed = i < st.cursor;
      const active = i === st.cursor - 1;
      const next = i === st.cursor;
      const frame = st.frames[i + 1];
      const cls = [
        'step',
        `step--${step.actor.toLowerCase()}`,
        executed ? 'step--done' : 'step--todo',
        active ? 'step--active' : '',
        next ? 'step--next' : '',
        frame.error ? 'step--error' : '',
      ].join(' ');
      const cell = el('div', { class: cls, style: `grid-column:${step.actor === 'T1' ? 1 : 2}` },
        el('span', { class: 'step__op', text: OP_LABEL[step.op] || step.op }),
        el('span', { class: 'step__note', text: step.note }),
        executed ? el('span', { class: 'step__result', text: frame.result }) : null,
      );
      lanes.append(cell);
    });
    return lanes;
  }

  function laneHeader(actor) {
    const view = state.stepper.frame.txns[actor];
    const iso = state.stepper.levels[actor];
    const status = view.started ? view.status : 'idle';
    return el('div', { class: `lane-head lane-head--${actor.toLowerCase()}` },
      el('span', { class: 'lane-head__name', text: actor }),
      el('span', { class: 'lane-head__iso', text: isoLabel(iso) }),
      el('span', { class: `badge badge--${status}`, text: status }),
    );
  }

  function renderTable(frame) {
    const wrap = el('div', { class: 'board' });
    wrap.append(el('h3', { class: 'board__title', text: 'Shared table' }));
    const rows = el('div', { class: 'rows' });
    if (frame.table.length === 0) {
      rows.append(el('p', { class: 'rows__empty', text: 'No rows yet — begin a transaction.' }));
    }
    for (const row of frame.table) {
      rows.append(renderRow(row, frame));
    }
    wrap.append(rows);
    return wrap;
  }

  function renderRow(row, frame) {
    const st = state.stepper;
    const flaring = st.flaring && st.flare.keys.includes(row.key);
    const node = el('div', {
      class: `row ${flaring ? (st.flare.prevented ? 'row--calm' : 'row--flare') : ''}`,
    },
      el('div', { class: 'row__head' },
        el('span', { class: 'row__key', text: row.key }),
        el('span', { class: 'row__value', text: fmt(row.committed) }),
      ),
      renderChain(row),
    );
    node.append(renderSees(row.key, frame));
    return node;
  }

  function renderChain(row) {
    const chain = el('div', { class: 'chain', aria: { label: `version chain for ${row.key}` } });
    row.versions.forEach((v, i) => {
      const live = v.xmax == null;
      chain.append(
        el('div', {
          class: `ver ver--${v.xminStatus || 'active'} ${live ? 'ver--live' : 'ver--dead'}`,
          title: `v${v.id} · xmin ${v.xmin} (${v.xminStatus}) · xmax ${v.xmax == null ? '∞' : `${v.xmax} (${v.xmaxStatus})`}`,
        },
          el('span', { class: 'ver__val', text: fmt(v.value) }),
          el('span', { class: 'ver__stamp', text: `xmin ${v.xmin} · xmax ${v.xmax == null ? '∞' : v.xmax}` }),
        ),
      );
      if (i < row.versions.length - 1) chain.append(el('span', { class: 'chain__arrow', text: '→' }));
    });
    return chain;
  }

  function renderSees(key, frame) {
    const box = el('div', { class: 'sees' });
    for (const actor of ['T1', 'T2']) {
      const view = frame.txns[actor];
      if (!view.started || view.status !== 'active') continue;
      box.append(
        el('span', { class: `sees__chip sees__chip--${actor.toLowerCase()}` },
          `${actor} sees ${fmt(view.sees[key])}`),
      );
    }
    return box;
  }

  function renderPanel() {
    const frame = state.stepper.frame;
    const panel = el('div', { class: 'panel__inner' });
    panel.append(el('h3', { class: 'panel__title', text: 'What just happened' }));
    panel.append(
      el('p', { class: 'explain', text: frame.explain || 'Press Step to run the first action.' }),
    );
    panel.append(el('h3', { class: 'panel__title', text: 'Snapshot inspector' }));
    panel.append(renderInspector(frame));
    return panel;
  }

  function renderInspector(frame) {
    const box = el('div', { class: 'inspector' });
    let any = false;
    for (const actor of ['T1', 'T2']) {
      const view = frame.txns[actor];
      if (!view.started) continue;
      any = true;
      const rc = view.iso === ISO.READ_COMMITTED;
      const visible = (view.snapshot || []).filter((id) => id !== 0);
      const snapText = rc
        ? 'refreshes every statement — sees any committed txn'
        : visible.length
          ? `frozen: sees committed {${visible.join(', ')}}`
          : 'frozen at begin: no concurrent commits visible';
      box.append(
        el('div', { class: `insp insp--${actor.toLowerCase()}` },
          el('div', { class: 'insp__head' },
            el('span', { class: 'insp__name', text: `${actor} · T#${view.id}` }),
            el('span', { class: `badge badge--${view.status}`, text: view.status }),
          ),
          el('div', { class: 'insp__row', text: `${isoLabel(view.iso)} — ${snapText}` }),
          el('div', { class: 'insp__row insp__row--dim',
            text: `read {${view.reads.join(', ') || '—'}}  ·  wrote {${view.writes.join(', ') || '—'}}` }),
        ),
      );
    }
    if (!any) box.append(el('p', { class: 'insp__empty', text: 'No transactions have begun yet.' }));
    return box;
  }

  function syncMute() {
    const btn = roots.mute;
    if (!btn) return;
    btn.setAttribute('aria-pressed', String(sound.muted));
    btn.classList.toggle('mute--off', sound.muted);
    const label = btn.querySelector('.mute__label');
    if (label) label.textContent = sound.muted ? 'Muted' : 'Sound';
  }

  // ---- wiring ---------------------------------------------------------------

  if (roots.mute) roots.mute.addEventListener('click', toggleMute);

  function onKey(e) {
    const tag = (e.target && e.target.tagName) || '';
    const onButton = tag === 'BUTTON';
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault(); stepForward(); break;
      case 'ArrowLeft':
        e.preventDefault(); stepBack(); break;
      case ' ':
        if (onButton) return; // let the focused button handle its own activation
        e.preventDefault(); stepForward(); break;
      case 'r': case 'R':
        if (!onButton) reset(); break;
      case 'p': case 'P':
        if (!onButton) togglePlay(); break;
      case 'm': case 'M':
        if (!onButton) toggleMute(); break;
      default:
        return;
    }
  }
  if (opts.keyboard !== false && typeof document !== 'undefined') {
    document.addEventListener('keydown', onKey);
  }

  renderAll();
  syncMute();

  return { state, stepForward, stepBack, reset, togglePlay, pickScenario, setLevel, toggleMute };
}

// ---- boot -------------------------------------------------------------------

/** Parse a scenario id from a URL hash like "#write-skew". */
export function scenarioIdFromHash(hash) {
  const id = (hash || '').replace(/^#/, '').trim();
  return SCENARIOS.some((s) => s.id === id) ? id : null;
}

if (typeof document !== 'undefined') {
  const rail = document.getElementById('rail');
  const stage = document.getElementById('stage');
  const panel = document.getElementById('panel');
  const mute = document.getElementById('mute');
  const callout = document.getElementById('callout');
  const live = document.getElementById('live');
  if (rail && stage && panel) {
    const scenarioId = scenarioIdFromHash(location.hash);
    const app = createApp({ rail, stage, panel, mute, callout, live, scenarioId });

    // Landing CTAs and back/forward navigation deep-link into a scenario.
    window.addEventListener('hashchange', () => {
      const id = scenarioIdFromHash(location.hash);
      if (id) app.pickScenario(id);
    });
    document.querySelectorAll('[data-scenario]').forEach((node) => {
      node.addEventListener('click', () => {
        const id = node.getAttribute('data-scenario');
        if (scenarioIdFromHash('#' + id)) {
          app.pickScenario(id);
          stage.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
  }
}
