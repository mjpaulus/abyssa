// FULL PLAY (2026-10-12, Michael: "record a full play through video from the raft to beating velkath
// and entering the rift after its open"). One continuous run through REAL key events on the freeze-step
// loop (riteplay.mjs's machinery; the fight policy is ritepolicy.mjs, shared with riteplay.mjs since
// velhard): from the raft deck, over the side,
// vented down and hauled across to her near flank by way of the other diver's trail (the boot, the
// coupling), [E] at the harpoon, the fight to the calm, then he walks to the opened fissure and sinks
// through its throat into zone 1. Video frames every 3rd game frame (RP_VIDEO=<dir>), assembled by the
// orchestrator. No ?playtest: nothing is jumped to.
//   RP_VIDEO=<dir> node tools/bench/fullplay.mjs <port> <mode: perfect|average> <tag> [seed] [maxSec]
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

// ---- the page side (the ledger), the state a player reads and the two players: ritepolicy.mjs ----
const { PROBE, STATE, TALLY, makePolicy, clamp, DEG } = await import('./ritepolicy.mjs');

const c0 = await (async () => { await start(`http://localhost:${PORT}/${process.env.RP_PATH || ""}?bench`); return connect(); })();
const c = c0;
await c.until(`!document.getElementById('load') && typeof window.setState === 'function' && window.__bench`, 240000, 1000);
await c.ev(`(window.__helm = true, window.setState('play'), 1)`);
await sleep(3000);
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

const decide = makePolicy({ AVG, rnd, FLEE, now: () => t });


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
console.log('START', JSON.stringify({ site: SITE, mode: MODE, pos: s.pos, lev: s.lev, wards: s.wards.map(w => w.floor), lit: s.wards.map(w => w.lit ? 1 : 0).join(''), canTake: s.canTake, prompt: await c.ev(`window.lev.rite.prompt(window.player.pos)`) }));
let lastWhy = '';
while (t < +MAXS) {
  s = await c.ev(STATE);
  if (s.calmed) break;
  const d = decide(s);
  if (d.why !== lastWhy || d.e || process.env.RP_LOGALL) log.push(`${t.toFixed(1)} ${d.why} agl ${s.agl} res ${s.reserve} lit ${s.wards.map(w => w.lit ? 1 : 0).join('')} ${decide.dbg || ''}`);
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
  hits: st.hits, tears: st.tears, hitAt: st.hitAt, ...(await c.ev(TALLY)), underS: +st.underS.toFixed(1), dryN: st.dryN, minReserve: +st.minReserve.toFixed(2), minAir: +st.minAir.toFixed(2), died: st.died, bowlN: st.bowlN, bowlAt: st.bowlAt, maxUp: +st.maxUp.toFixed(1), floatS: +st.floatS.toFixed(1),
  camN: st.camN, camBad: st.camBad, camBadPct: st.camN ? Math.round(100 * st.camBad / st.camN) : 0, pressedPct: st.camN ? Math.round(100 * st.pressed / st.camN) : 0, pressed: st.pressed, gameSec: +t.toFixed(1), way };
console.log(log.join('\n'));
ledger.slamLog = await c.ev(`window.__slamLog || null`);
console.log('LEDGER', JSON.stringify(ledger));
writeFileSync(`${OUT}/${TAG}.json`, JSON.stringify({ ledger, log }, null, 1));
const cons = await c.console();
const errs = cons.filter(l => /error|EXC/i.test(l) && !/favicon/.test(l));
if (errs.length) console.log('CONSOLE', errs.slice(0, 5).join('\n'));
c.close();
stop();
process.exit(0);
