// ---------------------------------------------------------------------------
// ABYSSA audio — CREATURES & SLEEPERS. OWNED BY: audio agent.
//
// Read-only on the sleepers: nothing here writes to a sleeper. Each frame the facade
// hands over the live sleeper object (window.lev) and its event record; this module
// watches the fields the sleeper already keeps for its own animation and fires on
// their EDGES, so the sound lands on the frame the body does:
//
// VELKATH THE BROODER (crab colossus) — chitin and weight.
//   each foot planting (feet[i].t -> -1)    ground-shaking footfall at THAT foot
//   the hammer cocking (hamPh crosses 0.40)  a grinding of plates under strain
//   the hammer landing (impT resets)         the biggest impact in the game
//   walking                                  a continuous joint grind riding her body
//   waking                                   the shell unfolding out of the silt
// ORUNE THE HOARDER (wrapped round the trawler) — wet, suction, breath.
//   her exhale (brPh crosses 0.7)            a deep resonant siphon exhale + a boil
//   an arm lashing (arms[i].lash rises)      a slither with sucker pops, at the tip
//   the grab (grab appears / goes)           a clamp, then a squeeze; the release
// MHOR THE HUNTER (squid) — jets and clicks.
//   his jet (contract rises)                 a whoomp of water thrown
//   circling                                 predatory click trains, quickening
//   the strike wind-up (state -> strike)     the shriek that isn't: a click train
//                                            accelerating into a tone, cut dead at
//                                            the dash, then the jet
//   stunned                                  convulsive clicks, a falling groan
// Fauna, sparse: a shark passing close, a ray's wingbeat near, a school turning.
// ---------------------------------------------------------------------------
import { mix, cl01 } from './engine.js';

export const KC = { BROODER: 1, HOARDER: 1, HUNTER: 1, FAUNA: 1, SLAM: 0.42 };

export function buildCre(E) {
  const c = { kind: null, L: null, feet: new Float32Array(8), hamPh: 0, impT: 9, brPh: 0, lash: new Float32Array(16), grab: false,
    hState: '', contract: 0, clickNext: 0, lastFoot: 0, footN: 0, sharkT: [0, 0], rayT: 0, fishT: 0, grabRe: 0, lastSlam: -9, silenceT: 0 };
  E.cre = c;
  // A body emitter that rides the sleeper: continuous joint grind (Velkath) and fin
  // flutter (Mhor). Persistent; its level is 0 unless a kind wants it.
  c.body = E.persist('cre'); c.body.lvl = 0;
  c.grindG = E.g(0, c.body.inp);
  { const am = E.g(0.5), b1 = E.f('bandpass', 520, 9, c.grindG), b2 = E.f('bandpass', 1350, 12, c.grindG), b3 = E.f('bandpass', 180, 4, c.grindG);
    am.connect(b1); am.connect(b2); am.connect(b3);
    const gate = E.o('square', 38); const gg = E.g(0.5, am.gain); gate.connect(gg); gate.start();
    const jit = E.n('brown', 0.3), jg = E.g(40, gate.frequency); jit.connect(jg); E.loop(jit);
    E.loop(E.n('white', 1, am)); }
  c.finG = E.g(0, c.body.inp);
  { const am = E.g(0.5), lp = E.f('lowpass', 240, 1.5, c.finG); am.connect(lp); c.finO = E.o('sine', 3.5); const fg = E.g(0.5, am.gain); c.finO.connect(fg); c.finO.start(); E.loop(E.n('brown', 1, am)); }
}

// ---------------------------------------------------------------------------
// shared voice pieces
// ---------------------------------------------------------------------------
// Sub thump: a sine falling through the floor of hearing.
function thump(E, dest, t, f0, f1, dur, lvl) {
  const g = E.g(0, dest), o = E.o('sine', f0, g);
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.6);
  E.env(g.gain, t, 0.006, dur, lvl);
  E.fire(o, t, t + dur + 0.05, [g]);
}
function noiseHit(E, dest, t, col, type, f, q, atk, dur, lvl, sweepTo) {
  const g = E.g(0, dest), fl = E.f(type, f, q, g);
  if (sweepTo) { fl.frequency.setValueAtTime(f, t); fl.frequency.exponentialRampToValueAtTime(sweepTo, t + dur); }
  E.env(g.gain, t, atk, dur, lvl);
  E.fire(E.n(col, 1, fl), t, t + dur + 0.05, [fl, g]);
}
// Stick-slip grind: noise gated by a jittering pulse through plate resonances.
function grind(E, dest, t, dur, lvl, rate0, rate1, res) {
  const g = E.g(0, dest), am = E.g(0.5);
  const ch = [am, g];
  for (const [f, q, a] of res) { const bp = E.f('bandpass', f, q), bg = E.g(a, g); am.connect(bp); bp.connect(bg); ch.push(bp, bg); }
  const gate = E.mod(rate0, 0.5, am.gain, t, t + dur + 0.05, 'square');
  gate.frequency.setValueAtTime(rate0, t); gate.frequency.exponentialRampToValueAtTime(rate1, t + dur);
  E.mod(E.r(5, 11), rate0 * 0.35, gate.frequency, t, t + dur + 0.05);
  E.ahr(g.gain, t, dur * 0.35, dur * 0.3, dur * 0.35, lvl);
  E.fire(E.n('white', 1, am), t, t + dur + 0.05, ch);
}
// A dense click train on ONE source: n peaks automated on one gain (cheap).
function clicks(E, dest, t, n, dt0, dt1, f, q, lvl) {
  const g = E.g(0, dest), bp = E.f('bandpass', f, q, g);
  let tt = t, dt = dt0;
  const k = n > 1 ? Math.pow(dt1 / dt0, 1 / (n - 1)) : 1;
  g.gain.setValueAtTime(0, t);
  for (let i = 0; i < n; i++) {
    const a = lvl * E.r(0.6, 1);
    g.gain.setValueAtTime(0, tt); g.gain.linearRampToValueAtTime(a, tt + 0.0015); g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.012);
    tt += dt * E.r(0.85, 1.15); dt *= k;
  }
  E.fire(E.n('white', 1, bp), t, tt + 0.05, [bp, g]);
  return tt;
}

// ---------------------------------------------------------------------------
// VELKATH
// ---------------------------------------------------------------------------
function velkathFoot(E, x, y, z, w) {
  const t = E.now() + 0.005, vg = E.emit('cre', x, y, z, 1.6, 1); if (!vg) return; E.log('velkathFoot');
  const k = KC.BROODER * cl01(w) * E.startle;
  thump(E, vg, t, 46, 22, 0.9, 0.55 * k);
  noiseHit(E, vg, t, 'brown', 'lowpass', 320, 0.8, 0.008, 0.45, 0.3 * k, 120);
  noiseHit(E, vg, t + 0.01, 'white', 'bandpass', E.r(1900, 2600), 7, 0.001, 0.03, 0.08 * k);   // the chitin tip on stone
  noiseHit(E, vg, t + 0.05, 'pink', 'bandpass', 900, 0.8, 0.08, 0.8, 0.04 * k);                // silt lifting
  if (w > 0.6) E.duck('amb', mix(1, 0.8, w), 0.02, 0.6, t);
}
function velkathCock(E, L) {
  const p = L.head || L.pos, t = E.now() + 0.005, vg = E.emit('cre', p.x, p.y, p.z, 2.4, 2, p); if (!vg) return; E.log('velkathCock');
  grind(E, vg, t, 1.9, 0.5 * KC.BROODER, 22, 70, [[380, 8, 1], [960, 11, 0.7], [2300, 14, 0.35]]);
  const g = E.g(0, vg), lp = E.f('lowpass', 200, 2, g), o = E.o('sawtooth', 48, lp);   // the body taking the weight
  o.frequency.setValueAtTime(48, t); o.frequency.exponentialRampToValueAtTime(58, t + 1.8);
  E.ahr(g.gain, t, 0.9, 0.5, 0.6, 0.18);
  E.fire(o, t, t + 2.1, [lp, g]);
}
function velkathHammer(E, L, k) {
  const p = L.head || L.pos, t = E.now() + 0.003, vg = E.emit('cre', p.x, p.y, p.z, 3.5, 3); if (!vg) return;
  const s = KC.BROODER * k * E.startle;
  thump(E, vg, t, 62, 19, 2.2, 0.95 * s);
  thump(E, vg, t + 0.02, 120, 45, 0.35, 0.4 * s);
  noiseHit(E, vg, t, 'white', 'bandpass', 1500, 1.1, 0.001, 0.07, 0.5 * s);          // the crack
  noiseHit(E, vg, t, 'brown', 'lowpass', 900, 0.7, 0.004, 1.0, 0.55 * s, 150);        // the floor giving
  // debris: stones kicked up and falling back, in a scatter
  for (let i = 0; i < 9; i++) noiseHit(E, vg, t + E.r(0.08, 1.1), 'white', 'bandpass', E.r(700, 2400), 5, 0.001, E.r(0.02, 0.06), E.r(0.03, 0.09) * s);
  E.duck('amb', 0.4, 0.01, 1.8, t); E.duck('mus', 0.5, 0.01, 2.2, t);
  E.log('velkathHammer', null, k);
}
function velkathWake(E, L) {
  const p = L.pos, t = E.now() + 0.01, vg = E.emit('cre', p.x, p.y + 2, p.z, 7, 3, null); if (!vg) return;
  grind(E, vg, t + 0.3, 5.5, 0.6 * E.startle, 12, 55, [[260, 6, 1], [640, 9, 0.8], [1500, 12, 0.4]]);
  noiseHit(E, vg, t, 'pink', 'bandpass', 1200, 0.7, 1.2, 5.5, 0.12, 300);           // silt pouring off her back
  thump(E, vg, t, 40, 20, 3, 0.5 * E.startle);
  const g = E.g(0, vg), lp = E.f('lowpass', 160, 3, g), o = E.o('sawtooth', 32, lp);
  o.frequency.setValueAtTime(32, t); o.frequency.exponentialRampToValueAtTime(44, t + 5);
  E.ahr(g.gain, t, 2.5, 1.5, 2, 0.25);
  E.fire(o, t, t + 6.2, [lp, g]);
  E.log('velkathWake');
}

// ---------------------------------------------------------------------------
// ORUNE
// ---------------------------------------------------------------------------
function oruneExhale(E, L, big) {
  const p = L.pos, t = E.now() + 0.01, dur = big ? 3.2 : 2.2, vg = E.emit('cre', p.x, p.y, p.z, dur + 1, 1); if (!vg) return; E.log('oruneExhale');
  const k = KC.HOARDER * (big ? 1 : 0.45);
  // the siphon's resonance: a low tube driven by breath
  const g = E.g(0, vg), f1 = E.f('bandpass', 92, 3, g), f2 = E.f('bandpass', 230, 2.2, g);
  const src = E.n('brown', 0.9); src.connect(f1); src.connect(f2);
  E.ahr(g.gain, t, dur * 0.2, dur * 0.2, dur * 0.6, 0.9 * k);
  E.fire(src, t, t + dur + 0.05, [f1, f2, g]);
  const tg = E.g(0, vg), lp = E.f('lowpass', 150, 4, tg), o = E.o('sawtooth', 39, lp);
  o.frequency.setValueAtTime(41, t); o.frequency.exponentialRampToValueAtTime(34, t + dur);
  E.ahr(tg.gain, t, dur * 0.25, dur * 0.25, dur * 0.5, 0.22 * k);
  E.fire(o, t, t + dur + 0.05, [lp, tg]);
  // the boil at the siphon mouth: big slow bubbles
  const n = big ? 14 : 6;
  for (let i = 0; i < n; i++) { const f = E.r(80, 240); E.bubble(t + E.r(0.2, dur * 0.8), f, f * E.r(1.4, 2), E.r(0.08, 0.2), E.r(0.05, 0.13) * k, vg); }
}
function oruneLash(E, A, delay = 0) {
  const p = A.tip, t = E.now() + 0.005 + delay, vg = E.emit('cre', p.x, p.y, p.z, 1.8 + delay, 2, p); if (!vg) return; E.log('oruneLash');
  const k = KC.HOARDER;
  noiseHit(E, vg, t, 'pink', 'bandpass', 700, 1.4, 0.12, 1.2, 0.18 * k, 230);   // the slither
  for (let i = 0; i < 8; i++) {                                                 // suckers letting go
    const tt = t + E.r(0.05, 1.0), f = E.r(170, 420), g = E.g(0, vg), o = E.o('sine', f, g);
    o.frequency.setValueAtTime(f, tt); o.frequency.exponentialRampToValueAtTime(f * 0.55, tt + 0.03);
    E.env(g.gain, tt, 0.001, 0.05, E.r(0.04, 0.1) * k);
    E.fire(o, tt, tt + 0.07, [g]);
  }
}
function oruneGrab(E, L, on) {
  const p = L.pos, I = E.in, t = E.now() + 0.005;
  const vg = E.emit('cre', I.px, I.py, I.pz, on ? 1.6 : 1, 3); if (!vg) return; E.log('oruneGrab');
  if (on) {
    thump(E, vg, t, 95, 40, 0.4, 0.45 * E.startle);
    noiseHit(E, vg, t, 'brown', 'lowpass', 700, 1.5, 0.003, 0.35, 0.3 * E.startle, 200);   // the clamp: wet, sealing
    grind(E, vg, t + 0.2, 1.3, 0.14, 9, 18, [[330, 10, 1], [760, 12, 0.5]]);           // suckers biting on canvas
    E.duck('amb', 0.6, 0.02, 1.5, t);
  } else {
    const g = E.g(0, vg), o = E.o('sine', 260, g);
    o.frequency.setValueAtTime(260, t); o.frequency.exponentialRampToValueAtTime(120, t + 0.06);
    E.env(g.gain, t, 0.001, 0.12, 0.2); E.fire(o, t, t + 0.15, [g]);
    noiseHit(E, vg, t + 0.03, 'pink', 'bandpass', 600, 1.4, 0.05, 0.6, 0.12, 250);
  }
  void p;
}
function oruneWake(E, L) {
  oruneExhale(E, L, true);
  const A = L.arms; if (A) for (let i = 0; i < 3 && i < A.length; i++) { const a = A[(i * 3) % A.length]; oruneLash(E, a, 0.4 + i * 0.5); }
}

// ---------------------------------------------------------------------------
// MHOR
// ---------------------------------------------------------------------------
function mhorJet(E, L, k) {
  const p = L.pos, t = E.now() + 0.003, vg = E.emit('cre', p.x, p.y, p.z, 1.2, 1, p); if (!vg) return; E.log('mhorJet');
  const s = KC.HUNTER * k;
  noiseHit(E, vg, t, 'brown', 'lowpass', 300, 1.2, 0.03, 0.55, 0.45 * s, 110);
  thump(E, vg, t, 52, 30, 0.45, 0.3 * s);
  noiseHit(E, vg, t + 0.02, 'pink', 'bandpass', 1700, 0.9, 0.02, 0.3, 0.035 * s);
}
function mhorClicks(E, L, urgency) {
  const p = L.head || L.pos, t = E.now() + 0.003, n = 6 + Math.floor(urgency * 10);
  const vg = E.emit('cre', p.x, p.y, p.z, 2.5, 1, p); if (!vg) return; E.log('mhorClicks');
  const dt0 = mix(0.11, 0.05, urgency);
  clicks(E, vg, t, n, dt0, dt0 * mix(0.9, 0.5, urgency), E.r(1050, 1450), 7, 0.22 * KC.HUNTER);
  // under each train, a low wet tick: the beak
  noiseHit(E, vg, t, 'brown', 'lowpass', 260, 2, 0.002, 0.05, 0.1);
}
// The shriek that isn't: clicks accelerating until they fuse into a tone (a click train
// at 200/s IS a 200 Hz buzz), formants opening, inharmonic metal gliding underneath —
// then cut dead at the dash. Silence, then the jet.
function mhorStrike(E, L) {
  const p = L.head || L.pos, t = E.now() + 0.003, wind = 0.9;
  const vg = E.emit('cre', p.x, p.y, p.z, 2.5, 3, p); if (!vg) return;
  const s = KC.HUNTER * E.startle;
  const g = E.g(0, vg), am = E.g(0.5), f1 = E.f('bandpass', 700, 5), f2 = E.f('bandpass', 1900, 7);
  am.connect(f1); am.connect(f2); f1.connect(g); f2.connect(g);
  f1.frequency.setValueAtTime(600, t); f1.frequency.exponentialRampToValueAtTime(1200, t + wind);
  f2.frequency.setValueAtTime(1500, t); f2.frequency.exponentialRampToValueAtTime(3100, t + wind);
  const gate = E.mod(18, 0.5, am.gain, t, t + wind + 0.02, 'square');
  gate.frequency.setValueAtTime(18, t); gate.frequency.exponentialRampToValueAtTime(210, t + wind);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.35 * s, t + wind * 0.92); g.gain.linearRampToValueAtTime(0, t + wind + 0.01);
  E.fire(E.n('white', 1, am), t, t + wind + 0.03, [am, f1, f2, g]);
  for (const [f, a] of [[1370, 1], [2210, 0.6], [3460, 0.35]]) {
    const mg = E.g(0, vg), o = E.o('sine', f, mg);
    o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.86, t + wind);
    mg.gain.setValueAtTime(0, t); mg.gain.linearRampToValueAtTime(0.03 * a * s, t + wind * 0.9); mg.gain.linearRampToValueAtTime(0, t + wind + 0.01);
    E.fire(o, t, t + wind + 0.03, [mg]);
  }
  E.duck('amb', 0.35, 0.3, wind + 0.8, t);
  E.duck('mus', 0.2, 0.2, wind + 1.2, t);
  E.log('mhorStrike');
}
function mhorStun(E, L) {
  const p = L.pos, t = E.now() + 0.005, vg = E.emit('cre', p.x, p.y, p.z, 3, 2, p); if (!vg) return; E.log('mhorStun');
  let tt = t;
  for (let i = 0; i < 4; i++) tt = clicks(E, vg, tt + E.r(0.05, 0.3), 3 + Math.floor(E.r(0, 5)), E.r(0.02, 0.06), E.r(0.05, 0.12), E.r(800, 1600), 5, 0.15);
  const g = E.g(0, vg), lp = E.f('lowpass', 220, 2, g), o = E.o('sawtooth', 72, lp);
  o.frequency.setValueAtTime(72, t); o.frequency.exponentialRampToValueAtTime(34, t + 2.2);
  E.ahr(g.gain, t, 0.2, 0.6, 1.4, 0.2);
  E.fire(o, t, t + 2.3, [lp, g]);
}
// His arrival from the deep: something far below calling up — a low, throat-less tone
// that bends, and clicks under it.
function mhorArrive(E, L) {
  const p = L.pos, t = E.now() + 0.01, vg = E.emit('cre', p.x, p.y, p.z, 6, 3, p); if (!vg) return; E.log('mhorArrive');
  const g = E.g(0, vg), bp = E.f('bandpass', 380, 4, g), o = E.o('sawtooth', 58, bp);
  o.frequency.setValueAtTime(58, t); o.frequency.exponentialRampToValueAtTime(92, t + 1.6); o.frequency.exponentialRampToValueAtTime(49, t + 4.5);
  E.mod(6.5, 0.3, g.gain, t, t + 4.6);
  E.ahr(g.gain, t, 1.2, 1.4, 2.0, 0.35 * E.startle);
  E.fire(o, t, t + 4.7, [bp, g]);
  clicks(E, vg, t + 1.8, 12, 0.09, 0.06, 1200, 7, 0.12);
}

// ---------------------------------------------------------------------------
// the serpent / generic voice (legacy growl) and the generic contact slam
// ---------------------------------------------------------------------------
function serpentGrowl(E, zi) {
  const t = E.now() + 0.01, root = [30, 25.5, 21][zi], dur = 4.4 + zi * 0.9, dest = E.B.lev;
  const lp = E.f('lowpass', 420, 0.8, dest);
  const sg = E.g(0, lp), so = E.o('sine', root * 1.3, sg);
  so.frequency.setValueAtTime(root * 1.3, t); so.frequency.exponentialRampToValueAtTime(root * 0.76, t + dur);
  E.env(sg.gain, t, dur * 0.16, dur, 0.75 * E.startle);
  E.fire(so, t, t + dur + 0.2, [sg]);
  const vg = E.g(0, lp), vo = E.o('sawtooth', root * 2);
  vo.frequency.setValueAtTime(root * 2, t); vo.frequency.exponentialRampToValueAtTime(root * 1.45, t + dur);
  E.env(vg.gain, t, dur * 0.22, dur * 0.92, 0.4);
  const ch = [vg, lp];
  for (const [f0, f1, a, q] of [[185, 330, 1, 4], [640, 415, 0.5, 6]]) {
    const bp = E.f('bandpass', f0, q), bg = E.g(a, vg); vo.connect(bp); bp.connect(bg);
    bp.frequency.setValueAtTime(f0, t); bp.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.7); ch.push(bp, bg);
  }
  E.fire(vo, t, t + dur + 0.2, ch);
}

// Wake / name: the kind's own voice, preceded by a held breath of silence in the score.
export function growl(E) {
  const L = E.in.lev, zi = E.S.zone | 0;
  E.silence(7);
  if (!L) { serpentGrowl(E, zi); return; }
  const k = L.kind;
  if (k === 'brooder') velkathWake(E, L);
  else if (k === 'hoarder') oruneWake(E, L);
  else if (k === 'hunter') mhorArrive(E, L);
  else serpentGrowl(E, zi);
  E.duck('amb', 0.5, 0.4, 5);
  if (E.score) E.score.sting(k);
  E.log('growl', k || 'serpent');
}

// Contact: the shell shoves, a bite lands. Rate-limited; per-frame callers are safe.
export function slam(E) {
  const c = E.cre, t0 = E.now();
  if (t0 - c.lastSlam < 0.42) return;
  c.lastSlam = t0;
  const t = t0 + 0.003, dest = E.B.events, s = KC.SLAM * E.startle;
  thump(E, dest, t, 92, 27, 0.9, s);
  noiseHit(E, dest, t, 'white', 'lowpass', 700, 1.6, 0.004, 0.45, 0.38 * s, 150);
  for (let i = 0; i < 7; i++) { const f = E.r(300, 700); E.bubble(t + E.r(0.02, 0.4), f, f * E.r(1.8, 2.8), E.r(0.05, 0.1), E.r(0.03, 0.07), E.B.helmet, E.r(-0.6, 0.6)); }
  E.duck('amb', 0.55, 0.05, 0.9, t);
  E.log('slam');
}

// A shark's bite: jaws closing on canvas and brass, the thrash that follows.
export function bite(E) {
  const t = E.now() + 0.003, dest = E.B.events, s = E.startle;
  noiseHit(E, dest, t, 'white', 'bandpass', 1300, 2, 0.001, 0.08, 0.25 * s);
  thump(E, dest, t, 130, 55, 0.25, 0.3 * s);
  noiseHit(E, dest, t + 0.08, 'brown', 'lowpass', 400, 1, 0.05, 0.7, 0.25 * s);
  const am = E.g(0.5), g = E.g(0, dest), lp = E.f('lowpass', 500, 1, g); am.connect(lp);
  E.mod(E.r(5, 8), 0.5, am.gain, t + 0.1, t + 1.1, 'square');
  E.env(g.gain, t + 0.1, 0.05, 1, 0.2 * s);
  E.fire(E.n('pink', 1, am), t + 0.1, t + 1.15, [am, lp, g]);
  E.log('bite');
}

// ---------------------------------------------------------------------------
// per frame: the sleeper's edges and the fauna
// ---------------------------------------------------------------------------
export function frameCre(E, W) {
  const c = E.cre, I = E.in, L = I.lev, ev = I.ev, t = E.now();
  if (L !== c.L) {                         // a new sleeper: reset the edge memory silently
    c.L = L; c.kind = L ? L.kind : null;
    if (L && L.feet) for (let i = 0; i < 8; i++) c.feet[i] = L.feet[i] ? L.feet[i].t : -1;
    c.hamPh = L ? L.hamPh || 0 : 0; c.impT = L ? L.impT || 9 : 9; c.brPh = L ? L.brPh || 0 : 0; c.grab = !!(L && L.grab);
    c.hState = L ? L.state || '' : ''; c.contract = L ? L.contract || 0 : 0;
    if (L && L.arms) for (let i = 0; i < L.arms.length && i < 16; i++) c.lash[i] = L.arms[i].lash || 0;
    c.body.follow = L ? L.pos : null; c.body.lvl = 0;
  }
  let bodyLvl = 0, grind = 0, fin = 0;
  if (L && I.state === 'play') {
    const awake = !L.dormant && !L.calmed;
    if (c.kind === 'brooder') {
      if (L.feet) {
        let moving = 0;
        for (let i = 0; i < 8; i++) {
          const f = L.feet[i]; if (!f) continue;
          if (c.feet[i] >= 0 && f.t < 0 && f.cur && t - c.lastFoot > 0.07) { c.lastFoot = t; velkathFoot(E, f.cur.x, f.cur.y, f.cur.z, (f.h || 0.3) / 0.3); }
          if (f.t >= 0) moving++;
          c.feet[i] = f.t;
        }
        grind = cl01(moving / 3) * (L.standE || 0);
      }
      const ph = L.hamPh || 0;
      if (awake && (L.threatE || 0) > 0.5 && c.hamPh < 0.4 && ph >= 0.4) velkathCock(E, L);
      c.hamPh = ph;
      const it = L.impT == null ? 9 : L.impT;
      if (it < c.impT - 0.5 && it < 0.1 && (L.threatE || 0) > 0.5) velkathHammer(E, L, L.threatE);
      c.impT = it;
      bodyLvl = awake ? 0.5 : 0.15;
    } else if (c.kind === 'hoarder') {
      const b = L.brPh || 0;
      if (c.brPh < 0.7 && b >= 0.7) oruneExhale(E, L, !L.dormant && !L.calmed);
      c.brPh = b;
      if (L.arms) for (let i = 0; i < L.arms.length && i < 16; i++) {
        const A = L.arms[i], v = A.lash || 0;
        if (v > 0 && c.lash[i] <= 0 && A.tip) oruneLash(E, A);
        c.lash[i] = v;
      }
      const g = !!L.grab;
      if (g !== c.grab) { oruneGrab(E, L, g); c.grabRe = t + 1.6; }
      else if (g && t > c.grabRe) { c.grabRe = t + 1.6; const vg = E.emit('cre', I.px, I.py, I.pz, 1.5, 2); if (vg) grindShort(E, vg); }
      c.grab = g;
    } else if (c.kind === 'hunter') {
      const st = L.state || '';
      const k = L.contract || 0;
      if (st !== 'absent' && c.contract < 0.45 && k >= 0.45) mhorJet(E, L, st === 'strike' ? 1.6 : 1);
      c.contract = k;
      if (st !== c.hState) {
        if (st === 'strike') mhorStrike(E, L);
        else if (st === 'stunned') mhorStun(E, L);
        c.hState = st; c.clickNext = t + E.r(1.5, 3);
      }
      if ((st === 'circle' || st === 'arrive') && t >= c.clickNext) {
        const urg = st === 'circle' ? cl01((L.stT || 0) / 7) : 0.2;
        c.clickNext = t + mix(3.6, 1.2, urg) * E.r(0.8, 1.2);
        mhorClicks(E, L, urg);
      }
      fin = st === 'absent' || st === 'leave' && (L.stT || 0) > 12 ? 0 : 0.6;
      if (c.finO) c.finO.frequency.setTargetAtTime(st === 'strike' ? 9 : st === 'stunned' ? 14 : 3.5, t, 0.2);
      bodyLvl = st === 'absent' ? 0 : 0.5;
    }
  }
  c.body.lvl = bodyLvl;
  E.gate('cgrind', c.grindG, c.body.inp, 0.3 * grind * KC.BROODER, 0.15);
  E.gate('cfin', c.finG, c.body.inp, 0.2 * fin * KC.HUNTER, 0.3);
  if (ev && ev.woke && c.kind === 'hunter') { /* the arrival voice comes via growl() */ }
  frameFauna(E, W);
}
function grindShort(E, vg) { grind(E, vg, E.now() + 0.005, 1.2, 0.1, 8, 14, [[330, 10, 1], [760, 12, 0.5]]); }

// ---- fauna: only where it adds ------------------------------------------------------
function frameFauna(E, W) {
  if (!W || E.S.above > 0.5 || E.in.state !== 'play') return;
  const c = E.cre, I = E.in, t = E.now(), MV = W.MV;
  if (MV && W.moverLive) {
    for (let k = 0; k < 2; k++) {
      const slot = 2 + k; if (!W.moverLive(slot)) continue;
      const o = slot * 9, dx = MV[o] - I.px, dy = MV[o + 1] - I.py, dz = MV[o + 2] - I.pz, d = Math.hypot(dx, dy, dz);
      const sp = Math.hypot(MV[o + 4], MV[o + 5], MV[o + 6]);
      if (d < 16 && sp > 5 && t - c.sharkT[k] > 6) { c.sharkT[k] = t; sharkPass(E, MV[o], MV[o + 1], MV[o + 2], sp); }
    }
    if (W.moverLive(4)) {
      const o = 36, d = Math.hypot(MV[o] - I.px, MV[o + 1] - I.py, MV[o + 2] - I.pz);
      if (d < 22 && t - c.rayT > 1.7) { c.rayT = t; wingbeat(E, MV[o], MV[o + 1], MV[o + 2]); }
    }
  }
  if (W.schools && t - c.fishT > 3.5) {
    for (const S of W.schools) {
      const C = S.center, v = S.cvel; if (!C || !v) continue;
      const d = Math.hypot(C.x - I.px, C.y - I.py, C.z - I.pz);
      if (d < 11 && Math.hypot(v.x, v.y, v.z) > 1.2 && E.r(0, 1) < 0.35) { c.fishT = t; schoolSwish(E, C); break; }
    }
    if (t - c.fishT > 3.5) c.fishT = t - 2.5;   // re-check in a second, not every frame
  }
}
function sharkPass(E, x, y, z, sp) {
  const t = E.now() + 0.005, vg = E.emit('cre', x, y, z, 1.6, 1); if (!vg) return;
  const g = E.g(0, vg), bp = E.f('bandpass', 380, 1.2, g);
  bp.frequency.setValueAtTime(320, t); bp.frequency.exponentialRampToValueAtTime(760, t + 0.45); bp.frequency.exponentialRampToValueAtTime(260, t + 1.3);
  E.ahr(g.gain, t, 0.4, 0.1, 0.9, 0.25 * KC.FAUNA * cl01(sp / 14));
  E.fire(E.n('pink', 1, bp), t, t + 1.45, [bp, g]);
  const tg = E.g(0, vg), lp = E.f('lowpass', 180, 1.5, tg), am = E.g(0.5); am.connect(lp);
  E.mod(3.2, 0.5, am.gain, t, t + 1.4);
  E.ahr(tg.gain, t, 0.3, 0.3, 0.7, 0.2 * KC.FAUNA);
  E.fire(E.n('brown', 1, am), t, t + 1.4, [am, lp, tg]);
  E.log('sharkPass');
}
function wingbeat(E, x, y, z) {
  const t = E.now() + 0.005, vg = E.emit('cre', x, y, z, 0.9, 0); if (!vg) return; E.log('wingbeat');
  const g = E.g(0, vg), lp = E.f('lowpass', 190, 1.2, g);
  E.ahr(g.gain, t, 0.18, 0.05, 0.45, 0.18 * KC.FAUNA);
  E.fire(E.n('brown', 1, lp), t, t + 0.7, [lp, g]);
}
function schoolSwish(E, C) {
  const t = E.now() + 0.005, vg = E.emit('cre', C.x, C.y, C.z, 1.2, 0); if (!vg) return; E.log('schoolSwish');
  const n = 1 + Math.floor(E.r(0, 3));
  for (let i = 0; i < n; i++) {
    const tt = t + i * E.r(0.08, 0.2), g = E.g(0, vg), bp = E.f('bandpass', 1400, 1.6, g);
    bp.frequency.setValueAtTime(1100, tt); bp.frequency.exponentialRampToValueAtTime(2600, tt + 0.18);
    E.env(g.gain, tt, 0.04, 0.3, 0.05 * KC.FAUNA);
    E.fire(E.n('pink', 1, bp), tt, tt + 0.35, [bp, g]);
  }
}
