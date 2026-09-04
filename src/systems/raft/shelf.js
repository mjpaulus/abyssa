// The keepsake shelf — port bulwark, forward of the chart table. OWNED BY: keepsake agent.
//
// A dive tender is not a museum, so this is the smallest thing that could hold a museum:
// one narrow board on two brackets, screwed to the inside of the bulwark where a man
// standing at the chart can reach it without turning his feet. Nothing is displayed. The
// things are simply PUT there, in the order they came up, the way anyone empties a pocket.
//
// The board and its brackets are static and go into the raft's cross-builder merge like
// everything else. The keepsakes themselves change at runtime (Sal brings one home from a
// remote wreck) so they cannot be baked in — they live in a small dynamic group carrying
// ONE mesh, rebuilt whole on the rare frames the set changes. Never per-frame.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Part, xf, box, cyl, weather } from './kit.js';
import { keepsakeKind, keepsakeGeo } from '../../lib/keepsakes.js';

const DECK = 0.11;
// Inboard face of the port bulwark run is x = -4.61 (edge -4.7, wall 0.09 thick). The
// board hangs off it, clear of the chart table's footprint (x >= -4.45, z 2.2..3.7).
const WALL = -4.61;
const SX = WALL + 0.10;           // board centre: 0.20 deep, flush to the wall
const SZ = 1.50, SLEN = 1.24;     // z 0.88..2.12 — forward of the table, on the same wall
// The home slot (his sextant) sits at the forward end: the board grows one slot's
// width toward the bow so the nine remote slots never move. Brackets stay where they are.
const HOME_W = 0.135;
const BZ = SZ - HOME_W / 2, BLEN = SLEN + HOME_W;
const TOP = 0.40;                 // board top surface: under the cap rail (0.53), over the deck
const THK = 0.032;

// Nine slots — three remote sites by three wrecks, site-major, left to right. A slot is
// held even when its keepsake is not yet found, so nothing on the shelf ever moves once
// it is put down: the gaps are the record.
// Slot 0 is the HOME slot (site 0, the skiff — his sextant), one slot's width forward
// of the nine; slots 1..9 are the remote nine exactly where they always were.
const SLOTS = 10;
const SLOT_Z = k => SZ + (k - 1 - 4) * 0.135;
// A stable, hand-set yaw per slot, so the row reads as things set down rather than racked.
const YAW = [0.95, 0.35, -0.62, 1.15, -0.20, 0.80, -1.05, 0.15, 1.42, -0.45];

export function buildShelf(group, mats) {
  const P = Part(group);
  const { wood, wood2, iron } = mats;

  // the board: a plain plank, worn pale along its front edge where sleeves pass
  P.add(weather(xf(box(0.20, THK, BLEN), SX, TOP - THK / 2, BZ),
    { tone: 1.02, freq: 2.6, amp: 0.26 }), wood2);

  // two iron brackets: a vertical leaf bolted to the bulwark, a shelf leaf under the
  // board, and the diagonal that stops it folding down under weight
  for (const bz of [SZ - 0.44, SZ + 0.44]) {
    P.add(weather(xf(box(0.012, 0.20, 0.05), WALL + 0.006, TOP - 0.11, bz),
      { tone: 0.80, amp: 0.22, rust: 0.40 }), iron);
    P.add(weather(xf(box(0.17, 0.012, 0.045), SX - 0.012, TOP - THK - 0.006, bz),
      { tone: 0.82, amp: 0.22, rust: 0.40 }), iron);
    P.add(weather(xf(box(0.20, 0.010, 0.035), SX - 0.005, TOP - 0.11, bz, 0, 0, 0.72),
      { tone: 0.78, amp: 0.20, rust: 0.45 }), iron);
    P.add(weather(xf(cyl(0.010, 0.010, 0.016, 6), WALL + 0.004, TOP - 0.05, bz, 0, 0, Math.PI / 2),
      { tone: 0.86, amp: 0.18, rust: 0.3 }), iron);
  }

  // a fiddle: the 15 mm lip that is the whole difference between a shelf on land and a
  // shelf at sea. Without it the first swell puts every one of these back in the water.
  P.add(weather(xf(box(0.012, 0.018, BLEN), SX + 0.094, TOP + 0.009, BZ),
    { tone: 0.94, amp: 0.22 }), wood);

  P.bake();

  // ---- the dynamic row ---------------------------------------------------------------
  // Its own group, so raft.js's consolidate() (direct children flagged rmerge only)
  // leaves it alone and the static merge is untouched.
  const dyn = new THREE.Group();
  group.add(dyn);
  let mesh = null;
  let sig = '';

  return function setShelf(keeps) {
    // site-major signature: rebuild only when the set actually changed (this is called
    // at boot, on every pickup and on every save load).
    let s = (keeps && keeps[0] && keeps[0][0]) ? '1' : '0';   // the home slot
    for (let si = 1; si <= 3; si++) {
      const row = (keeps && keeps[si]) || [0, 0, 0];
      for (let zi = 0; zi < 3; zi++) s += row[zi] ? '1' : '0';
    }
    if (s === sig) return;
    sig = s;

    const geos = [];
    for (let k = 0; k < SLOTS; k++) {
      if (s[k] !== '1') continue;
      const kind = k === 0 ? keepsakeKind(0, 0) : keepsakeKind(1 + (((k - 1) / 3) | 0), (k - 1) % 3);
      const parts = keepsakeGeo(kind, 1.0);
      for (const g of parts) {
        // weathered in the object's OWN frame on purpose: these are nine copies of the
        // same nine shapes, and grime keyed to a shelf slot would make them look sorted.
        // (The transform-then-weather rule exists for the waterline, and wetY is null.)
        weather(g, { tone: 0.90, freq: 3.4, amp: 0.24 });
        // pulled 30 mm inboard of the board centre: measured, the longest of them (the
        // pipe, stem out) otherwise overhangs the fiddle instead of leaning on it.
        geos.push(xf(g, SX - 0.03, TOP, SLOT_Z(k), 0, YAW[k], 0));
      }
    }

    if (mesh) { mesh.geometry.dispose(); dyn.remove(mesh); mesh = null; }
    if (!geos.length) return;
    const merged = geos.length > 1 ? mergeGeometries(geos) : geos[0];
    if (!merged) return;
    mesh = new THREE.Mesh(merged, mats.brass);
    mesh.castShadow = true; mesh.receiveShadow = true;
    dyn.add(mesh);
  };
}
