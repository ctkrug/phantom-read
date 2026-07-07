// Scaffold UI — proves the engine runs end to end in the browser. It lists the
// scenarios, lets you pick an isolation level, replays the scripted steps
// through the MVCC engine, and prints the resulting trace.
//
// This is intentionally minimal; the full step-by-step timeline visualisation
// (two swim lanes, version chains, anomaly flares) is built in later runs
// against docs/DESIGN.md. What matters now is that the real engine drives it.

import { Database, ISO } from '../engine/mvcc.js';
import { SCENARIOS } from '../engine/scenarios.js';

const ISO_LABELS = {
  [ISO.READ_COMMITTED]: 'Read Committed',
  [ISO.REPEATABLE_READ]: 'Repeatable Read',
  [ISO.SERIALIZABLE]: 'Serializable',
};

/** Replay a scenario's steps at `iso`, returning a per-step trace. */
export function replay(scenario, iso) {
  const db = new Database(scenario.seed);
  const txns = {};
  const trace = [];
  for (const step of scenario.steps) {
    const t = txns[step.actor];
    let result = '';
    try {
      switch (step.op) {
        case 'begin':
          txns[step.actor] = db.begin(iso);
          break;
        case 'read':
          result = `= ${format(t.read(step.key))}`;
          break;
        case 'scan':
          result = `→ ${t.scan().length} rows`;
          break;
        case 'write':
          t.write(step.key, step.value);
          break;
        case 'remove':
          t.remove(step.key);
          break;
        case 'commit':
          t.commit();
          result = 'committed';
          break;
        case 'abort':
          t.abort();
          result = 'aborted';
          break;
      }
    } catch (err) {
      result = `✗ ${err.name}`;
    }
    trace.push({ ...step, result });
  }
  return trace;
}

function format(v) {
  return v === undefined ? '∅' : String(v);
}

function render(root) {
  root.innerHTML = '';
  for (const scenario of SCENARIOS) {
    const card = document.createElement('section');
    card.className = 'scenario';

    const iso = scenario.defaultIso;
    card.innerHTML = `
      <h2 class="scenario__title">${scenario.title}</h2>
      <p class="scenario__blurb">${scenario.blurb}</p>
      <div class="scenario__level">Isolation: <strong>${ISO_LABELS[iso]}</strong></div>
      <ol class="trace"></ol>
    `;

    const list = card.querySelector('.trace');
    for (const step of replay(scenario, iso)) {
      const li = document.createElement('li');
      li.className = 'trace__step';
      li.innerHTML = `
        <span class="trace__actor trace__actor--${step.actor.toLowerCase()}">${step.actor}</span>
        <span class="trace__note">${step.note}</span>
        <span class="trace__result">${step.result}</span>
      `;
      list.appendChild(li);
    }
    root.appendChild(card);
  }
}

if (typeof document !== 'undefined') {
  const root = document.getElementById('app');
  if (root) render(root);
}
