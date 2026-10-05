// ---------------------------------------------------------------------------
// ABYSSA audio — the engine. OWNED BY: audio agent.
//
// createEngine(ctx) builds the whole mix on ANY BaseAudioContext — the live
// AudioContext, or an OfflineAudioContext for the analysis renders (audio/lab.js).
// Nothing in here reads the game: the facade (src/audio.js) fills `E.in` every frame
// and the engine turns state into sound. Time is the AUDIO clock only: every ambient
// scheduler is a "next fire at t" field checked by tick(), never a setTimeout, so an
// offline render suspended every 50 ms plays exactly what the game would.
//
// SIGNAL FLOW
//   voices ─► named bus (bed/deck/events/pump/lev/helmet/chime/…) ─► GROUP
//   GROUPS  AMB (beds)  SFX (world one-shots)  CRE (creatures)  SUIT (Sal)  MUS (score)
//     each: in ─► duckC (continuous sidechain) ─► duckE (event ducks) ─► trim ─► out
//                                                                        └► send ─► space reverb
//   AMB+SFX+CRE+reverb return ─► MEDIUM (low-pass + pressure shelf + presence dip,
//                                        deepening with depth; flat in air) ─► mix
//   SUIT ─► helmet EQ ─► mix,  SUIT ─► helmet convolver (0.26 s copper cavity) ─► mix
//   MUS ─► mix
//   mix ─► master (mute/pause fade) ─► glue compressor ─► limiter ─► out trim ─► dest
//   SPACE REVERB: two convolver slots A/B, crossfaded when the space changes
//     (deck / reef / boiler / abyss); a slot's buffer is only swapped while silent.
//   EMITTERS: pooled HRTF PannerNodes. Distance gain, distance low-pass and a
//     distance-dependent wet send are computed here (the panner does direction only),
//     and underwater the image NARROWS (sound travels 4.3x faster in water, so the ear's
//     time cues collapse — divers really cannot place sounds well).
// ---------------------------------------------------------------------------
import { makeIR, irData, SPACES, mulberry } from './ir.js';
import { loadTexture } from './worklet.js';

export const K = {
  MASTER: 0.62, OUT_TRIM: 0.95,
  GLUE: { thr: -20, ratio: 2.2, knee: 10, atk: 0.025, rel: 0.3 },
  LIM: { thr: -2.5, ratio: 20, knee: 0, atk: 0.002, rel: 0.12 },
  // group trims
  G: { amb: 1, sfx: 1, cre: 1, suit: 1, mus: 1 },
  // group reverb sends (emitters add their own distance-driven wet on top)
  SEND: { amb: 0.35, sfx: 0.3, cre: 0.25, suit: 0.0, mus: 0.55 },
  REV: 0.5,               // space reverb return
  HELM_WET: 0.32,         // helmet-cavity convolver return
  // sidechain
  DUCK_BREATH: 0.22,      // how far the bed dips under a full exhale
  DUCK_THREAT: 0.35,      // how far the bed sinks with the threat level
  // emitters
  EM_REF: 8, EM_ROLL: 0.6, EM_WIDTH_WATER: 0.55,
  // startle scale (reduced motion multiplies impacts and stingers by this)
  STARTLE_RM: 0.6,
  // voice cap
  LIVE_MAX: 150
};


// ---- PREBAKE (roadmap/loading-and-hitches.md) ---------------------------------------
// The engine's heavy DSP is its noise colours and its five room responses, all pure on the
// context's sample rate. The click used to compute them inside initAudio (~170 ms on the
// first play frame). The loader calls prebakeAudio() at the rates a context is likely to
// open at; a context at another rate simply computes on demand, as before.
const NOISE = new Map();
function noiseData(kind, secs, sr) {
  const key = kind + '|' + secs + '|' + sr;
  let got = NOISE.get(key);
  if (got) return got;
  const n = Math.floor(sr * secs), ch = [new Float32Array(n), new Float32Array(n)];
  for (let c = 0; c < 2; c++) {
    const d = ch[c], r = mulberry(0xA11CE + c * 977 + secs * 31);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0;
    for (let i = 0; i < n; i++) {
      const w = r() * 2 - 1;
      if (kind === 'white') d[i] = w * 0.7;
      else if (kind === 'pink') {       // Kellet's economy filter
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
      } else { br = (br + 0.02 * w) / 1.02; d[i] = br * 3.2; }
    }
    // crossfade the loop seam so a loop point is never a click
    const f = Math.floor(sr * 0.05);
    for (let i = 0; i < f; i++) { const k = i / f; d[n - f + i] = d[n - f + i] * (1 - k) + d[i] * k; }
    for (let i = 0; i < f; i++) d[i] = d[n - f + i];
  }
  NOISE.set(key, ch);
  return ch;
}
// Every buffer a live context at `sr` will ask for (createEngine's seeds: opt.seed unset).
export function prebakeAudio(sr) {
  noiseData('white', 6.1, sr); noiseData('pink', 7.3, sr); noiseData('brown', 8.9, sr);
  const irSeed = 7;
  for (const k of ['deck', 'reef', 'boiler', 'abyss', 'helmet']) irData(sr, SPACES[k], irSeed + k.length * 131);
}

const cl01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
export const mix = (a, b, t) => a + (b - a) * t;
export { cl01 };

export function createEngine(ctx, opt = {}) {
  const E = {
    ctx, K, offline: !!opt.offline,
    rng: mulberry(opt.seed || ((Math.random() * 4294967296) >>> 0)),
    live: 0, startle: 1, hrtf: opt.hrtf !== false,
    LOG: [], trace: false,
    // Targets (written by the facade) and smoothed values.
    T: { depth: 0, above: 1, zone: 0, prox: 0, calm: 0, speed: 0, wind: 0, rain: 0, day: 1, light: 1, air: 1,
      pumpSpd: 1, supplied: 1, taut: 0, strain: 0, torn: 0, rite: 0 },
    S: { depth: 0, above: 1, zone: 0, prox: 0, calm: 0, speed: 0, wind: 0, rain: 0, day: 1, light: 1, air: 1,
      pumpSpd: 1, supplied: 1, taut: 0, strain: 0, torn: 0, rite: 0, zw: [1, 0, 0] },
    // per-frame input (the facade fills this in place: no allocation)
    in: {
      px: 0, py: 1.5, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1, vx: 0, vy: 0, vz: 0,
      grounded: true, onDeck: true, above: true, state: 'title',
      breathPh: 0, breathStress: 0, raftX: 0, raftY: 0, raftZ: 0,
      lev: null, ev: null, threat: 0, bolt: null
    },
    next: {}, lastV: new Map(), B: {}, G: {}
  };
  const R = E.rng;
  E.r = (a, b) => a + R() * (b - a);
  E.now = () => ctx.currentTime;
  E.log = (name, kind, f) => {
    if (E.LOG.length >= 128) E.LOG.shift();
    E.LOG.push({ t: +ctx.currentTime.toFixed(3), name, kind: kind || null, f: f == null ? null : +(+f).toFixed(1) });
    if (E.trace) console.log('[audio]', name, kind || '', f == null ? '' : f);
  };

  // ---- node factories ------------------------------------------------------
  E.g = (v, dest) => { const g = ctx.createGain(); g.gain.value = v; if (dest) g.connect(dest); return g; };
  E.f = (type, fr, q, dest) => {
    const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = fr;
    if (q != null) b.Q.value = q; if (dest) b.connect(dest); return b;
  };
  E.o = (type, fr, dest) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = fr; if (dest) o.connect(dest); return o; };
  E.pan = (p, dest) => { const s = ctx.createStereoPanner(); s.pan.value = p; if (dest) s.connect(dest); return s; };
  // looped noise from one of the pre-generated colours, at a random offset
  E.n = (kind, rate, dest) => {
    const s = ctx.createBufferSource(); s.buffer = E.noise[kind || 'white']; s.loop = true;
    s.playbackRate.value = rate || 1; if (dest) s.connect(dest); s._off = R() * s.buffer.duration; return s;
  };
  // start a looping bed source forever
  E.loop = (src, t0) => { src.start(t0 || ctx.currentTime, src._off || 0); return src; };
  // one-shot lifetime: start/stop and drop the chain afterwards
  E.fire = (src, t0, t1, chain) => {
    if (src._off !== undefined) src.start(t0, src._off); else src.start(t0);
    src.stop(t1); E.live++;
    src.onended = () => { E.live--; src.disconnect(); if (chain) for (const n of chain) n.disconnect(); };
    return src;
  };
  // attack then exponential fall to silence
  E.env = (p, t0, atk, dur, peak) => {
    p.setValueAtTime(0.0001, t0);
    p.linearRampToValueAtTime(Math.max(0.0001, peak), t0 + atk);
    p.exponentialRampToValueAtTime(0.0001, t0 + Math.max(dur, atk + 0.02));
  };
  // attack, hold, release (linear), for swells
  E.ahr = (p, t0, atk, hold, rel, peak) => {
    p.setValueAtTime(0, t0);
    p.linearRampToValueAtTime(peak, t0 + atk);
    p.setValueAtTime(peak, t0 + atk + hold);
    p.linearRampToValueAtTime(0, t0 + atk + hold + rel);
  };
  // de-duplicated param target (the mix writes ~60 params 20x a second; most don't move)
  E.ramp = (key, p, v, tc = 0.25) => {
    const prev = E.lastV.get(key);
    if (prev !== undefined && Math.abs(prev - v) <= Math.max(1e-5, Math.abs(v) * 0.01)) return;
    E.lastV.set(key, v); p.setTargetAtTime(v, ctx.currentTime, tc);
  };
  // SLEEP GATE: a layer whose gain has sat at ~0 for 4 s is DISCONNECTED from its
  // destination, and Chrome stops pulling everything upstream of it (the noise loops,
  // LFOs, filters, worklets of a zone you are not in cost nothing). It reconnects
  // before its gain rises, while the gain is still ~0, so the seam is silent.
  E.gates = new Map();
  E.gate = (key, node, dest, v, tc = 0.25) => {
    let g = E.gates.get(key);
    if (!g) { g = { on: true, zeroAt: -1, node, dest }; E.gates.set(key, g); }
    const t = ctx.currentTime, quiet = v < 2e-4;
    if (!quiet) { if (!g.on) { node.connect(dest); g.on = true; } g.zeroAt = -1; }
    else if (g.on) { if (g.zeroAt < 0) g.zeroAt = t; else if (t - g.zeroAt > 4 && node.gain.value < 2e-4) { node.disconnect(dest); g.on = false; } }
    E.ramp(key, node.gain, quiet ? 0.0001 : v, tc);
  };
  E.hold = (p, t) => { p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); };
  E.full = () => E.live > K.LIVE_MAX;
  // A permanent modulator welded to a param (never point one at a param the mix ramps).
  E.lfo = (rate, depth, param, type = 'sine') => {
    const o = E.o(type, rate), g = E.g(depth, param); o.connect(g); o.start(ctx.currentTime + R() * 4); return o;
  };
  // A temporary modulator for a one-shot.
  E.mod = (rate, depth, param, t0, t1, type = 'sine') => {
    const o = E.o(type, rate), g = E.g(depth, param); o.connect(g); E.fire(o, t0, t1, [g]); return o;
  };
  // A burst of Minnaert bubbles as native nodes (for one-shot clusters; beds use the worklet).
  E.bubble = (t0, f0, f1, dur, vol, dest, pan = 0) => {
    const p = E.pan(pan, dest), g = E.g(0, p), o = E.o('sine', f0, g);
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    E.env(g.gain, t0, 0.004, dur, vol);
    E.fire(o, t0, t0 + dur + 0.02, [g, p]);
  };

  // ---- noise colours ----------------------------------------------------------
  // (prebaked: noiseData below is pure on (kind, secs, rate); the click only copies it)
  function noiseBuf(kind, secs) {
    const ch = noiseData(kind, secs, ctx.sampleRate), n = ch[0].length, b = ctx.createBuffer(2, n, ctx.sampleRate);
    b.copyToChannel(ch[0], 0); b.copyToChannel(ch[1], 1);
    return b;
  }
  E.noise = { white: noiseBuf('white', 6.1), pink: noiseBuf('pink', 7.3), brown: noiseBuf('brown', 8.9) };

  // ---- master chain -----------------------------------------------------------
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = K.LIM.thr; lim.ratio.value = K.LIM.ratio; lim.knee.value = K.LIM.knee;
  lim.attack.value = K.LIM.atk; lim.release.value = K.LIM.rel;
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = K.GLUE.thr; glue.ratio.value = K.GLUE.ratio; glue.knee.value = K.GLUE.knee;
  glue.attack.value = K.GLUE.atk; glue.release.value = K.GLUE.rel;
  const outTrim = E.g(K.OUT_TRIM, ctx.destination);
  lim.connect(outTrim); glue.connect(lim);
  const master = E.g(opt.offline ? 0.62 : 0.0001, glue);
  if (!opt.offline) master.gain.linearRampToValueAtTime(K.MASTER, ctx.currentTime + 3.5);   // no click on the first frame
  const mixN = E.g(1, master);
  const meter = ctx.createAnalyser(); meter.fftSize = 2048; outTrim.connect(meter);
  E.master = master; E.glue = glue; E.lim = lim; E.outTrim = outTrim; E.meter = meter; E.mixN = mixN;

  // ---- medium (the water between Sal and the world) --------------------------
  const medIn = E.g(1);
  const medShelf = E.f('lowshelf', 140, null); medShelf.gain.value = 0;
  const medDip = E.f('peaking', 2600, 0.8); medDip.gain.value = 0;
  const medLP = E.f('lowpass', 20000, 0.55);
  medIn.connect(medShelf); medShelf.connect(medDip); medDip.connect(medLP); medLP.connect(mixN);
  E.med = { in: medIn, lp: medLP, shelf: medShelf, dip: medDip };

  // ---- space reverb (A/B convolver slots) ---------------------------------------
  const revIn = E.g(1), revOut = E.g(K.REV);
  const revHP = E.f('highpass', 60, 0.7);        // no reverb sub mud
  revOut.connect(revHP); revHP.connect(medIn);
  E.IR = {};
  const irSeed = (opt.seed || 7) & 0xffff;
  for (const k of ['deck', 'reef', 'boiler', 'abyss', 'helmet']) E.IR[k] = makeIR(ctx, SPACES[k], irSeed + k.length * 131);
  const slots = [0, 1].map(() => {
    const c = ctx.createConvolver(); c.normalize = false; const g = E.g(0, revOut);
    revIn.connect(c); c.connect(g); return { c, g, space: null, on: true };
  });
  slots[0].c.buffer = E.IR.deck; slots[0].space = 'deck'; slots[0].g.gain.value = 1;
  revIn.disconnect(slots[1].c); slots[1].on = false;
  // the faded-out slot stops convolving once its crossfade is done
  E.revIdle = () => { const rv = E.rev, s = slots[1 - rv.cur]; if (s.on && ctx.currentTime > rv.swapAt + 0.5 && s.g.gain.value < 1e-3) { revIn.disconnect(s.c); s.on = false; } };
  E.rev = { in: revIn, out: revOut, slots, cur: 0, space: 'deck', want: 'deck', swapAt: 0 };
  // Crossfade to a new space: the idle slot takes the buffer while silent, then fades up
  // over `xf` seconds while the live one fades out. A request mid-fade waits its turn.
  E.setSpace = (name, xf = 3) => {
    const rv = E.rev; rv.want = name;
    const t = ctx.currentTime;
    if (name === rv.space || t < rv.swapAt) return;
    const idle = slots[1 - rv.cur], live = slots[rv.cur];
    if (idle.space !== name) { idle.c.buffer = E.IR[name]; idle.space = name; }
    E.hold(idle.g.gain, t); idle.g.gain.linearRampToValueAtTime(1, t + xf);
    E.hold(live.g.gain, t); live.g.gain.linearRampToValueAtTime(0, t + xf);
    if (!idle.on) { revIn.connect(idle.c); idle.on = true; }
    rv.cur = 1 - rv.cur; rv.space = name; rv.swapAt = t + xf + 0.1;
    E.log('space', name);
  };

  // ---- groups ---------------------------------------------------------------------
  function group(name, dest) {
    const G = { name, in: E.g(1) };
    G.duckC = E.g(1, null); G.duckE = E.g(1, null); G.trim = E.g(K.G[name] == null ? 1 : K.G[name], null);
    G.in.connect(G.duckC); G.duckC.connect(G.duckE); G.duckE.connect(G.trim); G.trim.connect(dest);
    G.send = E.g(K.SEND[name] || 0, revIn); G.trim.connect(G.send);
    G.emWet = E.g(1, revIn);             // emitters' distance-driven reverb sends enter here, so a trim/solo covers them
    E.G[name] = G; return G;
  }
  const AMB = group('amb', medIn), SFX = group('sfx', medIn), CRE = group('cre', medIn), MUS = group('mus', mixN);
  // Sal's own sounds are inside the helmet: not filtered by the medium, coloured by
  // the copper instead (two resonant peaks, the faceplate's top roll-off) plus the cavity IR.
  const helmEQ1 = E.f('peaking', 470, 1.3), helmEQ2 = E.f('peaking', 1150, 1.6), helmLP = E.f('lowpass', 5200, 0.7);
  helmEQ1.gain.value = 5; helmEQ2.gain.value = 3.5;
  helmEQ1.connect(helmEQ2); helmEQ2.connect(helmLP); helmLP.connect(mixN);
  const SUIT = group('suit', helmEQ1);
  const helmConv = ctx.createConvolver(); helmConv.normalize = false; helmConv.buffer = E.IR.helmet;
  const helmWet = E.g(K.HELM_WET, mixN);
  SUIT.trim.connect(helmConv); helmConv.connect(helmWet);
  E.helm = { conv: helmConv, wet: helmWet };

  // Legacy named buses (the dev surface trims/mutes these), each feeding a group.
  const bus = (name, G) => { const b = E.g(1, G.in); E.B[name] = b; return b; };
  bus('bed', AMB); bus('deck', AMB); bus('events', SFX); bus('pump', SFX); bus('sail', SFX);
  bus('lev', CRE); bus('fauna', CRE); bus('helmet', SUIT); bus('chime', MUS); bus('score', MUS);

  // event ducks (automated, never by the mix): hold whatever the last duck was doing
  E.duck = (gname, depth, fall, back, t = ctx.currentTime) => {
    const p = E.G[gname].duckE.gain;
    E.hold(p, t);
    p.linearRampToValueAtTime(depth, t + fall);
    p.linearRampToValueAtTime(1, t + back);
  };

  // ---- emitters (spatial voices) ------------------------------------------------------
  const EM = [];
  function emitter(G, persistent) {
    const inp = E.g(1), lp = E.f('lowpass', 18000, 0.6), dry = E.g(0), wet = E.g(0);
    const pn = ctx.createPanner();
    pn.panningModel = E.hrtf ? 'HRTF' : 'equalpower';
    pn.distanceModel = 'inverse'; pn.refDistance = 1; pn.rolloffFactor = 0;   // direction only; distance is ours
    pn.positionX.value = 0; pn.positionY.value = 0; pn.positionZ.value = -1;
    inp.connect(lp); lp.connect(dry); dry.connect(pn); pn.connect(G.in); lp.connect(wet); wet.connect(G.emWet);
    const s = { G, inp, lp, dry, wet, pn, until: 0, prio: 0, x: 0, y: 0, z: 0, follow: null, vg: null, persistent, lvl: 1, d: 1e9, key: 0 };
    EM.push(s); return s;
  }
  const poolCRE = [], poolSFX = [];
  for (let i = 0; i < 6; i++) poolCRE.push(emitter(CRE, false));
  for (let i = 0; i < 6; i++) poolSFX.push(emitter(SFX, false));
  E.EM = EM;
  E.persist = (gname) => emitter(E.G[gname], true);
  // Claim a pooled emitter for `dur` seconds at (x,y,z) (or following `follow`, anything
  // with x/y/z). Returns the per-voice input gain, or null when every slot is busier.
  E.emit = (gname, x, y, z, dur, prio = 1, follow = null) => {
    const pool = gname === 'cre' ? poolCRE : poolSFX, t = ctx.currentTime;
    let best = null;
    for (const s of pool) if (s.until <= t) { best = s; break; }
    if (!best) {
      for (const s of pool) if (s.prio <= prio && (!best || s.until < best.until)) best = s;
      if (!best) return null;
      if (best.vg) { E.hold(best.vg.gain, t); best.vg.gain.linearRampToValueAtTime(0, t + 0.03); }
    }
    best.until = t + dur; best.prio = prio; best.follow = follow;
    best.x = x; best.y = y; best.z = z;
    const vg = E.g(1, best.inp); best.vg = vg;
    place(best, true);
    return vg;
  };

  // listener-space direction + our own distance law
  const LS = { width: 1 };
  function place(s, snap) {
    const I = E.in;
    if (s.follow) { s.x = s.follow.x; s.y = s.follow.y; s.z = s.follow.z; }
    let dx = s.x - I.px, dy = s.y - I.py, dz = s.z - I.pz;
    // rotate into camera space by the inverse camera quaternion (t = 2 u x v; v' = v + w t + u x t)
    const ux = -I.qx, uy = -I.qy, uz = -I.qz, w = I.qw;
    const tx = 2 * (uy * dz - uz * dy), ty = 2 * (uz * dx - ux * dz), tz = 2 * (ux * dy - uy * dx);
    let rx = dx + w * tx + (uy * tz - uz * ty);
    const ry = dy + w * ty + (uz * tx - ux * tz);
    const rz = dz + w * tz + (ux * ty - uy * tx);
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    rx *= LS.width;
    const m = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1;
    const t = ctx.currentTime, tc = snap ? 0.005 : 0.03;
    s.pn.positionX.setTargetAtTime(rx / m, t, tc);
    s.pn.positionY.setTargetAtTime(ry / m, t, tc);
    s.pn.positionZ.setTargetAtTime(d < 0.5 ? -1 : rz / m, t, tc);
    const under = E.S.above < 0.5;
    const gd = K.EM_REF / (K.EM_REF + K.EM_ROLL * Math.max(0, d - K.EM_REF));
    const lp = under ? Math.max(260, 16000 * Math.exp(-d / 38)) : Math.max(1800, 19000 * Math.exp(-d / 500));
    const wet = mix(0.12, 0.7, cl01(d / 70)) * (under ? 1 : 0.35);
    s.d = d;
    s.dry.gain.setTargetAtTime(gd * s.lvl, t, tc);
    s.wet.gain.setTargetAtTime(wet * Math.sqrt(gd) * s.lvl, t, tc);
    s.lp.frequency.setTargetAtTime(lp, t, tc);
  }
  E.place = place;
  E.updateEmitters = () => {
    LS.width = mix(K.EM_WIDTH_WATER, 1, E.S.above);
    const t = ctx.currentTime;
    for (const s of EM) {
      if (!s.persistent && s.until <= t) { if (s.follow) s.follow = null; continue; }
      if (s.persistent && s.lvl <= 0.0005) continue;
      place(s, false);
    }
  };

  // ---- granular textures (worklet) ----------------------------------------------------
  // Until the module loads, texture() returns a silent stand-in whose params accept
  // automation, and the real node is patched in when ready.
  E.textures = [];
  E.texReady = loadTexture(ctx).then(ok => {
    E.texOK = ok;
    for (const tx of E.textures) realise(tx);
    return ok;
  });
  function fakeParam(v) { return { value: v, setTargetAtTime(x) { this.value = x; }, setValueAtTime(x) { this.value = x; }, linearRampToValueAtTime(x) { this.value = x; }, cancelScheduledValues() { }, exponentialRampToValueAtTime(x) { this.value = x; } }; }
  function realise(tx) {
    if (!E.texOK || tx.node) return;
    const node = new AudioWorkletNode(ctx, 'abyssa-texture', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { mode: tx.mode, seed: tx.seed } });
    for (const k of ['rate', 'level', 'fLo', 'fHi', 'bright', 'jitter']) {
      const p = node.parameters.get(k); p.value = tx.p[k].value; tx.p[k] = p;
    }
    node.connect(tx.out); tx.node = node;
  }
  E.texture = (mode, dest, init = {}) => {
    const tx = { mode, seed: (R() * 4294967296) >>> 0, out: E.g(1, dest), node: null, p: {} };
    const def = { rate: 20, level: 0, fLo: 300, fHi: 900, bright: 0.5, jitter: 1 };
    for (const k in def) tx.p[k] = fakeParam(init[k] != null ? init[k] : def[k]);
    E.textures.push(tx);
    if (E.texOK) realise(tx);
    return tx;
  };

  E.dispose = () => { try { master.disconnect(); } catch (e) { /* */ } };
  return E;
}
