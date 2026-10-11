// VELKATH'S HARPOON (fissure-and-harpoon Task 6; spec docs/superpowers/specs/2026-10-10-fissure-and-
// harpoon-design.md §2; Michael: taking her eggs was the wrong trigger, and the clutch was hard to
// reach). An old whaling iron is lodged in a seam on her NEAR flank (the sand side lair.js gives her,
// at standing height, never over the crack). Pulling it wakes her; the clutch stays hers.
//
//   makeHarpoon(L, { wound }) -> H          (brooder.js: L.harpoon = L.rite = H)
//   H.prompt(pos)    '[E] PULL THE HARPOON' (her first visit at this anchorage) / '[E] PRESS THE OLD WOUND'
//                    (a revisit: pulled[site] in the chart record) within REACH of H.anchor, or null
//   H.interact(pos)  starts the commitment: Sal braces against her shell and WRENCHES for WRENCH_T s,
//                    his drive held off (player.stagger re-armed every frame), his look on the iron.
//                    Returns { pulled: true, first, wound, msg: null, line } on the press, else null. The
//                    line ("IT COMES FREE. SHE FEELS IT." at home, "ANOTHER DIVER'S HARPOON." elsewhere,
//                    null at the wound) is SAID when it comes free, through the sleeper's ev.msg.
//   H.update(dt, t, player, ev)   the wrench, the free moment (ev.pulled, the line, the weep), the
//                    wake a beat later (H.onWake), the glint and the first-sight line
//   H.seat()         lays it in her drawn shell (her dormant pose; again when her sculpt lands)
//   H.pulled, H.wound, H.wrenching, H.anchor (where Sal stands, world, at his EYE height convention:
//                    x/z on the ground spot; y = the ground), H.seamWorld() (the entry point), H.dispose()
//
// THE REWARD: survival.hasHarpoon on the first pull EVER, at any site (saved as tools.harpoon by game.js
// on ev.pulled). A remote anchorage's harpoon is another diver's: the trigger, and the blade only if
// Sal has none yet. THE OLD WOUND: on a revisit the seam holds a healed scar; pressing it is the same
// commitment and the remembered rite's start, and grants nothing.
//
// THE MODEL is ONE generated asset (src/lib/harpoonSculpt.js -> assets/harpoon via tools/blender),
// shared with Task 7 (Sal's blade): harpoonModel() hands any owner its geometry and a fresh material
// (sculpted when the asset has landed, else the procedural lathe-and-box build with the same DIM).
//
// RENDER: the iron (1 draw), the line down to the silt (1), the wound scar (1, hidden until there is
// one), the weep (1 instanced draw of camera-facing dark puffs, render only: her sight never reads it),
// the glint (the eyeshine's warm-glow program, fog off, its own fade). No lights. Everything exists
// from the build (hidden things are drawn by the boot's warm frames), so nothing compiles on sight.
// Zero per-frame allocation (module temps).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { camera, envTexDeep as envTex } from '../../core.js';
import { V3, clamp } from '../../lib/math.js';
import { makeWarmGlow, seededRand } from '../../lib/textures.js';
import { loadSculpted, assetTextures, assetGeos } from '../../lib/assets.js';
import { DIM } from '../../lib/harpoonSculpt.js';
import { terrainH } from '../../world/terrain.js';
import { fissureDist } from '../../world/fissureShape.js';
import { currentSiteIndex } from '../../world/site.js';
import { emitDust } from '../../world/footfx.js';
import { stirPulse, P_STRIKE } from '../../world/stir.js';
import { survival } from '../../systems/survival.js';
import { diverImpulse } from '../diver.js';
import { bodyBlocked, inClutch, blockWhy } from './bodyCols.js';
import { rimR as G_rimR } from './brooderGeo.js';
const G = { rimR: G_rimR };

export const HARPOON_ASSET = loadSculpted('assets/harpoon/', 'harpoon');
let ASSET = null;
HARPOON_ASSET.then(a => { if (a && a.geos.harpoon && a.maps.harpoon) ASSET = a; });

export const WRENCH_T = 1.5;          // the commitment (s): brace, wrench, wrench, free
export const REACH = 2.6;             // prompt / interact range from the anchor (horizontal, u)
const WAKE_DELAY = 0.7;               // it comes free, she shudders a beat later (the wake's own sequence takes ~6 s)
const LODGE_IN = 0.30;                // how much of the iron is in her (model units, from the point)
// the lodged iron is drawn 1.3x the hand-scale model (a whaling iron for a colossus: 2.1 u, the pole
// reaching out past her folded legs to where a man on the sand takes it); Task 7's blade is 1x
export const LODGED_S = 1.3;
const GRIP_Z = -0.72;                 // where his hands close on the lodged pole (model z: aft of the lashing)
const GLINT_K = 0.95, GLINT_FAR = 40, SIGHT_R = 24;
export const LINE_FIRST_SIGHT = 'A HARPOON IN HER SIDE. SOMEONE CAME BEFORE YOU.';
export const LINE_FREE_HOME = 'IT COMES FREE. SHE FEELS IT.';
export const LINE_FREE_REMOTE = "ANOTHER DIVER'S HARPOON.";
// "once per site": the first-sight line is the anchorage's, not the build's (she is rebuilt on
// every zone entry), so it is remembered here for the session
const sightSaid = new Uint8Array(8);

const _v = V3(), _w = V3(), _n = V3(), _a = V3(), _b = V3(), _up = V3(0, 1, 0), _fw = V3();
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = V3(1, 1, 1), _nm = new THREE.Matrix3();
const _e = new THREE.Euler();

// ---- THE MODEL (shared with Task 7) ----------------------------------------------------------
let _procGeo = null;
// The procedural build: the same proportions in lathes, cones and boxes, vertex-coloured (iron,
// brass, weathered wood, tarred line). The loader never throws; this is what draws until (or unless)
// the sculpted set lands.
function proceduralGeo() {
  if (_procGeo) return _procGeo;
  const D = DIM, parts = [];
  const col = (g, c) => {
    const n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c[0]; a[i * 3 + 1] = c[1]; a[i * 3 + 2] = c[2]; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g.index ? g.toNonIndexed() : g;
  };
  const along = (g, z0, z1) => { g.rotateX(Math.PI / 2); g.translate(0, 0, (z0 + z1) / 2); return g; };
  const IRON = [0.17, 0.12, 0.09], BRASS = [0.52, 0.40, 0.21], WOOD = [0.40, 0.38, 0.33], ROPE = [0.13, 0.11, 0.08];
  parts.push(col(along(new THREE.CylinderGeometry(D.poleR0, D.poleR1, D.fer0 - D.butt, 12, 1), D.butt, D.fer0), WOOD));
  parts.push(col(along(new THREE.CylinderGeometry(D.ferR - 0.003, D.ferR, D.fer1 - D.fer0, 14, 1), D.fer0, D.fer1), BRASS));
  for (const z of [D.fer0 + 0.008, D.fer1 - 0.01]) { const g = new THREE.TorusGeometry(D.ferR, 0.0062, 6, 16); g.translate(0, 0, z); parts.push(col(g, BRASS)); }
  parts.push(col(along(new THREE.CylinderGeometry(D.shankR + 0.002, D.socketR, D.shank0 + 0.012 - D.socket0 + 0.02, 10, 1), D.socket0 - 0.02, D.shank0 + 0.012), IRON));
  { const g = new THREE.BoxGeometry(D.shankR * 2, D.shankR * 2, D.pin - D.shank0); g.translate(0, 0, (D.shank0 + D.pin) / 2); parts.push(col(g, IRON)); }
  { // the head: a flat two-flued leaf (an extruded outline), canted on its pin
    const sh = new THREE.Shape();
    const P = [[0, D.tip], [0.070, 0.508], [D.headHalfW, D.barbBack], [0.046, 0.469], [0.019, 0.462], [-0.019, 0.462], [-0.046, 0.469], [-D.headHalfW, D.barbBack], [-0.070, 0.508]];
    sh.moveTo(P[0][0], P[0][1]);
    for (let i = 1; i < P.length; i++) sh.lineTo(P[i][0], P[i][1]);
    sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.012, bevelEnabled: false });
    g.translate(0, 0, -0.006);
    g.rotateX(Math.PI / 2);                  // the outline's y -> +Z (the point), its depth -> Y (the leaf's thickness)
    g.translate(0, 0, -D.pin); g.rotateY(-D.toggle); g.translate(0, 0, D.pin);   // the toggle's cant on its pin
    parts.push(col(g, IRON));
  }
  for (let k = 0; k < 3; k++) { const g = new THREE.TorusGeometry(D.poleR0 + D.lashR * 0.75, D.lashR, 6, 14); g.translate(0, 0, D.lash0 + (D.lash1 - D.lash0) * (k + 0.5) / 3); parts.push(col(g, ROPE)); }
  {
    const c = new THREE.CubicBezierCurve3(V3(0.040, -0.022, -0.172), V3(0.072, -0.085, -0.215), V3(0.070, -0.165, -0.268), V3(0.052, -0.215, -0.318));
    parts.push(col(new THREE.TubeGeometry(c, 8, 0.0105, 6, false), ROPE));
  }
  for (const p of parts) { if (p.attributes.uv === undefined) p.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(p.attributes.position.count * 2), 2)); }
  _procGeo = mergeGeometries(parts.map(p => { const g = new THREE.BufferGeometry(); for (const k of ['position', 'normal', 'uv', 'color']) g.setAttribute(k, p.attributes[k]); return g; }));
  _procGeo.computeBoundingSphere();
  return _procGeo;
}
// harpoonModel() -> { geometry, material, sculpted, dim, keepGeo: Set, keepTex: Set }
// The geometry and textures are SHARED (cached for the page's life): an owner that disposes its
// subtree must keep them (the sets returned; a sleeper's L.keepGeo / L.keepTex). The material is the
// caller's own (fresh per call; one program for every owner: customProgramCacheKey).
export function harpoonModel() {
  if (ASSET) {
    const mp = ASSET.maps.harpoon;
    const m = new THREE.MeshStandardMaterial({
      map: mp.map, normalMap: mp.normalMap, roughnessMap: mp.ormMap, aoMap: mp.ormMap, metalnessMap: mp.ormMap,
      roughness: 1, metalness: 1, aoMapIntensity: 0.85, envMap: envTex, envMapIntensity: 0.55
    });
    m.customProgramCacheKey = () => 'harpoon|sculpt';
    return { geometry: ASSET.geos.harpoon, material: m, sculpted: true, dim: DIM, meta: ASSET.meta.meta, keepGeo: assetGeos(ASSET), keepTex: assetTextures(ASSET) };
  }
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.35, envMap: envTex, envMapIntensity: 0.45 });
  m.customProgramCacheKey = () => 'harpoon|proc';
  const g = proceduralGeo();
  return { geometry: g, material: m, sculpted: false, dim: DIM, meta: null, keepGeo: new Set([g]), keepTex: new Set() };
}

// ---- the wound (a healed scar in the seam; fresh and wet once pulled) -------------------------
let _woundGeo = null;
function woundGeo() {
  if (_woundGeo) return _woundGeo;
  // a radial patch in its own frame (+Z out of her): a pit where the iron went in, a callus ring of
  // regrown chitin round it, the edge flush with her shell; an uneven outline (noise on the rim)
  const RINGS = 7, SEG = 22, rnd = seededRand(0x40D5);
  const jit = Array.from({ length: SEG }, () => 0.85 + 0.3 * rnd());
  const pos = [], colr = [], idx = [];
  for (let i = 0; i <= RINGS; i++) {
    const f = i / RINGS;
    for (let j = 0; j < SEG; j++) {
      const a = j / SEG * Math.PI * 2, r = 0.20 * f * (i === 0 ? 0 : (0.75 + 0.25 * jit[j]));
      const zz = -0.05 * Math.pow(1 - f, 2) + 0.028 * Math.exp(-(((f - 0.62) / 0.16) ** 2)) - 0.006 * f;
      pos.push(Math.cos(a) * r, Math.sin(a) * r * 0.82, zz);
      // the pit black-red, the callus pale and dull, the edge her own grey-brown
      const pit = Math.pow(1 - f, 1.5), cal = Math.exp(-(((f - 0.62) / 0.2) ** 2));
      colr.push(0.05 + 0.33 * cal + 0.20 * (1 - pit) * (1 - cal), 0.025 + 0.29 * cal + 0.18 * (1 - pit) * (1 - cal), 0.02 + 0.22 * cal + 0.15 * (1 - pit) * (1 - cal));
    }
  }
  for (let i = 0; i < RINGS; i++) for (let j = 0; j < SEG; j++) {
    const a = i * SEG + j, b = i * SEG + (j + 1) % SEG, c = a + SEG, d = b + SEG;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  _woundGeo = g;
  return g;
}

// ---- the weep (render only) ----------------------------------------------------------------------
const WEEP_N = 32;
let _puff = null;
function puffTex() {
  if (_puff) return _puff;
  const S = 64, d = new Uint8Array(S * S * 4), rnd = seededRand(0x9EE9);
  const blobs = Array.from({ length: 5 }, () => [0.5 + (rnd() - 0.5) * 0.35, 0.5 + (rnd() - 0.5) * 0.35, 0.18 + rnd() * 0.16]);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = (x + 0.5) / S, v = (y + 0.5) / S;
    let a = 0;
    for (const [bx, by, br] of blobs) { const q = Math.hypot(u - bx, v - by) / br; a = Math.max(a, Math.max(0, 1 - q * q)); }
    a *= Math.max(0, 1 - Math.pow(Math.hypot(u - 0.5, v - 0.5) * 2, 4));
    const o = (y * S + x) * 4;
    d[o] = d[o + 1] = d[o + 2] = 255; d[o + 3] = Math.round(255 * a);
  }
  _puff = new THREE.DataTexture(d, S, S, THREE.RGBAFormat);
  _puff.magFilter = THREE.LinearFilter; _puff.minFilter = THREE.LinearMipmapLinearFilter; _puff.generateMipmaps = true;
  _puff.needsUpdate = true;
  return _puff;
}
let _weepQuad = null;
function weepMat() {
  const m = new THREE.MeshBasicMaterial({ color: 0x120806, map: puffTex(), transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide, forceSinglePass: true });
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aFade;\nvarying float vFade;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFade = aFade;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFade;')
      .replace('#include <alphatest_fragment>', '#include <alphatest_fragment>\ndiffuseColor.a *= vFade;');
  };
  m.customProgramCacheKey = () => 'harpoon|weep';
  return m;
}

// ---- the build ---------------------------------------------------------------------------------
export function makeHarpoon(L, opts = {}) {
  const wound = !!opts.wound;
  const site = currentSiteIndex() | 0;
  const H = {
    wound, pulled: wound, wrenching: false, pressed: false, seated: false,
    anchor: V3(), seam: V3(), normal: V3(), axis: V3(), lookAt: null,
    t: 0, wT: 0, freeT: -1, wakeT: -1, weepT: 0, weepRate: 0, weepHead: 0, kick: 0, pendingLine: null, line: null, first: false,
    glint: 0, onWake: null, site
  };
  // the iron, on a pivot under her body (it rides her; her body is scaled by R, so the pivot's
  // matrix carries 1/R): the mesh is swapped to the sculpted set if it lands later
  const piv = new THREE.Group();
  piv.matrixAutoUpdate = false;
  L.body.add(piv);
  H.piv = piv;
  let model = harpoonModel();
  const iron = new THREE.Mesh(model.geometry, model.material);
  iron.castShadow = true; iron.receiveShadow = true;
  piv.add(iron);
  H.iron = iron;
  const keep = mdl => {
    L.keepGeo = new Set([...(L.keepGeo || []), ...mdl.keepGeo]);
    L.keepTex = new Set([...(L.keepTex || []), ...mdl.keepTex]);
  };
  keep(model);
  H.keep = () => keep(model);          // brooder.js: her sculpt install REPLACES L.keepGeo; re-add ours after it
  if (!model.sculpted) HARPOON_ASSET.then(() => {
    if (!ASSET || L.gone) return;
    const old = iron.material;
    model = harpoonModel();
    iron.geometry = model.geometry; iron.material = model.material;
    old.dispose();
    keep(model);
  });
  // the line, from the stub's frayed end down into the silt (built at seat)
  const ropeMat = new THREE.MeshStandardMaterial({ color: 0x1b1611, roughness: 0.95, metalness: 0, envMap: envTex, envMapIntensity: 0.2 });
  ropeMat.customProgramCacheKey = () => 'harpoon|rope';
  const rope = new THREE.Mesh(new THREE.BufferGeometry(), ropeMat);
  rope.castShadow = false; rope.receiveShadow = true;
  L.grp.add(rope);
  H.rope = rope;
  // the wound (hidden until there is one: the pulled seam, or the revisit's healed scar)
  const woundMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0, envMap: envTex, envMapIntensity: 0.35,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  woundMat.customProgramCacheKey = () => 'harpoon|wound';
  const scar = new THREE.Mesh(woundGeo(), woundMat);
  scar.castShadow = false; scar.receiveShadow = true;
  scar.matrixAutoUpdate = false;
  scar.visible = wound;
  L.body.add(scar);
  H.scar = scar;
  L.keepGeo = new Set([...(L.keepGeo || []), woundGeo()]);
  // the weep (world space, in her group)
  {
    if (!_weepQuad) _weepQuad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = _weepQuad.index;
    for (const k of ['position', 'normal', 'uv']) g.setAttribute(k, _weepQuad.attributes[k]);
    H.fade = new Float32Array(WEEP_N);
    g.setAttribute('aFade', new THREE.InstancedBufferAttribute(H.fade, 1));
    const mesh = new THREE.InstancedMesh(g, weepMat(), WEEP_N);
    mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false;
    mesh.count = 0;
    mesh.renderOrder = 2;
    L.grp.add(mesh);
    H.weep = mesh;
    H.wp = new Float32Array(WEEP_N * 8);   // x y z vx vy vz age life
    L.keepGeo.add(_weepQuad);
    L.keepTex.add(puffTex());
  }
  // the glint on the brass (the eyeshine's warm-glow program; in the scene from the build at 0)
  const gl = makeWarmGlow(0xffe0a6, 0.55, { near: 3, far: GLINT_FAR, nearW: 0, swell: 0.015, swellMax: 0.8 });
  gl.material.opacity = 0;
  gl.renderOrder = 3;
  L.grp.add(gl);
  H.glintSpr = gl;

  // The iron went in from BELOW: a diver on the sand thrust it up into the seam over her rim (a man on
  // foot cannot throw down at her), so it slopes in and up, a little aft, and its pole hangs out and
  // down to where a standing man takes it. axisFor: the model's +Z (the point, into her) from the
  // seam's normal.
  const axisFor = (n, out) => {
    const nh = Math.hypot(n.x, n.z) || 1;
    return out.set(-n.x / nh * 0.74 - _fw.x * 0.14, 0.64, -n.z / nh * 0.74 - _fw.z * 0.14).normalize();
  };
  const _ax = V3(), _o = V3(), _p = V3(), _g = V3();
  const clearAt = (x, y, z, m) => !bodyBlocked(x, y, z, m) && !(inClutch(x, y, z, m) > 0);
  // Try a seam (world point p, normal n). The iron's outside length must stand clear of her limbs; a
  // standing spot must exist on clear ground (his whole body out of hers and out of her clutch, off
  // the crack) within arm's reach of the grip, the grip at his hands' height over it. Returns a score
  // (lower is better; Infinity: no) and leaves the spot in (sx, sz, sy) via _p.
  const trySeam = (p, n, strict) => {
    const idx = L.idx;
    axisFor(n, _ax);
    _o.copy(p).addScaledVector(_ax, -(DIM.tip - LODGE_IN) * LODGED_S);
    // (her limbs only: the shell's own collider is the column under her plan, which the iron's first
    // hand's breadth out of the seam is always inside)
    if (strict) for (const z of [-0.2, -0.55, -0.95]) {
      _g.copy(_o).addScaledVector(_ax, z * LODGED_S);
      if (bodyBlocked(_g.x, _g.y, _g.z, 0.05) && blockWhy !== -1) { H.dbg.shaft++; return Infinity; }
    }
    _g.copy(_o).addScaledVector(_ax, GRIP_Z * LODGED_S);
    const nh = Math.hypot(n.x, n.z) || 1, nx = n.x / nh, nz = n.z / nh;
    let best = Infinity;
    H.dbg.tried++;
    for (const d of [0.55, 0.7, 0.85, 1.0, 1.15, 1.3]) {
      for (const a of [0, 0.4, -0.4, 0.8, -0.8]) {
        const c = Math.cos(a), sn = Math.sin(a), dx = nx * c - nz * sn, dz = nx * sn + nz * c;
        const ax = _g.x + dx * d, az = _g.z + dz * d, ay = terrainH(ax, az, idx);
        const gu = _g.y - ay;
        if (strict && (gu < 0.9 || gu > 1.9)) { H.dbg.high++; continue; }
        if (fissureDist(ax, az, idx) < 8) continue;
        if (!(clearAt(ax, ay + 0.45, az, 0.5) && clearAt(ax, ay + 1.0, az, 0.5) && clearAt(ax, ay + 1.6, az, 0.5))) { H.dbg.body++; continue; }
        const sc = Math.abs(gu - 1.35) + 0.4 * d + 0.15 * Math.abs(a);
        if (sc < best) { best = sc; _p.set(ax, ay, az); }
      }
    }
    return best;
  };

  H._trySeam = (p, n, strict) => { _fw.set(Math.sin(L.yaw), 0, Math.cos(L.yaw)); return trySeam(p, n, strict); };   // (dev probe)
  // ---- SEAT: find the seam on her drawn shell, lodge the iron, lay the line, place the anchor ----
  // The shell's own vertices (sculpted or procedural), in her dormant pose: on her near flank (its
  // normal toward the open sand), mid-length, out of the drift, at a height a standing man's hands
  // reach from a spot on clear ground beside her (off the crack, out of her body and her clutch).
  H.seat = () => {
    const sh = L.parts && L.parts.shell;
    if (!sh) return H;
    L.grp.updateMatrixWorld(true);
    const mw = sh.matrixWorld, P = sh.geometry.attributes.position, N = sh.geometry.attributes.normal;
    _nm.getNormalMatrix(mw);
    _fw.set(Math.sin(L.yaw), 0, Math.cos(L.yaw));
    const sand = L.sand, R = L.R, idx = L.idx;
    // candidates: her shell's MARGIN on the near flank (the outermost band of the shell, just over the
    // rim: a seam a man on the sand can reach; anything further in is over her folded legs), facing the
    // sand, off the crack. Every one is tried (trySeam): the folded legs leave a few gaps along the
    // flank and the iron must stand in one of them.
    if (L.publishCols) L.publishCols();
    H.dbg = { tried: 0, shaft: 0, high: 0, body: 0 };
    let best = Infinity, bi = -1;
    const sa = L.sandSide > 0 ? 0 : Math.PI;
    for (let i = 0; i < P.count; i++) {
      _v.fromBufferAttribute(P, i);
      if (_v.y < -0.13 || _v.y > 0.08) continue;                 // the margin band (the sculpt's margin droops to -0.11 mid-flank)
      const th = Math.atan2(_v.z, _v.x);
      let dth = th - sa; dth = Math.atan2(Math.sin(dth), Math.cos(dth));
      if (Math.abs(dth) > 1.15) continue;
      if (Math.hypot(_v.x, _v.z) < G.rimR(th) * 0.95) continue;
      _n.fromBufferAttribute(N, i).applyMatrix3(_nm).normalize();
      const ns = _n.x * sand.x + _n.z * sand.z;
      if (ns < 0.4 || _n.y > 0.8) continue;
      _v.applyMatrix4(mw);
      if (fissureDist(_v.x, _v.z, idx) < 8) continue;
      const sc = trySeam(_v, _n, true) + 0.25 * Math.abs(dth) + 0.6 * (1 - ns);
      if (sc < best) { best = sc; bi = i; H.anchor.copy(_p); }
    }
    const found = bi >= 0;
    if (found) {
      H.seam.fromBufferAttribute(P, bi).applyMatrix4(mw);
      H.normal.fromBufferAttribute(N, bi).applyMatrix3(_nm).normalize();
    } else {        // nothing qualifies: the near-flank rim point lair.js gives, the anchor straight out
      H.seam.copy(L.nearFlank); H.seam.y += 1.6; H.normal.set(sand.x, 0.2, sand.z).normalize();
      for (let d = 1.6; d < 7; d += 0.25) {
        const x = H.seam.x + sand.x * d, z = H.seam.z + sand.z * d, y = terrainH(x, z, idx);
        H.anchor.set(x, y, z);
        if (clearAt(x, y + 1.0, z, 0.5)) break;
      }
    }
    axisFor(H.normal, H.axis);
    _v.copy(H.seam).applyMatrix4(_m2.copy(L.body.matrixWorld).invert());
    H.bear = Math.atan2(_v.z, _v.x);       // (body-local bearing: brooder.js opens the silt drift there)
    H.seatOk = found;
    // +Y of the model as near world up as the axis allows (the line stub hangs down)
    _b.copy(_up).addScaledVector(H.axis, -_up.dot(H.axis)).normalize();
    _a.crossVectors(_b, H.axis);
    _m.makeBasis(_a.multiplyScalar(LODGED_S), _b.multiplyScalar(LODGED_S), _w.copy(H.axis).multiplyScalar(LODGED_S));
    _m.setPosition(_w.copy(H.seam).addScaledVector(H.axis, -(DIM.tip - LODGE_IN) * LODGED_S));
    H.worldM = (H.worldM || new THREE.Matrix4()).copy(_m);
    _m2.copy(L.body.matrixWorld).invert();
    piv.matrix.multiplyMatrices(_m2, _m);
    piv.matrixWorldNeedsUpdate = true;
    H.pivBase = (H.pivBase || new THREE.Matrix4()).copy(piv.matrix);
    // the scar, flush on the seam (its +Z out along the normal)
    _b.copy(_up).addScaledVector(H.normal, -_up.dot(H.normal)).normalize();
    _a.crossVectors(_b, H.normal);
    _m.makeBasis(_a, _b, H.normal).setPosition(_w.copy(H.seam).addScaledVector(H.normal, 0.025));
    scar.matrix.multiplyMatrices(_m2, _m);
    scar.matrixWorldNeedsUpdate = true;
    // the line: from the stub's frayed end (meta.lineEnd in the model's frame), a sag down to the
    // silt and a length lying on it, half buried, out toward the sand
    {
      _v.set(0.052, -0.215, -0.318).applyMatrix4(H.worldM);
      const gx = _v.x + sand.x * 0.7 + _fw.x * 0.25, gz = _v.z + sand.z * 0.7 + _fw.z * 0.25, gy = terrainH(gx, gz, idx);
      const ex = _v.x + sand.x * 2.6 - _fw.x * 0.4, ez = _v.z + sand.z * 2.6 - _fw.z * 0.4, ey = terrainH(ex, ez, idx) - 0.03;
      const c = new THREE.CatmullRomCurve3([_v.clone(), V3((_v.x + gx) / 2, Math.max(gy + 0.15, (_v.y + gy) / 2 - 0.12), (_v.z + gz) / 2), V3(gx, gy + 0.02, gz),
        V3((gx + ex) / 2, terrainH((gx + ex) / 2, (gz + ez) / 2, idx) + 0.0, (gz + ez) / 2), V3(ex, ey, ez)]);
      rope.geometry.dispose();
      rope.geometry = new THREE.TubeGeometry(c, 40, 0.0105 * LODGED_S, 6, false);
    }
    rope.visible = !H.pulled;
    iron.visible = !H.pulled;
    H.seated = true;
    return H;
  };
  H.seamWorld = () => H.seam;
  // grip: where his hands close (for the look while he wrenches)
  H.gripWorld = out => out.set(0, 0, GRIP_Z).applyMatrix4(H.worldM || _m.identity());

  const inReach = pos => H.seated && Math.hypot(pos.x - H.anchor.x, pos.z - H.anchor.z) < REACH && Math.abs(pos.y - 1.35 - H.anchor.y) < 2.5;
  const ready = () => L.dormant && !H.wrenching && !(H.wound ? H.pressed : H.pulled);
  H.prompt = pos => {
    if (!ready() || !inReach(pos)) return null;
    return H.wound ? '[E] PRESS THE OLD WOUND' : '[E] PULL THE HARPOON';
  };
  H.interact = pos => {
    if (!ready() || !inReach(pos)) return null;
    H.wrenching = true; H.wT = 0; H.kick = 0;
    H.lookAt = H.lookAt || V3();
    H.gripWorld(H.lookAt);
    // remote first pulls are another diver's iron; the blade is granted once, ever
    H.first = !H.wound && !survival.hasHarpoon;
    H.line = H.wound ? null : site === 0 ? LINE_FREE_HOME : LINE_FREE_REMOTE;
    return { pulled: true, first: H.first, wound: H.wound, msg: null, line: H.line };
  };

  // the moment it comes free (or the wound gives under his palms)
  const free = (player) => {
    H.wrenching = false; H.lookAt = null;
    if (H.wound) H.pressed = true;
    else {
      H.pulled = true;
      if (!survival.hasHarpoon) survival.hasHarpoon = true;
      H.justPulled = true;
    }
    iron.visible = false; rope.visible = false;
    scar.visible = true;
    woundMat.color.setRGB(H.wound ? 1 : 0.82, H.wound ? 1 : 0.62, H.wound ? 1 : 0.6);
    H.pendingLine = H.line;
    H.wakeT = WAKE_DELAY;
    // the weep: dark, from the seam, for a few seconds (less from the old wound)
    H.weepT = H.wound ? 1.6 : 3.2; H.weepRate = H.wound ? 7 : 11; H.weepAcc = 0;
    stirPulse(H.seam.x, H.seam.y, H.seam.z, 16, 0, 0.7, P_STRIKE);
    emitDust(H.seam.x + H.normal.x * 0.4, H.seam.y - 0.3, H.seam.z + H.normal.z * 0.4, 8, 1.0);
    // he staggers back off it, the iron in his hands
    _v.subVectors(H.seam, player.pos).setY(0);
    const l = _v.length() || 1;
    diverImpulse('hit', _v.x / l, _v.z / l, 1.1);
    player.vel.x -= _v.x / l * 1.4; player.vel.z -= _v.z / l * 1.4;
    player.stagger = player.staggerDur = 0.45; player.staggerK = 1;
  };

  const spawnWeep = () => {
    const i = H.weepHead, o = i * 8;
    H.weepHead = (H.weepHead + 1) % WEEP_N;
    const nx = H.normal.x, ny = H.normal.y, nz = H.normal.z, j = 0.12;
    H.wp[o] = H.seam.x + nx * 0.08; H.wp[o + 1] = H.seam.y + ny * 0.08; H.wp[o + 2] = H.seam.z + nz * 0.08;
    H.wp[o + 3] = nx * 0.28 + (Math.random() - 0.5) * j; H.wp[o + 4] = ny * 0.28 + 0.10 + (Math.random() - 0.5) * j; H.wp[o + 5] = nz * 0.28 + (Math.random() - 0.5) * j;
    H.wp[o + 6] = 0; H.wp[o + 7] = 2.6 + 1.6 * Math.random();
    H.weep.count = WEEP_N;          // (the unborn and the spent draw at scale 0, fade 0)
  };

  H.update = (dt, t, player, ev) => {
    H.t += dt;
    if (!H.seated) return;
    // ---- the wrench ----
    if (H.wrenching) {
      H.wT += dt;
      // his hands are off the controls for the whole of it (stagger re-armed: drive 0), his air
      // pack too (game.js packUsable reads H.wrenching)
      player.stagger = player.staggerDur = 0.25; player.staggerK = 1;
      player.vel.x *= Math.exp(-8 * dt); player.vel.z *= Math.exp(-8 * dt);
      // he steps in to it and squares up to the iron over the first beat
      const k = Math.min(1, dt * 7);
      if (H.wT < 0.45) { player.pos.x += (H.anchor.x - player.pos.x) * k; player.pos.z += (H.anchor.z - player.pos.z) * k; }
      H.gripWorld(H.lookAt);
      const want = Math.atan2(H.lookAt.x - player.pos.x, H.lookAt.z - player.pos.z);
      let dy = want - player.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      player.yaw += dy * Math.min(1, dt * 6);
      // three heaves: each one rocks him back off his braced boot
      const beats = [0.28, 0.72, 1.12];
      if (H.kick < beats.length && H.wT >= beats[H.kick]) {
        _v.subVectors(H.seam, player.pos).setY(0); const l = _v.length() || 1;
        diverImpulse('hit', _v.x / l, _v.z / l, H.wound ? 0.35 : 0.55 + 0.15 * H.kick);
        if (!H.wound) emitDust(H.seam.x + H.normal.x * 0.2, H.seam.y - 0.2, H.seam.z + H.normal.z * 0.2, 2, 0.5);
        H.kick++;
      }
      // the iron works in the seam: it shudders on each heave and draws out a hand's breadth,
      // then the last of it all at once
      if (!H.wound) {
        const u = H.wT / WRENCH_T;
        let near = 9;
        for (const b of beats) near = Math.min(near, Math.abs(H.wT - b - 0.06));
        const shud = 0.035 * Math.sin(H.wT * 38) * Math.exp(-((near / 0.09) ** 2));
        const out = 0.05 * u + 0.30 * Math.pow(Math.max(0, (u - 0.86) / 0.14), 2);
        _e.set(shud, shud * 0.7, 0);
        _q.setFromEuler(_e);
        // (it works about the seam, not its own ferrule: slid out by `out`, then turned about the seam)
        const zs = DIM.tip - LODGE_IN;
        _v.set(0, 0, out + zs).applyQuaternion(_q);
        _m.makeRotationFromQuaternion(_q).setPosition(-_v.x, -_v.y, zs - _v.z);
        piv.matrix.multiplyMatrices(H.pivBase, _m);
        piv.matrixWorldNeedsUpdate = true;
      }
      if (H.wT >= WRENCH_T) free(player);
    }
    // ---- after: the line, the save, the wake ----
    if (H.justPulled) { ev.pulled = true; H.justPulled = false; }
    if (H.pendingLine && !ev.msg) { ev.msg = H.pendingLine; H.pendingLine = null; }
    if (H.wakeT > 0 && (H.wakeT -= dt) <= 0) { H.wakeT = -1; if (H.onWake) H.onWake(); }
    // ---- the weep ----
    if (H.weepT > 0) {
      H.weepT -= dt;
      H.weepAcc = (H.weepAcc || 0) + dt * H.weepRate;
      while (H.weepAcc >= 1) { H.weepAcc -= 1; spawnWeep(); }
    }
    if (H.weep.count > 0) {
      const W = H.wp, F = H.fade;
      let live = 0;
      for (let i = 0; i < H.weep.count; i++) {
        const o = i * 8;
        if (W[o + 7] > 0) { W[o + 6] += dt; if (W[o + 6] >= W[o + 7]) W[o + 7] = 0; }
        if (W[o + 7] <= 0) { F[i] = 0; _s.setScalar(0); H.weep.setMatrixAt(i, _m.compose(_v.set(W[o], W[o + 1], W[o + 2]), camera.quaternion, _s)); continue; }
        const age = W[o + 6], life = W[o + 7];
        live++;
        const drag = Math.exp(-1.2 * dt);
        W[o + 3] *= drag; W[o + 5] *= drag; W[o + 4] = W[o + 4] * drag + 0.03 * dt;   // it hangs, rises a little, spreads
        W[o] += W[o + 3] * dt; W[o + 1] += W[o + 4] * dt; W[o + 2] += W[o + 5] * dt;
        const u = age / life;
        F[i] = 0.6 * Math.min(1, u * 8) * Math.pow(1 - u, 1.3);           // in fast, thinning as it spreads
        _s.setScalar(0.22 + 1.1 * Math.sqrt(u));
        H.weep.setMatrixAt(i, _m.compose(_v.set(W[o], W[o + 1], W[o + 2]), camera.quaternion, _s));
      }
      H.weep.instanceMatrix.needsUpdate = true;
      H.weep.geometry.attributes.aFade.needsUpdate = true;
      if (!live && H.weepT <= 0) H.weep.count = 0;
    }
    // ---- the glint: the brass ferrule catching his lantern (lodged only) ----
    let f = 0;
    if (iron.visible && L.dormant && player) {
      // the ferrule's centre, stood a little off it toward him (the pole never clips it)
      _a.set(0, 0, (DIM.fer0 + DIM.fer1) * 0.5).applyMatrix4(H.worldM);
      _v.subVectors(player.pos, _a);
      const dist = _v.length() || 1;
      _v.multiplyScalar(1 / dist);
      gl.position.copy(_a).addScaledVector(_v, 0.12);
      // a cylinder flashes where its axis stands square to the line of sight; his lantern must be
      // turned toward it (he faces it); bright close, gone by GLINT_FAR; his lantern's charge
      const sq = 1 - Math.abs(H.axis.dot(_v));
      _fw.set(Math.sin(player.yaw), 0, Math.cos(player.yaw));
      const face = Math.max(0, -(_fw.x * _v.x + _fw.z * _v.z));
      const lit = Math.max(0, player.light == null ? 1 : player.light);
      f = sq * sq * Math.pow(face, 3) * lit * clamp(1 - (dist - 2) / (GLINT_FAR - 2), 0, 1) * (0.85 + 0.15 * Math.sin(H.t * 2.3));
      // first sight: once per anchorage, when his light finds it
      if (!sightSaid[site] && f > 0.25 && dist < SIGHT_R && !ev.msg) { sightSaid[site] = 1; ev.msg = LINE_FIRST_SIGHT; }
    }
    H.glint = f;
    gl.material.opacity = GLINT_K * f;
  };
  H.dispose = () => { /* everything is in her group: disposeSleeper frees it (the model's shared set is kept) */ };
  return H;
}
// dev: forget the first-sight lines (probes)
export function resetHarpoonSight() { sightSaid.fill(0); }
