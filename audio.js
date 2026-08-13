/**
 * audio.js
 * Small procedural sound engine built on the Web Audio API.
 * We synthesize every effect instead of shipping binary audio files —
 * this keeps the game's offline footprint tiny and avoids any external
 * asset dependency. All calls are no-ops if Web Audio isn't available
 * or sound is disabled in settings.
 */

const AudioFX = (() => {
  let ctx = null;
  let unlocked = false;
  let enabled = true;
  let vibrationEnabled = true;

  function ensureContext() {
    if (ctx) return ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    try {
      ctx = new Ctx();
    } catch {
      ctx = null;
    }
    return ctx;
  }

  // Must be called from a user gesture to satisfy autoplay policies.
  function unlock() {
    const c = ensureContext();
    if (!c) return;
    if (c.state === 'suspended') c.resume().catch(() => {});
    unlocked = true;
  }

  function setEnabled(v) { enabled = !!v; }
  function setVibrationEnabled(v) { vibrationEnabled = !!v; }

  function tone({ freq = 440, duration = 0.12, type = 'sine', gain = 0.18, delay = 0, sweepTo = null }) {
    if (!enabled) return;
    const c = ensureContext();
    if (!c || !unlocked) return;
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (sweepTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, sweepTo), t0 + duration);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(g).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  function chord(freqs, opts = {}) {
    freqs.forEach((f, i) => tone({ ...opts, freq: f, delay: (opts.delay || 0) + i * 0.05 }));
  }

  function vibrate(pattern) {
    if (!vibrationEnabled) return;
    if (!('vibrate' in navigator)) return;
    try { navigator.vibrate(pattern); } catch { /* noop */ }
  }

  return {
    unlock,
    setEnabled,
    setVibrationEnabled,
    click: () => tone({ freq: 520, duration: 0.06, type: 'triangle', gain: 0.12 }),
    pickUp: () => tone({ freq: 340, duration: 0.08, type: 'sine', gain: 0.14 }),
    move: () => tone({ freq: 260, duration: 0.03, type: 'sine', gain: 0.04 }),
    place: () => { tone({ freq: 440, duration: 0.1, type: 'triangle', gain: 0.16, sweepTo: 660 }); vibrate(12); },
    connect: () => { chord([523, 659], { duration: 0.14, type: 'triangle', gain: 0.15 }); vibrate(18); },
    error: () => { tone({ freq: 160, duration: 0.16, type: 'sawtooth', gain: 0.1, sweepTo: 90 }); vibrate([10, 30, 10]); },
    hint: () => tone({ freq: 700, duration: 0.15, type: 'sine', gain: 0.12, sweepTo: 900 }),
    start: () => chord([392, 523, 659], { duration: 0.16, type: 'sine', gain: 0.14 }),
    win: () => {
      chord([523, 659, 784, 1046], { duration: 0.28, type: 'triangle', gain: 0.18 });
      vibrate([30, 60, 30, 60, 80]);
    },
    record: () => {
      chord([659, 784, 988, 1318], { duration: 0.3, type: 'square', gain: 0.12 });
      vibrate([20, 40, 20, 40, 20, 100]);
    }
  };
})();
