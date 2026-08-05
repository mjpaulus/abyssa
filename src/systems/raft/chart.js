// The chart table — port side, aft of the dressing station. OWNED BY: raft detail agent
// (chart).
//
// Whoever tendered this raft before Sal's outfit took it over kept his charts here, and
// nobody's moved the corner since. The board still stands tilted the way a working
// lectern does — better light off the water, and gravity holds the sheet flat against
// the low lip instead of a man's forearm. It reads as inherited, not installed: the
// sheet is pinned down and left, the dividers dropped where a hand set them last, the
// lantern hook empty because whoever worked this station is below with Sal now.
import * as THREE from 'three';
import { Part, xf, box, cyl, tor, lathe, weather, tint } from './kit.js';

const TAU = Math.PI * 2;
const DECK = 0.11; // deck top surface, raft-local

// Table geometry. Box: x in [-4.45,-3.55], z in [2.2,3.7], y <= 1.35.
const TX = -4.00, TZ = 2.55;      // post/leg centre
const TILT = 0.32;                // ~18 degrees: board rises going away from the anchor (-Z), the
                                   // low edge (+Z, lip, near where a man stands) is closest to it
const BOARD_W = 0.72, BOARD_D = 0.62, BOARD_T = 0.035;
const BOARD_CY = 1.02;            // centre height of the board slab, within the 0.95-1.1 band

export function buildChart(group, mats) {
  const P = Part(group);
  // Four materials only, to keep this at four baked buckets: the board and its lip share
  // `wood` (no need for a second wood tone here), and the sounding-weight borrows `iron`
  // rather than pulling in a fifth material just for one small casting.
  const { wood, iron, brass, canvas } = mats;

  // ---- legs and deck pads --------------------------------------------------------------
  // Four stout legs, splayed slightly for a lectern's stance, bolted to pads let into
  // the deck rather than just standing on it — the previous owner built this to survive
  // a following sea.
  const LEG_H = 0.86, LEG_R = 0.028;
  const legPos = [
    [-0.26, -0.22], [0.26, -0.22], [-0.26, 0.20], [0.26, 0.20]
  ];
  for (const [dx, dz] of legPos) {
    const lean = 0.05;
    const lx = TX + dx, lz = TZ + dz;
    const tiltX = dz < 0 ? lean : -lean, tiltZ = dx < 0 ? -lean : lean;
    P.add(weather(xf(cyl(LEG_R, LEG_R * 1.25, LEG_H, 8), lx, DECK + LEG_H / 2, lz, tiltX, 0, tiltZ),
      { tone: 0.80, amp: 0.24 }), wood);
    // deck pad the leg is bolted through
    P.add(weather(xf(cyl(0.065, 0.065, 0.035, 10), lx + dx * 0.10, DECK + 0.017, lz + dz * 0.10),
      { tone: 0.74, amp: 0.20 }), iron);
  }
  // a low stretcher rail tying the legs together, stiffening the frame
  P.add(weather(xf(box(0.60, 0.04, 0.04), TX, DECK + 0.30, TZ - 0.22), { tone: 0.80, amp: 0.22 }), wood);
  P.add(weather(xf(box(0.04, 0.04, 0.34), TX - 0.26, DECK + 0.30, TZ - 0.02), { tone: 0.80, amp: 0.22 }), wood);
  P.add(weather(xf(box(0.04, 0.04, 0.34), TX + 0.26, DECK + 0.30, TZ - 0.02), { tone: 0.80, amp: 0.22 }), wood);

  // ---- the slanted board itself ---------------------------------------------------------
  // Tilted so the low edge faces +Z (toward the anchor, where a man stands to read it), with
  // a raised lip along that low edge so a rolled chart doesn't slide off into his boots.
  {
    const board = box(BOARD_W, BOARD_T, BOARD_D);
    weather(board, { tone: 1.0, amp: 0.20 });
    // wear the near (low) edge pale where hands rest reading the sheet — with TILT
    // rotating the board about X, local +Z ends up the low world-y edge (the near side,
    // toward the standing anchor); local -Z rises away. Bias the vertex colour brighter
    // on the +Y face near +Z before baking the tilt in.
    const pos = board.attributes.position, col = board.attributes.color;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i), y = pos.getY(i);
      if (y > 0 && z > BOARD_D * 0.25) {
        const w = Math.min(1, (z / (BOARD_D * 0.5) - 0.5) * 2.2);
        col.setXYZ(i, Math.min(1.3, col.getX(i) + w * 0.30), Math.min(1.3, col.getY(i) + w * 0.28),
          Math.min(1.3, col.getZ(i) + w * 0.22));
      }
    }
    P.add(xf(board, TX, BOARD_CY, TZ, TILT, 0, 0), wood);

    // raised lip along the low (near) edge, tilted with the board
    const lip = box(BOARD_W, 0.045, 0.03);
    weather(lip, { tone: 0.85, amp: 0.20 });
    const lipLocalZ = BOARD_D / 2 + 0.005, lipLocalY = BOARD_T / 2 + 0.02;
    // rotate the lip's local offset by TILT about X to sit flush with the board's low edge
    const ly = lipLocalY * Math.cos(TILT) - lipLocalZ * Math.sin(TILT);
    const lz = lipLocalY * Math.sin(TILT) + lipLocalZ * Math.cos(TILT);
    P.add(xf(lip, TX, BOARD_CY + ly, TZ + lz, TILT, 0, 0), wood);

    // the post the board is mounted on, rising from the stretcher to the board's underside
    P.add(weather(xf(cyl(0.035, 0.045, BOARD_CY - DECK - 0.30, 8), TX, DECK + 0.30 + (BOARD_CY - DECK - 0.30) / 2, TZ),
      { tone: 0.78, amp: 0.22 }), wood);
  }

  // Board surface height at a given world-Z offset from TZ (board rotates about X only,
  // so its local Z coincides with that offset). +dz is the near/low edge (toward the
  // anchor), -dz the far/high edge. Small objects resting on the slope use this so they
  // sit flush rather than floating or sinking into the board.
  const boardY = (dz) => BOARD_CY + (BOARD_T / 2) * Math.cos(TILT) - dz * Math.sin(TILT);

  // ---- the chart on the board -------------------------------------------------------------
  // A pale canvas/paper sheet lying on the slant, one corner curled up off the board —
  // charts kept rolled spend their lives fighting to roll back up.
  {
    const sheetZ0 = 0.0;
    const sheet = box(0.46, 0.006, 0.40);
    tint(sheet, 0.82, 0.78, 0.62);
    P.add(xf(sheet, TX + 0.03, boardY(sheetZ0) + 0.003 * Math.cos(TILT), TZ + sheetZ0,
      TILT, 0.06, 0), canvas);

    // curling corner: a second small quad angled up off the sheet's near-right corner
    const curl = box(0.14, 0.005, 0.11);
    tint(curl, 0.85, 0.81, 0.65);
    // parent tilt (board) + extra kick lifting the corner off the surface, near the low edge
    P.add(xf(curl, TX + 0.22, boardY(0.16) + 0.05, TZ + 0.16,
      TILT - 0.55, 0.06, -0.10), canvas);
  }

  // ---- brass paperweight, holding the sheet's far (high) corner down ----------------------
  {
    const wZ = -0.12;
    const wY = boardY(wZ) + 0.025 * Math.cos(TILT);
    P.add(xf(cyl(0.035, 0.045, 0.05, 10), TX - 0.16, wY, TZ + wZ, TILT), brass);
    P.add(xf(new THREE.SphereGeometry(0.014, 8, 6), TX - 0.16, wY + 0.028, TZ + wZ, TILT), brass);
  }

  // ---- lead sounding-weight, pinning the near (low) corner ---------------------------------
  {
    const sZ = 0.10;
    const sY = boardY(sZ) + 0.03 * Math.cos(TILT);
    const sound = lathe([[0, -0.045], [0.028, -0.03], [0.032, 0.01], [0.020, 0.045], [0, 0.05]], 10);
    P.add(weather(xf(sound, TX + 0.15, sY, TZ + sZ, TILT), { tone: 0.70, amp: 0.16 }), iron);
    // its line, coiled loosely beside it
    const line = box(0.09, 0.004, 0.09);
    tint(line, 0.5, 0.46, 0.38);
    P.add(xf(line, TX + 0.19, sY - 0.025, TZ + sZ - 0.06, TILT), canvas);
  }

  // ---- brass dividers, lying open on the sheet ---------------------------------------------
  {
    const dZ = 0.02, dRy = 0.6;
    const dY = boardY(dZ) + 0.006 * Math.cos(TILT);
    const leg = () => box(0.006, 0.006, 0.20);
    for (const s of [-1, 1]) {
      const l = xf(leg(), 0, 0, 0.10, 0, 0, s * 0.18);
      P.add(xf(l, TX - 0.02, dY, TZ + dZ, TILT, dRy, 0), brass);
    }
    P.add(xf(new THREE.SphereGeometry(0.012, 6, 5), TX - 0.02, dY, TZ + dZ, TILT, dRy), brass);
  }

  // ---- pencil stub, rolled down to the low lip ----------------------------------------------
  {
    const pZ = 0.24;
    const pY = boardY(pZ) + 0.008 * Math.cos(TILT);
    P.add(tint(xf(cyl(0.006, 0.006, 0.09, 6), TX - 0.20, pY, TZ + pZ, TILT, 0, 1.4), 0.55, 0.42, 0.24), wood);
    P.add(tint(xf(new THREE.ConeGeometry(0.006, 0.014, 6), TX - 0.20 + 0.047, pY, TZ + pZ, 0, 0, 1.4 + Math.PI / 2),
      0.30, 0.24, 0.16), wood);
  }

  // ---- rolled spare chart in a tube rack under the board ------------------------------------
  // Slung on the stretcher, out of the way of standing feet.
  {
    const rackY = DECK + 0.32, rackZ = TZ - 0.24;
    for (const rx of [TX - 0.18, TX + 0.18]) {
      P.add(weather(xf(tor(0.045, 0.008, 4, 10), rx, rackY, rackZ, Math.PI / 2), { tone: 0.78, amp: 0.2 }), iron);
    }
    const tube = cyl(0.038, 0.038, 0.50, 10, true);
    P.add(weather(xf(tube, TX, rackY, rackZ, 0, 0, Math.PI / 2), { tone: 0.86, amp: 0.18 }), canvas);
    // the curled leading edge of the chart peeking from the tube's mouth
    const peek = box(0.03, 0.006, 0.09);
    tint(peek, 0.80, 0.76, 0.60);
    P.add(xf(peek, TX + 0.25, rackY + 0.03, rackZ, 0, 0, 0.3), canvas);
  }

  // ---- lantern hook on the post, empty ------------------------------------------------------
  {
    const hookY = DECK + 0.30 + (BOARD_CY - DECK - 0.30) / 2 + 0.20;
    P.add(xf(new THREE.TorusGeometry(0.032, 0.008, 5, 10, Math.PI * 1.3), TX + 0.045, hookY, TZ,
      0, Math.PI / 2, 0.3), iron);
  }

  P.bake();

  return { anchor: new THREE.Vector3(-3.3, DECK, 2.95) };
}
