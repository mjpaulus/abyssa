// Ward touch harness: installs window.__wt. Run once per page load via cdp `run`.
const THREE = await import('three');
const W = window.__wt = {};
const C = await import("/src/entities/sleeper/common.js"); window.__pool = C.sigilPool; W.C = C;
const step = window.__bench.step;
const P = window.player, SV = window.survival;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
W.log = [];
let lastMsg = '';
const keep = () => {
  P.onDeck = false; if (P.ladder) P.ladder = null;
  SV.oxygen = 1; SV.hose = 5000; SV.fuel = 1; SV.torn = 0;
  const m = window.__msg();
  if (m.live !== lastMsg && m.t > 0) { lastMsg = m.live; W.log.push({ f: W.f, msg: m.live }); }
  if (m.t <= 0) lastMsg = '';
};
W.f = 0;
// step n frames of the REAL update; fn(i) runs after each frame (set the position for the next)
W.run = (n, fn) => step(n, i => { W.f++; keep(); return fn ? fn(i) : undefined; });
W.until = (cond, max, fn) => { let ok = false; W.run(max, i => { if (fn) fn(i); if (cond()) { ok = true; return false; } }); return ok; };
W.key = code => {
  window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code.replace('Key', '').toLowerCase(), bubbles: true }));
  window.dispatchEvent(new KeyboardEvent('keyup', { code, key: code.replace('Key', '').toLowerCase(), bubbles: true }));
};
const hold = new THREE.Vector3();
W.hold = p => { hold.copy(p); };
W.holdFn = () => { P.pos.copy(hold); P.vel.set(0, 0, 0); P.onDeck = false; };
W.setup = (site, zone, rem) => {
  window.__helm = true;
  if (window.__chartSite !== site) { window.__chart.arrive(site); window.__chartSite = site; }
  window.__lev.remember(rem);
  window.gotoZone(zone);
  SV.hasSonar = true;
  W.log = []; lastMsg = '';
  return { kind: window.lev.kind, n: window.lev.sigils.length, mem: window.lev.memWard };
};
const ground = (x, z) => window.terrainH(x, z, window.zone);
// sleeper meshes to test burial against (not the wards, halos, embers)
function bodyMeshes(L) {
  const wardObjs = new Set();
  for (const g of L.sigils) { g.grp.traverse(o => wardObjs.add(o)); wardObjs.add(g.halo); }
  const out = [];
  L.grp.traverse(o => { if (o.isMesh && !o.isInstancedMesh && o.visible && !wardObjs.has(o) && o.material && !o.material.transparent) out.push(o); });
  return out;
}
const rc = new THREE.Raycaster();
// how far the creature's own hide stands OVER the rune (ward-normal axis), >0 = rune buried
W.burial = (L, g) => {
  const n = V(0, 0, 1).applyQuaternion(g.grp.getWorldQuaternion(new THREE.Quaternion()));
  const rune = g.rune.getWorldPosition(V());
  const from = rune.clone().addScaledVector(n, 25);
  rc.set(from, n.clone().negate()); rc.far = 40;
  const hits = rc.intersectObjects(bodyMeshes(L), false);
  return hits.length ? +(25 - hits[0].distance).toFixed(2) : null;
};
W.wardNormal = g => V(0, 0, 1).applyQuaternion(g.grp.getWorldQuaternion(new THREE.Quaternion()));
// approach ward g: from `far` out to `near` along its outward normal (kept above ground),
// over n frames, then dwell d frames. Returns the frame index (relative) the ward lit, or -1.
W.approach = (L, g, o = {}) => {
  const n = o.frames || 30, dwell = o.dwell || 12, far = o.far || 9, near = o.near == null ? 1.2 : o.near;
  const wasLit = g.lit, pre = L.sigils.map(q => q.lit);
  let litAt = -1, k = 0;
  const target = () => {
    const nn = W.wardNormal(g);
    // keep a horizontal bias so an underside ward is approached from beside/below, not through the ground
    const t = Math.min(1, k / n), d = far + (near - far) * t;
    const p = g.grp.position.clone().addScaledVector(nn, d);
    const gy = ground(p.x, p.z) + 1.35;
    if (p.y < gy) p.y = gy;
    return p;
  };
  P.pos.copy(target()); P.vel.set(0, 0, 0);
  if (L.pPrev) L.pPrev.copy(P.pos);   // he arrives at the start point; no teleport sweep across the body
  W.run(1, () => { P.pos.copy(target()); P.vel.set(0, 0, 0); });   // pPrev settles at the start
  W.run(n + dwell, i => {
    k = i + 1;
    if (!wasLit && g.lit && litAt < 0) litAt = i;
    if (o.during) o.during(i);
    P.pos.copy(target()); P.vel.set(0, 0, 0);
  });
  if (!wasLit && g.lit && litAt < 0) litAt = n + dwell;
  const alsoLit = L.sigils.map((q, j) => (!pre[j] && q.lit && q !== g) ? j : -1).filter(j => j >= 0);
  return { litAt, alsoLit, dist: +P.pos.distanceTo(g.grp.position).toFixed(2), segDist: +g.grp.position.distanceTo(P.pos).toFixed(2) };
};
// what a ward looks like right now
W.look = (L, g) => {
  const idx = (window.__pool || []).indexOf(g.light);
  return {
    lit: g.lit, mem: !!g.mem, rev: +g.rev.toFixed(2),
    runeOp: +g.rune.material.opacity.toFixed(2), runeR: +g.rune.material.color.r.toFixed(2),
    runeVis: g.rune.visible && g.grp.visible && L.grp.visible,
    lightI: +g.light.intensity.toFixed(1), lightD: +g.light.position.distanceTo(g.grp.position).toFixed(2),
    lightInScene: !!g.light.parent, buried: W.burial(L, g)
  };
};
return 'ok';
