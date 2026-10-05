// ---------------------------------------------------------------------------
// ABYSSA — every sound is synthesised; the project ships no audio assets.
// OWNED BY: audio agent. This file is the FACADE: the API game.js/ending.js call,
// the live AudioContext's lifecycle (autoplay, pause, mute, hidden tab), the per-frame
// read of the world, and window.__audio. The sound itself lives in src/audio/:
//   engine.js     graph: groups, medium filter, space reverb A/B, helmet IR, HRTF emitters
//   ir.js         generated impulse responses (deck / reef / boiler / abyss / helmet)
//   worklet.js    the granular texture generator (shrimp, bubbles, rain, friction)
//   bed.js        the places: per-zone ambience, deck, pump, thunder, ambient one-shots
//   sal.js        the diver: breath, inflow, exhaust, boots, hose, knife, tear, sonar
//   creatures.js  the three sleepers' voices, the serpent, sharks, rays, schools
//   score.js      the sparse adaptive score and the bell family
//   run.js        assembly + the 20 Hz tick and the per-frame hook
//   lab.js        OFFLINE renders + analysis (dev only, dynamic import)
//
// WIRING (game.js): initAudio() on the first click; audioSleeper(lev, ev) right after
// updateLeviathan; audioFrame(dt, pev, wx) once per play frame; setPaused(paused).
// Every older hook (setDepth, footstep, chime, growl, slam, ...) keeps working.
// ---------------------------------------------------------------------------
import { K } from './audio/engine.js';
import * as RUN from './audio/run.js';
import * as SAL from './audio/sal.js';
import * as CRE from './audio/creatures.js';
import * as BED from './audio/bed.js';
import * as SCO from './audio/score.js';

export { K };
let E = null, ctx = null, tickT = 0;
let pausedWant = false, hidden = false, runState = 'running', suspendT = 0;
const W = { MV: null, moverLive: null, schools: null, vents: null, rocks: null };
const M = {};   // late-bound game modules (dynamic import: never a load-order hazard)
const RMQ = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

// ---------------------------------------------------------------------------
// lifecycle
// ---------------------------------------------------------------------------
function unlock() { if (ctx && ctx.state !== 'running' && wantRunning()) ctx.resume().catch(() => { }); }
let devIgnoreHidden = false;   // DEV: the review pane reports hidden whenever it is off screen
function wantRunning() { return !pausedWant && (!hidden || devIgnoreHidden) && K.MASTER > 0.0001; }
// Pause, a hidden tab and M=0 all SUSPEND the context (the audio thread stops, nothing
// is spent) after a short fade so nothing clicks. Coming back resumes, then fades up.
function applyRun() {
  if (!ctx || E.offline) return;
  const t = ctx.currentTime, want = wantRunning();
  clearTimeout(suspendT);
  if (want) {
    if (ctx.state !== 'running') ctx.resume().catch(() => { });
    E.master.gain.cancelScheduledValues(t);
    E.master.gain.setTargetAtTime(Math.max(0.0001, K.MASTER), t, 0.08);
    runState = 'running';
  } else {
    E.master.gain.cancelScheduledValues(t);
    E.master.gain.setTargetAtTime(0.0001, t, 0.04);
    runState = 'suspending';
    suspendT = setTimeout(() => { if (!wantRunning() && ctx.state === 'running') ctx.suspend().catch(() => { }); runState = 'suspended'; }, 220);
  }
}

export function initAudio() {
  if (E) { unlock(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC({ latencyHint: 'interactive' });
  E = RUN.assemble(ctx, {});
  RUN.setZone(E, typeof window.zone === 'number' && window.zone >= 0 ? window.zone : 0);
  unlock();
  for (const ev of ['pointerdown', 'keydown', 'touchend']) document.addEventListener(ev, unlock, { passive: true });
  ctx.addEventListener('statechange', () => E.log('ctx', ctx.state));
  document.addEventListener('visibilitychange', () => { hidden = document.hidden; applyRun(); });
  hidden = document.hidden;
  let last = performance.now();
  tickT = setInterval(() => {
    if (ctx.state !== 'running') return;
    const n = performance.now(), dt = Math.min(0.25, (n - last) / 1000); last = n;
    const t0 = performance.now();
    pollSlow();
    if (n - lastFrameAt > 200) audioFrame(dt, null, null);   // the ending, death, voyage: no frame hook runs
    RUN.tick(E, dt);
    PERF.tick += performance.now() - t0; PERF.ticks++;
  }, 50);
  // the world, read-only. Same module instances game.js holds: cache hits, not fetches.
  const imp = (p, f) => import(p).then(f).catch(e => console.warn('ABYSSA audio: ' + p, e));
  imp('./player.js', m => { M.player = m.player; });
  imp('./systems/survival.js', m => { M.survival = m.survival; });
  imp('./systems/raft.js', m => { M.raft = m.raft; M.pumpSpeed = m.pumpSpeed; });
  imp('./world/water.js', m => { M.windState = m.windState; M.surfY = m.localSurfaceY; });
  imp('./entities/diver.js', m => { M.breathPhase = m.breathPhase; M.breathStress = m.breathStress; });
  imp('./core.js', m => { M.camera = m.camera; });
  imp('./world/stir.js', m => { W.MV = m.MV; W.moverLive = m.moverLive; });
  imp('./world/creatures.js', m => { W.schools = m.schools; });
  imp('./world/vents.js', m => { W.vents = m.activeVents; });
  imp('./world/flora.js', m => { W.rocks = m.rockColliders; });
  installDev();
}

// Esc / blur: the game's real pause. Edge-detected, so calling it every frame is free.
export function setPaused(p) {
  p = !!p;
  if (p === pausedWant) return;
  pausedWant = p;
  applyRun();
}

// ---------------------------------------------------------------------------
// per frame
// ---------------------------------------------------------------------------
let sleeperL = null, sleeperEv = null;
export function audioSleeper(lev, ev) { sleeperL = lev; sleeperEv = ev; }

const PERF = { frame: 0, frames: 0, tick: 0, ticks: 0 };
let lastFrameAt = 0;
export function audioFrame(dt, pev, wx) {
  if (!E || ctx.state !== 'running') { sleeperL = sleeperEv = null; return; }
  const t0 = performance.now();
  if (pev || wx) lastFrameAt = t0;
  const I = E.in, T = E.T, P = M.player;
  if (P) {
    I.px = P.pos.x; I.py = P.pos.y + 0.9; I.pz = P.pos.z;
    I.vx = P.vel.x; I.vy = P.vel.y; I.vz = P.vel.z;
    I.grounded = !!P.grounded; I.onDeck = !!P.onDeck;
    I.above = M.surfY ? P.pos.y > M.surfY() : P.pos.y > 0;
    T.above = I.above ? 1 : 0;
  }
  const cam = M.camera;
  if (cam) { const q = cam.quaternion; I.qx = q.x; I.qy = q.y; I.qz = q.z; I.qw = q.w; }
  I.state = window.gameState || 'play';
  if (M.breathPhase) { I.breathPh = M.breathPhase(); I.breathStress = M.breathStress(); }
  if (M.raft) { const r = M.raft.position; I.raftX = r.x; I.raftY = r.y; I.raftZ = r.z; }
  const S = M.survival;
  if (S) { T.supplied = S.supplied ? 1 : 0; T.taut = S.tautness || 0; T.strain = S.strain || 0; T.torn = S.torn || 0; }
  if (M.pumpSpeed) T.pumpSpd = M.pumpSpeed();
  I.lev = sleeperL; I.ev = sleeperEv;
  if (sleeperL && sleeperL.sigils && sleeperL.sigils.length) {
    let lit = 0; const sg = sleeperL.sigils;
    for (let i = 0; i < sg.length; i++) if (sg[i].lit) lit++;
    T.rite = lit / sg.length;
    if (sleeperEv && sleeperEv.sigilLit && E.score) E.score.ward(lit, sg.length);
  }
  if (pev) I.threat = pev.threat || 0;
  if (pev && pev.bite) CRE.bite(E);
  if (wx) {
    T.day = wx.day;
    const sky = wx.env ? wx.env.sky : wx.storm;
    T.rain = sky > 0.15 ? Math.min(1, (sky - 0.15) / 0.6) : 0;
  }
  E.startle = (RMQ && RMQ.matches) || window.__rm ? K.STARTLE_RM : 1;
  RUN.frame(E, dt, W);
  sleeperL = sleeperEv = null;
  PERF.frame += performance.now() - t0; PERF.frames++;
}
// 10 Hz reads that would allocate if done per frame
let slowN = 0;
function pollSlow() {
  if ((slowN++ & 1) !== 0) return;
  const b = window.__bolt;
  if (b && b.last) E.in.bolt = b.last();
  if (typeof window.zone === 'number' && window.zone >= 0 && window.zone !== E.T.zone && !manualZone) RUN.setZone(E, window.zone);
  const P = M.player;
  if (P && !manual.depth) E.T.depth = Math.max(0, Math.min(1, -P.pos.y / 900));
  if (!manual.speed && P) E.T.speed = Math.hypot(P.vel.x, P.vel.y, P.vel.z);
  if (!manual.wind && M.windState) E.T.wind = Math.max(0, Math.min(1, M.windState().speed));
  if (!manual.prox) E.T.prox = E.in.threat;
}

// ---------------------------------------------------------------------------
// the legacy API (every existing caller keeps its sound)
// ---------------------------------------------------------------------------
const manual = {};
let manualZone = false;
const live = () => E && ctx.state === 'running';
export function chime(freq, dur, vol, kind) { if (live()) SCO.chime(E, freq, dur, vol, kind); }
export function growl() { if (live()) { E.in.lev = window.lev || null; CRE.growl(E); } }
export function slam() { if (live()) CRE.slam(E); }
export function airVent(power = 1) { if (live()) SAL.airVent(E, power); }
export function bottleReady() { if (live()) SAL.bottleReady(E); }
// THE AIR PACK's held burst, 0..1 every play frame (game.js updateAirPack): the roar layer.
export function setJet(k) { if (E) E.in.jet = k > 0 ? Math.min(1, k) : 0; }
export function voyage(len) { if (live()) BED.voyage(E, len); }
// The passage's pen on the chart (ui/passage.js via game.js): kind 'stroke' | 'ring' | 'letter' | 'tick'.
export function nib(kind, dur, pan0, pan1, dry) { if (live()) BED.nib(E, kind, dur, pan0, pan1, dry); }
export function syncBreath() { /* breath follows breathPhase() every frame now; kept for callers */ }
export function knife() { if (live()) SAL.knife(E); }
export function knifeHit(kind) { if (live()) SAL.knifeHit(E, kind); }
export function land(p) { if (live()) SAL.land(E, p, surface()); }
// the hose snapping taut on him (tether.js leash): k 0..1 is the yank's strength
export function hoseYank(k) { if (live()) SAL.hoseYank(E, k); }
// Sonar: the targets are what the ping actually finds — the sleeper's unlit wards
// (bright iron), the sleeper's body (low), the rift once open. Flat array x,y,z,kind.
const SON = new Float32Array(40);
export function sonar() {
  if (!live()) return;
  let n = 0;
  const L = window.lev;
  if (L && !L.calmed) {
    if (L.sigils) for (const s of L.sigils) {
      if (s.lit || n > 32) continue;
      const m = s.grp && s.grp.matrixWorld && s.grp.matrixWorld.elements;
      if (m) { SON[n++] = m[12]; SON[n++] = m[13]; SON[n++] = m[14]; SON[n++] = 1; }
    }
    const b = L.head || L.pos;
    if (b && !L.dormant && n < 36) { SON[n++] = b.x; SON[n++] = b.y; SON[n++] = b.z; SON[n++] = 2; }
  }
  SAL.sonar(E, SON.subarray(0, n));
}
function surface() {
  const I = E.in;
  if (I.onDeck) return 'deck';
  const zi = E.T.zone | 0;
  if (W.rocks && zi === 0) {
    const P = M.player;
    if (P) for (const r of W.rocks) { const dx = r.x - P.pos.x, dz = r.z - P.pos.z, rr = r.r + 1.2; if (dx * dx + dz * dz < rr * rr && Math.abs(r.y - P.pos.y) < r.r + 3) return 'rock'; }
  }
  return zi === 0 ? 'silt' : zi === 1 ? 'crust' : 'ooze';
}
let stepSide = 1;
export function footstep(force = 1) { if (!live()) return; stepSide = -stepSide; SAL.step(E, surface(), Math.max(0, Math.min(1, force)), stepSide); }
export function setDepth(d) { manual.depth = true; if (E) E.T.depth = Math.max(0, Math.min(1, d)); }
export function setProximity(p) { manual.prox = true; if (E) E.T.prox = Math.max(0, Math.min(1, p)); }
export function setLight(l) { if (E) E.T.light = Math.max(0, Math.min(1, l)); }
export function setAir(a) { if (E) E.T.air = Math.max(0, Math.min(1, a)); }
export function setCalm(c) {
  if (!E) return;
  const was = E.T.calm; E.T.calm = c ? 1 : 0;
  if (c && !was && live() && window.gameState === 'play') E.score.calm();
}
export function setSpeed(u) { manual.speed = true; if (E) E.T.speed = Math.max(0, u); }
export function setWalking() { /* grounded is read per frame */ }
export function setZone(i) { if (E) RUN.setZone(E, i); }
export function setAbove(a) { if (E) E.T.above = a ? 1 : 0; }
export function setWind(w) { manual.wind = true; if (E) E.T.wind = Math.max(0, Math.min(1, w)); }
export function setPump() { /* speed is read from raft.pumpSpeed() and placement is spatial now */ }
// Master fader, the game's one volume control (M). 0 suspends the context entirely.
export function setMaster(v) {
  K.MASTER = Math.max(0, Math.min(1, +v || 0));
  if (E) applyRun();
}

// ---------------------------------------------------------------------------
// window.__audio — the ear pass's bench
// ---------------------------------------------------------------------------
function installDev() {
  const ONESHOTS = {
    chime: (f = 660, d = 1.2, v = 0.25, k = null) => chime(f, d, v, k),
    pickup: (f = 880) => chime(f, 0.7, 0.18, 'pickup'), craft: (f = 523) => chime(f, 1.4, 0.22, 'craft'),
    ward: (f = 440) => chime(f, 2, 0.3, 'ward'),
    calm: () => { chime(262, 3, 0.3, 'calm'); chime(330, 3, 0.25, 'calm'); chime(392, 3, 0.25, 'calm'); E.score.calm(); },
    ending: () => { chime(523, 3, 0.3, 'ending'); chime(659, 3, 0.2, 'ending'); chime(784, 4, 0.2, 'ending'); },
    slam, growl, airVent, bottleReady, voyage, sonar, knife, knifeHit, land: (p = 1.5) => land(p),
    step: (mat = 'silt') => SAL.step(E, mat, 1, 1), exhaust: () => SAL.exhaust(E, 1), tear: () => SAL.tear(E),
    splash: () => SAL.splash(E, 0.8), emerge: () => SAL.emerge(E), bite: () => CRE.bite(E),
    hoseYank: (k = 0.8) => SAL.hoseYank(E, k),
    suitCreak: () => BED.suitCreak(E), rockGroan: () => BED.rockGroan(E), distantCall: () => BED.distantCall(E),
    deepKnock: () => BED.deepKnock(E), abyssTick: () => BED.abyssTick(E), hullCreak: () => BED.hullCreak(E),
    slap: () => BED.hullSlap(E), gull: () => BED.gull(E), thunder: (d = 200) => BED.thunder(E, E.in.px + d, E.in.pz, 1),
    brass: (f = 73) => SCO.brass(E, E.now() + 0.02, f, 9, SCO.KM.BRASS), bowed: (f = 147) => SCO.bowed(E, E.now() + 0.02, f, 10, SCO.KM.BOWED),
    sting: (k = 'brooder') => E.score.sting(k)
  };
  window.__audio = {
    ctx: () => ctx, E: () => E, k: K,
    kb: BED.KB, ks: SAL.KS, kc: CRE.KC, km: SCO.KM,
    state: () => (ctx ? ctx.state : 'none'),
    run: () => ({ want: wantRunning(), paused: pausedWant, hidden, runState, master: K.MASTER }),
    stats: () => ({ ctx: ctx.state, live: E.live, S: { ...E.S, zw: E.S.zw.slice() }, space: E.rev.space, emitters: E.EM.filter(s => s.until > E.now() || (s.persistent && s.lvl > 0.0005)).length, textures: E.textures.length, texOK: E.texOK }),
    perf: () => ({ frameMs: +(PERF.frame / Math.max(1, PERF.frames)).toFixed(4), tickMs: +(PERF.tick / Math.max(1, PERF.ticks)).toFixed(4), frames: PERF.frames, ticks: PERF.ticks, live: E.live, baseLatency: ctx.baseLatency, outputLatency: ctx.outputLatency }),
    resetPerf: () => { PERF.frame = PERF.frames = PERF.tick = PERF.ticks = 0; },
    log: (n = 40) => E.LOG.slice(-n),
    trace: v => { E.trace = !!v; return E.trace; },
    list: () => Object.keys(ONESHOTS),
    fire: (name, ...a) => { const f = ONESHOTS[name]; if (!f) throw new Error('no one-shot ' + name + ' — ' + Object.keys(ONESHOTS).join(',')); return f(...a); },
    groups: () => Object.keys(E.G),
    group: (name, v) => { const G = E.G[name]; if (v !== undefined) { K.G[name] = v; G.trim.gain.setTargetAtTime(v, ctx.currentTime, 0.05); G.emWet.gain.setTargetAtTime(v, ctx.currentTime, 0.05); } return G.trim.gain.value; },
    solo: name => { for (const g in E.G) { const v = g === name ? K.G[g] ?? 1 : 0; E.G[g].trim.gain.setTargetAtTime(v, ctx.currentTime, 0.05); E.G[g].emWet.gain.setTargetAtTime(v, ctx.currentTime, 0.05); } },
    unsolo: () => { for (const g in E.G) { E.G[g].trim.gain.setTargetAtTime(K.G[g] ?? 1, ctx.currentTime, 0.05); E.G[g].emWet.gain.setTargetAtTime(K.G[g] ?? 1, ctx.currentTime, 0.05); } },
    bus: (name, v) => { const b = E.B[name]; if (v !== undefined) b.gain.setTargetAtTime(v, ctx.currentTime, 0.05); return b.gain.value; },
    peak: () => {
      const buf = new Float32Array(E.meter.fftSize); E.meter.getFloatTimeDomainData(buf);
      let m = 0, s = 0; for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > m) m = a; s += buf[i] * buf[i]; }
      return { peak: +m.toFixed(4), rmsDb: +(10 * Math.log10(s / buf.length + 1e-12)).toFixed(1), limGR: +E.lim.reduction.toFixed(2), glueGR: +E.glue.reduction.toFixed(2) };
    },
    space: n => { if (n) E.setSpace(n, 2); return E.rev.space; },
    unlock,
    ignoreHidden: v => { devIgnoreHidden = !!v; applyRun(); return devIgnoreHidden; },
    // offline renders + analysis (roadmap: the ear pass without ears)
    lab: () => import('./audio/lab.js')
  };
  window.__abyssaAudio = { ctx: () => ctx, stats: () => window.__audio.stats() };
}
