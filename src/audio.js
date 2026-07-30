// ---------------------------------------------------------------------------
// ABYSSA — every sound is synthesised here; the project ships no audio assets.
// OWNED BY: audio agent.
//
// game.js already calls initAudio() / chime(freq,dur,vol) / growl(). Everything
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
//   footstep()         once per bootfall (self-limits to ~6/s)
//   setZone(i)         first line of enterZone(i), BEFORE growl()
//   slam()             when updateLeviathan returns ev.slam (self rate-limits)
//   setCalm(0|1)       on ev.calmed, back to 0 on respawn
// ---------------------------------------------------------------------------

let AC = null, live = 0, muted = false;
let master, dry, revIn, revWet, revTone, preDelay, tailGA, tailGB;
let droneLP, droneGain, noiseLP, noiseGain, surfGain, shimGain, subGain, bedDuck, bedWet;
let helmetIn, breathGain, whineGain, moveGain, moveBP;
let levBus, levLP, threatGain, tenseGain, chimeBus;
let noiseBuf, drones = [];

const rnd = (a, b) => a + Math.random() * (b - a);
const cl01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => a + (b - a) * t;

// Targets are written by hooks or drive(); S holds the smoothed values.
const S = { depth: 0, prox: 0, light: 1, air: 1, calm: 0, speed: 0, walking: false };
const T = { depth: 0, prox: 0, light: 1, air: 1, calm: 0, speed: 0 };
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
const BELL = [[0.5, 0.30, 1.5], [1, 1, 1], [2.0, 0.40, 0.72], [2.76, 0.26, 0.52], [4.07, 0.14, 0.38], [5.43, 0.08, 0.28]];

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
function bus(d, w) { const g = gain(1); g.connect(gain(d, dry)); g.connect(gain(w, revIn)); return g; }
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
function glide(p, v, dur) {
  const t = now();
  if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(t); else p.cancelScheduledValues(t);
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
  const limiter = AC.createDynamicsCompressor();
  limiter.threshold.value = -8; limiter.knee.value = 6; limiter.ratio.value = 8;
  limiter.attack.value = 0.004; limiter.release.value = 0.3;
  limiter.connect(gain(0.92, AC.destination));
  master = gain(0.0001, limiter);
  master.gain.linearRampToValueAtTime(0.62, now() + 3.5); // no click on the first frame
  dry = gain(1, master);

  const NL = Math.floor(AC.sampleRate * 6);   // one hitch at game start, never again
  noiseBuf = AC.createBuffer(2, NL, AC.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = noiseBuf.getChannelData(c);
    for (let i = 0; i < NL; i++) d[i] = Math.random() * 2 - 1;
  }

  // Reverb: convolved body in parallel with a cross-coupled delay pair whose
  // feedback — and so tail length — opens up as the trench deepens.
  revWet = gain(0.45, master);
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

  // ---- pressure drone: stacked partials on a root that drops per zone ----
  bedDuck = gain(1, dry);                    // event ducking only (growl/slam)
  bedWet = gain(0.32, revIn);
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
  shimSwell.connect(gain(0.6, dry)); shimSwell.connect(gain(0.9, revIn));
  shimGain = gain(0.0001, shimSwell);
  const shim = filt('highpass', 2400, 0.7, shimGain);
  noise(1.7, shim).start();
  lfo(0.11, 0.4, shimSwell.gain);

  // ---- diver: everything he makes is heard from inside a copper helmet ----
  helmetIn = gain(1);
  const h1 = filt('peaking', 430, 1.1), h2 = filt('peaking', 1180, 1.4), h3 = filt('lowpass', 3200, 0.9);
  h1.gain.value = 7; h2.gain.value = 5;
  helmetIn.connect(h1); h1.connect(h2); h2.connect(h3);
  h3.connect(gain(0.85, dry)); h3.connect(gain(0.22, revIn));
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
  levLP.connect(gain(0.55, dry)); levLP.connect(gain(1.0, revIn));

  threatGain = gain(0.0001);
  threatGain.connect(gain(0.8, dry)); threatGain.connect(gain(0.7, revIn));
  const th = osc('sine', 24.5, threatGain); th.start();
  lfo(0.19, 2.2, th.frequency);
  const thN = filt('bandpass', 58, 3.5, gain(0.7, threatGain));
  noise(0.55, thN).start();
  lfo(0.13, 16, thN.frequency);

  // two close partials beating: dread you feel before you hear
  tenseGain = gain(0.0001, gain(0.5, dry));
  osc('sine', 466.16, tenseGain).start();
  osc('sine', 493.88, tenseGain).start();

  chimeBus = bus(0.75, 0.9);
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

function breathCycle() {
  const stress = cl01(Math.max(S.prox * 0.9, 1 - S.light, 1 - S.air));
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

  const tg = gain(0, dry), to = osc('sine', 74, tg);
  to.frequency.exponentialRampToValueAtTime(34, t + 0.13);
  env(tg.gain, t, 0.006, 0.3, 0.22 * v);
  fire(to, t, t + 0.34, [tg]);

  const nz = noise(1, null), chain = [nz];       // one burst feeds silt and resonators
  const sg = gain(0, dry), sf = filt('lowpass', 430, 0.9, sg);
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
}

// Rock shifting somewhere out in the dark: almost entirely reverb.
function rockGroan() {
  schedGroan();
  if (!AC || muted || AC.state !== 'running') return;
  const t = now(), dur = rnd(4, 8), f0 = rnd(40, 78);
  const g = gain(0), lp = filt('lowpass', 165, 7, g);
  g.connect(gain(0.16, dry)); g.connect(gain(1.0, revIn));
  const o = osc('sawtooth', f0, lp);
  o.frequency.exponentialRampToValueAtTime(f0 * rnd(0.58, 0.8), t + dur);
  lp.frequency.exponentialRampToValueAtTime(rnd(70, 120), t + dur);
  env(g.gain, t, dur * 0.3, dur, rnd(0.1, 0.2));
  fire(o, t, t + dur + 0.1, [lp, g]);

  const rg = gain(0), rb = filt('bandpass', 190, 2.2, rg);
  rg.connect(gain(0.1, dry)); rg.connect(gain(0.8, revIn));
  env(rg.gain, t + dur * 0.2, 0.4, dur * 0.7, 0.04);
  fire(noise(0.45, rb), t + dur * 0.2, t + dur, [rb, rg]);
}

// Something enormous singing, far enough away that mostly the reverb arrives.
function distantCall() {
  schedCall();
  if (!AC || muted || AC.state !== 'running') return;
  const t = now(), f0 = rnd(130, 300), up = rnd(0.9, 1.8), dn = rnd(1.6, 3.4);
  const g = gain(0), lp = filt('lowpass', 820, 0.8, g);
  g.connect(gain(0.085, dry)); g.connect(gain(1.1, revIn));
  const chain = [lp, g], parts = [];
  for (const [m, a] of [[1, 1], [2, 0.3], [3, 0.1]]) {
    const vg = gain(a, lp), o = osc('sine', f0 * m, vg);
    o.frequency.exponentialRampToValueAtTime(f0 * m * rnd(1.4, 2.1), t + up);
    o.frequency.exponentialRampToValueAtTime(f0 * m * rnd(0.55, 0.85), t + up + dn);
    const vibG = gain(rnd(8, 20), o.detune), vib = osc('sine', rnd(3.8, 5.6), vibG);
    fire(vib, t, t + up + dn + 0.5, [vibG]);
    parts.push(o); chain.push(vg);
  }
  env(g.gain, t, up * 0.55, up + dn + 0.4, rnd(0.14, 0.26));
  for (let i = 0; i < parts.length; i++) fire(parts[i], t, t + up + dn + 0.5, i ? null : chain);
}

// A single deep knock, like the trench settling on its own weight.
function deepKnock() {
  schedKnock();
  if (!AC || muted || AC.state !== 'running') return;
  const t = now(), f0 = rnd(38, 62);
  const g = gain(0);
  g.connect(gain(0.4, dry)); g.connect(gain(1.0, revIn));
  const o = osc('sine', f0, g);
  o.frequency.exponentialRampToValueAtTime(f0 * 0.55, t + 0.5);
  env(g.gain, t, 0.02, rnd(1.2, 2.2), rnd(0.1, 0.22));
  fire(o, t, t + 2.4, [g]);
  const ng = gain(0), nf = filt('lowpass', 320, 1.4, ng);
  ng.connect(gain(0.3, dry)); ng.connect(gain(0.8, revIn));
  env(ng.gain, t, 0.01, 0.3, 0.05);
  fire(noise(0.7, nf), t, t + 0.4, [nf, ng]);
}

let breathTimer = 0, creakTimer = 0, groanTimer = 0, callTimer = 0, knockTimer = 0;
const schedCreak = () => { creakTimer = setTimeout(suitCreak, rnd(8, 24) * 1000 / (1 + S.depth * 1.6)); };
const schedGroan = () => { groanTimer = setTimeout(rockGroan, rnd(20, 55) * 1000); };
const schedCall = () => { callTimer = setTimeout(distantCall, rnd(42, 105) * 1000); };
const schedKnock = () => { knockTimer = setTimeout(deepKnock, rnd(28, 72) * 1000); };

// ---- per-tick mixing -----------------------------------------------------
function applyMix() {
  const d = S.depth, p = S.prox, c = S.calm, duck = mix(1, 0.76, p * p);
  // pressure: everything closes down and gets heavier on the way to the floor
  ramp('dlp', droneLP.frequency, mix(1250, 190, d * d) * mix(1, 1.5, c), 0.4);
  ramp('nlp', noiseLP.frequency, mix(2800, 360, d) * mix(1, 1.6, c), 0.4);
  ramp('dg', droneGain.gain, mix(0.5, 0.8, d) * mix(1, 0.85, c) * duck, 0.5);
  ramp('ng', noiseGain.gain, mix(1.0, 0.72, d) * duck, 0.5);
  ramp('sub', subGain.gain, 0.02 + 0.26 * d * d, 0.6);
  ramp('surf', surfGain.gain, 0.0001 + 0.2 * Math.pow(1 - d, 2.5), 0.6);
  ramp('shim', shimGain.gain, 0.0001 + 0.02 * Math.pow(1 - d, 1.6) + 0.014 * c, 0.6);
  // wetter and longer the deeper it gets
  ramp('bw', bedWet.gain, mix(0.22, 0.62, d), 0.5);
  ramp('rt', revTone.frequency, mix(3000, 1150, d) * mix(1, 1.5, c), 0.5);
  ramp('pd', preDelay.delayTime, mix(0.04, 0.085, d), 0.8);
  const fb = mix(0.4, 0.71, d);
  ramp('tga', tailGA.gain, fb, 0.8); ramp('tgb', tailGB.gain, fb, 0.8);
  // the leviathan closing in
  ramp('llp', levLP.frequency, mix(380, 2400, p), 0.5);
  ramp('th', threatGain.gain, 0.0001 + 0.30 * Math.pow(p, 1.7) * (1 - c), 0.7);
  ramp('te', tenseGain.gain, 0.0001 + 0.010 * Math.pow(p, 3) * (1 - c), 0.7);
  // diver
  ramp('mv', moveGain.gain, 0.0001 + 0.05 * cl01(S.speed / 22), 0.3);
  ramp('mvf', moveBP.frequency, 320 + 30 * S.speed, 0.3);
  ramp('whine', whineGain.gain, 0.0001 + 0.02 * Math.pow(cl01(1 - S.light / 0.4), 2.2), 0.5);
}

// ---- self-drive ----------------------------------------------------------
let P = null, tickN = 0, walkDist = 0;
const STRIDE = 2.6;

function drive() {
  if (!AC) return;
  if (!manual.zone && typeof window.zone === 'number' && window.zone >= 0 && window.zone !== zi) applyZone(window.zone);

  if (P) {
    if (!manual.depth) T.depth = cl01(-P.pos.y / 900);
    if (!manual.light) T.light = cl01(P.light);
    if (!manual.walking) S.walking = !!P.grounded;
    if (!manual.speed) T.speed = Math.hypot(P.vel.x, P.vel.y, P.vel.z);
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
  tickN++;

  for (const k of ['depth', 'prox', 'light', 'air', 'calm', 'speed']) S[k] += (T[k] - S[k]) * 0.07;
  applyMix();
}

function applyZone(i) {
  zi = Math.max(0, Math.min(2, i | 0));
  sigilStep = 0;
  for (const d of drones) glide(d.o.frequency, DRONE_ROOT[zi] * d.r, 14);
}

// ---- public API ----------------------------------------------------------
export function initAudio() {
  if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
  AC = new (window.AudioContext || window.webkitAudioContext)();
  build();
  if (AC.state === 'suspended') AC.resume();

  breathTimer = setTimeout(breathCycle, 900);
  schedCreak(); schedGroan(); schedKnock();
  callTimer = setTimeout(distantCall, rnd(12, 30) * 1000);
  setInterval(drive, 50);

  // Optional self-drive. If player.js ever moves the catch keeps audio alive,
  // and the exported hooks become the only source of truth.
  import('./player.js').then(m => { P = m.player; }).catch(() => { });

  document.addEventListener('visibilitychange', () => {
    muted = document.hidden;
    master.gain.setTargetAtTime(muted ? 0.0001 : 0.62, now(), 0.2);
  });

  window.__abyssaAudio = { ctx: () => AC, stats: () => ({ state: AC.state, live, zi, ...S }) };
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

// Three registers, keyed off dur because that is what the call sites vary:
// dur>=2.5 are the resolution chords (several calls inside one frame, so anything
// within 60 ms of the last chime becomes the next member of the tonic triad);
// dur~2 are sigils, which walk a fixed modal motif so a zone reads as one phrase;
// everything shorter (motes, pickups, craft confirms) is a snapped sparkle.
export function chime(freq, dur = 1.2, vol = 0.25) {
  if (!AC || muted || live > 110) return;
  const t = now(), chord = t - lastChime < 0.06;
  lastChime = t;

  let f, tail, v = vol * 0.55, parts = BELL;
  if (dur >= 2.5) {
    if (chord) chordIdx++;
    else { chordIdx = 0; chordOct = Math.max(0, Math.round(Math.log2(freq / SCALES[zi].root))); }
    f = degFreq(chordOct * 7 + [0, 2, 4, 6][chordIdx % 4]);
    tail = 1.9;
  } else if (dur >= 1.7) {
    f = degFreq(SIGIL_BASE + MOTIF[sigilStep % MOTIF.length]); sigilStep++;
    tail = 1.5;
  } else {
    f = snap(freq); tail = 0.7; v *= 0.9;
    parts = [[1, 1, 1], [2.76, 0.34, 0.5], [5.43, 0.16, 0.3]];
  }

  const outG = gain(1, chimeBus);
  let longest = 0;
  for (const p of parts) if (p[2] > longest) longest = p[2];
  for (const [m, a, dk] of parts) {
    const g = gain(0, outG), o = osc('sine', f * m, g);
    o.detune.value = rnd(-5, 5);
    const end = dur * tail * dk;
    env(g.gain, t, 0.004 + 0.004 * m, end, v * a);
    // the last partial standing tears down the summing node behind it
    fire(o, t, t + end + 0.05, dk === longest ? [g, outG] : [g]);
    if (m === 1) {  // detuned twin makes the fundamental warble like real metal
      const g2 = gain(0, outG), o2 = osc('sine', f, g2);
      o2.detune.value = rnd(4, 9);
      env(g2.gain, t, 0.006, dur * tail, v * a * 0.6);
      fire(o2, t, t + dur * tail + 0.05, [g2]);
    }
  }
  const sg = gain(0, outG), sf = filt('bandpass', f * 3.4, 2, sg);
  env(sg.gain, t, 0.002, 0.05, v * 0.35);
  fire(noise(1, sf), t, t + 0.08, [sf, sg]);
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
}

// bedDuck is automated by events only, never by applyMix, so the two never fight.
function duckBed(t, depth, fall, back) {
  const p = bedDuck.gain;
  p.cancelScheduledValues(t);
  p.setValueAtTime(p.value, t);
  p.linearRampToValueAtTime(depth, t + fall);
  p.linearRampToValueAtTime(1, t + back);
}

export function slam() {
  if (!AC || muted) return;
  const t = now();
  if (t - lastSlam < 0.42) return;
  lastSlam = t;
  const g = gain(0);
  g.connect(gain(0.9, dry)); g.connect(gain(0.7, revIn));
  const o = osc('sine', 92, g);
  o.frequency.exponentialRampToValueAtTime(27, t + 0.22);
  env(g.gain, t, 0.005, 0.9, 0.42);
  fire(o, t, t + 1.0, [g]);
  const ng = gain(0), nf = filt('lowpass', 700, 1.6, ng);
  ng.connect(gain(0.5, dry)); ng.connect(gain(0.9, revIn));
  nf.frequency.exponentialRampToValueAtTime(150, t + 0.4);
  env(ng.gain, t, 0.004, 0.45, 0.16);
  fire(noise(1, nf), t, t + 0.5, [nf, ng]);
  for (let i = 0; i < 7; i++) {
    const f = rnd(300, 700);
    bubble(t + rnd(0.02, 0.4), f, f * rnd(1.8, 2.8), rnd(0.05, 0.1), rnd(0.04, 0.09), helmetIn, rnd(-0.6, 0.6));
  }
  duckBed(t, 0.55, 0.05, 0.9);
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
