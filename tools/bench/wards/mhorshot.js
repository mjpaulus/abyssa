// Mhor stunned the real way (fed furnace, a strike aimed through the flare), camera pinned
// over the fifth ward (index 4). A.light: then haul Sal to that ward (harness approach).
const W = window.__wt, A = window.__arg || { site: 0 };
W.setup(A.site || 0, 2, false);
const L = window.lev, F = L.furnace, SV = window.survival;
SV.bitumen = 2;
const at = F.pos.clone(); at.x += 6; at.y = window.terrainH(at.x, at.z, 2) + 1.35;
W.hold(at); W.run(5, W.holdFn); W.key('KeyE');
W.until(() => L.state === 'circle', 60 * 40, W.holdFn);
for (let k = 0; k < 4 && L.state !== 'stunned'; k++) { W.until(() => L.state === 'circle', 600, W.holdFn); L.cmd('rear', F.top.clone()); W.until(() => L.state === 'stunned', 360, W.holdFn); }
W.run(90, W.holdFn);   // the convulsion settles
const g = L.sigils[4];
window.__last = g;
const n = W.wardNormal(g);
const pin = () => { const p = g.grp.position, nn = W.wardNormal(g); window.__camPin = { pos: [p.x + nn.x * 16 + 6, p.y + nn.y * 16 + 4, p.z + nn.z * 16], look: [p.x, p.y, p.z] }; };
pin(); window.__pinFn = pin;
if (!window.__pinLoop) { window.__pinLoop = true; const ride = () => { if (!window.__frozen && window.__pinFn) window.__pinFn(); requestAnimationFrame(ride); }; requestAnimationFrame(ride); }
// Sal off to the side, out of the shot's way
const off = g.grp.position.clone().addScaledVector(n, 12); off.x += 10;
W.hold(off); W.run(2, W.holdFn);
let lit = null;
if (A.light) { lit = W.approach(L, g, { far: 9, near: 1.0 }); }
return { state: L.state, stun: +L.stun.toFixed(2), lit: g.lit, approach: lit, buried: W.burial(L, g), local: g.local0.toArray() };
