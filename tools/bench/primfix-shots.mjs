// PRIMFIX SHOTS (2026-10-13) - A CAPTURE TOOL, NOT A GATE. The same framings before and after the
// primitives batch (reviews/primitives-audit.md): one close framing per item and the survey (~20 home
// zone-0 spots on the follow lens, then Pallid Bank via __chart.arrive(1), then home again).
//   node tools/bench/primfix-shots.mjs <port> <tag> [outdir] [only]   (serve.py must already serve <port>)
// Env DRV_PORT (default 9511). Every frame: Sal stood with __bench.place (air/fuel refilled), the lens
// settled behind him (or pinned for the close framings: window.__camPin), __bench.capture({ settle: 90 }).
// `only`: a comma list of shot names (prefix match) to run instead of all of them.
const [, , PORT, TAG = 'after', OUTD0 = '/Users/michaelpaulus/sc/.abyssa-wt/shots/primfix', ONLY = ''] = process.argv;
process.env.DRV_PORT = process.env.DRV_PORT || '9511';
const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs'); const { tmpdir } = await import('node:os');
process.env.DRV_DIR = mkdtempSync(tmpdir() + '/abyssa-primfix-shots-');
const { start, stop, connect, sleep } = await import('./drv.mjs');
const OUTD = OUTD0 + '/' + TAG;
mkdirSync(OUTD, { recursive: true });
await start(`http://localhost:${PORT}/?bench`);
process.on('exit', () => stop());
const c = await connect();
await c.until(`!document.getElementById('load') && typeof window.setState === 'function' && window.__bench`, 240000, 1000);
await c.ev(`(window.__bench.size(1280, 720), window.__helm = true, window.setState('play'), window.__drs.pin(1), window.__power.set(60, 60), 1)`);
await sleep(4000);
await c.ev(`(['title','pause'].forEach(id => { const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; }), document.getElementById('hud') && (document.getElementById('hud').style.visibility = 'hidden'), 1)`);

// in-page helpers: stand Sal (refilled), optionally pin the lens, capture settled
await c.ev(`(window.__pf = {
  refill() { const s = window.survival; s.oxygen = 1; s.fuel = 1; s.hose = 5000; },
  stand(x, z, yaw, zone = 0) { this.refill(); window.__camPin = null; return window.__bench.place(x, z, yaw, zone); },
  // stand him at distance d from target (tx, tz) on bearing a (from the target), facing it
  facing(tx, tz, d, a, zone = 0) { const x = tx + Math.sin(a) * d, z = tz + Math.cos(a) * d; return this.stand(x, z, Math.atan2(tx - x, tz - z), zone); },
  async shot(settle = 90) { this.refill(); const cap = await window.__bench.capture({ settle }); return window.__bench.png(cap, 1); }
}, 1)`);

const SHOTS = [];
const add = (name, js) => SHOTS.push({ name, js });
// ---- the items (zone 0, home): the lens PINNED at a fixed offset from each target, Sal stood
// 3.5 u beside it facing it (his lantern on it, out of the frame's middle) ----
await c.ev(`(window.__pf.pin = function (tx, tz, d, a, h, ty) {
  const y0 = ty != null ? ty : window.__pfFloor(tx, tz);
  const sx = tx + Math.sin(a + 1.9) * 3.5, sz = tz + Math.cos(a + 1.9) * 3.5;
  this.stand(sx, sz, Math.atan2(tx - sx, tz - sz));
  window.__camPin = { p: [tx + Math.sin(a) * d, y0 + h, tz + Math.cos(a) * d], t: [tx, y0 + 0.2, tz] };
}, 1)`);
const DEBRIS_FIND = `(() => { let best = null, bd = 1e9; const m = new window.player.pos.constructor(), M = new (window.camera.matrixWorld.constructor)();
  window.__pfScene.traverse(o => { if (!o.isInstancedMesh || !(o.name || '').startsWith('debris') && !(o.geometry && o.geometry.type === 'DodecahedronGeometry')) return;
    for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, M); m.setFromMatrixPosition(M); const d = Math.hypot(m.x - 60, m.z - 20); if (d < bd) { bd = d; best = m.clone(); } } });
  return best; })()`;
add('i1-debris-near', `const p = ${DEBRIS_FIND}; window.__pf.pin(p.x, p.z, 3.4, 2.2, 1.6); return await window.__pf.shot();`);
add('i1-debris-wide', `window.__pf.stand(70, 40, -2.0); return await window.__pf.shot();`);
add('i2-shell-near', `const S = window.lev.brood.shellsAt, T = window.lev.brood.trailA; const a = Math.atan2(T.x - S.x, T.z - S.z); window.__pf.pin(S.x, S.z, 9, a + 0.5, 3.2); return await window.__pf.shot();`);
add('i2-shell-wide', `const S = window.lev.brood.shellsAt, T = window.lev.brood.trailA; const a = Math.atan2(T.x - S.x, T.z - S.z); window.__pf.facing(S.x, S.z, 12, a - 0.4); return await window.__pf.shot();`);
add('i3-casings', `const S = window.lev.brood.shellsAt, P = window.lev.pos; const a = Math.atan2(P.x - S.x, P.z - S.z); const tx = S.x + Math.sin(a) * 5, tz = S.z + Math.cos(a) * 5;
  const y0 = window.__pfFloor(tx, tz), sx = tx + Math.sin(a + 1.9) * 3.5, sz = tz + Math.cos(a + 1.9) * 3.5; window.__pf.stand(sx, sz, Math.atan2(tx - sx, tz - sz));
  window.__camPin = { p: [tx + Math.sin(a) * 4.5, y0 + 2.4, tz + Math.cos(a) * 4.5], t: [tx - Math.sin(a) * 2, y0, tz - Math.cos(a) * 2] }; return await window.__pf.shot();`);
add('i4-pits', `const B = window.lev.brood, T = B.trailA, P = window.lev.pos; const dx = P.x - T.x, dz = P.z - T.z, dl = Math.hypot(dx, dz);
  const f = 0.42, cx = T.x + dx * f, cz = T.z + dz * f, px = -dz / dl, pz = dx / dl, bend = Math.sin(f * Math.PI) * 14;
  const tx = cx + px * (bend + 13), tz = cz + pz * (bend + 13), y0 = window.__pfFloor(tx, tz);
  window.__pf.stand(tx - px * 6, tz - pz * 6, Math.atan2(px, pz));
  window.__camPin = { p: [tx - dx / dl * 7 + px * 2, y0 + 5.5, tz - dz / dl * 7 + pz * 2], t: [tx + dx / dl * 2, y0, tz + dz / dl * 2] }; return await window.__pf.shot();`);
add('i5-reef', `const r = window.lev.parts.reef; r.updateMatrixWorld(true); const b = new (window.camera.position.constructor)(); r.geometry.computeBoundingBox(); r.geometry.boundingBox.getCenter(b); r.localToWorld(b);
  const P = window.lev.pos; window.__pf.stand(P.x + 22, P.z + 4, -1.4);
  window.__camPin = { p: [b.x + 6, b.y + 4, b.z + 5], t: [b.x, b.y - 0.8, b.z] }; return await window.__pf.shot();`);
add('i5-reef-low', `const r = window.lev.parts.reef; const b = new (window.camera.position.constructor)(); r.geometry.boundingBox.getCenter(b); r.localToWorld(b);
  const P = window.lev.pos; window.__pf.stand(P.x + 22, P.z + 4, -1.4);
  window.__camPin = { p: [b.x - 14, b.y + 1.5, b.z - 10], t: [b.x, b.y - 1, b.z] }; return await window.__pf.shot();`);
add('i6-skiff', `let mk = null; window.__pfScene.traverse(o => { if (!mk && (o.name === 'relicMarker' || (o.geometry && o.geometry.type === 'IcosahedronGeometry' && o.geometry.parameters.radius === 0.34))) mk = o.name === 'relicMarker' ? o : o.parent; });
  const host = mk.parent, V = window.camera.position.constructor; host.updateMatrixWorld(true);
  const cp = host.localToWorld(new V(1.5, 3.4, -12.5)), ct = host.localToWorld(new V(0.5, 0.4, -3.6)), st = host.localToWorld(new V(-1.5, 0, -6.5));
  window.__pf.stand(st.x, st.z, 0); window.__camPin = { p: cp.toArray(), t: ct.toArray() }; return await window.__pf.shot();`);
add('i6-skiff-b', `let mk = null; window.__pfScene.traverse(o => { if (!mk && (o.name === 'relicMarker' || (o.geometry && o.geometry.type === 'IcosahedronGeometry' && o.geometry.parameters.radius === 0.34))) mk = o.name === 'relicMarker' ? o : o.parent; });
  const host = mk.parent, V = window.camera.position.constructor; host.updateMatrixWorld(true);
  const cp = host.localToWorld(new V(-3.0, 3.6, 12.5)), ct = host.localToWorld(new V(-3.0, 0.3, 5.0)), st = host.localToWorld(new V(-1.0, 0, 8.5));
  window.__pf.stand(st.x, st.z, 3.1); window.__camPin = { p: cp.toArray(), t: ct.toArray() }; return await window.__pf.shot();`);
add('i6-skiff-wide', `const W = window.wrecks.list()[0]; window.__pf.facing(W.x, W.z, 11, 2.4); return await window.__pf.shot();`);
add('i7-polymer', `window.__pf.pin(27.1, 25.5, 6, -2.3, 2.5); return await window.__pf.shot();`);
// ---- the survey: 20 home spots (rings + bearings), the follow lens ----
const RING = [[30, 0.3], [30, 2.4], [30, 4.4], [55, 1.0], [55, 3.0], [55, 5.2], [80, 0.2], [80, 1.6], [80, 3.6], [80, 5.0],
  [105, 0.8], [105, 2.2], [105, 4.0], [130, 0.0], [130, 1.9], [130, 3.3], [130, 5.6], [150, 1.2], [150, 2.8], [150, 4.8]];
RING.forEach(([r, a], k) => add(`s0-${String(k).padStart(2, '0')}`, `window.__pf.stand(${(Math.sin(a) * r).toFixed(2)}, ${(Math.cos(a) * r).toFixed(2)}, ${(a + 2.2).toFixed(2)}); return await window.__pf.shot();`));
// ---- Pallid Bank (arrive(1)): six spots + her trail, then home ----
add('p-arrive', `window.__chart.arrive(1); window.__helm = true; await new Promise(r => setTimeout(r, 1500)); window.__pf.stand(30, 30, 0.8); return await window.__pf.shot();`);
[[50, 0.9], [70, 2.5], [90, 4.1], [110, 5.4], [130, 1.7]].forEach(([r, a], k) => add(`p-${k}`, `window.__pf.stand(${(Math.sin(a) * r).toFixed(2)}, ${(Math.cos(a) * r).toFixed(2)}, ${(a + 2.2).toFixed(2)}); return await window.__pf.shot();`));
add('p-shell', `const S = window.lev.brood.shellsAt, T = window.lev.brood.trailA; const a = Math.atan2(T.x - S.x, T.z - S.z); window.__pf.facing(S.x, S.z, 8, a + 0.5); return await window.__pf.shot();`);
add('p-debris', `const p = ${DEBRIS_FIND}; window.__pf.facing(p.x, p.z, 3.2, 2.2); return await window.__pf.shot();`);
add('p-skiff', `const W = window.wrecks.list()[0]; window.__pf.facing(W.x, W.z, 6, 0.9); return await window.__pf.shot();`);
add('h-back', `window.__chart.arrive(0); window.__helm = true; await new Promise(r => setTimeout(r, 1500)); const p = ${DEBRIS_FIND}; window.__pf.facing(p.x, p.z, 3.2, 2.2); return await window.__pf.shot();`);

await c.ev(`(async () => { const { scene } = await import('/src/core.js'); const { terrainH } = await import('/src/world/terrain.js'); window.__pfScene = scene; window.__pfFloor = (x, z) => terrainH(x, z, 0); return 1; })()`);
const only = ONLY ? ONLY.split(',') : null;
const log = [];
for (const s of SHOTS) {
  if (only && !only.some(o => s.name.startsWith(o))) continue;
  const t0 = Date.now();
  try {
    const url = await c.ev(`(async () => { ${s.js} })()`);
    writeFileSync(`${OUTD}/${s.name}.png`, Buffer.from(url.split(',')[1], 'base64'));
    log.push(`${s.name} ok ${Date.now() - t0} ms`);
  } catch (e) { log.push(`${s.name} FAIL ${e.message.slice(0, 200)}`); }
  console.log(log[log.length - 1]);
}
console.log(JSON.stringify(await c.ev(`({ lights: (() => { let n = 0; window.__pfScene.traverse(o => { if (o.isLight) n++; }); return n; })(), shader: window.__shaderFailed(), safe: window.__safeFailed() })`)));
c.close();
stop();
process.exit(0);
