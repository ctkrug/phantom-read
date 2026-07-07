// Synthesised sound effects — no binary assets. Every voice is generated from
// oscillators and a gain envelope through the WebAudio API, matching the
// blueprint direction: clean, mono, technical blips for the transport and reads,
// a coral downward flare for an anomaly, a calm arpeggio for the "database saved
// you" win.
//
// The board degrades safely: with no AudioContext (tests, old browsers) or while
// muted, play() is a no-op that returns false. The context is created lazily on
// the first user gesture to satisfy autoplay policy, and mute persists in
// localStorage.

const MUTE_KEY = 'phantom-read:muted';

// event -> voice recipe. freq in Hz, dur in seconds, gain is peak amplitude.
const VOICES = {
  begin: { type: 'sine', freq: 320, to: 380, dur: 0.09, gain: 0.05 },
  step: { type: 'triangle', freq: 440, dur: 0.05, gain: 0.04 },
  read: { type: 'sine', freq: 560, dur: 0.06, gain: 0.045 },
  write: { type: 'triangle', freq: 300, to: 340, dur: 0.08, gain: 0.06 },
  commit: { type: 'sine', freq: 520, to: 660, dur: 0.12, gain: 0.06 },
  abort: { type: 'sawtooth', freq: 220, to: 120, dur: 0.16, gain: 0.06 },
  // Anomaly: a coral flare — a bright note bent sharply downward.
  anomaly: { type: 'sawtooth', freq: 660, to: 180, dur: 0.28, gain: 0.07 },
  // Win: a rising arpeggio, played as a short chord sequence.
  win: { chord: [523.25, 659.25, 783.99, 1046.5], type: 'sine', dur: 0.5, gain: 0.06 },
};

export class SoundBoard {
  constructor(opts = {}) {
    this._storage =
      opts.storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    this._AudioCtx =
      opts.AudioCtx ??
      (typeof window !== 'undefined'
        ? window.AudioContext || window.webkitAudioContext
        : null);
    this._ctx = null;
    this._lastAt = -Infinity;
    this._minGap = opts.minGap ?? 0.03; // seconds, rate-throttle
    this._muted = this._loadMuted();
  }

  get muted() {
    return this._muted;
  }

  get supported() {
    return this._AudioCtx != null;
  }

  _loadMuted() {
    try {
      return this._storage?.getItem(MUTE_KEY) === '1';
    } catch {
      return false;
    }
  }

  _persist() {
    try {
      this._storage?.setItem(MUTE_KEY, this._muted ? '1' : '0');
    } catch {
      /* storage may be unavailable (private mode) — ignore */
    }
  }

  setMuted(value) {
    this._muted = Boolean(value);
    this._persist();
    return this._muted;
  }

  toggleMute() {
    return this.setMuted(!this._muted);
  }

  /** Create/resume the AudioContext. Call from a user gesture handler. */
  resume() {
    if (!this._AudioCtx) return;
    try {
      if (!this._ctx) this._ctx = new this._AudioCtx();
      if (this._ctx.state === 'suspended') this._ctx.resume();
    } catch {
      this._ctx = null;
    }
  }

  /**
   * Play the voice for `event`. Returns true if a sound was actually scheduled.
   * Never throws — audio must never break the app.
   */
  play(event) {
    const voice = VOICES[event];
    if (!voice || this._muted || !this._ctx) return false;
    const now = this._ctx.currentTime;
    if (now - this._lastAt < this._minGap) return false;
    this._lastAt = now;
    try {
      if (voice.chord) {
        voice.chord.forEach((f, i) => this._blip({ ...voice, freq: f }, now + i * 0.09));
      } else {
        this._blip(voice, now);
      }
      return true;
    } catch {
      return false;
    }
  }

  _blip(voice, at) {
    const ctx = this._ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = voice.type || 'sine';
    osc.frequency.setValueAtTime(voice.freq, at);
    if (voice.to != null) {
      osc.frequency.exponentialRampToValueAtTime(voice.to, at + voice.dur);
    }
    // Fast attack, exponential release — a crisp, engineered blip.
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(voice.gain, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + voice.dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + voice.dur + 0.02);
  }
}
