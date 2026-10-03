// THE ABYSS READS (roadmap/zone2-readability.md). OWNED BY: lighting/atmosphere track.
// Zone 2 at play distance (~9 u behind Sal) was a lantern pool in a black frame: the
// sculpted reef, the animals and Mhor only existed inside four units of the flame. This
// module holds the two levers that are not a shader knob in someone else's file:
//
//  1. THE FLOOR. The zone-2 terrain palette is pale volcanic ash over dark basalt
//     (GLASS.abyss silt/grav/rock): abyssal sediment is a LIGHT ground (ooze, ash), and a
//     lit light ground is what everything dark stands against in silhouette — the read
//     every deep ROV frame has. The water column, the far field and the rock stay black;
//     only what the lantern (or the reef's own light) reaches is lifted, and it lifts by
//     reflectance, not by a fill. Uniform writes on the existing material, no recompile.
//
//  2. THE REEF'S OWN LIGHT. While Mhor is absent (the furnace is cold, most of a zone-2
//     dive) his five borrowed pool lights (sleeper/common.js sigilPool — the light count
//     never changes) have nothing to do: hunter.js marks them `userData.bioFree`. Here
//     they ride the five nearest BIOLUMINESCENT COLONIES round Sal — sea-pen beds, whip
//     and crinoid thickets, clustered once per layout from gardens.js's own instances —
//     cold blue-green, dim, decay 2 (physical), breathing with the polyp wave and FLARING
//     when a colony is touched (stir.js pulseAt: Sal's footfall, the sonar, a slam), so
//     a startled reef lights its own sediment, its neighbours and whatever swims through
//     it. The nearest lit colony is a natural lamp-slot-B candidate, so the murk round it
//     glows faintly too (userData.scatter keeps that a haze, not a fog bank). When Mhor
//     arrives hunter.js takes the lights back the same frame: the reef goes dark as the
//     hunter comes.
//
// Zero per-frame allocation: colony arrays are typed and sized once per layout; the
// nearest-5 pick runs every 0.5 s over <= 64 colonies.
import * as THREE from 'three';
import { scene, camera } from '../core.js';
import { GLASS, abyssK as abyssKc } from '../config.js';
import { terrainH, terrainMeshes } from './terrain.js';
import { sigilPool } from '../entities/sleeper/common.js';
import { pulseAt } from './stir.js';

const MAXC = 64;                       // colonies kept (the densest)
const CX = new Float32Array(MAXC), CY = new Float32Array(MAXC), CZ = new Float32Array(MAXC);
const CW = new Float32Array(MAXC), CP = new Float32Array(MAXC), CF = new Float32Array(MAXC);
let nCol = 0, layoutSig = NaN, sigT = -1e9;
// per pool light: the colony it rides (-1 none), its eased level, and the colony it is
// fading toward (a re-pick fades out, moves, fades in — never a pop across the reef)
const SLOT = sigilPool;                // filled lazily by ensureSigilPool (common.js)
const sCol = new Int16Array(8).fill(-1), sWant = new Int16Array(8).fill(-1);
const sLev = new Float32Array(8);
let pickT = -1e9;
const _m = new THREE.Matrix4(), _col = new THREE.Color();
const BIO_KEYS = { g_pen: 1.0, g_whip: 0.35, g_crin: 0.3 };   // the share of each host that glows (gardens bioFrac)
const CELL = 9;
const _hosts = [];
const _collect = o => { if (o.isInstancedMesh && o.userData && BIO_KEYS[o.userData.plantKey] !== undefined) _hosts.push(o); };
// grid accumulation scratch (cell key -> slot), rebuilt only on a layout change
const GX = new Float32Array(1024), GY = new Float32Array(1024), GZ = new Float32Array(1024), GW = new Float32Array(1024);
const GK = new Int32Array(1024);
let gN = 0;

function signature() {
  let s = 0;
  for (let h = 0; h < _hosts.length; h++) {
    const o = _hosts[h];
    if (!o.count) continue;
    o.getMatrixAt(0, _m);
    s += o.count * 7.31 + _m.elements[12] * 1.7 + _m.elements[14] * 0.37;
  }
  return s;
}
function cluster() {
  gN = 0;
  for (let h = 0; h < _hosts.length; h++) {
    const o = _hosts[h], w = BIO_KEYS[o.userData.plantKey];
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, _m);
      const e = _m.elements, x = e[12], y = e[13], z = e[14];
      if (y > -600) continue;                         // the abyss only
      const key = (Math.round(x / CELL) + 512) * 1024 + (Math.round(z / CELL) + 512);
      let k = 0;
      for (; k < gN; k++) if (GK[k] === key) break;
      if (k === gN) { if (gN >= 1024) continue; GK[k] = key; GX[k] = GY[k] = GZ[k] = GW[k] = 0; gN++; }
      GX[k] += x * w; GY[k] += y * w; GZ[k] += z * w; GW[k] += w;
    }
  }
  // keep the MAXC heaviest cells (selection by repeated max; once per layout)
  const minW = GLASS.abyss.bioMinW;
  nCol = 0;
  for (let n = 0; n < MAXC; n++) {
    let b = -1, bw = minW;
    for (let k = 0; k < gN; k++) if (GW[k] >= bw) { bw = GW[k]; b = k; }
    if (b < 0) break;
    const w = GW[b];
    CX[nCol] = GX[b] / w; CZ[nCol] = GZ[b] / w;
    CY[nCol] = terrainH(CX[nCol], CZ[nCol], 2) + 0.9;   // in the canopy, not under the sand
    CW[nCol] = w; CP[nCol] = (CX[nCol] * 0.131 + CZ[nCol] * 0.071) % 6.283; CF[nCol] = 0;
    GW[b] = -1; nCol++;
  }
}

// ---- the floor palette -----------------------------------------------------------
const AUTH = { silt: 0x513f33, grav: 0x322a26, rock: 0x22171a };   // terrain.js zone 2 as authored
const _a = new THREE.Color(), _b = new THREE.Color();
let palOn = -1, palS = -1, palG = -1, palR = -1;
const PAL_K = ['silt', 'grav', 'rock'], PAL_U = ['uSilt', 'uGrav', 'uRock'];
function applyPalette(A, on) {
  const tm = terrainMeshes[2];
  const u = tm && tm.material && tm.material.userData.zoneU;
  if (!u) return;
  // only on a change (lab drag or A/B): numeric compares, no per-frame strings
  if (on === palOn && A.silt === palS && A.grav === palG && A.rock === palR) return;
  palOn = on; palS = A.silt; palG = A.grav; palR = A.rock;
  for (let i = 0; i < 3; i++) {
    _a.setHex(AUTH[PAL_K[i]]); _b.setHex(A[PAL_K[i]]);
    u[PAL_U[i]].value.copy(_a).lerp(_b, on);
  }
}

export function abyssK(camY = camera.position.y) { return abyssKc(camY); }

export const abyssState = { colonies: 0, lit: 0, picks: [-1, -1, -1, -1, -1], levels: [0, 0, 0, 0, 0] };

export function updateAbyss(dt, t, lev, sal) {
  const A = GLASS.abyss;
  if (!A) return;
  const on = Math.max(0, Math.min(1, +A.on || 0));
  applyPalette(A, on);
  const k = abyssK();
  const hunter = lev && lev.kind === 'hunter';
  const now = performance.now();
  // the layout: hosts and their signature, re-checked every 2 s (gardens reseed in place)
  if (k > 0 && hunter && now - sigT > 2000) {
    sigT = now;
    _hosts.length = 0; scene.traverse(_collect);
    const s = signature();
    if (s !== layoutSig) { layoutSig = s; cluster(); }
  }
  abyssState.colonies = nCol;
  const nS = SLOT.length;
  if (!nS) return;
  // re-pick the nearest colonies to Sal every 0.5 s
  if (now - pickT > 500) {
    pickT = now;
    for (let s = 0; s < nS; s++) sWant[s] = -1;
    if (k > 0 && hunter && nCol) {
      const R2 = A.bioReach * A.bioReach;
      for (let s = 0; s < nS; s++) {
        let best = -1, bd = R2;
        for (let c = 0; c < nCol; c++) {
          let taken = false;
          for (let q = 0; q < s; q++) if (sWant[q] === c) { taken = true; break; }
          if (taken) continue;
          const dx = CX[c] - sal.pos.x, dz = CZ[c] - sal.pos.z, d2 = dx * dx + dz * dz;
          if (d2 < bd) { bd = d2; best = c; }
        }
        sWant[s] = best;
      }
      // keep a light on the colony it already rides if that colony is still wanted, so a
      // re-pick never shuffles lights between colonies that both stay lit
      for (let s = 0; s < nS; s++) {
        const c = sCol[s];
        if (c < 0 || sWant[s] === c) continue;
        for (let q = 0; q < nS; q++) if (sWant[q] === c) { sWant[q] = sWant[s]; sWant[s] = c; break; }
      }
    }
  }
  _col.setHex(A.bioCol);
  let lit = 0;
  for (let s = 0; s < nS; s++) {
    const pl = SLOT[s];
    if (!pl.userData.bioFree || k <= 0 || !hunter) { sLev[s] = 0; sCol[s] = -1; continue; }
    // fade out toward a re-pick, move at black, fade in
    if (sCol[s] !== sWant[s]) {
      sLev[s] = Math.max(0, sLev[s] - dt * 1.5);
      if (sLev[s] <= 0) sCol[s] = sWant[s];
    } else if (sCol[s] >= 0) sLev[s] = Math.min(1, sLev[s] + dt * 0.8);
    const c = sCol[s];
    if (c < 0) { pl.intensity = 0; continue; }
    // the colony's breath: the gardens polyp wave, averaged over the bed, plus a touch flare
    const p = pulseAt(CX[c], CY[c], CZ[c]);
    if (p > CF[c]) CF[c] = p; else CF[c] = Math.max(0, CF[c] - dt * 0.45);
    const breath = 0.78 + 0.22 * Math.sin(t * 0.65 + CP[c]);
    const wk = Math.sqrt(Math.min(CW[c], 16) / 4);
    pl.intensity = sLev[s] * k * wk * (A.bioI * breath + A.bioFlash * CF[c]);
    pl.position.set(CX[c], CY[c], CZ[c]);
    pl.color.copy(_col);
    pl.distance = A.bioR * (0.85 + 0.15 * wk);
    pl.decay = 2.0;
    pl.userData.scatter = A.bioScatter;
    pl.userData.lampBias = undefined;
    if (pl.intensity > 0.01) lit++;
  }
  abyssState.lit = lit;
  for (let s = 0; s < 5; s++) { abyssState.picks[s] = s < nS ? sCol[s] : -1; abyssState.levels[s] = s < nS ? +SLOT[s].intensity.toFixed(2) : 0; }
}

if (typeof window !== 'undefined') {
  window.__abyss = {
    on: v => { GLASS.abyss.on = v; return v; },
    K: () => GLASS.abyss,
    state: () => ({ k: +abyssK().toFixed(3), ...abyssState, colPos: Array.from({ length: Math.min(nCol, 8) }, (_, i) => [Math.round(CX[i]), Math.round(CZ[i]), +CW[i].toFixed(1)]) })
  };
}
