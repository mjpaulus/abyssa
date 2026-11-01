// THE SAND ON HER AND THE CLOUD OFF HER, READ OFF PIXELS (sandrise, 2026-10-31; card roadmap/velkath-sand-rise.md; Michael: "we lost that she is
// partially covered in sand and when she rises the sand rolls off in a slight dust cloud", approved "yes do all three for the sand").
// burial-probe and pointcam-probe read state, never pixels: a crust that drew no sand, or a cloud nobody can see, passes them. This one
// reads what is drawn, through the whole post chain (the post bypass's frozen capture is black on the plugged clock: burial-probe's wound
// header), from FIXED framings (window.__camPin, re-set every stepped frame so it rides her body), on the PLUGGED clock.
//   DRV_PORT=<own> node tools/bench/sandpix-probe.mjs <crust|cloud> <game port>
// Exit 0 pass | 1 a bar failed | 2 UNMEASURED | 3 a RED whose bars did NOT fail | 4 LOST (clock drift) | 5 a RED whose bars failed, as they must.
// JSON -> SP_OUT (default out/probe/sandpix-<mode>-<tag>.json under the cwd).
//   crust  Home, her asleep and buried; he stands 40 u off her centre on her sand side (out of the frame; she turns to him once she stands,
//          away from the lens); the lens is pinned 24 u off her body on her FAR side, 24 u up, looking at her body + 3 u, re-pinned every frame.
//          THE COVER: the crust's probe PAINT (burial.js CRUST_PAINT, __burial.paint(on, 0.3): uShed.w, never written by the game) draws every
//          fragment of her body in a pure hue after its own light and fog: RED a face that looks up (geometric normal y > 0.5) with sand
//          cover > 0.3, BLUE a bare face that looks up, GREEN her other faces; classified by the dominant channel (> 50 codes over the other
//          two). up = red + blue pixels, sand = red, frac = sand / up. Captured asleep (A), then she is woken (lev.cmd('wake'), the pull's
//          onWake), at +1, +2, +3, +4 s after the wake, and at STOOD + 2 s (L.hasStood's first frame + 120: S). THE VISIBLE SAND: at A the
//          plain capture (the post chain, the paint off) with the crust as built against the same frozen frame with the cover taken off
//          (setCrust cover 0 / dust 0, restored): on the up pixels, the share whose luma (Rec.709, codes) moved >= 6 codes.
//          Bars (pre-registered before the first GREEN run, on the look-dev readings of ca105a0):
//            asleep   frac(A) >= 0.12 (she lies partly covered in sand)
//            seen     >= 10% of her up pixels move >= 6 codes of luma with the cover off (the sand changes what is seen)
//            holds    sand(+1) >= 0.6 x sand(A) (counts: as she rises more of her shell comes out of the dune, so frac dilutes)
//            sheds    frac(S) <= 0.6 x frac(A) and frac(S) < frac(+1) (it has run off)
//            rest     frac(S) >= 0.02 (some is left lying on her after she stands; the shed's hollows)
//          Booked: every reading, __burial.shedState(), L.bury, uShed.
//          SP_RED=off  the cover off throughout (setCrust cover 0, dust 0): asleep, seen must fail
//          SP_RED=fade the shed off (__burial.shed.on = 0: main's crust, the sand going with bury): rest must fail
//   cloud  Home, her asleep; he stands 40 u off her centre on her FAR side (she rises and turns away from the lens); the lens pinned 34 u
//          off her centre on her SAND side, 4 u over the floor there, looking at her centre at the floor + 2.5 u (the cloud rolls off her
//          toward the lens). She is woken; at +1, +2, +3, +5, +8 and +12 s after the wake TWO captures of the SAME frozen frame: the plumes
//          drawn and the plumes hidden (__plume.show(false): the mesh and the veil, restored). A CLOUD pixel moved >= 6 codes on some channel.
//          cov = cloud pixels / frame. Its look on the cloud pixels: dL = mean luma (on - off); sat = the mean (max - min) / max of the drawn
//          (on) pixel; the seabed's own sat = the same over the hidden frame's bottom quarter. LOW: the share of cloud pixels under the screen
//          row of a point 7 u over the floor at her centre (a projection of the pinned lens).
//          Bars (pre-registered as crust's):
//            seen     cov >= 0.03 at +2 and at +3 (a cloud you can see)
//            slight   cov <= 0.45 and the frame's mean luma rise <= 10 codes at every reading (it never whites the frame out)
//            low      >= 75% of the cloud pixels under the 7 u row at +3 and +5 (it hugs the bed; it does not balloon)
//            sandy    at +3: sat(cloud) >= 0.6 x sat(seabed) and dL <= 25 codes (the zone's sand in its water, not a pale puff)
//            settles  cov(+12) <= 0.7 x the largest cov booked
//          SP_RED=nocloud  no rise cloud drawn (__plume.look.on = 0 and the rise kind's render off: __burial.set({ plume: 0 })): seen fails
//          SP_RED=pale     the shipped rise cloud (__plume.look.on = 0: main's render params, the pale climbing puff): low or sandy must fail
// ENV: DRV_PORT (a port of this probe's own; never 8777 / 8790 / 9419), SP_RED, SP_OUT, SP_TAG, SP_SHOTS=<dir> (the captures as PNGs).
const P = /^\d+$/.test(process.env.DRV_PORT || '') ? +process.env.DRV_PORT : NaN;
if (!Number.isInteger(P) || P < 1024 || P > 65535 || [8777, 8790, 9419].includes(P)) { console.error('sandpix-probe: set DRV_PORT to a port of its own'); process.exit(2); }
const MODES = ['crust', 'cloud'];
const [, , MODE, PORT] = process.argv;
if (!MODES.includes(MODE) || !/^\d+$/.test(PORT || '')) { console.error('usage: DRV_PORT=<own> node tools/bench/sandpix-probe.mjs <crust|cloud> <game port>'); process.exit(2); }
const REDS = { crust: { off: ['asleep', 'seen'], fade: ['rest'] }, cloud: { nocloud: ['seen'], pale: ['low', 'sandy'] } };
const RED = process.env.SP_RED || '';
if (RED && !REDS[MODE][RED]) { console.error(`SP_RED: ${MODE} has ${Object.keys(REDS[MODE]).join(', ')}`); process.exit(2); }
const { mkdtempSync, rmSync, writeFileSync, mkdirSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const { join, dirname, resolve } = await import('node:path');
process.env.DRV_DIR = mkdtempSync(join(tmpdir(), 'abyssa-sandpix-'));
const { start, stop, connect, sleep } = await import('./drv.mjs');
const { plug, drift, unmeasured, lost } = await import('./clockplug.mjs');
let chromeStarted = false;
process.on('exit', () => { if (chromeStarted) stop(); try { rmSync(process.env.DRV_DIR, { recursive: true, force: true }); } catch (e) { } });
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(130));
const TAG = process.env.SP_TAG || 'port' + PORT;
const OUT = resolve(process.env.SP_OUT || `out/probe/sandpix-${MODE}${RED ? '-' + RED : ''}-${TAG}.json`);
const SHOTS = process.env.SP_SHOTS ? resolve(process.env.SP_SHOTS) : '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

await start('about:blank'); chromeStarted = true;
const c = await connect();
await c.send('Runtime.enable'); await c.send('Page.enable');
await c.send('Emulation.setFocusEmulationEnabled', { enabled: true });
await c.send('Page.navigate', { url: `http://localhost:${PORT}/?bench&playtest` });
const t0 = Date.now();
await c.until(`!document.getElementById('load') && typeof window.setState === 'function' && !!window.__bench && !!window.__chart && !!window.lev`, 300000, 500);
console.log(`sandpix-probe ${MODE}${RED ? ' RED ' + RED : ''} http://localhost:${PORT}/ loaded in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
await c.ev(`(window.__helm = true, window.setState('play'), 1)`);
await sleep(1000);
await plug(c);
await c.ev(`(window.__helm = true, window.__chart.arrive(0), window.gotoZone(0), window.weather.set(1, 0), window.__bench.step(30), 1)`);
await c.until(`(window.__bench.step(10), !!(window.lev && window.lev.sculpted))`, 30000, 100);
const has = await c.ev(`({ buried: !!(window.lev && window.lev.buried), paint: !!(window.__burial && window.__burial.paint), shed: !!(window.__burial && window.__burial.shed), show: !!(window.__plume && window.__plume.show), look: !!(window.__plume && window.__plume.look) })`);
console.log('build: ' + JSON.stringify(has));
if (!has.buried || (MODE === 'crust' && !has.paint) || (MODE === 'cloud' && !has.show)) { console.log('UNMEASURED: the build has no ' + (MODE === 'crust' ? 'crust paint' : 'plume show') + ' (or she is not buried)'); process.exit(2); }

// the page side: the pin, the paint read, the A/B reads
await c.ev(`(async () => {
  const T = await import('/src/world/terrain.js');
  const L0 = () => window.lev;
  const B = window.__bench;
  window.__sp = {
    him(d, side) { const L = L0(), s = L.sand, l = Math.hypot(s.x, s.z), x = L.pos.x + side * s.x / l * d, z = L.pos.z + side * s.z / l * d;
      B.place(x, z, Math.atan2(L.pos.x - x, L.pos.z - z), 0); window.player.pos.y = T.shutFloorY(x, z, 0) + 1.35; window.player.vel.set(0, 0, 0); return [+x.toFixed(2), +z.toFixed(2)]; },
    pin: null,
    // crust: off her BODY (rides her); cloud: off her bed centre (fixed in the world)
    setPin(kind) { const L = L0(), s = L.sand, l = Math.hypot(s.x, s.z), ux = s.x / l, uz = s.z / l;
      if (kind === 'crust') { const b = L.body.position; window.__camPin = { p: [b.x - ux * 24, b.y + 24, b.z - uz * 24], t: [b.x, b.y + 3, b.z] }; }
      else { const cx = this.cx, cz = this.cz, px = cx + ux * 34, pz = cz + uz * 34; window.__camPin = { p: [px, T.terrainH(px, pz, 0) + 4, pz], t: [cx, T.terrainH(cx, cz, 0) + 2.5, cz] }; }
      return window.__camPin; },
    step(n, kind) { B.step(n, () => this.setPin(kind), { render: true }); },
    async cap() { const k = window.__plugClk.clock, e = k.elapsedTime; try { return await B.capture({ frames: 2 }); } finally { k.elapsedTime = e; } },
    async paintRead() { window.__burial.paint(true, 0.3); let cap; try { cap = await this.cap(); } finally { window.__burial.paint(false); }
      const px = cap.px; let r = 0, b = 0, g = 0; const M = new Uint8Array(px.length / 4);
      for (let i = 0, j = 0; i < px.length; i += 4, j++) { const R = px[i], G = px[i + 1], Bc = px[i + 2];
        if (R - Math.max(G, Bc) > 50) { r++; M[j] = 1; } else if (Bc - Math.max(R, G) > 50) { b++; M[j] = 1; } else if (G - Math.max(R, Bc) > 50) g++; }
      this.mask = M; this.lastPaint = cap;
      return { up: r + b, sand: r, frac: r + b ? +(r / (r + b)).toFixed(4) : null, other: g }; },
    // the cover off on the same frozen frame: the share of her up pixels whose luma moved >= 6 codes
    async seenRead() { const C = window.__burial.crust, keep = { cover: C.cover, dust: C.dust };
      // (the capture's frozen frames run update(): crustTick writes the CRUST knobs into uSandK on each)
      const a = await this.cap(); C.cover = 0; C.dust = 0;
      let b; try { b = await this.cap(); } finally { Object.assign(C, keep); }
      const Y = (p, i) => 0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2];
      let n = 0, m = 0, sum = 0; for (let j = 0; j < this.mask.length; j++) { if (!this.mask[j]) continue; n++; const d = Math.abs(Y(a.px, j * 4) - Y(b.px, j * 4)); sum += d; if (d >= 6) m++; }
      this.lastA = a; this.lastB = b;
      return { n, moved: m, share: n ? +(m / n).toFixed(4) : null, meanD: n ? +(sum / n).toFixed(2) : null }; },
    async cloudRead() { const a = await this.cap(); window.__plume.show(false); let b; try { b = await this.cap(); } finally { window.__plume.show(true); }
      const W = a.w, H = a.h, pa = a.px, pb = b.px, Y = (p, i) => 0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2];
      const sat = (p, i) => { const mx = Math.max(p[i], p[i + 1], p[i + 2]), mn = Math.min(p[i], p[i + 1], p[i + 2]); return mx > 0 ? (mx - mn) / mx : 0; };
      // the 7 u row: a point 7 u over the floor at her bed's centre, projected by the pinned lens (rows bottom-up, as read back)
      const core = await import('/src/core.js'), cam = core.camera; cam.updateMatrixWorld();
      const THREE = await import('three'); const v = new THREE.Vector3(this.cx, T.terrainH(this.cx, this.cz, 0) + 7, this.cz).project(cam); const row7 = Math.round((v.y + 1) / 2 * H);
      let n = 0, low = 0, dL = 0, sA = 0, frameD = 0, sb = 0, nb = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4, d = Math.max(Math.abs(pa[i] - pb[i]), Math.abs(pa[i + 1] - pb[i + 1]), Math.abs(pa[i + 2] - pb[i + 2]));
        frameD += Y(pa, i) - Y(pb, i);
        if (y < H / 4) { sb += sat(pb, i); nb++; }
        if (d >= 6) { n++; if (y < row7) low++; dL += Y(pa, i) - Y(pb, i); sA += sat(pa, i); } }
      this.lastA = a; this.lastB = b;
      return { cov: +(n / (W * H)).toFixed(4), n, low: n ? +(low / n).toFixed(3) : null, dL: n ? +(dL / n).toFixed(2) : null, sat: n ? +(sA / n).toFixed(3) : null,
        satBed: +(sb / nb).toFixed(3), frameDL: +(frameD / (W * H)).toFixed(2), row7, veil: window.__plume.state().veil, veilR: window.__plume.state().veilR }; },
    png(which) { return B.png(which === 'b' ? this.lastB : which === 'p' ? this.lastPaint : this.lastA, 0.5); },
    st() { const L = L0(); return { t: +window.__plugClk.clock.elapsedTime.toFixed(3), dormant: L.dormant, bury: +L.bury.toFixed(3), stand: +L.stand.toFixed(3), hasStood: !!L.hasStood,
      shed: window.__burial.shedState ? window.__burial.shedState() : null, uShed: L.crustU && L.crustU.uShed ? L.crustU.uShed.value.toArray().map(q => +q.toFixed(3)) : null, plume: window.__plume.state() }; }
  };
  const L = L0(); window.__sp.cx = L.mound ? L.mound.bx : L.pos.x; window.__sp.cz = L.mound ? L.mound.bz : L.pos.z;
  return 1; })()`);
const save = async (name, which) => { if (!SHOTS) return; const u = await c.ev(`window.__sp.png(${JSON.stringify(which)})`); writeFileSync(join(SHOTS, `${MODE}${RED ? '-' + RED : ''}-${name}.png`), Buffer.from(u.split(',')[1], 'base64')); };

// the RED's switch
if (RED === 'off') await c.ev(`(Object.assign(window.__burial.crust, { cover: 0, dust: 0 }), 1)`);
if (RED === 'fade') await c.ev(`(window.__burial.shed.on = 0, 1)`);
if (RED === 'nocloud') await c.ev(`(window.__plume.look.on = 0, (async () => { await window.__burial.set({ plume: 0 }); return 1; })())`);
if (RED === 'pale') await c.ev(`(window.__plume.look.on = 0, 1)`);
await sleep(300);
await c.ev(`(window.__plume.tune.off = false, 1)`);

const out = { mode: MODE, red: RED || null, port: +PORT, readings: [], bars: {} };
const bars = out.bars;
const bar = (name, ok, val, text) => { bars[name] = { ok: ok === null ? null : !!ok, val, text }; console.log(`  ${ok === null ? 'VOID' : ok ? 'ok  ' : 'FAIL'} (${name}) ${JSON.stringify(val)} (bar ${text})`); };
const stepTo = async (secs, kind, from) => { const n = Math.round((secs - from) * 60); for (let i = 0; i < n; i += 30) await c.ev(`(window.__sp.step(${Math.min(30, n - i)}, '${kind}'), 1)`); };

if (MODE === 'crust') {
  console.log('him ' + JSON.stringify(await c.ev(`window.__sp.him(40, 1)`)));
  await c.ev(`(window.__sp.step(120, 'crust'), 1)`);
  const A = await c.ev(`window.__sp.paintRead()`); await save('A-paint', 'p');
  const seen = await c.ev(`window.__sp.seenRead()`);
  await save('A', 'a'); await save('A-off', 'b');
  out.readings.push({ at: 'A', ...A, seen, st: await c.ev(`window.__sp.st()`) });
  console.log('A ' + JSON.stringify(A) + ' seen ' + JSON.stringify(seen));
  await c.ev(`(window.lev.cmd('wake'), window.__sp.step(1, 'crust'), 1)`);
  let at = 0;
  for (const s of [1, 2, 3, 4]) { await stepTo(s, 'crust', at); at = s; const r = await c.ev(`window.__sp.paintRead()`); await save('w' + s, 'p'); const st = await c.ev(`window.__sp.st()`); out.readings.push({ at: '+' + s, ...r, st }); console.log(`+${s} ${JSON.stringify(r)} shed ${JSON.stringify(st.shed)} bury ${st.bury}`); }
  let k = 0; while (!(await c.ev(`!!window.lev.hasStood`)) && k++ < 600) await c.ev(`(window.__sp.step(1, 'crust'), 1)`);
  await c.ev(`(window.__sp.step(120, 'crust'), 1)`);
  const S = await c.ev(`window.__sp.paintRead()`); await save('S-paint', 'p'); const stS = await c.ev(`window.__sp.st()`);
  await c.ev(`(window.__burial.paint(false), 1)`); await c.ev(`window.__sp.cap().then(x => (window.__sp.lastA = x, 1))`); await save('S', 'a');
  out.readings.push({ at: 'S', ...S, st: stS, stoodAfterWake: +(at + k / 60).toFixed(2) });
  console.log('S ' + JSON.stringify(S) + ' ' + JSON.stringify(stS.shed));
  const R1 = out.readings.find(r => r.at === '+1');
  bar('asleep', A.frac != null && A.frac >= 0.12, A.frac, 'frac(A) >= 0.12');
  bar('seen', seen.share != null && seen.share >= 0.10, seen, '>= 10% of her up pixels move >= 6 codes of luma with the cover off');
  bar('holds', A.sand > 0 ? R1.sand >= 0.6 * A.sand : null, { sandA: A.sand, sand1: R1.sand, k: A.sand ? +(R1.sand / A.sand).toFixed(3) : null }, 'sand(+1) >= 0.6 x sand(A)');
  bar('sheds', A.frac && S.frac != null ? S.frac <= 0.6 * A.frac && S.frac < R1.frac : null, { fracA: A.frac, frac1: R1.frac, fracS: S.frac }, 'frac(S) <= 0.6 x frac(A) and < frac(+1)');
  bar('rest', S.frac != null ? S.frac >= 0.02 : null, S.frac, 'frac(S) >= 0.02');
} else {
  console.log('him ' + JSON.stringify(await c.ev(`window.__sp.him(40, -1)`)));
  await c.ev(`(window.__sp.step(120, 'cloud'), 1)`);
  await c.ev(`(window.lev.cmd('wake'), window.__sp.step(1, 'cloud'), 1)`);
  let at = 0;
  for (const s of [1, 2, 3, 5, 8, 12]) { await stepTo(s, 'cloud', at); at = s; const r = await c.ev(`window.__sp.cloudRead()`); await save('w' + s, 'a'); if (s === 3) await save('w3-off', 'b');
    out.readings.push({ at: '+' + s, ...r, st: await c.ev(`window.__sp.st()`) }); console.log(`+${s} ${JSON.stringify(r)}`); }
  const R = s => out.readings.find(r => r.at === '+' + s);
  const covMax = Math.max(...out.readings.map(r => r.cov));
  bar('seen', R(2).cov >= 0.03 && R(3).cov >= 0.03, [R(2).cov, R(3).cov], 'cov >= 0.03 at +2 and +3');
  bar('slight', out.readings.every(r => r.cov <= 0.45 && r.frameDL <= 10), out.readings.map(r => [r.cov, r.frameDL]), 'cov <= 0.45 and the frame mean luma rise <= 10 codes at every reading');
  bar('low', R(3).n && R(5).n ? R(3).low >= 0.75 && R(5).low >= 0.75 : null, [R(3).low, R(5).low], '>= 75% of the cloud pixels under the 7 u row at +3 and +5');
  bar('sandy', R(3).n ? R(3).sat >= 0.6 * R(3).satBed && R(3).dL <= 25 : null, { sat: R(3).sat, satBed: R(3).satBed, dL: R(3).dL }, 'at +3 sat(cloud) >= 0.6 x sat(seabed) and dL <= 25 codes');
  bar('settles', covMax > 0 ? R(12).cov <= 0.7 * covMax : null, { cov12: R(12).cov, covMax }, 'cov(+12) <= 0.7 x the largest cov');
}
const d = await drift(c); out.clock = d;
console.log('clock ' + JSON.stringify(d));
mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, JSON.stringify(out, null, 1));
c.close();
if (unmeasured(d)) { console.log('UNMEASURED (clock)'); process.exit(2); }
if (lost(d)) { console.log('CLOCK LOST'); process.exit(4); }
if (RED) {
  const mine = REDS[MODE][RED], failed = mine.filter(b => bars[b] && bars[b].ok === false);
  console.log(failed.length ? `RED ${RED}: ${failed.join(', ')} FAILED, as it must (exit 5)` : `RED ${RED}: its bars (${mine.join(', ')}) did NOT fail (exit 3)`);
  console.log('JSON ' + OUT); process.exit(failed.length ? 5 : 3);
}
const fails = Object.entries(bars).filter(([, v]) => v.ok === false).map(([k]) => k), voids = Object.entries(bars).filter(([, v]) => v.ok === null).map(([k]) => k);
console.log(fails.length ? 'FAIL ' + fails.join(', ') : voids.length ? 'UNMEASURED ' + voids.join(', ') : 'PASS');
console.log('JSON ' + OUT);
process.exit(fails.length ? 1 : voids.length ? 2 : 0);
