// BROODERFIX visible proof: frame strips through REAL input (W/E over CDP), plus numbers.
//   TAG=before|after SCEN=chase,leg,ridge,under,cam node tools/bench/brooder-shots.mjs
// Frames land in /Users/michaelpaulus/sc/.abyssa-wt/shots/brooderfix-<TAG>-<scen>-<n>.png
import { connect, sleep } from './drv.mjs';
const OUT = '/Users/michaelpaulus/sc/.abyssa-wt/shots/brooderfix-';
const TAG = process.env.TAG || 'before';
const SCEN = (process.env.SCEN || 'chase,leg,ridge,under,cam').split(',');
const c = await connect();
const shot = async (name) => { await c.png(`${OUT}${TAG}-${name}.png`); };
async function boot() {
  await c.send('Page.reload', { ignoreCache: true });
  await sleep(1500);
  await c.until(`!document.getElementById('load') && typeof window.start === 'function'`, 240000, 500);
  await sleep(1500);
  await c.ev(`(window.__helm = true, 1)`);
  await c.click(640, 400);
  await c.until(`window.__power && __power.state().state === 'play'`, 30000);
  await sleep(2000);
  await c.key('Digit6', true, 1); await sleep(80); await c.key('Digit6', false, 1);
  await sleep(1500);
  await c.ev(`(async () => { window.__T = await import('/src/world/terrain.js'); return 1; })()`);
}
// Sal's body as a vertical capsule (boots+0.45 .. helmet-0.45, r 0.45) against every leg
// segment (instance matrices, body-local -> world) and claw piece (joint chain world
// positions): the worst penetration in world units (positive = inside). Independent of the
// fix's own collider pool, so before and after measure the same thing.
const PEN = `(() => {
  const L = __sl, b = L.body.matrixWorld, R = L.R, p = player.pos;
  const ax = p.x, az = p.z, ay0 = p.y - 1.35 + 0.45, ay1 = p.y + 0.45 - 0.45, rs = 0.45;
  const V = THREE_V, m = THREE_M;
  const RAD = { coxa: 0.12, femur: 0.105, tibia: 0.075, dactyl: 0.04 };
  let worst = -1e9, what = '';
  function segDist(P0, P1) {   // vertical segment (ax, ay0..ay1, az) vs P0-P1: closest distance
    let best = 1e9;
    for (let i = 0; i <= 16; i++) {
      const t = i / 16, x = P0.x + (P1.x - P0.x) * t, y = P0.y + (P1.y - P0.y) * t, z = P0.z + (P1.z - P0.z) * t;
      const yy = Math.max(ay0, Math.min(ay1, y));
      const d = Math.hypot(x - ax, y - yy, z - az);
      if (d < best) best = d;
    }
    return best;
  }
  for (const k of ['coxa', 'femur', 'tibia', 'dactyl']) {
    const im = L.legs[k], L0 = L.segL0[k];
    for (let i = 0; i < 8; i++) {
      im.getMatrixAt(i, m); m.premultiply(b);
      const A = V[0].set(0, 0, 0).applyMatrix4(m), B = V[1].set(L0, 0, 0).applyMatrix4(m);
      const pen = RAD[k] * R + rs - segDist(A, B);
      if (pen > worst) { worst = pen; what = k + i; }
    }
  }
  for (const cl of L.claws) {
    const P = [cl.root, cl.cj, cl.pj, cl.dj].map((o, i) => o.getWorldPosition(V[2 + i].set(0, 0, 0)));
    const tip = V[6].set(0.66, 0, 0).applyMatrix4(cl.dj.matrixWorld);
    const segs = [[P[0], P[1], 0.12], [P[1], P[2], 0.12], [P[2], P[3], 0.12], [P[3], tip, 0.07]];
    for (const [A, B, r] of segs) { const pen = r * R * (cl.major ? 1.35 : 0.72) + rs - segDist(A, B); if (pen > worst) { worst = pen; what = (cl.major ? 'major' : 'minor'); } }
  }
  return [+worst.toFixed(2), what];
})()`;
await c.ev(`(async () => { const T = await import('three'); window.THREE_V = [0,0,0,0,0,0,0].map(() => new T.Vector3()); window.THREE_M = new T.Matrix4(); return 1; })()`).catch(() => 0);
const ST = `(() => { const L = __sl, p = player.pos; return { stand: +L.stand.toFixed(2), thr: +L.threat.toFixed(2), seen: L.seen, pd: +L._pd.toFixed(1), spd: +Math.hypot(L.vel.x, L.vel.z).toFixed(2),
  pos: [+L.pos.x.toFixed(1), +L.pos.z.toFixed(1)], sal: [+p.x.toFixed(1), +p.y.toFixed(2), +p.z.toFixed(1)], lens: +camera.position.distanceTo(p).toFixed(2), camY: +(camera.position.y - p.y).toFixed(2), eggs: L.brood.out() }; })()`;
const TH = `(async () => { const T = await import('three'); window.THREE_V = [0,0,0,0,0,0,0].map(() => new T.Vector3()); window.THREE_M = new T.Matrix4(); return 1; })()`;
const report = {};
// the fix's own colliders: Sal's clearance to the nearest published capsule (negative = inside)
const OWN = `(async () => { const B = await import('/src/entities/sleeper/bodyCols.js'); const C = B.bodyColsCaps(), p = player.pos; let m = [1e9, -1]; for (let i = 0; i < C.length / 8; i++) { const o = i * 8, ax = C[o], ay = C[o+1], az = C[o+2], dx = C[o+3]-ax, dy = C[o+4]-ay, dz = C[o+5]-az, L2 = dx*dx+dy*dy+dz*dz; for (let yy = p.y - 0.9; yy <= p.y + 0.01; yy += 0.15) { let t = ((p.x-ax)*dx+(yy-ay)*dy+(p.z-az)*dz)/L2; t = Math.max(0, Math.min(1, t)); const d = Math.hypot(p.x-ax-dx*t, yy-ay-dy*t, p.z-az-dz*t) - (C[o+6] + (C[o+7]-C[o+6])*t) - 0.45; if (d < m[0]) m = [+d.toFixed(2), i]; } } return m; })()`;
async function standAt(x, z, yaw, pitch = -0.05) {
  await c.ev(`(() => { const y = __T.terrainH(${x}, ${z}, 0) + 1.35; player.pos.set(${x}, y, ${z}); player.vel.set(0, 0, 0); player.yaw = ${yaw}; player.pitch = ${pitch}; return 1; })()`);
}
async function wakeAndHold() {
  await c.tap('KeyE', 100);                         // REAL E: take the egg, she wakes
  await c.until(`__sl.stand >= 1`, 20000);
  await sleep(1500);
  await c.ev(`(__sl.hold = true, __sl.threatTarget = 0, 1)`);   // lab hold: she stands still (framing only)
  await sleep(2500);
}
for (const sc of SCEN) {
  await boot();
  await c.ev(TH);
  if (sc === 'chase') {
    // the take -> wake -> chase, from the game camera: E at the nest, he holds still while
    // she rises, then walks away from her (real W; real C whenever a blow has him off the
    // bottom), looking back at her now and then
    await shot('chase-00-atnest');
    await c.tap('KeyE', 100);
    const rows = [];
    let cDown = false, wDown = false;
    const t0 = Date.now();
    let n = 0;
    while (Date.now() - t0 < 34000) {
      const el = (Date.now() - t0) / 1000;
      if (el > 9 && !wDown) { await c.ev(`(() => { const L = __sl, p = player.pos; player.yaw = Math.atan2(p.x - L.pos.x, p.z - L.pos.z); player.pitch = -0.05; return 1; })()`); await c.key('KeyW', true); wDown = true; }
      const g = await c.ev(`player.grounded`);
      if (!g && !cDown) { await c.key('KeyC', true); cDown = true; } else if (g && cDown) { await c.key('KeyC', false); cDown = false; }
      if (el > n * 2) {
        // every 4th frame he glances back over his shoulder (the lens follows his look)
        const back = wDown && n % 3 === 2;
        if (back) { await c.key('KeyW', false); await c.ev(`(() => { const L = __sl, p = player.pos; player.yaw = Math.atan2(L.pos.x - p.x, L.pos.z - p.z); return 1; })()`); await sleep(700); }
        await shot('chase-' + String(n).padStart(2, '0'));
        rows.push(Object.assign({ el: +el.toFixed(1) }, await c.ev(ST)));
        if (back) { await c.ev(`(() => { const L = __sl, p = player.pos; player.yaw = Math.atan2(p.x - L.pos.x, p.z - L.pos.z); return 1; })()`); await c.key('KeyW', true); }
        n++;
      }
      await sleep(120);
    }
    await c.key('KeyW', false); if (cDown) await c.key('KeyC', false);
    report.chase = rows;
  } else if (sc === 'leg') {
    await wakeAndHold();
    // a foot on her +X side, middle leg: stand 9 u out from it, face it, hold W
    const g = await c.ev(`(() => { const L = __sl, f = L.feet[5].planted, dx = f.x - L.pos.x, dz = f.z - L.pos.z, d = Math.hypot(dx, dz); return [f.x + dx / d * 9, f.z + dz / d * 9, Math.atan2(-dx, -dz)]; })()`);
    await standAt(g[0], g[1], g[2], 0.0);
    await sleep(2000);
    await shot('leg-0');
    await c.key('KeyW', true);
    let worst = -9; const tr = [];
    for (let i = 0; i < 40; i++) { await sleep(150); const pn = await c.ev(PEN); tr.push(pn[0]); if (pn[0] > worst) { worst = pn[0]; report.legWhat = pn[1]; report.legOwn = await c.ev(OWN); } if (i === 14 || i === 26 || i === 39) await shot('leg-' + i); }
    await c.key('KeyW', false);
    report.leg = { worst, tr, st: await c.ev(ST) };
    // the claw: in front of her face, walk into the great claw
    const g2 = await c.ev(`(() => { const L = __sl, cl = L.claws[1].major ? L.claws[1] : L.claws[0], P = cl.pj.getWorldPosition(THREE_V[0].set(0,0,0)); const fx = Math.sin(L.yaw), fz = Math.cos(L.yaw); return [P.x + fx * 8, P.z + fz * 8, Math.atan2(-fx, -fz)]; })()`);
    await standAt(g2[0], g2[1], g2[2], 0.0);
    await sleep(2000); await shot('claw-0');
    await c.key('KeyW', true);
    let w2 = -9; const tr2 = [];
    for (let i = 0; i < 40; i++) { await sleep(150); const pn = await c.ev(PEN); tr2.push(pn[0]); if (pn[0] > w2) w2 = pn[0]; if (i === 20 || i === 39) await shot('claw-' + i); }
    await c.key('KeyW', false);
    report.claw = { worst: w2, tr: tr2, st: await c.ev(ST) };
  } else if (sc === 'ridge') {
    // the dormant ridge: walk straight at her shell from the open side
    const g = await c.ev(`(() => { const L = __sl, fx = Math.sin(L.yaw), fz = Math.cos(L.yaw); return [L.pos.x + fx * 30, L.pos.z + fz * 30, Math.atan2(-fx, -fz)]; })()`);
    await standAt(g[0], g[1], g[2], 0.0);
    await sleep(2000); await shot('ridge-0');
    await c.key('KeyW', true);
    const tr = [];
    for (let i = 0; i < 70; i++) { await sleep(200); tr.push(await c.ev(`(() => { const L = __sl, p = player.pos; return +Math.hypot(p.x - L.pos.x, p.z - L.pos.z).toFixed(1); })()`)); if (i === 30 || i === 50 || i === 69) await shot('ridge-' + i); }
    await c.key('KeyW', false);
    report.ridge = { centreDist: tr, dormant: await c.ev(`__sl.dormant`) };
  } else if (sc === 'under') {
    await wakeAndHold();
    await c.ev(`(async () => { window.__B = await import('/src/entities/sleeper/bodyCols.js'); return 1; })()`);
    // from her flat flank, between legs 5 and 6, walk in under her (real W), then up to the
    // nearest dark ward (real W to stand under it, real Space to rise to it)
    const g = await c.ev(`(() => { const L = __sl, a = L.feet[5].planted, b = L.feet[6].planted, mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, dx = mx - L.pos.x, dz = mz - L.pos.z, d = Math.hypot(dx, dz); return [mx + dx / d * 8, mz + dz / d * 8, Math.atan2(-dx, -dz)]; })()`);
    await standAt(g[0], g[1], g[2], 0.0);
    await sleep(2000); await shot('under-0');
    await c.key('KeyW', true);
    const tr = [];
    let t0 = Date.now(), k = 1;
    while (Date.now() - t0 < 16000) {
      await sleep(200);
      const r = await c.ev(`(() => { const L = __sl, p = player.pos; return [+Math.hypot(p.x - L.pos.x, p.z - L.pos.z).toFixed(1), __B.BODY.under ? 1 : 0, __B.BODY.last, L.sigils.map(g => g.lit ? 1 : 0).join('')]; })()`);
      tr.push(r);
      if (Date.now() - t0 > k * 2500) { await shot('under-' + k); k++; }
      if (r[1]) break;
    }
    await shot('under-in');
    // the nearest dark ward: stand under it, then rise (Space burst, pitched up)
    const w = await c.ev(`(() => { const L = __sl, p = player.pos; let best = null, bd = 1e9; for (const g of L.sigils) { if (g.lit) continue; const d = Math.hypot(g.grp.position.x - p.x, g.grp.position.z - p.z); if (d < bd) { bd = d; best = g; } } return best ? [best.grp.position.x, best.grp.position.z, +(best.grp.position.y - p.y).toFixed(1)] : null; })()`);
    if (w) {
      t0 = Date.now();
      while (Date.now() - t0 < 8000) {
        const d = await c.ev(`(() => { const p = player.pos; player.yaw = Math.atan2(${w[0]} - p.x, ${w[1]} - p.z); return Math.hypot(${w[0]} - p.x, ${w[1]} - p.z); })()`);
        if (d < 1.5) break;
        await sleep(100);
      }
      await c.key('KeyW', false);
      await c.ev(`(player.pitch = 0.6, 1)`);
      await sleep(600);
      await shot('under-ward-0');
      await c.key('Space', true); await sleep(700); await c.key('Space', false);
      for (let i = 1; i <= 3; i++) { await sleep(700); await shot('under-ward-' + i); }
    }
    await c.key('KeyW', false);
    report.under = { tr, ward: w, lit: await c.ev(`__sl.sigils.map(g => g.lit ? 1 : 0).join('')`), eyeAboveFloor: await c.ev(`+(player.pos.y - __T.terrainH(player.pos.x, player.pos.z, 0)).toFixed(1)`) };
  } else if (sc === 'cam') {
    await wakeAndHold();
    // under her, the lens in four directions; then just outside a leg with her body behind him
    const P = await c.ev(`[__sl.pos.x, __sl.pos.z, __sl.yaw]`);
    const rows = [];
    for (let k = 0; k < 4; k++) {
      await standAt(P[0] + Math.sin(P[2]) * 2, P[1] + Math.cos(P[2]) * 2, P[2] + k * Math.PI / 2, 0.15);
      await sleep(2200); await shot('cam-under-' + k);
      rows.push(await c.ev(ST));
    }
    const g = await c.ev(`(() => { const L = __sl, f = L.feet[6].planted, dx = f.x - L.pos.x, dz = f.z - L.pos.z, d = Math.hypot(dx, dz); return [f.x + dx / d * 3.5, f.z + dz / d * 3.5, Math.atan2(dx, dz)]; })()`);
    await standAt(g[0], g[1], g[2], -0.05);
    await sleep(2200); await shot('cam-leg-behind');
    rows.push(await c.ev(ST));
    // lens samples over 3 s while she is released (legs moving): pumping?
    await c.ev(`(__sl.hold = false, 1)`);
    const lens = [];
    for (let i = 0; i < 30; i++) { await sleep(100); lens.push(await c.ev(`+camera.position.distanceTo(player.pos).toFixed(2)`)); }
    await shot('cam-released');
    report.cam = { rows, lens };
  }
}
console.log(JSON.stringify(report));
c.close();
