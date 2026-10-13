// CLAW STRIPS (clawfix 2026-10-13): one hammer blow of Velkath's crusher every 0.05 s (3 frames), from the
// game camera (the follow lens behind Sal) and from a level side lens, BEFORE (the shipped rod and finger:
// __claw WHIP.on = CHELA.on = 0, the same page) and AFTER. Velkath is woken and HELD (__lev.cmd('hold'): no
// hunt, turn or lunge; the hammer keeps its clock: 2.6 s = 156 frames, the landing on frame 141).
//   DRV_PORT=9512 node tools/bench/claw-strip.mjs <port> [outdir] [prefix=clawfix] [first=69] [n=40]
// -> <outdir>/<prefix>-<before|after>-<game|side>-NN-fFFF.png and <prefix>-strips.json (per-sample state)
import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
if (!process.env.DRV_PORT) process.env.DRV_PORT = '9512';
if (!process.env.DRV_DIR) process.env.DRV_DIR = tmpdir() + '/abyssa-cs-' + process.env.DRV_PORT + '-' + Date.now();
const { start, stop, connect, sleep } = await import('./drv.mjs');
const [, , PORT = '8860', OUTD = '/Users/michaelpaulus/sc/.abyssa-wt/shots/clawfix-strips', PREFIX = 'clawfix', FIRST = '69', N = '40'] = process.argv;
mkdirSync(OUTD, { recursive: true });
await start(`http://localhost:${PORT}/?bench&playtest&lab`);
const c = await connect();
await c.until(`!document.getElementById('load') && typeof window.setState === 'function' && window.__bench`, 240000, 1000);
await c.ev(`(window.__helm = true, window.setState('play'), 1)`);
await sleep(2500);
await c.ev(`(async () => { await window.__bench.setup('z0b'); return 1; })()`);
console.log('setup', JSON.stringify(await c.ev(`(async () => {
  const L = window.__sl, B = window.__bench, P = window.player, S = window.survival;
  const V = P.pos.constructor, cm = L.claws.find(q => q.major);
  const PL = await import(new URL('src/entities/sleeper/plume.js', document.baseURI).href);
  const T = L.hammerT, F = 1 / 60;
  const W = (o, x = 0, y = 0, z = 0) => new V(x, y, z).applyMatrix4(o.matrixWorld);
  window.__lev.cmd('wake');
  B.step(60 * 9);
  const D = 34, side = 9;
  const place = () => { const fx = Math.sin(L.yaw), fz = Math.cos(L.yaw), rx = Math.cos(L.yaw), rz = -Math.sin(L.yaw);
    const x = L.pos.x + fx * D - rx * side, z = L.pos.z + fz * D - rz * side; B.place(x, z, Math.atan2(L.pos.x - x, L.pos.z - z), 0); };
  place();
  B.step(60 * 10, i => { if (i % 30 === 0) place(); if (i > 200 && L.threatE > 0.99 && L.hamPh > 0.02 && L.hamPh < 0.05) return false; });
  window.__lev.cmd('hold');
  place();
  const keep = () => { S.fuel = 1; S.oxygen = 1; if (S.reserve != null) S.reserve = S.reserveCap || S.reserve; L.strikeCd = 99; };
  const cs = window.__cs = { view: 'game', side: null,
    fr: () => (L.swingT % T) / F,
    keep,
    pin() { if (cs.view === 'game') { window.__camPin = null; return; } const p = cs.side.p, t = cs.side.t; window.__camPin = { p, t, pos: p, look: t }; },
    adv(nf, dtot) { B.step(nf, () => { keep(); cs.pin(); }, { render: true, dt: dtot / nf }); },
    to(f) { B.step(800, () => { keep(); const d = ((f - cs.fr()) % 156 + 156) % 156; return !(d < 0.5 || d > 155.5); }); },
    on(v) { window.__claw.WHIP.on = v; window.__claw.CHELA.on = v; },
    clean(on) { window.__plume.tune.off = !!on; return B.hide(/plantKit|world\\/creatures|world\\/fauna/, !!on); },
    clear() { PL.clearPlumes(); },
    state() { const h = W(cm.dj), ax = o => new V(1, 0, 0).transformDirection(o.matrixWorld);
      return { f: +cs.fr().toFixed(1), t: +(L.swingT % T).toFixed(3), ph: +L.hamPh.toFixed(3), swing: +L.swing.toFixed(3), dj: +(cm.dj.rotation.z * 57.3).toFixed(1),
        mp: +(ax(cm.root).angleTo(ax(cm.pj)) * 57.3).toFixed(1), hinge: h.toArray().map(v => +v.toFixed(2)), hits: L.hits || 0, sal: P.pos.toArray().map(v => +v.toFixed(2)) }; },
    async shot(scale) { cs.pin(); const t0 = L.swingT; const cap = await B.capture({ frames: 8 }); return { png: B.png(cap, scale), drift: L.swingT - t0, st: cs.state() }; }
  };
  // THE SIDE LENS: level, outside the arm's swing plane (the shoulder, the hand cocked and landed), 50 u out
  B.hold(true);
  cs.on(1); cs.to(125); const sh = W(cm.root), ck = W(cm.dj); cs.to(141); const im = W(cm.dj);
  const a = new V().subVectors(ck, sh), b = new V().subVectors(im, sh), n = new V().crossVectors(a, b); n.y = 0; n.normalize();
  const ctr = L.body.getWorldPosition(new V()), mid = sh.clone().add(ck).add(im).multiplyScalar(1 / 3);
  if (n.dot(new V().subVectors(mid, ctr)) < 0) n.negate();
  const eye = mid.clone().addScaledVector(n, 50); eye.y = Math.max(eye.y, mid.y - 2);
  cs.side = { p: eye.toArray(), t: mid.toArray() };
  return { hold: L.hold, threatE: L.threatE, sal: P.pos.toArray(), fromCentre: +Math.hypot(P.pos.x - L.pos.x, P.pos.z - L.pos.z).toFixed(1), side: cs.side };
})()`)));
const save = (name, r) => writeFileSync(`${OUTD}/${name}.png`, Buffer.from(r.png.split(',')[1], 'base64'));
const log = [];
for (const ver of ['before', 'after']) {
  for (const view of ['game', 'side']) {
    await c.ev(`(__cs.on(${ver === 'after' ? 1 : 0}), __cs.view = '${view}', __cs.clean(${view === 'side'}), 1)`);
    // a whole blow first (the springs and the finger in their cycle), then settle the post chain on this lens,
    // ending on the first sample's frame
    const settle = 90, f0 = ((+FIRST - settle) % 156 + 156) % 156;
    await c.ev(`(__cs.to(${f0}), __cs.adv(156, 156 / 60), __cs.clear(), __cs.adv(${settle}, ${settle} / 60), 1)`);
    let drift = 0;
    for (let k = 0; k < +N; k++) {
      if (k > 0) await c.ev(`(__cs.adv(3, ${(0.05 - drift).toFixed(6)}), 1)`);
      const r = await c.ev(`__cs.shot(0.5)`);
      drift = r.drift;
      const name = `${PREFIX}-${ver}-${view}-${String(k).padStart(2, '0')}-f${String(Math.round(r.st.f)).padStart(3, '0')}`;
      save(name, r);
      log.push({ ver, view, k, name, ...r.st });
    }
    console.log(ver, view, 'done', JSON.stringify(log[log.length - 1]));
  }
}
await c.ev(`(__cs.on(1), __cs.clean(false), window.__camPin = null, __bench.hold(false), 1)`);
writeFileSync(`${OUTD}/${PREFIX}-strips.json`, JSON.stringify(log, null, 1));
c.close();
stop();
process.exit(0);
