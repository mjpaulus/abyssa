// Real-input swim probe over CDP. usage: node drive.mjs <dbgPort> <scenario> <out.json>
import { writeFileSync, mkdirSync } from 'node:fs';
const SHOTS = process.env.SHOTS, SHOT_MS = +(process.env.SHOT_MS || 400);
const [, , DBG, SCEN, OUT] = process.argv;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const list = await (await fetch(`http://127.0.0.1:${DBG}/json/list`)).json();
const pg = list.find(t => t.type === 'page');
const ws = new WebSocket(pg.webSocketDebuggerUrl);
let id = 0; const wait = new Map();
ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
await new Promise(r => ws.onopen = r);
const send = (method, params = {}) => new Promise(res => { const i = ++id; wait.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: `(async () => (${expr}))()`, awaitPromise: true, returnByValue: true, timeout: 120000 });
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails));
  return r.result.result.value;
}
const KC = { KeyW: [87, 'w'], KeyS: [83, 's'], KeyC: [67, 'c'], Space: [32, ' '], Digit3: [51, '3'] };
async function key(type, code, mods = 0) {
  const [vk, k] = KC[code];
  await send('Input.dispatchKeyEvent', { type, code, key: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: mods, ...(type === 'keyDown' && !mods ? { text: k } : {}) });
}
const down = c => key('keyDown', c), up = c => key('keyUp', c);
async function mark(s) { await ev(`(window.__rec.seg = ${JSON.stringify(s)}, 0)`); }
async function hold(code, ms, seg) {
  await mark(seg); await down(code);
  const t0 = Date.now();
  if (SHOTS && (seg === 'W' || seg === 'S')) { await ev(`(window.__rec.shotOn = true, 0)`); await sleep(ms); await ev(`(window.__rec.shotOn = false, 0)`); }
  else await sleep(ms);
  await up(code);
}

// recorder
if (process.env.CROP) { }
await ev(`(async () => {
  const D = await import('/src/entities/diver.js'), P = await import('/src/player.js');
  const V = D.diver.armL.end.position.constructor, a = new V(), b = new V();
  const R = window.__rec = { seg: 'idle', log: [], on: true, shots: [], shotOn: false, shotLast: 0, shotEvery: +(${SHOT_MS}), crop: ${process.env.CROP || '[0, 0, 1, 1]'}, sc: ${process.env.SC || 0.25}, side: ${+(process.env.SIDE || 0)} };
  const cv2 = document.createElement('canvas'), cx2 = cv2.getContext('2d');
  let lt = performance.now();
  const sv = new V();
  // both hands through the game camera, in canvas CSS pixels (what the player sees move)
  const scr = () => { const cam = window.camera, cv = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0], w = cv.clientWidth, h = cv.clientHeight, o = [];
    for (const arm of [D.diver.armL, D.diver.armR]) { arm.end.getWorldPosition(sv); sv.project(cam); o.push(+((sv.x * 0.5 + 0.5) * w).toFixed(1), +((-sv.y * 0.5 + 0.5) * h).toFixed(1)); }
    D.diver.getWorldPosition(sv); sv.project(cam); o.push(+((sv.x * 0.5 + 0.5) * w).toFixed(1), +((-sv.y * 0.5 + 0.5) * h).toFixed(1));
    return o; };
  const f = () => {
    const now = performance.now(), p = P.player;
    if (R.on && window.gameState === 'play') {
      D.diver.updateMatrixWorld(true);
      D.diver.armL.end.getWorldPosition(a); D.diver.worldToLocal(a);
      D.diver.armR.end.getWorldPosition(b); D.diver.worldToLocal(b);
      const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
      R.log.push([R.seg, +(now - lt).toFixed(1), p.grounded ? 1 : 0, p.onDeck ? 1 : 0, +p.buoy.toFixed(2), +p.fill.toFixed(3),
        +(p.jet || 0).toFixed(2), +(p.burstT || 0).toFixed(2), +p.swimP.toFixed(4), +Math.hypot(p.vel.x, p.vel.z).toFixed(2),
        +(p.vel.x * sy + p.vel.z * cy).toFixed(2), +p.vel.y.toFixed(2), p.scullZ || 0,
        +a.x.toFixed(3), +a.y.toFixed(3), +a.z.toFixed(3), +b.x.toFixed(3), +b.y.toFixed(3), +b.z.toFixed(3),
        (document.getElementById('mode') || {}).textContent || '', +(p.pos.y - p.groundY).toFixed(2), window.__burstLeanState ? window.__burstLeanState().pitchDeg : 0, +D.diver.armL.root.rotation.x.toFixed(3), +D.diver.armL.mid.rotation.x.toFixed(3), +D.diver.armR.root.rotation.x.toFixed(3), +D.diver.armL.root.rotation.z.toFixed(3), ...(window.__swimState ? (() => { const q = window.__swimState(); return [q.gb, q.burstW, q.ladderF, q.drive, q.rate]; })() : [-1, -1, -1, -1, -1]), ...scr()]);
    }
    if (R.side) {   // a side lens that rides with him (SIDE=1): checks the stroke's shape, not the game view
      const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw), q = p.pos;
      window.__camPin = { pos: [q.x + cy * R.side, q.y + 0.2, q.z - sy * R.side], look: [q.x, q.y - 0.9, q.z] };
    }
    if (R.shotOn && now - R.shotLast >= R.shotEvery) {
      R.shotLast = now;
      const c = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0], [x0, y0, x1, y1] = R.crop;
      const sx = x0 * c.width, sy2 = y0 * c.height, sw = (x1 - x0) * c.width, sh = (y1 - y0) * c.height;
      cv2.width = Math.round(sw * R.sc); cv2.height = Math.round(sh * R.sc);
      cx2.drawImage(c, sx, sy2, sw, sh, 0, 0, cv2.width, cv2.height);
      R.shots.push([R.seg, +(P.player.swimP).toFixed(3), +Math.hypot(P.player.vel.x, P.player.vel.z).toFixed(1), P.player.grounded ? 1 : 0, cv2.toDataURL('image/jpeg', 0.85)]);
    }
    lt = now; requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
  return 1;
})()`);

async function neutral(ms = 1500) {   // hold the dress at neutral fill while he hangs
  await ev(`(async () => { const P = await import('/src/player.js'); const p = P.player;
    const t0 = performance.now(); while (performance.now() - t0 < ${ms}) { p.trim = Math.max(p.trim, 0.05) * P.NEUTRAL_FILL / Math.max(p.fill, 1e-3); await new Promise(r => requestAnimationFrame(r)); } return p.fill; })()`);
}
async function lift(dy) {
  await ev(`(async () => { const P = await import('/src/player.js'); const p = P.player; p.pos.y += ${dy}; p.vel.set(0,0,0); p.grounded = false; return p.pos.y; })()`);
}
async function ws6() { await hold('KeyW', 6000, 'W'); await mark('coastW'); await sleep(1500); await hold('KeyS', 6000, 'S'); await mark('coastS'); await sleep(1500); }

// ALT3=1: enter the way Michael did, the playtest jump Alt+3 (SEABED, ZONE 0), by a real key
if (process.env.ALT3) {
  await mark('alt3');
  await key('keyDown', 'Digit3', 1); await key('keyUp', 'Digit3', 1);
  await sleep(2500);
  console.log('alt3', JSON.stringify(await ev(`(window.__helm = true, [gameState, window.__playtest && window.__playtest.last(), player.grounded, +player.pos.y.toFixed(1)])`)));
}
if (SCEN === 'cruise') { await mark('setup'); await lift(90); await neutral(2500); await hold('KeyW', 22000, 'W'); await mark('coastW'); await neutral(8000); await hold('KeyS', 16000, 'S'); }
else if (SCEN === 'long') { await mark('setup'); await lift(60); await neutral(2500); await mark('hang'); await neutral(2000); await hold('KeyW', 12000, 'W'); await mark('coastW'); await neutral(6000); await hold('KeyS', 12000, 'S'); await mark('coastS'); await sleep(1500); }
else if (SCEN === 'midS') { await mark('setup'); await lift(40); await neutral(2500); await mark('hang'); await neutral(3000); await hold('KeyS', 6000, 'S'); await mark('coastS'); await sleep(1500); }
else if (SCEN === 'mid') { await mark('setup'); await lift(40); await neutral(2500); await mark('hang'); await neutral(5000); await ws6(); }
else if (SCEN === 'low') { await mark('setup'); await lift(2.5); await neutral(1200); await ws6(); }
else if (SCEN === 'seabed') { await mark('setup'); await sleep(1000); await ws6(); }
else if (SCEN === 'burst') { await mark('setup'); await sleep(500); await hold('Space', 1100, 'burst'); await mark('float'); await sleep(1500); await ws6(); }
else if (SCEN === 'vent') { await mark('setup'); await sleep(500); await hold('Space', 1100, 'burst'); await mark('float'); await sleep(1200); await hold('KeyC', 1200, 'vent'); await mark('postvent'); await sleep(800); await ws6(); }
await ev(`(window.__rec.on = false, 0)`);
const log = await ev(`window.__rec.log`);
writeFileSync(OUT, JSON.stringify(log));
if (SHOTS) {
  mkdirSync(SHOTS, { recursive: true });
  const n = await ev(`window.__rec.shots.length`);
  for (let i = 0; i < n; i++) {
    const [seg, sp, v, g, url] = await ev(`window.__rec.shots[${i}]`);
    writeFileSync(`${SHOTS}/${seg}-${String(i).padStart(3, '0')}-p${sp}-v${v}${g ? '-G' : ''}.jpg`, Buffer.from(url.split(',')[1], 'base64'));
  }
  console.log('shots', n);
}
console.log('frames', log.length);
ws.close();
