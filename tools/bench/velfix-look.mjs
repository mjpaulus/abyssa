// VELFIX LOOK (2026-10-12): a lit Velkath ward, framed the same way every run, for the before/after of the
// white wash (Michael's recorded play-through: under her with lit wards the frame went white-green).
//   node tools/bench/velfix-look.mjs <port> <tag> [outdir]     (serve.py must already serve <port>)
// Env DRV_PORT (default 9491). She is woken and held (cmd 'hold': she stands and stops tracking him), ward 0 is
// lit (no flash), and Sal is stood at fixed spots round it; after a 3 s settle (the auto-exposure's slow side)
// the drawn frame is read back. Per scene: the frame's mean Rec.709 luma and blown share (> 230), and THE WARD'S
// READ: its projected spot's peak luma and the share of a 40 px disc round it over 150, against the frame's mean.
// Scenes: under-a/b (Sal 2.5 / 5 u out from under the lit ward, facing it), under-in (3 u in under her, the boom
// behind him under her belly), far-20/25/30 (the LENS that far from it,
// facing it, out from under her), flash (under-a, 0.1 s after the light-up flash), calm-2/6/10 (all three lit:
// the calm; s after it, Sal re-stood under the first ward as she walks home).
// No gate: the numbers and PNGs are for eyes and the report. The gate is fullplay.mjs FP_GATE.
const [, , PORT, TAG = 'look', OUTD = '/Users/michaelpaulus/sc/.abyssa-wt/shots/velfix'] = process.argv;
process.env.DRV_PORT = process.env.DRV_PORT || '9491';
const { mkdtempSync, mkdirSync } = await import('node:fs'); const { tmpdir } = await import('node:os');
process.env.DRV_DIR = mkdtempSync(tmpdir() + '/abyssa-velfix-look-');
const { start, stop, connect, sleep } = await import('./drv.mjs');
mkdirSync(OUTD, { recursive: true });
await start(`http://localhost:${PORT}/?playtest&bench`);
process.on('exit', () => stop());
const c = await connect();
await c.until(`!document.getElementById('load') && typeof window.setState === 'function' && window.__bench`, 240000, 1000);
await c.ev(`(window.__helm = true, window.setState('play'), 1)`);
await sleep(3000);
await c.ev(`(window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit6', key: 'x', altKey: true, bubbles: true })), window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Digit6', key: 'x', altKey: true, bubbles: true })), window.__bench.step(90), 1)`);
await sleep(1500);
await c.ev(`(window.requestAnimationFrame = cb => { window.__rafCb = cb; return 0; }, 1)`);
await c.ev(`(['title','pause','ptPanel','ptToast','ptDock'].forEach(id => { const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; }), 1)`);
const WI = +(process.env.VL_WARD || 1);   // the ward framed (1: her right hip; 0: the mouth, between the claws)
await c.ev(`(async () => {
  const { renderer } = await import('/src/core.js');
  const gl = renderer.getContext(), P = window.player, L = window.lev, cam = window.camera, V = P.pos.constructor;
  let buf = null; const w = new V();
  const read = (g) => {
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    if (!buf || buf.length !== W * H * 4) buf = new Uint8Array(W * H * 4);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const lum = i => 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
    let n = 0, hi = 0, s = 0;
    for (let i = 0; i < W * H * 4; i += 8) { const l = lum(i); n++; s += l; if (l > 230) hi++; }
    const o = { mean: +(s / n).toFixed(1), blown: +(hi / n).toFixed(3) };
    if (g) {
      cam.updateMatrixWorld(); w.copy(g.grp.position).project(cam);
      o.wardD = +g.grp.position.distanceTo(cam.position).toFixed(1);
      if (w.z < 1 && Math.abs(w.x) < 1 && Math.abs(w.y) < 1) {
        const px = Math.round((w.x * 0.5 + 0.5) * W), py = Math.round((w.y * 0.5 + 0.5) * H), R = 40;
        let pk = 0, m = 0, k = 0, over = 0;
        for (let y = Math.max(0, py - R); y < Math.min(H, py + R); y++) for (let x = Math.max(0, px - R); x < Math.min(W, px + R); x++) {
          if ((x - px) * (x - px) + (y - py) * (y - py) > R * R) continue;
          const l = lum((y * W + x) * 4); k++; m += l; if (l > pk) pk = l; if (l > 150) over++;
        }
        o.ward = { px, py: H - py, peak: Math.round(pk), mean: +(m / k).toFixed(1), over150: +(over / k).toFixed(3), contrast: +((m / k) / (s / n)).toFixed(2) };
      } else o.ward = 'off-screen';
    }
    o.exp = window.__exposure.state().mult;
    return o;
  };
  const standAt = (x, z, yaw, pitch) => { P.pos.set(x, terrainH(x, z, 0) + 1.35, z); P.vel.set(0, 0, 0); P.yaw = yaw; P.pitch = pitch; };
  window.__vl = { read, standAt, L, P };
  return 1;
})()`);
// wake her, let her stand, hold her still
await c.ev(`(window.lev.cmd('wake'), 1)`);
for (let i = 0; i < 12; i++) { await c.ev(`(window.__helm = true, window.__bench.step(60, null, { render: true }), 1)`); if (await c.ev('window.lev.standE > 0.99')) break; }
await c.ev(`(window.lev.cmd('hold'), 1)`);
await c.ev(`(window.__bench.step(60, null, { render: true }), 1)`);
const lightWard = async (i, flash) => c.ev(`(() => { const g = window.lev.sigils[${i}]; g.lit = true; g.rev = 1; g.flashT = ${flash ? 0 : 9}; return 1; })()`);
await lightWard(WI, false);
// VL_PRE=<js>: evaluated before the scenes (live knobs, e.g. "__burn.scatter = 0.1")
if (process.env.VL_PRE) await c.ev(`(() => { ${process.env.VL_PRE}; return 1; })()`);
const results = {};
const settle = async (n = 180) => c.ev(`(window.__helm = true, window.__bench.step(${n}, null, { render: true }), 1)`);
const shot = async name => { await c.png(`${OUTD}/${TAG}-${name}.png`); };
// a spot `off` u from the ward's ground point, along the bearing from her centre out through the ward,
// facing it (yaw, and the pitch up to it)
const place = (i, off) => c.ev(`(() => { const L = window.lev, g = L.sigils[${i}].grp.position, P = window.player;
  let ox = g.x - L.pos.x, oz = g.z - L.pos.z; const ol = Math.hypot(ox, oz) || 1; ox /= ol; oz /= ol;
  const x = g.x + ox * ${off}, z = g.z + oz * ${off}, fy = terrainH(x, z, 0) + 1.35;
  const dx = g.x - x, dz = g.z - z, dh = Math.hypot(dx, dz);
  window.__vl.standAt(x, z, Math.atan2(dx, dz), Math.max(-0.3, Math.min(1.1, Math.atan2(g.y - fy, Math.max(dh, 0.5)))));
  return [x, z]; })()`);
// the read happens INSIDE the frame's own step, right after its render (the drawing buffer is not preserved)
const readNow = i => c.ev(`(window.__bench.step(1, () => { window.__vlR = window.__vl.read(window.lev.sigils[${i}]); }, { render: true }), window.__vlR)`);
const scene = async (name, i, off, n = 180) => {
  await place(i, off);
  await settle(n);
  results[name] = await readNow(i);
  await shot(name);
};
await scene('under-a', WI, 2.5);
await scene('under-b', WI, 5);
await scene('under-in', WI, -3);
// the far read: the LENS 20 / 25 / 30 u from the ward (the boom hangs ~9 u behind him)
for (const d of [20, 25, 30]) await scene('far-' + d, WI, Math.max(3, d - 9));
// the flash: re-stood under it, the light-up flash 0.1 s in
await place(WI, 2.5); await settle(180);
await c.ev(`(window.lev.sigils[${WI}].flashT = 0, 1)`); await settle(5);
results['flash'] = await readNow(WI); await shot('flash');
// the calm: the other two lit; she walks home; Sal re-stood under the first ward each time
for (let i = 0; i < 3; i++) if (i !== WI) await lightWard(i, false);
await c.ev(`(window.lev.cmd('hold'), window.__bench.step(2, null, { render: true }), 1)`);   // (release the hold: she walks home)
let tCalm = 0;
for (const at of [2, 6, 10]) {
  const n = Math.round((at - tCalm) * 60) - 90; if (n > 0) await settle(n);
  await place(WI, 2.5); await settle(90); tCalm = at;
  results['calm-' + at] = await readNow(WI);
  results['calm-' + at].calmT = await c.ev('+window.lev.calmT.toFixed(1)');
  await shot('calm-' + at);
}
console.log('LOOK', TAG, JSON.stringify(results));
const errs = (await c.console()).filter(l => /error|EXC/i.test(l) && !/favicon/.test(l));
if (errs.length) console.log('CONSOLE', errs.slice(0, 5).join('\n'));
c.close();
process.exit(0);
