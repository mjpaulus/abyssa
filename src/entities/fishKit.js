// FISH KIT — anatomical fish as signed-distance fields, for the sculpt pipeline (fauna2).
// PURE: no THREE, no DOM. Shared by the offline bake (schoolSculpt.js -> tools/blender) and
// the runtime (creatures.js / fauna.js label the baked meshes' vertices with the SAME
// analytic functions, so the motion attributes the vertex shaders read land exactly on the
// anatomy the bake drew: body vs fin, root -> free edge, which pectoral).
//
// A FISH is plain data (a species row):
//   prof: [[t, top, bot, hw], ...]  body profile; t = 0 snout .. 1 caudal peduncle (the
//         body is 1 long), top/bot = dorsal/ventral height off the axis, hw = half-width.
//         Catmull-Rom between keys. The axis is straight; a fish's camber lives in top/bot.
//   fins: [FIN...]   median fins in the x = 0 plane (outline in (y, t)); paired fins in
//         their own plane through a root point (outline in (span, chord)).
//         FIN = { name, med: true, pts: [[y, t]...] } | { name, pair: true, O, A, B, pts: [[a, b]...] }
//         + root: [i0, i1] (the outline edge that sits in the body), th: root half-thickness,
//         rays: count, scal: free-edge scallop depth, spine: 1 for spiny rays (a stiffer,
//         thicker ray, a deeper notch), m: material id
//   eye: { t, y, r }   on the flank (y off the axis); the eyeball is a sphere sunk 0.35 r
//   mouth: { t, y, w } the gape's corner (t), height, half-height of the lips
//   op: { t, k }       the operculum's free edge at the mid-flank (t), its curvature
//   scales: { n, rows, amp } roof-tiled scales (bake-only): n along the body, rows round
//   frame: the creatures.js frame (head at z = +0.5, +Y up, x lateral) unless a species sets
//          frame: 'fauna' (head at x = +1, body 2 long, +Z lateral: fauna.js's vocabulary)
//
// Material ids are shared by every fish so one paint vocabulary covers the set.
export const FM = { BODY: 0, FIN: 1, EYE: 2, MOUTH: 3, SPINE: 4, LENS: 5 };

const sst = (a, b, x) => { let t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;

// ---- profile -----------------------------------------------------------------------------
// Catmull-Rom over non-uniform t keys: returns [top, bot, hw] at t (clamped to the keys).
function profAt(K, t, out) {
  const n = K.length;
  if (t <= K[0][0]) { out[0] = K[0][1]; out[1] = K[0][2]; out[2] = K[0][3]; return out; }
  if (t >= K[n - 1][0]) { out[0] = K[n - 1][1]; out[1] = K[n - 1][2]; out[2] = K[n - 1][3]; return out; }
  let i = 1;
  while (K[i][0] < t) i++;
  const a = K[Math.max(0, i - 2)], b = K[i - 1], c = K[i], d = K[Math.min(n - 1, i + 1)];
  const u = (t - b[0]) / (c[0] - b[0]);
  for (let k = 1; k <= 3; k++) {
    const p0 = a[k], p1 = b[k], p2 = c[k], p3 = d[k];
    out[k - 1] = Math.max(0.0015, 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u));
  }
  return out;
}

// ---- 2D polygon signed distance (negative inside) ------------------------------------------
function polyD(P, x, y) {
  let d = Infinity, s = 1;
  for (let i = 0, j = P.length - 1; i < P.length; j = i, i++) {
    const ax = P[j][0], ay = P[j][1], bx = P[i][0], by = P[i][1];
    const ex = bx - ax, ey = by - ay, wx = x - ax, wy = y - ay;
    const h = clamp((wx * ex + wy * ey) / (ex * ex + ey * ey), 0, 1);
    const qx = wx - ex * h, qy = wy - ey * h;
    d = Math.min(d, qx * qx + qy * qy);
    const c1 = y >= ay, c2 = y < by, c3 = ex * wy > ey * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
  }
  return s * Math.sqrt(d);
}
function segD(ax, ay, bx, by, x, y) {
  const ex = bx - ax, ey = by - ay, h = clamp(((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey), 0, 1);
  return Math.hypot(x - ax - ex * h, y - ay - ey * h);
}
// Smooth closed outline from a few control points: centripetal-ish Catmull-Rom resample, so
// fins have curved leading edges and rounded lobes instead of polygon corners.
function smoothOutline(P, per = 8) {
  const n = P.length, out = [];
  for (let i = 0; i < n; i++) {
    const a = P[(i - 1 + n) % n], b = P[i], c = P[(i + 1) % n], d = P[(i + 2) % n];
    for (let k = 0; k < per; k++) {
      const u = k / per;
      out.push([0, 1].map(j => 0.5 * (2 * b[j] + (-a[j] + c[j]) * u + (2 * a[j] - 5 * b[j] + 4 * c[j] - d[j]) * u * u + (-a[j] + 3 * b[j] - 3 * c[j] + d[j]) * u * u * u)));
    }
  }
  return out;
}

const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// ---- compile a species to analytic functions -------------------------------------------------
// Everything below works in the CANONICAL frame (head z = +0.5, length 1); the 'fauna' frame
// maps in/out at the edges (toCanon / the spec's xf).
export function makeFish(S) {
  const K = S.prof, tmp = [0, 0, 0];
  const fins = S.fins.map(f => {
    const F = Object.assign({ th: 0.004, rays: 12, scal: 0.18, spine: 0 }, f);
    if (F.med) { F.O = [0, 0, 0.5]; F.A = [0, 1, 0]; F.B = [0, 0, -1]; }
    F.A = norm(F.A); { const k = dot(F.A, F.B); F.B = norm([F.B[0] - F.A[0] * k, F.B[1] - F.A[1] * k, F.B[2] - F.A[2] * k]); } F.W = norm(cross(F.A, F.B));
    F.P = smoothOutline(F.pts, F.per || 8);
    // the root edge and the ray focus (just inside the root, behind its middle)
    const r0 = F.pts[F.root[0]], r1 = F.pts[F.root[1]];
    F.r0 = r0; F.r1 = r1;
    let far = 1e-6;
    for (const p of F.P) far = Math.max(far, segD(r0[0], r0[1], r1[0], r1[1], p[0], p[1]));
    F.far = far;
    F.focus = F.focus || [(r0[0] + r1[0]) / 2 - (F.med ? Math.sign((r0[0] + r1[0]) / 2 || 1) * far * 0.25 : far * 0.25), (r0[1] + r1[1]) / 2];
    let amin = 9, amax = -9;
    for (const p of F.P) {
      if (segD(r0[0], r0[1], r1[0], r1[1], p[0], p[1]) < far * 0.15) continue;
      const a = Math.atan2(p[1] - F.focus[1], p[0] - F.focus[0]);
      amin = Math.min(amin, a); amax = Math.max(amax, a);
    }
    F.amin = amin; F.amax = amax;
    let bb = [9, 9, 9, -9, -9, -9];
    for (const p of F.P) for (const w of [-0.02, 0.02]) {
      const q = [0, 1, 2].map(k => F.O[k] + F.A[k] * p[0] + F.B[k] * p[1] + F.W[k] * w);
      for (let k = 0; k < 3; k++) { bb[k] = Math.min(bb[k], q[k]); bb[k + 3] = Math.max(bb[k + 3], q[k]); }
    }
    F.bb = bb;
    return F;
  });

  // body: an ellipse per section (centre cy, semi-axes hw x b), corrected for the profile's
  // slope so the field stays close to a true distance at the head and the peduncle
  function body(x, y, z) {
    const t = 0.5 - z, tc = clamp(t, 0, 1);
    profAt(K, tc, tmp);
    const top = tmp[0], bot = tmp[1], a = tmp[2], b = (top + bot) * 0.5, cy = (top - bot) * 0.5;
    const px = x / a, py = (y - cy) / b;
    const k0 = Math.sqrt(px * px + py * py), k1 = Math.sqrt(px * px / (a * a) + py * py / (b * b));
    let d = k1 > 1e-9 ? k0 * (k0 - 1) / k1 : -Math.min(a, b);
    // slope correction (mean radius change per unit t)
    profAt(K, clamp(tc + 0.01, 0, 1), tmp);
    const r1 = (tmp[0] + tmp[1]) * 0.5;
    profAt(K, clamp(tc - 0.01, 0, 1), tmp);
    const r0 = (tmp[0] + tmp[1]) * 0.5, sl = (r1 - r0) / 0.02;
    d /= Math.sqrt(1 + sl * sl);
    const dz = t < 0 ? -t : t > 1 ? t - 1 : 0;
    return dz > 0 ? Math.hypot(Math.max(d, 0), dz) + Math.min(d, 0) * 0 : d;
  }
  // a fin: a slab over a smooth outline, thick at the root, rays standing proud, the free
  // edge scalloped between the rays. Returns the distance; local coords left in FL.
  const FL = { a: 0, b: 0, w: 0, s: 0, q: 0, ray: 0, d2: 0 };
  function finD(F, x, y, z) {
    const px = x - F.O[0], py = y - F.O[1], pz = z - F.O[2];
    const a = px * F.A[0] + py * F.A[1] + pz * F.A[2], b = px * F.B[0] + py * F.B[1] + pz * F.B[2], w = px * F.W[0] + py * F.W[1] + pz * F.W[2];
    const s = clamp(segD(F.r0[0], F.r0[1], F.r1[0], F.r1[1], a, b) / F.far, 0, 1);
    const ang = Math.atan2(b - F.focus[1], a - F.focus[0]);
    const q = clamp((ang - F.amin) / (F.amax - F.amin + 1e-6), 0, 1);
    const fq = q * F.rays, rq = fq - Math.floor(fq) - 0.5;
    const ray = Math.exp(-(rq * rq) / (F.spine ? 0.018 : 0.010));
    let d2 = polyD(F.P, a, b);
    // scallop: the membrane recedes between the rays near the free edge
    d2 += F.scal * F.far * 0.12 * (1 - ray) * sst(0.55, 1.0, s) * (F.spine ? 2.2 : 1);
    const th = F.th * (1 - 0.6 * s) * (1 + (F.spine ? 0.9 : 0.45) * ray);
    const e = Math.abs(w) - th;
    FL.a = a; FL.b = b; FL.w = w; FL.s = s; FL.q = q; FL.ray = ray; FL.d2 = d2;
    return d2 > 0 || e > 0 ? Math.hypot(Math.max(d2, 0), Math.max(e, 0)) : Math.max(d2, e);
  }
  // the eye: centre sunk into the flank, both sides (x = +-)
  let eye = null;
  if (S.eye) {
    profAt(K, S.eye.t, tmp);
    const a = tmp[2], b = (tmp[0] + tmp[1]) * 0.5, cy = (tmp[0] - tmp[1]) * 0.5;
    const yy = clamp((S.eye.y - cy) / b, -0.95, 0.95);
    const xs = a * Math.sqrt(1 - yy * yy);
    const n = norm([xs / (a * a), (S.eye.y - cy) / (b * b), 0]);
    const r = S.eye.r, sink = S.eye.sink != null ? S.eye.sink : 0.38;
    eye = { c: [xs - n[0] * r * sink, S.eye.y - n[1] * r * sink, 0.5 - S.eye.t], n, r, look: S.eye.look ? norm(S.eye.look) : n };
  }
  return { S, K, fins, body, finD, FL, eye, profAt: (t, o) => profAt(K, t, o) };
}

// ---- the SDF spec (sculpt.js nodes) ---------------------------------------------------------
// Body and fins are 'fn' leaves over the analytic fields above; the head detail (eye socket,
// mouth, operculum, nostril) are ordinary nodes and displacement layers; scales, lateral-line
// pores and fine skin are bake-only layers (texels, not triangles).
export function fishSpec(fish) {
  const { S, fins, body, finD, eye } = fish;
  let mt = 0, mb = 0, mw = 0;
  for (const k of fish.K) { mt = Math.max(mt, k[1]); mb = Math.max(mb, k[2]); mw = Math.max(mw, k[3]); }
  const bbB = [-mw - 0.02, -mb - 0.02, -0.53, mw + 0.02, mt + 0.02, 0.53];
  const bodyLeaf = { t: 'fn', bb: bbB, f: body, m: FM.BODY };
  const finLeaves = fins.map(F => ({ t: 'fn', bb: F.bb, f: (x, y, z) => finD(F, x, y, z), m: F.m != null ? F.m : FM.FIN }));
  // paired fins are mirrored to the -x side
  const finNodes = fins.map((F, i) => F.pair ? { t: 'mir', ax: 0, ch: [finLeaves[i]] } : finLeaves[i]);
  let sp = { t: 'u', k: S.finK || 0.006, ch: [bodyLeaf, ...finNodes] };
  // mouth: a gape groove from the snout to the corner, lips standing either side
  if (S.mouth) {
    const M = S.mouth, tc = M.t;
    const len = tc + 0.02;
    sp = { t: 's', k: 0.003, m: FM.MOUTH, ch: [sp, { t: 'mir', ax: 0, ch: [{ t: 'ellip', c: [0, M.y, 0.5 - tc * 0.5 + 0.01], r: [M.halfW || 0.06, M.w, len * 0.5 + 0.004], e: [M.tilt || 0, 0, 0], m: FM.MOUTH }] }] };
  }
  // eyes: socket cut, eyeball in, an orbit rim
  if (eye) {
    const c = eye.c, r = eye.r, n = eye.n;
    const sock = { t: 'mir', ax: 0, ch: [{ t: 'sphere', c: [c[0], c[1], c[2]], r: r * 1.10 }] };
    sp = { t: 's', k: r * 0.25, m: FM.BODY, ch: [sp, sock] };
    const ball = { t: 'mir', ax: 0, ch: [{ t: 'sphere', c, r, m: FM.EYE }] };
    sp = { t: 'u', k: 0, ch: [sp, ball] };
  }
  // displacement: operculum groove + gill-cover edge (mesh), scales + pores + grain (bake)
  const L = [];
  if (S.op) L.push({ type: 'fn', amp: 0.006, fn: opFn(fish) });
  if (S.scales) L.push({ type: 'fn', amp: S.scales.amp * 1.6, bake: true, fn: scaleFn(fish) });
  L.push({ type: 'fn', amp: 0.0016, bake: true, fn: finRayFn(fish) });
  if (S.lat) L.push({ type: 'fn', amp: 0.0012, bake: true, fn: latFn(fish) });
  if (S.scutes) L.push({ type: 'fn', amp: 0.0035, fn: scuteFn(fish) });
  L.push({ type: 'grain', amp: 0.0004, f: 260, seed: 7, bake: true });
  sp = { t: 'disp', L, ch: [sp] };
  return S.frame === 'fauna' ? toFaunaFrame(sp, S.faunaLen || 2) : sp;
}
// the fauna.js frame: +X forward, length faunaLen centred, +Z lateral. Canonical (x, y, z)
// -> fauna (X = z * L, Y = y * L, Z = x * L): a rotation about Y plus a uniform scale.
function toFaunaFrame(sp, L) {
  // xf maps child (canonical) -> world: world = s * R * child. R takes canon z -> +X, canon x -> +Z
  return { t: 'xf', s: L, e: [0, Math.PI / 2, 0], ch: [sp] };
}
export function toCanon(S, x, y, z) {
  if (S.frame !== 'fauna') return [x, y, z];
  const L = S.faunaLen || 2;
  // inverse of Ry(pi/2) * L: canon x = -Z... Ry(+90): (x, y, z) -> (z, y, -x); so canon -> world
  // X = cz, Z = -cx  =>  cz = X / L, cx = -Z / L
  return [-z / L, y / L, x / L];
}

// where on the body a point is: t, the normalised height yn (-1 belly .. 1 back), the radial
// ratio k (1 on the skin), the side angle
function bodyCoord(fish, x, y, z, o) {
  const t = 0.5 - z, tc = clamp(t, 0, 1), P = fish.profAt(tc, o.tmp || (o.tmp = [0, 0, 0]));
  const a = P[2], b = (P[0] + P[1]) * 0.5, cy = (P[0] - P[1]) * 0.5;
  o.t = t; o.yn = (y - cy) / b; o.k = Math.hypot(x / a, (y - cy) / b); o.th = Math.atan2(y - cy, Math.abs(x)); o.b = b; o.a = a; o.cy = cy;
  return o;
}
function opFn(fish) {
  const op = fish.S.op, o = {};
  return (x, y, z) => {
    bodyCoord(fish, x, y, z, o);
    if (o.k < 0.8 || o.k > 1.25 || o.t < 0.05 || o.t > 0.5) return 0;
    const curve = op.t + op.k * o.yn * o.yn - 0.01 * o.yn;
    const dt = o.t - curve;
    // the cover's free edge overlaps the body behind it: a step up just ahead of the line,
    // a groove on it
    const groove = -0.0045 * Math.exp(-((dt / 0.0045) ** 2));
    const lip = 0.0022 * sst(-0.05, -0.004, dt) * (1 - sst(-0.004, 0.0, dt));
    const band = sst(-0.95, -0.7, o.yn) * (1 - sst(0.7, 0.92, o.yn));
    // the preopercle: a fainter line ahead of it
    const pre = -0.0016 * Math.exp(-(((dt + 0.045 - 0.02 * o.yn) / 0.003) ** 2)) * sst(-0.6, -0.2, o.yn) * (1 - sst(0.4, 0.7, o.yn));
    return (groove + lip + pre) * band;
  };
}
// roof-tiled scales: each row offset half a scale; the head-ward scale overlaps, so each
// visible scale shows a free posterior field ending in a raised crescent rim
function scaleFn(fish) {
  const sc = fish.S.scales, o = {};
  const t0 = fish.S.op ? fish.S.op.t + 0.02 : 0.2;
  return (x, y, z) => {
    bodyCoord(fish, x, y, z, o);
    if (o.k < 0.85 || o.k > 1.2 || o.t < t0 - 0.03 || o.t > 1.0) return 0;
    const fade = sst(t0 - 0.03, t0 + 0.01, o.t) * (1 - sst(0.97, 1.0, o.t));
    // rows around: by arc on the ellipse, so scales stay square on deep bodies
    const arc = o.th * (o.b + o.a) * 0.5;
    const along = o.t * sc.n, around = arc / (1 / sc.n) * (sc.ar || 1.0);
    const row = Math.floor(around), off = (row & 1) ? 0.5 : 0;
    let best = 1e5, h = 0;
    for (let j = -1; j <= 1; j++) {
      const r = row + j, of = (r & 1) ? 0.5 : 0;
      for (let i = -1; i <= 1; i++) {
        const cx = Math.floor(along - of) + i + 0.5 + of, cyy = r + 0.5;
        const dx = along - cx, dy = (around - cyy) * 0.86, k = Math.hypot(dx, dy) / 0.82;
        if (k < 1 && cx < best) {
          best = cx;
          // posterior field slopes down to the free edge; crescent rim at the edge
          h = (0.35 + 0.65 * clamp(0.5 + dx / 0.9, 0, 1)) * (1 - k ** 4) - 0.6 * sst(0.8, 1.0, k);
        }
      }
    }
    return sc.amp * h * fade;
  };
}
function latFn(fish) {
  const L = fish.S.lat, o = {};
  return (x, y, z) => {
    bodyCoord(fish, x, y, z, o);
    if (o.k < 0.85 || o.k > 1.2 || o.t < L.t0 || o.t > 0.98) return 0;
    const yc = L.y0 + (L.y1 - L.y0) * o.t;   // the line's height (yn) along the body
    const d = (o.yn - yc) * o.b;
    const canal = Math.exp(-((d / 0.004) ** 2));
    const pore = Math.exp(-(((((o.t * L.n) % 1) - 0.5) / 0.12) ** 2));
    return -0.0012 * canal * (0.4 + 0.6 * pore) + 0.0006 * canal;
  };
}
// keel scutes (herring, scad): a row of sharp-edged plates along the belly / lateral line
function scuteFn(fish) {
  const Sc = fish.S.scutes, o = {};
  return (x, y, z) => {
    bodyCoord(fish, x, y, z, o);
    if (o.k < 0.8 || o.k > 1.25 || o.t < Sc.t0 || o.t > Sc.t1) return 0;
    const d = (o.yn - Sc.yn) * o.b;
    const band = Math.exp(-((d / Sc.w) ** 2));
    const u = (o.t - Sc.t0) / (Sc.t1 - Sc.t0) * Sc.n, f = u - Math.floor(u);
    const plate = sst(0.0, 0.7, f) * (1 - sst(0.85, 1.0, f));
    return Sc.h * band * (0.5 + 0.5 * plate);
  };
}
function finRayFn(fish) {
  const FL = fish.FL;
  return (x, y, z) => {
    let best = 1e9, r = 0;
    for (const F of fish.fins) {
      const xx = F.pair ? Math.abs(x) : x;
      const d = fish.finD(F, xx, y, z);
      if (d < best && d < 0.01) {
        best = d;
        // segment joints across each ray, and the ray's own relief
        const seg = Math.exp(-(((((FL.s * (F.spine ? 3 : 9)) % 1) - 0.5) / 0.06) ** 2));
        r = FL.ray * (1 - 0.5 * seg * (F.spine ? 0 : 1)) * (1 - 0.6 * FL.s) - 0.3 * (1 - FL.ray) * FL.s;
      }
    }
    return best < 0.01 ? 0.0012 * r : 0;
  };
}

// ---- runtime labels --------------------------------------------------------------------------
// For a baked vertex (canonical frame): which fin it belongs to (-1 = body), its root -> edge
// coordinate s and across-ray q, and whether it is on the eyeball.
export function labelVertex(fish, x, y, z, out) {
  let best = fish.body(x, y, z), fi = -1, s = 0, q = 0;
  for (let i = 0; i < fish.fins.length; i++) {
    const F = fish.fins[i];
    const d = fish.finD(F, F.pair ? Math.abs(x) : x, y, z);
    // a fin wins only where it stands clear of the body (the smooth root belongs to the body)
    if (d < best - 0.0015) { best = d; fi = i; s = fish.FL.s; q = fish.FL.q; }
  }
  out.fin = fi; out.s = s; out.q = q;
  out.eye = 0;
  if (fish.eye) {
    const e = fish.eye.c, dx = Math.abs(x) - e[0], dy = y - e[1], dz = z - e[2];
    if (Math.hypot(dx, dy, dz) < fish.eye.r * 1.04) out.eye = 1;
  }
  return out;
}
export const _internal = { profAt, polyD, bodyCoord };
