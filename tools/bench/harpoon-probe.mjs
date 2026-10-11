// THE HARPOON probe (fissure-and-harpoon Task 6; spec docs/superpowers/specs/2026-10-10-fissure-and-harpoon-design.md §2).
//   node tools/bench/harpoon-probe.mjs <routes|rite|remote|lodged|abort> <port>      (serve.py must already serve <port>)
// Env DRV_PORT (CDP debug port, default 9485). A FRESH PROFILE per run (the chart save remembers
// pulled[site] and tools.harpoon), shared across the rite's own reload.
//   routes: at all four anchorages (Home, Pallid, Burned, the Unsounded Shelf), Alt+6 stands Sal at
//     L.harpoon.anchor: the prompt reads "[E] PULL THE HARPOON"; the harpoon rides her NEAR flank (sand
//     side), at standing height, never over the crack; the anchor is off the crack and clear of her body.
//   rite: real E at home -> the wrench holds his controls ~1.5 s, she stays asleep through it -> it
//     comes free, the line, she wakes, Sal owns the harpoon, pulled[0] is saved -> a reload keeps the
//     ownership -> Alt+6 finds the OLD WOUND ("[E] PRESS THE OLD WOUND") -> pressing it wakes her
//     again, grants nothing new.
const [, , mode, port] = process.argv;
process.env.DRV_PORT = process.env.DRV_PORT || '9485';
const { mkdtempSync, rmSync } = await import('node:fs'); const { tmpdir } = await import('node:os');
process.env.DRV_DIR = mkdtempSync(tmpdir() + '/abyssa-harpoon-probe-');
const { start, stop, connect, sleep } = await import('./drv.mjs');
await start(`http://localhost:${port}/?bench&playtest`);
process.on('exit', () => { stop(); try { rmSync(process.env.DRV_DIR, { recursive: true, force: true }); } catch (e) { } });
let c = await connect();
const ready = `!document.getElementById('load') && typeof window.setState === 'function' && !!window.__bench && !!window.__chart`;
await c.until(ready, 240000, 1000);
const fail = [];
const alt = (cc, d) => cc.ev(`(window.dispatchEvent(new KeyboardEvent('keydown',{code:'Digit${d}',key:'${d}',altKey:true,bubbles:true})), window.dispatchEvent(new KeyboardEvent('keyup',{code:'Digit${d}',key:'${d}',altKey:true,bubbles:true})), window.__helm=true, window.__bench.step(60), 1)`);
const AT = `(async () => {
  const S = await import('/src/world/fissureShape.js'), T = await import('/src/world/terrain.js'), BC = await import('/src/entities/sleeper/bodyCols.js');
  const L = window.lev, P = window.player, H = L && L.harpoon;
  if (!H) return { err: 'no harpoon (' + (L ? L.kind : 'no sleeper') + ')' };
  const hp = H.seamWorld ? H.seamWorld() : null, a = H.anchor;
  const fl = T.terrainH(a.x, a.z, 0);
  let blocked = false; L.publishCols && L.publishCols();
  for (const h of [0.45, 1.0, 1.6]) if (BC.bodyBlocked(a.x, fl + h, a.z, 0.45)) blocked = true;
  const sand = L.sand, side = hp ? (hp.x - L.pos.x) * sand.x + (hp.z - L.pos.z) * sand.z : null;
  return { prompt: L.rite ? L.rite.prompt(P.pos) : null, dSal: +Math.hypot(P.pos.x - a.x, P.pos.z - a.z).toFixed(2),
    anchorFd: +S.fissureDist(a.x, a.z, 0).toFixed(1), seamFd: hp ? +S.fissureDist(hp.x, hp.z, 0).toFixed(1) : null,
    seamUp: hp ? +(hp.y - T.terrainH(hp.x, hp.z, 0)).toFixed(2) : null, seamUpSal: hp ? +(hp.y - fl).toFixed(2) : null, sandSide: side == null ? null : +side.toFixed(1),
    gripUp: H.gripWorld ? +(H.gripWorld(new (a.constructor)()).y - fl).toFixed(2) : null, seatOk: !!H.seatOk,
    blocked, wound: !!H.wound, pulled: !!H.pulled, dormant: !!L.dormant, site: window.__chart.site ? window.__chart.site() : null };
})()`;
if (mode === 'routes') {
  await c.ev(`(window.__helm = true, window.setState('play'), 1)`);
  for (const site of [0, 1, 2, 3]) {
    await c.ev(`(window.__helm=true, window.__chart.arrive(${site}), 1)`); await alt(c, 6);
    const r = await c.ev(AT);
    console.log('site', site, JSON.stringify(r));
    if (r.err) { fail.push(`site ${site}: ${r.err}`); continue; }
    if (r.prompt !== '[E] PULL THE HARPOON') fail.push(`site ${site} prompt: ${r.prompt}`);
    if (r.anchorFd < 6) fail.push(`site ${site}: Sal stands ${r.anchorFd} u off the crack`);
    if (r.seamFd < 6) fail.push(`site ${site}: the harpoon sits ${r.seamFd} u off the crack`);
    if (!(r.sandSide > 0)) fail.push(`site ${site}: the harpoon is not on her near (sand) flank (${r.sandSide})`);
    if (!(r.seamUpSal > 0.5 && r.seamUpSal < 2.8)) fail.push(`site ${site}: the seam is ${r.seamUpSal} u over his boots (0.5-2.8)`);
    if (!(r.gripUp > 0.85 && r.gripUp < 1.95)) fail.push(`site ${site}: the harpoon's grip is ${r.gripUp} u over his boots (his hands: 0.85-1.95)`);
    if (!r.seatOk) fail.push(`site ${site}: no seam on her flank qualified (fallback seat)`);
    if (r.blocked) fail.push(`site ${site}: the anchor is inside her body`);
    if (r.dSal > 0.6) fail.push(`site ${site}: Alt+6 left him ${r.dSal} u off the anchor`);
  }
}
if (mode === 'rite') {
  await c.ev(`(window.__helm = true, window.setState('play'), 1)`);
  await c.ev(`(window.__helm=true, window.__chart.arrive(0), 1)`); await alt(c, 6);
  const p0 = await c.ev(`window.lev.rite.prompt(window.player.pos)`);
  if (p0 !== '[E] PULL THE HARPOON') fail.push('home prompt: ' + p0);
  const own0 = await c.ev(`!!window.survival.hasHarpoon`);
  if (own0) fail.push('owned the harpoon before the pull');
  await c.key('KeyE', true); await c.ev(`(window.__bench.step(2), 1)`); await c.key('KeyE', false);
  // the wrench: his drive held off, she still asleep, W does nothing
  await c.key('KeyW', true);
  const w = await c.ev(`(() => { const P = window.player, x = P.pos.x, z = P.pos.z; window.__bench.step(50); return { moved: +Math.hypot(P.pos.x - x, P.pos.z - z).toFixed(2), dormant: !!window.lev.dormant, wrench: !!window.lev.harpoon.wrenching, owns: !!window.survival.hasHarpoon }; })()`);
  await c.key('KeyW', false);
  console.log('wrench', JSON.stringify(w));
  if (w.moved > 0.15) fail.push('he walked during the wrench: ' + w.moved);
  if (!w.dormant) fail.push('she woke before it came free');
  if (!w.wrench) fail.push('no wrench under way 0.8 s after E');
  const lines = [];
  const s = await c.ev(`(() => { const seen = []; window.__bench.step(600, () => { const m = window.__msg().live; if (m && seen[seen.length - 1] !== m) seen.push(m); }); return { dormant: window.lev.dormant, owns: !!window.survival.hasHarpoon, msgs: seen, pulled: !!window.lev.harpoon.pulled, saved: JSON.parse(localStorage.getItem('abyssa.chart.v1') || '{}') }; })()`);
  console.log('after', JSON.stringify(s));
  if (s.dormant) fail.push('she did not wake');
  if (!s.owns) fail.push('no harpoon owned');
  if (!s.msgs.includes('IT COMES FREE. SHE FEELS IT.')) fail.push('no pull line: ' + JSON.stringify(s.msgs));
  if (!s.msgs.some(m => /VELKATH/.test(m))) fail.push('her name never showed: ' + JSON.stringify(s.msgs));
  if (!(s.saved.pulled && s.saved.pulled[0] === 1)) fail.push('pulled[0] not saved: ' + JSON.stringify(s.saved.pulled));
  if (!(s.saved.tools && s.saved.tools.harpoon)) fail.push('tools.harpoon not saved');
  void lines;
  await c.ev(`(location.reload(), 1)`).catch(() => {}); await sleep(3000);
  c.close(); c = await connect(); await c.until(ready, 240000, 1000);
  await c.ev(`(window.__helm=true, window.setState('play'), 1)`); await sleep(1000);
  await alt(c, 6);
  const a = await c.ev(`({ owns: !!window.survival.hasHarpoon, prompt: window.lev.rite.prompt(window.player.pos), wound: !!window.lev.harpoon.wound, dormant: !!window.lev.dormant })`);
  console.log('reload', JSON.stringify(a));
  if (!a.owns) fail.push('ownership lost on reload');
  if (a.prompt !== '[E] PRESS THE OLD WOUND') fail.push('revisit prompt: ' + a.prompt);
  // the remembered rite starts at the wound: same commitment, she wakes, nothing new granted
  await c.key('KeyE', true); await c.ev(`(window.__bench.step(2), 1)`); await c.key('KeyE', false);
  const b = await c.ev(`(() => { const seen = []; window.__bench.step(400, () => { const m = window.__msg().live; if (m && seen[seen.length - 1] !== m) seen.push(m); }); return { dormant: !!window.lev.dormant, msgs: seen }; })()`);
  console.log('wound', JSON.stringify(b));
  if (b.dormant) fail.push('pressing the wound did not wake her');
  if (b.msgs.includes('IT COMES FREE. SHE FEELS IT.') || b.msgs.includes("ANOTHER DIVER'S HARPOON.")) fail.push('the wound said a pull line');
} else if (mode === 'lodged') {
  // THE IRON IS IN HER (fix round 1): at all four anchorages, points along the DRAWN iron (H.iron.matrixWorld,
  // the live pose) are cast against her drawn body (the shell, the instanced legs, the claws; DoubleSide for
  // the test) along +-Y and +-the seam normal. INSIDE = every first hit is an exit face. The head (tip, mid,
  // both barbs, pin) and the shank must be inside her shell, the head by >= 0.1 u; the socket, ferrule and the
  // pole (outside her) must be inside no leg or claw.
  await c.ev(`(window.__helm = true, window.setState('play'), 1)`);
  const LODGE = `(async () => {
    const THREE = await import('three'); const L = window.lev, H = L.harpoon; L.grp.updateMatrixWorld(true);
    const shell = [L.parts.shell], limbs = [];
    for (const k in L.legs) limbs.push(L.legs[k]);
    for (const cl of L.claws || []) for (const k in cl) { const o = cl[k]; if (o && o.isObject3D) o.traverse(m => { if (m.isMesh && !limbs.includes(m)) limbs.push(m); }); }
    const all = shell.concat(limbs), sides = all.map(m => m.material.side); all.forEach(m => m.material.side = THREE.DoubleSide);
    const rc = new THREE.Raycaster(), v = new THREE.Vector3(), n = H.normal.clone(), nm = new THREE.Matrix3(), im = new THREE.Matrix4(), wn = new THREE.Vector3();
    const dirs = [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0), n.clone(), n.clone().negate()];
    const inside = (p, objs) => { let dmin = 1e9;
      for (const d of dirs) { rc.set(p, d); rc.far = 40; const h = rc.intersectObjects(objs, false)[0]; if (!h) return -1;
        const o = h.object; let M = o.matrixWorld; if (o.isInstancedMesh && h.instanceId != null) { o.getMatrixAt(h.instanceId, im); M = im.premultiply(o.matrixWorld); }
        nm.getNormalMatrix(M); wn.copy(h.face.normal).applyMatrix3(nm).normalize(); if (wn.dot(d) <= 0) return -1; dmin = Math.min(dmin, h.distance); }
      return dmin; };
    const pt = (x, y, z) => v.set(x, y, z).applyMatrix4(H.iron.matrixWorld).clone();
    const head = { tip: [0, 0, 0.62], mid: [0, 0, 0.52], barbL: [0.06, 0, 0.45], barbR: [-0.06, 0, 0.45], pin: [0, 0, 0.448], shank: [0, 0, 0.25] };
    const out = { site: window.__chart.site(), head: {}, limbs: {} };
    for (const k in head) out.head[k] = +inside(pt(...head[k]), shell).toFixed(3);
    for (const z of [0.0, -0.1, -0.3, -0.55, -0.8, -0.95]) out.limbs[z] = +inside(pt(0, 0, z), limbs).toFixed(3);
    all.forEach((m, i) => m.material.side = sides[i]);
    return out; })()`;
  for (const site of [0, 1, 2, 3]) {
    await c.ev(`(window.__helm=true, window.__chart.arrive(${site}), 1)`); await alt(c, 6);
    const r = await c.ev(LODGE);
    console.log('site', site, JSON.stringify(r));
    for (const k in r.head) { const need = k === 'shank' ? 0.0 : 0.1; if (!(r.head[k] >= need)) fail.push(`site ${site}: the ${k} is ${r.head[k] < 0 ? 'outside her' : r.head[k] + ' u inside (< ' + need + ')'}`); }
    for (const z in r.limbs) if (r.limbs[z] >= 0) fail.push(`site ${site}: the pole at z ${z} runs through a leg/claw (${r.limbs[z]} u)`);
  }
} else if (mode === 'remote') {
  // the first pull EVER at a remote anchorage: another diver's iron, and the blade with it; then home's
  // own pull says its own line and grants nothing new; pulled[] is per anchorage
  const pull = async site => {
    await c.ev(`(window.__helm=true, window.__chart.arrive(${site}), 1)`); await alt(c, 6);
    await c.key('KeyE', true); await c.ev(`(window.__bench.step(2), 1)`); await c.key('KeyE', false);
    return c.ev(`(() => { const seen = []; window.__bench.step(300, () => { const m = window.__msg().live; if (m && seen[seen.length - 1] !== m) seen.push(m); }); const sv = JSON.parse(localStorage.getItem('abyssa.chart.v1') || '{}'); return { msgs: seen, owns: !!window.survival.hasHarpoon, dormant: !!window.lev.dormant, pulled: sv.pulled, tool: !!(sv.tools && sv.tools.harpoon) }; })()`);
  };
  await c.ev(`(window.__helm = true, window.setState('play'), 1)`);
  const r1 = await pull(1);
  console.log('pallid', JSON.stringify(r1));
  if (!r1.msgs.includes("ANOTHER DIVER'S HARPOON.")) fail.push('remote line missing: ' + JSON.stringify(r1.msgs));
  if (r1.msgs.includes('IT COMES FREE. SHE FEELS IT.')) fail.push('home line at a remote anchorage');
  if (!r1.owns || !r1.tool) fail.push('the first pull ever (remote) did not grant the blade');
  if (JSON.stringify(r1.pulled) !== '[0,1,0,0]') fail.push('pulled after Pallid: ' + JSON.stringify(r1.pulled));
  if (r1.dormant) fail.push('she did not wake at Pallid');
  const r0 = await pull(0);
  console.log('home', JSON.stringify(r0));
  if (!r0.msgs.includes('IT COMES FREE. SHE FEELS IT.')) fail.push('home line missing: ' + JSON.stringify(r0.msgs));
  if (!r0.owns) fail.push('ownership lost');
  if (JSON.stringify(r0.pulled) !== '[1,1,0,0]') fail.push('pulled after home: ' + JSON.stringify(r0.pulled));
} else if (mode !== 'routes') fail.push('unknown mode ' + mode);
const cons = await c.console();
const errs = cons.filter(l => /error|EXC/i.test(l) && !/favicon/.test(l));
if (errs.length) { console.log('CONSOLE', errs.slice(0, 6).join('\n')); fail.push('console errors: ' + errs.length); }
c.close();
stop();
if (fail.length) { console.error('FAIL', fail); process.exit(1); } else console.log('PASS');
