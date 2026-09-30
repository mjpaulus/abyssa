// STEP 1 of the sculpt pipeline (node): SDF specs -> PLY meshes + manifest for Blender.
//   node tools/blender/export_hi.mjs <creature> [piece ...]
// <creature> names src/entities/sleeper/<creature>Sculpt.js, which exports pipeline():
//   { name, out: 'assets/sleepers/<name>', sets: { <set>: { size, gutter?, aoSamples? } },
//     pieces: [ { name, set, sdf, hi: { h }, lo: { h, tris }, paint, kEps?, ao?, cage?,
//                 ray? } ], meta?: {...json}, probes?: [...] }
// For each piece it writes .build/<creature>/<piece>_hi.ply (full-detail field meshed
// densely with dual contouring, every vertex painted: sRGB albedo + roughness in alpha)
// and <piece>_lo.ply (the mesh field — bake-only layers left out — for Blender to
// decimate). The manifest carries the rest. Deterministic: specs are seeded.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { meshSDF, shadeVertices, plyBytes, compile, decimate, unwrapSet } from '../../src/lib/sculpt.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [creature, ...only] = process.argv.slice(2);
if (!creature) { console.error('usage: export_hi.mjs <creature> [piece ...]'); process.exit(1); }
const mod = await import(path.join(ROOT, 'src/entities/sleeper', creature + 'Sculpt.js'));
const P = mod.pipeline();
const build = path.join(ROOT, 'tools/blender/.build', creature);
fs.mkdirSync(build, { recursive: true });
const man = { name: P.name, out: P.out, sets: P.sets, pieces: [], meta: P.meta || {}, probes: {}, compress: P.compress || null };   // compress: optional, see bake.py
const t00 = Date.now();
// HIGH polys (the expensive part; `piece ...` args limit it to those pieces)
for (const pc of P.pieces) {
  const entry = { name: pc.name, set: pc.set, tris: pc.lo.tris, cage: pc.cage || pc.hi.h * 3, ray: pc.ray || pc.hi.h * 8, hi: pc.name + '_hi.ply', lo: pc.name + '_lo.ply' };
  man.pieces.push(entry);
  if (only.length && !only.includes(pc.name)) continue;
  const t0 = Date.now();
  const hi = meshSDF(pc.sdf, pc.hi.h, {});
  const sh = shadeVertices(hi.field, hi.pos, pc.paint, { kEps: pc.kEps, ao: pc.ao });
  fs.writeFileSync(path.join(build, entry.hi), plyBytes(hi.pos, hi.idx, sh.normal, sh.rgba));
  entry.hiTris = hi.idx.length / 3;
  console.log(pc.name, 'hi', entry.hiTris, ((Date.now() - t0) / 1000).toFixed(1) + ' s');
}
// LOW polys, per texture set: the mesh field (bake-only layers left out) DC-meshed,
// QEM-decimated to the piece's budget, then every piece of the set charted and packed into
// ONE atlas (sculpt.js unwrapSet: axis charts on smoothed normals; Smart UV Project
// shredded the bumpy lows into thousands of islands at 20% coverage)
man.unwrap = {};
for (const set of Object.keys(P.sets)) {
  const pcs = P.pieces.filter(q => q.set === set), t0 = Date.now(), lows = [];
  for (const pc of pcs) {
    const lo = meshSDF(pc.sdf, pc.lo.h, { forMesh: true });
    const d = decimate(lo.pos, lo.idx, pc.lo.tris, pc.lo.err != null ? pc.lo.err : pc.lo.h * 1.2);
    lows.push(d);
    man.pieces.find(e => e.name === pc.name).loSrcTris = lo.idx.length / 3;
  }
  const U = unwrapSet(lows, P.sets[set].size, P.sets[set].gutter || 6);
  U.meshes.forEach((m, i) => {
    const e = man.pieces.find(q => q.name === pcs[i].name);
    fs.writeFileSync(path.join(build, e.lo), plyBytes(m.pos, m.idx, null, null, true, m.uv));
    e.loTris = m.idx.length / 3; e.charts = m.charts;
  });
  man.unwrap[set] = { coverage: +U.coverage.toFixed(3), texel: U.texel };
  console.log('set', set, 'lows', pcs.map((q, i) => q.name + ' ' + U.meshes[i].idx.length / 3).join(', '), 'coverage', U.coverage.toFixed(3), ((Date.now() - t0) / 1000).toFixed(1) + ' s');
}
// probes: top-surface heights, ray-marched on the full field (props seat on these)
for (const pr of P.probes || []) {
  const pc = P.pieces.find(q => q.name === pr.part), f = compile(pc.sdf).f, n = pr.n, H = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = pr.x0 + (pr.x1 - pr.x0) * i / (n - 1), z = pr.z0 + (pr.z1 - pr.z0) * j / (n - 1);
    let y = pr.y0 != null ? pr.y0 : 1, hit = null;
    for (let it = 0; it < 300 && y > -1; it++) { const d = f(x, y, z); if (d < 2e-4) { hit = +y.toFixed(4); break; } y -= Math.max(d * 0.8, 5e-4); }
    H.push(hit);
  }
  man.probes[pr.name] = { x0: pr.x0, x1: pr.x1, z0: pr.z0, z1: pr.z1, n, h: H };
}
fs.writeFileSync(path.join(build, 'manifest.json'), JSON.stringify(man, null, 1));
console.log('export done', ((Date.now() - t00) / 1000).toFixed(1) + ' s ->', build);
