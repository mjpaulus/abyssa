// ---------------------------------------------------------------------------
// ABYSSA audio — THE BED: the places themselves. OWNED BY: audio agent.
//
// Every layer here is continuous and never loops audibly: noise loops of prime-ish
// lengths at incommensurate playback rates, LFOs at incommensurate rates, and the
// granular worklet for anything with grain (shrimp, bubbles, rain). The mix (mixBed)
// only moves gains and corners; nothing is created per tick.
//
//   DECK      wind in the stays, the whistle of a gust, water lapping the strakes, slaps
//             on the hull (granular one-shots), rain on timber, hull creaks, a rare gull
//   UNDER     (all zones) the pressure drone (tuned per zone), water movement, surface
//             wash near the top, rain hiss on the surface from below (14 kHz bubbles)
//   REEF      zone 0: snapping-shrimp crackle, two layers (a far carpet + near snaps),
//             distant whale-like calls, rock settling
//   BOILER    zone 1: pressure rumble, boiling, vent roar from the two nearest throats
//             (spatial emitters), deep knocks
//   ABYSS     zone 2: sub-bass pressure, a ringing faint air in the silence, far metal
//             ticks, and long stretches of nothing
// ---------------------------------------------------------------------------
import { mix, cl01 } from './engine.js';

export const KB = {
  DRONE: 0.3, WATER: 0.55, SURF: 0.2, SHIM: 0.02,
  REEF_FAR: 0.55, REEF_NEAR: 0.35, REEF_RATE: 420,
  BOIL_RUMBLE: 0.08, BOIL_BUB: 0.5, VENT: 0.2,
  ABYSS_SUB: 0.3, ABYSS_AIR: 0.01,
  DECK_WIND: 0.10, DECK_GUST: 0.03, DECK_LAP: 0.05, DECK_SLAP: 0.09, DECK_CREAK: 0.06,
  RAIN_DECK: 0.12, RAIN_UNDER: 0.12,
  PUMP: 0.32, PUMP_HOSE: 0.5,
  THUNDER: 0.9,
  GULL: 0.028, GULL_ON: 1,
  CALL: 1, GROAN: 1, KNOCK: 1, TICK: 1
};

// D aeolian / C phrygian / A phrygian-dominant: the trench darkens as you fall.
export const DRONE_ROOT = [36.71, 32.70, 27.50];

export function buildBed(E) {
  const b = {}, B = E.B, t0 = E.now();
  E.bed = b;
  // ---- pressure drone: stacked partials on a root that drops per zone ----
  b.droneG = E.g(0.0001); b.droneLP = E.f('lowpass', 1200, 0.6);
  b.droneG.connect(b.droneLP); b.droneLP.connect(B.bed);
  b.drones = [];
  const PART = [[1, 0.22, 'sine', 0.013, 6], [1.5, 0.07, 'sine', 0.019, 9], [2, 0.14, 'sine', 0.023, 5],
    [3, 0.045, 'triangle', 0.029, 11], [4, 0.026, 'triangle', 0.037, 14], [6, 0.009, 'sine', 0.041, 18]];
  for (const [r, g0, ty, mr, md] of PART) {
    const vg = E.g(g0, b.droneG), o = E.o(ty, DRONE_ROOT[0] * r, vg);
    o.start(t0); E.lfo(mr, md, o.detune); E.lfo(mr * 1.63 + 0.007, g0 * 0.42, vg.gain);
    b.drones.push({ o, r });
  }
  // ---- water movement ----
  b.waterG = E.g(0.0001); b.waterLP = E.f('lowpass', 2600, 0.5);
  const wHP = E.f('highpass', 38, 0.7);
  b.waterG.connect(b.waterLP); b.waterLP.connect(wHP); wHP.connect(B.bed);
  { const g = E.g(0.06, b.waterG), f = E.f('lowpass', 210, 1.1, g); E.loop(E.n('brown', 0.83, f)); E.lfo(0.021, 90, f.frequency); E.lfo(0.031, 0.05, g.gain); }
  { const g = E.g(0.05, b.waterG), f = E.f('bandpass', 340, 0.8, g); E.loop(E.n('pink', 1.0, f)); E.lfo(0.017, 170, f.frequency); E.lfo(0.043, 0.022, g.gain); }
  { const sw = E.g(0.7, b.waterG); b.surfG = E.g(0.0001, sw); b.surfG._dest = sw; const f = E.f('bandpass', 620, 0.5, b.surfG); E.loop(E.n('pink', 0.42, f)); E.lfo(0.071, 0.45, sw.gain); E.lfo(0.053, 260, f.frequency); }
  { const sw = E.g(0.7, B.bed); b.shimG = E.g(0.0001, sw); const f = E.f('highpass', 2600, 0.7, b.shimG); E.loop(E.n('white', 1.7, f)); E.lfo(0.11, 0.4, sw.gain); }

  // ---- REEF: snapping shrimp. A far carpet (dense, dull) and near snaps (sparse, bright).
  b.reefG = E.g(0.0001, B.bed);
  const reefHP = E.f('highpass', 1400, 0.6, b.reefG), reefPk = E.f('peaking', 4200, 0.9, reefHP); reefPk.gain.value = 3;
  b.reefFar = E.texture(0, reefPk, { rate: KB.REEF_RATE, level: 0.6, bright: 0.15, jitter: 1 });
  b.reefNear = E.texture(0, reefPk, { rate: 9, level: 0.9, bright: 0.95, jitter: 1 });

  // ---- BOILER: rumble, boiling, (vent roar lives on emitters below) ----
  b.boilG = E.g(0.0001, B.bed);
  { const sw = E.g(0.8, b.boilG), f = E.f('lowpass', 85, 0.9, sw); E.loop(E.n('brown', 0.6, f)); E.lfo(0.047, 0.35, sw.gain); E.lfo(0.013, 25, f.frequency); }
  { const g = E.g(0.03, b.boilG), o = E.o('sine', 41, g); o.start(t0); E.lfo(0.061, 0.05, g.gain); E.lfo(0.023, 1.5, o.frequency); }
  { const lp = E.f('lowpass', 900, 0.7, b.boilG); b.boilBub = E.texture(1, lp, { rate: 22, level: 0.25, fLo: 70, fHi: 320 }); }

  // ---- ABYSS: sub pressure (two beating sines + the octave for small speakers), a
  // ringing faint air, and nothing else. Silence is the instrument here.
  b.abyssG = E.g(0.0001, B.bed);
  { const g = E.g(0.035, b.abyssG); const o1 = E.o('sine', 30.5, g), o2 = E.o('sine', 31.1, g); o1.start(t0); o2.start(t0);
    const g2 = E.g(0.025, b.abyssG), o3 = E.o('sine', 61.3, g2); o3.start(t0); E.lfo(0.031, 0.015, g2.gain); }
  { b.airG = E.g(0.0001, B.bed); const f = E.f('bandpass', 6800, 4, b.airG); E.loop(E.n('pink', 1.0, f)); E.lfo(0.019, 900, f.frequency); }

  // ---- rain: on timber above (worklet drops + a hiss), and heard from below as the
  // high bubble hiss that rain really makes under the surface ----
  b.rainDeckG = E.g(0.0001, B.deck);
  b.rainDeck = E.texture(2, b.rainDeckG, { rate: 0, level: 0.6, fLo: 1800, fHi: 6000, bright: 0.7 });
  { const f = E.f('bandpass', 3500, 0.5, b.rainDeckG); b.rainHiss = E.g(0, f); E.loop(E.n('pink', 1.1, b.rainHiss)); }
  b.rainUnderG = E.g(0.0001, B.bed);
  b.rainUnder = E.texture(1, b.rainUnderG, { rate: 0, level: 0.25, fLo: 9000, fHi: 15500 });

  // ---- deck: wind, gust whistle, lap ----
  b.deckIn = E.g(0.0001, B.deck);
  b.windG = E.g(0.0001, b.deckIn);
  { const sw = E.g(0.7, b.windG); E.lfo(0.083, 0.26, sw.gain); E.lfo(0.21, 0.13, sw.gain);
    b.windBP = E.f('bandpass', 300, 0.45, sw); E.loop(E.n('pink', 0.7, b.windBP)); E.lfo(0.047, 60, b.windBP.frequency); }
  b.gustG = E.g(0.0001, b.deckIn);
  { const sw = E.g(0.55, b.gustG); E.lfo(0.17, 0.4, sw.gain); const f = E.f('bandpass', 1400, 2.5, sw); E.loop(E.n('white', 1.4, f)); E.lfo(0.031, 350, f.frequency); }
  b.lapG = E.g(0.0001, b.deckIn);
  { const sw = E.g(0.55, b.lapG); E.lfo(0.27, 0.38, sw.gain); E.lfo(0.41, 0.15, sw.gain); const f = E.f('bandpass', 760, 0.9, sw); E.loop(E.n('pink', 0.9, f)); E.lfo(0.19, 240, f.frequency); }

  // ---- vents: two persistent emitters ride the two nearest active throats ----
  b.vents = [0, 1].map(i => {
    const em = E.persist('sfx'); em.lvl = 0;
    const src = E.g(1, em.inp);
    const roar = E.f('bandpass', 180 + i * 60, 0.6, src); E.loop(E.n('brown', 0.9 + i * 0.13, roar));
    const hiss = E.g(0.25, src), hf = E.f('bandpass', 2400 + i * 500, 0.8, hiss); E.loop(E.n('white', 0.8 + i * 0.1, hf));
    E.lfo(0.37 + i * 0.11, 0.12, hiss.gain);
    const bub = E.f('lowpass', 1600, 0.7, src);
    E.texture(1, bub, { rate: 30, level: 0.35, fLo: 120, fHi: 700 });
    return { em, src, x: 0, y: -1e5, z: 0 };
  });

  // ---- the raft pump: a single-cylinder oil engine belt-driving the compressor ----
  // On deck it is a place (spatial emitter at the raft). Below, it comes down the
  // umbilical as a conducted thump inside the helmet — that thread IS the machine
  // breathing for him, which makes the moment it stops the moment he finds out.
  b.pumpBus = E.g(1);
  b.pumpEm = E.persist('sfx'); b.pumpEm.lvl = 0;
  b.pumpAir = E.g(1, b.pumpEm.inp); b.pumpBus.connect(b.pumpAir);
  b.pumpHose = E.g(0); const hoseLP = E.f('lowpass', 380, 0.8, B.helmet);
  b.pumpBus.connect(b.pumpHose); b.pumpHose.connect(hoseLP);
  b.pumpPulse = E.g(1, b.pumpBus); b.pumpMech = E.g(0.0001, b.pumpPulse);
  b.pumpMechLP = E.f('lowpass', 160, 0.9, b.pumpMech); E.loop(E.n('brown', 0.5, b.pumpMechLP));
  b.pumpHiss = E.g(0.0001, b.pumpBus); { const f = E.f('bandpass', 3400, 1.1, b.pumpHiss); E.loop(E.n('white', 1.3, f)); }
  b.pRate = 0; b.pNext = 0;

  for (const [n, d] of [['reefG', B.bed], ['boilG', B.bed], ['abyssG', B.bed], ['airG', B.bed], ['rainDeckG', B.deck], ['rainUnderG', B.bed], ['deckIn', B.deck]]) b[n]._dest = d;
  // ambient schedule (audio clock)
  const n = E.next, t = E.now();
  n.creak = t + E.r(8, 20); n.groan = t + E.r(15, 40); n.call = t + E.r(14, 35); n.knock = t + E.r(20, 50);
  n.deckCreak = t + E.r(2, 5); n.slap = t + E.r(0.5, 2); n.gull = t + E.r(30, 90); n.tick = t + E.r(10, 30);
  b.boltT = null;
}

// ---------------------------------------------------------------------------
// per-tick mix (20 Hz). S = smoothed state.
// ---------------------------------------------------------------------------
export function mixBed(E) {
  const b = E.bed, S = E.S, d = S.depth, a = S.above, u = 1 - a, c = S.calm, w = S.wind, zw = S.zw, R = (k, p, v, tc) => E.ramp(k, p, v, tc);
  const duck = mix(1, 0.8, S.prox * S.prox);
  // pressure drone: closes down and gets heavier toward the floor; a memory of it on deck
  R('dlp', b.droneLP.frequency, mix(1250, 190, d * d) * mix(1, 1.4, c), 0.4);
  R('dg', b.droneG.gain, KB.DRONE * mix(0.45, 0.75, d) * mix(1, 0.85, c) * duck * mix(1, 0.25, a) * (1 - 0.5 * zw[2]), 0.5);
  R('wlp', b.waterLP.frequency, mix(2800, 360, d) * mix(1, 1.5, c), 0.4);
  R('wg', b.waterG.gain, KB.WATER * mix(1.0, 0.6, d) * duck * mix(1, 0.5, a) * (1 - 0.6 * zw[2]), 0.5);
  R('shim', b.shimG.gain, 0.0001 + (KB.SHIM * Math.pow(1 - d, 1.6) + 0.012 * c) * u, 0.6);
  // zone layers (zw = smoothed zone weights, so the rift passage crossfades)
  const shallow = cl01(1 - d / 0.3);                // shrimp live in the shallows
  const G = (k, n, v, tc) => E.gate(k, n, n._dest, v, tc);
  G('reef', b.reefG, zw[0] * u * mix(0.35, 1, shallow) * KB.REEF_FAR * 0.18, 0.8);
  G('boil', b.boilG, zw[1] * u * KB.BOIL_RUMBLE, 0.8);
  G('abyss', b.abyssG, zw[2] * u * KB.ABYSS_SUB, 1.2);
  G('air', b.airG, zw[2] * u * KB.ABYSS_AIR * (1 - S.prox), 1.5);
  // rain
  const rain = S.rain;
  G('rd', b.rainDeckG, KB.RAIN_DECK * a * rain, 0.6);
  b.rainDeck.p.rate.setTargetAtTime(rain * 1400, E.now(), 0.8);
  R('rh', b.rainHiss.gain, 0.025 * rain * rain, 0.8);
  G('ru', b.rainUnderG, KB.RAIN_UNDER * u * rain * Math.pow(cl01(1 - d / 0.08), 2), 0.8);
  b.rainUnder.p.rate.setTargetAtTime(rain * 900, E.now(), 0.8);
  // deck
  G('deck', b.deckIn, a, 0.5);
  G('surfg', b.surfG, KB.SURF * Math.pow(1 - d, 2.5) * u, 0.6);
  R('wind', b.windG.gain, KB.DECK_WIND * (0.12 + 0.88 * Math.pow(w, 1.3)), 0.8);
  R('windf', b.windBP.frequency, mix(220, 560, w), 1.0);
  R('gust', b.gustG.gain, 0.0001 + KB.DECK_GUST * w * w, 0.8);
  R('lap', b.lapG.gain, KB.DECK_LAP * (0.5 + 0.5 * w), 0.8);
  // vents: the emitter's own input is gated (its HRTF panner idles on silence)
  for (let i = 0; i < 2; i++) { const v = b.vents[i]; v.em.lvl = zw[1] * u * KB.VENT * (v.y > -1e4 ? 1 : 0); E.gate('vent' + i, v.src, v.em.inp, v.em.lvl > 0 ? 1 : 0, 0.3); }
  E.revIdle();
  // the space
  const I = E.in;
  E.setSpace(a > 0.5 ? 'deck' : ['reef', 'boiler', 'abyss'][S.zone | 0], a > 0.5 || E.rev.space === 'deck' ? 0.6 : 4);
  // medium: flat in air; underwater the top closes with depth, the bottom thickens
  const med = E.med;
  R('mlp', med.lp.frequency, a > 0.5 ? 20000 : 7800 * (1 - 0.7 * Math.pow(d, 0.6)), a > 0.5 ? 0.05 : 0.06);
  R('msh', med.shelf.gain, u * mix(1, 2.5, d), 0.3);
  R('mdp', med.dip.gain, -4.5 * u, 0.3);
  // reverb return: open air is the driest room in the game
  R('revo', E.rev.out.gain, E.K.REV * mix(1, 0.35, a) * mix(0.8, 1.15, d), 0.5);
  void I;
}

// ---------------------------------------------------------------------------
// per-frame (vent tracking, thunder, pump strokes)
// ---------------------------------------------------------------------------
export function frameBed(E, W) {
  const b = E.bed, I = E.in;
  // nearest two active vents
  if (W.vents && E.S.zw[1] > 0.01) {
    let i0 = -1, i1 = -1, d0 = 1e12, d1 = 1e12;
    const V = W.vents;
    for (let i = 0; i < V.length; i++) {
      const v = V[i], dx = v.x - I.px, dy = v.y - I.py, dz = v.z - I.pz, dd = dx * dx + dy * dy + dz * dz;
      if (dd < d0) { d1 = d0; i1 = i0; d0 = dd; i0 = i; } else if (dd < d1) { d1 = dd; i1 = i; }
    }
    const pick = [i0, i1];
    for (let k = 0; k < 2; k++) {
      const s = b.vents[k], v = pick[k] >= 0 ? V[pick[k]] : null;
      if (v) { s.em.x = v.x; s.em.y = v.y + 2; s.em.z = v.z; s.y = v.y; } else s.y = -1e5;
    }
  }
  // pump emitter at the raft
  b.pumpEm.x = I.raftX; b.pumpEm.y = I.raftY + 0.6; b.pumpEm.z = I.raftZ;
  // thunder: a new strike, placed and delayed by range
  const bl = I.bolt;
  if (bl && bl.t !== b.boltT) {
    const first = b.boltT === null;
    b.boltT = bl.t;
    if (!first && bl.amp > 0.05) thunder(E, bl.x, bl.z, bl.amp);
  }
}

export function tickBed(E) {
  const n = E.next, t = E.now(), S = E.S, u = S.above < 0.5, zi = S.zone | 0;
  if (t >= n.creak) { n.creak = t + E.r(8, 24) / (1 + S.depth * 1.6); if (u) suitCreak(E); }
  if (t >= n.groan) { n.groan = t + E.r(20, 55); if (u && KB.GROAN) rockGroan(E); }
  if (t >= n.call) { n.call = t + (zi === 2 ? E.r(90, 200) : E.r(45, 120)); if (u && KB.CALL && S.prox < 0.3) distantCall(E); }
  if (t >= n.knock) { n.knock = t + E.r(28, 72); if (u && zi > 0 && KB.KNOCK) deepKnock(E); }
  if (t >= n.tick) { n.tick = t + E.r(9, 34); if (u && zi === 2 && KB.TICK) abyssTick(E); }
  if (t >= n.deckCreak) { n.deckCreak = t + E.r(2, 6); if (!u) hullCreak(E, t, E.r(0.4, 1) * (0.4 + 0.6 * S.wind), KB.DECK_CREAK * (0.5 + 0.5 * S.wind)); }
  if (t >= n.slap) { n.slap = t + E.r(0.35, 2.2) / (0.6 + S.wind); if (!u) hullSlap(E, t, 0.5 + 0.5 * S.wind); }
  if (t >= n.gull) { n.gull = t + E.r(40, 130); if (!u && KB.GULL_ON && S.wind < 0.5 && S.rain < 0.1 && S.day > 0.5) { const s = E.r(0, 1) < 0.5 ? -1 : 1; gull(E, t, 0.55 * s); if (E.r(0, 1) < 0.4) gull(E, t + E.r(0.5, 0.9), -0.4 * s, KB.GULL * 0.7); } }
  pumpTick(E);
}

// ---------------------------------------------------------------------------
// ambient one-shots
// ---------------------------------------------------------------------------
// A far point on a random bearing (for sounds with no source in the world).
const FAR = { x: 0, y: 0, z: 0 };
function farPoint(E, dist, dy = 0) {
  const a = E.r(0, Math.PI * 2), I = E.in;
  FAR.x = I.px + Math.cos(a) * dist; FAR.z = I.pz + Math.sin(a) * dist; FAR.y = I.py + dy;
  return FAR;
}

// Metal under pressure: a resonance that slides while stick-slip chatters on top.
export function suitCreak(E) {
  if (E.full()) return;
  const t = E.now() + 0.01, dur = E.r(0.9, 2.3), f0 = E.r(210, 680), H = E.B.helmet;
  const g = E.g(0, H), am = E.g(1, g), bp = E.f('bandpass', f0, 9, am);
  bp.frequency.setValueAtTime(f0, t); bp.frequency.exponentialRampToValueAtTime(f0 * E.r(0.7, 1.45), t + dur);
  const chatG = E.g(0.55, am.gain), chat = E.o('sine', E.r(9, 21), chatG);
  chat.frequency.setValueAtTime(chat.frequency.value, t); chat.frequency.exponentialRampToValueAtTime(E.r(3, 7), t + dur);
  E.env(g.gain, t, dur * 0.35, dur, E.r(0.04, 0.09) * (0.5 + E.S.depth));
  E.fire(chat, t, t + dur + 0.05, [chatG]);
  E.fire(E.n('pink', 0.3, bp), t, t + dur + 0.05, [bp, am, g]);
  const og = E.g(0, H), o = E.o('triangle', E.r(58, 124), og);
  o.frequency.setValueAtTime(o.frequency.value, t); o.frequency.exponentialRampToValueAtTime(o.frequency.value * E.r(0.85, 1.1), t + dur);
  E.env(og.gain, t, dur * 0.4, dur, 0.03);
  E.fire(o, t, t + dur + 0.05, [og]);
  E.log('suitCreak');
}

// Rock shifting somewhere out in the dark: placed far away, almost all reverb.
export function rockGroan(E) {
  if (E.full()) return;
  const p = farPoint(E, E.r(60, 140), E.r(-20, 5));
  const t = E.now() + 0.01, dur = E.r(4, 8), f0 = E.r(40, 78);
  const vg = E.emit('sfx', p.x, p.y, p.z, dur + 0.5, 0); if (!vg) return;
  const g = E.g(0, vg), lp = E.f('lowpass', 165, 7, g);
  const o = E.o('sawtooth', f0, lp);
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * E.r(0.58, 0.8), t + dur);
  lp.frequency.setValueAtTime(165, t); lp.frequency.exponentialRampToValueAtTime(E.r(70, 120), t + dur);
  E.env(g.gain, t, dur * 0.3, dur, E.r(0.12, 0.2));
  E.fire(o, t, t + dur + 0.1, [lp, g]);
  const rg = E.g(0, vg), rb = E.f('bandpass', 190, 2.2, rg);
  E.env(rg.gain, t + dur * 0.2, 0.4, dur * 0.7, 0.05);
  E.fire(E.n('brown', 0.45, rb), t + dur * 0.2, t + dur, [rb, rg]);
  E.log('rockGroan');
}

// Something enormous singing a long way off. Not a whale sample and not a whale: a
// throat (two formants) driven by a slow glide with a rough, sub-audio flutter, heard
// through 100+ units of water. The zone sets its register.
export function distantCall(E) {
  if (E.full()) return;
  const zi = E.S.zone | 0, p = farPoint(E, E.r(90, 170), E.r(-30, 10));
  const t = E.now() + 0.01, f0 = [E.r(110, 190), E.r(70, 120), E.r(38, 60)][zi];
  const up = E.r(1.2, 2.4), dn = E.r(2.2, 4.2), tot = up + dn + 0.6;
  const vg = E.emit('sfx', p.x, p.y, p.z, tot + 1, 0); if (!vg) return;
  const g = E.g(0, vg), f1 = E.f('bandpass', f0 * 3.1, 3, g), f2 = E.f('bandpass', f0 * 6.3, 5, g);
  const src = E.o('sawtooth', f0), rough = E.g(1);
  src.connect(rough); rough.connect(f1); rough.connect(f2);
  const q = src.frequency;
  q.setValueAtTime(f0, t); q.exponentialRampToValueAtTime(f0 * E.r(1.3, 1.8), t + up); q.exponentialRampToValueAtTime(f0 * E.r(0.6, 0.85), t + up + dn);
  E.mod(E.r(7, 13), 0.35, rough.gain, t, t + tot);          // the flutter: a big throat's grain
  E.mod(E.r(3.5, 5), E.r(10, 25), src.detune, t, t + tot);
  E.env(g.gain, t, up * 0.6, tot, E.r(0.2, 0.32) * KB.CALL);
  E.fire(src, t, t + tot, [rough, f1, f2, g]);
  E.log('distantCall', null, f0);
}

// A single deep knock: the trench settling on its own weight.
export function deepKnock(E) {
  if (E.full()) return;
  const p = farPoint(E, E.r(40, 110), E.r(-15, 5));
  const t = E.now() + 0.01, f0 = E.r(38, 62);
  const vg = E.emit('sfx', p.x, p.y, p.z, 2.6, 0); if (!vg) return;
  const g = E.g(0, vg), o = E.o('sine', f0, g);
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.55, t + 0.5);
  E.env(g.gain, t, 0.02, E.r(1.2, 2.2), E.r(0.15, 0.25));
  E.fire(o, t, t + 2.4, [g]);
  const ng = E.g(0, vg), nf = E.f('lowpass', 320, 1.4, ng);
  E.env(ng.gain, t, 0.01, 0.3, 0.08);
  E.fire(E.n('brown', 0.7, nf), t, t + 0.4, [nf, ng]);
  E.log('deepKnock', null, f0);
}

// The abyss's only small sound: something metallic cooling or straining far off —
// a single inharmonic tink, mostly tail.
export function abyssTick(E) {
  if (E.full()) return;
  const p = farPoint(E, E.r(50, 120), E.r(-20, 20));
  const t = E.now() + 0.01, f = E.r(900, 1700);
  const vg = E.emit('sfx', p.x, p.y, p.z, 2.5, 0); if (!vg) return;
  for (const [m, a, dk] of [[1, 1, 1.2], [2.76, 0.4, 0.6], [5.4, 0.15, 0.3]]) {
    const g = E.g(0, vg), o = E.o('sine', f * m, g);
    E.env(g.gain, t, 0.002, dk, 0.05 * a);
    E.fire(o, t, t + dk + 0.05, [g]);
  }
  E.log('abyssTick', null, f);
}

// ---- the boat: timber, canvas, water on the strakes ------------------------------
export function hullCreak(E, t = E.now(), force = 1, lvl = KB.DECK_CREAK, bus = E.B.deck) {
  if (E.full()) return;
  const dur = E.r(0.35, 1.1) * (0.7 + 0.5 * force), f0 = E.r(150, 420);
  const g = E.g(0, bus), am = E.g(0.5, g);
  const m2 = E.g(0.4, am), b1 = E.f('bandpass', f0, 7, am), b2 = E.f('bandpass', f0 * 2.7, 9, m2);
  b1.frequency.setValueAtTime(f0, t); b1.frequency.exponentialRampToValueAtTime(f0 * E.r(1.1, 1.6), t + dur);
  b2.frequency.setValueAtTime(f0 * 2.7, t); b2.frequency.exponentialRampToValueAtTime(f0 * 2.7 * E.r(1.1, 1.5), t + dur);
  const chat = E.mod(E.r(11, 18), 0.5, am.gain, t, t + dur + 0.05, 'sawtooth');
  chat.frequency.setValueAtTime(chat.frequency.value, t); chat.frequency.exponentialRampToValueAtTime(E.r(26, 48), t + dur);
  E.env(g.gain, t, dur * 0.3, dur, lvl * (0.6 + 0.4 * force));
  const nz = E.n('pink', 0.35); nz.connect(b1); nz.connect(b2);
  E.fire(nz, t, t + dur + 0.05, [b1, b2, m2, am, g]);
  const tg = E.g(0, bus), to = E.o('sine', 62, tg);
  to.frequency.setValueAtTime(62, t); to.frequency.exponentialRampToValueAtTime(38, t + 0.22);
  E.env(tg.gain, t, 0.008, 0.3, lvl * 0.45 * force);
  E.fire(to, t, t + 0.35, [tg]);
  E.log('hullCreak', null, f0);
}

// A wave slapping the strakes: a hollow knock (the hull a drum under it) and a spill.
export function hullSlap(E, t = E.now(), force = 1) {
  if (E.full()) return;
  const bus = E.B.deck, pan = E.pan(E.r(-0.7, 0.7), bus), lvl = KB.DECK_SLAP * force * E.r(0.4, 1);
  const g = E.g(0, pan), bp = E.f('bandpass', E.r(280, 620), 1.4, g);
  E.env(g.gain, t, 0.004, E.r(0.12, 0.25), lvl);
  const g2 = E.g(0, pan), o = E.o('sine', E.r(95, 140), g2);
  o.frequency.setValueAtTime(o.frequency.value, t); o.frequency.exponentialRampToValueAtTime(o.frequency.value * 0.7, t + 0.15);
  E.env(g2.gain, t, 0.003, 0.18, lvl * 0.5);
  const g3 = E.g(0, pan), hp = E.f('bandpass', E.r(1500, 2600), 0.9, g3);
  E.env(g3.gain, t + 0.03, 0.04, E.r(0.3, 0.6), lvl * 0.35);
  E.fire(E.n('pink', 1.1, bp), t, t + 0.3, [bp, g]);
  E.fire(o, t, t + 0.25, [g2]);
  E.fire(E.n('white', 0.9, hp), t + 0.03, t + 0.7, [hp, g3, pan]);
}

export function canvasLuff(E, t = E.now(), dur = 1.6, lvl = 0.05) {
  if (E.full()) return;
  const g = E.g(0, E.B.sail), am = E.g(0.5, g), lp = E.f('lowpass', 700, 0.8, am);
  lp.frequency.setValueAtTime(700, t); lp.frequency.linearRampToValueAtTime(1100, t + dur);
  const flap = E.mod(4, 0.5, am.gain, t, t + dur + 0.05, 'square');
  flap.frequency.setValueAtTime(4, t); flap.frequency.exponentialRampToValueAtTime(9, t + dur);
  E.mod(0.9, 1.2, flap.frequency, t, t + dur + 0.05);
  E.env(g.gain, t, dur * 0.35, dur, lvl);
  E.fire(E.n('pink', 0.6, lp), t, t + dur + 0.05, [lp, am, g]);
}
export function canvasSnap(E, t = E.now(), lvl = 0.16) {
  if (E.full()) return;
  const bus = E.B.sail;
  const cg = E.g(0, bus), hp = E.f('highpass', 1100, 0.7, cg);
  E.env(cg.gain, t, 0.002, 0.07, lvl * 0.7); E.fire(E.n('white', 1.1, hp), t, t + 0.12, [hp, cg]);
  const bg = E.g(0, bus), lp = E.f('lowpass', 260, 0.9, bg);
  lp.frequency.setValueAtTime(260, t); lp.frequency.exponentialRampToValueAtTime(120, t + 0.4);
  E.env(bg.gain, t + 0.01, 0.006, 0.45, lvl); E.fire(E.n('pink', 0.7, lp), t, t + 0.5, [lp, bg]);
  const wg = E.g(0, bus), wo = E.o('sine', 88, wg);
  wo.frequency.setValueAtTime(88, t); wo.frequency.exponentialRampToValueAtTime(44, t + 0.2);
  E.env(wg.gain, t, 0.005, 0.32, lvl * 0.8); E.fire(wo, t, t + 0.4, [wg]);
}
export function strakeWash(E, t = E.now(), dur = 6, lvl = 0.055) {
  if (E.full()) return;
  const tEnd = t + dur + 0.1, g = E.g(0, E.B.sail), pan = E.pan(E.r(-0.2, 0.2), g);
  E.mod(0.11, 0.3, pan.pan, t, tEnd);
  const am = E.g(0.6, pan), bp = E.f('bandpass', 900, 0.6, am);
  E.mod(0.35, 0.3, am.gain, t, tEnd); E.mod(0.53, 0.15, am.gain, t, tEnd); E.mod(0.3, 250, bp.frequency, t, tEnd);
  E.env(g.gain, t, dur * 0.25, dur, lvl);
  E.fire(E.n('pink', 0.8, bp), t, tEnd, [bp, am, pan, g]);
}
export function gull(E, t = E.now(), pan = 0.5, lvl = KB.GULL) {
  if (E.full()) return;
  const g = E.g(0, E.B.deck), p = E.pan(pan, g);
  const tone = E.f('lowpass', 3200, 0.7, p), bp = E.f('bandpass', 1500, 2.5, tone), o = E.o('triangle', 1500, bp);
  const k = E.r(0.92, 1.08);
  for (const q of [o.frequency, bp.frequency]) {
    q.setValueAtTime(1350 * k, t); q.exponentialRampToValueAtTime(2050 * k, t + 0.07);
    q.exponentialRampToValueAtTime(1750 * k, t + 0.16); q.exponentialRampToValueAtTime(950 * k, t + 0.42);
  }
  E.mod(27, 22, o.detune, t, t + 0.5);
  E.env(g.gain, t, 0.03, 0.45, lvl);
  E.fire(o, t, t + 0.5, [bp, tone, p, g]);
  E.log('gull');
}

// The passage as one score on the audio clock (game.js rings the bell at 2.3 s).
export function voyage(E, len = 6.2) {
  const t = E.now() + 0.01;
  strakeWash(E, t + 0.2, len - 0.4, 0.055);
  hullCreak(E, t + E.r(0.3, 0.5), 1.0, 0.11, E.B.sail);
  hullCreak(E, t + E.r(1.1, 1.4), 0.8, 0.11, E.B.sail);
  canvasLuff(E, t + 0.8, 1.6);
  hullCreak(E, t + E.r(1.9, 2.15), 0.9, 0.11, E.B.sail);
  canvasSnap(E, t + 2.55);
  hullCreak(E, t + E.r(3.5, 3.8), 0.6, 0.11, E.B.sail);
  hullCreak(E, t + E.r(4.9, 5.2), 0.45, 0.11, E.B.sail);
  for (let i = 0; i < 5; i++) hullSlap(E, t + 0.5 + i * E.r(0.8, 1.3), 0.8);
  if (KB.GULL_ON) { const s = E.r(0, 1) < 0.5 ? -1 : 1; gull(E, t + 4.85, 0.55 * s); }
  E.log('voyage');
}

// ---- thunder ---------------------------------------------------------------------------
// Placed at the strike and delayed by range at the speed of sound in air (1 unit = 3 m,
// so ~114 units/s). Near: a crack, a tearing, then the roll. Far: the roll only, lower.
// From under the water it arrives as a heavy, dull shove (the medium filter and the
// surface do that), and below ~120 units it does not arrive at all.
export function thunder(E, x, z, amp) {
  const I = E.in, dx = x - I.px, dz = z - I.pz, dist = Math.hypot(dx, dz, 200 - I.py);
  if (I.py < -120) return;
  const t = E.now() + Math.min(9, dist / 114), near = cl01(1 - dist / 700), lvl = KB.THUNDER * amp * mix(0.35, 1, near) * E.startle;
  const roll = E.r(3, 7) * mix(1.3, 0.8, near);
  const vg = E.emit('sfx', x, 180, z, (t - E.now()) + roll + 1.5, 2); if (!vg) return;
  if (near > 0.45) {
    const cg = E.g(0, vg), hp = E.f('highpass', 1800, 0.7, cg);
    E.env(cg.gain, t, 0.002, 0.08, lvl * 0.8);
    E.fire(E.n('white', 1, hp), t, t + 0.15, [hp, cg]);
    const tg = E.g(0, vg), tb = E.f('bandpass', 900, 0.8, tg), am = E.g(0.5); am.connect(tb);
    E.mod(E.r(30, 60), 0.5, am.gain, t, t + 0.7, 'square');
    E.env(tg.gain, t + 0.02, 0.03, 0.6, lvl * 0.5);
    const nz = E.n('pink', 1); nz.connect(am);
    E.fire(nz, t, t + 0.75, [am, tb, tg]);
  }
  // the roll: brown noise through a falling low-pass, amplitude built from overlapping swells
  const rg = E.g(0, vg), lp = E.f('lowpass', mix(380, 900, near), 0.7, rg);
  lp.frequency.setValueAtTime(lp.frequency.value, t); lp.frequency.exponentialRampToValueAtTime(120, t + roll);
  rg.gain.setValueAtTime(0, t);
  let tt = t;
  const n = 3 + Math.floor(E.r(0, 4));
  for (let i = 0; i < n; i++) {
    const pk = lvl * E.r(0.4, 1) * (1 - i / (n + 1));
    tt += E.r(0.15, roll / n);
    rg.gain.linearRampToValueAtTime(pk, tt);
    rg.gain.linearRampToValueAtTime(pk * 0.35, tt + E.r(0.3, 0.8));
  }
  rg.gain.linearRampToValueAtTime(0, t + roll + 1);
  E.fire(E.n('brown', 0.7, lp), t, t + roll + 1.1, [lp, rg]);
  const sg = E.g(0, vg), so = E.o('sine', 34, sg);
  E.env(sg.gain, t + 0.05, 0.25, roll * 0.6, lvl * 0.4 * near);
  E.fire(so, t, t + roll, [sg]);
  if (near > 0.3) E.duck('amb', 0.75, 0.1, roll * 0.5, t);
  E.log('thunder', null, dist);
}

// ---- the pump ----------------------------------------------------------------------------
function pumpThump(E, t, spd) {
  const b = E.bed, f0 = mix(42, 56, spd) * E.r(0.985, 1.015);
  const g = E.g(0, b.pumpBus), o = E.o('sine', f0, g);
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.5, t + 0.12);
  E.env(g.gain, t, 0.005, 0.16 + 0.06 * (1 - spd), 0.11 + 0.16 * spd);
  E.fire(o, t, t + 0.28, [g]);
  // the exhaust bark of a hot-bulb engine: a short low noise pop
  const ng = E.g(0, b.pumpBus), nf = E.f('bandpass', 140, 1.5, ng);
  E.env(ng.gain, t + 0.01, 0.004, 0.09, 0.05 + 0.06 * spd);
  E.fire(E.n('brown', 1, nf), t, t + 0.14, [nf, ng]);
  const p = b.pumpPulse.gain;
  E.hold(p, t); p.linearRampToValueAtTime(1 + 0.55 * spd, t + 0.02); p.setTargetAtTime(1, t + 0.02, 0.08);
  if (E.sal) E.sal.inflowStroke(t, spd);    // the stroke reaches the helmet as a pulse of air
}
// Strokes laid on the audio clock inside a short lookahead: timer jitter never reaches
// the beat. As speed sags the interval stretches — slowing, faltering, then simply not
// firing again, which is how a heavy engine actually dies.
function pumpTick(E) {
  const b = E.bed, t = E.now(), spd = E.S.pumpSpd;
  if (b.pNext < t - 0.5) b.pNext = t + 0.02;
  while (b.pNext < t + 0.25) {
    b.pRate += (1.4 * spd - b.pRate) * 0.5;
    if (b.pRate <= 0.05) { b.pNext += 0.26; continue; }
    if (!E.full()) pumpThump(E, b.pNext, spd);
    b.pNext += (1 / b.pRate) * E.r(0.97, 1.03);
  }
}
export function mixPump(E) {
  const b = E.bed, S = E.S, spd = S.pumpSpd, a = S.above, R = (k, p, v, tc) => E.ramp(k, p, v, tc);
  b.pumpEm.lvl = KB.PUMP * a;
  R('phose', b.pumpHose.gain, KB.PUMP_HOSE * 0.13 * (1 - a) * (1 - 0.45 * S.depth), 0.4);
  R('pmech', b.pumpMech.gain, 0.0001 + 0.18 * Math.pow(spd, 0.8), 0.35);
  R('pmlp', b.pumpMechLP.frequency, mix(150, 320, spd), 0.5);
  R('phiss', b.pumpHiss.gain, 0.0001 + 0.02 * spd * spd, 0.4);
}
