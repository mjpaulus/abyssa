// ---------------------------------------------------------------------------
// ABYSSA — every sound is synthesised here; the project ships no audio assets.
// OWNED BY: audio agent.
//
// game.js already calls initAudio() / chime(freq,dur,vol[,kind]) / growl(). Everything
// else is driven by a 20 Hz internal loop that reads `player` and `window.zone
// |lev` directly, so the whole mix is live with no extra wiring needed.
//
// OPTIONAL HOOKS — wiring any of these makes it tighter. Each latches on first
// call and from then on overrides the internal derivation:
//   setDepth(d01)      every frame  — game.js already computes `depth01`
//   setProximity(p01)  every frame  — 0 leviathan far, 1 on top of you
//   setLight(l01)      every frame  — player.light (breath rate + dying-lamp whine)
//   setAir(a01)        every frame  — remaining air, once that system exists
//   setSpeed(u)        every frame  — player.vel.length(), for water rush
//   setWalking(bool)   every frame  — player.grounded
//   setAbove(bool)     every frame  — head above the waterline (deck bed vs pressure bed)
//   setWind(w01)       every frame  — eased wind 0..1 (water.js windState().speed)
//   footstep()         once per bootfall (self-limits to ~6/s)
//   setZone(i)         first line of enterZone(i), BEFORE growl()
//   slam()             when updateLeviathan returns ev.slam (self rate-limits)
//   setCalm(0|1)       on ev.calmed, back to 0 on respawn
//   setPump(spd01,lvl01) every frame — raft engine: 0..1 revs, 0..1 audibility by distance
//   voyage()           at startVoyage(): the whole passage, scheduled on the audio clock
//   chime(f,dur,vol,kind) kind ∈ pickup|craft|ward|calm|voyage|ending — see chime()
//
// DEV SURFACE: window.__audio — knobs (.k), per-bus trims/mutes, every one-shot by
// name (.fire), an event log with audio-clock timestamps, a master peak meter.
// ---------------------------------------------------------------------------

// ---- KNOBS ---------------------------------------------------------------
// Every level the ear pass may want to move, in one place. Live-pokeable:
// window.__audio.k.NAME = v. One-shots read at fire time; beds on the next tick.
export const K = {
  MASTER: 0.62,                                   // master fader (after the 3.5 s fade-in)
  OUT_TRIM: 0.92,                                 // post-limiter trim into the destination
  LIMIT_THRESH: -8, LIMIT_KNEE: 6, LIMIT_RATIO: 8, LIMIT_ATK: 0.004, LIMIT_REL: 0.3,
  REVERB: 0.45,                                   // wet return

  // voyage programme — offsets are seconds after voyage() on the audio clock
  VOY_LEN: 6.2,
  VOY_CREAK: 0.11,                                // hull creaks as the chain comes home
  VOY_LUFF: 0.05,                                 // canvas luffing before she takes the wind
  VOY_SNAP: 0.16,                                 // the sail filling, just after the bell
  VOY_WASH: 0.055,                                // water along the strakes, the whole passage
  VOY_GULL: 0.028,                                // a distant gull as the black lifts
  VOY_GULL_ON: 1,                                 // 0 kills the gulls if they read cheap

  // deck bed — the air regime (wind in the rigging, water lapping the hull)
  DECK: 1.0,                                      // regime fader ceiling
  DECK_WIND: 0.10,
  DECK_GUST: 0.03,                                // the high whistle, wind^2
  DECK_LAP: 0.045,
  DECK_CREAK: 0.06,                               // ambient hull creak level on deck
  DECK_CREAK_MIN: 2, DECK_CREAK_MAX: 6,           // seconds between creaks
  DECK_DRONE_CUT: 0.30,                           // pressure drone multiplier above water
  DECK_WATER_CUT: 0.55,                           // water-movement bed multiplier above water

  // chime family — multipliers on the caller's vol
  CH_PICKUP: 0.9, CH_CRAFT: 0.8, CH_WARD: 1, CH_CALM: 1, CH_VOYAGE: 1.1, CH_ENDING: 1.1, CH_SPARK: 1,

  // bus trims (dry and wet together); __audio.mute() drives these to 0 and back
  BUS: { bed: 1, helmet: 1, lev: 1, events: 1, pump: 1, chime: 1, deck: 1, sail: 1 }
};

let AC = null, live = 0, muted = false;
let master, dry, revIn, revWet, revTone, preDelay, tailGA, tailGB, limiter, outTrim, meter;
let droneLP, droneGain, noiseLP, noiseGain, surfGain, shimGain, subGain, bedDuck, bedWet;
let helmetIn, breathGain, whineGain, moveGain, moveBP;
let levBus, levLP, threatGain, tenseGain, chimeBus;
let pumpBus, pumpMechGain, pumpMechLP, pumpMechPulse, pumpHissGain;
let deckIn, windGain, windBP, gustGain, lapGain;
let noiseBuf, drones = [];
const BUSES = {};
let BED, HELM, LEV, EV, PUMP, CHIME, DECK, SAIL;

const rnd = (a, b) => a + Math.random() * (b - a);
const cl01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => a + (b - a) * t;

// Targets are written by hooks or drive(); S holds the smoothed values.
const S = { depth: 0, prox: 0, light: 1, air: 1, calm: 0, speed: 0, above: 0, wind: 0, walking: false };
const T = { depth: 0, prox: 0, light: 1, air: 1, calm: 0, speed: 0, above: 0, wind: 0 };
const SMOOTH = ['depth', 'prox', 'light', 'air', 'calm', 'speed', 'above', 'wind'];  // hoisted: drive() allocates nothing
const manual = {};
let zi = 0, growls = 0, sigilStep = 0;
let lastChime = -9, chordIdx = 0, chordOct = 1, lastSlam = -9, lastStep = -9;

// D aeolian / C phrygian / A phrygian-dominant: the trench darkens as you fall,
// and the last zone's tonic triad is major, so the ending resolves brighter.
const SCALES = [
  { root: 146.83, deg: [0, 2, 3, 5, 7, 8, 10] },
  { root: 130.81, deg: [0, 1, 3, 5, 7, 8, 10] },
  { root: 110.00, deg: [0, 1, 4, 5, 7, 8, 10] }
];
const DRONE_ROOT = [36.71, 32.70, 27.50];
const MOTIF = [0, 2, 3, 5, 4, 6, 7, 8]; // scale steps above SIGIL_BASE: climbs, then leans back
const SIGIL_BASE = 11;
// [ratio, amplitude, decay-scale] partial sets: one bell family, several voices
const BELL = [[0.5, 0.30, 1.5], [1, 1, 1], [2.0, 0.40, 0.72], [2.76, 0.26, 0.52], [4.07, 0.14, 0.38], [5.43, 0.08, 0.28]];
const BELL_BRIGHT = [[0.5, 0.22, 1.5], [1, 1, 1], [2.0, 0.55, 0.8], [2.76, 0.32, 0.56], [4.07, 0.22, 0.42], [5.43, 0.12, 0.3], [8.2, 0.05, 0.2]];
const SPARK = [[1, 1, 1], [2.76, 0.34, 0.5], [5.43, 0.16, 0.3]];
const TAP = [[1, 1, 1], [1.58, 0.42, 0.6], [2.4, 0.2, 0.4]];   // dull, inharmonic: a damped brass fitting

// ---- event log (dev surface) ---------------------------------------------
const LOG = [];
let trace = false;
function logEv(name, kind, at, f) {
  if (LOG.length >= 96) LOG.shift();
  const e = { t: AC ? AC.currentTime : 0, at, name, kind, f };
  LOG.push(e);
  if (trace) console.log('[audio]', name, kind || '', 'at', at.toFixed(3), f ? f.toFixed(1) : '');
}

// ---- node factories ------------------------------------------------------
const now = () => AC.currentTime;
function gain(v, dest) { const g = AC.createGain(); g.gain.value = v; if (dest) g.connect(dest); return g; }
function filt(type, f, q, dest) {
  const b = AC.createBiquadFilter(); b.type = type; b.frequency.value = f;
  if (q != null) b.Q.value = q; if (dest) b.connect(dest); return b;
}
function osc(type, f, dest) { const o = AC.createOscillator(); o.type = type; o.frequency.value = f; if (dest) o.connect(dest); return o; }
function noise(rate, dest) {
  const n = AC.createBufferSource(); n.buffer = noiseBuf; n.loop = true;
  n.playbackRate.value = rate; if (dest) n.connect(dest); return n;
}
// Permanent modulator welded onto a param. Never point one at a param that
// applyMix() also ramps — use a serial gain node instead, or the LFO depth
// swamps the mix target (and can drive gains negative).
function lfo(rate, depth, param, type = 'sine') {
  const o = osc(type, rate), g = gain(depth, param);
  o.connect(g); o.start(now() + Math.random() * 4); return o;
}
// Temporary modulator for a one-shot: lives from t0 to t1, then tears itself down.
function mod(rate, depth, param, t0, t1, type = 'sine') {
  const o = osc(type, rate), g = gain(depth, param);
  o.connect(g); fire(o, t0, t1, [g]); return o;
}
// Named bus: a dry trim into the master and a wet trim into the reverb. The dev
// surface mutes/trims these; every voice reaches the outside through one of them.
function mkBus(name) { const b = { name, dry: gain(1, dry), wet: gain(1, revIn) }; BUSES[name] = b; return b; }
// One-shot send: g -> [d] -> bus.dry, g -> [w] -> bus.wet. Both taps join the
// chain so fire() tears them down with the voice instead of leaving them on the bus.
function sends(g, d, w, b, chain) {
  const a = gain(d, b.dry); g.connect(a); if (chain) chain.push(a);
  if (w > 0) { const c = gain(w, b.wet); g.connect(c); if (chain) chain.push(c); }
  return g;
}
function env(p, t0, atk, dur, peak) {
  p.setValueAtTime(0.0001, t0);
  p.linearRampToValueAtTime(peak, t0 + atk);
  p.exponentialRampToValueAtTime(0.0001, t0 + Math.max(dur, atk + 0.02));
}
// Start/stop a source, then drop its chain so the graph can be collected.
function fire(src, t0, tEnd, chain) {
  src.start(t0); src.stop(tEnd); live++;
  src.onended = () => { live--; src.disconnect(); if (chain) for (const n of chain) n.disconnect(); };
  return src;
}
const lastV = new Map();
function ramp(key, p, v, tc = 0.25) {
  const prev = lastV.get(key);
  if (prev !== undefined && Math.abs(prev - v) <= Math.max(1e-4, Math.abs(v) * 0.012)) return;
  lastV.set(key, v); p.setTargetAtTime(v, now(), tc);
}
// Cut any pending automation at t and ANCHOR the current value there. The anchor
// is load-bearing: a ramp with no preceding event renders as a jump at its end
// time in Chrome (measured: cancelAndHoldAtTime alone on an idle param turned the
// slam duck's 50 ms fall into a cliff). setValueAtTime(value, t) is the anchor.
function hold(p, t) {
  p.cancelScheduledValues(t);
  p.setValueAtTime(p.value, t);
}
function glide(p, v, dur) {
  const t = now();
  hold(p, t);
  p.exponentialRampToValueAtTime(Math.max(0.0001, v), t + dur);
}

// ---- procedural impulse response ----------------------------------------
// Decaying noise through a one-pole cascade whose corner falls across the tail:
// early reflections stay bright, the late field goes to mud. Normalised to unit
// energy per channel so send gains mean what they say.
function makeIR(dur, decay) {
  const n = Math.floor(AC.sampleRate * dur), buf = AC.createBuffer(2, n, AC.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let a1 = 0, a2 = 0, sum = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n, k = 0.22 - 0.185 * t;
      const w = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      a1 += k * (w - a1); a2 += k * (a1 - a2);
      d[i] = a2; sum += a2 * a2;
    }
    for (let r = 0; r < 14; r++) {           // sparse early taps: walls, not wash
      const i = Math.floor(rnd(0.004, 0.13) * AC.sampleRate);
      d[i] += rnd(-0.5, 0.5) * Math.pow(1 - i / n, decay);
    }
    const g = 1 / Math.sqrt(sum || 1);
    for (let i = 0; i < n; i++) d[i] *= g;
  }
  return buf;
}

// ---- graph ---------------------------------------------------------------
function build() {
  // master chain: master fader -> limiter -> out trim -> destination (+ meter tap)
  limiter = AC.createDynamicsCompressor();
  limiter.threshold.value = K.LIMIT_THRESH; limiter.knee.value = K.LIMIT_KNEE; limiter.ratio.value = K.LIMIT_RATIO;
  limiter.attack.value = K.LIMIT_ATK; limiter.release.value = K.LIMIT_REL;
  outTrim = gain(K.OUT_TRIM, AC.destination);
  limiter.connect(outTrim);
  meter = AC.createAnalyser(); meter.fftSize = 1024; outTrim.connect(meter);   // read-only tap, no output
  master = gain(0.0001, limiter);
  master.gain.linearRampToValueAtTime(K.MASTER, now() + 3.5); // no click on the first frame
  dry = gain(1, master);

  const NL = Math.floor(AC.sampleRate * 6);   // one hitch at game start, never again
  noiseBuf = AC.createBuffer(2, NL, AC.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = noiseBuf.getChannelData(c);
    for (let i = 0; i < NL; i++) d[i] = Math.random() * 2 - 1;
  }

  // Reverb: convolved body in parallel with a cross-coupled delay pair whose
  // feedback — and so tail length — opens up as the trench deepens.
  revWet = gain(K.REVERB, master);
  revIn = gain(1);
  revTone = filt('lowpass', 2600, 0.7, revWet);
  const conv = AC.createConvolver();
  conv.normalize = false; conv.buffer = makeIR(3.6, 2.4);
  preDelay = AC.createDelay(0.4); preDelay.delayTime.value = 0.055;
  revIn.connect(preDelay); preDelay.connect(conv); conv.connect(revTone);

  const dA = AC.createDelay(1), dB = AC.createDelay(1);
  dA.delayTime.value = 0.311; dB.delayTime.value = 0.487;
  const lpA = filt('lowpass', 900, 0.6), lpB = filt('lowpass', 760, 0.6);
  tailGA = gain(0.42); tailGB = gain(0.42);
  revIn.connect(dA); revIn.connect(dB);
  dA.connect(lpA); lpA.connect(tailGA); tailGA.connect(dB);
  dB.connect(lpB); lpB.connect(tailGB); tailGB.connect(dA);
  const panL = AC.createStereoPanner(), panR = AC.createStereoPanner();
  panL.pan.value = -0.75; panR.pan.value = 0.75;
  lpA.connect(panL); lpB.connect(panR);
  panL.connect(gain(0.3, revWet)); panR.connect(gain(0.3, revWet));
  lfo(0.037, 0.0016, dA.delayTime); lfo(0.029, 0.0021, dB.delayTime); // kills metallic ring

  BED = mkBus('bed'); HELM = mkBus('helmet'); LEV = mkBus('lev'); EV = mkBus('events');
  PUMP = mkBus('pump'); CHIME = mkBus('chime'); DECK = mkBus('deck'); SAIL = mkBus('sail');

  // ---- pressure drone: stacked partials on a root that drops per zone ----
  bedDuck = gain(1, BED.dry);                // event ducking only (growl/slam)
  bedWet = gain(0.32, BED.wet);
  droneGain = gain(0.9); droneLP = filt('lowpass', 1200, 0.6);
  droneGain.connect(droneLP); droneLP.connect(bedDuck); droneLP.connect(bedWet);
  const PART = [
    [1, 0.22, 'sine', 0.013, 6], [1.5, 0.085, 'sine', 0.019, 9], [2, 0.16, 'sine', 0.023, 5],
    [3, 0.055, 'triangle', 0.029, 11], [4, 0.032, 'triangle', 0.037, 14], [6, 0.011, 'sine', 0.041, 18]
  ];
  for (const [r, g0, ty, mr, md] of PART) {
    const o = osc(ty, DRONE_ROOT[0] * r), vg = gain(g0, droneGain);
    o.connect(vg); o.start();
    lfo(mr, md, o.detune);                        // incommensurate rates: never repeats
    lfo(mr * 1.63 + 0.007, g0 * 0.42, vg.gain);   // the spectrum breathes too
    drones.push({ o, r });
  }
  const subHeave = gain(0.85, droneGain);         // serial, so applyMix owns subGain alone
  subGain = gain(0.0001, subHeave);
  osc('sine', 21.5, subGain).start();
  lfo(0.077, 0.15, subHeave.gain);

  // ---- water movement: two noise layers at incommensurate playback rates ----
  noiseGain = gain(0.9); noiseLP = filt('lowpass', 2600, 0.5);
  const nHP = filt('highpass', 42, 0.7);
  noiseGain.connect(noiseLP); noiseLP.connect(nHP); nHP.connect(bedDuck); nHP.connect(bedWet);
  const wLowG = gain(0.11, noiseGain), wLow = filt('lowpass', 210, 1.1, wLowG);
  noise(0.83, wLow).start();
  lfo(0.021, 90, wLow.frequency); lfo(0.031, 0.045, wLowG.gain);
  const wMidG = gain(0.05, noiseGain), wMid = filt('bandpass', 340, 0.8, wMidG);
  noise(1.0, wMid).start();
  lfo(0.017, 170, wMid.frequency); lfo(0.043, 0.022, wMidG.gain);

  const surfSwell = gain(0.7, noiseGain);
  surfGain = gain(0.0001, surfSwell);
  const surf = filt('bandpass', 620, 0.5, surfGain);
  noise(0.42, surf).start();
  lfo(0.071, 0.45, surfSwell.gain); lfo(0.053, 260, surf.frequency);

  const shimSwell = gain(0.7);
  shimSwell.connect(gain(0.6, BED.dry)); shimSwell.connect(gain(0.9, BED.wet));
  shimGain = gain(0.0001, shimSwell);
  const shim = filt('highpass', 2400, 0.7, shimGain);
  noise(1.7, shim).start();
  lfo(0.11, 0.4, shimSwell.gain);

  // ---- deck: the air regime. Same vocabulary (filtered noise, slow swells), a
  // different room: wind finding the rigging, the sea lapping the strakes. deckIn
  // is the regime fader; applyMix crossfades it against the pressure bed by S.above.
  deckIn = gain(0.0001);
  deckIn.connect(gain(1, DECK.dry)); deckIn.connect(gain(0.3, DECK.wet));
  windGain = gain(0.0001, deckIn);
  const windSwell = gain(0.7, windGain);                      // serial: the LFOs own this one
  lfo(0.083, 0.26, windSwell.gain); lfo(0.21, 0.13, windSwell.gain);
  windBP = filt('bandpass', 300, 0.45, windSwell);
  noise(0.7, windBP).start();
  lfo(0.047, 60, windBP.frequency);
  gustGain = gain(0.0001, deckIn);                            // the thin whistle in the stays
  const gustSwell = gain(0.55, gustGain);
  lfo(0.17, 0.4, gustSwell.gain);
  const gustBP = filt('bandpass', 1400, 0.5, gustSwell);
  noise(1.4, gustBP).start();
  lfo(0.031, 350, gustBP.frequency);
  lapGain = gain(0.0001, deckIn);                             // water slapping the planking
  const lapSwell = gain(0.55, lapGain);
  lfo(0.27, 0.38, lapSwell.gain); lfo(0.41, 0.15, lapSwell.gain);
  const lapBP = filt('bandpass', 760, 0.9, lapSwell);
  noise(0.9, lapBP).start();
  lfo(0.19, 240, lapBP.frequency);

  // ---- diver: everything he makes is heard from inside a copper helmet ----
  helmetIn = gain(1);
  const h1 = filt('peaking', 430, 1.1), h2 = filt('peaking', 1180, 1.4), h3 = filt('lowpass', 3200, 0.9);
  h1.gain.value = 7; h2.gain.value = 5;
  helmetIn.connect(h1); h1.connect(h2); h2.connect(h3);
  h3.connect(gain(0.85, HELM.dry)); h3.connect(gain(0.22, HELM.wet));
  breathGain = gain(1, helmetIn);

  moveGain = gain(0.0001, helmetIn);              // water rushing past the helmet
  moveBP = filt('bandpass', 420, 0.7, moveGain);
  noise(1.2, moveBP).start();

  const flick = gain(0.6, helmetIn);              // failing filament, near-dead lantern only
  whineGain = gain(0.0001, flick);
  const wf = filt('bandpass', 3100, 6, whineGain);
  osc('sawtooth', 3100, wf).start();
  lfo(9.3, 0.4, flick.gain); lfo(0.31, 90, wf.frequency);

  // ---- leviathan: the lowpass doubles as a distance cue ----
  levBus = gain(1); levLP = filt('lowpass', 420, 0.8);
  levBus.connect(levLP);
  levLP.connect(gain(0.55, LEV.dry)); levLP.connect(gain(1.0, LEV.wet));

  threatGain = gain(0.0001);
  threatGain.connect(gain(0.8, LEV.dry)); threatGain.connect(gain(0.7, LEV.wet));
  const th = osc('sine', 24.5, threatGain); th.start();
  lfo(0.19, 2.2, th.frequency);
  const thN = filt('bandpass', 58, 3.5, gain(0.7, threatGain));
  noise(0.55, thN).start();
  lfo(0.13, 16, thN.frequency);

  // two close partials beating: dread you feel before you hear
  tenseGain = gain(0.0001, gain(0.5, LEV.dry));
  osc('sine', 466.16, tenseGain).start();
  osc('sine', 493.88, tenseGain).start();

  // ---- raft pump: single-cylinder oil engine belt-driving the compressor ----
  // A surface machine, not a diver sound — same dry/reverb split as the leviathan
  // bus, never helmetIn. Deliberately outside bedDuck: growl/slam happen to Sal at
  // depth and have no physical reach to a wooden deck above, and the pump's own
  // death (fuel-out) has to read clean, not folded into a leviathan-event dip.
  // level01 sets the one output fader below; speed01 shapes everything upstream
  // of it, so distance and engine-state never multiply into a squared falloff.
  pumpBus = gain(0.0001);
  pumpBus.connect(gain(0.5, PUMP.dry));
  pumpBus.connect(gain(0.65, PUMP.wet));

  pumpMechPulse = gain(1, pumpBus);              // per-stroke accent, retriggered by the thump
  pumpMechGain = gain(0.0001, pumpMechPulse);    // belt/compressor/bearing rumble
  pumpMechLP = filt('lowpass', 160, 0.9, pumpMechGain);
  noise(0.5, pumpMechLP).start();

  pumpHissGain = gain(0.0001, pumpBus);          // compressor delivery — the one bright thread
  const pumpHissBP = filt('bandpass', 3400, 1.1, pumpHissGain);
  noise(1.3, pumpHissBP).start();

  chimeBus = gain(1);
  chimeBus.connect(gain(0.75, CHIME.dry)); chimeBus.connect(gain(0.9, CHIME.wet));
}

// ---- one-shot voices -----------------------------------------------------
function bubble(t0, f0, f1, dur, vol, dest, pan = 0) {
  const p = AC.createStereoPanner(); p.pan.value = pan; p.connect(dest);
  const g = gain(0, p), o = osc('sine', f0, g);
  o.frequency.setValueAtTime(f0, t0);   // anchor: bubbles are scheduled ahead of now
  o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  env(g.gain, t0, 0.006, dur, vol);
  fire(o, t0, t0 + dur + 0.02, [g, p]);
}

function breathCycle(stressIn = -1) {
  const stress = stressIn >= 0 ? cl01(stressIn) : cl01(Math.max(S.prox * 0.9, 1 - S.light, 1 - S.air));
  // Self-schedules as a fallback; while the diver's breath clock is running, game.js
  // pre-empts this timer every cycle via syncBreath() so the regulator sound, the
  // shoulder rise and the exhaust bubbles all share one phase.
  clearTimeout(breathTimer);
  breathTimer = setTimeout(breathCycle, (mix(5.4, 2.9, stress) + rnd(-0.3, 0.3)) * 1000);
  if (!AC || muted || AC.state !== 'running') return;
  const t = now(), lvl = 0.055 + 0.045 * stress;

  const inD = 1.15 - 0.35 * stress;
  const ig = gain(0, breathGain), ib = filt('bandpass', 300, 1.5, ig);
  ib.frequency.exponentialRampToValueAtTime(880, t + inD);
  env(ig.gain, t, inD * 0.55, inD * 1.25, lvl);
  fire(noise(0.9, ib), t, t + inD * 1.4, [ib, ig]);

  const t2 = t + inD + 0.35 - 0.15 * stress, exD = 1.5 - 0.4 * stress;
  const eg = gain(0, breathGain), eb = filt('bandpass', 950, 1.2, eg);
  eb.frequency.setValueAtTime(950, t2);   // the exhale is scheduled ahead of now
  eb.frequency.exponentialRampToValueAtTime(240, t2 + exD);
  env(eg.gain, t2, 0.18, exD, lvl * 1.15);
  fire(noise(0.75, eb), t2, t2 + exD + 0.1, [eb, eg]);

  const nB = 5 + Math.floor(Math.random() * 5);   // exhaust climbing away from the helmet
  for (let i = 0; i < nB; i++) {
    const f = rnd(340, 760);
    bubble(t2 + 0.05 + i * rnd(0.05, 0.13), f, f * rnd(1.7, 2.6), rnd(0.05, 0.1),
      rnd(0.03, 0.075), helmetIn, rnd(-0.4, 0.4));
  }
}

// Heavy lead boot: pitched thud, sediment puff, and three struck-metal modes.
function step(force) {
  if (!AC || muted || live > 90) return;
  const t = now();
  if (t - lastStep < 0.16) return;
  lastStep = t;
  const v = 0.55 + 0.45 * force;

  const tg = gain(0, HELM.dry), to = osc('sine', 74, tg);
  to.frequency.exponentialRampToValueAtTime(34, t + 0.13);
  env(tg.gain, t, 0.006, 0.3, 0.22 * v);
  fire(to, t, t + 0.34, [tg]);

  const nz = noise(1, null), chain = [nz];       // one burst feeds silt and resonators
  const sg = gain(0, HELM.dry), sf = filt('lowpass', 430, 0.9, sg);
  nz.connect(sf); env(sg.gain, t, 0.008, 0.26, 0.05 * v); chain.push(sf, sg);
  const clank = gain(1, helmetIn); chain.push(clank);
  const j = rnd(0.94, 1.07);
  for (const [f, a, d] of [[1170, 0.09, 0.34], [1860, 0.055, 0.22], [2680, 0.03, 0.15]]) {
    const bp = filt('bandpass', f * j, 16), bg = gain(0, clank);
    nz.connect(bp); bp.connect(bg);
    env(bg.gain, t, 0.004, d, a * v);
    chain.push(bp, bg);
  }
  fire(nz, t, t + 0.4, chain);
}

// Metal under pressure: a resonance that slides while stick-slip chatters on top.
function suitCreak() {
  schedCreak();
  if (!AC || muted || AC.state !== 'running') return;
  const t = now(), dur = rnd(0.9, 2.3), f0 = rnd(210, 680);
  const g = gain(0, helmetIn), am = gain(1, g), bp = filt('bandpass', f0, 9, am);
  bp.frequency.exponentialRampToValueAtTime(f0 * rnd(0.7, 1.45), t + dur);
  const chatG = gain(0.55, am.gain), chat = osc('sine', rnd(9, 21), chatG);
  chat.frequency.exponentialRampToValueAtTime(rnd(3, 7), t + dur);
  env(g.gain, t, dur * 0.35, dur, rnd(0.05, 0.11) * (0.5 + S.depth));
  fire(chat, t, t + dur + 0.05, [chatG]);
  fire(noise(0.3, bp), t, t + dur + 0.05, [bp, am, g]);

  const og = gain(0, helmetIn), o = osc('triangle', rnd(58, 124), og);
  o.frequency.exponentialRampToValueAtTime(o.frequency.value * rnd(0.85, 1.1), t + dur);
  env(og.gain, t, dur * 0.4, dur, 0.035);
  fire(o, t, t + dur + 0.05, [og]);
  logEv('suitCreak', null, t);
}

// Rock shifting somewhere out in the dark: almost entirely reverb.
function rockGroan() {
  schedGroan();
  if (!AC || muted || AC.state !== 'running') return;
  const t = now(), dur = rnd(4, 8), f0 = rnd(40, 78);
  const chain = [], g = gain(0), lp = filt('lowpass', 165, 7, g);
  sends(g, 0.16, 1.0, EV, chain); chain.push(lp, g);
  const o = osc('sawtooth', f0, lp);
  o.frequency.exponentialRampToValueAtTime(f0 * rnd(0.58, 0.8), t + dur);
  lp.frequency.exponentialRampToValueAtTime(rnd(70, 120), t + dur);
  env(g.gain, t, dur * 0.3, dur, rnd(0.1, 0.2));
  fire(o, t, t + dur + 0.1, chain);

  const ch2 = [], rg = gain(0), rb = filt('bandpass', 190, 2.2, rg);
  sends(rg, 0.1, 0.8, EV, ch2); ch2.push(rb, rg);
  env(rg.gain, t + dur * 0.2, 0.4, dur * 0.7, 0.04);
  fire(noise(0.45, rb), t + dur * 0.2, t + dur, ch2);
  logEv('rockGroan', null, t);
}

// Something enormous singing, far enough away that mostly the reverb arrives.
function distantCall() {
  schedCall();
  if (!AC || muted || AC.state !== 'running') return;
  const t = now(), f0 = rnd(130, 300), up = rnd(0.9, 1.8), dn = rnd(1.6, 3.4);
  const g = gain(0), lp = filt('lowpass', 820, 0.8, g);
  const chain = [lp, g], parts = [];
  sends(g, 0.085, 1.1, EV, chain);
  for (const [m, a] of [[1, 1], [2, 0.3], [3, 0.1]]) {
    const vg = gain(a, lp), o = osc('sine', f0 * m, vg);
    o.frequency.exponentialRampToValueAtTime(f0 * m * rnd(1.4, 2.1), t + up);
    o.frequency.exponentialRampToValueAtTime(f0 * m * rnd(0.55, 0.85), t + up + dn);
    mod(rnd(3.8, 5.6), rnd(8, 20), o.detune, t, t + up + dn + 0.5);
    parts.push(o); chain.push(vg);
  }
  env(g.gain, t, up * 0.55, up + dn + 0.4, rnd(0.14, 0.26));
  for (let i = 0; i < parts.length; i++) fire(parts[i], t, t + up + dn + 0.5, i ? null : chain);
  logEv('distantCall', null, t, f0);
}

// A single deep knock, like the trench settling on its own weight.
function deepKnock() {
  schedKnock();
  if (!AC || muted || AC.state !== 'running') return;
  const t = now(), f0 = rnd(38, 62);
  const chain = [], g = gain(0);
  sends(g, 0.4, 1.0, EV, chain); chain.push(g);
  const o = osc('sine', f0, g);
  o.frequency.exponentialRampToValueAtTime(f0 * 0.55, t + 0.5);
  env(g.gain, t, 0.02, rnd(1.2, 2.2), rnd(0.1, 0.22));
  fire(o, t, t + 2.4, chain);
  const ch2 = [], ng = gain(0), nf = filt('lowpass', 320, 1.4, ng);
  sends(ng, 0.3, 0.8, EV, ch2); ch2.push(nf, ng);
  env(ng.gain, t, 0.01, 0.3, 0.05);
  fire(noise(0.7, nf), t, t + 0.4, ch2);
  logEv('deepKnock', null, t, f0);
}

// ---- the boat: timber, canvas, water on the strakes ------------------------
// Shared by the voyage programme and the on-deck ambient; every voice takes an
// absolute audio-clock time so the passage can be laid out ahead as one score.

// Timber under strain: a stick-slip chatter gating a wooden body resonance that
// rises as the tension does, with a low settle as the strake takes the load.
// Not the suit creak (that is brass, inside the helmet); this is the hull, outside.
function hullCreak(t = now(), force = 1, lvl = K.DECK_CREAK, b = DECK) {
  if (!AC || muted || live > 110) return;
  const dur = rnd(0.35, 1.1) * (0.7 + 0.5 * force), f0 = rnd(150, 420);
  const chain = [], g = gain(0), am = gain(0.5, g);
  sends(g, 0.85, 0.35, b, chain); chain.push(am, g);
  const m2 = gain(0.4, am), b1 = filt('bandpass', f0, 7, am), b2 = filt('bandpass', f0 * 2.7, 9, m2);
  chain.push(b1, b2, m2);
  b1.frequency.setValueAtTime(f0, t); b1.frequency.exponentialRampToValueAtTime(f0 * rnd(1.1, 1.6), t + dur);
  b2.frequency.setValueAtTime(f0 * 2.7, t); b2.frequency.exponentialRampToValueAtTime(f0 * 2.7 * rnd(1.1, 1.5), t + dur);
  const chat = mod(rnd(11, 18), 0.5, am.gain, t, t + dur + 0.05, 'sawtooth');   // 0..1 gate
  chat.frequency.setValueAtTime(chat.frequency.value, t);
  chat.frequency.exponentialRampToValueAtTime(rnd(26, 48), t + dur);   // the chatter quickens as the grain lets go
  env(g.gain, t, dur * 0.3, dur, lvl * (0.6 + 0.4 * force));
  const nz = noise(0.35, null); nz.connect(b1); nz.connect(b2);
  fire(nz, t, t + dur + 0.05, chain);

  const ch2 = [], tg = gain(0), to = osc('sine', 62, tg);          // the settle, felt in the planks
  sends(tg, 0.9, 0.2, b, ch2); ch2.push(tg);
  to.frequency.setValueAtTime(62, t); to.frequency.exponentialRampToValueAtTime(38, t + 0.22);
  env(tg.gain, t, 0.008, 0.3, lvl * 0.45 * force);
  fire(to, t, t + 0.35, ch2);
  logEv('hullCreak', null, t, f0);
}

// Canvas luffing: lowpassed noise gated by an irregular flap that quickens as the
// wind finds the sail. Each flap is a soft whump, not a slap.
function canvasLuff(t = now(), dur = 1.6, lvl = K.VOY_LUFF, b = SAIL) {
  if (!AC || muted || live > 110) return;
  const chain = [], g = gain(0), am = gain(0.5, g);
  sends(g, 0.9, 0.3, b, chain); chain.push(am, g);
  const lp = filt('lowpass', 700, 0.8, am); chain.push(lp);
  lp.frequency.setValueAtTime(700, t); lp.frequency.linearRampToValueAtTime(1100, t + dur);
  const flap = mod(4, 0.5, am.gain, t, t + dur + 0.05, 'square');
  flap.frequency.setValueAtTime(4, t); flap.frequency.exponentialRampToValueAtTime(9, t + dur);
  mod(0.9, 1.2, flap.frequency, t, t + dur + 0.05);                 // never a metronome
  env(g.gain, t, dur * 0.35, dur, lvl);
  fire(noise(0.6, lp), t, t + dur + 0.05, chain);
  logEv('canvasLuff', null, t);
}

// The sail fills: a crack as the cloth snaps taut, a low whump as it takes the wind,
// and the sheets settling behind it.
function canvasSnap(t = now(), lvl = K.VOY_SNAP, b = SAIL) {
  if (!AC || muted || live > 110) return;
  const c1 = [], cg = gain(0), hp = filt('highpass', 1100, 0.7, cg);
  sends(cg, 0.9, 0.4, b, c1); c1.push(hp, cg);
  env(cg.gain, t, 0.002, 0.07, lvl * 0.7);
  fire(noise(1.1, hp), t, t + 0.12, c1);

  const c2 = [], bg = gain(0), lp = filt('lowpass', 260, 0.9, bg);
  sends(bg, 0.9, 0.35, b, c2); c2.push(lp, bg);
  lp.frequency.setValueAtTime(260, t); lp.frequency.exponentialRampToValueAtTime(120, t + 0.4);
  env(bg.gain, t + 0.01, 0.006, 0.45, lvl);
  fire(noise(0.7, lp), t, t + 0.5, c2);

  const c3 = [], wg = gain(0), wo = osc('sine', 88, wg);
  sends(wg, 0.9, 0.2, b, c3); c3.push(wg);
  wo.frequency.setValueAtTime(88, t); wo.frequency.exponentialRampToValueAtTime(44, t + 0.2);
  env(wg.gain, t, 0.005, 0.32, lvl * 0.8);
  fire(wo, t, t + 0.4, c3);
  logEv('canvasSnap', null, t);
}

// Water along the strakes: a band-passed wash with slow amplitude modulation and a
// gentle pan wander, over a lower slap of the bow meeting the swell.
function strakeWash(t = now(), dur = 6, lvl = K.VOY_WASH, b = SAIL) {
  if (!AC || muted || live > 110) return;
  const tEnd = t + dur + 0.1;
  const chain = [], g = gain(0), pan = AC.createStereoPanner();
  pan.pan.value = rnd(-0.2, 0.2); pan.connect(g);
  sends(g, 0.9, 0.3, b, chain); chain.push(pan, g);
  mod(0.11, 0.3, pan.pan, t, tEnd);
  const am = gain(0.6, pan), bp = filt('bandpass', 900, 0.6, am); chain.push(am, bp);
  mod(0.35, 0.3, am.gain, t, tEnd); mod(0.53, 0.15, am.gain, t, tEnd);
  mod(0.3, 250, bp.frequency, t, tEnd);
  env(g.gain, t, dur * 0.25, dur, lvl);
  fire(noise(0.8, bp), t, tEnd, chain);

  const c2 = [], sg = gain(0, pan), slp = filt('lowpass', 320, 1.0, sg); c2.push(slp, sg);
  const sam = gain(0.5, slp); c2.push(sam);
  mod(0.45, 0.45, sam.gain, t, tEnd);                               // the slower slap under the bow
  env(sg.gain, t, dur * 0.3, dur, lvl * 0.8);
  fire(noise(0.5, sam), t, tEnd, c2);
  logEv('strakeWash', null, t);
}

// A gull, far off: a filtered chirp glide — the short rise then the falling cry,
// heard mostly through the reverb. One, occasionally answered.
function gull(t = now(), pan = 0.5, lvl = K.VOY_GULL, b = SAIL) {
  if (!AC || muted || live > 110) return;
  const chain = [], g = gain(0), p = AC.createStereoPanner();
  p.pan.value = pan; p.connect(g);
  sends(g, 0.3, 1.0, b, chain); chain.push(p, g);
  const tone = filt('lowpass', 3200, 0.7, p), bp = filt('bandpass', 1500, 2.5, tone), o = osc('triangle', 1500, bp);
  chain.push(tone, bp);
  const k = rnd(0.92, 1.08);
  for (const q of [o.frequency, bp.frequency]) {
    q.setValueAtTime(1350 * k, t);
    q.exponentialRampToValueAtTime(2050 * k, t + 0.07);
    q.exponentialRampToValueAtTime(1750 * k, t + 0.16);
    q.exponentialRampToValueAtTime(950 * k, t + 0.42);
  }
  mod(27, 22, o.detune, t, t + 0.5);
  env(g.gain, t, 0.03, 0.45, lvl);
  fire(o, t, t + 0.5, chain);
  logEv('gull', null, t, 1350 * k);
}

// The passage, as one score on the audio clock: the chain lets go, the hull works
// as she comes off the mooring, water runs along the strakes the whole way, the
// canvas luffs then fills just after the bell (game.js rings the bell at 2.3 s via
// chime(392, 2.6, 0.2, 'voyage')), and as the black lifts a gull is somewhere above.
export function voyage(len = K.VOY_LEN) {
  if (!AC || muted) return;
  const t = now();
  slam();                                                   // the chain — rate-limited, so a game.js slam() alongside is harmless
  strakeWash(t + 0.2, len - 0.4, K.VOY_WASH);
  hullCreak(t + rnd(0.3, 0.5), 1.0, K.VOY_CREAK, SAIL);
  hullCreak(t + rnd(1.1, 1.4), 0.8, K.VOY_CREAK, SAIL);
  canvasLuff(t + 0.8, 1.6, K.VOY_LUFF);
  hullCreak(t + rnd(1.9, 2.15), 0.9, K.VOY_CREAK, SAIL);
  canvasSnap(t + 2.55, K.VOY_SNAP);                         // she takes the wind on the new mooring
  hullCreak(t + rnd(3.5, 3.8), 0.6, K.VOY_CREAK, SAIL);
  hullCreak(t + rnd(4.9, 5.2), 0.45, K.VOY_CREAK, SAIL);
  if (K.VOY_GULL_ON) {
    const side = Math.random() < 0.5 ? -1 : 1;
    gull(t + 4.85, 0.55 * side, K.VOY_GULL);
    if (Math.random() < 0.5) gull(t + 5.55, -0.4 * side, K.VOY_GULL * 0.7);
  }
  logEv('voyage', null, t);
}

let breathTimer = 0, creakTimer = 0, groanTimer = 0, callTimer = 0, knockTimer = 0, pumpTimer = 0, deckTimer = 0;
// Each scheduler clears its own timer first, so a manual trigger (dev surface)
// never forks a second ambient chain.
const schedCreak = () => { clearTimeout(creakTimer); creakTimer = setTimeout(suitCreak, rnd(8, 24) * 1000 / (1 + S.depth * 1.6)); };
const schedGroan = () => { clearTimeout(groanTimer); groanTimer = setTimeout(rockGroan, rnd(20, 55) * 1000); };
const schedCall = () => { clearTimeout(callTimer); callTimer = setTimeout(distantCall, rnd(42, 105) * 1000); };
const schedKnock = () => { clearTimeout(knockTimer); knockTimer = setTimeout(deepKnock, rnd(28, 72) * 1000); };
// On deck the hull works in the swell: irregular, 2-6 s, harder in wind. Silent below.
function deckCreak() {
  clearTimeout(deckTimer);
  deckTimer = setTimeout(deckCreak, rnd(K.DECK_CREAK_MIN, K.DECK_CREAK_MAX) * 1000);
  if (!AC || muted || AC.state !== 'running' || S.above < 0.5) return;
  hullCreak(now(), rnd(0.4, 1) * (0.4 + 0.6 * S.wind), K.DECK_CREAK * (0.5 + 0.5 * S.wind), DECK);
}

// One stroke of the engine: a low thud plus a belt/compressor accent on the same
// beat. Fired by pumpTick at a scheduled time, never by setPump — setPump only
// ever writes params.
function pumpThump(t, spd) {
  const f0 = mix(42, 56, spd) * rnd(0.985, 1.015);   // pitch rises with revs, wanders a hair
  const g = gain(0, pumpBus), o = osc('sine', f0, g);
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f0 * 0.5, t + 0.12);
  env(g.gain, t, 0.005, 0.16 + 0.06 * (1 - spd), 0.11 + 0.16 * spd);  // slower engine = softer, duller
  fire(o, t, t + 0.28, [g]);

  const p = pumpMechPulse.gain;
  hold(p, t);
  p.linearRampToValueAtTime(1 + 0.55 * spd, t + 0.02);
  p.setTargetAtTime(1, t + 0.02, 0.08);
}

// Governed ~1.4 Hz heartbeat, proportional to speed01 like a real crank. Strokes
// are laid on the AUDIO clock inside a short lookahead (the two-clocks pattern):
// the 60 ms timer only tops up the queue, so its jitter never reaches the beat.
// As speed sags the interval between thumps stretches on its own — slowing, then
// faltering, then simply not firing again — which is how a heavy engine actually
// dies, not a ramp anyone could hear as a fade.
let pRate = 0, pSpeed = 0, pLevel = 0, pNext = 0;
const PUMP_LOOK = 0.25, PUMP_TICK = 60;
function pumpTick() {
  pumpTimer = setTimeout(pumpTick, PUMP_TICK);
  if (!AC || AC.state !== 'running') { pNext = 0; return; }
  const t = now();
  if (pNext < t - 0.5) pNext = t + 0.02;              // clock stalled (hidden tab): re-anchor, never catch up
  while (pNext < t + PUMP_LOOK) {
    pRate += (1.4 * pSpeed - pRate) * 0.5;            // the crank chases the governor, one stroke at a time
    if (pRate <= 0.05) { pNext += 0.26; continue; }   // dead: ask again in 260 ms
    if (!muted && live < 100 && pLevel >= 0.004) pumpThump(pNext, pSpeed);
    pNext += (1 / pRate) * rnd(0.97, 1.03);
  }
}

// ---- per-tick mixing -----------------------------------------------------
function applyMix() {
  const d = S.depth, p = S.prox, c = S.calm, a = S.above, w = S.wind, duck = mix(1, 0.76, p * p);
  // pressure: everything closes down and gets heavier on the way to the floor
  ramp('dlp', droneLP.frequency, mix(1250, 190, d * d) * mix(1, 1.5, c), 0.4);
  ramp('nlp', noiseLP.frequency, mix(2800, 360, d) * mix(1, 1.6, c), 0.4);
  // the pressure bed belongs below the waterline; on deck it thins to a memory of it
  ramp('dg', droneGain.gain, mix(0.5, 0.8, d) * mix(1, 0.85, c) * duck * mix(1, K.DECK_DRONE_CUT, a), 0.5);
  ramp('ng', noiseGain.gain, mix(1.0, 0.72, d) * duck * mix(1, K.DECK_WATER_CUT, a), 0.5);
  ramp('sub', subGain.gain, 0.0001 + (0.02 + 0.26 * d * d) * (1 - a), 0.6);
  ramp('surf', surfGain.gain, 0.0001 + 0.2 * Math.pow(1 - d, 2.5), 0.6);
  ramp('shim', shimGain.gain, 0.0001 + 0.02 * Math.pow(1 - d, 1.6) + 0.014 * c, 0.6);
  // the deck bed fades in as the head clears the water; wind sets its weight
  ramp('deck', deckIn.gain, 0.0001 + K.DECK * a, 0.7);
  ramp('wind', windGain.gain, K.DECK_WIND * (0.12 + 0.88 * Math.pow(w, 1.3)), 0.8);
  ramp('windf', windBP.frequency, mix(220, 560, w), 1.0);
  ramp('gust', gustGain.gain, 0.0001 + K.DECK_GUST * w * w, 0.8);
  ramp('lap', lapGain.gain, K.DECK_LAP * (0.5 + 0.5 * w), 0.8);
  // wetter and longer the deeper it gets; open air is the driest room in the game
  ramp('bw', bedWet.gain, mix(0.22, 0.62, d) * mix(1, 0.5, a), 0.5);
  ramp('rt', revTone.frequency, mix(3000, 1150, d) * mix(1, 1.5, c), 0.5);
  ramp('pd', preDelay.delayTime, mix(0.04, 0.085, d), 0.8);
  const fb = mix(0.4, 0.71, d) * mix(1, 0.75, a);
  ramp('tga', tailGA.gain, fb, 0.8); ramp('tgb', tailGB.gain, fb, 0.8);
  // the leviathan closing in
  ramp('llp', levLP.frequency, mix(380, 2400, p), 0.5);
  ramp('th', threatGain.gain, 0.0001 + 0.30 * Math.pow(p, 1.7) * (1 - c), 0.7);
  ramp('te', tenseGain.gain, 0.0001 + 0.010 * Math.pow(p, 3) * (1 - c), 0.7);
  // diver
  ramp('mv', moveGain.gain, 0.0001 + 0.05 * cl01(S.speed / 22) * (1 - a), 0.3);
  ramp('mvf', moveBP.frequency, 320 + 30 * S.speed, 0.3);
  ramp('whine', whineGain.gain, 0.0001 + 0.02 * Math.pow(cl01(1 - S.light / 0.4), 2.2), 0.5);
}

// ---- self-drive ----------------------------------------------------------
let P = null, WS = null, tickN = 0, walkDist = 0;
const STRIDE = 2.6;

function drive() {
  if (!AC) return;
  if (!manual.zone && typeof window.zone === 'number' && window.zone >= 0 && window.zone !== zi) applyZone(window.zone);

  if (P) {
    if (!manual.depth) T.depth = cl01(-P.pos.y / 900);
    if (!manual.light) T.light = cl01(P.light);
    if (!manual.walking) S.walking = !!P.grounded;
    if (!manual.speed) T.speed = Math.hypot(P.vel.x, P.vel.y, P.vel.z);
    if (!manual.above) T.above = (P.onDeck || P.pos.y > 0.6) ? 1 : 0;   // SURFACE_Y is 0; the swell rides a little above it
    if (!manual.prox && (tickN & 1) === 0) {
      const L = window.lev;
      let p = 0;
      if (L && L.spine && !L.calmed) {
        let near = 1e9;
        for (const s of L.spine) {
          const dx = s.x - P.pos.x, dy = s.y - P.pos.y, dz = s.z - P.pos.z;
          const dd = dx * dx + dy * dy + dz * dz;
          if (dd < near) near = dd;
        }
        p = Math.max(cl01(1 - Math.sqrt(near) / (L.size * 12)), (L.agitation || 0) * 0.45);
      }
      T.prox = p;
      if (!manual.calm) T.calm = L && L.calmed ? 1 : 0;
    }
    if (!manual.step && S.walking) {
      const sp = Math.hypot(P.vel.x, P.vel.z);
      if (sp > 1.2) { walkDist += sp * 0.05; if (walkDist > STRIDE) { walkDist = 0; step(cl01(sp / 12)); } }
      else walkDist = Math.min(walkDist, STRIDE);
    }
  }
  if (!manual.wind && WS) T.wind = cl01(WS().speed);
  tickN++;

  for (let i = 0; i < SMOOTH.length; i++) { const k = SMOOTH[i]; S[k] += (T[k] - S[k]) * 0.07; }
  applyMix();
}

function applyZone(i) {
  zi = Math.max(0, Math.min(2, i | 0));
  sigilStep = 0;
  for (const d of drones) glide(d.o.frequency, DRONE_ROOT[zi] * d.r, 14);
}

// ---- public API ----------------------------------------------------------
// Autoplay policy: the context only runs after a user gesture. initAudio() is
// called from the title click, but a context can also be suspended later (tab
// interruption, OS audio-session change), so every gesture re-checks it.
function unlock() {
  if (AC && AC.state !== 'running') AC.resume().catch(() => { });
}

export function initAudio() {
  if (AC) { unlock(); return; }
  AC = new (window.AudioContext || window.webkitAudioContext)();
  build();
  unlock();
  for (const ev of ['pointerdown', 'keydown', 'touchend']) document.addEventListener(ev, unlock, { passive: true });
  AC.addEventListener('statechange', () => logEv('ctx', AC.state, AC.currentTime));

  breathTimer = setTimeout(breathCycle, 900);
  schedCreak(); schedGroan(); schedKnock();
  callTimer = setTimeout(distantCall, rnd(12, 30) * 1000);
  pumpTimer = setTimeout(pumpTick, 200);
  deckTimer = setTimeout(deckCreak, rnd(2, 5) * 1000);
  setInterval(drive, 50);

  // Optional self-drive. If player.js ever moves the catch keeps audio alive,
  // and the exported hooks become the only source of truth. Same for the wind:
  // water.js is already loaded by game.js, so this is a cache hit, not a fetch.
  import('./player.js').then(m => { P = m.player; }).catch(() => { });
  import('./world/water.js').then(m => { WS = m.windState; }).catch(() => { });

  document.addEventListener('visibilitychange', () => {
    muted = document.hidden;
    master.gain.setTargetAtTime(muted ? 0.0001 : K.MASTER, now(), 0.2);
  });

  installDev();
}

// Snap to the current mode so nothing thrown at chime() lands off-key.
function snap(f) {
  const s = SCALES[zi];
  const n = Math.round(12 * Math.log2(f / s.root));
  const oct = Math.floor(n / 12), pc = n - oct * 12;
  let best = s.deg[0], bd = 99;
  for (const d of s.deg) { const dd = Math.abs(d - pc); if (dd < bd) { bd = dd; best = d; } }
  return s.root * Math.pow(2, (oct * 12 + best) / 12);
}
function degFreq(d) {
  const s = SCALES[zi], o = Math.floor(d / 7);
  return s.root * Math.pow(2, (s.deg[d - o * 7] + 12 * o) / 12);
}

// The bell body: sine partials with a detuned twin on the fundamental and a strike
// transient. `parts` picks the voice, `tail` the length; the last partial standing
// tears down the summing node behind it.
function bell(t, f, dur, tail, v, parts, strike = 0.05) {
  const outG = gain(1, chimeBus);
  let longest = 0;
  for (const p of parts) if (p[2] > longest) longest = p[2];
  for (const [m, a, dk] of parts) {
    const g = gain(0, outG), o = osc('sine', f * m, g);
    o.detune.value = rnd(-5, 5);
    const end = dur * tail * dk;
    env(g.gain, t, 0.004 + 0.004 * m, end, v * a);
    fire(o, t, t + end + 0.05, dk === longest ? [g, outG] : [g]);
    if (m === 1) {  // detuned twin makes the fundamental warble like real metal
      const g2 = gain(0, outG), o2 = osc('sine', f, g2);
      o2.detune.value = rnd(4, 9);
      env(g2.gain, t, 0.006, dur * tail, v * a * 0.6);
      fire(o2, t, t + dur * tail + 0.05, [g2]);
    }
  }
  const sg = gain(0, outG), sf = filt('bandpass', f * 3.4, 2, sg);
  env(sg.gain, t, 0.002, strike, v * 0.35);
  fire(noise(1, sf), t, t + strike + 0.03, [sf, sg]);
}

// PICKUP: a short dull tap on a brass fitting — inharmonic partials under a lowpass,
// gone in a quarter second. Acknowledges, never rewards.
function brassTap(t, f, v) {
  const outG = gain(1, chimeBus), lp = filt('lowpass', 2400, 0.8, outG);
  const chain = [lp, outG];
  let first = true;
  for (const [m, a, dk] of TAP) {
    const g = gain(0, lp), o = osc('sine', f * m, g);
    o.detune.value = rnd(-8, 8);
    env(g.gain, t, 0.003, 0.24 * dk, v * a);
    fire(o, t, t + 0.24 * dk + 0.05, first ? chain.concat([g]) : [g]);
    first = false;
  }
  const sg = gain(0, lp), sf = filt('bandpass', f * 2.2, 3, sg);
  env(sg.gain, t, 0.001, 0.02, v * 0.5);
  fire(noise(1, sf), t, t + 0.05, [sf, sg]);
}

// CRAFT: a two-note metal clack — a noise burst through three struck-metal modes,
// answered 90 ms later a fourth higher. Hardware being fitted, not a bell.
function metalClack(t, f, v) {
  const clackAt = (t0, f0, vv) => {
    const nz = noise(1, null), outG = gain(1, chimeBus), chain = [nz, outG];
    const j = rnd(0.97, 1.03);
    for (const [m, a, d] of [[1, 1, 0.14], [2.9, 0.5, 0.09], [5.1, 0.25, 0.05]]) {
      const bp = filt('bandpass', f0 * m * j, 18), bg = gain(0, outG);
      nz.connect(bp); bp.connect(bg);
      env(bg.gain, t0, 0.002, d, vv * a);
      chain.push(bp, bg);
    }
    fire(nz, t0, t0 + 0.2, chain);
    const g = gain(0, outG), o = osc('sine', f0, g);          // a hair of body under the modes
    env(g.gain, t0, 0.002, 0.09, vv * 0.5);
    fire(o, t0, t0 + 0.14, [g]);
  };
  clackAt(t, f, v);
  clackAt(t + 0.09, snap(f * 1.335), v * 0.85);
}

// ONE BELL ANSWERS EVERYTHING — but each class gets its own voice from the family:
//   pickup  short dull brass tap (motes, sacs, spears, kills)
//   craft   two-note metal clack (hose, fuel, a relic fitted)
//   ward    the sigil motif note: a zone reads as one modal phrase
//   calm    the resolved chord (several calls in one frame build the tonic triad)
//   voyage  the ship's bell, long
//   ending  the bright tonic — same chord path, brighter partials
// Without a kind the legacy dur-keyed routing applies (>=2.5 chord, ~2 sigil, else
// sparkle), so every existing caller keeps its sound until it is re-pointed.
export function chime(freq, dur = 1.2, vol = 0.25, kind = null) {
  if (!AC || muted || live > 110) return;
  const t = now(), chord = t - lastChime < 0.06;
  lastChime = t;
  if (!kind) kind = dur >= 2.5 ? 'chord' : dur >= 1.7 ? 'ward' : 'spark';

  let f, tail, v = vol * 0.55, parts = BELL, strike = 0.05;
  switch (kind) {
    case 'pickup':
      f = snap(freq); brassTap(t, f, v * K.CH_PICKUP); logEv('chime', kind, t, f); return;
    case 'craft':
      f = snap(freq); metalClack(t, f, v * K.CH_CRAFT); logEv('chime', kind, t, f); return;
    case 'ward':
      f = degFreq(SIGIL_BASE + MOTIF[sigilStep % MOTIF.length]); sigilStep++;
      tail = 1.5; v *= K.CH_WARD; break;
    case 'calm': case 'chord': case 'ending':
      if (chord) chordIdx++;
      else { chordIdx = 0; chordOct = Math.max(0, Math.round(Math.log2(freq / SCALES[zi].root))); }
      f = degFreq(chordOct * 7 + [0, 2, 4, 6][chordIdx % 4]);
      tail = 1.9;
      if (kind === 'ending') { parts = BELL_BRIGHT; v *= K.CH_ENDING; } else v *= K.CH_CALM;
      break;
    case 'voyage':
      chordIdx = 0; chordOct = Math.max(0, Math.round(Math.log2(freq / SCALES[zi].root)));
      f = degFreq(chordOct * 7); tail = 2.3; strike = 0.09; v *= K.CH_VOYAGE;
      break;
    default:   // 'spark' and anything unknown: the snapped sparkle
      f = snap(freq); tail = 0.7; v *= 0.9 * K.CH_SPARK; parts = SPARK; kind = 'spark';
  }
  bell(t, f, dur, tail, v, parts, strike);
  logEv('chime', kind, t, f);
}

// Layered sub with a growl grain, formant-swept saw, and roar noise — all heard
// through the distance lowpass, so it reads as huge and far rather than close.
export function growl() {
  if (!AC || muted) return;
  if (!manual.zone) {
    const wz = window.zone;
    applyZone(typeof wz === 'number' && wz >= 0 ? wz : growls);
  }
  growls++;
  const t = now(), root = [30, 25.5, 21][zi], dur = 4.4 + zi * 0.9;

  const am = gain(0.72, levBus), sg = gain(0, am);
  const so = osc('sine', root * 1.3, sg);
  so.frequency.exponentialRampToValueAtTime(root * 0.76, t + dur);
  env(sg.gain, t, dur * 0.16, dur, 0.75);
  const grG = gain(0.26, am.gain), gr = osc('sine', 17 - zi * 3.5, grG);
  gr.frequency.exponentialRampToValueAtTime(6 - zi, t + dur);
  fire(gr, t, t + dur + 0.2, [grG]);
  fire(so, t, t + dur + 0.2, [sg, am]);

  const vg = gain(0, levBus), vo = osc('sawtooth', root * 2);
  vo.frequency.exponentialRampToValueAtTime(root * 1.45, t + dur);
  env(vg.gain, t, dur * 0.22, dur * 0.92, 0.4);
  const chain = [vg];
  for (const [f0, f1, a, q] of [[185, 330, 1, 4], [640, 415, 0.5, 6], [1450, 960, 0.2, 8]]) {
    const bp = filt('bandpass', f0, q), bg = gain(a, vg);
    vo.connect(bp); bp.connect(bg);
    bp.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.7);
    chain.push(bp, bg);
  }
  fire(vo, t, t + dur + 0.2, chain);

  const ng = gain(0, levBus), nb = filt('bandpass', 480, 1.3, ng);
  nb.frequency.exponentialRampToValueAtTime(240, t + dur);
  env(ng.gain, t, dur * 0.3, dur * 0.85, 0.09);
  fire(noise(0.6, nb), t, t + dur + 0.1, [nb, ng]);

  duckBed(t, 0.45, 0.35, dur * 0.9);   // the world flinches
  logEv('growl', null, t, root);
}

// bedDuck is automated by events only, never by applyMix, so the two never fight.
// Always a ramp: hold whatever the last duck was doing at t, then ramp down and back.
function duckBed(t, depth, fall, back) {
  const p = bedDuck.gain;
  hold(p, t);
  p.linearRampToValueAtTime(depth, t + fall);
  p.linearRampToValueAtTime(1, t + back);
}

export function slam() {
  if (!AC || muted) return;
  const t = now();
  if (t - lastSlam < 0.42) return;
  lastSlam = t;
  const chain = [], g = gain(0);
  sends(g, 0.9, 0.7, EV, chain); chain.push(g);
  const o = osc('sine', 92, g);
  o.frequency.exponentialRampToValueAtTime(27, t + 0.22);
  env(g.gain, t, 0.005, 0.9, 0.42);
  fire(o, t, t + 1.0, chain);
  const ch2 = [], ng = gain(0), nf = filt('lowpass', 700, 1.6, ng);
  sends(ng, 0.5, 0.9, EV, ch2); ch2.push(nf, ng);
  nf.frequency.exponentialRampToValueAtTime(150, t + 0.4);
  env(ng.gain, t, 0.004, 0.45, 0.16);
  fire(noise(1, nf), t, t + 0.5, ch2);
  for (let i = 0; i < 7; i++) {
    const f = rnd(300, 700);
    bubble(t + rnd(0.02, 0.4), f, f * rnd(1.8, 2.8), rnd(0.05, 0.1), rnd(0.04, 0.09), helmetIn, rnd(-0.6, 0.6));
  }
  duckBed(t, 0.55, 0.05, 0.9);
  logEv('slam', null, t);
}

// Cracking a compressed-air bottle: the brass lever clacks, then a hard noise burst
// that falls from a hiss toward a roar as the jet entrains water, then a slug of bubbles
// boiling past the faceplate. NOTE env() is (param, t0, attack, duration, peak) — `power`
// scales LEVEL, never duration, or a weak vent plays at full volume for less time.
export function airVent(power = 1) {
  if (!AC || muted || live > 100) return;
  const t = now();

  const c1 = [], cg = gain(0), cf = filt('bandpass', 1800, 3.0, cg);
  sends(cg, 0.30 * power, 0, EV, c1); c1.push(cf, cg);
  env(cg.gain, t, 0.002, 0.03, 0.30);
  fire(noise(0.12, cf), t, t + 0.14, c1);

  const c2 = [], ng = gain(0), nf = filt('bandpass', 2800, 1.1, ng);
  sends(ng, 0.85, 0.55, EV, c2); c2.push(nf, ng);
  nf.frequency.setValueAtTime(2800, t + 0.01);
  nf.frequency.exponentialRampToValueAtTime(380, t + 0.30);
  env(ng.gain, t, 0.005, 0.30, 0.42 * power);
  fire(noise(0.6, nf), t, t + 0.55, c2);

  // the shove itself, felt more than heard
  const c3 = [], bg = gain(0);
  sends(bg, 0.45, 0, EV, c3); c3.push(bg);
  const bo = osc('sine', 74, bg);
  bo.frequency.exponentialRampToValueAtTime(38, t + 0.16);
  env(bg.gain, t, 0.004, 0.20, 0.5 * power);
  fire(bo, t, t + 0.4, c3);

  const nb = Math.round(6 + 9 * power);
  for (let i = 0; i < nb; i++) {
    const f = rnd(420, 980);
    bubble(t + rnd(0.01, 0.55), f, f * rnd(1.6, 2.6), rnd(0.04, 0.09), rnd(0.05, 0.11), helmetIn, rnd(-0.7, 0.7));
  }
  // slam() dips the bed to 0.55; a third of that dip is 0.85. Anything deeper turns a
  // tool the player uses every few seconds into the loudest event in the game.
  duckBed(t, 0.85, 0.02, 0.5);
  logEv('airVent', null, t, power);
}

// Bottle back to pressure. Deliberately NOT chime(): chime snaps to the zone scale and
// is the pickup/mote voice, so a note every few seconds would read as a reward.
export function bottleReady() {
  if (!AC || muted || live > 100) return;
  const t = now();
  const g = gain(0), bp = filt('bandpass', 1240, 6, g), tap = gain(0.5, helmetIn);
  g.connect(tap);
  env(g.gain, t, 0.001, 0.03, 0.06);
  fire(noise(0.5, bp), t, t + 0.06, [bp, g, tap]);
  logEv('bottleReady', null, t);
}

// Fire one breath cycle NOW, phase-locked to the diver's breath clock (called at
// inhale start; the exhale voice lands mid-cycle where the bubbles burst).
export function syncBreath(stress01 = -1) {
  if (!AC) return;
  clearTimeout(breathTimer);
  breathCycle(stress01);
}

export function footstep(force = 1) { manual.step = true; step(cl01(force)); }
export function setDepth(d) { manual.depth = true; T.depth = cl01(d); }
export function setProximity(p) { manual.prox = true; T.prox = cl01(p); }
export function setLight(l) { manual.light = true; T.light = cl01(l); }
export function setAir(a) { manual.air = true; T.air = cl01(a); }
export function setCalm(c) { manual.calm = true; T.calm = cl01(c); }
export function setSpeed(u) { manual.speed = true; T.speed = Math.max(0, u); }
export function setWalking(w) { manual.walking = true; S.walking = !!w; }
export function setZone(i) { manual.zone = true; applyZone(i); }
export function setAbove(a) { manual.above = true; T.above = a ? 1 : 0; }
export function setWind(w) { manual.wind = true; T.wind = cl01(w); }
// Master fader, for the game's one volume control (M). Safe before initAudio: K.MASTER
// is what the fade-in ramps to. 0 is silence (the graph keeps running; nothing is torn down).
export function setMaster(v) {
  K.MASTER = Math.max(0, Math.min(1, +v || 0));
  if (master && !muted) master.gain.setTargetAtTime(Math.max(0.0001, K.MASTER), now(), 0.05);
}

// speed01: engine state (0 stopped .. 1 governed) — shapes rumble, hiss and thump
// tempo/pitch upstream of the fader. level01: audibility right now (distance +
// immersion) — the single output fader, so the two never compound into a
// squared falloff.
export function setPump(speed01, level01) {
  if (!AC) return;
  pSpeed = cl01(speed01);
  pLevel = cl01(level01);
  ramp('pbus', pumpBus.gain, 0.0001 + 0.30 * pLevel, 0.4);
  ramp('pmech', pumpMechGain.gain, 0.0001 + 0.18 * Math.pow(pSpeed, 0.8), 0.35);
  ramp('pmlp', pumpMechLP.frequency, mix(150, 320, pSpeed), 0.5);
  ramp('phiss', pumpHissGain.gain, 0.0001 + 0.02 * pSpeed * pSpeed, 0.4);
}

// ---- dev surface -----------------------------------------------------------
// window.__audio: what makes the ear pass fast. Nothing here runs per frame.
let meterBuf = null;
function installDev() {
  const ONESHOTS = {
    chime: (f = 660, dur = 1.2, vol = 0.25, kind = null) => chime(f, dur, vol, kind),
    pickup: (f = 880) => chime(f, 0.7, 0.18, 'pickup'),
    craft: (f = 523) => chime(f, 1.4, 0.22, 'craft'),
    ward: (f = 440) => chime(f, 2, 0.3, 'ward'),
    calm: () => { chime(262, 3, 0.3, 'calm'); chime(330, 3, 0.25, 'calm'); chime(392, 3, 0.25, 'calm'); },
    voyageBell: () => chime(392, 2.6, 0.2, 'voyage'),
    ending: () => { chime(523, 3, 0.3, 'ending'); chime(659, 3, 0.2, 'ending'); chime(784, 4, 0.2, 'ending'); },
    spark: (f = 880) => chime(f, 0.9, 0.18),
    slam, growl, airVent, bottleReady,
    step: (force = 1) => step(cl01(force)),
    breath: (stress = 0) => breathCycle(stress),
    suitCreak, rockGroan, distantCall, deepKnock,
    pumpThump: (spd = 1) => pumpThump(now(), cl01(spd)),
    hullCreak: (force = 1, lvl = K.DECK_CREAK) => hullCreak(now(), force, lvl, DECK),
    canvasLuff: (dur = 1.6) => canvasLuff(now(), dur),
    canvasSnap: () => canvasSnap(now()),
    wash: (dur = 6) => strakeWash(now(), dur),
    gull: (pan = 0.5) => gull(now(), pan),
    voyage
  };
  const busTrim = (name, v) => {
    if (name === 'reverb') { revWet.gain.setTargetAtTime(K.REVERB * v, now(), 0.05); return; }
    const b = BUSES[name]; if (!b) throw new Error('no bus ' + name + ' — ' + Object.keys(BUSES).concat('reverb').join(','));
    b.dry.gain.setTargetAtTime(v, now(), 0.05); b.wet.gain.setTargetAtTime(v, now(), 0.05);
  };
  const dev = {
    ctx: () => AC,
    state: () => (AC ? AC.state : 'none'),
    k: K,
    stats: () => ({ state: AC.state, live, zi, ...S, pump: { speed: pSpeed, level: pLevel, rate: pRate } }),
    log: (n = 32) => LOG.slice(-n),
    trace: v => { trace = !!v; return trace; },
    live: () => live,
    buses: () => Object.keys(BUSES).concat('reverb'),
    bus: (name, v) => { if (v !== undefined) { K.BUS[name] = v; busTrim(name, v); } return K.BUS[name]; },
    mute: (name, on = true) => { busTrim(name, on ? 0 : (K.BUS[name] == null ? 1 : K.BUS[name])); return on; },
    solo: name => { for (const b of Object.keys(BUSES)) busTrim(b, b === name ? (K.BUS[b] == null ? 1 : K.BUS[b]) : 0); },
    unmuteAll: () => { for (const b of Object.keys(BUSES)) busTrim(b, K.BUS[b] == null ? 1 : K.BUS[b]); busTrim('reverb', 1); },
    master: v => { if (v !== undefined) { K.MASTER = v; master.gain.setTargetAtTime(v, now(), 0.05); } return K.MASTER; },
    limiter: () => limiter,
    limit: (thresh, ratio) => {
      if (thresh !== undefined) { K.LIMIT_THRESH = thresh; limiter.threshold.setTargetAtTime(thresh, now(), 0.05); }
      if (ratio !== undefined) { K.LIMIT_RATIO = ratio; limiter.ratio.setTargetAtTime(ratio, now(), 0.05); }
      return { threshold: limiter.threshold.value, ratio: limiter.ratio.value, reduction: limiter.reduction };
    },
    // peak of the last ~21 ms at the output trim (post-limiter): the clip guard, read live
    peak: () => {
      if (!meterBuf) meterBuf = new Float32Array(meter.fftSize);
      meter.getFloatTimeDomainData(meterBuf);
      let m = 0; for (let i = 0; i < meterBuf.length; i++) { const a = Math.abs(meterBuf[i]); if (a > m) m = a; }
      return m;
    },
    duck: () => bedDuck.gain.value,
    list: () => Object.keys(ONESHOTS),
    fire: (name, ...a) => { const f = ONESHOTS[name]; if (!f) throw new Error('no one-shot ' + name + ' — ' + Object.keys(ONESHOTS).join(',')); return f(...a); },
    unlock,
    nodes: { master: () => master, dry: () => dry, revIn: () => revIn, revWet: () => revWet, bedDuck: () => bedDuck, deckIn: () => deckIn, buses: BUSES }
  };
  window.__audio = dev;
  window.__abyssaAudio = { ctx: () => AC, stats: dev.stats };   // legacy alias
}
