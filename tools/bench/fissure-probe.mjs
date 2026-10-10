// THE FISSURE probe (spec docs/superpowers/specs/2026-10-10-fissure-and-harpoon-design.md).
//   node tools/bench/fissure-probe.mjs shape <port>      (serve.py must already serve <port>)
// Env DRV_PORT (CDP debug port, default 9481). drv.mjs reads DRV_PORT when it is first
// evaluated, so the default is set BEFORE the driver is imported (a static import is hoisted).
const [, , mode, port] = process.argv;
process.env.DRV_PORT = process.env.DRV_PORT || '9481';
const { start, stop, connect } = await import('./drv.mjs');
await start(`http://localhost:${port}/?bench&playtest`);
const c = await connect();
await c.until(`!document.getElementById('load')`, 240000, 1000);
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
} else fail.push(`unknown mode ${mode}`);
c.close();
stop();
if (fail.length) { console.error('FAIL', fail); process.exit(1); } else console.log('PASS');
