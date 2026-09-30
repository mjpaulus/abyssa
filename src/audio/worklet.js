// ---------------------------------------------------------------------------
// ABYSSA audio — the granular texture generator. OWNED BY: audio agent.
//
// One AudioWorkletProcessor, three grain grammars. It runs on the audio thread and
// never repeats: every grain is drawn from a seeded xorshift stream, so a reef heard
// for an hour is an hour of different clicks, not a 9-second loop.
//   mode 0 CRACKLE  snapping shrimp: sub-millisecond broadband snaps, Pareto-tailed
//                   amplitudes (most faint, a few sharp), a per-grain one-pole lowpass
//                   so some snaps are near and bright and most are far and dull.
//   mode 1 BUBBLE   Minnaert bubbles: a damped sine whose pitch RISES as it rings
//                   (the real signature of a bubble detaching), 15-90 ms.
//   mode 2 RAIN     drops on timber / canvas / water: a tick plus a short bright ring.
//   mode 3 FRICTION stick-slip: dense jittered impulses, the raw material the caller
//                   runs through resonant filters for chitin, rope, rubber, rock.
// AudioParams (k-rate): rate (grains/s), level, fLo, fHi (Hz range for rings), bright
// (0..1 near/far balance), jitter (0..1 how irregular the stream is).
// The density itself wanders (a slow random walk) so the texture breathes.
//
// The source is shipped as a string and loaded through a Blob URL: the project has
// no build step and the rule is that every sound is authored in code.
// ---------------------------------------------------------------------------

export const TEXTURE_SRC = `
const MAXG = 64;
class AbyssaTexture extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rate', defaultValue: 20, minValue: 0, maxValue: 4000, automationRate: 'k-rate' },
      { name: 'level', defaultValue: 0, minValue: 0, maxValue: 4, automationRate: 'k-rate' },
      { name: 'fLo', defaultValue: 300, minValue: 20, maxValue: 12000, automationRate: 'k-rate' },
      { name: 'fHi', defaultValue: 900, minValue: 20, maxValue: 16000, automationRate: 'k-rate' },
      { name: 'bright', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'jitter', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' }
    ];
  }
  constructor(opt) {
    super();
    const o = (opt && opt.processorOptions) || {};
    this.mode = o.mode | 0;
    this.s = (o.seed >>> 0) || 0x9E3779B9;
    this.walk = 0.5; this.walkV = 0;
    this.acc = 0;
    // grain pool, structure-of-arrays, allocated once
    this.age = new Float32Array(MAXG); this.len = new Float32Array(MAXG);
    this.amp = new Float32Array(MAXG); this.panL = new Float32Array(MAXG); this.panR = new Float32Array(MAXG);
    this.ph = new Float32Array(MAXG); this.f = new Float32Array(MAXG); this.df = new Float32Array(MAXG);
    this.lp = new Float32Array(MAXG); this.z = new Float32Array(MAXG); this.dec = new Float32Array(MAXG);
    this.on = new Uint8Array(MAXG);
    this.sr = sampleRate;
  }
  r() { let x = this.s; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.s = x >>> 0; return this.s / 4294967296; }
  spawn(fLo, fHi, bright) {
    let i = -1;
    for (let k = 0; k < MAXG; k++) if (!this.on[k]) { i = k; break; }
    if (i < 0) return;
    const sr = this.sr, m = this.mode;
    this.on[i] = 1; this.age[i] = 0; this.z[i] = 0; this.ph[i] = 0;
    const p = this.r() * 2 - 1, a = Math.PI * 0.25 * (p + 1);
    this.panL[i] = Math.cos(a); this.panR[i] = Math.sin(a);
    if (m === 0) {
      // Pareto tail: amplitude = u^-1/alpha, clipped. Most snaps are small.
      const u = 0.02 + 0.98 * this.r();
      this.amp[i] = Math.min(1, 0.06 * Math.pow(u, -0.7));
      const near = this.r() < bright * 0.5;
      this.dec[i] = Math.exp(-1 / (sr * (near ? 0.00025 + 0.0004 * this.r() : 0.0006 + 0.0012 * this.r())));
      this.lp[i] = near ? 0.85 + 0.15 * this.r() : 0.12 + 0.35 * this.r();
      this.len[i] = sr * 0.012;
      this.f[i] = 0;
    } else if (m === 1) {
      const f0 = fLo * Math.pow(fHi / fLo, this.r());
      const dur = 0.015 + 0.075 * this.r() * (600 / Math.max(200, f0));
      this.f[i] = f0 * 2 * Math.PI / sr;
      this.df[i] = Math.pow(1.6 + this.r() * 0.9, 1 / (dur * sr));     // pitch rises ~2x over the ring
      this.dec[i] = Math.exp(-4.6 / (dur * sr));
      this.amp[i] = 0.15 + 0.85 * Math.pow(this.r(), 2);
      this.len[i] = dur * sr * 1.2;
      this.lp[i] = 0;
    } else if (m === 2) {
      const f0 = fLo * Math.pow(fHi / fLo, this.r());
      const dur = 0.006 + 0.03 * this.r();
      this.f[i] = f0 * 2 * Math.PI / sr; this.df[i] = 1;
      this.dec[i] = Math.exp(-4.6 / (dur * sr));
      this.amp[i] = 0.1 + 0.9 * Math.pow(this.r(), 3);
      this.len[i] = dur * sr * 1.3;
      this.lp[i] = 0.3 + 0.6 * bright;
    } else {
      this.amp[i] = 0.4 + 0.6 * this.r();
      this.dec[i] = Math.exp(-1 / (sr * (0.0003 + 0.0008 * this.r())));
      this.len[i] = sr * 0.006; this.f[i] = 0; this.lp[i] = 0.6 + 0.4 * bright;
    }
  }
  process(inputs, outputs, P) {
    const out = outputs[0], L = out[0], R = out[1] || out[0], n = L.length;
    const rate = P.rate[0], level = P.level[0], fLo = P.fLo[0], fHi = P.fHi[0], bright = P.bright[0], jit = P.jitter[0];
    // density wander: a damped random walk around 1, ~10 s correlation
    this.walkV = this.walkV * 0.995 + (this.r() - 0.5) * 0.004 + (0.5 - this.walk) * 0.0006;
    this.walk = Math.min(1, Math.max(0, this.walk + this.walkV));
    const dens = rate * (0.35 + 1.3 * this.walk * jit + (1 - jit) * 0.65);
    const pPer = dens / this.sr;
    for (let s = 0; s < n; s++) { L[s] = 0; if (R !== L) R[s] = 0; }
    if (level <= 0.00001) return true;
    for (let s = 0; s < n; s++) {
      if (jit >= 0.999) { if (this.r() < pPer) this.spawn(fLo, fHi, bright); }
      else { this.acc += pPer * (1 + (this.r() - 0.5) * 2 * jit); if (this.acc >= 1) { this.acc -= 1; this.spawn(fLo, fHi, bright); } }
    }
    const m = this.mode;
    for (let i = 0; i < MAXG; i++) {
      if (!this.on[i]) continue;
      let a = this.amp[i] * level, z = this.z[i], ph = this.ph[i], f = this.f[i];
      const dec = this.dec[i], lp = this.lp[i], pl = this.panL[i], pr = this.panR[i], df = this.df[i];
      let age = this.age[i];
      const len = this.len[i];
      for (let s = 0; s < n && age < len; s++, age++) {
        let v;
        if (m === 0 || m === 3) { v = (this.r() * 2 - 1) * a; z += lp * (v - z); v = z; }
        else if (m === 1) { v = Math.sin(ph) * a; ph += f; f *= df; }
        else { const tick = age < 24 ? (this.r() * 2 - 1) * (1 - age / 24) : 0; v = (Math.sin(ph) * 0.6 + tick * lp) * a; ph += f; }
        a *= dec;
        L[s] += v * pl; R[s] += v * pr;
      }
      this.age[i] = age; this.z[i] = z; this.ph[i] = ph; this.f[i] = f;
      if (age >= len) this.on[i] = 0;
    }
    return true;
  }
}
registerProcessor('abyssa-texture', AbyssaTexture);
`;

// Load once per context. Returns true when the processor is registered.
const loaded = new WeakMap();
export function loadTexture(ctx) {
  if (loaded.has(ctx)) return loaded.get(ctx);
  let p;
  if (!ctx.audioWorklet) p = Promise.resolve(false);
  else {
    const url = URL.createObjectURL(new Blob([TEXTURE_SRC], { type: 'application/javascript' }));
    p = ctx.audioWorklet.addModule(url).then(() => true, e => { console.warn('ABYSSA audio: worklet unavailable, textures fall back to buffers', e); return false; });
  }
  loaded.set(ctx, p);
  return p;
}
