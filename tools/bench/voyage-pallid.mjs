// THE VOYAGE FROM A BURIED HOME TO PALLID BANK AND BACK (velkath-buried-rock Task 13; the plan's Task 13 Step 1, relief-load voyage's added
// checks). Home's Velkath lies buried under a drawn dune that is GROUND (bodyCols.js buriedFloorAt through terrain.js setExtraFloor /
// extraFloorAt), keyed to the site it was published at, because a voyage's reseed (game.js reseedWorldNow) sets the next site first and places
// that site's octopus dens (predators.js reseedDens, on shutFloorY + 0.2) before home's sleeper is disposed: home's dune must never be ground
// at another site, during the reseed or after it.
//   DRV_PORT=<own> node tools/bench/voyage-pallid.mjs <game port>
// A fresh load in a fresh profile (?playtest, console captured from the first byte). Real-time sleeps (no __bench.step: no clock to plug).
//   home       __ridge.fp() 5c0705a1; the LIVE anchor (relief-load.mjs LIVE, its bounds verbatim: heading -121.51 deg, Alt+6 spot fwd -0.53
//              lat -0.23 R, lift 0.55, seat found, dormant, bury 1, crest 6-7 u, buryD 1.414); POSITIVE CONTROL: her dune is ground at home
//              (extraFloorAt(x, z, 0) > -1e8 on >= 1 cell of a 1 u grid +-40 u round her bed (89.7, 39.1), the FOOTPRINT, and over terrainH at
//              the bed), else UNMEASURED (the grid below could not see ground)
//   the reseed the provider is wrapped page-side (terrain.js setExtraFloor with a wrapper round bodyCols buriedFloorAt): every extraFloorAt
//              call made from inside reseedDens's stack while the site is not home is booked, and the first three read extraFloorAt at home's
//              bed. Restored after the arrival. No read booked = UNMEASURED
//   Pallid     arrive(1): __chart.fp() b1c58f8d; extraFloorAt === -1e9 on a 2 u grid +-40 u round home's bed AND round Pallid's bed (the live
//              sleeper's lairPos), zones 0-2; every octopus den (window.pred.octos[i].den, its own zone) within 0.05 u of Pallid's terrainH + 0.2
//              (a den where jamAt > terrainH is booked, not judged; no den judged = UNMEASURED); dens inside home's footprint (zone 0, plan)
//              booked; the reseed's reads of home's bed all -1e9; Pallid's ROW-BUILT sleeperFingerprint(0, its row) 014f3101 and no bury key
//   home again arrive(0): __ridge.fp() 5c0705a1 and the LIVE anchor again (buried, dormant); console: no error but the favicon 404
// RED (VP_RED=nositekey): serve a SCRATCH SNAPSHOT of the build (git worktree add --detach <dir> <head>; never committed) whose bodyCols.js
// buriedFloorAt has the site key removed (`if (!mound || zi !== moundZi) return -1e9;`, no currentSiteIndex() !== moundSite). The probe
// checks the served bodyCols.js lacks the key (else exit 2: not the snapshot) and judges ONE bar, the reseed's reads of home's bed: it must
// read the dune (exit 5); if it reads -1e9 the RED discriminates nothing (exit 3). Why this bar: no den of this seed falls inside home's dune
// footprint, so a den reading high cannot be the RED; the read DURING the reseed is the window the key closes (measured, Task 13: home's bed
// read -271.217 there on the snapshot, -1e9 on the build; after the arrival the grids read -1e9 on both, her build disposed).
// Exit 0 pass | 1 a bar failed | 2 UNMEASURED / usage / a refused port | 3 a RED whose bar did not fail | 5 a RED whose bar failed, as it must.
// JSON -> VP_OUT (default ~/sc/.abyssa-wt/reviews/buried/voyage-pallid-<tag>.json; VP_TAG, default port<port>).
const P = /^\d+$/.test(process.env.DRV_PORT || '') ? +process.env.DRV_PORT : NaN;
if (!Number.isInteger(P) || P < 1024 || P > 65535 || [8777, 8790, 9419].includes(P)) { console.error('voyage-pallid: set DRV_PORT to a port of its own, an integer in 1024-65535 (not 8777 / 8790 / 9419)'); process.exit(2); }
const PORT = process.argv[2];
if (!/^\d+$/.test(PORT || '')) { console.error('usage: DRV_PORT=<own> [VP_RED=nositekey] node tools/bench/voyage-pallid.mjs <game port>'); process.exit(2); }
const RED = process.env.VP_RED || '';
if (RED && RED !== 'nositekey') { console.error(`VP_RED: nositekey (got ${JSON.stringify(RED)})`); process.exit(2); }
try { await fetch(`http://127.0.0.1:${P}/json/version`); console.error(`voyage-pallid: DRV_PORT ${P} already answers: refused (its Chrome is not ours to stop)`); process.exit(2); } catch (e) { }
const { mkdtempSync, rmSync, writeFileSync, mkdirSync } = await import('node:fs');
const { tmpdir, homedir } = await import('node:os');
const { join, dirname } = await import('node:path');
process.env.DRV_DIR = mkdtempSync(join(tmpdir(), 'abyssa-voyage-pallid-'));
const { start, stop, connect, sleep } = await import('./drv.mjs');
let started = false;
process.on('exit', () => { if (started) stop(); try { rmSync(process.env.DRV_DIR, { recursive: true, force: true }); } catch (e) { } });
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(130));
const TAG = process.env.VP_TAG || 'port' + PORT;
const OUT = process.env.VP_OUT || join(homedir(), 'sc/.abyssa-wt/reviews/buried', `voyage-pallid-${TAG}.json`);
const record = { port: +PORT, red: RED || null, tag: TAG };
const finish = (code, why) => { record.exit = code; record.why = why || null; try { mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, JSON.stringify(record, null, 1)); console.log('JSON ' + OUT); } catch (e) { } process.exit(code); };
const show = v => JSON.stringify(v);
const ck = [];
const check = (name, ok, v, vacuous = false) => { ck.push({ name, ok: !!ok, vacuous: !!vacuous, val: v }); console.log(`  ${vacuous ? 'VOID' : ok ? 'ok  ' : 'FAIL'} ${name} -> ${show(v)}`); };

const HB = { x: 89.7, z: 39.1 };     // home's bed (her raft-side station)
const LIVE = { yawDeg: -121.51, anchor: [-0.53, -0.23], lift: 0.55, bury: 1, crest: [6.0, 7.0], buryD: 1.414, tol: 0.01 };   // relief-load.mjs LIVE
const LIVE_JS = `(() => { const L = window.lev, H = L && L.harpoon; if (!L || L.kind !== 'brooder' || !H || !L.lairPos) return { err: 'no brooder / harpoon (' + (L && L.kind) + ')' };
  const s = Math.sin(L.lairYaw), c = Math.cos(L.lairYaw), ox = H.anchor.x - L.lairPos.x, oz = H.anchor.z - L.lairPos.z;
  const B = window.__burial, st = B && B.state ? B.state() : null, sh = L.parts && L.parts.shell; let top = -1e9;
  if (sh) { sh.updateMatrixWorld(true); const P = sh.geometry.attributes.position, e = sh.matrixWorld.elements;
    for (let i = 0; i < P.count; i++) { const x = P.getX(i), y = P.getY(i), z = P.getZ(i), wy = e[1] * x + e[5] * y + e[9] * z + e[13]; if (wy > top) top = wy; } }
  return { yawDeg: +(L.lairYaw * 180 / Math.PI).toFixed(2), anchor: [+((ox * s + oz * c) / L.R).toFixed(2), +((ox * c - oz * s) / L.R).toFixed(2)], lift: L.standLift, seatOk: !!H.seatOk, dormant: !!L.dormant,
    bury: L.bury, buryD: +(L.buryD || 0).toFixed(3), crest: st && st.meanG != null ? +(top - st.meanG).toFixed(2) : null }; })()`;
const near = (a, b) => Math.abs(a - b) <= LIVE.tol;
const liveOk = v => !!v && !v.err && near(v.yawDeg, LIVE.yawDeg) && near(v.anchor[0], LIVE.anchor[0]) && near(v.anchor[1], LIVE.anchor[1]) && v.lift === LIVE.lift && v.seatOk && v.dormant
  && v.bury === LIVE.bury && v.crest >= LIVE.crest[0] && v.crest <= LIVE.crest[1] && near(v.buryD, LIVE.buryD);

let c, fatal = null;
try {
  await start('about:blank'); started = true;
  c = await connect();
  await c.send('Runtime.enable'); await c.send('Log.enable'); await c.send('Page.enable');
  await c.send('Page.navigate', { url: `http://localhost:${PORT}/?playtest` });
  await c.until(`!document.getElementById('load') && typeof window.setState === 'function' && !!window.__chart && !!window.__lev && !!window.pred`, 240000, 500);
  await c.ev(`(window.__helm = true, window.setState('play'), 1)`);
  await sleep(3000);
  // the served bodyCols.js: does it carry the site key? (the RED needs the snapshot without it)
  record.siteKey = await c.ev(`fetch('/src/entities/sleeper/bodyCols.js', { cache: 'no-store' }).then(r => r.text()).then(t => /currentSiteIndex\\(\\) !== moundSite/.test(t))`);
  console.log(`voyage-pallid ${RED ? 'RED ' + RED + ' ' : ''}http://localhost:${PORT}/?playtest (fresh profile); the served bodyCols.js ${record.siteKey ? 'HAS' : 'LACKS'} the site key`);
  if (RED && record.siteKey) { console.error('UNMEASURED: VP_RED=nositekey needs the scratch snapshot without the site key (header): this build has it'); finish(2, 'not the snapshot'); }

  // ---- home, fresh load ----
  const h0 = await c.ev(`(async () => { const T = await import('/src/world/terrain.js'); const fp = [];
    for (let j = -40; j <= 40; j++) for (let i = -40; i <= 40; i++) if (T.extraFloorAt(${HB.x} + i, ${HB.z} + j, 0) > -1e8) fp.push(i + ',' + j);
    window.__vpFoot = new Set(fp);
    return { site: __chart.site(), fp: __ridge.fp(), footN: fp.length, bedXF: T.extraFloorAt(${HB.x}, ${HB.z}, 0), bedTH: T.terrainH(${HB.x}, ${HB.z}, 0) }; })()`);
  const live0 = await c.ev(LIVE_JS);
  record.home = { h0, live0 };
  console.log('home (fresh load): ' + show(h0) + '; live ' + show(live0));
  const ctrl = h0.footN > 0 && h0.bedXF > h0.bedTH;
  check('home: positive control, her dune is ground at home (footprint cells, and over terrainH at her bed)', ctrl, { footN: h0.footN, bedXF: h0.bedXF, bedTH: h0.bedTH }, !ctrl);
  check('home: at home, __ridge.fp() 5c0705a1', h0.site === 0 && h0.fp === '5c0705a1', [h0.site, h0.fp]);
  check('home: the LIVE anchor (dormant, bury 1, heading, Alt+6 spot, lift, seat, crest 6-7 u, buryD)', liveOk(live0), live0);

  // ---- the provider wrapped through the voyage's reseed ----
  await c.ev(`(async () => { const T = await import('/src/world/terrain.js'), BC = await import('/src/entities/sleeper/bodyCols.js'), S = await import('/src/world/site.js');
    const k = window.__vpR = { arm: true, calls: 0, inDens: 0, bed: [], high: [], max: -1e9 };
    T.setExtraFloor((x, z, zi) => { const v = BC.buriedFloorAt(x, z, zi);
      if (k.arm && S.currentSiteIndex() !== 0) { k.calls++; if (/reseedDens/.test(new Error().stack)) { k.inDens++;
        if (k.bed.length < 3) k.bed.push(BC.buriedFloorAt(${HB.x}, ${HB.z}, 0)); if (v > k.max) k.max = v; if (v > -1e8 && k.high.length < 20) k.high.push([x, z, zi, v]); } }
      return v; });
    return 1; })()`);
  await c.ev(`(window.__helm = true, window.__chart.arrive(1), 1)`); await sleep(2000);
  const pal = await c.ev(`(async () => { const T = await import('/src/world/terrain.js'), BC = await import('/src/entities/sleeper/bodyCols.js');
    const k = window.__vpR; k.arm = false; T.setExtraFloor(BC.buriedFloorAt);   // the provider restored
    const L = window.__sl, pb = L && L.lairPos ? { x: L.lairPos.x, z: L.lairPos.z } : null;
    const grid = (cx, cz) => { let n = 0, bad = 0, max = -1e9, at = null; for (const zi of [0, 1, 2]) for (let j = -20; j <= 20; j++) for (let i = -20; i <= 20; i++) {
        const x = cx + 2 * i, z = cz + 2 * j, v = T.extraFloorAt(x, z, zi); n++; if (v !== -1e9) { bad++; if (v > max) { max = v; at = [x, z, zi]; } } } return { n, bad, max, at }; };
    const dens = window.pred.octos.map(O => { const x = O.den.x, z = O.den.z, th = T.terrainH(x, z, O.zi), j = T.jamAt(x, z, O.zi);
      const inFoot = O.zi === 0 && window.__vpFoot.has(Math.round(x - ${HB.x}) + ',' + Math.round(z - ${HB.z}));
      return { zi: O.zi, x: +x.toFixed(2), z: +z.toFixed(2), d: +(O.den.y - (th + 0.2)).toFixed(4), jam: j > th, inFoot }; });
    return { site: __chart.site(), fp: __chart.fp(), palBed: pb, gHome: grid(${HB.x}, ${HB.z}), gPal: pb ? grid(pb.x, pb.z) : null, dens,
      reseed: { calls: k.calls, inDens: k.inDens, bed: k.bed, max: k.max, high: k.high } }; })()`);
  record.pallid = pal;
  console.log(`Pallid: site ${pal.site} fp ${pal.fp} bed ${show(pal.palBed)}; reseedDens reads ${show(pal.reseed)}`);
  const judged = pal.dens.filter(d => !d.jam), badD = judged.filter(d => Math.abs(d.d) > 0.05), inFoot = pal.dens.filter(d => d.inFoot);
  check('the reseed: every extraFloorAt read of home\'s bed from inside reseedDens -1e9 (home\'s dune is not ground at Pallid)', pal.reseed.inDens > 0 && pal.reseed.bed.length > 0 && pal.reseed.bed.every(v => v === -1e9),
    { inDens: pal.reseed.inDens, bed: pal.reseed.bed }, !(pal.reseed.inDens > 0 && pal.reseed.bed.length > 0));
  check('arrive(1): Pallid __chart.fp() b1c58f8d', pal.site === 1 && pal.fp === 'b1c58f8d', [pal.site, pal.fp]);
  check('Pallid: extraFloorAt -1e9 on the 2 u grid +-40 u round home\'s bed (zones 0-2)', pal.gHome.bad === 0, pal.gHome);
  check('Pallid: extraFloorAt -1e9 on the 2 u grid +-40 u round Pallid\'s bed (zones 0-2)', !!pal.gPal && pal.gPal.bad === 0, pal.gPal, !pal.gPal);
  check('Pallid: every den within 0.05 u of Pallid\'s terrainH + 0.2 (jam aside)', judged.length > 0 && badD.length === 0,
    { judged: judged.length, jam: pal.dens.length - judged.length, bad: badD, maxAbs: judged.length ? Math.max(...judged.map(d => Math.abs(d.d))) : null, inHomeFootprint: inFoot.length }, !judged.length);
  const row = await c.ev(`(async () => { const M = await import('/src/entities/leviathan.js'), S = await import('/src/world/site.js'), C = await import('/src/config.js');
    const site = S.currentSite(), row = site.sleepers && site.sleepers[0];
    const over = row ? { nSigils: row.sigils, hue: (C.LEVIATHAN_CFG[0].hue + row.hueShift + 1) % 1, name: site.epithet ? site.epithet[0] : C.LEVIATHAN_CFG[0].name,
      idle: row.idle || null, lair: row.lair || null, hard: row.hard || null, bury: row.bury || null } : undefined;
    const r = { norow: M.sleeperFingerprint(0), row: M.sleeperFingerprint(0, over), bury: row && row.bury || null }; window.__lev.remember(null); return r; })()`);
  record.pallidRow = row;
  check('Pallid: the row-built sleeperFingerprint(0, its row) 014f3101, no bury key', row.row === '014f3101' && !row.bury, row);

  // ---- home again ----
  await c.ev(`(window.__helm = true, window.__chart.arrive(0), 1)`); await sleep(2000);
  const h1 = await c.ev(`({ site: __chart.site(), fp: __ridge.fp() })`), live1 = await c.ev(LIVE_JS);
  record.homeAgain = { h1, live1 };
  console.log('home again: ' + show(h1) + '; live ' + show(live1));
  check('home again: __ridge.fp() 5c0705a1', h1.site === 0 && h1.fp === '5c0705a1', h1);
  check('home again: buried, dormant, the LIVE anchor', liveOk(live1), live1);
  const cons = (await c.console()).filter(l => /error|EXC/i.test(l) && !/favicon/.test(l));
  record.consoleErrors = cons;
  check('console: no error but the favicon 404', cons.length === 0, cons.slice(0, 3));
} catch (e) { fatal = String(e && e.message || e); }
if (c) try { c.close(); } catch (e) { }
record.checks = ck;
if (fatal) { console.error('UNMEASURED: page-side throw: ' + fatal); finish(2, 'throw: ' + fatal); }
if (RED) {
  const k = ck.find(q => q.name.startsWith('the reseed:'));
  if (!k || k.vacuous) { console.error('UNMEASURED: RED nositekey: no reseed read booked'); finish(2, 'RED vacuous'); }
  if (!k.ok) { console.log('RED nositekey: the reseed\'s read of home\'s bed failed as it must: exit 5'); finish(5); }
  console.error('RED nositekey did not fail as written (home\'s bed read -1e9 during the reseed): exit 3'); finish(3, 'RED did not fail');
}
const failed = ck.filter(q => !q.vacuous && !q.ok), vac = ck.filter(q => q.vacuous);
if (failed.length) { console.error('VOYAGE-PALLID FAIL: ' + failed.map(q => q.name).join('; ')); finish(1, 'failed'); }
if (vac.length) { console.error('UNMEASURED: ' + vac.map(q => q.name).join('; ')); finish(2, 'vacuous'); }
console.log('VOYAGE-PALLID PASS'); finish(0);
