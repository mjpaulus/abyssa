// MHOR, THE HUNTER — zone 2's sleeper (roadmap/three-sleepers.md, spec §2).
// A squid-like colossus: a furnace-red torpedo mantle ~36 u long with a fin running each
// side of its tail, great eyes, eight arms and two hunting tentacles with clubs, rows of
// photophores that pulse when he hunts. He is NOT in the zone. The zone is cold: its
// tallest black smoker, THE LAST FURNACE, is dead, with cold stumps round it. Feeding the
// furnace bitumen relights it — and the field wakes: a warm pocket where the air comes
// easy (the biggest practical reward in the game at the depth the hose is the leash).
// Mhor hunts heat. A little after the fire takes, photophores come up out of the black.
//
// He never stops moving: he circles the diver out in the dark, then STRIKES — turns and
// drives through him arms-first, tentacles shooting out. A hit throws Sal and tears the
// dress. Ink (Q) inside his line breaks the strike. His weakness is the furnace: a strike
// that runs through the flare blinds him; he stalls in the glow, stunned, sinking, and
// that is when his wards (on the mantle, kept by his squid as zone 2 always was) can be
// reached. Calmed, he sinks back into the deep; the furnace burns on.
import * as THREE from 'three';
import { scene, envTexDeep as envTex } from '../../core.js';
import { V3, clamp, lerp } from '../../lib/math.js';
import { seededRand, makeGlow, canvas2d, toTexture, normalFromHeight } from '../../lib/textures.js';
import { registerPaint } from '../../lib/paint.js';
import { terrainH } from '../../world/terrain.js';
import { setWardTargets, wardGuardCount } from '../../world/predators.js';
import { riftPos, WORLD_R } from '../../config.js';
import { survival } from '../../systems/survival.js';
import {
  setLive, SIGIL_POOL_N, ensureSigilPool, makeWard, wardIdle, wardLitPose, wardTouch, wardFlashes, makeEmbers
} from './common.js';

const TAU = Math.PI * 2;
const smooth = THREE.MathUtils.smoothstep;
const sst = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const UP = V3(0, 1, 0);
const ML_OF_SIZE = 3.6, NA = 10, RINGS = 28, RADIAL = 10;
const FEED_COST = 2, FEED_R = 5, POCKET_R = 28, FLARE_R = 22;
const _a = V3(), _b = V3(), _c = V3(), _d = V3(), _t = V3(), _p = V3(), _f = V3(), _r = V3(), _w = V3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = V3();

// ---- geometry -------------------------------------------------------------------------
// The mantle along +Z (0 = head end at the arms, L at the tail tip), lathed: a head bulb,
// a waist, the long barrel, the fin-bearing taper. Unit: mantle length 1.
function mantleGeo(rows = 72, radial = 36) {
  const pos = [], uv = [], col = [], idx = [];
  const prof = s => {
    const head = 0.075 * Math.exp(-Math.pow((s - 0.06) / 0.07, 2));
    const barrel = 0.095 * Math.pow(Math.sin(Math.PI * Math.min(1, s * 1.05 + 0.02)), 0.55);
    return Math.max(0.004, Math.max(head, barrel) * (1 - 0.85 * sst(0.70, 1.0, s)) + 0.004);
  };
  for (let i = 0; i <= rows; i++) {
    const s = i / rows, r = prof(s);
    for (let j = 0; j <= radial; j++) {
      const a = (j % radial) / radial * TAU, ca = Math.cos(a), sa = Math.sin(a);
      const flat = 1 - 0.18 * Math.pow(Math.abs(sa), 4);
      pos.push(ca * r * 1.05, sa * r * flat, s);
      uv.push(s * 4, j / radial);
      const belly = sst(0.2, -0.9, sa), c = 0.85 + 0.15 * Math.sin(s * 60 + a * 3);
      col.push(c + 0.5 * belly, c + 0.25 * belly, c + 0.2 * belly);
    }
  }
  for (let i = 0; i < rows; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.userData.prof = prof;
  return g;
}
// One fin: a thin rhombic flap along the tail, unit mantle space, +X side.
function finGeo() {
  const sh = new THREE.Shape();
  sh.moveTo(0, 0.62); sh.quadraticCurveTo(0.14, 0.80, 0.10, 0.97); sh.lineTo(0, 0.99); sh.lineTo(0, 0.62);
  const g = new THREE.ShapeGeometry(sh, 10);
  g.rotateX(Math.PI / 2);                                           // shape Y -> +Z along the mantle
  g.scale(1, 1, -1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, -p.getZ(i));
  g.computeVertexNormals();
  return g;
}
// Hide: deep red-brown chromatophore mottle with a darker dorsal band; photophore dots as
// an emissive map in rows down the flanks.
let _hide = null;
function hideMaps(S = 512) {
  if (_hide) return _hide;
  const A = canvas2d(S), H = canvas2d(S), E = canvas2d(S);
  const ai = A.ctx.createImageData(S, S), hi = H.ctx.createImageData(S, S), ei = E.ctx.createImageData(S, S);
  const rnd = seededRand(0x40FF);
  const cells = Array.from({ length: 300 }, () => [rnd(), rnd(), 0.5 + 0.5 * rnd()]);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, i = (y * S + x) * 4;
    let f1 = 9, tone = 1;
    for (const [cx, cy, t] of cells) {
      let dx = Math.abs(u - cx); dx = Math.min(dx, 1 - dx);
      let dy = Math.abs(v - cy); dy = Math.min(dy, 1 - dy);
      const d = dx * dx + dy * dy;
      if (d < f1) { f1 = d; tone = t; }
    }
    const spot = 1 - sst(0.00005, 0.0006, f1);
    const dorsal = sst(0.15, 0.30, v) * (1 - sst(0.70, 0.85, v));   // v runs round the body
    const r = (0.36 - 0.14 * spot * tone) * (1 - 0.35 * dorsal), g = (0.10 - 0.04 * spot) * (1 - 0.3 * dorsal), b = 0.07;
    ai.data[i] = r * 255; ai.data[i + 1] = g * 255; ai.data[i + 2] = b * 255; ai.data[i + 3] = 255;
    hi.data[i] = hi.data[i + 1] = hi.data[i + 2] = (0.5 + 0.4 * spot) * 255; hi.data[i + 3] = 255;
    // photophores: two rows each flank (v ~ 0.02/0.48 are the flanks), dots every ~1/24 in u
    const row = Math.min(Math.abs(v - 0.02), Math.abs(v - 0.98), Math.abs(v - 0.48), Math.abs(v - 0.52));
    const du = Math.abs(((u * 24) % 1) - 0.5) / 24;
    const ph = 1 - sst(0.0, 0.010, Math.hypot(du, row));
    ei.data[i] = ei.data[i + 1] = ei.data[i + 2] = ph * 255; ei.data[i + 3] = 255;
  }
  A.ctx.putImageData(ai, 0, 0); H.ctx.putImageData(hi, 0, 0); E.ctx.putImageData(ei, 0, 0);
  _hide = { map: toTexture(A.canvas, 1, true), normalMap: toTexture(normalFromHeight(H.canvas, 2)), emissiveMap: toTexture(E.canvas, 1, true) };
  return _hide;
}
function tubeGeo() {
  const g = new THREE.BufferGeometry(), nv = (RINGS + 1) * (RADIAL + 1);
  const uv = new Float32Array(nv * 2), col = new Float32Array(nv * 3), idx = [];
  for (let i = 0; i <= RINGS; i++) for (let j = 0; j <= RADIAL; j++) {
    const k = i * (RADIAL + 1) + j, a = (j % RADIAL) / RADIAL * TAU;
    uv[k * 2] = i / RINGS * 5; uv[k * 2 + 1] = j / RADIAL;
    const pale = sst(0.2, -0.8, Math.cos(a));
    col[k * 3] = 0.9 + 0.4 * pale; col[k * 3 + 1] = 0.9 + 0.2 * pale; col[k * 3 + 2] = 0.9 + 0.2 * pale;
  }
  for (let i = 0; i < RINGS; i++) for (let j = 0; j < RADIAL; j++) {
    const a = i * (RADIAL + 1) + j, b = a + RADIAL + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  return g;
}
// A black smoker, lathed and lumpy; `h` tall, base radius `r`.
function chimneyGeo(h, r, seed) {
  const rnd = seededRand(seed), P = [];
  for (let k = 0; k <= 16; k++) {
    const s = k / 16;
    P.push(new THREE.Vector2(r * (1 - 0.62 * s) * (0.85 + 0.3 * rnd()) + (s > 0.94 ? r * 0.2 : 0), s * h));
  }
  P.push(new THREE.Vector2(r * 0.18, h * 0.97));                     // the bore
  const g = new THREE.LatheGeometry(P, 14);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), y = p.getY(i), k = 1 + 0.12 * Math.sin(y * 1.7 + Math.atan2(z, x) * 3);
    p.setX(i, x * k); p.setZ(i, z * k);
  }
  g.computeVertexNormals();
  return g;
}

// ---- build ----------------------------------------------------------------------------
export function makeHunter(idx, cfg) {
  let c = cfg;
  if (c.nSigils > SIGIL_POOL_N) c = Object.assign({}, c, { nSigils: SIGIL_POOL_N });
  ensureSigilPool();
  const ML = c.size * ML_OF_SIZE;
  const grp = new THREE.Group(), body = new THREE.Group();
  body.scale.setScalar(ML);
  grp.add(body);
  const L = {
    ...c, idx, R: ML * 0.1, ML, size: c.size, grp, body, t: 0, agitation: 0, calmed: false, calmT: 0,
    sonarWards: false, guardWards: true, reveal: 0, rang: false, hinted: false, pendingMsg: null,
    reach: 6, collR: ML * 0.09, flare: 0, dormant: true,
    state: 'absent', stT: 0, pos: V3(0, -9999, 0), vel: V3(), fwd: V3(0, 0, 1), head: V3(), spine: [V3(), V3(), V3(), V3(), V3()],
    sigils: [], arms: [], stun: 0, pulse: 0, orbitA: 0, strikeFrom: V3(), strikeTo: V3(), _pd: 1e9
  };

  // ---- the field: the last furnace, cold stumps, scorch ----
  const rp = riftPos(idx), awayRift = V3(-rp.x, 0, -rp.z).normalize();
  const F = V3(awayRift.x * WORLD_R * 0.30, 0, awayRift.z * WORLD_R * 0.30);
  F.y = terrainH(F.x, F.z, idx);
  L.furnace = { pos: F, lit: false, heat: 0, top: V3(F.x, F.y + 28, F.z), found: false, stumps: [], stumpFound: false };
  const smokerMat = registerPaint(new THREE.MeshStandardMaterial({ color: 0x1a1512, roughness: 0.92, metalness: 0.05, envMap: envTex, envMapIntensity: 0.2,
    emissive: 0xff5a14, emissiveIntensity: 0 }));
  L.smokerMat = smokerMat;
  const furnace = new THREE.Mesh(chimneyGeo(28, 5.2, 0xF0A1), smokerMat);
  furnace.position.copy(F);
  furnace.castShadow = furnace.receiveShadow = true;
  grp.add(furnace);
  const coldMat = registerPaint(new THREE.MeshStandardMaterial({ color: 0x191512, roughness: 0.95, metalness: 0.05 }));
  const rnd = seededRand(0x5700 + idx);
  for (let k = 0; k < 5; k++) {
    const a = k / 5 * TAU + rnd(), r = 26 + rnd() * 30;
    const x = F.x + Math.cos(a) * r, z = F.z + Math.sin(a) * r, y = terrainH(x, z, idx);
    const st = new THREE.Mesh(chimneyGeo(6 + rnd() * 9, 1.8 + rnd() * 1.4, 0xC01D + k), coldMat);
    st.position.set(x, y, z);
    grp.add(st);
    L.furnace.stumps.push(V3(x, y, z));
  }
  // the fire: glow sprites up the throat (fog off, the vent-ember lesson) + a heat shimmer
  L.fire = [];
  for (let k = 0; k < 4; k++) {
    const gl = makeGlow(0xff7a2a, 1);
    gl.material.fog = false;
    gl.material.opacity = 0;
    gl.position.set(F.x, F.y + 28 + k * 4, F.z);
    grp.add(gl);
    L.fire.push(gl);
  }

  // ---- his body ----
  const hide = hideMaps();
  L.keepTex = new Set([hide.map, hide.normalMap, hide.emissiveMap]);
  const skin = registerPaint(new THREE.MeshStandardMaterial({
    map: hide.map, normalMap: hide.normalMap, normalScale: new THREE.Vector2(0.8, 0.8), vertexColors: true,
    roughness: 0.36, metalness: 0, envMap: envTex, envMapIntensity: 0.6,
    emissive: 0xff8a3a, emissiveMap: hide.emissiveMap, emissiveIntensity: 0, side: THREE.FrontSide
  }));
  L.skin = skin;
  const mg = mantleGeo();
  const mantle = new THREE.Mesh(mg, skin);
  mantle.castShadow = true;
  body.add(mantle);
  const finMat = registerPaint(new THREE.MeshStandardMaterial({ color: 0x5a1c10, roughness: 0.5, metalness: 0, side: THREE.DoubleSide, transparent: false,
    emissive: 0xff8a3a, emissiveIntensity: 0 }));
  L.finMat = finMat;
  L.fins = [];
  for (const sd of [-1, 1]) {
    const fin = new THREE.Mesh(finGeo(), finMat);
    fin.scale.x = sd;
    body.add(fin);
    L.fins.push({ fin, sd });
  }
  // eyes: huge, black, with a gold ring; eyeshine off the lantern
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.03, metalness: 0.3, envMap: envTex, envMapIntensity: 2.2,
    emissive: 0xd8c070, emissiveIntensity: 0 });
  L.eyeMat = eyeMat;
  for (const sd of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.045, 24, 18), eyeMat);
    e.position.set(0.062 * sd, 0.015, 0.075);
    e.scale.set(0.7, 1, 1);
    body.add(e);
  }
  // arms (8) + tentacles (2): world-space tubes rebuilt per frame
  for (let a = 0; a < NA; a++) {
    const geo = tubeGeo(), mesh = new THREE.Mesh(geo, skin);
    mesh.frustumCulled = false;
    grp.add(mesh);
    const tent = a >= 8;
    L.arms.push({
      geo, mesh, tent, ang: tent ? (a === 8 ? -0.35 : 0.35) : (a + 0.5) / 8 * TAU,
      len: ML * (tent ? 0.95 : 0.42), r0: ML * (tent ? 0.012 : 0.022), shoot: 0,
      pts: Array.from({ length: RINGS + 1 }, () => V3()), U: Array.from({ length: RINGS + 1 }, () => V3())
    });
  }
  // tentacle clubs: flattened spindles with a ring of hooks
  L.clubs = [];
  for (let k = 0; k < 2; k++) {
    const club = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), skin);
    club.scale.set(ML * 0.025, ML * 0.012, ML * 0.07);
    grp.add(club);
    L.clubs.push(club);
  }

  // ---- wards: five on the mantle, kept by the squid (the zone-2 rule) ----
  const WS = [[0.10, 0.25], [-0.10, 0.40], [0.10, 0.55], [-0.10, 0.68], [0, 0.32]];
  for (let i = 1; i <= c.nSigils; i++) {
    const w = makeWard(L, i, 3.6);
    const [side, s] = WS[(i - 1) % WS.length];
    w.local = V3(side * 1.0, 0.085, s);                               // on the dorsal barrel
    w.q = new THREE.Quaternion().setFromUnitVectors(V3(0, 0, 1), V3(side * 0.6, 1, 0).normalize());
    L.sigils.push(w);
  }
  makeEmbers(L, c.size);
  grp.visible = true;
  body.visible = false;
  for (const A of L.arms) A.mesh.visible = false;
  for (const cl of L.clubs) cl.visible = false;

  L.rite = {
    prompt: pos => {
      if (L.furnace.lit) return null;
      if (Math.hypot(pos.x - F.x, pos.z - F.z) > FEED_R + 5.2 || pos.y > F.y + 12) return null;
      return survival.bitumen >= FEED_COST ? '[E] FEED THE FURNACE' : 'THE FURNACE IS COLD. IT WANTS BITUMEN.';
    },
    interact: pos => {
      if (L.furnace.lit || Math.hypot(pos.x - F.x, pos.z - F.z) > FEED_R + 5.2 || pos.y > F.y + 12) return null;
      if (survival.bitumen < FEED_COST) return { msg: `THE FURNACE WANTS ${FEED_COST} BITUMEN.` };
      survival.bitumen -= FEED_COST;
      L.furnace.lit = true;
      L.stT = 0;
      return { took: true, msg: 'THE FURNACE TAKES. THE FIELD WAKES — AND THE WARMTH CARRIES.' };
    }
  };
  L.lairWhere = 'IN THE COLD';
  L.cmd = (name, arg) => {
    if (name === 'stand' || name === 'wake') { if (!L.furnace.lit) { L.furnace.lit = true; L.stT = 0; } else if (L.state === 'absent') arrive(L); }
    else if (name === 'rear') { if (L.state === 'circle') startStrike(L, arg || null); }
    else if (name === 'stun') stunHim(L);
    return L.probe();
  };
  L.probe = () => ({
    kind: 'hunter', state: L.state, furnace: L.furnace.lit, heat: +L.furnace.heat.toFixed(2), stun: +L.stun.toFixed(1),
    pos: L.pos.toArray().map(v => +v.toFixed(1)), calmed: L.calmed, wards: L.sigils.map(g => ({ lit: g.lit, kept: wardGuardCount(L.sigils.indexOf(g)) }))
  });
  scene.add(grp);
  setLive(L);
  setWardTargets(-1, null);
  return L;
}

function arrive(L) {
  // up out of the black: below and beyond the diver's side of the field
  const F = L.furnace.pos;
  L.state = 'arrive'; L.stT = 0; L.dormant = false; L.woke = true;
  L.pos.set(F.x + 90, F.y - 80, F.z + 60);
  L.fwd.set(-0.5, 0.6, -0.4).normalize();
  L.body.visible = true;
  for (const A of L.arms) A.mesh.visible = true;
  for (const cl of L.clubs) cl.visible = true;
}
function startStrike(L, target) {
  L.state = 'strike'; L.stT = 0;
  L.strikeFrom.copy(L.pos);
  L.strikeTo.copy(target || L.aim);
}
function stunHim(L) {
  L.state = 'stunned'; L.stT = 0; L.stun = 10;
  L.pendingMsg = L.pendingMsg || 'THE FIRE BLINDS HIM. HIS SHOAL SCATTERS. HE HANGS IN THE GLOW.';
}

// Arms trail behind the head (the head leads when he strikes; when cruising he swims
// mantle-first and they stream). Tentacles shoot out on a strike.
function buildArms(L, dt) {
  const b = L.body, head = _a.set(0, 0, 0.02).applyMatrix4(b.matrixWorld);
  // the arms stream from the head AWAY from the tail: trailing when he cruises tail-first,
  // leading when he strikes head-first
  const armDir = _c.copy(L.fwd).multiplyScalar(L.state === 'strike' ? 1 : -1);
  _w.crossVectors(L.fwd, UP).normalize();
  _p.crossVectors(_w, L.fwd).normalize();                           // body up
  for (let a = 0; a < NA; a++) {
    const A = L.arms[a];
    const sp = A.tent ? 0.10 : 0.30, ca = Math.cos(A.ang), sa = Math.sin(A.ang);
    const spread = _d.copy(_w).multiplyScalar(ca * sp).addScaledVector(_p, sa * sp);
    const shoot = A.tent ? A.shoot : 0;
    const len = A.len * (A.tent ? 0.35 + 0.65 * shoot : 1);
    for (let i = 0; i <= RINGS; i++) {
      const s = i / RINGS;
      const wv = Math.sin(L.t * 3.2 - s * 6 + a * 1.7) * len * 0.05 * s * (L.stun > 0 ? 0.3 : 1);
      A.pts[i].copy(head).addScaledVector(armDir, len * s)
        .addScaledVector(spread, len * s * (1 - 0.5 * s)).addScaledVector(_w, wv).addScaledVector(_p, wv * 0.6);
      if (L.stun > 0) A.pts[i].y -= len * 0.25 * s * s;              // limp: the arms hang
    }
    // frames + tube
    const pos = A.geo.attributes.position.array, nor = A.geo.attributes.normal.array, row = RADIAL + 1;
    for (let i = 0; i <= RINGS; i++) {
      _t.subVectors(A.pts[Math.min(RINGS, i + 1)], A.pts[Math.max(0, i - 1)]).normalize();
      const U = A.U[i];
      if (i === 0) U.copy(_p); else U.copy(A.U[i - 1]);
      U.addScaledVector(_t, -U.dot(_t)).normalize();
      _f.crossVectors(_t, U);
      const s = i / RINGS, r = A.r0 * Math.pow(1 - s, 0.7) + 0.08 + (A.tent && s > 0.85 ? A.r0 * 0.6 : 0);
      for (let j = 0; j <= RADIAL; j++) {
        const an = (j % RADIAL) / RADIAL * TAU, ca2 = Math.cos(an), sa2 = Math.sin(an);
        const nx = U.x * ca2 + _f.x * sa2, ny = U.y * ca2 + _f.y * sa2, nz = U.z * ca2 + _f.z * sa2;
        const k = (i * row + j) * 3;
        pos[k] = A.pts[i].x + nx * r; pos[k + 1] = A.pts[i].y + ny * r; pos[k + 2] = A.pts[i].z + nz * r;
        nor[k] = nx; nor[k + 1] = ny; nor[k + 2] = nz;
      }
    }
    A.geo.attributes.position.needsUpdate = true;
    A.geo.attributes.normal.needsUpdate = true;
    if (A.tent) {
      const club = L.clubs[a - 8];
      club.position.copy(A.pts[RINGS - 2]);
      _t.subVectors(A.pts[RINGS], A.pts[RINGS - 4]).normalize();
      club.quaternion.setFromUnitVectors(V3(0, 0, 1), _t);
    }
  }
}

function place(L) {
  const b = L.body;
  // the mantle's +Z (tail) points AWAY from the direction of travel when striking, and
  // along it when cruising (squid cruise tail-first): body +Z = -fwd in strike, +fwd cruising
  _t.copy(L.fwd);
  if (L.state === 'strike') _t.negate();
  _q.setFromUnitVectors(V3(0, 0, 1), _t);
  b.quaternion.copy(_q);
  // keep him upright-ish: roll the body so its +Y stays toward world up
  b.position.copy(L.pos);
  b.updateMatrixWorld(true);
  for (let k = 0; k < L.spine.length; k++) L.spine[k].set(0, 0, 0.1 + k * 0.18).applyMatrix4(b.matrixWorld);
  L.head.set(0, 0, 0.05).applyMatrix4(b.matrixWorld);
  for (const g of L.sigils) {
    g.grp.position.copy(g.local).applyMatrix4(b.matrixWorld);
    g.grp.quaternion.copy(b.quaternion).multiply(g.q);
  }
}

export function updateHunter(L, dt, t, player) {
  const ev = { sigilLit: 0, calmed: false, lightDrain: 0, slam: false, remaining: 0, msg: null };
  if (L.pendingMsg) { ev.msg = L.pendingMsg; L.pendingMsg = null; }
  if (L.woke) { L.woke = false; ev.woke = true; }
  if (!L.pPrev) L.pPrev = player.pos.clone();
  L.t += dt; L.stT += dt;
  const Fz = L.furnace, F = Fz.pos;

  // ---- the furnace ----
  Fz.heat += clamp((Fz.lit ? 1 : 0) - Fz.heat, -dt * 0.2, dt * 0.35);
  L.smokerMat.emissiveIntensity = 0.9 * Fz.heat * (0.85 + 0.15 * Math.sin(L.t * 3.1) * Math.sin(L.t * 1.3));
  for (let k = 0; k < L.fire.length; k++) {
    const gl = L.fire[k], d = gl.position.distanceTo(player.pos);
    gl.material.opacity = Fz.heat * (0.8 - k * 0.15) * (0.85 + 0.15 * Math.sin(L.t * 5 + k));
    gl.scale.setScalar((9 - k * 1.5) * (1 + Math.min(3, d * 0.02)));
  }
  const dF = Math.hypot(player.pos.x - F.x, player.pos.z - F.z);
  // the warm pocket: near the lit furnace the air comes easy
  if (Fz.heat > 0.5 && dF < POCKET_R && player.pos.y < F.y + 40) {
    survival.oxygen = Math.min(1, survival.oxygen + dt * 0.05 * Fz.heat);
    ev.warm = true;
  }
  if (!ev.msg && !Fz.stumpFound) for (const s of Fz.stumps) if (s.distanceTo(player.pos) < 12) {
    Fz.stumpFound = true; ev.msg = 'A DEAD CHIMNEY. SCORCHED. SOMETHING BURNED HERE ONCE.'; break;
  }
  if (!ev.msg && !Fz.found && dF < 30 && player.pos.y < F.y + 40) { Fz.found = true; ev.msg = 'THE LAST FURNACE. COLD. IT WANTS FEEDING.'; }

  // ---- him ----
  if (L.state === 'absent') {
    if (Fz.lit && L.stT > 14) arrive(L);                             // he hunts heat
    ev.remaining = L.sigils.length;
    return ev;
  }
  L.pulse = L.t;
  let pd = 1e9;
  for (const s of L.spine) { const d = s.distanceTo(player.pos); if (d < pd) pd = d; }
  L._pd = pd;
  const speedK = L.speed;
  if (L.state === 'arrive') {
    _t.set(F.x + Math.cos(L.orbitA) * 70, F.y + 30, F.z + Math.sin(L.orbitA) * 70).sub(L.pos);
    const d = _t.length();
    L.fwd.lerp(_t.normalize(), Math.min(1, dt * 0.8)).normalize();
    L.pos.addScaledVector(L.fwd, speedK * 1.2 * dt);
    if (d < 15 || L.stT > 12) { L.state = 'circle'; L.stT = 0; }
  } else if (L.state === 'circle') {
    // circle the diver out in the dark, closing, then strike
    L.orbitA += dt * 0.22;
    const R = 55 - Math.min(20, L.stT * 2);
    _t.set(player.pos.x + Math.cos(L.orbitA) * R, player.pos.y + 8 + 6 * Math.sin(L.t * 0.4), player.pos.z + Math.sin(L.orbitA) * R).sub(L.pos);
    L.fwd.lerp(_t.normalize(), Math.min(1, dt * 1.2)).normalize();
    L.pos.addScaledVector(L.fwd, speedK * dt);
    if (L.stT > 7 && !L.calmed) { L.aim = player.pos.clone(); startStrike(L); }
  } else if (L.state === 'strike') {
    // drive through where the diver was, arms-first, tentacles out
    _t.copy(L.strikeTo).sub(L.pos);
    const d = _t.length();
    if (L.stT < 0.9) {
      // wind-up: turn to face him, drift back
      L.fwd.lerp(_t.normalize(), Math.min(1, dt * 4)).normalize();
      L.pos.addScaledVector(L.fwd, -speedK * 0.3 * dt);
    } else {
      L.pos.addScaledVector(L.fwd, speedK * 3.4 * dt);
      for (let k = 8; k < 10; k++) L.arms[k].shoot = Math.min(1, L.arms[k].shoot + dt * 3);
      // the fire: a strike that runs through the flare blinds him
      if (Fz.heat > 0.6 && L.head.distanceTo(Fz.top) < FLARE_R) { stunHim(L); }
      // ink in his line breaks the strike
      if (L.state === 'strike' && player.inkAt && performance.now() - player.inkAt < 4000 && pd < 30) { L.state = 'circle'; L.stT = 0; L.orbitA += Math.PI; ev.msg = ev.msg || 'THE INK BREAKS HIS LINE.'; }
      // the hit
      if (L.state === 'strike' && pd < 7 && !L.hitThisStrike) {
        L.hitThisStrike = true;
        _r.copy(player.pos).sub(L.pos).normalize();
        player.vel.addScaledVector(_r, 40).addScaledVector(L.fwd, 20);
        ev.slam = true; ev.lightDrain += 0.2;
      }
      if (L.stT > 3.2 || (d < 4 && L.stT > 1.5)) { L.state = 'circle'; L.stT = 0; L.hitThisStrike = false; }
    }
  } else if (L.state === 'stunned') {
    // hanging in the glow, sinking slowly, the fire in his eyes
    L.stun -= dt;
    L.pos.y -= dt * 1.2;
    L.pos.y = Math.max(L.pos.y, terrainH(L.pos.x, L.pos.z, L.idx) + 6);
    if (L.stun <= 0) { L.state = 'circle'; L.stT = 0; ev.msg = ev.msg || 'HE SHAKES OFF THE FIRE.'; }
  } else if (L.state === 'leave') {
    L.fwd.lerp(V3(0.3, -1, 0.2).normalize(), Math.min(1, dt)).normalize();
    L.pos.addScaledVector(L.fwd, speedK * 0.8 * dt);
    if (L.stT > 16) { L.body.visible = false; for (const A of L.arms) A.mesh.visible = false; for (const c of L.clubs) c.visible = false; }
  }
  for (let k = 8; k < 10; k++) if (L.state !== 'strike') L.arms[k].shoot = Math.max(0, L.arms[k].shoot - dt * 1.5);
  // never through the seabed
  const gy = terrainH(L.pos.x, L.pos.z, L.idx) + 5;
  if (L.pos.y < gy) L.pos.y = gy;

  place(L);
  buildArms(L, dt);

  // photophores: they pulse when he hunts, gutter when stunned, go dark when calmed
  const hunt = L.state === 'strike' ? 1 : L.state === 'circle' ? 0.6 : 0.4;
  const ph = L.calmed ? 0.1 : L.stun > 0 ? 0.15 * (Math.sin(L.t * 17) > 0.6 ? 1 : 0) : hunt * (0.55 + 0.45 * Math.sin(L.t * (2 + 4 * hunt)));
  L.skin.emissiveIntensity = 1.8 * ph;
  L.finMat.emissiveIntensity = 0.3 * ph;
  // fins ripple
  for (const f of L.fins) f.fin.rotation.z = f.sd * 0.25 * Math.sin(L.t * (L.state === 'strike' ? 9 : 3));
  // eyeshine
  _p.copy(player.pos).sub(L.head);
  const dist = _p.length() || 1;
  L.eyeMat.emissiveIntensity = (L.stun > 0 ? 1.2 : 0) + 1.6 * (1 - smooth(dist, 30, 110)) * Math.max(0, player.light || 0);

  // ---- wards: kept by the squid (zone 2), reachable when he is still enough ----
  const haloK = L.size * 0.6;
  if (!L.calmed) {
    let allLit = true;
    for (let i = 0; i < L.sigils.length; i++) {
      const g = L.sigils[i];
      if (g.lit) { wardLitPose(g, dt, haloK); continue; }
      allLit = false;
      g.rev = 1;
      wardIdle(g, dt, haloK);
      if (L.state === 'stunned') {
        // stunned, his wards wake hot and throw light across his hide: the moment you SEE
        // the size of him (borrowed pool lights — the light count never changes)
        g.light.intensity = 55 + 20 * Math.sin(L.t * 3 + i);
        L.guardWards = false; wardTouch(L, i, g, player, ev); L.guardWards = true;
      }
      else if (!L.hinted && g.grp.position.distanceTo(player.pos) < L.reach) { L.hinted = true; ev.msg = ev.msg || 'HE WILL NOT HOLD STILL. NOT OUT HERE IN THE DARK.'; }
    }
    // the keepers ride his wards — except in the fire, which scatters the shoal
    if (L.state === 'stunned') setWardTargets(-1, null); else setWardTargets(L.idx, L.sigils);
    ev.remaining = L.sigils.filter(q => !q.lit).length;
    if (allLit) {
      L.calmed = true; L.calmT = 0; ev.calmed = true;
      L.state = 'leave'; L.stT = 0; L.stun = 0;
      setWardTargets(-1, null);
    }
  } else {
    L.calmT += dt;
    for (const g of L.sigils) {
      g.pulse += dt;
      g.light.intensity = Math.max(0, 120 - L.calmT * 7);
      g.light.position.copy(g.grp.position);
      g.halo.position.copy(g.grp.position);
    }
  }
  wardFlashes(L, dt, null);
  L.pPrev.copy(player.pos);
  return ev;
}
