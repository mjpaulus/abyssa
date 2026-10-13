// THE RELIEF GATES — spec docs/superpowers/specs/2026-10-13-seafloor-relief-design.md: the §7 hard limits, the shape
// acceptance S1-S7 and G3, measured on the SLICED REAL code at home zone 0 (run slice.mjs first), against the same
// code with home's relief rows removed (= the shipped world; validate.mjs proves it bit for bit). Exit 1 if a hard
// gate fails. S3 is a target: reported, never fails the run.
//   node tools/relief/slice.mjs && node tools/relief/gates.mjs [--json out.json]
import { writeFileSync } from 'node:fs';
import { setSite, siteAt } from '../../src/world/site.js';
import { riftPos } from '../../src/config.js';
import { FISSURE, resetJam, jamTopY, fissureDist, fissureWorld } from '../../src/world/fissureShape.js';
import { analyze, classify, N, X0, idx } from './stats.mjs';
import { makeMesh } from './mesh.mjs';
const T = await import('./terrain.gen.mjs'), P = await import('./pins.gen.mjs');
const { meshH } = makeMesh(T);
const PUMP = [5.382, 4.232, 2.895];              // the live pump head the leash anchors to (audit §3; stats.analyze takes [x, y, z])
const TRIG = -309.5, R = 15.4, STATION = { x: 89.7, z: 39.1 }, TODAY_RAFT = -240.3;
const F0 = FISSURE[0], C = { x: F0.cx, z: F0.cz };
setSite(0);
const HOME = siteAt(0), ROWS = { shape: HOME.shape, wrecks: HOME.wrecks };
function rows(on) { HOME.shape = on ? ROWS.shape : null; HOME.wrecks = on ? ROWS.wrecks : null; T.syncSite(); T.buildClampTable(); P.resetPins(); resetJam(); }
const grid = () => { const H = new Float64Array(N * N); for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) H[j * N + i] = T.terrainH(X0 + i, X0 + j, 0); return H; };
const centre = () => { const o = [], w = { x: 0, z: 0 }; for (let u = -0.9 * F0.halfLen; u <= 0.9 * F0.halfLen; u += 0.5) { fissureWorld(u, 0, 0, w); o.push([w.x, w.z, T.terrainH(w.x, w.z, 0)]); } return o; };
const raftCol = () => { let s = 0, n = 0; for (let z = -15; z <= 15; z++) for (let x = -15; x <= 15; x++) if (x * x + z * z <= 225) { s += T.terrainH(x, z, 0); n++; } return s / n; };
// --- the shipped side (rows off): G3's centre line and S6's per-point mesh error
rows(false);
const centre0 = centre();
const S6PTS = [];
for (let z = C.z - 200; z <= C.z + 200; z += 0.5) for (let x = C.x - 200; x <= C.x + 200; x += 0.5) {
  if (Math.hypot(x, z) > 250 || fissureDist(x, z, 0) < 17) continue;
  S6PTS.push(x, z, Math.abs(meshH(x, z, 0) - T.terrainH(x, z, 0)));
}
// --- the relief (rows on)
rows(true);
const hasHollow = !!(T.HOL && T.hollowAt);
const ws = P.wreckSites(), lair = P.velkathLair(0, R, null), bed = { x: lair.lip.x, z: lair.lip.z, r: 1.55 * R };
const H = grid();
const res = analyze({ T, H, zi: 0, clampTbl: T.clampR[0], bed, R, pump: PUMP });
const out = { skiff: [+ws[0].x.toFixed(1), +ws[0].z.toFixed(1)], bed: [+bed.x.toFixed(1), +bed.z.toFixed(1)] };
const g = [];   // [name, pass, value, hard]
const gate = (name, pass, value, hard = true) => g.push([name, !!pass, value, hard]);
// S1
gate('S1 relief', res.open.sd >= 12 && res.relief50.p50 >= 17 && res.relief100.p50 >= 30, { sd: res.open.sd, r50: res.relief50.p50, r100: res.relief100.p50 });
// S2
gate('S2 her lair is the deepest part', res.lair.pctOfOpen <= 0.05 && res.low.minOpen.dBed <= 40 && Math.hypot(bed.x - STATION.x, bed.z - STATION.z) <= 0.5,
  { pct: res.lair.pctOfOpen, minOpenDBed: res.low.minOpen.dBed, bed: out.bed });
// S3 (target)
const rc = raftCol();
gate('S3 raft-side fall (TARGET)', TODAY_RAFT - rc <= 12 && rc - res.lair.underR.mean >= 20, { sink: +(TODAY_RAFT - rc).toFixed(1), fall: +(rc - res.lair.underR.mean).toFixed(1) }, false);
// S4: the outline and the tread lines vary with bearing (the hollow's own profile, not the noise on it)
let s4 = null;
if (hasHollow) {
  const o = T._hv, rF = [], rO = [], N_ = T.HOL.N, tread = Array.from({ length: N_ }, () => []);
  for (let b = 0; b < 360; b++) {
    const a = b * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    T.hollowAt(C.x + ca * 100, C.z + sa * 100, o); rF.push(o.rF); rO.push(o.rO);
    for (let k = 1; k <= N_; k++) { const lv = (k - 0.5) / N_; let hit = NaN; for (let d = 2; d < 260; d += 0.5) { T.hollowAt(C.x + ca * d, C.z + sa * d, o); if (o.q <= lv) { hit = d; break; } } tread[k - 1].push(hit); }
  }
  const ptp = a => { const f = a.filter(Number.isFinite), mn = Math.min(...f), mx = Math.max(...f), m = f.reduce((p, q) => p + q, 0) / f.length; return { pct: +((mx - mn) / m * 100).toFixed(1), range: +(mx - mn).toFixed(1) }; };
  s4 = { rF: ptp(rF), rO: ptp(rO), treads: tread.map(ptp) };
}
gate('S4 not a lathe', s4 && s4.rF.pct >= 20 && s4.rO.pct >= 20 && s4.treads.every(t => t.range >= 15), s4 || 'no hollow');
// S5: walkable; reachability over the walkable grid from the raft column (a step: |dh| <= tan 52 x run, or a hop <= 2 u)
const { C: CL } = classify(T, 0, T.clampR[0]);
const walk = k => CL[k] === 2 || CL[k] === 3 || CL[k] === 4, TAN = Math.tan(52 * Math.PI / 180);
function bfs(hop) {
  const seen = new Uint8Array(N * N), q = new Int32Array(N * N); let h = 0, t = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const x = X0 + i, z = X0 + j, k = j * N + i; if (x * x + z * z <= 100 && walk(k)) { seen[k] = 1; q[t++] = k; } }
  while (h < t) { const k = q[h++], i = k % N, j = (k / N) | 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { if (!di && !dj) continue; const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue; const kk = jj * N + ii; if (seen[kk] || !walk(kk)) continue;
      const run = di && dj ? Math.SQRT2 : 1, dh = Math.abs(H[kk] - H[k]); if (dh <= TAN * run || (hop && dh <= 2)) { seen[kk] = 1; q[t++] = kk; } } }
  return seen;
}
const sHop = bfs(true), sWalk = bfs(false), at = (x, z) => idx(Math.round(x - X0), Math.round(z - X0));
let on = 0, oy = 0; for (let k = 0; k < N * N; k++) if (CL[k] === 3) { on++; if (sHop[k]) oy++; }
const lipW = { x: 0, z: 0 }; fissureWorld(0, F0.halfW + 1.5, 0, lipW);
const route = { bed: !!sWalk[at(bed.x, bed.z)], skiff: !!sWalk[at(ws[0].x, ws[0].z)], lip: !!sWalk[at(lipW.x, lipW.z)] };
gate('S5 mostly walkable', res.slope.over.sal_ny062 <= 0.015 && oy / on >= 0.97 && route.bed && route.skiff && route.lip,
  { over52: res.slope.over.sal_ny062, over33: res.slope.over.kelp_ny084, reach: +(oy / on).toFixed(4), route });
// S6: the mesh error the change ADDS (today's floor already reaches 1.9 u near the NE rim)
let e6 = 0, e6at = null, e6n = 0; const e6s = [];
for (let i = 0; i < S6PTS.length; i += 3) { const x = S6PTS[i], z = S6PTS[i + 1]; const e = Math.abs(meshH(x, z, 0) - T.terrainH(x, z, 0)) - S6PTS[i + 2]; e6s.push(e); e6n++; if (e > e6) { e6 = e; e6at = [x, z]; } }
e6s.sort((a, b) => a - b);
gate('S6 drawn = stood on (added error)', e6 <= 0.3, { max: +e6.toFixed(3), p99: +e6s[Math.floor(e6s.length * 0.99)].toFixed(3), at: e6at, n: e6n });
// S7
const arena = res.lair.arena45.max - res.lair.arena45.min;
gate('S7 her fight ground', res.lair.underR.relief <= 3 && res.lair.underBED.relief <= 6.5 && arena <= 11.5, { body: res.lair.underR.relief, bed: res.lair.underBED.relief, arena: +arena.toFixed(1) });
// §7 hard limits
const jam = jamTopY(0, T.terrainH), r0 = riftPos(0), r1 = riftPos(1);
let z1max = -Infinity; for (let i = 0; i <= 56; i++) { const t = i / 56; z1max = Math.max(z1max, T.terrainH(r1.x + (r0.x - r1.x) * t, r1.z + (r0.z - r1.z) * t, 1)); }
const tf0 = T.terrainH(r0.x, r0.z, 0);
let cmin = Infinity; for (let i = 0; i <= 56; i++) { const t = i / 56, x = r1.x + (r0.x - r1.x) * t, z = r1.z + (r0.z - r1.z) * t; if (Math.hypot(x - r0.x, z - r0.z) < 16 * 2.8) continue; cmin = Math.min(cmin, T.terrainH(x, z, 0)); }
const endGap = Math.min(tf0, cmin) - 14 - (z1max + 18);   // ending.js: yD (CLEAR 18, DIP 14) over zone 1's corridor crest
gate('L walkable floor >= -285', res.trigger.minWalk >= -285, res.trigger.minWalk);
gate('L trigger margin >= 24.5', res.trigger.margin >= 24.5, res.trigger.margin);
gate('L jam top >= 25 over the trigger', jam - TRIG >= 25, +(jam - TRIG).toFixed(1));
gate('L hose >= 10 u spare', 375 - res.hose.maxDist >= 10, { spare: +(375 - res.hose.maxDist).toFixed(1), at: res.hose.at });
gate('L lips <= 1.2', res.crack.lipDiffMax <= 1.2, res.crack.lipDiffMax);
gate('L berm <= 5.4', res.crack.berm <= 5.4, res.crack.berm);
gate('L ending dip >= 150', endGap >= 150, +endGap.toFixed(1));
// G3: along the centre line, wherever today's floor is below the trigger, the new floor is within 1 u of today's
const c1 = centre(); let g3 = 0, g3n = 0;
for (let i = 0; i < c1.length; i++) if (centre0[i][2] < TRIG) { g3n++; g3 = Math.max(g3, Math.abs(c1[i][2] - centre0[i][2])); }
gate('G3 the throat keeps its floor', g3n > 0 && g3 <= 1, { maxDev: +g3.toFixed(3), points: g3n, floorAtRift: +tf0.toFixed(1) });
// the skiff (spec §5)
const sk = { raft: Math.hypot(ws[0].x, ws[0].z), bed: Math.hypot(ws[0].x - bed.x, ws[0].z - bed.z) };
gate('skiff within 130 u of the raft, outside her arena', sk.raft <= 130 && sk.bed >= 57, { at: out.skiff, raft: +sk.raft.toFixed(1), bed: +sk.bed.toFixed(1) });
const th0 = Math.atan2(-F0.cz, -F0.cx), sa = Math.atan2(ws[0].z - F0.cz, ws[0].x - F0.cx), sdist = Math.hypot(ws[0].x - F0.cx, ws[0].z - F0.cz);
let rel = (sa - th0) * 180 / Math.PI; rel = ((rel % 360) + 540) % 360 - 180;
const win = (ROWS.wrecks && ROWS.wrecks.band && ROWS.wrecks.band[0]) || null;
gate('skiff in its window', win && win.length >= 4 && rel >= win[2] - 0.5 && rel <= win[3] + 0.5 && sdist >= win[0] - 0.5 && sdist <= win[1] + 0.5, { rel: +rel.toFixed(1), d: +sdist.toFixed(1), win });
let hard = 0;
for (const [n, p, v, h] of g) { if (!p && h) hard++; console.log((p ? 'PASS ' : h ? 'FAIL ' : 'MISS ') + n.padEnd(46), JSON.stringify(v)); }
// INFO: the gait rig's pitch clamp is 35.5 deg (diver.js groundPitch); steeper planted soles sink by design. Reported so
// tuning can push it down (today ~2.4% of the open floor is past 33 deg; trial Q0 ~15%) — Michael judges (Review Focus 1)
{ let s355 = 0, sn = 0; const cmax = Math.cos(35.5 * Math.PI / 180);
  for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) { const k = j * N + i; if (CL[k] !== 3) continue; sn++;
    const gx = (H[k + 1] - H[k - 1]) / 2, gz = (H[k + N] - H[k - N]) / 2; if (1 / Math.sqrt(1 + gx * gx + gz * gz) < cmax) s355++; }
  console.log('INFO open floor steeper than the gait clamp (35.5 deg):', +(s355 / sn * 100).toFixed(1) + '%'); }
const ji = process.argv.indexOf('--json'); if (ji > 0) writeFileSync(process.argv[ji + 1], JSON.stringify({ out, gates: g }, null, 1));
process.exit(hard ? 1 : 0);
