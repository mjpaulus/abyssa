// THE BURIAL — Velkath asleep as a rock with an old harpoon in it (velkath-buried-rock; spec
// docs/superpowers/specs/2026-10-14-velkath-buried-rock-design.md; Michael 2026-10-14: "it would be interesting if she was buried
// in the sand and looked like a rock"). HOME ONLY (Michael 2026-10-15: "we should focus on getting one right now"): the site row's
// sleepers[0].bury switches it on; without it nothing here is called and she is the shipped ridge bit for bit.
// ONE VALUE DRIVES IT: L.bury, 0 risen .. 1 buried. brooder.js poseAll sinks her body L.buryD * L.bury under her bed; the mound is
// drawn over her at L.bury; the crust shades her shell at L.bury. Fits run at events (her build, the dig-in's start), never per
// frame; zero per-frame allocation.
import * as THREE from 'three';
import { V3 } from '../../lib/math.js';
import { terrainH } from '../../world/terrain.js';

// crest   u: her crest's top over the mean ground under her (spec: 3-4 u); the row may set it (home: 3.5)
// on      dev A/B (__burial.set): 0 = the shipped ridge at home too
export const BURY = { on: 1, crest: 3.5 };
const _v = V3();

// the mean ground under her: poseAll's own 5 x 5 support grid over her footprint, bare floor
export function meanGround(L) {
  const cy = Math.cos(L.yaw), sy = Math.sin(L.yaw), R = L.R;
  let s = 0;
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
    const lx = (-0.8 + 0.4 * i) * R, lz = (-0.84 + 0.425 * j) * R;
    s += terrainH(L.pos.x + lx * cy + lz * sy, L.pos.z - lx * sy + lz * cy, L.idx);
  }
  return s / 25;
}
// THE SINK (spec §1: "the depth that puts the crest's top 3–4 u above the mean ground under her"), read off her DRAWN shell in the
// pose she is in (L.bury 0): its highest vertex, less the sleeping breath's lift at this instant (L.breathU) so the depth does not
// depend on the phase of a breath at the fit.
export function fitSink(L, crest) {
  const sh = L.parts.shell, P = sh.geometry.attributes.position;
  L.body.updateMatrixWorld(true);
  const mw = sh.matrixWorld;
  let top = -1e9;
  for (let i = 0; i < P.count; i++) { _v.fromBufferAttribute(P, i).applyMatrix4(mw); if (_v.y > top) top = _v.y; }
  L.meanG = meanGround(L);
  L.crestTop0 = top - L.breathU;
  return Math.max(0, L.crestTop0 - L.meanG - crest);
}

if (typeof window !== 'undefined') window.__burial = {
  knobs: BURY,
  state: () => { const L = window.__sl; return L && L.kind !== undefined ? { buried: !!L.buried, bury: L.bury, buryD: L.buryD, crest: L.crest, meanG: L.meanG } : null; },
  // patch the knobs (a `crest` key also writes the live home row) and rebuild the zone's sleeper IN PLACE (__lev.remember(null):
  // a fresh build at her bed, as enterZone builds her; __lev.swap would set her down in front of the diver)
  async set(p) {
    for (const k in p) { if (BURY[k] && typeof BURY[k] === 'object' && !Array.isArray(BURY[k])) Object.assign(BURY[k], p[k]); else BURY[k] = p[k]; }
    if ('crest' in p) { const S = await import('../../world/site.js'); const r = S.currentSite().sleepers[0]; if (r && r.bury) r.bury.crest = p.crest; }
    window.__lev.remember(null); return this.state();
  }
};
