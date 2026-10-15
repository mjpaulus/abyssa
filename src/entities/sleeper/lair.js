// src/entities/sleeper/lair.js — WHERE VELKATH SLEEPS (fissure Task 5, spec 2026-10-10 §1 "Lairs",
// §2 "Asleep"). A PURE function of the terrain, the zone's wreck site and the site's sleeper row, so
// the world's scatter (flora, gardens, props, resources, debris) can keep her bed clear BEFORE she is
// built (reseedWorld: flora runs long before the sleepers), and brooder.js lays her in exactly the
// same place.
//
// She lies ALONGSIDE her fissure, not on a rim crest: one flank to the crack, the other (her NEAR flank:
// Task 6 lodges the harpoon there, at standing height) to open sand, her face turned along the crack
// toward the opening. Her centre is
//   lair = fissureWorld(u0, +-(halfW(u0, side) + off))      (the KINKED centreline: fissureShape.js contract)
// with off the smallest value from APRON + 1.3 R up, 1 u at a time, that keeps her whole plan outline
// (G.rimR + OUTLINE_PAD round her) off the APRON: inside those 14 u the ground rises to the lip, and a
// crack-side shell edge stood on it 5-6 u higher (STAND.clear then lifted her wards to 13-17 u); the lip
// kinks and jags under her ~31 u length, so a fixed offset from one half width is not enough.
// The row picks WHERE: a bearing th about the crack's centre (the shipped raft-side bearing, swung by the
// row's `bear`, or searched over its `arc` with the IDLE height split as before: Pallid's [62, 38] still
// takes the HIGH ground) turns into a side (which way th points across the crack) and a station u0 (how
// far th points along it, scaled into the stretch where her length fits the crack). A point whose body
// or trail head would lie on the zone's wreck is passed over (the skiff never lies under her); home's row
// has no bear or arc and takes the shipped bearing. (Ruling 44) The row's `face: -1` turns her face the other
// way along the crack, on a bed that clears the apron facing either way (home's: Velkath's own row in site.js).
import { V3 } from '../../lib/math.js';
import { riftPos, WORLD_R, LEVIATHAN_CFG } from '../../config.js';
import { FISSURE, fissureDist, fissureWorld, _halfWAt, APRON } from '../../world/fissureShape.js';
import { terrainH } from '../../world/terrain.js';
import { wreckSites } from '../../world/wrecks.js';
import { siteParams } from '../../world/site.js';
import { rimR } from './brooderGeo.js';

export const R_OF_SIZE = 2.8;               // carapace half-width in cfg.size units (5.5 -> 15.4 u)
// Her drawn plan reaches up to 0.39 shell units past G.rimR (the brow, the serration and the rear points,
// measured on the sculpted shell): the outline test pads rimR by that.
const OUTLINE_PAD = 0.4, OUT_N = 64;
export const HEAD_R = 1.8;                  // her trail's head, out on the sand side (R; 2.8 put home's on the skiff)
// Her BED for the scatter: no rock, plant or prop within this (R) of her centre + its own radius (her
// plan is 1.29 R at its widest; the silt skirt drifts a few u past it). Rocks under her lifted her
// standing pose (her sole rides their tops) and poked through her asleep.
export const BED_R = 1.55;

const _lw = { x: 0, z: 0 };
function outlineMin(x, z, yaw, R, zi) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  let m = 1e9;
  for (let k = 0; k < OUT_N; k++) {
    const th = k / OUT_N * Math.PI * 2, rr = (rimR(th) + OUTLINE_PAD) * R, lx = Math.cos(th) * rr, lz = Math.sin(th) * rr;
    m = Math.min(m, fissureDist(x + lx * cy + lz * sy, z - lx * sy + lz * cy, zi));
  }
  return m;
}

// Returns { lip (her centre), out (minus her face: brooder.js faces by it), sand (unit normal to open
// ground), ok, g }. c: { lair, idle } (the site's sleeper row; absent = the shipped bearing and face).
export function velkathLair(idx, R, c) {
  const F = FISSURE[idx], rp = riftPos(idx), lr = (c && c.lair) || {}, turn = lr.face === -1;
  const in0 = Math.atan2(-rp.z, -rp.x);                 // the shipped bearing: rift -> raft side
  const W = idx < 3 ? wreckSites()[idx] : null;
  const uMax = Math.max(0, 0.9 * F.halfLen - R);         // her length along the crack stays where it is wide
  const at = th => {
    const ax = Math.cos(th), az = Math.sin(th);
    const along = ax * F.dx + az * F.dz, across = -ax * F.dz + az * F.dx;
    const side = across >= 0 ? 1 : 0, sg = side ? 1 : -1, u0 = along * uMax;
    const sand = V3(-F.dz * sg, 0, F.dx * sg);           // across the bearing, away from the crack
    const fs = u0 > 0 ? -1 : 1, front = V3(F.dx * fs, 0, F.dz * fs);   // her face: along the crack, toward the opening
    const yaw = Math.atan2(front.x, front.z), w = _halfWAt(F, u0, side);
    let off = APRON + 1.3 * R;
    for (let it = 0; it < 40; it++, off += 1) {
      fissureWorld(u0, sg * (w + off), idx, _lw);
      if (outlineMin(_lw.x, _lw.z, yaw, R, idx) >= APRON && (!turn || outlineMin(_lw.x, _lw.z, yaw + Math.PI, R, idx) >= APRON)) break;
    }
    // (Ruling 44) TURNED AT HER BED: the row's face -1 turns her face the other way along the crack once the bed is fitted.
    // The bed is the one that clears the apron facing EITHER way, which at home is today's: re-fitted at the turned face
    // alone, her outline cleared one 1 u step sooner and her centre came 1.0 u nearer the crack, off her frozen station
    // (89.7, 39.1); turned there, her outline clears it by 15.5 u (14 needed)
    const lip = V3(_lw.x, 0, _lw.z), out = front.clone().negate();
    if (turn) out.negate();
    const head = lip.clone().addScaledVector(sand, R * HEAD_R);
    const clear = !W || (Math.hypot(lip.x - W.x, lip.z - W.z) > R * 2 + 16 && Math.hypot(head.x - W.x, head.z - W.z) > 22);
    const inBasin = Math.hypot(lip.x, lip.z) < WORLD_R * 0.66 && Math.hypot(head.x, head.z) < WORLD_R * 0.66;
    let g = 0;
    for (let k = 0; k < 5; k++) g += terrainH(lip.x + Math.cos(k * 1.2566) * R * 0.6, lip.z + Math.sin(k * 1.2566) * R * 0.6, idx);
    return { lip, out, sand, ok: clear && inBasin, g: g / 5 };
  };
  const d2r = Math.PI / 180;
  if (lr.arc && c.idle) {
    const C = [];
    for (let a = lr.arc[0]; a <= lr.arc[1] + 1e-6; a += 10) { const q = at(in0 + a * d2r); if (q.ok) C.push(q); }
    if (C.length) {
      let lo = 1e9, hi = -1e9;
      for (const q of C) { lo = Math.min(lo, q.g); hi = Math.max(hi, q.g); }
      const want = lo + (hi - lo) * c.idle[0] / (c.idle[0] + c.idle[1]);
      let best = C[0];
      for (const q of C) if (Math.abs(q.g - want) < Math.abs(best.g - want)) best = q;
      return best;
    }
  }
  const b = (lr.bear || 0) * d2r;
  for (let k = 0; k < 24; k++) {
    const q = at(in0 + b + (k & 1 ? 1 : -1) * Math.ceil(k / 2) * 15 * d2r);
    if (q.ok) return q;
  }
  return at(in0 + b);
}

// Her bed at the current site (zone 0), for the scatter. Cached on the wreck sites array: it is rebuilt
// on every reseed after the terrain refills (reseedWrecks), and both are all the lair reads.
let bedKey = null, bedX = 0, bedZ = 0, bedR = 0;
function bed() {
  const ws = wreckSites();
  if (bedKey !== ws) {
    bedKey = ws;
    const row = (siteParams().sleepers || [])[0] || {}, R = LEVIATHAN_CFG[0].size * R_OF_SIZE;
    const q = velkathLair(0, R, { lair: row.lair, idle: row.idle });
    bedX = q.lip.x; bedZ = q.lip.z; bedR = BED_R * R;
  }
}
// true when (x, z) in zone zi keeps r (its own radius) clear of Velkath's bed
export function clearOfBed(zi, x, z, r = 0) {
  if (zi !== 0) return true;
  bed();
  const d = bedR + r, dx = x - bedX, dz = z - bedZ;
  return dx * dx + dz * dz > d * d;
}
export function bedAt() { bed(); return { x: bedX, z: bedZ, r: bedR }; }
