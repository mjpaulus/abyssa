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
export const sph = (r, w = 8, h = 6) => new THREE.SphereGeometry(r, w, h);
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
        // merging demands identical attribute sets: pad plain primitives that got mixed
        // in with weathered ones carrying vertex colours.
        if (mat.vertexColors || list.some(g => g.attributes.color)) {
          for (const g of list) if (!g.attributes.color) {
            g.setAttribute('color', new THREE.BufferAttribute(
              new Float32Array(g.attributes.position.count * 3).fill(1), 3));
          }
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
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const a = fbm(x * freq + 7.3, z * freq + 2.1) - 0.5;
    const b = fbm(y * freq * 2.3 + 19.7, (x + z) * freq * 1.4 + 5.5) - 0.5;
    const g = clamp(tone * (1 + (a * 1.15 + b * 0.7) * amp * 2), 0.30, 1.25);
    let r = g, gg = g * 0.985, bb = g * 0.965;
    if (rust > 0) {
      // oxide blooms where the grime field is high, so streaks follow the same field
      const k = clamp((fbm(x * 1.7 + 31.1, (y + z) * 1.7 + 13.3) - 0.42) * 3.4, 0, 1) * rust;
      r += k * 0.55; gg += k * 0.20; bb -= k * 0.10;
    }
    if (wetY !== null) {
      const w = clamp((wetY + wetBand - y) / (wetBand * 2), 0, 1);
      // slime line: strongest right at the band, darker still below it
      const slime = w * w * (1 - w) * 4;
      r = r * (1 - w * 0.52) + wetTint[0] * slime * 0.55;
      gg = gg * (1 - w * 0.44) + wetTint[1] * slime * 0.62;
      bb = bb * (1 - w * 0.46) + wetTint[2] * slime * 0.42;
    }
    col[i * 3] = clamp(r, 0, 1.4); col[i * 3 + 1] = clamp(gg, 0, 1.4); col[i * 3 + 2] = clamp(bb, 0, 1.4);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

// Flat tint, for parts that want to sit in a merged bucket with weathered ones.
export function tint(geo, r, g = r, b = r) {
  const n = geo.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = b; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

// ---- fittings -----------------------------------------------------------------------
// A ring of bolt/rivet heads on a plate. `axis` is 'x' | 'y' | 'z' (the plate normal).
export function rivetRing(P, mat, n, cx, cy, cz, r, rad = 0.03, axis = 'z', phase = 0.5) {
  const g = sph(rad, 6, 4);
  for (let i = 0; i < n; i++) {
    const a = (i + phase) / n * TAU, c = Math.cos(a) * r, s = Math.sin(a) * r;
    if (axis === 'z') P.add(xf(g.clone(), cx + c, cy + s, cz), mat);
    else if (axis === 'y') P.add(xf(g.clone(), cx + c, cy, cz + s), mat);
    else P.add(xf(g.clone(), cx, cy + c, cz + s), mat);
  }
}

// A line of bolt heads — iron strapping, plate seams, hull fastenings.
export function boltLine(P, mat, x0, y0, z0, x1, y1, z1, n, rad = 0.032) {
  const g = sph(rad, 6, 4);
  for (let i = 0; i < n; i++) {
    const u = n === 1 ? 0.5 : i / (n - 1);
    P.add(xf(g.clone(), x0 + (x1 - x0) * u, y0 + (y1 - y0) * u, z0 + (z1 - z0) * u), mat);
  }
}

// A run of rope/chain/hose through space. Points are [x,y,z] triples.
export function rope(P, mat, pts, rad = 0.03, seg = null, closed = false) {
  const c = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p[0], p[1], p[2])), closed);
  return P.add(new THREE.TubeGeometry(c, seg || Math.max(8, pts.length * 3), rad, 5, closed), mat);
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
export function lash(P, mat, cx, cy, cz, r, axis = 'x', turns = 3, rad = 0.022, pitch = 0.05) {
  const pts = [], steps = Math.ceil(turns * 10);
  for (let i = 0; i <= steps; i++) {
    const u = i / steps, a = u * turns * TAU, o = (u - 0.5) * turns * pitch;
    const c = Math.cos(a) * r, s = Math.sin(a) * r;
    if (axis === 'x') pts.push([cx + o, cy + c, cz + s]);
    else if (axis === 'y') pts.push([cx + c, cy + o, cz + s]);
    else pts.push([cx + c, cy + s, cz + o]);
  }
  return rope(P, mat, pts, rad, steps * 2);
}

// A staved timber cask/barrel: lathe body plus iron hoops. Returns nothing; files itself.
export function barrel(P, woodMat, ironMat, x, y, z, r = 0.42, h = 1.0, ry = 0) {
  const b = h / 2;
  P.add(xf(lathe([[r * 0.80, -b], [r * 0.97, -b * 0.55], [r, 0], [r * 0.97, b * 0.55],
    [r * 0.80, b], [0, b]], 14), x, y, z, 0, ry, 0), woodMat);
  P.add(xf(cyl(r * 0.80, r * 0.80, 0.02, 14), x, y - b + 0.01, z), woodMat);
  for (const hy of [-b * 0.78, -b * 0.30, b * 0.30, b * 0.78]) {
    const rr = r * (1 - Math.abs(hy / b) * 0.20) + 0.012;
    P.add(xf(tor(rr, 0.026, 4, 14), x, y + hy, z, Math.PI / 2), ironMat);
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
