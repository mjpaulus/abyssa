// WALK-IN UNDER HER (ritefair, 2026-10-09; Michael at 60 fps: "I was struggling to get under her
// as she was crouched too low and I kept colliding"). Two measurements on the live pose:
//  1. LANES + CLEARANCE (geometry, no input): with her woken and risen, from 4 bearings about
//     her heading (front, right, back, left) the free arc a 0.45 u-radius diver fits through at
//     the rim (radii 1.15/1.0/0.85/0.7 R, his capsule at 0.45/1.0/1.8 u over the floor), and
//     the lowest part of her over the floor along each line in (shell, leg, claw or clutch).
//  2. WALK-IN (real keys): Sal stood 1.8 R out on each bearing, facing her centre, W+Shift in
//     0.25 s slices re-aimed at her centre each slice, up to 12 s: reached under (< 0.35 R)?
//     time, closest, frames in contact, the hardest part speed that met him (hitV), slams,
//     her crouch and the belly clearance over his floor when he got there.
// Her states: 'held' (lab hold: risen, standing still, not tracking) and 'hunt' (unheld).
//   node tools/bench/ritefair-walkin.mjs <port> <tag> [site home|pallid]
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
if (!process.env.DRV_PORT) process.env.DRV_PORT = '9471';
if (!process.env.DRV_DIR) process.env.DRV_DIR = tmpdir() + '/abyssa-wi-' + process.env.DRV_PORT + '-' + Date.now();
const { start, stop, connect, sleep } = await import('./drv.mjs');
const [, , PORT, TAG = 'walkin', SITE = 'home'] = process.argv;
const OUT = '/Users/michaelpaulus/sc/.abyssa-wt/shots/ritefair-play';
await start(`http://localhost:${PORT}/?playtest&bench`);
const c = await connect();
await c.until(`!document.getElementById('load') && typeof window.setState === 'function' && window.__bench`, 240000, 1000);
await c.ev(`(window.__helm = true, window.setState('play'), 1)`);
await sleep(3000);
const alt = async code => {
  await c.ev(`(window.dispatchEvent(new KeyboardEvent('keydown', { code: '${code}', key: 'x', altKey: true, bubbles: true })), window.dispatchEvent(new KeyboardEvent('keyup', { code: '${code}', key: 'x', altKey: true, bubbles: true })), 1)`);
  await c.ev(`(window.__helm = true, window.__bench.step(90), 1)`);
};
if (SITE === 'pallid') { await alt('Minus'); await sleep(4000); await c.ev(`(window.__bench.step(120), 1)`); }
await alt('Digit6');
await sleep(1000);
await c.ev(`(window.__bench.step(30), 1)`);
// the probe surface
await c.ev(`(async () => {
  const BC = await import('/src/entities/sleeper/bodyCols.js');
  const L = window.lev, P = window.player, R = L.R;
  const fl = (x, z) => terrainH(x, z, 0);
  const dirOf = b => { const a = L.yaw + b * Math.PI / 180; return [Math.sin(a), Math.cos(a)]; };
  const free = (x, z) => { const f = fl(x, z); for (const h of [0.45, 1.0, 1.8]) if (BC.bodyBlocked(x, f + h, z, 0.45)) return false; return true; };
  // the free arc (u) through bearing b at radius r: if b itself is blocked, the nearest free arc inside +-30 deg
  const arc = (b, r) => {
    const cx = L.pos.x, cz = L.pos.z;
    const ok = d => { const [sx, sz] = dirOf(b + d); return free(cx + sx * r, cz + sz * r); };
    let c0 = null;
    for (let k = 0; k <= 60 && c0 === null; k++) for (const s of [1, -1]) { const d = s * k * 0.5; if (ok(d)) { c0 = d; break; } }
    if (c0 === null) return { w: 0, off: null };
    let lo = c0, hi = c0;
    while (hi - c0 < 90 && ok(hi + 0.5)) hi += 0.5;
    while (c0 - lo < 90 && ok(lo - 0.5)) lo -= 0.5;
    return { w: +((hi - lo + 0.5) * Math.PI / 180 * r).toFixed(2), off: c0 };
  };
  // the lowest part of her over the floor along the line in on bearing b (from 1.2 R to her centre)
  // (why: -1 shell, -3 clutch, >= 0 a limb capsule; taken at the minimum)
  const roof = (b, q0 = 1.2, q1 = 0) => {
    let lo = 99, at = null, why = null;
    const [sx, sz] = dirOf(b);
    for (let q = q0; q >= q1 - 0.01; q -= 0.05) {
      const x = L.pos.x + sx * q * R, z = L.pos.z + sz * q * R, f = fl(x, z);
      for (let h = 0.1; h < 14; h += 0.1) if (BC.bodyBlocked(x, f + h, z, 0)) { if (h < lo) { lo = h; at = +q.toFixed(2); why = BC.blockWhy; } break; }
    }
    return { clear: +lo.toFixed(1), atR: at, why };
  };
  // a start for the walk-in on bearing b: on her plateau (within 5 u of the floor under her,
  // gentle), 1.5-2.2 R out, within +-25 deg; null = no walkable approach from that side
  const startAt = b => {
    const f0 = fl(L.pos.x, L.pos.z);
    for (const q of [1.8, 1.6, 2.0, 2.2, 1.5]) for (const d of [0, 10, -10, 20, -20, 25, -25]) {
      const [sx, sz] = dirOf(b + d), x = L.pos.x + sx * q * R, z = L.pos.z + sz * q * R, f = fl(x, z);
      const sl = Math.hypot(fl(x + 1, z) - fl(x - 1, z), fl(x, z + 1) - fl(x, z - 1)) / 2;
      if (Math.abs(f - f0) < 5 && sl < 0.45) return { x, z, q, d };
    }
    return null;
  };
  window.__wi = {
    anat: () => {
      const r = x => +x.toFixed(2), m = L.brood ? new (P.pos.constructor)(0, -0.47, -0.27).applyMatrix4(L.body.matrixWorld) : null;
      return { standE: r(L.standE), threatE: r(L.threatE), crouch: r(L.crouch ? L.crouch.x : 0), bellyOver: r(L.bellyOver || 0), soleLift: r(L.soleLift || 0),
        bodyOverFloor: r(L.bodyY - fl(L.pos.x, L.pos.z)), wards: L.sigils.map(g => r(g.grp.position.y - fl(g.grp.position.x, g.grp.position.z))),
        massBottom: m ? r(m.y - fl(m.x, m.z)) : null };
    },
    lanes: () => [0, 90, 180, 270].map(b => ({ b, arcs: [1.15, 1.0, 0.85, 0.7].map(q => arc(b, q * R)), roof: roof(b) })),
    put: b => { const s = startAt(b); if (!s) return null; window.__bench.place(s.x, s.z, Math.atan2(L.pos.x - s.x, L.pos.z - s.z), 0); return { q: s.q, d: s.d }; },
    far: () => { const [sx, sz] = dirOf(0); window.__bench.place(L.pos.x + sx * 70, L.pos.z + sz * 70, 0, 0); },
    // rim/lane roofs on all four bearings (the approach lanes, 1.2 R .. 0.5 R) and under him
    lanesRoof: () => [0, 90, 180, 270].map(b => roof(b, 1.2, 0.5).clear),
    slice: () => { const r = x => +x.toFixed(2); return { d: r(Math.hypot(L.pos.x - P.pos.x, L.pos.z - P.pos.z) / R), g: !!P.grounded, v: r(Math.hypot(P.vel.x, P.vel.z)), vy: r(P.vel.y), her: r(Math.hypot(L.vel.x, L.vel.z)), thr: r(L.threatE), cr: r(L.crouch ? L.crouch.x : 0), cont: BC.BODY.contacts, agl: r(P.pos.y - 1.35 - fl(P.pos.x, P.pos.z)) }; },
    aim: () => { P.yaw = Math.atan2(L.pos.x - P.pos.x, L.pos.z - P.pos.z); P.pitch = 0; return +(Math.hypot(L.pos.x - P.pos.x, L.pos.z - P.pos.z) / R).toFixed(3); },
    run: n => { const st = window.__wi.st; window.__bench.step(n, () => {
      const B = BC.BODY; if (B.contacts > 0) st.contact++; if (B.hitV > st.hitV) st.hitV = B.hitV; st.push += B.push || 0;
      if (window.survival.torn > st.torn + 0.5) st.slams++; st.torn = window.survival.torn;
      if (st.lane && (st.k = (st.k || 0) + 1) % 6 === 0) { const lr = window.__wi.lanesRoof(); for (let j = 0; j < 4; j++) if (lr[j] < st.lane[j]) st.lane[j] = lr[j]; }
      const d = Math.hypot(L.pos.x - P.pos.x, L.pos.z - P.pos.z) / R; if (d < st.minD) st.minD = d;
      if (L.crouch && L.crouch.x > st.crouchMax) st.crouchMax = L.crouch.x; }); return 1; },
    st: null
  };
  return 1;
})()`);
// take (real E) and let her rise
await c.key('KeyE', true); await c.ev(`(window.__bench.step(2), 1)`); await c.key('KeyE', false);
await c.ev(`(window.__bench.step(8 * 60), 1)`);
const res = { site: SITE, held: {}, hunt: {}, crouch: null };
for (const mode of ['held', 'hunt']) {
  if (mode === 'held') await c.ev(`(window.lev.hold || window.lev.cmd('hold'), 1)`);
  else await c.ev(`(window.lev.hold && window.lev.cmd('hold'), 1)`);
  // her pose with Sal far out (no crouch)
  await c.ev(`(window.__wi.far(), window.__bench.step(60), 1)`);
  res[mode].anat = await c.ev(`window.__wi.anat()`);
  res[mode].lanes = await c.ev(`window.__wi.lanes()`);
  res[mode].walk = [];
  for (const b of [0, 90, 180, 270]) {
    const at = await c.ev(`window.__wi.put(${b})`);
    if (!at) { res[mode].walk.push({ b, start: 'no walkable approach (rift bowl / slope)' }); continue; }
    await c.ev(`(window.__bench.step(20), window.__wi.st = { contact: 0, hitV: 0, push: 0, slams: 0, torn: window.survival.torn, minD: 9, crouchMax: 0, lane: [99, 99, 99, 99] }, 1)`);
    let tUnder = null, t = 0, d = 9;
    const trace = [];
    await c.key('KeyW', true); await c.key('ShiftLeft', true);
    for (let i = 0; i < 48; i++) {
      d = await c.ev(`window.__wi.aim()`);
      if (i % 4 === 0) trace.push(await c.ev(`window.__wi.slice()`));
      if (d < 0.35) { tUnder = t; break; }
      await c.ev(`window.__wi.run(15)`); t += 0.25;
    }
    await c.key('KeyW', false); await c.key('ShiftLeft', false);
    await c.ev(`window.__wi.run(60)`);   // stand where he got to a second: the crouch comes down
    const a = await c.ev(`window.__wi.anat()`);
    const st = await c.ev(`window.__wi.st`);
    if (b === 90) { await c.ev(`(window.__bench.step(1, null, { render: true }), 1)`); await c.png(`${OUT}/${TAG}-${mode}-b${b}.png`); }
    res[mode].walk.push({ b, start: at, under: tUnder != null, tUnder, minD: +st.minD.toFixed(2), contactFrames: st.contact, hitV: +st.hitV.toFixed(1), slams: st.slams,
      crouchMax: +st.crouchMax.toFixed(2), crouchNow: a.crouch, bellyOver: a.bellyOver, laneRoofMinDuring: st.lane, wardsNow: a.wards, massBottom: a.massBottom, trace });
  }
}
// THE CROUCH: Sal stood under her (unheld) from far out; the lane roofs on all four bearings
// sampled through the spring's ramp (0 .. 3 s)
{
  await c.ev(`(window.lev.hold && window.lev.cmd('hold'), window.__wi.far(), window.__bench.step(120), 1)`);
  await c.ev(`(window.__bench.place(window.lev.pos.x, window.lev.pos.z, window.lev.yaw, 0), 1)`);
  const ramp = [];
  for (const dt of [0, 0.25, 0.5, 1, 2, 3]) {
    const prev = ramp.length ? ramp[ramp.length - 1].t : 0;
    if (dt > prev) await c.ev(`(window.__bench.step(${Math.round((dt - prev) * 60)}), 1)`);
    const a = await c.ev(`window.__wi.anat()`);
    ramp.push({ t: dt, crouch: a.crouch, bellyOver: a.bellyOver, lanesRoof: await c.ev(`window.__wi.lanesRoof()`), wards: a.wards, massBottom: a.massBottom, bodyOverFloor: a.bodyOverFloor });
  }
  res.crouch = ramp;
  await c.ev(`(window.__bench.step(1, null, { render: true }), 1)`); await c.png(`${OUT}/${TAG}-crouched.png`);
}
console.log(JSON.stringify(res, null, 1));
writeFileSync(`${OUT}/${TAG}.json`, JSON.stringify(res, null, 1));
c.close(); stop(); process.exit(0);
