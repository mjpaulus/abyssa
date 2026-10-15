// L2b: HEIGHT-TIED SHADING (Task 13). The terrain shader reads hb = vColor.b = clamp((h - ZB[0] - 2) / 220, 0, 1), ZB[0] = -260, and uses it twice:
// rockW's smoothstep argument += 0.10 hb, and albedo *= 0.86 + 0.20 wn.y + 0.10 hb. A CAPTURE / PROBE TOOL, NOT A GATE (always exits 0). For each build:
//   1. the share of the open floor that sits at hb = 0 (clamped) and the albedo factor's range over it (from terrainH, 2 u grid, r < 200, off the apron);
//   2. for four fixed views (same lens x, z, yaw, pitch on both builds), the WHOLE height-tied term measured as a picture difference: after a 300-frame
//      pre-roll, captures ALTERNATE A B A B A (A = as shipped; B = every BASIN mesh's colour.b set to 0: hb = 0 everywhere, no height tie at all), each settled 30.
//      The tie's contribution is diff(A, B) and the signed mean luma shift of the lower 40% of the frame (the floor), + = brighter without the tie, against the
//      same two numbers between the A captures themselves (the noise: the post chain and the swaying plants).
//   DRV_PORT=9520 node tools/relief/render/shade.mjs <port> <tag> [outdir]       branch: 8870 / 9520;  main: 8871 / 9521
// Writes <outdir>/<tag>-shade.json. It changes nothing in the game: the colour attribute is restored from a copy.
const [, , PORT, TAG = 'shade', OUTD = '/Users/michaelpaulus/sc/.abyssa-wt/shots/relief-look'] = process.argv;
if (!process.env.DRV_PORT) { console.error('shade.mjs: set DRV_PORT (9520 branch, 9521 main)'); process.exit(2); }
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync } = await import('node:fs'); const { tmpdir } = await import('node:os');
const { dirname, join } = await import('node:path'); const { fileURLToPath } = await import('node:url');
process.env.DRV_DIR = mkdtempSync(tmpdir() + '/abyssa-relief-shade-');
const { start, stop, connect, sleep } = await import('../../bench/drv.mjs');
mkdirSync(OUTD, { recursive: true });
await start(`http://localhost:${PORT}/?bench&playtest`);
process.on('exit', () => stop());
const c = await connect();
await c.until(`!document.getElementById('load') && typeof window.setState === 'function' && window.__bench`, 240000, 1000);
await c.ev(`(window.__helm = true, window.setState('play'), window.__bench.size(1512, 982), window.__drs.pin(1), window.__power.set(60, 60), window.weather.set(1, 0), 1)`);
await sleep(4000);
await c.ev(`(async () => { ${readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'lens.page.js'), 'utf8')} })()`);

const out = await c.ev(`(async () => {
  const k = window.__lk, F = k.F, S = k.S, T = k.T, B = window.__bench;
  const { scene } = await import('/src/core.js');
  // 1. hb over the open floor
  let n = 0, z0 = 0, sum = 0; const hbs = [];
  for (let z = -200; z <= 200; z += 2) for (let x = -200; x <= 200; x += 2) {
    if (Math.hypot(x, z) > 200 || S.fissureDist(x, z, 0) < 14) continue;
    const hb = Math.max(0, Math.min(1, (k.g(x, z) - (-260) - 2) / 220)); n++; if (hb === 0) z0++; sum += hb; hbs.push(hb);
  }
  hbs.sort((a, b) => a - b); const q = p => +hbs[Math.floor((hbs.length - 1) * p)].toFixed(4);
  const hbStat = { n, shareHbZero: +(z0 / n).toFixed(3), mean: +(sum / n).toFixed(4), p5: q(0.05), p50: q(0.5), p95: q(0.95), max: q(1),
    albedoFlatFactor: { atZero: +(0.86 + 0.20 + 0).toFixed(4), atP50: +(1.06 + 0.1 * q(0.5)).toFixed(4), atP95: +(1.06 + 0.1 * q(0.95)).toFixed(4), atMax: +(1.06 + 0.1 * q(1)).toFixed(4) } };
  // 2. the picture difference
  const meshes = []; scene.traverse(o => { if (o.isMesh && o.geometry && o.geometry.attributes && o.geometry.attributes.color && o.material && o.material.userData && o.material.userData.zoneU && o.geometry.attributes.position.count === 289 * 289) meshes.push(o); });   // the three BASIN meshes only (the fissure patch and the strata walls carry other things in colour.b)
  const saved = meshes.map(m => m.geometry.attributes.color.array.slice());
  const setB = on => meshes.forEach((m, i) => { const a = m.geometry.attributes.color.array, s = saved[i]; for (let q = 2; q < a.length; q += 3) a[q] = on ? 0 : s[q]; m.geometry.attributes.color.needsUpdate = true; });
  const luma = (cap, y0, y1) => { let s = 0, m = 0; for (let y = y0; y < y1; y++) for (let x = 0; x < cap.w; x++) { const i = (y * cap.w + x) * 4; s += 0.2126 * cap.px[i] + 0.7152 * cap.px[i + 1] + 0.0722 * cap.px[i + 2]; m++; } return s / m; };
  const Lc = Math.hypot(F.cx, F.cz), ux = F.cx / Lc, uz = F.cz / Lc, neYaw = Math.atan2(ux, uz);
  const views = [
    ['raft-landing', () => k.view(-8, -8, Math.atan2(F.cx + 8, F.cz + 8), -0.15)],
    ['bed-station', () => k.view(89.7 - 40 * ux, 39.1 - 40 * uz, neYaw, 0.06)],
    ['hollow-floor-down', () => k.view(75, 5, neYaw, -0.45)],
    ['upland-ridge', () => k.view(-75, -135, Math.atan2(F.cx + 75, F.cz + 135), -0.10)]];
  const res = {};
  for (const [name, set] of views) {
    set(); k.refill(); B.step(300, null, { render: true });   // a long pre-roll: the floor's luma drifts for several seconds after a move (measured +5% over 7 captures, with the tie restored)
    // A B A B A: alternate, so the drift is shared (A = as shipped, B = hb = 0 everywhere), settle 30 each
    const caps = [];
    for (const on of [false, true, false, true, false]) { setB(on); B.step(10, null, { render: true }); const cp = await B.capture({ settle: 30, frames: 12 }); caps.push({ on, cp, floor: luma(cp, Math.round(cp.h * 0.6), cp.h), all: luma(cp, 0, cp.h) }); }
    setB(false);
    const As = caps.filter(q => !q.on), Bs = caps.filter(q => q.on), mean = a => a.reduce((p, q) => p + q, 0) / a.length;
    const dAB = [], dAA = []; for (const a of As) for (const b of Bs) dAB.push(B.diff(a.cp, b.cp)); for (let x = 0; x < As.length; x++) for (let y = x + 1; y < As.length; y++) dAA.push(B.diff(As[x].cp, As[y].cp));
    const dm = (a, f) => +mean(a.map(d => d[f])).toFixed(4);
    res[name] = { basinMeshes: meshes.length, floorLumaA: As.map(q => +q.floor.toFixed(2)), floorLumaNoHb: Bs.map(q => +q.floor.toFixed(2)),
      floorShiftPct_noHb: +((mean(Bs.map(q => q.floor)) - mean(As.map(q => q.floor))) / mean(As.map(q => q.floor)) * 100).toFixed(2),
      floorSpreadPct_AA: +((Math.max(...As.map(q => q.floor)) - Math.min(...As.map(q => q.floor))) / mean(As.map(q => q.floor)) * 100).toFixed(2),
      diffMean_AvsNoHb: dm(dAB, 'mean'), diffMean_AvsA: dm(dAA, 'mean'), gt8_AvsNoHb: dm(dAB, 'gt8'), gt8_AvsA: dm(dAA, 'gt8'), exposure: window.__exposure.state().mult };
  }
  return { fp: window.__ridge.fp(), hbStat, views: res };
})()`);
writeFileSync(`${OUTD}/${TAG}-shade.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out.hbStat)); for (const [k, v] of Object.entries(out.views)) console.log(k, JSON.stringify(v));
c.close();
process.exit(0);
