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

// ---- THE NO-SLOT RULE -----------------------------------------------------------------
// Two shapes closer than a body's breadth (2 x 0.32) make a slot he cannot fit but can
// press into, and the two push-outs then fight: he jitters. So every gap narrower than
// that is FILLED — gear standing near a bulwark runs its shape to the timber, a cluster
// is bridged into one outline. `pinches()` in the lab probe (see the report on this
// branch) must come back empty after any edit here. That is why some lines below are a
// little bigger than the object they name.

// ---- davit.js: the gallows, forward of the gap on the +X side. ---------------------
// aft leg (rig s = +1): tie rod from its deck ring (1.92, 1.60) to the leg foot, the
// raked leg run on to the rail just forward of the gap's edge
cap('gallows aft tie rod', RX(1.30, 1.92), RZ(1.30, 1.92), RX(1.30, 3.75), RZ(1.30, 3.75), 0.07);
cap('gallows aft leg', RX(1.30, 3.75), RZ(1.30, 3.75), 4.60, 1.42, 0.22);
// forward leg, its tie rod, the tackle's horn cleat and the corner cleat: one block
box('gallows fwd foot', 3.30, 4.375, 1.45, 0.375);
// ---- raft.js buildReel, in the rig frame: drum centre (0, 0.60), cheeks r 0.70 at x
// +-0.46, standards at x +-0.60, crank out to 0.64.
box('hose reel', RX(0, 0.60), RZ(0, 0.60), 0.72, 0.68);

// ---- pump.js: the oil engine + compressor block, PUMP_POS (0.15, -1.20). -----------
box('pump', 0.22, -1.20, 1.36, 0.82);
// ---- gear.js ------------------------------------------------------------------------
box('pump servants', 0.06, -2.345, 0.78, 0.325);           // bucket, oil can, toolbox
cap('water butt', -1.20, -3.00, -0.70, -2.50, 0.50);        // bridged to the servants
cap('bilge pump', -1.55, -4.60, -1.30, -3.45, 0.14);        // rail to the butt
box('fuel depot', 3.865, -3.95, 0.885, 0.80);               // barrel B, tapped barrel, can, funnel
cap('bitumen barrel A', 3.45, -2.85, 3.95, -1.95, 0.38);    // bridged to the hose stock
disc('hose stock', 3.95, -1.95, 0.42);
box('hose stock (rail side)', 4.35, -2.175, 0.40, 0.975);   // to the timber, the gap's aft edge, the depot
box('lashed cargo', -0.955, 3.895, 0.835, 0.855);           // crates, cask, tarp (KX/KZ), to the reel
for (const [x, z] of [[-4.40, 4.40], [-4.40, -4.40]]) box('corner cleat', x, z, 0.35, 0.35);

// ---- station.js: the dressing station, -X wing ---------------------------------------
// bench, tarpaulin, helmet stand and slate rail stand within a hand of each other and
// of the wall: one outline
box('dressing station', -4.305, -0.71, 0.445, 1.91);
cap('tender stool + spare line', -3.90, -1.10, -3.50, -0.85, 0.25);
cap('kicked-off boots', -4.60, -2.75, -3.66, -2.62, 0.17);
// ---- shelf.js / chart.js --------------------------------------------------------------
box('keepsake shelf', -4.51, 1.42, 0.10, 0.70);
box('chart table', -4.175, 2.515, 0.575, 0.395);

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

// ---- THE UMBILICAL ON DECK (polish-leftovers-oct) ------------------------------------
// The tether's verlet nodes used to know only the seabed: on deck the hose fell through
// the planks and cut across the gallows' forward leg. resolveHoseNode() pushes ONE node
// (raft-local, in place) out of:
//   1. the gallows members as 3D capsules — the four raked leg struts and the two tie
//      rods, mirrored from davit.js (FOOT/KNEE/PEAK, the guy-wire a/b/c points; rig frame
//      mapped through RX/RZ exactly as the deck lines above are). Move one, move both.
//      The jib and sheave are left out: node 0 is pinned in the sheave groove and the
//      line is meant to run off it.
//   2. the deck plane over the footprint (top +0.11), with the hull as a slab under it;
//   3. the deck lines above, as COLUMNS from the planks to a top height: a node beside
//      gear is pushed out sideways, a node over it settles on its top (the hose drapes
//      over a crate rather than being shoved off it). The gallows foot lines are skipped
//      (the struts carry them in 3D).
// Zero allocation; the result vector is module scratch read by the caller.
const DECK_Y = 0.11, DECK_E = 4.70, HULL_UNDER = 0.45;
const GALLOWS_SEGS = [];   // ax, ay, az, bx, by, bz, r — raft-local
{
  const seg = (a, b, r) => GALLOWS_SEGS.push(RX(a[0], a[2]), a[1], RZ(a[0], a[2]), RX(b[0], b[2]), b[1], RZ(b[0], b[2]), r);
  const PEAK = [0, 3.35, 4.85];
  for (const s of [-1, 1]) {
    const foot = [s * 1.30, DECK_Y, 3.75], knee = [s * 1.25, 2.45, 3.90];
    seg(foot, knee, 0.10);
    seg(knee, PEAK, 0.085);
    const a = [s * 0.28, 3.28, 4.72], b = [s * 1.20, 2.10, 3.35], c = [s * 1.30, DECK_Y, 1.92];
    seg(a, b, 0.026);
    seg(b, c, 0.022);
  }
}
// Column tops (raft-local y) for the deck lines; 0 = not a column for the hose.
const TOP = {
  'bulwark +Z': 0.53, 'bulwark -Z': 0.53, 'bulwark -X': 0.53, 'bulwark +X aft': 0.53, 'bulwark +X fwd': 0.53,
  'hose reel': 1.32, 'pump': 1.15, 'pump servants': 0.55, 'water butt': 0.79, 'bilge pump': 0.95,
  'fuel depot': 1.05, 'bitumen barrel A': 1.05, 'hose stock': 0.60, 'hose stock (rail side)': 0.60,
  'lashed cargo': 1.05, 'corner cleat': 0.30, 'dressing station': 1.00, 'tender stool + spare line': 0.55,
  'kicked-off boots': 0.40, 'keepsake shelf': 1.25, 'chart table': 1.10
};
for (const o of C) o.top = TOP[o.name] || 0;
export const HOSE_BOUND_R2 = 7.5 * 7.5;    // node-to-raft-origin reject, squared (head is 6.5 out)

// p: {x,y,z} raft-local, moved in place; prevY = the node's raft-local y last step (a node
// that arrives from under the hull is sent back under it, never popped up through it).
// Returns 1 on contact.
export function resolveHoseNode(p, R, prevY) {
  let hit = 0;
  // 1. gallows struts
  const G = GALLOWS_SEGS;
  for (let i = 0; i < G.length; i += 7) {
    const ax = G[i], ay = G[i + 1], az = G[i + 2], sx = G[i + 3] - ax, sy = G[i + 4] - ay, sz = G[i + 5] - az;
    const rr = G[i + 6] + R;
    let t = ((p.x - ax) * sx + (p.y - ay) * sy + (p.z - az) * sz) / (sx * sx + sy * sy + sz * sz);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = p.x - (ax + sx * t), ey = p.y - (ay + sy * t), ez = p.z - (az + sz * t);
    const d2 = ex * ex + ey * ey + ez * ez;
    if (d2 >= rr * rr) continue;
    const d = Math.sqrt(d2);
    if (d > 1e-6) { const k = (rr - d) / d; p.x += ex * k; p.y += ey * k; p.z += ez * k; }
    else p.x -= rr;
    hit = 1;
  }
  if (p.x > DECK_E || p.x < -DECK_E || p.z > DECK_E || p.z < -DECK_E) return hit;
  if (p.y < DECK_Y - HULL_UNDER) return hit;   // under the hull: the water's business
  // 2. the planks (and the hull slab under them)
  if (p.y < DECK_Y + R) {
    if (prevY < DECK_Y - 0.05) { p.y = DECK_Y - HULL_UNDER; return 1; }
    p.y = DECK_Y + R; hit = 1;
  }
  // 3. gear columns
  for (let i = 0; i < C.length; i++) {
    const o = C[i];
    if (!o.top || p.y >= o.top + R) continue;
    let nx, nz, pen;
    if (o.k === 0) {
      const dx = p.x - o.cx, dz = p.z - o.cz;
      const lx = dx * o.c + dz * o.s, lz = -dx * o.s + dz * o.c;
      if (lx > o.hx + R || lx < -o.hx - R || lz > o.hz + R || lz < -o.hz - R) continue;
      const qx = lx < -o.hx ? -o.hx : lx > o.hx ? o.hx : lx;
      const qz = lz < -o.hz ? -o.hz : lz > o.hz ? o.hz : lz;
      const ex = lx - qx, ez = lz - qz, d2 = ex * ex + ez * ez;
      if (d2 >= R * R) continue;
      let ux, uz;
      if (d2 > 1e-10) { const d = Math.sqrt(d2); ux = ex / d; uz = ez / d; pen = R - d; }
      else {
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
    // the cheaper way out: over the top, or sideways
    const up = o.top + R - p.y;
    if (up < pen) p.y = o.top + R;
    else { p.x += nx * pen; p.z += nz * pen; }
    hit = 1;
  }
  return hit;
}
// Dev: the struts, for probes.
export const HOSE_GALLOWS = GALLOWS_SEGS;

// ---- THE DECK BOOM (deck-camera-pullin, 2026-10-04) -------------------------------------
// Michael: "Closer on deck (~6)". A camera six back stands OVER the planks, among the gear,
// where nine back it was always off the boat. game.js walks the boom from the top of Sal's
// helmet to the lens and asks this, per sample, whether a raft-local point is inside something solid
// (grown by `m`, the lens's own clearance). The solid set is the deck lines above as
// columns, the planks over the footprint, and the tall iron the deck lines leave out
// because a boot never meets it: the gallows legs (GALLOWS_SEGS, not the wires), the jib out
// to the sheave, the lantern bracket, and the pump's tall parts. The pump's deck line is a
// walking outline padded out to its neighbours (the no-slot rule) and runs to z -0.38, a
// hand from the spawn line; as a 1.95 column it clipped the spawn boom on every roll of
// the swell. So for the lens the pump is its block to 1.15 plus its real tall parts as
// capsules: flywheel, engine barrel and hot-bulb head, receiver, stack. Column heights
// here are the VISIBLE tops (the hose TOP table above is a drape height). Zero allocation.
const CAM_TOP = { 'hose reel': 1.40, 'keepsake shelf': 1.30, 'chart table': 1.15 };
for (const o of C) o.camTop = CAM_TOP[o.name] || o.top;
// The guy wires (r 0.026 / 0.022) are left out: a boom that jumped in to 2.2 for a wire two
// centimetres thick was measured doing exactly that in the walk lane under the gallows.
// A wire that crosses the lens is a thin line through the frame for a moment; a boom that
// lurches is the whole frame.
const CAM_SEGS = [];
for (let i = 0; i < GALLOWS_SEGS.length; i += 7) if (GALLOWS_SEGS[i + 6] > 0.05) for (let k = 0; k < 7; k++) CAM_SEGS.push(GALLOWS_SEGS[i + k]);
{
  const seg = (a, b, r) => CAM_SEGS.push(RX(a[0], a[2]), a[1], RZ(a[0], a[2]), RX(b[0], b[2]), b[1], RZ(b[0], b[2]), r);
  seg([0, 3.35, 4.85], [0, 3.30, 5.60], 0.11);              // the jib, knuckle to sheave (+ the knuckle ball)
  seg([-0.40, 3.28, 4.60], [-0.55, 2.85, 4.50], 0.12);      // lantern bracket and lantern
}
// pump.js, group at PUMP_POS (0.15, 0.11, -1.20), no yaw
CAM_SEGS.push(
  0.15 - 1.00, 1.30, -1.20, 0.15 - 1.00, 2.50, -1.20, 0.17,     // exhaust stack to the rain cap
  0.15 - 0.55, 0.93, -0.74, 0.15 - 0.55, 0.93, -0.74, 0.60,     // flywheel (FW 0.82, r 0.58, belt plane z 0.46)
  0.15 - 0.55, 1.00, -1.20, 0.15 - 0.55, 1.93, -1.20, 0.30,     // engine barrel, fins and hot-bulb head
  0.15 + 0.19, 1.77, -1.34, 0.15 + 1.17, 1.77, -1.34, 0.27);    // air receiver
// Dev: what the last blocked query hit (a CAM_SEGS index, 'planks', or a deck line's name).
export let camBlockWhy = '';
export function camBlockedLocal(x, y, z, m) {
  const G = CAM_SEGS;
  for (let i = 0; i < G.length; i += 7) {
    const ax = G[i], ay = G[i + 1], az = G[i + 2], sx = G[i + 3] - ax, sy = G[i + 4] - ay, sz = G[i + 5] - az;
    const rr = G[i + 6] + m;
    const l2 = sx * sx + sy * sy + sz * sz;   // 0 for a sphere (the flywheel): 0/0 would never hit
    let t = l2 > 1e-12 ? ((x - ax) * sx + (y - ay) * sy + (z - az) * sz) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = x - (ax + sx * t), ey = y - (ay + sy * t), ez = z - (az + sz * t);
    if (ex * ex + ey * ey + ez * ez < rr * rr) { camBlockWhy = i / 7; return true; }
  }
  if (x > DECK_E || x < -DECK_E || z > DECK_E || z < -DECK_E) return false;
  if (y < DECK_Y - HULL_UNDER) return false;
  if (y < DECK_Y + m) { camBlockWhy = 'planks'; return true; }
  for (let i = 0; i < C.length; i++) {
    const o = C[i];
    if (!o.camTop || y >= o.camTop + m) continue;
    if (o.k === 0) {
      const dx = x - o.cx, dz = z - o.cz;
      const lx = dx * o.c + dz * o.s, lz = -dx * o.s + dz * o.c;
      const ex = Math.max(Math.abs(lx) - o.hx, 0), ez = Math.max(Math.abs(lz) - o.hz, 0);
      if (ex * ex + ez * ez < m * m) { camBlockWhy = o.name; return true; }
    } else {
      const sx = o.bx - o.ax, sz = o.bz - o.az, l2 = sx * sx + sz * sz;
      let t = l2 > 1e-12 ? ((x - o.ax) * sx + (z - o.az) * sz) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = x - (o.ax + sx * t), ez = z - (o.az + sz * t), rr = o.r + m;
      if (ex * ex + ez * ez < rr * rr) { camBlockWhy = o.name; return true; }
    }
  }
  return false;
}
