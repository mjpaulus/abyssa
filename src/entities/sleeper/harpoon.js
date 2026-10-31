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
//                    x/z on the ground spot; y = the ground he stands on: terrainH, or buried the DRAWN ground there (the dune, or her
//                    crest's footing: groundY below)), H.seamWorld() (the entry point), H.dispose()
//
// THE REWARD: survival.hasHarpoon on the first pull EVER, at any site (saved as tools.harpoon by game.js
// on ev.pulled). A remote anchorage's harpoon is another diver's: the trigger, and the blade only if
// Sal has none yet. THE OLD WOUND: on a revisit the seam holds a healed scar; pressing it is the same
// commitment and the remembered rite's start, and grants nothing.
//
// THE MODEL is ONE generated asset (src/lib/harpoonSculpt.js -> assets/harpoon via tools/blender),
// shared with Task 7 (Sal's blade): src/lib/harpoonModel.js harpoonModel() hands any owner its geometry and a fresh material
// (sculpted when the asset has landed, else the procedural lathe-and-box build with the same DIM).
//
// RENDER: the iron (1 draw), the line down to the silt (1), the wound scar (1, hidden until there is
// one), the weep (1 instanced draw of camera-facing dark puffs, render only: her sight never reads it),
// the glint (the eyeshine's warm-glow program, fog off, its own fade). No lights. Everything exists
// from the build (hidden things are drawn by the boot's warm frames), so nothing compiles on sight.
// Zero per-frame allocation (module temps).
import * as THREE from 'three';
import { camera, envTexDeep as envTex } from '../../core.js';
import { V3, clamp } from '../../lib/math.js';
import { makeWarmGlow, seededRand } from '../../lib/textures.js';
import { HARPOON_ASSET, harpoonModel, harpoonSculpted } from '../../lib/harpoonModel.js';
import { DIM } from '../../lib/harpoonSculpt.js';
import { terrainH, extraFloorAt } from '../../world/terrain.js';
import { fissureDist } from '../../world/fissureShape.js';
import { currentSiteIndex } from '../../world/site.js';
import { emitDust } from '../../world/footfx.js';
import { stirPulse, P_STRIKE } from '../../world/stir.js';
import { survival } from '../../systems/survival.js';
import { diverImpulse } from '../diver.js';
import { bodyBlocked, inClutch, blockWhy } from './bodyCols.js';
import { rimR as G_rimR } from './brooderGeo.js';
import { sandY, crestY, shellTopW, crustWoundRec, setCrustWoundRec } from './burial.js';
const G = { rimR: G_rimR };


export const WRENCH_T = 1.5;          // the commitment (s): brace, wrench, wrench, free
const BEATS = [0.28, 0.72, 1.12];     // the three heaves (s into the wrench)
// (velkath-buried-rock Task 4) a buried seam stands over the DRAWN SAND (the floor or the dune, never her crest) by this much (u)
const SEAM_UP = 0.25;
const SEAT_TRY = 10;                  // buried + reachable seams scored before the search stops (best pre-score first)
const AX_UPS = [0.18, 0.06, 0.3];     // the entry's rise per unit in (tried in turn per seam)
export const REACH = 2.6;             // prompt / interact range from the anchor (horizontal, u)
const WAKE_DELAY = 0.7;               // it comes free, she shudders a beat later (the wake's own sequence takes ~6 s)
// how much of the iron is in her (model units, from the point): the head, the pin and the shank up to the
// socket (fix round 1: at 0.30 the point and the head stood out of her, leaned on the margin's lip)
const LODGE_IN = 0.605;
// the burial test (seat): these model points must be inside her drawn shell by at least `d` (u)
const BURY = [[0, 0, 0.62, 0.15], [0, 0, 0.52, 0.15], [0.06, 0, 0.45, 0.12], [-0.06, 0, 0.45, 0.12], [0, 0, 0.40, 0.15], [0, 0, 0.25, 0.06], [0, 0, 0.12, 0.02]];

// the lodged iron is drawn 1.3x the hand-scale model (a whaling iron for a colossus: 2.1 u, the pole
// reaching out past her folded legs to where a man on the sand takes it); Task 7's blade is 1x
export const LODGED_S = 1.3;
const GRIP_Z = -0.72;                 // where his hands close on the lodged pole (model z: aft of the lashing)
const GLINT_K = 1.0, GLINT_FAR = 120, SIGHT_R = 24;   // (the sprite's own fade runs on the LENS's distance, long and shallow)
// the range cue: nothing inside GL_NEAR u of him (the lit brass carries it there), full from GL_FULL, gone
// between GL_OUT0 and GL_OUT1 (the murk has it by then)
const GL_NEAR = 3, GL_FULL = 6.5, GL_OUT0 = 26, GL_OUT1 = 40, GL_CATCH = 0.4;
// (oldwound) the old wound's broken barb glints on the same curve, colder, smaller and dimmer than the brass did (k of the iron's)
const OLD_GLINT_K = 0.45, OLD_GLINT_C = 0xc4d6e6, OLD_GLINT_S = 0.4;
// (oldwound) the ray that finds the seam's OUTER surface: from OUT_R u out over the lip (the normal's level part, OUT_UP up), back in, through her shell's triangles within OUT_NEAR u
const OUT_R = 1.2, OUT_NEAR = 2.5, OUT_UP = 0.7;
export const LINE_FIRST_SIGHT = 'A HARPOON IN HER SIDE. SOMEONE CAME BEFORE YOU.';
export const LINE_FREE_HOME = 'IT COMES FREE. SHE FEELS IT.';
export const LINE_FREE_REMOTE = "ANOTHER DIVER'S HARPOON.";
// "once per site": the first-sight line is the anchorage's, not the build's (she is rebuilt on
// every zone entry), so it is remembered here for the session
const sightSaid = new Uint8Array(8);

const _v = V3(), _w = V3(), _n = V3(), _a = V3(), _b = V3(), _up = V3(0, 1, 0), _fw = V3();
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = V3(1, 1, 1), _nm = new THREE.Matrix3();
const _e = new THREE.Euler();

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

// (oldwound) THE OLD WOUND AT HOME (a remembered build, buried): the healed scar above sat flush on the crest seam, which is a crevice
// vertex under an overhang of her rock: 154 of its 176 vertices lay inside her drawn shell (up to 0.54 u, its centre 0.26 u under the
// overhang): what reached the screen was an 8 px fleck from 10 u (burial-probe wound on 983224c). The wound is now painted into her
// shell by the crust (burial.js setCrustWound: the stain, the torn pit, the callus, the rust) at the seam's OUTER surface (seat: a ray
// in from over the lip, outerHit),
// and this small piece is what stands proud of it there: the torn lip of the puncture, and in it the broken BARB of the iron, a dull
// cold flake whose glint is the range cue (H.update). Its own geometry in the scar's own material: the same program
let _oldGeo = null;
export const BARB_TIP = [0.028, 0.034, 0.15];      // (the barb's tip in the piece's frame: the glint's seat)
function oldWoundGeo() {
  if (_oldGeo) return _oldGeo;
  const RINGS = 5, SEG = 18, rnd = seededRand(0x01D3);
  const jit = Array.from({ length: SEG }, () => 0.7 + 0.6 * rnd());
  const pos = [], colr = [], idx = [];
  for (let i = 0; i <= RINGS; i++) {
    const f = i / RINGS;
    for (let j = 0; j < SEG; j++) {
      const a = j / SEG * Math.PI * 2, r = 0.13 * f * (i === 0 ? 0 : (i === RINGS ? jit[j] : 0.85 + 0.15 * jit[j]));
      // a pit, and a torn lip standing up round it (the shell broken outward where the iron was wrenched)
      const zz = -0.07 * Math.pow(1 - f, 1.6) + 0.035 * Math.exp(-(((f - 0.7) / 0.18) ** 2)) * jit[j];
      pos.push(Math.cos(a) * r, Math.sin(a) * r, zz);
      const pit = Math.pow(1 - f, 1.2), lip = Math.exp(-(((f - 0.7) / 0.2) ** 2));
      colr.push(0.02 + 0.16 * lip * (1 - pit), 0.012 + 0.07 * lip * (1 - pit), 0.008 + 0.035 * lip * (1 - pit));
    }
  }
  for (let i = 0; i < RINGS; i++) for (let j = 0; j < SEG; j++) {
    const a = i * SEG + j, b = i * SEG + (j + 1) % SEG, c = a + SEG, d = b + SEG;
    idx.push(a, c, b, b, c, d);
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  g.setIndex(idx);
  g = g.toNonIndexed();
  // the barb: a flat broken wedge of iron out of the pit, leaning off the normal (flat shaded, cold dark grey)
  const A = [-0.032, -0.008, -0.03], B = [0.032, -0.008, -0.03], C = [0, 0.012, -0.03], T = BARB_TIP;
  const bp = [...A, ...B, ...T, ...B, ...C, ...T, ...C, ...A, ...T], bc = [];
  for (let k = 0; k < 9; k++) bc.push(...(k % 3 === 2 ? [0.30, 0.31, 0.33] : [0.09, 0.09, 0.10]));
  const P0 = g.attributes.position.array, C0 = g.attributes.color.array;
  const P1 = new Float32Array(P0.length + bp.length), C1 = new Float32Array(C0.length + bc.length);
  P1.set(P0); P1.set(bp, P0.length); C1.set(C0); C1.set(bc, C0.length);
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P1, 3));
  out.setAttribute('color', new THREE.BufferAttribute(C1, 3));
  out.computeVertexNormals();
  g.dispose();
  _oldGeo = out;
  return out;
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

// (oldwound) the seam's OUTER surface: a ray from OUT_R u out along the normal, back in, against her drawn shell's triangles near it (an
// event at seat; a distance cull first, so a few hundred of her ~70k triangles are tested). _oh: p the first surface it meets, n its
// normal (her face's, turned out to the seam's side, eased half to the seam's), t how far over the seam it is; no hit = the seam itself
const _oh = { p: V3(), n: V3(), t: 0 }, _ta = V3(), _tb = V3(), _tc = V3(), _e1 = V3(), _e2 = V3(), _pv = V3(), _tv = V3(), _qv = V3(), _ro = V3(), _rd = V3(), _fn = V3();
function outerHit(sh, mw, seam, n) {
  const P = sh.geometry.attributes.position, I = sh.geometry.index, nT = I ? I.count / 3 : P.count / 3, near2 = OUT_NEAR * OUT_NEAR;
  _ro.copy(seam).addScaledVector(n, OUT_R); _rd.copy(n).negate();
  let best = Infinity;
  for (let t = 0; t < nT; t++) {
    const ia = I ? I.getX(t * 3) : t * 3;
    _ta.fromBufferAttribute(P, ia).applyMatrix4(mw);
    if (_ta.distanceToSquared(seam) > near2) continue;
    _tb.fromBufferAttribute(P, I ? I.getX(t * 3 + 1) : t * 3 + 1).applyMatrix4(mw);
    _tc.fromBufferAttribute(P, I ? I.getX(t * 3 + 2) : t * 3 + 2).applyMatrix4(mw);
    _e1.subVectors(_tb, _ta); _e2.subVectors(_tc, _ta);
    _pv.crossVectors(_rd, _e2); const det = _e1.dot(_pv);
    if (Math.abs(det) < 1e-12) continue;
    const inv = 1 / det; _tv.subVectors(_ro, _ta);
    const u = _tv.dot(_pv) * inv; if (u < 0 || u > 1) continue;
    _qv.crossVectors(_tv, _e1); const v = _rd.dot(_qv) * inv; if (v < 0 || u + v > 1) continue;
    const d = _e2.dot(_qv) * inv;
    if (d <= 0 || d >= best) continue;
    _fn.crossVectors(_e1, _e2).normalize();
    if (_fn.dot(n) < 0) _fn.negate();
    best = d; _oh.n.copy(_fn);
  }
  if (best < Infinity) { _oh.p.copy(_ro).addScaledVector(_rd, best); _oh.n.add(n).normalize(); _oh.t = OUT_R - best; }
  else { _oh.p.copy(seam); _oh.n.copy(n); _oh.t = 0; }
  return _oh;
}

// ---- the build ---------------------------------------------------------------------------------
export function makeHarpoon(L, opts = {}) {
  const wound = !!opts.wound;
  const site = currentSiteIndex() | 0;
  const H = {
    wound, pulled: wound, wrenching: false, pressed: false, seated: false,
    anchor: V3(), seam: V3(), normal: V3(), axis: V3(), lookAt: null,
    t: 0, wT: 0, freeT: -1, wakeT: -1, weepT: 0, weepRate: 0, weepHead: 0, kick: 0, pendingLine: null, line: null, first: false,
    glint: 0, onWake: null, site, sightLine: LINE_FIRST_SIGHT, sighted: !!opts.sighted, catchT: 0
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
    if (!harpoonSculpted() || L.gone) return;
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
  // (oldwound) a remembered build at home, buried: the old wound is painted into her shell (the crust) and this mesh is its proud piece
  const oldW = wound && !!L.buried;
  H.oldW = oldW;
  // (oldwound) H.healed: the old wound is what shows at the seam (the remembered build from the start; a fresh pull's wound once she digs
  // back in: heal, H.update); a pull or a press opens it fresh again (free)
  H.healed = oldW;
  const scarGeo = oldW ? oldWoundGeo() : woundGeo();
  const scar = new THREE.Mesh(scarGeo, woundMat);
  scar.castShadow = false; scar.receiveShadow = true;
  scar.matrixAutoUpdate = false;
  scar.visible = wound;
  L.body.add(scar);
  H.scar = scar;
  L.keepGeo = new Set([...(L.keepGeo || []), scarGeo]);
  if (L.buried) { L.keepGeo.add(woundGeo()); L.keepGeo.add(oldWoundGeo()); }   // (a buried build may swap one for the other: heal)
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
  const gl = makeWarmGlow(0xffe0a6, 0.9, { near: 40, far: GLINT_FAR, nearW: 0, swell: 0.02, swellMax: 1.5 });
  gl.material.opacity = 0;
  gl.renderOrder = 3;
  // (oldwound) the barb's glint: cold and small (the brass's is warm); a uniform, the same program
  const glintOld = () => { gl.material.color.setHex(OLD_GLINT_C); gl.scale.setScalar(OLD_GLINT_S); };
  if (oldW) glintOld();
  L.grp.add(gl);
  H.glintSpr = gl;

  // The iron went in from below and outside: a diver on the sand drove it into the seam at her margin,
  // nearly level and a little up (fix round 1: at 0.64 up it ran through the margin's thin lip and its
  // point stood out of the top), a little aft; its pole hangs out and down to where a standing man takes
  // it. axisFor: the model's +Z (the point, into her) from the seam's normal.
  const _ax = V3(), _o = V3(), _p = V3(), _g = V3();
  let axUp = 0.18;                    // the rise of the entry (tried per seam: AX_UPS)
  const axisFor = (n, out) => {
    const nh = Math.hypot(n.x, n.z) || 1;
    return out.set(-n.x / nh * 0.96 - _fw.x * 0.10, axUp, -n.z / nh * 0.96 - _fw.z * 0.10).normalize();
  };
  // ---- THE BURIAL TEST: rays against her drawn shell (seat time only) ----
  // TRI: world-space triangles of the shell near the flank (9 floats each), gathered once per seat and
  // bucketed on an x/z grid (GC u cells, CSR: CELL0 offsets into CELLT). A point is INSIDE her when the
  // vertical ray up from it and the one down both meet her surface first from the inside (her shell is
  // closed and wound outward: an exit face); its depth is the nearer of the two. (Vertical rays only need
  // the triangles over the point's own cell: the whole test is a few dozen triangles.)
  const GC = 0.5;
  const ROPE_STEP = 0.02, ROPE_LIE = 0.01, ROPE_CREST = 0.05;   // (buried: the rope's control spacing along its lying length, and how far each sits over the drawn ground)
  let TRI = new Float32Array(0), nTri = 0, CELL0 = new Int32Array(0), CELLT = new Int32Array(0), gx0 = 0, gz0 = 0, gnx = 0, gnz = 0;
  let keelR = 0.6;                    // (the crest gather's keel radius; _crestScan's opts.keelR may widen it for a diagnosis, then puts it back)
  const gatherTris = (sh, mw, sa, crest = false) => {
    const P = sh.geometry.attributes.position, I = sh.geometry.index, n = I ? I.count / 3 : P.count / 3;
    if (TRI.length < n * 9) TRI = new Float32Array(n * 9);
    nTri = 0;
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let t = 0; t < n; t++) {
      const i0 = I ? I.getX(t * 3) : t * 3, i1 = I ? I.getX(t * 3 + 1) : t * 3 + 1, i2 = I ? I.getX(t * 3 + 2) : t * 3 + 2;
      const cx = (P.getX(i0) + P.getX(i1) + P.getX(i2)) / 3, cy = (P.getY(i0) + P.getY(i1) + P.getY(i2)) / 3, cz = (P.getZ(i0) + P.getZ(i1) + P.getZ(i2)) / 3;
      // (velkath-buried-rock) buried, the seam is in her CREST: the band reaches her top and there is no radial floor (near her keel,
      // where a candidate's bearing from her centre means little, every triangle within 0.6 of her centre is kept whatever its bearing).
      // This widens the DATA the burial test reads, never its thresholds (BURY's depths, AX_UPS). Seat time only.
      if (crest ? (cy < -0.4 || cy > 0.5) : (cy < -0.4 || cy > 0.4)) continue;
      const th = Math.atan2(cz, cx); let dth = th - sa; dth = Math.atan2(Math.sin(dth), Math.cos(dth));
      if (crest ? (Math.abs(dth) > 1.45 && Math.hypot(cx, cz) > keelR) : (Math.abs(dth) > 1.45 || Math.hypot(cx, cz) < G.rimR(th) * 0.5)) continue;
      const o = nTri * 9;
      _v.fromBufferAttribute(P, i0).applyMatrix4(mw); TRI[o] = _v.x; TRI[o + 1] = _v.y; TRI[o + 2] = _v.z;
      _v.fromBufferAttribute(P, i1).applyMatrix4(mw); TRI[o + 3] = _v.x; TRI[o + 4] = _v.y; TRI[o + 5] = _v.z;
      _v.fromBufferAttribute(P, i2).applyMatrix4(mw); TRI[o + 6] = _v.x; TRI[o + 7] = _v.y; TRI[o + 8] = _v.z;
      for (const k of [0, 3, 6]) { x0 = Math.min(x0, TRI[o + k]); x1 = Math.max(x1, TRI[o + k]); z0 = Math.min(z0, TRI[o + k + 2]); z1 = Math.max(z1, TRI[o + k + 2]); }
      nTri++;
    }
    gx0 = x0; gz0 = z0; gnx = Math.max(1, Math.ceil((x1 - x0) / GC) + 1); gnz = Math.max(1, Math.ceil((z1 - z0) / GC) + 1);
    const cnt = new Int32Array(gnx * gnz + 1);
    const each = (t, fn) => {
      const o = t * 9;
      const a0 = Math.floor((Math.min(TRI[o], TRI[o + 3], TRI[o + 6]) - gx0) / GC), a1 = Math.floor((Math.max(TRI[o], TRI[o + 3], TRI[o + 6]) - gx0) / GC);
      const b0 = Math.floor((Math.min(TRI[o + 2], TRI[o + 5], TRI[o + 8]) - gz0) / GC), b1 = Math.floor((Math.max(TRI[o + 2], TRI[o + 5], TRI[o + 8]) - gz0) / GC);
      for (let b = b0; b <= b1; b++) for (let a = a0; a <= a1; a++) fn(b * gnx + a);
    };
    for (let t = 0; t < nTri; t++) each(t, c => { cnt[c + 1]++; });
    for (let c = 0; c < gnx * gnz; c++) cnt[c + 1] += cnt[c];
    CELL0 = cnt; CELLT = new Int32Array(cnt[gnx * gnz]);
    const fill = new Int32Array(gnx * gnz);
    for (let t = 0; t < nTri; t++) each(t, c => { CELLT[CELL0[c] + fill[c]++] = t; });
  };
  // the first hit of the vertical ray from (px, py, pz) going dir (+1 up, -1 down): sets RAY.t, RAY.exit
  const RAY = { t: 1e9, exit: false };
  const vray = (px, py, pz, dir) => {
    RAY.t = 1e9; RAY.exit = false;
    const a = Math.floor((px - gx0) / GC), b = Math.floor((pz - gz0) / GC);
    if (a < 0 || b < 0 || a >= gnx || b >= gnz) return;
    const c = b * gnx + a;
    for (let q = CELL0[c]; q < CELL0[c + 1]; q++) {
      const o = CELLT[q] * 9;
      const ax = TRI[o], az = TRI[o + 2], bx = TRI[o + 3], bz = TRI[o + 5], cx = TRI[o + 6], cz = TRI[o + 8];
      // barycentric in x/z
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (d > -1e-12 && d < 1e-12) continue;
      const l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / d, l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / d, l3 = 1 - l1 - l2;
      if (l1 < 0 || l2 < 0 || l3 < 0) continue;
      const y = l1 * TRI[o + 1] + l2 * TRI[o + 4] + l3 * TRI[o + 7], t = (y - py) * dir;
      if (t <= 1e-5 || t >= RAY.t) continue;
      RAY.t = t;
      // the face's normal y (e1 x e2): an exit face going up faces up
      const ny = (TRI[o + 5] - TRI[o + 2]) * (TRI[o + 6] - TRI[o]) - (TRI[o + 3] - TRI[o]) * (TRI[o + 8] - TRI[o + 2]);
      RAY.exit = ny * dir > 0;
    }
  };
  // depth of world point (px, py, pz) inside her (-1: outside)
  const depthIn = (px, py, pz) => {
    vray(px, py, pz, 1); if (!RAY.exit || RAY.t > 1e8) return -1;
    const up = RAY.t;
    vray(px, py, pz, -1); if (!RAY.exit || RAY.t > 1e8) return -1;
    return Math.min(up, RAY.t);
  };
  const _bx = V3(), _by = V3();
  let buriedFail = -1, buriedDep = 0;   // (dev: the BURY point a failed burial test stopped at, and its depth; _crestScan books them)
  // the head and the shank buried (every BURY point at its depth), for a seam p with normal n
  const buried = (p, n) => {
    axisFor(n, _ax);
    _by.copy(_up).addScaledVector(_ax, -_up.dot(_ax)).normalize();
    _bx.crossVectors(_by, _ax);
    _o.copy(p).addScaledVector(_ax, -(DIM.tip - LODGE_IN) * LODGED_S);
    let worst = 1e9, k = 0;
    for (const [x, y, z, d] of BURY) {
      _g.copy(_o).addScaledVector(_bx, x * LODGED_S).addScaledVector(_by, y * LODGED_S).addScaledVector(_ax, z * LODGED_S);
      const dep = depthIn(_g.x, _g.y, _g.z);
      if (dep < d) { buriedFail = k; buriedDep = dep; return -1; }
      k++;
      worst = Math.min(worst, dep - d);
    }
    return worst;
  };
  H._buriedScan = () => {   // (dev probe) burial over every margin-edge seam: [ok count, best margin, per-point fail histogram]
    const sh = L.parts.shell, mw = sh.matrixWorld, P = sh.geometry.attributes.position, N = sh.geometry.attributes.normal;
    L.grp.updateMatrixWorld(true); _nm.getNormalMatrix(mw); _fw.set(Math.sin(L.yaw), 0, Math.cos(L.yaw));
    const sa = L.sandSide > 0 ? 0 : Math.PI; gatherTris(sh, mw, sa);
    const fail = new Array(BURY.length).fill(0); let ok = 0, n = 0, bestW = -9;
    for (let i = 0; i < P.count; i += 3) {
      _v.fromBufferAttribute(P, i); if (_v.y < -0.13 || _v.y > 0.08) continue;
      const th = Math.atan2(_v.z, _v.x); let dth = th - sa; dth = Math.atan2(Math.sin(dth), Math.cos(dth));
      if (Math.abs(dth) > 1.15 || Math.hypot(_v.x, _v.z) < G.rimR(th) * 0.95) continue;
      _n.fromBufferAttribute(N, i).applyMatrix3(_nm).normalize(); const ns = _n.x * L.sand.x + _n.z * L.sand.z;
      if (ns < 0.55 || _n.y > 0.55 || _n.y < -0.45) continue;
      _v.applyMatrix4(mw); n++;
      axisFor(_n, _ax); _by.copy(_up).addScaledVector(_ax, -_up.dot(_ax)).normalize(); _bx.crossVectors(_by, _ax);
      _o.copy(_v).addScaledVector(_ax, -(DIM.tip - LODGE_IN) * LODGED_S);
      let w = 1e9, k = 0;
      for (const [x, y, z, d] of BURY) { _g.copy(_o).addScaledVector(_bx, x * LODGED_S).addScaledVector(_by, y * LODGED_S).addScaledVector(_ax, z * LODGED_S);
        const dep = depthIn(_g.x, _g.y, _g.z); if (dep < d) { fail[k]++; w = -1; break; } w = Math.min(w, dep - d); k++; }
      if (w >= 0) ok++; bestW = Math.max(bestW, w);
    }
    return { n, ok, bestW, fail };
  };
  // (velkath-buried-rock Task 4, dev probe) THE CREST SCAN: seat()'s buried candidate filter run vertex by vertex over the whole shell,
  // counting the survivors after each filter in order (exposed, side, back, facing, crack), then the data column `under` (of crack's
  // survivors, those 0.1 u inside whose vertical rays find gathered triangles both above and below: the crest gather covers them), the
  // burial test with the crest gather (`buried`) and with the shipped margin gather beside it (`buriedMargin`), the reach (`reach`:
  // seams trySeam strict stands him at; `pass`: seam x entry-rise pairs that do), the best score and where it sits. Every crack survivor
  // is tried (seat() stops at SEAT_TRY passes). `measured` is false when `under` is under 90% of `crack`: the gather does not cover the
  // crest and a 0 is a data gap, never "no seat". Leaves seat()'s scratch as it found it (axUp, H.dbg, the gather: re-seat to rebuild).
  // (opts.side, diagnosis only, never run by seat(): 'off' (default, seat()'s own since the Task 4 ruling: no bearing test, the facing
  // test keeps the seam toward the sand), 'body' (the plan's 1.15 rad bearing from her centre: 28 / 12 / 8 survivors, 0 buried), 'crest'
  // (the bearing from the strip's centre, burial.js MD.bx / bz). opts.keelR widens the crest gather's keel radius for a diagnosis.)
  // COVERAGE: `under` alone undercounts on a thin knob (0.1 u in exits its far face), so the scan also gathers EVERY triangle and re-counts
  // buried / reach: equal counts mean the crest gather misses nothing the test reads, and the scan is measured (Task 4 ruling 2)
  H._crestScan = (opts = {}) => {
    const sideMode = opts.side || 'off';
    const sh = L.parts && L.parts.shell; if (!sh || !L.buried || !L.mound) return { err: 'not a buried build (L.buried ' + !!L.buried + ', mound ' + !!L.mound + ')' };
    L.grp.updateMatrixWorld(true);
    const mw = sh.matrixWorld, P = sh.geometry.attributes.position, N = sh.geometry.attributes.normal, idx = L.idx, sand = L.sand;
    _nm.getNormalMatrix(mw); _fw.set(Math.sin(L.yaw), 0, Math.cos(L.yaw));
    if (L.publishCols) L.publishCols();
    const sa = L.sandSide > 0 ? 0 : Math.PI, backHalf = !!(L.lair && L.lair.seat === 'back');
    const out = { sideMode, keelR: opts.keelR || 0.6, n: P.count, exposed: 0, side: 0, back: 0, facing: 0, crack: 0, under: 0, buried: 0, buriedMargin: 0, reach: 0, pass: 0, best: null, measured: false, backHalf,
      buryFail: BURY.map(() => 0), buryDep: [] };
    const surv = [];
    for (let i = 0; i < P.count; i++) {
      _v.fromBufferAttribute(P, i); _w.copy(_v).applyMatrix4(mw);
      if (!(_w.y >= sandY(L.mound, _w.x, _w.z, idx) + SEAM_UP)) continue; out.exposed++;
      let th = Math.atan2(_v.z, _v.x);
      if (sideMode === 'crest') { _a.set(L.mound.bx, _w.y, L.mound.bz).applyMatrix4(_m2.copy(L.body.matrixWorld).invert()); _b.copy(_w).applyMatrix4(_m2); th = Math.atan2(_b.z - _a.z, _b.x - _a.x); }
      let dth = th - sa; dth = Math.atan2(Math.sin(dth), Math.cos(dth));
      if (sideMode !== 'off' && Math.abs(dth) > 1.15) continue; out.side++;
      if (backHalf && _v.z > 0) continue; out.back++;
      _n.fromBufferAttribute(N, i).applyMatrix3(_nm).normalize();
      const ns = _n.x * sand.x + _n.z * sand.z;
      if (ns < 0.35 || _n.y > 0.8) continue; out.facing++;
      if (fissureDist(_w.x, _w.z, idx) < 8) continue; out.crack++;
      const gh = groundY(_w.x + _n.x * 1.5, _w.z + _n.z * 1.5);
      surv.push([i, 0.25 * Math.abs(dth) + 0.6 * (1 - ns) + 0.3 * Math.abs(_w.y - gh - 1.6)]);
    }
    const ax0 = axUp, dbg0 = H.dbg;
    try {   // (a throw mid-scan must not leave keelR at 9 / axUp / H.dbg for the next seat(): the finally puts them back)
    H.dbg = { tried: 0, shaft: 0, high: 0, body: 0, sand: 0 };
    // the shipped margin gather first (buriedMargin), then the crest gather (under, buried, reach)
    gatherTris(sh, mw, sa, false);
    for (const [i] of surv) { _v.fromBufferAttribute(P, i).applyMatrix4(mw); _n.fromBufferAttribute(N, i).applyMatrix3(_nm).normalize();
      if (AX_UPS.some(up => (axUp = up, buried(_v, _n) >= 0))) out.buriedMargin++; }
    if (opts.keelR) keelR = opts.keelR;
    gatherTris(sh, mw, sa, true);
    keelR = 0.6;
    out.tris = nTri;
    let best = Infinity, bi = -1, bUp = 0;
    for (const [i, pre] of surv) {
      _v.fromBufferAttribute(P, i).applyMatrix4(mw); _n.fromBufferAttribute(N, i).applyMatrix3(_nm).normalize();
      _a.copy(_v).addScaledVector(_n, -0.1);
      vray(_a.x, _a.y, _a.z, 1); const hu = RAY.t < 1e8; vray(_a.x, _a.y, _a.z, -1); const hd = RAY.t < 1e8;
      if (hu && hd) out.under++;
      let isB = false, isR = false;
      for (const up of AX_UPS) {
        axUp = up;
        if (buried(_v, _n) < 0) { out.buryFail[buriedFail]++; if (up === AX_UPS[0]) out.buryDep.push(+buriedDep.toFixed(2)); continue; }
        isB = true;
        const sc = trySeam(_v, _n, true);
        if (sc < Infinity) { isR = true; out.pass++; (out.seams || (out.seams = [])).push({ i, up, score: +(sc + pre).toFixed(3), side: +((_v.x - L.pos.x) * sand.x + (_v.z - L.pos.z) * sand.z).toFixed(2), world: [+_v.x.toFixed(2), +_v.y.toFixed(2), +_v.z.toFixed(2)] }); if (sc + pre < best) { best = sc + pre; bi = i; bUp = up; } }
      }
      if (isB) out.buried++; if (isR) out.reach++;
    }
    out.reject = H.dbg;
    // the full-shell control: every triangle gathered (keelR past her whole plan), buried / reach re-counted
    keelR = 9; gatherTris(sh, mw, sa, true); keelR = 0.6;
    let fb = 0, fr = 0;
    H.dbg = { tried: 0, shaft: 0, high: 0, body: 0, sand: 0 };
    for (const [i] of surv) { _v.fromBufferAttribute(P, i).applyMatrix4(mw); _n.fromBufferAttribute(N, i).applyMatrix3(_nm).normalize();
      let b = false, r = false; for (const up of AX_UPS) { axUp = up; if (buried(_v, _n) < 0) continue; b = true; if (trySeam(_v, _n, true) < Infinity) r = true; }
      if (b) fb++; if (r) fr++; }
    out.full = { tris: nTri, buried: fb, reach: fr };
    const underOk = out.crack > 0 && out.under >= 0.9 * out.crack, sameFull = fb === out.buried && fr === out.reach;
    out.measured = out.crack > 0 && (underOk || sameFull);
    out.measuredBy = !out.crack ? 'nothing to measure' : underOk ? 'under >= 90% of crack' : sameFull ? 'the full-shell gather gives the same buried / reach (under ' + out.under + ' / ' + out.crack + ' is the test\'s own geometry)' : 'UNMEASURED: the crest gather misses triangles the burial test reads';
    gatherTris(sh, mw, sa, true);
    if (bi >= 0) {
      _v.fromBufferAttribute(P, bi); const lx = _v.x, lz = _v.z, ly = _v.y;
      _v.applyMatrix4(mw); _n.fromBufferAttribute(N, bi).applyMatrix3(_nm).normalize();
      axUp = bUp; trySeam(_v, _n, true);
      // the slope of her drawn top round it (burial.js shellTopW, the fit pose; central differences 0.25 u)
      const MD = L.mound, e = 0.25, tx = (shellTopW(MD, _v.x + e, _v.z) - shellTopW(MD, _v.x - e, _v.z)) / (2 * e), tz = (shellTopW(MD, _v.x, _v.z + e) - shellTopW(MD, _v.x, _v.z - e)) / (2 * e);
      out.best = { score: +best.toFixed(3), i: bi, axUp: bUp, local: [+lx.toFixed(4), +ly.toFixed(4), +lz.toFixed(4)], world: [+_v.x.toFixed(2), +_v.y.toFixed(2), +_v.z.toFixed(2)],
        normal: [+_n.x.toFixed(3), +_n.y.toFixed(3), +_n.z.toFixed(3)], overSand: +(_v.y - sandY(MD, _v.x, _v.z, idx)).toFixed(2),
        topSlopeDeg: +(Math.atan(Math.hypot(tx, tz)) * 180 / Math.PI).toFixed(1), stand: [+_p.x.toFixed(2), +_p.y.toFixed(2), +_p.z.toFixed(2)] };
    }
    } finally { keelR = 0.6; axUp = ax0; H.dbg = dbg0; }
    return out;
  };
  H._depthIn = (x, y, z) => depthIn(x, y, z);   // (dev probe; after a seat)
  const clearAt = (x, y, z, m) => !bodyBlocked(x, y, z, m) && !(inClutch(x, y, z, m) > 0);
  // (velkath-buried-rock) HIS ground, where he stands and what his hands are judged over: the drawn ground (the dune, or her crest's
  // footing once she is fully buried: bodyCols buriedFloorAt through terrain.js extraFloorAt). Off home extraFloorAt is -1e9 and
  // this is terrainH exactly. (The seam and the pole are judged against the drawn SAND instead: burial.js sandY.)
  const groundY = (x, z) => Math.max(terrainH(x, z, L.idx), extraFloorAt(x, z, L.idx));
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
    if (strict) for (const z of [0.03, -0.1, -0.3, -0.55, -0.8, -0.95]) {   // socket, ferrule, the pole to its break
      _g.copy(_o).addScaledVector(_ax, z * LODGED_S);
      if (bodyBlocked(_g.x, _g.y, _g.z, 0.05) && blockWhy !== -1) { H.dbg.shaft++; return Infinity; }
    }
    // (velkath-buried-rock) buried, the pole is CLEAR of the sand: its samples from the ferrule to the break stand >= 0.05 u over the
    // drawn sand (the floor or the dune; never her crest, which is rock the iron came out of)
    if (strict && L.buried) for (const z of [-0.1, -0.3, -0.55, -0.8, -0.95]) {
      _g.copy(_o).addScaledVector(_ax, z * LODGED_S);
      if (!(_g.y >= sandY(L.mound, _g.x, _g.z, idx) + 0.05)) { H.dbg.sand = (H.dbg.sand || 0) + 1; return Infinity; }
    }
    _g.copy(_o).addScaledVector(_ax, GRIP_Z * LODGED_S);
    // (cheap first: a grip far off a man's hands over the ground under it is never in reach)
    if (strict) { const g0 = _g.y - groundY(_g.x, _g.z); if (g0 < 0.6 || g0 > 2.2) { H.dbg.high++; return Infinity; } }
    const nh = Math.hypot(n.x, n.z) || 1, nx = n.x / nh, nz = n.z / nh;
    let best = Infinity;
    H.dbg.tried++;
    for (const d of [0.55, 0.7, 0.85, 1.0, 1.15, 1.3]) {
      for (const a of [0, 0.4, -0.4, 0.8, -0.8]) {
        const c = Math.cos(a), sn = Math.sin(a), dx = nx * c - nz * sn, dz = nx * sn + nz * c;
        const ax = _g.x + dx * d, az = _g.z + dz * d, ay = groundY(ax, az);
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
    const cand = [];
    const sa = L.sandSide > 0 ? 0 : Math.PI;
    // (seafloor relief Task 8b, Ruling 44) the site's sleeper row may keep the seam to her BACK half (lair.seat 'back': her
    // body-local z < 0; her front is +z). Home's does: turned at her raft-side bed, her left flank's middle lies at the
    // ground on the levelled flat (its margin -0.4..+0.5 u over the ground 1.5 u out, main's 1.5-2.0), so only the two ends
    // of the arc reach a man's hands and the front one scored best (1.267 against her back corner's 1.534): the fight
    // opened at her front-left. Kept to her back half, Alt+6 stands him at her back-left, as shipped. No key: no change.
    const backHalf = !!(L.lair && L.lair.seat === 'back');
    for (let i = 0; i < P.count; i++) {
      _v.fromBufferAttribute(P, i);
      if (L.buried) {
        // (velkath-buried-rock) THE CREST SEAT: only her EXPOSED crest, on the sand side, her back half (lair.seat 'back'): a vertex
        // over the DRAWN SAND by SEAM_UP u (sandY: never the crest's own top, which is his ground there), its normal toward the sand
        // side and not her top (a flank of the rock, not its crown)
        _w.copy(_v).applyMatrix4(mw);                     // (_v stays body-local for the back-half and bearing tests)
        if (!(_w.y >= sandY(L.mound, _w.x, _w.z, idx) + SEAM_UP)) continue;
        if (backHalf && _v.z > 0) continue;
        // (no bearing test here, Task 4 ruling (a): the exposed crest is a thin strip along her keel, where a bearing from her centre is
        // ~90 deg off either flank whatever side a vertex faces; the brief's 1.15 rad test left 28 of 2722 exposed vertices, none buried.
        // The facing test below keeps the seam toward the sand. dth stays in the pre-score only.)
        const th = Math.atan2(_v.z, _v.x); let dth = th - sa; dth = Math.atan2(Math.sin(dth), Math.cos(dth));
        _n.fromBufferAttribute(N, i).applyMatrix3(_nm).normalize();
        const ns = _n.x * sand.x + _n.z * sand.z;
        if (ns < 0.35 || _n.y > 0.8) continue;
        if (fissureDist(_w.x, _w.z, idx) < 8) continue;
        const gh = groundY(_w.x + _n.x * 1.5, _w.z + _n.z * 1.5);   // (where he stands: the dune, or the crest)
        cand.push(0.25 * Math.abs(dth) + 0.6 * (1 - ns) + 0.3 * Math.abs(_w.y - gh - 1.6), i);
        continue;
      }
      if (_v.y < -0.13 || _v.y > 0.08) continue;                 // the margin band (the sculpt's margin droops to -0.11 mid-flank)
      if (backHalf && _v.z > 0) continue;
      const th = Math.atan2(_v.z, _v.x);
      let dth = th - sa; dth = Math.atan2(Math.sin(dth), Math.cos(dth));
      if (Math.abs(dth) > 1.15) continue;
      if (Math.hypot(_v.x, _v.z) < G.rimR(th) * 0.95) continue;
      _n.fromBufferAttribute(N, i).applyMatrix3(_nm).normalize();
      const ns = _n.x * sand.x + _n.z * sand.z;
      if (ns < 0.55 || _n.y > 0.55 || _n.y < -0.45) continue;           // the margin's outer EDGE (its top face is a thin lip)
      _v.applyMatrix4(mw);
      if (fissureDist(_v.x, _v.z, idx) < 8) continue;
      // the cheap part of the score now (bearing, facing, the seam ~2 u over the ground out there); the
      // costly reach test only for the best SEAT_TRY of them (the full scan was 24-30 ms a build)
      const gh = terrainH(_v.x + _n.x * 1.5, _v.z + _n.z * 1.5, idx);
      cand.push(0.25 * Math.abs(dth) + 0.6 * (1 - ns) + 0.3 * Math.abs(_v.y - gh - 2.0), i);
    }
    const ord = [];
    for (let k = 0; k < cand.length; k += 2) ord.push(k);
    ord.sort((a, b) => cand[a] - cand[b]);
    // every seam (best pre-score first, at most SEAT_TRY of those that pass): its head and shank BURIED in
    // her drawn body at one of the entry rises AX_UPS (the sculpted shell is closed; the procedural one,
    // before the sculpt lands, is not, and is only reached), then the reach test; the best score wins
    const tg0 = performance.now();
    gatherTris(sh, mw, sa, !!L.buried);
    H.dbg.tGather = +(performance.now() - tg0).toFixed(1); H.dbg.tris = nTri; H.dbg.bury = 0; H.dbg.pass = 0;
    let bestUp = AX_UPS[0];
    for (let q = 0; q < ord.length && H.dbg.pass < SEAT_TRY; q++) {
      const i = cand[ord[q] + 1];
      _v.fromBufferAttribute(P, i).applyMatrix4(mw);
      _n.fromBufferAttribute(N, i).applyMatrix3(_nm).normalize();
      for (const up of AX_UPS) {
        axUp = up;
        if (L.sculpted && buried(_v, _n) < 0) continue;
        H.dbg.bury++;
        const sc = trySeam(_v, _n, true) + cand[ord[q]];
        if (sc < Infinity) { H.dbg.pass++; if (sc < best) { best = sc; bi = i; bestUp = up; H.anchor.copy(_p); } }
      }
    }
    H.dbg.tSearch = +(performance.now() - tg0).toFixed(1);
    axUp = bestUp; H.axUp = bestUp;
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
    // (oldwound) the old wound at home: on her OUTER surface over the seam (the seam is a crevice under an overhang of her rock), the
    // crust painted there, this piece seated flush on it. Measured at EVERY buried seat (her dormant pose), kept in her body's frame (the
    // piece's matrix) and her shell's (the crust's place): the remembered build shows it now; a fresh pull's wound heals into it when she
    // digs back in (heal: no ray then, the dig-in's frames stay under its cost bar), riding her body through the re-bed
    if (L.buried) {
      // (in from over the lip, not along the seam's own normal: the seam faces 25 deg DOWN, under an overhang, and the stain laid on
      // that underside was hidden from every lens above it; the lip's top-front over it faces the sand and the lens)
      _n.set(H.normal.x, 0, H.normal.z).normalize(); _n.y = OUT_UP; _n.normalize();
      outerHit(sh, mw, H.seam, _n);
      H.woundP = (H.woundP || V3()).copy(_oh.p); H.woundN = (H.woundN || V3()).copy(_oh.n);
      H.woundOut = +_oh.t.toFixed(3);
      _b.copy(_up).addScaledVector(H.woundN, -_up.dot(H.woundN)).normalize();
      _a.crossVectors(_b, H.woundN);
      _m.makeBasis(_a, _b, H.woundN).setPosition(_w.copy(H.woundP).addScaledVector(H.woundN, 0.012));
      H.outerM = (H.outerM || new THREE.Matrix4()).multiplyMatrices(_m2, _m);
      H.crustRec = crustWoundRec(L, H.woundP, H.woundN, H.crustRec || undefined);
      if (H.healed) { scar.matrix.copy(H.outerM); scar.matrixWorldNeedsUpdate = true; }
      setCrustWoundRec(L, H.crustRec, H.healed && !H.woundHidden);
    }
    // the line: from the stub's frayed end (meta.lineEnd in the model's frame), a sag down to the
    // silt and a length lying on it, half buried, out toward the sand
    {
      // (velkath-buried-rock) buried, it lies on what is DRAWN there: the dune (else the floor), or her rock in the strip (burial.js crestY,
      // her drawn top). On terrainH it dove into the dune; on sandY alone (the floor under the strip) it ran 1 u through her crest
      const gnd = L.buried ? (x, z) => Math.max(sandY(L.mound, x, z, idx), crestY(L.mound, x, z) - ROPE_CREST) : (x, z) => terrainH(x, z, idx);
      _v.set(0.052, -0.215, -0.318).applyMatrix4(H.worldM);
      const gx = _v.x + sand.x * 0.7 + _fw.x * 0.25, gz = _v.z + sand.z * 0.7 + _fw.z * 0.25, gy = gnd(gx, gz);
      const ex = _v.x + sand.x * 2.6 - _fw.x * 0.4, ez = _v.z + sand.z * 2.6 - _fw.z * 0.4, ey = gnd(ex, ez) - 0.03;
      const c0 = V3((_v.x + gx) / 2, Math.max(gy + 0.15, (_v.y + gy) / 2 - 0.12), (_v.z + gz) / 2);
      let c;
      if (!L.buried) {
        c = new THREE.CatmullRomCurve3([_v.clone(), c0, V3(gx, gy + 0.02, gz),
          V3((gx + ex) / 2, gnd((gx + ex) / 2, (gz + ez) / 2) + 0.0, (gz + ez) / 2), V3(ex, ey, ez)]);
        rope.geometry.dispose();
        rope.geometry = new THREE.TubeGeometry(c, 40, 0.0105 * LODGED_S, 6, false);
      } else {
        // (velkath-buried-rock, Task 4 fix r1 I1) the lying length is followed on the drawn ground every ROPE_STEP u. The shipped 3 control points
        // sampled gnd only at gx, the midpoint and ex, and the spline passed 0.181 u UNDER the dune where the strip ends (inStrip flips, and the
        // surface steps from her crest up the dune's lip: -0.181 u at t 0.42-0.68, 98 of 401 samples more than two radii under). In the strip the
        // baked top (crestY) stands 0.05-0.08 u over her drawn triangles, so there the rope is bedded ROPE_CREST under it (without it +0.09 u).
        // MEASURED (tube centreline, 401 samples vs the drawn ground: shell + dune meshes by ray, else terrainH; radius 0.0137): home, from the
        // gx control (t 0.323) to the end, -0.030 .. +0.048 u (the -0.030 is the end's deliberate half-bury, ey; max +0.048 where the line comes
        // down off the stub; the last half of the rope -0.030 .. +0.011), 0 samples inside her shell, 1 of 401 more than two radii under (that
        // end). Was -0.181 .. +0.076. Bar: no lower than the remote worst (Pallid -0.044) and no higher than +0.05. The tube gets 2 segments a
        // control point. Remote ropes keep the shipped 5 points, bit-identical (position-buffer hash Pallid 850c13b5, Burned 65fba35b, Shelf
        // 37d0bf08; Burned's own sag still dips and crosses her shell, untouched).
        const pts = [_v.clone(), c0, V3(gx, gy + 0.02, gz)];
        const nn = Math.max(2, Math.ceil(Math.hypot(ex - gx, ez - gz) / ROPE_STEP));
        for (let k = 1; k < nn; k++) { const x = gx + (ex - gx) * k / nn, z = gz + (ez - gz) * k / nn; pts.push(V3(x, gnd(x, z) + ROPE_LIE, z)); }
        pts.push(V3(ex, ey, ez));
        c = new THREE.CatmullRomCurve3(pts);
        rope.geometry.dispose();
        rope.geometry = new THREE.TubeGeometry(c, pts.length * 2, 0.0105 * LODGED_S, 6, false);
      }
    }
    rope.visible = !H.pulled;
    iron.visible = !H.pulled;
    H.seated = true;
    return H;
  };
  H.seamWorld = () => H.seam;
  // (oldwound) the old wound on / off whole (the probe's A/B: burial-probe wound): the piece, the crust's paint, the barb's glint
  H._woundShow = on => { H.woundHidden = !on; scar.visible = !!on && (H.wound || H.pulled); if (H.healed) setCrustWoundRec(L, H.crustRec, !!on); return !!on; };
  // (oldwound) THE HEAL: a buried build's opened wound (a fresh pull, or the remembered wound pressed) becomes the old wound as she digs
  // back in: the piece and the barb at the outer surface, the crust's stain (it comes up with the sand: the crust's own uBury fade), the
  // cold glint. Matrix copies and uniform writes only
  const heal = () => {
    if (!H.outerM) return;
    H.healed = true;
    if (scar.geometry !== oldWoundGeo()) scar.geometry = oldWoundGeo();
    scar.matrix.copy(H.outerM); scar.matrixWorldNeedsUpdate = true;
    woundMat.color.setRGB(1, 1, 1);
    glintOld();
    setCrustWoundRec(L, H.crustRec, !H.woundHidden);
  };
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

  const abort = player => {
    H.wrenching = false; H.lookAt = null; H.wT = 0; H.kick = 0; H.aborted = (H.aborted || 0) + 1;
    piv.matrix.copy(H.pivBase); piv.matrixWorldNeedsUpdate = true;
    if (player.stagger > 0 && player.staggerK >= 1) player.stagger = 0;
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
    H.healed = oldW && H.healed;   // (opened: the fresh scar until she digs back in; the remembered piece stays where it is)
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
    const nx = H.normal.x, ny = H.normal.y, nz = H.normal.z, j = 0.12, sp = oldW && H.woundP ? H.woundP : H.seam;
    H.wp[o] = sp.x + nx * 0.08; H.wp[o + 1] = sp.y + ny * 0.08; H.wp[o + 2] = sp.z + nz * 0.08;
    H.wp[o + 3] = nx * 0.28 + (Math.random() - 0.5) * j; H.wp[o + 4] = ny * 0.28 + 0.10 + (Math.random() - 0.5) * j; H.wp[o + 5] = nz * 0.28 + (Math.random() - 0.5) * j;
    H.wp[o + 6] = 0; H.wp[o + 7] = 2.6 + 1.6 * Math.random();
    H.weep.count = WEEP_N;          // (the unborn and the spent draw at scale 0, fade 0)
  };

  H.update = (dt, t, player, ev) => {
    H.t += dt;
    if (!H.seated) return;
    // (oldwound) dug back in after the pull: the wound heals into the old wound (once the re-bed's job is done and the sand comes back)
    if (!H.healed && H.pulled && L.buried && L.digging && !L.digJob) heal();
    // ---- the wrench ----
    // the commitment holds only while he is AT it: drowned and brought up on the deck, hauled off by the
    // line, thrown by her, or she woke some other way, and the pull is undone (no reward, no wake, no line)
    if (H.wrenching && (player.onDeck || !L.dormant || Math.hypot(player.pos.x - H.anchor.x, player.pos.z - H.anchor.z) > REACH + 1)) abort(player);
    if (H.wrenching) {
      H.wT += dt;
      // his hands are off the controls for the whole of it (stagger re-armed: drive 0), his air
      // pack too (game.js packUsable reads H.wrenching)
      player.stagger = player.staggerDur = 0.25; player.staggerK = 1;
      player.vel.x *= Math.exp(-8 * dt); player.vel.z *= Math.exp(-8 * dt);
      // he steps in to it and squares up to the iron over the first beat
      const k = Math.min(1, dt * 7);
      // (not against the line: at the leash's hold the step in would drag him past what the hose allows)
      if (H.wT < 0.45 && !(survival.tautness > 0.75)) { player.pos.x += (H.anchor.x - player.pos.x) * k; player.pos.z += (H.anchor.z - player.pos.z) * k; }
      H.gripWorld(H.lookAt);
      const want = Math.atan2(H.lookAt.x - player.pos.x, H.lookAt.z - player.pos.z);
      let dy = want - player.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      player.yaw += dy * Math.min(1, dt * 6);
      // three heaves: each one rocks him back off his braced boot
      const beats = BEATS;
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
    // (its own field: game.js says it at prio 3, over the ambient finds, and her name follows it)
    if (H.pendingLine) { ev.pullLine = H.pendingLine; H.pendingLine = null; sightSaid[site] = 1; }
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
    // ---- THE GLINT (fix round 1: the eyeshine's pattern, brooder.js EYESHINE AT RANGE) ----
    // A range cue, not a lamp: the lit brass carries itself up close, so the pinpoint is zero inside
    // GL_NEAR u of him and rises by GL_FULL; ONE fade past that (the sprite's own, to GL_FAR from the lens).
    // Stood off the ferrule toward the CAMERA by min(1.2, 0.1 d) so her rim, her legs and the pole itself
    // never clip it, and high enough over his line of sight that his helmet does not (10-20 u: the game
    // camera sees it over him). Lit only by his lantern turned on it (face), his charge (lit); the
    // cylinder's squareness to the view makes it twinkle, it never vanishes. The FIRST time his light finds
    // it (once ever per anchorage, persisted with the chart: opts.sighted / ev.sighted), it CATCHES: a
    // GL_CATCH s swell to full.
    let f = 0;
    const ironOn = iron.visible && L.dormant && player, barbOn = !ironOn && H.healed && !(oldW && H.pressed && L.dormant) && !H.woundHidden && (L.dormant || L.dugIn) && player;
    if (ironOn || barbOn) {
      if (ironOn) _a.set(0, 0, (DIM.fer0 + DIM.fer1) * 0.5).applyMatrix4(H.worldM);
      else _a.set(BARB_TIP[0], BARB_TIP[1], BARB_TIP[2]).applyMatrix4(scar.matrixWorld);
      _b.subVectors(camera.position, _a);
      const dc = _b.length() || 1;
      gl.position.copy(_a).addScaledVector(_b, Math.min(1.2, 0.1 * dc) / dc);
      _v.subVectors(_a, player.pos); _v.y = 0;
      const dp = _v.length() || 1;
      _v.multiplyScalar(1 / dp);
      _fw.set(Math.sin(player.yaw), 0, Math.cos(player.yaw));
      const face = Math.max(0, _fw.x * _v.x + _fw.z * _v.z);
      const lit = Math.max(0, player.light == null ? 1 : player.light);
      const sq = ironOn ? 1 - Math.abs(H.axis.dot(_b) / dc) : 1;
      const rng = clamp((dp - GL_NEAR) / (GL_FULL - GL_NEAR), 0, 1), far = 1 - clamp((dp - GL_OUT0) / (GL_OUT1 - GL_OUT0), 0, 1);
      f = face * face * lit * rng * rng * (3 - 2 * rng) * far * (0.7 + 0.3 * sq * sq) * (0.9 + 0.1 * Math.sin(H.t * 2.3)) * (ironOn ? 1 : OLD_GLINT_K);
      // first sight: once EVER per anchorage, when his light finds it
      if (ironOn && !H.sighted && !sightSaid[site] && face > 0.85 && lit > 0.2 && dp > GL_NEAR && dp < SIGHT_R && !ev.msg) {
        H.sighted = true; sightSaid[site] = 1; ev.msg = LINE_FIRST_SIGHT; ev.sighted = true; H.catchT = GL_CATCH;
      }
    }
    if (H.catchT > 0) {
      H.catchT -= dt;
      const u = 1 - Math.max(0, H.catchT) / GL_CATCH;           // 0 -> 1 over the catch
      f = Math.max(f, Math.sin(Math.PI * u) / GLINT_K);         // up to full and back down to the twinkle
    }
    H.glint = f;
    gl.material.opacity = Math.min(1, GLINT_K * f);
  };
  H.dispose = () => { /* everything is in her group: disposeSleeper frees it (the model's shared set is kept) */ };
  return H;
}
// dev: forget the first-sight lines (probes)
export function resetHarpoonSight() { sightSaid.fill(0); }
