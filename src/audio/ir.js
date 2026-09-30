// ---------------------------------------------------------------------------
// ABYSSA audio — generated impulse responses. OWNED BY: audio agent.
//
// No recorded rooms: each space is a decaying noise field split into three bands with
// their OWN decay times (real rooms lose their top end first; water loses it fastest),
// plus the features that make a place a place:
//   early   discrete first reflections (the deck planking, the surface overhead)
//   modes   ringing resonances (the helmet's copper cavity, the chimneys' throats)
//   echoes  late discrete returns (the abyss's far cliffs answering a second later)
// Energy is normalised per channel so a send level means the same thing in every space.
// Decorrelated L/R (independent streams) gives width without a stereo trick.
// ---------------------------------------------------------------------------

// Seeded stream so the same session always hears the same rooms (and offline renders
// are reproducible).
export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The four spaces and the helmet. rt = [low, mid, high] seconds to -60 dB; x = band
// crossovers; pre = pre-delay; er = [time, gain]; modes = [freq, gain, rt];
// echoes = [time, gain, lowpass01]; tone = final one-pole lowpass (0..1, 1 = open).
export const SPACES = {
  // Open deck: air, timber underfoot, nothing overhead. Short, a little bright, the
  // hull and bulwark give a handful of close slaps. Mostly it is the absence of a room.
  deck: {
    dur: 1.2, rt: [0.9, 0.55, 0.3], x: [300, 3000], pre: 0.004, tone: 0.9,
    er: [[0.0031, 0.55], [0.0067, 0.4], [0.0109, 0.32], [0.0172, 0.22], [0.029, 0.12]],
    modes: [], echoes: [[0.21, 0.05, 0.35]]
  },
  // The shallow reef: water carries sound four times faster, so reflections crowd in;
  // the surface overhead is a strong, inverted mirror; the sand floor soaks the top.
  reef: {
    dur: 2.8, rt: [2.4, 1.6, 0.55], x: [250, 2200], pre: 0.009, tone: 0.6,
    er: [[0.011, -0.6], [0.019, 0.35], [0.027, -0.3], [0.041, 0.25], [0.063, 0.15], [0.089, -0.12]],
    modes: [], echoes: []
  },
  // The boiler room: black-smoker chimneys, hard mineral crust, hot water — a
  // resonant, metallic, rumbling room with its own throat notes.
  boiler: {
    dur: 3.8, rt: [3.4, 2.1, 0.7], x: [200, 1800], pre: 0.014, tone: 0.5,
    er: [[0.017, 0.45], [0.029, -0.38], [0.043, 0.3], [0.061, 0.26], [0.097, -0.18], [0.14, 0.12]],
    modes: [[118, 0.009, 2.2], [183, 0.008, 1.9], [311, 0.006, 1.5], [467, 0.005, 1.1], [742, 0.004, 0.8]],
    echoes: [[0.38, 0.1, 0.3], [0.71, 0.06, 0.2]]
  },
  // The abyss: no near surfaces at all. A long, very dark tail and the far walls
  // answering late — a room you cannot see the edges of.
  abyss: {
    dur: 7.5, rt: [5.5, 3.6, 0.9], x: [160, 1100], hp: 70, pre: 0.03, tone: 0.28,
    er: [[0.06, 0.12], [0.11, -0.08]],
    modes: [],
    echoes: [[0.63, 0.22, 0.2], [1.31, 0.16, 0.14], [2.37, 0.11, 0.1], [3.9, 0.06, 0.08]]
  },
  // Inside the copper: a 0.35 m cavity and a glass faceplate. Short and very coloured —
  // this is what makes a breath sound like it is in your head AND in a helmet.
  helmet: {
    dur: 0.26, rt: [0.14, 0.11, 0.06], x: [400, 3500], pre: 0.0006, tone: 0.8,
    er: [[0.0011, 0.7], [0.0019, -0.5], [0.0026, 0.35], [0.0034, -0.25]],
    modes: [[488, 0.09, 0.16], [731, 0.06, 0.13], [1154, 0.05, 0.1], [1612, 0.035, 0.08], [2410, 0.025, 0.06]],
    echoes: []
  }
};

const LN1000 = 6.907755;

export function makeIR(ctx, spec, seed = 1) {
  const sr = ctx.sampleRate, n = Math.max(64, Math.floor(sr * spec.dur));
  const buf = ctx.createBuffer(2, n, sr);
  const aLo = 1 - Math.exp(-2 * Math.PI * spec.x[0] / sr);
  const aHi = 1 - Math.exp(-2 * Math.PI * spec.x[1] / sr);
  const kLo = LN1000 / (spec.rt[0] * sr), kMid = LN1000 / (spec.rt[1] * sr), kHi = LN1000 / (spec.rt[2] * sr);
  const pre = Math.floor(spec.pre * sr);
  for (let c = 0; c < 2; c++) {
    const rnd = mulberry(seed * 7919 + c * 104729 + 17);
    const d = buf.getChannelData(c);
    let lo = 0, mh = 0, tone = 0;
    const toneA = spec.tone;
    for (let i = 0; i < n; i++) {
      const w = rnd() * 2 - 1;
      lo += aLo * (w - lo);
      const rest = w - lo;
      mh += aHi * (rest - mh);
      const hi = rest - mh;
      const j = i - pre;
      let v = 0;
      if (j >= 0) {
        // late field onset: density builds over the first ~40 ms rather than a wall of noise
        const onset = Math.min(1, j / (sr * 0.04));
        v = (lo * Math.exp(-kLo * j) + mh * Math.exp(-kMid * j) + hi * Math.exp(-kHi * j)) * onset * 0.8;
      }
      tone += toneA * (v - tone);
      d[i] = tone;
    }
    // early reflections: 1 ms smeared bursts (a real surface is not a perfect mirror)
    for (const [t, g] of spec.er) {
      const i0 = Math.floor((t + (c ? 0.0007 : 0) * (rnd() + 0.5)) * sr);
      const w = Math.max(2, Math.floor(sr * 0.0012));
      for (let k = 0; k < w && i0 + k < n; k++) d[i0 + k] += g * (1 - k / w) * (rnd() * 0.6 + 0.7) * 1.6;
    }
    // modes: decaying sines, random phase per channel
    for (const [f, g, rt] of spec.modes) {
      const w = 2 * Math.PI * f / sr, ph = rnd() * 6.283, kk = LN1000 / (rt * sr);
      for (let i = pre; i < n; i++) d[i] += g * Math.sin(w * i + ph) * Math.exp(-kk * (i - pre)) * 8;
    }
    // late discrete echoes: a band-limited burst, smeared over ~30 ms
    for (const [t, g, lp] of spec.echoes) {
      const i0 = Math.floor((t * (c ? 1.013 : 1)) * sr), w = Math.floor(sr * 0.03);
      let z = 0;
      for (let k = 0; k < w * 3 && i0 + k < n; k++) {
        const env = k < w ? k / w : Math.exp(-(k - w) / (w * 0.6));
        z += lp * ((rnd() * 2 - 1) - z);
        d[i0 + k] += g * z * env * 3;
      }
    }
    // high-pass the whole response (two one-poles): a reverb's sub is boom, not space
    { const hpA = Math.exp(-2 * Math.PI * (spec.hp || 55) / sr); let x1 = 0, y1 = 0, x2 = 0, y2 = 0;
      for (let i = 0; i < n; i++) { const x = d[i]; y1 = hpA * (y1 + x - x1); x1 = x; const y = hpA * (y2 + y1 - x2); x2 = y1; y2 = y; d[i] = y; } }
    let sum = 0;
    for (let i = 0; i < n; i++) sum += d[i] * d[i];
    const g = 1 / Math.sqrt(sum || 1);
    for (let i = 0; i < n; i++) d[i] *= g;
    // a short fade at the very end so a truncated tail never clicks
    const f = Math.min(n, Math.floor(sr * 0.02));
    for (let i = 0; i < f; i++) d[n - 1 - i] *= i / f;
  }
  return buf;
}
