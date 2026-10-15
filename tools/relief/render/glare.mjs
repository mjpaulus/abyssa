// L3b: THE WARD GLARE (Task 13): the light-up flash with the lens pressed under her, the blown share of the frame PER FRAME, the same method and the same
// lens position relative to her ward on main and on the relief branch. A CAPTURE / PROBE TOOL, NOT A GATE (always exits 0; the verdict is the report's).
//   DRV_PORT=9520 node tools/relief/render/glare.mjs <port> <tag> [outdir]       branch: serve.py 8870 / 9520;  main: 8871 / 9521
// Env GL_REPS (repeats per scene, default 3), GL_FRAMES (rendered frames booked per flash, default 90 = 1.5 s).
// The setup is tools/bench/velfix-look.mjs's (velhard's check): she is woken and HELD (cmd 'hold': she stands and stops tracking him), ONE ward is lit without a
// flash. Task 9's 0.57-0.59 on main were the follow lens PRESSED on Sal under her belly (CRECAM's 2.2 u floor; lens 1-2 u from his bonnet, 1-4 u from the ward), a fight's
// camera. A stood Sal does not press it (the boom stays ~9 u: measured 8-15 u from the ward, flash peak 0.03), so the lens is PINNED (window.__camPin): at distance D
// from the ward along the bearing from her centre out through it, 1.6 u over this build's ground, looking at the ward, Sal 1.1 u in front of it facing the ward (his bonnet
// in the frame as in the fight). The same offsets on both builds. Then flashT = 0 (the light-up) and the drawn frame is read back after EVERY rendered frame inside that
// frame's own step (the drawing buffer is not preserved): blown = the share of the frame's pixels (every 2nd) whose Rec.709 luma is over 230, velfix-look's own measure.
// velfix-look reads ONE frame 5 frames after the flash; Task 9's numbers were the PEAK over a flash's life, so this books the whole flash (GL_FRAMES rendered frames). Per scene
// and repeat: the peak share and the frame it fell on, the frames over 15% (the gate's cap) and over 50% (the plan's bar), the lens-to-ward distance, the baseline before the flash.
// The scenes: D = 1.8, 2.5 and 4.0 u on each of her wards (0 her mouth, 1 her right hip, 2 the third). GL_SHOTS=<dir>: a PNG of each scene's first repeat, 0.3 s into the flash.
const [, , PORT, TAG = 'glare', OUTD = '/Users/michaelpaulus/sc/.abyssa-wt/shots/relief-look'] = process.argv;
if (!process.env.DRV_PORT) { console.error('glare.mjs: set DRV_PORT (9520 branch, 9521 main)'); process.exit(2); }
const REPS = +(process.env.GL_REPS || 3), NF = +(process.env.GL_FRAMES || 90);
const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs'); const { tmpdir } = await import('node:os');
process.env.DRV_DIR = mkdtempSync(tmpdir() + '/abyssa-relief-glare-');
const { start, stop, connect, sleep } = await import('../../bench/drv.mjs');
mkdirSync(OUTD, { recursive: true });
await start(`http://localhost:${PORT}/?playtest&bench`);
process.on('exit', () => stop());
const c = await connect();
await c.until(`!document.getElementById('load') && typeof window.setState === 'function' && window.__bench`, 240000, 1000);
await c.ev(`(window.__helm = true, window.setState('play'), window.__bench.size(1512, 982), window.__drs.pin(1), window.weather.set(1, 0), 1)`);
await sleep(3000);
await c.ev(`(window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit6', key: 'x', altKey: true, bubbles: true })), window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Digit6', key: 'x', altKey: true, bubbles: true })), window.__bench.step(90), 1)`);
await sleep(1500);
await c.ev(`(window.requestAnimationFrame = cb => { window.__rafCb = cb; return 0; }, 1)`);   // the live loop stops: time moves only through __bench.step
await c.ev(`(['title','pause','ptPanel','ptToast','ptDock'].forEach(id => { const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; }), 1)`);
await c.ev(`(async () => {
  const { renderer } = await import('/src/core.js');
  const gl = renderer.getContext(), P = window.player, L = window.lev, cam = window.camera;
  let buf = null;
  const read = () => {
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    if (!buf || buf.length !== W * H * 4) buf = new Uint8Array(W * H * 4);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let n = 0, hi = 0, s = 0;
    for (let i = 0; i < W * H * 4; i += 8) { const l = 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]; n++; s += l; if (l > 230) hi++; }
    return { blown: hi / n, mean: s / n };
  };
  const standAt = (x, z, yaw, pitch) => { P.pos.set(x, terrainH(x, z, 0) + 1.35, z); P.vel.set(0, 0, 0); P.yaw = yaw; P.pitch = pitch; };
  window.__gl = { read, standAt, P, L, cam };
  return 1;
})()`);
await c.ev(`(window.lev.cmd('wake'), 1)`);
for (let i = 0; i < 12; i++) { await c.ev(`(window.__helm = true, window.__bench.step(60, null, { render: true }), 1)`); if (await c.ev('window.lev.standE > 0.99')) break; }
await c.ev(`(window.lev.cmd('hold'), 1)`);
await c.ev(`(window.__bench.step(60, null, { render: true }), 1)`);
const info = await c.ev(`({ fp: window.__ridge.fp(), lev: { pos: window.lev.pos.toArray(), standE: window.lev.standE, wards: window.lev.sigils.map(g => g.grp.position.toArray().map(v => +v.toFixed(2))) }, size: [window.__gl.cam.aspect] })`);
const SCENES = [['d1.8-w0', 0, 1.8], ['d1.8-w1', 1, 1.8], ['d1.8-w2', 2, 1.8], ['d2.5-w0', 0, 2.5], ['d2.5-w1', 1, 2.5], ['d2.5-w2', 2, 2.5], ['d4.0-w0', 0, 4.0], ['d4.0-w1', 1, 4.0], ['d4.0-w2', 2, 4.0]];
const results = {};
for (const [name, wi, DD] of SCENES) {
  results[name] = [];
  for (let rep = 0; rep < REPS; rep++) {
    const PRE = rep === 0 && process.env.GL_SHOTS ? 18 : 0;   // frames booked before the screenshot (0.3 s into the flash)
    const book = (n, first) => `window.__bench.step(${n}, i => { const r = window.__gl.read(); window.__glS.push([+r.blown.toFixed(4), +r.mean.toFixed(1), +window.__glG.flashT.toFixed(3), +window.__gl.cam.position.distanceTo(window.__glG.grp.position).toFixed(2), +window.__gl.P.pos.distanceTo(window.__gl.cam.position).toFixed(2)]); }, { render: true })`;
    const r0 = await c.ev(`(async () => {
      const G = window.__gl, L = G.L, B = window.__bench, g = L.sigils[${wi}], wp = g.grp.position;
      L.sigils.forEach((s, q) => { if (q !== ${wi}) s.lit = false; });   // only the framed ward is lit (velfix-look lights one); an earlier scene's ward goes dark
      g.lit = true; g.rev = 1; g.flashT = 9;
      // the pin FOLLOWS the ward every frame (she sways while held: a lens placed once drifted 0.5-1.1 u off its distance between runs): the getters run in updateCamera
      const lensAt = () => { let ox = wp.x - L.pos.x, oz = wp.z - L.pos.z; const ol = Math.hypot(ox, oz) || 1; ox /= ol; oz /= ol;
        const hd = ${DD} * Math.cos(0.5236), lx = wp.x + ox * hd, lz = wp.z + oz * hd, ly = Math.max(terrainH(lx, lz, 0) + 1.0, wp.y - ${DD} * Math.sin(0.5236)), sx = lx - ox * 1.1, sz = lz - oz * 1.1;
        G.standAt(sx, sz, Math.atan2(-ox, -oz), 0.2); return [lx, ly, lz]; };
      window.__camPin = { get p() { return lensAt(); }, get t() { return [wp.x, wp.y, wp.z]; } };
      window.__helm = true; B.step(180, null, { render: true });
      let base = null; B.step(1, () => { base = G.read(); }, { render: true });
      window.__glS = []; window.__glG = g;
      g.flashT = 0;   // THE LIGHT-UP
      ${PRE ? book(PRE) : ''};
      return { base: +base.blown.toFixed(4), baseMean: +base.mean.toFixed(1) };
    })()`);
    if (PRE) await c.png(`${process.env.GL_SHOTS}/${TAG}-${name}-flash0.3s.png`);
    const r = await c.ev(`(async () => { ${book(NF - PRE)}; return { series: window.__glS, exp: window.__exposure.state().mult }; })()`);
    r.base = r0.base; r.baseMean = r0.baseMean;
    const sr = r.series, pk = sr.reduce((a, s, i) => (s[0] > a[0] ? [s[0], i] : a), [0, 0]);
    const o = { base: r.base, peak: pk[0], peakFrame: pk[1], peakFlashT: sr[pk[1]][2], over15: sr.filter(s => s[0] > 0.15).length, over50: sr.filter(s => s[0] > 0.5).length,
      lensToWardAtPeak: sr[pk[1]][3], lensToBonnetAtPeak: sr[pk[1]][4], lensToWardMin: Math.min(...sr.map(s => s[3])), exp: r.exp, series: sr.map(s => s[0]) };
    results[name].push(o);
    console.log(name, 'rep', rep, 'peak', o.peak, 'at frame', o.peakFrame, '(flashT', o.peakFlashT + ') over15', o.over15, 'over50', o.over50, 'lens-ward', o.lensToWardAtPeak, 'base', o.base);
  }
}
const sum = {};
for (const [n, rs] of Object.entries(results)) sum[n] = { peaks: rs.map(r => r.peak), maxPeak: Math.max(...rs.map(r => r.peak)), meanPeak: +(rs.reduce((a, r) => a + r.peak, 0) / rs.length).toFixed(3), maxFramesOver15: Math.max(...rs.map(r => r.over15)), maxFramesOver50: Math.max(...rs.map(r => r.over50)), lensToWard: +(rs.reduce((a, r) => a + r.lensToWardAtPeak, 0) / rs.length).toFixed(2) };
writeFileSync(`${OUTD}/${TAG}-glare.json`, JSON.stringify({ info, frames: NF, reps: REPS, sum, results }, null, 1));
console.log('SUMMARY', TAG, JSON.stringify(sum));
const errs = (await c.console()).filter(l => /error|EXC/i.test(l) && !/favicon/.test(l));
if (errs.length) console.log('CONSOLE', errs.slice(0, 5).join('\n'));
c.close();
process.exit(0);
