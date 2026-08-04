// The dressing station — port wing. OWNED BY: raft detail agent (station).
//
// Dressing a hard-hat diver takes two men and twenty minutes: one tends the line, the
// other bolts the corselet on and lowers the helmet over it. Sal is down the ladder
// right now, so this corner reads as just-vacated, not tidied-away — the bench he sat
// on, the stand his helmet came off, the tools that bolted him in, all still lying
// where the last hand set them down. The single object doing the most work is the
// empty helmet stand: a cradle with nothing in it says "the man is in the water"
// without a line of UI.
import * as THREE from 'three';
import { Part, xf, box, cyl, tor, lathe, weather, tint, rivetRing, rope, coil, lash } from './kit.js';

const TAU = Math.PI * 2;
const DECK = 0.11; // deck top surface, raft-local — everything here sits on it

export function buildStation(group, mats) {
  const P = Part(group);
  // `rope` collides with the kit's tube-builder of the same name, hence the rename.
  const { wood, iron, brass, lead, canvas, rope: ropeMat } = mats;

  // ---- the dressing bench ------------------------------------------------------------
  // A trestle bench, low enough to sit on while a man laces your boots. The far end
  // steps down half an inch and opens into a scooped trough — that's where the
  // corselet sat while it was bolted to the chest, so it doesn't roll off a flat top.
  const BX = -4.10, LEG_H = 0.34, TOP_T = 0.08;
  {
    for (const lx of [BX - 0.16, BX + 0.16]) {
      for (const lz of [-2.30, -0.68]) {
        P.add(weather(xf(box(0.06, LEG_H, 0.06), lx, DECK + LEG_H / 2, lz), { tone: 0.82, amp: 0.24 }), wood);
      }
      P.add(weather(xf(box(0.045, 0.045, 1.62), lx, DECK + 0.22, -1.49), { tone: 0.82, amp: 0.22 }), wood);
    }
    // seat plank — pale and smooth where two seasons of dressed divers have sat on it
    P.add(weather(xf(box(0.44, TOP_T, 1.60), BX, DECK + LEG_H + TOP_T / 2, -1.70),
      { tone: 1.18, amp: 0.14 }), wood);
    // the step-down shelf carrying the cradle
    P.add(weather(xf(box(0.44, 0.05, 0.40), BX, DECK + LEG_H + 0.025, -0.70),
      { tone: 1.02, amp: 0.18 }), wood);
    // the trough itself: bottom half of a cylinder, open face up, let into the shelf
    const trough = new THREE.CylinderGeometry(0.15, 0.15, 0.42, 10, 1, true, Math.PI / 2, Math.PI)
      .rotateZ(Math.PI / 2);
    P.add(weather(xf(trough, BX, DECK + LEG_H + 0.05, -0.70), { tone: 0.72, amp: 0.20 }), wood);
  }

  // ---- the empty helmet stand ----------------------------------------------------------
  // A spare corselet ring on a post doubles as the cradle — that's really how a Mark V
  // sits between dives, screwed to nothing, waiting. The three dogs that lock a helmet
  // down hang open on their hinges because there's no breastplate under them to clamp.
  // SX sits 0.35 in from the port rail (x=-4.55): the cradle's own radius (0.29) would
  // otherwise hang the basket out past the wing's edge.
  const SX = -4.20, SZ = 0.90, POST_H = 0.72, POST_Y0 = DECK + 0.03;
  {
    P.add(weather(xf(box(0.24, 0.03, 0.24), SX, POST_Y0 + 0.015, SZ), { tone: 0.8, amp: 0.2 }), wood);
    rivetRing(P, brass, 4, SX, POST_Y0 + 0.03, SZ, 0.09, 0.014, 'y');
    const postTop = POST_Y0 + POST_H;
    P.add(weather(xf(cyl(0.05, 0.065, POST_H, 10), SX, POST_Y0 + POST_H / 2, SZ),
      { tone: 0.85, amp: 0.2 }), iron);
    const cradle = lathe([[0, 0], [0.14, 0], [0.25, 0.07], [0.29, 0.15], [0.26, 0.19]], 16);
    P.add(weather(xf(cradle, SX, postTop, SZ), { tone: 1.05, amp: 0.16 }), wood);
    const ringY = postTop + 0.19;
    P.add(xf(tor(0.26, 0.022, 6, 20).rotateX(Math.PI / 2), SX, ringY, SZ), brass);
    // three loose dogs, drooped open at 120 degrees — hinge lugs on the ring, wingnut
    // tabs hanging below where they'd swing shut over a helmet's neck flange
    for (let i = 0; i < 3; i++) {
      const a = i / 3 * TAU + 0.35;
      const hx = SX + Math.cos(a) * 0.26, hz = SZ + Math.sin(a) * 0.26;
      P.add(xf(box(0.05, 0.02, 0.02), hx, ringY - 0.01, hz, 0, a), brass);
      const dx = SX + Math.cos(a) * 0.29, dz = SZ + Math.sin(a) * 0.29;
      P.add(xf(cyl(0.022, 0.026, 0.05, 8), dx, ringY - 0.09, dz, 1.05, a), brass);
      P.add(xf(box(0.10, 0.042, 0.014), dx, ringY - 0.09, dz, 1.05, a), brass);
    }
  }

  // ---- the tender's stool --------------------------------------------------------------
  // Pulled up close to the bench — this is where a man sat with the line in his fist
  // for twenty minutes, watching the water for bubbles.
  const TX = -3.55, TZ = -1.10;
  {
    P.add(weather(xf(cyl(0.16, 0.16, 0.045, 10), TX, DECK + 0.30, TZ), { tone: 1.08, amp: 0.16 }), wood);
    for (let i = 0; i < 3; i++) {
      const a = i / 3 * TAU + 0.4, lx = Math.cos(a), lz = Math.sin(a), lean = 0.16;
      P.add(weather(xf(cyl(0.016, 0.020, 0.19, 6), TX + lx * 0.10, DECK + 0.195, TZ + lz * 0.10,
        lz * lean, 0, -lx * lean), { tone: 0.85, amp: 0.2 }), wood);
    }
  }

  // ---- the tender's tools: an open roll, a couple of spanners --------------------------
  // The breastplate spanner is the one that matters — its forked jaw is cut to fit the
  // wing-bolt tabs on that stand behind it. Everything else here is a common wrench.
  const RX = BX, RZ = -2.05, ROLL_Y = DECK + LEG_H + TOP_T + 0.01;
  {
    P.add(tint(xf(box(0.42, 0.02, 0.30), RX, ROLL_Y, RZ), 0.62, 0.56, 0.44), canvas);
    P.add(tint(xf(cyl(0.045, 0.045, 0.30, 10, true).rotateZ(Math.PI / 2), RX - 0.18, ROLL_Y + 0.05, RZ),
      0.58, 0.52, 0.40), canvas);
    const wrench = (wx, wz, ry) => {
      P.add(xf(box(0.15, 0.016, 0.026), wx, ROLL_Y + 0.03, wz, 0, ry), iron);
      P.add(xf(tor(0.020, 0.008, 5, 10), wx + Math.cos(ry) * 0.09, ROLL_Y + 0.03, wz - Math.sin(ry) * 0.09,
        Math.PI / 2, ry), iron);
      P.add(xf(box(0.03, 0.03, 0.05), wx - Math.cos(ry) * 0.09, ROLL_Y + 0.03, wz + Math.sin(ry) * 0.09,
        0, ry), iron);
    };
    wrench(RX - 0.06, RZ - 0.06, 0.30);
    wrench(RX + 0.07, RZ + 0.06, -0.55);
    // breastplate spanner: longer bar, forked hook end
    const sry = 0.9, slen = 0.26;
    P.add(xf(box(slen, 0.020, 0.045), RX + 0.12, ROLL_Y + 0.045, RZ - 0.02, 0, sry), iron);
    const hookX = RX + 0.12 + Math.cos(sry) * slen * 0.55, hookZ = RZ - 0.02 - Math.sin(sry) * slen * 0.55;
    P.add(xf(new THREE.TorusGeometry(0.05, 0.012, 5, 10, Math.PI * 1.4), hookX, ROLL_Y + 0.045, hookZ,
      Math.PI / 2, sry), iron);
  }

  // ---- spare weight belt, draped over the bench's outboard edge ------------------------
  {
    const pts = [[BX - 0.18, 0.53, -1.80], [BX - 0.34, 0.42, -1.83], [BX - 0.42, 0.26, -1.87], [BX - 0.40, 0.15, -1.92]];
    weather(rope(P, canvas, pts, 0.024), { tone: 0.55, amp: 0.24 });
    const blocks = [
      [-4.28, 0.50, -1.81, 0.3], [-4.34, 0.44, -1.82, -0.4], [-4.39, 0.36, -1.84, 0.5],
      [-4.42, 0.28, -1.86, -0.3], [-4.42, 0.20, -1.89, 0.4], [-4.40, 0.14, -1.92, -0.5]
    ];
    for (const [bx2, by2, bz2, rr] of blocks) P.add(xf(box(0.075, 0.05, 0.03), bx2, by2, bz2, 0, rr, 0.5), lead);
  }

  // ---- a spare pair of boots, kicked off rather than set down ---------------------------
  // No leather in this kit's palette, so a dark-tinted duck canvas stands in for the
  // upper — from three paces on a deck it reads the same.
  function boot(cx, cz, ry, tip, baseY) {
    const local = [
      [box(0.11, 0.03, 0.27), lead, 0, 0.015, 0],
      [box(0.095, 0.085, 0.19), canvas, 0, 0.0575, 0.015],
      [cyl(0.070, 0.086, 0.12, 8), canvas, 0, 0.135, -0.075],
      [new THREE.SphereGeometry(0.062, 8, 5, 0, TAU, 0, Math.PI / 2).rotateX(Math.PI / 2), brass, 0, 0.048, 0.145]
    ];
    for (const [geo, mat, x, y, z] of local) {
      let g = xf(geo, x, y, z);
      g = xf(g, 0, 0, 0, 0, 0, tip);
      g = xf(g, cx, baseY, cz, 0, ry, 0);
      P.add(mat === canvas ? tint(g, 0.40, 0.27, 0.18) : g, mat);
    }
    // a slack lace, looped once over the instep and left untied
    const fy = baseY + 0.10, fx = cx + Math.sin(ry) * 0.02, fz = cz + Math.cos(ry) * 0.02;
    weather(rope(P, canvas, [[fx - 0.05, fy, fz + 0.03], [fx, fy + 0.02, fz + 0.09], [fx + 0.06, fy - 0.01, fz + 0.02]], 0.010),
      { tone: 1.15, amp: 0.14 });
  }
  boot(-3.86, -2.85, 0.35, 0.05, DECK + 0.005);
  boot(-3.66, -2.62, -0.60, 1.15, DECK + 0.05);

  // ---- folded tarpaulin -------------------------------------------------------------
  {
    P.add(weather(xf(box(0.48, 0.09, 0.38), -4.16, DECK + 0.05, -0.30), { tone: 0.8, amp: 0.22 }), canvas);
    P.add(weather(xf(box(0.40, 0.08, 0.32), -4.16, DECK + 0.13, -0.30, 0, 0, 0.06), { tone: 0.86, amp: 0.20 }), canvas);
    P.add(weather(xf(box(0.32, 0.06, 0.25), -4.16, DECK + 0.19, -0.30, 0, 0, -0.05), { tone: 0.92, amp: 0.18 }), canvas);
  }

  // ---- coiled spare line, dropped by the stool ---------------------------------------
  weather(coil(P, ropeMat, -3.50, DECK, -0.85, 0.24, 3, 0.032), { tone: 0.85, amp: 0.22 });

  // ---- bulwark fixtures: the tender's slate and a dead hand-lantern --------------------
  // Two stanchions of our own, lashed with a short cap rail — enough rail to hang a
  // board and a hook off without leaning on whatever the hull actually built here.
  const RAIL_X = -4.46, RAIL_Y = DECK + 0.97;
  {
    for (const rz of [0.35, 1.10]) {
      P.add(weather(xf(cyl(0.045, 0.045, RAIL_Y - DECK, 8), RAIL_X, DECK + (RAIL_Y - DECK) / 2, rz),
        { tone: 0.8, amp: 0.22 }), iron);
    }
    P.add(weather(xf(cyl(0.03, 0.03, 1.55, 8).rotateX(Math.PI / 2), RAIL_X, RAIL_Y, 0.75),
      { tone: 0.8, amp: 0.2 }), iron);

    // the slate — the dive log, chalked and rubbed out and chalked again
    const BDX = RAIL_X + 0.06, BDZ = 0.35;
    P.add(weather(xf(box(0.03, 0.46, 0.34), BDX, DECK + 0.72, BDZ, 0, 0, 0.03), { tone: 0.60, amp: 0.16 }), wood);
    // radius/centre chosen to loop past both the post and the board's near face, so the
    // lashing actually reads as holding the two together rather than floating near them
    weather(lash(P, ropeMat, RAIL_X + 0.03, DECK + 0.90, BDZ, 0.075, 'y', 2, 0.016), { tone: 0.9, amp: 0.18 });
    weather(lash(P, ropeMat, RAIL_X + 0.03, DECK + 0.58, BDZ, 0.075, 'y', 2, 0.016), { tone: 0.9, amp: 0.18 });
    const chalkX = BDX + 0.02;
    P.add(tint(xf(box(0.10, 0.012, 0.004), chalkX, DECK + 0.86, BDZ), 1.25, 1.22, 1.05), canvas); // header line
    for (let i = 0; i < 5; i++) {
      P.add(tint(xf(box(0.006, 0.05, 0.004), chalkX, DECK + 0.74 - i * 0.045, BDZ - 0.11 + i * 0.014), 1.25, 1.22, 1.05), canvas);
    }
    P.add(tint(xf(box(0.05, 0.008, 0.004), chalkX, DECK + 0.62, BDZ + 0.08, 0, 0, 0.4), 1.2, 1.17, 1.0), canvas);

    // dead hand-lantern hanging off the second stanchion, swung slightly inboard
    const LX = RAIL_X + 0.05, LZ = 1.10;
    P.add(xf(new THREE.TorusGeometry(0.045, 0.011, 5, 10, Math.PI * 1.3), RAIL_X, DECK + 0.86, LZ,
      0, Math.PI / 2, 0.3), iron);
    weather(rope(P, ropeMat, [[RAIL_X, DECK + 0.85, LZ], [LX, DECK + 0.72, LZ]], 0.010), { tone: 0.8, amp: 0.2 });
    P.add(weather(xf(box(0.09, 0.12, 0.09), LX, DECK + 0.60, LZ), { tone: 0.75, amp: 0.2 }), iron);
    P.add(weather(xf(new THREE.ConeGeometry(0.07, 0.06, 6), LX, DECK + 0.69, LZ), { tone: 0.75, amp: 0.2 }), iron);
    P.add(xf(tor(0.025, 0.006, 5, 10), LX, DECK + 0.735, LZ), brass);
  }

  P.bake();
}
