// THE DECK IS NOT EMPTY. OWNED BY: orchestrator (raft collision, 2026-10-02).
//
// Michael: "seems like sal can walk through most items." Until now the only thing on deck
// that stopped him was the bulwark clamp in player.js; he waded through the pump, the
// reel, the chart table and the barrels. This is the footprint of everything solid that
// stands on the planks, in RAFT-LOCAL x/z (THE FRAME: deck top +0.11, footprint
// [-4.7, 4.7]), as 2D shapes a standing man's body circle is pushed out of:
//
//   box      centre, half extents, yaw  — crates, bench, pump block, the bulwark runs
//   capsule  a segment with a radius    — barrels and posts (a zero-length capsule is a
//                                          circle), gallows legs, guy wires, stool+coil
//
// Resolution is closest-point: the body is pushed out along the vector from the nearest
// point of the shape, and only the INWARD part of his velocity is removed, so he slides
// along a face and rounds a corner on a continuous normal — no snag on box corners, no
// flip-flop at a concave join (two passes settle those). Every shape is authored against
// the builder that owns the object (file named per line); move an object, move its line.
// Low things a boot steps over (ring bolts, pad eyes, plates, the flat ash scoop, the
// boat hook lying along the forward rail) are deliberately NOT here. Neither is anything
// above head height (the jib, the lantern, the tackle block).
//
// Module-load allocation only; resolveDeck() allocates nothing.
import { RIG_Z, LADDER_Z } from './davit.js';

export const DECK_BODY_R = 0.32;      // a dressed man's half-breadth at the shoulders
// The one gap in the bulwark: the +X rail, z in [LADDER_Z - GAP_HZ, LADDER_Z + GAP_HZ].
export const GAP_HZ = 1.20;
export { LADDER_Z };

export const DECK_COLLIDERS = [];
const C = DECK_COLLIDERS;
const box = (name, cx, cz, hx, hz, ang = 0) =>
  C.push({ k: 0, name, cx, cz, hx, hz, c: Math.cos(ang), s: Math.sin(ang) });
const cap = (name, ax, az, bx, bz, r) => C.push({ k: 1, name, ax, az, bx, bz, r });
const disc = (name, x, z, r) => cap(name, x, z, x, z, r);
// rig frame (davit.js: x athwart the gallows, +z outboard) -> raft x/z
const RX = (fx, fz) => fz, RZ = (fx, fz) => RIG_Z - fx;

// ---- hull.js: the bulwark. Inner face 4.61 (edge 4.70, wall 0.09). -----------------
const WI = 4.61, WT = 0.07, WC = WI + WT;
box('bulwark +Z', 0, WC, 4.75, WT);
box('bulwark -Z', 0, -WC, 4.75, WT);
box('bulwark -X', -WC, 0, WT, 4.75);
{
  const lo = LADDER_Z - GAP_HZ, hi = LADDER_Z + GAP_HZ;
  box('bulwark +X aft', WC, (-4.75 + lo) / 2, WT, (lo + 4.75) / 2);
  box('bulwark +X fwd', WC, (hi + 4.75) / 2, WT, (4.75 - hi) / 2);
}

// ---- davit.js: the gallows, forward of the gap on the +X side. ---------------------
for (const s of [-1, 1]) {
  // raked leg from its gusseted foot (frame s*1.30, z 3.75) toward the knee (s*1.25, 3.90)
  cap('gallows leg', RX(s * 1.30, 3.75), RZ(s * 1.30, 3.75), RX(s * 1.27, 3.86), RZ(s * 1.27, 3.86), 0.22);
  // tie rod, deck ring (s*1.30, 1.92) up to (s*1.20, 3.35) at y 2.10: only the run below
  // ~1.8 (a helmet's height) can meet him, so the capsule stops at frame z 3.12
  cap('gallows tie rod', RX(s * 1.30, 1.92), RZ(s * 1.30, 1.92), RX(s * 1.22, 3.12), RZ(s * 1.22, 3.12), 0.07);
}
// ---- raft.js buildReel, in the rig frame: drum centre (0, 0.60), cheeks r 0.70 at x
// +-0.46, standards at x +-0.60, crank out to 0.64.
box('hose reel', RX(0, 0.60), RZ(0, 0.60), 0.72, 0.68);

// ---- pump.js: the oil engine + compressor block, PUMP_POS (0.15, -1.20). -----------
box('pump', 0.22, -1.20, 1.36, 0.82);
// ---- gear.js ------------------------------------------------------------------------
box('pump servants', 0.06, -2.48, 0.78, 0.19);           // bucket, oil can, toolbox
disc('water butt', -1.20, -3.00, 0.50);
disc('bilge pump', -1.55, -4.12, 0.12);
disc('bitumen barrel A', 3.45, -2.85, 0.38);
disc('bitumen barrel B', 4.15, -3.55, 0.38);
cap('tapped barrel + can', 3.55, -4.12, 3.97, -4.12, 0.40);
disc('funnel', 3.15, -4.30, 0.17);
disc('hose stock', 3.95, -1.95, 0.42);
box('lashed cargo', -1.12, 3.72, 0.64, 0.68);             // crates, cask, tarp (KX/KZ)
for (const [x, z] of [[4.25, 4.25], [4.25, -4.25], [-4.25, 4.25], [-4.25, -4.25]]) disc('cleat', x, z, 0.13);

// ---- station.js: the dressing station, -X wing ---------------------------------------
box('dressing bench + tarpaulin', -4.13, -1.22, 0.27, 1.11);
cap('tender stool + spare line', -3.55, -1.10, -3.50, -0.85, 0.25);
cap('kicked-off boots', -3.86, -2.85, -3.66, -2.62, 0.17);
disc('helmet stand', -4.20, 0.90, 0.30);
box('slate rail', -4.46, 0.72, 0.08, 0.44);
// ---- shelf.js / chart.js --------------------------------------------------------------
box('keepsake shelf', -4.51, 1.42, 0.10, 0.70);
box('chart table', -4.00, 2.53, 0.40, 0.38);

// Push a body circle at raft-local (p.x, p.z) out of every shape; v (raft-local x/z
// velocity) loses only its inward component. Returns the number of contacts.
export function resolveDeck(p, v, R = DECK_BODY_R) {
  let hits = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < C.length; i++) {
      const o = C[i];
      let nx, nz, pen;
      if (o.k === 0) {
        const dx = p.x - o.cx, dz = p.z - o.cz;
        if (dx > o.hx + o.hz + R || dx < -(o.hx + o.hz + R) || dz > o.hx + o.hz + R || dz < -(o.hx + o.hz + R)) continue;
        const lx = dx * o.c + dz * o.s, lz = -dx * o.s + dz * o.c;
        const qx = lx < -o.hx ? -o.hx : lx > o.hx ? o.hx : lx;
        const qz = lz < -o.hz ? -o.hz : lz > o.hz ? o.hz : lz;
        const ex = lx - qx, ez = lz - qz, d2 = ex * ex + ez * ez;
        if (d2 >= R * R) continue;
        let ux, uz;
        if (d2 > 1e-10) { const d = Math.sqrt(d2); ux = ex / d; uz = ez / d; pen = R - d; }
        else {
          // centre inside the box (a teleport or a spawn): leave by the nearest face
          const px = o.hx - Math.abs(lx), pz = o.hz - Math.abs(lz);
          if (px < pz) { ux = lx < 0 ? -1 : 1; uz = 0; pen = px + R; }
          else { ux = 0; uz = lz < 0 ? -1 : 1; pen = pz + R; }
        }
        nx = ux * o.c - uz * o.s; nz = ux * o.s + uz * o.c;
      } else {
        const sx = o.bx - o.ax, sz = o.bz - o.az, l2 = sx * sx + sz * sz;
        let t = l2 > 1e-12 ? ((p.x - o.ax) * sx + (p.z - o.az) * sz) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = p.x - (o.ax + sx * t), ez = p.z - (o.az + sz * t), rr = o.r + R, d2 = ex * ex + ez * ez;
        if (d2 >= rr * rr) continue;
        if (d2 > 1e-10) { const d = Math.sqrt(d2); nx = ex / d; nz = ez / d; pen = rr - d; }
        else { nx = -1; nz = 0; pen = rr; }
      }
      p.x += nx * pen; p.z += nz * pen;
      const vn = v.x * nx + v.z * nz;
      if (vn < 0) { v.x -= nx * vn; v.z -= nz * vn; }
      hits++;
    }
  }
  return hits;
}
