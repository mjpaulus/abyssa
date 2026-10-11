// THE FISSURE probe (spec docs/superpowers/specs/2026-10-10-fissure-and-harpoon-design.md).
//   node tools/bench/fissure-probe.mjs <clearance|velkath-crack|walls-inside|fall-lens|ending|wave-minors|shape|jam-stand|throat-edges|slabs|tips|walls|climb-out|open-ledge|floor-readers|opening|jam-mesh|reascend|seep-depth|open-persist|calm-open|open-light|pour-hide|below-dark> <port>   (serve.py must already serve <port>)
// Env DRV_PORT (CDP debug port, default 9481). drv.mjs reads DRV_PORT when it is first
// evaluated, so the default is set BEFORE the driver is imported (a static import is hoisted).
const [, , mode, port] = process.argv;
process.env.DRV_PORT = process.env.DRV_PORT || '9481';
// A FRESH PROFILE per run: the game saves its chart (endingSeen, calms) to localStorage, and a run
// that played the ending would turn the next run's zone-2 fall into the quiet ink beat.
const { mkdtempSync, rmSync } = await import('node:fs'); const { tmpdir } = await import('node:os');
process.env.DRV_DIR = mkdtempSync(tmpdir() + '/abyssa-fissure-probe-');
const { start, stop, connect, sleep } = await import('./drv.mjs');
await start(`http://localhost:${port}/?bench&playtest${['below-dark', 'ending'].includes(mode) ? '&lab' : ''}`);   // (&lab: the pinned lens, __camPin)
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
        let under = 1e9, underStep = 1e9, underN = 0, up = 0, last = null, n = 0;
        window.keys.KeyW = true;
        try { window.__bench.step(burst ? 420 : 240, i => {
          window.keys.Space = burst && i >= 60 && i < 90;
          const p = window.player.pos, j = T.jamAt(p.x, p.z, zi);
          // (a step up a block's side in progress eases him up on the sill spring, briefly under the new
          // floor by design: those frames are held to half a step instead)
          if (j > -1e8) { if (window.player.stepUp > 1e-3) underStep = Math.min(underStep, p.y - (j + 1.35)); else { under = Math.min(under, p.y - (j + 1.35)); if (p.y - (j + 1.35) < -0.03) underN++; } }
          if (last != null) up = Math.max(up, p.y - last); last = p.y; n = i; }); }
        finally { window.keys.KeyW = false; window.keys.Space = false; }
        const p = window.player.pos;
        out.push({ zi, a, sd, burst, minAboveJam: +under.toFixed(3), minInStep: +underStep.toFixed(3), underFrames: underN, maxRise: +up.toFixed(3), endFd: +S.fissureDist(p.x, p.z, zi).toFixed(2), zone: window.zone });
      }
    }
    return out; })()`);
  for (const z of r) {
    // (fix round 1: the jam's floor has banks now, up to 0.9 slope; player.js samples the floor before
    // the frame's step, so climbing a bank he trails it by one frame's rise, <= 0.1 u)
    if (z.minAboveJam < -0.1) fail.push('under the jam ' + JSON.stringify(z));
    if (z.minInStep < -0.5) fail.push('under the jam mid-step ' + JSON.stringify(z));
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
} else if (mode === 'seep-depth') {
  // THE SEEP LAYER IS DEPTH-STABLE (fix round 2): it lies on the silt's own vertices, so a z-fight with
  // the silt shows as the layer passing in some patches and failing in others: flat camouflage
  // blotches that crawl with the TAA jitter. By day, through the full post chain, the layer's gain
  // raised to the same strong light in every zone and made FLAT (leak 1 on every silt quad, so its
  // own mask adds no structure), stood in each zone's crack looking down at it:
  // frame A layer on, frame B layer off. D = A - B is the layer's own light and must be SMOOTH:
  // blotch energy E = sum|D - blur9(D)| / sum blur9(D) over the pixels it lights.
  // Measured on the z-fighting layer (its transform and no polygon offset, restored for the run):
  // z0 0.22, z1 0.56, z2 0.26; depth-stable: z0 0.075, z1 0.11, z2 0.13.
  const out = [];
  await c.ev(`(async () => { window.setState('play'); window.__helm = true; window.survival.hose = 5000; window.weather.set(1, 0); window.__bench.size(960, 540); return 1; })()`);
  for (let zi = 0; zi < 3; zi++) {
    await c.ev(`(async () => { window.gotoZone(${zi}); window.lev.calmed = false; window.__fissure.setOpen(${zi}, 0); return 1; })()`);
    await sleep(400);
    out.push(await c.ev(`(async () => {
      const S = await import('/src/world/fissureShape.js'); const T = await import('/src/world/terrain.js');
      const zi = ${zi}, SE = window.__fissure.seep, keep = Object.assign({}, SE);
      const lum = cap => { const n = cap.w * cap.h, L = new Float32Array(n); for (let i = 0; i < n; i++) L[i] = 0.2126 * cap.px[i * 4] + 0.7152 * cap.px[i * 4 + 1] + 0.0722 * cap.px[i * 4 + 2]; return L; };
      try {
        const F = S.FISSURE[zi], o = { x: 0, z: 0 }; S.fissureWorld(-6, 0, zi, o);
        window.__bench.place(o.x, o.z, Math.atan2(F.dx, F.dz), zi); window.player.pos.y = T.shutFloorY(o.x, o.z, zi) + 1.35; window.player.pitch = -0.55;
        SE.wisp = 0; SE.k = 2.5 / window.__fissure.seepK[zi]; window.__fissure.seepTest(zi, true);   // flat: leak 1 on every silt quad
        window.__bench.step(90, null, { render: true });
        const A = lum(await window.__bench.capture({ frames: 4 }));
        SE.layer = 0;
        const capB = await window.__bench.capture({ frames: 4 }), B = lum(capB), W = capB.w, H = capB.h;
        const D = new Float32Array(W * H); for (let i = 0; i < D.length; i++) D[i] = Math.max(0, A[i] - B[i]);
        const SA = new Float64Array((W + 1) * (H + 1));
        for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += D[y * W + x]; SA[(y + 1) * (W + 1) + x + 1] = SA[y * (W + 1) + x + 1] + row; } }
        const R = 4; let num = 0, den = 0, px = 0;
        for (let y = R; y < H - R; y++) for (let x = R; x < W - R; x++) {
          const s = SA[(y + R + 1) * (W + 1) + x + R + 1] - SA[(y - R) * (W + 1) + x + R + 1] - SA[(y + R + 1) * (W + 1) + x - R] + SA[(y - R) * (W + 1) + x - R];
          const m = s / ((2 * R + 1) * (2 * R + 1));
          if (m < 1.5) continue;
          num += Math.abs(D[y * W + x] - m); den += m; px++;
        }
        return { zi, camAbove: +(window.camera.position.y - window.player.pos.y).toFixed(1), litPx: px, meanAdd: +(den / Math.max(1, px)).toFixed(2), blotch: +(num / Math.max(1e-6, den)).toFixed(3) };
      } finally { Object.assign(SE, keep); window.__fissure.seepTest(zi, false); } })()`));
  }
  await c.ev(`(window.__bench.size(), 1)`);
  // PER-ZONE BOUNDS (final fix wave M7): one 0.17 bound flaked in zone 2 under load (depth-stable z2 measured
  // 0.124-0.182 across loaded and quiet machines, z0 ~0.075, z1 ~0.11) while it must still catch the z-fight
  // (RED 0.20-0.22 / 0.56-0.58 / 0.20-0.26): z0 0.15, z1 0.30, z2 0.19.
  const SEEP_BOUND = [0.15, 0.30, 0.19];
  for (const z of out) {
    if (z.litPx < 2000) fail.push(`zone ${z.zi}: the seep layer barely draws (${z.litPx} px)`);
    if (z.blotch > SEEP_BOUND[z.zi]) fail.push(`zone ${z.zi}: the seep layer is blotched (z-fight) E ${z.blotch} (bound ${SEEP_BOUND[z.zi]})`);
  }
  console.log(JSON.stringify(out));
} else if (mode === 'reascend') {
  // THE OPEN STATE IS THE CHART'S, FOR EVERY ZONE: calmed (recorded) zone 0 stays open after he
  // descends through it, so coming back up through the crack (re-entering zone 0 the way start and
  // the rescue do) he passes the jam's level with nothing under or over him there.
  const r = await c.ev(`(async () => {
    const S = await import('/src/world/fissureShape.js'); const T = await import('/src/world/terrain.js');
    window.setState('play'); window.__helm = true; window.survival.hose = 5000;
    const site = 0, F = S.FISSURE[0], jam = S.jamFloorAt(0, 0, 0, T.terrainH), out = {};
    window.__chart.rec()[site][0] = 1; window.__chart.visit()[0] = 1;   // calmed THIS visit (the pencil has her too)
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
} else if (mode === 'open-persist') {
  // OPEN = CALMED THIS VISIT (Michael, "Ritual, remembered": the sleepers re-wake every visit, the
  // water does not remember). (a) a zone calmed this visit stays open across zone changes (down and
  // back); (b) an anchorage the chart only RECORDS loads shut on arrival; (c) and after a reload.
  const r = await c.ev(`(async () => {
    window.setState('play'); window.__helm = true; window.survival.hose = 5000;
    const rec = window.__chart.rec(), visit = window.__chart.visit(), out = {};
    window.gotoZone(0); rec[0][0] = 1; visit[0] = 1; window.gotoZone(0);   // the calm's two writes
    window.gotoZone(1); out.a1 = { k0: window.__fissure.k(0), k1: window.__fissure.k(1) };
    window.gotoZone(0); out.a0 = { k0: window.__fissure.k(0), k1: window.__fissure.k(1) };
    window.__chart.arrive(0); out.b = { k0: window.__fissure.k(0), rec00: rec[0][0], visit0: visit[0] };
    return out; })()`);
  await c.send('Page.reload', { ignoreCache: true });
  await new Promise(res => setTimeout(res, 1500));
  await c.until(`!document.getElementById('load') && typeof window.setState === 'function' && !!window.__fissure`, 240000, 1000);
  r.c = await c.ev(`({ k0: window.__fissure.k(0), rec00: window.__chart.rec()[0][0], visit0: window.__chart.visit()[0] })`);
  if (r.a1.k0 !== 1 || r.a0.k0 !== 1) fail.push('calmed this visit: zone 0 did not stay open across zone changes ' + JSON.stringify(r));
  if (r.a1.k1 !== 0 || r.a0.k1 !== 0) fail.push('uncalmed zone 1 loaded open ' + JSON.stringify(r));
  if (r.b.k0 !== 0 || r.b.rec00 !== 1 || r.b.visit0 !== 0) fail.push('recorded-only anchorage did not load shut on arrival ' + JSON.stringify(r.b));
  if (r.c.k0 !== 0 || r.c.rec00 !== 1) fail.push('recorded-only anchorage did not load shut after a reload ' + JSON.stringify(r.c));
  console.log(JSON.stringify(r));
} else if (mode === 'calm-open') {
  // THE REAL CALM PATH (game.js's ev.calmed block), Sal stood on the jam's middle, every ward lit
  // through the sleeper's own update. Three branches:
  //  z0     home zone 0, line enough: the chart records her and the visit holds her on the calm frame,
  //         the opening starts there; the open light, the rift's bearing and the descent all wait for
  //         the jam's pour (k > 0.5), never the calm instant; "A RIFT OPENS BELOW." lands as the light
  //         arrives (dur - 2.5 s, +-0.2 s); he drops through the opened throat into zone 1.
  //  nohose zone 0 with too little line: the line ("IT STILLS. YOU HAVE ...") is said AT ONCE, the
  //         fissure still opens, he falls into the throat but the zone change is refused (and said).
  //  z2     zone 2 (Mhor woken, furnace lit): "...THE RIFT WAITS." is held to dur - 2.5 s; falling
  //         through the opened throat plays the ending.
  const cases = { z0: { zi: 0, hose: 5000 }, nohose: { zi: 0, hose: 450 }, z2: { zi: 2, hose: 5000 } };
  const out = {};
  for (const [name, cs] of Object.entries(cases)) {
    if (name !== 'z0') { await c.send('Page.reload', { ignoreCache: true }); await new Promise(res => setTimeout(res, 1500));
      await c.until(`!document.getElementById('load') && typeof window.setState === 'function' && !!window.__fissure`, 240000, 1000); }
    out[name] = await c.ev(`(async () => {
      const S = await import('/src/world/fissureShape.js'); const T = await import('/src/world/terrain.js');
      const zi = ${cs.zi};
      window.setState('play'); window.__helm = true; window.survival.hose = ${cs.hose};
      window.gotoZone(zi);
      if (zi === 2) { window.lev.cmd('wake'); window.__bench.step(10); window.lev.cmd('wake'); window.__bench.step(120); }
      const o = { x: 0, z: 0 }; S.fissureWorld(0, 0, zi, o); window.__bench.place(o.x, o.z, 0, zi);
      const jam0 = T.jamAt(o.x, o.z, zi); window.player.pos.y = jam0 + 1.35; window.__bench.step(30);
      const $msg = document.getElementById('msg'), $rift = document.getElementById('bmRift');
      const out = { calmAt: -1, openAt: -1, recAt: -1, visitAt: -1, msgAt: -1, shortAt: -1, kHalfAt: -1, lightAt: -1, bearAt: -1, zoneAt: -1, wonAt: -1,
        lightBeforeHalf: 0, bearBeforeHalf: false, lights: 0, programs0: window.__fissure.programs(), kEnd: 0, zoneEnd: -1 };
      for (const g of window.lev.sigils) g.lit = true;                      // the last ward takes: the sleeper's own update calms her
      const line = ${JSON.stringify(cs.zi === 2 ? 'THE RIFT WAITS' : cs.hose < 1000 ? 'IT STILLS. YOU HAVE' : 'A RIFT OPENS BELOW')};
      window.__bench.step(60 * 40, i => {
        if (out.calmAt < 0 && window.lev.calmed) out.calmAt = i;
        if (out.openAt < 0 && window.__fissure.state(zi).opening) out.openAt = i;
        if (out.recAt < 0 && window.__chart.rec()[0][zi]) out.recAt = i;
        if (out.visitAt < 0 && window.__chart.visit()[zi]) out.visitAt = i;
        if (out.msgAt < 0 && $msg.textContent.includes(line) && $msg.classList.contains('on')) out.msgAt = i;
        if (out.shortAt < 0 && $msg.textContent.includes('THE LINE IS TOO SHORT')) out.shortAt = i;
        const k = window.__fissure.k(zi), L = window.__rifts.state(zi);
        if (out.kHalfAt < 0 && k > 0.5) out.kHalfAt = i;
        if (out.lightAt < 0 && L.light > 0.01) out.lightAt = i;
        const bear = $rift.classList.contains('active');
        if (out.bearAt < 0 && bear) out.bearAt = i;
        if (k <= 0.5) { out.lightBeforeHalf = Math.max(out.lightBeforeHalf, L.light); out.bearBeforeHalf = out.bearBeforeHalf || bear; }
        if (out.zoneAt < 0 && window.zone !== zi) out.zoneAt = i;
        if (out.wonAt < 0 && window.gameState === 'won') { out.wonAt = i; return false; }
        if (zi === 0 && ${cs.hose >= 1000} && out.zoneAt >= 0) return false;
      });
      out.kEnd = window.__fissure.k(zi); out.zoneEnd = window.zone; out.fellY = +(window.player.pos.y - jam0).toFixed(1); out.minY = +window.player.pos.y.toFixed(1);
      window.scene.traverse(q => { if (q.isLight) out.lights++; });
      out.programs1 = window.__fissure.programs();
      return out; })()`);
  }
  const f = 60, d = 6.6;
  for (const [name, r] of Object.entries(out)) {
    const tag = name + ':';
    if (r.calmAt < 0) { fail.push(tag + ' the wards never calmed her'); continue; }
    if (r.recAt !== r.calmAt || r.visitAt !== r.calmAt) fail.push(`${tag} the chart/visit did not record the calm on its frame (${r.recAt}/${r.visitAt} vs ${r.calmAt})`);
    if (r.openAt < 0 || r.openAt - r.calmAt > 1) fail.push(`${tag} the fissure did not start opening on the calm (${r.openAt} vs ${r.calmAt})`);
    if (r.lightBeforeHalf > 0.01) fail.push(tag + ' the open light showed over the shut jam ' + r.lightBeforeHalf);
    if (r.bearBeforeHalf) fail.push(tag + ' the rift bearing showed over the shut jam');
    if (r.lightAt < 0 || r.lightAt < r.kHalfAt) fail.push(`${tag} the light did not follow the pour (${r.lightAt} vs k>0.5 at ${r.kHalfAt})`);
    if (r.lights !== 14) fail.push(tag + ' light count ' + r.lights);
    if (name === 'nohose') {
      if (r.msgAt < 0 || r.msgAt - r.calmAt > 1) fail.push(`${tag} the no-line line was not said at once (${r.msgAt} vs ${r.calmAt})`);
      if (r.kEnd !== 1) fail.push(tag + ' the fissure did not open ' + r.kEnd);
      if (r.zoneAt >= 0) fail.push(tag + ' he descended with too little line');
      if (r.shortAt < 0) fail.push(tag + ' the refusal was not said');
      if (!(r.fellY < -5)) fail.push(tag + ' he did not fall into the opened throat ' + r.fellY);
    } else {
      if (r.msgAt < 0 || Math.abs((r.msgAt - r.calmAt) / f - (d - 2.5)) > 0.2) fail.push(`${tag} the line at ${((r.msgAt - r.calmAt) / f).toFixed(2)} s, want ${d - 2.5}`);
      if (r.bearAt < 0) fail.push(tag + ' no rift bearing once open');
      if (name === 'z0' && r.zoneAt < 0) fail.push(tag + ' he did not descend through the opened throat');
      if (name === 'z2' && r.wonAt < 0) fail.push(tag + ' the ending did not play through the opened throat');
    }
  }
  console.log(JSON.stringify(out));
} else if (mode === 'open-light') {
  // THE DEEP'S OWN LIGHT (rifts.js), at every site and zone. The CURTAIN is continuous along the crack
  // (stations <= 1.6 u apart over the middle 80% of its length) and no blob's light reaches rock: at
  // 24 heights through every station's rise, its radius (the shader's own formula, __rifts.radiusAt)
  // stays inside the open half-width the probe measures itself (16 directions, 0.1 u steps, the carved
  // rock and the overhang slabs' bodies), and its lifted foot stays off the throat floor. The light is
  // dark shut / full open (it reads k only); every part additive, fog off, its own program key; drawn
  // open in each zone every program it uses was built at boot; the surface glow only over zone 0, only
  // from the air, opacity <= 0.16; 14 lights.
  const r = await c.ev(`(async () => {
    const S = await import('/src/world/fissureShape.js'), T = await import('/src/world/terrain.js'), core = await import('/src/core.js');
    const R = core.renderer, bootMax = Math.max(...R.info.programs.map(p => p.id));
    window.setState('play'); window.__helm = true; window.survival.hose = 5000;
    const solid = (x, z, y, zi) => { if (T.terrainUnderH(x, z, zi) > y) return true; const sp = S.slabProbe(x, z, zi);
      if (sp.q >= 0) { const top = T.terrainH(x, z, zi); if (y < top + 0.3 && y > top - sp.th - 0.6) return true; } return false; };
    const openAt = (x, z, y, zi, cap) => { let best = cap; for (let k = 0; k < 16; k++) { const a = k / 16 * 6.2832, dx = Math.cos(a), dz = Math.sin(a);
      for (let q = 0; q <= best; q += 0.1) if (solid(x + dx * q, z + dz * q, y, zi)) { best = q; break; } } return best; };
    const out = { bootMax, rows: [], draw: [] };
    for (const site of [0, 1, 2]) {
      if (site) window.__chart.arrive(site);
      for (let zi = 0; zi < 3; zi++) {
        const F = S.FISSURE[zi], st = window.__rifts.stations(zi), row = { site, zi, stations: st.length, gapMax: 0, cover: 0, worst: -1e9, worstAt: null, footWorst: -1e9, n: 0, slabHits: 0, slabAt: null };
        for (let i = 1; i < st.length; i++) row.gapMax = Math.max(row.gapMax, st[i].u - st[i - 1].u);
        row.cover = +((st[st.length - 1].u - st[0].u) / (2 * F.halfLen)).toFixed(2);
        for (let i = 0; i < st.length; i += 2) {
          const s = st[i];
          for (let j = 0; j < 24; j++) {
            const y0 = s.floor + (s.lip + 26 - s.floor) * j / 23, b = window.__rifts.radiusAt(zi, i, y0);
            if (b.y > s.lip + 8) continue;                       // high over the lip there is no rock to reach (the lip heave is <= 3 u)
            const open = openAt(s.x, s.z, b.y, zi, b.R + 1); row.n++;   // (a blob under 0.1 u is nothing; the march's step is 0.1 u)
            if (b.R > 0.1 && b.R - open > row.worst) { row.worst = +(b.R - open).toFixed(3); row.worstAt = { u: +s.u.toFixed(1), y: +(b.y - s.lip).toFixed(1), R: +b.R.toFixed(2), open: +open.toFixed(2) }; }
            row.footWorst = Math.max(row.footWorst, +(s.floor - (b.y - 0.95 * b.R * b.sy)).toFixed(3));
            // up and down too (review N6): the veil is drawn out R x sy up the vertical; no point of its
            // lit ellipsoid (0.95 of it) may lie inside an overhang slab's body
            if (b.R > 0.1) for (let e = -2; e <= 2; e++) for (let k = 0; k < 16; k++) {
              const th = e * 0.7, a = k / 16 * 6.2832, rr = 0.95 * b.R * Math.cos(th);
              const px = s.x + Math.cos(a) * rr, pz = s.z + Math.sin(a) * rr, py = b.y + 0.95 * b.R * b.sy * Math.sin(th);
              const sp = S.slabProbe(px, pz, zi);
              if (sp.q >= 0) { const top = T.terrainH(px, pz, zi); if (py < top + 0.3 && py > top - sp.th - 0.6) { row.slabHits++; row.slabAt = { u: +s.u.toFixed(1), y: +(py - s.lip).toFixed(2), R: +b.R.toFixed(2) }; } }
            }
          }
        }
        window.__fissure.setOpen(zi, 0); window.__bench.step(2); row.shutLight = window.__rifts.state(zi).light;
        window.__fissure.setOpen(zi, 1); window.__bench.step(2); row.openLight = window.__rifts.state(zi).light;
        const mats = window.__rifts.materials(zi);
        row.fogOff = mats.every(m => m.fog === false); row.additive = mats.every(m => m.blending === 2);
        row.keys = [...new Set(mats.map(m => m.customProgramCacheKey()))];
        out.rows.push(row);
      }
    }
    window.__chart.arrive(0);
    for (const zi of [0, 1, 2]) {
      window.gotoZone(zi); window.__fissure.setOpen(zi, 1);
      const F = S.FISSURE[zi], lip = S.lipMeanY(zi, T.terrainH), o = { x: 0, z: 0 };
      S.fissureWorld(-8, S._halfWAt(F, -8, 1) + 7, zi, o); window.__bench.place(o.x, o.z, 0, zi);
      const P = [F.cx - F.dz * 26, lip + 30, F.cz + F.dx * 26], L = [F.cx, lip - 6, F.cz];
      window.__camPin = { p: P, t: L, pos: P, look: L };
      window.__bench.step(20, null, { render: true });
      const ids = window.__rifts.materials(zi).map(m => { const p = R.properties.get(m).currentProgram; return p ? p.id : -1; });
      out.draw.push({ zi, ids: [...new Set(ids)] });
    }
    window.__camPin = null;
    // the surface glow from the deck (air) and from under the raft (water)
    window.__playtest.jump('1'); window.setState('play'); window.__helm = true; window.__fissure.setOpen(0, 1);
    window.__bench.step(10); out.surfAir = window.__rifts.state(0).surf;
    const surfMat = window.__rifts.materials(0).find(m => m.isSpriteMaterial); out.surfOpacity = surfMat ? surfMat.opacity : null; out.surfFog = surfMat ? surfMat.fog : null;
    window.gotoZone(0); window.__fissure.setOpen(0, 1); window.__bench.place(4, 4, 0, 0); window.__bench.step(10); out.surfWater = window.__rifts.state(0).surf;
    let lights = 0; window.scene.traverse(q => { if (q.isLight) lights++; }); out.lights = lights;
    return out; })()`);
  for (const w of r.rows) {
    const tag = `site ${w.site} zone ${w.zi}`;
    if (w.gapMax > 1.6 || w.cover < 0.78) fail.push(`${tag}: the curtain is not continuous (gap ${w.gapMax}, cover ${w.cover})`);
    if (w.worst > 0.1) fail.push(`${tag}: a blob's light reaches rock ` + JSON.stringify(w.worstAt) + ' by ' + w.worst);
    if (w.slabHits) fail.push(`${tag}: ${w.slabHits} points of the veil inside a slab's body ` + JSON.stringify(w.slabAt));
    if (w.footWorst > 0.05) fail.push(`${tag}: a blob's foot reaches the throat floor by ${w.footWorst}`);
    if (w.shutLight !== 0) fail.push(`${tag}: light over the shut jam ${w.shutLight}`);
    if (w.openLight !== 1) fail.push(`${tag}: open light ${w.openLight}`);
    if (!w.fogOff || !w.additive) fail.push(`${tag}: a part is fogged or not additive`);
    if (w.keys.some(k => !/^(rift|warmGlow)/.test(k))) fail.push(`${tag}: program keys ${w.keys}`);
  }
  for (const d of r.draw) if (d.ids.some(i => i < 0 || i > r.bootMax)) fail.push(`zone ${d.zi}: a program built after boot ${d.ids} > ${r.bootMax}`);
  if (r.surfAir !== true) fail.push('no surface glow from the deck');
  if (r.surfWater !== false) fail.push('the surface glow shows under the water');
  if (!(r.surfOpacity <= 0.16) || r.surfFog !== false) fail.push(`surface glow opacity ${r.surfOpacity} fog ${r.surfFog}`);
  if (r.lights !== 14) fail.push('light count ' + r.lights);
  console.log(JSON.stringify(r));
} else if (mode === 'pour-hide') {
  // NOTHING POPS IN THE LIGHT: with the deep's light welling up under the pour, every block must be
  // switched off only once it is wholly under the throat floor where it is NOW (every drawn vertex of
  // it, every third, under the ground at that vertex's x, z), and the silt
  // only once every vertex of it is under the throat floor below it. One opening per zone, at home.
  const r = await c.ev(`(async () => {
    const T = await import('/src/world/terrain.js'), THREE = await import('three');
    window.setState('play'); window.__helm = true; window.survival.hose = 5000;
    const out = [], m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    for (const zi of [0, 1, 2]) {
      window.gotoZone(zi); window.__fissure.setOpen(zi, 0); window.__bench.place(0, 0, 0, zi);
      window.__fissure.open(zi);
      const ims = [0, 1, 2, 3].map(k => window.scene.getObjectByName('fissureJam' + zi + '_' + k)).filter(Boolean);
      const prev = ims.map(im => new Float32Array(im.instanceMatrix.array));
      let hidden = 0, worst = -1e9, worstAt = null, siltWorst = -1e9, meshOffAt = -1, meshWorst = -1e9, meshLeft = 0, wasOn = true;
      // the worst drawn vertex of an instance (matrix array P at o) over the ground under it
      const overGround = (im, P, o) => { m.fromArray(P, o); const G = im.geometry.attributes.position; let w = -1e9;
        for (let v = 0; v < G.count; v += 3) { p.fromBufferAttribute(G, v).applyMatrix4(m); w = Math.max(w, p.y - T.terrainUnderH(p.x, p.z, zi)); } return w; };
      const silt = window.scene.getObjectByName('fissureSilt' + zi);
      window.__bench.step(60 * 23, i => {   // (the pour's whole clock: ROCK_T is 22 s)
        // the mesh-level switch-off (rockOn: every block gone, or the ROCK_T cap): anything still drawn
        // the frame before must already be under the ground
        const on = window.__fissure.state(zi).bouldersVisible;
        if (wasOn && !on && meshOffAt < 0) { meshOffAt = i; ims.forEach((im, a) => { const P = prev[a]; for (let k = 0; k < im.count; k++) { const o = k * 16;
          if (P[o] !== 0 || P[o + 5] !== 0 || P[o + 10] !== 0) { meshLeft++; meshWorst = Math.max(meshWorst, overGround(im, P, o)); } } }); }
        wasOn = on;
        ims.forEach((im, a) => {
          const A = im.instanceMatrix.array, P = prev[a];
          for (let k = 0; k < im.count; k++) {
            const o = k * 16, wasOn = P[o] !== 0 || P[o + 5] !== 0 || P[o + 10] !== 0, on = A[o] !== 0 || A[o + 5] !== 0 || A[o + 10] !== 0;
            if (wasOn && !on) {
              hidden++;
              // its own drawn vertices (every 3rd) against the ground under each
              m.fromArray(P, o); const G = im.geometry.attributes.position; let w = -1e9, wy = 0, wf = 0;
              for (let v = 0; v < G.count; v += 3) { p.fromBufferAttribute(G, v).applyMatrix4(m); const f = T.terrainUnderH(p.x, p.z, zi); if (p.y - f > w) { w = p.y - f; wy = p.y; wf = f; } }
              if (w > worst) { worst = w; worstAt = { frame: i, y: +wy.toFixed(2), floor: +wf.toFixed(2) }; }
            }
          }
          P.set(A);
        });
        if (silt && silt.visible) {
          // the frame before it goes: how far its highest vertex stands over the floor under it
          const S = silt.geometry.attributes.position.array; let w = -1e9;
          for (let v = 0; v < S.length; v += 3 * 7) w = Math.max(w, S[v + 1] - T.terrainUnderH(S[v], S[v + 2], zi));
          siltWorst = w;
        }
      });
      out.push({ zi, hidden, worstTopOverFloor: +worst.toFixed(3), worstAt, siltLastAboveFloor: +siltWorst.toFixed(3), left: window.__fissure.state(zi).left,
        meshOffAt: +(meshOffAt / 60).toFixed(2), meshLeft, meshWorst: meshLeft ? +meshWorst.toFixed(3) : null });
    }
    return out; })()`);
  for (const z of r) {
    if (z.hidden < 100) fail.push(`zone ${z.zi}: only ${z.hidden} blocks hid`);
    if (z.worstTopOverFloor > 0) fail.push(`zone ${z.zi}: a block hid ${z.worstTopOverFloor} u above the floor over it ` + JSON.stringify(z.worstAt));
    if (z.meshLeft && z.meshWorst > 0) fail.push(`zone ${z.zi}: the rubble switched off with ${z.meshLeft} blocks still drawn, ${z.meshWorst} u above the ground`);
    if (z.meshOffAt < 0) fail.push(`zone ${z.zi}: the rubble never switched off`);
    if (z.siltLastAboveFloor > 0.05) fail.push(`zone ${z.zi}: the silt hid with a part ${z.siltLastAboveFloor} u above the floor`);
  }
  console.log(JSON.stringify(r));
} else if (mode === 'below-dark') {
  // FROM BELOW NOTHING (review I1 + I2): from the zone under each crack (where the descent lands and
  // the ending rises), 40 u under its deepest throat floor, looking up at it: the open light adds
  // nothing to the frame (A/B: the light on against its gain zeroed, post bypassed so the frame is
  // the scene's own), and the roof shell hangs no blades into the view (frames kept).
  const fs = await import('node:fs');
  const r = await c.ev(`(async () => {
    const S = await import('/src/world/fissureShape.js'), P = await import('/src/postfx.js');
    window.setState('play'); window.__helm = true; window.survival.hose = 5000;
    P.setPostBypass(true);
    const out = [], K = window.__rifts.K;
    for (const zi of [0, 1, 2]) {
      const vis = window.__chart.visit(); vis[0] = vis[1] = vis[2] = 1;
      window.gotoZone(Math.min(2, zi + 1)); window.__fissure.setOpen(zi, 1);
      const F = S.FISSURE[zi], fl = window.__rifts.state(zi).floorMin, o = { x: 0, z: 0 };
      S.fissureWorld(0, 0, zi, o);
      const Pp = [o.x + F.dz * 6, fl - 40, o.z - F.dx * 6], L = [o.x, fl + 20, o.z];
      window.__camPin = { p: Pp, t: L, pos: Pp, look: L };
      const k0 = K[zi], shot = async () => { const cap = await window.__bench.capture({ frames: 12, settle: 90 }); return cap; };   // (settled: the grade on what is in front of the lens)
      window.__bench.step(30);
      // A/B (on, off) against an A/A pair (on, on): the frame is not bit-stable (drifting particles)
      const on = await shot(), on2 = await shot(); K[zi] = 0; const off = await shot(); K[zi] = k0;
      const cmp = (A, B) => { let sum = 0, big = 0; const n = A.px.length / 4;
        for (let i = 0; i < A.px.length; i += 4) { const d = Math.abs(A.px[i] - B.px[i]) + Math.abs(A.px[i + 1] - B.px[i + 1]) + Math.abs(A.px[i + 2] - B.px[i + 2]); sum += d; if (d > 12) big++; }
        return { mean: +(sum / n).toFixed(3), bigPct: +(100 * big / n).toFixed(3) }; };
      // and the discriminator: the same A/B with the gate forced open must show the light
      window.__rifts.tune.noGate = true; window.__bench.step(2); const ng = await shot(); window.__rifts.tune.noGate = false; window.__bench.step(2);
      out.push({ zi, camY: +Pp[1].toFixed(1), floorMin: +fl.toFixed(1), gate: window.__rifts.state(zi).gate, light: window.__rifts.state(zi).light, ab: cmp(on2, off), aa: cmp(on, on2), noGate: cmp(ng, off), url: window.__bench.png(on, 0.6) });
    }
    window.__camPin = null; P.setPostBypass(false);
    return out; })()`);
  for (const z of r) {
    fs.writeFileSync(`/Users/michaelpaulus/sc/.abyssa-wt/shots/fissure-t4f-below-z${z.zi}.png`, Buffer.from(z.url.split(',')[1], 'base64')); delete z.url;
    if (z.light !== 1) fail.push(`crack ${z.zi}: not open for the check`);
    if (z.gate !== 0) fail.push(`crack ${z.zi}: the light's gate is open from below ${z.gate}`);
    if (!(z.noGate.bigPct > z.aa.bigPct * 3 + 0.1)) fail.push(   // (on bigPct: settled frames move between captures, the mean's A/A floor is higher)
      `crack ${z.zi}: the check does not discriminate (gate forced open shows nothing) ` + JSON.stringify(z));
    if (z.ab.mean > z.aa.mean * 1.5 + 0.02 || z.ab.bigPct > z.aa.bigPct * 1.5 + 0.01) fail.push(`crack ${z.zi}: the light shows from below ` + JSON.stringify(z));
  }
  console.log(JSON.stringify(r));
} else if (mode === 'walls-inside') {
  // THE THROAT WALLS FROM INSIDE (Task 5b; page half: tools/bench/walls-inside.page.js).
  // (1) THE BOUND, every site x zone: every drawn crack surface (the patch inside the lip; the throat
  //     wall where there is one) against the heightfield Sal stands on (terrainUnderH), as a 3-D
  //     distance to its surface: it may lie back inside the collision rock (by at most WALL_RECESS)
  //     but stand out into the water (lens, body) by no more than WALL_PROTRUDE anywhere and by more
  //     than 0.25 u on no more than WALL_OUT25 of its samples; rays from the throat's axis to both
  //     walls (grazes and overhang slabs aside) find no gap (a drawn miss) and no drawn rock more than
  //     0.3 u in front of the heightfield's.
  // (2) THE LOOK, each zone open at every anchorage (home, Pallid, Burned, the Shelf), settled, from
  //     inside the throat looking up along it. THE GRAIN (fix round 1): the settled frame's fine band
  //     that runs in coherent lines (LINES x LINE SHARE: walls-inside.page.js look) under WALL_GRAIN:
  //     stretched 2-D noise beds drew zone 1 as wood grain and agate eyes. And the
  //     STREAK ratio of the drawn rock's view-space normals (their change across the wall's vertical
  //     axis over their change along it: a grid on a 30 u riser draws long vertical slivers, ratio
  //     6-8; layered rock changes most down the face) under WALL_STREAK, and the settled frame keeps its
  //     detail (local contrast over WALL_DETAIL: a smooth dark wall does not pass). With the A/B
  //     (terrain.js fissureWallAB) the old patch walls are measured too and the new must halve them.
  //     (The facet energy, the mean normal change, is reported: it was the RED's first metric and
  //     does not tell teeth from relief: the layered walls carry more relief than the teeth did.)
  const fs = await import('node:fs');
  // (WALL_OUT25: the worst measured share is 0.20%; the geometry is deterministic, the bound keeps 50%
  // headroom for later changes to the walls. WALL_GRAIN (fix round 1) = LINES x LINE SHARE: the zone-1
  // wood grain at 85e22f8 measured 0.049-0.066 at the four anchorages (zone 2's at Burned and the
  // Shelf 0.045-0.046), the 1-D beds <= 0.039 everywhere: the bound sits ~12% from each side.)
  const WALL_PROTRUDE = 0.8, WALL_OUT25 = 0.003, WALL_RECESS = 2.0, WALL_STREAK = 3.5, WALL_DETAIL = 0.035, WALL_GRAIN = 0.044;
  const bound = await c.ev(`(async () => {
    const W = await import('/tools/bench/walls-inside.page.js');
    window.setState('play'); window.__helm = true; window.survival.hose = 5000;
    const out = [];
    for (const site of [0, 1, 2]) {
      if (site) window.__chart.arrive(site);
      for (let zi = 0; zi < 3; zi++) out.push(Object.assign({ site, zi }, W.bound(zi), { rays: W.rays(zi) }));
    }
    window.__chart.arrive(0);
    return out; })()`);
  for (const b of bound) {
    for (const k of ['patch', 'wall']) {
      const s = b[k]; if (!s) continue;
      if (s.protrudeMax > WALL_PROTRUDE) fail.push(`site ${b.site} zone ${b.zi} ${k}: drawn rock stands ${s.protrudeMax} u out into the water (bound ${WALL_PROTRUDE}) at ${s.worstOut}`);
      if (s.over025 > WALL_OUT25) fail.push(`site ${b.site} zone ${b.zi} ${k}: ${(s.over025 * 100).toFixed(2)}% of the drawn rock stands > 0.25 u out into the water (bound ${WALL_OUT25 * 100}%)`);
      if (s.recessMax > WALL_RECESS) fail.push(`site ${b.site} zone ${b.zi} ${k}: drawn rock lies ${s.recessMax} u back in the rock (bound ${WALL_RECESS}) at ${s.worstIn}`);
    }
    const r = b.rays;
    if (r.gaps) fail.push(`site ${b.site} zone ${b.zi}: ${r.gaps}/${r.rays} rays see a gap (no drawn rock where the heightfield is) ` + JSON.stringify(r.bad));
    if (r.protrude) fail.push(`site ${b.site} zone ${b.zi}: ${r.protrude}/${r.rays} rays hit drawn rock more than 0.3 u in front of the rock (worst ${r.hitInFrontMax} ` + JSON.stringify(r.inFrontAt) + ')');
  }
  console.log(JSON.stringify(bound));
  const look = await c.ev(`(async () => {
    const W = await import('/tools/bench/walls-inside.page.js'), T = await import('/src/world/terrain.js');
    window.setState('play'); window.__helm = true; window.survival.hose = 5000; window.weather.set(1, 0);
    window.__bench.size(1280, 720);
    const out = [];
    for (const site of [0, 1, 2, 3]) {
      window.__chart.arrive(site);
      for (let zi = 0; zi < 3; zi++) {
        window.gotoZone(zi); window.lev.calmed = true; window.__fissure.setOpen(zi, 1);
        const row = { site, zi };
        const one = async tag => { const r = await W.look(zi); if (r.err) return r;
          row['png_' + tag] = window.__bench.png(r.cap, 0.5); delete r.cap; delete r.normals; return r; };
        row.now = await one('now');
        if (site === 0 && T.fissureWallAB) { T.fissureWallAB(false); try { row.old = await one('old'); } finally { T.fissureWallAB(true); } }
        out.push(row);
      }
    }
    window.__chart.arrive(0); window.__bench.size();
    return out; })()`);
  for (const z of look) {
    for (const k of ['now', 'old']) if (z['png_' + k]) { fs.writeFileSync(`/Users/michaelpaulus/sc/.abyssa-wt/shots/fissure-t5b-probe-s${z.site}-z${z.zi}-${k}.png`, Buffer.from(z['png_' + k].split(',')[1], 'base64')); delete z['png_' + k]; }
    const n = z.now, at = `site ${z.site} zone ${z.zi}`;
    if (n.err) { fail.push(`${at}: ${n.err}`); continue; }
    if (n.streak > WALL_STREAK) fail.push(`${at}: the walls draw as vertical slivers (teeth, stretched) from inside: streak ${n.streak} > ${WALL_STREAK}`);
    if (n.localContrast < WALL_DETAIL) fail.push(`${at}: the walls lost their detail: local contrast ${n.localContrast} < ${WALL_DETAIL}`);
    const grain = +(n.lines * n.lineShare).toFixed(4); n.grain = grain;
    if (grain > WALL_GRAIN) fail.push(`${at}: the walls' grain runs in fine coherent lines (wood grain, agate): grain ${grain} = lines ${n.lines} x share ${n.lineShare} (bound ${WALL_GRAIN})`);
    if (z.old && !(n.streak < 0.5 * z.old.streak)) fail.push(`${at}: no better than the old patch walls (streak ${n.streak} vs ${z.old.streak})`);
  }
  console.log(JSON.stringify(look.map(z => ({ site: z.site, zi: z.zi, now: z.now && { streak: z.now.streak, grain: z.now.grain, lines: z.now.lines, lineShare: z.now.lineShare, localContrast: z.now.localContrast, facet: z.now.facet },
    old: z.old && { streak: z.old.streak, lines: z.old.lines, lineShare: z.old.lineShare, localContrast: z.old.localContrast } }))));
  // (3) THE LENS ON THE FALL PATH: the real follow camera while Sal sinks through each open throat (three
  //     places along it), the frames its lens sits within the near plane (0.1 u) of drawn crack rock,
  //     the throat walls against the old patch walls on the same paths. The camera keeps no
  //     horizontal clearance in the crack (game.js clearCamDistance tests the floor under it), so the
  //     lens grazes the faces either way: the walls must not make it worse.
  const fall = await c.ev(`(async () => {
    const W = await import('/tools/bench/walls-inside.page.js'), T = await import('/src/world/terrain.js');
    const out = [];
    for (const ab of [true, false]) { if (T.fissureWallAB) T.fissureWallAB(ab); else if (ab === false) break;
      for (let zi = 0; zi < 3; zi++) for (const u of [-15, -4, 9]) out.push(Object.assign({ ab, u }, await W.fallLens(zi, { u }))); }
    if (T.fissureWallAB) T.fissureWallAB(true);
    return out; })()`);
  const close = ab => fall.filter(r => r.ab === ab).reduce((a, r) => a + r.closeFrames, 0), samp = ab => fall.filter(r => r.ab === ab).reduce((a, r) => a + r.samples, 0);
  const fallSum = { now: { close: close(true), samples: samp(true) }, old: { close: close(false), samples: samp(false) } };
  console.log(JSON.stringify({ fallSum, fall: fall.map(r => ({ ab: r.ab, zi: r.zi, u: r.u, close: r.closeFrames, samples: r.samples, minD: r.minD, at: r.at })) }));
  if (fallSum.old.samples && fallSum.now.close > 1.5 * fallSum.old.close + 15) fail.push(`the lens grazes the drawn rock on the fall more than with the old walls: ${fallSum.now.close}/${fallSum.now.samples} frames vs ${fallSum.old.close}/${fallSum.old.samples}`);

} else if (mode === 'fall-lens') {
  // THE LENS ON THE DESCENT (final fix wave I1; page half: walls-inside.page.js descentLens). The REAL
  // follow camera while Sal sinks through each open throat from the shut jam it opened under, ALL THE WAY
  // through the throat floor (final residual fix: in zones 0/1 the zone-change plane lies 10-16 u above
  // the throat floor, and the shaft below it was never measured; `postSwitch` counts that segment): three
  // stations along each crack x six headings relative to it (along, across both ways, the diagonals),
  // plus the look pitched down / up and a man turning while he falls. GATES, per case: 0 frames with
  // the lens within the near plane (0.1 u) of DRAWN crack rock (the patch, the throat walls, the
  // slabs); 0 frames with the lens under the heightfield he collides with at its own (x, z) (inside
  // the rock: the frame shows the void behind it) — zones 0 and 1: near the drawn rock and under the
  // heightfield each <= 1 sample a case and <= 3 in all (final residual fix: followed to the throat floor,
  // their bottom 10-16 u pinch like zone 2's, the drawn walls stand proud of collision in places and lie
  // back from it in others (walls-inside: up to 2 u); with the guard a spring (no cut) a sample can slip:
  // measured 0-2 a run, every under-the-heightfield one with drawn rock >= 0.25 u off, i.e. in water as
  // drawn); ZONE 2 within a bound:
  // <= 8 near frames a case, <= 12 near / 4 inside over its 23 cases (~5800 samples; measured 4-6 /
  // 1-2 with the lerp guard, 7-8 / 0 with the spring guard, every one 38-87 u down; the per-case 8 since
  // the spring guard: it ramps in instead of covering half the correction in a frame). Why a bound there: below ~40 u the zone-2 shaft
  // pinches at its kinks into pockets a few tenths of a unit to 1.6 u wide (u 15-25 off its centre),
  // and its drawn walls stand up to ~0.9-1.4 u proud of the collision heightfield at the ledge corners
  // (the strata ribbon chamfers the staircase), so the heightfield march the lens is placed by cannot
  // see every drawn face there; Sal (his chest) inside 85% of the frame every
  // sample once he has fallen 3 u off the jam (before that the frame is the shut jam's, unchanged; the
  // pitched-UP case is reported, not gated: he is looking away from himself); Sal's own chest never
  // inside the shaft's walls (salIn: under the heightfield where the shaft still has open water at his
  // feet: he drifted into a face) beyond a one-sample graze a case (<= 0.75 u, <= 4 in all: since the
  // final residual fix the hold eases him at <= 12 u/s instead of snapping him, so at a ledge in the
  // shaft's bottom he can graze the corner for a frame); >= 150 samples below the lip (a case that
  // measures nothing fails).
  // Reported, not gated: `inside` (behind the nearest drawn triangle by its winding: the patch's risers
  // do not all wind toward the water) and salUnderFloor (no open water left at his station: he sinks
  // through the throat floor toward the zone plane, which in zone 2 lies ~5-10 u under it; the lens
  // holds over the floor there). Each case runs on its own pinned clock and weather (the current that
  // sets him sideways is fbm in t). RED on 1d68aa0, this probe: of 16853 samples the lens near drawn
  // rock 761 (zone 2: 298), inside it 3843 (1491), Sal out of frame 1661, Sal in the walls 2645 (no
  // clearance across the crack: clearCamDistance tested only the floor under the boom, the 2.2 u
  // minimum, the floor clamp lifted the lens up a wall column; Sal drifted into the walls with no wall
  // test while overRift). GREEN (game.js THROAT_CAM, player.js holdInShaft): zones 0-1 all 0; zone 2
  // near 4-6, inside 1-2; out of frame 0; in the walls 0. Then the STANDING cases (below).
  const D90 = Math.PI / 2, cases = [];
  for (let zi = 0; zi < 3; zi++) {
    for (const u of [-15, -4, 9]) for (const yaw of [0, D90, -D90, D90 / 2, 3 * D90 / 2, 2 * D90]) cases.push({ zi, u, yaw });
    cases.push({ zi, u: -4, yaw: D90, pitch: -0.6 }, { zi, u: -4, yaw: 0, pitch: -0.6 }, { zi, u: -4, yaw: D90, pitch: 0.4 });
    cases.push({ zi, u: -4, yaw: 0, yawRate: 1.0 }, { zi, u: 9, yaw: D90, yawRate: -1.0 });
  }
  cases.forEach((k, i) => { k.t0 = 1000 + 37 * i; });   // each case its own repeatable clock (the current is fbm in t)
  const r = await c.ev(`(async () => {
    const W = await import('/tools/bench/walls-inside.page.js'); const out = [];
    for (const k of ${JSON.stringify(cases)}) out.push(await W.descentLens(k.zi, k));
    window.gotoZone(0);
    return out; })()`);
  let close = 0, hfIn = 0, inside = 0, off = 0, samples = 0, salIn = 0, salFloor = 0, guards = 0, snaps = 0;
  const post = { n: 0, close: 0, hfIn: 0, salIn: 0 };
  for (const q of r) {
    close += q.close; hfIn += q.hfIn; inside += q.inside; off += q.offFrame; samples += q.samples; salIn += q.salIn; salFloor += q.salFloor; guards += q.guards || 0; snaps += q.snaps || 0;
    for (const k in post) post[k] += q.post[k];
    if (q.zi < 2 && !q.through) fail.push(`zone ${q.zi} u ${q.u} yaw ${Math.round(q.yaw * 57.3)}: the descent was not followed through the throat floor`);
    const at = `zone ${q.zi} u ${q.u} yaw ${Math.round(q.yaw * 57.3)}${q.pitch ? ' pitch ' + q.pitch : ''}${q.yawRate ? ' turning ' + q.yawRate : ''}`;
    if (q.samples < 150) fail.push(`${at}: only ${q.samples} samples below the lip (the fall was not measured)`);
    if (q.zi < 2 && q.close > 1) fail.push(`${at}: the lens within ${q.near} u of drawn rock on ${q.close}/${q.samples} frames (min ${q.minD} at ${JSON.stringify(q.at)})`);
    if (q.zi < 2 && q.hfIn > 1) fail.push(`${at}: the lens inside the rock on ${q.hfIn}/${q.samples} frames`);
    if (q.zi === 2 && q.close > 8) fail.push(`${at}: the lens within ${q.near} u of drawn rock on ${q.close}/${q.samples} frames, over the zone-2 bound 8 (min ${q.minD})`);
    if (q.offFrame && !(q.pitch > 0)) fail.push(`${at}: Sal out of frame on ${q.offFrame}/${q.samples} frames (ndc y ${q.ndcLow}..${q.ndcHigh}, |x| ${q.ndcSide})`);
    if (q.salIn > 1 || q.salInMax > 0.75) fail.push(`${at}: Sal inside the shaft walls on ${q.salIn}/${q.samples} frames (up to ${q.salInMax} u under the rock)`);
  }
  const z2 = r.filter(q => q.zi === 2), z2close = z2.reduce((a, q) => a + q.close, 0), z2hf = z2.reduce((a, q) => a + q.hfIn, 0);
  const z01close = r.filter(q => q.zi < 2).reduce((a, q) => a + q.close, 0), z01hf = r.filter(q => q.zi < 2).reduce((a, q) => a + q.hfIn, 0);
  if (z01hf > 3) fail.push(`zones 0/1: the lens under the heightfield on ${z01hf} samples (bound 3, <= 1 a case)`);
  if (salIn > 4) fail.push(`Sal inside the shaft walls on ${salIn} samples in all (bound 4: one-sample grazes <= 0.75 u, the eased hold)`);
  if (z01close > 3) fail.push(`zones 0/1: the lens near drawn rock on ${z01close} samples (bound 3, <= 1 a case)`);
  if (z2close > 12 || z2hf > 4) fail.push(`zone 2: the lens near drawn rock on ${z2close} frames / inside it on ${z2hf} (bound 12 / 4)`);
  console.log(JSON.stringify({ cases: r.length, samples, close, hfIn, inside, offFrame: off, salIn, salUnderFloor: salFloor, z2close, z2hf, postSwitch: post, lensGuardFrames: guards, lensStiffFrames: snaps }));
  // STANDING in or at the open crack (the boom's floor test and the floor clamp stand aside only inside the
  // outline): per zone, stood on the broken lip (fd -0.4 / -1.2 on each side) at three stations and at both
  // tips, plus the probe's strata ledge, facing out of the crack, along it and into it, 3 s settled then 2 s
  // measured. RED on 1a79a7b: stood on zone 1's lip facing in, the lens sat 2.9 u inside the ground past the
  // lip on 60/60 samples (no floor clamp in the open crack, and the shaft's march only scans 1.5 u past the
  // lip). GATES, a bound: per stand <= 1 near-plane sample and <= 2 under the heightfield, over all 180
  // stands <= 3 and <= 4 (of ~10800). Measured over three runs: near 1/2/2, under 0/1/2, every one at a
  // crack TIP (0.88 halfLen, where the outline closes to a slot a lens can be either side of from frame to
  // frame), under by <= 0.16 u, a one-sample transient of the spring.
  const stand = await c.ev(`(async () => {
    const S = await import('/src/world/fissureShape.js'), T = await import('/src/world/terrain.js'), W = await import('/tools/bench/walls-inside.page.js');
    const o = { x: 0, z: 0 }, q = { x: 0, z: 0 }, out = [];
    for (let zi = 0; zi < 3; zi++) {
      const F = S.FISSURE[zi], spots = [];
      for (const u of [-12, 0, 12, -0.88 * F.halfLen, 0.88 * F.halfLen]) for (const sd of [0, 1]) for (const d of [0.4, 1.2]) {
        const w = S._halfWAt(F, u, sd); if (w < d + 0.3) continue;
        S.fissureWorld(u, (sd ? 1 : -1) * (w - d), zi, o); if (S.slabAt(o.x, o.z, zi) >= 0) continue;
        spots.push({ u, sd, d, x: o.x, z: o.z });
      }
      // a strata ledge (open-ledge's rule)
      const k = F.throatHalfW / F.halfW;
      for (let m = 0; m <= 40 && spots.length < 40; m++) { const u = (m % 2 ? -1 : 1) * Math.ceil(m / 2); let got = false;
        for (const sd of [0, 1]) { const sg = sd ? 1 : -1, w = S._halfWAt(F, u, sd);
          for (let v = w * k + 0.3; v < w - 0.6 && !got; v += 0.1) { S.fissureWorld(u, sg * v, zi, o); if (S.slabAt(o.x, o.z, zi) >= 0) continue;
            const h = T.terrainH(o.x, o.z, zi), nn = T.terrainNormal(o.x, o.z, zi); if (nn.y < 0.8 || S.lipMeanY(zi, T.terrainH) - h < 1.5) continue;
            S.fissureWorld(u, sg * (v + 0.7), zi, q); if (T.terrainH(q.x, q.z, zi) - h > 0.8) { spots.push({ u, sd, ledge: true, x: o.x, z: o.z }); got = true; } } }
        if (got) break; }
      for (const sp of spots) {
        const l = { u: 0, v: 0 }; S.fissureLocal(sp.x, sp.z, zi, l);
        const sg = l.v >= 0 ? 1 : -1, outX = -F.dz * sg, outZ = F.dx * sg;
        for (const [name, fx, fz] of [['out', outX, outZ], ['along', F.dx, F.dz], ['in', -outX, -outZ]]) {
          const r = await W.standLens(zi, { x: sp.x, z: sp.z, yaw: Math.atan2(fx, fz), t0: 2000 + out.length * 17 });
          out.push(Object.assign({ u: +sp.u.toFixed(1), sd: sp.sd, d: sp.d || null, ledge: !!sp.ledge, face: name }, r));
        }
      }
    }
    window.gotoZone(0);
    return out; })()`);
  let sClose = 0, sHf = 0;
  for (const q of stand) {
    sClose += q.close; sHf += q.hfIn;
    if (q.close > 1 || q.hfIn > 2) fail.push(`standing zone ${q.zi} u ${q.u} side ${q.sd} ${q.ledge ? 'ledge' : 'lip ' + q.d} facing ${q.face}: the lens near drawn rock ${q.close} / in the rock ${q.hfIn} of ${q.samples} (min ${q.minD}, hf ${q.hfMax})`);
  }
  if (sClose > 3 || sHf > 4) fail.push(`standing: the lens near drawn rock on ${sClose} / under the ground on ${sHf} samples over ${stand.length} stands (bound 3 / 4)`);
  console.log(JSON.stringify({ standing: stand.length, close: sClose, hfIn: sHf }));
  // FRAME-RATE INDEPENDENCE (final residual fix): nine descents (per zone: across, along, turning) stepped
  // at dt 1/60 and at dt 1/30. Per frame: the lens's speed relative to Sal and the guard's one-frame move as
  // a speed. GATES: the lens's worst speed relative to him <= 60 u/s at both rates (no cut: 1 u a frame at 60
  // fps; per case and the 1/30 : 1/60 ratio are reported: the follow spring itself is explicit Euler at dt);
  // and the guard's own one-frame move, as a speed, never
  // over 45 u/s at either rate (RED on 6cf1039, the lerp guard, instrumented to record every move: see the
  // final-fix report); at 1/30 the
  // whole-shaft gates hold within a bound (zones 0/1: <= 2 near-plane and <= 2 in-rock samples a case: the
  // follow spring itself is explicit Euler at dt and trails further at 30 fps); Sal never in the walls.
  const fr = await c.ev(`(async () => {
    const W = await import('/tools/bench/walls-inside.page.js'); const out = [];
    for (const dt of [1 / 60, 1 / 30]) for (let zi = 0; zi < 3; zi++) for (const k of [{ u: -4, yaw: Math.PI / 2 }, { u: 9, yaw: 0 }, { u: -4, yaw: 0, yawRate: 1.0 }]) {
      const q = await W.descentLens(zi, Object.assign({ dt, every: dt > 0.02 ? 1 : 2, t0: 3000 + out.length * 23 }, k));
      out.push({ dt: q.dt, zi, u: k.u, yaw: Math.round(k.yaw * 57.3), turn: k.yawRate || 0, n: q.samples, close: q.close, hfIn: q.hfIn, salIn: q.salIn, relMax: q.relMax, relAt: q.relAt,
        guardSpeed: q.guardStepMax == null ? null : +(q.guardStepMax / q.dt).toFixed(1), salStepMax: q.salStepMax });
    }
    window.gotoZone(0); return out; })()`);
  const agg = dt => { const a = fr.filter(q => Math.abs(q.dt - dt) < 1e-3); return { rel: Math.max(...a.map(q => q.relMax)), guard: Math.max(...a.map(q => q.guardSpeed || 0)), salStep: Math.max(...a.map(q => q.salStepMax)) }; };
  const f60 = agg(0.0167), f30 = agg(0.0333);
  console.log(JSON.stringify({ frameRate: { dt60: f60, dt30: f30 } }));
  for (const q of fr) console.log(JSON.stringify(q));
  if (f30.rel > 60 || f60.rel > 60) fail.push(`frame rate: the lens moved ${f60.rel} u/s relative to him at 1/60, ${f30.rel} at 1/30 (no-cut bound 60: 1 u a frame at 60 fps)`);
  // the guard's own move: a speed limit per SECOND (45 u/s), so no frame rate turns it into a cut
  if (f60.guard > 46 || f30.guard > 46) fail.push(`frame rate: the guard moved the lens at ${f60.guard} u/s at 1/60, ${f30.guard} at 1/30 (limit 45)`);
  const a60 = fr.filter(q => q.dt < 0.02), a30 = fr.filter(q => q.dt > 0.02);
  // (per case reported, not gated: the follow spring itself is explicit Euler at dt, and since the shaft
  // hold eases him his path differs a little between the two rates)
  void a30; void a60;
  for (const q of fr) if (q.dt > 0.02 && (q.zi < 2 && (q.close > 2 || q.hfIn > 2) || q.salIn)) fail.push('at dt 1/30: ' + JSON.stringify(q));
  // SAL'S LATERAL STEP (final residual fix 3: the shaft hold was a hard clamp that snapped him up to 2.75 u
  // in a frame at a ledge, 3.8 u rising back into the shaft from under its floor). Every descent above (and
  // the frame-rate ones) plus RISES: per zone 0/1, under the throat floor at u -4 and 9, beside the slot
  // (dv -1.5 / +1.5) and under it, Space held (the burst) then the dress, at dt 1/60 and 1/30. GATES: his
  // lateral step <= 0.25 u a frame at 1/60 (0.5 at 1/30), the hold's own step <= its 12 u/s limit.
  const rise = await c.ev(`(async () => {
    const W = await import('/tools/bench/walls-inside.page.js'); const out = [];
    for (const dt of [1 / 60, 1 / 30]) for (const zi of [0, 1]) for (const u of [-4, 9]) for (const dv of [-1.5, 0, 1.5])
      out.push(await W.riseShaft(zi, { u, dv, dt, t0: 4000 + out.length * 13 }));
    window.gotoZone(0); return out; })()`);
  const stepCap = dt => dt > 0.02 ? 0.5 : 0.25, holdCap = dt => 12 * dt + 1e-3;
  const desc = r.concat(fr.map(q => ({ zi: q.zi, u: q.u, yaw: q.yaw * Math.PI / 180, dt: q.dt, salStepMax: q.salStepMax, holdStepMax: null })));
  let stepW = 0, holdW = 0;
  for (const q of desc) { stepW = Math.max(stepW, q.salStepMax || 0); holdW = Math.max(holdW, q.holdStepMax || 0);
    if ((q.salStepMax || 0) > stepCap(q.dt || 1 / 60)) fail.push(`zone ${q.zi} u ${q.u} yaw ${Math.round((q.yaw || 0) * 57.3)}: Sal stepped ${q.salStepMax} u in one frame (dt ${q.dt || '1/60'})`);
    if ((q.holdStepMax || 0) > holdCap(q.dt || 1 / 60)) fail.push(`zone ${q.zi} u ${q.u}: the shaft hold moved him ${q.holdStepMax} u in a frame`); }
  for (const q of rise) { stepW = Math.max(stepW, q.salStepMax);
    if (q.frames < 30) fail.push('rise did not come up into the crack ' + JSON.stringify(q));
    if (q.salStepMax > stepCap(q.dt)) fail.push('rising: Sal stepped ' + q.salStepMax + ' u in one frame ' + JSON.stringify(q));
    if (q.holdStepMax > holdCap(q.dt)) fail.push('rising: the shaft hold moved him ' + q.holdStepMax + ' u in a frame ' + JSON.stringify(q)); }
  console.log(JSON.stringify({ salStep: { worst: +stepW.toFixed(3), holdWorst: +holdW.toFixed(3), rises: rise.length, riseWorst: Math.max(...rise.map(q => q.salStepMax)), riseHoldWorst: Math.max(...rise.map(q => q.holdStepMax || 0)) } }));
  for (const q of rise) console.log(JSON.stringify(q));
  for (const q of r) console.log(JSON.stringify({ zi: q.zi, u: q.u, yaw: Math.round(q.yaw * 57.3), pitch: q.pitch, turn: q.yawRate, n: q.samples, close: q.close, hfIn: q.hfIn, inside: q.inside, off: q.offFrame,
    minD: q.minD, ndc: [q.ndcLow, q.ndcHigh, q.ndcSide], boom: [q.boomMin, q.boomMax], end: q.endBelowLip, salIn: q.salIn, salInMax: q.salInMax, salAt: q.salAt, salFloor: q.salFloor, salFloorAt: q.salFloorAt, offAll: q.offAll, holds: q.shaftHolds, closeAt: q.closeAt, hfAt: q.hfAt, offAt: q.offAt }));
} else if (mode === 'ending') {
  // THE ENDING THREADS THE OPEN THROATS (final fix wave M5). playEnding() with all three fissures open
  // this visit, 4500 stepped frames (dt 1/60). Per frame, for the diver (his eye, player.pos) and the
  // lens:
  //   band     - ending.js's own insideFloor criterion, y in (h - 26, h + 1.8) of a zone's floor, with its
  //              y-window (zoneBottom - 62 .. + 190): Task 1's numbers (camera 2/19/0, diver 18/7/0)
  //   bandAll  - the same band WITHOUT the y-window (the throat floors lie ~70 u under the lips, below
  //              zoneBottom - 62: the window hides the diver's last ~14 u under each throat floor; the
  //              final review's 68/52 counted these)
  //   hidden   - his chest under the floor of his own column while the lens is over the floor of its
  //              own (the same zone's floor): he is inside the rock and the lens on the other side
  //   occluded - during the rise, the line from the lens to his chest enters the rock from the water
  //              side (a front-face crossing of any zone's heightfield: the throat walls and floors as
  //              drawn within ~1 u), his body in the water
  // GATES: hidden 0, occluded <= 60 of the ~2730 rise frames (the lens's release up through each floor
  // after him and the zone-0 crossing's first frames), the ending holds 'won'. RED on 1d68aa0 (ending.js
  // unchanged since Task 1): band cam 2/19/0 diver 18/7/0 (Task 1's numbers reproduce), bandAll diver
  // 66/49/241 (the review's 68/52: the window was dropped), hidden 74 (19/3/52: he rose the last ~14 u
  // under each throat floor with the lens 5-12 u over it), occluded 292 (zone 2's pinched throat: 230).
  // GREEN (ending.js FLOOR_UNDER / UNDER_HIM / LOS_F): hidden 0, occluded 33; the lens's own band frames
  // rise (2/19/0 -> 32/5/118: it now waits under each floor with him, where the floor is a culled back face).
  const r = await c.ev(`(async () => {
    const T = await import('/src/world/terrain.js'), C = await import('/src/config.js');
    window.setState('play'); window.__helm = true; window.survival.hose = 5000;
    for (let zi = 0; zi < 3; zi++) window.__fissure.setOpen(zi, 1);
    window.__bench.step(5);
    window.playEnding();
    const bandOf = (x, y, z, win) => { for (let zi = 0; zi < 3; zi++) { if (win && (y < C.zoneBottom(zi) - 62 || y > C.zoneBottom(zi) + 190)) continue;
      const h = T.terrainH(x, z, zi); if (y < h + 1.8 && y > h - 26) return zi; } return -1; };
    const nearZone = y => { let best = -1, bd = 1e9; for (let zi = 0; zi < 3; zi++) { const d = Math.abs(y - (C.zoneBottom(zi) - 40)); if (d < bd) { bd = d; best = zi; } } return best; };
    const out = { cam: [0, 0, 0], div: [0, 0, 0], camAll: [0, 0, 0], divAll: [0, 0, 0], hidden: [0, 0, 0], occluded: 0, occAt: [], hidAt: [], rise: 0 };
    // +1 over a floor, -1 under it (the zone whose floor lies within 40 u), 0 in the open water between
    const above = (x, y, z) => { for (let zi = 0; zi < 3; zi++) { const h = T.terrainH(x, z, zi); if (Math.abs(y - h) < 40) return y > h ? 1 : -1; } return 0; };
    window.__bench.step(4500, i => {
      const p = window.player.pos, c = window.camera.position, t = i / 60;
      let b = bandOf(c.x, c.y, c.z, true); if (b >= 0) out.cam[b]++;
      b = bandOf(p.x, p.y, p.z, true); if (b >= 0) out.div[b]++;
      b = bandOf(c.x, c.y, c.z, false); if (b >= 0) out.camAll[b]++;
      b = bandOf(p.x, p.y, p.z, false); if (b >= 0) out.divAll[b]++;
      // hidden: the floor nearest him (the zone whose floor lies within 30 u)
      let hid = false;
      for (let zi = 0; zi < 3; zi++) { const hd = T.terrainH(p.x, p.z, zi); if (Math.abs(p.y - hd) > 30) continue;
        if (p.y - 0.5 < hd && c.y > T.terrainH(c.x, c.z, zi)) { hid = true; out.hidden[zi]++; if (out.hidAt.length < 12) out.hidAt.push([i, zi, +(p.y - hd).toFixed(1)]); } break; }
      if (t > 6.5 && t < 52) { out.rise++;
        if (!hid) { const y0 = p.y - 0.5; let prev = above(c.x, c.y, c.z), occ = false;
          const d = Math.hypot(p.x - c.x, y0 - c.y, p.z - c.z), n = Math.max(8, Math.ceil(d / 0.5));
          for (let k = 1; k < n; k++) { const f = k / n, x = c.x + (p.x - c.x) * f, y = c.y + (y0 - c.y) * f, z = c.z + (p.z - c.z) * f;
            const a = above(x, y, z); if (prev > 0 && a < 0) { occ = true; break; } if (a !== 0) prev = a; }
          if (occ) { out.occluded++; if (out.occAt.length < 16) out.occAt.push([i, +p.y.toFixed(1)]); } } }
    });
    out.state = window.gameState;
    return out; })()`);
  console.log(JSON.stringify(r));
  const sum = a => a.reduce((x, y) => x + y, 0);
  if (r.state !== 'won') fail.push('the ending did not hold the won state: ' + r.state);
  if (sum(r.hidden)) fail.push(`the diver was inside the rock with the lens on the other side on ${sum(r.hidden)} frames (${r.hidden.join('/')}) ` + JSON.stringify(r.hidAt));
  if (r.occluded > 60) fail.push(`the lens's line to him ran through rock on ${r.occluded}/${r.rise} rise frames ` + JSON.stringify(r.occAt));
} else if (mode === 'wave-minors') {
  // THE FINAL WAVE'S SMALL FIXES, each through the game's own path (RED: each fix reverted alone).
  //  M1 the sonar's "way down" echo keys on the FISSURE (open past half), not the calm: calmed but still
  //     shut, no echo; open (whatever the calm flag says), the echo rings at the LIP (lipMeanY + 1), not
  //     down at the throat floor.
  //  M2 the harpoon's contact over the SHUT jam churns silt at the point (the floor under it is the jam,
  //     shutFloorY; terrainH there is the throat floor ~70 u down, so it never fired over the jam).
  //  M9 "THE RIFT IS SHUT WHILE IT WAKES." never while she sleeps (he stands on the jam 25 s, she dormant);
  //     once she is awake and he stands on it, it is said.
  //  M10 a zone's ward count still waiting for a silence is dropped when she stills (zone 1: the calm lands
  //     before the count is said; 25 s after it the count has not been said).
  const r = await c.ev(`(async () => {
    const S = await import('/src/world/fissureShape.js'), T = await import('/src/world/terrain.js'), Tools = await import('/src/systems/tools.js');
    window.setState('play'); window.__helm = true; window.survival.hose = 5000; window.survival.fuel = 1; window.survival.oxygen = 1;
    const out = {}, o = { x: 0, z: 0 }, $msg = document.getElementById('msg');
    const said = (n, hold) => { const seen = []; window.__bench.step(n, () => { if (hold) hold(); window.survival.oxygen = 1; window.survival.fuel = 1;
      const m = $msg.classList.contains('on') ? $msg.textContent : null; if (m && seen[seen.length - 1] !== m) seen.push(m); }); return seen; };
    // ---- M1
    window.gotoZone(0); const F = S.FISSURE[0], lip = S.lipMeanY(0, T.terrainH);
    S.fissureWorld(0, S._halfWAt(F, 0, 1) + 3, 0, o); window.__bench.place(o.x, o.z, 0, 0);
    const ping = () => { window.__bench.step(400); Tools.sonarPing(window.player.pos, 0); return window.tools.echoes().filter(e => Math.abs(e[3] - 0.58) < 1e-3 && Math.abs(e[4] - 0.95) < 1e-3); };
    window.lev.calmed = true; window.__fissure.setOpen(0, 0); window.__bench.step(2);
    const a = ping(); window.lev.calmed = true; window.__fissure.setOpen(0, 0);
    out.m1 = { calmedShut: a.length };
    window.lev.calmed = false; window.__fissure.setOpen(0, 1); window.__bench.step(2);
    const b = ping();
    out.m1.openUncalmed = b.length; out.m1.y = b.length ? +(b[0][1] - lip).toFixed(2) : null;
    window.__fissure.setOpen(0, 0); window.lev.calmed = false;
    // ---- M2
    window.gotoZone(0); window.__fissure.setOpen(0, 0); window.lev.calmed = false;
    window.survival.hasHarpoon = true;
    S.fissureWorld(0, 0, 0, o); window.__bench.place(o.x, o.z, 0, 0);
    window.player.pos.y = T.shutFloorY(o.x, o.z, 0) + 1.35; window.player.vel.set(0, 0, 0); window.player.pitch = -0.3;
    window.__bench.step(60);
    window.__slash(); const t0 = window.__bladeLast ? window.__bladeLast.t : -1;
    window.__bench.step(40);
    const BL = window.__bladeLast;
    out.m2 = { contact: !!BL && BL.t !== t0, kind: BL && BL.kind, puff: BL ? BL.puff : null, onJam: window.player.jamY != null };
    window.survival.hasHarpoon = false; window.player.pitch = 0;
    // ---- M9
    window.gotoZone(0); window.__fissure.setOpen(0, 0); window.lev.calmed = false;
    S.fissureWorld(0, 0, 0, o); const hx = o.x, hz = o.z;
    const hold = () => { window.player.pos.x = hx; window.player.pos.z = hz; };
    window.__bench.place(hx, hz, 0, 0); window.player.pos.y = T.shutFloorY(hx, hz, 0) + 1.35;
    const asleep = said(1500, hold);
    out.m9 = { dormant: !!window.lev.dormant, asleepSaid: asleep.includes('THE RIFT IS SHUT WHILE IT WAKES.'), asleep };
    window.lev.cmd('wake'); window.__bench.step(10); window.lev.cmd('wake');
    window.__bench.place(hx, hz, 0, 0); window.player.pos.y = T.shutFloorY(hx, hz, 0) + 1.35;
    const awake = said(1500, hold);
    out.m9.awakeDormant = !!window.lev.dormant; out.m9.awakeSaid = awake.includes('THE RIFT IS SHUT WHILE IT WAKES.'); out.m9.awake = awake;
    // ---- M10
    window.gotoZone(1); window.__fissure.setOpen(1, 0);
    S.fissureWorld(0, 30, 1, o); window.__bench.place(o.x, o.z, 0, 1);
    for (const g of window.lev.sigils) g.lit = true;
    let calmAt = -1; window.__bench.step(120, i => { if (calmAt < 0 && window.lev.calmed) calmAt = i; });
    const after = said(1500);
    out.m10 = { calmAt, wardsSaid: after.some(m => /IRON WARDS/.test(m)), after };
    window.gotoZone(0);
    return out; })()`);
  console.log(JSON.stringify(r));
  if (r.m1.calmedShut) fail.push('M1: the way-down echo rang over a still-shut jam (calmed, fissure shut)');
  if (r.m1.openUncalmed !== 1) fail.push('M1: no way-down echo over the open fissure ' + JSON.stringify(r.m1));
  else if (Math.abs(r.m1.y - 1) > 0.5) fail.push('M1: the way-down echo is not at the lip (' + r.m1.y + ' u off lipMeanY)');
  if (!r.m2.contact) fail.push('M2: the thrust never landed ' + JSON.stringify(r.m2));
  else if (r.m2.puff !== 1) fail.push('M2: no silt at the point over the shut jam ' + JSON.stringify(r.m2));
  if (!r.m9.dormant) fail.push('M9: she was not asleep for the asleep half');
  if (r.m9.asleepSaid) fail.push('M9: "THE RIFT IS SHUT WHILE IT WAKES." said while she slept');
  if (r.m9.awakeDormant || !r.m9.awakeSaid) fail.push('M9: not said on the jam with her awake ' + JSON.stringify(r.m9.awake));
  if (r.m10.calmAt < 0) fail.push('M10: the wards never calmed her');
  if (r.m10.wardsSaid) fail.push('M10: the ward count was said after the calm ' + JSON.stringify(r.m10.after));
} else if (mode === 'clearance') {
  // EVERYTHING CLEARS THE CRACK (spec §1 Lairs, Task 5). At every anchorage (the hidden shelf too),
  // in every zone: every collider (rocks, props, wrecks, vents), every placed instance (flora,
  // gardens, props, physics debris), every resource node, the wrecks' sites and the three lairs
  // keep >= 6 u + their own radius off the lip (fissureDist is negative inside the crack).
  // Velkath: her lair centre (radius R), her whole REST OUTLINE (every shell vertex) >= 6 u, her silt
  // skirt never over the lip (>= 1 u), her near flank (L.nearFlank, Task 6's harpoon side) out on
  // open walkable sand.
  const r = await c.ev(`(async () => {
    const S = await import('/src/world/fissureShape.js'), T = await import('/src/world/terrain.js');
    const Fl = await import('/src/world/flora.js'), Pr = await import('/src/world/props.js'), Wr = await import('/src/world/wrecks.js');
    const Ve = await import('/src/world/vents.js'), Re = await import('/src/world/resources.js'), THREE = await import('three'), { scene } = await import('/src/core.js');
    window.setState('play'); window.__helm = true;
    const out = [], info = [], m4 = new THREE.Matrix4(), v = new THREE.Vector3();
    const zoneOf = (x, y, z) => { for (let zi = 0; zi < 3; zi++) if (Math.abs(y - T.terrainH(x, z, zi)) < 25) return zi; return -1; };
    const owner = o => { while (o && o.parent && o.parent !== scene && !(o.userData && o.userData.benchSrc)) o = o.parent; return o && o.userData ? o.userData.benchSrc || '' : ''; };
    const SCAN = /^(world\\/flora|world\\/gardens|world\\/props|systems\\/physics)$/;
    for (const site of [0, 1, 2, 3]) {
      window.__chart.arrive(site);
      const worst = {};
      const bad = (n, zi, x, z, rad, need = 6) => {
        const d = S.fissureDist(x, z, zi) - rad;
        if (!(n in worst) || d < worst[n]) worst[n] = +d.toFixed(1);
        if (d < need) out.push({ site, zi, n, d: +d.toFixed(1), at: [+x.toFixed(1), +z.toFixed(1)] });
        return d; };
      for (const [n, list] of [['rock', Fl.rockColliders], ['prop', Pr.propColliders], ['wreckCol', Wr.wreckColliders], ['vent', Ve.ventColliders]])
        for (const q of list) { const zi = zoneOf(q.x, q.y, q.z); if (zi >= 0) bad(n, zi, q.x, q.z, q.r); }
      for (const nd of Re.nodes) { const p = nd.grp.position, zi = zoneOf(p.x, p.y, p.z); if (zi >= 0) bad('resource', zi, p.x, p.z, 1); }
      for (let zi = 0; zi < 3; zi++) for (const w of (window.wrecks && window.wrecks.sites ? window.wrecks.sites(zi) : [{ x: 0, z: 0, r: 1e9, missing: 1 }])) {
        if (w.missing) { out.push({ site, zi, n: 'wrecks.sites missing' }); continue; }
        bad('wreck', zi, w.x, w.z, w.r || 10); }
      for (let zi = 0; zi < 3; zi++) {
        window.gotoZone(zi);
        scene.traverse(o => {
          if (!o.isInstancedMesh || !SCAN.test(owner(o))) return;
          o.updateWorldMatrix(true, false);
          for (let i = 0; i < o.count; i++) {
            o.getMatrixAt(i, m4); v.setFromMatrixPosition(m4).applyMatrix4(o.matrixWorld);
            if (zoneOf(v.x, v.y, v.z) !== zi) continue;
            bad('inst:' + owner(o).split('/')[1], zi, v.x, v.z, 0);
          } });
        const L = window.lev;
        if (!L) continue;
        if (L.kind === 'brooder') {
          bad('lair', zi, L.lairPos.x, L.lairPos.z, L.R || 10);
          L.body.updateMatrixWorld(true);
          const P = L.parts.shell.geometry.attributes.position, mw = L.parts.shell.matrixWorld;
          let om = 1e9;
          for (let i = 0; i < P.count; i += 3) { v.fromBufferAttribute(P, i).applyMatrix4(mw); om = Math.min(om, S.fissureDist(v.x, v.z, zi)); }
          if (om < 6) out.push({ site, zi, n: 'velkath outline', d: +om.toFixed(1) });
          let sm = 1e9;
          if (L.skirt) { const Q = L.skirt.geometry.attributes.position; for (let i = 0; i < Q.count; i++) sm = Math.min(sm, S.fissureDist(Q.getX(i), Q.getZ(i), zi)); }
          if (sm < 1) out.push({ site, zi, n: 'velkath skirt', d: +sm.toFixed(1) });
          const nf = L.nearFlank, fd = nf ? S.fissureDist(nf.x, nf.z, zi) : -1e9;
          const ny = nf ? T.terrainNormal(nf.x, nf.z, zi).y : 0;
          if (!nf || fd < 6 + 0.5 * L.R || ny < 0.8) out.push({ site, zi, n: 'velkath near flank', fd: +fd.toFixed(1), ny: +ny.toFixed(2) });
          // her bed (sleeper/lair.js clearOfBed): no rock under her (a rock top lifts her standing sole)
          for (const q of Fl.rockColliders) if (zoneOf(q.x, q.y, q.z) === 0) {
            const d = Math.hypot(q.x - L.lairPos.x, q.z - L.lairPos.z) - q.r;
            if (d < 1.3 * L.R) out.push({ site, zi, n: 'rock under velkath', d: +d.toFixed(1), r: +q.r.toFixed(1) }); }
          info.push({ site, zi, lairFd: +S.fissureDist(L.lairPos.x, L.lairPos.z, zi).toFixed(1), outline: +om.toFixed(1), skirt: +sm.toFixed(1), flankFd: +fd.toFixed(1), flankNy: +ny.toFixed(2) });
        }
        if (L.kind === 'hoarder') { bad('orune', zi, L.pos.x, L.pos.z, L.R || 10); if (L.hoard && L.hoard.center) bad('trawler hoard', zi, L.hoard.center.x, L.hoard.center.z, 14); }
        if (L.furnace && L.furnace.pos) bad('furnace', zi, L.furnace.pos.x, L.furnace.pos.z, 6);
      }
      info.push({ site, worst });
    }
    window.__chart.arrive(0);
    return { out, info }; })()`);
  console.log(JSON.stringify(r.info));
  if (r.out.length) fail.push(`too close to the crack (${r.out.length}): ` + JSON.stringify(r.out.slice(0, 60)));
} else if (mode === 'velkath-crack') {
  // AWAKE BY HER CRACK (Task 5; ritefair numbers re-checked). At home, Pallid and Burned: she is woken
  // and hunts a diver who stands right at her crack's lip (fd 1.5-3, several stations along it
  // either side of her, and out on the shut jam itself); over 15 s each: her centre never comes
  // inside APRON + STAND.keep R of the lip (0.3 u slack for the per-frame push), her drawn
  // shell never inside 12 u of it (the 14 u apron, 2 u slack); then him under her for 3 s: her dark wards over
  // the floor stay where ritefair left them (6.7-9.6 u; fail > 10.5: reach 7 + one tap-hop) and the shell keeps its STAND.clear. THROWS: from 160 spots by the lip (fd 0.5-10, either side,
  // along the whole crack) in 8 directions each, the guarded hammer throw (safeThrow, knockUp,
  // 26 u/s through the real player step) never carries him into the crack (fd < 0 at any frame);
  // the unguarded share is reported as the discriminator. (final wave M4) Her feet (planted and
  // swinging) never stand inside the lip (fd >= 0). OPEN, from inside the lip on the broken lip (off
  // the throat): the guarded throw always leans out of the crack; shut there, it is left alone.
  const r = await c.ev(`(async () => {
    const S = await import('/src/world/fissureShape.js'), T = await import('/src/world/terrain.js');
    const B = await import('/src/entities/sleeper/brooder.js'), THREE = await import('three');
    window.setState('play'); window.__helm = true; window.survival.hose = 5000;
    const out = { hunt: [], throws: [] }, v = new THREE.Vector3(), o = { x: 0, z: 0 };
    const EYE = 1.35, keep = S.APRON + B.STAND.keep * 15.4;
    for (const site of [0, 1, 2]) {
      window.__chart.arrive(site); window.gotoZone(0); window.__fissure.setOpen(0, 0);
      const L = window.lev; if (!L || L.kind !== 'brooder') { out.hunt.push({ site, err: 'no brooder' }); continue; }
      const lair = L.lairPos.clone(), l = { u: 0, v: 0 }; S.fissureLocal(lair.x, lair.z, 0, l);
      const sg = l.v >= 0 ? 1 : -1, F = S.FISSURE[0];
      const spots = [];
      for (const du of [-14, 0, 14]) { const u = Math.max(-F.halfLen * 0.85, Math.min(F.halfLen * 0.85, l.u + du));
        S.fissureWorld(u, sg * (S._halfWAt(F, u, sg > 0 ? 1 : 0) + 2), 0, o); spots.push([o.x, o.z, 'lip']); }
      S.fissureWorld(l.u, 0, 0, o); spots.push([o.x, o.z, 'jam']);
      for (const [sx, sz, kind] of spots) {
        window.__chart.arrive(site); window.gotoZone(0); window.__fissure.setOpen(0, 0);
        const L = window.lev; L.cmd('wake');
        window.__bench.place(sx, sz, 0, 0); window.player.pos.y = T.shutFloorY(sx, sz, 0) + EYE; window.player.vel.set(0, 0, 0);
        let minC = 1e9, minO = 1e9, minClr = 1e9, frames = 0, minFoot = 1e9;
        const footScan = () => { for (const f of L.feet) { minFoot = Math.min(minFoot, S.fissureDist(f.cur.x, f.cur.z, 0), S.fissureDist(f.planted.x, f.planted.z, 0)); } };
        const P = L.parts.shell.geometry.attributes.position;
        const shellScan = () => { const mw = L.parts.shell.matrixWorld; let low = 1e9;
          for (let k = 0; k < P.count; k += 7) { v.fromBufferAttribute(P, k).applyMatrix4(mw); minO = Math.min(minO, S.fissureDist(v.x, v.z, 0)); low = Math.min(low, v.y - T.terrainH(v.x, v.z, 0)); }
          minClr = Math.min(minClr, low); };
        window.__bench.step(900, i => {
          window.player.pos.x = sx; window.player.pos.z = sz;   // he holds his ground at the lip
          if (L.standE < 0.9) return; frames++;
          minC = Math.min(minC, S.fissureDist(L.pos.x, L.pos.z, 0)); footScan();
          if (i % 12 === 0) shellScan(); });
        // then him under her (the refuge), 3 s: her dark wards over the floor under each (ritefair's table)
        const ux = L.pos.x, uz = L.pos.z;
        window.__bench.place(ux, uz, 0, 0); window.player.vel.set(0, 0, 0);
        window.__bench.step(180, i => { minC = Math.min(minC, S.fissureDist(L.pos.x, L.pos.z, 0)); footScan(); if (i % 12 === 0) shellScan(); });
        const wards = L.sigils.filter(g => !g.lit).map(g => +(g.grp.position.y - T.terrainH(g.grp.position.x, g.grp.position.z, 0)).toFixed(1));
        out.hunt.push({ site, kind, frames, minCentre: +minC.toFixed(2), keep: +keep.toFixed(2), minOutline: +minO.toFixed(2), minFoot: +minFoot.toFixed(2), wardsUnder: wards, minShellClear: +minClr.toFixed(2),
          salFd: +S.fissureDist(sx, sz, 0).toFixed(1) });
      }
    }
    // throws (home terrain)
    window.__chart.arrive(0); window.gotoZone(0); window.__fissure.setOpen(0, 0);
    const F = S.FISSURE[0]; let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    let n = 0, inG = 0, inU = 0; const worst = [];
    for (let k = 0; k < 160; k++) {
      const u = (rnd() * 2 - 1) * F.halfLen * 1.05, sd = rnd() < 0.5 ? 1 : 0, d = 0.5 + rnd() * 9.5;
      S.fissureWorld(u, (sd ? 1 : -1) * (S._halfWAt(F, Math.max(-F.halfLen, Math.min(F.halfLen, u)), sd) + d), 0, o);
      if (S.fissureDist(o.x, o.z, 0) < 0.4) continue;
      for (let a = 0; a < 8; a++) {
        const th = a / 8 * Math.PI * 2 + rnd() * 0.3;
        for (const guard of [true, false]) {
          v.set(Math.cos(th), 0, Math.sin(th));
          if (guard) B.safeThrow(v, o.x, o.z, 0);
          v.y = B.STAND.knockUp; v.normalize();
          window.__bench.place(o.x, o.z, 0, 0); window.player.pos.y = T.shutFloorY(o.x, o.z, 0) + EYE;
          window.player.vel.set(0, 0, 0).addScaledVector(v, 26); window.player.grounded = false;
          let m = 1e9; window.__bench.step(90, () => { m = Math.min(m, S.fissureDist(window.player.pos.x, window.player.pos.z, 0)); });
          if (guard) { n++; if (m < 0) { inG++; if (worst.length < 8) worst.push({ at: [+o.x.toFixed(1), +o.z.toFixed(1)], th: +th.toFixed(2), m: +m.toFixed(2) }); } }
          else if (m < 0) inU++;
        }
      }
    }
    out.throws = { n, intoCrackGuarded: inG, intoCrackUnguarded: inU, worst };
    // (final wave M4) OPEN, from INSIDE the lip (fd -0.3..-1.6, off the throat, where a man stands on the
    // broken lip): the guarded throw always leans OUT, away from the throat (its flat direction's share
    // along the outward normal >= 0.3, in 16 headings); shut, it is left alone (the jam is under him). The
    // throw's own lift (knockUp, buoyancy) mostly carries him over the crack whichever way it points, so
    // this is the contract, checked directly: on 1d68aa0 safeThrow returned early inside the lip and
    // half of these headings pointed in.
    const g2 = { x: 0, z: 0 }, fdAt = (x, z) => S.fissureDist(x, z, 0);
    let n2 = 0, inG2 = 0, inU2 = 0, shutMoved = 0; const worst2 = [];
    for (let k = 0; k < 60; k++) {
      const u = (rnd() * 2 - 1) * F.halfLen * 0.8, sd = rnd() < 0.5 ? 1 : 0, d = 0.3 + rnd() * 1.3;
      S.fissureWorld(u, (sd ? 1 : -1) * (S._halfWAt(F, u, sd) - d), 0, o);
      if (S.inThroat(o.x, o.z, 0) || fdAt(o.x, o.z) >= 0) continue;
      const h = 0.75, gx = fdAt(o.x + h, o.z) - fdAt(o.x - h, o.z), gz = fdAt(o.x, o.z + h) - fdAt(o.x, o.z - h), gl = Math.hypot(gx, gz) || 1;
      g2.x = gx / gl; g2.z = gz / gl;
      for (let a = 0; a < 16; a++) {
        const th = a / 16 * Math.PI * 2;
        window.__fissure.setOpen(0, 1); window.__bench.step(1);   // (the shut flag follows k on the next update)
        v.set(Math.cos(th), 0, Math.sin(th)); const outU = v.x * g2.x + v.z * g2.z;
        B.safeThrow(v, o.x, o.z, 0); const outG = (v.x * g2.x + v.z * g2.z) / Math.max(1e-6, Math.hypot(v.x, v.z));
        n2++; if (outG < 0.3) { inG2++; if (worst2.length < 6) worst2.push({ at: [+o.x.toFixed(1), +o.z.toFixed(1)], th: +th.toFixed(2), out: +outG.toFixed(2) }); }
        if (outU < 0) inU2++;
        window.__fissure.setOpen(0, 0); window.__bench.step(1);
        v.set(Math.cos(th), 0, Math.sin(th)); B.safeThrow(v, o.x, o.z, 0);
        if (Math.abs(v.x - Math.cos(th)) > 1e-9 || Math.abs(v.z - Math.sin(th)) > 1e-9) shutMoved++;
      }
    }
    out.throwsOpen = { n: n2, inwardGuarded: inG2, inwardUnguarded: inU2, shutMoved, worst: worst2 };
    window.__fissure.setOpen(0, 0); if (window.lev) window.lev.calmed = false;
    window.__chart.arrive(0);
    return out; })()`);
  console.log(JSON.stringify(r));
  for (const h of r.hunt) {
    if (h.err) { fail.push(h.err); continue; }
    if (h.frames < 200) fail.push(`site ${h.site} ${h.kind}: she never stood (${h.frames} frames)`);
    if (h.minCentre < h.keep - 0.3) fail.push(`site ${h.site} ${h.kind}: her centre came ${h.minCentre} off the lip (keep ${h.keep})`);
    if (h.minOutline < 12) fail.push(`site ${h.site} ${h.kind}: her shell came ${h.minOutline} off the lip (onto the 14 u apron)`);
    if (Math.max(...h.wardsUnder) > 10.5) fail.push(`site ${h.site} ${h.kind}: a dark ward hung ${Math.max(...h.wardsUnder)} u over him under her (ritefair: 6.7-9.6, reach 7 + a tap-hop)`);
    if (h.minShellClear < 3.0) fail.push(`site ${h.site} ${h.kind}: her shell came ${h.minShellClear} u over the ground (STAND.clear 3.6)`);
  }
  for (const h of r.hunt) if (!h.err && h.minFoot < 0) fail.push(`site ${h.site} ${h.kind}: one of her feet stood ${h.minFoot} u inside the lip`);
  if (r.throws.intoCrackGuarded) fail.push(`a guarded throw carried him into the crack: ${r.throws.intoCrackGuarded}/${r.throws.n} ` + JSON.stringify(r.throws.worst));
  if (!r.throws.intoCrackUnguarded) fail.push('the throw check does not discriminate (no unguarded throw reached the crack)');
  const to = r.throwsOpen;
  if (!(to.n >= 300)) fail.push(`open-crack throws: only ${to.n} measured`);
  if (to.inwardGuarded) fail.push(`OPEN, from inside the lip: ${to.inwardGuarded}/${to.n} guarded throws do not lean out of the crack ` + JSON.stringify(to.worst));
  if (!to.inwardUnguarded) fail.push('the open-crack throw check does not discriminate (no unguarded heading pointed in)');
  if (to.shutMoved) fail.push(`SHUT, inside the lip: ${to.shutMoved} throws were turned (the jam is under him: left alone)`);
} else fail.push(`unknown mode ${mode}`);
c.close();
stop();
if (fail.length) { console.error('FAIL', fail); process.exit(1); } else console.log('PASS');
