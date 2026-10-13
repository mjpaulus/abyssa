// RITE PLAYER (ritefair, 2026-10-09): Velkath's rite played end to end through REAL key events
// on the freeze-step loop of tools/bench/play.mjs (keys held over CDP for fixed slices of GAME
// time, the live loop held, __bench.step advancing it). A policy reads what a player reads off
// the screen (where her wards are, which are lit, the clutch, his air) and presses W/Shift/
// Space/C/E with a yaw/pitch, slice by slice, and the page books the ledger per frame.
//   node tools/bench/riteplay.mjs <port> <site: home|pallid|burned> <mode: perfect|average> <tag> [seed] [maxSec]
//   perfect: 0.25 s slices, exact aim.  average: 0.5-1.0 s slices, aim +-20 deg, bursts held
//   0.7-1.5x what was needed (a player who reads late and overshoots). (velhard) Both players live in
//   ritepolicy.mjs now (shared with fullplay.mjs): the perfect one plays her windows and counts its own
//   time under her; the average one lingers under her a little too long.
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
// RP_FLEE=<s>: after the pull he runs off for that long, so the rite starts against a risen,
// hunting Velkath; the ledger's case. (fissure-and-harpoon Task 6: the trigger is the harpoon in her
// near flank, Alt+6 stands him at it; the pry, the carried clump and the brood rule are gone.)
const FLEE = +(process.env.RP_FLEE || 0);

// ---- the page side (the ledger), the state a player reads and the two players: ritepolicy.mjs ----
const { PROBE, STATE, TALLY, makePolicy, clamp, DEG } = await import('./ritepolicy.mjs');

const c0 = await (async () => { await start(`http://localhost:${PORT}/${process.env.RP_PATH || ""}?playtest&bench`); return connect(); })();
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
// RP_PRE=<js>: evaluated before the jump (e.g. a revisit: the chart says pulled + calmed here, then a
// sail away and back: "__chart.pulled()[0]=1; __chart.rec()[0][0]=1; __chart.arrive(1); __chart.arrive(0)")
if (process.env.RP_PRE) await c.ev(`(() => { ${process.env.RP_PRE}; return 1; })()`);
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
await c.ev(`(async () => { const S = await import(new URL('src/world/fissureShape.js', document.baseURI).href); window.__fd = S.fissureDist; return 1; })()`);   // the crack test for the bowl ledger
await c.ev(PROBE);
// (clawcam) book the lens's look-up while the policy plays (frames it is on, its peak); main has no __clawcam
await c.ev(`(() => { const f0 = window.__rp.frame, st = window.__rp.st; st.ccN = 0; st.ccMax = 0; st.ccOff = 0;
  window.__rp.frame = () => { f0(); const C = window.__clawcam; if (!C) return; const s = C.state();
    if (s.tilt > 0) { st.ccN++; if (s.tiltDeg > st.ccMax) st.ccMax = s.tiltDeg; } if (s.why === 'mouse' || s.why === 'cool') st.ccOff++; }; return 1; })()`);
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
// (velhard) abortTele: the slice ends the moment her drop's telegraph starts (the perfect player leaves at
// once; a long burst is no excuse): stepped in 0.1 s chunks with the telegraph read between them
let aborted = false;
async function stepW(n, watch) {
  if (!watch) { await stepN(n); return n; }
  let k = 0;
  while (k < n) {
    const m = Math.min(6, n - k);
    await stepN(m); k += m;
    if (await c.ev(`window.lev && window.lev.drop === 1 ? 1 : 0`)) { aborted = true; return k; }
  }
  return k;
}
async function slice({ keys = [], sec, yaw, pitch = 0, space = 0, e = false, abortTele = false }) {
  const frames = Math.max(1, Math.round(sec * 60));
  await c.ev(`(window.player.yaw = ${yaw}, window.player.pitch = ${pitch}, 1)`);
  const watch = abortTele && !(await c.ev(`window.lev && window.lev.drop === 1 ? 1 : 0`));
  aborted = false;
  const MAP = { W: 'KeyW', S: 'KeyS', A: 'KeyA', D: 'KeyD', Shift: 'ShiftLeft', C: 'KeyC', E: 'KeyE', Space: 'Space' };
  for (const k of keys) await c.key(MAP[k], true);
  if (e) { await c.key('KeyE', true); await stepN(2); await c.key('KeyE', false); }
  let done = e ? 2 : 0;
  if (space > 0) {
    const sf = Math.max(2, Math.min(frames - done, Math.round(space * 60)));
    await c.key('Space', true);
    done += await stepW(sf, watch);
    await c.key('Space', false);
  }
  if (frames > done && !aborted) done += await stepW(frames - done, watch);
  for (const k of keys) await c.key(MAP[k], false);
  t += done / 60;
}

const decide = makePolicy({ AVG, rnd, FLEE, now: () => t });

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
// (fissure-and-harpoon Task 6) THE WAY DOWN: calmed, she walks home and the fissure opens (world/fissure.js);
// then Sal, stood over the crack's middle, goes down into it
let way = null;
if (s.calmed) {
  for (let i = 0; i < 100; i++) await slice({ sec: 0.25, yaw: 0, keys: [] });
  way = await c.ev(`(async () => { const S = await import(new URL('src/world/fissureShape.js', document.baseURI).href); const L = window.lev, o = { x: 0, z: 0 };
    const k = window.__fissure.k(0); const l = { u: 0, v: 0 }; S.fissureLocal(L.lairPos.x, L.lairPos.z, 0, l); S.fissureWorld(l.u, 0, 0, o);
    window.__bench.place(o.x, o.z, 0); const T = await import(new URL('src/world/terrain.js', document.baseURI).href); window.player.pos.y = T.terrainH(L.lairPos.x, L.lairPos.z, 0) + 2; window.player.grounded = false; const y0 = window.player.pos.y; window.__bench.step(240); return { openK: +k.toFixed(2), y0: +y0.toFixed(1), y4s: +window.player.pos.y.toFixed(1), fd: +S.fissureDist(window.player.pos.x, window.player.pos.z, 0).toFixed(1) }; })()`);
  await shot('down');
}
const st = s.rp;
const ledger = { site: SITE, mode: MODE, seed: +SEED, completed: st.calmT != null, calmT: st.calmT, takeT: st.takeT, wardT: st.wardT,
  hits: st.hits, tears: st.tears, hitAt: st.hitAt, ...(await c.ev(TALLY)), underS: +st.underS.toFixed(1), dryN: st.dryN, minReserve: +st.minReserve.toFixed(2), minAir: +st.minAir.toFixed(2), died: st.died, bowlN: st.bowlN, bowlAt: st.bowlAt, maxUp: +st.maxUp.toFixed(1), floatS: +st.floatS.toFixed(1),
  ccN: st.ccN, ccMax: st.ccMax, ccOff: st.ccOff, camN: st.camN, camBad: st.camBad, camBadPct: st.camN ? Math.round(100 * st.camBad / st.camN) : 0, pressedPct: st.camN ? Math.round(100 * st.pressed / st.camN) : 0, pressed: st.pressed, gameSec: +t.toFixed(1), way };
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
