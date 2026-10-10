// THE FISSURE probe (spec docs/superpowers/specs/2026-10-10-fissure-and-harpoon-design.md).
//   node tools/bench/fissure-probe.mjs <shape|jam-stand|throat-edges|slabs> <port>   (serve.py must already serve <port>)
// Env DRV_PORT (CDP debug port, default 9481). drv.mjs reads DRV_PORT when it is first
// evaluated, so the default is set BEFORE the driver is imported (a static import is hoisted).
const [, , mode, port] = process.argv;
process.env.DRV_PORT = process.env.DRV_PORT || '9481';
// A FRESH PROFILE per run: the game saves its chart (endingSeen, calms) to localStorage, and a run
// that played the ending would turn the next run's zone-2 fall into the quiet ink beat.
const { mkdtempSync, rmSync } = await import('node:fs'); const { tmpdir } = await import('node:os');
process.env.DRV_DIR = mkdtempSync(tmpdir() + '/abyssa-fissure-probe-');
const { start, stop, connect } = await import('./drv.mjs');
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
  // jitters (and never leaves the zone); the jam sits above every calm-gated trigger plane at every
  // site, and below the lip all round the outline (so stepping in is a step DOWN, never up).
  const r = await c.ev(`(async () => {
    const S = await import('/src/world/fissureShape.js'); const T = await import('/src/world/terrain.js');
    const C = await import('/src/config.js');
    const EYE_H = 1.35, trig = zi => zi < 2 ? C.zoneBottom(zi) - C.ZONE_GAP * 0.55 : C.zoneBottom(2) - 70;
    window.setState('play'); window.__helm = true; window.survival.hose = 5000;
    const o = { x: 0, z: 0 }, out = { stand: [], planes: [] };
    for (let zi = 0; zi < 3; zi++) {
      window.gotoZone(zi); if (window.lev) window.lev.calmed = false; window.__fissure.setOpen(zi, 0);
      const F = S.FISSURE[zi], jam = S.jamTopY(zi, T.terrainH);
      window.__bench.place(F.cx, F.cz, 0, zi);
      window.player.pos.y = jam + EYE_H;            // place() stands him on terrainH: the throat floor
      let minY = 1e9, maxStep = 0, last = null, minN = 1;
      window.__bench.step(300, () => { const y = window.player.pos.y; minY = Math.min(minY, y);
        if (last != null) maxStep = Math.max(maxStep, Math.abs(y - last)); last = y; });
      out.stand.push({ zi, jam: +jam.toFixed(2), minY: +minY.toFixed(3), maxStep: +maxStep.toFixed(4), zone: window.zone,
        grounded: window.player.grounded, drift: +Math.hypot(window.player.pos.x - F.cx, window.player.pos.z - F.cz).toFixed(3) });
    }
    for (const site of [0, 1, 2]) {
      if (site) window.__chart.arrive(site);
      for (let zi = 0; zi < 3; zi++) {
        // the jam's whole profile (jamYAt ramps up toward the tips): under both lip points at every
        // station, never steeper than 1 (walkable well inside the 52 deg limit)
        const F = S.FISSURE[zi], jam = S.jamTopY(zi, T.terrainH); let lipMin = 1e9, under = 1e9, slope = 0, prev = null;
        for (let u = -F.halfLen; u <= F.halfLen + 1e-9; u += 0.1) {
          const jy = S.jamYAt(u, zi, T.terrainH);
          if (prev != null) slope = Math.max(slope, Math.abs(jy - prev) / 0.1); prev = jy;
          for (const sd of [0, 1]) {
            S.fissureWorld(u, (sd ? 1 : -1) * S._halfWAt(F, u, sd), zi, o); const h = T.terrainH(o.x, o.z, zi);
            lipMin = Math.min(lipMin, h); under = Math.min(under, h - jy); } }
        out.planes.push({ site, zi, jam: +jam.toFixed(2), ends: [+S.jamYAt(-F.halfLen, zi, T.terrainH).toFixed(2), +S.jamYAt(F.halfLen, zi, T.terrainH).toFixed(2)],
          trigger: trig(zi), aboveTrigger: +(jam - trig(zi)).toFixed(2), lipMin: +lipMin.toFixed(2), underLip: +under.toFixed(3), maxSlope: +slope.toFixed(3) });
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
  for (const p of r.planes) {
    if (!(p.aboveTrigger > 1.35 + 5)) fail.push(`site ${p.site} zone ${p.zi}: jam not clear of the trigger plane ` + JSON.stringify(p));
    if (!(p.underLip > 0)) fail.push(`site ${p.site} zone ${p.zi}: a lip point dips below the jam ` + JSON.stringify(p));
    if (!(p.maxSlope <= 1.0)) fail.push(`site ${p.site} zone ${p.zi}: jam ramp too steep ` + JSON.stringify(p));
  }
  console.log(JSON.stringify(r));
} else if (mode === 'throat-edges') {
  // OPEN: from the opening's centre he falls through to the next zone (zone 2: the ending); 1 u
  // outside the lip he does not. Hauling across the throat mid-fall (W held, facing a wall, C held to
  // vent: a trimmed diver sinks ~3-4 u/s, the jam was 60-80 u above the trigger) he is kept in the
  // throat column, never snapped up onto the wall. Zone 0 also sinks free from the centre, no input.
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
      // haul across the crack mid-fall: facing the side-1 wall, W held from the first frame
      for (const sd of [1, 0]) {
        open(zi);
        window.__bench.place(F.cx, F.cz, 0, zi);
        window.player.pos.y = S.jamTopY(zi, T.terrainH) + 1.35;   // from where the jam was
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
        if (zi === 2) break;   // the first haul ends the game
      }
      if (zi === 0) {   // no input at all: stood where the jam was, he sinks through on his own
        open(0); window.__bench.place(F.cx, F.cz, 0, 0); window.player.pos.y = S.jamTopY(0, T.terrainH) + 1.35;
        let n = 0; window.__bench.step(4800, i => { n = i; if (window.zone !== 0) return false; });
        res.freeSink = { zone: window.zone, seconds: +(n / 60).toFixed(1) };
      }
      out.push(res);
    }
    return out; })()`);
  for (const z of r) {
    if (z.lipZone !== z.zi) fail.push(`zone ${z.zi}: fell through from the lip`);
    if (z.freeSink && z.freeSink.zone !== 1) fail.push('zone 0: did not sink through the open throat unaided ' + JSON.stringify(z.freeSink));
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
        window.player.pos.y = Math.max(T.terrainH(o.x, o.z, zi), S.jamYAt(sl.u0, zi, T.terrainH)) + 1.35;
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
  // A riser up to JAM_STEP (0.8 u, player.js) over the jam is a step he takes in a few frames; more
  // than that in one frame is a snap. A slab whose top sits within a step of the jam (room <= 1.1)
  // is a ledge he may step onto; any higher one must never be stood on from below.
  for (const z of r) {
    if (z.maxRise > 0.85) fail.push(`zone ${z.zi} slab u0 ${z.u0}: snapped up ${z.maxRise}`);
    if (z.onTop && z.room > 1.1) fail.push(`zone ${z.zi} slab u0 ${z.u0}: stood on the slab from below ` + JSON.stringify(z));
  }
  console.log(JSON.stringify(r));
} else fail.push(`unknown mode ${mode}`);
c.close();
stop();
if (fail.length) { console.error('FAIL', fail); process.exit(1); } else console.log('PASS');
