// THE FISSURE probe (spec docs/superpowers/specs/2026-10-10-fissure-and-harpoon-design.md).
//   node tools/bench/fissure-probe.mjs <shape|jam-stand|throat-edges|slabs|tips|walls|climb-out|open-ledge|floor-readers|opening|jam-mesh|reascend> <port>   (serve.py must already serve <port>)
// Env DRV_PORT (CDP debug port, default 9481). drv.mjs reads DRV_PORT when it is first
// evaluated, so the default is set BEFORE the driver is imported (a static import is hoisted).
const [, , mode, port] = process.argv;
process.env.DRV_PORT = process.env.DRV_PORT || '9481';
// A FRESH PROFILE per run: the game saves its chart (endingSeen, calms) to localStorage, and a run
// that played the ending would turn the next run's zone-2 fall into the quiet ink beat.
const { mkdtempSync, rmSync } = await import('node:fs'); const { tmpdir } = await import('node:os');
process.env.DRV_DIR = mkdtempSync(tmpdir() + '/abyssa-fissure-probe-');
const { start, stop, connect, sleep } = await import('./drv.mjs');
await start(`http://localhost:${port}/?bench&playtest`);
process.on('exit', () => { stop(); try { rmSync(process.env.DRV_DIR, { recursive: true, force: true }); } catch (e) { } });   // a throwing probe must not leave its Chrome on the port
const c = await connect();
await c.until(`!document.getElementById('load') && typeof window.setState === 'function' && !!window.__bench && !!window.__fissure`, 240000, 1000);
const fail = [];
if (mode === 'shape') {
  const r = await c.ev(`(async () => {
    const S = await import('/src/world/fissureShape.js'); const T = await import('/src/world/terrain.js');
    const out = [];
    for (let zi = 0; zi < 3; zi++) {
      const F = S.FISSURE[zi], o = {};
      const atC = T.terrainH(F.cx, F.cz, zi);                          // opening centre
      const lipL = T.terrainH(F.cx + F.dx * F.halfLen * 0.9, F.cz + F.dz * F.halfLen * 0.9, zi);
      const side = T.terrainH(F.cx - F.dz * (F.halfW + 8), F.cz + F.dx * (F.halfW + 8), zi);
      out.push({ zi, len: F.halfLen * 2, w: F.halfW * 2, depthCentre: side - atC, depthEnd: side - lipL,
        inC: S.inThroat(F.cx, F.cz, zi), outSide: S.inThroat(F.cx - F.dz * (F.halfW + 3), F.cz + F.dx * (F.halfW + 3), zi) });
    }
    return out; })()`);
  for (const z of r) {
    if (z.len < 60 || z.len > 80) fail.push(`zone ${z.zi} length ${z.len}`);
    if (z.w < 10 || z.w > 16) fail.push(`zone ${z.zi} width ${z.w}`);
    if (z.depthCentre < 25) fail.push(`zone ${z.zi} throat too shallow ${z.depthCentre}`);
    if (!z.inC || z.outSide) fail.push(`zone ${z.zi} throat test wrong`);
  }
  console.log(JSON.stringify(r));
} else if (mode === 'jam-stand') {
  // SHUT: per zone, stood on the jam over the opening for 5 s he never sinks below it and never
  // jitters (and never leaves the zone); DROPPED onto it from 15 u above the lip (C held, venting)
  // he lands on it, never below. At every site, every zone: the jam is >= 55 u above the calm-gated
  // trigger plane, under both lip points everywhere (stepping in is a step DOWN), the LOWER lip at
  // most 3 u above it along its whole length (spec: "a few units below the lip"), never steeper
  // than 1. The higher lip's height above it is reported.
  const r = await c.ev(`(async () => {
    const S = await import('/src/world/fissureShape.js'); const T = await import('/src/world/terrain.js');
    const C = await import('/src/config.js');
    const EYE_H = 1.35, trig = zi => zi < 2 ? C.zoneBottom(zi) - C.ZONE_GAP * 0.55 : C.zoneBottom(2) - 70;
    window.setState('play'); window.__helm = true; window.survival.hose = 5000;
    const o = { x: 0, z: 0 }, out = { stand: [], drop: [], planes: [] };
    for (let zi = 0; zi < 3; zi++) {
      window.gotoZone(zi); if (window.lev) window.lev.calmed = false; window.__fissure.setOpen(zi, 0);
      const F = S.FISSURE[zi];
      window.__bench.place(F.cx, F.cz, 0, zi);
      const jam = T.shutFloorY(F.cx, F.cz, zi);      // the jam's floor there (the rubble grid; fix round 1)
      window.player.pos.y = jam + EYE_H;            // place() stands him on terrainH: the throat floor
      let minY = 1e9, maxStep = 0, last = null;
      window.__bench.step(300, () => { const y = window.player.pos.y; minY = Math.min(minY, y);
        if (last != null) maxStep = Math.max(maxStep, Math.abs(y - last)); last = y; });
      out.stand.push({ zi, jam: +jam.toFixed(2), minY: +minY.toFixed(3), maxStep: +maxStep.toFixed(4), zone: window.zone,
        grounded: window.player.grounded, drift: +Math.hypot(window.player.pos.x - F.cx, window.player.pos.z - F.cz).toFixed(3) });
      // the drop: 15 u over the lip, over the middle of the crack, venting all the way down
      window.__bench.place(F.cx, F.cz, 0, zi);
      window.player.pos.y = S.lipMeanY(zi, T.terrainH) + 15 + EYE_H; window.player.grounded = false; window.player.vel.set(0, 0, 0);
      let dMin = 1e9, landed = -1;
      window.keys.KeyC = true;
      try { window.__bench.step(1200, i => { const p = window.player.pos, j = T.jamAt(p.x, p.z, zi);
        if (j > -1e8) dMin = Math.min(dMin, p.y - (j + EYE_H));
        if (landed < 0 && window.player.grounded && window.player.jamY != null) landed = i; }); }
      finally { window.keys.KeyC = false; }
      out.drop.push({ zi, landedFrame: landed, minAboveJam: +dMin.toFixed(3), onJam: window.player.jamY != null, zone: window.zone });
    }
    for (const site of [0, 1, 2]) {
      if (site) window.__chart.arrive(site);
      for (let zi = 0; zi < 3; zi++) {
        const F = S.FISSURE[zi], jam = S.jamTopY(zi, T.terrainH);
        let under = 1e9, slope = 0, prev = null, loAbove = 0, hiAbove = 0;
        for (let u = -F.halfLen; u <= F.halfLen + 1e-9; u += 0.1) {
          const jy = S.jamYAt(u, zi, T.terrainH);
          if (prev != null) slope = Math.max(slope, Math.abs(jy - prev) / 0.1); prev = jy;
          let lo = 1e9, hi = -1e9;
          for (const sd of [0, 1]) {
            S.fissureWorld(u, (sd ? 1 : -1) * S._halfWAt(F, u, sd), zi, o); const h = T.terrainH(o.x, o.z, zi);
            lo = Math.min(lo, h); hi = Math.max(hi, h); }
          under = Math.min(under, lo - jy); loAbove = Math.max(loAbove, lo - jy); hiAbove = Math.max(hiAbove, hi - jy); }
        out.planes.push({ site, zi, jamLowest: +jam.toFixed(2), centre: +S.jamYAt(0, zi, T.terrainH).toFixed(2),
          trigger: trig(zi), aboveTrigger: +(jam - trig(zi)).toFixed(2), underLip: +under.toFixed(3),
          lowerLipMaxAbove: +loAbove.toFixed(2), higherLipMaxAbove: +hiAbove.toFixed(2), maxSlope: +slope.toFixed(3) });
      }
    }
    window.__chart.arrive(0);
    return out; })()`);
  for (const z of r.stand) {
    if (z.minY < z.jam + 1.35 - 0.05) fail.push(`zone ${z.zi} sank below the jam ` + JSON.stringify(z));
    if (z.maxStep > 0.08) fail.push(`zone ${z.zi} jitter on the jam ${z.maxStep}`);
    if (z.zone !== z.zi) fail.push(`zone ${z.zi}: left the zone while shut`);
    if (!z.grounded) fail.push(`zone ${z.zi}: not grounded on the jam`);
  }
  for (const z of r.drop) {
    if (z.landedFrame < 0 || !z.onJam) fail.push(`zone ${z.zi}: the drop did not land on the jam ` + JSON.stringify(z));
    if (z.minAboveJam < -0.05) fail.push(`zone ${z.zi}: the drop went below the jam ` + JSON.stringify(z));
    if (z.zone !== z.zi) fail.push(`zone ${z.zi}: the drop left the zone`);
  }
  for (const p of r.planes) {
    if (!(p.aboveTrigger >= 55)) fail.push(`site ${p.site} zone ${p.zi}: jam under 55 u above the trigger plane ` + JSON.stringify(p));
    if (!(p.underLip > 0)) fail.push(`site ${p.site} zone ${p.zi}: a lip point dips below the jam ` + JSON.stringify(p));
    if (!(p.lowerLipMaxAbove <= 3)) fail.push(`site ${p.site} zone ${p.zi}: the lower lip stands more than 3 u above the jam ` + JSON.stringify(p));
    if (!(p.maxSlope <= 1.0)) fail.push(`site ${p.site} zone ${p.zi}: jam ramp too steep ` + JSON.stringify(p));
  }
  console.log(JSON.stringify(r));
} else if (mode === 'throat-edges') {
  // OPEN: 1 u outside the lip he stays put. Stood where the jam was over the opening's centre he
  // sinks through to the next zone with no input (zones 0, 1). Hauling across the shaft mid-fall
  // (W held at a wall, C held to vent), started 5 u below the wall face at the throat's edges (so he
  // is in the shaft, not over a strata ledge he could land on), he is held in the throat column and
  // falls through (zone 2: the ending), never snapped up onto the wall.
  const r = await c.ev(`(async () => {
    const S = await import('/src/world/fissureShape.js'); const T = await import('/src/world/terrain.js');
    window.setState('play'); window.__helm = true; window.survival.hose = 5000;
    const o = { x: 0, z: 0 }, out = [];
    const open = zi => { window.gotoZone(zi); window.lev.calmed = true; window.__fissure.setOpen(zi, 1); };
    for (let zi = 0; zi < 3; zi++) {
      const F = S.FISSURE[zi], res = { zi };
      open(zi);
      S.fissureWorld(0, S._halfWAt(F, 0, 1) + 1, zi, o);
      window.__bench.place(o.x, o.z, 0, zi); res.lipN = +T.terrainNormal(o.x, o.z, zi).y.toFixed(3);
      window.__bench.step(300); res.lipZone = window.zone;
      res.lipMoved = +Math.hypot(window.player.pos.x - o.x, window.player.pos.z - o.z).toFixed(2);
      // the shaft: below the lower wall face at the throat's two edges (u = 0)
      const k = F.throatHalfW / F.halfW; let wallLo = 1e9;
      for (const sd of [0, 1]) { S.fissureWorld(0, (sd ? 1 : -1) * S._halfWAt(F, 0, sd) * k, zi, o); wallLo = Math.min(wallLo, T.terrainH(o.x, o.z, zi)); }
      res.shaftY = +(wallLo - 5).toFixed(1);
      for (const sd of (zi < 2 ? [1, 0] : [1])) {   // zone 2: the first haul ends the game
        open(zi);
        window.__bench.place(F.cx, F.cz, 0, zi);
        window.player.pos.y = wallLo - 5 + 1.35; window.player.grounded = false;
        const nx = -F.dz * (sd ? 1 : -1), nz = F.dx * (sd ? 1 : -1);  // across the crack toward side sd
        window.player.yaw = Math.atan2(nx, nz);   // forward is (sin yaw, cos yaw)
        window.keys.KeyW = true; window.keys.KeyC = true; let up = 0, last = null, n = 0, outT = 0;
        try {
          window.__bench.step(2400, i => {
            if (window.gameState !== 'play' || window.zone !== zi) return false;
            const y = window.player.pos.y; if (last != null) up = Math.max(up, y - last); last = y; n = i;
            if (!S.inThroat(window.player.pos.x, window.player.pos.z, zi)) outT++;
          });
        } finally { window.keys.KeyW = false; window.keys.KeyC = false; }
        res['haul' + sd] = { zone: window.zone, state: window.gameState, maxRise: +up.toFixed(3), frames: n, outOfThroat: outT };
      }
      if (zi < 2) {   // no input at all: stood where the jam was, he sinks through on his own
        open(zi); window.__bench.place(F.cx, F.cz, 0, zi); window.player.pos.y = S.jamTopY(zi, T.terrainH) + 1.35;
        let n = 0; window.__bench.step(4800, i => { n = i; if (window.zone !== zi) return false; });
        res.freeSink = { zone: window.zone, seconds: +(n / 60).toFixed(1) };
      }
      out.push(res);
    }
    return out; })()`);
  for (const z of r) {
    if (z.lipZone !== z.zi) fail.push(`zone ${z.zi}: fell through from the lip`);
    if (z.freeSink && z.freeSink.zone !== z.zi + 1) fail.push(`zone ${z.zi}: did not sink through the open throat unaided ` + JSON.stringify(z.freeSink));
    for (const k of ['haul1', 'haul0']) {
      const h = z[k]; if (!h) continue;
      if (z.zi < 2 ? h.zone !== z.zi + 1 : h.state !== 'won') fail.push(`zone ${z.zi} ${k}: did not fall through the open throat ` + JSON.stringify(h));
      if (h.maxRise > 0.5) fail.push(`zone ${z.zi} ${k}: snapped up out of the throat by ${h.maxRise}`);
    }
  }
  console.log(JSON.stringify(r));
} else if (mode === 'slabs') {
  // SHUT, FROM BELOW: stood on the jam 1 u in front of each overhang slab, facing it, W held 4 s
  // (the yaw re-aimed at a point on the slab each frame: the mouse's job).
  // A slab top is ground only from above: from the jam he walks under it or stops at its front,
  // never snapped up onto it (a heightfield slab top once stood him 6.8 u up in one frame).
  const r = await c.ev(`(async () => {
    const S = await import('/src/world/fissureShape.js'); const T = await import('/src/world/terrain.js');
    window.setState('play'); window.__helm = true; window.survival.hose = 5000;
    const o = { x: 0, z: 0 }, a = { x: 0, z: 0 }, out = [];
    for (let zi = 0; zi < 3; zi++) {
      window.gotoZone(zi); if (window.lev) window.lev.calmed = false; window.__fissure.setOpen(zi, 0);
      const F = S.FISSURE[zi];
      for (const sl of S.SLABS[zi]) {
        const wd = S._widths(F, sl.u0), w = sl.side ? wd.w1 : wd.w0, reach = S._slabReach(sl, sl.u0, w), sg = sl.side ? 1 : -1;
        S.fissureWorld(sl.u0, sg * (w - reach - 1.0), zi, o);          // 1 u in front of the slab's front
        S.fissureWorld(sl.u0, sg * (w - reach * 0.5), zi, a);          // a point on the slab
        const top = T.terrainH(a.x, a.z, zi);
        window.__bench.place(o.x, o.z, 0, zi);
        window.player.pos.y = T.shutFloorY(o.x, o.z, zi) + 1.35;
        window.__bench.step(30);
        window.player.yaw = Math.atan2(a.x - o.x, a.z - o.z);          // forward is (sin yaw, cos yaw)
        window.keys.KeyW = true; let up = 0, last = null, maxY = -1e9;
        try { window.__bench.step(240, () => { const y = window.player.pos.y; if (last != null) up = Math.max(up, y - last); last = y; maxY = Math.max(maxY, y);
          window.player.yaw = Math.atan2(a.x - window.player.pos.x, a.z - window.player.pos.z); }); }
        finally { window.keys.KeyW = false; }
        const p = window.player.pos, q = S.slabAt(p.x, p.z, zi);
        out.push({ zi, u0: sl.u0, side: sl.side, room: +(top - S.jamYAt(sl.u0, zi, T.terrainH)).toFixed(2), maxRise: +up.toFixed(3),
          onTop: maxY > top + 1.35 - 0.7, under: q >= 0, moved: +Math.hypot(p.x - o.x, p.z - o.z).toFixed(2) });
      }
    }
    return out; })()`);
  // More than a step (0.85 u) in one frame is a snap. Since the jam sits ~2 u under the lip (fix
  // round 1), most slab tops stand only 1-1.5 u over it: a low ledge he may climb onto, gently. One
  // standing more than 2 u over the jam must never be stood on from below.
  for (const z of r) {
    if (z.maxRise > 0.85) fail.push(`zone ${z.zi} slab u0 ${z.u0}: snapped up ${z.maxRise}`);
    if (z.onTop && z.room > 2) fail.push(`zone ${z.zi} slab u0 ${z.u0}: stood on the slab from below ` + JSON.stringify(z));
  }
  console.log(JSON.stringify(r));
} else if (mode === 'tips') {
  // SHUT, END TO END: at every site, every zone, both ends: stood on the jam at 0.8 halfLen, W held
  // along the crack (the yaw steered at the centreline 5 u ahead: the mouse's job) for 25 s. He must
  // walk out past the tip (the jam ramps up into each tip; a riser of up to a step is stepped),
  // never rising more than a step in one frame.
  const r = await c.ev(`(async () => {
    const S = await import('/src/world/fissureShape.js'); const T = await import('/src/world/terrain.js');
    window.setState('play'); window.__helm = true; window.survival.hose = 5000;
    const o = { x: 0, z: 0 }, L = { u: 0, v: 0 }, out = [];
    for (const site of [0, 1, 2]) {
      if (site) window.__chart.arrive(site);
      window.setState('play'); window.__helm = true;
      for (let zi = 0; zi < 3; zi++) for (const e of [-1, 1]) {
        window.gotoZone(zi); if (window.lev) window.lev.calmed = false; window.__fissure.setOpen(zi, 0);
        const F = S.FISSURE[zi], u0 = e * 0.8 * F.halfLen;
        S.fissureWorld(u0, 0, zi, o); window.__bench.place(o.x, o.z, 0, zi);
        window.player.pos.y = T.shutFloorY(o.x, o.z, zi) + 1.35;
        window.__bench.step(20);
        window.keys.KeyW = true; let up = 0, last = null, uEnd = 0, n = 0;
        try { window.__bench.step(1500, i => { const p = window.player.pos; S.fissureLocal(p.x, p.z, zi, L);
          S.fissureWorld(L.u + 5 * e, 0, zi, o); window.player.yaw = Math.atan2(o.x - p.x, o.z - p.z);
          if (last != null) up = Math.max(up, p.y - last); last = p.y; uEnd = L.u; n = i;
          if (e * L.u > F.halfLen + 2) return false; }); }
        finally { window.keys.KeyW = false; }
        out.push({ site, zi, end: e, out: e * uEnd > F.halfLen + 2, uEnd: +uEnd.toFixed(1), secs: +(n / 60).toFixed(1), maxRise: +up.toFixed(3) });
      }
    }
    window.__chart.arrive(0);
    return out; })()`);
  for (const z of r) {
    if (!z.out) fail.push(`site ${z.site} zone ${z.zi} end ${z.end}: did not walk out of the tip ` + JSON.stringify(z));
    if (z.maxRise > 0.85) fail.push(`site ${z.site} zone ${z.zi} end ${z.end}: rose ${z.maxRise} in a frame`);
  }
  console.log(JSON.stringify(r));
} else if (mode === 'walls') {
  // SHUT, THE WALLS FROM INSIDE: at u = -0.3/0/+0.3 halfLen in each zone, stood on the jam's centreline
  // facing each wall: (a) W held 4 s; (b) W held with a 0.5 s pack burst, then 3 s more. Every
  // frame inside the crack he is at or above the jam (eye >= jam + EYE_H - 0.05: never under it from
  // the sides), and never rises more than a step (0.85 u) in one frame.
  const r = await c.ev(`(async () => {
    const S = await import('/src/world/fissureShape.js'); const T = await import('/src/world/terrain.js');
    window.setState('play'); window.__helm = true; window.survival.hose = 5000;
    const o = { x: 0, z: 0 }, out = [];
    for (let zi = 0; zi < 3; zi++) {
      window.gotoZone(zi); if (window.lev) window.lev.calmed = false; window.__fissure.setOpen(zi, 0);
      const F = S.FISSURE[zi];
      for (const a of [-0.3, 0, 0.3]) for (const sd of [0, 1]) for (const burst of [false, true]) {
        const u = a * F.halfLen; S.fissureWorld(u, 0, zi, o);
        window.__bench.place(o.x, o.z, 0, zi); window.player.pos.y = T.shutFloorY(o.x, o.z, zi) + 1.35;
        window.player.vel.set(0, 0, 0); window.survival.reserve = window.survival.reserveCap || 1;
        window.__bench.step(10);
        const sg = sd ? 1 : -1, nx = -F.dz * sg, nz = F.dx * sg;
        window.player.yaw = Math.atan2(nx, nz);
        let under = 1e9, up = 0, last = null, n = 0;
        window.keys.KeyW = true;
        try { window.__bench.step(burst ? 420 : 240, i => {
          window.keys.Space = burst && i >= 60 && i < 90;
          const p = window.player.pos, j = T.jamAt(p.x, p.z, zi);
          if (j > -1e8) under = Math.min(under, p.y - (j + 1.35));
          if (last != null) up = Math.max(up, p.y - last); last = p.y; n = i; }); }
        finally { window.keys.KeyW = false; window.keys.Space = false; }
        const p = window.player.pos;
        out.push({ zi, a, sd, burst, minAboveJam: +under.toFixed(3), maxRise: +up.toFixed(3), endFd: +S.fissureDist(p.x, p.z, zi).toFixed(2), zone: window.zone });
      }
    }
    return out; })()`);
  for (const z of r) {
    if (z.minAboveJam < -0.05) fail.push('under the jam ' + JSON.stringify(z));
    if (z.maxRise > 0.85) fail.push('snapped up ' + JSON.stringify(z));
    if (z.zone !== z.zi) fail.push('left the zone ' + JSON.stringify(z));
  }
  console.log(JSON.stringify(r));
} else if (mode === 'climb-out') {
  // SHUT, OUT SIDEWAYS WITH REAL INPUT: from the middle of the jam (u = 0, centreline) facing a lip,
  // REAL CDP keys on the live loop: W held, a Space TAP at 2.5 s (a seabed hop), W held on. He must
  // end outside the crack (fd > 0, on the lip or past it) in the same zone, every zone, both lips.
  const out = [];
  await c.ev(`(window.start && window.gameState === 'title' && window.start(), window.setState('play'), window.__helm = true, window.survival.hose = 5000, 1)`);
  for (let zi = 0; zi < 3; zi++) for (const sd of [0, 1]) {
    await c.ev(`(async () => {
      const S = await import('/src/world/fissureShape.js'); const T = await import('/src/world/terrain.js');
      window.gotoZone(${zi}); if (window.lev) window.lev.calmed = false; window.__fissure.setOpen(${zi}, 0);
      const F = S.FISSURE[${zi}], o = { x: 0, z: 0 };
      S.fissureWorld(0, 0, ${zi}, o); window.__bench.place(o.x, o.z, 0, ${zi});
      window.player.pos.y = T.shutFloorY(o.x, o.z, ${zi}) + 1.35;
      window.survival.reserve = window.survival.reserveCap || 1;
      const sg = ${sd} ? 1 : -1; window.player.yaw = Math.atan2(-F.dz * sg, F.dx * sg);
      window.__co = { up: 0, last: null };
      const tick = () => { if (!window.__co) return; const y = window.player.pos.y;
        if (window.__co.last != null) window.__co.up = Math.max(window.__co.up, y - window.__co.last); window.__co.last = y; requestAnimationFrame(tick); };
      requestAnimationFrame(tick); return 1; })()`);
    await sleep(300);
    await c.key('KeyW', true); await sleep(2500);
    await c.tap('Space', 80); await sleep(4500);
    await c.key('KeyW', false); await sleep(300);
    const r = await c.ev(`(async () => { const S = await import('/src/world/fissureShape.js'); const p = window.player.pos;
      const T = await import('/src/world/terrain.js'), F = S.FISSURE[${zi}], o = { x: 0, z: 0 }, lip = [0, 1].map(sd => {
        S.fissureWorld(0, (sd ? 1 : -1) * S._halfWAt(F, 0, sd), ${zi}, o); return T.terrainH(o.x, o.z, ${zi}); });
      const jam = S.jamYAt(0, ${zi}, T.terrainH);
      const r = { zi: ${zi}, sd: ${sd}, lipAbove: +(lip[${sd}] - jam).toFixed(2), lower: lip[${sd}] <= lip[1 - ${sd}],
        fd: +S.fissureDist(p.x, p.z, ${zi}).toFixed(2), zone: window.zone, maxRise: +window.__co.up.toFixed(3), taps: window.__pack ? window.__pack.taps : null };
      window.__co = null; return r; })()`);
    out.push(r);
  }
  // The jam cannot rise above the LOWER lip (stepping in would be a step up), and where the two lips
  // stand far apart the higher one is out of a hop's reach: the lower lip's side must be a tap-and-
  // step exit in every zone; the higher side is asserted only where that lip is within 2.2 u of the
  // jam, and reported otherwise.
  for (const z of out) {
    const must = z.lower || z.lipAbove <= 2.2;
    z.asserted = must;
    if (must && !(z.fd > 0)) fail.push('still in the crack ' + JSON.stringify(z));
    if (z.zone !== z.zi) fail.push('left the zone ' + JSON.stringify(z));
    if (z.maxRise > 0.85) fail.push('snapped up ' + JSON.stringify(z));
  }
  for (let zi = 0; zi < 3; zi++) if (!out.some(z => z.zi === zi && z.lower && z.fd > 0)) fail.push(`zone ${zi}: no way out sideways`);
  console.log(JSON.stringify(out));
} else if (mode === 'open-ledge') {
  // OPEN, A STRATA LEDGE: per zone, a standable spot on the crack's wall (normal.y > 0.8) with a face
  // rising ahead toward the nearer lip; stood there facing the face, W held 4 s. He stays on the
  // ledge: never sent into the throat, never more than 1 u from where he stood, same zone.
  const r = await c.ev(`(async () => {
    const S = await import('/src/world/fissureShape.js'); const T = await import('/src/world/terrain.js');
    window.setState('play'); window.__helm = true; window.survival.hose = 5000;
    const o = { x: 0, z: 0 }, q = { x: 0, z: 0 }, out = [];
    for (let zi = 0; zi < 3; zi++) {
      const F = S.FISSURE[zi], k = F.throatHalfW / F.halfW; let found = null;
      for (let m = 0; m <= 2 * Math.floor(0.7 * F.halfLen) && !found; m++) {
        const u = (m % 2 ? -1 : 1) * Math.ceil(m / 2);   // 0, 1, -1, 2, -2, ... out to 0.7 halfLen
        for (const sd of [0, 1]) {
          const sg = sd ? 1 : -1, w = S._halfWAt(F, u, sd);
          for (let v = w * k + 0.3; v < w - 0.6 && !found; v += 0.1) {
            S.fissureWorld(u, sg * v, zi, o); if (S.slabAt(o.x, o.z, zi) >= 0) continue;
            const h = T.terrainH(o.x, o.z, zi), n = T.terrainNormal(o.x, o.z, zi);
            if (n.y < 0.8 || S.lipMeanY(zi, T.terrainH) - h < 1.5) continue;
            S.fissureWorld(u, sg * (v + 0.7), zi, q);
            if (T.terrainH(q.x, q.z, zi) - h > 0.8) found = { u, sd, v, x: o.x, z: o.z, h };
          }
        }
      }
      if (!found) { out.push({ zi, found: false }); continue; }
      window.gotoZone(zi); window.lev.calmed = true; window.__fissure.setOpen(zi, 1);
      window.__bench.place(found.x, found.z, 0, zi);
      window.__bench.step(30);
      const p0 = window.player.pos.clone(), sg = found.sd ? 1 : -1;
      window.player.yaw = Math.atan2(-F.dz * sg, F.dx * sg);
      let throat = 0; window.keys.KeyW = true;
      try { window.__bench.step(240, () => { const p = window.player.pos; if (S.inThroat(p.x, p.z, zi)) throat++; }); }
      finally { window.keys.KeyW = false; }
      const p = window.player.pos;
      out.push({ zi, found: true, u: found.u, sd: found.sd, v: +found.v.toFixed(2), dy: +(p.y - p0.y).toFixed(3),
        moved: +Math.hypot(p.x - p0.x, p.z - p0.z).toFixed(2), throatFrames: throat, zone: window.zone });
    }
    return out; })()`);
  for (const z of r) {
    if (!z.found) { fail.push(`zone ${z.zi}: no ledge found to test`); continue; }
    if (z.throatFrames > 0 || z.zone !== z.zi) fail.push('sent into the throat off a ledge ' + JSON.stringify(z));
    if (Math.abs(z.dy) > 1 || z.moved > 1) fail.push('left the ledge ' + JSON.stringify(z));
  }
  console.log(JSON.stringify(r));
} else if (mode === 'floor-readers') {
  // THE SHARED SHUT FLOOR (terrain.js shutFloorY / jamAt): shut, it is the jam over the crack and
  // terrainH outside it; open, terrainH everywhere. Its readers, stood on the jam in zone 0 (shut):
  // a spear fired down the crack lies on the jam, not 70 u under it; the hose nodes by him rest on
  // the jam; the camera keeps its clearance above the jam.
  const r = await c.ev(`(async () => {
    const S = await import('/src/world/fissureShape.js'); const T = await import('/src/world/terrain.js');
    const Tools = await import('/src/systems/tools.js');
    window.setState('play'); window.__helm = true; window.survival.hose = 5000;
    const zi = 0, F = S.FISSURE[zi], o = { x: 0, z: 0 }, out = {};
    window.gotoZone(zi); window.lev.calmed = false; window.__fissure.setOpen(zi, 0);
    S.fissureWorld(0, 0, zi, o); window.__bench.place(o.x, o.z, 0, zi);
    const jam = T.jamAt(o.x, o.z, zi); window.player.pos.y = jam + 1.35;   // the jam's own floor there (the rubble grid)
    window.__bench.step(2);
    out.shut = { floor: +T.shutFloorY(o.x, o.z, zi).toFixed(3), jam: +jam.toFixed(3), terrain: +T.terrainH(o.x, o.z, zi).toFixed(2) };
    S.fissureWorld(0, 20, zi, o); out.outside = { floor: +T.shutFloorY(o.x, o.z, zi).toFixed(3), terrain: +T.terrainH(o.x, o.z, zi).toFixed(3) };
    let camMin = 1e9;   // (place() snapped the lens behind him on the throat floor: let it settle first)
    window.__bench.step(240, i => { if (i >= 60) camMin = Math.min(camMin, window.camera.position.y - jam); });
    out.camAboveJam = +camMin.toFixed(2);
    out.hoseLow = window.__leash.lowNear(window.player.pos.x, window.player.pos.z, 4);
    // a spear down the crack, 30 deg below level, from his eye
    const p = window.player.pos, fwd = window.player.pos.clone().set(F.dx * 0.87, -0.5, F.dz * 0.87);
    Tools.fireSpear(p.clone(), fwd);
    let sp = null;   // where it lies the frame it settles (state 3; he may pick it straight back up)
    window.__bench.step(300, () => { if (sp) return false; const k = window.tools.drop().indexOf(3);
      if (k >= 0) { const q = window.tools.spears[k].pos; sp = { x: q.x, y: q.y, z: q.z }; } });
    out.spear = sp ? { y: +sp.y.toFixed(3), aboveJam: +(sp.y - T.jamAt(sp.x, sp.z, zi)).toFixed(3), inCrack: S.fissureDist(sp.x, sp.z, zi) < 0 } : null;
    window.__fissure.setOpen(zi, 1); window.lev.calmed = true; window.__bench.place(F.cx + 30, F.cz, 0, zi); window.__bench.step(2);
    S.fissureWorld(0, 0, zi, o); out.open = { floor: +T.shutFloorY(o.x, o.z, zi).toFixed(3), terrain: +T.terrainH(o.x, o.z, zi).toFixed(3) };
    return out; })()`);
  if (Math.abs(r.shut.floor - r.shut.jam) > 1e-3) fail.push('shut floor is not the jam ' + JSON.stringify(r.shut));
  if (r.outside.floor !== r.outside.terrain) fail.push('outside the crack the floor is not terrain ' + JSON.stringify(r.outside));
  if (r.open.floor !== r.open.terrain) fail.push('open, the floor is not terrain ' + JSON.stringify(r.open));
  if (!(r.camAboveJam > 1.0)) fail.push('camera under the jam clearance ' + r.camAboveJam);
  if (r.hoseLow != null && r.hoseLow < r.shut.jam) fail.push('hose sagged under the jam ' + r.hoseLow);
  if (!r.spear || !r.spear.inCrack || r.spear.aboveJam < 0) fail.push('spear did not lie on the jam ' + JSON.stringify(r.spear));
  console.log(JSON.stringify(r));
} else if (mode === 'opening') {
  // THE OPENING MOMENT (world/fissure.js), at home zone 0, Pallid Bank zone 0 and home zone 1: open()
  // returns 5-9 s; k climbs 0 -> 1 over it and the shut flag clears on the frame k passes 0.5; the
  // seabed quakes; stood on the jam's middle he rides the slump (his floor never more than 0.25 u off
  // what is drawn under his boots while the floor holds) and drops into the throat once it goes; at
  // the end the silt is gone and every block left in view is below the lip; the pour then sinks out
  // one block at a time (never all at once) and is gone by 14 s; no light added, no program built.
  const r = await c.ev(`(async () => {
    const S = await import('/src/world/fissureShape.js'); const T = await import('/src/world/terrain.js');
    window.setState('play'); window.__helm = true; window.survival.hose = 5000;
    const out = [];
    for (const [site, zi] of [[0, 0], [1, 0], [0, 1]]) {
      if (site !== (out.length ? out[out.length - 1].site : 0)) window.__chart.arrive(site);
      window.setState('play'); window.__helm = true;
      window.gotoZone(zi); window.lev.calmed = false; window.__fissure.setOpen(zi, 0);
      const F = S.FISSURE[zi], lip = S.lipMeanY(zi, T.terrainH), o = { x: 0, z: 0 };
      S.fissureWorld(0, 0, zi, o); window.__bench.place(o.x, o.z, 0, zi);
      const jam = T.jamAt(o.x, o.z, zi); window.player.pos.y = jam + 1.35; window.__bench.step(30);
      const programs0 = window.__fissure.programs();
      const dur = window.__fissure.open(zi); let k5 = 0, kHalfAt = -1, quake = 0, shutAt = -1, gapMax = 0, minY = 1e9, endState = null, shown = [], nMax = 0;
      window.__bench.step(Math.round(dur * 60) + 60, i => {
        const st = window.__fissure.state(zi);
        if (i === 300) k5 = st.k;
        if (kHalfAt < 0 && st.k > 0.5) kHalfAt = i;
        if (shutAt < 0 && !S.fissureShut(zi)) shutAt = i;
        quake = Math.max(quake, st.quake);
        minY = Math.min(minY, window.player.pos.y);
        if (S.fissureShut(zi) && window.player.grounded && window.player.jamY != null && i % 6 === 0) {
          const p = window.player.pos, d = st.drawnAt(p.x, p.y - 1.35, p.z);
          if (!isNaN(d)) gapMax = Math.max(gapMax, Math.abs(window.player.jamY - d)); }
      });
      endState = window.__fissure.state(zi);
      // the pour after the opening: how many blocks are still drawn, frame by frame, to 14 s
      let prevLeft = -1, maxDropAtOnce = 0, goneAt = -1;
      window.__bench.step(Math.round((14.2 - dur - 1) * 60), i => { const L = window.__fissure.state(zi).left;
        if (prevLeft >= 0) maxDropAtOnce = Math.max(maxDropAtOnce, prevLeft - L); prevLeft = L; if (goneAt < 0 && !window.__fissure.state(zi).bouldersVisible) goneAt = i; });
      let lights = 0; window.scene.traverse(q => { if (q.isLight) lights++; });
      out.push({ site, zi, dur, k5: +k5.toFixed(3), kEnd: endState.k, kHalfAt, shutAt, quake: +quake.toFixed(3), shutEnd: S.fissureShut(zi), opening: endState.opening,
        bouldersVisible: endState.bouldersVisible, boulderTopMax: +endState.boulderTopMax.toFixed(2), lip: +lip.toFixed(2), siltVisible: endState.siltVisible,
        rideGapMax: +gapMax.toFixed(3), fellBelowJam: +(jam + 1.35 - minY).toFixed(2), blocks: endState.n, maxSinkOutAtOnce: maxDropAtOnce, pourGoneAfter: goneAt < 0 ? null : +((goneAt / 60) + dur + 1).toFixed(1),
        lights, programs0, programs1: window.__fissure.programs() });
    }
    window.__chart.arrive(0);
    return out; })()`);
  for (const z of r) {
    const tag = `site ${z.site} zone ${z.zi}`;
    if (z.dur < 5 || z.dur > 9) fail.push(`${tag}: opening duration ` + z.dur);
    if (z.kEnd < 0.99) fail.push(`${tag}: did not finish opening`);
    if (z.opening) fail.push(`${tag}: still opening after its duration`);
    if (!(z.quake > 0)) fail.push(`${tag}: no quake`);
    if (z.shutEnd) fail.push(`${tag}: still shut at the end`);
    if (z.shutAt < 0 || Math.abs(z.shutAt - z.kHalfAt) > 1) fail.push(`${tag}: shut flag did not follow k > 0.5 (${z.shutAt} vs ${z.kHalfAt})`);
    if (z.bouldersVisible && z.boulderTopMax > z.lip) fail.push(`${tag}: a block ends above the lip ` + z.boulderTopMax);
    if (z.siltVisible) fail.push(`${tag}: the silt is still drawn when open`);
    if (z.rideGapMax > 0.25) fail.push(`${tag}: his floor left the drawn jam by ${z.rideGapMax} while it held`);
    if (!(z.fellBelowJam > 5)) fail.push(`${tag}: he did not drop into the throat once it opened ` + z.fellBelowJam);
    if (z.pourGoneAfter == null) fail.push(`${tag}: the pour still drawn at 14 s`);
    if (z.maxSinkOutAtOnce > Math.max(6, z.blocks * 0.1)) fail.push(`${tag}: ${z.maxSinkOutAtOnce} blocks vanished in one frame`);
    if (z.lights !== 14) fail.push(`${tag}: light count ` + z.lights);
    if (z.programs1 !== z.programs0) fail.push(`${tag}: programs ${z.programs0} -> ${z.programs1} across the opening`);
  }
  console.log(JSON.stringify(r));
} else if (mode === 'jam-mesh') {
  // THE DRAWN JAM IS THE FLOOR (fix round 1), every site x zone, shut: rays down through the drawn
  // silt and blocks at ~1500 points agree with the floor Sal stands on (shutFloorY) within 0.15 u at
  // the 95th percentile, with <= 1% where drawn rock stands > 0.3 u over his boots (clipping) and <= 2%
  // where his boots would hang > 0.3 u over the drawn ground; the silt never within 0.05 u of a slab top
  // (no z-fight); 60-160 blocks in >= 3 shapes, CLUMPED (nearest-neighbour CV >= 0.4: Poisson-disk
  // paving reads ~0.2), none in a slab footprint, each over >= 20 u of throat; Task 2's bounds: the lower
  // lip at most 2.2 u (a tap-hop) over the walkable floor beside it, stepping in at most 0.6 u up; the
  // seep fog off. Then the BOOTS: at home, zone 0, stood at 40 spots on the jam (the live player, 20
  // frames), the drawn top under his soles within 0.2 u of them at 95%.
  const r = await c.ev(`(async () => {
    const S = await import('/src/world/fissureShape.js'); const T = await import('/src/world/terrain.js');
    window.setState('play'); window.__helm = true;
    const out = { audit: [], boots: null };
    for (const site of [0, 1, 2]) {
      if (site) window.__chart.arrive(site);
      for (let zi = 0; zi < 3; zi++) { window.__fissure.setOpen(zi, 0); }
      for (let zi = 0; zi < 3; zi++) out.audit.push(Object.assign({ site, zi }, window.__fissure.audit(zi)));
    }
    window.__chart.arrive(0); window.setState('play'); window.__helm = true;
    window.gotoZone(0); window.lev.calmed = false; window.__fissure.setOpen(0, 0);
    const F = S.FISSURE[0], o = { x: 0, z: 0 }, errs = []; let s = 0x2468;
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    for (let k = 0; k < 40; k++) {
      const u = (rnd() * 2 - 1) * F.halfLen * 0.75, v = (rnd() * 2 - 1) * 0.6 * S._halfWAt(F, u, rnd() < 0.5 ? 1 : 0);
      S.fissureWorld(u, v, 0, o); window.__bench.place(o.x, o.z, rnd() * 6.28, 0); window.player.pos.y = T.shutFloorY(o.x, o.z, 0) + 1.35;
      window.__bench.step(20);
      const p = window.player.pos, d = window.__fissure.state(0).drawnAt(p.x, p.y - 1.35, p.z);
      if (!isNaN(d)) errs.push(Math.abs(p.y - 1.35 - d));
    }
    errs.sort((a, b) => a - b);
    out.boots = { n: errs.length, p50: +errs[Math.floor(errs.length * 0.5)].toFixed(3), p95: +errs[Math.floor(errs.length * 0.95)].toFixed(3), max: +errs[errs.length - 1].toFixed(3) };
    return out; })()`);
  for (const z of r.audit) {
    const tag = `site ${z.site} zone ${z.zi}`;
    if (!(z.p95 <= 0.15)) fail.push(`${tag}: floor vs drawn p95 ${z.p95}`);
    if (z.clipPct > 1) fail.push(`${tag}: drawn rock over his boots at ${z.clipPct}%`);
    if (z.hoverPct > 2) fail.push(`${tag}: boots over the drawn ground at ${z.hoverPct}%`);
    if (z.slabGap < 0.05) fail.push(`${tag}: silt within ${z.slabGap} of a slab top`);
    if (z.boulders > 160 || z.boulders < 60) fail.push(`${tag}: ${z.boulders} blocks`);
    if (z.shapes < 3) fail.push(`${tag}: ${z.shapes} rock shapes`);
    if (!(z.nnCV >= 0.4)) fail.push(`${tag}: blocks evenly spaced (nearest-neighbour CV ${z.nnCV})`);
    if (z.inSlab) fail.push(`${tag}: ${z.inSlab} blocks in slab footprints`);
    if (!(z.dropMin >= 20)) fail.push(`${tag}: a block over only ${z.dropMin} u of throat`);
    if (!(z.lowerLipOver <= 2.2)) fail.push(`${tag}: the lower lip ${z.lowerLipOver} u over the floor beside it`);
    if (!(z.stepIn <= 0.6)) fail.push(`${tag}: stepping in is ${z.stepIn} u up`);
    if (!z.seepFogOff) fail.push(`${tag}: seep fogged`);
  }
  if (!(r.boots.p95 <= 0.2)) fail.push('his soles off the drawn jam ' + JSON.stringify(r.boots));
  console.log(JSON.stringify(r));
} else if (mode === 'reascend') {
  // THE OPEN STATE IS THE CHART'S, FOR EVERY ZONE: calmed (recorded) zone 0 stays open after he
  // descends through it, so coming back up through the crack (re-entering zone 0 the way start and
  // the rescue do) he passes the jam's level with nothing under or over him there.
  const r = await c.ev(`(async () => {
    const S = await import('/src/world/fissureShape.js'); const T = await import('/src/world/terrain.js');
    window.setState('play'); window.__helm = true; window.survival.hose = 5000;
    const site = 0, F = S.FISSURE[0], jam = S.jamFloorAt(0, 0, 0, T.terrainH), out = {};
    window.__chart.rec()[site][0] = 1;          // the pencil has her: zone 0 calmed
    window.gotoZone(0); window.lev.calmed = true;
    out.kAtEnter = window.__fissure.k(0);
    window.__bench.place(F.cx, F.cz, 0, 0); window.player.pos.y = jam + 1.35;
    let n = 0; window.__bench.step(4800, i => { n = i; if (window.zone !== 0) return false; });
    out.descended = { zone: window.zone, seconds: +(n / 60).toFixed(1) };
    out.after = { k0: window.__fissure.k(0), shut0: S.fissureShut(0), jamAt0: T.jamAt(F.cx, F.cz, 0), k1: window.__fissure.k(1), shut1: S.fissureShut(1) };
    // back up: re-entering zone 0 (as start / the rescue do), from 12 u under the jam in the throat, rising
    window.gotoZone(0);
    out.kReenter = window.__fissure.k(0);
    window.__bench.place(F.cx, F.cz, 0, 0); window.player.pos.y = jam - 12 + 1.35; window.player.grounded = false;
    window.player.vel.set(0, 3, 0); window.player.fill = 1;
    let caught = -1, maxStep = 0, last = null, top = -1e9;
    window.__bench.step(600, i => { const y = window.player.pos.y; if (last != null) maxStep = Math.max(maxStep, y - last); last = y; top = Math.max(top, y);
      window.player.vel.y = Math.max(window.player.vel.y, 3);
      if (caught < 0 && window.player.grounded && Math.abs(y - (jam + 1.35)) < 0.3) caught = i; if (y > jam + 8) return false; });
    out.rise = { caughtOnJam: caught, maxStep: +maxStep.toFixed(3), top: +(top - jam).toFixed(2), jamY: window.player.jamY };
    return out; })()`);
  if (r.kAtEnter !== 1) fail.push('recorded calm: zone 0 not open on entering ' + r.kAtEnter);
  if (r.descended.zone !== 1) fail.push('did not descend through the open throat ' + JSON.stringify(r.descended));
  if (r.after.k0 !== 1 || r.after.shut0 || r.after.jamAt0 > -1e8) fail.push('zone 0 re-shut behind him ' + JSON.stringify(r.after));
  if (r.after.k1 !== 0 || !r.after.shut1) fail.push('zone 1 (not calmed) is not shut ' + JSON.stringify(r.after));
  if (r.kReenter !== 1) fail.push('zone 0 shut on re-entry ' + r.kReenter);
  if (r.rise.caughtOnJam >= 0 || r.rise.maxStep > 0.5 || r.rise.top < 7) fail.push('a phantom jam stopped him ' + JSON.stringify(r.rise));
  console.log(JSON.stringify(r));
} else fail.push(`unknown mode ${mode}`);
c.close();
stop();
if (fail.length) { console.error('FAIL', fail); process.exit(1); } else console.log('PASS');
