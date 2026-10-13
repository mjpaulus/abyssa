// RELIEF LOAD (seafloor relief Task 5; spec docs/superpowers/specs/2026-10-13-seafloor-relief-design.md G7, and the
// plan's Review Focus 2 and 3): home's new zone 0 IN THE GAME. Every mode is a fresh load in its own fresh profile (a
// private headless Chrome over tools/bench/drv.mjs) with the console captured from the first byte: the page is
// navigated from about:blank only after the CDP Runtime/Log domains are on.
//   DRV_PORT=9520 node tools/bench/relief-load.mjs <port> [all|load|parity|voyage|oldsave]   (serve.py serves <port>)
// load     ?playtest, __helm = true, setState('play'), 32 s of play, then: the lights (core.js scene), __ridge.fp() and
//          fp([1,2]), __lev.fp(0..2), sleeperFingerprint(0..2) and zone 0 again, as brooder-invariants.mjs takes them,
//          __safeFailed() / __shaderFailed() before and after the fingerprints, __boot, the console.
//          Exit 1 on: lights != 14; fp([1,2]) != d49d451d; __lev.fp(1/2) != c938fe6e / 652d0412;
//          sleeperFingerprint(1/2) != ac04921e / ce3eaf9d; a failure list not []; a console error but the favicon 404;
//          and home's anchors: __ridge.fp() != tools/relief/expect.json's `home`, __lev.fp(0) / sleeperFingerprint(0)
//          != ANCHOR below (recorded by Task 5; a move is a finding: name its cause before re-recording it).
// parity   terrainH, zone 0, on the 2 u grid x, z in [-120, 280] (the hollow) in the page, as float64 bytes, against the
//          sliced replica in node (tools/relief/terrain.gen.mjs, re-sliced first; its canonical fingerprint must be
//          expect.json's home). Exit 1 unless |d| <= 1e-9 on >= 99% of the points (Chrome's and node's Math.exp can
//          differ in the last bit).
// voyage   arrive(1) -> __chart.fp() b1c58f8d, arrive(2) -> d2b6fb68, then three round trips arrive(1), arrive(0). On
//          every arrival at Pallid its fp holds; on every arrival home: __ridge.fp() = home, the live sleeper is the
//          Brooder, her lairPos is within 0.5 u of her raft-side station (89.7, 39.1) and equals the replica's
//          velkathLair, lair.js bedAt() (the scatter's bed, cached on the wreck sites' identity) equals lairPos, and the
//          skiff's site (wrecks.sites(0)) equals the replica's wreckSites()[0]; and every arrival home is identical to
//          the fresh load's. wrecks.list() reports the skiff's RELIC on its settled hull, not the site the replica
//          computes: it is booked and held identical, not compared with the replica.
// oldsave  a save shaped as game.js saveChart() writes it (site 0, pulled[0] and sighted[0] set, tools.harpoon), put in
//          localStorage before the page's first script; Alt+6 as a real key: the rite's prompt and the HUD read
//          '[E] PRESS THE OLD WOUND', the anchor stands within 30 u of (89.7, 39.1), harpoon-probe's routes checks pass at
//          this site (its prompt check is the wound's here); then a real E wakes her (the remembered rite starts there).
// The failing case is main (a `git archive main` copy served on its own port), measured 2026-10-13. load passes every
// shipped invariant there (3b526986; ecfa371e ac04921e ce3eaf9d; 15ce888c c938fe6e 652d0412) and fails only home's
// anchors. voyage: main's bed lies on the far flank at (43.5, 113.4), 87.5 u off the station, and its skiff site is 58 u
// from the replica's. oldsave: the old wound's anchor is 105 u off.
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const [, , PORT = '8870', MODE = 'all'] = process.argv;
const MODES = ['load', 'parity', 'voyage', 'oldsave'];
if (MODE === 'all') {
  const bad = [];
  for (const m of MODES) if (spawnSync(process.execPath, [fileURLToPath(import.meta.url), PORT, m], { stdio: 'inherit' }).status !== 0) bad.push(m);
  console.log(bad.length ? 'RELIEF LOAD FAIL: ' + bad.join(', ') : 'RELIEF LOAD PASS: ' + MODES.join(', '));
  process.exit(bad.length ? 1 : 0);
}
if (!MODES.includes(MODE)) { console.error('unknown mode ' + MODE); process.exit(2); }
if (!process.env.DRV_PORT) process.env.DRV_PORT = '9520';
process.env.DRV_DIR = mkdtempSync(join(tmpdir(), 'abyssa-relief-load-'));   // a fresh profile: no save, no caches
const { start, stop, connect, sleep } = await import('./drv.mjs');
process.on('exit', () => { stop(); try { rmSync(process.env.DRV_DIR, { recursive: true, force: true }); } catch (e) { } });

const EXP = JSON.parse(readFileSync(new URL('../relief/expect.json', import.meta.url), 'utf8'));
const SHIPPED = { fp12: 'd49d451d', lev1: 'c938fe6e', lev2: '652d0412', sl1: 'ac04921e', sl2: 'ce3eaf9d', pallid: 'b1c58f8d', burned: 'd2b6fb68' };
// (Task 5, on 5c0705a1) __lev.fp(0) held 15ce888c: the serpent's one terrain read (serpent.js updateBlobs) moves only its
// blob meshes, which leviathan.js sleeperFingerprint does not hash. sleeperFingerprint(0) moved ecfa371e -> 1ca3b28c: her
// wards and body sit over the new ground.
const ANCHOR = { home: EXP.home, lev0: '15ce888c', sl0: '1ca3b28c' };
const STATION = { x: 89.7, z: 39.1 };       // her raft-side station (spec §5; a pure function of the frozen fissure frame)
const fails = [];
const show = v => typeof v === 'string' ? v : JSON.stringify(v);
const check = (name, ok, v) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (v === undefined ? '' : ' -> ' + show(v))); if (!ok) fails.push(name); };

// ---- boot: about:blank, the domains on, (the old save seeded into the next document), then the game ----
const SAVE = MODE === 'oldsave' ? {
  site: 0, rec: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]], found: [1, 1, 1, 0], keeps: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]],
  pulled: [1, 0, 0, 0], sighted: [1, 0, 0, 0], endingSeen: false, hose: 380, mute: false,
  tools: { sonar: false, spear: false, thruster: false, harpoon: true }
} : null;
await start('about:blank');
const c = await connect();
await c.send('Runtime.enable'); await c.send('Log.enable'); await c.send('Page.enable');
let seed = null;
if (SAVE) seed = (await c.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('abyssa.chart.v1', ${JSON.stringify(JSON.stringify(SAVE))}); } catch (e) { }` })).result.identifier;
const URL0 = `http://localhost:${PORT}/?playtest`, tNav = Date.now();
await c.send('Page.navigate', { url: URL0 });
await c.until(`!document.getElementById('load') && typeof window.setState === 'function' && !!window.__chart && !!window.__lev`, 240000, 500);
const loadMs = Date.now() - tNav;
if (seed) await c.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: seed });
console.log(`relief-load ${MODE} ${URL0} (fresh profile): loaded in ${(loadMs / 1000).toFixed(1)} s`);

function consoleLines() {
  const out = [];
  for (const e of c.events) {
    if (e.method === 'Runtime.consoleAPICalled') out.push({ lvl: e.params.type, text: e.params.args.map(a => a.value ?? a.description).join(' ') });
    else if (e.method === 'Log.entryAdded') out.push({ lvl: e.params.entry.level, text: e.params.entry.text, url: e.params.entry.url || '' });
    else if (e.method === 'Runtime.exceptionThrown') out.push({ lvl: 'error', text: 'EXC ' + e.params.exceptionDetails.text + ' ' + (e.params.exceptionDetails.exception && e.params.exceptionDetails.exception.description) });
  }
  return out;
}
function consoleCheck() {
  const L = consoleLines(), fav = l => /\/favicon\.ico$/.test(l.url || '') && /404/.test(l.text);
  const errs = L.filter(l => (l.lvl === 'error' || l.lvl === 'assert') && !fav(l)), warns = L.filter(l => l.lvl === 'warning');
  console.log(`  console: ${L.length} lines, ${warns.length} warnings, favicon 404 x${L.filter(fav).length}, other errors ${errs.length}`);
  for (const w of [...new Set(warns.map(l => l.text.slice(0, 110)))].slice(0, 6)) console.log('    warning ' + w);
  for (const l of errs.slice(0, 8)) console.log('    ' + l.lvl + ' ' + l.text.slice(0, 300) + ' ' + (l.url || ''));
  check('console: no error but the favicon 404', errs.length === 0, errs.length);
}
const LIGHTS = `(async () => { const core = await import('/src/core.js'); let n = 0; core.scene.traverse(o => { if (o.isLight) n++; }); return n; })()`;
const replica = async () => {   // the sliced real code in node, at home, re-sliced first (tools/relief/validate.mjs's way)
  await import('../relief/slice.mjs');
  const T = await import('../relief/terrain.gen.mjs'), P = await import('../relief/pins.gen.mjs');
  const S = await import('../../src/world/site.js'), CFG = await import('../../src/config.js');
  S.setSite(0); T.syncSite(); P.resetPins();
  const fp = zones => {   // terrain.js terrainFingerprint: FNV-1a over the float32 bytes, 32 x 32, -248..248 step 16
    let h = 0x811c9dc5; const f = new Float32Array(1), b = new Uint8Array(f.buffer);
    for (const zi of zones) for (let j = 0; j < 32; j++) for (let i = 0; i < 32; i++) {
      f[0] = T.terrainH(-248 + i * 16, -248 + j * 16, zi);
      for (let k = 0; k < 4; k++) { h ^= b[k]; h = Math.imul(h, 16777619) >>> 0; }
    }
    return h.toString(16).padStart(8, '0');
  };
  return { T, P, CFG, fp };
};

await c.ev(`(window.__helm = true, window.setState('play'), 1)`);

if (MODE === 'load') {
  await sleep(32000);
  const s = await c.ev(`({ gameState: window.gameState, hidden: document.hidden, site: __chart.site(), zone: window.zone, boot: __boot.total, bootLog: __boot.log().map(r => r[0] + ' ' + Math.round(r[1])) })`);
  const lights = await c.ev(LIGHTS);
  const safe = await c.ev(`__safeFailed()`), shader = await c.ev(`__shaderFailed()`);
  const ridge = await c.ev(`__ridge.fp()`), ridge12 = await c.ev(`__ridge.fp([1, 2])`);
  const lev = await c.ev(`[__lev.fp(0), __lev.fp(1), __lev.fp(2)]`);
  // brooder-invariants.mjs's take (zone 0 twice: deterministic). It builds over the live sleeper; the live one is then
  // rebuilt as the chart builds her (__lev.remember(null)), not set down 45 u ahead of Sal as brooder-invariants' swap() does
  const sfp = await c.ev(`(async () => { const M = await import('/src/entities/leviathan.js'); const out = []; for (let i = 0; i < 3; i++) out.push(M.sleeperFingerprint(i)); out.push(M.sleeperFingerprint(0)); return out; })()`);
  await c.ev(`(window.__lev.remember(null), 1)`);
  const lights2 = await c.ev(LIGHTS), safe2 = await c.ev(`__safeFailed()`), shader2 = await c.ev(`__shaderFailed()`), live = await c.ev(`({ kind: lev && lev.kind, same: window.__sl === lev, state: window.gameState })`);
  console.log('  state ' + show(s));
  console.log(`  lights ${lights} (after the fingerprints ${lights2}); __ridge.fp() ${ridge} (expect.json home ${EXP.home}); fp([1,2]) ${ridge12}`);
  console.log(`  __lev.fp(0..2) ${lev.join(' ')}; sleeperFingerprint(0..2) ${sfp.slice(0, 3).join(' ')} (zone 0 again ${sfp[3]}); live after ${show(live)}`);
  console.log(`  __safeFailed() ${show(safe)} / after ${show(safe2)}; __shaderFailed() ${show(shader)} / after ${show(shader2)}`);
  check('in play, page visible', s.gameState === 'play' && !s.hidden && s.site === 0 && s.zone === 0, s.gameState);
  check('lights 14 (and after the fingerprints)', lights === 14 && lights2 === 14, [lights, lights2]);
  check(`__ridge.fp([1,2]) ${SHIPPED.fp12}`, ridge12 === SHIPPED.fp12, ridge12);
  check(`__lev.fp(1/2) ${SHIPPED.lev1} / ${SHIPPED.lev2}`, lev[1] === SHIPPED.lev1 && lev[2] === SHIPPED.lev2, lev.slice(1));
  check(`sleeperFingerprint(1/2) ${SHIPPED.sl1} / ${SHIPPED.sl2}`, sfp[1] === SHIPPED.sl1 && sfp[2] === SHIPPED.sl2, sfp.slice(1, 3));
  check('__safeFailed() [] (before and after)', Array.isArray(safe) && !safe.length && Array.isArray(safe2) && !safe2.length, [safe, safe2]);
  check('__shaderFailed() [] (before and after)', Array.isArray(shader) && !shader.length && Array.isArray(shader2) && !shader2.length, [shader, shader2]);
  check(`home __ridge.fp() = expect.json home ${EXP.home}`, ridge === EXP.home, ridge);
  check(`__lev.fp(0) = the anchor ${ANCHOR.lev0}`, lev[0] === ANCHOR.lev0, lev[0]);
  check('sleeperFingerprint(0) deterministic (twice in one load)', sfp[0] === sfp[3], [sfp[0], sfp[3]]);
  check(`sleeperFingerprint(0) = the anchor ${ANCHOR.sl0}`, sfp[0] === ANCHOR.sl0, sfp[0]);
  check('the live sleeper rebuilt (the Brooder, __sl live)', live.kind === 'brooder' && live.same && live.state === 'play', live);
}

if (MODE === 'parity') {
  await sleep(2000);
  const N = 201, X0 = -120, STEP = 2;
  const pg = await c.ev(`(async () => { const T = await import('/src/world/terrain.js'); const a = new Float64Array(${N * N});
    for (let j = 0; j < ${N}; j++) for (let i = 0; i < ${N}; i++) a[j * ${N} + i] = T.terrainH(${X0} + ${STEP} * i, ${X0} + ${STEP} * j, 0);
    const u = new Uint8Array(a.buffer); let s = ''; for (let k = 0; k < u.length; k += 0x8000) s += String.fromCharCode.apply(null, u.subarray(k, k + 0x8000));
    return { site: __chart.site(), fp: __ridge.fp(), b64: btoa(s) }; })()`);
  const A = new Float64Array(new Uint8Array(Buffer.from(pg.b64, 'base64')).buffer);
  const R = await replica(), nfp = R.fp([0, 1, 2]);
  console.log(`  page: site ${pg.site}, __ridge.fp() ${pg.fp}; replica (node): fp ${nfp}`);
  check('the page is at home on the home anchor', pg.site === 0 && pg.fp === EXP.home, pg.fp);
  check('the replica is the same code (its fp = expect.json home)', nfp === EXP.home, nfp);
  let within = 0, same = 0, bad = 0, max = 0, at = null;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = X0 + STEP * i, z = X0 + STEP * j, g = A[j * N + i], r = R.T.terrainH(x, z, 0);
    if (!Number.isFinite(g) || !Number.isFinite(r)) { bad++; continue; }
    const d = Math.abs(g - r);
    if (g === r) same++;
    if (d <= 1e-9) within++;
    if (d > max) { max = d; at = { x, z, game: g, replica: r }; }
  }
  const n = N * N, share = within / n;
  console.log(`  ${n} points (2 u grid, x, z in [-120, 280], zone 0): bit-identical ${same} (${(100 * same / n).toFixed(3)}%), |d| <= 1e-9 ${within} (${(100 * share).toFixed(3)}%), non-finite ${bad}, max |d| ${max}${at ? ' at ' + show(at) : ''}`);
  check('|d| <= 1e-9 on >= 99% of the points (and no non-finite)', share >= 0.99 && !bad, { share: +(100 * share).toFixed(3), max });
}

if (MODE === 'voyage') {
  await sleep(3000);
  const SNAP = `(async () => {
    const LR = await import('/src/entities/sleeper/lair.js'), core = await import('/src/core.js');
    let lights = 0; core.scene.traverse(o => { if (o.isLight) lights++; });
    const lv = window.lev, L = window.__sl, H = lv && lv.harpoon, sk = window.wrecks.sites(0)[0], li = window.wrecks.list()[0], b = LR.bedAt();
    const sw = H && H.seamWorld ? H.seamWorld() : null;
    return { site: __chart.site(), state: window.gameState, fp: __ridge.fp(), live: L === lv, kind: lv && lv.kind, dormant: !!(lv && lv.dormant),
      lair: L && L.lairPos ? [L.lairPos.x, L.lairPos.z] : null, bed: [b.x, b.z, b.r], skiff: [sk.x, sk.z], relic: [li.x, li.y, li.z, li.tool],
      anchor: H && H.anchor ? [H.anchor.x, H.anchor.y, H.anchor.z] : null, seam: sw ? [sw.x, sw.y, sw.z] : null,
      her: L ? [L.pos.x, L.pos.y, L.pos.z, L.yaw] : null, wound: !!(H && H.wound), lights, safe: __safeFailed(), shader: __shaderFailed() };
  })()`;
  const arrive = async i => { await c.ev(`(window.__helm = true, window.__chart.arrive(${i}), 1)`); await sleep(1500); };
  const R = await replica(), w0 = R.P.wreckSites()[0], lr = R.P.velkathLair(0, R.CFG.LEVIATHAN_CFG[0].size * R.P.R_OF_SIZE, null);
  const REP = { skiff: [w0.x, w0.z], lair: [lr.lip.x, lr.lip.z] };
  console.log('  replica (node): skiff site ' + show(REP.skiff) + ', her lair ' + show(REP.lair));
  const d2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const PIN = ['fp', 'lair', 'bed', 'skiff', 'relic', 'anchor', 'seam', 'her', 'lights'];
  const pins = s => JSON.stringify(PIN.map(k => s[k]));
  const home = (tag, s, ref) => {
    console.log(`  ${tag}: ${show({ fp: s.fp, kind: s.kind, lair: s.lair, bed: s.bed, skiff: s.skiff, relic: s.relic, anchor: s.anchor, her: s.her, lights: s.lights })}`);
    check(`${tag}: at home in play`, s.site === 0 && s.state === 'play', [s.site, s.state]);
    check(`${tag}: __ridge.fp() = home ${EXP.home}`, s.fp === EXP.home, s.fp);
    check(`${tag}: the live sleeper is the Brooder (__sl = lev)`, s.live && s.kind === 'brooder' && s.dormant, [s.kind, s.live, s.dormant]);
    check(`${tag}: lairPos within 0.5 u of (89.7, 39.1)`, d2(s.lair, [STATION.x, STATION.z]) <= 0.5, +d2(s.lair, [STATION.x, STATION.z]).toFixed(3));
    check(`${tag}: lairPos = the replica's velkathLair (<= 1e-9)`, d2(s.lair, REP.lair) <= 1e-9, d2(s.lair, REP.lair));
    check(`${tag}: lair.js bedAt() = lairPos (the bed recomputed)`, s.bed[0] === s.lair[0] && s.bed[1] === s.lair[1], [s.bed[0], s.bed[1]]);
    check(`${tag}: the skiff's site = the replica's wreckSites()[0] (<= 1e-9)`, d2(s.skiff, REP.skiff) <= 1e-9, d2(s.skiff, REP.skiff));
    check(`${tag}: lights 14, failure lists []`, s.lights === 14 && !s.safe.length && !s.shader.length, [s.lights, s.safe, s.shader]);
    if (ref) check(`${tag}: identical to the fresh load (${PIN.join(', ')})`, pins(s) === pins(ref), pins(s) === pins(ref) ? 'same' : { now: pins(s), boot: pins(ref) });
  };
  const boot = await c.ev(SNAP);
  home('fresh load', boot, null);
  console.log(`  the skiff's relic (wrecks.list(), x y z) sits ${d2([boot.relic[0], boot.relic[2]], REP.skiff).toFixed(2)} u from its site on the settled hull`);
  await arrive(1);
  const p0 = await c.ev(`({ site: __chart.site(), fp: __chart.fp() })`);
  check(`arrive(1): Pallid __chart.fp() ${SHIPPED.pallid}`, p0.site === 1 && p0.fp === SHIPPED.pallid, p0);
  await arrive(2);
  const b0 = await c.ev(`({ site: __chart.site(), fp: __chart.fp() })`);
  check(`arrive(2): Burned __chart.fp() ${SHIPPED.burned}`, b0.site === 2 && b0.fp === SHIPPED.burned, b0);
  for (let k = 1; k <= 3; k++) {
    await arrive(1);
    const p = await c.ev(`({ site: __chart.site(), fp: __chart.fp() })`);
    check(`trip ${k}: arrive(1) Pallid ${SHIPPED.pallid}`, p.site === 1 && p.fp === SHIPPED.pallid, p);
    await arrive(0);
    home(`trip ${k}: arrive(0)`, await c.ev(SNAP), boot);
  }
}

if (MODE === 'oldsave') {
  // harpoon-probe.mjs's AT, verbatim: where Alt+6 stood him, and the harpoon's seat
  const AT = `(async () => {
  const S = await import('/src/world/fissureShape.js'), T = await import('/src/world/terrain.js'), BC = await import('/src/entities/sleeper/bodyCols.js');
  const L = window.lev, P = window.player, H = L && L.harpoon;
  if (!H) return { err: 'no harpoon (' + (L ? L.kind : 'no sleeper') + ')' };
  const hp = H.seamWorld ? H.seamWorld() : null, a = H.anchor;
  const fl = T.terrainH(a.x, a.z, 0);
  let blocked = false; L.publishCols && L.publishCols();
  for (const h of [0.45, 1.0, 1.6]) if (BC.bodyBlocked(a.x, fl + h, a.z, 0.45)) blocked = true;
  const sand = L.sand, side = hp ? (hp.x - L.pos.x) * sand.x + (hp.z - L.pos.z) * sand.z : null;
  return { prompt: L.rite ? L.rite.prompt(P.pos) : null, dSal: +Math.hypot(P.pos.x - a.x, P.pos.z - a.z).toFixed(2),
    anchorFd: +S.fissureDist(a.x, a.z, 0).toFixed(1), seamFd: hp ? +S.fissureDist(hp.x, hp.z, 0).toFixed(1) : null,
    seamUp: hp ? +(hp.y - T.terrainH(hp.x, hp.z, 0)).toFixed(2) : null, seamUpSal: hp ? +(hp.y - fl).toFixed(2) : null, sandSide: side == null ? null : +side.toFixed(1),
    gripUp: H.gripWorld ? +(H.gripWorld(new (a.constructor)()).y - fl).toFixed(2) : null, seatOk: !!H.seatOk,
    blocked, wound: !!H.wound, pulled: !!H.pulled, dormant: !!L.dormant, site: window.__chart.site ? window.__chart.site() : null };
})()`;
  const pre = await c.ev(`({ site: __chart.site(), pulled: __chart.pulled(), sighted: __chart.sighted(), harpoon: !!survival.hasHarpoon, kind: lev && lev.kind, wound: !!(lev && lev.harpoon && lev.harpoon.wound), fp: __ridge.fp() })`);
  console.log('  the old save, read: ' + show(pre));
  check('the old save was read (site 0, pulled[0], the harpoon owned, her harpoon is the old wound)', pre.site === 0 && pre.pulled[0] === 1 && pre.harpoon && pre.kind === 'brooder' && pre.wound, pre);
  check(`home on the new ground (__ridge.fp() ${EXP.home})`, pre.fp === EXP.home, pre.fp);
  await sleep(1000);
  await c.key('Digit6', true, 1); await sleep(80); await c.key('Digit6', false, 1);   // Alt+6, a real key
  await sleep(1500);
  const r = await c.ev(AT);
  const hud = await c.ev(`(() => { const e = document.getElementById('craft'); return { text: e.textContent, opacity: e.style.opacity, last: window.__playtest ? window.__playtest.last() : null, state: window.gameState }; })()`);
  const lair = await c.ev(`[window.__sl.lairPos.x, window.__sl.lairPos.z]`), an = await c.ev(`[lev.harpoon.anchor.x, lev.harpoon.anchor.z]`);
  const dSt = Math.hypot(an[0] - STATION.x, an[1] - STATION.z);
  console.log('  after Alt+6: ' + show(r));
  console.log(`  HUD ${show(hud)}; anchor ${show(an.map(v => +v.toFixed(2)))} is ${dSt.toFixed(1)} u from (89.7, 39.1); her lair ${show(lair.map(v => +v.toFixed(2)))}`);
  check('Alt+6 jumped to VELKATH', /VELKATH/.test(hud.last || '') && hud.state === 'play', hud.last);
  check("the rite's prompt: '[E] PRESS THE OLD WOUND'", r.prompt === '[E] PRESS THE OLD WOUND', r.prompt);
  check('the HUD shows it', hud.text === '[E] PRESS THE OLD WOUND' && hud.opacity === '1', hud);
  check('the anchor stands within 30 u of her raft-side station (89.7, 39.1)', dSt <= 30, +dSt.toFixed(2));
  check('the old wound (its iron long out: harpoon.js pulled = wound), her asleep, at home', r.wound && r.pulled && r.dormant && r.site === 0, [r.wound, r.pulled, r.dormant, r.site]);
  // harpoon-probe.mjs routes' checks at this site, its bounds verbatim (its prompt check is the wound's, above)
  check('routes: Sal stands >= 6 u off the crack', !(r.anchorFd < 6), r.anchorFd);
  check('routes: the harpoon sits >= 6 u off the crack', !(r.seamFd < 6), r.seamFd);
  check('routes: on her near (sand) flank', r.sandSide > 0, r.sandSide);
  check('routes: the seam 0.5-2.8 u over his boots', r.seamUpSal > 0.5 && r.seamUpSal < 2.8, r.seamUpSal);
  check("routes: the grip 0.85-1.95 u over his boots (his hands)", r.gripUp > 0.85 && r.gripUp < 1.95, r.gripUp);
  check('routes: a seam on her flank qualified (no fallback seat)', r.seatOk, r.seatOk);
  check('routes: the anchor is not inside her body', !r.blocked, r.blocked);
  check('routes: Alt+6 left him <= 0.6 u off the anchor', !(r.dSal > 0.6), r.dSal);
  // the remembered rite starts there: a real E presses the wound, she wakes, nothing new is said or granted
  const seen = [];
  await c.ev(`(window.__rlSeen = [], window.__rlI = setInterval(() => { const m = window.__msg && window.__msg().live; if (m && window.__rlSeen[window.__rlSeen.length - 1] !== m) window.__rlSeen.push(m); }, 50), 1)`);
  await c.key('KeyE', true); await sleep(100); await c.key('KeyE', false);
  await sleep(3500);
  const w = await c.ev(`(clearInterval(window.__rlI), { dormant: !!lev.dormant, pressed: !!lev.harpoon.pressed, owns: !!survival.hasHarpoon, msgs: window.__rlSeen.slice() })`);
  seen.push(...w.msgs);
  console.log('  after E: ' + show(w));
  check('E at the wound: pressed, she wakes', w.pressed && !w.dormant, [w.pressed, w.dormant]);
  check('...and no pull line', !seen.includes('IT COMES FREE. SHE FEELS IT.') && !seen.includes("ANOTHER DIVER'S HARPOON."), seen);
}

consoleCheck();
c.close();
console.log(fails.length ? `${MODE.toUpperCase()} FAIL (${fails.length}): ${fails.join('; ')}` : `${MODE.toUpperCase()} PASS`);
process.exit(fails.length ? 1 : 0);
