// Freeze-step PLAY harness (2026-10-09): a human-in-the-loop way for the orchestrator to play
// the game through REAL key events with perfect reaction time. Each `act` holds keys for a fixed
// slice of GAME time (the live loop is held, __bench.step advances it), renders one game-camera
// frame, and prints the state a player could read off the screen plus the ledger numbers.
//   node tools/bench/play.mjs start <port>          (serve.py must already serve <port>)
//   node tools/bench/play.mjs act "<keys>" <sec> [yawDeg] [tag]   keys: W,A,S,D,Space,Shift,C,E,Q,T (comma list or -)
//   node tools/bench/play.mjs alt <digit>           playtest jump (Alt+digit)
//   node tools/bench/play.mjs state | shot <tag> | stop
// Env DRV_PORT (default 9461). Frames -> /Users/michaelpaulus/sc/.abyssa-wt/shots/play/
import { start, stop, connect, sleep } from './drv.mjs';
import { mkdirSync } from 'node:fs';
const OUT = '/Users/michaelpaulus/sc/.abyssa-wt/shots/play';
mkdirSync(OUT, { recursive: true });
const [, , cmd, a1, a2, a3, a4] = process.argv;
if (!process.env.DRV_PORT) process.env.DRV_PORT = '9461';

const STATE = `(() => {
  const P = window.player, SV = window.survival, L = window.lev, m = window.__msg();
  const r = v => +v.toFixed(1);
  const out = { t: r(performance.now() / 1000), zone: window.zone, pos: [r(P.pos.x), r(P.pos.y), r(P.pos.z)], yawDeg: r(P.yaw * 57.3),
    grounded: !!P.grounded, air: +SV.oxygen.toFixed(2), reserve: +(SV.reserve ?? 0).toFixed(2), fuel: +SV.fuel.toFixed(2),
    torn: +(SV.torn || 0).toFixed(1), msg: m.live, queue: m.queue };
  if (L) {
    const lp = L.pos || null;
    out.lev = { kind: L.kind, dormant: !!L.dormant, stand: +(L.stand||0).toFixed(2), threat: +(L.threat||0).toFixed(2), calmed: !!L.calmed, blind: !!L.blind };
    if (lp) { const dx = lp.x - P.pos.x, dz = lp.z - P.pos.z; out.lev.dist = r(Math.hypot(dx, dz)); out.lev.bearingDeg = r(Math.atan2(dx, dz) * 57.3); out.lev.y = r(lp.y); }
    if (L.sigils) out.wards = L.sigils.map((g, i) => {
      const w = g.grp.getWorldPosition(new (P.pos.constructor)());
      const dx = w.x - P.pos.x, dz = w.z - P.pos.z;
      return { i, lit: !!g.lit, d: r(Math.hypot(dx, w.y - P.pos.y, dz)), dh: r(Math.hypot(dx, dz)), up: r(w.y - P.pos.y), brg: r(Math.atan2(dx, dz) * 57.3) };
    });
    const B = L.brood || window.__brood;
    if (B && B.out) { out.clumpOut = B.out(); try { out.clutchReach = +B.reach(P.pos).toFixed(1); out.canReturn = !!B.canReturn(P.pos); } catch (e) {} }
    out.stagger = +(P.stagger || 0).toFixed(2);
    try { out.prompt = L.rite ? L.rite.prompt(P.pos) : null; } catch (e) {}
    const H = L.hoard; if (H && H.lampPos) { const dx = H.lampPos.x - P.pos.x, dz = H.lampPos.z - P.pos.z; out.lamp = { d: r(Math.hypot(dx, dz)), brg: r(Math.atan2(dx, dz) * 57.3), taken: !!H.lampTaken }; }
    out.grabbed = !!(L.grab || L.grabbed);
  }
  return out;
})()`;


// ---- VIDEO: the game canvas + the message line composited into a 2D canvas, recorded with
// MediaRecorder from a captureStream(0) we push by hand: one video frame per 2 game frames
// (30 fps), paced to wall time so playback runs at game speed; paused between moves.
const REC_INSTALL = `(() => {
  if (window.__rec) return 1;
  const W = 960, H = 540, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d'), st = cv.captureStream(0), tr = st.getVideoTracks()[0];
  const R = window.__rec = { cv, g, tr, chunks: [], mr: null, n: 0, last: 0 };
  R.start = () => { R.chunks = []; R.mr = new MediaRecorder(st, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 5e6 }); R.mr.ondataavailable = e => { if (e.data.size) R.chunks.push(e.data); }; R.mr.start(1000); R.mr.pause(); return 1; };
  R.frame = () => {
    const src = document.querySelector('canvas'); g.drawImage(src, 0, 0, W, H);
    const m = window.__msg ? window.__msg().live : '';
    const P = window.player, SV = window.survival, L = window.lev;
    g.font = '15px Georgia, serif'; g.textAlign = 'center'; g.fillStyle = 'rgba(0,0,0,0.45)';
    if (m) { g.fillRect(W/2 - g.measureText(m).width/2 - 10, 24, g.measureText(m).width + 20, 26); g.fillStyle = '#e6dcc6'; g.fillText(m, W/2, 43); }
    let pr = null; try { pr = L && L.rite ? L.rite.prompt(P.pos) : null; } catch (e) {}
    if (pr) { g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(W/2 - 150, H - 70, 300, 24); g.fillStyle = '#e6dcc6'; g.fillText(pr, W/2, H - 53); }
    g.textAlign = 'left'; g.font = '12px ui-monospace, Menlo, monospace'; g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(10, H - 62, 250, 52);
    g.fillStyle = '#cfe6df';
    const wards = L && L.sigils ? L.sigils.map(w => w.lit ? '●' : '○').join(' ') : '';
    g.fillText('AIR ' + (SV.oxygen*100|0) + '%  RESERVE ' + ((SV.reserve||0)*100|0) + '%  DRESS ' + (SV.torn > 0 ? 'TORN' : 'OK'), 18, H - 44);
    g.fillText('WARDS ' + wards + (window.__recCap ? '   ' + window.__recCap : ''), 18, H - 24);
    tr.requestFrame(); R.n++;
  };
  R.stop = () => new Promise(res => { R.mr.onstop = async () => { const b = new Blob(R.chunks, { type: 'video/webm' }); const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); }; R.mr.resume(); R.mr.stop(); });
  return 1;
})()`;
async function recStep(c, frames) {
  // 2 game frames per video frame, rendered, composited, pushed; wall-paced to 33 ms
  await c.ev(`(async () => { const R = window.__rec; R.mr.resume(); const n = ${frames};
    for (let i = 0; i < n; i += 2) { const t0 = performance.now(); window.__bench.step(Math.min(2, n - i), null, { render: true }); R.frame();
      const w = 33.3 - (performance.now() - t0); if (w > 0) await new Promise(r => setTimeout(r, w)); }
    R.mr.pause(); return R.n; })()`);
}

async function render(c) {
  await c.ev(`(['title','pause'].forEach(id => { const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; }), 1)`);
  // one rendered frame of the real pipeline so the screenshot is current
  await c.ev(`(window.__bench.step(1, null, { render: true }), 1)`);
}

if (cmd === 'start') {
  await start(`http://localhost:${a1}/?playtest&bench`);
  const c = await connect();
  await c.until(`!document.getElementById('load')`, 240000, 1000);
  await c.ev(`(window.__helm = true, window.setState('play'), 1)`);
  await sleep(4000);
  console.log(JSON.stringify(await c.ev(STATE)));
  process.exit(0);
}
if (cmd === 'stop') { stop(); process.exit(0); }
const c = await connect();
if (cmd === 'alt') {
  await c.ev(`(window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit${a1}', key: '${a1}', altKey: true, bubbles: true })), window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Digit${a1}', key: '${a1}', altKey: true, bubbles: true })), 1)`);
  await c.ev(`(window.__helm = true, window.__bench.step(90), 1)`);
  await render(c);
  await c.png(`${OUT}/alt${a1}.png`);
  console.log(JSON.stringify(await c.ev(STATE)));
  await c.ev(`(window.__helm = false, 1)`);
  process.exit(0);
}
if (cmd === 'look') { await c.ev(`(window.player.yaw = ${+a1} / 57.2958, window.player.pitch = ${+a2} / 57.2958, window.__helm = true, window.__bench.step(20), 1)`); await render(c); await c.png(`${OUT}/${a3 || 'look'}.png`); console.log(JSON.stringify(await c.ev(STATE))); await c.ev(`(window.__helm = false, 1)`); process.exit(0); }
if (cmd === 'reload') { await c.ev(`(location.reload(), 1)`).catch(() => {}); await sleep(3000); const c2 = await connect(); await c2.until(`!document.getElementById('load')`, 240000, 1000); await c2.ev(`(window.__helm = true, window.setState('play'), 1)`); await sleep(3000); await c2.ev(`(window.__helm = false, 1)`); console.log('reloaded'); process.exit(0); }
if (cmd === 'rec') {
  if (a1 === 'start') { await c.ev(REC_INSTALL); await c.ev(`(window.__rec.start(), 1)`); console.log('recording'); process.exit(0); }
  if (a1 === 'stop') { const url = await c.ev(`window.__rec.stop()`); const { writeFileSync } = await import('node:fs'); writeFileSync(a2, Buffer.from(url.split(',')[1], 'base64')); console.log('saved', a2); process.exit(0); }
  if (a1 === 'cap') { await c.ev(`(window.__recCap = ${JSON.stringify(a2 || '')}, 1)`); process.exit(0); }
}
if (cmd === 'state') { console.log(JSON.stringify(await c.ev(STATE), null, 1)); process.exit(0); }
if (cmd === 'shot') { await c.ev(`(window.__helm = true, 1)`); await render(c); await c.ev(`(window.__helm = false, 1)`); await c.png(`${OUT}/${a1 || 'shot'}.png`); process.exit(0); }
if (cmd === 'act') {
  const MAP = { W: 'KeyW', A: 'KeyA', S: 'KeyS', D: 'KeyD', Space: 'Space', Shift: 'ShiftLeft', C: 'KeyC', E: 'KeyE', Q: 'KeyQ', T: 'KeyT', F: 'KeyF' };
  let keys = (a1 && a1 !== '-') ? a1.split(',').map(k => MAP[k] || k) : [];
  const knife = keys.includes('Knife'); keys = keys.filter(k => k !== 'Knife');
  const frames = Math.max(1, Math.round(+a2 * 60));
  if (a3 != null && a3 !== '-') await c.ev(`(window.player.yaw = ${+a3} / 57.2958, 1)`);
  await c.ev(`(window.__helm = true, window.__bench.step(1), 1)`);
  for (const k of keys) await c.key(k, true);
  if (knife) await c.ev(`(window.__slash(), 1)`);
  if (await c.ev(`!!(window.__rec && window.__rec.mr)`)) await recStep(c, frames); else await c.ev(`(window.__bench.step(${frames}), 1)`);
  for (const k of keys) await c.key(k, false);
  await c.ev(`(window.__bench.step(1), 1)`);
  await render(c);
  const tag = a4 || ('a' + Date.now() % 100000);
  await c.png(`${OUT}/${tag}.png`);
  console.log(JSON.stringify(await c.ev(STATE)));
  await c.ev(`(window.__helm = false, 1)`);
  process.exit(0);
}
console.log('unknown command'); process.exit(1);
