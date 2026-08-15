// The diving davit: frame, sheave, tackle, boarding ladder, descent line, and the
// anchor lantern that marks the raft at night. OWNED BY: davit agent.
//
// A diving davit is a load path, not scenery. It carries a dressed man — 200+ lb of
// lead, brass and rubber — swung outboard so he hangs clear of the hull, and it carries
// his air hose over the same block. Every member below is doing that job: raked legs
// take the vertical load down to gusseted deck pads, tie rods take the overturning
// moment the cantilever creates (a cantilever with no back-stay is one nobody would
// stand under), and the sheave is a strapped fitting with cheeks and a pin, not a torus
// floating in space.
import * as THREE from 'three';
import { Part, cyl, sph, weather } from './kit.js';

const TAU = Math.PI * 2;

// ---- oriented struts ------------------------------------------------------------
// Build-time only: this runs once per member while the davit is assembled, not in any
// per-frame path. Kit's `cyl` sits on +Y; setFromUnitVectors turns that into whatever
// heading the two endpoints demand, then Euler XYZ hands the angles to `xf` the same
// way every other placement in this file works.
const _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0),
  _dir = new THREE.Vector3(), _eu = new THREE.Euler();
function strut(P, mat, x0, y0, z0, x1, y1, z1, r0, r1 = r0, seg = 8) {
  _dir.set(x1 - x0, y1 - y0, z1 - z0);
  const len = _dir.length();
  _dir.normalize();
  _q.setFromUnitVectors(_up, _dir);
  _eu.setFromQuaternion(_q, 'XYZ');
  return P.put(cyl(r0, r1, len, seg), mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, _eu.x, _eu.y, _eu.z);
}

export function buildDavit(group, mats) {
  const P = Part(group);
  const { iron, brass, rope: ropeMat, lead, glass } = mats;

  // Weathering profiles. Only iron and rope carry vertex colours (brass, lead and
  // glass are not in the vertexColors set the kit hands out), so those two buckets get
  // grime and the wet-band treatment where a member actually crosses the waterline.
  const grime = geo => weather(geo, { freq: 0.55, amp: 0.18, rust: 0.30 });
  const wetGrime = geo => weather(geo, { freq: 0.55, amp: 0.18, rust: 0.30, wetY: -0.55 });
  const ropeGrime = geo => weather(geo, { freq: 0.6, amp: 0.16 });
  const ropeWetGrime = geo => weather(geo, { freq: 0.6, amp: 0.16, wetY: -0.55 });

  // ---- geometry --------------------------------------------------------------------
  // hoseHead / HEAD is the sheave groove centre, kept at its prior-round value
  // (0, 3.30, 5.35): it is already outboard of the deck edge (z=4.7) with margin, it
  // is a sane height for a cantilevered head above a 0.11 deck, and the verlet tether
  // elsewhere in the game is tuned against this exact anchor — moving it would ripple
  // into physics nobody asked this file to retune. We rebuild everything AROUND it.
  const HEAD = new THREE.Vector3(0, 3.30, 5.35);
  const DECK_Y = 0.11;
  // GATE is the height/reach above which an overhead member may cross back over the
  // walk lane (x in [-1.1,1.1], z in [1.7,4.7]) — Sal's eye line is 1.46, so anything
  // planted above 2.0 reads as headroom, not an obstruction. Below it, every member
  // in this file stays outside |x| 1.1 while it's inside that z band.
  const GATE_Y = 2.10, GATE_X = 1.20;
  // THE CLIMB LINE. The boarding ladder hangs in the bulwark gap and player.js grabs it
  // inside raft-local |x| < 1.2, z 4.2..5.9; a climbing man's helmet reaches ~2.5 above
  // the deck top. That box is a NO-MEMBER volume for this file. It used to hold the
  // tackle block, the hook, the fall's first leg, the shot line and the last stretch of
  // both raked legs — Sal climbed up through his own gallows (user-reported: "the boom
  // is in the way of the ladder"). Everything below is placed against these three lines.
  const BAY_X = 1.20, BAY_Z0 = 4.20, BAY_Y = DECK_Y + 2.50;   // 2.61
  const FOOT = s => [s * 1.30, DECK_Y, 3.75];
  // The knee is higher and a touch inboard-aft of its old place, so the jib leg has
  // already climbed past 2.73 by the time it crosses z = 4.2 into the bay (was 2.38 —
  // it went through a climber's chest).
  const KNEE = s => [s * 1.25, 2.45, 3.90];
  const PEAK = [0, 3.35, 4.85]; // the knuckle: legs, jib and guys all resolve here

  // ---- legs: raked, gusseted, kinked at a knee knuckle ------------------------------
  for (const s of [-1, 1]) {
    const [fx, fy, fz] = FOOT(s), [kx, ky, kz] = KNEE(s);
    // gusset plate + bolt ring: the difference between a welded foot and a stick
    // shoved into the planking. Low and inside the walk lane's height allowance.
    P.put(cyl(0.20, 0.22, 0.045, 8), iron, fx, DECK_Y + 0.02, fz); // deck pad
    const gusset = P.put(new THREE.BoxGeometry(0.34, 0.05, 0.28), iron, fx, DECK_Y + 0.045, fz);
    grime(gusset);
    for (let i = 0; i < 5; i++) {
      const a = (i + 0.5) / 5 * TAU, r = 0.155;
      grime(P.put(sph(0.026, 6, 4), iron, fx + Math.cos(a) * r, DECK_Y + 0.07, fz + Math.sin(a) * r));
    }
    grime(strut(P, iron, fx, fy, fz, kx, ky, kz, 0.10, 0.085));
    grime(strut(P, iron, kx, ky, kz, PEAK[0], PEAK[1], PEAK[2], 0.085, 0.062));
    grime(P.put(sph(0.06, 8, 6), iron, kx, ky, kz)); // knee knuckle
  }
  grime(P.put(sph(0.11, 8, 6), iron, PEAK[0], PEAK[1], PEAK[2])); // head knuckle
  grime(strut(P, iron, PEAK[0], PEAK[1], PEAK[2], HEAD.x, HEAD.y, HEAD.z, 0.075, 0.058)); // jib

  // ---- guy wires (tie rods): the back-stay that makes the cantilever honest --------
  for (const s of [-1, 1]) {
    const a = [s * 0.28, 3.28, 4.72], b = [s * GATE_X, GATE_Y, 3.35], c = [s * 1.30, DECK_Y, 1.92];
    grime(strut(P, iron, a[0], a[1], a[2], b[0], b[1], b[2], 0.026, 0.022));
    grime(strut(P, iron, b[0], b[1], b[2], c[0], c[1], c[2], 0.022, 0.020));
    // deck ring bolt the tie rod threads through
    const ring = P.put(new THREE.TorusGeometry(0.045, 0.012, 4, 8), iron, c[0], DECK_Y + 0.05, c[2], Math.PI / 2);
    grime(ring);
  }

  // ---- the sheave: strapped shell, cheeks, pin, not a bare torus -------------------
  // Axis runs athwartships (X) so the hose wraps the rim in the vertical plane, up
  // from the reel and down to the water outboard of the transom.
  {
    const { x, y, z } = HEAD;
    for (const sx of [-0.065, 0.065]) grime(P.put(cyl(0.19, 0.19, 0.025, 10, false), iron, x + sx, y, z, 0, 0, Math.PI / 2));
    P.put(cyl(0.17, 0.17, 0.05, 12, false), brass, x, y, z, 0, 0, Math.PI / 2); // the wheel itself
    P.put(cyl(0.024, 0.024, 0.24, 6, false), brass, x, y, z, 0, 0, Math.PI / 2); // the pin
    for (const sx of [-0.09, 0.09]) grime(strut(P, iron, x + sx, y, z, sx * 0.3, y + 0.10, z, 0.018, 0.016)); // strap up to the jib
  }

  // ---- tackle: heavy block, hook, becket, fall to a deck cleat ---------------------
  // The whole purchase is swung to STARBOARD of the bay: a davit's tackle is swung off
  // the man, not hung down his throat. TK_X clears BAY_X by the block's own half-width
  // plus a hand's breadth, so nothing here re-enters the climb line at any height.
  {
    const TK_X = BAY_X + 0.25;
    const top = [TK_X, 2.85, 4.85], mid = [TK_X, 2.62, 4.85];
    grime(strut(P, iron, PEAK[0], PEAK[1], PEAK[2], top[0], top[1], top[2], 0.030, 0.028));
    const becket = P.put(new THREE.TorusGeometry(0.05, 0.014, 4, 8), iron, top[0], top[1], top[2], Math.PI / 2);
    grime(becket);
    const block = P.put(new THREE.BoxGeometry(0.22, 0.34, 0.16), iron, mid[0], mid[1], mid[2]);
    grime(block);
    // the hook: a partial torus (kit's tor() has no arc param), open throat facing up
    const hook = P.put(new THREE.TorusGeometry(0.085, 0.018, 5, 10, 4.2), iron, TK_X, 2.30, 4.85, Math.PI, 0, 0);
    grime(hook);
    // fall of rope: hangs from the block, ducks under the walk-lane gate the same way
    // the guys do, and belays to a horn cleat by the leg foot.
    const gate = [GATE_X + 0.15, GATE_Y, 3.90], cleatPos = [1.30, 0.20, 3.70];
    ropeGrime(strut(P, ropeMat, TK_X, 2.28, 4.85, gate[0], gate[1], gate[2], 0.022));
    ropeGrime(strut(P, ropeMat, gate[0], gate[1], gate[2], cleatPos[0], cleatPos[1], cleatPos[2], 0.022));
    const cbase = P.put(new THREE.BoxGeometry(0.16, 0.05, 0.06), iron, cleatPos[0], cleatPos[1], cleatPos[2]);
    grime(cbase);
    for (const sx of [-1, 1]) {
      const horn = strut(P, iron, cleatPos[0] + sx * 0.03, cleatPos[1] + 0.02, cleatPos[2],
        cleatPos[0] + sx * 0.11, cleatPos[1] + 0.09, cleatPos[2], 0.016, 0.010);
      grime(horn);
    }
  }

  // ---- boarding ladder: hangs in the bulwark gap hull.js leaves at x in [-1.1,1.1]
  // on the +Z rail. Built by hand (not kit's ladder()) so every rung can carry the
  // waterline wear it actually crosses. z=4.78 sits just outboard of the rail for its
  // full run, which keeps it clear of the walk-lane box regardless of height.
  {
    const LX = 0.275, LZ = 4.78, Y0 = -1.6, Y1 = 0.85, RUNGS = 9, rad = 0.04;
    for (const sx of [-1, 1]) {
      wetGrime(P.put(cyl(rad, rad, Y1 - Y0, 6, false), iron, sx * LX, (Y0 + Y1) / 2, LZ));
    }
    for (let i = 0; i < RUNGS; i++) {
      const ry = Y0 + (i + 0.5) / RUNGS * (Y1 - Y0);
      wetGrime(P.put(cyl(rad * 0.8, rad * 0.8, LX * 2, 6, false), iron, 0, ry, LZ, 0, 0, Math.PI / 2));
    }
  }

  // ---- descent line: a shot line and lead weight into the water beside the ladder --
  {
    // Also swung starboard of the bay, alongside the tackle it hangs beside: at x 0.7 it
    // ran straight down through the climb line for its whole length.
    const pts = [[1.42, 3.02, 4.92], [1.47, 0.50, 4.86], [1.52, -1.20, 4.80], [1.55, -2.50, 4.78]];
    const c = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)));
    const line = P.add(new THREE.TubeGeometry(c, 16, 0.028, 5, false), ropeMat);
    ropeWetGrime(line);
    P.put(cyl(0.012, 0.06, 0.16, 8, false), lead, 1.55, -2.62, 4.78); // shot weight
  }

  // ---- the anchor lantern: brass housing, caged glass, vent cowl, bail ------------
  // Hangs from a short bracket off the head knuckle so it reads as a fitting, not a
  // bare bulb. The glass is a small recessed cylinder — a few cm of visible area, not
  // a glowing sphere — set well inside the rib radius and shrouded top and bottom by
  // solid brass caps, so eight ribs plus that recess leave only narrow slots exposed.
  // Daylight sees brass; only close up at night does the slot of glass between the
  // ribs read as lit. That's what stops the bloom halo: geometry that occludes itself,
  // not a dimmer on the emissive (the orchestrator tunes bloom/glow separately).
  // Hung 0.12 higher than it was: its base cap sat 0.11 above the climb line's ceiling,
  // which is not a margin, it is a coincidence. Now it clears a climbing helmet by 0.23.
  const BR = [-0.40, 3.28, 4.60], TOP = [-0.55, 3.10, 4.50];
  grime(strut(P, iron, BR[0], BR[1], BR[2], TOP[0], TOP[1], TOP[2], 0.028, 0.024));
  const capY = TOP[1], cowlY = capY - 0.045, shoulderY = capY - 0.105, cageY = capY - 0.175, footY = capY - 0.255;
  P.put(cyl(0.05, 0.055, 0.04, 8, false), brass, TOP[0], capY, TOP[2]); // mount cap
  P.put(new THREE.TorusGeometry(0.085, 0.012, 4, 8, Math.PI), brass, TOP[0], capY + 0.02, TOP[2]); // bail
  P.put(cyl(0.028, 0.075, 0.09, 8, false), brass, TOP[0], cowlY, TOP[2]); // vent cowl
  P.put(cyl(0.085, 0.075, 0.03, 8, false), brass, TOP[0], shoulderY, TOP[2]); // shoulder cap
  const RIBS = 8, RIB_R = 0.078;
  for (let i = 0; i < RIBS; i++) {
    const a = i / RIBS * TAU;
    P.put(cyl(0.013, 0.013, 0.13, 4, false), brass, TOP[0] + Math.cos(a) * RIB_R, cageY, TOP[2] + Math.sin(a) * RIB_R);
  }
  P.put(cyl(0.07, 0.05, 0.035, 8, false), brass, TOP[0], footY, TOP[2]); // base cap

  // recessed well inside RIB_R (0.078) so the ribs shroud it further at any oblique
  // angle than their own angular width alone would suggest — a slot, not a window.
  const lampGlass = new THREE.Mesh(cyl(0.045, 0.045, 0.045, 10, false), glass);
  lampGlass.position.set(TOP[0], cageY, TOP[2]);
  lampGlass.castShadow = false;
  group.add(lampGlass);
  const lampPos = new THREE.Vector3(TOP[0], cageY, TOP[2]);

  P.bake();
  return { hoseHead: HEAD, lampGlass, lampPos };
}
