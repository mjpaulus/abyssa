// THE BROOD — Velkath's nest, eggs and the trail to them (roadmap/three-sleepers.md,
// spec §2 zone 0 and §3). Owned by the Brooder: built into her L.grp, so a zone change,
// voyage or reseed disposes it with her (disposeSleeper's traversal).
//
// The rite, in the world's own grammar:
//   * she sleeps over the zone-0 rift, a reef-crusted ridge in the silt;
//   * a trail of many-legged tracks runs from the open seabed toward her nest in her
//     lee, past the broken shells of an old clutch — found, not signposted;
//   * the nest holds three eggs, each the size of Sal's helmet, faintly warm;
//   * taking one wakes her (brooder.js hears it through brood.onTake);
//   * her last ward will not light while any egg is out of the nest; with all three
//     back it lights on its own.
// Eggs are carried one at a time, held at Sal's side, taken/returned with [E].
import * as THREE from 'three';
import { V3, clamp } from '../../lib/math.js';
import { seededRand } from '../../lib/textures.js';
import { registerPaint } from '../../lib/paint.js';
import { envTexDeep as envTex } from '../../core.js';
import { terrainH, terrainNormal } from '../../world/terrain.js';

const TAU = Math.PI * 2;
const TAKE_R = 3.2, NEST_R = 5.5;
const _v = V3(), _n = V3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = V3(), _up = V3(0, 1, 0);

// One egg: a blunt ovoid, pale and slightly translucent-looking, with a slow warm pulse
// inside — warm in the cold, the one soft thing in her whole world.
function eggGeo() {
  const g = new THREE.SphereGeometry(1, 28, 20);
  const p = g.attributes.position, c = new Float32Array(p.count * 3), rnd = seededRand(0xE665);
  const spots = Array.from({ length: 22 }, () => [rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1]);
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = y > 0 ? 1 - 0.18 * y : 1;                        // the narrow end up
    x *= 0.52 * k; z *= 0.52 * k; y *= 0.70;
    p.setXYZ(i, x, y, z);
    let d = 1;
    for (const [a, b, e] of spots) d = Math.min(d, Math.hypot(x / 0.52 - a, y / 0.7 - b, z / 0.52 - e));
    const m = 0.78 + 0.22 * Math.min(1, d * 3.2);               // faint mottling
    c[i * 3] = m; c[i * 3 + 1] = m * 0.97; c[i * 3 + 2] = m * 0.90;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.computeVertexNormals();
  return g;
}

// A shell shard: a curved fragment cut from a sphere, broken edge up.
function shardGeo() {
  const g = new THREE.SphereGeometry(1, 8, 6, 0, 1.3, 0.3, 1.0);
  g.scale(0.52, 0.7, 0.52);
  return g;
}

export function makeBrood(L, idx, nestPos, trailFrom) {
  const grp = L.grp;
  const rnd = seededRand(0xB700D + idx * 131 + Math.round(nestPos.x * 7 + nestPos.z * 13));
  const B = {
    nest: nestPos.clone(), eggs: [], held: -1, taken: 0, woke: false,
    found: { tracks: false, shells: false, nest: false, ridge: false },
    trailA: trailFrom.clone(), shellsAt: V3(), t: 0
  };
  B.nest.y = terrainH(B.nest.x, B.nest.z, idx);

  // ---- the nest: a shallow ring of heaped silt and stones, darker in the bowl ----
  const sandMat = registerPaint(new THREE.MeshStandardMaterial({ color: 0x6f6858, roughness: 0.95, metalness: 0 }));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(NEST_R * 0.82, 0.9, 8, 40), sandMat);
  ring.rotation.x = Math.PI / 2;
  ring.scale.z = 0.45;
  ring.position.copy(B.nest).y += 0.1;
  ring.receiveShadow = true;
  grp.add(ring);
  const bowl = new THREE.Mesh(new THREE.CircleGeometry(NEST_R * 0.8, 32), new THREE.MeshBasicMaterial({
    color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false
  }));
  bowl.rotation.x = -Math.PI / 2;
  bowl.position.copy(B.nest).y += 0.06;
  bowl.renderOrder = -1;
  grp.add(bowl);
  const stoneGeo = new THREE.DodecahedronGeometry(1, 0);
  const stones = new THREE.InstancedMesh(stoneGeo, sandMat, 14);
  for (let k = 0; k < 14; k++) {
    const a = k / 14 * TAU + rnd() * 0.3, r = NEST_R * (0.85 + 0.25 * rnd());
    const x = B.nest.x + Math.cos(a) * r, z = B.nest.z + Math.sin(a) * r, s = 0.5 + 0.7 * rnd();
    stones.setMatrixAt(k, _m.compose(_v.set(x, terrainH(x, z, idx) + s * 0.3, z),
      _q.setFromEuler(new THREE.Euler(rnd() * 3, rnd() * 3, rnd() * 3)), _s.set(s, s * 0.7, s)));
  }
  stones.instanceMatrix.needsUpdate = true;
  stones.castShadow = stones.receiveShadow = true;
  grp.add(stones);

  // ---- the clutch ----
  const eggMat = registerPaint(new THREE.MeshStandardMaterial({
    color: 0xe2dccb, roughness: 0.32, metalness: 0, vertexColors: true, envMap: envTex, envMapIntensity: 0.5,
    emissive: 0x9a6428, emissiveIntensity: 0.25
  }), { hero: true });
  B.eggMat = eggMat;
  const eg = eggGeo();
  for (let k = 0; k < 3; k++) {
    const a = k / 3 * TAU + 0.4, home = V3(B.nest.x + Math.cos(a) * 1.3, 0, B.nest.z + Math.sin(a) * 1.3);
    home.y = terrainH(home.x, home.z, idx) + 0.55;
    const mesh = new THREE.Mesh(eg, eggMat);
    mesh.position.copy(home);
    mesh.rotation.set(rnd() * 0.3, rnd() * TAU, rnd() * 0.3);
    mesh.castShadow = true;
    grp.add(mesh);
    B.eggs.push({ mesh, home, inNest: true, tilt: mesh.rotation.clone() });
  }

  // ---- the old clutch: broken shells on the approach ----
  _v.subVectors(trailFrom, B.nest).setY(0).normalize();
  B.shellsAt.copy(B.nest).addScaledVector(_v, 16);
  const shards = new THREE.InstancedMesh(shardGeo(), eggMat, 12);
  for (let k = 0; k < 12; k++) {
    const x = B.shellsAt.x + (rnd() - 0.5) * 7, z = B.shellsAt.z + (rnd() - 0.5) * 7;
    shards.setMatrixAt(k, _m.compose(_v.set(x, terrainH(x, z, idx) + 0.05, z),
      _q.setFromEuler(new THREE.Euler(Math.PI + (rnd() - 0.5) * 1.2, rnd() * TAU, (rnd() - 0.5) * 1.2)), _s.setScalar(0.5 + 0.5 * rnd())));
  }
  shards.instanceMatrix.needsUpdate = true;
  grp.add(shards);
  B.shellsAt.y = terrainH(B.shellsAt.x, B.shellsAt.z, idx);

  // ---- the trail: rows of paired pits, many legs, from the open seabed to the nest ----
  const pitGeo = new THREE.CircleGeometry(0.55, 10);
  pitGeo.rotateX(-Math.PI / 2);
  pitGeo.scale(1, 1, 1.6);
  const pits = new THREE.InstancedMesh(pitGeo, new THREE.MeshBasicMaterial({
    color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false
  }), 160);
  pits.renderOrder = -1;
  let n = 0;
  const steps = 40;
  for (let k = 0; k < steps && n < 160; k++) {
    const f = k / (steps - 1);
    // a gentle curve, not a ruler line
    const bend = Math.sin(f * Math.PI) * 14;
    _v.lerpVectors(trailFrom, B.nest, f * 0.93);
    const dx = B.nest.x - trailFrom.x, dz = B.nest.z - trailFrom.z, dl = Math.hypot(dx, dz) || 1;
    const px = -dz / dl, pz = dx / dl, yaw = Math.atan2(dx, dz);
    const cx = _v.x + px * bend, cz = _v.z + pz * bend;
    for (const sd of [-1, 1]) for (const off of [11, 15]) {
      if (n >= 160) break;
      const x = cx + px * sd * off + (rnd() - 0.5) * 1.2, z = cz + pz * sd * off + (rnd() - 0.5) * 1.2;
      _n.copy(terrainNormal(x, z, idx));
      _q.setFromUnitVectors(_up, _n).multiply(new THREE.Quaternion().setFromAxisAngle(_up, yaw + (rnd() - 0.5) * 0.5));
      pits.setMatrixAt(n++, _m.compose(_v.set(x, terrainH(x, z, idx) + 0.04, z), _q, _s.setScalar(0.8 + 0.5 * rnd())));
    }
  }
  pits.count = n;
  pits.instanceMatrix.needsUpdate = true;
  grp.add(pits);
  B.trailA.y = terrainH(B.trailA.x, B.trailA.z, idx);

  // ---- behaviour ----
  B.out = () => B.eggs.filter(e => !e.inNest).length;
  B.nearEgg = pos => {
    if (B.held >= 0) return -1;
    let best = -1, bd = TAKE_R;
    for (let k = 0; k < B.eggs.length; k++) {
      const e = B.eggs[k];
      if (!e.inNest) continue;
      const d = e.mesh.position.distanceTo(pos);
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  };
  B.nearNest = pos => Math.hypot(pos.x - B.nest.x, pos.z - B.nest.z) < NEST_R + 1.5 && Math.abs(pos.y - B.nest.y) < 6;
  // The HUD prompt for the E key, or null.
  B.prompt = pos => {
    if (B.held >= 0) return B.nearNest(pos) ? '[E] SET THE EGG BACK' : null;
    return B.nearEgg(pos) >= 0 ? '[E] TAKE THE EGG' : null;
  };
  // [E]: returns { took, returned } or null. brooder.js wakes on the first take.
  B.interact = pos => {
    if (B.held >= 0) {
      if (!B.nearNest(pos)) return null;
      const e = B.eggs[B.held];
      e.inNest = true;
      e.mesh.position.copy(e.home);
      e.mesh.rotation.copy(e.tilt);
      B.held = -1;
      const out = B.out();
      return { returned: true, out, msg: out ? (out === 1 ? 'ONE EGG STILL OUT OF THE NEST.' : out + ' EGGS STILL OUT OF THE NEST.') : 'THE CLUTCH IS WHOLE.' };
    }
    const k = B.nearEgg(pos);
    if (k < 0) return null;
    B.eggs[k].inNest = false;
    B.held = k;
    B.taken++;
    if (B.onTake) B.onTake(B.taken);
    return { took: true, first: B.taken === 1, msg: B.taken === 1 ? null : 'ANOTHER EGG. SHE KNOWS.' };
  };
  // Per frame: the held egg rides at Sal's side; the clutch breathes its slow warmth;
  // the trail announces itself once each as it is found.
  B.update = (dt, player, ev) => {
    B.t += dt;
    B.eggMat.emissiveIntensity = 0.20 + 0.10 * Math.sin(B.t * 0.9);
    if (B.held >= 0) {
      const e = B.eggs[B.held], yaw = player.yaw || 0;
      e.mesh.position.set(player.pos.x + Math.sin(yaw) * 0.9 + Math.cos(yaw) * 0.6, player.pos.y + 0.9, player.pos.z + Math.cos(yaw) * 0.9 - Math.sin(yaw) * 0.6);
      e.mesh.rotation.set(0.2 * Math.sin(B.t * 1.3), yaw, 0.15 * Math.sin(B.t * 0.9));
    }
    if (ev.msg) return;
    const F = B.found, p = player.pos;
    const near = (q, r) => Math.hypot(p.x - q.x, p.z - q.z) < r && Math.abs(p.y - q.y) < 10;
    if (!F.tracks && near(B.trailA, 30)) { F.tracks = true; ev.msg = 'TRACKS IN THE SILT. MANY LEGS, AND HEAVY.'; }
    else if (!F.shells && near(B.shellsAt, 10)) { F.shells = true; ev.msg = 'SHELL, BROKEN FROM THE INSIDE. AN OLD CLUTCH.'; }
    else if (!F.nest && near(B.nest, 12)) { F.nest = true; ev.msg = 'A NEST. EGGS THE SIZE OF YOUR HELMET, WARM IN THE COLD.'; }
  };
  return B;
}
