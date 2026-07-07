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
  arm(SCENARIOS[0]);

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

    rail.append(renderTransport());
    return rail;
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
    const node = el('div', { class: 'row' },
      el('span', { class: 'row__key', text: row.key }),
      el('span', { class: 'row__value', text: fmt(row.committed) }),
    );
    node.append(renderSees(row.key, frame));
    return node;
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
    return panel;
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

  renderAll();
  syncMute();

  return { state, stepForward, stepBack, reset, togglePlay, pickScenario, setLevel, toggleMute };
}

// ---- boot -------------------------------------------------------------------

if (typeof document !== 'undefined') {
  const rail = document.getElementById('rail');
  const stage = document.getElementById('stage');
  const panel = document.getElementById('panel');
  const mute = document.getElementById('mute');
  if (rail && stage && panel) {
    createApp({ rail, stage, panel, mute });
  }
}
