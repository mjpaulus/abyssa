// RITE PLAYER (ritefair, 2026-10-09): Velkath's rite played end to end through REAL key events
// on the freeze-step loop of tools/bench/play.mjs (keys held over CDP for fixed slices of GAME
// time, the live loop held, __bench.step advancing it). A policy reads what a player reads off
// the screen (where her wards are, which are lit, the clutch, his air) and presses W/Shift/
// Space/C/E with a yaw/pitch, slice by slice, and the page books the ledger per frame.
//   node tools/bench/riteplay.mjs <port> <site: home|pallid|burned> <mode: perfect|average> <tag> [seed] [maxSec]
//   perfect: 0.25 s slices, exact aim.  average: 0.5-1.0 s slices, aim +-20 deg, bursts held
//   0.7-1.5x what was needed (a player who reads late and overshoots).
// Env DRV_PORT (default 9471). Frames -> SHOTS dir (env RP_OUT, default shots/ritefair-play).
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
if (!process.env.DRV_PORT) process.env.DRV_PORT = '9471';
// a FRESH profile every run: the chart save would otherwise remember a calm (a lit ward)
if (!process.env.DRV_DIR) { process.env.DRV_DIR = tmpdir() + '/abyssa-rp-' + process.env.DRV_PORT + '-' + Date.now(); }
const { start, stop, connect, sleep } = await import('./drv.mjs');
const [, , PORT, SITE = 'home', MODE = 'perfect', TAG = 'run', SEED = '1', MAXS = '240'] = process.argv;
const OUT = process.env.RP_OUT || '/Users/michaelpaulus/sc/.abyssa-wt/shots/ritefair-play';
mkdirSync(OUT, { recursive: true });
let seed = +SEED >>> 0 || 1;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const AVG = MODE === 'average';
// RP_FLEE=<s>: after the take he runs off with the clump for that long (a thief's first
// instinct), so the rite starts against a risen, hunting Velkath; the ledger's case
const FLEE = +(process.env.RP_FLEE || 0);

// ---- the page side: the per-frame ledger ----
const PROBE = `(() => {
  const P = window.player, SV = window.survival, L = window.lev, cam = window.camera, V = P.pos.constructor;
  const v = new V(), w = new V();
  const seen = L.sigils.map(() => false);
  const st = { seen, f: 0, tears: 0, lastHit: -9, hits: 0, hitAt: [], dryN: 0, dryWas: false, low: 0, bowlN: 0, bowlAt: [], inBowl: false, camN: 0, camBad: 0, pressed: 0,
    wardT: L.sigils.map(g => g.lit ? 0 : null), calmT: null, retT: null, takeT: null, maxUp: 0, floatS: 0, tornPrev: SV.torn, heldPrev: L.brood ? L.brood.held : -1,
    lairFloor: terrainH(L.lairPos.x, L.lairPos.z, 0), minReserve: 1 };
  const frame = () => {
    st.f++;
    const t = st.f / 60;
    if (SV.torn > st.tornPrev + 0.5) { st.tears++; if (t - st.lastHit > 0.5) { st.hits++; st.hitAt.push(+t.toFixed(1)); } st.lastHit = t; }
    st.tornPrev = SV.torn;
    const res = SV.reserve / (SV.reserveCap || 1);
    if (res < st.minReserve) st.minReserve = res;
    const dry = res < 0.12;
    if (dry && !st.dryWas) st.dryN++;
    st.dryWas = dry;
    const fl = terrainH(P.pos.x, P.pos.z, 0);
    const lairD = Math.hypot(P.pos.x - L.lairPos.x, P.pos.z - L.lairPos.z);
    const inB = fl < st.lairFloor - 15 && lairD < 90;
    if (inB && !st.inBowl) { st.bowlN++; st.bowlAt.push(+t.toFixed(1)); }
    st.inBowl = inB;
    const agl = P.pos.y - 1.35 - fl;
    if (agl > st.maxUp) st.maxUp = agl;
    if (agl > 9) st.floatS += 1 / 60;
    for (let i = 0; i < L.sigils.length; i++) if (L.sigils[i].lit && st.wardT[i] == null) st.wardT[i] = +t.toFixed(1);
    if (L.calmed && st.calmT == null) st.calmT = +t.toFixed(1);
    const h = L.brood ? L.brood.held : -1;
    if (h >= 0 && st.heldPrev < 0 && st.takeT == null) st.takeT = +t.toFixed(1);
    if (h < 0 && st.heldPrev >= 0) st.retT = +t.toFixed(1);
    st.heldPrev = h;
    // the framing: she is awake and inside 30 u; readable if her belly or a dark ward is on screen
    if (st.f % 4 === 0 && t >= (window.__rpFlee || 0) && !L.dormant && !L.calmed && L.standE > 0.5 && Math.hypot(P.pos.x - L.pos.x, P.pos.z - L.pos.z) < 30) {
      st.camN++;
      cam.updateMatrixWorld();
      const on = p => { w.copy(p).project(cam); return Math.abs(w.x) < 0.95 && Math.abs(w.y) < 0.95 && w.z < 1 && w.z > -1; };
      let ok = on(v.set(L.pos.x, L.bodyY - 0.12 * L.R, L.pos.z));
      if (!ok) for (const g of L.sigils) if (!g.lit && on(g.grp.position)) { ok = true; break; }
      if (!ok) st.camBad++;
      for (let i = 0; i < L.sigils.length; i++) if (!seen[i] && on(L.sigils[i].grp.position)) seen[i] = true;
      if (cam.position.distanceTo(v.set(P.pos.x, P.pos.y + 0.3, P.pos.z)) < 2.6) st.pressed++;
    }
  };
  window.__rp = { st, frame };
  return 1;
})()`;

const STATE = `(() => {
  const P = window.player, SV = window.survival, L = window.lev, B = L.brood, V = P.pos.constructor, r = x => +x.toFixed(2);
  const fl = terrainH(P.pos.x, P.pos.z, 0);
  const o = { pos: [r(P.pos.x), r(P.pos.y), r(P.pos.z)], vel: [r(P.vel.x), r(P.vel.y), r(P.vel.z)], agl: r(P.pos.y - 1.35 - fl), grounded: !!P.grounded,
    reserve: r(SV.reserve / (SV.reserveCap || 1)), fill: r(P.fill || 0), dormant: !!L.dormant, calmed: !!L.calmed, standE: r(L.standE),
    lev: [r(L.pos.x), r(L.bodyY), r(L.pos.z)], R: r(L.R), cock: r(L.cock || 0), threatE: r(L.threatE || 0), crouch: r(L.crouch ? L.crouch.x : 0),
    held: B ? B.held : -1, canTake: B ? !!B.canTake(P.pos) : false, canReturn: B ? !!B.canReturn(P.pos) : false, clutchReach: B ? r(B.reach(P.pos)) : 99,
    reach: L.reach, msg: window.__msg().live };
  o.wards = L.sigils.map(g => ({ p: [r(g.grp.position.x), r(g.grp.position.y), r(g.grp.position.z)], lit: !!g.lit, floor: r(g.grp.position.y - terrainH(g.grp.position.x, g.grp.position.z, 0)) }));
  // the clutch's lowest point (live lobes), the spot he presses the clump back into
  if (B && B.live) { const q = new V(); let lo = 1e9, m = null;
    for (let k = 0; k < B.nL; k++) { const j = k * 4; if (B.live[j + 3] <= 0.002) continue; q.set(B.live[j], B.live[j + 1] - B.live[j + 3], B.live[j + 2]).applyMatrix4(L.body.matrixWorld);
      if (q.y < lo) { lo = q.y; m = q.clone(); } }
    if (m) { o.mass = [r(m.x), r(m.y), r(m.z)]; o.massFloor = r(m.y - terrainH(m.x, m.z, 0)); } }
  o.rp = window.__rp ? window.__rp.st : null;
  return o;
})()`;

const c0 = await (async () => { await start(`http://localhost:${PORT}/?playtest&bench`); return connect(); })();
const c = c0;
await c.until(`!document.getElementById('load') && typeof window.setState === 'function' && window.__bench`, 240000, 1000);
await c.ev(`(window.__helm = true, window.setState('play'), 1)`);
await sleep(3000);
const alt = async code => {
  await c.ev(`(window.dispatchEvent(new KeyboardEvent('keydown', { code: '${code}', key: 'x', altKey: true, bubbles: true })), window.dispatchEvent(new KeyboardEvent('keyup', { code: '${code}', key: 'x', altKey: true, bubbles: true })), 1)`);
  await c.ev(`(window.__helm = true, window.__bench.step(90), 1)`);
};
const nSail = SITE === 'pallid' ? 1 : SITE === 'burned' ? 2 : 0;
for (let i = 0; i < nSail; i++) { await alt('Minus'); await sleep(4000); await c.ev(`(window.__bench.step(120), 1)`); }
await alt('Digit6');
await sleep(1500);
await c.ev(`(window.__bench.step(60), 1)`);
// THE LIVE LOOP STOPS HERE: __bench.step only holds the game loop while it steps, so between
// CDP calls the page's own rAF kept playing real-time frames with the keys as they were (and a
// screenshot forces one), an unbooked, unrepeatable share of the fight. From now on time moves
// only through __bench.step.
await c.ev(`(window.requestAnimationFrame = cb => { window.__rafCb = cb; return 0; }, 1)`);
await sleep(300);
await c.ev(`(window.__rpFlee = ${FLEE}, 1)`);
await c.ev(PROBE);
const render = async () => {
  await c.ev(`(['title','pause','ptPanel','ptToast','ptDock'].forEach(id => { const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; }), window.__bench.step(1, null, { render: true }), 1)`);
};
const shot = async name => { await render(); await c.png(`${OUT}/${TAG}-${name}.png`); };
// THE VIDEO (RP_VIDEO=<dir>): every 3rd game frame is rendered through the real pipeline and
// captured (~20 fps of game time), 0000.png ... for the orchestrator to assemble
const VID = process.env.RP_VIDEO || null;
let vidN = 0, vidPh = 0;
if (VID) { mkdirSync(VID, { recursive: true }); await c.ev(`(['title','pause','ptPanel','ptToast','ptDock'].forEach(id => { const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; }), 1)`); }
async function vgrab() {
  const r = await c.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1280, height: 800, scale: 0.75 } });
  writeFileSync(`${VID}/${String(vidN++).padStart(4, '0')}.png`, Buffer.from(r.result.data, 'base64'));
}
// n game frames with the ledger booked each frame. Every frame is RENDERED through the real
// pipeline (RP_RENDER=0 skips it): the renderer's matrixWorld pass is part of the frame the
// game reads back (her colliders), and a stepped loop without it played a different, gentler
// fight (0 early hits in 12 runs vs 3 of 4 with renders). With RP_VIDEO every 3rd is captured.
const RENDER = process.env.RP_RENDER !== '0';
async function stepN(n) {
  const R = RENDER ? ', { render: true }' : '';
  if (!VID) { await c.ev(`(window.__bench.step(${n}, () => window.__rp.frame()${R}), 1)`); return; }
  while (n > 0) {
    const k = Math.min(n, 3 - vidPh);
    if (vidPh + k === 3) {
      if (k > 1) await c.ev(`(window.__bench.step(${k - 1}, () => window.__rp.frame()${R}), 1)`);
      await c.ev(`(window.__bench.step(1, () => window.__rp.frame(), { render: true }), 1)`);
      await vgrab();
      vidPh = 0;
    } else { await c.ev(`(window.__bench.step(${k}, () => window.__rp.frame()${R}), 1)`); vidPh += k; }
    n -= k;
  }
}
const DEG = Math.PI / 180;
let t = 0, lastShot = 0, log = [];
// one slice: keys held for `sec`, Space held only its first `spaceSec`, E tapped at the start
async function slice({ keys = [], sec, yaw, pitch = 0, space = 0, e = false }) {
  const frames = Math.max(1, Math.round(sec * 60));
  await c.ev(`(window.player.yaw = ${yaw}, window.player.pitch = ${pitch}, 1)`);
  const MAP = { W: 'KeyW', S: 'KeyS', A: 'KeyA', D: 'KeyD', Shift: 'ShiftLeft', C: 'KeyC', E: 'KeyE', Space: 'Space' };
  for (const k of keys) await c.key(MAP[k], true);
  if (e) { await c.key('KeyE', true); await stepN(2); await c.key('KeyE', false); }
  let done = e ? 2 : 0;
  if (space > 0) {
    const sf = Math.max(2, Math.min(frames - done, Math.round(space * 60)));
    await c.key('Space', true);
    await stepN(sf);
    await c.key('Space', false);
    done += sf;
  }
  if (frames > done) await stepN(frames - done);
  for (const k of keys) await c.key(MAP[k], false);
  t += Math.max(frames, done) / 60;
}

const hyp = Math.hypot;
function decide(s) {
  const P = s.pos, reach = s.reach || 6;
  const sec = AVG ? 0.5 + 0.5 * rnd() : 0.25;
  const noise = AVG ? (rnd() * 2 - 1) * 20 * DEG : 0;
  // the average player holds a burst ~1 s whatever the climb needs (the ledger's habit)
  const avgBurst = 0.6 + 0.6 * rnd();
  if (s.dormant) return { sec: 0.2, yaw: 0, e: s.canTake, keys: [], why: 'take' };
  if (t < FLEE) { const ax = P[0] - s.lev[0], az = P[2] - s.lev[2]; return { sec, yaw: Math.atan2(ax, az) + noise, keys: ['W', 'Shift'], why: 'flee' }; }
  // targets: the dark wards; the last one waits on the clutch while the clump is out
  const dark = s.wards.map((w, i) => ({ ...w, i })).filter(w => !w.lit && (!AVG || (s.rp && s.rp.seen[w.i])));
  const nDark = s.wards.filter(w => !w.lit).length;
  let T = null, kind = 'ward', R = reach - 0.9;
  if (s.held >= 0 && nDark <= 1) { T = s.mass; kind = 'clutch'; R = 3.0; }
  else if (dark.length) {
    dark.sort((a, b) => hyp(a.p[0] - P[0], a.p[1] - P[1], a.p[2] - P[2]) - hyp(b.p[0] - P[0], b.p[1] - P[1], b.p[2] - P[2]));
    T = dark[0].p;
  }
  if (!T && nDark) { T = [s.lev[0], s.lev[1] - 0.3 * s.R, s.lev[2]]; kind = 'belly'; }
  if (!T) return { sec, yaw: 0, keys: [], why: 'idle' };
  const dx = T[0] - P[0], dz = T[2] - P[2], dh = hyp(dx, dz), up = T[1] - P[1];
  const d3 = hyp(dh, up);
  const yaw = Math.atan2(dx, dz) + noise;
  if (kind === 'clutch' && s.canReturn) return { sec, yaw, e: true, keys: s.grounded ? [] : ['C'], why: 'return' };
  // how high he must be at this horizontal distance to be in reach
  const hIn = Math.min(dh, R - 0.3), needUp = up - Math.sqrt(Math.max(0, R * R - hIn * hIn));
  const pitch = clamp(Math.atan2(up, Math.max(dh, 0.5)), -0.6, 1.2);
  // under the hammer, out in front of her and she is cocking: rush in under her
  const lx = s.lev[0] - P[0], lz = s.lev[2] - P[2], ld = hyp(lx, lz);
  if (!AVG && s.threatE > 0.5 && s.cock > 0.5 && ld > 0.9 * s.R && ld < 3.0 * s.R) {
    return { sec, yaw: Math.atan2(lx, lz), keys: s.grounded ? ['W', 'Shift'] : ['W'], why: 'dodge-under' };
  }
  if (d3 < R - 0.3) return { sec, yaw, keys: s.grounded ? [] : (s.vel[1] > 0.5 ? ['C'] : []), why: 'in-reach' };
  if (s.grounded) {
    const lookP = clamp(pitch, -0.3, 0.7);
    if (dh > 3.5 && needUp > -1) return { sec, yaw, pitch: lookP, keys: ['W', 'Shift'], why: 'walk' };
    if (needUp <= 0.2) return { sec, yaw, pitch: lookP, keys: ['W', 'Shift'], why: 'walk-in' };
    if (needUp <= 2.2) return { sec, yaw, pitch: clamp(pitch, -0.3, 0.7), keys: dh > 1.5 ? ['W'] : [], space: 0.05, why: 'hop' };
    // a burst toward it: held for what the climb needs
    const sp = AVG ? avgBurst : clamp(0.22 + 0.05 * needUp, 0.22, 1.2);
    return { sec: Math.max(sec, sp + 0.05), yaw, pitch, keys: dh > 1.5 ? ['W'] : [], space: sp, why: 'burst ' + needUp.toFixed(1) };
  }
  // in the water
  const vy = s.vel[1];
  const keys = [];
  if (dh > 1.2) keys.push('W');
  if (needUp < -1.0 || vy > 2.5 || (needUp < 0 && vy > 0.8)) keys.push('C');
  if (needUp > 1.5 && vy < 1.0 && s.reserve > 0.25) return { sec: Math.max(sec, 0.3), yaw, pitch, keys, space: AVG ? avgBurst : 0.25, why: 'swim-burst' };
  return { sec, yaw, pitch, keys, why: 'swim' };
}
function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

let s = await c.ev(STATE);
console.log('START', JSON.stringify({ site: SITE, mode: MODE, pos: s.pos, lev: s.lev, wards: s.wards.map(w => w.floor), massFloor: s.massFloor, canTake: s.canTake }));
let lastWhy = '';
while (t < +MAXS) {
  s = await c.ev(STATE);
  if (s.calmed) break;
  const d = decide(s);
  if (d.why !== lastWhy || d.e) log.push(`${t.toFixed(1)} ${d.why} agl ${s.agl} res ${s.reserve} lit ${s.wards.map(w => w.lit ? 1 : 0).join('')} held ${s.held} cr ${s.crouch} reach ${s.clutchReach}`);
  lastWhy = d.why;
  await slice(d);
  if (t - lastShot >= 10) { lastShot = t; await shot(String(Math.round(t)).padStart(3, '0')); }
}
// let the calm settle a beat
for (let i = 0; i < 8; i++) await slice({ sec: 0.25, yaw: 0, keys: [] });
s = await c.ev(STATE);
await shot('end');
const st = s.rp;
const ledger = { site: SITE, mode: MODE, seed: +SEED, completed: st.calmT != null, calmT: st.calmT, takeT: st.takeT, wardT: st.wardT, retT: st.retT,
  hits: st.hits, tears: st.tears, hitAt: st.hitAt, dryN: st.dryN, minReserve: +st.minReserve.toFixed(2), bowlN: st.bowlN, bowlAt: st.bowlAt, maxUp: +st.maxUp.toFixed(1), floatS: +st.floatS.toFixed(1),
  camN: st.camN, camBad: st.camBad, camBadPct: st.camN ? Math.round(100 * st.camBad / st.camN) : 0, pressedPct: st.camN ? Math.round(100 * st.pressed / st.camN) : 0, pressed: st.pressed, gameSec: +t.toFixed(1) };
console.log(log.join('\n'));
console.log('LEDGER', JSON.stringify(ledger));
writeFileSync(`${OUT}/${TAG}.json`, JSON.stringify({ ledger, log }, null, 1));
const cons = await c.console();
const errs = cons.filter(l => /error|EXC/i.test(l) && !/favicon/.test(l));
if (errs.length) console.log('CONSOLE', errs.slice(0, 5).join('\n'));
c.close();
stop();
process.exit(0);
