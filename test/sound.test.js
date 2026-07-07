import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SoundBoard } from '../src/ui/sound.js';

// A minimal in-memory localStorage stand-in.
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
  };
}

// A fake AudioContext that records how many nodes were created, so we can assert
// a play produced sound without needing real audio hardware.
function fakeAudio() {
  const calls = { oscillators: 0, gains: 0 };
  class Ctx {
    constructor() {
      this.currentTime = 0;
      this.state = 'running';
      this.destination = {};
    }
    resume() {
      this.state = 'running';
    }
    createOscillator() {
      calls.oscillators++;
      return {
        type: 'sine',
        frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect: () => ({ connect() {} }),
        start() {},
        stop() {},
      };
    }
    createGain() {
      calls.gains++;
      return {
        gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect: () => ({ connect() {} }),
      };
    }
  }
  return { Ctx, calls };
}

test('with no AudioContext, play is a silent no-op and never throws', () => {
  const board = new SoundBoard({ AudioCtx: null, storage: fakeStorage() });
  assert.equal(board.supported, false);
  assert.equal(board.play('commit'), false, 'no sound without audio support');
});

test('resume creates a context and then play schedules a voice', () => {
  const { Ctx, calls } = fakeAudio();
  const board = new SoundBoard({ AudioCtx: Ctx, storage: fakeStorage() });
  assert.equal(board.play('commit'), false, 'no context before resume');
  board.resume();
  assert.equal(board.play('commit'), true, 'plays after resume');
  assert.equal(calls.oscillators, 1);
  assert.equal(calls.gains, 1);
});

test('a muted board stays silent', () => {
  const { Ctx, calls } = fakeAudio();
  const board = new SoundBoard({ AudioCtx: Ctx, storage: fakeStorage() });
  board.resume();
  board.setMuted(true);
  assert.equal(board.play('write'), false);
  assert.equal(calls.oscillators, 0, 'nothing was scheduled while muted');
});

test('mute state persists and reloads from storage', () => {
  const storage = fakeStorage();
  const a = new SoundBoard({ AudioCtx: fakeAudio().Ctx, storage });
  assert.equal(a.muted, false, 'defaults to unmuted');
  a.toggleMute();
  assert.equal(a.muted, true);

  const b = new SoundBoard({ AudioCtx: fakeAudio().Ctx, storage });
  assert.equal(b.muted, true, 'a fresh board reads the persisted mute');
});

test('plays are rate-throttled within the minimum gap', () => {
  const { Ctx, calls } = fakeAudio();
  const board = new SoundBoard({ AudioCtx: Ctx, storage: fakeStorage(), minGap: 0.03 });
  board.resume();
  assert.equal(board.play('read'), true, 'first play goes through');
  assert.equal(board.play('read'), false, 'a second immediate play is throttled');
  board._ctx.currentTime = 1; // time advances past the gap
  assert.equal(board.play('read'), true, 'plays again after the gap');
});

test('the win voice schedules a chord of several notes', () => {
  const { Ctx, calls } = fakeAudio();
  const board = new SoundBoard({ AudioCtx: Ctx, storage: fakeStorage() });
  board.resume();
  assert.equal(board.play('win'), true);
  assert.ok(calls.oscillators >= 4, 'the win arpeggio plays multiple notes');
});

test('an unknown event plays nothing', () => {
  const board = new SoundBoard({ AudioCtx: fakeAudio().Ctx, storage: fakeStorage() });
  board.resume();
  assert.equal(board.play('nonsense'), false);
});

test('hostile storage never breaks construction, mute, or persistence', () => {
  const hostile = {
    getItem() { throw new Error('SecurityError'); },
    setItem() { throw new Error('QuotaExceeded'); },
  };
  let board;
  assert.doesNotThrow(() => { board = new SoundBoard({ AudioCtx: null, storage: hostile }); });
  assert.equal(board.muted, false, 'a throwing getItem falls back to unmuted');
  assert.doesNotThrow(() => board.setMuted(true), 'a throwing setItem is swallowed');
  assert.equal(board.muted, true, 'the in-memory mute state still updates');
});

test('a throwing AudioContext constructor degrades to silence, not a crash', () => {
  class Boom {
    constructor() { throw new Error('no audio device'); }
  }
  const board = new SoundBoard({ AudioCtx: Boom, storage: fakeStorage() });
  assert.doesNotThrow(() => board.resume());
  assert.equal(board.play('commit'), false, 'no context means no sound');
});

test('a voice that throws mid-schedule is caught and reported as no sound', () => {
  class Flaky {
    constructor() { this.currentTime = 0; this.state = 'running'; this.destination = {}; }
    resume() {}
    createOscillator() { throw new Error('oscillator failed'); }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: () => ({ connect() {} }) }; }
  }
  const board = new SoundBoard({ AudioCtx: Flaky, storage: fakeStorage() });
  board.resume();
  assert.equal(board.play('commit'), false, 'a failed schedule returns false without throwing');
});
