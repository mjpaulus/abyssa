// Frame setup for the proof shots: Velkath awake with an egg out, every ward but the last lit
// (harness), then Sal stood ~R u from the last ward on the seabed facing it, camera snapped,
// and the live loop handed back. The caller then holds W (a real keydown) and shoots.
const W = window.__wt, A = window.__arg || { site: 0, rem: false, R: 10 };
W.setup(A.site, 0, A.rem);
const L = window.lev, P = window.player, B = L.brood;
const e0 = B.eggs.find(q => q.inNest), at = e0.mesh.position.clone(); at.x += 0.6; at.y = window.terrainH(at.x, at.z, 0) + 1.35;
W.hold(at); W.run(5, W.holdFn); W.key('KeyE');
W.until(() => L.standE > 0.95, 60 * 25, W.holdFn);
for (const g of L.sigils) { if (L.sigils.filter(q => !q.lit).length <= 1) break; if (!g.lit) { W.approach(L, g); W.run(20, W.holdFn); } }
const last = L.sigils.find(q => !q.lit);
window.__last = last;
// A.pre: one earlier touch of the held ward (the stepping harness), then 5 s away from it,
// so the shot is the diver's SECOND try (Michael: "I tried multiple times")
if (A.pre) { W.approach(L, last); const away = last.grp.position.clone().addScaledVector(W.wardNormal(last), 16); away.y = Math.max(away.y, window.terrainH(away.x, away.z, 0) + 1.35); W.hold(away); W.run(300, W.holdFn); }
// stand off along the horizontal from her centre through the ward
const c = L.pos, wp = last.grp.position;
let dx = wp.x - c.x, dz = wp.z - c.z; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
const sx = wp.x + dx * (A.R || 10), sz = wp.z + dz * (A.R || 10);
window.__bench.place(sx, sz, Math.atan2(wp.x - sx, wp.z - sz), 0);
// in the water at the ward's height (her belly rides ~10-14 u up when she stands): he hauls in
if (A.mid !== false) { P.pos.y = wp.y - 1.2; P.grounded = false; P.vel.set(0, 0, 0); }
P.pitch = A.pitch == null ? 0.18 : A.pitch;
L.pPrev.copy(P.pos);
W.log = [];
return { ward: L.sigils.indexOf(last), dist: +P.pos.distanceTo(wp).toFixed(1), wardY: +(wp.y - window.terrainH(wp.x, wp.z, 0)).toFixed(1), eggOut: B.out(), state: window.gameState };
