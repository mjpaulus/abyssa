// FAILING TEST for the brood rule's feedback: with an egg out and one dark ward left, every
// entry into the last ward's reach must put the refusal on the live HUD line within 1.5 s.
const W = window.__wt, A = window.__arg || { site: 0, rem: false };
const cfg = W.setup(A.site, 0, A.rem);
const L = window.lev, P = window.player, B = L.brood;
const e0 = B.eggs.find(q => q.inNest), at = e0.mesh.position.clone(); at.x += 0.6; at.y = window.terrainH(at.x, at.z, 0) + 1.35;
W.hold(at); W.run(5, W.holdFn); W.key('KeyE');
W.until(() => L.standE > 0.95, 60 * 25, W.holdFn);
for (const g of L.sigils) { if (L.sigils.filter(q => !q.lit).length <= 1) break; if (!g.lit) { W.approach(L, g); W.run(20, W.holdFn); } }
const last = L.sigils.find(q => !q.lit);
const entries = [];
for (let k = 0; k < 3; k++) {
  // away (out of reach), then in again
  const away = last.grp.position.clone().addScaledVector(W.wardNormal(last), 16); away.y = Math.max(away.y, window.terrainH(away.x, away.z, 0) + 1.35);
  W.hold(away); W.run(60 * 4, W.holdFn);
  let seen = false, cue = false;
  const ap = W.approach(L, last, { frames: 30, dwell: 90, during: () => {
    const m = window.__msg(); if (m.t > 0 && /LAST WARD|NEST/.test(m.live)) seen = true;
    if (window.__wardRefuse && window.__wardRefuse() > 0) cue = true;
  } });
  entries.push({ k, seen, cue, lit: last.lit, eggOut: B.out() });
}
return { cfg, site: A.site, rem: A.rem, entries, pass: entries.every(e => e.seen && !e.lit), log: W.log.slice(-12).map(m => m.msg) };
