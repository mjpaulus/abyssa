// VELKATH ON THE GROUND (roadmap/brooder-ground-plume.md). Owner, 2026-10-03: "the crab
// creature is sinking into the sand and passes through other objects, when its claw smacks
// down it goes beyond the floor."
//
// Measured before this file (standing, zone 0): the shell's sole up to 1.9 u under the
// floor (she stood on the MEAN of her planted feet, so a hump between her feet came up
// through her belly), the crusher 6-14 u under it at guard and on the hammer (the arm pose
// is pure joint angles with no idea where the floor is), feet floating up to 2.8 u on
// steep ground (the foot was placed out of the leg's reach and the IK let it slide) and
// biting 1.3 u in while folded (the dactyl's thick base lies flat). And nothing she did
// knew the world's rocks or wrecks existed.
//
// Everything here reads the colliders the game already has (flora's rockColliders, the
// wrecks, the vents, props: {x,y,z,r} spheres, the same lists player.js pushes Sal out of)
// through ONE per-frame near list, and the terrain. Zero per-frame allocation: fixed
// scratch, fixed arrays.
import { terrainH } from '../../world/terrain.js';
import { rockColliders } from '../../world/flora.js';
import { wreckColliders } from '../../world/wrecks.js';
import { ventColliders } from '../../world/vents.js';
import { propColliders } from '../../world/props.js';

const NEAR_MAX = 160;
const near = new Array(NEAR_MAX).fill(null);
const nearBlock = new Uint8Array(NEAR_MAX), nearTall = new Uint8Array(NEAR_MAX);
let nearN = 0;
// a collider whose top stands this far (x R, ~6.5 u) over the floor is something she walks
// AROUND; anything lower she steps on and rides over (her sole lifts onto it)
export const BLOCK_H = 0.42;
export const BODY_RH = 0.86;            // her horizontal body radius in R (the shell is ~1.0 wide, ~1.1 long, the rim is skirted plates)

// Gather the colliders within `rad` of (x, z) and within the zone's height band.
export function buildNear(L, rad) {
  nearN = 0;
  const px = L.pos.x, pz = L.pos.z, gy = terrainH(px, pz, L.idx), R = L.R;
  for (let list = 0; list < 4; list++) {
    const cols = list === 0 ? rockColliders : list === 1 ? wreckColliders : list === 2 ? ventColliders : propColliders;
    for (let k = 0; k < cols.length && nearN < NEAR_MAX; k++) {
      const c = cols[k], rr = rad + c.r;
      const dx = c.x - px; if (dx > rr || dx < -rr) continue;
      const dz = c.z - pz; if (dz > rr || dz < -rr) continue;
      if (c.y > gy + 60 || c.y < gy - 60) continue;          // another zone's floor
      if (dx * dx + dz * dz > rr * rr) continue;
      near[nearN] = c;
      // wrecks always block (hulls are walls); rocks and the rest by their height, unless she
      // is CLIMBING (brooder.js: boxed in by boulders she cannot get round, she goes over)
      nearTall[nearN] = list !== 1 && c.y + c.r - terrainH(c.x, c.z, L.idx) > BLOCK_H * R ? 1 : 0;
      nearBlock[nearN] = list === 1 || (!(L.climbT > 0) && nearTall[nearN]) ? 1 : 0;
      nearN++;
    }
  }
  return nearN;
}
export function nearCount() { return nearN; }

// The ground she stands on at x, z: the floor, or the top of a rock/hull under that point.
// `skipBlock`: ignore the blocking colliders' tops (a foot placed beside a wreck must not
// "stand" on the hull's bounding sphere 8 u up).
export function groundAt(L, x, z, skipBlock) {
  let h = terrainH(x, z, L.idx);
  for (let k = 0; k < nearN; k++) {
    if (skipBlock && nearBlock[k]) continue;
    const c = near[k], dx = x - c.x, dz = z - c.z, d2 = dx * dx + dz * dz, r2 = c.r * c.r;
    if (d2 >= r2) continue;
    const top = c.y + Math.sqrt(r2 - d2);
    if (top > h) h = top;
  }
  return h;
}

// A foot target: out of any blocking collider (moved to just beside it), then grounded.
export function placeFoot(L, out) {
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 0; k < nearN; k++) {
      if (!nearBlock[k]) continue;
      const c = near[k], dx = out.x - c.x, dz = out.z - c.z, d2 = dx * dx + dz * dz;
      // horizontal radius of the sphere at the floor's height there
      const fy = terrainH(out.x, out.z, L.idx), hy = fy - c.y, hr2 = c.r * c.r - hy * hy;
      if (hr2 <= 0) continue;
      const hr = Math.sqrt(hr2) + 0.6;
      if (d2 >= hr * hr) continue;
      const d = Math.sqrt(d2) || 1e-3;
      out.x = c.x + dx / d * hr; out.z = c.z + dz / d * hr;
    }
  }
  out.y = groundAt(L, out.x, out.z, true);
  return out;
}

// Push the body (a horizontal circle at L.pos) out of every blocking collider and take the
// inward part out of her velocity, so she slides along a hull instead of through it.
// Returns the total push this frame (probe).
export function pushOut(L, dt) {
  const R = L.R, br = BODY_RH * R;
  let tot = 0;
  for (let k = 0; k < nearN; k++) {
    if (!nearBlock[k]) continue;
    const c = near[k], rr = br + c.r * 0.9;
    const dx = L.pos.x - c.x, dz = L.pos.z - c.z, d2 = dx * dx + dz * dz;
    if (d2 >= rr * rr) continue;
    const d = Math.sqrt(d2) || 1e-3, nx = dx / d, nz = dz / d, pen = rr - d;
    // most of it at once (she must never stand IN a hull), the rest next frame
    const p = pen * Math.min(1, 10 * dt);
    L.pos.x += nx * p; L.pos.z += nz * p;
    tot += p;
    const vin = L.vel.x * nx + L.vel.z * nz;
    if (vin < 0) { L.vel.x -= nx * vin; L.vel.z -= nz * vin; }
  }
  return tot;
}

// Still over a tall rock (a climb is not over until she is off it)?
export function overTall(L) {
  const br = BODY_RH * L.R;
  for (let k = 0; k < nearN; k++) {
    if (!nearTall[k]) continue;
    const c = near[k], rr = br + c.r * 0.9;
    if ((L.pos.x - c.x) ** 2 + (L.pos.z - c.z) ** 2 < rr * rr) return true;
  }
  return false;
}

// Steering: bend a wanted heading round the blocking colliders ahead (a tangent push on
// the side she was already going, plus a little straight away from it).
// `side` (+1/-1) is sticky: brooder.js flips it when she stops making headway (two rocks
// either side of her line make a pocket a potential field can sit in).
export function steer(L, want, side = 0) {
  const R = L.R, br = BODY_RH * R, look = 1.2 * R;
  let dx = Math.sin(want), dz = Math.cos(want), any = false;
  for (let k = 0; k < nearN; k++) {
    if (!nearBlock[k]) continue;
    const c = near[k], rx = c.x - L.pos.x, rz = c.z - L.pos.z, d = Math.hypot(rx, rz) || 1e-3;
    const gap = d - br - c.r * 0.9;
    if (gap > look) continue;
    const ahead = (rx * Math.sin(want) + rz * Math.cos(want)) / d;
    if (ahead < -0.2) continue;                                   // behind her
    const w = Math.min(1.5, 1 - gap / look) * (0.4 + 0.6 * Math.max(0, ahead));
    let tx = rz / d, tz = -rx / d;                                // tangent
    if (side ? side < 0 : tx * dx + tz * dz < 0) { tx = -tx; tz = -tz; }
    dx += (tx * 1.1 - rx / d * 0.4) * w;
    dz += (tz * 1.1 - rz / d * 0.4) * w;
    any = true;
  }
  return any ? Math.atan2(dx, dz) : want;
}

// ---- geometry probes (built once per body/claw install) ---------------------------------
// The SOLE: the lowest vertex of the shell in each cell of a grid over its plan, in body
// space. Posing tests these against the ground, so the belly can never go under it.
export function soleFromGeos(geos, n = 11) {
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const g of geos) {
    const P = g.attributes.position.array;
    for (let i = 0; i < P.length; i += 3) {
      if (P[i] < x0) x0 = P[i]; if (P[i] > x1) x1 = P[i];
      if (P[i + 2] < z0) z0 = P[i + 2]; if (P[i + 2] > z1) z1 = P[i + 2];
    }
  }
  const low = new Float32Array(n * n * 3).fill(NaN);
  for (const g of geos) {
    const P = g.attributes.position.array;
    for (let i = 0; i < P.length; i += 3) {
      const cx = Math.min(n - 1, ((P[i] - x0) / (x1 - x0) * n) | 0), cz = Math.min(n - 1, ((P[i + 2] - z0) / (z1 - z0) * n) | 0);
      const o = (cz * n + cx) * 3;
      if (!(P[i + 1] >= low[o + 1])) { low[o] = P[i]; low[o + 1] = P[i + 1]; low[o + 2] = P[i + 2]; }
    }
  }
  const pts = [];
  for (let i = 0; i < n * n; i++) if (low[i * 3 + 1] === low[i * 3 + 1]) pts.push(low[i * 3], low[i * 3 + 1], low[i * 3 + 2]);
  // ...and the RIM: per bearing, the outermost vertex of the lower half. A cell's lowest
  // vertex can sit inboard of its edge, and where the floor rises outside her (a crest, the
  // rift's rim) it is the edge that meets it first.
  const B = 48, rim = new Float32Array(B * 4).fill(-1);
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  for (const g of geos) {
    const P = g.attributes.position.array;
    for (let i = 0; i < P.length; i += 3) {
      if (P[i + 1] > 0.0) continue;
      const dx = P[i] - cx, dz = P[i + 2] - cz, r = dx * dx + dz * dz;
      const b = Math.min(B - 1, ((Math.atan2(dz, dx) / (2 * Math.PI) + 0.5) * B) | 0);
      if (r > rim[b * 4 + 3]) { rim[b * 4] = P[i]; rim[b * 4 + 1] = P[i + 1]; rim[b * 4 + 2] = P[i + 2]; rim[b * 4 + 3] = r; }
    }
  }
  for (let b = 0; b < B; b++) if (rim[b * 4 + 3] > 0) pts.push(rim[b * 4], rim[b * 4 + 1], rim[b * 4 + 2]);
  return new Float32Array(pts);
}

// A limb piece's hull samples: along its bone (local X) in `bins` slices, the extreme
// vertices in +-Y and +-Z of each slice, in the mesh's own space (the mesh's scale is part
// of its matrixWorld, so these stay right after a rescale).
// minX: skip the piece behind its own joint (the merus root is buried in her shell, and
// lifting the arm swings it DOWN: it would make every lift look like it needs more).
export function hullSamples(g, bins = 7, minX = -1e9) {
  const P = g.attributes.position.array;
  let x0 = 1e9, x1 = -1e9;
  for (let i = 0; i < P.length; i += 3) { if (P[i] < minX) continue; if (P[i] < x0) x0 = P[i]; if (P[i] > x1) x1 = P[i]; }
  const E = 8, best = new Float32Array(bins * E * 4).fill(NaN);    // per bin: 8 extremes x (x,y,z,score)
  for (let i = 0; i < P.length; i += 3) {
    if (P[i] < minX) continue;
    const b = Math.min(bins - 1, ((P[i] - x0) / (x1 - x0 || 1) * bins) | 0), y = P[i + 1], z = P[i + 2];
    const sc = [y, -y, z, -z, y + z, -y - z, y - z, z - y];
    for (let e = 0; e < E; e++) {
      const o = (b * E + e) * 4;
      if (!(sc[e] <= best[o + 3])) { best[o] = P[i]; best[o + 1] = P[i + 1]; best[o + 2] = P[i + 2]; best[o + 3] = sc[e]; }
    }
  }
  const pts = [];
  for (let i = 0; i < bins * E; i++) if (best[i * 4 + 3] === best[i * 4 + 3]) pts.push(best[i * 4], best[i * 4 + 1], best[i * 4 + 2]);
  return new Float32Array(pts);
}

// Deepest penetration of a point set (local to matrix m) under the ground, in world units.
// Positive = under. One terrain sample per point (terrainH is ~0.2 us).
export function penetration(L, pts, m, margin) {
  const e = m.elements;
  let worst = -1e9;
  for (let i = 0; i < pts.length; i += 3) {
    const x = pts[i], y = pts[i + 1], z = pts[i + 2];
    const wx = e[0] * x + e[4] * y + e[8] * z + e[12];
    const wy = e[1] * x + e[5] * y + e[9] * z + e[13];
    const wz = e[2] * x + e[6] * y + e[10] * z + e[14];
    const d = groundAt(L, wx, wz, false) + margin - wy;
    if (d > worst) worst = d;
  }
  return worst;
}
