// The sleepers — ONE import path for the game (game.js, tools.js). Each zone's colossus
// is a KIND: cfg.kind in config.js LEVIATHAN_CFG picks the creature module, and a chart
// row (`over`) or the lab can override it. Every kind returns the same sleeper object
// shape the game reads — head, spine (collision centres), size, name, sigils, calmed —
// and the same update event { sigilLit, calmed, lightDrain, slam, remaining, msg }.
// Shared machinery lives in sleeper/common.js; see roadmap/three-sleepers.md.
import * as THREE from 'three';
import { LEVIATHAN_CFG } from '../config.js';
import { seededRand } from '../lib/textures.js';
import { disposeSleeper } from './sleeper/common.js';
import { makeSerpent, updateSerpent, BODY_R_MAX } from './sleeper/serpent.js';
import { makeBrooder, updateBrooder } from './sleeper/brooder.js';

export { BODY_R_MAX };
export { revealWards, wardRevealLeft, MSG_WARDS_ANSWER, MSG_WARDS_DARK, MSG_WARDS_KEPT } from './sleeper/common.js';

const KINDS = {
  serpent: { make: makeSerpent, update: updateSerpent },
  brooder: { make: makeBrooder, update: updateBrooder }
};
export const sleeperKinds = () => Object.keys(KINDS);

// `over` is THE CHART's authored sleeper row for a remote site (nSigils/hue/name, and
// optionally kind). It merges over the shipped config and flows through the creature.
export function makeLeviathan(idx, over) {
  const c = over ? Object.assign({}, LEVIATHAN_CFG[idx], over) : LEVIATHAN_CFG[idx];
  const kind = KINDS[c.kind] ? c.kind : 'serpent';
  const L = KINDS[kind].make(idx, c);
  L.kind = kind;
  return L;
}

export function updateLeviathan(L, dt, t, player) {
  return KINDS[L.kind].update(L, dt, t, player);
}

export function disposeLeviathan(L) { disposeSleeper(L); }

// ---- REGRESSION ANCHOR --------------------------------------------------------------
// Build zone idx's sleeper under a seeded Math.random, step it `frames` fixed 1/60 s
// frames against a parked player 12 u off the head, and FNV-1a hash what came out
// (events, head, spine, ward positions, a stride of the body surface). Disposes what it
// built. The CALLER owns the live sleeper: this touches the shared ward light pool and
// the module's live pointer, so game.js tears the live one down first and rebuilds after.
// Values are rounded to 1e-4 before hashing so a harmless reassociation can't flip it.
export function sleeperFingerprint(idx, over, frames = 120) {
  // Warm the lazy module caches first (one of them draws Math.random on its first
  // build), so the seeded run below sees the same stream on every call.
  disposeLeviathan(makeLeviathan(idx, over));
  const R0 = Math.random;
  Math.random = seededRand(0x51EE9E11);
  let h = 0x811c9dc5;
  const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
  const mix = v => { f32[0] = Math.round(v * 1e4) / 1e4; h ^= u32[0]; h = Math.imul(h, 0x01000193) >>> 0; };
  let L = null;
  try {
    L = makeLeviathan(idx, over);
    const player = { pos: L.head.clone().add(new THREE.Vector3(12, 0, 0)), vel: new THREE.Vector3() };
    for (let f = 0; f < frames; f++) {
      const ev = updateLeviathan(L, 1 / 60, f / 60, player);
      mix(ev.sigilLit); mix(ev.lightDrain); mix(ev.remaining); mix(ev.slam ? 1 : 0);
    }
    mix(L.head.x); mix(L.head.y); mix(L.head.z);
    for (const s of L.spine) { mix(s.x); mix(s.y); mix(s.z); }
    for (const g of L.sigils) { mix(g.grp.position.x); mix(g.grp.position.y); mix(g.grp.position.z); mix(g.lit ? 1 : 0); }
    if (L.bodyGeo) { const a = L.bodyGeo.attributes.position.array; for (let i = 0; i < a.length; i += 7) mix(a[i]); }
  } finally {
    if (L) disposeLeviathan(L);
    Math.random = R0;
  }
  return h.toString(16).padStart(8, '0');
}
