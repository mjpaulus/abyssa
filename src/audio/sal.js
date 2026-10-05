// ---------------------------------------------------------------------------
// ABYSSA audio — SAL. Everything the diver makes. OWNED BY: audio agent.
//
// THE HELMET IS THE LISTENER'S HEAD. Breath, inflow and the boots' bone-conducted
// weight go to the SUIT group: never filtered by the water, coloured by copper (the
// group's EQ + a 0.26 s cavity IR). What leaves the helmet — exhaust bubbles, the
// boot's contact with the floor, the knife through water — goes out into the world
// (SFX) and is filtered by the medium like everything else.
//
// BREATH is CONTINUOUS and phase-driven: one noise source through two moving formants,
// its level and formants written every frame from diver.js breathPhase() — the same
// clock that lifts the shoulders and fires the exhaust. 0..PI inhale, PI..TAU exhale.
// A held breath (the phase stalls) goes silent on its own. Under stress the exhale
// gains a voiced edge. Nothing is re-triggered, so nothing can drift out of sync.
//
// INFLOW: a Mark V is free-flow — air arrives down the umbilical all the time. That
// hiss is the pump's pulse in his helmet (each engine stroke swells it), and when the
// supply stops (fuel out, a storm gasp, the hose at its end) it dies. The silence
// that follows is the loudest thing in the game.
// ---------------------------------------------------------------------------
import { mix, cl01 } from './engine.js';
import { hullCreak } from './bed.js';

export const KS = {
  BREATH: 0.12, BREATH_VOICE: 0.035, INFLOW: 0.03, EXHAUST: 0.11,
  STEP: 1, HOSE: 0.05, LEAK: 0.03, KNIFE: 0.22, SONAR: 0.2, JET: 0.16
};
const TAU = Math.PI * 2;

export function buildSal(E) {
  const H = E.B.helmet, s = { prevPh: 0, rate: 1.53, stress: 0, env: 0, lastExh: -9, lastStep: -9, stepSide: 1, lastStrain: -9, tornWas: 0, lastBub: 0, aboveWas: null, lastLand: -9 };
  E.sal = s;
  // breath: pink noise -> two formants in parallel -> level
  s.brG = E.g(0, H);
  s.f1 = E.f('bandpass', 800, 2.6, s.brG); s.f2 = E.f('bandpass', 1900, 3.5, s.brG);
  s.f2g = E.g(0.7); s.f2g.connect(s.f2);
  const src = E.n('pink', 1.0); src.connect(s.f1); src.connect(s.f2g); E.loop(src);
  // a little high air on the breath (the lips, the teeth)
  s.hiG = E.g(0, H); const hf = E.f('bandpass', 4200, 1.2, s.hiG); E.loop(E.n('white', 0.9, hf));
  // the voiced edge under stress (a throat, not a word)
  s.vG = E.g(0, H); const vf = E.f('bandpass', 520, 2.2, s.vG); s.vo = E.o('sawtooth', 104, vf); s.vo.start();
  E.lfo(5.5, 3, s.vo.frequency);
  // inflow: continuous air at the gooseneck
  s.inflowG = E.g(0, H); s.inflowPulse = E.g(1, s.inflowG);
  const inf = E.f('bandpass', 3800, 0.9, s.inflowPulse), inl = E.f('lowpass', 7200, 0.7, inf);
  E.loop(E.n('white', 1.0, inl)); E.lfo(0.29, 0.08, s.inflowPulse.gain);
  // hose drag: rubber and canvas over silt, outside
  s.hoseG = E.g(0, E.B.events); const hb = E.f('bandpass', 520, 1.1, s.hoseG); E.loop(E.n('brown', 1.2, hb)); E.lfo(0.7, 120, hb.frequency);
  // the leak: a torn dress hisses, inside
  s.leakG = E.g(0, H); const lf = E.f('bandpass', 5200, 2.2, s.leakG); E.loop(E.n('white', 1.1, lf));
  // water rushing past the helmet at speed
  s.moveG = E.g(0, H); s.moveBP = E.f('bandpass', 420, 0.7, s.moveG); E.loop(E.n('pink', 1.2, s.moveBP));
  // failing filament: near-dead lantern only
  s.whineG = E.g(0, H); const wf = E.f('bandpass', 3100, 6, s.whineG); const wo = E.o('sawtooth', 3100, wf); wo.start();
  E.lfo(0.31, 90, wf.frequency);
  // THE AIR PACK's held burst: three layers off one level. A hard hiss at the valve (in
  // the helmet: it is on his back), a roar as the jet entrains water (outside, filtered by
  // the medium), and a low rumble through the backplate into the bonnet. Gated by frameSal.
  s.jetHissG = E.g(0, H); s.jetHissBP = E.f('bandpass', 3400, 1.3, s.jetHissG); E.loop(E.n('white', 1.0, s.jetHissBP));
  s.jetRoarG = E.g(0, E.B.events); s.jetRoarBP = E.f('bandpass', 700, 0.8, s.jetRoarG); E.loop(E.n('pink', 1.2, s.jetRoarBP));
  s.jetRumG = E.g(0, H); const jrl = E.f('lowpass', 140, 0.9, s.jetRumG); E.loop(E.n('brown', 1.4, jrl));
  s.jetWas = 0;
  s.stepOut = [E.pan(-0.18, E.B.events), E.pan(0.18, E.B.events)];
  s.exhOut = E.pan(0.35, E.B.events);
  s.inflowStroke = (t, spd) => {
    const p = s.inflowPulse.gain;
    E.hold(p, t); p.linearRampToValueAtTime(1 + 0.6 * spd, t + 0.05); p.setTargetAtTime(1, t + 0.06, 0.18);
  };
}

// ---------------------------------------------------------------------------
// per frame: breath, exhaust edge, tear edge, the waterline
// ---------------------------------------------------------------------------
export function frameSal(E, dt) {
  const s = E.sal, I = E.in, S = E.S, t = E.now();
  const ph = I.breathPh;
  let dph = ph - s.prevPh; if (dph < -Math.PI) dph += TAU;
  if (dt > 0 && dph >= 0 && dph < 1.5) s.rate += (dph / dt - s.rate) * Math.min(1, dt * 4);
  s.stress += (I.breathStress - s.stress) * Math.min(1, dt * 2);
  const nominal = TAU / 4.1, held = cl01((s.rate / nominal - 0.35) / 0.35);   // the phase stalling = a held breath
  const st = s.stress, playing = I.state === 'play' || I.state === 'won';
  let env = 0, F1, F2, voice = 0;
  if (ph < Math.PI) {                   // inhale: drawn through the teeth, rising
    const x = ph / Math.PI;
    env = Math.pow(Math.sin(Math.PI * Math.min(1, x * 1.15)), 0.8) * (0.75 + 0.35 * st);
    F1 = 850 + 450 * x; F2 = 2100 + 500 * x;
  } else {                              // exhale: out through the lips, falling, fuller
    const x = (ph - Math.PI) / Math.PI;
    env = (x < 0.07 ? x / 0.07 : 1) * Math.pow(1 - x, 1.2) * (1.0 + 0.4 * st);
    F1 = 700 - 260 * x; F2 = 1600 - 350 * x;
    voice = cl01((st - 0.5) / 0.4) * env;
  }
  env *= held * (playing ? 1 : 0) * (0.85 + 0.25 * (1 - S.above));
  s.env = env;
  s.brG.gain.setTargetAtTime(KS.BREATH * env, t, 0.035);
  s.hiG.gain.setTargetAtTime(KS.BREATH * 0.18 * env * (ph < Math.PI ? 1 : 0.4), t, 0.035);
  s.f1.frequency.setTargetAtTime(F1, t, 0.06); s.f2.frequency.setTargetAtTime(F2, t, 0.06);
  s.vG.gain.setTargetAtTime(KS.BREATH_VOICE * voice, t, 0.05);
  // the bed ducks under the breath: the sidechain, done from the envelope we already own
  E.G.amb.duckC.gain.setTargetAtTime((1 - E.K.DUCK_BREATH * env * (1 - S.above)) * (1 - E.K.DUCK_THREAT * S.prox * S.prox), t, 0.06);
  // the exhale opening the valve: the exhaust blat and the column of bubbles
  if (s.prevPh < Math.PI + 0.12 && ph >= Math.PI + 0.12 && playing && held > 0.5 && t - s.lastExh > 1) {
    s.lastExh = t;
    if (S.above < 0.5) exhaust(E, 0.6 + 0.6 * st);
  }
  s.prevPh = ph;
  // the air pack's held burst: hiss leads, the roar and the rumble swell under it; the
  // roar's filter opens as the jet comes up to pressure (a falling-then-steady hiss->roar)
  {
    const j = playing ? (I.jet || 0) : 0, under = 1 - S.above;
    E.gate('jetHiss', s.jetHissG, E.B.helmet, KS.JET * 0.55 * j * under, j > s.jetWas ? 0.03 : 0.08);
    E.gate('jetRoar', s.jetRoarG, E.B.events, KS.JET * j * under, j > s.jetWas ? 0.05 : 0.12);
    E.gate('jetRum', s.jetRumG, E.B.helmet, KS.JET * 1.3 * j * under, j > s.jetWas ? 0.06 : 0.15);
    E.ramp('jetRoarF', s.jetRoarBP.frequency, 420 + 520 * j, 0.12);
    s.jetWas = j;
  }
  // the dress tears (fresh tear only)
  if (S.torn > 0 && s.tornWas <= 0) tear(E);
  s.tornWas = S.torn;
  if (S.torn > 0 && S.above < 0.5 && t - s.lastBub > 0) { s.lastBub = t + E.r(0.4, 1.4); leakBubbles(E); }
  // the waterline
  const ab = I.above;
  if (s.aboveWas !== null && ab !== s.aboveWas && playing) { if (!ab) splash(E, Math.min(1, Math.abs(I.vy) / 6)); else emerge(E); }
  s.aboveWas = ab;
}

// per tick: the continuous suit layers
export function mixSal(E) {
  const s = E.sal, S = E.S, R = (k, p, v, tc) => E.ramp(k, p, v, tc), u = 1 - S.above;
  const supply = S.supplied * S.pumpSpd;
  R('inflow', s.inflowG.gain, KS.INFLOW * supply * mix(0.35, 1, u), supply > 0.1 ? 0.3 : 0.7);
  const H = E.B.helmet;
  E.gate('hose', s.hoseG, E.B.events, KS.HOSE * u * cl01(S.speed / 5) * mix(0.25, 1, S.taut), 0.2);
  E.gate('leak', s.leakG, H, S.torn > 0 ? KS.LEAK * mix(0.6, 1, u) : 0, 0.25);
  E.gate('mv', s.moveG, H, 0.05 * cl01(S.speed / 22) * u, 0.3);
  R('mvf', s.moveBP.frequency, 320 + 30 * S.speed, 0.3);
  E.gate('whine', s.whineG, H, 0.016 * Math.pow(cl01(1 - S.light / 0.4), 2.2), 0.5);
  // the hose at its end: the rubber complains — moving against it, or straining on the hold
  const t = E.now();
  if (((S.taut > 0.93 && S.speed > 1.2) || S.strain > 0.4) && u > 0.5 && t - s.lastStrain > E.r(1.4, 2.6)) { s.lastStrain = t; hoseStrain(E, Math.max(S.taut, S.strain)); }
}

// ---------------------------------------------------------------------------
// one-shots
// ---------------------------------------------------------------------------
// The exhaust valve on the right of the bonnet: a rubbery blat and a column of bubbles
// climbing away past the faceplate.
export function exhaust(E, k = 1) {
  if (E.full()) return;
  const t = E.now() + 0.01, out = E.sal.exhOut;
  const g = E.g(0, out), bp = E.f('bandpass', 170, 3, g), am = E.g(0.5); am.connect(bp);
  E.mod(E.r(28, 40), 0.5, am.gain, t, t + 0.25, 'square');
  E.env(g.gain, t, 0.01, 0.22, KS.EXHAUST * 0.9 * k);
  E.fire(E.n('brown', 1.2, am), t, t + 0.3, [am, bp, g]);
  const nB = 7 + Math.floor(E.r(0, 7) * k);
  for (let i = 0; i < nB; i++) {
    const f = E.r(300, 820), tt = t + 0.03 + i * E.r(0.04, 0.11);
    E.bubble(tt, f, f * E.r(1.6, 2.5), E.r(0.04, 0.1), E.r(0.02, 0.06) * k, out, E.r(-0.3, 0.5));
  }
  // later, the column breaks the surface far above — a soft seethe, very quiet
  const sg = E.g(0, out), sf = E.f('bandpass', 1800, 0.8, sg);
  E.env(sg.gain, t + 0.25, 0.3, 1.2, 0.008 * k);
  E.fire(E.n('white', 0.8, sf), t + 0.2, t + 1.6, [sf, sg]);
}

function leakBubbles(E) {
  const t = E.now() + 0.01, out = E.B.events;
  const n = 2 + Math.floor(E.r(0, 4));
  for (let i = 0; i < n; i++) { const f = E.r(700, 1500); E.bubble(t + i * E.r(0.03, 0.08), f, f * 1.9, 0.04, E.r(0.01, 0.03), out, E.r(-0.6, 0.6)); }
}

// Heel strike. Surface decides the contact; the weight always arrives through the suit.
//   deck: timber knock + board ring      silt: dull puff + slow settling hiss
//   rock: hard clack + grit              crust: brittle crunch (zone 1 mineral)
//   ooze: almost nothing but weight      (zone 2 floor)
export function step(E, mat = 'silt', force = 1, side = 1) {
  if (E.full()) return;
  const s = E.sal, t0 = E.now();
  if (t0 - s.lastStep < 0.16) return;
  s.lastStep = t0;
  E.log('step', mat);
  const t = t0 + 0.005, v = (0.55 + 0.45 * force) * KS.STEP, H = E.B.helmet;
  const deck = mat === 'deck';
  // 1) weight: bone-conducted into the helmet
  const tg = E.g(0, H), to = E.o('sine', deck ? 88 : 70, tg);
  to.frequency.setValueAtTime(deck ? 88 : 70, t); to.frequency.exponentialRampToValueAtTime(deck ? 44 : 32, t + 0.14);
  E.env(tg.gain, t, 0.005, 0.28, (mat === 'ooze' ? 0.13 : 0.19) * v);
  E.fire(to, t, t + 0.32, [tg]);
  // 2) contact: outside, placed at the boot
  const out = s.stepOut[side > 0 ? 1 : 0];
  const burst = (type, f, q, atk, dur, lvl, col = 'white', rate = 1, at = t) => {
    const g = E.g(0, out), bp = E.f(type, f, q, g);
    E.env(g.gain, at, atk, dur, lvl * v);
    E.fire(E.n(col, rate, bp), at, at + dur + 0.05, [bp, g]);
  };
  if (deck) {
    for (const [f, q, a, d] of [[190, 7, 0.16, 0.2], [430, 9, 0.09, 0.14], [880, 6, 0.04, 0.08]]) burst('bandpass', f * E.r(0.95, 1.06), q, 0.002, d, a);
    burst('highpass', 2500, 0.7, 0.001, 0.02, 0.03);
    if (E.r(0, 1) < 0.2) hullCreak(E, t + 0.05, 0.3, 0.025, E.B.deck);
  } else if (mat === 'rock' || mat === 'crust') {
    burst('bandpass', mat === 'crust' ? 1100 : 1900, 2.5, 0.001, 0.035, 0.09);
    burst('lowpass', 500, 0.8, 0.004, 0.12, 0.06, 'brown');
    // grit: a short gated crackle
    const g = E.g(0, out), bp = E.f('bandpass', mat === 'crust' ? 1500 : 2800, 1.2, g), am = E.g(0.5); am.connect(bp);
    E.mod(E.r(70, 130), 0.5, am.gain, t, t + 0.12, 'square');
    E.env(g.gain, t + 0.01, 0.003, mat === 'crust' ? 0.16 : 0.09, (mat === 'crust' ? 0.07 : 0.04) * v);
    E.fire(E.n('white', 1, am), t, t + 0.2, [am, bp, g]);
  } else {
    burst('lowpass', mat === 'ooze' ? 260 : 480, 0.9, 0.012, mat === 'ooze' ? 0.4 : 0.3, mat === 'ooze' ? 0.05 : 0.08, 'brown');
    burst('bandpass', 1300, 0.8, 0.06, 0.6, mat === 'ooze' ? 0.004 : 0.012, 'pink');   // silt settling back
  }
  // 3) the boot's own hardware: lead sole, brass toe — small, inside
  if (mat !== 'ooze') {
    const nz = E.n('white', 1), cl = E.g(deck ? 0.5 : 1, H); const ch = [cl];
    const j = E.r(0.94, 1.07);
    for (const [f, a, d] of [[1170, 0.05, 0.3], [1860, 0.03, 0.2], [2680, 0.016, 0.13]]) {
      const bp = E.f('bandpass', f * j, 16), bg = E.g(0, cl); nz.connect(bp); bp.connect(bg);
      E.env(bg.gain, t, 0.003, d, a * v); ch.push(bp, bg);
    }
    E.fire(nz, t, t + 0.35, ch);
  }
}

// Landing after a drop: both boots, the knees taking it, a cloud of silt.
export function land(E, p = 1, mat = 'silt') {
  const s = E.sal, t = E.now();
  if (t - s.lastLand < 0.5) return;
  s.lastLand = t;
  const k = cl01(p / 2.2), H = E.B.helmet;
  const g = E.g(0, H), o = E.o('sine', 64, g);
  o.frequency.setValueAtTime(64, t); o.frequency.exponentialRampToValueAtTime(28, t + 0.25);
  E.env(g.gain, t, 0.006, 0.45, 0.28 * (0.4 + 0.6 * k));
  E.fire(o, t, t + 0.5, [g]);
  const cg = E.g(0, E.B.events), lp = E.f('lowpass', 420, 0.8, cg);
  lp.frequency.setValueAtTime(700, t); lp.frequency.exponentialRampToValueAtTime(200, t + 0.9);
  E.env(cg.gain, t, 0.02, 0.9, 0.14 * (0.3 + 0.7 * k));
  E.fire(E.n('brown', 0.8, lp), t, t + 1, [lp, cg]);
  s.lastStep = -9; step(E, mat, 1, -1);
}

function hoseStrain(E, taut) {
  if (E.full()) return;
  const t = E.now() + 0.01, g = E.g(0, E.B.events), bp = E.f('bandpass', 260, 11, g), o = E.o('sawtooth', E.r(95, 140), bp);
  o.frequency.setValueAtTime(o.frequency.value, t); o.frequency.exponentialRampToValueAtTime(o.frequency.value * E.r(1.2, 1.5), t + 0.7);
  E.mod(E.r(14, 22), 0.5, g.gain, t, t + 0.8);
  E.env(g.gain, t, 0.15, 0.8, 0.05 * taut);
  E.fire(o, t, t + 0.9, [bp, g]);
}

// THE YANK (tether.js leash): the line comes up bar-taut on him. Three layers, all scaled
// by the snap's strength k: OUTSIDE, the rubber-and-canvas hose taking the load — a low
// thump down the line and a short stick-slip creak that rises as it stretches; INSIDE, on
// a hard jerk, the bonnet knocks on the corselet — a dull copper knock (a few inharmonic
// partials, fast decay) heard through his own head. A lean is a faint creak and no knock.
export function hoseYank(E, k = 0.5) {
  if (E.full() || !(k > 0.02)) return;
  const t = E.now() + 0.005, out = E.B.events, H = E.B.helmet, u = E.S.above < 0.5 ? 1 : 0.6;
  // the thump: the whole line taking up at once, low and short
  const tg = E.g(0, out), to = E.o('sine', 58, tg);
  to.frequency.setValueAtTime(58 + 20 * k, t); to.frequency.exponentialRampToValueAtTime(30, t + 0.22);
  E.env(tg.gain, t, 0.004, 0.32, 0.30 * Math.pow(k, 0.7) * u);
  E.fire(to, t, t + 0.36, [tg]);
  // the creak: a gated sawtooth through a narrow band, pitch rising as the rubber loads
  const cg = E.g(0, out), cb = E.f('bandpass', 300, 9, cg), am = E.g(0.5); am.connect(cb);
  const co = E.o('sawtooth', E.r(80, 105), am);
  co.frequency.setValueAtTime(co.frequency.value, t); co.frequency.exponentialRampToValueAtTime(co.frequency.value * (1.3 + 0.5 * k), t + 0.18 + 0.2 * k);
  cb.frequency.setValueAtTime(260, t); cb.frequency.exponentialRampToValueAtTime(420 + 260 * k, t + 0.25);
  E.mod(E.r(26, 38), 0.5, am.gain, t, t + 0.5, 'square');
  E.env(cg.gain, t + 0.01, 0.03, 0.22 + 0.3 * k, 0.10 * (0.35 + 0.65 * k) * u);
  E.fire(co, t, t + 0.6, [am, cb, cg]);
  // the knock: the bonnet on the breastplate, from inside — only when it is a real jerk
  if (k > 0.22) {
    const kv = Math.min(1, (k - 0.22) / 0.6) * E.startle;
    const parts = [[310, 0.12], [742, 0.08], [1187, 0.04], [1663, 0.025]];
    for (let i = 0; i < parts.length; i++) {
      const f = parts[i][0] * E.r(0.97, 1.03), g = E.g(0, H), o = E.o('sine', f, g);
      E.env(g.gain, t + 0.03, 0.002, 0.10 + 0.25 / (i + 1), parts[i][1] * kv);
      E.fire(o, t + 0.03, t + 0.45, [g]);
    }
    const ng = E.g(0, H), nb = E.f('bandpass', 900, 3, ng);
    E.env(ng.gain, t + 0.03, 0.001, 0.05, 0.07 * kv);
    E.fire(E.n('white', 0.6, nb), t + 0.03, t + 0.1, [nb, ng]);
  }
  E.log('hoseYank', null, k * 100);
}

// The knife through water: not a whoosh — a displacement. Pressure on the blade's flat,
// a sweep up and away. Above water a thin blade ring is allowed.
export function knife(E) {
  if (E.full()) return;
  const t = E.now() + 0.005, out = E.B.events, above = E.S.above > 0.5;
  const g = E.g(0, out), bp = E.f('bandpass', 350, 1.6, g);
  bp.frequency.setValueAtTime(320, t); bp.frequency.exponentialRampToValueAtTime(above ? 2400 : 1300, t + 0.12); bp.frequency.exponentialRampToValueAtTime(480, t + 0.3);
  E.env(g.gain, t, 0.05, 0.32, KS.KNIFE * 0.5);
  E.fire(E.n('pink', 1.2, bp), t, t + 0.36, [bp, g]);
  if (!above) for (let i = 0; i < 4; i++) { const f = E.r(500, 1100); E.bubble(t + 0.12 + i * 0.04, f, f * 2, 0.05, 0.015, out, E.r(-0.4, 0.4)); }
  else { const rg = E.g(0, out), ro = E.o('sine', 3350, rg); E.env(rg.gain, t + 0.02, 0.01, 0.4, 0.01); E.fire(ro, t, t + 0.45, [rg]); }
  E.log('knife');
}
// The contact: flesh (a kill, the Hoarder's arm), a dull wet thock.
export function knifeHit(E, kind = 'flesh') {
  if (E.full()) return;
  const t = E.now() + 0.005, out = E.B.events;
  const g = E.g(0, out), o = E.o('sine', 150, g);
  o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(62, t + 0.1);
  E.env(g.gain, t, 0.002, 0.16, 0.2 * E.startle);
  E.fire(o, t, t + 0.2, [g]);
  const ng = E.g(0, out), nb = E.f('bandpass', kind === 'flesh' ? 650 : 1400, 2, ng), am = E.g(0.5); am.connect(nb);
  E.mod(E.r(40, 70), 0.5, am.gain, t, t + 0.25, 'square');
  E.env(ng.gain, t, 0.003, 0.22, 0.09);
  E.fire(E.n('pink', 1, am), t, t + 0.28, [am, nb, ng]);
  E.log('knifeHit', kind);
}

// Cracking a compressed-air bottle: the brass lever clacks, a hard jet falls from hiss
// toward roar as it entrains water, then a slug of bubbles boils past the faceplate.
export function airVent(E, power = 1) {
  if (E.full()) return;
  const t = E.now() + 0.005, out = E.B.events, H = E.B.helmet;
  const cg = E.g(0, H), cf = E.f('bandpass', 1800, 3, cg);
  E.env(cg.gain, t, 0.002, 0.03, 0.12);
  E.fire(E.n('white', 0.12, cf), t, t + 0.14, [cf, cg]);
  const ng = E.g(0, out), nf = E.f('bandpass', 2800, 1.1, ng);
  nf.frequency.setValueAtTime(2800, t + 0.01); nf.frequency.exponentialRampToValueAtTime(380, t + 0.35);
  E.env(ng.gain, t, 0.005, 0.35, 0.34 * power);
  E.fire(E.n('white', 0.6, nf), t, t + 0.55, [nf, ng]);
  const bg = E.g(0, H), bo = E.o('sine', 74, bg);
  bo.frequency.setValueAtTime(74, t); bo.frequency.exponentialRampToValueAtTime(38, t + 0.16);
  E.env(bg.gain, t, 0.004, 0.2, 0.22 * power);
  E.fire(bo, t, t + 0.4, [bg]);
  const nb = Math.round(6 + 9 * power);
  for (let i = 0; i < nb; i++) { const f = E.r(420, 980); E.bubble(t + E.r(0.01, 0.55), f, f * E.r(1.6, 2.6), E.r(0.04, 0.09), E.r(0.03, 0.08), out, E.r(-0.7, 0.7)); }
  E.duck('amb', 0.85, 0.02, 0.5);
  E.log('airVent', null, power);
}

export function bottleReady(E) {
  if (E.full()) return;
  const t = E.now() + 0.005, g = E.g(0, E.B.helmet), bp = E.f('bandpass', 1240, 6, g);
  E.env(g.gain, t, 0.001, 0.03, 0.03);
  E.fire(E.n('white', 0.5, bp), t, t + 0.06, [bp, g]);
  E.log('bottleReady');
}

// The dress tears: canvas ripping (a gated, rising crackle), a gasp of air escaping,
// then the leak hisses (mixSal) and bubbles trickle out (frameSal) until it mends.
export function tear(E) {
  const t = E.now() + 0.005, H = E.B.helmet;
  const g = E.g(0, H), bp = E.f('bandpass', 1500, 1.3, g), am = E.g(0.5); am.connect(bp);
  bp.frequency.setValueAtTime(1300, t); bp.frequency.exponentialRampToValueAtTime(3600, t + 0.35);
  const gate = E.mod(E.r(70, 110), 0.5, am.gain, t, t + 0.45, 'square');
  E.mod(9, 40, gate.frequency, t, t + 0.45);
  E.env(g.gain, t, 0.01, 0.42, 0.16 * E.startle);
  E.fire(E.n('white', 1, am), t, t + 0.5, [am, bp, g]);
  const hg = E.g(0, H), hf = E.f('bandpass', 4200, 1, hg);
  E.env(hg.gain, t + 0.2, 0.02, 0.9, 0.06);
  E.fire(E.n('white', 1.2, hf), t + 0.18, t + 1.2, [hf, hg]);
  for (let i = 0; i < 10; i++) { const f = E.r(500, 1200); E.bubble(t + 0.25 + E.r(0, 0.6), f, f * 2.1, 0.06, E.r(0.02, 0.05), E.B.events, E.r(-0.6, 0.6)); }
  E.log('tear');
}

// Going under: the slap of the surface, then the world turning to water around the
// helmet — a falling roar and a boil of bubbles past the glass.
export function splash(E, k = 0.5) {
  const t = E.now() + 0.005, H = E.B.helmet;
  const sg = E.g(0, E.B.deck), sh = E.f('highpass', 900, 0.7, sg);
  E.env(sg.gain, t, 0.003, 0.25, 0.12 * (0.5 + k));
  E.fire(E.n('white', 1, sh), t, t + 0.3, [sh, sg]);
  const rg = E.g(0, H), rl = E.f('lowpass', 3000, 0.7, rg);
  rl.frequency.setValueAtTime(3500, t); rl.frequency.exponentialRampToValueAtTime(300, t + 1.4);
  E.env(rg.gain, t + 0.03, 0.05, 1.5, 0.18 * (0.5 + k));
  E.fire(E.n('pink', 0.9, rl), t, t + 1.6, [rl, rg]);
  for (let i = 0; i < 22; i++) { const f = E.r(300, 1100); E.bubble(t + E.r(0.02, 0.9), f, f * E.r(1.6, 2.6), E.r(0.04, 0.1), E.r(0.02, 0.07), E.B.events, E.r(-0.8, 0.8)); }
  E.log('splash', null, k);
}
// Coming up: water sheeting off the bonnet, drips, and the air arriving.
export function emerge(E) {
  const t = E.now() + 0.005, out = E.B.deck;
  const g = E.g(0, out), f = E.f('bandpass', 1400, 0.6, g);
  E.env(g.gain, t, 0.02, 1.1, 0.06);
  E.fire(E.n('white', 0.9, f), t, t + 1.2, [f, g]);
  for (let i = 0; i < 9; i++) {
    const tt = t + 0.2 + E.r(0, 1.6), dg = E.g(0, out), o = E.o('sine', E.r(1400, 2600), dg);
    o.frequency.setValueAtTime(o.frequency.value, tt); o.frequency.exponentialRampToValueAtTime(o.frequency.value * 1.5, tt + 0.03);
    E.env(dg.gain, tt, 0.001, 0.04, E.r(0.005, 0.015)); E.fire(o, tt, tt + 0.06, [dg]);
  }
  E.log('emerge');
}

// ---- the sounding set ----------------------------------------------------------------
// A brass-age sonar: the key clacks, a pure oscillator pings through the hull of the
// set, and the dark answers — echoes from what the ping actually found, placed where
// it is, delayed by the round trip, darker and smeared with distance. The iron wards
// ring back bright; a sleeper returns low and long; the floor and far walls return as
// diffuse grey. The ring front on screen travels at 36 u/s; the echo comes back at the
// same speed, so each return lands after its glint, as a real return would.
export function sonar(E, targets) {
  const t = E.now() + 0.01, I = E.in, out = E.B.events;
  const kg = E.g(0, E.B.helmet), kb = E.f('bandpass', 2200, 4, kg);
  E.env(kg.gain, t, 0.001, 0.02, 0.1);
  E.fire(E.n('white', 1, kb), t, t + 0.05, [kb, kg]);
  ping(E, t + 0.03, 1180, 1.0, out, 1);
  E.duck('amb', 0.7, 0.05, 1.5, t);
  let n = 0;
  if (targets) for (let i = 0; i < targets.length && n < 7; i += 4, n++) {
    const x = targets[i], y = targets[i + 1], z = targets[i + 2], kind = targets[i + 3];
    const d = Math.hypot(x - I.px, y - I.py, z - I.pz);
    if (d > 140) continue;
    const at = t + 0.03 + Math.min(7, (2 * d) / 36);
    const vg = E.emit('sfx', x, y, z, at - E.now() + 2.5, 2); if (!vg) continue;
    const f = kind === 1 ? 1180 * 1.5 : kind === 2 ? 1180 * 0.5 : 1180;
    ping(E, at, f, kind === 1 ? 0.55 : kind === 2 ? 0.7 : 0.35, vg, kind === 2 ? 3 : 1.5);
  }
  // the floor and the far walls: two diffuse returns on random bearings
  for (let k = 0; k < 2; k++) {
    const a = E.r(0, Math.PI * 2), d = E.r(35, 110);
    const x = I.px + Math.cos(a) * d, z = I.pz + Math.sin(a) * d;
    const at = t + 0.03 + (2 * d) / 36;
    const vg = E.emit('sfx', x, I.py - 10, z, at - E.now() + 2, 0); if (!vg) continue;
    ping(E, at, 1180, 0.12, vg, 2.5, true);
  }
  E.log('sonar', null, n);
}
function ping(E, t, f, lvl, dest, smear = 1, diffuse = false) {
  const g = E.g(0, dest);
  if (diffuse) {
    const bp = E.f('bandpass', f, 12, g);
    E.env(g.gain, t, 0.08 * smear, 0.6 * smear, KS.SONAR * lvl * 2);
    E.fire(E.n('white', 1, bp), t, t + 0.7 * smear + 0.1, [bp, g]);
    return;
  }
  const g2 = E.g(0.08, g), o = E.o('sine', f, g), o2 = E.o('sine', f * 2.01, g2);
  o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.975, t + 0.8 * smear);
  E.env(g.gain, t, 0.004 * smear * 3, 0.9 * smear, KS.SONAR * lvl);
  E.fire(o, t, t + 0.95 * smear + 0.05, [g]); E.fire(o2, t, t + 0.4, [g2]);
}
