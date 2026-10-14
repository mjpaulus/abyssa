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
// (seafloor relief Task 8) The ledger books her wards' height over her ground while she is up (wardUp, below), and the
// START line and the ledger name the ground the fight ran on (`ground`: __ridge.fp(); `lair`: her lairPos x, z). The
// ledger also books every tear's source and phase (hitLog) and every drop's outcome (dropLog), read-only, never gated.
// Env RP_WARD_BAR=<u> gates the column (main's highest over its fights + 0.5): a WARD PASS / FAIL line, exit 1 over the bar
// (or on a reading that was not finite); WARD UNMEASURED, exit 2, when she was never up (no frame booked: no reading at
// all, neither a pass nor a RED). Its one RED attempt (Task 8): her station on a mound's flank (a set is a full arrival, so
// before the jump, never mid-fight). On that mound the harpoon's seat search falls back to the flank and Sal slides off the
// anchor within 90 frames of Alt+6 (no prompt: the pull never comes), so it wakes her through the game's own command
// instead, after the jump (RP_POST: the jump rebuilds her, dormant):
//   RP_PRE='window.__relief.set({hollow:{sDrop:-14,sR:[8,24]}})' RP_POST='window.lev.cmd("wake")' RP_WARD_BAR=<u> \
//     node tools/bench/riteplay.mjs <port> home perfect <tag> 1
// Measured: it does NOT fail the bar (highest 12.50 u over 14523 frames up against 15.01; p50 7.82 against the shipped
// relief's 9.3-9.6; 240 s, not calmed), so the bound stands on its derivation from main's fights.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
if (!process.env.DRV_PORT) process.env.DRV_PORT = '9471';
// a FRESH profile every run: the chart save would otherwise remember a calm (a lit ward)
if (!process.env.DRV_DIR) { process.env.DRV_DIR = tmpdir() + '/abyssa-rp-' + process.env.DRV_PORT + '-' + Date.now(); }
const { start, stop, connect, sleep } = await import('./drv.mjs');
const [, , PORT, SITE = 'home', MODE = 'perfect', TAG = 'run', SEED = '1', MAXS = '240'] = process.argv;
// (the bar's positive control: a bar that is not a number would gate nothing)
const WARD_BAR = process.env.RP_WARD_BAR === undefined ? null : +process.env.RP_WARD_BAR;
if (WARD_BAR !== null && !Number.isFinite(WARD_BAR)) { console.error(`RP_WARD_BAR must be a finite number (got ${JSON.stringify(process.env.RP_WARD_BAR)})`); process.exit(2); }
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
// (Task 8) RP_POST=<js>: evaluated after the jump. The jump runs enterZone(0), which disposes her and builds a fresh,
// dormant sleeper, so anything done to HER (e.g. waking her) must come after it; RP_PRE is for the world before the jump
if (process.env.RP_POST) await c.ev(`(() => { ${process.env.RP_POST}; return 1; })()`);
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
// (seafloor relief Task 8) HER WARDS' HEIGHT OVER HER GROUND: the spec's G5 line, "her wards stay at today's height over
// her ground" (docs/superpowers/specs/2026-10-13-seafloor-relief-design.md §4: the rite assumes level ground; a bank
// under one side once lifted them to 10-17 u). Booked on EVERY frame she is UP: awake (the pull woke her: !L.dormant),
// not yet calmed (!L.calmed: calmed she walks home to her bed by the crack, which is not the fight) and risen past half
// (L.standE > 0.5, the framing ledger's own "awake" in ritepolicy.mjs PROBE: below it her wards are still coming up out
// of the silt). Every ward, lit or dark (a lit ward hangs where it did): h = ward.y - terrainH(ward.x, ward.z, 0), the
// brooder's own measure (brooder.js L.probe().wards[].y). Read-only: the ward positions are world space after her pose.
//   wardUp      the fight's highest h (u), the gated number; wardUpAt: when (ledger s), which ward, lit, her drop phase
//               (the drop's frames count: its telegraph braces her up to NOSAFE.brace 0.7 u, its slam lowers her),
//               standE, her standing body height over the ground under her centre (`body`: the drop's offset taken out,
//               as STATE reads her), how much lower the ground under that ward lies than under her centre (`bank`) and
//               the ward's distance off the crack (`fd`: a ward over the crack reads its depth)
//   wardUpDark  the same over dark wards only (what fissure-probe velkath-crack reads)
//   wardUpP50 / wardUpP95  over the frames up, each frame's highest ward: the stance beside the peak
//   wardUpN     frames booked; 0 = never up: unmeasured, never a pass. wardUpBad: readings that were not finite (each fails)
// It is a second wrap of __rp.frame (after the clawcam's) and returns nothing: a `false` would stop __bench.step.
await c.ev(`(() => { const f0 = window.__rp.frame, L = window.lev, st = window.__rp.st, W = { n: 0, bad: 0, max: null, dark: null, at: null, fr: [] };
  window.__rp.frame = () => { f0();
    if (L.dormant || L.calmed || !(L.standE > 0.5)) return;
    let fm = -Infinity;
    for (let i = 0; i < L.sigils.length; i++) {
      const g = L.sigils[i], p = g.grp.position, gw = terrainH(p.x, p.z, 0), h = p.y - gw;
      if (!Number.isFinite(h)) { W.bad++; continue; }
      if (h > fm) fm = h;
      if (!g.lit && (W.dark === null || h > W.dark)) W.dark = h;
      if (W.max === null || h > W.max) {
        const gc = terrainH(L.pos.x, L.pos.z, 0);
        W.max = h;
        W.at = { t: +(st.f / 60).toFixed(2), i, lit: !!g.lit, drop: L.drop || 0, standE: +L.standE.toFixed(2), body: +(L.bodyY - (L.dropY || 0) - gc).toFixed(2), bank: +(gc - gw).toFixed(2), fd: window.__fd ? +window.__fd(p.x, p.z, 0).toFixed(1) : null };
      }
    }
    W.n++; W.fr.push(fm); };
  window.__rpWard = () => { const s = W.fr.slice().sort((a, b) => a - b), q = k => s.length ? +s[Math.round(k * (s.length - 1))].toFixed(2) : null, r = x => x === null ? null : +x.toFixed(2);
    return { wardUp: r(W.max), wardUpDark: r(W.dark), wardUpP50: q(0.5), wardUpP95: q(0.95), wardUpN: W.n, wardUpBad: W.bad, wardUpAt: W.at }; };
  return 1; })()`);
// (seafloor relief Task 8, context round: Ruling 37 (e), booked for Michael, never gated) EVERY TEAR, what tore it and
// when in her fight. A third wrap of __rp.frame, read-only, after the ledger's own frame (which counts the tear: st.tears,
// and st.hits when it is > 0.5 s after the last). The source, in the game's own terms: her drop's slam (L.dropHits), the
// hammer (L.hits: her major claw's blow), else the body contact game.js booked in __slamLog this frame (legN / clawN / shell
// / clutch, with its speed), else 'other' (no sleeper source: a predator's bite). A sleeper tear game.js booked while the
// dress was already at its cap (survival.js TORN_CAP: torn does not rise, so the ledger cannot see it) is booked with
// ledger: false. The phase: her drop phase (L.drop: 0 none, 1 the telegraph, 2 the fall, 3 the rise) and the last drop's
// kind, the hammer's cock and swing, rising (her wake's rise), under her (L.nsUnder), his distance from her centre in R,
// his height over the ground, standE, the wards lit. Every drop's outcome is booked too (dropLog: clean / sweep / slam; a
// sweep throws him and never tears). Any throw in here is caught and counted (hitErr): this booking cannot stop a fight.
await c.ev(`(() => { const f0 = window.__rp.frame, L = window.lev, st = window.__rp.st, P = window.player;
  const H = { tears: st.tears, hits: st.hits, hammer: L.hits || 0, slam: L.dropHits || 0, dropN: L.dropHitN || 0, logN: (window.__slamLog || []).length, hitLog: [], dropLog: [], err: 0, errMsg: null };
  window.__rp.frame = () => { f0();
    try {
      const t = +(st.f / 60).toFixed(2), dropN = L.dropHitN || 0, hammer = L.hits || 0, slam = L.dropHits || 0;
      if (dropN > H.dropN) H.dropLog.push({ t, kind: L.dropKind || null });
      const log = window.__slamLog || [], game = log.length > H.logN ? log[log.length - 1] : null;
      const tore = st.tears > H.tears;
      if (tore || game) {
        let lit = 0; for (const g of L.sigils) if (g.lit) lit++;
        const src = slam > H.slam ? 'drop slam' : hammer > H.hammer ? 'hammer' : game && game.why !== 'blow' ? String(game.why).split(' ')[0].replace(/[0-9]+$/, '') : game ? 'blow' : 'other';
        H.hitLog.push({ t, ledger: tore, hit: st.hits > H.hits, src, game: game ? game.why : null, drop: L.drop || 0, dropKind: L.dropKind || null,
          cock: +(L.cock || 0).toFixed(2), swing: +(L.swing || 0).toFixed(2), rising: !!L.rising, under: !!L.nsUnder,
          rho: +(Math.hypot(P.pos.x - L.pos.x, P.pos.z - L.pos.z) / L.R).toFixed(2), agl: +(P.pos.y - 1.35 - terrainH(P.pos.x, P.pos.z, 0)).toFixed(2), standE: +L.standE.toFixed(2), lit });
      }
      H.tears = st.tears; H.hits = st.hits; H.hammer = hammer; H.slam = slam; H.dropN = dropN; H.logN = log.length;
    } catch (e) { H.err++; if (!H.errMsg) H.errMsg = String(e && e.message || e); } };
  window.__rpHits = () => ({ hitLog: H.hitLog, dropLog: H.dropLog, hitErr: H.err, hitErrMsg: H.errMsg });
  return 1; })()`);
// (Task 8) a shot's frame is a game frame like the others, so the ledger books it (it stepped unbooked before: one frame in
// every 10 s of play went past the ledger, and past the ward column, which reads every frame she is up)
const render = async () => {
  await c.ev(`(['title','pause','ptPanel','ptToast','ptDock'].forEach(id => { const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; }), window.__bench.step(1, () => window.__rp.frame(), { render: true }), 1)`);
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
// (Task 8) the ground this fight runs on: the canonical fingerprint (main 3b526986, the relief 5c0705a1, a mutant neither)
// and her bed (main's far flank (43.5, 113.4), the relief's station (89.7, 39.1))
const ground = await c.ev(`({ ground: window.__ridge.fp(), lair: [+window.lev.lairPos.x.toFixed(1), +window.lev.lairPos.z.toFixed(1)] })`);
console.log('START', JSON.stringify({ site: SITE, mode: MODE, ...ground, pos: s.pos, lev: s.lev, wards: s.wards.map(w => w.floor), lit: s.wards.map(w => w.lit ? 1 : 0).join(''), canTake: s.canTake, prompt: await c.ev(`window.lev.rite.prompt(window.player.pos)`) }));
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
const ledger = { site: SITE, mode: MODE, seed: +SEED, ...ground, completed: st.calmT != null, calmT: st.calmT, takeT: st.takeT, wardT: st.wardT,
  hits: st.hits, tears: st.tears, hitAt: st.hitAt, ...(await c.ev(TALLY)), underS: +st.underS.toFixed(1), dryN: st.dryN, minReserve: +st.minReserve.toFixed(2), minAir: +st.minAir.toFixed(2), died: st.died, bowlN: st.bowlN, bowlAt: st.bowlAt, maxUp: +st.maxUp.toFixed(1), floatS: +st.floatS.toFixed(1),
  ccN: st.ccN, ccMax: st.ccMax, ccOff: st.ccOff, camN: st.camN, camBad: st.camBad, camBadPct: st.camN ? Math.round(100 * st.camBad / st.camN) : 0, pressedPct: st.camN ? Math.round(100 * st.pressed / st.camN) : 0, pressed: st.pressed, gameSec: +t.toFixed(1),
  ...(await c.ev(`window.__rpWard()`)), ...(await c.ev(`window.__rpHits()`)), way };
console.log(log.join('\n'));
ledger.slamLog = await c.ev(`window.__slamLog || null`);
console.log('LEDGER', JSON.stringify(ledger));
writeFileSync(`${OUT}/${TAG}.json`, JSON.stringify({ ledger, log }, null, 1));
const wa = ledger.wardUpAt;
console.log(`WARD her wards over her ground while she was up: highest ${ledger.wardUp} u` + (wa ? ` (ward ${wa.i} ${wa.lit ? 'lit' : 'dark'} at ${wa.t} s, drop ${wa.drop}, standE ${wa.standE}, her body ${wa.body} u over her ground, bank ${wa.bank} u, fd ${wa.fd})` : '') +
  `, dark ${ledger.wardUpDark}, p50 ${ledger.wardUpP50} / p95 ${ledger.wardUpP95} over ${ledger.wardUpN} frames up` + (ledger.wardUpBad ? `, ${ledger.wardUpBad} NOT FINITE` : ''));
console.log(`HITS ${ledger.hits} (tears ${ledger.tears}): ` + (ledger.hitLog.map(h => `${h.t} s ${h.src}${h.game && h.src !== h.game ? ' [' + h.game + ']' : ''} drop ${h.drop}${h.rising ? ' rising' : ''}${h.under ? ' under' : ''} rho ${h.rho}R${h.ledger ? '' : ' (dress at its cap: not in the ledger)'}`).join('; ') || 'none') +
  `; drops ${ledger.dropLog.map(d => d.kind).join(' ') || 'none'}` + (ledger.hitErr ? `; HIT BOOKING ERRORS ${ledger.hitErr}: ${ledger.hitErrMsg}` : ''));
// the gate: PASS, FAIL (exit 1: over the bar, or a reading that was not finite; NaN-safe) or UNMEASURED (exit 2: she was
// never up, so there is no reading; a fight that never happened must not read as the bound's RED, nor as a pass)
let code = 0;
if (WARD_BAR !== null) {
  if (!(ledger.wardUpN > 0)) {
    console.log(`WARD UNMEASURED: she was never up (0 frames booked; woken: ${!s.dormant}): no reading against the bar (<= ${WARD_BAR})`);
    code = 2;
  } else {
    const ok = ledger.wardUpBad === 0 && Number.isFinite(ledger.wardUp) && ledger.wardUp <= WARD_BAR;
    console.log(`WARD ${ok ? 'PASS' : 'FAIL'}: highest ${ledger.wardUp} u over her ground (bar <= ${WARD_BAR}: main's highest + 0.5) over ${ledger.wardUpN} frames up` + (ledger.wardUpBad ? `, ${ledger.wardUpBad} readings not finite` : ''));
    if (!ok) code = 1;
  }
}
const cons = await c.console();
const errs = cons.filter(l => /error|EXC/i.test(l) && !/favicon/.test(l));
if (errs.length) console.log('CONSOLE', errs.slice(0, 5).join('\n'));
c.close();
stop();
process.exit(code);
