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
import { bakeStrip } from './strip.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [creature, ...only] = process.argv.slice(2);
if (!creature) { console.error('usage: export_hi.mjs <creature> [piece ...]'); process.exit(1); }
// a sleeper lives in src/entities/sleeper/; anything else (sal) in src/entities/
// (additive, plants) sessile life lives in src/world/plants/
const SRC = [path.join(ROOT, 'src/entities/sleeper', creature + 'Sculpt.js'), path.join(ROOT, 'src/entities', creature + 'Sculpt.js'), path.join(ROOT, 'src/world/plants', creature + 'Sculpt.js')].find(f => fs.existsSync(f));
if (!SRC) { console.error('no sculpt module for', creature); process.exit(1); }
const mod = await import(SRC);
const P = mod.pipeline();
const build = path.join(ROOT, 'tools/blender/.build', creature);
fs.mkdirSync(build, { recursive: true });
const man = { name: P.name, out: P.out, sets: P.sets, pieces: [], meta: P.meta || {}, probes: {}, compress: P.compress || null };
// SKIN (optional, additive; salSkin): { bones: [{ name, head, tail, parent? }] } in the game
// frame; bake.py builds the armature and bone-heat weights every piece that has `skin`
if (P.skin) man.skin = P.skin;   // compress: optional, see bake.py
const t00 = Date.now();
// HIGH polys (the expensive part; `piece ...` args limit it to those pieces)
for (const pc of P.pieces) {
  const entry = { name: pc.name, set: pc.set, hiE: pc.emit ? pc.name + '_hiE.ply' : undefined, tris: pc.lo.tris, cage: pc.cage || pc.hi.h * 3, ray: pc.ray || pc.hi.h * 8, hi: pc.name + '_hi.ply', lo: pc.name + '_lo.ply' };
  if (pc.wrk) entry.hiW = pc.name + '_hiW.ply';           // (additive) see below
  if (pc.skin) entry.skin = pc.skin;                       // (additive) bake.py weights it
  if (pc.far) entry.far = pc.far;                          // (additive, plants) a far LOD: bake.py decimates a welded copy of the low to this many tris (UVs kept)
  man.pieces.push(entry);
  if (only.length && !only.includes(pc.name)) continue;
  const t0 = Date.now();
  const hi = meshSDF(pc.sdf, pc.hi.h, {});
  const sh = shadeVertices(hi.field, hi.pos, pc.paint, { kEps: pc.kEps, ao: pc.ao, state: !!pc.emit });
  fs.writeFileSync(path.join(build, entry.hi), plyBytes(hi.pos, hi.idx, sh.normal, sh.rgba));
  entry.hiTris = hi.idx.length / 3;
  // EMISSIVE (optional, additive): pc.emit(S) -> 0..1 per high vertex (S: x,y,z,nx,ny,nz),
  // written as a second painted high that bake.py bakes into the ORM's B channel. The
  // value goes in sRGB-encoded: Blender linearises byte colours, so the non-colour bake
  // then stores the value itself.
  if (pc.emit) {
    const n = hi.pos.length / 3, rgba = new Uint8Array(n * 4), S = {};
    for (let i = 0; i < n; i++) {
      S.x = hi.pos[i * 3]; S.y = hi.pos[i * 3 + 1]; S.z = hi.pos[i * 3 + 2];
      S.nx = sh.normal[i * 3]; S.ny = sh.normal[i * 3 + 1]; S.nz = sh.normal[i * 3 + 2];
      // the vertex's paint state too (additive): material ids, blend, curvature, AO
      S.ma = sh.state[i * 5]; S.mb = sh.state[i * 5 + 1]; S.mw = sh.state[i * 5 + 2]; S.k = sh.state[i * 5 + 3]; S.ao = sh.state[i * 5 + 4];
      let e = pc.emit(S); e = e < 0 ? 0 : e > 1 ? 1 : e;
      const g = e <= 0.0031308 ? e * 12.92 : 1.055 * Math.pow(e, 1 / 2.4) - 0.055;
      rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = g * 255 + 0.5; rgba[i * 4 + 3] = 255;
    }
    entry.hiE = pc.name + '_hiE.ply';
    fs.writeFileSync(path.join(build, entry.hiE), plyBytes(hi.pos, hi.idx, sh.normal, rgba));
  }
  // WRINKLE (optional, additive; salSkin): pc.wrk is a second full-detail field — the same
  // piece with compression gathers sculpted into the inside of its joints. Meshed at the
  // same h and written unpainted (only its normals are baked: bake.py -> <set>_wrinkle).
  if (pc.wrk) {
    const hw = meshSDF(pc.wrk, pc.hi.h, {});
    const n = hw.pos.length / 3, nrm = new Float32Array(n * 3), e = pc.hi.h * 0.5, f = hw.field.at;
    for (let i = 0; i < n; i++) {
      const x = hw.pos[i * 3], y = hw.pos[i * 3 + 1], z = hw.pos[i * 3 + 2];
      const gx = f(x + e, y, z) - f(x - e, y, z), gy = f(x, y + e, z) - f(x, y - e, z), gz = f(x, y, z + e) - f(x, y, z - e), l = Math.hypot(gx, gy, gz) || 1;
      nrm[i * 3] = gx / l; nrm[i * 3 + 1] = gy / l; nrm[i * 3 + 2] = gz / l;
    }
    const rgba = new Uint8Array(n * 4).fill(255);
    entry.hiW = pc.name + '_hiW.ply';
    fs.writeFileSync(path.join(build, entry.hiW), plyBytes(hw.pos, hw.idx, nrm, rgba));
    entry.hiWTris = hw.idx.length / 3;
  }
  console.log(pc.name, 'hi', entry.hiTris, entry.hiWTris ? 'wrinkle ' + entry.hiWTris : '', ((Date.now() - t0) / 1000).toFixed(1) + ' s');
}
// LOW polys, per texture set: the mesh field (bake-only layers left out) DC-meshed,
// QEM-decimated to the piece's budget, then every piece of the set charted and packed into
// ONE atlas (sculpt.js unwrapSet: axis charts on smoothed normals; Smart UV Project
// shredded the bumpy lows into thousands of islands at 20% coverage)
man.unwrap = {};
for (const set of Object.keys(P.sets)) {
  const pcs = P.pieces.filter(q => q.set === set), t0 = Date.now(), lows = [];
  for (const pc of pcs) {
    // (additive, plants) `loSdf`: a different field for the low — an alpha card's plain shell
    // under a high that is all holes (bake.py set alpha: true)
    const lo = meshSDF(pc.loSdf || pc.sdf, pc.lo.h, { forMesh: true });
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
// STRIPS (optional, additive): tileable detail maps for procedural, deforming tubes
// (strip.mjs). Raw RGBA8 here; bake.py writes them as <strip>_albedo/normal/orm.webp and
// lists them in the meta's sets with strip: true (the game wraps them RepeatWrapping).
man.strips = {};
for (const st of P.strips || []) {
  if (only.length && !only.includes(st.name)) { man.strips[st.name] = { W: st.W, H: st.H }; continue; }
  const b = bakeStrip(st);
  for (const k of ['albedo', 'normal', 'orm']) fs.writeFileSync(path.join(build, st.name + '_' + k + '.raw'), b[k]);
  man.strips[st.name] = { W: st.W, H: st.H };
  console.log('strip', st.name, st.W + 'x' + st.H, (b.ms / 1000).toFixed(1) + ' s');
}
fs.writeFileSync(path.join(build, 'manifest.json'), JSON.stringify(man, null, 1));
console.log('export done', ((Date.now() - t00) / 1000).toFixed(1) + ' s ->', build);
