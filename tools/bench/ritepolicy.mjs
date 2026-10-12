// THE RITE POLICY (velhard, 2026-10-12): the page-side ledger, the state a player reads off the screen and
// the two players of Velkath's fight, shared by riteplay.mjs and fullplay.mjs so the recorded run plays the
// same fight the sweep measured. Ruling: VELHARD-BRIEF.md ("No safe spot": under her more than ~2 s and
// she drops; she keeps her front to him; a slow-turn window after each blow and each drop; reach 5).
//   PERFECT: 0.25 s slices, exact aim. It has learned the rule: it counts its own time under her (deep under
//     her at 1/s, under her rim slower) and never reads hers. It goes in at the point of her rim nearest
//     the ward it wants (hopping and hauling round her outside the rim: she out-turns a walker; out of the
//     hammer's lane while she cocks), goes in
//     once its count has cooled, bursts at the ward on the slant, and is out before the drop: radially,
//     the moment the ward lights, at the first sign of the telegraph, or when its count says so.
//   AVERAGE: the ritefair "sloppy" player unchanged (0.5-1.0 s slices decided on the state at slice start,
//     aim +-20 deg, bursts held 0.6-1.2 s whatever the climb needs, only wards it has seen on screen,
//     no hammer dodge, straight at the ward; with no dark ward seen it walks round her looking, where
//     ritefair stood under her belly, a refuge then), plus it lingers under her a little too long: it leaves when
//     its own count passes 2.2-2.8 s (drawn each time it goes in), half the time when a ward it lit makes
//     her flinch, half the time when it sees the telegraph, and it goes back in without waiting for the
//     count to cool. After two drops taken going at the same ward it goes round to that ward's side as the
//     careful player does (it learns that a side ward is not reached from her face; she out-turns a walker).
export const DEG = Math.PI / 180;
const hyp = Math.hypot;
export function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

// ---- the page side: the per-frame ledger ----
export const PROBE = `(() => {
  const P = window.player, SV = window.survival, L = window.lev, cam = window.camera, V = P.pos.constructor;
  const v = new V(), w = new V();
  const seen = L.sigils.map(() => false);
  const st = { seen, f: 0, tears: 0, lastHit: -9, hits: 0, hitAt: [], dryN: 0, dryWas: false, low: 0, bowlN: 0, bowlAt: [], inBowl: false, camN: 0, camBad: 0, pressed: 0,
    wardT: L.sigils.map(g => g.lit ? 0 : null), calmT: null, retT: null, takeT: null, maxUp: 0, floatS: 0, tornPrev: SV.torn, pulledPrev: !!(L.harpoon && (L.harpoon.pulled && !L.harpoon.wound || L.harpoon.pressed)),
    lairFloor: terrainH(L.lairPos.x, L.lairPos.z, 0), minReserve: 1, minAir: 1, died: false, underS: 0,
    hammer0: L.hits || 0, dropHit0: L.dropHits || 0, drops0: L.dropHitN || 0 };
  const frame = () => {
    st.f++;
    const t = st.f / 60;
    if (SV.torn > st.tornPrev + 0.5) { st.tears++; if (t - st.lastHit > 0.5) { st.hits++; st.hitAt.push(+t.toFixed(1)); } st.lastHit = t; }
    st.tornPrev = SV.torn;
    const res = SV.reserve / (SV.reserveCap || 1);
    if (res < st.minReserve) st.minReserve = res;
    if (SV.oxygen < st.minAir) st.minAir = SV.oxygen;
    if (window.gameState === 'dead') st.died = true;
    if (L.nsUnder) st.underS += 1 / 60;
    const dry = res < 0.12;
    if (dry && !st.dryWas) st.dryN++;
    st.dryWas = dry;
    const fl = terrainH(P.pos.x, P.pos.z, 0);
    const lairD = Math.hypot(P.pos.x - L.lairPos.x, P.pos.z - L.lairPos.z);
    const inB = window.__fd ? window.__fd(P.pos.x, P.pos.z, 0) < 0 : fl < st.lairFloor - 15 && lairD < 90;   // (fissure Task 5: the 'bowl' is the crack now)
    if (inB && !st.inBowl) { st.bowlN++; st.bowlAt.push(+t.toFixed(1)); }
    st.inBowl = inB;
    const agl = P.pos.y - 1.35 - fl;
    if (agl > st.maxUp) st.maxUp = agl;
    if (agl > 9) st.floatS += 1 / 60;
    for (let i = 0; i < L.sigils.length; i++) if (L.sigils[i].lit && st.wardT[i] == null) st.wardT[i] = +t.toFixed(1);
    if (L.calmed && st.calmT == null) st.calmT = +t.toFixed(1);
    const Hp = L.harpoon, pl = !!(Hp && ((Hp.pulled && !Hp.wound) || Hp.pressed));
    if (pl && !st.pulledPrev && st.takeT == null) st.takeT = +t.toFixed(1);
    st.pulledPrev = pl;
    // the framing: she is awake and inside 30 u; readable if her belly or a dark ward is on screen
    if (st.f % 4 === 0 && t >= (window.__rpFlee || 0) && !L.dormant && !L.calmed && L.standE > 0.5 && Math.hypot(P.pos.x - L.pos.x, P.pos.z - L.pos.z) < 30) {
      st.camN++;
      cam.updateMatrixWorld();
      const on = p => { w.copy(p).project(cam); return Math.abs(w.x) < 0.95 && Math.abs(w.y) < 0.95 && w.z < 1 && w.z > -1; };
      let ok = on(v.set(L.pos.x, L.bodyY - 0.12 * L.R, L.pos.z));
      if (!ok) for (const g of L.sigils) if (!g.lit && on(g.grp.position)) { ok = true; break; }
      if (!ok) st.camBad++;
      for (let i = 0; i < L.sigils.length; i++) if (!seen[i] && on(L.sigils[i].grp.position)) seen[i] = true;
      if (cam.position.distanceTo(v.set(P.pos.x, P.pos.y + 0.3, P.pos.z)) < 2.6) st.pressed++;
    }
  };
  window.__rp = { st, frame };
  return 1;
})()`;

// what a player reads off the screen: him, her (where she is, which way she faces, the hammer's cock, the
// blow landing, her drop's telegraph), her wards
export const STATE = `(() => {
  const P = window.player, SV = window.survival, L = window.lev, Hp = L.harpoon, V = P.pos.constructor, r = x => +x.toFixed(2);
  const fl = terrainH(P.pos.x, P.pos.z, 0);
  const o = { pos: [r(P.pos.x), r(P.pos.y), r(P.pos.z)], vel: [r(P.vel.x), r(P.vel.y), r(P.vel.z)], agl: r(P.pos.y - 1.35 - fl), grounded: !!P.grounded,
    reserve: r(SV.reserve / (SV.reserveCap || 1)), fill: r(P.fill || 0), dormant: !!L.dormant, calmed: !!L.calmed, standE: r(L.standE),
    lev: [r(L.pos.x), r(L.bodyY - (L.dropY || 0)), r(L.pos.z)], R: r(L.R), lyaw: r(L.yaw), cock: r(L.cock || 0), threatE: r(L.threatE || 0), impT: r(L.impT == null ? 9 : L.impT),
    drop: L.drop || 0, crouch: r(L.crouch ? L.crouch.x : 0),
    yaw: r(P.yaw), canTake: !!(L.rite && L.rite.prompt(P.pos)), wrenching: !!(Hp && Hp.wrenching),
    reach: L.reach, msg: window.__msg().live };
  o.wards = L.sigils.map(g => ({ p: [r(g.grp.position.x), r(g.grp.position.y), r(g.grp.position.z)], lit: !!g.lit, floor: r(g.grp.position.y - terrainH(g.grp.position.x, g.grp.position.z, 0)) }));
  o.rp = window.__rp ? window.__rp.st : null;
  return o;
})()`;

// the ledger's closing read (page side): hits split by what landed them
export const TALLY = `(() => { const L = window.lev, st = window.__rp.st; return { hammerHits: (L.hits || 0) - st.hammer0, dropHits: (L.dropHits || 0) - st.dropHit0, drops: (L.dropHitN || 0) - st.drops0 }; })()`;

// rnd: the run's seeded stream; now(): the game seconds the driver has played
export function makePolicy({ AVG, rnd, FLEE = 0, now }) {
  const UNDER = 0.72, RIM = 0.95;      // how far in under her shell the count runs (and slower under her rim), as he has learned it (R)
  const EXIT_P = 1.5;                  // the perfect player's own count: out by then (her rule: ~2.4 s)
  let myU = 0, tPrev = null, prevLit = 0, wasUnder = false, wasRim = false, exitA = 2.5, outT = 0, commit = false, onTop = 0;
  let tgtI = -1, prevDrop = 0; const fails = [0, 0, 0, 0, 0];   // (average) drops taken going at each ward
  let stX = 0, stZ = 0, stT = -9, backT = -9;   // walled off going round her (a leg, a claw): back out and go again
  const decide = s => { const d = decide1(s); decide.dbg = dbg; return d; };
  let dbg = '';
  return decide;
  function decide1(s) {
    const t = now();
    const P = s.pos, reach = s.reach || 6, RR = s.R;
    const sec = AVG ? 0.5 + 0.5 * rnd() : 0.25;
    const noise = AVG ? (rnd() * 2 - 1) * 20 * DEG : 0;
    // the average player holds a burst ~1 s whatever the climb needs (the ledger's habit)
    const avgBurst = 0.6 + 0.6 * rnd();
    // asleep: [E] at the harpoon (or the old wound), then hands off through the wrench
    if (s.dormant) return { sec: 0.2, yaw: s.yaw, e: s.canTake && !s.wrenching, keys: [], why: s.wrenching ? 'wrench' : 'pull' };
    if (t < FLEE) { const ax = P[0] - s.lev[0], az = P[2] - s.lev[2]; return { sec, yaw: Math.atan2(ax, az) + noise, keys: ['W', 'Shift'], why: 'flee' }; }
    // her frame: him relative to her centre and her facing
    const ox = P[0] - s.lev[0], oz = P[2] - s.lev[2], rho = hyp(ox, oz);
    const fx = Math.sin(s.lyaw), fz = Math.cos(s.lyaw);
    const fwd = (ox * fx + oz * fz) / RR, lat = (ox * fz - oz * fx) / RR;
    const under = rho < UNDER * RR && P[1] < s.lev[1], rimB = !under && rho < RIM * RR && P[1] < s.lev[1];
    // HIS OWN COUNT of the time under her shell (the rule he has learned; it cools as he stays out)
    const dt = tPrev == null ? 0 : t - tPrev; tPrev = t;
    myU = wasUnder ? myU + dt : wasRim && !AVG ? myU + 0.3 * dt : Math.max(0, myU - dt);   // (the perfect one knows her rim counts slower)
    if (under && !wasUnder && AVG) exitA = 2.2 + 0.6 * rnd();
    wasUnder = under; wasRim = rimB;
    outT = under ? 0 : outT + dt;
    const nLit = s.wards.filter(w => w.lit).length, justLit = nLit > prevLit; prevLit = nLit;
    // (the perfect one has learned that a ward lit from under her brings the drop on: its count jumps too)
    if (!AVG && justLit && (under || rimB)) myU = Math.max(myU, 1.4);
    dbg = `rho ${(rho / RR).toFixed(2)} fwd ${fwd.toFixed(2)} lat ${lat.toFixed(2)} myU ${myU.toFixed(1)} drop ${s.drop} imp ${s.impT}`;
    const away = Math.atan2(ox, oz);      // out from under her, radially
    // targets: the dark wards
    const dark = s.wards.map((w, i) => ({ ...w, i })).filter(w => !w.lit && (!AVG || (s.rp && s.rp.seen[w.i])));
    const nDark = s.wards.filter(w => !w.lit).length;
    // ---- OFF HER BACK: a diver who has floated up onto her shell swims off it (the wards are under her);
    // the average one takes a couple of seconds to see it ----
    onTop = P[1] > s.lev[1] + 1 && rho < 1.25 * RR ? onTop + dt : 0;
    if (onTop > (AVG ? 2 : 0.3)) return { sec, yaw: away + noise, pitch: 0, keys: ['W', 'C'], why: 'off-back' };
    // ---- OUT FROM UNDER HER ----
    if (under) {
      const tele = s.drop === 1;
      if (AVG && justLit && rnd() < 0.5) exitA = 0;     // half the time he reads her flinch and leaves
      const go = AVG ? (myU > exitA || (tele && rnd() < 0.5)) : (tele || myU > EXIT_P || justLit);
      if (go) {
        commit = false;
        const keys = s.grounded ? ['W', 'Shift'] : ['W'];
        if (!s.grounded && s.vel[1] > 0.5) keys.push('C');
        return { sec, yaw: away + noise, pitch: s.grounded ? 0 : -0.25, keys, why: tele ? 'out-tele' : 'out' };
      }
    }
    let T = null, R = reach - 0.9;
    if (dark.length) {
      dark.sort((a, b) => hyp(a.p[0] - P[0], a.p[1] - P[1], a.p[2] - P[2]) - hyp(b.p[0] - P[0], b.p[1] - P[1], b.p[2] - P[2]));
      T = dark[0].p; tgtI = dark[0].i;
    } else tgtI = -1;
    // (average) a drop that came while it went at a ward is a failed dash at that ward; after two it has
    // learned that one is not reached from her face, and goes round to it like the careful player (still
    // late, sloppy, never waiting for its count)
    if (s.drop === 1 && prevDrop !== 1 && tgtI >= 0) fails[tgtI]++;
    prevDrop = s.drop;
    const smart = !AVG || (tgtI >= 0 && fails[tgtI] >= 2);
    // no dark ward seen yet: under her belly to look was the ritefair habit (a refuge then); under the new
    // rule that is 150 s of drops, so he walks round her outside her legs, looking up at her belly
    if (!T && nDark) {
      if (!AVG) T = [s.lev[0], s.lev[1] - 0.3 * RR, s.lev[2]];
      else {
        const aP = Math.atan2(ox, oz), tyaw = aP + Math.PI / 2, outK = clamp((1.35 * RR - rho) / 4, -0.6, 0.9);
        return { sec, yaw: tyaw - outK + noise, pitch: 0.4, keys: s.grounded ? ['W', 'Shift'] : ['W', 'C'], why: 'look' };
      }
    }
    if (!T) return { sec, yaw: 0, keys: [], why: 'idle' };
    // ---- THE PERFECT PLAYER OUTSIDE HER: round her rim to the point nearest the ward, in when cooled ----
    if (smart && justLit) commit = false;
    if (smart && commit && rho > (RIM * RR + 4)) commit = false;
    if (smart && !under && !commit) {
      const tx = T[0] - s.lev[0], tz = T[2] - s.lev[2], tl = hyp(tx, tz) || 1;
      const eR = RIM * RR + 1.0;
      const ex = s.lev[0] + tx / tl * eR, ez = s.lev[2] + tz / tl * eR;
      const de = hyp(ex - P[0], ez - P[2]);
      // the hammer's lane: in front of her, 1.6-2.8 R, while she cocks or falls: step out of it sideways
      const inLane = !AVG && fwd > 1.6 && fwd < 2.8 && Math.abs(lat) < 0.7 && s.threatE > 0.5 && s.cock > 0.25;
      if (inLane) {
        const sgn = lat >= 0 ? 1 : -1;
        return { sec, yaw: Math.atan2(fz * sgn, -fx * sgn), keys: s.grounded ? ['W', 'Shift'] : ['W'], why: 'lane' };
      }
      if (de > 4) {
        if (AVG) dbg += ' learned';
        // walled off (no headway for 1.5 s against a planted leg or her claw): a human backs out and goes again
        if (hyp(fwd * RR - stX, lat * RR - stZ) > 0.6) { stX = fwd * RR; stZ = lat * RR; stT = t; }   // (in her frame: she carries him)
        else if (t - stT > 1.5) { backT = t + 1.2; stT = t; }
        if (backT > t) return { sec, yaw: away, keys: s.grounded ? ['W', 'Shift'] : ['W'], why: 'unstick' };
        // circle outside the rim: if the straight line cuts under her, go round at the rim's radius
        const aP = Math.atan2(ox, oz), aE = Math.atan2(ex - s.lev[0], ez - s.lev[2]);
        let da = aE - aP; da = Math.atan2(Math.sin(da), Math.cos(da));
        let yaw;
        if (Math.abs(da) > 0.35 && rho < eR + 6) {
          const sgn = da > 0 ? 1 : -1;                         // tangent toward E
          const tyaw = aP + sgn * Math.PI / 2;
          const outK = clamp((eR + 2.5 - rho) / 3, -0.6, 1.1);  // hold the circle's radius (a haul carries him in)
          yaw = tyaw - sgn * outK;
          // she turns to keep her front on him faster than he walks round her: he hops off the bottom
          // and HAULS round her (~6.6 u/s), over her planted feet
          if (s.grounded && s.reserve > 0.3) return { sec, yaw, pitch: 0.2, keys: ['W'], space: 0.05, why: 'round-hop' };
          if (!s.grounded) return { sec, yaw, pitch: -0.05, keys: ['W', ...(s.vel[1] > 0.3 ? ['C'] : [])], why: 'round-haul' };
        } else yaw = Math.atan2(ex - P[0], ez - P[2]);
        return { sec, yaw, pitch: 0, keys: s.grounded ? ['W', 'Shift'] : ['W', ...(s.vel[1] > 0.5 ? ['C'] : [])], why: 'round' };
      }
      // at her rim, by the ward: wait out the count, then in
      if (!AVG && (myU > 0.35 || s.drop)) return { sec, yaw: Math.atan2(-ox, -oz), keys: s.grounded ? [] : ['C'], why: 'wait' };
      commit = true;                     // cooled, at her rim by the ward: in, and no second thoughts
    }
    // ---- AT THE WARD (both players; the average one comes straight here) ----
    const dx = T[0] - P[0], dz = T[2] - P[2], dh = hyp(dx, dz), up = T[1] - P[1];
    const d3 = hyp(dh, up);
    dbg += ` T dh ${dh.toFixed(1)} up ${up.toFixed(1)}`;
    const yaw = Math.atan2(dx, dz) + noise;
    // how high he must be at this horizontal distance to be in reach
    const hIn = Math.min(dh, R - 0.3), needUp = up - Math.sqrt(Math.max(0, R * R - hIn * hIn));
    const pitch = clamp(Math.atan2(up, Math.max(dh, 0.5)), -0.6, 1.2);
    if (d3 < R - 0.3) return { sec, yaw, keys: s.grounded ? [] : (s.vel[1] > 0.5 ? ['C'] : []), why: 'in-reach' };
    if (s.grounded) {
      const lookP = clamp(pitch, -0.3, 0.7);
      // (velhard) the perfect player bursts at a high ward on the slant from up to 8 u out (on foot to 3.5 u
      // its time under her ran out before the climb began); the average one walks in to 3.5 u, as ritefair
      if (!AVG && needUp > 2.2 && dh <= 8) {
        const sp = clamp(0.22 + 0.05 * needUp + 0.03 * dh, 0.22, 1.2);
        return { sec: Math.max(sec, sp + 0.05), yaw, pitch, keys: ['W'], space: sp, why: 'burst ' + needUp.toFixed(1) };
      }
      if (dh > 3.5 && needUp > -1) return { sec, yaw, pitch: lookP, keys: ['W', 'Shift'], why: 'walk' };
      if (needUp <= 0.2) return { sec, yaw, pitch: lookP, keys: ['W', 'Shift'], why: 'walk-in' };
      if (needUp <= 2.2) return { sec, yaw, pitch: clamp(pitch, -0.3, 0.7), keys: dh > 1.5 ? ['W'] : [], space: 0.05, why: 'hop' };
      // a burst toward it: held for what the climb needs
      const sp = AVG ? avgBurst : clamp(0.22 + 0.05 * needUp, 0.22, 1.2);
      return { sec: Math.max(sec, sp + 0.05), yaw, pitch, keys: dh > 1.5 ? ['W'] : [], space: sp, why: 'burst ' + needUp.toFixed(1) };
    }
    // in the water
    const vy = s.vel[1];
    const keys = [];
    if (dh > 1.2) keys.push('W');
    if (needUp < -1.0 || vy > 2.5 || (needUp < 0 && vy > 0.8)) keys.push('C');
    if (needUp > 1.5 && vy < 1.0 && s.reserve > 0.25) return { sec: Math.max(sec, 0.3), yaw, pitch, keys, space: AVG ? avgBurst : 0.25, why: 'swim-burst' };
    return { sec, yaw, pitch, keys, why: 'swim' };
  }
}
