// L1 prep (Task 13): the render arguments for the side-by-side hillshade maps and the sections, from the two builds' own samples.
//   node tools/relief/render/prep.mjs <dataDir> [outDir]
// <dataDir> holds main/ and relief/, each with H_s0_z0.f64 + meta_s0.json (sample.page.js, run in that build's Chrome with OUT=<dataDir>/<tag>).
// Writes into <dataDir>: up_main.json, up_relief.json (Float32 grids for upload.page.js), args_map.json, args_sections.json.
// Statistics come from stats.mjs `analyze` on the GAME's grids (the sliced real code supplies the rim and the crack carve for the
// masks; home's relief rows are toggled off for main, as gates.mjs does). Section lines A, B, C are the audit's, fixed in the world
// for both builds; D (raft -> crack -> NE wall) is the call-3 section of preview-ne.mjs.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setSite, siteAt } from '../../../src/world/site.js';
import { FISSURE, resetJam } from '../../../src/world/fissureShape.js';
import { analyze, N, clampLim } from '../stats.mjs';
await import('../slice.mjs');
const T = await import('../terrain.gen.mjs'), P = await import('../pins.gen.mjs');
const D = process.argv[2];
if (!D) { console.error('usage: prep.mjs <dataDir>'); process.exit(2); }
const rdGrid = f => { const b = readFileSync(f); return new Float64Array(b.buffer.slice(b.byteOffset, b.byteOffset + N * N * 8)); };
const meta = tag => JSON.parse(readFileSync(join(D, tag, 'meta_s0.json'), 'utf8'));
const MAIN = { tag: 'main', H: rdGrid(join(D, 'main', 'H_s0_z0.f64')), m: meta('main') };
const REL = { tag: 'relief', H: rdGrid(join(D, 'relief', 'H_s0_z0.f64')), m: meta('relief') };
for (const b of [MAIN, REL]) {
  const f = Float32Array.from(b.H);
  writeFileSync(join(D, `up_${b.tag}.json`), JSON.stringify({ key: b.tag, b64: Buffer.from(f.buffer).toString('base64') }));
}
setSite(0);
const HOME = siteAt(0), ROWS = { shape: HOME.shape, wrecks: HOME.wrecks };
function rows(on) { HOME.shape = on ? ROWS.shape : null; HOME.wrecks = on ? ROWS.wrecks : null; T.syncSite(); T.buildClampTable(); P.resetPins(); resetJam(); }
const R = 15.4;
const stat = (b, on) => {
  rows(on);
  const bd = b.m.bed, bed = { x: bd.x, z: bd.z, r: 1.55 * R };
  return analyze({ T, H: b.H, zi: 0, clampTbl: b.m.clampR[0], bed, R, pump: b.m.pump });
};
MAIN.st = stat(MAIN, false); REL.st = stat(REL, true);
rows(true);
const r1 = v => Math.round(v * 10) / 10;
const F = FISSURE[0], dir = [F.dx, F.dz], n = [-F.dz, F.dx];
const toR = (p, u, rr) => { const b = p[0] * u[0] + p[1] * u[1], c = p[0] * p[0] + p[1] * p[1] - rr * rr; return -b + Math.sqrt(b * b - c); };
// A: the audit's line, across the crack through MAIN's bed (it also passes the branch's station, her designed raft-side flank)
const mb = MAIN.m.bed, tA1 = toR([mb.x, mb.z], n, 280), tA0 = toR([mb.x, mb.z], [-n[0], -n[1]], 280);
const A = { name: 'A', a: [mb.x + n[0] * tA1, mb.z + n[1] * tA1], b: [mb.x - n[0] * tA0, mb.z - n[1] * tA0] };
const c0 = [F.cx, F.cz], tB1 = toR(c0, dir, 280), tB0 = toR(c0, [-dir[0], -dir[1]], 280);
const B = { name: 'B', a: [F.cx - dir[0] * tB0, F.cz - dir[1] * tB0], b: [F.cx + dir[0] * tB1, F.cz + dir[1] * tB1] };
const C = { name: 'C', a: [-280, 0], b: [280, 0] };
const Lc = Math.hypot(F.cx, F.cz), U = [F.cx / Lc, F.cz / Lc];
const Dn = { name: 'D', a: [0, 0], b: [U[0] * 300, U[1] * 300] };
const info = L => { const len = Math.hypot(L.b[0] - L.a[0], L.b[1] - L.a[1]); return { len, u: [(L.b[0] - L.a[0]) / len, (L.b[1] - L.a[1]) / len] }; };
const along = (L, p) => { const { u } = info(L); return (p[0] - L.a[0]) * u[0] + (p[1] - L.a[1]) * u[1]; };
const off = (L, p) => { const { u } = info(L); return Math.abs(-(p[0] - L.a[0]) * u[1] + (p[1] - L.a[1]) * u[0]); };
const { fissureDist } = await import('../../../src/world/fissureShape.js');
function scan(L, tbl) {   // the crack's lip and apron spans along the line (the crack is frozen: identical on both builds); the walk limit per build
  const { len, u } = info(L); const lip = [], apron = []; let lipIn = null, apIn = null, pin = null, pout = null;
  for (let d = 0; d <= len; d += 0.25) {
    const x = L.a[0] + u[0] * d, z = L.a[1] + u[1] * d, fd = fissureDist(x, z, 0), inW = Math.hypot(x, z) < clampLim(tbl, x, z);
    if (inW && pin == null) pin = d; if (inW) pout = d;
    if (fd < 0 && lipIn == null) lipIn = d; if (fd >= 0 && lipIn != null) { lip.push([lipIn, d]); lipIn = null; }
    if (fd < 14 && apIn == null) apIn = d; if (fd >= 14 && apIn != null) { apron.push([apIn, d]); apIn = null; }
  }
  return { lip, apron, walk: [pin, pout] };
}
const pinsOf = b => ({ bed: [b.m.bed.x, b.m.bed.z], skiff: [b.m.wrecks[0].x, b.m.wrecks[0].z], hose: b === MAIN ? [MAIN.st.hose.at.x, MAIN.st.hose.at.z] : [REL.st.hose.at.x, REL.st.hose.at.z] });
const PM = pinsOf(MAIN), PR = pinsOf(REL);
const NEAR = 45;   // a pin is marked on a line when it lies within this many u of it
function marks(L) {
  const out = [], add = (p, txt, color, row) => { if (off(L, p) <= NEAR) out.push({ d: along(L, p), txt: `${txt} (${r1(off(L, p))} u off-line)`, color, row }); };
  add([0, 0], 'raft', '#ffe2c0', 0);
  add(PM.skiff, 'skiff main', '#9aa4ae', 1); add(PR.skiff, 'skiff relief', '#ffd166', 2);
  add(PM.hose, 'hose point main', '#c08aa4', 3); add(PR.hose, 'hose point relief', '#ff4fa3', 4);
  return out;
}
const refs = [[-246, 'rgba(110,220,255,0.85)', 'silt datum NEPH_YF[0] -246 (hs 24)'], [-256, 'rgba(255,214,102,0.9)', 'soft-floor knee -256 (h<4 compressed 4:1)'], [-309.5, 'rgba(255,80,80,0.95)', 'descent trigger -309.5 (fissure open)']];
for (const [L, desc, yRange] of [
  [A, "across the crack: main's bed (NW flank, left) and the relief's bed, her designed raft-side station (SE flank)", [-335, -150]],
  [B, "along the crack's axis: SW wall -> past the raft -> the crack -> NE wall", [-335, -100]],
  [C, 'west -> east through the raft (z = 0): the upland rise to the west, the skiffs, the east wall', [-335, -150]],
  [Dn, 'raft -> crack -> NE wall (call 3: the wall behind her crack stands ~30 u taller over the lower floor)', [-335, -60]]]) {
  const sM = scan(L, MAIN.m.clampR[0]), sR = scan(L, REL.m.clampR[0]);
  L.desc = desc; L.yRange = yRange;
  L.spans = [...sM.apron.map(([a, b]) => ({ d0: a, d1: b, txt: 'apron 14 u', color: '#bfc8d4', row: 1 })), ...sM.lip.map(([a, b]) => ({ d0: a, d1: b, txt: 'THE CRACK (throat)', color: '#ffffff', row: 0 }))];
  for (const [bd, txt, color, row] of [[MAIN.m.bed, 'main bed', '#9aa4ae', 5], [REL.m.bed, 'relief bed', '#ff8a7a', 6]]) {
    const dd = along(L, [bd.x, bd.z]);
    if (off(L, [bd.x, bd.z]) <= 2 * R) L.spans.push({ d0: dd - R, d1: dd + R, txt, color, row });
  }
  L.marks = [...marks(L), { d: sM.walk[0], txt: 'main walk limit', color: '#9aa4ae', row: 7 }, { d: sR.walk[0], txt: 'relief walk limit', color: '#ff9d2e', row: 8 }, { d: sM.walk[1], txt: 'main walk limit', color: '#9aa4ae', row: 7 }, { d: sR.walk[1], txt: 'relief walk limit', color: '#ff9d2e', row: 8 }];
  L.a = L.a.map(r1); L.b = L.b.map(r1);
}
const sections = [A, B, C, Dn];
const numOf = b => { const s = b.st; return { p1: s.low.p1, p5: s.low.p5, min: [s.low.minOpen.x, s.low.minOpen.z, s.low.minOpen.h], bedMean: s.lair.underR.mean, bedPct: s.lair.pctOfOpen, throatMin: s.throat.min, rimKR: T.RIM_KR[0], rimIn: T.ZP[0].rimIn }; };
const panel = (b, title, subtitle) => ({ key: b.tag, title, subtitle, R, bed: b.m.bed, wreck: b.m.wrecks[0], pump: b.m.pump, clampR: b.m.clampR[0], hose: { x: b.st.hose.at.x, z: b.st.hose.at.z, maxDist: b.st.hose.maxDist }, num: numOf(b) });
const commit = process.env.MAIN_COMMIT || 'main';
const panels = [panel(MAIN, `MAIN  (${commit})`, `__ridge.fp() ${MAIN.m.fp}   zones 1+2 ${MAIN.m.fp12}   open floor sd ${MAIN.st.open.sd}, relief ${MAIN.st.relief50.p50} u / 50 u window, ${MAIN.st.relief100.p50} u / 100 u`),
  panel(REL, 'RELIEF BRANCH  (relief)', `__ridge.fp() ${REL.m.fp}   zones 1+2 ${REL.m.fp12}   open floor sd ${REL.st.open.sd}, relief ${REL.st.relief50.p50} u / 50 u window, ${REL.st.relief100.p50} u / 100 u`)];
const notes = [
  `OPEN floor (fd >= 14, inside the rim onset and the walk clamp): main ${(MAIN.st.open.n / 1000).toFixed(0)}k u^2, relief ${(REL.st.open.n / 1000).toFixed(0)}k u^2.  p1..p99: main ${MAIN.st.open.p1} .. ${MAIN.st.open.p99}, relief ${REL.st.open.p1} .. ${REL.st.open.p99}.`,
  `Velkath's bed: main (${r1(MAIN.m.bed.x)}, ${r1(MAIN.m.bed.z)}), mean under her ${MAIN.st.lair.underR.mean}, ${Math.round(MAIN.st.lair.pctOfOpen * 100)}th pct;  relief (${r1(REL.m.bed.x)}, ${r1(REL.m.bed.z)}), ${REL.st.lair.underR.mean}, ${Math.round(REL.st.lair.pctOfOpen * 100)}th pct (1st = deepest).`,
  `Skiff: main (${r1(MAIN.m.wrecks[0].x)}, ${r1(MAIN.m.wrecks[0].z)}), floor ${r1(MAIN.m.wrecks[0].y)};  relief (${r1(REL.m.wrecks[0].x)}, ${r1(REL.m.wrecks[0].z)}), floor ${r1(REL.m.wrecks[0].y)}.   Throat floor at rift 0 (min): main ${MAIN.st.throat.min}, relief ${REL.st.throat.min}.`,
  `Hose: farthest walkable point from the pump, main ${MAIN.st.hose.maxDist} u at (${MAIN.st.hose.at.x}, ${MAIN.st.hose.at.z});  relief ${REL.st.hose.maxDist} u at (${REL.st.hose.at.x}, ${REL.st.hose.at.z}).  The give starts at 375.`,
  'Hillshade x2 vertical exaggeration, light from the upper left; contours every 5 u (25 u bold). Top-down: +x right, +z down. Both panels share one colour ramp in absolute height.'];
writeFileSync(join(D, 'args_map.json'), JSON.stringify({ mode: 'map2', out: 'relief-look-L1-map.png', sections, panels, notes,
  title: 'ABYSSA zone 0, THE HOME MOORING: seabed height, main beside the relief branch (terrainH sampled in each running game, 1 u grid)',
  subtitle: 'Each panel is that build\'s own live terrainH and live pins (bed, skiff, pump, walk limit); the crack, the raft and the section lines are the same in both.' }));
writeFileSync(join(D, 'args_sections.json'), JSON.stringify({ mode: 'sections', out: 'relief-look-L1-sections.png', sections, refs, ph: 300, yRange: [-335, -150],
  profiles: [{ key: 'main', color: '#9aa4ae', width: 2.2, name: 'main (3b526986)' }, { key: 'relief', color: '#f0b040', width: 2.6, name: 'relief branch (5c0705a1)' }],
  title: 'ABYSSA zone 0 (home): four cross-sections, main against the relief branch (same world lines)', subtitle: 'terrainH sampled in each running game; near true scale; the throat (to -330) runs off the bottom of the A, B, C panels, and the walls off the top' }));
console.log(JSON.stringify({ main: { low: MAIN.st.low.minOpen, hose: MAIN.st.hose, lair: MAIN.st.lair.pctOfOpen }, relief: { low: REL.st.low.minOpen, hose: REL.st.hose, lair: REL.st.lair.pctOfOpen, throat: REL.st.throat.min } }));
console.log('A', A.a, A.b, 'B', B.a, B.b, 'D', Dn.a, Dn.b);
