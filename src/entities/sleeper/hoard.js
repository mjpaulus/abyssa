// THE HOARD — Orune's lair (roadmap/three-sleepers.md, spec §2 zone 1 and §3). Owned by
// the Hoarder: built into her L.grp so zone changes, voyages and reseeds dispose it.
//
// Every light the deep ever took, gathered round the broken trawler: drowned lanterns in
// the silt, still burning low, and at the heart of it the ship's own lamp set up on a
// crate like an altar. A line of lanterns she dropped on the way in leads a diver to it.
// Taking the lamp wakes her (hoarder.js hears it through hoard.onTake); as she rises the
// hoard's lights go out one by one, as if she were drawing them in. Calmed, she lets him
// keep it: the lamp refills Sal's lantern twice as fast (game.js, player.hasLamp).
// Glows are sprites only — never PointLights (the scene's light count is sacred).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { V3 } from '../../lib/math.js';
import { seededRand, makeGlow } from '../../lib/textures.js';
import { registerPaint } from '../../lib/paint.js';
import { envTexDeep as envTex } from '../../core.js';
import { terrainH } from '../../world/terrain.js';
import { lanternParts, shipLampParts, crateParts, woodMaps } from './hoarderGeo.js';

// The chimney glass: its grime (vertex colour) dims its own glow, not just its tint.
function grimeGlow(m) {
  m.customProgramCacheKey = () => 'abyssa-hoard-glass';
  m.onBeforeCompile = sh => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      #ifdef USE_COLOR
        totalEmissiveRadiance *= vColor.rgb;
      #endif`);
  };
  return m;
}

const TAU = Math.PI * 2, TAKE_R = 3.6, IDENT = new THREE.Matrix4();
const _v = V3();

export function makeHoard(L, idx, center, trailFrom) {
  const grp = L.grp, rnd = seededRand(0x40A2D + idx * 977);
  const H = { lamp: null, lampTaken: false, lights: [], found: { trail: false, hoard: false, arms: false }, center: center.clone(), trailA: trailFrom.clone(), dark: -1, t: 0 };
  H.center.y = terrainH(H.center.x, H.center.z, idx);
  H.trailA.y = terrainH(H.trailA.x, H.trailA.z, idx);

  // polish-sleepers2: built props. Brass carries patina (verdigris low and in the joints,
  // tarnish, worn edges) in vertex colour; the glass chimney's grime gradient multiplies
  // its own glow (a sooted crown, a clean band at the flame). The 17 hoard lanterns are
  // TWO instanced draws (brass, glass) where they were 34 meshes.
  const brass = registerPaint(new THREE.MeshStandardMaterial({ color: 0xc09a58, vertexColors: true, roughness: 0.38, metalness: 0.85, envMap: envTex, envMapIntensity: 1.0 }));
  const glass = grimeGlow(new THREE.MeshStandardMaterial({ color: 0x3a3226, vertexColors: true, roughness: 0.08, metalness: 0, envMap: envTex, envMapIntensity: 1.2, emissive: 0xffb45a, emissiveIntensity: 0.9 }));
  H.glass = glass;
  const LP = lanternParts(), mats = [], dummy = new THREE.Object3D();
  const put = (x, z, s, tilt, bright) => {
    const y = terrainH(x, z, idx);
    dummy.position.set(x, y - 0.05 * s, z);
    dummy.scale.setScalar(s);
    dummy.rotation.set(tilt * (rnd() - 0.5), rnd() * TAU, tilt * (rnd() - 0.5));
    dummy.updateMatrix();
    mats.push(dummy.matrix.clone());
    // fog OFF with its own distance curve (the vent-ember lesson: per-channel fog turns a
    // warm glow teal and then to nothing in metres) — the hoard is zone 1's far beacon
    const glow = makeGlow(0xffb466, 2.2 * s);
    glow.material.fog = false;
    glow.position.set(x, y + 0.38 * s, z);
    glow.material.opacity = 0.55 * bright;
    grp.add(glow);
    H.lights.push({ glow, inst: mats.length - 1, base: 0.55 * bright, phase: rnd() * TAU, on: 1, s });
  };

  // the hoard: a ring of lanterns round the lair, some on their sides
  for (let k = 0; k < 11; k++) {
    const a = k / 11 * TAU + rnd() * 0.4, r = 6 + rnd() * 12;
    put(H.center.x + Math.cos(a) * r, H.center.z + Math.sin(a) * r, 0.9 + rnd() * 0.8, rnd() < 0.4 ? 2.2 : 0.3, 0.7 + 0.3 * rnd());
  }
  // the altar: a planked crate with iron corners, and on it the ship's lamp
  const wm = woodMaps();
  L.keepTex.add(wm.map); L.keepTex.add(wm.normalMap);
  const CP = crateParts();
  const crate = new THREE.Group();
  // one draw: the iron is merged into the planks, told apart by its dark rusted vertex colour
  const wood = new THREE.Mesh(mergeGeometries([CP.wood, CP.iron]), registerPaint(new THREE.MeshStandardMaterial({ map: wm.map, normalMap: wm.normalMap, vertexColors: true, roughness: 0.86, metalness: 0, envMap: envTex, envMapIntensity: 0.25 })));
  CP.wood.dispose(); CP.iron.dispose();
  wood.castShadow = wood.receiveShadow = true;
  crate.add(wood);
  crate.position.set(H.center.x, H.center.y + 0.6, H.center.z);
  crate.rotation.y = rnd() * TAU;
  grp.add(crate);
  const SL = shipLampParts(), LAMP_S = 1.9;
  // the lamp and its lens are one-instance InstancedMeshes: they share the lanterns' programs
  H.lamp = new THREE.InstancedMesh(SL.brass, brass, 1);
  H.lamp.setMatrixAt(0, IDENT);
  H.lamp.scale.setScalar(LAMP_S);
  H.lamp.position.set(H.center.x, H.center.y + 1.3, H.center.z);
  H.lamp.rotation.y = crate.rotation.y;
  H.lamp.castShadow = true;
  grp.add(H.lamp);
  const lampGlass = grimeGlow(glass.clone());                  // clone() drops onBeforeCompile
  lampGlass.emissiveIntensity = 1.4;
  const lampLens = new THREE.InstancedMesh(SL.glass, lampGlass, 1);
  lampLens.setMatrixAt(0, IDENT);
  lampLens.scale.setScalar(LAMP_S);
  lampLens.position.copy(H.lamp.position);
  lampLens.rotation.y = crate.rotation.y;
  grp.add(lampLens);
  const lampGlow = makeGlow(0xffc070, 7);
  lampGlow.material.fog = false;
  lampGlow.position.set(H.center.x, H.center.y + 1.3 + 0.8, H.center.z);
  lampGlow.material.opacity = 0.75;
  grp.add(lampGlow);
  H.lampParts = [H.lamp, lampLens, lampGlow];
  H.lampPos = lampGlow.position.clone();

  // the trail: lanterns she let fall on the way in, leading to her
  for (let k = 0; k < 6; k++) {
    const f = (k + 0.5) / 6;
    _v.lerpVectors(trailFrom, H.center, f * 0.85);
    const bend = Math.sin(f * Math.PI) * 10;
    const dx = H.center.x - trailFrom.x, dz = H.center.z - trailFrom.z, dl = Math.hypot(dx, dz) || 1;
    put(_v.x - dz / dl * bend, _v.z + dx / dl * bend, 0.9, 2.4, 0.8);
  }

  const lb = new THREE.InstancedMesh(LP.brass, brass, mats.length), lgl = new THREE.InstancedMesh(LP.glass, glass, mats.length);
  for (let k = 0; k < mats.length; k++) { lb.setMatrixAt(k, mats[k]); lgl.setMatrixAt(k, mats[k]); }
  lb.castShadow = true;
  grp.add(lb, lgl);

  // ---- the generic rite interface game.js drives with [E] ----
  H.prompt = pos => (!H.lampTaken && pos.distanceTo(H.lampPos) < TAKE_R + 1.5) ? "[E] TAKE THE SHIP'S LAMP" : null;
  H.interact = pos => {
    if (H.lampTaken || pos.distanceTo(H.lampPos) > TAKE_R + 1.5) return null;
    H.lampTaken = true;
    for (const p of H.lampParts) p.visible = false;
    if (H.onTake) H.onTake();
    return { took: true, first: true, lamp: true, msg: null };
  };
  // Her waking draws the hoard's light in: one lantern out every half second.
  H.darken = () => { if (H.dark < 0) H.dark = 0; };
  H.update = (dt, player, ev) => {
    H.t += dt;
    if (H.dark >= 0) H.dark += dt;
    for (let k = 0; k < H.lights.length; k++) {
      const q = H.lights[k];
      if (H.dark >= 0 && H.dark > k * 0.5) q.on = Math.max(0, q.on - dt * 1.5);
      const flick = 0.85 + 0.15 * Math.sin(H.t * 7.3 + q.phase) * Math.sin(H.t * 2.1 + q.phase * 1.7);
      // distance: dim and SWELLING with range (murk grows halos), gone past ~150 u
      const d = q.glow.position.distanceTo(player.pos);
      const far = 1 - Math.min(1, Math.max(0, (d - 40) / 110));
      q.glow.material.opacity = q.base * q.on * flick * (0.35 + 0.65 * far) * (d > 150 ? 0 : 1);
      q.glow.scale.setScalar(q.s * (2.2 + Math.min(4, d * 0.035)));
      q.glow.visible = q.on > 0.01;
    }
    glass.emissiveIntensity = 0.9 * (H.dark < 0 ? 1 : Math.max(0.05, 1 - H.dark / (H.lights.length * 0.5)));
    if (ev.msg) return;
    const p = player.pos, F = H.found;
    const near = (q, r) => Math.hypot(p.x - q.x, p.z - q.z) < r && Math.abs(p.y - q.y) < 12;
    if (!F.trail && near(H.trailA, 45)) { F.trail = true; ev.msg = 'A LANTERN, DROWNED. STILL BURNING.'; }
    else if (!F.hoard && near(H.center, 24)) { F.hoard = true; ev.msg = 'A HOARD OF LIGHTS. EVERY LAMP THE DEEP EVER TOOK.'; }
  };
  return H;
}
