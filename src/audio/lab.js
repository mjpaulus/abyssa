// ---------------------------------------------------------------------------
// ABYSSA audio — THE LAB: offline renders and analysis. OWNED BY: audio agent. DEV ONLY
// (window.__audio.lab() imports it; the game never does).
//
// Nobody on the build side can listen, so the mix is measured instead. Each SCENE is a
// scripted state timeline driven through the REAL engine on an OfflineAudioContext:
// suspended every 50 ms, the scene writes state (depth, zone, breath phase, a fake
// sleeper whose animation fields move like the real one's), then frame() and tick()
// run exactly as they do live. So the sleeper edge detectors, the schedulers, the
// director and the ducks are all exercised, not bypassed.
//
//   const lab = await __audio.lab();
//   await lab.analyse('reef')          -> loudness / peak / spectrum / cpu for one scene
//   await lab.masking('velkath')       -> per-group stems, band-by-band overlap
//   await lab.all()                    -> every scene, summary table
//   await lab.play('reef')             -> audition a render through the live context
// Loudness is BS.1770-style: K-weighting (the standard shelf + high-pass), 400 ms blocks
// at 75% overlap, absolute (-70) and relative (-10 LU) gates. "LUFS-ish": the K filter is
// a biquad approximation, within ~0.3 dB of the reference on programme material.
// ---------------------------------------------------------------------------
import * as RUN from './run.js';
import * as SAL from './sal.js';
import * as CRE from './creatures.js';
import * as BED from './bed.js';
import * as SCO from './score.js';

const SR = 48000, STEP = 0.05, TAU = Math.PI * 2;

function V(x, y, z) { return { x, y, z }; }

// ---- scenes -----------------------------------------------------------------------------
// setup(E, W) once; at(E, t, W) every 50 ms before frame/tick.
function breathe(E, t, period = 4.1) { E.in.breathPh = ((t / period) % 1) * TAU; }
function walker(E, t, every, mat, st) { const n = Math.floor(t / every); if (n !== st.n) { st.n = n; if (t > 0.3) { st.side = -(st.side || 1); SAL.step(E, mat, 1, st.side); } } }
function base(E, o) {
  const I = E.in, T = E.T;
  I.state = 'play'; I.px = 0; I.py = o.y; I.pz = 0; I.above = o.y > 0; I.onDeck = !!o.deck; I.grounded = true;
  I.raftX = 0; I.raftY = 0; I.raftZ = o.deck ? -2 : 0;
  I.raftY = o.deck ? 0 : 0;
  T.above = I.above ? 1 : 0; T.depth = Math.max(0, -o.y / 900); T.zone = o.zone || 0; T.wind = o.wind || 0.3; T.rain = o.rain || 0;
  T.day = 1; T.pumpSpd = 1; T.supplied = 1; T.prox = o.prox || 0; T.speed = o.speed || 1.5; T.taut = 0.2; T.torn = 0;
  RUN.setZone(E, T.zone);
  for (const k in T) if (k in E.S && typeof T[k] === 'number') E.S[k] = T[k];
  E.S.zw = [0, 0, 0]; E.S.zw[T.zone] = 1;
  E.setSpace(I.above ? 'deck' : ['reef', 'boiler', 'abyss'][T.zone], 0.01);
}
export const SCENES = {
  deck: {
    secs: 16, what: 'on deck, fair day: wind, lap, slaps, hull, the pump beside him, boots on planks',
    setup(E) { base(E, { y: 1.5, deck: true, wind: 0.35 }); this.w = {}; },
    at(E, t) { breathe(E, t); if (t > 3 && t < 12) walker(E, t, 0.95, 'deck', this.w); }
  },
  storm: {
    secs: 16, what: 'on deck in a gale: rain on timber, gusts, thunder near (3 s) and far (10 s)',
    setup(E) { base(E, { y: 1.5, deck: true, wind: 0.95, rain: 1 }); this.f = 0; },
    at(E, t) { breathe(E, t, 3.2); if (t >= 3 && this.f === 0) { this.f = 1; BED.thunder(E, 120, 60, 1); } if (t >= 10 && this.f === 1) { this.f = 2; BED.thunder(E, 900, -400, 0.8); } }
  },
  descent: {
    secs: 24, what: 'over the side: splash at 2 s, sinking through the shallows to the reef',
    setup(E) { base(E, { y: 1.2, deck: false }); E.in.grounded = false; },
    at(E, t) {
      breathe(E, t, 3.6);
      const y = t < 2 ? 1.2 : -Math.min(200, (t - 2) * 9);
      E.in.py = y; E.in.above = y > 0; E.T.above = E.in.above ? 1 : 0; E.T.depth = Math.max(0, -y / 900); E.in.vy = t < 2.1 ? -5 : -3;
    }
  },
  reef: {
    secs: 20, what: 'zone 0 floor (~200 m): shrimp crackle, water, the pump down the hose, silt boots, fish',
    setup(E, W) { base(E, { y: -70, zone: 0 }); this.w = {}; W.schools = [{ center: V(4, -69, 3), cvel: V(3, 0, 0) }]; },
    at(E, t, W) { breathe(E, t); if (t > 2 && t < 14) walker(E, t, 1.05, 'silt', this.w); W.schools[0].center.x = 6 * Math.cos(t * 0.7); W.schools[0].center.z = 6 * Math.sin(t * 0.7); }
  },
  boiler: {
    secs: 20, what: 'zone 1 (~1300 m): pressure rumble, boiling, two vents roaring (spatial), crust boots',
    setup(E, W) { base(E, { y: -430, zone: 1 }); this.w = {}; W.vents = [{ x: 12, y: -432, z: -6 }, { x: -20, y: -432, z: 14 }, { x: 60, y: -432, z: 60 }]; },
    at(E, t) { breathe(E, t); if (t > 3 && t < 15) walker(E, t, 1.05, 'crust', this.w); if (Math.abs(t - 8) < 0.026) BED.deepKnock(E); }
  },
  abyss: {
    secs: 24, what: 'zone 2 (~2400 m): sub pressure, ringing air, far ticks, a far call, ooze',
    setup(E) { base(E, { y: -800, zone: 2 }); this.w = {}; },
    at(E, t) { breathe(E, t, 4.6); if (t > 4 && t < 12) walker(E, t, 1.2, 'ooze', this.w); if (Math.abs(t - 6) < 0.026) BED.abyssTick(E); if (Math.abs(t - 14) < 0.026) BED.distantCall(E); }
  },
  velkath: {
    secs: 20, what: 'VELKATH: wakes at 1 s, walks (8 feet), rears and hammers every 2.6 s, 20 u away',
    setup(E) {
      base(E, { y: -240, zone: 0, prox: 0.7 });
      const L = { kind: 'brooder', pos: V(0, -240, -20), head: V(0, -236, -14), dormant: false, calmed: false, standE: 0, threatE: 0, hamPh: 0, impT: 9, R: 8,
        feet: Array.from({ length: 8 }, (_, i) => ({ t: -1, h: 0.3, cur: V(Math.cos(i) * 9, -242, -20 + Math.sin(i) * 9) })) };
      this.L = L; E.in.lev = L;
    },
    at(E, t) {
      const L = this.L; breathe(E, t, 2.8); E.in.breathStress = 0.6; E.in.lev = L;
      if (Math.abs(t - 1) < 0.026) CRE.growl(E);
      L.standE = Math.min(1, Math.max(0, (t - 1) / 3));
      if (t > 4 && t < 10) { for (let i = 0; i < 8; i++) { const ph = (t * 0.9 + (i & 1) * 0.5) % 1; L.feet[i].t = ph < 0.45 ? ph / 0.45 : -1; } }
      else for (const f of L.feet) f.t = -1;
      L.threatE = t > 10 ? 1 : 0;
      if (t > 10) { const ph = ((t - 10) % 2.6) / 2.6; if (ph < L.hamPh) L.impT = 9; L.hamPh = ph; if (ph >= 0.9 && L.impT > 3) L.impT = 0; else if (L.impT < 3) L.impT += STEP; }
    }
  },
  orune: {
    secs: 18, what: 'ORUNE: resonant exhales, an arm lashes at 4 s, grabs Sal at 8 s, cut free at 11.5 s',
    setup(E) {
      base(E, { y: -470, zone: 1, prox: 0.6 });
      this.L = { kind: 'hoarder', pos: V(0, -470, -15), dormant: false, calmed: false, brPh: 0, grab: null, arms: Array.from({ length: 8 }, (_, i) => ({ lash: 0, tip: V(Math.cos(i) * 6, -468, -8) })) };
    },
    at(E, t) {
      const L = this.L; E.in.lev = L; breathe(E, t, 3); E.in.breathStress = 0.5;
      L.brPh = (t / 3.5) % 1;
      L.arms[2].lash = t > 4 && t < 5 ? 1 : 0;
      L.grab = t > 8 && t < 11.5 ? { arm: 3, t: 0 } : null;
      if (Math.abs(t - 11.5) < 0.026) SAL.knifeHit(E, 'flesh');
      if (Math.abs(t - 11.28) < 0.026) SAL.knife(E);
    }
  },
  mhor: {
    secs: 20, what: 'MHOR: arrives, circles with click trains and jets, strikes at 9 s (shriek -> dash), stunned at 14 s',
    setup(E) {
      base(E, { y: -760, zone: 2, prox: 0.5 });
      this.L = { kind: 'hunter', pos: V(30, -750, 0), head: V(28, -750, 0), state: 'arrive', stT: 0, contract: 0, dormant: false, calmed: false };
    },
    at(E, t) {
      const L = this.L; E.in.lev = L; breathe(E, t, 2.6); E.in.breathStress = 0.7;
      if (Math.abs(t - 0.5) < 0.026) CRE.growl(E);
      const st = t < 3 ? 'arrive' : t < 9 ? 'circle' : t < 11 ? 'strike' : t < 14 ? 'circle' : 'stunned';
      if (st !== L.state) L.stT = 0; L.state = st; L.stT += STEP;
      const a = t * 0.4; L.pos.x = Math.cos(a) * (st === 'strike' ? 8 : 30); L.pos.z = Math.sin(a) * 30; L.head.x = L.pos.x; L.head.z = L.pos.z;
      L.contract = st === 'strike' && L.stT > 0.9 && L.stT < 1.2 ? 1 : Math.max(0, Math.sin(t * TAU / 1.6));
      E.T.prox = st === 'strike' ? 1 : 0.55;
    }
  },
  suit: {
    secs: 16, what: 'SAL under stress: panting breath, the dress tears (3 s), thruster (6 s), knife (8 s), sonar (10 s), pump dies (12 s)',
    setup(E) { base(E, { y: -120, zone: 0 }); E.in.grounded = false; },
    at(E, t) {
      breathe(E, t, 2.2); E.in.breathStress = 0.85;
      E.T.torn = t > 3 ? 20 : 0;
      if (Math.abs(t - 6) < 0.026) SAL.airVent(E, 1);
      if (Math.abs(t - 8) < 0.026) SAL.knife(E);
      if (Math.abs(t - 10) < 0.026) SAL.sonar(E, new Float32Array([20, -110, 30, 1, -40, -118, 10, 2]));
      E.T.pumpSpd = t > 12 ? 0 : 1; E.T.supplied = t > 12 ? 0 : 1;
    }
  },
  score: {
    secs: 30, what: 'THE SCORE: an ambient phrase (1 s), a ward lit (9 s), the calm swell (14 s), a wake sting (24 s)',
    setup(E) { base(E, { y: -200, zone: 0 }); E.score.next = E.now() + 1; },
    at(E, t) {
      breathe(E, t);
      if (Math.abs(t - 9) < 0.026) { SCO.chime(E, 440, 2, 0.3, 'ward'); E.score.ward(2, 3); }
      if (Math.abs(t - 14) < 0.026) { SCO.chime(E, 262, 3, 0.3, 'calm'); SCO.chime(E, 330, 3, 0.25, 'calm'); SCO.chime(E, 392, 3, 0.25, 'calm'); E.score.restUntil = 0; E.score.calm(); }
      if (Math.abs(t - 24) < 0.026) { E.score.restUntil = 0; E.score.next = 0; E.score.sting('hoarder'); }
    }
  }
};

// ---- render --------------------------------------------------------------------------------
export async function render(name, opt = {}) {
  const sc = SCENES[name]; if (!sc) throw new Error('no scene ' + name + ' — ' + Object.keys(SCENES).join(','));
  const secs = opt.secs || sc.secs;
  const ctx = new OfflineAudioContext(2, Math.floor(SR * secs), SR);
  const E = RUN.assemble(ctx, { offline: true, seed: opt.seed || 0xAB155A, hrtf: opt.hrtf !== false });
  await E.texReady;
  const W = { MV: null, moverLive: null, schools: null, vents: null };
  if (opt.solo) for (const g in E.G) { const v = g === opt.solo ? 1 : 0; E.G[g].trim.gain.value = v; E.G[g].emWet.gain.value = v; }
  sc.setup(E, W);
  // the pump beside/above him and the listener facing -Z
  RUN.frame(E, STEP, W); RUN.tick(E, STEP);
  let n = 0;
  for (let t = STEP; t < secs - 0.01; t += STEP) {
    const tt = Math.round(t / STEP) * STEP;
    ctx.suspend(tt).then(() => {
      try { sc.at(E, tt, W); RUN.frame(E, STEP, W); RUN.tick(E, STEP); }
      catch (e) { console.error('lab scene threw at', tt, e); }
      n++; ctx.resume();
    });
  }
  const t0 = performance.now();
  const buf = await ctx.startRendering();
  const ms = performance.now() - t0;
  return { buf, ms, secs, log: E.LOG.slice(), peakLive: E.live };
}

// ---- analysis -------------------------------------------------------------------------------
async function kWeight(buf) {
  const ctx = new OfflineAudioContext(buf.numberOfChannels, buf.length, buf.sampleRate);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const sh = ctx.createBiquadFilter(); sh.type = 'highshelf'; sh.frequency.value = 1681.97; sh.gain.value = 3.999;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 38.13; hp.Q.value = 0.5003;
  src.connect(sh); sh.connect(hp); hp.connect(ctx.destination); src.start();
  return ctx.startRendering();
}
export async function loudness(buf) {
  const k = await kWeight(buf), sr = k.sampleRate, blk = Math.floor(sr * 0.4), hop = Math.floor(blk / 4);
  const ch = []; for (let c = 0; c < k.numberOfChannels; c++) ch.push(k.getChannelData(c));
  const L = [];
  for (let s = 0; s + blk <= k.length; s += hop) {
    let z = 0; for (const d of ch) { let a = 0; for (let i = s; i < s + blk; i++) a += d[i] * d[i]; z += a / blk; }
    L.push(z);
  }
  const lk = z => -0.691 + 10 * Math.log10(z + 1e-20);
  const abs = L.filter(z => lk(z) > -70);
  const m1 = abs.reduce((a, b) => a + b, 0) / Math.max(1, abs.length);
  const rel = abs.filter(z => lk(z) > lk(m1) - 10);
  const I = lk(rel.reduce((a, b) => a + b, 0) / Math.max(1, rel.length));
  // short-term (3 s) max and momentary max
  let stMax = -99, mMax = -99;
  const per3 = Math.round(3 / 0.1);
  for (let i = 0; i < L.length; i++) {
    mMax = Math.max(mMax, lk(L[i]));
    if (i + per3 <= L.length) { let a = 0; for (let j = i; j < i + per3; j++) a += L[j]; stMax = Math.max(stMax, lk(a / per3)); }
  }
  // LRA-ish: spread of short-term values (10th..95th percentile)
  const st = []; for (let i = 0; i + per3 <= L.length; i += 3) { let a = 0; for (let j = i; j < i + per3; j++) a += L[j]; const v = lk(a / per3); if (v > -70) st.push(v); }
  st.sort((a, b) => a - b);
  const lra = st.length > 4 ? st[Math.floor(st.length * 0.95) - 1] - st[Math.floor(st.length * 0.1)] : 0;
  return { I: +I.toFixed(1), Smax: +stMax.toFixed(1), Mmax: +mMax.toFixed(1), LRA: +lra.toFixed(1) };
}
export function peaks(buf) {
  let pk = 0, clip = 0, sq = 0, n = 0, dc = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > pk) pk = a; if (a >= 0.999) clip++; sq += d[i] * d[i]; dc += d[i]; n++; }
  }
  const rms = Math.sqrt(sq / n);
  return { peakDb: +(20 * Math.log10(pk + 1e-12)).toFixed(2), rmsDb: +(20 * Math.log10(rms + 1e-12)).toFixed(1), crestDb: +(20 * Math.log10(pk / (rms + 1e-12))).toFixed(1), clips: clip, dc: +(dc / n).toFixed(5) };
}
// iterative radix-2 FFT, in place
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const ur = re[i + j], ui = im[i + j], vr = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci, vi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
        re[i + j] = ur + vr; im[i + j] = ui + vi; re[i + j + len / 2] = ur - vr; im[i + j + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}
export const BANDS = [20, 45, 90, 180, 355, 710, 1400, 2800, 5600, 11200, 20000];
export function spectrum(buf) {
  const N = 8192, d0 = buf.getChannelData(0), d1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : d0;
  const acc = new Float64Array(N / 2), re = new Float64Array(N), im = new Float64Array(N);
  let w = 0;
  for (let s = 0; s + N <= buf.length; s += N) {
    for (let i = 0; i < N; i++) { const h = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)); re[i] = 0.5 * (d0[s + i] + d1[s + i]) * h; im[i] = 0; }
    fft(re, im);
    for (let i = 0; i < N / 2; i++) acc[i] += re[i] * re[i] + im[i] * im[i];
    w++;
  }
  const bands = [];
  for (let b = 0; b < BANDS.length - 1; b++) {
    let e = 0; const i0 = Math.floor(BANDS[b] / buf.sampleRate * N), i1 = Math.floor(BANDS[b + 1] / buf.sampleRate * N);
    for (let i = i0; i < i1 && i < N / 2; i++) e += acc[i];
    bands.push(+(10 * Math.log10(e / Math.max(1, w) / (N * N) * 8 + 1e-20)).toFixed(1));
  }
  // spectral centroid
  let num = 0, den = 0; for (let i = 1; i < N / 2; i++) { num += acc[i] * i * buf.sampleRate / N; den += acc[i]; }
  return { bands, centroid: Math.round(num / (den || 1)) };
}

export async function analyse(name, opt = {}) {
  const r = await render(name, opt);
  const out = { scene: name, what: SCENES[name].what, secs: r.secs, renderMs: Math.round(r.ms), rtFactor: +(r.secs * 1000 / r.ms).toFixed(1), ...peaks(r.buf), ...(await loudness(r.buf)), ...spectrum(r.buf), events: r.log.map(e => e.name + (e.kind ? ':' + e.kind : '')).filter((v, i, a) => a.indexOf(v) === i).join(' ') };
  if (opt.keep) out.buf = r.buf;
  return out;
}
// Per-group stems of one scene: which group owns which band, and where two groups sit
// within 4 dB of each other with both above -55 dB (the masking candidates).
export async function masking(name) {
  const groups = ['amb', 'sfx', 'cre', 'suit', 'mus'], res = {};
  for (const g of groups) { const r = await render(name, { solo: g }); const p = peaks(r.buf); res[g] = { rmsDb: p.rmsDb, peakDb: p.peakDb, bands: spectrum(r.buf).bands, L: (await loudness(r.buf)).I }; }
  const flags = [];
  for (let b = 0; b < BANDS.length - 1; b++) {
    const row = groups.map(g => [g, res[g].bands[b]]).filter(x => x[1] > -55).sort((a, c) => c[1] - a[1]);
    if (row.length >= 2 && row[0][1] - row[1][1] < 4) flags.push(`${BANDS[b]}-${BANDS[b + 1]} Hz: ${row[0][0]} ${row[0][1]} vs ${row[1][0]} ${row[1][1]} dB`);
  }
  return { scene: name, groups: res, masking: flags };
}
export async function all(names = Object.keys(SCENES)) {
  const rows = [];
  for (const n of names) { const a = await analyse(n); rows.push(a); }
  return rows;
}
// audition a render through the live context (for the curious)
export async function play(name) {
  const r = await render(name);
  const ctx = window.__audio && window.__audio.ctx();
  if (!ctx) return 'no live context: click into the game first';
  const s = ctx.createBufferSource(); s.buffer = r.buf; s.connect(ctx.destination); s.start();
  return r.secs;
}
// WAV export, for listening outside the game
export async function wav(name) {
  const r = await render(name), b = r.buf, n = b.length, ab = new ArrayBuffer(44 + n * 4), v = new DataView(ab);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, SR, true); v.setUint32(28, SR * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 4, true);
  const L = b.getChannelData(0), R = b.getChannelData(1);
  for (let i = 0; i < n; i++) { v.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true); v.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true); }
  return URL.createObjectURL(new Blob([ab], { type: 'audio/wav' }));
}
