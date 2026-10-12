// FULL PLAY (2026-10-12, Michael: "record a full play through video from the raft to beating velkath
// and entering the rift after its open"). One continuous run through REAL key events on the freeze-step
// loop (riteplay.mjs's machinery and its fight policy, unchanged): from the raft deck, over the side,
// vented down and hauled across to her near flank by way of the other diver's trail (the boot, the
// coupling), [E] at the harpoon, the fight to the calm, then he walks to the opened fissure and sinks
// through its throat into zone 1. Video frames every 3rd game frame (RP_VIDEO=<dir>), assembled by the
// orchestrator. No ?playtest: nothing is jumped to.
//   RP_VIDEO=<dir> node tools/bench/fullplay.mjs <port> <mode: perfect|average> <tag> [seed] [maxSec]
// (velfix 2026-10-12) Two opt-in additions, neither changes what is played:
//   FP_GATE=1   the velfix gate, booked in the page every stepped frame and printed as a GATE line (exit 1 when
//               RED): THE WASH (every 3rd frame, while the lens is under her or within WASH_R of a lit ward: the
//               share of the drawn frame's pixels with Rec.709 luma > 230 outside each lit ward's own burn disc, and
//               in all, read back right after the frame's own render) and THE LENS IN HER (every frame she is
//               published awake: the camera inside her bodyCols volumes, margin 0 = inside, 0.15 = the near plane in
//               it, and every 3rd frame a ray from the lens toward his bonnet against her drawn meshes, a hit within
//               0.35 u = her surface on the lens; split fight / after the calm; RED on the after-the-calm inside
//               and ray counts).
//               Also: the lens in Sal (0.45 u of his axis), and her shell's lowest point over the ground per phase.
//   FP_STOP=<n> stop after n video-rate frames (every 3rd game frame, ~20 per game second: the RP_VIDEO index),
//               print the state; FP_HOLD=1 leaves the (frozen) Chrome up for `drv.mjs eval` and A/B pokes.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
if (!process.env.DRV_PORT) process.env.DRV_PORT = '9471';
// a FRESH profile every run: the chart save would otherwise remember a calm (a lit ward)
if (!process.env.DRV_DIR) { process.env.DRV_DIR = tmpdir() + '/abyssa-rp-' + process.env.DRV_PORT + '-' + Date.now(); }
const { start, stop, connect, sleep } = await import('./drv.mjs');
const [, , PORT, MODE = 'perfect', TAG = 'full', SEED = '1', MAXS = '240'] = process.argv;
const SITE = 'home';
const OUT = process.env.RP_OUT || '/Users/michaelpaulus/sc/.abyssa-wt/shots/ritefair-play';
mkdirSync(OUT, { recursive: true });
let seed = +SEED >>> 0 || 1;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const AVG = MODE === 'average';
// RP_FLEE=<s>: after the pull he runs off for that long, so the rite starts against a risen,
// hunting Velkath; the ledger's case. (fissure-and-harpoon Task 6: the trigger is the harpoon in her
// near flank, Alt+6 stands him at it; the pry, the carried clump and the brood rule are gone.)
const FLEE = +(process.env.RP_FLEE || 0);

// ---- the page side: the per-frame ledger ----
const PROBE = `(() => {
  const P = window.player, SV = window.survival, L = window.lev, cam = window.camera, V = P.pos.constructor;
  const v = new V(), w = new V();
  const seen = L.sigils.map(() => false);
  const st = { seen, f: 0, tears: 0, lastHit: -9, hits: 0, hitAt: [], dryN: 0, dryWas: false, low: 0, bowlN: 0, bowlAt: [], inBowl: false, camN: 0, camBad: 0, pressed: 0,
    wardT: L.sigils.map(g => g.lit ? 0 : null), calmT: null, retT: null, takeT: null, maxUp: 0, floatS: 0, tornPrev: SV.torn, pulledPrev: !!(L.harpoon && (L.harpoon.pulled && !L.harpoon.wound || L.harpoon.pressed)),
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
    const inB = window.__fd ? window.__fd(P.pos.x, P.pos.z, 0) < 0 : fl < st.lairFloor - 15 && lairD < 90;   // (fissure Task 5: the 'bowl' is the crack now)
    if (inB && !st.inBowl) { st.bowlN++; st.bowlAt.push(+t.toFixed(1)); }
    st.inBowl = inB;
    const agl = P.pos.y - 1.35 - fl;
    if (agl > st.maxUp) st.maxUp = agl;
    if (agl > 9) st.floatS += 1 / 60;
    for (let i = 0; i < L.sigils.length; i++) if (L.sigils[i].lit && st.wardT[i] == null) st.wardT[i] = +t.toFixed(1);
    if (L.calmed && st.calmT == null) st.calmT = +t.toFixed(1);
    const Hp = L.harpoon, pl = !!(Hp && ((Hp.pulled && !Hp.wound) || Hp.pressed));
    if (pl && !st.pulledPrev && st.takeT == null) st.takeT = +t.toFixed(1);
    st.pulledPrev = pl;
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
  const P = window.player, SV = window.survival, L = window.lev, Hp = L.harpoon, V = P.pos.constructor, r = x => +x.toFixed(2);
  const fl = terrainH(P.pos.x, P.pos.z, 0);
  const o = { pos: [r(P.pos.x), r(P.pos.y), r(P.pos.z)], vel: [r(P.vel.x), r(P.vel.y), r(P.vel.z)], agl: r(P.pos.y - 1.35 - fl), grounded: !!P.grounded,
    reserve: r(SV.reserve / (SV.reserveCap || 1)), fill: r(P.fill || 0), dormant: !!L.dormant, calmed: !!L.calmed, standE: r(L.standE),
    lev: [r(L.pos.x), r(L.bodyY), r(L.pos.z)], R: r(L.R), cock: r(L.cock || 0), threatE: r(L.threatE || 0), crouch: r(L.crouch ? L.crouch.x : 0),
    yaw: r(P.yaw), canTake: !!(L.rite && L.rite.prompt(P.pos)), wrenching: !!(Hp && Hp.wrenching),
    reach: L.reach, msg: window.__msg().live };
  o.wards = L.sigils.map(g => ({ p: [r(g.grp.position.x), r(g.grp.position.y), r(g.grp.position.z)], lit: !!g.lit, floor: r(g.grp.position.y - terrainH(g.grp.position.x, g.grp.position.z, 0)) }));
  o.rp = window.__rp ? window.__rp.st : null;
  return o;
})()`;

const c0 = await (async () => { await start(`http://localhost:${PORT}/${process.env.RP_PATH || ""}?bench`); return connect(); })();
const c = c0;
await c.until(`!document.getElementById('load') && typeof window.setState === 'function' && window.__bench`, 240000, 1000);
await c.ev(`(window.__helm = true, window.setState('play'), 1)`);
await sleep(3000);
// FP_PRE=<js>: evaluated once play is up (live knobs for an A/B, e.g. "__crecam.knobs.swNeed = -100")
if (process.env.FP_PRE) await c.ev(`(() => { ${process.env.FP_PRE}; return 1; })()`);
const alt = async code => {
  await c.ev(`(window.dispatchEvent(new KeyboardEvent('keydown', { code: '${code}', key: 'x', altKey: true, bubbles: true })), window.dispatchEvent(new KeyboardEvent('keyup', { code: '${code}', key: 'x', altKey: true, bubbles: true })), 1)`);
  await c.ev(`(window.__helm = true, window.__bench.step(90), 1)`);
};
// THE LIVE LOOP STOPS HERE: __bench.step only holds the game loop while it steps, so between
// CDP calls the page's own rAF kept playing real-time frames with the keys as they were (and a
// screenshot forces one), an unbooked, unrepeatable share of the fight. From now on time moves
// only through __bench.step.
await c.ev(`(window.requestAnimationFrame = cb => { window.__rafCb = cb; return 0; }, 1)`);
await sleep(300);
await c.ev(`(window.__rpFlee = ${FLEE}, 1)`);
await c.ev(`(async () => { const S = await import('/src/world/fissureShape.js'); window.__fd = S.fissureDist; window.__fs = S; return 1; })()`);   // the crack test for the bowl ledger
await c.ev(PROBE);
// ---- (velfix) the gate's page side: wraps the ledger's frame hook ----
const GATE = process.env.FP_GATE === '1';
// THE WASH is blown pixels (Rec.709 luma > 230) OUTSIDE every lit ward's own burn: a disc of WASH_DISC u round the ward,
// projected (the glyph is 2.4 u, its ring 2.6; the light's hot spot on her shell round it). Inside it the burn may
// clip: that is the strong gold burn on her shell the fix asks for. RED: any booked frame with more than WASH_BLOWN of
// the frame blown outside the burns, or more than WASH_CAP blown in all (the burn itself never fills the screen).
const WASH_BLOWN = 0.05, WASH_CAP = 0.15, WASH_R = 14, WASH_DISC = 4;
const GATE_JS = `(async () => {
  const BC = await import('/src/entities/sleeper/bodyCols.js');
  const { renderer } = await import('/src/core.js');
  const gl = renderer.getContext();
  const L = window.lev, cam = window.camera, P = window.player;
  const g = { washN: 0, washRed: 0, washSum: 0, washMax: 0, washMaxAt: null, washMeanLuma: 0, washAt: [], washOutSum: 0, washOutMax: 0, washOutMaxAt: null,
    lens: { fightN: 0, fightIn: 0, fightNear: 0, calmN: 0, calmIn: 0, calmNear: 0, inAt: [], parts: {}, salFight: 0, salCalm: 0,
      rayN: 0, rayFight: 0, rayCalm: 0, rayAt: [], rayHit: {} },
    // her shell's lowest point over the ground (u): the fight (up, hunting), the walk home (calmed, up), the settle
    shellClr: { fight: 99, home: 99, settle: 99 } };
  let buf = null;
  // THE DRAWN SURFACE (every 3rd frame): bodyCols is a fit (85th-percentile capsules, a height-band shell), so the
  // lens can be outside it with her drawn mesh across the near plane. A ray from the lens toward his bonnet against
  // her opaque meshes: a hit within 0.35 u of the lens is a surface ON the lens (the dark wedge).
  const T = (await import('three'));
  const rc = new T.Raycaster(), dir = new T.Vector3(), from = new T.Vector3();
  // (custom-instanced meshes, InstancedBufferGeometry, are left out: three raycasts only their base geometry)
  const meshes = []; L.grp.traverse(o => { if ((o.isMesh || o.isInstancedMesh) && !o.isSprite && o.material && !o.material.transparent && o.visible && !(o.geometry && o.geometry.isInstancedBufferGeometry)) meshes.push(o); });
  g.lens.rayMeshes = meshes.length;
  const base = window.__rp.frame;
  window.__rp.frame = () => {
    base();
    const f = window.__rp.st.f, t = f / 60;
    if (window.zone !== 0 || L.dormant || !BC.bodyColsOn()) return;
    const x = cam.position.x, y = cam.position.y, z = cam.position.z;
    const inside = BC.bodyBlocked(x, y, z, 0), why = BC.blockWhy, near = inside || BC.bodyBlocked(x, y, z, 0.15);
    const Lg = g.lens;
    // the lens in SAL (the other clip): within 0.45 u of his body's axis, boots (eye - 1.35) to bonnet top (eye + 0.4)
    const sy = Math.max(P.pos.y - 1.35, Math.min(P.pos.y + 0.4, y)), inSal = Math.hypot(x - P.pos.x, y - sy, z - P.pos.z) < 0.45;
    if (L.calmed) { Lg.calmN++; if (inside) Lg.calmIn++; if (near) Lg.calmNear++; if (inSal) Lg.salCalm++; }
    else { Lg.fightN++; if (inside) Lg.fightIn++; if (near) Lg.fightNear++; if (inSal) Lg.salFight++; }
    if (inside) { const k = why === -1 ? 'shell' : why === -3 ? 'clutch' : 'cap' + why; Lg.parts[k] = (Lg.parts[k] || 0) + 1; if (Lg.inAt.length < 60) Lg.inAt.push(+t.toFixed(2));
      if (window.__vfSnap && Lg.inAt.length <= 8) { const r = v => +v.toFixed(2); (Lg.snap = Lg.snap || []).push({ t: r(t), part: k, cam: [r(x), r(y), r(z)], sal: [r(P.pos.x), r(P.pos.y), r(P.pos.z)], vel: [r(P.vel.x), r(P.vel.y), r(P.vel.z)], grounded: !!P.grounded, yaw: r(P.yaw), pitch: r(P.pitch),
        cre: window.__crecam.state(), boss: window.__bosscam.state(), throat: window.__throatCam.state(), lev: { standE: r(L.standE), calmT: r(L.calmT || 0), toBed: !!L.toBed, pos: [r(L.pos.x), r(L.bodyY), r(L.pos.z)] }, bc: BC.bodyColsState() }); }
      if (window.__vfStopIn && !window.__vfHalt) { window.__vfHalt = true; return false; } }
    if (f % 3) return;
    {
      from.set(x, y, z); dir.set(P.pos.x - x, P.pos.y + 0.4 - y, P.pos.z - z);
      const dl = dir.length();
      if (dl > 1e-3) {
        dir.multiplyScalar(1 / dl); rc.set(from, dir); rc.near = 0; rc.far = Math.min(0.35, dl);
        const hits = rc.intersectObjects(meshes, false), hit = hits.length > 0;
        Lg.rayN++;
        if (hit) { if (L.calmed) Lg.rayCalm++; else Lg.rayFight++; if (Lg.rayAt.length < 30) Lg.rayAt.push(+t.toFixed(2));
          const o = hits[0].object, k = (o.name || o.type) + (o.isInstancedMesh ? '#' + hits[0].instanceId : '') + (o.geometry && o.geometry.attributes.position ? ':' + o.geometry.attributes.position.count : ''); Lg.rayHit[k] = (Lg.rayHit[k] || 0) + 1; }
      }
    }
    if (f % 12 === 0 && L.parts && L.parts.shell && L.standE > 0.05) {
      const SP = L.parts.shell.geometry.attributes.position, mw = L.parts.shell.matrixWorld; let low = 1e9;
      for (let k = 0; k < SP.count; k += 7) { from.fromBufferAttribute(SP, k).applyMatrix4(mw); low = Math.min(low, from.y - terrainH(from.x, from.z, 0)); }
      const ph = !L.calmed ? (L.standE > 0.9 ? 'fight' : null) : (L.standE > 0.9 ? 'home' : 'settle');
      if (ph) g.shellClr[ph] = Math.min(g.shellClr[ph], +low.toFixed(2));
    }
    let lit = false, dmin = 1e9, wmin = null;
    for (const s of L.sigils) if (s.lit) { lit = true; const dd = s.grp.position.distanceTo(cam.position); if (dd < dmin) { dmin = dd; wmin = s; } }
    if (!lit || !(BC.underShell(x, y, z) || BC.underShell(P.pos.x, P.pos.y + 1, P.pos.z) || dmin < ${WASH_R})) return;
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    if (!buf || buf.length !== W * H * 4) buf = new Uint8Array(W * H * 4);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    // each lit ward's burn disc in drawing-buffer pixels (rows bottom-up, as readPixels returns them)
    const discs = []; cam.updateMatrixWorld();
    const kpx = (H / 2) / Math.tan(cam.fov * Math.PI / 360);
    for (const s of L.sigils) if (s.lit) {
      if (s.grp.position.distanceTo(cam.position) < ${WASH_DISC}) { discs.push(0, 0, 1e9); continue; }   // (the lens inside the burn: only the cap applies)
      dir.copy(s.grp.position).applyMatrix4(cam.matrixWorldInverse);
      if (dir.z > -0.05) continue;                                                                 // (behind the lens)
      from.copy(s.grp.position).project(cam);
      discs.push((from.x * 0.5 + 0.5) * W, (from.y * 0.5 + 0.5) * H, ${WASH_DISC} * kpx / -dir.z);
    }
    let n = 0, hi = 0, sum = 0, out = 0;
    for (let i = 0; i < W * H * 4; i += 8) {
      const l = 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]; n++; sum += l;
      if (l <= 230) continue;
      hi++;
      const px = (i >> 2) % W, py = ((i >> 2) / W) | 0;
      let inD = false;
      for (let k = 0; k < discs.length; k += 3) { const dx = px - discs[k], dy = py - discs[k + 1]; if (discs[k + 2] > 1e8 || dx * dx + dy * dy < discs[k + 2] * discs[k + 2]) { inD = true; break; } }
      if (!inD) out++;
    }
    const sh = hi / n, so = out / n;
    g.washN++; g.washSum += sh; g.washOutSum += so; g.washMeanLuma += sum / n;
    // a RED frame explains itself: [t, blown, blown outside the burns, lens-to-bonnet u, nearest lit ward u, its flashT,
    // the lens-in-Sal frames so far in this phase, calmed]
    if (so > ${WASH_BLOWN} || sh > ${WASH_CAP}) { g.washRed++; if (g.washAt.length < 60) g.washAt.push([+t.toFixed(2), +sh.toFixed(3), +so.toFixed(3),
      +Math.hypot(x - P.pos.x, y - P.pos.y - 0.4, z - P.pos.z).toFixed(2), +dmin.toFixed(1), wmin ? +Math.min(9, wmin.flashT).toFixed(2) : null,
      L.calmed ? g.lens.salCalm : g.lens.salFight, !!L.calmed]); }
    if (sh > g.washMax) { g.washMax = sh; g.washMaxAt = +t.toFixed(2); }
    if (so > g.washOutMax) { g.washOutMax = so; g.washOutMaxAt = +t.toFixed(2); }
  };
  window.__vfGate = g;
  return 1;
})()`;
if (GATE) { await c.ev(GATE_JS); if (process.env.FP_SNAP) await c.ev("(window.__vfSnap = true, 1)"); if (process.env.FP_STOPIN) await c.ev("(window.__vfStopIn = true, 1)"); }
// ---- (velfix) FP_STOP / FP_HOLD ----
const STOP = +(process.env.FP_STOP || 0), HOLD = process.env.FP_HOLD === '1';
let gf = 0;
async function atStop() {
  const s = await c.ev(STATE);
  console.log('STOP', gf, (gf / 60).toFixed(2), JSON.stringify({ pos: s.pos, lev: s.lev, calmed: s.calmed, standE: s.standE, wards: s.wards.map(w => w.lit ? 1 : 0).join(''), cam: await c.ev(`window.camera.position.toArray().map(v => +v.toFixed(2))`) }));
  if (GATE) console.log('GATE-SO-FAR', JSON.stringify(await c.ev('window.__vfGate')));
  if (HOLD) { console.log(`HOLD: Chrome left up on DRV_PORT ${process.env.DRV_PORT}`); c.close(); process.exit(0); }
  c.close(); stop(); process.exit(0);
}
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
  // (velfix) FP_STOP: never step past the stop frame
  if (STOP) { if (gf >= STOP * 3) await atStop(); if (gf + n > STOP * 3) n = STOP * 3 - gf; }
  gf += n;
  await stepN0(n);
  if (STOP && gf >= STOP * 3) await atStop();
  if (process.env.FP_STOPIN && await c.ev('!!window.__vfHalt')) await atStop();
}
async function stepN0(n) {
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
  // asleep: [E] at the harpoon (or the old wound), then hands off through the wrench
  if (s.dormant) return { sec: 0.2, yaw: s.yaw, e: s.canTake && !s.wrenching, keys: [], why: s.wrenching ? 'wrench' : 'pull' };
  if (t < FLEE) { const ax = P[0] - s.lev[0], az = P[2] - s.lev[2]; return { sec, yaw: Math.atan2(ax, az) + noise, keys: ['W', 'Shift'], why: 'flee' }; }
  // targets: the dark wards
  const dark = s.wards.map((w, i) => ({ ...w, i })).filter(w => !w.lit && (!AVG || (s.rp && s.rp.seen[w.i])));
  const nDark = s.wards.filter(w => !w.lit).length;
  let T = null, kind = 'ward', R = reach - 0.9;
  if (dark.length) {
    dark.sort((a, b) => hyp(a.p[0] - P[0], a.p[1] - P[1], a.p[2] - P[2]) - hyp(b.p[0] - P[0], b.p[1] - P[1], b.p[2] - P[2]));
    T = dark[0].p;
  }
  if (!T && nDark) { T = [s.lev[0], s.lev[1] - 0.3 * s.R, s.lev[2]]; kind = 'belly'; }
  if (!T) return { sec, yaw: 0, keys: [], why: 'idle' };
  const dx = T[0] - P[0], dz = T[2] - P[2], dh = hyp(dx, dz), up = T[1] - P[1];
  const d3 = hyp(dh, up);
  const yaw = Math.atan2(dx, dz) + noise;
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


// ---- THE APPROACH: deck -> over the side -> down and across, by the other diver's trail ----
const NAV = `(() => { const P = window.player, L = window.lev, B = L.brood, H = L.harpoon, r = x => +x.toFixed(2);
  const fl = terrainH(P.pos.x, P.pos.z, 0);
  return { pos: [r(P.pos.x), r(P.pos.y), r(P.pos.z)], vy: r(P.vel.y), grounded: !!P.grounded, onDeck: !!P.onDeck,
    agl: r(P.pos.y - 1.35 - fl), zone: window.zone, canTake: !!(L.rite && L.rite.prompt(P.pos)), dormant: !!L.dormant,
    reserve: r(window.survival.reserve / (window.survival.reserveCap || 1)),
    boot: [r(B.bootAt.x), r(B.bootAt.y), r(B.bootAt.z)], coup: [r(B.couplingAt.x), r(B.couplingAt.y), r(B.couplingAt.z)],
    anchor: [r(H.anchor.x), r(H.anchor.y), r(H.anchor.z)], msg: window.__msg().live }; })()`;
const phase = [];
// FP_HOSE=<u>: the line he has gathered (a fresh diver's line stops him in zone 0's throat: HOSE_REQ gates zone 1)
if (process.env.FP_HOSE) await c.ev(`(window.survival.hose = ${+process.env.FP_HOSE}, 1)`);
let n0 = await c.ev(NAV);
phase.push(`${t.toFixed(1)} deck ${JSON.stringify(n0.pos)} msg ${n0.msg}`);
// walk +X through the bulwark gap and over the side
for (let i = 0; i < 80; i++) {
  const n = await c.ev(NAV);
  if (!n.onDeck && n.pos[1] < -1.5) break;
  await slice({ sec: 0.25, yaw: Math.PI / 2, pitch: -0.05, keys: ['W'] });
}
phase.push(`${t.toFixed(1)} over the side`);
async function travel(name, key, radius, maxS) {
  const t0 = t; let last = null, lastT = t;
  while (t - t0 < maxS) {
    const n = await c.ev(NAV); const T = n[key];
    const dx = T[0] - n.pos[0], dz = T[2] - n.pos[2], dh = Math.hypot(dx, dz);
    if (key === 'anchor' ? n.canTake : dh < radius) { phase.push(`${t.toFixed(1)} at ${name} dh ${dh.toFixed(1)} msg ${n.msg}`); return true; }
    const yaw = Math.atan2(dx, dz);
    if (!n.grounded) {
      const keys = dh > 1.2 ? ['W'] : [];
      // a glide slope: vent while he is higher above the floor than the way still to go allows
      if (n.agl > Math.max(3, dh * 0.9) || dh < 10) keys.push('C');
      await slice({ sec: 0.5, yaw, pitch: -0.15, keys });
    } else {
      if (!last || t - lastT >= 2) {
        const moved = last ? Math.hypot(n.pos[0] - last[0], n.pos[2] - last[2]) : 9;
        last = n.pos; lastT = t;
        if (moved < 0.8) { await slice({ sec: 0.6, yaw, pitch: 0.1, keys: ['W'], space: 0.35 }); continue; }   // stuck on a lip or a block: a burst over it
      }
      await slice({ sec: 0.5, yaw, pitch: -0.1, keys: dh > 2 ? ['W', 'Shift'] : ['W'] });
    }
  }
  phase.push(`${t.toFixed(1)} gave up on ${name}`); return false;
}
await travel('the boot', 'boot', 3, 150);
await travel('the coupling', 'coup', 3, 60);
await travel('the harpoon', 'anchor', 0, 60);
// face the iron so his light finds it (the first-sight line)
{ const n = await c.ev(NAV); const yaw = await c.ev(`Math.atan2(window.lev.harpoon.seam.x - window.player.pos.x, window.lev.harpoon.seam.z - window.player.pos.z)`);
  for (let i = 0; i < 8; i++) await slice({ sec: 0.25, yaw, pitch: 0.05, keys: [] }); phase.push(`${t.toFixed(1)} facing the iron msg ${(await c.ev(NAV)).msg}`); }

let s = await c.ev(STATE);
console.log('START', JSON.stringify({ site: SITE, mode: MODE, t: +t.toFixed(2), pos: s.pos, lev: s.lev, wards: s.wards.map(w => w.floor), lit: s.wards.map(w => w.lit ? 1 : 0).join(''), canTake: s.canTake, prompt: await c.ev(`window.lev.rite.prompt(window.player.pos)`), cre: await c.ev('window.__crecam.state().swings') }));
let lastWhy = '';
while (t < +MAXS) {
  s = await c.ev(STATE);
  if (s.calmed) break;
  const d = decide(s);
  if (d.why !== lastWhy || d.e) log.push(`${t.toFixed(1)} ${d.why} agl ${s.agl} res ${s.reserve} lit ${s.wards.map(w => w.lit ? 1 : 0).join('')} cr ${s.crouch}`);
  lastWhy = d.why;
  await slice(d);
  if (t - lastShot >= 10) { lastShot = t; await shot(String(Math.round(t)).padStart(3, '0')); }
}
// let the calm settle a beat
for (let i = 0; i < 8; i++) await slice({ sec: 0.25, yaw: 0, keys: [] });
s = await c.ev(STATE);
await shot('end');
// THE WAY DOWN, WALKED: calmed, he turns to the crack (the pour and the light ahead of him), walks to
// its middle and over the lip, and vents down through the opened throat into zone 1
let way = null;
if (s.calmed) {
  const CRK = `(() => { const S = window.__fs, P = window.player, l = { u: 0, v: 0 }, o = { x: 0, z: 0 };
    S.fissureLocal(P.pos.x, P.pos.z, 0, l); S.fissureWorld(Math.max(-14, Math.min(14, l.u)), 0, 0, o);
    return { x: o.x, z: o.z, fd: S.fissureDist(P.pos.x, P.pos.z, 0), k: window.__fissure.k(0), zone: window.zone, y: P.pos.y, grounded: !!P.grounded, msg: window.__msg().live }; })()`;
  const t0 = t; let last = null, lastT = t, zoneAt = null;
  while (t - t0 < 90) {
    const q = await c.ev(CRK);
    if (q.zone === 1 && zoneAt == null) { zoneAt = t; phase.push(`${t.toFixed(1)} zone 1 y ${q.y.toFixed(1)} msg ${q.msg}`); }
    if (zoneAt != null && t - zoneAt > 5) break;
    const yaw = Math.atan2(q.x - (await c.ev('window.player.pos.x')), q.z - (await c.ev('window.player.pos.z')));
    if (!q._l && (t - (globalThis.__dl || -9) >= 2)) { globalThis.__dl = t; const pp = await c.ev('[window.player.pos.x, window.player.pos.y, window.player.pos.z].map(v => +v.toFixed(1))'); const inT = await c.ev('window.__fs.inThroat ? window.__fs.inThroat(window.player.pos.x, window.player.pos.z, 0) : null'); phase.push(`${t.toFixed(1)} down fd ${q.fd.toFixed(1)} k ${q.k.toFixed(2)} gr ${q.grounded} pos ${pp} inT ${inT} zone ${q.zone} tgt ${q.x.toFixed(1)},${q.z.toFixed(1)}`); }
    if (q.fd < -1 && !q.grounded) { await slice({ sec: 0.5, yaw, pitch: -0.35, keys: ['C'] }); continue; }   // in the throat: down
    if (q.grounded && q.k > 0.5) {
      if (!last || t - lastT >= 2) { const p = await c.ev('[window.player.pos.x, window.player.pos.z]'); const moved = last ? Math.hypot(p[0] - last[0], p[1] - last[1]) : 9; last = p; lastT = t;
        if (moved < 0.8) { await slice({ sec: 0.6, yaw, pitch: 0, keys: ['W'], space: 0.3 }); continue; } }
      await slice({ sec: 0.5, yaw, pitch: -0.2, keys: ['W', 'Shift'] }); continue;
    }
    if (!q.grounded && q.fd >= -1) { await slice({ sec: 0.5, yaw, pitch: -0.2, keys: ['W', 'C'] }); continue; }
    await slice({ sec: 0.5, yaw, pitch: -0.1, keys: [] });   // the crack still pouring: watch it open
  }
  way = { zoneAt: zoneAt == null ? null : +zoneAt.toFixed(1) };
  await shot('down');
}
console.log(phase.join('\n'));
const st = s.rp;
const ledger = { site: SITE, mode: MODE, seed: +SEED, completed: st.calmT != null, calmT: st.calmT, takeT: st.takeT, wardT: st.wardT,
  hits: st.hits, tears: st.tears, hitAt: st.hitAt, dryN: st.dryN, minReserve: +st.minReserve.toFixed(2), bowlN: st.bowlN, bowlAt: st.bowlAt, maxUp: +st.maxUp.toFixed(1), floatS: +st.floatS.toFixed(1),
  camN: st.camN, camBad: st.camBad, camBadPct: st.camN ? Math.round(100 * st.camBad / st.camN) : 0, pressedPct: st.camN ? Math.round(100 * st.pressed / st.camN) : 0, pressed: st.pressed, gameSec: +t.toFixed(1), way };
console.log(log.join('\n'));
ledger.slamLog = await c.ev(`window.__slamLog || null`);
// (velfix) the quality ladder as the run ended: the real loop's perf judge runs before the stepped loop takes over, and a
// loaded machine (several of these at once) can shed passes, which changes the render the fight's colliders read back
ledger.perf = await c.ev(`window.__perf ? window.__perf.state() : null`);
console.log('LEDGER', JSON.stringify(ledger));
let gateRed = false;
if (GATE) {
  const g = await c.ev('window.__vfGate');
  // the lens, after the calm (the walk home, the settle, him under her): inside her bodyCols (margin 0), or her drawn
  // surface on the lens (the ray). The near-plane count (0.15) is reported, not gated: it is the camera guard's own
  // trigger zone (game.js draws the lens out of it on the next frames), so a frame of it is the guard working. The
  // fight's own counts are reported beside it: the fight's camera is baa7f88's, unchanged, and a claw blow can cross
  // it for a frame or two (pre-existing, rare).
  const lensRed = g.lens.calmIn + g.lens.rayCalm > 0;
  const washRed = g.washRed > 0;
  gateRed = washRed || lensRed;
  ledger.gate = g;
  console.log('GATE', gateRed ? 'RED' : 'GREEN', JSON.stringify({
    wash: { booked: g.washN, red: g.washRed, meanBlown: g.washN ? +(g.washSum / g.washN).toFixed(4) : 0, maxBlown: +g.washMax.toFixed(3), maxAt: g.washMaxAt,
      meanOutside: g.washN ? +(g.washOutSum / g.washN).toFixed(4) : 0, maxOutside: +g.washOutMax.toFixed(3), maxOutsideAt: g.washOutMaxAt,
      meanLuma: g.washN ? +(g.washMeanLuma / g.washN).toFixed(1) : 0, verdict: washRed ? `RED (${g.washRed} frames > ${WASH_BLOWN} blown outside the burns or > ${WASH_CAP} in all)` : 'GREEN', at: g.washAt.slice(0, 12) },
    lens: { ...g.lens, inAt: g.lens.inAt.slice(0, 20), rayAt: g.lens.rayAt.slice(0, 20), snap: undefined, verdict: lensRed ? 'RED' : 'GREEN' }, shellClr: g.shellClr }));
}
writeFileSync(`${OUT}/${TAG}.json`, JSON.stringify({ ledger, log }, null, 1));
const cons = await c.console();
const errs = cons.filter(l => /error|EXC/i.test(l) && !/favicon/.test(l));
if (errs.length) console.log('CONSOLE', errs.slice(0, 5).join('\n'));
c.close();
stop();
process.exit(gateRed ? 1 : 0);
