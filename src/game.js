// Game state machine, camera, HUD, and the frame loop. Owned by the orchestrator.
import * as THREE from 'three';
import { scene, camera, clock, renderer, flushSize } from './core.js';
import { ZONE_GAP, SURFACE_Y, RIFT_R, zoneTop, zoneBottom, riftPos, LEVIATHAN_CFG, GLASS } from './config.js';
import { V3, rng, clamp } from './lib/math.js';
import { render, samplePerf, frameStart, gpuFrameBegin, gpuFrameEnd, warmUp, warmUpAsync, setPostBypass, getPostBypass, getVolumetrics, setChromaReduced, resetTemporal, addTemporalMover } from './postfx.js';
import { lanternLight, playerLightSrc, updateLighting, setWeatherLight, kickLantern, lanternGutter, setSiteLight } from './lighting.js';
import { buildTerrain, updateTerrain, terrainH, fillTerrain, updateZoneSight } from './world/terrain.js';
import { buildFlora, updateFlora, rockColliders, reseedFlora } from './world/flora.js';
import { stirPulse, P_SLAM } from './world/stir.js';
import { buildWater, updateWater, updateAtmosphere, syncLamps, setLampOccluders, setWeatherWater, setWeatherEnv, setWeatherHand, setRayDim, localSurfaceY, renderRefraction, windState, setSiteWater } from './world/water.js';
import { buildCreatures, updateCreatures, reseedCreatures, schools, jellies } from './world/creatures.js';
import { buildRifts, updateRifts, seedMotes, updateMotes, reseatRifts } from './world/rifts.js';
import { makeLeviathan, disposeLeviathan, updateLeviathan, BODY_R_MAX, sleeperFingerprint } from './entities/leviathan.js';
import { diver, updateDiver, lanternWorldPos, diverOccluders, stepCount, lastFootfall, triggerSlash, breathPhase, breathCount, breathStress, diverImpulse, diverGrab, diverLookAt, diverYank } from './entities/diver.js';
import './entities/helmetSwap.js';   // mounts the authored helmet if the glb is present
import {
  player, updatePlayer, requestLock, locked, forwardVec, rightVec, keys, clearKeys,
  setStormCurrent, setWindCurrentVec, resetSuit, BURST_DUR, NEUTRAL_FILL
} from './player.js';
import {
  initAudio, chime, growl, setDepth, setProximity, setLight, setAir,
  setSpeed, setWalking, footstep, setZone, slam, setCalm, airVent, bottleReady, setPump,
  syncBreath, voyage, nib, setAbove, setWind, setMaster,
  audioFrame, audioSleeper, setPaused, sonar, knife, knifeHit, land, hoseYank
} from './audio.js';
import {
  survival, updateSurvival, canCraftHose, craftHose, canCraftFuel, craftFuel,
  resupplyAtRaft, canDescendTo, HOSE_REQ, HOSE_START, HOSE_MAX, tearDress, o2RefillRate, SPUTTER_SEC
} from './systems/survival.js';
import { buildRaft, updateRaft, nearRaft, pumpPos, raft, setSwell, pumpSpeed, chartAnchor, setKeepsakes } from './systems/raft.js';
import { buildTether, updateTether, reseatTether, leash } from './systems/tether.js';
import { camBlockedLocal, camBlockWhy } from './systems/raft/colliders.js';
import { buildResources, updateResources, reseedResources } from './world/resources.js';
import { initPhysics, updatePhysics, switchZone as physicsSwitchZone } from './systems/physics.js';
import { buildProps, updateProps, propColliders, reseedProps } from './world/props.js';
import { buildFootFX, spawnFootfall, updateFootFX, setLanternPos } from './world/footfx.js';
import { buildPredators, switchPredatorZone, updatePredators, slash, deployInk, reseedDens } from './world/predators.js';
import { buildWrecks, updateWrecks, wreckColliders, nearRelic, takeRelic, reseedWrecks, setKeepsakeState, nearKeepsake, takeKeepsake } from './world/wrecks.js';
import { buildVents, updateVents, ventColliders, reseedVents } from './world/vents.js';
import { buildClouds, updateClouds, setCloudWeather, setPuffsVisible } from './world/clouds.js';
import { buildSky, updateSky, renderSky, setSkyWeather, volSkyOn } from './world/sky.js';
import { buildRain, updateRain, setRainWeather } from './world/rain.js';
import { buildLightning, updateLightning, setBoltRibbons } from './world/lightning.js';
import { buildVentLife, updateVentLife, reseedVentLife } from './world/ventlife.js';
import { buildGardens, updateGardens, reseedGardens } from './world/gardens.js';
import { updateAbyss } from './world/abyss.js';
import { buildFauna, updateFauna, reseedFauna } from './world/fauna.js';   // FAUNA PATCH
import { initTools, updateTools, sonarPing, fireSpear, fireThruster, setToolsLanternPos } from './systems/tools.js';
import { initWeather, updateWeather } from './systems/weather.js';
import { startEnding, updateEnding } from './ending.js';
import { setSite, currentSite, currentSiteIndex, siteAt } from './world/site.js';
import { openChart, closeChart, isChartOpen } from './ui/chartOverlay.js';
import { startPassage, updatePassage, setPassageSound, PT as PASSAGE_T, PEV_RESEED, PEV_BELL, PEV_DONE } from './ui/passage.js';
// dev look-dev hooks are live only under ?lab (the lab's own flag)
const DEV_CAMPIN = typeof location !== 'undefined' && location.search.includes('lab');

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
let muteSaved = false;
// A save is UNTRUSTED input: hand-edited, torn, or written by an older build. Every
// field is coerced to its shape and clamped to its range; nothing in it can put the
// sim in a state the game itself could not reach.
const grid43 = v => Array.from({ length: 4 }, (_, i) =>
  Array.from({ length: 3 }, (_, j) => (Array.isArray(v) && Array.isArray(v[i]) && v[i][j]) ? 1 : 0));
(() => { try {
  const sv = JSON.parse(localStorage.getItem(SAVE_KEY));
  if (!sv || typeof sv !== 'object') return;
  if (Array.isArray(sv.rec)) chartRec = grid43(sv.rec);
  if (Array.isArray(sv.found)) chartFound = [1, 1, 1, sv.found[3] ? 1 : 0];   // authored sites always start found
  if (Array.isArray(sv.keeps)) keepsakes = grid43(sv.keeps).map(r => Array.isArray(r) ? r : [0, 0, 0]);
  endingSeen = !!sv.endingSeen;
  muteSaved = !!sv.mute;
  if (sv.site) setSite(sv.site);
  // A NaN, a string, a negative or a hose longer than the reel can hold all read as
  // 'the line he started with' or 'the most line there is'; never as a broken number.
  survival.hose = clamp(+sv.hose || HOSE_START, HOSE_START, HOSE_MAX);
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
    endingSeen, hose: survival.hose, mute: muteSaved,
    tools: { sonar: !!survival.hasSonar, spear: !!survival.hasSpear, thruster: !!survival.hasThruster }
  }));
} catch (e) { /* private mode etc: play on, remember nothing */ } }
// A tab closed mid-dive keeps its crafts: pagehide is the last reliable beat on every browser.
addEventListener('pagehide', saveChart);

// ---- BOOT GUARD --------------------------------------------------------------------
// Anything that throws before the loader lifts would otherwise leave 'raising the pump'
// pulsing forever. Say what happened, in the game's own voice, on the loader itself.
let booted = false;
function bootFail(e) {
  if (booted) return;
  const el = document.getElementById('load');
  if (!el) return;
  const p = el.querySelector('p');
  if (p) { p.textContent = 'THE PUMP WILL NOT START — RELOAD'; p.style.animation = 'none'; p.style.opacity = '.85'; }
  console.error('ABYSSA: boot failed', e);
}
addEventListener('error', ev => bootFail(ev.error || ev.message));
addEventListener('unhandledrejection', ev => bootFail(ev.reason));

// ---- REDUCED MOTION ---------------------------------------------------------------
// The OS setting, plus window.__rm for probes. Read every frame so a live toggle takes.
const RMQ = matchMedia('(prefers-reduced-motion: reduce)');
function reducedMotion() { return RMQ.matches || !!window.__rm; }
let rmWas = null;

performance.mark('abyssa:world-build-start');

// ---- build the world ----
buildTerrain();
buildFlora();
buildWater();
// OWN WATER: the anchorage's water and light (uniform + CPU rows; null at home = shipped).
// The saved site is already set (loadChart runs before the world builds).
setSiteWater(currentSite().water || null);
setSiteLight(currentSite().light || null);
buildClouds();   // instanced puff clusters in the air; must follow buildWater (palette + wind)
buildSky();      // VOLUMETRIC SKY: noise volumes on the GPU, atmosphere LUT, cloud march targets
buildRain();     // one instanced draw call of wind-slanted rain streaks, air side only
buildLightning();   // bolt channels (one instanced draw) + the two-slot bolt light in the fog chunk
buildCreatures();
buildRifts();
buildRaft();
// TAA: Sal and the raft are rigid hierarchies -- exact motion vectors for both.
addTemporalMover(diver); addTemporalMover(raft);
// Deck spawn (deckSpawn below): raft-local, and his heading — toward the boarding gap.
const DECK_SPAWN_X = 2.6, DECK_SPAWN_Z = 0;
export const DECK_SPAWN_YAW = Math.PI / 2;
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
buildGardens();   // after flora (reef anchors = its rock colliders) and vents (activeVents)
buildFauna();   // FAUNA PATCH: after creatures AND after vents (isopods/vent fish anchor on activeVents, moray/crabs on flora's rockColliders)
initTools();
initWeather();
performance.mark('abyssa:world-build-end');
{
  const m = performance.measure('abyssa:world-build', 'abyssa:world-build-start', 'abyssa:world-build-end');
  console.info(`ABYSSA: world built in ${m.duration.toFixed(0)} ms`);
}

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
let threatSaid = false;
// The rescue tops the pump up from the reserve can — enough to reach zone 0's bitumen
// and back; half a tank is ~3.5 min at FUEL_BURN. (Was 0.3: two minutes, and the
// bitumen 200 m down — an unwinnable state by arithmetic.)
const FUEL_RESCUE = 0.5;
const _burst = V3();
let sputterT = 0, sputterCd = 12;       // storm-peak pump sputter scheduler
let lev = null, zone = -1;
const lanternPos = V3();
let lightDip = 0, lightK = 1, slamWas = false, inkBlind = 0;   // inkBlind: Orune's ink smothering the lantern   // hit feedback on the light (see the lantern block)
// THE PAUSE. There is no pause menu: losing the pointer lock IS the pause. While he has
// no helm the man, his air and the hunters all stand still; the sea, the raft and the
// camera keep breathing so it never reads as a freeze. Same on window blur.
let paused = false, pauseT = 0, blurred = false;
let lanternHeld = false;   // predators.js STATE: the octopus has the lantern (see the snatch)
const PEV_IDLE = { threat: 0, bite: 0, lightSteal: 0, inkPickup: 0, lanternStolen: false, msg: null };

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
const $threat = document.getElementById('threat');
const $pause = document.getElementById('pause');
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
// same panic gesture, and keeping the swim boost (x2.2 since the weighted-suit pass) preserves
// the marginal escape from a striking shark (predators.js strikeSpeed 22 against a ~24-26 u/s haul).
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
  // The chart owns the keyboard while it is up (chartOverlay.js captures Escape and the
  // site keys); nothing below may fire under the paper.
  if (isChartOpen()) return;
  // Diagnostic: P bypasses the whole post chain so an on-screen artifact can be
  // attributed to either the scene or a pass, live, without a rebuild.
  if (e.code === 'KeyP') {
    setPostBypass(!getPostBypass());
    showMsg(getPostBypass() ? 'POST PROCESSING BYPASSED (P TO RESTORE)' : 'POST PROCESSING ON', 3);
    return;
  }
  // M: the one volume control. Persisted, so a muted dive stays muted next session.
  if (e.code === 'KeyM' && !e.repeat) {
    muteSaved = !muteSaved;
    setMaster(muteSaved ? 0 : MASTER_VOL);
    saveChart();
    if (state === 'play') showMsg(muteSaved ? 'SOUND OFF' : 'SOUND ON', 1.5, 0);
    return;
  }
  // Held keys must not repeat a verb: a held E would take, craft and consult in one press.
  if (e.repeat) return;
  if (paused && state === 'play') return;   // no helm, no verbs
  if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight') && state === 'play'
      && survival.hasThruster) { tryBurst(); return; }
  // Q vents a carried ink sac: a dark cloud that breaks a hunting shark's charge.
  if (e.code === 'KeyQ' && state === 'play' && survival.ink > 0) {
    if (deployInk(player.pos)) {
      survival.ink--;
      player.inkAt = performance.now();   // the Hunter reads it: ink in his line breaks a strike
      chime(196, 1.2, 0.2, 'pickup');
      showMsg('INK VENTED', 2);
    }
    return;
  }
  // T: sonar pulse (once the set is recovered from the shallows wreck)
  if (e.code === 'KeyT' && state === 'play' && survival.hasSonar) {
    if (sonarPing(player.pos, zone < 0 ? 0 : zone)) {
      sonar();   // the sounding set: a ping and the dark's answers (audio places the echoes)
      // THE DEEP SOUND CHANNEL: a ping from zone 2 carries far enough to sound
      // ground the chart's owner never reached. Once, ever, per hidden anchorage.
      if (zone === 2 && !chartFound[3]) {
        chartFound[3] = 1;
        saveChart();
        showMsg('A FAR RETURN. NEW GROUND — THE PENCIL TAKES IT.', 6);
        chime(587, 3.5, 0.12, 'voyage');
      }
    }
    return;
  }
  // E near a wreck's relic: take the tool
  if (e.code === 'KeyE' && state === 'play' && lev && lev.rite) {
    // THE RITE'S TRIGGER (the Brooder's eggs, the Hoarder's lamp): the sleeper's own
    // object decides what [E] does here, and hands back the line to show
    const r = lev.rite.interact(player.pos);
    if (r) {
      if (r.took) chime(740, 2.2, 0.2, 'pickup');
      else if (r.returned) chime(494, 2.4, 0.2, 'ward');
      if (r.lamp) player.hasLamp = true;
      if (r.msg) showMsg(r.msg, 3);
      return;
    }
  }
  if (e.code === 'KeyE' && state === 'play') {
    // keepsakes first: at remote sites the relic berth is long empty — what is
    // left is the previous owner's small thing, and one line of them.
    const kp = nearKeepsake(player.pos);
    if (kp) {
      const got = takeKeepsake(kp.zi);
      if (got) {
        // A mark is READ, not taken: nothing goes to the shelf, nothing is saved.
        if (!got.mark) {
          keepsakes[currentSiteIndex()][kp.zi] = 1;
          setKeepsakes(keepsakes);
          saveChart();
        }
        if (got.line) showMsg(got.line, 6);
        chime(659, 2.5, 0.22, 'pickup');
        return;
      }
    }
    const rel = nearRelic(player.pos);
    if (rel) {
      const tool = takeRelic(rel.zi);
      if (tool === 'sonar') { survival.hasSonar = true; showMsg('A SOUNDING SET — [T] LISTENS TO THE DARK', 5); }
      else if (tool === 'spear') { survival.hasSpear = true; survival.spears = 3; showMsg('A SPEAR GUN — RIGHT CLICK. SPEARS CAN BE RECOVERED.', 5); }
      else if (tool === 'thruster') { survival.hasThruster = true; showMsg('AN AIR THRUSTER — TAP SHIFT TO CRACK THE BOTTLE. ONE SHOVE, AND IT COSTS AIR.', 6); }
      if (tool) { chime(659, 2.5, 0.28, 'craft'); chime(880, 2.5, 0.2, 'craft'); saveChart(); return; }
    }
  }
  if (state !== 'play' || !nearRaft(player.pos)) return;
  if (e.code === 'KeyE' && nearChartTable()) { consultChart(); return; }
  if (e.code === 'KeyE' && craftHose()) { chime(523, 1.4, 0.22, 'craft'); showMsg('HOSE EXTENDED', 2); saveChart(); }
  if (e.code === 'KeyF' && craftFuel()) { chime(392, 1.4, 0.22, 'craft'); showMsg('PUMP REFUELLED', 2); saveChart(); }
});
addEventListener('contextmenu', e => { if (locked) e.preventDefault(); });

// Left-click while locked: knife slash. The anim gates repeats; the hit lands on the
// contact frame via pendingSlash so the blade connects when it visually connects.
let pendingSlash = 0;
const lampOcc = new Float32Array(8);   // diverOccluders -> setLampOccluders, every frame
function doSlash() { if (triggerSlash()) { pendingSlash = 0.22; knife(); } }   // contact ~0.22s into the swing
function doSpear() {
  if (!survival.hasSpear) return;
  if (survival.spears > 0 && fireSpear(player.pos, forwardVec())) {
    survival.spears--;
    chime(330, 0.3, 0.24, 'pickup');
  } else if (survival.spears === 0 && msgT <= 0) {
    showMsg('NO SPEARS — FIND THE ONES YOU THREW', 2.5);
  }
}
addEventListener('mousedown', e => {
  if (state !== 'play' || !locked || paused) return;
  if (e.button === 0) doSlash();
  if (e.button === 2) doSpear();
});

// ---- THE MESSAGE LINE --------------------------------------------------------------
// One line on screen, one waiting. A message of lower or equal priority than the live
// one WAITS for it (so 'SHE MAKES FOR...' is never clobbered by the arrival's sleeper
// name); a higher one cuts in. The waiting slot keeps the more important of any two.
// prio 0: names and colour. prio 1 (default): everything the player must read.
let msgPrio = 0, msgPend = null;
function showMsg(text, dur = 4, prio = 1) {
  if (msgT > 0 && msgPrio >= prio) {
    if (!msgPend || prio >= msgPend.prio) msgPend = { text, dur, prio };
    return;
  }
  $msg.textContent = text;
  $msg.classList.add('on');
  msgT = dur; msgPrio = prio;
}
// Probe surface: what is live, what waits.
window.__msg = () => ({ live: $msg.textContent, t: +msgT.toFixed(2), prio: msgPrio, pend: msgPend && msgPend.text });

// Remote anchorages carry hand-authored sleeper rows: more wards, a hue nudge, an
// epithet in the previous chart-owner's ink. Home passes undefined and is untouched.
// `extra` merges last (the lab uses it to ask for a different kind).
//
// RITUAL, REMEMBERED (roadmap/sleepers-persist-decision.md, Michael 2026-10-04): a sleeper
// the chart's pencil already records as stilled (chartRec[site][zone], set on the calming
// frame and saved with the chart) still wakes to her rite, but boots `remembered`: one
// ward dim-lit and counted, one fewer touch (sleeper/common.js rememberWard). Read at
// every build, so it holds across a voyage there and back, a reload, and a zone re-entry;
// the visit that does the calming is not affected (she is already built). The flag is
// only added when true, so a never-calmed sleeper builds from exactly the config it did.
// memForce (dev, __lev.remember) overrides the chart; null = the chart decides.
let memForce = null;
const calmedBefore = i => memForce !== null ? memForce : !!chartRec[currentSiteIndex()][i];
function makeZoneSleeper(i, extra) {
  const row = currentSite().sleepers && currentSite().sleepers[i];
  // idle / lair / hard (OWN WATER, roadmap/fly-remote-sites.md) were dead data until
  // 2026-10-04: the row's idle depth, its lair bearing and its behaviour numbers now reach
  // the kind (brooder/hoarder/hunter read c.idle / c.lair / c.hard; absent = shipped).
  let over = row ? {
    nSigils: row.sigils,
    hue: (LEVIATHAN_CFG[i].hue + row.hueShift + 1) % 1,
    name: currentSite().epithet ? currentSite().epithet[i] : LEVIATHAN_CFG[i].name,
    idle: row.idle || null, lair: row.lair || null, hard: row.hard || null
  } : undefined;
  if (calmedBefore(i)) over = Object.assign({}, over, { remembered: true });
  return makeLeviathan(i, extra ? Object.assign({}, over, extra) : over);
}
// The remembered wake's one line ('SHE KNOWS YOUR HAND. ONE WARD STILL REMEMBERS.', per
// kind: lev.memLine), said once per sleeper per session, in the first silence after her
// name (it waits like the other onboarding beats, so it never clobbers the queue).
// (marked said when it SHOWS: a wake that leaves the zone before a silence keeps it owed)
const memSaid = new Uint8Array(12);
let memPending = null, memKey = 0;

function enterZone(i) {
  disposeLeviathan(lev);
  zone = i;
  setZone(i);            // must precede growl() so the voice is tuned to the zone
  lev = makeZoneSleeper(i);
  memPending = null;
  seedMotes(i);
  physicsSwitchZone(i);  // no-op until the WASM world is up
  switchPredatorZone(i);
  setCalm(0);
  // colour, not instruction: it waits behind anything that matters. A dormant sleeper
  // (the Brooder asleep as a ridge) is not announced — her name is the reveal.
  if (!lev.dormant) { showMsg(lev.name, 4, 0); growl(); }
  pendingWards = i > 0;
  riftShutSaid = false;
  // The bowl's rim, for the rift-shut beat: the collar crest sits at 0.84 of the funnel
  // radius, so sample the height there on four bearings and keep the mean.
  const rp = riftPos(i), rr = RIFT_R * 2.7 * 0.84;
  riftRimY = (terrainH(rp.x + rr, rp.z, i) + terrainH(rp.x - rr, rp.z, i)
    + terrainH(rp.x, rp.z + rr, i) + terrainH(rp.x, rp.z - rr, i)) * 0.25;
}

// Sleeper probe (roadmap/three-sleepers.md). fp(i): the split's regression hash for zone
// i's home sleeper. swap(kind): rebuild the live zone's sleeper as another kind — a
// placeable kind is set down 45 u ahead of the diver, facing him. cmd: the kind's own
// lab verbs (brooder: stand / settle / walk / rear / place). Dev only; nothing calls it.
window.__lev = {
  fp(i = Math.max(0, zone)) {
    disposeLeviathan(lev); lev = null;
    let out;
    try { out = sleeperFingerprint(i, { kind: 'serpent' }); }   // the serpent's regression anchor
    finally { if (zone >= 0) lev = makeZoneSleeper(zone); }
    return out;
  },
  swap(kind) {
    if (zone < 0) return null;
    disposeLeviathan(lev);
    lev = makeZoneSleeper(zone, kind ? { kind } : undefined);
    if (lev.cmd) {
      const f = forwardVec(), fx = f.x, fz = f.z, fl = Math.hypot(fx, fz) || 1;
      const pos = player.pos.clone();
      pos.x += fx / fl * 45; pos.z += fz / fl * 45;
      lev.cmd('place', { pos, yaw: Math.atan2(-fx, -fz) });
    }
    return lev.kind;
  },
  // remember(on): rebuild the live zone's sleeper as if the chart did (true) or did not
  // (false) record her stilled; the force holds for every later build until remember(null)
  // hands the call back to the chart. The save is never touched.
  remember(on = true) {
    memForce = on === null ? null : !!on;
    if (zone < 0) return null;
    disposeLeviathan(lev);
    lev = makeZoneSleeper(zone);
    memPending = null;
    return lev.probe ? lev.probe() : { kind: lev.kind, remembered: !!lev.remembered };
  },
  cmd(name, arg) { return lev && lev.cmd ? lev.cmd(name, arg) : null; },
  state() { return lev ? (lev.probe ? lev.probe() : { kind: lev.kind, calmed: lev.calmed }) : null; },
  me() { return player.pos.clone(); }
};
// THE RIFT IS SHUT WHILE IT WAKES: a diver who drops into the bowl before the sleeper
// stills falls into an unmarked hole in the dark. Said once per zone, 20u below the rim.
let riftShutSaid = false, riftRimY = 0;

// Where a dressed diver waits before a dive: on the deck at the inboard end of the walk
// to the boarding gap, facing out over the water he is about to step into. The gap is on
// the +X rail since 2026-10-02 (Michael: "move the ladder to the left side. The air
// hose rig is in the way"), so he faces +X; the gallows stands forward of the gap, on
// his right, instead of over it. Clear of the pump block (x <= 1.6) by a stride.
export function deckSpawn(out) {
  return out.set(raft.position.x + DECK_SPAWN_X, raft.position.y + 0.11 + 1.35, raft.position.z + DECK_SPAWN_Z);
}
// The play camera's rest spot behind a man standing at the spawn heading (game.js cuts
// to it on start, voyage arrival and rescue rather than letting the spring travel).
// `onDeck` picks the boom: every deck spawn passes true (player.onDeck is last frame's
// and may still say "in the water" after a rescue), the bench's seabed spots false.
function snapCamBehind(onDeck) {
  deckK = onDeck && DECKCAM.on ? 1 : 0; deckKV = 0;
  const back = boomBack(), sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
  camera.position.set(player.pos.x - sy * back, player.pos.y + boomUp(), player.pos.z - cy * back);
  camDist = back; camDistV = 0; camBasePrev = back;
}

export function start() {
  if (state !== 'title') return;
  state = 'play';
  // He begins the dive standing on the raft, not already in the water. The whole point
  // of the surface round: you see the sea before you are under it.
  deckSpawn(player.pos);
  player.vel.set(0, 0, 0);
  player.yaw = DECK_SPAWN_YAW;     // facing the boarding gap, out across the water
  player.pitch = -0.05;
  resetSuit(player.pos.y);
  reseatTether(player);
  // Snap the camera from the title portrait (in front of Sal) straight to the
  // play position behind him — letting the spring travel there would drag the
  // lens through his body.
  snapCamBehind(true);
  camVel.set(0, 0, 0);
  camLook.set(player.pos.x + Math.sin(player.yaw) * 6, player.pos.y + DECKCAM.look * deckK, player.pos.z + Math.cos(player.yaw) * 6);
  document.getElementById('title').classList.add('hidden');
  $hud.classList.remove('hidden');
  initAudio();
  enterZone(0);
  // Async WASM load; the module degrades to no-ops if the CDN fails, so no await.
  initPhysics(0);
  // Lock is requested by the window click handler below, on this same click. Asking
  // here as well made Chrome reject the duplicate request, so the mouse stayed dead
  // until the player clicked a second time.
  showMsg(wardsLine(), 5, 0);   // same priority as the name, so it follows it instead of cutting it
}

// THE VERB IS SETTLED: wards are LIT, the sleeper STILLS. One sentence says what a ward
// is, where it rides, and what lighting it does — with this zone's real count, since a
// remote anchorage's sleeper can carry more iron than the home one.
const COUNT = ['NO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE'];
function wardsLine() {
  const n = lev ? lev.sigils.length : 3;
  // a dormant sleeper (the Brooder asleep as a ridge) is not described: finding her is the point
  if (lev && lev.dormant) return `SOMETHING SLEEPS ${lev.lairWhere || 'HERE'}, ${COUNT[n] || n} IRON WARDS SET IN IT. FIND IT. LIGHT THEM.`;
  return `${COUNT[n] || n} IRON WARDS RIDE ITS HIDE. LIGHT THEM AND IT STILLS.`;
}
let pendingWards = false;   // zones after the first say their count once the name has faded

document.getElementById('title').addEventListener('click', start);
addEventListener('click', () => {
  if (state !== 'title' && !locked && !isChartOpen()) requestLock();
});
// Stuck keys: a keyup that lands on another window never reaches us. Every way of
// losing the helm drops every key.
addEventListener('blur', () => { blurred = true; clearKeys(); });
addEventListener('focus', () => { blurred = false; });
document.addEventListener('pointerlockchange', () => { if (document.pointerLockElement !== renderer.domElement) clearKeys(); });
// Fullscreen: keep Ctrl+W/S/D/T from closing the tab or opening one while he plays.
// Ctrl remains an unlisted alias for C (vent); the browser only gives these up fullscreen.
document.addEventListener('fullscreenchange', () => {
  const kb = navigator.keyboard;
  if (!kb || !kb.lock) return;
  try {
    if (document.fullscreenElement) kb.lock(['KeyW', 'KeyS', 'KeyD', 'KeyT']).catch(() => {});
    else kb.unlock();
  } catch (e) { /* not supported here */ }
});

// ---- THE LAMP GUTTERS: WebGL context loss --------------------------------------------
// A lost context cannot be recovered in place (every render target, program and
// texture is gone). Say so, and reload on the click or on the restore, whichever first.
renderer.domElement.addEventListener('webglcontextlost', e => {
  e.preventDefault();
  failCard('THE LAMP GUTTERS', 'CLICK TO RELIGHT');
});
renderer.domElement.addEventListener('webglcontextrestored', () => location.reload());
let failEl = null;
function failCard(title, line) {
  if (failEl) return;
  try { if (document.exitPointerLock) document.exitPointerLock(); } catch (e) { /* */ }
  failEl = document.createElement('div');
  failEl.id = 'fail';
  failEl.innerHTML = `<h1>${title}</h1><p>${line}</p>`;
  failEl.addEventListener('click', () => location.reload());
  document.body.appendChild(failEl);
}
// Probes: lose the context on purpose; throw inside the decorative block on purpose.
window.__loseContext = () => { const x = renderer.getContext().getExtension('WEBGL_lose_context'); if (x) x.loseContext(); return !!x; };
window.__breakAmbient = 0;

// ---- THE VOYAGE: weigh anchor, the chart under the lamp, a new sea floor ------------
// THE INKED PASSAGE (Michael, 2026-10-04, roadmap/voyage-fade-timing.md): the sea fades
// as the paper chart comes up and fills the screen; Sal's course inks itself across it
// from this anchorage to the chosen one; the bell rings as the nib touches the mark; the
// chart dissolves into the new water. ui/passage.js owns the sheet and its clock; this
// file owns what happens to the world: the reseed (scheduled by the passage into the
// still beat after the chart is up and before the pen goes down, where its main-thread
// hitch can't be seen), the bell, play.
let voyageTo = 0, voyageDone = false, inkBeat = false;
// Arrival lands on the pause (the chart click released the helm: CLICK TO TAKE THE HELM),
// and a pause suspends the audio. Hold that off a few seconds so the bell the nib rang,
// and the water under the new mooring, ring out before the sea goes quiet.
let voyageRing = 0;
setPassageSound((kind, dur, p0, p1, dry) => nib(kind, dur, p0, p1, dry));

function startVoyage(i) {
  if (state !== 'play' || i === currentSiteIndex() || !siteAt(i)) return;
  clearKeys();
  state = 'voyage';
  voyageTo = i; voyageDone = false;
  startPassage(currentSiteIndex(), i, { currentSite: currentSiteIndex(), calmed: chartRec, found: chartFound });
  voyage(PASSAGE_T.END);                    // the passage, scored: chain, strakes, luff, gull
  showMsg('SHE MAKES FOR ' + siteAt(i).name, 4);
}

// The reseed itself, run once under the opaque chart: a load event, exempt from the
// per-frame allocation rule. ORDER IS CONTRACT — flora excludes around wreckSites(),
// dens are re-picked from flora's fresh colliders.
function reseedWorld(i) {
  resetTemporal('reseed');   // the world changes under a still camera: no history survives it
  setSite(i);
  setSiteWater(currentSite().water || null);   // uniforms only: no program, no material
  setSiteLight(currentSite().light || null);
  fillTerrain();
  reseedWrecks({ sonar: !!survival.hasSonar, spear: !!survival.hasSpear, thruster: !!survival.hasThruster });
  setKeepsakeState(keepsakes[currentSiteIndex()]);
  reseedFlora();
  reseedResources();
  reseedProps();
  reseedVents();
  reseedVentLife();
  reseedGardens();   // after reseedFlora + reseedVents: reads rockColliders and activeVents
  reseatRifts();
  reseedDens();
  reseedCreatures();
  reseedFauna();   // FAUNA PATCH: after creatures, flora and vents — ORDER IS CONTRACT
  enterZone(0);
  inkBeat = false;
  deckSpawn(player.pos);
  player.vel.set(0, 0, 0); player.yaw = DECK_SPAWN_YAW; player.pitch = -0.05;
  resetSuit(player.pos.y);
  reseatTether(player);
  survival.oxygen = 1;
  survival.fuel = Math.max(survival.fuel, 0.3);   // the tender refits while she sails
  snapCamBehind(true);
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
Object.assign(window, { player, start, zoneTop, zoneBottom, terrainH, camera, diver, scene, survival, keys, setState: s => { state = s; } });
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
  chime(523, 3, 0.3, 'ending'); chime(659, 3, 0.2, 'ending'); chime(784, 4, 0.2, 'ending');
  resetSuit(player.pos.y);
  clearKeys();
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
const camUpAxis = V3(0, 1, 0);
let camDist = 9, camDistV = 0, camRoll = 0, camFov = 70, camSpdS = 0;
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
// THE YANK in the lens (tether.js leash): the hose jerks Sal and the frame goes with him
// for a beat — a short, near-dead-beat offset along the pull plus a nod, proportional to
// the snap. Centimetres, not shake: GROUNDED (Michael hates a floaty lens).
const camYank = { x: 0, v: 0 }, camYankDir = V3();
window.__camYank = camYank;   // probe: x = the lens offset along the pull, u
const CAM_BACK = 9, CAM_UP = 2.4;
// ---- THE DECK BOOM (roadmap/deck-camera-pullin.md; Michael 2026-10-04: "Closer on deck
// (~6)"). Nine back the lens was always OFF the raft, 9.4 across, so every deck detail was
// read from the water. On the planks the boom shortens and drops a touch; over the side it
// eases back out to the 9 everything below the surface was tuned at.
//   deckK  0 = the water boom (CAM_BACK/CAM_UP, untouched), 1 = the deck boom. It rides a
//          critically-damped spring (w 4.7: ~95% in 1.0 s, no overshoot) toward a target
//          the deck state sets: 1 on the planks, 0 in the water, and on the LADDER a
//          ramp over the last of the climb, so the boom is already coming in as his
//          helmet clears the rail and the step aboard never pops. Under the surface the
//          target is 0 and deckK sits at exactly 0: the water camera is byte-for-byte the
//          grounded camera it was (no lag added there).
//   look   the aim point drops this much on deck (chosen by eye, 2026-10-04, against
//          back 6 / up 2.0 / look -0.35 and back 6.5): with the eye-height aim six back,
//          his helmet sat ON the horizon line in the middle of the frame. Aiming 0.8
//          lower tips the lens down ~6 deg: the sea line rises to the upper third, his
//          helmet stands clear below it against open water, and the deck he is walking
//          on (pump, reel, the lashed cargo) fills the lower half where it can be read.
// Occlusion: the deck boom is walked from the top of his helmet (DECK_PIVOT) to the lens
// against the raft's solid gear (colliders.js camBlockedLocal: deck lines as columns, the gallows, jib, lantern and
// the pump's head and stack) in RAFT-LOCAL space, so the test rolls with the hull in a
// storm; the first contact is refined by bisection, so the pull-in is continuous (an
// 8-step quantised answer stair-stepped the boom against the gallows legs).
const DECKCAM = { on: true, back: 6.0, up: 2.1, look: -0.8, w: 4.7, margin: 0.25 };
let deckK = 0, deckKV = 0, camBasePrev = CAM_BACK, deckWant = CAM_BACK, deckStops = 0;
// THE CRANE. Most of what stands on the deck is waist-to-shoulder high (pump block, reel,
// cargo, the receiver at 1.8): with one of those right behind him, pulling the boom in
// along its line found nowhere to stand — the lens ended up at the 2.2 floor INSIDE the
// receiver (measured), and when the hull rolled the line flickered clear/blocked and the
// boom pumped between 2.2 and 6 with the swell. A camera operator would crane UP and
// shoot over it. So when the line is blocked, the boom tries a few lifts and rides a
// critically-damped spring to the lowest one that is clear; it comes back down only when
// the lower line is clear by an extra hand (hysteresis), so the swell can't flick it.
const DECK_LIFTS = [0, 0.9, 1.8, 2.7];
let deckLift = 0, deckLiftV = 0, deckLiftT = 0;
const boomBack = () => CAM_BACK + (DECKCAM.back - CAM_BACK) * deckK;
const boomUp = () => CAM_UP + (DECKCAM.up - CAM_UP) * deckK;
const _raftInv = new THREE.Matrix4(), _one = V3(1, 1, 1), _bp = V3(), _piv = V3();
// the boom's pivot: the top of his helmet, not his eye — a line from the eye clipped
// every waist-high thing a hand behind him; from the bonnet it clears them, which is also
// what the lens needs to see (the helmet and shoulders), and the lens stays on that line.
const DECK_PIVOT = 0.4;
function deckTarget() {
  if (!DECKCAM.on) return 0;
  if (player.onDeck) return 1;
  if (player.onLadder) {
    // the ladder's catch is deck eye height - 0.68 (player.js); ramp over the 1.6 below it
    const top = raft.position.y + 0.11 + 1.35;
    return clamp((player.pos.y - (top - 2.3)) / 1.6, 0, 1);
  }
  return 0;
}
// Fraction (0..1] of the boom from `from` along `boom` that is clear of the raft's gear.
function deckHit(from, boom, f, m) {
  _bp.copy(from).addScaledVector(boom, f).applyMatrix4(_raftInv);
  return camBlockedLocal(_bp.x, _bp.y, _bp.z, m);
}
function deckBoomClear(from, boom, m = DECKCAM.margin) {
  _raftInv.compose(raft.position, raft.quaternion, _one).invert();
  const N = 14;
  // start a little out from his eye: the first 0.6 is inside his own helmet and dress
  const f0 = 0.6 / boom.length();
  for (let i = 1; i <= N; i++) {
    const f = f0 + (1 - f0) * (i / N);
    if (!deckHit(from, boom, f, m)) continue;
    let lo = f0 + (1 - f0) * ((i - 1) / N), hi = f;
    for (let k = 0; k < 5; k++) { const mid = (lo + hi) * 0.5; if (deckHit(from, boom, mid, m)) hi = mid; else lo = mid; }
    return lo;
  }
  return 1;
}
const MASTER_VOL = 0.62;   // audio.js K.MASTER's shipped value; M toggles between it and silence
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
// GROUNDED (Michael, 2026-10-01: "the camera feels floaty underwater"). surgeK 1.35 -> 0:
// the lens no longer breathes in and out with every kick; the stroke's surge is read off
// the world going past a camera that is locked to him, which is what weight looks like.
const FEEL = { on: true, surgeK: 0, stepDip: 0.05, bedDip: 0.035, landK: 0.07, lead: 0.55, leadMax: 1.4 };
// Seabed footfalls and landings reach the lens too (the deck already had its dip): the
// camera reads stepCount() itself so it needs nothing from the frame loop. The landing
// is a sprung sag — the eye drops with the knees and comes back up past level once.
// LOOK-AHEAD: a slow-smoothed horizontal velocity leads the framing, so a walk or a swim
// has room ahead of him in frame instead of being dragged from the centre.
let camStepSeen = -1, camWasGrounded = true, camFallV = 0;
const camLand = { x: 0, v: 0 };
const camLead = V3();
let diverLookCool = 0;
window.__feel = FEEL;
// ---- THE FLOW LEAN: a camera with a point of view (roadmap/flow-lean-style.md, item 6)
// styleK reads GLASS.style: a sub-knob of -1 follows the master flowLean. Local on
// purpose — config.js is shared and every style term reads the dial the same way.
function styleK(name) {
  const st = GLASS.style; if (!st) return 0;
  const v = st[name];
  return clamp(v == null || v < 0 ? st.flowLean : v, 0, 1);
}
// Flow's handheld is LAYERED: Zilbalodis keyed a standstill layer, a walking layer and
// a running layer and mixed them by what the character was doing. Ours: STANDSTILL
// (slow breathing drift), WALKING (heel-strike-coupled sway) and SWIMMING (rolling
// drift on the stroke), each a 4-octave sine noise on position, look AND roll, mixed
// by state with ~0.4 s crossfades. Amplitudes scale with styleK('camera'); at 0 the
// block does nothing and the camera is bit-identical to the shipped one.
// Everything integrates its own phase by dt, so the motion is framerate-independent.
// The deck is Flow's boat: standstill only, no roll — the handheld lives in the water.
// GROUNDED (2026-10-01): Michael found the underwater lens floaty, and measured it was —
// the standstill and swim layers, the stroke roll and the interest drift kept the frame
// wandering and rolling while Sal hung perfectly still. Every CONTINUOUS layer is now
// zero; what remains is driven by real events only: the heel strike (heelRoll/heelX),
// the flinch on a hit. The machinery stays, so the layers can be A/B'd from window.__hh.
const HH = {
  // per-layer scale at styleK = 1: [pos x, y, z (units)], [yaw, pitch, roll (deg)], rate (Hz)
  still: { pos: [0, 0, 0], look: [0, 0, 0], rate: 0.15 },          // was 0.05/0.06/0.03, 0.40/0.30/0.35 deg
  walk:  { pos: [0, 0, 0], look: [0, 0, 0], rate: 0.90, heelRoll: 0.55, heelX: 0.035, heelTau: 0.30 },   // noise was 0.08 u / 0.8 deg
  swim:  { pos: [0, 0, 0], look: [0, 0, 0], rate: 0.22, strokeRoll: 0 },   // was 0.09 u / 0.9 deg roll + 0.45 deg stroke roll
  fade: 0.4,           // layer crossfade, seconds
  interestDeg: 0,      // max look bias toward the nearest living thing (was 3: the lens drifted off him)
  interestTau: 2,      // seconds
  interestR: 45,       // notice things within this many units
  flinchDeg: 2.2,      // roll flinch per unit of shake impulse
  rmK: 0.3,            // reduced motion: every layer at 30%
};
window.__hh = HH;
// probe handles: the dial and the player, so a console harness can drive the layers
HH.style = GLASS.style; HH.player = player; HH.cam = camera; HH.keys = keys;
HH.impulse = (v = 0.5) => { shake = Math.max(shake, v); return shake; };   // probe: a bite-sized hit
// noise: 4 octaves of incommensurate sines with a hashed phase per channel, in [-1, 1]
const HH_OCT = [1, 2.07, 3.91, 7.3], HH_AMP = [1, 0.5, 0.25, 0.125], HH_NORM = 1 / 1.875;
function hhHash(i) { const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return (x - Math.floor(x)) * Math.PI * 2; }
function hhNoise(ph, ch) {
  let v = 0;
  for (let o = 0; o < 4; o++) v += HH_AMP[o] * Math.sin(ph * HH_OCT[o] + hhHash(ch * 4 + o));
  return v * HH_NORM;
}
const hhPh = [0, 0, 0];                 // still / walk / swim phases (radians), dt-integrated
const hhW = [0, 0, 0];                  // mixed layer weights
let hhGate = 0;                         // eases out under the pause, in again after
let hhHeel = 0, hhHeelSign = 1;         // walking heel-strike pulse (0..1), alternating side
let hhFlinch = 0, hhFlinchV = 0;        // roll flinch: a damped spring kicked by shake impulses
let hhShakeWas = 0;
let hhYawB = 0, hhPitchB = 0;           // interest drift bias (radians), toward the nearest life
let hhYawWas = 0, hhPitchWas = 0, hhMouseCool = 0;
const hhOff = V3(), hhTmp = V3();
let hhRoll = 0, hhYaw = 0, hhPitch = 0;  // this frame's look terms (radians), for the probe
window.__hhState = () => ({ k: styleK('camera'), gate: hhGate, w: hhW.slice(), off: [hhOff.x, hhOff.y, hhOff.z],
  yaw: hhYaw, pitch: hhPitch, roll: hhRoll, flinch: hhFlinch, iYaw: hhYawB, iPitch: hhPitchB, heel: hhHeel });

// The nearest living thing in the front hemisphere: fauna groups (instance state
// buffers), boid schools (their centre), jellies, sharks, the sleeper's head when it
// is awake. Returns the squared distance, target in hhTmp; Infinity if nothing.
function hhNearestLife(fwd) {
  const px = player.pos.x, py = player.pos.y, pz = player.pos.z, R2 = HH.interestR * HH.interestR;
  let best = Infinity;
  const consider = (x, y, z) => {
    const dx = x - px, dy = y - py, dz = z - pz, d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= best || d2 > R2 || d2 < 4) return;
    if (dx * fwd.x + dy * fwd.y + dz * fwd.z < 0) return;   // behind the lens
    best = d2; hhTmp.set(x, y, z);
  };
  const F = window.__fauna;
  if (F && F.groups) for (const G of F.groups) {
    if (!G.mesh.visible) continue;
    const st = G.st, n = G.n;
    for (let i = 0; i < n; i++) { const o = i * 10; consider(st[o], st[o + 1], st[o + 2]); }
  }
  const zi = zone < 0 ? 0 : zone;
  for (const S of schools) if (S.zi === zi && S.inst && S.inst.visible) consider(S.center.x, S.center.y, S.center.z);
  for (const J of jellies) if (J.zi === zi) consider(J.pos.x, J.pos.y, J.pos.z);
  const P = window.pred;
  if (P && P.sharks) for (const S of P.sharks) if (S.mesh && S.mesh.visible) consider(S.pos.x, S.pos.y, S.pos.z);
  if (lev && lev.head && !lev.calmed) consider(lev.head.x, lev.head.y, lev.head.z);
  return best;
}
// breath probe: cycle timing + phase, for cadence verification without a stopwatch
window.__breath = () => ({ phase: breathPhase(), count: breathCount(), stress: breathStress() });
let lastBreath = 0;

// Walk the ray from the player out to the ideal camera spot and stop short of the
// seafloor and of any boulder large enough to swallow the camera, so obstacles push
// the camera in instead of clipping through it.
// Per-frame colliders the camera must also respect: the sleeper's body (one sphere per
// spine point, at the body's widest radius) and the raft's hull from below. Reused
// objects, never allocated in the frame.
const dynCols = [];
let dynN = 0;
function dynCol(x, y, z, r) {
  let c = dynCols[dynN];
  if (!c) c = dynCols[dynN] = { x: 0, y: 0, z: 0, r: 0 };
  c.x = x; c.y = y; c.z = z; c.r = r; dynN++;
}
function buildDynCols() {
  dynN = 0;
  if (lev && lev.spine) {
    const r = lev.collR || lev.size * BODY_R_MAX;   // per kind: the brooder's shell spheres are smaller
    for (let i = 0; i < lev.spine.length; i++) { const s = lev.spine[i]; dynCol(s.x, s.y, s.z, r); }
  }
  // the hull only matters from under it: on deck the camera is meant to be over the planks
  if (player.pos.y < localSurfaceY()) dynCol(raft.position.x, raft.position.y, raft.position.z, 5);
}
window.__camCols = () => dynN;
// Dev: the deck boom. knobs live-tune; state() is the boom as of the last frame.
window.__deckcam = {
  knobs: DECKCAM,
  state: () => ({ deckK: +deckK.toFixed(4), target: deckTarget(), base: +boomBack().toFixed(3), up: +boomUp().toFixed(3),
    camDist: +camDist.toFixed(3), deckWant: +deckWant.toFixed(3), onDeck: player.onDeck, onLadder: player.onLadder,
    lens: +camera.position.distanceTo(player.pos).toFixed(3), why: deckWant < boomBack() - 1e-3 ? camBlockWhy : '', stops: deckStops, lift: +deckLift.toFixed(3), liftT: deckLiftT })
};

// Sal's body reacts to what struck him FROM THE SIDE it came from: the nearest of a list
// of points (sharks carry .pos, the sleeper's spine is bare vectors). No allocation.
function hitFrom(list, mag, hasPos) {
  let bx = 0, bz = 0, bd = Infinity;
  if (list) for (let i = 0; i < list.length; i++) {
    const q = hasPos ? list[i].pos : list[i];
    if (!q) continue;
    const dx = q.x - player.pos.x, dz = q.z - player.pos.z, d = dx * dx + dz * dz + (q.y - player.pos.y) ** 2;
    if (d < bd) { bd = d; bx = dx; bz = dz; }
  }
  diverImpulse('hit', bx, bz, mag);
}

function clearCamDistance(from, dir, want, zi) {
  const STEPS = 8, MARGIN = 0.8;
  for (let i = 1; i <= STEPS; i++) {
    const d = want * (i / STEPS);
    const x = from.x + dir.x * d, y = from.y + dir.y * d, z = from.z + dir.z * d;
    if (y < terrainH(x, z, zi) + 1.1) return Math.max(2.2, want * ((i - 1) / STEPS));
    for (let list = 0; list < 5; list++) {
    const cols = list === 0 ? rockColliders : list === 1 ? propColliders : list === 2 ? wreckColliders : list === 3 ? ventColliders : dynCols;
    const nCols = list === 4 ? dynN : cols.length;
    for (let k = 0; k < nCols; k++) {
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

  // the deck boom's ease (see DECKCAM): sub-stepped so a long frame cannot ring it
  {
    const tgt = deckTarget(), w = DECKCAM.w;
    for (let r = dt; r > 1e-6; r -= 0.02) {
      const h = Math.min(r, 0.02);
      deckKV += (w * w * (tgt - deckK) - 2 * w * deckKV) * h;
      deckK += deckKV * h;
    }
    if (deckK < 1e-4 && tgt === 0 && deckKV <= 0) { deckK = 0; deckKV = 0; }
    else if (deckK > 1 - 1e-4 && tgt === 1 && deckKV >= 0) { deckK = 1; deckKV = 0; }
  }
  const base = boomBack(), up = boomUp();
  buildDynCols();
  let want = clearCamDistance(player.pos, camBack, base, zi);
  // On (or coming onto) the deck the boom is also walked against the raft's gear, along
  // the real line from the pivot to the lens (back AND up), and the lens slides in along
  // that same line: the rise shrinks with the pull-in so a pulled-in lens is still on a
  // clear line (the water boom keeps its fixed rise; deckK is 0 there).
  deckWant = base;
  if (deckK > 0) {
    // The crane's target: the lowest lift with a clear line (one lower than the current
    // target must be clear by margin + 0.2). None clear: the longest line, but the current
    // target holds unless another beats it by 0.1 (equal answers flip-flopped it, measured).
    _piv.copy(player.pos); _piv.y += DECK_PIVOT;
    let bestF = -1, bestL = deckLiftT, curF = -1;
    for (let i = 0; i < DECK_LIFTS.length; i++) {
      const L = DECK_LIFTS[i];
      camTo.copy(camBack).multiplyScalar(base); camTo.y += up + L - DECK_PIVOT;
      const f = deckBoomClear(_piv, camTo, DECKCAM.margin + (L < deckLiftT ? 0.2 : 0));
      if (f >= 1) { bestL = L; bestF = 2; break; }
      if (L === deckLiftT) curF = f;
      if (f > bestF) { bestF = f; bestL = L; }
    }
    if (bestF < 2 && curF >= 0 && bestF < curF + 0.1) bestL = deckLiftT;
    deckLiftT = bestL;
    { const w = 5.5, h = Math.min(dt, 0.05); deckLiftV += (w * w * (deckLiftT - deckLift) - 2 * w * deckLiftV) * h; deckLift += deckLiftV * h;
      if (deckLiftT === 0 && Math.abs(deckLift) < 1e-3 && Math.abs(deckLiftV) < 1e-2) deckLift = deckLiftV = 0; }
    if (bestL === 0 && bestF === 2 && deckLift === 0) deckWant = base;   // the usual frame: one clear line, already tested
    else {
      camTo.copy(camBack).multiplyScalar(base); camTo.y += up + deckLift * deckK - DECK_PIVOT;
      deckWant = Math.max(2.2, base * deckBoomClear(_piv, camTo));
    }
    if (deckWant < want) want = deckWant;
  } else { deckLift = deckLiftV = deckLiftT = 0; }
  // In fast (an obstacle must never be clipped through), out on a critically-damped
  // spring: the old first-order ease left the wall at full speed, a visible kink every
  // time a rock slid out of the line of sight. The spring leaves it at rest.
  // A FREE boom (nothing in the way, and it was at full length last frame) rides the
  // deck/water ease exactly — the spring is for coming off an obstacle, and chasing the
  // ease with it would stack a second lag on the 1 s transition.
  if (want >= base - 1e-4 && camDist >= camBasePrev - 1e-3) { camDist = want; camDistV = 0; }
  else if (want < camDist) { camDist += (want - camDist) * Math.min(1, 14 * dt); camDistV = 0; }
  else { const w = 4.5; camDistV += (w * w * (want - camDist) - 2 * w * camDistV) * Math.min(dt, 0.05); camDist += camDistV * Math.min(dt, 0.05); if (camDist > want) { camDist = want; camDistV = 0; } }
  camBasePrev = base;

  camDesired.copy(player.pos).addScaledVector(camBack, camDist);
  // on deck the lens rides the line from the pivot: pulled in, it comes down that line
  if (deckK > 0) { const upD = up + deckLift * deckK; camDesired.y += upD - deckK * (upD - DECK_PIVOT) * (1 - camDist / base); }
  else camDesired.y += CAM_UP;
  camDesired.y = Math.max(camDesired.y, terrainH(camDesired.x, camDesired.z, zi) + 1.2);
  // (The idle "breathing" drift — 0.09 u vertical, 0.07 u lateral, forever — is gone: a
  // locked frame on a still man is the point. Weight comes from Sal, not from the lens.)
  const rmK = reducedMotion() ? 0 : 1;

  // feel channel: swim surge + deck footfall (see the block at the constants)
  if (FEEL.on) {
    const spd = player.vel.length();
    speedEMA += (spd - speedEMA) * Math.min(1, 0.5 * dt);          // ~2s mean
    if (!player.grounded && speedEMA > 1.5) {
      // surge > 0 on the kick, < 0 in the coast; camera pulls in on the push
      const surge = (spd - speedEMA) / Math.max(speedEMA, 1);
      camDesired.addScaledVector(camBack, -FEEL.surgeK * clamp(surge, -0.6, 0.6));
    }
    const scNow = stepCount();
    if (scNow !== camStepSeen) {
      if (camStepSeen >= 0 && !player.onDeck && player.grounded) camStepDip = Math.max(camStepDip, FEEL.bedDip / FEEL.stepDip);
      camStepSeen = scNow;
    }
    camStepDip = Math.max(0, camStepDip - dt / 0.22);
    camDesired.y -= FEEL.stepDip * camStepDip;
    if (player.grounded && !camWasGrounded && camFallV > 1.2) camLand.v -= Math.min(2.2, camFallV * FEEL.landK * 4);
    camWasGrounded = player.grounded;
    camFallV = player.grounded ? 0 : Math.max(0, -player.vel.y);
    { const w = 7.5, z = 0.45; camLand.v += (-w * w * camLand.x - 2 * z * w * camLand.v) * Math.min(dt, 0.033); camLand.x += camLand.v * Math.min(dt, 0.033); }
    camDesired.y += camLand.x;
    const lk = Math.min(1, 1.4 * dt);
    camLead.x += (player.vel.x * FEEL.lead - camLead.x) * lk;
    camLead.z += (player.vel.z * FEEL.lead - camLead.z) * lk;
    const ll = Math.hypot(camLead.x, camLead.z);
    if (ll > FEEL.leadMax) { camLead.x *= FEEL.leadMax / ll; camLead.z *= FEEL.leadMax / ll; }
  } else camLead.set(0, 0, 0);
  // THE HANDHELD (Flow lean item 6). Mix weights by state, integrate each layer's
  // phase by dt, sum position offsets into the spring target. Look and roll terms
  // are computed here and applied after lookAt below. Nothing runs at styleK 0.
  const hk = styleK('camera') * (rmK ? 1 : HH.rmK);
  hhOff.set(0, 0, 0); hhYaw = 0; hhPitch = 0; hhRoll = 0;
  if (hk > 0) {
    const fadeK = Math.min(1, dt / HH.fade);
    // the pause stills the lens over one crossfade; phases hold, offsets ease to zero
    hhGate += ((paused ? 0 : 1) - hhGate) * fadeK;
    const moving = player.grounded && speed > 0.35;
    const wantW0 = player.grounded && !moving ? 1 : 0, wantW1 = moving ? 1 : 0, wantW2 = player.grounded ? 0 : 1;
    hhW[0] += (wantW0 - hhW[0]) * fadeK; hhW[1] += (wantW1 - hhW[1]) * fadeK; hhW[2] += (wantW2 - hhW[2]) * fadeK;
    if (!paused) {
      hhPh[0] += dt * HH.still.rate * Math.PI * 2;
      hhPh[1] += dt * HH.walk.rate * Math.PI * 2 * (0.6 + 0.4 * Math.min(1, speed / 2.2));   // sway follows the gait
      hhPh[2] += dt * (HH.swim.rate + 0.02 * speed) * Math.PI * 2;
      hhHeel = Math.max(0, hhHeel - dt / HH.walk.heelTau);
    }
    const deck = player.onDeck;                      // Flow's deck shots are steady
    const g = hk * hhGate, D2R = Math.PI / 180;
    const L = [HH.still, HH.walk, HH.swim];
    for (let i = 0; i < 3; i++) {
      const w = (deck && i > 0 ? 0 : hhW[i]) * g; if (w < 1e-4) continue;
      const ph = hhPh[i], ch = i * 6, lay = L[i];
      hhOff.x += w * lay.pos[0] * hhNoise(ph, ch);
      hhOff.y += w * lay.pos[1] * hhNoise(ph, ch + 1);
      hhOff.z += w * lay.pos[2] * hhNoise(ph, ch + 2);
      hhYaw   += w * lay.look[0] * D2R * hhNoise(ph, ch + 3);
      hhPitch += w * lay.look[1] * D2R * hhNoise(ph, ch + 4);
      if (!deck) hhRoll += w * lay.look[2] * D2R * hhNoise(ph, ch + 5);
    }
    // walking: the heel strike lands in the lens — a lateral nudge and a roll pulse to
    // the side the weight went, decaying before the next step
    if (!deck && hhW[1] > 1e-3 && hhHeel > 0) {
      camRight.set(Math.sin(player.yaw - Math.PI / 2), 0, Math.cos(player.yaw - Math.PI / 2));
      const hp = hhW[1] * g * hhHeel * hhHeel * hhHeelSign;
      hhOff.addScaledVector(camRight, HH.walk.heelX * hp);
      hhRoll += HH.walk.heelRoll * D2R * hp;
    }
    // swimming: the roll leans with the stroke (player.swimP is the kick phase, 0..1)
    if (!deck && hhW[2] > 1e-3) hhRoll += hhW[2] * g * HH.swim.strokeRoll * D2R * Math.sin(player.swimP * Math.PI * 2);
    // impulses: bites, slams, the lunge all raise `shake`. A rising edge kicks a damped
    // roll spring, so the hit reads as the lens flinching rather than vibrating.
    if (shake > hhShakeWas + 1e-4) hhFlinchV += (shake - hhShakeWas) * HH.flinchDeg * D2R * 14 * (rng(0, 1) < 0.5 ? -1 : 1);
    hhShakeWas = shake;
    if (!paused) {
      const fs = 120, fd = 2 * Math.sqrt(fs) * 0.55;   // underdamped: one wobble, then still
      hhFlinchV += (-fs * hhFlinch - fd * hhFlinchV) * dt;
      hhFlinch += hhFlinchV * dt;
    }
    hhRoll += hhFlinch * g;
    // put the position layers on the spring target: the spring's own damping keeps
    // them cinematic, not shaky
    camDesired.add(hhOff);
  } else if (hhGate !== 0) {
    hhGate = 0; hhFlinch = hhFlinchV = 0; hhShakeWas = shake;
  }
  // A critically-damped tracker sits damp*v/stiff behind its target, measured at 20.9 u
  // when the old thruster was at full chat — so the camera made the effect LESS visible
  // at exactly the moment it fired. Lead the spring by that amount and punch in, but
  // only while the kick is live.
  // (The old velocity lead that made up the tracker's lag is not needed: the spring below
  // carries Sal's own velocity, so it has no lag to make up. The punch-in stays.)
  if (camKick > 0) camDesired.addScaledVector(camBack, -2.6 * camKick);

  // Cut, don't fly. Done before the spring so camVel never integrates the teleport.
  if (camSnap) {
    camSnap = false;
    camera.position.copy(camDesired);
    camVel.set(0, 0, 0);
    camLook.copy(player.pos).addScaledVector(fwd, 6);
    camLook.y += DECKCAM.look * deckK;
    camDist = want; camDistV = 0; camBasePrev = base;
  }

  // Critically-damped spring WITH VELOCITY FEED-FORWARD. The old spring damped the
  // camera's absolute velocity, so in steady motion it sat damp*v/stiff behind its target
  // — 5 u at swimming speed — and that lag stretched and shrank with every kick: the lens
  // floated after him on a rubber band. Damping the velocity RELATIVE to Sal's removes
  // the steady-state lag entirely; the spring only answers changes (a turn, a landing, a
  // collision push-in), and answers them a little firmer than before (60, was 42).
  const stiff = 60, damp = 2 * Math.sqrt(stiff);
  camTo.copy(camDesired).sub(camera.position);
  camVel.addScaledVector(camTo, stiff * dt);
  camVel.x -= (camVel.x - player.vel.x) * damp * dt;
  camVel.y -= (camVel.y - player.vel.y) * damp * dt;
  camVel.z -= (camVel.z - player.vel.z) * damp * dt;
  camera.position.addScaledVector(camVel, dt);
  // Leading the target is not enough on its own: the spring needs ~0.31 s to respond and
  // the whole burst is 0.26 s. Close the rest of the gap directly, scoped to the kick.
  if (camKick > 0) camera.position.lerp(camDesired, Math.min(1, 7 * camKick * dt));

  // the yank: the frame is jerked along the line with him and settles inside ~0.3 s
  if (camYank.x !== 0 || camYank.v !== 0) {
    const w = 15, z = 0.72;
    let h = Math.min(dt, 0.05);
    while (h > 1e-6) {
      const hs = Math.min(h, 1 / 120);
      camYank.v += (-w * w * camYank.x - 2 * z * w * camYank.v) * hs;
      camYank.x += camYank.v * hs; h -= hs;
    }
    if (Math.abs(camYank.x) < 1e-4 && Math.abs(camYank.v) < 1e-3) camYank.x = camYank.v = 0;
    camera.position.addScaledVector(camYankDir, camYank.x * (rmK ? 1 : 0.3));
  }
  if (shake > 0) {
    const sk = shake * 0.5 * (rmK ? 1 : 0.3) * (hk > 0 ? 1 - 0.5 * hk * hhGate : 1);
    camera.position.x += rng(-1, 1) * sk;
    camera.position.y += rng(-1, 1) * sk;
    camera.position.z += rng(-1, 1) * sk;
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

  // THE DECK BOOM'S HARD STOP. The spring trails camDesired by a frame or two, and in a
  // brisk turn that lag carried the lens through the jib (measured: 4 frames in one deck
  // loop). If the lens itself has ended up inside the raft's gear, put it back on the
  // clear part of its own line to Sal and drop its relative velocity.
  if (deckK > 0) {
    _raftInv.compose(raft.position, raft.quaternion, _one).invert();
    _bp.copy(camera.position).applyMatrix4(_raftInv);
    if (camBlockedLocal(_bp.x, _bp.y, _bp.z, DECKCAM.margin * 0.5)) {
      _piv.copy(player.pos); _piv.y += DECK_PIVOT;
      camTo.copy(camera.position).sub(_piv);
      camera.position.copy(_piv).addScaledVector(camTo, deckBoomClear(_piv, camTo));
      camVel.copy(player.vel);
      deckStops++;
    }
  }

  // aim slightly ahead of travel so fast movement leads the frame
  // Aim tracks the look direction almost immediately. Heavy smoothing here reads as
  // mouse lag, which is far more objectionable than a little jitter.
  // The look leads on the SLOW-smoothed velocity only (camLead); the raw-velocity term
  // went (it swung the aim with every kick's surge).
  camAim.copy(player.pos).addScaledVector(fwd, 6).add(camLead);
  camAim.y += DECKCAM.look * deckK;
  // Sal looks at what the lens would notice: the nearest life in front, re-picked four
  // times a second (the search walks every fauna buffer; the look itself is sprung).
  diverLookCool -= dt;
  if (diverLookCool <= 0) {
    diverLookCool = 0.25;
    diverLookAt(hhNearestLife(fwd) < Infinity ? hhTmp : null);
  }
  camLook.lerp(camAim, Math.min(1, 40 * dt));
  camera.lookAt(camLook);
  if (hk > 0) {
    // INTEREST DRIFT: the lens notices the world. A slow bias of the look toward the
    // nearest living thing in front, capped at a few degrees, tau ~2 s. Any mouse or
    // stick input on the look this frame drops the bias at once and holds it off for
    // a beat — it never fights the player.
    const looked = Math.abs(player.yaw - hhYawWas) > 1e-6 || Math.abs(player.pitch - hhPitchWas) > 1e-6;
    hhYawWas = player.yaw; hhPitchWas = player.pitch;
    let wantYawB = 0, wantPitchB = 0;
    if (looked) hhMouseCool = 0.8;
    if (!paused) hhMouseCool = Math.max(0, hhMouseCool - dt);
    if (hhMouseCool <= 0 && !paused && hhNearestLife(fwd) < Infinity) {
      hhTmp.sub(camera.position);
      const dl = hhTmp.length();
      if (dl > 1e-3) {
        // yaw/pitch of the target in the camera's frame (lookAt already faced camLook)
        camera.getWorldDirection(camTo);
        const yawT = Math.atan2(hhTmp.x, hhTmp.z), yawC = Math.atan2(camTo.x, camTo.z);
        let dy = yawT - yawC; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        const pitT = Math.asin(clamp(hhTmp.y / dl, -1, 1)), pitC = Math.asin(clamp(camTo.y, -1, 1));
        const lim = HH.interestDeg * Math.PI / 180 * hk;
        wantYawB = clamp(dy, -lim, lim); wantPitchB = clamp(pitT - pitC, -lim, lim);
      }
    }
    const ik = looked ? 1 : Math.min(1, dt / HH.interestTau);
    hhYawB += (wantYawB - hhYawB) * ik; hhPitchB += (wantPitchB - hhPitchB) * ik;
    // apply the interest bias and the layered look noise as rotations of the lens
    // (world-Y yaw so the horizon stays level, local pitch)
    camera.rotateOnWorldAxis(camUpAxis, (hhYawB * hhGate + hhYaw));
    camera.rotateX(hhPitchB * hhGate + hhPitch);
  } else if (hhYawB !== 0 || hhPitchB !== 0) { hhYawB = hhPitchB = 0; hhYawWas = player.yaw; hhPitchWas = player.pitch; }

  // bank into lateral movement, and widen slightly with speed
  camRight.set(Math.sin(player.yaw - Math.PI / 2), 0, Math.cos(player.yaw - Math.PI / 2));
  const lateral = player.vel.dot(camRight);
  // Bank into lateral movement — a hint, not a lean: was 0.012/u capped at 6.3 degrees, which
  // rolled the horizon whenever he crabbed or the current set him sideways.
  camRoll += (clamp(-lateral * 0.004, -0.035, 0.035) * rmK - camRoll) * Math.min(1, 3 * dt);
  camera.rotateZ(camRoll + hhRoll);
  if (camYank.x !== 0) camera.rotateX(camYank.x * 0.09 * (rmK ? 1 : 0.3));   // the nod: ~1 deg at a full snap

  // The 2.5/s lerp has a 0.4 s time constant, so it can only reach 48% of any target
  // inside a 0.26 s burst — which is why the existing +9 speed FOV was imperceptible.
  // Snap out, ease back. Capped at 86: the speed term and the kick peak together, and
  // 70 + 9 + 15 would be an 89-degree fisheye.
  // Widen with the SMOOTHED speed: on the instantaneous one the field of view pumped with
  // every kick. The burst punch is an event and stays sharp.
  camSpdS += (speed - camSpdS) * Math.min(1, 0.8 * dt);
  const wantFov = Math.min(86, 70 + clamp(camSpdS * 0.32, 0, 9) + 11 * camKickPunch);
  // Snap out only while a kick is live; the 2.5/s ease is otherwise exactly as shipped.
  const fovRate = camKickPunch > 0 && wantFov > camFov ? 20 : 2.5;
  camFov += (wantFov - camFov) * Math.min(1, fovRate * dt);
  if (Math.abs(camera.fov - camFov) > 0.01) { camera.fov = camFov; camera.updateProjectionMatrix(); }
}

// The decorative block: a broken jelly or a bad cloud must never take the helm with it.
// Each system fails on its own, once, loudly, and the dive goes on without it.
const safeFailed = new Set();
// PERF HARNESS section clock (__bench, ?lab/?bench): null in play, so each mark is one
// compare. pm(name) books the wall time since the previous mark to `name`.
let prof = null, pmT = 0;
function pm(name) { if (!prof) return; const n = performance.now(); prof[name] = (prof[name] || 0) + n - pmT; pmT = n; }
function safe(name, fn) {
  if (safeFailed.has(name)) return;
  if (prof) pm('glue');
  try { fn(); if (prof) pm(name); } catch (e) {
    safeFailed.add(name);
    console.error(`ABYSSA: ${name} threw and is switched off for this session`, e);
  }
}
window.__safeFailed = () => [...safeFailed];

// Lightning under reduced motion: a quarter of the flash, and never more than three
// strokes in any second.
const strokeT = [0, 0, 0];
let flashWas = 0;
function gateFlash(flash, t) {
  const rm = reducedMotion();
  if (flash > 0.2 && flashWas <= 0.2) {
    // a new stroke: count it against the last second
    let n = 0; for (const s of strokeT) if (t - s < 1) n++;
    if (n >= 3 && rm) { flashWas = flash; return 0; }
    strokeT[0] = strokeT[1]; strokeT[1] = strokeT[2]; strokeT[2] = t;
  }
  flashWas = flash;
  return flash * (rm ? 0.25 : 1);
}

// ---- GAMEPAD ------------------------------------------------------------------------
// One pad, polled. Sticks and buttons are translated into the same key codes the
// keyboard sets, edge-only, so pad and keys never fight over a key. Verbs go through
// synthetic keydown/keyup so the handler above is the single place they live.
const PAD_DEAD = 0.22;
const padHeld = {};
const PAD_BTN = { 0: 'Space', 1: 'KeyC', 2: 'KeyE', 3: 'KeyF', 4: 'KeyQ', 5: 'ShiftLeft', 8: 'KeyT' };
function padKey(code, on, synth) {
  if (on && !padHeld[code]) {
    padHeld[code] = true;
    if (synth) dispatchEvent(new KeyboardEvent('keydown', { code })); else keys[code] = true;
  } else if (!on && padHeld[code]) {
    padHeld[code] = false;
    if (synth) dispatchEvent(new KeyboardEvent('keyup', { code })); else keys[code] = false;
  }
}
function pollGamepad(dt) {
  let pads = null;
  try { pads = navigator.getGamepads ? navigator.getGamepads() : null; } catch (e) { return; }
  const gp = pads && (pads[0] || pads[1] || pads[2] || pads[3]);
  if (!gp) return;
  const ax = gp.axes || [], bt = gp.buttons || [];
  const lx = ax[0] || 0, ly = ax[1] || 0, rx = ax[2] || 0, ry = ax[3] || 0;
  padKey('KeyW', ly < -PAD_DEAD); padKey('KeyS', ly > PAD_DEAD);
  padKey('KeyA', lx < -PAD_DEAD); padKey('KeyD', lx > PAD_DEAD);
  if (Math.abs(rx) > PAD_DEAD) player.yaw -= rx * 2.4 * dt;
  if (Math.abs(ry) > PAD_DEAD) player.pitch = clamp(player.pitch - ry * 1.8 * dt, -1.45, 1.45);
  const pressed = i => !!(bt[i] && (bt[i].pressed || bt[i].value > 0.5));
  for (const i in PAD_BTN) {
    const code = PAD_BTN[i];
    padKey(code, pressed(i), code === 'KeyE' || code === 'KeyF' || code === 'KeyQ' || code === 'KeyT' || code === 'ShiftLeft');
  }
  // triggers: RT knife, LT spear — edge only, same functions the mouse buttons call
  const rt = pressed(7), lt = pressed(6);
  if (rt && !padHeld.RT && state === 'play' && !paused) doSlash();
  if (lt && !padHeld.LT && state === 'play' && !paused) doSpear();
  padHeld.RT = rt; padHeld.LT = lt;
}

function update(dt, t) {
  if (prof) pmT = performance.now();
  if (msgT > 0) {
    msgT -= dt;
    if (msgT <= 0) {
      if ($msg.classList.contains('on')) {
        // the live line fades; if one waits, hold the slot (at ITS priority) for the fade
        $msg.classList.remove('on');
        if (msgPend) { msgT = 0.5; msgPrio = msgPend.prio; }
      } else if (msgPend) {
        const p = msgPend; msgPend = null; showMsg(p.text, p.dur, p.prio);
      }
    }
  }
  // reduced motion: the feel channel goes with it (window.__feel can still A/B it)
  const rmNow = reducedMotion();
  if (rmNow !== rmWas) { rmWas = rmNow; FEEL.on = !rmNow; setChromaReduced(rmNow); }

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
    player.yaw = DECK_SPAWN_YAW;
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
    // Authored in Sal's own frame (l = along his left, f = ahead of him) so the portrait
    // follows the spawn heading: it was written when he faced +Z.
    const a = t * 0.05;
    const fx = Math.sin(DECK_SPAWN_YAW), fz = Math.cos(DECK_SPAWN_YAW), lx = fz, lz = -fx;
    const ol = 3.15 + Math.sin(a) * 0.55, of = 4.30 + Math.cos(a) * 0.40;
    camera.position.set(
      player.pos.x + lx * ol + fx * of,
      player.pos.y + 1.05 + Math.sin(t * 0.5) * 0.06,
      player.pos.z + lz * ol + fz * of
    );
    // Look-target offset puts Sal in the right third of the frame, clear of the type.
    camera.lookAt(player.pos.x - lx * 1.35, player.pos.y + 0.30, player.pos.z - lz * 1.35);
  }

  // Weather runs even behind the title so a session can open at dusk or mid-storm.
  const wx = updateWeather(dt, t);
  const flash = gateFlash(wx.flash, t);
  // THE BOLT LIGHT (world/lightning.js) carries the strike now: channels + a two-slot
  // light in the fog chunk that every material reads. The scalar flash stays as the
  // coarse fallback at its `coarseK` share (the light is four uniforms and never sheds;
  // only the ribbon mesh goes under the terminal perf rung).
  safe('lightning', () => updateLightning(dt, wx, reducedMotion()));
  setBoltRibbons(!(window.__perf && window.__perf.stage() >= 3));
  setWeatherLight(wx.day, wx.storm, flash * GLASS.lightning.coarseK, wx.env);
  setWeatherEnv(wx.env);
  setWeatherHand(wx.hand, wx.wind);
  setCloudWeather(wx.hand, wx.env.sky);
  setSkyWeather(wx);
  setRainWeather(wx.env, windState());   // the eased wind, so the streaks lean on the same curve as the chop
  // The storm's 45% cut to surface irradiance is DAY-GATED now (the sunlit-storm
  // principle, same as the palette desat): a noon gale keeps most of its light —
  // Michael's poseidon reference is a BRIGHT storm — while a night gale keeps the
  // full dread cut. At day 1 the cut is ~16%; at day 0 it is the shipped 45%.
  // day/flash passed EXPLICITLY (water.js's preferred form): the fallback inversion of
  // surfK predates the day-gated storm cut and skews wDay in mid-day gales, and without
  // the flash arg the sea-surface lightning term (uFlash) never fires at all.
  setWeatherWater((0.20 + 0.80 * wx.day) * (1 - 0.45 * wx.storm * (1 - 0.65 * wx.day)), wx.storm, wx.day, flash);
  setSwell(wx.env.sea, wx.day);
  setStormCurrent(wx.env.below);   // subsurface current lags the sky — weather arrives from above
  setWindCurrentVec(windState().speed, windState().dx, windState().dz);   // eased wind: drift below re-aims on the same curve as the chop above
  setRayDim(getVolumetrics() ? 0.55 : 1);

  // Ambient world animation runs even behind the title screen. Decorative: each is fenced.
  // Zone sight first: every band gate below reads it (config.js ZONE_SEEN).
  updateZoneSight(camera.position.x, camera.position.y, camera.position.z);
  if (window.__breakAmbient) { window.__breakAmbient = 0; safe('probe', () => { throw new Error('probe: injected ambient throw'); }); }
  safe('flora', () => updateFlora(dt, t));
  safe('gardens', () => updateGardens(dt, t));
  safe('props', () => updateProps(dt, t));
  safe('footfx', () => updateFootFX(dt, t));
  safe('creatures', () => updateCreatures(dt, t));
  safe('fauna', () => updateFauna(dt, t));   // FAUNA PATCH
  pm('glue'); updateWater(dt, t); pm('water');    // NOT decorative: the surface height, optics and refraction key off it
  // The volumetric sky retires the puffs (they stay built: the A/B, and __vsky.on(0)).
  if (volSkyOn()) setPuffsVisible(false);
  else safe('clouds', () => updateClouds(dt, t));   // after updateWater: reads its eased wind and its resolved cloud palette
  safe('sky', () => updateSky(dt, t));         // after updateWater: reads its palette, hands back the horizon
  safe('rain', () => updateRain(dt, t));       // after updateWater: reads the surface height it just resolved
  pm('glue'); updateTerrain(dt, t, camera.position.y, wx.day * (1 - 0.85 * wx.storm)); pm('terrain');
  updateRifts(dt, t, zone, !!(lev && lev.calmed)); pm('rifts');

  // ---- THE VOYAGE ------------------------------------------------------------------
  // The inked passage (ui/passage.js) runs on its own wall clock; it tells us when to
  // reseed (once, under the opaque sheet, before the pen goes down), when the nib
  // touches the mark (the bell) and when the chart has dissolved (play). Blur holds it:
  // the sheet stops where it is and the audio suspends with it, as in play.
  if (state === 'voyage') {
    setPaused(blurred);
    const pev = updatePassage(blurred);
    if ((pev & PEV_RESEED) && !voyageDone) {
      voyageDone = true;
      reseedWorld(voyageTo);
    }
    if (pev & PEV_BELL) chime(392, 2.6, 0.2, 'voyage');   // the ship's bell as the nib touches her mooring
    if (pev & PEV_DONE) {
      if (!voyageDone) { voyageDone = true; reseedWorld(voyageTo); }   // never arrive unreseeded
      state = 'play';
      voyageRing = 3;
    }
    updateRaft(dt, t);
    updateAtmosphere(0, camera.position.y);
    updateLighting(0); syncLamps();   // atmos: lamp in-scatter reads the RELIT lantern
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
    updateLighting(d01); syncLamps();   // atmos: lamp in-scatter reads the RELIT lantern
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
    updateLighting(d01); syncLamps();   // atmos: lamp in-scatter reads the RELIT lantern
    setDepth(d01);
    return;
  }

  // The chart in hand stills the man: movement keys are parked while the paper is up.
  if (isChartOpen()) clearKeys();
  // THE PAUSE: no pointer lock and no chart means no helm. See the note at `paused`.
  // window.__helm === true: the review harness has no pointer lock; it takes the helm by
  // flag. Strictly true — helmetSwap.js hangs its debug OBJECT on the same name, and a
  // truthy test there meant Esc/blur never paused play (found 2026-10-04).
  paused = window.__helm !== true && (!locked || blurred) && !isChartOpen();
  voyageRing = Math.max(0, voyageRing - dt);
  setPaused(paused && (voyageRing <= 0 || blurred));   // audio: Esc/blur suspends the context (an arrival's bell rings out first)
  pauseT = paused ? pauseT + dt : 0;
  // the line waits a beat so the lock's own latency never flashes it
  $pause.classList.toggle('on', paused && pauseT > 0.35);
  if (!paused) pollGamepad(dt);
  let fwd;
  pm('glue');
  if (paused) fwd = forwardVec();
  else ({ fwd } = updatePlayer(dt, t, zone, !!(lev && lev.calmed)));
  pm('player');
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
    // (audio hears the crossing itself: audio/sal.js splash(), keyed on the same surface)
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
        chime(523, 3, 0.25, 'ending'); chime(659, 3, 0.18, 'ending'); chime(784, 4, 0.15, 'ending');
      }
      return;
    }
    endingSeen = true;
    saveChart();
    state = 'won'; winT = 0;
    chime(523, 3, 0.3, 'ending'); chime(659, 3, 0.2, 'ending'); chime(784, 4, 0.2, 'ending');
    clearKeys();
    // The cinematic drives player.pos/vel itself; clear the suit state so a banked burst
    // cannot fire under it and so the rig's pose reads off a sane fill.
    resetSuit(player.pos.y);
    startEnding();
    return;
  }

  const gained = paused ? 0 : updateMotes(dt, t, player.pos);
  if (gained) {
    player.light = Math.min(1, player.light + 0.34 * gained);
    chime(880 + Math.random() * 220, 0.9, 0.18, 'pickup');
  }

  pm('glue');
  if (lev) {
    const ev = updateLeviathan(lev, dt, t, player); pm('leviathan');
    audioSleeper(lev, ev);   // audio reads the sleeper's own animation edges this frame
    if (ev.woke) {
      showMsg(lev.name, 5, 2); growl(); shake = 1;
      const mk = currentSiteIndex() * 3 + zone;
      if (lev.memWard >= 0 && lev.memLine && !memSaid[mk]) { memPending = lev.memLine; memKey = mk; }
    }
    if (ev.grabbed) { shake = Math.min(1, shake + 0.6); kickLantern(0.8); diverImpulse('grab'); }
    diverGrab(!!lev.grab);
    if (ev.quake) shake = Math.max(shake, ev.quake);   // her footfalls, hammer, settle thump
    // big blows startle the reef too (footfalls already reach it through stir.js)
    if (ev.quake > 0.3 && lev.pos) stirPulse(lev.pos.x, lev.pos.y, lev.pos.z, 40, 0, Math.min(1, ev.quake + 0.3), P_SLAM);
    if (ev.plume) stirPulse(ev.plumeX, ev.plumeY, ev.plumeZ, 30, 0, Math.min(1, 0.5 + 0.5 * ev.plume), P_SLAM);   // the Brooder's sand plume startles the reef where it rises
    if (ev.msg) showMsg(ev.msg, 4);
    if (ev.lightDrain) player.light -= ev.lightDrain;
    if (ev.inkDim) inkBlind = 1;   // Orune answers the light with ink (hoarder.js)
    if (ev.slam) {
      shake = Math.min(1, shake + 2 * dt); slam();
      // Contact is per-frame; the tear is per collision. Rising edge only.
      if (!slamWas) {
        if (lev.pos) stirPulse(lev.pos.x, lev.pos.y, lev.pos.z, 40, 0, 1, P_SLAM);
        kickLantern(1.2);
        hitFrom(lev.spine, 1.5);   // Sal's body takes the slam too (diver.js life layer)
        lightDip = Math.max(lightDip, 0.7);
        if (tearDress()) showMsg('AIR IS LEAKING — THE DRESS IS TORN', 4);
      }
    }
    slamWas = ev.slam;
    if (ev.sigilLit) {
      chime(ev.sigilLit, 2, 0.3, 'ward');
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
      chime(262, 3, 0.3, 'calm'); chime(330, 3, 0.25, 'calm'); chime(392, 3, 0.25, 'calm');
    }
  }

  // The lantern going out is no longer fatal on its own — it blinds you and makes you
  // breathe harder. Drowning is the single death condition.
  // the Hoarder's ship's lamp, once kept, refills the lantern twice as fast
  if (!paused) player.light = Math.min(1, player.light + dt * 0.008 * (player.hasLamp ? 2.2 : 1));
  // THE SNATCH: while the octopus has the lantern there is no light to regain. Held at
  // zero AFTER the regen line, every frame, until predators.js says it let go.
  if (lanternHeld) player.light = 0;
  const lightOut = player.light <= 0;
  if (lightOut) player.light = 0;
  if (lightOut && !wasLightOut) showMsg('YOUR LANTERN IS OUT', 3);
  wasLightOut = lightOut;

  // ---- surface-supplied air ----
  pm('glue'); updateRaft(dt, t); pm('raft');
  const distFromRaft = updateTether(dt, player, zone); pm('tether');
  // THE YANK: the hose snapped him back this frame (tether.js leash). The body staggers
  // toward the line, his hands come off the controls for a recovery that scales with the
  // snap, the lens is jerked with him, and the rubber and the bonnet sound it.
  if (leash.yank > 0 && !paused) {
    const k = leash.yank;
    diverYank(leash.dx, leash.dz, k, player.grounded);
    if (k > 0.12) {
      const dur = 0.3 + 1.2 * k;
      player.staggerDur = dur; player.stagger = dur;
      player.staggerK = Math.min(0.95, 0.35 + 0.6 * k);
    }
    camYankDir.set(leash.dx, leash.dy, leash.dz);
    camYank.v += 7.5 * k;
    hoseYank(k);
  }
  const drowned = paused ? false : updateSurvival(dt, depth01, player.pos.y < -3, lightOut);

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
      // The line actually stops: survival.supplied drops for the gasp, so the tank
      // drains at depth rate, the bottle recharges at a crawl, and the HUD says so.
      survival.sputter = Math.max(survival.sputter, Math.min(sputterT, SPUTTER_SEC));
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
    // Same order as the E handler: the brood, the keepsake (or his mark), the relic.
    const bp = lev && lev.rite ? lev.rite.prompt(player.pos) : null;
    const kp = bp ? null : nearKeepsake(player.pos);
    const rel = kp || bp ? null : nearRelic(player.pos);
    if (bp) {
      $craft.textContent = bp;
      $craft.style.opacity = 1;
    } else if (kp) {
      $craft.textContent = kp.mark ? '[E] READ IT' : '[E] TAKE IT';
      $craft.style.opacity = 1;
    } else if (rel) {
      $craft.textContent = `[E] take the ${rel.tool === 'sonar' ? 'sounding set' : rel.tool === 'spear' ? 'spear gun' : 'air thruster'}`;
      $craft.style.opacity = 1;
    } else {
      $craft.style.opacity = 0;
    }
  }

  const got = updateResources(dt, t, player.pos);
  if (got) {
    chime(got === 'polymer' ? 660 : 330, 0.7, 0.14, 'pickup');
    if (got === 'polymer' && !tips.polymer) { tips.polymer = 1; showMsg('POLYMER — THREE MAKE A LENGTH OF HOSE', 4); }
    else if (got === 'bitumen' && !tips.bitumen) { tips.bitumen = 1; showMsg('BITUMEN — FOOD FOR THE PUMP', 4); }
  }

  // onboarding beats fire only in silence, each exactly once
  zoneTime += dt;
  if (msgT <= 0 && state === 'play') {
    if (memPending) {
      // (stilled before a silence came, the line is stale: dropped, still owed)
      if (lev && !lev.calmed) { showMsg(memPending, 5); memSaid[memKey] = 1; }
      memPending = null;
    } else if (pendingWards) {
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
  // FIRST occurrence or the player bobs helplessly without knowing C is the answer.
  if (state === 'play') {
    if (!tips.dress && player.pos.y < -8) {
      tips.dress = 1; showMsg('AIR IN THE DRESS LIFTS YOU. [SPACE] FILLS IT, [C] VENTS IT.', 5);
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
    clearKeys();
    showMsg('YOUR AIR RAN OUT', 4);
    setTimeout(() => {
      // BACK ON THE DECK, not floating under the raft. The tenders hauled him up and
      // stood him on his feet; the dive starts again the way it started the first time,
      // by stepping over the side. Same pose as start().
      deckSpawn(player.pos);
      player.yaw = DECK_SPAWN_YAW;
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
      snapCamBehind(true);
      camSnap = true;
      // The rescue tops the pump up from the reserve can. Without this, drowning with
      // an empty tank and no bitumen strands you at the raft with 45s of air and all
      // the bitumen 200m below — an unwinnable state.
      survival.fuel = Math.max(survival.fuel, FUEL_RESCUE);
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
  setAbove(aboveWater);            // the air side of the mix: gulls, wind, the pump in the open
  setWind(windState().speed);      // the eased wind, same curve as the chop
  // knife: the hit lands on the swing's contact frame, not the click
  if (pendingSlash > 0) {
    pendingSlash -= dt;
    if (pendingSlash <= 0) {
      const kill = slash(player.pos, forwardVec(), 3.4);
      if (lev && lev.onSlash) lev.onSlash(player.pos, forwardVec());   // the Hoarder lets go of a cut arm
      if (kill) {
        knifeHit('flesh');
        shake = Math.min(1, shake + 0.25);
        if (kill.killed === 'squid') showMsg('THE SHOAL SCATTERS — IT DROPPED SOMETHING', 3);
      }
    }
  }

  // wrecks + relic tools
  safe('vents', () => updateVents(dt, t));
  safe('ventlife', () => updateVentLife(dt, t));
  pm('glue'); updateWrecks(dt, t); pm('wrecks');
  const tev = updateTools(dt, t, player); pm('tools');
  if (tev.spearKill) {
    chime(880, 0.5, 0.22, 'pickup');
    showMsg('THE SPEAR FINDS ITS MARK', 2.5);
  }
  if (tev.spearRecovered) {
    survival.spears += tev.spearRecovered;
    chime(494, 0.5, 0.16, 'pickup');
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
  pm('glue'); const pev = paused ? PEV_IDLE : updatePredators(dt, t, player, lanternPos); pm('predators');
  // Audio-only threats get a picture: a cold tint at the frame's edge, and one line the
  // first time each approach closes in (re-armed once it has fully withdrawn).
  $threat.style.opacity = (pev.threat * 0.55).toFixed(3);
  if (pev.threat > 0.35 && !threatSaid) { threatSaid = true; showMsg('SOMETHING CIRCLES', 3, 0); }
  else if (pev.threat < 0.08 && threatSaid) threatSaid = false;
  if (pev.inkPickup) {
    survival.ink += pev.inkPickup;
    chime(740, 0.8, 0.18, 'pickup');
    if (msgT <= 0) showMsg('INK SAC — [Q] VENTS IT AT A HUNTER', 3.5);
  }
  if (pev.bite) {
    survival.oxygen = Math.max(0.04, survival.oxygen - 0.10 * pev.bite);
    shake = Math.min(1, shake + 0.5);
    slam();
    kickLantern(1.2);
    hitFrom(window.pred && window.pred.sharks, 1, true);
    lightDip = 1;
    // A torn dress is the stake: the tenders cannot out-pump the hole, so for the next
    // TORN_SEC the line refills at half rate and 'AIR IS LEAKING' is true.
    if (tearDress()) showMsg('AIR IS LEAKING — THE DRESS IS TORN', 4);
    else if (msgT <= 0) showMsg('SOMETHING STRUCK YOU', 3);
  }
  if (pev.lightSteal) player.light = Math.max(0, player.light - pev.lightSteal * dt);
  if (pev.msg && msgT <= 0) showMsg(pev.msg, 4);
  if (!paused) lanternHeld = !!pev.lanternStolen;
  if (pev.lanternStolen) player.light = 0;

  let dread = 0;
  if (lev && !lev.dormant) {
    let near = Infinity;
    for (const s of lev.spine) { const d = s.distanceTo(player.pos); if (d < near) near = d; }
    dread = clamp(1 - near / (lev.size * 9), 0, 1);
  }
  setProximity(Math.max(dread, pev.threat));
  pm('glue'); audioFrame(dt, pev, wx); pm('audio');   // audio: listener, breath clock, creature/fauna/thunder edges
  // Debris reacts to the diver's push and the leviathan's sweep.
  updatePhysics(dt, player.pos, player.vel, lev ? lev.spine : null); pm('physics');

  updateDiver(dt, t, player); pm('diver');
  // Bootfall audio, sand puff and boot print all key off the rig's real heel strikes
  // (counted inside updateDiver), so they land on the same frame the weight drops.
  const sc = stepCount();
  if (sc !== lastStepPhase) {
    lastStepPhase = sc;
    footstep();
    // The eye feels the footfall on planks: a few centimetres of dip, fast recovery.
    if (player.onDeck && FEEL.on) camStepDip = 1;
    if (!player.onDeck) { hhHeel = 1; hhHeelSign = sc % 2 === 0 ? 1 : -1; }   // handheld walking layer (styleK-gated in updateCamera)
    // Silt and boot prints are SEABED effects. On the raft's planking they read as Sal
    // kicking up sand in mid-air and stamping footprints into timber, so the deck gets
    // the sound and nothing else.
    if (!player.onDeck) { const ff = lastFootfall(); spawnFootfall(player.pos, ff.yaw, ff.side, zone < 0 ? 0 : zone, 1, ff); }   // at the boot that went down, on its heading
  }
  // Landing after a drop kicks up a bigger cloud under both boots.
  // Terminal sink is 5.1 u/s vented (10.2 with the exhaust held open), not the 18 u/s
  // of the old point-and-hold dive, so the old >3 gate almost never fired.
  if (player.grounded && !wasGrounded && landVel > 1.8 && !player.onDeck) {
    const zi = zone < 0 ? 0 : zone;
    const p = Math.min(2.2, landVel * 0.42);
    land(p);
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
  inkBlind = Math.max(0, inkBlind - dt / 2.5);
  lightK = player.light * (1 - 0.45 * lightDip) * (1 - 0.6 * inkBlind);
  lanternLight.intensity = (9 + 3.5 * Math.sin(t * 9) + 1.5 * Math.sin(t * 23)) * lightK * lanternGutter(dt, t);
  playerLightSrc.position.copy(player.pos);
  playerLightSrc.intensity = 8 + 40 * lightK;

  // Keyed on the CAMERA's height, not the player's: the water column is stratified, so
  // what the eye is sitting in decides the optics. updateCamera runs below, so this reads
  // last frame's position — half a unit at full swim speed, against a 24-unit scale height.
  pm('glue'); updateAtmosphere(depth01, camera.position.y); pm('atmos');
  // THE ABYSS READS (world/abyss.js): zone-2 floor palette + the reef's own light on
  // Mhor's idle pool lights. After the sleeper staged the pool, before the lamp pick.
  safe('abyss', () => updateAbyss(dt, t, lev, player));
  updateLighting(depth01); syncLamps();   // atmos: lamp in-scatter reads the RELIT lantern
  setLampOccluders(diverOccluders(lampOcc));   // Sal's chest and bonnet shadow the glow
  pm('lighting');
  updateCamera(dt, t, fwd); pm('camera');
  // Look-dev camera pin, ?lab ONLY (DEV_CAMPIN is false in a shipped URL, so the read
  // never happens): window.__camPin = { pos: [x,y,z], look: [x,y,z] } holds the lens
  // there for macro captures.
  if (DEV_CAMPIN) {
    const cp = window.__camPin;
    if (cp) { camera.position.fromArray(cp.pos); camera.lookAt(cp.look[0], cp.look[1], cp.look[2]); }
  }

  // wayfinding: raft always, the sleeper until calmed, the rift once open
  setBearing($bm.raft, raft.position.x, raft.position.y, raft.position.z, true);
  const levShown = !!(lev && !lev.calmed && !lev.dormant);   // a sleeping ridge has no bearing
  setBearing($bm.lev, lev ? lev.head.x : 0, lev ? lev.head.y : 0, lev ? lev.head.z : 0, levShown);
  const rp = zone >= 0 ? riftPos(zone) : null;
  setBearing($bm.rift, rp ? rp.x : 0, rp ? terrainH(rp.x, rp.z, zone) : 0, rp ? rp.z : 0, !!(rp && lev && lev.calmed));
  // the active target carries the bright tick: the sleeper until it stills, then the rift
  $bm.lev.classList.toggle('active', levShown);
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
  pm('hud');
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
  if (++bootFrames < 3) return false;
  const el = document.getElementById('load');
  if (el && !el.classList.contains('done')) {
    el.classList.add('done');
    booted = true;
    setTimeout(() => el.remove(), 1100);   // it is z-index 2 over the title; do not leave it
  }
  return true;
}

// THE FRAME GOVERNOR (roadmap/battery-governor.md). rAF fires at the display's rate
// (120 Hz on this box), and the loop used to render every one of them: the title screen
// alone pinned the GPU for as long as the window was open, which is what a laptop on
// battery feels first. Now a frame is SKIPPED unless its slot is due: `cap` fps while
// the sea has the helm, `idle` fps on the title / unfocused / paused unlocked, and no
// frame at all while the document is hidden. Skipping means not even calling
// clock.getDelta(), so the skipped time lands in the next frame's dt (clamped 50 ms as
// always) — physics and the weather clock see the same seconds either way. Kept in
// phase (the remainder carries) so a 60 cap on a 120 Hz display is a steady every-other
// frame, not a beat.
let frameDue = 0, driveT = 0;
function frameCap() {
  if (document.hidden && !driveT) return -1;
  const P = GLASS.power;
  const idle = state === 'title' || blurred || !document.hasFocus() || (paused && window.__helm !== true);
  return idle ? P.idle : P.cap;
}
window.__power = {
  state: () => ({ cap: frameCap(), focus: document.hasFocus(), blurred, paused, state, hidden: document.hidden, knobs: { ...GLASS.power } }),
  set: (cap, idle) => { if (cap != null) GLASS.power.cap = cap; if (idle != null) GLASS.power.idle = idle; return window.__power.state(); },
  // DEV: the in-app browser pane reports document.hidden whenever it is not on screen,
  // and a hidden document gets no rAF at all. drive(true) runs the loop from a 60 Hz
  // timer so probes and canvas captures work anyway; drive(false) stops. Never called
  // by the game.
  drive(on) {
    if (driveT) { clearInterval(driveT); driveT = 0; }
    if (on) driveT = setInterval(() => { if (document.hidden) frame(performance.now()); }, 16);
    return !!driveT;
  }
};

// One rAF pending at most: __power.drive calls frame() from a timer while hidden, and
// an unguarded re-queue per call would stack parallel loops the moment it is visible.
let rafQ = false;
function rafTick(t) { rafQ = false; frame(t); }
let benchHold = false;   // __bench owns the frame while it measures
function frame(now = performance.now()) {
  if (loopFailed) return;
  if (!rafQ) { rafQ = true; requestAnimationFrame(rafTick); }
  if (benchHold) return;
  const cap = frameCap();
  if (cap < 0) return;                        // hidden: hold everything, spend nothing
  if (cap > 0) {
    const slot = 1000 / cap;
    if (now < frameDue - 1) return;           // -1 ms: rAF timestamps jitter under the slot
    // Carry the phase so the cadence is even; resync after a long gap (a stall, a
    // return from hidden) rather than bursting to catch up.
    frameDue = now - frameDue > slot * 2 ? now + slot : frameDue + slot;
  }
  frameStart();   // the latency probe's clock (postfx.js): this frame will render
  const dt = Math.min(0.05, clock.getDelta()), t = clock.elapsedTime;
  try {
    flushSize();   // one resize per frame, before anything reads the camera or the targets
    update(dt, t);
    // The sea's transmission target: a clip-plane render of the far side of the
    // interface. Runs after update (needs the frame's surface height and camera) and
    // before the composer, so the surface shader samples this frame, not the last one.
    gpuFrameBegin();     // one GPU timer query around the refraction pass + composer
    renderSky();         // cloud march + history before anything draws the dome
    renderRefraction();
    render(dt);
    gpuFrameEnd();
    boot();
    // The perf judge grades a wall-time MEDIAN against the governor's frame budget
    // (postfx.samplePerf). An idle-governed loop (30 fps cap) is not evidence about
    // the GPU: only sample with the helm at 45+ or uncapped, and tell it the cap.
    samplePerf(dt, (state === 'play' || state === 'won') && (cap === 0 || cap >= 45), cap);
  } catch (e) {
    if (!loopFailed) {
      loopFailed = true;
      console.error('ABYSSA: frame loop threw — the game is frozen from here.', e);
      failCard('THE PUMP HAS STOPPED', 'CLICK TO RAISE IT AGAIN');
    }
  }
}
// The shader precompile is ASYNC now (parallel compile where the driver has it), and
// the loader is held until it resolves; the loop does not start before the programs
// exist. A driver without compileAsync falls back to the synchronous compile.
{
  const t0 = performance.now();
  warmUpAsync()
    .catch(e => { console.warn('ABYSSA: compileAsync failed, compiling synchronously', e); return warmUp(); })
    .then(n => {
      console.info(`ABYSSA: ${n} shader programs precompiled in ${(performance.now() - t0).toFixed(0)} ms`);
      setMaster(muteSaved ? 0 : MASTER_VOL);
      clock.getDelta();   // the compile is not a frame
      frame();
    });
}

// DEV: THE PERF HARNESS (src/lib/bench.js, ?lab or ?bench): a fixed-step offscreen loop
// that steps the REAL update + render back to back, owning the frame while it runs.
if (/[?&](lab|bench)/.test(location.search)) import('./lib/bench.js').then(B => B.installBench({
  hold(on) { benchHold = !!on; if (!on) { clock.getDelta(); frameDue = 0; } },
  profOn(o) { prof = o; },
  // One whole frame exactly as frame() runs it, minus the governor and the perf judge.
  update(dt, t) { flushSize(); update(dt, t); },
  sky: () => renderSky(), refraction: () => renderRefraction(), post: (dt) => render(dt),
  // Stand Sal on zone z's seabed at (x, z), facing yaw, camera snapped behind him: the
  // bench's views are reproducible spots, not wherever the last probe left him.
  place(x, zz, yaw = 0, zi = zone) {
    if (zi !== zone) enterZone(zi);
    player.pos.set(x, terrainH(x, zz, zi) + 0.05, zz); player.vel.set(0, 0, 0); player.yaw = yaw;
    player.grounded = true; player.onDeck = false;
    snapCamBehind(false);
    return { y: player.pos.y, zone };
  },
  where: () => ({ zone, pos: player.pos.toArray(), yaw: player.yaw, cam: camera.position.toArray(), rift: [0, 1, 2].map(i => riftPos(i)),
    lev: lev && lev.head ? lev.head.toArray() : null })
})).catch(e => console.warn('bench: ' + e));

// DEV: the weather/light lab. One guard, dynamic import — a normal load never fetches it.
if (location.search.includes('lab')) import('./ui/lab.js').catch(e => console.warn('lab: ' + e));
