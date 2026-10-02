// THE FAR FIELD — crossed-card IMPOSTORS of every sculpted 3D species variant, baked through
// the same pipeline (`node tools/blender/build.mjs imp` -> assets/imp/). Why: a far LOD made by
// collapse-decimating a near low stalls at its UV seams (a tentacled anemone or a worm
// colony never got under ~1000 triangles), so a dense reef paid near-mesh vertex cost all the
// way to the range fade. A far plant here is FOUR triangles.
//
// How the bake makes an impostor: each variant's piece is two cards crossing at the centre of
// its bounds (one facing +z, one facing +x), with explicit UVs in one shared alpha atlas
// (uvFixed). The cage pushes each card out to the front of the bounds and the ray reaches back
// through all of it, so every texel samples the FRONT-MOST surface of the full sculpt —
// an orthographic projection, with albedo, tangent normals relative to the card, AO, and the
// coverage (ORM.B, alpha set) that cuts the silhouette. Paint is the species' own.
//
// plantKit.js draws them as ONE extra batch for every species (+1 draw call total), moving an
// instance there at its far LOD distance.
import { compile } from '../../lib/sculpt.js';
import { SPECIES } from './plantsSculpt.js';

// species that get impostors, the high's cell size for the projection (coarser than the
// species' own bake: a card cell is ~100 texels), and how much the card sways at range
export const IMP = {
  tube: { h: 0.004, flex: 1 }, anem: { h: 0.0032, flex: 0.6 }, barrel: { h: 0.008, flex: 0.25 },
  worm: { h: 0.0035, flex: 0.3 }, stag: { h: 0.004, flex: 0.5 }, crin: { h: 0.0025, flex: 0.8 },
  pen: { h: 0.0032, flex: 0.8 }, brain: { h: 0.006, flex: 0 }, table: { h: 0.006, flex: 0 }
};
const COLS = 6, CELL = 1 / COLS, FILL = 0.94;

// the variant's tight bounds: a coarse raster of its field (compile's own bb is padded)
function tightBounds(sdf) {
  const C = compile(sdf, true), f = C.f, bb = C.bb, st = 0.025;
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (let x = bb[0]; x <= bb[3]; x += st) for (let y = bb[1]; y <= bb[4]; y += st) for (let z = bb[2]; z <= bb[5]; z += st) {
    if (f(x, y, z) < st * 0.7) { lo[0] = Math.min(lo[0], x); lo[1] = Math.min(lo[1], y); lo[2] = Math.min(lo[2], z); hi[0] = Math.max(hi[0], x); hi[1] = Math.max(hi[1], y); hi[2] = Math.max(hi[2], z); }
  }
  return [lo[0] - st, Math.max(lo[1] - st, -0.15), lo[2] - st, hi[0] + st, hi[1] + st, hi[2] + st];
}

let _plan = null;
export function impPlan() {
  if (_plan) return _plan;
  const items = [];
  for (const sp of Object.keys(IMP)) SPECIES[sp].variants.forEach((v, i) => items.push({ sp, v: i, spec: v }));
  _plan = items.map((it, k) => {
    const col = k % COLS, row = Math.floor(k / COLS);
    return { ...it, u0: col * CELL + CELL * (1 - FILL) / 2, v0: row * CELL + CELL * (1 - FILL) / 2 };
  });
  return _plan;
}

// two crossed cards for bounds B, laid into the cell at (u0, v0) with one texel scale
export function impCards(B, u0, v0) {
  const [x0, y0, z0, x1, y1, z1] = B, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const W = Math.max(x1 - x0, z1 - z0), H = y1 - y0, k = CELL * FILL / Math.max(W * 2 + 0.02, H);
  const pos = [], uv = [], idx = [];
  // card A faces +z (x across), card B faces +x (z across, mirrored so it faces outward); the two
  // sit side by side in the cell
  const ua = u0, ub = u0 + (x1 - x0) * k + 0.01 * k;
  const quad = (P, U) => { const b = pos.length / 3; for (let i = 0; i < 4; i++) { pos.push(...P[i]); uv.push(...U[i]); } idx.push(b, b + 1, b + 2, b, b + 2, b + 3); };
  quad([[x0, y0, cz], [x1, y0, cz], [x1, y1, cz], [x0, y1, cz]], [[ua, v0], [ua + (x1 - x0) * k, v0], [ua + (x1 - x0) * k, v0 + H * k], [ua, v0 + H * k]]);
  quad([[cx, y0, z1], [cx, y0, z0], [cx, y1, z0], [cx, y1, z1]], [[ub, v0], [ub + (z1 - z0) * k, v0], [ub + (z1 - z0) * k, v0 + H * k], [ub, v0 + H * k]]);
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx), uv: new Float32Array(uv), depth: Math.max(x1 - x0, z1 - z0) / 2 };
}

export function pipeline() {
  const pieces = [], bounds = {};
  for (const P of impPlan()) {
    const S = SPECIES[P.sp], b = S.build(P.spec), B = tightBounds(b.sdf), C = impCards(B, P.u0, P.v0);
    const name = 'i' + P.sp + '_v' + P.v;
    bounds[name] = B.map(x => +x.toFixed(3));
    pieces.push({
      name, set: 'imp', sdf: b.sdf, low: () => impCards(B, P.u0, P.v0), hi: { h: IMP[P.sp].h }, lo: { h: 0.01, tris: 0 },
      paint: S.paint, kEps: S.kEps * 1.5, ao: S.ao, cage: C.depth + 0.04, ray: C.depth * 2 + 0.1, emit: () => 1
    });
  }
  return {
    name: 'imp', out: 'assets/imp',
    sets: { imp: { size: 1024, gutter: 3, aoDist: 0.08, aoSamples: 32, fill: true, alpha: true, ormB: 'alpha', ormHalf: false, uvFixed: true } },
    pieces,
    compress: { mesh: 'draco', tex: 'ktx2' },
    meta: { imp: Object.fromEntries(Object.keys(IMP).map(sp => [sp, SPECIES[sp].variants.length])), flex: Object.fromEntries(Object.entries(IMP).map(([k, v]) => [k, v.flex])), bounds }
  };
}
