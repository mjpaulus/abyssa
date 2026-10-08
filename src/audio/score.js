// ---------------------------------------------------------------------------
// ABYSSA audio — THE SCORE. OWNED BY: audio agent.
//
// Mostly silence. Music in ABYSSA is weather, not wallpaper: it arrives rarely, low,
// and it leaves. Three instruments, all synthesised:
//   BRASS   low horn swells — detuned saws through a low-pass that opens WITH the
//           amplitude (the physics of brass: louder is brighter), slow late vibrato.
//           Dignified, brass-age, never a fanfare.
//   BOWED   bowed metal — noise bowing a bank of very high-Q resonators at inharmonic
//           plate ratios, with a pressure tremor. The sound of the wreck singing.
//   TENSION a sustained cluster of bowed resonances (minor seconds and a tritone) that
//           fades in with threat and tightens as it rises.
// The DIRECTOR (tick) decides when anything plays:
//   - never on deck; never within a silence window (a wake clears the air first);
//   - an ambient phrase every ~1-2 minutes below, rarer in the abyss, gated off
//     while threatened; the phrase grows a note for each ward lit (rite progress);
//   - threat brings the tension cluster; a wake gets a stinger (a dissonant low brass
//     cluster swelling out of the silence); a calm gets the resolution swell, then a
//     long rest.
// The bell family (chime) keeps its voices from the original engine: every pickup,
// craft, ward, calm, voyage and ending cue is still here, now on the MUS group.
// ---------------------------------------------------------------------------
import { cl01, mix } from './engine.js';

export const KM = { BRASS: 0.022, BOWED: 0.014, TENSION: 0.02, PHRASE_MIN: 55, PHRASE_MAX: 125, CH: { pickup: 0.9, craft: 0.8, ward: 1, calm: 1, voyage: 1.1, ending: 1.1, spark: 1 } };

export const SCALES = [
  { root: 146.83, deg: [0, 2, 3, 5, 7, 8, 10] },
  { root: 130.81, deg: [0, 1, 3, 5, 7, 8, 10] },
  { root: 110.00, deg: [0, 1, 4, 5, 7, 8, 10] }
];
const MOTIF = [0, 2, 3, 5, 4, 6, 7, 8], SIGIL_BASE = 11;
const BELL = [[0.5, 0.30, 1.5], [1, 1, 1], [2.0, 0.40, 0.72], [2.76, 0.26, 0.52], [4.07, 0.14, 0.38], [5.43, 0.08, 0.28]];
const BELL_BRIGHT = [[0.5, 0.22, 1.5], [1, 1, 1], [2.0, 0.55, 0.8], [2.76, 0.32, 0.56], [4.07, 0.22, 0.42], [5.43, 0.12, 0.3], [8.2, 0.05, 0.2]];
const SPARK = [[1, 1, 1], [2.76, 0.34, 0.5], [5.43, 0.16, 0.3]];
const TAP = [[1, 1, 1], [1.58, 0.42, 0.6], [2.4, 0.2, 0.4]];

export function buildScore(E) {
  const D = { next: E.now() + 40, silenceUntil: 0, restUntil: 0, sigil: 0, lastChime: -9, chordIdx: 0, chordOct: 1, zone: 0, lastZoneEnter: -99, tension: 0, lastWardSwell: -9 };
  E.score = D;
  // tension cluster: persistent, gain 0 until threatened
  D.tenG = E.g(0, E.B.score);
  D.tenBP = [];
  const src = E.n('pink', 1); E.loop(src);
  for (const [r, a] of [[1, 1], [1.0595, 0.8], [1.414, 0.55], [2.12, 0.35]]) {
    const bp = E.f('bandpass', 220 * r, 70), g = E.g(a * 6, D.tenG);
    src.connect(bp); bp.connect(g); D.tenBP.push({ bp, r });
    E.lfo(E.r(0.07, 0.17), a * 1.8, g.gain);
  }
  E.silence = (sec) => {
    const t = E.now();
    D.silenceUntil = Math.max(D.silenceUntil, t + sec);
    E.duck('mus', 0.05, 0.15, Math.min(sec, 3), t);
  };
  D.sting = (kind) => {
    const t = E.now() + 2.4, root = SCALES[E.S.zone | 0].root / 2;
    brass(E, t, root / 2, 8, KM.BRASS * 0.9 * E.startle);
    brass(E, t + 0.4, root / 2 * 1.0595, 7.5, KM.BRASS * 0.55 * E.startle);   // the minor second grinding against it
    if (kind === 'hoarder' || kind === 'brooder') bowed(E, t + 1.5, root * 2 * 1.414, 7, KM.BOWED * 0.8);
    D.next = Math.max(D.next, t + 60);
    E.log('sting', kind);
  };
  D.ward = (lit, total) => {
    const t = E.now() + 0.8, s = SCALES[E.S.zone | 0];
    const deg = [0, 4, 2, 7, 5][Math.min(4, lit - 1)] || 0;
    brass(E, t, s.root / 2 * Math.pow(2, s.deg[deg % 7] / 12) * (deg >= 7 ? 2 : 1), 6, KM.BRASS * 0.45);
    D.next = Math.max(D.next, t + 30);
    void total;
  };
  D.calm = () => {
    const t = E.now() + 1.2, s = SCALES[E.S.zone | 0], r = s.root / 2;
    brass(E, t, r, 11, KM.BRASS * 0.8); brass(E, t + 0.6, r * 1.5, 10, KM.BRASS * 0.6);
    brass(E, t + 1.3, r * 2 * 1.26, 9, KM.BRASS * 0.45);         // the major third: it resolves
    bowed(E, t + 2.5, r * 4, 9, KM.BOWED * 0.6);
    D.restUntil = t + 50; D.next = t + 70;
    E.log('calmSwell');
  };
  D.enterZone = (zi) => {
    D.zone = zi; D.sigil = 0;
    const t = E.now();
    if (t - D.lastZoneEnter > 20) D.next = Math.min(D.next, t + 12);
    D.lastZoneEnter = t;
  };
}

// ---- instruments ---------------------------------------------------------------------
export function brass(E, t, f, dur, lvl, dest = E.B.score) {
  if (E.full()) return;
  const g = E.g(0, dest), lp = E.f('lowpass', f * 1.5, 0.9, g);
  // vibrato arrives late, the way a player leans into a held note
  const vib = E.o('sine', E.r(4.3, 5)), vd = E.g(0); vib.connect(vd);
  vd.gain.setValueAtTime(0, t); vd.gain.linearRampToValueAtTime(7, t + dur * 0.6);
  let first = true;
  for (const [ty, m, det, a] of [['sawtooth', 1, -4, 1], ['sawtooth', 1, 5, 0.9], ['square', 0.5, 0, 0.25]]) {
    const vg = E.g(a, lp), o = E.o(ty, f * m, vg); o.detune.value = det; vd.connect(o.detune);
    E.fire(o, t, t + dur + 0.1, first ? [vg, lp, g] : [vg]); first = false;
  }
  E.fire(vib, t, t + dur + 0.1, [vd]);
  const atk = dur * 0.42, hold = dur * 0.18, rel = dur * 0.4, open = f * mix(4, 7, cl01(lvl / 0.12));
  E.ahr(g.gain, t, atk, hold, rel, lvl);
  // the brass law: the filter opens with the swell
  lp.frequency.setValueAtTime(f * 1.3, t);
  lp.frequency.linearRampToValueAtTime(open, t + atk);
  lp.frequency.setValueAtTime(open, t + atk + hold);
  lp.frequency.linearRampToValueAtTime(f * 1.2, t + dur);
  E.log('brass', null, f);
}
export function bowed(E, t, f, dur, lvl, dest = E.B.score) {
  if (E.full()) return;
  const trem = E.g(1, dest), g = E.g(0, trem), src = E.n('pink', 1), ch = [g, trem];
  for (const [m, a] of [[1, 1], [2.32, 0.6], [3.71, 0.4], [5.12, 0.25], [6.8, 0.14]]) {
    const bp = E.f('bandpass', f * m, 110), bg = E.g(a * 9, g); src.connect(bp); bp.connect(bg); ch.push(bp, bg);
    bp.frequency.setValueAtTime(f * m, t); bp.frequency.linearRampToValueAtTime(f * m * E.r(0.994, 1.006), t + dur);
  }
  E.mod(E.r(3, 6), 0.25, trem.gain, t, t + dur);
  E.ahr(g.gain, t, dur * 0.45, dur * 0.15, dur * 0.4, lvl);
  E.fire(src, t, t + dur + 0.05, ch);
  E.log('bowed', null, f);
}

// ---- the director ---------------------------------------------------------------------
export function tickScore(E) {
  const D = E.score, S = E.S, I = E.in, t = E.now();
  const under = S.above < 0.5, playing = I.state === 'play';
  // tension: threat, never once it is calmed, never in a silence
  const tension = cl01((S.prox - 0.22) / 0.6) * (1 - S.calm) * (t < D.silenceUntil ? 0.3 : 1) * (under ? 1 : 0);
  D.tension += (tension - D.tension) * 0.08;
  E.gate('ten', D.tenG, E.B.score, KM.TENSION * Math.pow(D.tension, 1.4), 0.4);
  const root = SCALES[S.zone | 0].root;
  for (const b of D.tenBP) E.ramp('tb' + b.r, b.bp.frequency, root * 1.5 * b.r * mix(1, 0.985, D.tension), 1.5);
  if (!playing || !under) return;
  if (t < D.next || t < D.silenceUntil || t < D.restUntil || D.tension > 0.25) return;
  // an ambient phrase: the zone's root, low, and one note more for each ward lit
  const zi = S.zone | 0, s = SCALES[zi], r = s.root / 2, rite = S.rite;
  D.next = t + E.r(KM.PHRASE_MIN, KM.PHRASE_MAX) * (zi === 2 ? 1.5 : 1);
  if (E.r(0, 1) < 0.3) { bowed(E, t + 0.05, r * 2 * (zi === 2 ? 0.5 : 1), E.r(10, 14), KM.BOWED * (zi === 2 ? 0.7 : 1)); return; }
  const lvl = KM.BRASS * (zi === 2 ? 0.6 : 0.75);
  const low = zi === 2 ? r / 2 : r;
  brass(E, t + 0.05, low, E.r(9, 12), lvl);
  brass(E, t + 3.5, low * Math.pow(2, s.deg[4] / 12), E.r(7, 9), lvl * 0.6);
  if (rite > 0.3) brass(E, t + 6, low * Math.pow(2, s.deg[2] / 12) * 2, 7, lvl * 0.4);
  if (rite > 0.6) bowed(E, t + 7, low * 4, 8, KM.BOWED * 0.6);
}

// ---- the bell family -------------------------------------------------------------------
function snap(E, f) {
  const s = SCALES[E.S.zone | 0];
  const n = Math.round(12 * Math.log2(f / s.root)), oct = Math.floor(n / 12), pc = n - oct * 12;
  let best = s.deg[0], bd = 99;
  for (const d of s.deg) { const dd = Math.abs(d - pc); if (dd < bd) { bd = dd; best = d; } }
  return s.root * Math.pow(2, (oct * 12 + best) / 12);
}
function degFreq(E, d) {
  const s = SCALES[E.S.zone | 0], o = Math.floor(d / 7);
  return s.root * Math.pow(2, (s.deg[d - o * 7] + 12 * o) / 12);
}
function bell(E, t, f, dur, tail, v, parts, strike = 0.05) {
  const outG = E.g(1, E.B.chime);
  let longest = 0;
  for (const p of parts) if (p[2] > longest) longest = p[2];
  for (const [m, a, dk] of parts) {
    const g = E.g(0, outG), o = E.o('sine', f * m, g);
    o.detune.value = E.r(-5, 5);
    const end = dur * tail * dk;
    E.env(g.gain, t, 0.004 + 0.004 * m, end, v * a);
    E.fire(o, t, t + end + 0.05, dk === longest ? [g, outG] : [g]);
    if (m === 1) {
      const g2 = E.g(0, outG), o2 = E.o('sine', f, g2);
      o2.detune.value = E.r(4, 9);
      E.env(g2.gain, t, 0.006, dur * tail, v * a * 0.6);
      E.fire(o2, t, t + dur * tail + 0.05, [g2]);
    }
  }
  const sg = E.g(0, outG), sf = E.f('bandpass', f * 3.4, 2, sg);
  E.env(sg.gain, t, 0.002, strike, v * 0.35);
  E.fire(E.n('white', 1, sf), t, t + strike + 0.03, [sf, sg]);
}
function brassTap(E, t, f, v) {
  const outG = E.g(1, E.B.chime), lp = E.f('lowpass', 2400, 0.8, outG);
  let first = true;
  for (const [m, a, dk] of TAP) {
    const g = E.g(0, lp), o = E.o('sine', f * m, g);
    o.detune.value = E.r(-8, 8);
    E.env(g.gain, t, 0.003, 0.24 * dk, v * a);
    E.fire(o, t, t + 0.24 * dk + 0.05, first ? [lp, outG, g] : [g]);
    first = false;
  }
  const sg = E.g(0, lp), sf = E.f('bandpass', f * 2.2, 3, sg);
  E.env(sg.gain, t, 0.001, 0.02, v * 0.5);
  E.fire(E.n('white', 1, sf), t, t + 0.05, [sf, sg]);
}
function metalClack(E, t, f, v) {
  const at = (t0, f0, vv) => {
    const nz = E.n('white', 1), outG = E.g(1, E.B.chime), chain = [outG];
    const j = E.r(0.97, 1.03);
    for (const [m, a, d] of [[1, 1, 0.14], [2.9, 0.5, 0.09], [5.1, 0.25, 0.05]]) {
      const bp = E.f('bandpass', f0 * m * j, 18), bg = E.g(0, outG);
      nz.connect(bp); bp.connect(bg); E.env(bg.gain, t0, 0.002, d, vv * a); chain.push(bp, bg);
    }
    E.fire(nz, t0, t0 + 0.2, chain);
    const g = E.g(0, outG), o = E.o('sine', f0, g);
    E.env(g.gain, t0, 0.002, 0.09, vv * 0.5); E.fire(o, t0, t0 + 0.14, [g]);
  };
  at(t, f, v); at(t + 0.09, snap(E, f * 1.335), v * 0.85);
}

// ONE BELL ANSWERS EVERYTHING, each class in its own voice:
//   pickup a dull brass tap · craft a two-note clack · ward the sigil motif note ·
//   calm the resolved chord (calls in one frame build the triad) · voyage the ship's
//   bell · ending the bright tonic.
export function chime(E, freq, dur = 1.2, vol = 0.25, kind = null) {
  if (E.full()) return;
  const D = E.score, t = E.now() + 0.005, chord = t - D.lastChime < 0.06;
  D.lastChime = t;
  if (!kind) kind = dur >= 2.5 ? 'chord' : dur >= 1.7 ? 'ward' : 'spark';
  let f, tail, v = vol * 0.55, parts = BELL, strike = 0.05;
  switch (kind) {
    case 'pickup': f = snap(E, freq); brassTap(E, t, f, v * KM.CH.pickup); E.log('chime', kind, f); return;
    // a ward a rule holds cold answers a touch with a dead iron knock, never its bell (fifth-ward)
    case 'cold': f = snap(E, freq); brassTap(E, t, f, v * KM.CH.pickup * 0.9); E.log('chime', kind, f); return;
    case 'craft': f = snap(E, freq); metalClack(E, t, f, v * KM.CH.craft); E.log('chime', kind, f); return;
    case 'ward': f = degFreq(E, SIGIL_BASE + MOTIF[D.sigil % MOTIF.length]); D.sigil++; tail = 1.5; v *= KM.CH.ward; break;
    case 'calm': case 'chord': case 'ending':
      if (chord) D.chordIdx++;
      else { D.chordIdx = 0; D.chordOct = Math.max(0, Math.round(Math.log2(freq / SCALES[E.S.zone | 0].root))); }
      f = degFreq(E, D.chordOct * 7 + [0, 2, 4, 6][D.chordIdx % 4]);
      tail = 1.9;
      if (kind === 'ending') { parts = BELL_BRIGHT; v *= KM.CH.ending; } else v *= KM.CH.calm;
      break;
    case 'voyage':
      D.chordIdx = 0; D.chordOct = Math.max(0, Math.round(Math.log2(freq / SCALES[E.S.zone | 0].root)));
      f = degFreq(E, D.chordOct * 7); tail = 2.3; strike = 0.09; v *= KM.CH.voyage; break;
    default: f = snap(E, freq); tail = 0.7; v *= 0.9 * KM.CH.spark; parts = SPARK; kind = 'spark';
  }
  bell(E, t, f, dur, tail, v, parts, strike);
  E.log('chime', kind, f);
}
