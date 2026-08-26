// The surface raft: a working dive tender. OWNED BY: orchestrator.
//
// This used to be a prop seen from underneath. Now Sal stands on it, walks it, and steps
// off it to begin the dive, so it is a PLACE — and the job of every object on it is to
// say what happens here. It is assembled from four builders that each own a region of
// the deck, plus the pump, which is the fuel gauge made physical:
//
//   raft/hull.js     the barge itself: planking, bulwark, drums, mooring
//   raft/station.js  the dressing station, port wing — where Sal was suited up
//   raft/gear.js     working gear, starboard and aft — the bitumen the pump eats
//   raft/davit.js    the gallows the umbilical runs over, and the boarding ladder
//   raft/pump.js     oil engine belt-driving a compressor; six running/dead tells
//
// Every builder bakes merged geometry into THIS group, then consolidate() merges again
// ACROSS builders, so four files that each emit an iron bucket cost one iron draw call.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { scene, camera, envTex } from '../core.js';
import { SURFACE_Y } from '../config.js';
import { V3 } from '../lib/math.js';
import { makeGlow, canvas2d, toTexture, noiseCanvas, normalFromHeight, seededRand } from '../lib/textures.js';
import { survival } from './survival.js';
import { surfaceHeightAt, stormLevel, onSkyEnv } from '../world/water.js';
import { Part, xf, box, cyl, tor, weather, rivetRing, boltLine, rope, lash } from './raft/kit.js';
import { buildHull } from './raft/hull.js';
import { buildStation } from './raft/station.js';
import { buildGear } from './raft/gear.js';
import { buildDavit } from './raft/davit.js';
import { buildChart } from './raft/chart.js';
import { buildShelf } from './raft/shelf.js';
import { buildPump, updatePump, PUMP_POS } from './raft/pump.js';

export const raft = new THREE.Group();
// IT FLOATS. This sat at SURFACE_Y - 1.6 for the whole project, which put the deck top at
// y = -1.49 and the flotation drums entirely under water — nobody noticed because the
// camera had never once been above the waterline. At +0.55 the drums (r 0.85, local
// centre -0.75) sit about 62% submerged, which is where an oil drum floats, and the deck
// carries ~0.66 of freeboard. The bob is +-0.32 before storm gain, so the deck never
// dips under. Everything downstream is position-relative (pumpPos, nearRaft, the respawn
// point, the ending's arrival, the HUD bearing) and follows for free.
export const RAFT_POS = V3(0, SURFACE_Y + 0.55, 0);

// Where the umbilical actually leaves the raft: over the gallows sheave, outboard of
// the deck edge. RAFT-LOCAL; pumpPos is this transformed into world space each frame.
const hoseHead = V3();
// Where the umbilical leaves the pump.
export const pumpPos = V3();
// Raft-local standing spot in front of the chart table (world = raft.localToWorld of this).
export const chartAnchor = V3();

let pumpH = null, lampGlass = null, beaconGlow = null, lamp = null, lampLight = null;
// The keepsake shelf's dynamic-row setter, and anything game.js pushed in before the raft
// existed (it loads the saved chart and calls setKeepsakes at module scope).
let shelfSet = null, pendingKeeps = null;
// Ride state: the hull's eased height and attitude on the real wave field.
let rideY = RAFT_POS.y, rideRX = 0, rideRZ = 0;
const PUFFN = 7, puffs = [];
let puffT = 0;
const puffOrigin = V3();

const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;

// ---- palette ----------------------------------------------------------------------
// EVERY material is created exactly once, here, and passed to the builders. A builder
// that makes its own material makes its own draw call and breaks the merge. All of them
// carry vertexColors so kit.js's weather()/tint() can bake grime and waterline stain
// into whatever geometry wants it.
// ---- procedural surface maps for the palette ---------------------------------------
// STRUCTURE ONLY. The raft's colour story is authored twice already — palette hues and
// kit.js weather() vertex stains — and both MULTIPLY with these maps, so every albedo
// here is near-white grayscale (grain shadow, never pigment) and every roughnessMap is a
// multiplier around 1. Deck boards are box(capW, h, len) with the long axis on Z: a box
// face maps 0..1 regardless of size, so on the deck top the V axis runs down the board
// and the ~15:1 face stretch elongates everything drawn — grain is therefore drawn along
// canvas Y and comes out running WITH the boards for free. Deterministic seeds: the raft
// must look identical every boot. Built once, at first palette() call.
let RM = null;
function raftMaps() {
  if (RM) return RM;
  const clamp01b = v => v < 0 ? 0 : v > 255 ? 255 : v;
  const gray = (S, fn) => {
    const { canvas, ctx } = canvas2d(S);
    const im = ctx.createImageData(S, S);
    for (let i = 0; i < S * S; i++) {
      const g = clamp01b(fn(i) * 255);
      im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = g;
      im.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(im, 0, 0);
    return canvas;
  };
  // -- wood: long grain along canvas Y, pores, a rare split --
  const S = 256, wr = seededRand(0xDECC0A7);
  const whc = noiseCanvas(S, 4, 1.0, wr);
  const wh = whc.getContext('2d');
  wh.lineCap = 'round';
  for (let i = 0; i < 150; i++) {              // grain streaks, running with the board (v)
    const x = wr() * S, y0 = wr() * S, l = 60 + wr() * 200;
    wh.strokeStyle = wr() < 0.6 ? 'rgba(0,0,0,.16)' : 'rgba(255,255,255,.11)';
    wh.lineWidth = 0.6 + wr() * 1.8;
    wh.beginPath(); wh.moveTo(x, y0);
    wh.bezierCurveTo(x + (wr() - 0.5) * 5, y0 + l * 0.33, x + (wr() - 0.5) * 5, y0 + l * 0.66, x + (wr() - 0.5) * 3, y0 + l);
    wh.stroke();
  }
  for (let i = 0; i < 60; i++) {               // pores / old fastener stains
    const x = wr() * S, y = wr() * S, r = 1 + wr() * 2.4;
    wh.fillStyle = 'rgba(0,0,0,.28)';
    wh.beginPath(); wh.ellipse(x, y, r * 0.5, r * 1.6, 0, 0, Math.PI * 2); wh.fill();
  }
  const wd = wh.getImageData(0, 0, S, S).data;
  const woodAlb = gray(S, i => 0.80 + 0.20 * (wd[i * 4] / 255));
  const woodRgh = gray(S, i => 0.90 + 0.10 * (1 - wd[i * 4] / 255));
  // -- metal: micro-scratches + faint dents (diver.js metalMaps idiom, but neutral) --
  const mr = seededRand(0xB7A55);
  const mhc = noiseCanvas(S, 4, 1.0, mr);
  const mh = mhc.getContext('2d');
  mh.lineCap = 'round';
  for (let i = 0; i < 40; i++) {
    const x = mr() * S, y = mr() * S, r = 5 + mr() * 14;
    const g = mh.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, mr() < 0.6 ? 'rgba(0,0,0,.26)' : 'rgba(255,255,255,.22)');
    g.addColorStop(1, 'rgba(128,128,128,0)');
    mh.fillStyle = g; mh.beginPath(); mh.arc(x, y, r, 0, Math.PI * 2); mh.fill();
  }
  for (let i = 0; i < 170; i++) {              // brushed hairlines
    const x = mr() * S, y = mr() * S, a = (mr() - 0.5) * 0.8 + (mr() < 0.5 ? 0 : 1.57), l = 10 + mr() * 60;
    mh.strokeStyle = mr() < 0.5 ? 'rgba(255,255,255,.18)' : 'rgba(0,0,0,.18)';
    mh.lineWidth = 0.5 + mr() * 1.2;
    mh.beginPath(); mh.moveTo(x, y); mh.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); mh.stroke();
  }
  const md = mh.getImageData(0, 0, S, S).data;
  const metAlb = gray(S, i => 0.86 + 0.14 * (md[i * 4] / 255));
  const metRgh = gray(S, i => 0.78 + 0.22 * (1 - md[i * 4] / 255));
  RM = {
    wood: { map: toTexture(woodAlb, 1, true), rough: toTexture(woodRgh, 1), nrm: toTexture(normalFromHeight(whc, 1.3), 1) },
    metal: { map: toTexture(metAlb, 1, true), rough: toTexture(metRgh, 1), nrm: toTexture(normalFromHeight(mhc, 1.2), 1) }
  };
  return RM;
}

function palette() {
  const M = (color, o) => new THREE.MeshStandardMaterial(
    Object.assign({ color, envMap: envTex, vertexColors: true }, o));
  const { wood: W, metal: MT } = raftMaps();
  const wset = { map: W.map, roughnessMap: W.rough, normalMap: W.nrm, normalScale: new THREE.Vector2(0.45, 0.45) };
  const mset = { map: MT.map, roughnessMap: MT.rough, normalMap: MT.nrm, normalScale: new THREE.Vector2(0.35, 0.35) };
  return {
    wood: M(0x584734, { roughness: 0.94, metalness: 0.02, envMapIntensity: 0.16, ...wset }),
    wood2: M(0x8b7c64, { roughness: 0.96, metalness: 0.00, envMapIntensity: 0.12, ...wset }),
    iron: M(0x33373b, { roughness: 0.58, metalness: 0.78, envMapIntensity: 0.45, ...mset }),
    rust: M(0x6d452a, { roughness: 0.93, metalness: 0.22, envMapIntensity: 0.18 }),
    brass: M(0xac8a2f, { roughness: 0.34, metalness: 0.90, envMapIntensity: 0.70, ...mset }),
    lead: M(0x6b6f74, { roughness: 0.74, metalness: 0.52, envMapIntensity: 0.28 }),
    rope: M(0x9a8862, { roughness: 0.97, metalness: 0.00, envMapIntensity: 0.10 }),
    canvas: M(0x7c7360, { roughness: 0.98, metalness: 0.00, envMapIntensity: 0.10 }),
    leather: M(0x4e3620, { roughness: 0.80, metalness: 0.04, envMapIntensity: 0.16 }),
    paint: M(0x7a3c2b, { roughness: 0.86, metalness: 0.10, envMapIntensity: 0.20 }),
    // Matched to tether.js's own hose material (0x33383b / 0.5) on purpose: the wound
    // reel, the lead over the sheave and the deployed umbilical have to read as ONE
    // continuous line, and a shade of difference at the block gives that away.
    hose: M(0x33383b, { roughness: 0.52, metalness: 0.00, envMapIntensity: 0.22 }),
    glass: M(0xc6d8de, { roughness: 0.10, metalness: 0.00, envMapIntensity: 0.9, transparent: true, opacity: 0.30 })
  };
}

// Second-pass merge across builders. Every mesh a Part baked is flagged and sits at
// identity in raft-local space, so this is a straight geometry concat — no matrices to
// apply, and the animated sub-groups (pump, flywheel, governor, lamp) are untouched
// because they are not direct children of the raft.
function consolidate(g) {
  const byMat = new Map();
  for (const c of g.children) {
    if (!c.isMesh || !c.userData.rmerge) continue;
    let a = byMat.get(c.material); if (!a) byMat.set(c.material, a = []);
    a.push(c);
  }
  let n = 0;
  for (const [mat, list] of byMat) {
    if (list.length < 2) { n++; continue; }
    const merged = mergeGeometries(list.map(o => o.geometry));
    if (!merged) { n += list.length; continue; }   // mismatched attributes: leave them be
    for (const o of list) g.remove(o);
    const m = new THREE.Mesh(merged, mat);
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
    n++;
  }
  return n;
}

// ---- the hose reel ------------------------------------------------------------------
// Kept here rather than in a builder because the umbilical is the orchestrator's wire:
// the lead from this drum to the davit sheave is what makes the hose come FROM somewhere.
function buildReel(P, mats, head) {
  // PROPORTION. The first pass ran 1.02 cheeks on a 0.62 drum — a two-metre reel, which
  // next to a 1.8 m diver read as a boulder parked on the deck and swallowed its own
  // winding. At 0.70 over 0.40 the wound turns are a fifth of the cheek instead of a
  // sixteenth, so the thing you are meant to see — hose, coiled, ready to pay out — is
  // the thing that reads.
  const RY = 0.74, RZ = 0.60, HW = 0.46, DRUM = 0.40, CHEEK = 0.70;
  // A-frame standards. It floated in mid-air before, which is the kind of thing you
  // stop seeing after the twentieth look and the player sees on the first.
  for (const s of [-1, 1]) {
    for (const d of [-1, 1]) {
      P.add(xf(cyl(0.045, 0.065, RY - 0.11, 6), s * 0.60, (RY + 0.11) / 2, RZ + d * 0.30,
        -d * 0.30, 0, -s * 0.10), mats.iron);
    }
    P.add(xf(box(0.18, 0.05, 0.78), s * 0.60, 0.14, RZ), mats.iron);        // sole plate
    boltLine(P, mats.iron, s * 0.60, 0.18, RZ - 0.28, s * 0.60, 0.18, RZ + 0.28, 3, 0.030);
    P.add(xf(cyl(0.08, 0.08, 0.14, 8), s * 0.60, RY, RZ, 0, 0, Math.PI / 2), mats.brass);  // bearing
  }
  P.add(xf(cyl(0.05, 0.05, 1.32, 8), 0, RY, RZ, 0, 0, Math.PI / 2), mats.iron);            // axle
  // drum and cheeks
  P.add(xf(cyl(DRUM, DRUM, HW * 1.9, 14), 0, RY, RZ, 0, 0, Math.PI / 2), mats.iron);
  for (const s of [-HW, HW]) {
    P.add(weather(xf(cyl(CHEEK, CHEEK, 0.055, 16), s, RY, RZ, 0, 0, Math.PI / 2),
      { tone: 0.92, freq: 1.4, amp: 0.22, rust: 0.35 }), mats.iron);
    rivetRing(P, mats.iron, 8, s, RY, RZ, CHEEK - 0.16, 0.028, 'x');
  }
  // hose wound on in two layers, which is the only way a reel reads as loaded
  lash(P, mats.hose, 0, RY, RZ, 0.455, 'x', 7, 0.065, 0.118);
  lash(P, mats.hose, 0, RY, RZ, 0.575, 'x', 5, 0.065, 0.118);
  // crank, ratchet and pawl on the outboard cheek: a reel you cannot wind is a spool
  P.add(xf(cyl(0.034, 0.034, 0.24, 6), 0.52, RY + 0.26, RZ, 0, 0, Math.PI / 2), mats.iron);
  P.add(xf(cyl(0.030, 0.030, 0.20, 6), 0.64, RY + 0.26, RZ), mats.iron);
  P.add(xf(cyl(0.045, 0.045, 0.15, 8), 0.64, RY + 0.38, RZ), mats.wood);
  P.add(xf(cyl(0.034, 0.034, 0.34, 6), 0.58, RY + 0.13, RZ, 0, 0, Math.PI / 2), mats.iron);
  P.add(xf(tor(0.22, 0.030, 4, 14), -0.52, RY, RZ, 0, Math.PI / 2), mats.iron);  // ratchet ring
  P.add(xf(box(0.24, 0.045, 0.045), -0.52, RY - 0.23, RZ - 0.13, 0, 0, 0.5), mats.iron);  // pawl

  // The lead from the drum up over the sheave. Without it the umbilical appears out of
  // thin air at the block, which is what the last round's bug actually looked like.
  const a = V3(0.06, RY + 0.62, RZ + 0.18);
  const mid = a.clone().lerp(head, 0.5); mid.y += 0.20;
  rope(P, mats.hose, [[a.x, a.y, a.z], [mid.x, mid.y, mid.z], [head.x, head.y, head.z]], 0.065, 18);
}

export function buildRaft() {
  raft.position.copy(RAFT_POS);
  const mats = palette();
  // The raft is the one thing in the game that lives at the surface, so it is the one
  // thing whose reflections should be the game's OWN sky rather than core.js's neutral
  // RoomEnvironment. water.js captures the sky dome into a small PMREM on palette-stop
  // transitions and calls back here with each refresh; swapping envMap texture-for-
  // texture (same CubeUV mapping) never recompiles a program. Authored
  // envMapIntensity values are untouched — brass-age, never chrome. Everything
  // UNDERWATER (diver, leviathan, wrecks) deliberately keeps the RoomEnvironment:
  // sky glints at -500 through the fog-patched materials would be wrong.
  onSkyEnv(tex => { for (const k in mats) mats[k].envMap = tex; });

  // The davit runs first: it owns hoseHead, and the reel's lead has to be laid to it.
  const dav = buildDavit(raft, mats);
  hoseHead.copy(dav.hoseHead);
  // The lantern flame is the one unlit surface on this boat. A flame is EMISSION, not
  // albedo — a MeshStandardMaterial with nothing shining on it renders a dead lamp
  // black — and it needs its own material besides, because the builder handed it
  // mats.glass, which the pump's sight glass and oiler domes are also made of. Driving
  // the colour on a shared material would light those up along with it.
  lampGlass = dav.lampGlass;
  lampGlass.material = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
  // The builder made the glass 45 mm to stop it blowing out at noon, which worked and
  // then left nothing to see at night — a halo with no bright thing at the middle of it
  // reads as fog, not as a lamp. 1.7x puts the flame at about 76 mm, still inside the
  // cage bars at 78 and still under the bloom threshold in daylight, because what keeps
  // it from blooming is the COLOUR the update drives, not the area.
  lampGlass.scale.setScalar(1.7);

  buildHull(raft, mats);
  buildStation(raft, mats);
  buildGear(raft, mats);
  // The chart table (port side, aft of the dressing station): THE CHART's physical
  // home. Its anchor is where game.js centres the [E] CONSULT prompt.
  chartAnchor.copy(buildChart(raft, mats).anchor);
  // The keepsake shelf shares that wall. Its board and brackets go into the static merge
  // below; the row of small things on it is dynamic and returns its own setter.
  shelfSet = buildShelf(raft, mats);
  if (pendingKeeps) { shelfSet(pendingKeeps); pendingKeeps = null; }

  const P = Part(raft);
  buildReel(P, mats, hoseHead);
  P.bake();

  const pumpGroup = new THREE.Group();
  raft.add(pumpGroup);
  pumpH = buildPump(pumpGroup, mats);
  puffOrigin.copy(pumpH.stackTip).add(PUMP_POS);

  // exhaust: grey puffs that climb and fade, recycled. Only issued while it burns.
  const puffMat = new THREE.MeshBasicMaterial({ color: 0x6b6f73, transparent: true, opacity: 0.32, depthWrite: false });
  for (let i = 0; i < PUFFN; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 7, 5), puffMat.clone());
    m.visible = false;
    raft.add(m);
    puffs.push({ m, life: 0, max: 1, vy: 0, dz: 0 });
  }

  // THE BEACON. It exists so a diver 200 m down can find his way home, and that job is
  // why it was a 7-unit additive sprite — which is also why it blew out to an enormous
  // halo the moment the camera came above water in daylight. It is now driven by how
  // deep the CAMERA is and by the time of day: a tight warm point on deck at noon, the
  // full long-range beacon once you are down in the fog, and warm again at night.
  beaconGlow = makeGlow(0xffb673, 1.2);
  beaconGlow.position.copy(dav.lampPos);
  raft.add(beaconGlow);

  // The lantern actually lights its own deck. Without this the raft at night is a dark
  // shape that Sal's hand lamp happens to be standing on, and the one warm object on it
  // throws nothing — which is the tell that it is a picture of a lamp rather than a lamp.
  // Short range on purpose: it pools around the davit and leaves the corners to the dark.
  lampLight = new THREE.PointLight(0xffc07a, 0, 15, 1.9);
  lampLight.position.copy(dav.lampPos);
  raft.add(lampLight);

  // downward lamp so the raft reads as a lit landmark from below
  lamp = new THREE.PointLight(0xffd2a0, 26, 90, 1.7);
  lamp.position.set(0, -0.6, 0);
  raft.add(lamp);

  const calls = consolidate(raft);
  raft.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  // Debug surface, kept: five builders compose into one frame and the only trustworthy
  // check that nobody strayed out of their box is a bounding-box probe on the real tree.
  window.__raft = raft;
  scene.add(raft);
  raft.updateMatrixWorld(true);
  raft.localToWorld(pumpPos.copy(hoseHead));
  return calls;
}

// Storm intensity and daylight, pushed in by game.js from the weather system.
let storm = 0, day = 1, govK = 0;
// CHART V2 keepsakes: keeps is the full per-site/per-wreck taken matrix. The shelf on the
// port bulwark forward of the chart table shows one small prop per taken keepsake, in a
// FIXED site-major order — the slot a keepsake lands in never depends on the order they
// were found, so the gaps in the row are themselves the record of where Sal has not been.
// Idempotent and callable at any time: before buildRaft it is remembered, after it the
// shelf builder no-ops unless the set actually changed.
export function setKeepsakes(keeps) {
  if (shelfSet) shelfSet(keeps);
  else pendingKeeps = keeps;
}

export function setSwell(k, d = 1) { storm = k; day = d; }

// The flywheel's real speed, 0..1. Published so the audio hears the same coast-down the
// eye does — an engine whose sound and whose wheel disagree reads as two objects.
export function pumpSpeed() { return govK; }

export function updateRaft(dt, t) {
  // THE RAFT RIDES THE REAL SEA. It used to run its own decorative bob (+-0.32 sine)
  // while the wave MESH, since the choppy-sea round, heaves 2.5+ units in a gale —
  // so storm crests rolled straight THROUGH the deck and buried the standing camera
  // inside the wave (user-reported as "I don't see the improved water": he was IN it).
  // Now the hull samples the same surfaceHeightAt the mesh is built from — center,
  // bow and beam — averages them (a 9-unit hull low-passes chop shorter than itself)
  // and eases with a short time constant (mass; a barge does not follow ripples).
  // Pitch/roll come from the bow/beam differentials. Everything downstream (pumpPos,
  // tether, deckY in player.js, the camera) is position-relative and follows free.
  const st = stormLevel();
  const hC = surfaceHeightAt(RAFT_POS.x, RAFT_POS.z, t, st);
  const hF = surfaceHeightAt(RAFT_POS.x, RAFT_POS.z + 3.5, t, st);
  const hB = surfaceHeightAt(RAFT_POS.x + 3.5, RAFT_POS.z, t, st);
  const hTarget = RAFT_POS.y + (hC * 2 + hF + hB) * 0.25;
  const ek = Math.min(1, dt / 0.35);
  rideY += (hTarget - rideY) * ek;
  raft.position.y = rideY;
  raft.position.x = RAFT_POS.x + Math.sin(t * 0.37) * 0.16 * (1 + storm * 2.1);
  // pitch into the swell off the bow/beam height differentials, softly clamped
  const pit = clamp01((hF - hC) / 3.5 + 0.5) - 0.5, rol = clamp01((hB - hC) / 3.5 + 0.5) - 0.5;
  rideRX += (-pit * 0.9 - rideRX) * ek;
  rideRZ += (rol * 0.9 - rideRZ) * ek;
  raft.rotation.x = rideRX + Math.cos(t * 0.44) * 0.012;
  raft.rotation.z = rideRZ + Math.sin(t * 0.52) * 0.014;
  // The anchor rides the sheave, so the hose stays on the block as the raft rolls.
  // The matrix has to be refreshed first — localToWorld reads matrixWorld, which three
  // would not rebuild until render, leaving the anchor a frame behind the swell.
  raft.updateMatrixWorld(true);
  raft.localToWorld(pumpPos.copy(hoseHead));

  const running = survival.fuel > 0;
  govK = updatePump(pumpH, dt, t, running);

  // exhaust
  puffT -= dt;
  if (running && puffT <= 0) {
    puffT = 0.16 + Math.random() * 0.12;
    const p = puffs.find(q => q.life <= 0);
    if (p) {
      p.life = p.max = 1.7 + Math.random() * 0.9;
      p.vy = 0.9 + Math.random() * 0.5;
      p.dz = (Math.random() - 0.5) * 0.3;
      p.m.position.copy(puffOrigin);
      p.m.visible = true;
    }
  }
  for (const p of puffs) {
    if (p.life <= 0) continue;
    p.life -= dt;
    if (p.life <= 0) { p.m.visible = false; continue; }
    const k = 1 - p.life / p.max;
    p.m.position.y += p.vy * dt;
    p.m.position.x += (0.35 + p.dz) * dt;      // drifts downwind off the stack
    p.m.position.z += p.dz * dt;
    p.m.scale.setScalar(0.10 + k * 0.42);
    p.m.material.opacity = 0.30 * (1 - k) * (1 - k);
  }

  // ---- the lantern -------------------------------------------------------------
  // Two separate reads out of one lamp. Underwater it has to punch through fog from
  // hundreds of units away, so the halo grows with the camera's depth. Above water it
  // is a brass object with a flame in it, and at noon that means the glass must sit
  // BELOW the bloom threshold or it becomes the brightest thing in the frame.
  const lit = running ? 1 : 0.22;
  const sub = clamp01((SURFACE_Y - camera.position.y) / 34);
  const night = 1 - day;
  const flick = 0.90 + 0.10 * Math.sin(t * 2.0) + 0.04 * Math.sin(t * 7.3);
  const warm = lit * flick * (0.30 + 0.70 * Math.max(sub, night));
  if (lampGlass) lampGlass.material.color.setRGB(1.00 * warm, 0.78 * warm, 0.46 * warm);
  // The glass itself is deliberately tiny — a few centimetres, shrouded by the cage —
  // because that is what stopped it blowing out to a halo at noon. At nine units that
  // makes it about two pixels, so the NIGHT read has to come from the halo instead: the
  // sprite carries it in the dark, and shrinks to almost nothing in daylight.
  beaconGlow.scale.setScalar((1.15 + 6.1 * sub + 1.30 * night * (1 - sub)) * flick);
  beaconGlow.material.opacity = 0.80 * lit * clamp01(0.10 + 0.90 * sub + 0.52 * night * (1 - sub));
  lampLight.intensity = 13 * lit * flick * night * (1 - sub);
  lamp.intensity = 26 * lit;
}

export function nearRaft(pos, radius = 12) {
  return pos.distanceTo(raft.position) < radius;
}
