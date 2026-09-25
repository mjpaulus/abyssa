// Shared geometry kit for the raft build. OWNED BY: orchestrator.
//
// The raft is assembled by four builders (hull, station, gear, davit) that each bucket
// their primitives into a Part and bake one merged mesh per material, exactly the way
// diver.js does. Hundreds of bolts, cleats, staves and rope turns therefore cost a
// handful of draw calls, and nothing here allocates after build.
//
// DELIBERATELY DEPENDENCY-LIGHT: this imports `three` and lib/math.js only. It must not
// reach for core.js — raft.js already owns that edge, and water.js -> flora.js ->
// terrain.js has an evaluation-order cycle in this project that a new shared module is
// an easy way to trip. Materials are PASSED IN, never built here.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm, clamp } from '../../lib/math.js';

export const TAU = Math.PI * 2;

const _o = new THREE.Object3D();

// Place a geometry in its parent's frame. Rotation is applied about the geometry origin
// first, then the translation — the order you want when bolting a part onto a frame.
export function xf(geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1) {
  _o.position.set(x, y, z); _o.rotation.set(rx, ry, rz); _o.scale.setScalar(s);
  _o.updateMatrix();
  return geo.applyMatrix4(_o.matrix);
}

// ---- primitive shorthands (all indexed, so mergeGeometries stays happy) ------------
export const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
export const cyl = (rt, rb, h, seg = 10, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
export const sph = (r, w = 8, h = 6, ps, pl, ts, tl) => new THREE.SphereGeometry(r, w, h, ps, pl, ts, tl);
export const tor = (r, t, rs = 6, ts = 14) => new THREE.TorusGeometry(r, t, rs, ts);
export const lathe = (pts, seg = 16) => new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(p[0], p[1])), seg);

// Bucket primitives by material, emit one merged mesh each.
export function Part(node) {
  const b = new Map();
  return {
    node,
    add(geo, mat) { let a = b.get(mat); if (!a) b.set(mat, a = []); a.push(geo); return geo; },
    // Convenience: transform and file in one call, the shape most builder lines want.
    put(geo, mat, x, y, z, rx, ry, rz, s) { return this.add(xf(geo, x, y, z, rx, ry, rz, s), mat); },
    bake(shadow = true) {
      for (const [mat, list] of b) {
        // SURFACE PASS (polish-raft). Every piece gets metric UVs (1 uv = 1 metre, laid
        // along the piece's own grain) plus a per-piece offset hashed from where it sits,
        // so no two boards, staves or plates show the same patch of texture.
        const mode = mat.userData.uv;
        if (mode) for (const g of list) metricUV(g, mode);
        // No part may render at one roughness: pieces a builder filed without any wear
        // get the material's default treatment — patina on brass (tarnish facing down,
        // bright facing up), and a light grime/oxide field on everything else textured.
        if (mode && !mat.transparent) for (const g of list) if (!g.attributes.color) {
          if (mat.userData.brass) brassPatina(g);
          else weather(g, { tone: 0.94, freq: 2.2, amp: 0.20, rust: mat.userData.rustK || 0 });
        }
        // merging demands identical attribute sets: pad plain primitives that got mixed
        // in with weathered ones carrying vertex colours. Colour is RGBA: A is the
        // surface STATE (0.5 neutral; lower = wetter / more polished, higher = rustier /
        // drier) that the raft's shader patch turns into roughness and metalness.
        if (mat.vertexColors || list.some(g => g.attributes.color)) {
          // transparent buckets (glass) stay RGB: an alpha channel would multiply opacity
          if (mat.transparent) {
            for (const g of list) if (!g.attributes.color) g.setAttribute('color', new THREE.BufferAttribute(
              new Float32Array(g.attributes.position.count * 3).fill(1), 3));
          } else for (const g of list) rgba(g);
        }
        // the deck-map coordinate (raft.js): real deck planking carries raft-local xz,
        // everything else in the bucket points at the map's neutral corner texel
        if (mat.userData.deckAttr) for (const g of list) if (!g.attributes.raftDeck) {
          g.setAttribute('raftDeck', new THREE.BufferAttribute(
            new Float32Array(g.attributes.position.count * 2).fill(DECK_SENTINEL), 2));
        }
        const m = new THREE.Mesh(list.length > 1 ? mergeGeometries(list) : list[0], mat);
        m.castShadow = shadow; m.receiveShadow = true;
        // Marks this mesh as static and already in raft-local space, so raft.js can do a
        // second merge across builders: four files that each bake their own iron bucket
        // would otherwise cost four iron draw calls instead of one.
        m.userData.rmerge = true;
        node.add(m);
      }
      b.clear();
      return node;
    }
  };
}

// ---- surface pass helpers (polish-raft) ---------------------------------------------
// The deck map's neutral texel lives in its corner, outside the hull footprint.
export const DECK_SENTINEL = 0.001;

// Promote a geometry's colour to RGBA (state 0.5), or give it one (white, 0.5).
export function rgba(g, st = 0.5) {
  const c = g.attributes.color, n = g.attributes.position.count;
  if (c && c.itemSize === 4) return g;
  const a = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    a[i * 4] = c ? c.getX(i) : 1; a[i * 4 + 1] = c ? c.getY(i) : 1; a[i * 4 + 2] = c ? c.getZ(i) : 1;
    a[i * 4 + 3] = st;
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 4));
  return g;
}

// Set/shift the surface state of every vertex (fn(i, x, y, z) -> delta, or a number).
export function state(g, fn) {
  rgba(g);
  const c = g.attributes.color, p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const d = typeof fn === 'number' ? fn : fn(i, p.getX(i), p.getY(i), p.getZ(i));
    c.setW(i, clamp(c.getW(i) + d, 0, 1));
  }
  return g;
}

// Deterministic per-piece offset from where the piece sits (metres, wraps any tile).
const _bc = new THREE.Vector3();
function pieceSeed(g) {
  if (!g.boundingBox) g.computeBoundingBox();
  g.boundingBox.getCenter(_bc);
  const h = Math.sin(_bc.x * 127.1 + _bc.y * 311.7 + _bc.z * 74.7) * 43758.5453;
  const h2 = Math.sin(_bc.x * 269.5 + _bc.y * 183.3 + _bc.z * 246.1) * 12543.1234;
  g.boundingBox = null;
  return [(h - Math.floor(h)) * 17.0, (h2 - Math.floor(h2)) * 23.0];
}

// METRIC UVs. Three's primitives map each face or wrap 0..1 regardless of size, so a
// 9-metre slab and a 2-centimetre bolt got the same texture once each. This rewrites a
// piece's UVs in metres from its own construction parameters (they survive xf and
// clone), keeping each primitive's natural grain direction: along a cylinder's axis,
// along a tube's path, along a lathe's profile, and along the LONGER edge of every box
// face. mode 'strand' instead lays one texture tile per rope lay: (along / circumference,
// around 0..1), so a laid-rope texture wraps seamlessly at any radius.
export function metricUV(g, mode = 'metric') {
  const uv = g.attributes.uv; if (!uv || g.userData.muv) return g;
  g.userData.muv = true;
  const P = g.parameters || {}, t = g.type, n = uv.count, TAU_ = Math.PI * 2;
  const [ou, ov] = pieceSeed(g);
  const strand = mode === 'strand';
  const set = (i, u, v) => uv.setXY(i, u + ou, v + ov);
  if (t === 'BoxGeometry') {
    const { width: W, height: H, depth: D } = P;
    const ws = P.widthSegments || 1, hs = P.heightSegments || 1, ds = P.depthSegments || 1;
    const faces = [[D, H, (ds + 1) * (hs + 1)], [D, H, (ds + 1) * (hs + 1)], [W, D, (ws + 1) * (ds + 1)],
      [W, D, (ws + 1) * (ds + 1)], [W, H, (ws + 1) * (hs + 1)], [W, H, (ws + 1) * (hs + 1)]];
    let i = 0;
    for (const [U, V, cnt] of faces) {
      const swap = U > V;
      for (let k = 0; k < cnt && i < n; k++, i++) {
        const u = uv.getX(i) * U, v = uv.getY(i) * V;
        if (swap) set(i, v, u); else set(i, u, v);
      }
    }
  } else if (t === 'CylinderGeometry' || t === 'ConeGeometry') {
    const rt = P.radiusTop ?? 0, rb = P.radiusBottom ?? P.radius ?? 0.1, h = P.height;
    const rs = P.radialSegments, hs = P.heightSegments, th = P.thetaLength ?? TAU_;
    const torso = (rs + 1) * (hs + 1), ra = Math.max(0.004, (rt + rb) / 2), rm = Math.max(rt, rb);
    for (let i = 0; i < n; i++) {
      const u = uv.getX(i), v = uv.getY(i);
      if (i < torso) {
        if (strand) set(i, v * h / (TAU_ * ra), u);
        else set(i, u * th * ra, v * h);
      } else set(i, (u - 0.5) * 2 * rm, (v - 0.5) * 2 * rm);
    }
  } else if (t === 'LatheGeometry') {
    const pts = P.points; let L = 0, rmax = 0;
    for (let k = 1; k < pts.length; k++) L += pts[k].distanceTo(pts[k - 1]);
    for (const p of pts) rmax = Math.max(rmax, p.x);
    const ph = P.phiLength ?? TAU_;
    for (let i = 0; i < n; i++) set(i, uv.getX(i) * ph * rmax, uv.getY(i) * L);
  } else if (t === 'TorusGeometry') {
    const R = P.radius, r = P.tube, arc = P.arc ?? TAU_;
    for (let i = 0; i < n; i++) {
      const u = uv.getX(i), v = uv.getY(i);
      if (strand) set(i, u * arc * R / (TAU_ * r), v);
      else set(i, u * arc * R, v * TAU_ * r);
    }
  } else if (t === 'TubeGeometry') {
    const r = P.radius, L = P.path.getLength();
    for (let i = 0; i < n; i++) {
      const u = uv.getX(i), v = uv.getY(i);
      if (strand) set(i, u * L / (TAU_ * r), v);
      else set(i, v * TAU_ * r, u * L);
    }
  } else if (t === 'SphereGeometry') {
    const r = P.radius, ph = P.phiLength ?? TAU_, th = P.thetaLength ?? Math.PI;
    for (let i = 0; i < n; i++) set(i, uv.getX(i) * ph * r, uv.getY(i) * th * r);
  } else if (t === 'CircleGeometry') {
    const r = P.radius;
    for (let i = 0; i < n; i++) set(i, (uv.getX(i) - 0.5) * 2 * r, (uv.getY(i) - 0.5) * 2 * r);
  } else if (g.userData.prism) {
    const { perim, l, side } = g.userData.prism;
    for (let i = 0; i < n; i++) {
      if (i < side) set(i, uv.getX(i) * perim, uv.getY(i) * l);
      else set(i, uv.getX(i), uv.getY(i));             // caps are already metric (x, y)
    }
  } else if (g.userData.metricDone) {
    for (let i = 0; i < n; i++) set(i, uv.getX(i), uv.getY(i));
  }
  uv.needsUpdate = true;
  return g;
}

// ---- profile prisms -----------------------------------------------------------------
// A straight prism extruded along +Z from a closed 2D loop (x = width axis, y = height
// axis), with flat per-face normals, UVs (u around the loop, v along the length) and end
// caps. Indexed, with the same attribute set as the built-in primitives, so it merges
// into the same buckets. `segZ` puts vertex rows along the length so weather() has
// something to vary per-board, not just per-end.
export function profilePrism(loop, l, segZ = 2, segFor = null) {
  const nL = loop.length, hz = l / 2;
  const pos = [], nrm = [], uv = [], idx = [];
  // perimeter-true u so metric UVs keep the texture square on every face
  const cum = [0];
  for (let e = 0; e < nL; e++) {
    const [x0, y0] = loop[e], [x1, y1] = loop[(e + 1) % nL];
    cum.push(cum[e] + Math.hypot(x1 - x0, y1 - y0));
  }
  const perim = cum[nL];
  // side faces: one strip per edge (flat normal), segZ quads along the length. `segFor`
  // (edge index -> rows) lets the faces that are actually seen carry more rows than the
  // hidden underside, which is what the deck's baked grime needs to resolve.
  for (let e = 0; e < nL; e++) {
    const [x0, y0] = loop[e], [x1, y1] = loop[(e + 1) % nL];
    const ex = y1 - y0, ey = x0 - x1;                    // outward normal of the edge
    const el = Math.hypot(ex, ey) || 1, nx = ex / el, ny = ey / el;
    const base = pos.length / 3, sz = segFor ? segFor(e) : segZ;
    for (let s = 0; s <= sz; s++) {
      const z = -hz + l * s / sz, v = s / sz;
      pos.push(x0, y0, z, x1, y1, z);
      nrm.push(nx, ny, 0, nx, ny, 0);
      uv.push(cum[e] / perim, v, cum[e + 1] / perim, v);
    }
    for (let s = 0; s < sz; s++) {
      const a = base + s * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const side = pos.length / 3;
  // end caps: triangle fans about the loop centroid
  let cx = 0, cy = 0;
  for (const [x, y] of loop) { cx += x / nL; cy += y / nL; }
  for (const sgn of [-1, 1]) {
    const z = sgn * hz, base = pos.length / 3;
    pos.push(cx, cy, z); nrm.push(0, 0, sgn); uv.push(cx, cy);
    for (const [x, y] of loop) { pos.push(x, y, z); nrm.push(0, 0, sgn); uv.push(x, y); }
    for (let e = 0; e < nL; e++) {
      const a = base + 1 + e, b = base + 1 + (e + 1) % nL;
      if (sgn > 0) idx.push(base, a, b); else idx.push(base, b, a);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.userData.prism = { perim, l, side };
  return g;
}

// A deck board with eased edges: an 8-vertex-loop prism, top corners chamfered `c` and
// the bottom corners eased a hair, so every seam catches a real specular line instead of
// the painted-on grid a bare box gives. Length runs along Z like box(w,h,l).
export function chamferedPlank(w, h, l, c = 0.012, rows = 2) {
  const hw = w / 2, hh = h / 2, cc = Math.min(c, hw * 0.4, hh * 0.9), cb = cc * 0.5;
  // edges 3..5 are chamfer, top, chamfer: the faces a boot and an eye actually meet
  return profilePrism([
    [-hw + cb, -hh], [hw - cb, -hh], [hw, -hh + cb], [hw, hh - cc],
    [hw - cc, hh], [-hw + cc, hh], [-hw, hh - cc], [-hw, -hh + cb]
  ], l, 2, e => (e >= 3 && e <= 5) ? rows : 1);
}

// ---- wear ---------------------------------------------------------------------------
// Bake grime into vertex colours rather than textures, so dirt lands on the geometry
// that actually exists. `wetY` is the local height of the waterline: everything under it
// darkens and greens the way a boot-top does, with a soft band for the swell.
//
// opts: tone (base brightness), freq/amp (grime noise), wetY, wetBand, wetTint [r,g,b].
export function weather(geo, opts = {}) {
  const { tone = 1, freq = 0.55, amp = 0.20, wetY = null, wetBand = 0.30,
    wetTint = [0.42, 0.50, 0.38], rust = 0 } = opts;
  const pos = geo.attributes.position, n = pos.count;
  const col = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    let st = 0.5;
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const a = fbm(x * freq + 7.3, z * freq + 2.1) - 0.5;
    const b = fbm(y * freq * 2.3 + 19.7, (x + z) * freq * 1.4 + 5.5) - 0.5;
    const g = clamp(tone * (1 + (a * 1.15 + b * 0.7) * amp * 2), 0.30, 1.25);
    let r = g, gg = g * 0.985, bb = g * 0.965;
    // the grime field also varies the surface state: dirtier = drier and rougher, so no
    // part renders at a single roughness value
    st += (a * 1.15 + b * 0.7) * 0.30;
    if (rust > 0) {
      // oxide blooms where the grime field is high, so streaks follow the same field
      const k = clamp((fbm(x * 1.7 + 31.1, (y + z) * 1.7 + 13.3) - 0.42) * 3.4, 0, 1) * rust;
      r += k * 0.55; gg += k * 0.20; bb -= k * 0.10;
      st += k * 0.38;                                   // oxide is rough and dull
    }
    if (wetY !== null) {
      const w = clamp((wetY + wetBand - y) / (wetBand * 2), 0, 1);
      // slime line: strongest right at the band, darker still below it
      const slime = w * w * (1 - w) * 4;
      r = r * (1 - w * 0.52) + wetTint[0] * slime * 0.55;
      gg = gg * (1 - w * 0.44) + wetTint[1] * slime * 0.62;
      bb = bb * (1 - w * 0.46) + wetTint[2] * slime * 0.42;
      // rust blooms hardest at water contact (the splash zone just above the band),
      // then the band itself is wet and slick
      if (rust > 0) {
        const splash = clamp(1 - Math.abs(y - (wetY + wetBand * 1.1)) / (wetBand * 1.2), 0, 1) * rust;
        r += splash * 0.30; gg += splash * 0.08; bb -= splash * 0.06; st += splash * 0.25;
      }
      st -= w * 0.34 + slime * 0.10;
    }
    col[i * 4] = clamp(r, 0, 1.4); col[i * 4 + 1] = clamp(gg, 0, 1.4); col[i * 4 + 2] = clamp(bb, 0, 1.4);
    col[i * 4 + 3] = clamp(st, 0.02, 0.98);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
  return geo;
}

// Flat tint, for parts that want to sit in a merged bucket with weathered ones.
export function tint(geo, r, g = r, b = r, st = 0.5) {
  const n = geo.attributes.position.count, col = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { col[i * 4] = r; col[i * 4 + 1] = g; col[i * 4 + 2] = b; col[i * 4 + 3] = st; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
  return geo;
}

// ---- fittings -----------------------------------------------------------------------
// Fastener heads are where iron rusts first: the seam round a head holds water. Each
// head gets its own deterministic share of oxide (colour + dull, rough state), so a
// line of rivets reads as a line of individual rivets, not a stamped pattern.
const _fh = (x, y, z) => { const h = Math.sin(x * 91.7 + y * 47.3 + z * 23.9) * 43758.5453; return h - Math.floor(h); };
export function rustHead(g, x, y, z, k = 1) {
  const r = _fh(x, y, z), o = (0.25 + 0.75 * r) * k;
  return tint(g, 1 + o * 0.95, 1 + o * 0.12, 1 - o * 0.30, 0.5 + o * 0.38);
}

// A ring of bolt/rivet heads on a plate. `axis` is 'x' | 'y' | 'z' (the plate normal).
export function rivetRing(P, mat, n, cx, cy, cz, r, rad = 0.03, axis = 'z', phase = 0.5, w = 6, h = 4) {
  const g = sph(rad, w, h);
  for (let i = 0; i < n; i++) {
    const a = (i + phase) / n * TAU, c = Math.cos(a) * r, s = Math.sin(a) * r;
    let q;
    if (axis === 'z') q = xf(g.clone(), cx + c, cy + s, cz);
    else if (axis === 'y') q = xf(g.clone(), cx + c, cy, cz + s);
    else q = xf(g.clone(), cx, cy + c, cz + s);
    if (!mat.userData.brass) rustHead(q, cx + c, cy + s, cz + i);
    P.add(q, mat);
  }
}

// A line of bolt heads — iron strapping, plate seams, hull fastenings. `w,h` are the
// dome tessellation, so nail heads can be cheaper than bolt heads. Pass hex=true for
// manufactured through-bolts: a six-flat head on a washer instead of a dome rivet.
export function boltLine(P, mat, x0, y0, z0, x1, y1, z1, n, rad = 0.032, w = 6, h = 4, hex = false, halo = false) {
  const g = hex ? null : sph(rad, w, h);
  for (let i = 0; i < n; i++) {
    const u = n === 1 ? 0.5 : i / (n - 1);
    const x = x0 + (x1 - x0) * u, y = y0 + (y1 - y0) * u, z = z0 + (z1 - z0) * u;
    if (hex) hexBolt(P, mat, x, y, z, rad, 0, halo);
    else P.add(mat.userData.brass ? xf(g.clone(), x, y, z) : rustHead(xf(g.clone(), x, y, z), x, y, z), mat);
  }
}

// A hex-head through-bolt seated on its washer, head up (+Y). Dome rivets stay rivets —
// this is for the fastenings a spanner has actually been on.
// `halo` lays a rust bloom on the plate under it: a flush 16-sided disc whose centre is
// oxide-orange and dull, fading at the rim back to the plate's own grey-iron state, so
// the stain reads as bleeding OUT of the seam rather than as a sticker. Iron plates only
// (on timber the deck map does this job).
export function hexBolt(P, mat, x, y, z, rad = 0.032, ry = 0, halo = false) {
  P.add(rustHead(xf(cyl(rad * 1.55, rad * 1.55, rad * 0.5, 12), x, y + rad * 0.25, z), x, y, z, 1.2), mat);      // washer
  // the head: a spanner has been on its flats, so the top is brighter than the washer
  const hd = rustHead(xf(cyl(rad * 0.92, rad * 1.0, rad * 1.15, 6), x, y + rad * 0.9, z, 0, ry), x + 1, y, z, 0.6);
  state(hd, (i, hx, hy) => hy > y + rad * 1.4 ? -0.18 : 0);
  P.add(hd, mat);
  if (halo) {
    const d = new THREE.CircleGeometry(rad * 3.2, 16).rotateX(-Math.PI / 2);
    xf(d, x, y + 0.0015, z, 0, _fh(x, z, y) * 6.28);
    const dp = d.attributes.position, n = dp.count, c = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const dx = dp.getX(i) - x, dz = dp.getZ(i) - z, rim = Math.hypot(dx, dz) > 1e-5;
      // uneven edge: the bloom runs further one way (the way the water sits)
      if (rim) {
        const a = Math.atan2(dz, dx), sc = 0.72 + 0.55 * _fh(Math.cos(a) * 3 + x, Math.sin(a) * 3 + z, y);
        dp.setX(i, x + dx * sc); dp.setZ(i, z + dz * sc);
      }
      const o = rim ? 0 : 1, t = rim ? 0.92 : 1;
      c[i * 4] = t * (1 + o * 1.25); c[i * 4 + 1] = t * (1 + o * 0.15); c[i * 4 + 2] = t * (1 - o * 0.35); c[i * 4 + 3] = 0.5 + o * 0.45;
    }
    d.setAttribute('color', new THREE.BufferAttribute(c, 4));
    P.add(d, mat);
  }
}

// BRASS WEAR for a wheel/ring in the XY plane about (cx, cy): the rim's outside and
// face are where hands and belts polish it bright and slick; the inside of the rim and
// the spoke roots near the hub hold dark, dry tarnish. `R` is the wheel radius.
export function brassWear(g, cx, cy, R) {
  rgba(g);
  const p = g.attributes.position, nr = g.attributes.normal, c = g.attributes.color;
  for (let i = 0; i < p.count; i++) {
    const dx = p.getX(i) - cx, dy = p.getY(i) - cy, r = Math.hypot(dx, dy) || 1;
    const out = (nr.getX(i) * dx + nr.getY(i) * dy) / r;          // + faces outward
    const face = Math.abs(nr.getZ(i));
    let pol = Math.max(0, out) * 0.9 + face * 0.35 * Math.min(1, r / R);
    let tar = Math.max(0, -out) * 0.8 + Math.max(0, 1 - r / (R * 0.45)) * 0.7;
    const k = Math.max(-1, Math.min(1, pol - tar));
    const cr = c.getX(i), cg = c.getY(i), cb = c.getZ(i);
    if (k > 0) c.setXYZW(i, cr * (1 + k * 0.22), cg * (1 + k * 0.20), cb * (1 + k * 0.12), 0.5 - k * 0.38);
    else c.setXYZW(i, cr * (1 + k * 0.45), cg * (1 + k * 0.40), cb * (1 + k * 0.30), 0.5 - k * 0.40);
  }
  return g;
}

// General brass: tarnish settles where a part faces down or away from hands (lower
// hemisphere of the normal), bright where it faces up and out.
export function brassPatina(g, k = 1) {
  rgba(g);
  const nr = g.attributes.normal, c = g.attributes.color, p = g.attributes.position;
  for (let i = 0; i < nr.count; i++) {
    const up = nr.getY(i), n = _fh(p.getX(i) * 7, p.getY(i) * 7, p.getZ(i) * 7) - 0.5;
    const t = Math.max(-1, Math.min(1, (-up * 0.55 + n * 0.9 + 0.25) * k));
    c.setXYZW(i, c.getX(i) * (1 - t * 0.30), c.getY(i) * (1 - t * 0.26), c.getZ(i) * (1 - t * 0.12), 0.5 + t * 0.35);
  }
  return g;
}

// A run of rope/chain/hose through space. Points are [x,y,z] triples.
export function rope(P, mat, pts, rad = 0.03, seg = null, closed = false, radial = 5) {
  const c = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p[0], p[1], p[2])), closed);
  return P.add(new THREE.TubeGeometry(c, seg || Math.max(8, pts.length * 3), rad, radial, closed), mat);
}

// A rope coiled flat on the deck: the single most legible "this is a working boat" prop.
export function coil(P, mat, cx, cy, cz, r0, turns = 3, rad = 0.035, drop = 0.055) {
  const pts = [];
  const steps = Math.ceil(turns * 12);
  for (let i = 0; i <= steps; i++) {
    const u = i / steps, a = u * turns * TAU, r = r0 - u * r0 * 0.34;
    pts.push([cx + Math.cos(a) * r, cy + u * drop, cz + Math.sin(a) * r]);
  }
  return rope(P, mat, pts, rad, steps * 2);
}

// Rope lashed round something — a few tight turns, used on drums, spars and bitts.
export function lash(P, mat, cx, cy, cz, r, axis = 'x', turns = 3, rad = 0.022, pitch = 0.05, radial = 5) {
  const pts = [], steps = Math.ceil(turns * 10);
  for (let i = 0; i <= steps; i++) {
    const u = i / steps, a = u * turns * TAU, o = (u - 0.5) * turns * pitch;
    const c = Math.cos(a) * r, s = Math.sin(a) * r;
    if (axis === 'x') pts.push([cx + o, cy + c, cz + s]);
    else if (axis === 'y') pts.push([cx + c, cy + o, cz + s]);
    else pts.push([cx + c, cy + s, cz + o]);
  }
  return rope(P, mat, pts, rad, steps * 2, false, radial);
}

// A staved timber cask/barrel: lathe body plus iron hoops. Returns nothing; files itself.
// Hoop tori KEEP radial 4 — square-section wrought-iron hoop stock is period-correct.
export function barrel(P, woodMat, ironMat, x, y, z, r = 0.42, h = 1.0, ry = 0) {
  const b = h / 2;
  P.add(xf(lathe([[r * 0.80, -b], [r * 0.97, -b * 0.55], [r, 0], [r * 0.97, b * 0.55],
    [r * 0.80, b], [0, b]], 20), x, y, z, 0, ry, 0), woodMat);
  P.add(xf(cyl(r * 0.80, r * 0.80, 0.02, 20), x, y - b + 0.01, z), woodMat);
  for (const hy of [-b * 0.78, -b * 0.30, b * 0.30, b * 0.78]) {
    const rr = r * (1 - Math.abs(hy / b) * 0.20) + 0.012;
    P.add(xf(tor(rr, 0.026, 4, 20), x, y + hy, z, Math.PI / 2), ironMat);
  }
}

// A short flight of rungs between two stringers — boarding ladder, bench steps.
export function ladder(P, mat, x, y, z, w, h, rungs, ry = 0, tilt = 0, rad = 0.035) {
  for (const s of [-1, 1]) {
    P.add(xf(cyl(rad, rad, h, 6), x + Math.cos(ry) * s * w / 2, y + h / 2,
      z - Math.sin(ry) * s * w / 2, tilt, ry, 0), mat);
  }
  for (let i = 0; i < rungs; i++) {
    const ry0 = (i + 0.5) / rungs * h;
    P.add(xf(cyl(rad * 0.8, rad * 0.8, w, 6), x - Math.sin(tilt) * ry0, y + ry0 * Math.cos(tilt),
      z - Math.sin(tilt) * ry0 * 0.0, 0, ry, Math.PI / 2), mat);
  }
}
