const W = window.__wt, A = window.__arg || { site: 0, rem: false };
const cfg = W.setup(A.site, 1, A.rem);
const L = window.lev, P = window.player, SV = window.survival, H = L.hoard;
const res = { cfg, site: A.site, rem: A.rem, wards: [], notes: [] };
// take the ship's lamp with the real [E]
const at = H.lampPos.clone(); at.x += 1.2;
W.hold(at);
W.run(5, W.holdFn);
W.key('KeyE');
res.notes.push('lamp taken: ' + H.lampTaken + ' dormant: ' + L.dormant);
// stand back off her while she rises
const back = L.pos.clone(); const dir = H.lampPos.clone().sub(L.pos).setY(0).normalize();
back.addScaledVector(dir, 40); back.y = window.terrainH(back.x, back.z, 1) + 1.35;
W.hold(back);
W.until(() => L.riseE > 0.95, 60 * 20, W.holdFn);
res.notes.push('riseE ' + L.riseE.toFixed(2) + ' f=' + W.f);
res.before = L.sigils.map(g => W.look(L, g));
const ping = () => {
  // from beside her, real T (wait out the 6 s cooldown if needed)
  let rang = false;
  for (let k = 0; k < 8 && !rang; k++) {
    W.key('KeyT');
    if (L.reveal > 7) rang = true; else W.run(60, W.holdFn);
  }
  return rang;
};
for (let i = 0; i < L.sigils.length; i++) {
  const g = L.sigils[i];
  if (g.lit) { res.wards.push({ i, pre: 'lit' + (g.mem ? '(mem)' : '') }); continue; }
  if (L.reveal < 4) { W.hold(back); W.run(2, W.holdFn); res.notes.push('ping before ' + i + ': ' + ping()); W.run(30, W.holdFn); }
  const rev = +L.reveal.toFixed(2), grev = +g.rev.toFixed(2);
  const r = W.approach(L, g, { far: 9, near: 1.0 });
  W.run(30, W.holdFn);
  res.wards.push({ i, arm: g.arm, s: g.s, reveal: rev, grev, ...r, after: W.look(L, g), litCount: L.sigils.filter(q => q.lit).length, slot: window.__pool.indexOf(g.light) });
  W.hold(back);
  if (L.calmed) break;
}
res.calmed = L.calmed;
res.pos = L.sigils.map(g => g.grp.position.toArray().map(v => +v.toFixed(1)));
res.msgs = W.log.slice(-14);
return res;
