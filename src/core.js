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
// DYNAMIC RESOLUTION (2026-09-28). RES_SCALE is now the CEILING; the live scale moves
// between RES_FLOOR and it, driven by the GPU timer in postfx.js (updateResScale). At 1.5x
// on a Retina laptop the frame is ~3.3 MP and the GPU median sat at ~19 ms against a
// 16.7 ms slot -- the machine ran flat out. Dropping to 1.0x saves ~6 ms. Buffer dims stay
// INTEGER (the black-rectangle rule above); a change goes through the same coalesced
// applySize -> flushSize path as a window resize, so every render target is rebuilt once.
export const RES_FLOOR = Math.min(1, RES_SCALE) * 0.85;
// TEMPORAL UPSCALING (postfx.taa.js). With TAAU live the renderer's size (and so every
// composer target, getSize, getDrawingBufferSize, every uPix) is the INTERNAL resolution,
// and the canvas's drawing buffer is the OUTPUT resolution (css x RES_SCALE, fixed by the
// window, never by DRS). postfx.js owns the canvas dims per frame (syncCanvas); the TAA
// resolve reconstructs internal -> output. The live floor is lowered while TAAU runs,
// because a lower internal scale no longer means a soft picture.
let resFloor = RES_FLOOR;
export function getRenderFloor() { return resFloor; }
export function setRenderFloor(f) {
  resFloor = Math.max(0.4, Math.min(RES_SCALE, f));
  if (resScale < resFloor) setRenderScale(resFloor);
  return resFloor;
}
let resScale = RES_SCALE;
export function getRenderScale() { return resScale; }
export function setRenderScale(s) {
  s = Math.max(resFloor, Math.min(RES_SCALE, s));
  if (Math.abs(s - resScale) < 0.01) return resScale;
  resScale = s;
  applySize();
  return resScale;
}
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
let lastW = 0, lastH = 0, outW = 0, outH = 0;
// The OUTPUT size (canvas drawing buffer while TAAU runs): css x RES_SCALE, integer.
export function getOutputSize(v) { v.x = outW; v.y = outH; return v; }
// Resizes are COALESCED: a drag fires the resize event and the ResizeObserver many times
// a frame, and each setSize reallocates every render target. applySize only records the
// wanted size (the aspect is immediate — it is one matrix); flushSize, called once by the
// frame loop before update, does the reallocation.
let pendingW = 0, pendingH = 0;
function applySize() {
  const cssW = renderer.domElement.clientWidth || innerWidth;
  const cssH = renderer.domElement.clientHeight || innerHeight;
  // A hidden or zero-height container reports 0. Resizing to zero and back reallocates
  // every render target twice and flashes black across the frame, so hold the last
  // good size instead and pick the real one up when layout returns.
  if (cssW < 2 || cssH < 2) return;
  const w = Math.max(1, Math.round(cssW * resScale));
  const h = Math.max(1, Math.round(cssH * resScale));
  const ow = Math.max(1, Math.round(cssW * RES_SCALE)), oh = Math.max(1, Math.round(cssH * RES_SCALE));
  if (w === lastW && h === lastH && ow === outW && oh === outH) return;   // never resize on an unchanged frame
  lastW = w; lastH = h; outW = ow; outH = oh;
  camera.aspect = cssW / cssH;
  camera.updateProjectionMatrix();
  pendingW = w; pendingH = h;
}
export function flushSize() {
  if (!pendingW) return false;
  const w = pendingW, h = pendingH;
  pendingW = pendingH = 0;
  renderer.setSize(w, h, false);
  for (const fn of resizeHandlers) fn(w, h);
  return true;
}

addEventListener('resize', applySize);
new ResizeObserver(applySize).observe(renderer.domElement);
applySize();
flushSize();   // the boot size applies at once: nothing may render into a stale buffer
export { applySize };
