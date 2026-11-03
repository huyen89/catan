/**
 * Sound effects synthesised with WebAudio (no audio files). Nothing is created until the first
 * cue that is not muted (callers only invoke playSounds when unmuted). Browsers keep a context
 * suspended until the page has had a user gesture: such a cue is dropped, and the next gesture
 * (unless muted by then) resumes the context, after which the gesture listeners are removed.
 */
import type { SoundId } from './events';
import { useSoundStore } from './store';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let unlockInstalled = false;

function ensureContext(): AudioContext | null {
  if (ctx) return ctx;
  if (typeof window === 'undefined' || typeof window.AudioContext === 'undefined') return null;
  try {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
  }
  return ctx;
}

function resume(): void {
  if (!ctx || ctx.state === 'running') return;
  ctx.resume().then(
    () => {
      if (ctx?.state === 'running') removeUnlock();
    },
    () => {},
  );
}

function onGesture(): void {
  if (useSoundStore.getState().muted) return;
  resume();
}

function installUnlock(): void {
  if (unlockInstalled) return;
  unlockInstalled = true;
  window.addEventListener('pointerdown', onGesture, true);
  window.addEventListener('keydown', onGesture, true);
}

function removeUnlock(): void {
  if (!unlockInstalled) return;
  unlockInstalled = false;
  window.removeEventListener('pointerdown', onGesture, true);
  window.removeEventListener('keydown', onGesture, true);
}

function audio(): { ac: AudioContext; out: GainNode } | null {
  const ac = ensureContext();
  if (!ac) return null;
  if (ac.state !== 'running') {
    installUnlock();
    resume();
    return null;
  }
  return { ac, out: master! };
}

/** One enveloped oscillator note. */
function tone(
  ac: AudioContext,
  out: AudioNode,
  opts: {
    at: number;
    freq: number;
    to?: number;
    dur: number;
    type?: OscillatorType;
    gain?: number;
  },
): void {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(opts.freq, opts.at);
  if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, opts.at + opts.dur);
  const peak = opts.gain ?? 0.5;
  g.gain.setValueAtTime(0.0001, opts.at);
  g.gain.exponentialRampToValueAtTime(peak, opts.at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, opts.at + opts.dur);
  osc.connect(g).connect(out);
  osc.start(opts.at);
  osc.stop(opts.at + opts.dur + 0.02);
}

let noiseBuf: AudioBuffer | null = null;

/** A short band-passed noise burst (dice clacks, build knocks). */
function click(ac: AudioContext, out: AudioNode, at: number, freq: number, gain = 0.6): void {
  if (!noiseBuf || noiseBuf.sampleRate !== ac.sampleRate) {
    const len = Math.floor(ac.sampleRate * 0.05);
    noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
    const data = noiseBuf.getChannelData(0);
    // Deterministic pseudo-noise (xorshift) is plenty for a click.
    let x = 0x9e3779b9;
    for (let i = 0; i < len; i++) {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      data[i] = ((x >>> 0) / 0xffffffff) * 2 - 1;
    }
  }
  const src = ac.createBufferSource();
  src.buffer = noiseBuf;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = 3;
  const g = ac.createGain();
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
  src.connect(bp).connect(g).connect(out);
  src.start(at);
}

const RECIPES: Record<SoundId, (ac: AudioContext, out: AudioNode, t: number) => number> = {
  dice(ac, out, t) {
    const hits = [0, 0.06, 0.1, 0.17, 0.21, 0.3];
    hits.forEach((dt, i) => click(ac, out, t + dt, 1800 + (i % 3) * 700, 0.7 - i * 0.08));
    return 0.4;
  },
  yourTurn(ac, out, t) {
    tone(ac, out, { at: t, freq: 659.25, dur: 0.18, type: 'triangle', gain: 0.45 });
    tone(ac, out, { at: t + 0.14, freq: 987.77, dur: 0.35, type: 'triangle', gain: 0.45 });
    return 0.5;
  },
  build(ac, out, t) {
    click(ac, out, t, 600, 0.8);
    tone(ac, out, { at: t, freq: 190, to: 90, dur: 0.16, type: 'triangle', gain: 0.6 });
    return 0.2;
  },
  gold(ac, out, t) {
    // A bright rising sparkle.
    [1046.5, 1318.5, 1568, 2093].forEach((f, i) =>
      tone(ac, out, { at: t + i * 0.06, freq: f, dur: 0.25, type: 'triangle', gain: 0.25 }),
    );
    return 0.45;
  },
  trade(ac, out, t) {
    tone(ac, out, { at: t, freq: 880, dur: 0.12, gain: 0.35 });
    tone(ac, out, { at: t + 0.1, freq: 1318.5, dur: 0.2, gain: 0.35 });
    return 0.3;
  },
  robber(ac, out, t) {
    tone(ac, out, { at: t, freq: 220, to: 98, dur: 0.6, type: 'sawtooth', gain: 0.18 });
    tone(ac, out, { at: t, freq: 110, to: 55, dur: 0.6, type: 'sine', gain: 0.4 });
    return 0.6;
  },
  gameOver(ac, out, t) {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      tone(ac, out, { at: t + i * 0.13, freq: f, dur: i === 3 ? 0.7 : 0.2, type: 'triangle' }),
    );
    return 1.1;
  },
};

/** Play cues back to back. No-op without WebAudio or before the first user gesture. */
export function playSounds(ids: readonly SoundId[]): void {
  if (ids.length === 0 || useSoundStore.getState().muted) return;
  const a = audio();
  if (!a) return;
  let t = a.ac.currentTime + 0.02;
  for (const id of ids) t += RECIPES[id](a.ac, a.out, t);
}
