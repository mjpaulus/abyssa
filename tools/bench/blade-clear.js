// (fissure-and-harpoon Task 7, fix round 1) THE IRON'S CLEARANCE off Sal's own body, per state. A page module for the
// blade-shots page (bs ev "$(cat tools/bench/blade-clear.js)"): 21 points along the iron (butt -1.02 .. tip 0.665)
// against capsules/spheres of the rig — bonnet + corselet (diverOccluders), hips, both thighs and shins, the knife
// sheath, the left upper arm and forearm (points within 0.35 u of the grip skipped there: the fist holds it).
// Clearance = distance to the part's axis minus its radius; < 0 is inside. Per state: the minimum per part.
// (final fix wave) It FAILS: the page module THROWS (so `blade-shots.mjs ev` exits 1) when any part's minimum in
// any state is below 0 (inside the body), except the valve check's bonnet (his hand is on the helmet there and the
// sphere is a rough fit of the bonnet's bbox: the palm itself measures -0.074; bound -0.2), or when the iron was
// never shown (no state measured anything). The table is the return value when it passes.
(async () => {
  const D = await import('/src/entities/diver.js'), R = await import('/src/systems/raft.js'), Cc = await import('/src/systems/raft/colliders.js'), PL = await import('/src/player.js');
  const g = D.diver, P = window.player, V = P.pos.constructor, oc = new Float32Array(8), p = new V(), a = new V(), b = new V(), w = new V();
  const kd = c => window.dispatchEvent(new KeyboardEvent('keydown', { code: c, key: c, bubbles: true }));
  const ku = c => window.dispatchEvent(new KeyboardEvent('keyup', { code: c, key: c, bubbles: true }));
  const segD = (q, A, B) => { w.subVectors(B, A); const l2 = w.lengthSq(); let t = l2 > 0 ? ((q.x - A.x) * w.x + (q.y - A.y) * w.y + (q.z - A.z) * w.z) / l2 : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(q.x - A.x - w.x * t, q.y - A.y - w.y * t, q.z - A.z - w.z * t); };
  const cap = (o1, o2, r, skip) => ({ o1, o2, r, skip });
  const parts = {
    thighL: cap(g.legL.root, g.legL.mid, 0.20), shinL: cap(g.legL.mid, g.legL.end, 0.17),
    thighR: cap(g.legR.root, g.legR.mid, 0.20), shinR: cap(g.legR.mid, g.legR.end, 0.17),
    upArmL: cap(g.armL.root, g.armL.mid, 0.15, 0.35), foreArmL: cap(g.armL.mid, g.armL.end, 0.13, 0.35)
  };
  const HG = -0.67;
  const probe = (acc) => {
    if (!g.harpoon.visible) return;
    g.updateMatrixWorld(true); D.diverOccluders(oc);
    const sh = g.knifeSheath; const s1 = sh.localToWorld(new V(0, 0.12, 0)), s2 = sh.localToWorld(new V(0, -0.30, 0));
    g.hips.getWorldPosition(b); const hipC = b.clone();
    for (let k = 0; k <= 20; k++) {
      const z = -1.02 + 1.685 * k / 20; p.set(0, 0, z); g.harpoonMesh.localToWorld(p);
      const put = (n, d) => { if (!(n in acc) || d < acc[n][0]) acc[n] = [+d.toFixed(3), +z.toFixed(2)]; };
      put('bonnet', Math.hypot(p.x - oc[4], p.y - oc[5], p.z - oc[6]) - oc[7]);
      put('corselet', Math.hypot(p.x - oc[0], p.y - oc[1], p.z - oc[2]) - oc[3]);
      put('hips', p.distanceTo(hipC) - 0.40);
      put('sheath', segD(p, s1, s2) - 0.10);
      for (const n in parts) { const c = parts[n]; if (c.skip && Math.abs(z - HG) < c.skip) continue; c.o1.getWorldPosition(a); c.o2.getWorldPosition(b); put(n, segD(p, a, b) - c.r); }
    }
  };
  const run = (name, n, setup, teardown) => { setup && setup(); const acc = {}; let sp = 0;
    window.__bench.step(n, () => { probe(acc); sp = Math.max(sp, Math.hypot(P.vel.x, P.vel.z)); }); teardown && teardown(); acc.speedMax = +sp.toFixed(2); return [name, acc]; };
  window.__helm = true; window.survival.hasHarpoon = true;
  const out = [];
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit3', key: '3', altKey: true, bubbles: true })); window.__helm = true; window.__bench.step(60);
  out.push(run('idle', 240));
  out.push(run('walk', 420, () => { kd('KeyW'); window.__bench.step(60); }, () => ku('KeyW')));
  window.__bench.step(60);
  out.push(run('walkHurry', 300, () => { kd('KeyW'); kd('ShiftLeft'); window.__bench.step(60); }, () => { ku('KeyW'); ku('ShiftLeft'); }));
  window.__bench.step(60);
  out.push(run('thrust', 60, () => window.__slash()));
  out.push(run('valve', 200, () => { window.__sal.valve = 1; }, () => { window.__sal.valve = -1; }));
  window.__bench.step(60);
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit5', key: '5', altKey: true, bubbles: true })); window.__helm = true;
  { const S = window.pred.sharks.find(s => s.cfg.zi === 0); S.state = 'patrol'; S.cool = 90; S.arousal = 0; S.pos.x += 80; }
  window.__bench.step(60);
  out.push(run('haul', 360, () => kd('KeyW'), () => ku('KeyW')));
  out.push(run('burst', 150, () => kd('Space'), () => ku('Space')));
  out.push(run('burstOff', 90));
  out.push(run('swimThrust', 60, () => window.__slash()));
  // the ladder
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1', key: '1', altKey: true, bubbles: true })); window.__helm = true; window.__bench.step(60);
  { const raft = R.raft; raft.updateMatrixWorld(true); const pp = raft.localToWorld(new V(5.3, 0, Cc.LADDER_Z)), q = raft.localToWorld(new V(4.3, 0, Cc.LADDER_Z));
    const top = PL.deckHeightAt(pp.x, pp.z) + 1.35; P.pos.set(pp.x, top - 3.2, pp.z); P.vel.set(0, 0, 0); P.onDeck = false; P.yaw = Math.atan2(q.x - pp.x, q.z - pp.z); }
  let on = 0;
  out.push(run('ladder', 150, () => kd('KeyW'), () => ku('KeyW')));
  window.__helm = false;
  const bad = [];
  for (const [name, acc] of out) {
    const parts = Object.keys(acc).filter(k => k !== 'speedMax');
    if (!parts.length) bad.push(name + ': nothing measured (the iron hidden?)');
    for (const k of parts) { const lim = name === 'valve' && k === 'bonnet' ? -0.2 : 0; if (acc[k][0] < lim) bad.push(`${name} ${k} ${acc[k][0]} at z ${acc[k][1]} (bound ${lim})`); }
  }
  if (bad.length) throw new Error('BLADE CLEAR FAIL: ' + bad.join('; '));
  return out;
})()
