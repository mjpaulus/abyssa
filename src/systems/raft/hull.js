// The hull: planked deck, bulwark, the structure underneath, the four flotation drums,
// and the mooring chain that ties the whole barge to the trench it sits over.
// OWNED BY: hull agent (raft detail round). Replaces the nine identical planks, three
// bare beams and four smooth drums that used to stand in for a boat — this is the piece
// that has to convince the player they are standing on something, not a platform.
import { Part, xf, box, cyl, tor, weather, boltLine, rope, lash } from './kit.js';

const FOOT = 4.7;          // walkable footprint half-extent — player.js hard-codes this
const DECK_TOP = 0.11;     // deck top surface — player.js hard-codes this too
const WATERLINE = -0.55;   // raft-local; see RAFT_BRIEF frame table
const RAIL_H = 0.42;       // bulwark height above the deck

// Transform-then-weather: weather() reads each vertex's raw Y to place the waterline
// band, so a piece has to be sitting in raft-local space (post-xf) before it runs, not
// centred on its own local origin.
const W = (geo, x, y, z, rx, ry, rz, s, opts) =>
  weather(xf(geo, x, y, z, rx, ry, rz, s), opts);

export function buildHull(group, mats) {
  const { wood, wood2, iron, rust, rope: ropeMat } = mats;
  const P = Part(group);

  buildDeck(P, wood, wood2);
  buildBulwark(P, wood, iron);
  buildStructure(P, iron);
  buildDrums(P, rust, ropeMat);
  buildMooring(P, iron, rust);

  P.bake();
}

// ---- the deck -------------------------------------------------------------------------
// A solid backing slab carries the load and guarantees the deck reads as solid from
// above no matter how deep the plank seams cut into the cladding above it — there is no
// floor below y = +0.11 except open water, so this can never show daylight through it.
// The visible planking is a separate cap layer glued to that slab: varied board widths,
// staggered butt joints, a few pale replacements, two scarfed patches, and a chamfer
// bead along every long seam so it reads as boards instead of a painted-on grid.
function buildDeck(P, wood, wood2) {
  const SPAN = FOOT * 2, BASE_TOP = 0.02, GROOVE = 0.022, JOINT = 0.02;

  P.add(weather(xf(box(SPAN, BASE_TOP + DECK_TOP, SPAN), 0, (BASE_TOP - DECK_TOP) / 2, 0),
    { tone: 0.74, freq: 0.9, amp: 0.26 }), wood);

  // BOARD WIDTH IS THE WHOLE THING. Sal is 1.8 units tall and reads as a man, so a unit
  // is about a metre — which made the first pass's eight boards across the span METRE-
  // WIDE planks, and a deck with eight boards on it has no planking at all, just facets.
  // At ~0.21 the seams land at roughly a boot's width apart and the deck finally reads
  // as carpentry. 44 rows x 3 butts is under 1600 triangles; the merge eats it.
  const N = 44;
  // Deterministic per-board jitter. Widths vary because no deck stays one width once
  // boards have been swapped over a season, and the variation is what stops the eye
  // finding a repeat.
  const h1 = i => ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1;
  const h2 = i => ((Math.sin(i * 78.233 + 4.1) * 27183.284) % 1 + 1) % 1;

  const raw = [];
  for (let i = 0; i < N; i++) raw.push(0.80 + h1(i) * 0.55);
  const scale = SPAN / raw.reduce((a, b) => a + b, 0);

  let x = -FOOT;
  for (let i = 0; i < N; i++) {
    const w = raw[i] * scale, x0 = x, x1 = x + w, xc = (x0 + x1) / 2, capW = w - GROOVE;
    x = x1;

    // stagger the butt joints row to row so no two rows break along the same line
    const off = (h2(i) - 0.5) * 4.6;
    const j1 = Math.max(-FOOT + 0.7, Math.min(FOOT - 1.4, -1.6 + off));
    const j2 = Math.max(j1 + 0.7, Math.min(FOOT - 0.7, 1.8 + off));
    const breaks = [-FOOT, j1, j2, FOOT];
    // one board in nine is a paler replacement, and it sits a hair proud: it has not had
    // thirty years of boots to wear it flush with its neighbours.
    const paleAt = h1(i + 91) > 0.89 ? (h2(i + 7) * 3) | 0 : -1;
    // old decking cups. A few thousandths of height difference per board is enough for
    // the light to find an edge at every seam instead of gliding over one flat sheet.
    const cup = (h2(i + 41) - 0.5) * 0.009;

    for (let s = 0; s < 3; s++) {
      let z0 = breaks[s], z1 = breaks[s + 1];
      if (s > 0) z0 += JOINT / 2;
      if (s < 2) z1 -= JOINT / 2;
      const len = z1 - z0;
      if (len <= 0.05) continue;
      const isPale = s === paleAt;
      // A replacement board is a slightly fresher piece of the SAME timber, so it stays
      // in the wood bucket and gets its lift from tone. Built out of wood2 it came out
      // twice the value of its neighbours and read as a stripe of paint down the deck.
      const mat = wood;
      const h = DECK_TOP - BASE_TOP + cup + (isPale ? 0.007 : 0);
      // Per-board tone, not just per-vertex noise: boards weather as whole boards,
      // because each one is a different piece of timber that went down in a different
      // year. Without this the deck is one sheet of noise and reads as a texture.
      const tone = (isPale ? 1.16 : 0.80) + (h1(i + 313) - 0.5) * 0.26;
      P.add(weather(xf(box(capW, h, len), xc, BASE_TOP + h / 2, (z0 + z1) / 2),
        { tone, freq: 2.6, amp: 0.30 }), mat);
    }
  }

  // two scarfed repairs: a diagonal patch board let in over an old joint, proud enough
  // to throw a real shadow line rather than just a colour change
  P.add(weather(xf(box(0.62, 0.028, 0.34), -3.0, DECK_TOP + 0.012, -1.0, 0, 0.42, 0),
    { tone: 1.10, freq: 3.2, amp: 0.30 }), wood);
  P.add(weather(xf(box(0.58, 0.026, 0.30), 3.15, DECK_TOP + 0.011, 0.55, 0, -0.33, 0),
    { tone: 1.04, freq: 3.2, amp: 0.30 }), wood);
}

// ---- bulwark / toe rail -----------------------------------------------------------------
// The single biggest silhouette change over the old pallet-deck: a solid low wall around
// the edge in place of open planking, with scuppers cut through its base so a boarding
// sea has somewhere to go. SHARED INVARIANT: no rail across x in [-1.1, 1.1] on the +Z
// edge — that gap is Sal's dive step-off and davit.js hangs the boarding ladder there.
function buildBulwark(P, wood, iron) {
  wallRun(P, wood, iron, 'x', -FOOT, -1.20, FOOT, [{ at: -2.9 }]);
  wallRun(P, wood, iron, 'x', 1.20, FOOT, FOOT, [{ at: 2.9 }]);
  wallRun(P, wood, iron, 'x', -FOOT, FOOT, -FOOT, [{ at: -1.6 }, { at: 1.6 }]);
  wallRun(P, wood, iron, 'z', -FOOT, FOOT, FOOT, [{ at: -2.0 }, { at: 2.0 }]);
  wallRun(P, wood, iron, 'z', -FOOT, FOOT, -FOOT, [{ at: 1.4 }]);

  // corner posts only — the two ends flanking the dive gap are left as a plain cut wall
  // face instead of a post, because that x/z falls inside davit.js's OCCUPIED frame box
  // and posts have no low-things carve-out there the way the walk lane does
  for (const [x, z] of [[-4.64, -4.64], [4.64, -4.64], [-4.64, 4.64], [4.64, 4.64]])
    post(P, wood, iron, x, z);

  // pad eyes to lash gear down: the four corners, plus a pair inboard of each drum where
  // the tie-downs built in buildDrums() actually terminate
  for (const [x, z] of [[-4.3, -4.3], [4.3, -4.3], [-4.3, 4.3], [4.3, 4.3],
    [-4.3, -3.2], [4.3, -3.2], [-4.3, 3.2], [4.3, 3.2]]) padEye(P, iron, x, z);
}

// One straight run of bulwark: toe wall + cap rail + scupper cuts. `axis` is the run's
// direction ('x' or 'z'); `edge` is the raft-local coordinate of the OUTER face on the
// cross axis (e.g. z = +FOOT for the dive-side rail). `scuppers` are {at, w} cut
// positions along the run — the wall opens at the base there while the cap rail keeps
// running overhead, which is how a real bulwark drains without losing its top line.
function wallRun(P, wood, iron, axis, a0, a1, edge, scuppers = []) {
  const T = 0.09, CAPT = T + 0.04, SLOT_H = 0.13;
  const inb = edge > 0 ? -1 : 1;
  const fw = edge + inb * T / 2, fc = edge + inb * CAPT / 2;

  const seg = (len, mid, y, h) => {
    if (axis === 'x') P.put(box(len, h, T), wood, mid, y, fw);
    else P.put(box(T, h, len), wood, fw, y, mid);
  };

  const cuts = scuppers.map(s => ({ at: s.at, w: s.w || 0.22 })).sort((m, n) => m.at - n.at);
  let cur = a0;
  for (const c of cuts) {
    const lo = c.at - c.w / 2, hi = c.at + c.w / 2;
    if (lo - cur > 0.05) seg(lo - cur, (cur + lo) / 2, DECK_TOP + RAIL_H / 2, RAIL_H);
    // lintel: the rail keeps running above the slot, only its base is cut open
    seg(c.w, c.at, DECK_TOP + SLOT_H + (RAIL_H - SLOT_H) / 2, RAIL_H - SLOT_H);
    cur = hi;
  }
  if (a1 - cur > 0.05) seg(a1 - cur, (cur + a1) / 2, DECK_TOP + RAIL_H / 2, RAIL_H);

  if (axis === 'x') P.put(box(a1 - a0, 0.05, CAPT), wood, (a0 + a1) / 2, DECK_TOP + RAIL_H + 0.025, fc);
  else P.put(box(CAPT, 0.05, a1 - a0), wood, fc, DECK_TOP + RAIL_H + 0.025, (a0 + a1) / 2);

  // through-bolts pinning the cap to the wall — the strapping detail carried up from the
  // beams below, at deck-fitting scale
  const n = Math.max(2, Math.round((a1 - a0) / 1.3));
  if (axis === 'x') boltLine(P, iron, a0 + 0.3, DECK_TOP + RAIL_H, fw, a1 - 0.3, DECK_TOP + RAIL_H, fw, n);
  else boltLine(P, iron, fw, DECK_TOP + RAIL_H, a0 + 0.3, fw, DECK_TOP + RAIL_H, a1 - 0.3, n);
}

// A corner / gangway post, thicker than the run of wall so the eye reads it as a stop
// rather than another plank. The iron cap band ties it visually to the rest of the
// ironwork without a whole new fastening pattern.
function post(P, wood, iron, x, z) {
  const s = 0.11, h = RAIL_H + 0.08;
  P.put(box(s, h, s), wood, x, DECK_TOP + h / 2, z);
  P.put(box(s + 0.02, 0.05, s + 0.02), iron, x, DECK_TOP + h - 0.02, z);
}

// A ring bolt let into the deck — the thing a lashing actually ties to. Flat torus plus
// a short stub so it reads as bolted through the planking, not sitting loose on top.
function padEye(P, iron, x, z) {
  P.put(tor(0.05, 0.013, 5, 10), iron, x, DECK_TOP + 0.02, z, Math.PI / 2, 0, 0);
  P.put(cyl(0.02, 0.02, 0.05, 6), iron, x, DECK_TOP, z);
}

// ---- structure underneath ---------------------------------------------------------------
// The player spends most of the game looking UP at this from the water, so the underside
// is a hero angle, not a hidden face: three cross beams (matching this raft's own frame
// spec), two longitudinal keelsons tying them together, and the iron strapping and bolt
// pattern that actually holds a plank deck onto a row of flotation drums.
function buildStructure(P, iron) {
  for (const z of [-3.6, 0, 3.6]) {
    P.add(W(box(FOOT * 2, 0.20, 0.55), 0, -0.22, z, 0, 0, 0, 1, { wetY: WATERLINE, rust: 0.35 }), iron);
    // strap doubler riding the top of the beam, bolted through into the planking above
    P.add(W(box(FOOT * 2, 0.03, 0.62), 0, -0.115, z, 0, 0, 0, 1, { wetY: WATERLINE, rust: 0.4 }), iron);
    boltLine(P, iron, -FOOT + 0.4, -0.10, z, FOOT - 0.4, -0.10, z, 14);
  }
  // where the aft beam's strap bolts actually punch up through the planking — the only
  // one of the three whose deck-side fastenings sit clear of the pump, reel and davit
  boltLine(P, iron, -FOOT + 0.4, DECK_TOP + 0.012, -3.6, FOOT - 0.4, DECK_TOP + 0.012, -3.6, 10);

  for (const x of [-2.3, 2.3]) {
    P.add(W(box(0.24, 0.28, FOOT * 2 - 0.1), x, -0.34, 0, 0, 0, 0, 1, { wetY: WATERLINE, rust: 0.4 }), iron);
    boltLine(P, iron, x, -0.20, -FOOT + 0.5, x, -0.20, FOOT - 0.5, 10);
  }
}

// ---- the flotation drums -----------------------------------------------------------------
// Four oil drums, axis along X, half-drowned at rest (radius 0.85, centre y -0.75 — the
// waterline at -0.55 cuts them well above their middle, which is where an oil drum
// actually floats). This is where a hull rusts hardest, so the boot-top band has to read
// as a real waterline and not a paint stripe, and where a drum that is not tied down is
// a drum that leaves on the next swell — every one gets a lashing to a deck pad eye.
function buildDrums(P, rust, ropeMat) {
  const R = 0.85, LEN = 3.2, Y = -0.75;
  const wet = { wetY: WATERLINE, wetBand: 0.35, rust: 0.7 };

  for (const [x, z] of [[-3.6, -3.2], [3.6, -3.2], [-3.6, 3.2], [3.6, 3.2]]) {
    P.add(W(cyl(R, R, LEN, 12), x, Y, z, 0, 0, Math.PI / 2, 1, wet), rust);

    for (const ox of [-1.05, 0, 1.05]) {
      P.add(W(tor(R + 0.02, 0.035, 5, 12), x + ox, Y, z, 0, Math.PI / 2, 0, 1, wet), rust);
    }
    // bung plug, proud of the shell near one end
    P.add(W(cyl(0.09, 0.09, 0.06, 8), x + 1.15, Y + R, z, 0, 0, 0, 1, { rust: 0.5 }), rust);
    // rolled seam — a line of rivet heads down one side of the shell
    boltLine(P, rust, x - LEN / 2 + 0.15, Y + R * 0.64, z + R * 0.77,
      x + LEN / 2 - 0.15, Y + R * 0.64, z + R * 0.77, 9, 0.022);

    // a couple of turns near one end, tied off to the nearest deck pad eye
    lash(P, ropeMat, x - 0.9, Y, z, R + 0.03, 'x', 1.4, 0.024);
    rope(P, ropeMat, [[x - 0.9, Y + R + 0.02, z], [Math.sign(x) * 4.3, DECK_TOP - 0.02, z]], 0.022);
  }
}

// ---- the mooring -----------------------------------------------------------------------
// A chain leaving the hull at an angle is the detail that actually sells "moored over a
// trench" rather than "floating prop" — a taut mooring never hangs straight down. Mounted
// on the rail cap at the free port-aft corner, clear of the pump and the walk lane.
function buildMooring(P, iron, rust) {
  const ax = -3.6, az = -FOOT - 0.02, ay = DECK_TOP + RAIL_H + 0.09;

  P.put(box(0.18, 0.10, 0.20), iron, ax, ay - 0.03, az);
  P.put(cyl(0.05, 0.05, 0.20, 8), iron, ax, ay, az, 0, 0, Math.PI / 2);

  // a handful of visible links, then the run drops into water dense enough that it does
  // not need modelling any further than that — the fog does the rest
  const ex = ax - 0.9, ey = ay - 3.6, ez = az - 1.4, n = 9;
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const x = ax + (ex - ax) * u, y = ay + (ey - ay) * u, z = az + (ez - az) * u;
    const rx = i % 2 === 0 ? 0 : Math.PI / 2;
    P.add(W(tor(0.05, 0.014, 4, 8), x, y, z, rx, 0, 0, 1,
      { wetY: WATERLINE, wetBand: 0.4, rust: 0.75 }), rust);
  }
}
