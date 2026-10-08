// Michael's route: ?playtest Alt+6 (the jump's own placement at the nest), a real [E] for the
// egg, every ward but the last lit, then the last ward touched with the egg in hand.
const W = window.__wt, A = window.__arg || {};
window.__lev.remember(null);   // the chart decides, as in his game
if (A.next) window.__playtest.jump('-');
if (A.rec) window.__chart.rec()[A.site || 0][0] = 1;
window.__playtest.jump('6');
const L = window.lev, B = L.brood, P = window.player;
W.log = [];
W.run(3);
W.key('KeyE');
const took = B.held >= 0;
const nestHold = P.pos.clone(); W.hold(nestHold);
W.until(() => L.standE > 0.95, 60 * 25, W.holdFn);
for (const g of L.sigils) { if (L.sigils.filter(q => !q.lit).length <= 1) break; if (!g.lit) { W.approach(L, g); W.run(150, W.holdFn); } }
const last = L.sigils.find(q => !q.lit); window.__last = last;
const r = W.approach(L, last, { frames: 30, dwell: 40 });
const msg = window.__msg();
return { site: window.__chartSiteName = A.next ? 1 : 0, n: L.sigils.length, remembered: !!L.remembered, took, eggOut: B.out(), lastLit: last.lit, coldT: last.coldT, live: msg.live, tally: document.querySelector('#bmLev .tally').textContent, dock: !!document.getElementById('ptDock'), log: W.log.map(m => m.msg) };
