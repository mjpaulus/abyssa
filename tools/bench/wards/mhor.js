// args via window.__arg = { site, rem }
const W = window.__wt, A = window.__arg || { site: 0, rem: false };
const cfg = W.setup(A.site, 2, A.rem);
const L = window.lev, P = window.player, SV = window.survival;
const F = L.furnace;
const res = { cfg, site: A.site, rem: A.rem, wards: [], notes: [] };
// feed the furnace with the real [E]
SV.bitumen = 2;
const at = F.pos.clone(); at.x += 6; at.y = window.terrainH(at.x, at.z, 2) + 1.35;
W.hold(at);
W.run(5, W.holdFn);
W.key('KeyE');
res.notes.push('furnace lit: ' + F.lit);
// wait for him to arrive and circle
const ok = W.until(() => L.state === 'circle', 60 * 40, W.holdFn);
res.notes.push('circle: ' + ok + ' f=' + W.f);
// the strike: through the flare (Sal at the furnace; the strike aims at the furnace top)
let stunned = false;
for (let tries = 0; tries < 4 && !stunned; tries++) {
  W.until(() => L.state === 'circle', 60 * 10, W.holdFn);
  L.cmd('rear', F.top.clone());
  stunned = W.until(() => L.state === 'stunned', 60 * 6, W.holdFn);
}
res.notes.push('stunned: ' + stunned + ' stun=' + L.stun.toFixed(2) + ' hStun=' + L.hStun);
res.before = L.sigils.map(g => W.look(L, g));
for (let i = 0; i < L.sigils.length; i++) {
  const g = L.sigils[i];
  if (g.lit) { res.wards.push({ i, pre: 'lit' + (g.mem ? '(mem)' : '') }); continue; }
  if (L.state !== 'stunned') {
    // a new stun, the real way
    for (let tries = 0; tries < 4 && L.state !== 'stunned'; tries++) {
      W.until(() => L.state === 'circle', 60 * 12, W.holdFn);
      L.cmd('rear', F.top.clone());
      W.until(() => L.state === 'stunned', 60 * 6, W.holdFn);
    }
    res.notes.push('re-stun for ward ' + i + ': ' + L.state);
  }
  if (A.pace) W.run(A.pace, W.holdFn);   // a diver's swim between wards (HUD checks)
  const stunLeft = +L.stun.toFixed(2);
  const r = W.approach(L, g, { far: 9, near: 1.0 });
  W.run(30);   // flash settles
  res.wards.push({ i, stunLeft, ...r, after: W.look(L, g), others: L.sigils.filter(q => q.lit).length });
  if (L.calmed) break;
}
res.calmed = L.calmed;
res.msgs = W.log.slice(-14);
return res;
