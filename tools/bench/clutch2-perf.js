// CLUTCH2 perf (cdp.mjs run): the clutch's whole cost (B.off A/B, liveAB ABBA) at the Alt+6
// spot facing the clutch close up, and from 30 u (z0b). Page: ?bench&playtest.
const wait = ms => new Promise(r => setTimeout(r, ms));
const out = {};
await __bench.setup('z0b');
window.__helm = true;
__playtest.jump('6'); await wait(3500);
const B = __sl.brood;
const face = () => { const t = B.takeAt, p = player.pos; player.yaw = Math.atan2(t.x - p.x, t.z - p.z) - 0.9; player.pitch = -0.35; };
face(); await wait(2500); face();
out.close = await __bench.liveAB({ name: 'clutch close', a: () => { B.off = false; }, b: () => { B.off = true; }, pairs: +(window.__pairs || 6), ms: 2500 });
await __bench.setup('z0b'); await wait(2500);
out.z0b = await __bench.liveAB({ name: 'z0b', a: () => { B.off = false; }, b: () => { B.off = true; }, pairs: +(window.__pairs || 6), ms: 2500 });
out.cal = await __bench.calibrate ? 'ok' : '';
return JSON.stringify({ close: [out.close.a, out.close.b, out.close.d], z0b: [out.z0b.a, out.z0b.b, out.z0b.d] });
