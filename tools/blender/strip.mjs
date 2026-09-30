// TILEABLE STRIP BAKES (node) — the detail maps for geometry that must stay procedural.
//
// A deforming tube (an octopus arm, a squid tentacle) is rebuilt on the CPU every frame, so
// it cannot be a baked low poly. Its SKIN can still be sculpted: every feature on it is a
// displacement over the tube's own (u, v) parameterisation — u along the arm, v once
// round it — so the high poly IS a heightfield on a torus, and a heightfield bake on that
// domain is exactly periodic in both directions by construction (Blender's cage bake of a
// finite segment is not: the ends need padding and every noise layer would have to tile).
//
//   bakeStrip(spec) -> { W, H, albedo, normal, orm }     RGBA8, row r <-> v = (r + .5) / H
//   spec = { W, H,            texels along u, round v
//            Lu, Lv,          physical size of one tile (the height's units)
//            field(u, v, S),  writes S.h (height, + out) and any fields paint wants
//            paint(S),        reads S.h, S.ao, S.k (curvature, + convex), S.u, S.v, the
//                             field's own values; writes S.c [sRGB 0..1], S.ro, S.e (emit)
//            ao: { r, dirs, steps } }                    horizon occlusion radius (physical)
//
// Normal convention: tangent x along +u, y along +v — the frame three's getTangentFrame
// derives from the mesh's uv (no tangent attribute needed on a rebuilt tube). Textures are
// loaded flipY = false, so image row r is v = (r + .5) / H exactly as written here.
// ORM: R = AO, G = roughness, B = emissive mask (the sculpt pipeline's ORM layout).
export function bakeStrip(spec) {
  const { W, H, Lu, Lv } = spec, N = W * H;
  const hf = new Float32Array(N), fields = new Array(N);
  const t0 = Date.now();
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const S = { u: (c + 0.5) / W, v: (r + 0.5) / H, h: 0 };
    spec.field(S.u, S.v, S);
    hf[r * W + c] = S.h;
    fields[r * W + c] = S;
  }
  const dx = Lu / W, dy = Lv / H;
  const at = (c, r) => hf[(((r % H) + H) % H) * W + (((c % W) + W) % W)];
  // horizon AO over the periodic heightfield
  const A = spec.ao || {}, aoR = A.r || Math.min(Lu, Lv) * 0.05, nd = A.dirs || 8, ns = A.steps || 6;
  const DIRS = [];
  for (let d = 0; d < nd; d++) { const a = (d + 0.5) / nd * Math.PI * 2; DIRS.push([Math.cos(a), Math.sin(a)]); }
  const alb = new Uint8Array(N * 4), nrm = new Uint8Array(N * 4), orm = new Uint8Array(N * 4);
  const cl = x => x < 0 ? 0 : x > 1 ? 1 : x;
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const i = r * W + c, h = hf[i], S = fields[i];
    const hx = (at(c + 1, r) - at(c - 1, r)) / (2 * dx), hy = (at(c, r + 1) - at(c, r - 1)) / (2 * dy);
    const lap = (at(c + 1, r) + at(c - 1, r) - 2 * h) / (dx * dx) + (at(c, r + 1) + at(c, r - 1) - 2 * h) / (dy * dy);
    let nx = -hx, ny = -hy, nz = 1;
    const nl = 1 / Math.hypot(nx, ny, nz); nx *= nl; ny *= nl; nz *= nl;
    let occ = 0;
    for (const [ex, ey] of DIRS) {
      let best = 0;
      for (let s = 1; s <= ns; s++) {
        const dist = aoR * s / ns, q = at(Math.round(c + ex * dist / dx), Math.round(r + ey * dist / dy));
        const sl = (q - h) / dist;
        if (sl > best) best = sl;
      }
      occ += best / Math.sqrt(1 + best * best);                 // sin of the horizon angle
    }
    S.ao = cl(1 - occ / nd);
    S.k = -lap * (spec.kScale || 1);                              // + where convex
    S.nx = nx; S.ny = ny;
    S.c = [0.5, 0.5, 0.5]; S.ro = 0.6; S.e = 0;
    spec.paint(S);
    const j = i * 4;
    alb[j] = cl(S.c[0]) * 255 + 0.5; alb[j + 1] = cl(S.c[1]) * 255 + 0.5; alb[j + 2] = cl(S.c[2]) * 255 + 0.5; alb[j + 3] = 255;
    nrm[j] = (nx * 0.5 + 0.5) * 255 + 0.5; nrm[j + 1] = (ny * 0.5 + 0.5) * 255 + 0.5; nrm[j + 2] = (nz * 0.5 + 0.5) * 255 + 0.5; nrm[j + 3] = 255;
    orm[j] = S.ao * 255 + 0.5; orm[j + 1] = cl(S.ro) * 255 + 0.5; orm[j + 2] = cl(S.e) * 255 + 0.5; orm[j + 3] = 255;
  }
  return { W, H, albedo: alb, normal: nrm, orm, ms: Date.now() - t0 };
}

// Tileable value noise / fbm / cell grids on the unit torus (period 1 in u and v at every
// octave: lattice sizes are integers). For strip fields.
export function tnoise(seed) {
  const hash = (x, y, o) => { let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed + o * 131, 144665); h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
  const vn = (u, v, nx, ny, o) => {
    const x = u * nx, y = v * ny, xi = Math.floor(x), yi = Math.floor(y);
    let tx = x - xi, ty = y - yi; tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
    const X0 = ((xi % nx) + nx) % nx, X1 = (X0 + 1) % nx, Y0 = ((yi % ny) + ny) % ny, Y1 = (Y0 + 1) % ny;
    const a = hash(X0, Y0, o), b = hash(X1, Y0, o), c = hash(X0, Y1, o), d = hash(X1, Y1, o);
    return a + (b - a) * tx + (c - a + (a - b + d - c) * tx) * ty;
  };
  // fbm with base lattice (nx, ny), `oct` octaves, in [0, 1]
  const fbm = (u, v, nx, ny, oct = 4) => { let s = 0, a = 1, t = 0; for (let o = 0; o < oct; o++) { s += a * vn(u, v, nx << o, ny << o, o); t += a; a *= 0.5; } return s / t; };
  // jittered cells: (nx, ny) grid, returns nearest point distance f1, second f2 (in cell
  // units along u), the nearest cell's id hash and its offset
  const cells = (u, v, nx, ny, jit, o, out, aspect = 1) => {
    const x = u * nx, y = v * ny, xi = Math.floor(x), yi = Math.floor(y);
    let f1 = 9, f2 = 9, id = 0, bx = 0, by = 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const cx = xi + ox, cy = yi + oy, wx = ((cx % nx) + nx) % nx, wy = ((cy % ny) + ny) % ny;
      const px = cx + 0.5 + (hash(wx, wy, o + 7) - 0.5) * jit, py = cy + 0.5 + (hash(wx, wy, o + 11) - 0.5) * jit;
      const ex = px - x, ey = (py - y) * aspect, d = Math.sqrt(ex * ex + ey * ey);
      if (d < f1) { f2 = f1; f1 = d; id = hash(wx, wy, o + 17); bx = ex; by = ey; } else if (d < f2) f2 = d;
    }
    out.f1 = f1; out.f2 = f2; out.id = id; out.dx = bx; out.dy = by;
    return out;
  };
  return { vn, fbm, cells, hash };
}
