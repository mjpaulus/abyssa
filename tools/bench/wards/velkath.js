const W = window.__wt, A = window.__arg || { site: 0, rem: false };
const cfg = W.setup(A.site, 0, A.rem);
const L = window.lev, P = window.player, B = L.brood;
const res = { cfg, site: A.site, rem: A.rem, wards: [], notes: [] };
const nestAt = () => { const e = B.eggs.find(q => q.inNest); const p = e.mesh.position.clone(); p.x += 0.6; p.y = window.terrainH(p.x, p.z, 0) + 1.35; return p; };
W.hold(nestAt());
W.run(5, W.holdFn);
W.key('KeyE');
res.notes.push('egg held: ' + B.held + ' out: ' + B.out());
W.until(() => L.standE > 0.95, 60 * 25, W.holdFn);
res.notes.push('standE ' + L.standE.toFixed(2) + ' f=' + W.f);
res.before = L.sigils.map(g => W.look(L, g));
const order = L.sigils.map((g, i) => i);
for (const i of order) {
  const g = L.sigils[i];
  if (g.lit) { res.wards.push({ i, pre: 'lit' + (g.mem ? '(mem)' : '') }); continue; }
  const dark = L.sigils.filter(q => !q.lit).length;
  const logN = W.log.length;
  const r = W.approach(L, g, { far: 9, near: 1.0 });
  W.run(30, W.holdFn);
  const row = { i, darkBefore: dark, eggOut: B.out(), ...r, after: W.look(L, g), litCount: L.sigils.filter(q => q.lit).length, msgs: W.log.slice(logN).map(m => m.msg) };
  if (dark === 1 && !g.lit) {
    // the brood rule held: go back, set the egg in the nest with the real [E]
    const n = B.nest.clone(); n.y = window.terrainH(n.x, n.z, 0) + 1.35;
    W.hold(n); W.run(3, W.holdFn); W.key('KeyE');
    row.returned = B.out() === 0;
    const lit = W.until(() => g.lit, 60 * 10, W.holdFn);
    row.selfLit = lit; row.afterReturn = W.look(L, g);
    W.run(30, W.holdFn);
  }
  res.wards.push(row);
  if (L.calmed) break;
}
res.calmed = L.calmed;
res.msgs = W.log.slice(-10);
return res;
