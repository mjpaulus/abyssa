// Surface-supplied air economy: oxygen, pump fuel, salvage, and crafting.
// Pure state + rules; rendering lives in tether.js / raft.js and the HUD in game.js.
// OWNED BY: orchestrator.
import { clamp } from '../lib/math.js';

// Enough line to work all of zone 0 even when the leviathan wanders to the far rim —
// reachability must never depend on where the creature happens to be swimming.
export const HOSE_START = 380;
export const HOSE_PER_CRAFT = 80;
export const HOSE_MAX = 1000;       // reaches the floor of zone 2 at the world's edge

// Descent is gated on line explicitly rather than on how deep the hose physically
// stretches, so terrain shape and creature wander can never soft-lock progression.
export const HOSE_REQ = [0, 480, 720];
export function canDescendTo(zoneIndex) {
  return survival.hose >= (HOSE_REQ[zoneIndex] || 0);
}
export const POLYMER_PER_HOSE = 3;
export const BITUMEN_PER_FUEL = 2;
export const FUEL_PER_CRAFT = 0.25;

export const survival = {
  oxygen: 1,          // 0..1, the only lethal resource
  fuel: 1,            // 0..1, pump fuel at the raft
  hose: HOSE_START,   // metres of umbilical paid out
  polymer: 0,         // crafts hose
  bitumen: 0,         // crafts fuel
  supplied: true,     // is air actually reaching the helmet right now
  tautness: 0,        // 0..1, how close to the end of the hose
  ink: 0,             // squid-ink sacs: deployable smoke that breaks a shark's charge
  // relic tools, discovered at the wrecks
  hasSonar: false,
  hasSpear: false,
  hasThruster: false,
  spears: 0           // loaded spears; spent ones stick in the world and can be recovered
};

// The pump only burns fuel while the diver is actually down the line.
const FUEL_BURN = 1 / 240;          // a full tank runs about four minutes
const O2_REFILL = 0.28;             // supplied air recovers quickly
const O2_BASE_DRAIN = 1 / 45;       // unsupplied, roughly 45s at the surface
const O2_DEPTH_FACTOR = 1.9;        // pressure makes each breath cost more

// depth01: 0 at surface, 1 at the deepest point. lightOut: lantern has failed,
// which drives panic breathing and couples the two meters without a second death rule.
export function updateSurvival(dt, depth01, submerged, lightOut) {
  if (submerged && survival.fuel > 0) survival.fuel = Math.max(0, survival.fuel - FUEL_BURN * dt);

  const pumpRunning = survival.fuel > 0;
  survival.supplied = pumpRunning && survival.tautness < 1;

  if (survival.supplied) {
    survival.oxygen = Math.min(1, survival.oxygen + O2_REFILL * dt);
  } else {
    const panic = lightOut ? 1.5 : 1;
    survival.oxygen -= O2_BASE_DRAIN * (1 + depth01 * O2_DEPTH_FACTOR) * panic * dt;
    survival.oxygen = Math.max(0, survival.oxygen);
  }
  return survival.oxygen <= 0;
}

export function canCraftHose() {
  return survival.polymer >= POLYMER_PER_HOSE && survival.hose < HOSE_MAX;
}
export function craftHose() {
  if (!canCraftHose()) return false;
  survival.polymer -= POLYMER_PER_HOSE;
  survival.hose = Math.min(HOSE_MAX, survival.hose + HOSE_PER_CRAFT);
  return true;
}

export function canCraftFuel() {
  return survival.bitumen >= BITUMEN_PER_FUEL && survival.fuel < 1;
}
export function craftFuel() {
  if (!canCraftFuel()) return false;
  survival.bitumen -= BITUMEN_PER_FUEL;
  survival.fuel = clamp(survival.fuel + FUEL_PER_CRAFT, 0, 1);
  return true;
}

export function collect(kind) {
  if (kind === 'polymer') survival.polymer++;
  else if (kind === 'bitumen') survival.bitumen++;
}

// Surfacing at the raft tops the diver back up; the pump keeps whatever fuel it has.
export function resupplyAtRaft() {
  survival.oxygen = 1;
}
