// Renderer, scene, camera, shared environment map. Owned by the orchestrator.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export const renderer = new THREE.WebGLRenderer({ antialias: false, stencil: false, depth: false, powerPreference: 'high-performance' });
// Render scale is applied by hand to INTEGER buffer dimensions, with pixelRatio pinned
// at 1. A fractional setPixelRatio (1.5) made the renderer and the post-processing
// composer round the drawing-buffer size differently, so the composer saw a mismatch
// and reallocated its render targets every single frame — which shows up as black
// rectangles flashing and changing size.
export const RES_SCALE = Math.min(devicePixelRatio || 1, 1.5);
renderer.setPixelRatio(1);
renderer.setSize(Math.round(innerWidth * RES_SCALE), Math.round(innerHeight * RES_SCALE), false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
// r182 deprecated PCFSoftShadowMap for WebGLRenderer: three now warns and silently
// substitutes PCFShadowMap. Naming it here is the truth about what actually runs —
// the soft variant is gone from the core, not switched off by us. If the raft's
// shadow edge ever wants softening back, it has to come from the shadow camera /
// map size / bias, not from this constant.
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x04121f);
scene.fog = new THREE.FogExp2(0x04121f, 0.016);

export const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 700);

// Indoor-studio IBL used only as a reflection source for metals; it never lights the scene directly.
export const envTex = (() => {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return tex;
})();

export const clock = new THREE.Clock();

const resizeHandlers = [];
export function onResize(fn) { resizeHandlers.push(fn); }

// Drive off the canvas's real laid-out size rather than innerWidth/innerHeight. A
// ResizeObserver also catches the cases a resize event misses — bookmark bars appearing,
// zoom changes, devtools docking — any of which previously left the canvas a different
// size from its drawing buffer, so part of the window went unpainted.
let lastW = 0, lastH = 0;
function applySize() {
  const cssW = renderer.domElement.clientWidth || innerWidth;
  const cssH = renderer.domElement.clientHeight || innerHeight;
  // A hidden or zero-height container reports 0. Resizing to zero and back reallocates
  // every render target twice and flashes black across the frame, so hold the last
  // good size instead and pick the real one up when layout returns.
  if (cssW < 2 || cssH < 2) return;
  const w = Math.max(1, Math.round(cssW * RES_SCALE));
  const h = Math.max(1, Math.round(cssH * RES_SCALE));
  if (w === lastW && h === lastH) return;   // never resize on an unchanged frame
  lastW = w; lastH = h;
  camera.aspect = cssW / cssH;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  for (const fn of resizeHandlers) fn(w, h);
}

addEventListener('resize', applySize);
new ResizeObserver(applySize).observe(renderer.domElement);
applySize();
export { applySize };
