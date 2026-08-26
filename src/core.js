// Renderer, scene, camera, shared environment map. Owned by the orchestrator.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { setMaxAniso } from './lib/textures.js';

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
// Publish the device's true max anisotropy to lib/textures BEFORE any world module
// evaluates (they all import core.js), so every generated texture is filtered at the cap.
setMaxAniso(renderer);
document.body.appendChild(renderer.domElement);

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x04121f);
scene.fog = new THREE.FogExp2(0x04121f, 0.016);

export const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 700);

// Indoor-studio IBL used only as a reflection source for metals; it never lights the
// scene directly. The RAFT keeps this (then swaps to water.js's live sky probe via
// onSkyEnv); underwater consumers take envTexDeep below.
export const envTex = (() => {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return tex;
})();

// DEEP-WATER IBL for underwater metals (wreck brass, leviathan eye, tools, tether).
// RoomEnvironment put studio softboxes into abyssal reflections — every bright
// highlight on brass 300m down was a window. This is a tiny generated scene (no
// files, per the all-procedural rule): a vertical gradient — dim teal downwelling
// light above fading to near-black below — plus one soft cool "surface" lid so
// curved metal still catches a live highlight, PMREM'd once at boot. Static on
// purpose: reflections this dark don't need to track weather, and swapping envMaps
// at runtime would touch dozens of materials for nothing.
export const envTexDeep = (() => {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = new THREE.Scene();
  // Gradient shell: unlit vertex-coloured sphere seen from inside.
  const geo = new THREE.SphereGeometry(10, 24, 16);
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
  const top = new THREE.Color(0x0d3a42), bot = new THREE.Color(0x010304), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = Math.pow(Math.max(0, pos.getY(i) / 10 * 0.5 + 0.5), 1.6);
    c.copy(bot).lerp(top, t);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  env.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  // The lid: a soft bright patch straight up, so brass still reads alive, just oceanic.
  const lid = new THREE.Mesh(new THREE.CircleGeometry(4.5, 24), new THREE.MeshBasicMaterial({ color: 0x9fd8d4 }));
  lid.position.y = 9; lid.rotation.x = Math.PI / 2;
  env.add(lid);
  const tex = pmrem.fromScene(env, 0.08).texture;
  pmrem.dispose();
  geo.dispose(); lid.geometry.dispose();
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
