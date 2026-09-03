// Game state machine, camera, HUD, and the frame loop. Owned by the orchestrator.
import * as THREE from 'three';
import { scene, camera, clock } from './core.js';
import { ZONE_GAP, SURFACE_Y, RIFT_R, zoneTop, zoneBottom, riftPos, LEVIATHAN_CFG } from './config.js';
import { V3, rng, clamp } from './lib/math.js';
import { render, samplePerf, warmUp, setPostBypass, getPostBypass, getVolumetrics } from './postfx.js';
import { lanternLight, playerLightSrc, updateLighting, setWeatherLight, kickLantern, lanternGutter } from './lighting.js';
import { buildTerrain, updateTerrain, terrainH, fillTerrain } from './world/terrain.js';
import { buildFlora, updateFlora, rockColliders, reseedFlora } from './world/flora.js';
import { buildWater, updateWater, updateAtmosphere, setWeatherWater, setWeatherEnv, setWeatherHand, setRayDim, localSurfaceY, renderRefraction, windState } from './world/water.js';
import { buildCreatures, updateCreatures, reseedCreatures } from './world/creatures.js';
import { buildRifts, updateRifts, seedMotes, updateMotes, reseatRifts } from './world/rifts.js';
import { makeLeviathan, disposeLeviathan, updateLeviathan } from './entities/leviathan.js';
import { diver, updateDiver, lanternWorldPos, stepCount, triggerSlash, breathPhase, breathCount, breathStress } from './entities/diver.js';
import './entities/helmetSwap.js';   // mounts the authored helmet if the glb is present
import {
  player, updatePlayer, requestLock, locked, forwardVec, rightVec, keys,
  setStormCurrent, setWindCurrentVec, resetSuit, BURST_DUR, NEUTRAL_FILL
} from './player.js';
import {
  initAudio, chime, growl, setDepth, setProximity, setLight, setAir,
  setSpeed, setWalking, footstep, setZone, slam, setCalm, airVent, bottleReady, setPump,
  syncBreath
} from './audio.js';
import {
  survival, updateSurvival, canCraftHose, craftHose, canCraftFuel, craftFuel,
  resupplyAtRaft, canDescendTo, HOSE_REQ, tearDress, o2RefillRate
} from './systems/survival.js';
import { buildRaft, updateRaft, nearRaft, pumpPos, raft, setSwell, pumpSpeed, chartAnchor, setKeepsakes } from './systems/raft.js';
import { buildTether, updateTether, reseatTether } from './systems/tether.js';
import { buildResources, updateResources, reseedResources } from './world/resources.js';
import { initPhysics, updatePhysics, switchZone as physicsSwitchZone } from './systems/physics.js';
import { buildProps, updateProps, propColliders, reseedProps } from './world/props.js';
import { buildFootFX, spawnFootfall, updateFootFX, setLanternPos } from './world/footfx.js';
import { buildPredators, switchPredatorZone, updatePredators, slash, deployInk, reseedDens } from './world/predators.js';
import { buildWrecks, updateWrecks, wreckColliders, nearRelic, takeRelic, reseedWrecks, setKeepsakeState, nearKeepsake, takeKeepsake } from './world/wrecks.js';
import { buildVents, updateVents, ventColliders, reseedVents } from './world/vents.js';
import { buildClouds, updateClouds, setCloudWeather } from './world/clouds.js';
import { buildRain, updateRain, setRainWeather } from './world/rain.js';
import { buildVentLife, updateVentLife, reseedVentLife } from './world/ventlife.js';
import { initTools, updateTools, sonarPing, fireSpear, fireThruster, setToolsLanternPos } from './systems/tools.js';
import { initWeather, updateWeather } from './systems/weather.js';
import { startEnding, updateEnding } from './ending.js';
import { setSite, currentSite, currentSiteIndex, siteAt } from './world/site.js';
import { openChart, closeChart, isChartOpen } from './ui/chartOverlay.js';

// ---- THE CHART's memory -----------------------------------------------------------
// Loaded BEFORE the world builds, so a saved anchorage builds directly — no reseed at
// boot, no double work. The chart is the save file: which mooring she rides at, which
// sleepers have taken the pencil, what Sal carries, whether the rite has been seen.
const SAVE_KEY = 'abyssa.chart.v1';
let chartRec = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]], endingSeen = false;
// V2: which hidden anchorages the deep sound channel has given up (index-aligned with
// SITES; authored sites start found), and which keepsakes sit on the raft shelf
// (per site, per wreck berth).
let chartFound = [1, 1, 1, 0];
let keepsakes = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
(() => { try {
  const sv = JSON.parse(localStorage.getItem(SAVE_KEY));
  if (!sv) return;
  if (Array.isArray(sv.rec)) { chartRec = sv.rec; while (chartRec.length < 4) chartRec.push([0, 0, 0]); }
  if (Array.isArray(sv.found)) chartFound = sv.found;
  if (Array.isArray(sv.keeps)) { keepsakes = sv.keeps; while (keepsakes.length < 4) keepsakes.push([0, 0, 0]); }
  endingSeen = !!sv.endingSeen;
  if (sv.site) setSite(sv.site);
  if (sv.hose) survival.hose = Math.max(survival.hose, sv.hose);
  if (sv.tools) {
    survival.hasSonar = !!sv.tools.sonar;
    survival.hasSpear = !!sv.tools.spear;
    if (sv.tools.spear) survival.spears = Math.max(survival.spears || 0, 2);
    survival.hasThruster = !!sv.tools.thruster;
  }
} catch (e) { /* a torn save is a blank chart, never a crash */ } })();
function saveChart() { try {
  localStorage.setItem(SAVE_KEY, JSON.stringify({
    site: currentSiteIndex(), rec: chartRec, found: chartFound, keeps: keepsakes,
    endingSeen, hose: survival.hose,
    tools: { sonar: !!survival.hasSonar, spear: !!survival.hasSpear, thruster: !!survival.hasThruster }
  }));
} catch (e) { /* private mode etc: play on, remember nothing */ } }

// ---- build the world ----
buildTerrain();
buildFlora();
buildWater();
buildClouds();   // instanced puff clusters in the air; must follow buildWater (palette + wind)
buildRain();     // one instanced draw call of wind-slanted rain streaks, air side only
buildCreatures();
buildRifts();
buildRaft();
buildTether(pumpPos);
buildResources();
buildProps();   // async; props pop in shortly after load, world never blocks on them
buildFootFX();
buildPredators();
buildWrecks();
// A restored diver already owns his relics: rebuild the wrecks with those cradles
// empty rather than offering him a second sounding set.
if (survival.hasSonar || survival.hasSpear || survival.hasThruster) {
  reseedWrecks({ sonar: !!survival.hasSonar, spear: !!survival.hasSpear, thruster: !!survival.hasThruster });
}
setKeepsakeState(keepsakes[currentSiteIndex()]);
setKeepsakes(keepsakes);
buildVents();
buildVentLife();
initTools();
initWeather();

// Put Sal on the deck and hang the umbilical there BEFORE the title draws. buildTether
// lays the rope as a straight vertical line under the sheave, and nothing simulates it
// behind the title screen — so the first frame of play snapped every node into place at
// once (98 units of travel, measured) and then wriggled for a second and a half while
// the solver found the catenary. Both of those are now paid for here, off-screen.
deckSpawn(player.pos);
reseatTether(player);

// lastStepPhase mirrors stepCount()'s starting value so no bootfall fires on frame one.
let state = 'title', msgT = 0, shake = 0, winT = 0, wasLightOut = false, lastStepPhase = 0;
// One-shot onboarding tips: the game speaks once, at the moment each mechanic first
// matters, and never talks over another message.
const tips = { submerged: 0, taut: 0, fuel: 0, wander: 0, polymer: 0, bitumen: 0,
  dress: 0, swollen: 0, stand: 0, flat: 0 };
let zoneTime = 0;
let wasGrounded = false, landVel = 0;   // tracks fall speed so landings kick up silt
// Entry detector: he is only ABOVE the water at the start of a dive and after a rescue,
// so this fires on the one beat the surface round exists for — the step over the side.
let wasAboveWater = true, deckTip = 0;
// Air thruster: one shove per press of the bottle. BURST_RECHARGE is the whole anti-flight
// argument — at 5 s, mashing Shift while swimming buys +12.7% distance over 30 s against
// the +85% the held-Shift version bought. It is punctuation, never a travel mode.
const BURST_RECHARGE = 5.0, AIR_PER_BURST = 0.10;
let wasCharged = true;
const _burst = V3();
let sputterT = 0, sputterCd = 12;       // storm-peak pump sputter scheduler
let lev = null, zone = -1;
const lanternPos = V3();
let lightDip = 0, lightK = 1, slamWas = false;   // hit feedback on the light (see the lantern block)

const $hud = document.getElementById('hud');
const $msg = document.getElementById('msg');
const $depth = document.getElementById('depth');
const $mode = document.getElementById('mode');
const $lightfill = document.getElementById('lightfill');
const $o2bar = document.getElementById('o2bar');
const $o2fill = document.getElementById('o2fill');
const $o2leak = document.getElementById('o2leak');
const $fuelfill = document.getElementById('fuelfill');
const $hose = document.getElementById('hose');
const $mats = document.getElementById('mats');
const $craft = document.getElementById('craft');
const $warn = document.getElementById('warn');
const $bm = {
  raft: document.getElementById('bmRaft'),
  lev: document.getElementById('bmLev'),
  rift: document.getElementById('bmRift')
};

// DRESS is load-bearing, not decoration: the suit-air model is otherwise invisible state
// and the controls would just read as having got worse. The tick sits at the neutral
// fill, so a player who descends without touching a key WATCHES the bar shrink past it
// and learns Boyle's law in one dive without a word of text. The markup lives in
// index.html with the other gauges; only the tick's position is the suit model's to set.
const $trimfill = document.getElementById('trimfill');
document.querySelector('#trimbar .neutral').style.left = (NEUTRAL_FILL * 100).toFixed(1) + '%';
const $bottlebar = document.getElementById('bottlebar');
const $bottlefill = document.getElementById('bottlefill');

// Bearing strip: place a marker by its horizontal angle from the view direction.
// Off-screen targets pin to the strip's edge at reduced opacity, so you can still
// turn toward them. dy drives a rise/dive glyph appended to the distance.
function setBearing(el, tx, ty, tz, show) {
  if (!show) { el.style.opacity = 0; return; }
  const dx = tx - player.pos.x, dz = tz - player.pos.z, dy = ty - player.pos.y;
  let rel = Math.atan2(dx, dz) - player.yaw;
  while (rel > Math.PI) rel -= Math.PI * 2;
  while (rel < -Math.PI) rel += Math.PI * 2;
  const SPAN = 1.05;                        // radians mapped across the strip's half-width
  const off = clamp(rel / SPAN, -1, 1);
  el.style.left = (50 + off * 50) + '%';
  el.style.opacity = Math.abs(rel) > SPAN ? 0.28 : 0.55 + 0.45 * (1 - Math.abs(off));
  const dist = Math.round(Math.hypot(dx, dy, dz) * 3);
  const vert = dy < -25 ? ' ▾' : dy > 25 ? ' ▴' : '';
  el.querySelector('.dst').textContent = dist + ' m' + vert;
}

// One press, one shove. Edge-triggered on keydown with !e.repeat, so HOLDING Shift can
// never repeat the burst — that is the only reading of the input that fully kills flight.
// Shift still means "swim hard" while held; cracking the bottle and finning hard are the
// same panic gesture, and keeping the 2x swim boost preserves the marginal escape from a
// striking shark (predators.js strikeSpeed 22 against a 25.2 u/s sprint).
function tryBurst() {
  if (player.grounded) return;                 // lead boots on the floor: nothing to push off
  if (survival.thrustCharge < 1) return;       // still repressurising
  const cost = survival.supplied ? AIR_PER_BURST : AIR_PER_BURST * 2;
  if (survival.oxygen <= cost + 0.06) {
    // a wheeze, not a burst — the FX still fires so the player learns why
    _burst.copy(forwardVec());
    fireThruster(_burst.x, _burst.y, _burst.z, 0.12);
    airVent(0.18);
    if (msgT <= 0) showMsg('THE BOTTLE ONLY SIGHS — NOT ENOUGH AIR', 2.5);
    return;
  }
  survival.thrustCharge = 0;
  survival.oxygen = Math.max(0.05, survival.oxygen - cost);
  // Direction: the way he is looking, nudged toward whatever he is asking for. S is
  // applied LAST so reversing does not also invert the lateral nudge.
  _burst.copy(forwardVec());
  if (keys['KeyA'] || keys['ArrowLeft']) _burst.addScaledVector(rightVec(), -0.55);
  if (keys['KeyD'] || keys['ArrowRight']) _burst.addScaledVector(rightVec(), 0.55);
  if (keys['Space']) _burst.y += 0.55;
  if (keys['ControlLeft'] || keys['KeyC']) _burst.y -= 0.55;
  if (keys['KeyS'] || keys['ArrowDown']) _burst.multiplyScalar(-1);
  _burst.normalize();
  player.burstDir.copy(_burst);
  player.burstT = BURST_DUR;
  fireThruster(_burst.x, _burst.y, _burst.z, 1);
  airVent(1);
  camKick = 1; camKickPunch = 1;
  shake = Math.max(shake, 0.34);
}

// Crafting is only possible at the raft, where the pump and reel are.
addEventListener('keydown', e => {
  if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight') && state === 'play'
      && survival.hasThruster && !e.repeat) { tryBurst(); return; }
  // Diagnostic: P bypasses the whole post chain so an on-screen artifact can be
  // attributed to either the scene or a pass, live, without a rebuild.
  if (e.code === 'KeyP') {
    setPostBypass(!getPostBypass());
    showMsg(getPostBypass() ? 'POST PROCESSING BYPASSED (P TO RESTORE)' : 'POST PROCESSING ON', 3);
    return;
  }
  // Q vents a carried ink sac: a dark cloud that breaks a hunting shark's charge.
  if (e.code === 'KeyQ' && state === 'play' && survival.ink > 0) {
    if (deployInk(player.pos)) {
      survival.ink--;
      chime(196, 1.2, 0.2);
      showMsg('INK VENTED', 2);
    }
    return;
  }
  // T: sonar pulse (once the set is recovered from the shallows wreck)
  if (e.code === 'KeyT' && state === 'play' && survival.hasSonar) {
    if (sonarPing(player.pos, zone < 0 ? 0 : zone)) {
      chime(1174, 2.2, 0.16);
      // THE DEEP SOUND CHANNEL: a ping from zone 2 carries far enough to sound
      // ground the chart's owner never reached. Once, ever, per hidden anchorage.
      if (zone === 2 && !chartFound[3]) {
        chartFound[3] = 1;
        saveChart();
        showMsg('A FAR RETURN. NEW GROUND — THE PENCIL TAKES IT.', 6);
        chime(587, 3.5, 0.12);
      }
    }
    return;
  }
  // E near a wreck's relic: take the tool
  if (e.code === 'KeyE' && state === 'play') {
    // keepsakes first: at remote sites the relic berth is long empty — what is
    // left is the previous owner's small thing, and one line of them.
    const kp = nearKeepsake(player.pos);
    if (kp) {
      const got = takeKeepsake(kp.zi);
      if (got) {
        keepsakes[currentSiteIndex()][kp.zi] = 1;
        setKeepsakes(keepsakes);
        saveChart();
        if (got.line) showMsg(got.line, 6);
        chime(659, 2.5, 0.22);
        return;
      }
    }
    const rel = nearRelic(player.pos);
    if (rel) {
      const tool = takeRelic(rel.zi);
      if (tool === 'sonar') { survival.hasSonar = true; showMsg('A SOUNDING SET — [T] LISTENS TO THE DARK', 5); }
      else if (tool === 'spear') { survival.hasSpear = true; survival.spears = 3; showMsg('A SPEAR GUN — RIGHT CLICK. SPEARS CAN BE RECOVERED.', 5); }
      else if (tool === 'thruster') { survival.hasThruster = true; showMsg('AN AIR THRUSTER — TAP SHIFT TO CRACK THE BOTTLE. ONE SHOVE, AND IT COSTS AIR.', 6); }
      if (tool) { chime(659, 2.5, 0.28); chime(880, 2.5, 0.2); return; }
    }
  }
  if (state !== 'play' || !nearRaft(player.pos)) return;
  if (e.code === 'KeyE' && nearChartTable()) { consultChart(); return; }
  if (e.code === 'KeyE' && craftHose()) { chime(523, 1.4, 0.22); showMsg('HOSE EXTENDED', 2); }
  if (e.code === 'KeyF' && craftFuel()) { chime(392, 1.4, 0.22); showMsg('PUMP REFUELLED', 2); }
});
addEventListener('contextmenu', e => { if (locked) e.preventDefault(); });

// Left-click while locked: knife slash. The anim gates repeats; the hit lands on the
// contact frame via pendingSlash so the blade connects when it visually connects.
let pendingSlash = 0;
addEventListener('mousedown', e => {
  if (state !== 'play' || !locked) return;
  if (e.button === 0 && triggerSlash()) pendingSlash = 0.22;   // contact ~0.22s into the swing
  if (e.button === 2 && survival.hasSpear) {
    if (survival.spears > 0 && fireSpear(player.pos, forwardVec())) {
      survival.spears--;
      chime(330, 0.3, 0.24);
    } else if (survival.spears === 0 && msgT <= 0) {
      showMsg('NO SPEARS — FIND THE ONES YOU THREW', 2.5);
    }
  }
});

function showMsg(text, dur = 4) {
  $msg.textContent = text;
  $msg.style.opacity = 1;
  msgT = dur;
}

function enterZone(i) {
  disposeLeviathan(lev);
  zone = i;
  setZone(i);            // must precede growl() so the voice is tuned to the zone
  // Remote anchorages carry hand-authored sleeper rows: more wards, a hue nudge, an
  // epithet in the previous chart-owner's ink. Home passes undefined and is untouched.
  const row = currentSite().sleepers && currentSite().sleepers[i];
  lev = makeLeviathan(i, row ? {
    nSigils: row.sigils,
    hue: (LEVIATHAN_CFG[i].hue + row.hueShift + 1) % 1,
    name: currentSite().epithet ? currentSite().epithet[i] : LEVIATHAN_CFG[i].name
  } : undefined);
  seedMotes(i);
  physicsSwitchZone(i);  // no-op until the WASM world is up
  switchPredatorZone(i);
  setCalm(0);
  showMsg(lev.name);
  growl();
  pendingWards = i > 0;
  riftShutSaid = false;
  // The bowl's rim, for the rift-shut beat: the collar crest sits at 0.84 of the funnel
  // radius, so sample the height there on four bearings and keep the mean.
  const rp = riftPos(i), rr = RIFT_R * 2.7 * 0.84;
  riftRimY = (terrainH(rp.x + rr, rp.z, i) + terrainH(rp.x - rr, rp.z, i)
    + terrainH(rp.x, rp.z + rr, i) + terrainH(rp.x, rp.z - rr, i)) * 0.25;
}
// THE RIFT IS SHUT WHILE IT WAKES: a diver who drops into the bowl before the sleeper
// stills falls into an unmarked hole in the dark. Said once per zone, 20u below the rim.
let riftShutSaid = false, riftRimY = 0;

// Where a dressed diver waits before a dive: on the deck, clear of the pump block at
// local z = -1.2, facing out over the water he is about to step into.
export function deckSpawn(out) {
  return out.set(raft.position.x, raft.position.y + 0.11 + 1.35, raft.position.z + 2.6);
}

export function start() {
  if (state !== 'title') return;
  state = 'play';
  // He begins the dive standing on the raft, not already in the water. The whole point
  // of the surface round: you see the sea before you are under it.
  deckSpawn(player.pos);
  player.vel.set(0, 0, 0);
  player.yaw = 0;                 // facing +z, out across the water
  player.pitch = -0.05;
  resetSuit(player.pos.y);
  reseatTether(player);
  // Snap the camera from the title portrait (in front of Sal) straight to the
  // play position behind him — letting the spring travel there would drag the
  // lens through his body.
  camera.position.set(player.pos.x, player.pos.y + CAM_UP, player.pos.z - CAM_BACK);
  camVel.set(0, 0, 0);
  camLook.set(player.pos.x, player.pos.y, player.pos.z + 6);
  document.getElementById('title').classList.add('hidden');
  $hud.classList.remove('hidden');
  initAudio();
  enterZone(0);
  // Async WASM load; the module degrades to no-ops if the CDN fails, so no await.
  initPhysics(0);
  // Lock is requested by the window click handler below, on this same click. Asking
  // here as well made Chrome reject the duplicate request, so the mouse stayed dead
  // until the player clicked a second time.
  showMsg(wardsLine());
}

// THE VERB IS SETTLED: wards are LIT, the sleeper STILLS. One sentence says what a ward
// is, where it rides, and what lighting it does — with this zone's real count, since a
// remote anchorage's sleeper can carry more iron than the home one.
const COUNT = ['NO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE'];
function wardsLine() {
  const n = lev ? lev.sigils.length : 3;
  return `${COUNT[n] || n} IRON WARDS RIDE ITS HIDE. LIGHT THEM AND IT STILLS.`;
}
let pendingWards = false;   // zones after the first say their count once the name has faded

document.getElementById('title').addEventListener('click', start);
addEventListener('click', () => {
  if (state !== 'title' && !locked && !isChartOpen()) requestLock();
});

// ---- THE VOYAGE: weigh anchor, black water, a new sea floor -------------------------
const $voyage = (() => {
  const d = document.createElement('div');
  d.id = 'voyage';
  d.style.cssText = 'position:fixed;inset:0;background:#010409;opacity:0;pointer-events:none;z-index:15';
  document.body.appendChild(d);
  return d;
})();
let voyageT = 0, voyageTo = 0, voyageDone = false, inkBeat = false;

function startVoyage(i) {
  if (state !== 'play') return;
  state = 'voyage';
  voyageT = 0; voyageTo = i; voyageDone = false;
  slam();                                   // the chain lets go of the seabed
  showMsg('SHE MAKES FOR ' + siteAt(i).name, 4);
}

// The reseed itself, run once under full black: a load event, exempt from the
// per-frame allocation rule. ORDER IS CONTRACT — flora excludes around wreckSites(),
// dens are re-picked from flora's fresh colliders.
function reseedWorld(i) {
  setSite(i);
  fillTerrain();
  reseedWrecks({ sonar: !!survival.hasSonar, spear: !!survival.hasSpear, thruster: !!survival.hasThruster });
  setKeepsakeState(keepsakes[currentSiteIndex()]);
  reseedFlora();
  reseedResources();
  reseedProps();
  reseedVents();
  reseedVentLife();
  reseatRifts();
  reseedDens();
  reseedCreatures();
  enterZone(0);
  inkBeat = false;
  deckSpawn(player.pos);
  player.vel.set(0, 0, 0); player.yaw = 0; player.pitch = -0.05;
  resetSuit(player.pos.y);
  reseatTether(player);
  survival.oxygen = 1;
  survival.fuel = Math.max(survival.fuel, 0.3);   // the tender refits while she sails
  camera.position.set(player.pos.x, player.pos.y + CAM_UP, player.pos.z - CAM_BACK);
  camSnap = true;
  saveChart();
}

// The [E] CONSULT reach: on deck, within arm's length of the table's standing spot.
const _chartW = V3();
function nearChartTable() {
  raft.localToWorld(_chartW.copy(chartAnchor));
  return player.onDeck && player.pos.distanceTo(_chartW) < 3.2;
}
function consultChart() {
  if (document.exitPointerLock) document.exitPointerLock();
  openChart({ currentSite: currentSiteIndex(), calmed: chartRec, found: chartFound },
    i => startVoyage(i), () => {});
}

// Debug/automation surface used by the visual-review harness.
Object.assign(window, { player, start, zoneTop, zoneBottom, terrainH, camera, diver, scene, survival, setState: s => { state = s; } });
// Probe surface for the hit feedback: the live refill rate, the light dip, the rift rim.
window.__hit = () => ({ torn: +survival.torn.toFixed(2), refill: +o2RefillRate().toFixed(3), lightDip: +lightDip.toFixed(3), lightK: +lightK.toFixed(3), riftRimY: +riftRimY.toFixed(1), lantern: +lanternLight.intensity.toFixed(2) });
// Debug: switch the active zone without calming a sleeper — zone gating (terrain floor,
// predators, leviathan, physics) all key off this, so a teleported probe that skips it
// gets snapped back up to the previous zone's seabed and reads as a broken teleport.
window.gotoZone = i => { enterZone(Math.max(0, Math.min(2, i | 0))); return 'zone ' + zone; };
// Debug: sail without the fade (the fade is cosmetic; this is the state change), and
// force the reseed directly. Kept for probes and for future harness runs.
window.__chart = { sail: i => startVoyage(i | 0), arrive: i => reseedWorld(i | 0), rec: () => chartRec,
  found: () => chartFound, keeps: () => keepsakes };
// Debug: jump straight to the ending cinematic from anywhere in a running game.
window.playEnding = () => {
  if (state !== 'play') return 'start the game first';
  player.pos.set(0, zoneBottom(2) - 72, 0);
  player.vel.set(0, 0, 0);
  state = 'won'; winT = 0;
  chime(523, 3, 0.3); chime(659, 3, 0.2); chime(784, 4, 0.2);
  resetSuit(player.pos.y);
  startEnding();
  return 'ending started';
};
Object.defineProperties(window, {
  lev: { get: () => lev },
  zone: { get: () => zone },
  gameState: { get: () => state }
});

// ---- cinematic third-person camera ----
const camVel = V3(), camAim = V3(), camDesired = V3(), camLook = V3();
const camBack = V3(), camTo = V3(), camRight = V3();   // hot-path temps, never allocated per frame
let camDist = 9, camRoll = 0, camFov = 70;
// A respawn TELEPORTS the diver, and the spring then flew the camera the whole way after
// him — measured 210 units in ~1.2 s, during which the frame peaked at 3.15x its normal
// luminance and fell back. That bright wash is the camera crossing the entire water
// column in open water while the LIGHTING has already snapped to surface values (it keys
// off player depth, which teleports; the fog keys off the camera, which does not). A
// respawn is a CUT, not a camera move. Set this and updateCamera places the eye directly.
let camSnap = false;
// Burst reaction. Scoped entirely to these two envelopes so ordinary swimming — which
// nobody complained about — is byte-identical to before.
let camKick = 0, camKickPunch = 0;
const CAM_BACK = 9, CAM_UP = 2.4;
// ---- THE FEEL CHANNEL -------------------------------------------------------------
// Every embodiment change so far lived in Sal's BODY, and Michael couldn't feel any of
// it — because the player experiences the game through a critically-damped camera nine
// units back, and that spring is a low-pass filter that erases surge and footfall
// alike. Feel is transmitted through the camera or it is not transmitted at all.
//   swim: the camera breathes with the stroke — an EMA tracks mean speed, and the
//         camera pulls in on the kick's surge and drifts out through the coast.
//   deck: each heel strike dips the eye a few centimetres with a fast recovery, so
//         footfalls exist in the hands, not just in Sal's knees.
// Millimetres, not screen shake — the game stays quiet. window.__feel A/Bs it live.
let speedEMA = 0, camStepDip = 0;
const FEEL = { on: true, surgeK: 1.35, stepDip: 0.05 };
window.__feel = FEEL;
// breath probe: cycle timing + phase, for cadence verification without a stopwatch
window.__breath = () => ({ phase: breathPhase(), count: breathCount(), stress: breathStress() });
let lastBreath = 0;

// Walk the ray from the player out to the ideal camera spot and stop short of the
// seafloor and of any boulder large enough to swallow the camera, so obstacles push
// the camera in instead of clipping through it.
function clearCamDistance(from, dir, want, zi) {
  const STEPS = 8, MARGIN = 0.8;
  for (let i = 1; i <= STEPS; i++) {
    const d = want * (i / STEPS);
    const x = from.x + dir.x * d, y = from.y + dir.y * d, z = from.z + dir.z * d;
    if (y < terrainH(x, z, zi) + 1.1) return Math.max(2.2, want * ((i - 1) / STEPS));
    for (let list = 0; list < 4; list++) {
    const cols = list === 0 ? rockColliders : list === 1 ? propColliders : list === 2 ? wreckColliders : ventColliders;
    for (let k = 0; k < cols.length; k++) {
      const c = cols[k];
      // cheap reject on the dominant axes before the full sphere test
      const dx = x - c.x; if (dx > c.r + MARGIN || dx < -c.r - MARGIN) continue;
      const dz = z - c.z; if (dz > c.r + MARGIN || dz < -c.r - MARGIN) continue;
      const dy = y - c.y;
      const rr = c.r + MARGIN;
      if (dx * dx + dy * dy + dz * dz < rr * rr) return Math.max(2.2, want * ((i - 1) / STEPS));
    }
    }
  }
  return want;
}

function updateCamera(dt, t, fwd) {
  const zi = zone < 0 ? 0 : zone;
  const speed = player.vel.length();
  camBack.copy(fwd).multiplyScalar(-1);
  camKick = Math.max(0, camKick - dt / 0.62);
  camKickPunch = Math.max(0, camKickPunch - dt / 0.34);

  const want = clearCamDistance(player.pos, camBack, CAM_BACK, zi);
  camDist += (want - camDist) * Math.min(1, (want < camDist ? 14 : 4) * dt);

  camDesired.copy(player.pos).addScaledVector(camBack, camDist);
  camDesired.y += CAM_UP;
  camDesired.y = Math.max(camDesired.y, terrainH(camDesired.x, camDesired.z, zi) + 1.2);
  // idle breathing drift so the frame is never perfectly locked
  camDesired.y += Math.sin(t * 0.7) * 0.09;
  camDesired.x += Math.sin(t * 0.43) * 0.07;

  // feel channel: swim surge + deck footfall (see the block at the constants)
  if (FEEL.on) {
    const spd = player.vel.length();
    speedEMA += (spd - speedEMA) * Math.min(1, 0.5 * dt);          // ~2s mean
    if (!player.grounded && speedEMA > 1.5) {
      // surge > 0 on the kick, < 0 in the coast; camera pulls in on the push
      const surge = (spd - speedEMA) / Math.max(speedEMA, 1);
      camDesired.addScaledVector(camBack, -FEEL.surgeK * clamp(surge, -0.6, 0.6));
    }
    camStepDip = Math.max(0, camStepDip - dt / 0.22);
    camDesired.y -= FEEL.stepDip * camStepDip;
  }
  // A critically-damped tracker sits damp*v/stiff behind its target, measured at 20.9 u
  // when the old thruster was at full chat — so the camera made the effect LESS visible
  // at exactly the moment it fired. Lead the spring by that amount and punch in, but
  // only while the kick is live.
  if (camKick > 0) {
    camDesired.addScaledVector(player.vel, 0.3086 * camKick);
    camDesired.addScaledVector(camBack, -2.6 * camKick);
  }

  // Cut, don't fly. Done before the spring so camVel never integrates the teleport.
  if (camSnap) {
    camSnap = false;
    camera.position.copy(camDesired);
    camVel.set(0, 0, 0);
    camLook.copy(player.pos).addScaledVector(fwd, 6);
    camDist = want;
  }

  // critically-damped spring: settles without the rubber-band of a raw lerp
  const stiff = 42, damp = 2 * Math.sqrt(stiff);
  camTo.copy(camDesired).sub(camera.position);
  camVel.addScaledVector(camTo, stiff * dt).addScaledVector(camVel, -damp * dt);
  camera.position.addScaledVector(camVel, dt);
  // Leading the target is not enough on its own: the spring needs ~0.31 s to respond and
  // the whole burst is 0.26 s. Close the rest of the gap directly, scoped to the kick.
  if (camKick > 0) camera.position.lerp(camDesired, Math.min(1, 7 * camKick * dt));

  if (shake > 0) {
    camera.position.x += rng(-1, 1) * shake * 0.5;
    camera.position.y += rng(-1, 1) * shake * 0.5;
    camera.position.z += rng(-1, 1) * shake * 0.5;
    shake = Math.max(0, shake - dt * 2);
  }

  // There is no above-water world yet — no sky, and the raft deck sits at y = -2.08 — so
  // a camera that breaks the surface renders air through the WATER's optics and washes
  // the frame out to flat grey-green. Sal can legitimately reach the surface (the tenders
  // trim him up at the raft), so hold the eye just under it and let him bob through
  // instead. Zeroing the rising spring velocity matters: without it the spring keeps
  // integrating into the clamp and snaps when he descends again.
  // window.__noSurfClamp lets a probe put the eye in the air on purpose. This clamp is a
  // stopgap for having no above-water world; the surface round is what retires it.
  // The waterline clamp is RETIRED. It existed because there was no above-water world to
  // render; there is one now, and Sal starts the dive standing on the deck, so the eye
  // has to be allowed into the air. What remains is a floor under the DECK so the spring
  // cannot dip the lens through the planks while he stands on them — the deck is a
  // one-way platform for him and needs to be one for the camera too.
  if (player.grounded && player.pos.y > SURFACE_Y) {
    const deckLim = raft.position.y + 0.11 + 0.35;
    if (camera.position.y < deckLim) {
      camera.position.y = deckLim;
      if (camVel.y < 0) camVel.y = 0;
    }
  }

  // aim slightly ahead of travel so fast movement leads the frame
  // Aim tracks the look direction almost immediately. Heavy smoothing here reads as
  // mouse lag, which is far more objectionable than a little jitter.
  camAim.copy(player.pos).addScaledVector(fwd, 6).addScaledVector(player.vel, 0.10);
  camLook.lerp(camAim, Math.min(1, 40 * dt));
  camera.lookAt(camLook);

  // bank into lateral movement, and widen slightly with speed
  camRight.set(Math.sin(player.yaw - Math.PI / 2), 0, Math.cos(player.yaw - Math.PI / 2));
  const lateral = player.vel.dot(camRight);
  camRoll += (clamp(-lateral * 0.012, -0.11, 0.11) - camRoll) * Math.min(1, 3 * dt);
  camera.rotateZ(camRoll);

  // The 2.5/s lerp has a 0.4 s time constant, so it can only reach 48% of any target
  // inside a 0.26 s burst — which is why the existing +9 speed FOV was imperceptible.
  // Snap out, ease back. Capped at 86: the speed term and the kick peak together, and
  // 70 + 9 + 15 would be an 89-degree fisheye.
  const wantFov = Math.min(86, 70 + clamp(speed * 0.32, 0, 9) + 11 * camKickPunch);
  // Snap out only while a kick is live; the 2.5/s ease is otherwise exactly as shipped.
  const fovRate = camKickPunch > 0 && wantFov > camFov ? 20 : 2.5;
  camFov += (wantFov - camFov) * Math.min(1, fovRate * dt);
  if (Math.abs(camera.fov - camFov) > 0.01) { camera.fov = camFov; camera.updateProjectionMatrix(); }
}

function update(dt, t) {
  if (msgT > 0) { msgT -= dt; if (msgT <= 0) $msg.style.opacity = 0; }

  // TITLE: Sal already dressed and standing on the tender's deck, waiting to go over.
  // He used to hang 10 m under the raft here and get teleported onto the planks by
  // start() — a seam, and a waste of the one place in this game with daylight in it.
  // Standing him where the dive actually begins removes the cut and opens the game
  // above water, which is the whole shape of it: you start in the light and give it up.
  if (state === 'title') {
    // The hero shot's raft used to be frozen — updateRaft never ran before the
    // state gate below. Run it first so the deck Sal is spawned onto (and the swell
    // the camera rides over) is this frame's, not boot's: flywheel turning, exhaust
    // puffing, lantern lit, hull riding the sea behind the title.
    updateRaft(dt, t);
    deckSpawn(player.pos);
    // The rig poses off player state and updatePlayer never runs behind the title, so
    // grounded keeps its boot value of FALSE — which blended Sal into the swim posture,
    // treading water on top of his own deck. He is standing on planks; say so.
    player.grounded = true;
    player.onDeck = true;
    player.vel.set(0, 0, 0);
    diver.position.copy(player.pos);
    updateDiver(dt, t, player);
    // Three-quarter from the starboard bow, so the davit rakes across the frame behind
    // him and the pump's stack sits over his shoulder. Drifts slowly; the raft's own
    // bob rides underneath it, so the shot breathes twice at different rates.
    const a = t * 0.05;
    camera.position.set(
      player.pos.x + 3.15 + Math.sin(a) * 0.55,
      player.pos.y + 1.05 + Math.sin(t * 0.5) * 0.06,
      player.pos.z + 4.30 + Math.cos(a) * 0.40
    );
    // Look-target offset puts Sal in the right third of the frame, clear of the type.
    camera.lookAt(player.pos.x - 1.35, player.pos.y + 0.30, player.pos.z);
  }

  // Weather runs even behind the title so a session can open at dusk or mid-storm.
  const wx = updateWeather(dt, t);
  setWeatherLight(wx.day, wx.storm, wx.flash, wx.env);
  setWeatherEnv(wx.env);
  setWeatherHand(wx.hand, wx.wind);
  setCloudWeather(wx.hand, wx.env.sky);
  setRainWeather(wx.env, windState());   // the eased wind, so the streaks lean on the same curve as the chop
  // The storm's 45% cut to surface irradiance is DAY-GATED now (the sunlit-storm
  // principle, same as the palette desat): a noon gale keeps most of its light —
  // Michael's poseidon reference is a BRIGHT storm — while a night gale keeps the
  // full dread cut. At day 1 the cut is ~16%; at day 0 it is the shipped 45%.
  // day/flash passed EXPLICITLY (water.js's preferred form): the fallback inversion of
  // surfK predates the day-gated storm cut and skews wDay in mid-day gales, and without
  // the flash arg the sea-surface lightning term (uFlash) never fires at all.
  setWeatherWater((0.20 + 0.80 * wx.day) * (1 - 0.45 * wx.storm * (1 - 0.65 * wx.day)), wx.storm, wx.day, wx.flash);
  setSwell(wx.env.sea, wx.day);
  setStormCurrent(wx.env.below);   // subsurface current lags the sky — weather arrives from above
  setWindCurrentVec(windState().speed, windState().dx, windState().dz);   // eased wind: drift below re-aims on the same curve as the chop above
  setRayDim(getVolumetrics() ? 0.55 : 1);

  // Ambient world animation runs even behind the title screen.
  updateFlora(dt, t);
  updateProps(dt, t);
  updateFootFX(dt, t);
  updateCreatures(dt, t);
  updateWater(dt, t);
  updateClouds(dt, t);   // after updateWater: reads its eased wind and its resolved cloud palette
  updateRain(dt, t);     // after updateWater: reads the surface height it just resolved
  updateTerrain(dt, t, camera.position.y, wx.day * (1 - 0.85 * wx.storm));
  updateRifts(dt, t, zone, !!(lev && lev.calmed));

  // ---- THE VOYAGE ------------------------------------------------------------------
  // A cut dressed as passage: fade to black, reseed the whole sea floor under it,
  // arrive on deck at the new anchorage. The world keeps breathing (ambient updates
  // above already ran); the reseed itself happens exactly once, at full black.
  if (state === 'voyage') {
    voyageT += dt;
    $voyage.style.opacity = voyageT < 2 ? voyageT / 2
      : voyageT < 4.6 ? 1
      : Math.max(0, 1 - (voyageT - 4.6) / 1.5);
    if (!voyageDone && voyageT >= 2.3) {
      voyageDone = true;
      reseedWorld(voyageTo);
      chime(392, 2.6, 0.2);                 // the bell as she takes her new mooring
    }
    if (voyageT >= 6.2) { state = 'play'; $voyage.style.opacity = 0; }
    updateRaft(dt, t);
    updateAtmosphere(0, camera.position.y);
    updateLighting(0);
    return;
  }

  // The 2.5s between drowning and the deck used to hold a half-frozen frame: ambient
  // systems above kept breathing but the raft, hose and camera all stopped dead — it
  // read as a hitch, not a cut. Keep the cheap subset ticking and let the eye rise
  // slowly off the body: the haul beginning, quiet and unhurried.
  if (state === 'dead') {
    updateRaft(dt, t);
    updateTether(dt, player, zone);
    const d01 = clamp(-player.pos.y / 900, 0, 1);
    updateAtmosphere(d01, camera.position.y);
    updateLighting(d01);
    camera.position.y += dt * 0.4;
    camera.lookAt(player.pos);
    return;
  }

  if (state !== 'play' && state !== 'won') return;

  // The ending cinematic owns the player and camera; the world keeps breathing
  // underneath it (flora/water updates above already ran this frame).
  if (state === 'won') {
    winT += dt;
    updateEnding(dt, t);
    const d01 = clamp(-player.pos.y / 900, 0, 1);
    updateRaft(dt, t);
    updateVentLife(dt, t);   // the boiler-room flythrough is inhabited, not a still
    updateAtmosphere(d01, camera.position.y);
    updateLighting(d01);
    setDepth(d01);
    return;
  }

  // The chart in hand stills the man: movement keys are parked while the paper is up.
  if (isChartOpen()) for (const k in keys) keys[k] = false;
  const { fwd } = updatePlayer(dt, t, zone, !!(lev && lev.calmed));
  $mode.textContent = player.grounded ? 'walking'
    : player.fill > NEUTRAL_FILL + 0.09 ? 'rising'
    : player.fill < NEUTRAL_FILL - 0.09 ? 'sinking' : 'trimmed';
  const depth01 = clamp(-player.pos.y / 900, 0, 1);

  // ---- THE STEP OVER THE SIDE -------------------------------------------------------
  // Crossing the waterline downward is the moment the whole surface round was built for,
  // and it costs almost nothing to give it weight: a slam for the impact, a rush of
  // bubbles past the helmet, and a camera kick so the frame lurches as he goes under.
  // Keyed on the LIVE local surface, the same one the optics and the clamp use.
  const aboveWater = player.pos.y > localSurfaceY();
  if (wasAboveWater && !aboveWater) {
    const impact = Math.min(1, Math.abs(player.vel.y) / 6);
    slam();
    airVent(0.5 + 0.5 * impact);
    shake = Math.max(shake, 0.35 + 0.5 * impact);
    camKick = Math.max(camKick, 0.5);
    showMsg('VENT THE DRESS TO GO DOWN', 3.5);
  }
  wasAboveWater = aboveWater;

  // One-shot deck prompt: he starts standing on planks with no idea he is meant to leave
  // them. Fires once, only while he is actually up there, and never over another message.
  if (!deckTip && player.grounded && player.pos.y > SURFACE_Y && msgT <= 0) {
    deckTip = 1;
    showMsg('STEP OVER THE SIDE', 4);
  }

  // THE RIFT IS SHUT WHILE IT WAKES: 20u below the bowl's rim with the sleeper awake.
  if (!riftShutSaid && lev && !lev.calmed && zone >= 0 && msgT <= 0) {
    const rq = riftPos(zone);
    if (Math.hypot(player.pos.x - rq.x, player.pos.z - rq.z) < RIFT_R * 2.7 * 0.84
        && player.pos.y < riftRimY - 20) {
      riftShutSaid = true;
      showMsg('THE RIFT IS SHUT WHILE IT WAKES.', 5);
    }
  }
  // zone progression through the rift, gated on having the line to work the next zone
  if (lev && lev.calmed && zone < 2 && player.pos.y < zoneBottom(zone) - ZONE_GAP * 0.55) {
    if (canDescendTo(zone + 1)) enterZone(zone + 1);
    else if (msgT <= 0) showMsg(`THE LINE IS TOO SHORT — ${HOSE_REQ[zone + 1] * 3} M NEEDED`, 3);
  }
  if (lev && lev.calmed && zone === 2 && player.pos.y < zoneBottom(2) - 70 && state === 'play') {
    // The full rite plays ONCE, the first triple-calm anywhere. Every later completion
    // is a quiet beat: the chart takes the ink and the dive simply ends where it is.
    if (endingSeen) {
      if (!inkBeat) {
        inkBeat = true;
        saveChart();
        showMsg('THE THIRD STILLS. THE CHART TAKES THE INK.', 7);
        chime(523, 3, 0.25); chime(659, 3, 0.18); chime(784, 4, 0.15);
      }
      return;
    }
    endingSeen = true;
    saveChart();
    state = 'won'; winT = 0;
    chime(523, 3, 0.3); chime(659, 3, 0.2); chime(784, 4, 0.2);
    // The cinematic drives player.pos/vel itself; clear the suit state so a banked burst
    // cannot fire under it and so the rig's pose reads off a sane fill.
    resetSuit(player.pos.y);
    startEnding();
    return;
  }

  const gained = updateMotes(dt, t, player.pos);
  if (gained) {
    player.light = Math.min(1, player.light + 0.34 * gained);
    chime(880 + Math.random() * 220, 0.9, 0.18);
  }

  if (lev) {
    const ev = updateLeviathan(lev, dt, t, player);
    if (ev.lightDrain) player.light -= ev.lightDrain;
    if (ev.slam) {
      shake = Math.min(1, shake + 2 * dt); slam();
      // Contact is per-frame; the tear is per collision. Rising edge only.
      if (!slamWas) {
        kickLantern(1.2);
        lightDip = Math.max(lightDip, 0.7);
        if (tearDress()) showMsg('AIR IS LEAKING — THE DRESS IS TORN', 4);
      }
    }
    slamWas = ev.slam;
    if (ev.sigilLit) {
      chime(ev.sigilLit, 2, 0.3);
      shake = 0.6;
      if (ev.remaining > 0) showMsg((COUNT[ev.remaining] || ev.remaining) + (ev.remaining === 1 ? ' WARD DARK' : ' WARDS DARK'), 2.5);
    }
    if (ev.calmed) {
      chartRec[currentSiteIndex()][zone] = 1;
      saveChart();
      player.light = 1;
      setCalm(1);
      // The one moment the player is reading: if the line will not reach the next zone,
      // say so NOW with the real numbers, not 55% of the way down the rift.
      showMsg(zone === 2 ? 'ALL WARDS LIT. THE LAST SLEEPER STILLS. THE RIFT WAITS.'
        : canDescendTo(zone + 1) ? 'ALL WARDS LIT. IT STILLS. A RIFT OPENS BELOW.'
        : `IT STILLS. YOU HAVE ${Math.floor(survival.hose * 3)} M OF LINE. THE RIFT NEEDS ${HOSE_REQ[zone + 1] * 3}.`, 6);
      chime(262, 3, 0.3); chime(330, 3, 0.25); chime(392, 3, 0.25);
    }
  }

  // The lantern going out is no longer fatal on its own — it blinds you and makes you
  // breathe harder. Drowning is the single death condition.
  player.light = Math.min(1, player.light + dt * 0.008);
  const lightOut = player.light <= 0;
  if (lightOut) player.light = 0;
  if (lightOut && !wasLightOut) showMsg('YOUR LANTERN IS OUT', 3);
  wasLightOut = lightOut;

  // ---- surface-supplied air ----
  updateRaft(dt, t);
  const distFromRaft = updateTether(dt, player, zone);
  const drowned = updateSurvival(dt, depth01, player.pos.y < -3, lightOut);

  // The pump, heard. On deck it is the loudest object in Sal's world; once he is under,
  // the same thump comes down the umbilical, faint and never quite gone — that thread of
  // sound IS the machine breathing for him, so it keeps a floor all the way to the
  // bottom. Which makes the moment it stops the moment he finds out. Speed comes from
  // the real flywheel, so what he hears and what he'd see always agree.
  {
    const near = clamp(1 - (player.pos.distanceTo(raft.position) - 3) / 26, 0, 1);
    setPump(pumpSpeed(), player.pos.y > localSurfaceY()
      ? Math.max(0.12, near)
      : 0.13 * (1 - 0.45 * depth01));
  }

  // At a storm's peak the pump gasps: brief windows where the swell outruns the
  // flywheel and the tank dips. Survivable, but it teaches you to ride storms deep
  // or sit them out on the raft.
  if (wx.storm > 0.7) {
    sputterCd -= dt;
    if (sputterCd <= 0) { sputterT = 2.2; sputterCd = rng(9, 16); }
  }
  if (sputterT > 0) {
    sputterT -= dt;
    if (player.pos.y < -3) {
      survival.oxygen = Math.max(0.04, survival.oxygen - dt * 0.30);
      if (msgT <= 0) showMsg('THE PUMP GASPS IN THE SWELL', 2);
    }
  }

  if (nearRaft(player.pos)) {
    resupplyAtRaft();
    if (nearChartTable()) {
      $craft.textContent = '[E] consult the chart';
      $craft.style.opacity = 1;
    } else {
      const canH = canCraftHose(), canF = canCraftFuel();
      $craft.textContent = canH || canF
        ? `[E] craft hose  ·  [F] refuel pump${canH ? '' : '   (need 3 polymer)'}`
        : 'at the raft — collect polymer and bitumen below';
      $craft.style.opacity = 1;
    }
  } else {
    const rel = nearRelic(player.pos);
    if (rel) {
      $craft.textContent = `[E] take the ${rel.tool === 'sonar' ? 'sounding set' : rel.tool === 'spear' ? 'spear gun' : 'air thruster'}`;
      $craft.style.opacity = 1;
    } else {
      $craft.style.opacity = 0;
    }
  }

  const got = updateResources(dt, t, player.pos);
  if (got) {
    chime(got === 'polymer' ? 660 : 330, 0.7, 0.14);
    if (got === 'polymer' && !tips.polymer) { tips.polymer = 1; showMsg('POLYMER — THREE MAKE A LENGTH OF HOSE', 4); }
    else if (got === 'bitumen' && !tips.bitumen) { tips.bitumen = 1; showMsg('BITUMEN — FOOD FOR THE PUMP', 4); }
  }

  // onboarding beats fire only in silence, each exactly once
  zoneTime += dt;
  if (msgT <= 0 && state === 'play') {
    if (pendingWards) {
      pendingWards = false; showMsg(wardsLine(), 5);
    } else if (!tips.submerged && player.pos.y < -6) {
      tips.submerged = 1; showMsg('YOUR AIR COMES DOWN THE LINE. THE PUMP ABOVE MUST STAY FED.', 5);
    } else if (!tips.taut && survival.tautness > 0.92) {
      tips.taut = 1; showMsg('THE LINE IS TAUT — MORE HOSE CAN BE MADE AT THE RAFT', 5);
    } else if (!tips.fuel && survival.fuel < 0.5) {
      tips.fuel = 1; showMsg('THE PUMP RUNS LOW. IT BURNS BITUMEN — BLACK LUMPS ON THE FLOOR.', 5);
    } else if (!tips.wander && zone === 0 && zoneTime > 75 && lev && !lev.calmed && !lev.sigils.some(s => s.lit)) {
      tips.wander = 1; showMsg('FOLLOW THE SLEEPER MARK ON THE RULE ABOVE. LIGHT ITS WARDS.', 6);
    }
  }
  // Suit-air beats are gated separately: 'TOO MUCH AIR TO STAND' has to fire on the
  // FIRST occurrence or the player bobs helplessly without knowing Ctrl is the answer.
  if (state === 'play') {
    if (!tips.dress && player.pos.y < -8) {
      tips.dress = 1; showMsg('AIR IN THE DRESS LIFTS YOU. [SPACE] FILLS IT, [CTRL] VENTS IT.', 5);
    } else if (!tips.swollen && player.fill > 0.97 && player.vel.y > 2) {
      tips.swollen = 1; showMsg('THE DRESS IS SWELLING. VENT OR IT WILL CARRY YOU UP.', 4);
    } else if (!tips.stand && !player.grounded && player.buoy > 0.9
               && player.pos.y < player.groundY + 2.5 && player.pos.y > player.groundY - 1) {
      tips.stand = 1; showMsg('TOO MUCH AIR TO STAND. VENT.', 4);
    } else if (!tips.flat && player.fill <= 0.001 && player.pos.y < -400) {
      tips.flat = 1; showMsg('THE DRESS IS FLAT. YOU ARE A STONE.', 4);
    }
  }

  if (drowned && state === 'play') {
    state = 'dead';
    showMsg('YOUR AIR RAN OUT', 4);
    setTimeout(() => {
      // BACK ON THE DECK, not floating under the raft. The tenders hauled him up and
      // stood him on his feet; the dive starts again the way it started the first time,
      // by stepping over the side. Same pose as start().
      deckSpawn(player.pos);
      player.yaw = 0;
      player.pitch = -0.05;
      player.vel.set(0, 0, 0);
      player.light = 1;
      survival.oxygen = 1;
      survival.torn = 0;
      survival.thrustCharge = 1;
      // The tenders re-dress him and blow the suit up. Without this he arrives at the
      // raft with whatever the drowning left — usually a flat dress — and sinks straight
      // back off the surface he was just hauled to.
      resetSuit(player.pos.y);
      // They hauled him back BY the line, so the line came up with him. Without this the
      // tender reels in at 0.6 m/s from wherever he drowned — six minutes of slack hose
      // tangled around the camera after a death at 220 m.
      reseatTether(player);
      // Cut the camera with him. The y is set here as well as via camSnap because
      // updateAtmosphere runs BEFORE updateCamera in the frame, so leaving the eye 210
      // units down would key one more frame of fog off the death depth.
      camera.position.set(player.pos.x, player.pos.y + CAM_UP, player.pos.z + CAM_BACK);
      camSnap = true;
      // The rescue tops the pump up from the reserve can. Without this, drowning with
      // an empty tank and no bitumen strands you at the raft with 45s of air and all
      // the bitumen 200m below — an unwinnable state.
      survival.fuel = Math.max(survival.fuel, 0.3);
      state = 'play';
      showMsg('THEY HAVE YOU BACK ON THE DECK', 3);
    }, 2500);
  }

  // ---- feed the audio engine ----
  // regulator/breath sound phase-locked to the diver's breath clock: one sync per
  // cycle, fired at inhale start, carrying the same stress that sets the cadence
  if (breathCount() !== lastBreath) { lastBreath = breathCount(); syncBreath(breathStress()); }
  setDepth(depth01);
  setLight(lightK);
  setAir(survival.oxygen);
  setSpeed(player.vel.length());
  setWalking(player.grounded);
  // knife: the hit lands on the swing's contact frame, not the click
  if (pendingSlash > 0) {
    pendingSlash -= dt;
    if (pendingSlash <= 0) {
      const kill = slash(player.pos, forwardVec(), 3.4);
      if (kill) {
        chime(880, 0.5, 0.22);
        shake = Math.min(1, shake + 0.25);
        if (kill.killed === 'squid') showMsg('THE SHOAL SCATTERS — IT DROPPED SOMETHING', 3);
      }
    }
  }

  // wrecks + relic tools
  updateVents(dt, t);
  updateVentLife(dt, t);
  updateWrecks(dt, t);
  const tev = updateTools(dt, t, player);
  if (tev.spearKill) {
    chime(880, 0.5, 0.22);
    showMsg('THE SPEAR FINDS ITS MARK', 2.5);
  }
  if (tev.spearRecovered) {
    survival.spears += tev.spearRecovered;
    chime(494, 0.5, 0.16);
  }
  // The bottle repressurises off the hose, so outrunning the line costs you the relic
  // too: a quarter-rate refill when the pump is dry or the line is taut.
  if (survival.hasThruster) {
    survival.thrustCharge = Math.min(1,
      survival.thrustCharge + dt / (BURST_RECHARGE * (survival.supplied ? 1 : 4)));
    if (survival.thrustCharge >= 1 && !wasCharged) bottleReady();
    wasCharged = survival.thrustCharge >= 1;
  }

  // predators: hunting behavior, strikes and light-stealing
  const pev = updatePredators(dt, t, player, lanternPos);
  if (pev.inkPickup) {
    survival.ink += pev.inkPickup;
    chime(740, 0.8, 0.18);
    if (msgT <= 0) showMsg('INK SAC — [Q] VENTS IT AT A HUNTER', 3.5);
  }
  if (pev.bite) {
    survival.oxygen = Math.max(0.04, survival.oxygen - 0.10 * pev.bite);
    shake = Math.min(1, shake + 0.5);
    slam();
    kickLantern(1.2);
    lightDip = 1;
    // A torn dress is the stake: the tenders cannot out-pump the hole, so for the next
    // TORN_SEC the line refills at half rate and 'AIR IS LEAKING' is true.
    if (tearDress()) showMsg('AIR IS LEAKING — THE DRESS IS TORN', 4);
    else if (msgT <= 0) showMsg('SOMETHING STRUCK YOU', 3);
  }
  if (pev.lightSteal) player.light = Math.max(0, player.light - pev.lightSteal * dt);

  let dread = 0;
  if (lev) {
    let near = Infinity;
    for (const s of lev.spine) { const d = s.distanceTo(player.pos); if (d < near) near = d; }
    dread = clamp(1 - near / (lev.size * 9), 0, 1);
  }
  setProximity(Math.max(dread, pev.threat));
  // Debris reacts to the diver's push and the leviathan's sweep.
  updatePhysics(dt, player.pos, player.vel, lev ? lev.spine : null);

  updateDiver(dt, t, player);
  // Bootfall audio, sand puff and boot print all key off the rig's real heel strikes
  // (counted inside updateDiver), so they land on the same frame the weight drops.
  const sc = stepCount();
  if (sc !== lastStepPhase) {
    lastStepPhase = sc;
    footstep();
    // The eye feels the footfall on planks: a few centimetres of dip, fast recovery.
    if (player.onDeck && FEEL.on) camStepDip = 1;
    // Silt and boot prints are SEABED effects. On the raft's planking they read as Sal
    // kicking up sand in mid-air and stamping footprints into timber, so the deck gets
    // the sound and nothing else.
    if (!player.onDeck) spawnFootfall(player.pos, player.yaw, sc % 2 === 0 ? 1 : -1, zone < 0 ? 0 : zone, 1);
  }
  // Landing after a drop kicks up a bigger cloud under both boots.
  // Terminal sink is 5.1 u/s vented (10.2 with the exhaust held open), not the 18 u/s
  // of the old point-and-hold dive, so the old >3 gate almost never fired.
  if (player.grounded && !wasGrounded && landVel > 1.8 && !player.onDeck) {
    const zi = zone < 0 ? 0 : zone;
    const p = Math.min(2.2, landVel * 0.42);
    spawnFootfall(player.pos, player.yaw, 1, zi, p);
    spawnFootfall(player.pos, player.yaw, -1, zi, p);
  }
  wasGrounded = player.grounded;
  landVel = player.grounded ? 0 : Math.max(landVel * 0.98, -player.vel.y);
  lanternWorldPos(lanternPos);
  lanternLight.position.copy(lanternPos);
  setLanternPos(lanternPos);   // dust catches the lantern's warmth
  setToolsLanternPos(lanternPos);
  // A hit reads as a hit in the light too: the meter dips by up to 45% and recovers over
  // ~3 s (an envelope over the stored value, so it is never a second oxygen penalty),
  // and the lantern gutters for 1.2 s on top of its everyday flicker.
  lightDip = Math.max(0, lightDip - dt / 3);
  lightK = player.light * (1 - 0.45 * lightDip);
  lanternLight.intensity = (9 + 3.5 * Math.sin(t * 9) + 1.5 * Math.sin(t * 23)) * lightK * lanternGutter(dt, t);
  playerLightSrc.position.copy(player.pos);
  playerLightSrc.intensity = 8 + 40 * lightK;

  // Keyed on the CAMERA's height, not the player's: the water column is stratified, so
  // what the eye is sitting in decides the optics. updateCamera runs below, so this reads
  // last frame's position — half a unit at full swim speed, against a 24-unit scale height.
  updateAtmosphere(depth01, camera.position.y);
  updateLighting(depth01);

  updateCamera(dt, t, fwd);

  // wayfinding: raft always, the sleeper until calmed, the rift once open
  setBearing($bm.raft, raft.position.x, raft.position.y, raft.position.z, true);
  setBearing($bm.lev, lev ? lev.head.x : 0, lev ? lev.head.y : 0, lev ? lev.head.z : 0, !!(lev && !lev.calmed));
  const rp = zone >= 0 ? riftPos(zone) : null;
  setBearing($bm.rift, rp ? rp.x : 0, rp ? terrainH(rp.x, rp.z, zone) : 0, rp ? rp.z : 0, !!(rp && lev && lev.calmed));
  // the active target carries the bright tick: the sleeper until it stills, then the rift
  $bm.lev.classList.toggle('active', !!(lev && !lev.calmed));
  $bm.rift.classList.toggle('active', !!(rp && lev && lev.calmed));
  // low-air vignette breathes in once the tank drops below a third
  $warn.style.opacity = survival.oxygen < 0.33 ? (0.33 - survival.oxygen) / 0.33 : 0;

  $trimfill.style.transform = `scaleX(${player.fill})`;
  $bottlebar.classList.toggle('hidden', !survival.hasThruster);
  $bottlefill.style.transform = `scaleX(${survival.thrustCharge})`;
  $lightfill.style.transform = `scaleX(${lightK})`;
  $o2fill.style.transform = `scaleX(${survival.oxygen})`;
  $fuelfill.style.transform = `scaleX(${survival.fuel})`;
  $o2fill.classList.toggle('critical', survival.oxygen < 0.3);
  // the torn dress bleeds on the bar: a red bead rides the fill's leading edge
  $o2bar.classList.toggle('torn', survival.torn > 0);
  if (survival.torn > 0) $o2leak.style.left = (survival.oxygen * 100).toFixed(1) + '%';
  // Charted metres, ×3 like the depth readout. The raw values are world units, and
  // printing them unconverted put "306 / 380 m of line" next to "690 m" of depth in the
  // same frame — the HUD contradicting itself threefold on the one number that is
  // supposed to tell you how far you can go.
  $hose.textContent = `${Math.floor(distFromRaft * 3)} / ${Math.floor(survival.hose * 3)} m of line`;
  $hose.classList.toggle('taut', survival.tautness > 0.92);
  $mats.textContent = `polymer ${survival.polymer}  ·  bitumen ${survival.bitumen}`
    + (survival.ink > 0 ? `  ·  ink ${survival.ink}` : '')
    + (survival.hasSpear ? `  ·  spears ${survival.spears}` : '');
  // A gauge reads depth, not altitude. Standing on the deck this printed "-7 m", which is
  // a diving gauge claiming he is seven metres into the sky; on the surface it reads the
  // deck, which is what a tender would call it.
  $depth.textContent = player.pos.y >= SURFACE_Y
    ? 'ON DECK'
    : Math.floor(-player.pos.y * 3) + ' m';
  if (state === 'won') winT += dt;
}

// requestAnimationFrame is scheduled first so a throw can't stop the loop — but that
// also means a broken frame fails silently forever. Surface it once, loudly, instead.
let loopFailed = false;
// Boot loader. #load is painted by the browser before this module even evaluates (ES
// modules are deferred), so it covers the whole world build. What it also covers, and
// the reason it exists, is the SHADER PRECOMPILE: three compiles lazily on first render,
// so ~75 programs used to compile during the opening seconds of play. That cost the
// player twice — visible hitches, and a perf sampler that graded the warmup and silently
// dropped volumetrics, AO and shadows for the whole session on hardware that then ran at
// a steady 60. Two settled frames after the compile, uncover the title.
let bootFrames = 0;
function boot() {
  if (bootFrames === 0) {
    const n = warmUp();
    console.info(`ABYSSA: ${n} shader programs precompiled`);
  }
  if (++bootFrames < 3) return false;
  const el = document.getElementById('load');
  if (el && !el.classList.contains('done')) {
    el.classList.add('done');
    setTimeout(() => el.remove(), 1100);   // it is z-index 2 over the title; do not leave it
  }
  return true;
}

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta()), t = clock.elapsedTime;
  try {
    update(dt, t);
    // The sea's transmission target: a clip-plane render of the far side of the
    // interface. Runs after update (needs the frame's surface height and camera) and
    // before the composer, so the surface shader samples this frame, not the last one.
    renderRefraction();
    render(dt);
    boot();
    samplePerf(dt, state === 'play' || state === 'won');
  } catch (e) {
    if (!loopFailed) {
      loopFailed = true;
      console.error('ABYSSA: frame loop threw — the game is frozen from here.', e);
    }
  }
}
frame();

// DEV: the weather/light lab. One guard, dynamic import — a normal load never fetches it.
if (location.search.includes('lab')) import('./ui/lab.js').catch(e => console.warn('lab: ' + e));
