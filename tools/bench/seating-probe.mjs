// SEATING PROBE (seafloor relief Task 12; spec docs/superpowers/specs/2026-10-13-seafloor-relief-design.md G6 "nothing hovers or
// sinks"; the plan's Review Focus 5): everything the game puts on the ground still sits on it. Ported from the primfix survey
// (~/sc/.abyssa-wt/reviews/primfix-survey/ x3 = props / nodes / debris / relics / moult, x8 = the skiff's deck kit, x2/ev = the
// egg skins), with three changes: it exits 1 on a failure, it reads EVERY vertex (the survey stepped 160 per mesh, which can only
// miss a low point or a high one), and its zone test is by terrainH (the zone whose floor at that x, z is nearest the object's
// height), not the survey's hard-coded `y > -330`.
//   DRV_PORT=9520 node tools/bench/seating-probe.mjs <port>          (serve.py serves <port>)
// Default run: a fresh load at home, then Pallid (arrive(1)), then home again (arrive(0)), one survey at each. A survey samples,
// against wrecks.js terrainSample(zi, x, z) (the DRAWN floor: the coarse mesh's own triangles, or the fissure patch near a crack):
//   props (props.js propMeshes), resource nodes (resources.js nodes), seabed debris (physics.js, scene 'debris*' instanced meshes),
//   her relics and her moult (brood.js), the spent egg skins (brood.js casings), and the skiff's deck kit (wrecks.js: the six
//   crates by their corners, the fallen mast by both ends).
// Bars (each class, each survey):
//   hover   the object's LOWEST vertex is > 0.08 u over the floor under it                       (an egg skin: see CASING_HOVER)
//   sunk    the object's HIGHEST vertex is < 0 (wholly under the floor)
//   boulder a resource node's centre is inside a flora boulder collider's ball at its own height (flora.js rockColliders)
// and the survey must not pass vacuously: every class has a floor on its count (a class that is absent is a FAIL, not a pass).
// Home again must equal the first home survey (the reseed is a pure function of the site).
// Each survey also lays the rifts' light motes (rifts.js seedMotes, which draws a height from the zone's band alone, wherever it
// lands) for MOTE_SEEDS seeded streams in every zone, and none may sit within MOTE_CLEAR (3) u of the floor (terrainH): the bob
// in updateMotes is +-0.9 u, so a mote seeded under 3 u dips into the ground. Math.random is swapped for a seeded stream for
// the draw and put back.
// Env SP_RED=<variant>: an opt-in RED case, never part of the default run, each measured to fail its bar, applied in the page
// before the FIRST (home) survey:
//   prop-lift   the best-seated prop is lifted 0.5 u (its instance matrix)         -> hover
//   node-sink   one resource node is sunk 4 u (its group)                          -> sunk
//   node-boulder one resource node is moved onto the centre of the largest boulder -> nodes inside boulders
// The failing case is main (a `git archive main` copy on its own port), measured 2026-10-14: every other bar passes there (props,
// nodes, debris, her trail and the skiff's kit sit on main's ground too) and it fails the motes' bar at all three surveys (59-61 of
// 1260 seeded motes within 3 u of the floor: seedMotes there takes its height from the zone's band alone) and home's anchor.
// Exit 1 on any FAIL; 2 on a usage error. The RED run exits 1 on the bar it was built to break (and the home-again survey, after
// the reseed rebuilt the props, passes: the mutation does not survive an arrival).
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const [, , PORT = '8870'] = process.argv;
const RED = process.env.SP_RED;
const REDS = ['prop-lift', 'node-sink', 'node-boulder'];
if (RED !== undefined && !REDS.includes(RED)) { console.error(`SP_RED: the variants are ${REDS.join(', ')} (got ${JSON.stringify(RED)})`); process.exit(2); }
if (!process.env.DRV_PORT) process.env.DRV_PORT = '9520';
process.env.DRV_DIR = mkdtempSync(join(tmpdir(), 'abyssa-seating-'));   // a fresh profile: no save, no caches
const { start, stop, connect, sleep } = await import('./drv.mjs');
process.on('exit', () => { stop(); try { rmSync(process.env.DRV_DIR, { recursive: true, force: true }); } catch (e) { } });

const EXP = JSON.parse(readFileSync(new URL('../relief/expect.json', import.meta.url), 'utf8'));   // the recorded anchors: home's terrain fingerprint
const HOVER = 0.08;                    // the survey's bar: the lowest point over the floor
const MOTE_SEEDS = 30, MOTE_CLEAR = 3;   // seeded streams per zone; the least a mote may hover over the floor (u)
const CASING_HOVER = 0.42 * 1.12 + HOVER;   // a spent egg skin lies ON the silt drift round the moult (brood.js bankH 0.42 at its crest, x1.12 for its ripple): its centre is the drift's height over the floor
// the least each class may count (a vacuous pass is a FAIL); home and Pallid both carry them all
const FLOOR = { prop: 30, node: 20, debris: 40, relic: 1, moult: 1, casing: 100, crate: 6, mast: 2 };
const fails = [];
const show = v => typeof v === 'string' ? v : JSON.stringify(v);
const check = (name, ok, v) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (v === undefined ? '' : ' -> ' + show(v))); if (!ok) fails.push(name); };

await start('about:blank');
const c = await connect();
await c.send('Runtime.enable'); await c.send('Log.enable'); await c.send('Page.enable');
const tNav = Date.now();
await c.send('Page.navigate', { url: `http://localhost:${PORT}/?playtest` });
await c.until(`!document.getElementById('load') && typeof window.setState === 'function' && !!window.__chart && !!window.__lev`, 240000, 500);
console.log(`seating-probe ${RED ? 'RED ' + RED + ' ' : ''}http://localhost:${PORT}/?playtest (fresh profile): loaded in ${((Date.now() - tNav) / 1000).toFixed(1)} s`);
await c.ev(`(window.__helm = true, window.setState('play'), 1)`);

function consoleCheck() {
  const L = [];
  for (const e of c.events) {
    if (e.method === 'Runtime.consoleAPICalled') L.push({ lvl: e.params.type, text: e.params.args.map(a => a.value ?? a.description).join(' ') });
    else if (e.method === 'Log.entryAdded') L.push({ lvl: e.params.entry.level, text: e.params.entry.text, url: e.params.entry.url || '' });
    else if (e.method === 'Runtime.exceptionThrown') L.push({ lvl: 'error', text: 'EXC ' + e.params.exceptionDetails.text + ' ' + (e.params.exceptionDetails.exception && e.params.exceptionDetails.exception.description) });
  }
  const fav = l => /\/favicon\.ico$/.test(l.url || '') && /404/.test(l.text);
  const errs = L.filter(l => (l.lvl === 'error' || l.lvl === 'assert') && !fav(l));
  for (const l of errs.slice(0, 6)) console.log('    ' + l.lvl + ' ' + l.text.slice(0, 300) + ' ' + (l.url || ''));
  check('console: no error but the favicon 404', errs.length === 0, errs.length);
}

// ---- the survey, in the page ----
// test(cls, name, geo, mw, zi): every vertex of geo through mw against terrainSample(zi, x, z); lo = the lowest vertex over the
// floor, hi = the highest. The deck kit (one merged geometry per material, in the wreck's frame) is read per crate and per mast end.
const SURVEY = mutate => `(async () => {
  const THREE = await import('three');
  const { terrainSample } = await import('/src/world/wrecks.js');
  const { terrainH } = await import('/src/world/terrain.js');
  const { propMeshes } = await import('/src/world/props.js');
  const { nodes } = await import('/src/world/resources.js');
  const { rockColliders } = await import('/src/world/flora.js');
  const { scene } = await import('/src/core.js');
  const HOVER = ${HOVER}, CASING_HOVER = ${CASING_HOVER};
  // the zone by terrainH: the zone whose floor at (x, z) lies nearest the object's height (the zones' floors are 300+ u apart)
  const zoneOf = (x, y, z) => { let b = 0, bd = 1e9; for (let zi = 0; zi < 3; zi++) { const d = Math.abs(y - terrainH(x, z, zi)); if (d < bd) { bd = d; b = zi; } } return b; };
  const v = new THREE.Vector3(), M = new THREE.Matrix4(), MI = new THREE.Matrix4();
  const R = { classes: {}, hover: [], sunk: [], inBoulder: [], notes: [] };
  const cls = k => R.classes[k] || (R.classes[k] = { n: 0, lo: 1e9, loAt: null, hi: -1e9 });
  const r2 = x => +x.toFixed(2);
  // extent of one object over the floor: [lowest, highest] over every vertex
  const extent = (geo, mw, zi) => {
    const P = geo.attributes.position; let lo = 1e9, hi = -1e9;
    for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i).applyMatrix4(mw); const d = v.y - terrainSample(zi, v.x, v.z); if (d < lo) lo = d; if (d > hi) hi = d; }
    return [lo, hi];
  };
  const book = (k, name, lo, hi, x, z, hoverAt = HOVER) => {
    const C = cls(k); C.n++; if (lo < C.lo) { C.lo = lo; C.loAt = [name, r2(x), r2(z)]; } if (hi > C.hi) C.hi = hi;
    if (lo > hoverAt) R.hover.push([k, name, r2(x), r2(z), r2(lo)]);
    if (hi < 0) R.sunk.push([k, name, r2(x), r2(z), r2(hi)]);
  };
  const test = (k, name, geo, mw, zi) => { const [lo, hi] = extent(geo, mw, zi); v.setFromMatrixPosition(mw); book(k, name, lo, hi, v.x, v.z); };
  const keyOf = im => im.material && im.material.customProgramCacheKey ? im.material.customProgramCacheKey().slice(0, 14) : 'p';
  ${mutate}
  // props: every instance of every prop mesh
  for (const im of propMeshes) { im.updateMatrixWorld(true); for (let i = 0; i < im.count; i++) { im.getMatrixAt(i, MI); M.multiplyMatrices(im.matrixWorld, MI); v.setFromMatrixPosition(M); test('prop', keyOf(im), im.geometry, M, zoneOf(v.x, v.y, v.z)); } }
  // resource nodes (zone from the node itself), and which of them sit inside a boulder's ball at their own height
  for (const n of nodes) { n.grp.updateMatrixWorld(true); const m = n.grp.children[0]; if (m && m.geometry) test('node', n.kind, m.geometry, m.matrixWorld, n.zi); }
  for (const n of nodes) { const p = n.grp.position; for (const c of rockColliders) { const dy = c.y - p.y, gr = c.r * c.r - dy * dy; if (gr > 0 && Math.hypot(p.x - c.x, p.z - c.z) < Math.sqrt(gr)) { R.inBoulder.push([n.kind, n.zi, r2(p.x), r2(p.z)]); break; } } }
  // seabed debris: the stones (physics.js names them 'debris<zone>_<shape>'; the zone also by terrainH, and they must agree)
  scene.traverse(o => { if ((o.name || '').startsWith('debris') && o.isInstancedMesh) { o.updateMatrixWorld(true); for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, MI); M.multiplyMatrices(o.matrixWorld, MI); v.setFromMatrixPosition(M); const zn = +o.name[6], zt = zoneOf(v.x, v.y, v.z); if (zn !== zt) R.notes.push(['debris zone', o.name, r2(v.x), r2(v.z), zn, zt]); test('debris', o.name, o.geometry, M, zt); } } });
  // her trail: the relics, the moult, the spent egg skins (the live sleeper's group; the trail is laid once her sculpt is in hand)
  const L = window.lev; R.brood = !!(L && L.brood);
  if (L && L.brood) {
    const B = L.brood;
    for (const r of (B.relics || [])) { r.updateMatrixWorld(true); v.setFromMatrixPosition(r.matrixWorld); test('relic', 'relic', r.geometry, r.matrixWorld, zoneOf(v.x, v.y, v.z)); }
    if (B.molt) { B.molt.updateMatrixWorld(true); v.setFromMatrixPosition(B.molt.matrixWorld); test('moult', 'moult', B.molt.geometry, B.molt.matrixWorld, zoneOf(v.x, v.y, v.z)); }
    if (B.casings) {
      const g = B.casings.geometry, A = g.attributes.aP0.array;   // aP0 = x, y, z, r (an instance's centre and radius)
      for (let i = 0; i < g.instanceCount; i++) { const x = A[i * 4], y = A[i * 4 + 1], z = A[i * 4 + 2], r = A[i * 4 + 3], d = y - terrainSample(zoneOf(x, y, z), x, z); book('casing', 'casing', d, d + r, x, z, CASING_HOVER); }
    }
  }
  // the skiff's deck kit (wrecks.js, the part of the wreck that lives outside the roll, in the wreck's frame): the crates by their
  // lowest corner, the fallen mast by both ends. The constants are wrecks.js's own (CR, RC, the mast's Euler and HALF): keep in sync.
  let mk = null; scene.traverse(o => { if (!mk && o.name === 'relicMarker') mk = o; });
  const deck = mk && mk.parent && mk.parent.children[1];
  R.deck = !!(deck && deck.isGroup && deck.children.some(m => m.isMesh));
  if (R.deck) {
    deck.parent.updateMatrixWorld(true);
    const DM = deck.matrixWorld, inv = DM.clone().invert(), w = new THREE.Vector3();
    const V = []; for (const m of deck.children) if (m.isMesh) { const P = m.geometry.attributes.position; for (let i = 0; i < P.count; i++) V.push(P.getX(i), P.getY(i), P.getZ(i)); }
    const zD = (() => { w.set(0, 0, 0).applyMatrix4(DM); return zoneOf(w.x, w.y, w.z); })();
    const fl = (x, z) => { w.set(x, 0, z).applyMatrix4(DM); w.y = terrainSample(zD, w.x, w.z); return w.applyMatrix4(inv).y; };   // the floor under a deck-frame (x, z), as a deck-frame height
    const near = (x, z, rad) => { let lo = 1e9, hi = -1e9; for (let i = 0; i < V.length; i += 3) if (Math.hypot(V[i] - x, V[i + 2] - z) < rad) { lo = Math.min(lo, V[i + 1]); hi = Math.max(hi, V[i + 1]); } return [lo, hi]; };
    const world = (x, z) => { w.set(x, 0, z).applyMatrix4(DM); return [w.x, w.z]; };
    const CR = [[-7.4, -2.6, 0.6, 1.4 * 1.0 / 2, 1.05 * 1.0 / 2], [-5.9, -4.2, 0.5, 1.4 * 0.8 / 2, 1.05 * 0.8 / 2], [6.2, -3.0, 0.9, 1.4 * 1.15 / 2, 1.05 * 1.15 / 2],
      [8.0, 0.6, 2.4, 1.4 * 0.95 / 2, 1.05 * 0.95 / 2], [-8.6, 1.4, 1.1, 1.4 * 1.2 / 2, 1.05 * 1.2 / 2], [3.4, -5.0, -0.35, 1.05, 0.8]];
    for (const [x, z, ry, fx, fz] of CR) {
      let worst = -1e9, seen = 0;
      for (const [a, b] of [[fx, fz], [-fx, fz], [fx, -fz], [-fx, -fz]]) {
        const cx = x + a * Math.cos(ry) + b * Math.sin(ry), cz = z - a * Math.sin(ry) + b * Math.cos(ry), [lo] = near(cx, cz, 0.22);
        if (lo < 1e8) { seen++; worst = Math.max(worst, lo - fl(cx, cz)); }
      }
      const [, top] = near(x, z, Math.hypot(fx, fz) + 0.3), [wx, wz] = world(x, z), C = cls('crate');
      if (seen < 4 || top > 1e8) { R.notes.push(['crate: no deck vertices at its corners (the constants are stale)', x, z, seen]); continue; }
      const hi = top - fl(x, z);
      C.n++; if (C.lo > worst) { C.lo = worst; C.loAt = ['crate', r2(wx), r2(wz)]; } C.hi = Math.max(C.hi, hi);
      if (worst > HOVER) R.hover.push(['crate', 'corner', r2(wx), r2(wz), r2(worst)]);
      if (hi < 0) R.sunk.push(['crate', 'top', r2(wx), r2(wz), r2(hi)]);
    }
    const e = new THREE.Vector3(0, 1, 0).applyEuler(new THREE.Euler(0, 0.42, Math.PI / 2 - 0.06)).setY(0).normalize();
    for (const s of [-1, 1]) {
      const x = -3 + e.x * 4.6 * s, z = 5.4 + e.z * 4.6 * s, [lo, hi] = near(x, z, 0.3), [wx, wz] = world(x, z);
      if (lo > 1e8) { R.notes.push(['mast end: no deck vertices (the constants are stale)', s]); continue; }
      const f = fl(x, z); book('mast', 'end' + s, lo - f, hi - f, wx, wz);
    }
  }
  for (const k in R.classes) { const C = R.classes[k]; C.lo = r2(C.lo); C.hi = r2(C.hi); }
  R.hover = R.hover.slice(0, 30); R.sunk = R.sunk.slice(0, 30);
  R.site = window.__chart.site(); R.fp = window.__ridge.fp();
  return R;
})()`;

// the motes: seedMotes under a seeded Math.random, every zone; the nearest any mote lies over the floor (terrainH at its x, z)
const MOTES = `(async () => {
  const R = await import('/src/world/rifts.js'), { terrainH } = await import('/src/world/terrain.js');
  const real = Math.random, out = { n: 0, nearest: 1e9, at: null, inside: [], insideN: 0 };
  try {
    for (let zi = 0; zi < 3; zi++) for (let sd = 1; sd <= ${MOTE_SEEDS}; sd++) {
      let a = (sd * 2654435761 + zi * 40503) >>> 0;
      Math.random = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      R.seedMotes(zi);
      for (const m of R.motes) { const p = m.home, d = p.y - terrainH(p.x, p.z, zi); out.n++; if (d < out.nearest) { out.nearest = d; out.at = [zi, sd, +p.x.toFixed(1), +p.z.toFixed(1)]; } if (d < ${MOTE_CLEAR}) { out.insideN++; out.inside.push([zi, sd, +p.x.toFixed(1), +p.z.toFixed(1), +d.toFixed(2)]); } }
    }
  } finally { Math.random = real; }
  R.seedMotes(window.zone || 0);     // the zone's own motes again, on the game's own stream
  out.nearest = +out.nearest.toFixed(2); out.inside = out.inside.slice(0, 12);
  return out;
})()`;

// ---- the REDs: a mutation of the page's state, run inside the first survey's page function ----
const MUTATE = {
  // the best-seated prop (the largest lowest-point <= HOVER, so +0.5 certainly crosses the bar) up 0.5 u
  'prop-lift': `{ let best = null;
    for (const im of propMeshes) { im.updateMatrixWorld(true); for (let i = 0; i < im.count; i++) { im.getMatrixAt(i, MI); M.multiplyMatrices(im.matrixWorld, MI); v.setFromMatrixPosition(M); const [lo] = extent(im.geometry, M, zoneOf(v.x, v.y, v.z)); if (lo <= HOVER && (!best || lo > best.lo)) best = { im, i, lo, x: v.x, z: v.z }; } }
    if (!best) throw new Error('RED prop-lift: no prop to lift');
    best.im.getMatrixAt(best.i, MI); MI.premultiply(new THREE.Matrix4().makeTranslation(0, 0.5, 0)); best.im.setMatrixAt(best.i, MI); best.im.instanceMatrix.needsUpdate = true;
    R.notes.push(['RED prop-lift: one prop lifted 0.5 u (was ' + r2(best.lo) + ' over the floor)', r2(best.x), r2(best.z)]); }`,
  // one node 4 u under (its geometry is under a unit tall: wholly under the floor)
  'node-sink': `{ const n = nodes.find(n => n.zi === 0 && n.grp.children[0] && n.grp.children[0].geometry); if (!n) throw new Error('RED node-sink: no node'); n.grp.position.y -= 4; n.grp.updateMatrixWorld(true);
    R.notes.push(['RED node-sink: one node sunk 4 u', n.kind, r2(n.grp.position.x), r2(n.grp.position.z)]); }`,
  // one node on the centre of the largest boulder
  'node-boulder': `{ const n = nodes.find(n => n.zi === 0); let big = null; for (const c of rockColliders) if (c.y > -300 && (!big || c.r > big.r)) big = c; if (!n || !big) throw new Error('RED node-boulder: no node or boulder');
    n.grp.position.set(big.x, big.y, big.z); n.grp.updateMatrixWorld(true);
    R.notes.push(['RED node-boulder: one node put on the centre of the boulder r ' + r2(big.r), r2(big.x), r2(big.z)]); }`
};

const ARRIVE = i => `(async () => { window.__helm = true; window.__chart.arrive(${i}); await new Promise(r => setTimeout(r, 1500)); return window.__chart.site(); })()`;
const TRAIL = `!!(window.lev && window.lev.brood && window.lev.brood.molt && window.lev.brood.casings && window.lev.brood.relics)`;
const surveys = [];
async function survey(tag, mutate = '') {
  await c.until(TRAIL, 60000, 500);     // her sculpt in hand: the trail is laid (it is not at the first frame of a fresh load)
  const S = await c.ev(SURVEY(mutate));
  surveys.push(S);
  console.log(`${tag}: site ${S.site}, __ridge.fp() ${S.fp}`);
  for (const [k, C] of Object.entries(S.classes)) console.log(`  ${k.padEnd(7)} n ${String(C.n).padStart(4)}  lowest over the floor ${String(C.lo).padStart(6)}${C.loAt ? ' (' + C.loAt.join(' ') + ')' : ''}  highest ${C.hi}`);
  for (const n of S.notes) console.log('  note ' + show(n));
  const miss = Object.keys(FLOOR).filter(k => !((S.classes[k] || {}).n >= FLOOR[k]));
  check(`${tag}: every class sampled (floors ${Object.entries(FLOOR).map(([k, n]) => k + ' ' + n).join(', ')})`, !miss.length && S.deck && S.brood, miss.length ? { short: miss.map(k => [k, (S.classes[k] || {}).n || 0]), deck: S.deck, brood: S.brood } : undefined);
  check(`${tag}: 0 hover (an object's lowest vertex > ${HOVER} u over the drawn floor)`, !S.hover.length, S.hover);
  check(`${tag}: 0 wholly sunk (an object's highest vertex < 0)`, !S.sunk.length, S.sunk);
  check(`${tag}: 0 resource nodes inside a boulder`, !S.inBoulder.length, S.inBoulder);
  const MO = await c.ev(MOTES);
  console.log(`  motes   n ${String(MO.n).padStart(4)}  nearest over the floor ${MO.nearest}${MO.at ? ' (zone ' + MO.at[0] + ' seed ' + MO.at[1] + ' at ' + MO.at[2] + ' ' + MO.at[3] + ')' : ''}`);
  check(`${tag}: 0 motes within ${MOTE_CLEAR} u of the floor (${MOTE_SEEDS} seeded layouts x 3 zones x 14)`, MO.n === MOTE_SEEDS * 3 * 14 && !MO.insideN, MO.insideN ? { count: MO.insideN, first: MO.inside } : undefined);
  check(`${tag}: the stale-constant / zone notes are empty`, !S.notes.filter(n => !/^RED /.test(n[0])).length, S.notes.filter(n => !/^RED /.test(n[0])));
  return S;
}

const home1 = await survey('home', RED ? MUTATE[RED] : '');
check(`at home on the relief (__ridge.fp() = expect.json home ${EXP.home})`, home1.site === 0 && home1.fp === EXP.home, [home1.site, home1.fp]);
await c.ev(ARRIVE(1));
const pallid = await survey('Pallid');
check('Pallid is site 1', pallid.site === 1, pallid.site);
await c.ev(ARRIVE(0));
const home2 = await survey('home again');
const sig = S => JSON.stringify([S.fp, S.classes]);
check('home again = home (every class: count, lowest, highest; a reseed is a pure function of the site)', RED ? true : sig(home2) === sig(home1), RED ? 'RED run: the first survey carries the mutation' : (sig(home2) === sig(home1) ? 'same' : { first: home1.classes, again: home2.classes }));
consoleCheck();
c.close();
console.log(fails.length ? `SEATING FAIL (${fails.length}): ${fails.join('; ')}` : 'SEATING PASS');
process.exit(fails.length ? 1 : 0);
