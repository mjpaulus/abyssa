// The working gear: fuel stock, spare hose, lashed cargo, and the low fittings that
// stop the deck edge reading as a cut line. Territory: starboard wing, aft strip, and
// perimeter fittings (<= y 0.35) all round. Everything here answers one question —
// what does the pump eat, and who feeds it — because bitumen and polymer are a real
// resource loop in this game, not set dressing. OWNED BY: raft-detail agent (gear).
import * as THREE from 'three';
import { box, cyl, sph, tor, lathe, weather, rivetRing, boltLine, rope, coil,
  lash, barrel, Part, xf, chamferBox, tint, state } from './kit.js';

// A packing crate as a crate: a chamfered body with proud battens round the top and
// bottom edges and down the corners, and a rope becket on one end. Built about its own
// origin, then turned and placed (xf twice: local, then the crate's own yaw and seat).
function crate(P, wood, x, y, z, w, h, d, ry, tone = 0.9) {
  const put = (g, lx, ly, lz, t = tone) => P.add(weather(xf(xf(g, lx, ly, lz), x, y, z, 0, ry, 0), { tone: t, freq: 2.4, amp: 0.26 }), wood);
  put(chamferBox(w - 0.03, h - 0.03, d - 0.03, 0.008, 2), 0, 0, 0);
  const b = 0.045, t = 0.018;
  for (const sy of [-1, 1]) {
    const yy = sy * (h / 2 - b / 2);
    put(chamferBox(w, b, t, 0.005), 0, yy, d / 2 - t / 2, tone * 0.92);
    put(chamferBox(w, b, t, 0.005), 0, yy, -d / 2 + t / 2, tone * 0.92);
    put(chamferBox(t, b, d, 0.005), w / 2 - t / 2, yy, 0, tone * 0.92);
    put(chamferBox(t, b, d, 0.005), -w / 2 + t / 2, yy, 0, tone * 0.92);
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1])
    put(chamferBox(b, h - 2 * b, t, 0.005).rotateX(0), sx * (w / 2 - b / 2), 0, sz * (d / 2 - t / 2 + 0.001), tone * 0.95);
}

const DY = 0.11; // deck top; everything not on a chock sits with its base flush here.

export function buildGear(group, mats) {
  const P = Part(group);
  const { wood, wood2, iron, rope: ropeMat, canvas, hose } = mats;

  // ---- FUEL DEPOT ----------------------------------------------------------------
  // Bitumen, staved into barrels, stacked in the aft-starboard corner — hard against
  // the bulwark and out of the aft strip's foot traffic, and close to the pump it
  // feeds. Two barrels in reserve; the third is up on chocks with a tap and a can
  // catching the drip, because a barrel on its side on the deck can't be drawn from.
  const bA = { x: 3.45, z: -2.85, r: 0.36, h: 0.82 };
  const bB = { x: 4.15, z: -3.55, r: 0.36, h: 0.82 };
  const bC = { x: 3.55, z: -4.12, r: 0.38, h: 0.88 }; // the tapped one
  barrel(P, wood, iron, bA.x, DY + bA.h / 2, bA.z, bA.r, bA.h, 0.30);
  barrel(P, wood, iron, bB.x, DY + bB.h / 2, bB.z, bB.r, bB.h, -0.40);

  const chockH = 0.16;
  for (const s of [-1, 1]) {
    P.put(weather(chamferBox(0.16, chockH, 0.30, 0.012), { tone: 0.85 }), wood2,
      bC.x + s * 0.16, DY + chockH / 2, bC.z, 0, 0.1, 0);
  }
  const cY = DY + chockH + bC.h / 2;
  barrel(P, wood, iron, bC.x, cY, bC.z, bC.r, bC.h, 0.10);
  // a strap dogging the tapped barrel down against the roll — the one place on this
  // deck a barrel actually has to stay put
  weather(lash(P, ropeMat, bC.x, cY - bC.h * 0.18, bC.z, bC.r + 0.02, 'y', 1, 0.020, 0.02), { tone: 0.85 });

  // tap, low on the barrel's downhill side, with the catch-can sitting right under it
  const tapX = bC.x + bC.r + 0.05, tapY = DY + chockH + 0.15;
  P.put(weather(cyl(0.025, 0.025, 0.12, 6), { tone: 0.8 }), iron, tapX, tapY, bC.z, 0, 0, Math.PI / 2);
  P.put(weather(cyl(0.09, 0.10, 0.16, 8), { tone: 0.75 }), iron, tapX + 0.02, DY + 0.08, bC.z);
  // funnel and the rag that always lives next to a fuel tap
  P.put(weather(lathe([[0.015, -0.05], [0.015, 0.02], [0.09, 0.10], [0.16, 0.16]], 10),
    { tone: 0.82 }), iron, 3.15, DY + 0.05, -4.30, 0, 0.4, 0);
  P.put(weather(box(0.24, 0.02, 0.16), { tone: 0.55, freq: 0.9 }), canvas,
    3.05, DY + 0.015, -4.40, 0.15, 0.3, 0.25);

  // ---- HOSE STOCK ------------------------------------------------------------------
  // A spare coil of umbilical, flaked down on deck against the starboard rail. Hose is
  // the other craftable and it's the diver's lifeline — it gets its own clear patch of
  // deck, not a corner shared with anything else.
  coil(P, hose, 3.95, DY + 0.02, -0.05, 0.34, 4, 0.045, 0.05);
  for (const x of [3.55, 4.30]) {
    P.put(weather(chamferBox(0.10, 0.10, 0.28, 0.012), { tone: 0.85 }), wood2, x, DY + 0.05, -0.05, 0, 0, 0);
  }

  // ---- LASHED CARGO ------------------------------------------------------------------
  // Crates and a small cask, thrown-tarp over the top, the tarp actually made off to
  // ring bolts rather than just draped — a tarp with nothing holding it down reads as
  // a mistake the first time the raft rolls.
  crate(P, wood2, 2.55, DY + 0.23, 1.10, 0.62, 0.46, 0.58, 0.15, 0.9);
  crate(P, wood2, 3.05, DY + 0.18, 0.85, 0.46, 0.36, 0.42, -0.20, 0.82);
  barrel(P, wood, iron, 2.85, DY + 0.30, 1.55, 0.30, 0.60, 0.5);

  // The tarp has to sit ON the crates, not hover a hand's breadth over them and overhang
  // them by a third of a metre on every side — at that size the crates read as legs and
  // the whole group reads as a white card table. Smaller, lower, and darker: a tarp is
  // oiled duck that has lived outdoors, not a tablecloth.
  // The tarp is CLOTH now, not a slab: a 26 x 30 sheet draped over what is actually under
  // it. Each vertex sits on the highest support (crate tops, the cask head) or falls away
  // from the nearest edge like a tent, down to the planks, with fold ripples wherever it
  // hangs free. A thin hem strip gives the edge a thickness to catch light.
  {
    const DX = 0.95, DZ = 1.15, NX = 26, NZ = 30, cx = 2.74, cz = 1.26, ry = 0.08;
    const cr = Math.cos(ry), sr = Math.sin(ry);
    const rects = [[2.55, 1.10, 0.31, 0.29, 0.15, DY + 0.465], [3.05, 0.85, 0.23, 0.21, -0.20, DY + 0.365]];
    const cask = [2.85, 1.55, 0.26, DY + 0.61];
    const g = new THREE.PlaneGeometry(DX, DZ, NX, NZ).rotateX(-Math.PI / 2);
    const gp = g.attributes.position;
    for (let i = 0; i < gp.count; i++) {
      const lx = gp.getX(i), lz = gp.getZ(i);
      const x = cx + lx * cr + lz * sr, z = cz - lx * sr + lz * cr;
      let hgt = DY + 0.012, hang = 0;
      for (const [rx, rz, hx, hz, rr, top] of rects) {
        const c = Math.cos(rr), sn = Math.sin(rr), qx = (x - rx) * c - (z - rz) * sn, qz = (x - rx) * sn + (z - rz) * c;
        const ox = Math.max(0, Math.abs(qx) - hx), oz = Math.max(0, Math.abs(qz) - hz), d = Math.hypot(ox, oz);
        const hh = top - d * 2.2 - d * d * 3;
        if (hh > hgt) { hgt = hh; hang = d; }
      }
      {
        const d = Math.max(0, Math.hypot(x - cask[0], z - cask[1]) - cask[2]);
        const hh = cask[3] - d * 1.9 - d * d * 3;
        if (hh > hgt) { hgt = hh; hang = d; }
      }
      // folds where it hangs, a slight belly where it spans
      hgt += Math.sin(x * 23 + z * 7) * 0.012 * Math.min(1, hang * 8) + Math.sin(z * 31 - x * 5) * 0.004;
      gp.setXYZ(i, x, Math.max(DY + 0.006, hgt), z);
    }
    g.computeVertexNormals();
    g.userData.metricDone = true;   // plane uv 0..1 over DX x DZ: rescale to metres below
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * DX, uv.getY(i) * DZ);
    P.add(weather(g, { tone: 0.62, freq: 1.6, amp: 0.34 }), canvas);
  }

  const ringBoltDeck = (x, z) => P.put(weather(tor(0.045, 0.011, 4, 8), { tone: 0.85 }),
    iron, x, DY + 0.015, z, Math.PI / 2, 0, 0);
  ringBoltDeck(2.15, 0.55); ringBoltDeck(3.45, 1.95);
  ringBoltDeck(3.35, 0.55); ringBoltDeck(2.20, 1.95);
  weather(rope(P, ropeMat, [[2.15, DY + 0.03, 0.55], [2.50, 0.66, 0.95], [2.95, 0.70, 1.50], [3.45, DY + 0.03, 1.95]], 0.020), { tone: 0.85 });
  weather(rope(P, ropeMat, [[3.35, DY + 0.03, 0.55], [2.95, 0.68, 0.95], [2.55, 0.65, 1.50], [2.20, DY + 0.03, 1.95]], 0.020), { tone: 0.85 });

  // ---- WATER BUTT --------------------------------------------------------------------
  // Drinking water, kept well clear of the bitumen — the two barrels should never read
  // as interchangeable. Aft strip, port side of the pump servants.
  const wbX = -1.20, wbZ = -3.00, wbR = 0.46, wbH = 0.66;
  barrel(P, wood, iron, wbX, DY + wbH / 2, wbZ, wbR, wbH, 0.2);
  const lidY = DY + wbH + 0.015;
  P.put(weather(cyl(wbR * 0.90, wbR * 0.90, 0.03, 12), { tone: 0.85 }), wood2, wbX, lidY, wbZ);
  rivetRing(P, iron, 10, wbX, lidY, wbZ, wbR * 0.90, 0.018, 'y');
  // tin dipper, hooked over the rim rather than lost inside
  P.put(weather(cyl(0.05, 0.065, 0.09, 8), { tone: 0.8 }), iron, wbX + 0.34, lidY + 0.05, wbZ, 0.3, 0, 0);
  P.put(weather(cyl(0.010, 0.010, 0.22, 5), { tone: 0.8 }), iron, wbX + 0.28, lidY + 0.03, wbZ, 0, 0, Math.PI / 2.4);

  // ---- THE PUMP'S SERVANTS -----------------------------------------------------------
  // Aft strip, right behind the pump: what a man needs at hand to keep it fed and
  // clean without walking off for it. Kept aft of z -2.25 so none of it sits in the
  // pump's own footprint.
  P.put(weather(cyl(0.13, 0.16, 0.22, 10), { tone: 0.6 }), iron, -0.55, DY + 0.11, -2.45);
  P.put(weather(tor(0.15, 0.012, 4, 10), { tone: 0.6 }), iron, -0.55, DY + 0.25, -2.45);
  // oil can with its spout cocked toward the pump
  P.put(weather(cyl(0.05, 0.06, 0.14, 8), { tone: 0.75 }), iron, 0.15, DY + 0.07, -2.50);
  P.put(weather(cyl(0.012, 0.020, 0.14, 6), { tone: 0.75 }), iron, 0.24, DY + 0.15, -2.42, 0.9, 0, 0.5);
  // toolbox, banded, rivets at the lid seam
  P.put(weather(chamferBox(0.42, 0.20, 0.26, 0.012, 2), { tone: 0.88 }), wood2, 0.62, DY + 0.10, -2.50, 0, 0.1, 0);
  P.put(weather(chamferBox(0.44, 0.03, 0.28, 0.008), { tone: 0.95 }), wood2, 0.62, DY + 0.215, -2.50, 0, 0.1, 0);   // lid
  P.put(state(tor(0.06, 0.009, 6, 12, Math.PI), -0.2), iron, 0.62, DY + 0.232, -2.50, 0, 0.1, 0);                 // handle
  boltLine(P, iron, 0.62 - 0.19, DY + 0.20, -2.44, 0.62 + 0.19, DY + 0.20, -2.44, 4, 0.014);
  // the ash scoop, laid flat rather than leaned on nothing
  P.put(weather(cyl(0.018, 0.018, 0.85, 6), { tone: 0.75 }), iron, -0.15, DY + 0.02, -2.68, 0, 0.25, Math.PI / 2);
  P.put(weather(box(0.14, 0.02, 0.20), { tone: 0.75 }), iron, 0.25, DY + 0.02, -2.60, 0, 0.25, 0);

  // ---- PERIMETER FITTINGS -------------------------------------------------------------
  // Low stuff, all round the rail — under y 0.35 everywhere, so it's legal even across
  // the walk lane and the other wings. This is what keeps the deck edge from reading
  // as a cut line: nobody plates a raft's rail with nothing on it.
  // horn cleats: a tapered pedestal and two round horns tapering to blunt tips, cast
  const cleat = (x, z, ry) => {
    P.put(weather(cyl(0.035, 0.055, 0.085, 10), { tone: 0.85 }), iron, x, DY + 0.043, z, 0, ry, 0);
    P.put(weather(chamferBox(0.16, 0.012, 0.09, 0.004), { tone: 0.8 }), iron, x, DY + 0.006, z, 0, ry, 0);
    const ax = Math.cos(ry), az = -Math.sin(ry);
    for (const s of [-1, 1]) {
      const h = xf(cyl(0.017, 0.028, 0.15, 10), 0, 0, 0, 0, 0, s * Math.PI / 2 - s * 0.12);
      P.add(weather(xf(h, x + ax * 0.075 * s, DY + 0.095, z + az * 0.075 * s, 0, ry, 0), { tone: 0.88 }), iron);
    }
  };
  for (const [x, z, ry] of [[4.25, 4.25, 0.78], [4.25, -4.25, -0.78], [-4.25, 4.25, 2.36], [-4.25, -4.25, -2.36]])
    cleat(x, z, ry);

  const ringBolt = (x, z) => P.put(weather(tor(0.045, 0.011, 4, 8), { tone: 0.85 }),
    iron, x, DY + 0.015, z, Math.PI / 2, 0, 0);
  for (const [x, z] of [[4.35, -1.5], [4.35, 2.6], [-4.35, -1.2], [-4.35, 1.4], [-4.35, 3.1],
    [0.9, -4.35], [-0.9, -4.35], [-2.0, 4.35], [2.0, 4.35]]) ringBolt(x, z);

  for (const [x, z, ry] of [[4.40, -3.95, 0], [-4.40, -3.95, 0], [1.72, 4.35, 0.2], [-1.72, 4.35, -0.2]])
    P.put(weather(chamferBox(0.22, 0.13, 0.02, 0.005), { tone: 0.8, rust: 0.4 }), iron, x, DY + 0.075, z, 0, ry, 0);

  // ---- BOAT HOOK, stowed along the starboard rail --------------------------------------
  // A 2.2m pole would trip Sal if it stood up; laid flat against the bulwark it reads
  // as stowed gear instead of a barricade, and it's clear of the hose stock inboard.
  P.put(weather(cyl(0.020, 0.020, 2.2, 6), { tone: 0.85 }), wood2, 4.42, DY + 0.045, 0.5, Math.PI / 2, 0, 0);
  weather(rope(P, iron, [[4.42, DY + 0.09, 1.55], [4.50, DY + 0.20, 1.62], [4.44, DY + 0.28, 1.58]], 0.016), { tone: 0.8 });
  for (const z of [-0.30, 1.00]) P.put(weather(tor(0.035, 0.010, 4, 8), { tone: 0.8 }), iron, 4.42, DY + 0.09, z);

  // ---- BILGE PUMP HANDLE ----------------------------------------------------------------
  // The one slender vertical this side of the deck gets. Aft-port corner of the aft
  // strip, tucked well below the davit's silhouette and off any line Sal actually walks.
  P.put(weather(chamferBox(0.16, 0.12, 0.16, 0.015), { tone: 0.85 }), iron, -1.55, DY + 0.06, -4.15);
  P.put(weather(cyl(0.022, 0.022, 0.62, 6), { tone: 0.85 }), iron, -1.55, DY + 0.42, -4.05, 0, 0, 0.15);
  P.put(weather(sph(0.035, 6, 5), { tone: 0.85 }), iron, -1.46, DY + 0.71, -4.05);

  P.bake();
}
