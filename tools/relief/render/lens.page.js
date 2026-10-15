// In-page helpers shared by the render tools (stills.mjs, shade.mjs, exposure.mjs): window.__lk. An async function body (drive.mjs style).
  const T = await import('/src/world/terrain.js'), S = await import('/src/world/fissureShape.js'), Lr = await import('/src/entities/sleeper/lair.js'), Wk = await import('/src/world/wrecks.js');
  const EYE = 3.75, g = (x, z) => T.terrainH(x, z, 0), L = window.lev, F = S.FISSURE[0], W0 = Wk.wreckSites()[0], bed = Lr.bedAt();
  const fwd = yaw => [Math.sin(yaw), Math.cos(yaw)];
  const lk = window.__lk = { g, EYE, L, F, W0, bed, S, T, log: {} };
  lk.refill = () => { const s = window.survival; s.oxygen = 1; s.fuel = 1; s.hose = 5000; };
  // Sal 9 u ahead of the lens and 3.5 u to its right (lens-relative), facing the same way
  lk.salFor = (lx, lz, yaw) => { const [fx, fz] = fwd(yaw); return [lx + fx * 9 - fz * 3.5, lz + fz * 9 + fx * 3.5]; };
  // the lens at (lx, lz), EYE over this build's ground, looking at yaw/pitch; Sal stood by it
  lk.view = (lx, lz, yaw, pitch) => {
    lk.refill(); window.__camPin = null;
    const [sx, sz] = lk.salFor(lx, lz, yaw); window.__bench.place(sx, sz, yaw, 0);
    const py = g(lx, lz) + EYE, [fx, fz] = fwd(yaw), cp = Math.cos(pitch);
    window.__camPin = { p: [lx, py, lz], t: [lx + fx * cp * 60, py + Math.sin(pitch) * 60, lz + fz * cp * 60] };
    return { lens: [lx, py, lz], sal: [sx, sz] };
  };
  // the lens at (lx, lz), EYE over the ground, looking at the point (tx, ty, tz)
  lk.viewAt = (lx, lz, tx, ty, tz) => {
    const yaw = Math.atan2(tx - lx, tz - lz); lk.refill(); window.__camPin = null;
    const [sx, sz] = lk.salFor(lx, lz, yaw); window.__bench.place(sx, sz, yaw, 0);
    const py = g(lx, lz) + EYE; window.__camPin = { p: [lx, py, lz], t: [tx, ty, tz] };
    return { lens: [lx, py, lz], sal: [sx, sz], yaw, pitch: Math.atan2(ty - py, Math.hypot(tx - lx, tz - lz)) };
  };
  lk.shot = async name => {
    lk.refill();
    window.__bench.step(120, null, { render: true });   // the exposure adapts up in ~3 s: pre-roll before the settled capture
    const cap = await window.__bench.capture({ settle: 90, frames: 12 });
    const url = window.__bench.png(cap, 1), ex = window.__exposure.state();
    lk.log[name] = { cam: window.camera.position.toArray(), camPin: window.__camPin, exposure: ex, sal: window.player.pos.toArray(), w: cap.w, h: cap.h };
    return url;
  };
  return 1;
