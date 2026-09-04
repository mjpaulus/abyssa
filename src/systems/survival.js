// Surface-supplied air economy: oxygen, pump fuel, salvage, and crafting.
// Pure state + rules; rendering lives in tether.js / raft.js and the HUD in game.js.
// OWNED BY: orchestrator.
import { clamp } from '../lib/math.js';

// Enough line to work all of zone 0 even when the leviathan wanders to the far rim —
// reachability must never depend on where the creature happens to be swimming.
export const HOSE_START = 380;
// THE HOSE IS A GRIND, NOT A GATE: one craft was 80 (a fifth of the reel's headroom),
// and the zone-1 gate sat one craft above the start — met once, forgotten. At 120 per
// craft and gates of 640/920 the reel is worked three times before zone 1 and five
// before zone 2, and every visit to the raft with polymer still matters.
export const HOSE_PER_CRAFT = 120;
export const HOSE_MAX = 1000;       // reaches the floor of zone 2 at the world's edge

// Descent is gated on line explicitly rather than on how deep the hose physically
// stretches, so terrain shape and creature wander can never soft-lock progression.
export const HOSE_REQ = [0, 640, 920];
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
  spears: 0,          // loaded spears; spent ones stick in the world and can be recovered
  // Accumulator bottle for the air thruster: one burst spends all of it. It refills off
  // the hose, so an unsupplied diver gets his bottle back at a crawl. game.js owns the
  // recharge (it has dt and the play-state gate); it lives here so the HUD, the debug
  // surface and the respawn path all read one authoritative value.
  thrustCharge: 1,
  // THE TORN DRESS. Seconds left on a tear: a bite or a sleeper's slam opens the suit
  // and the tenders cannot out-pump the hole — supplied air refills at half rate until
  // it runs out. Stacking hits EXTEND the tear (capped), they never halve twice.
  torn: 0,
  // THE GASP. Seconds the line is actually stopped: a storm-peak sputter (game.js sets
  // it) cuts `supplied`, so supplied air is threatenable at all — the tank drains at
  // depth rate, the bottle recharges at a crawl, the HUD reads the line as dead.
  sputter: 0
};
export const SPUTTER_SEC = 2.2;

export const TORN_SEC = 20;
const TORN_CAP = 45;
const TORN_REFILL = 0.5;            // refill multiplier while torn
// Returns true when this call opened a NEW tear (the game says so once); false when it
// only extended one already open.
export function tearDress(sec = TORN_SEC) {
  const fresh = survival.torn <= 0;
  survival.torn = Math.min(TORN_CAP, Math.max(0, survival.torn) + sec);
  return fresh;
}
export function mendDress() { survival.torn = 0; }
// The live refill rate, for the HUD and for probes: what the line is actually giving him.
export function o2RefillRate() { return O2_REFILL * (survival.torn > 0 ? TORN_REFILL : 1); }

// The pump only burns fuel while the diver is actually down the line.
// FUEL: a full tank is seven minutes. At four (1/240) zone 2 was a death by arithmetic:
// the descent alone spent more than the tank held, and the bitumen to refill it lay on
// the floor he could not reach. Seven covers a zone-2 descent, its floor and the climb
// with a margin that is thin, not fictional.
const FUEL_BURN = 1 / 420;
// REFILL: 0.28/s topped the tank in under four seconds, so nothing that costs air ever
// cost anything while the line ran. 0.10/s (ten seconds from empty) makes a bite, a
// burst and a gasp each leave a mark that has to be waited out. The torn-dress halving
// still applies on top.
const O2_REFILL = 0.10;
const O2_BASE_DRAIN = 1 / 45;       // unsupplied, roughly 45s at the surface
const O2_DEPTH_FACTOR = 1.9;        // pressure makes each breath cost more

// depth01: 0 at surface, 1 at the deepest point. lightOut: lantern has failed,
// which drives panic breathing and couples the two meters without a second death rule.
export function updateSurvival(dt, depth01, submerged, lightOut) {
  if (submerged && survival.fuel > 0) survival.fuel = Math.max(0, survival.fuel - FUEL_BURN * dt);

  const pumpRunning = survival.fuel > 0;
  if (survival.sputter > 0) survival.sputter = Math.max(0, survival.sputter - dt);
  survival.supplied = pumpRunning && survival.tautness < 1 && survival.sputter <= 0;

  if (survival.torn > 0) survival.torn = Math.max(0, survival.torn - dt);

  if (survival.supplied) {
    survival.oxygen = Math.min(1, survival.oxygen + o2RefillRate() * dt);
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

// Surfacing at the raft tops the diver back up and the tenders patch the dress; the
// pump keeps whatever fuel it has.
export function resupplyAtRaft() {
  survival.oxygen = 1;
  survival.torn = 0;
}
