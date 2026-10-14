// RELIEF WALK (seafloor relief Task 11; the plan's Review Focus 1 and 4, G1's hose; spec docs/superpowers/specs/
// 2026-10-13-seafloor-relief-design.md §7): Sal walks over the new ground with REAL keys on the LIVE loop.
//   DRV_PORT=9520 node tools/bench/relief-walk.mjs <boots|lens|hose> <port>        (serve.py serves <port>; branch 8870 / 9520, main 8871 / 9521)
// Env  RW_REPS=<n>   walks per line and direction (boots 2, lens 3)
//      RW_JSON=<f>   write the result (the lens's main run hands its bar to the branch's through this file)
//      RW_MAIN=<f>   (lens, on the branch) main's RW_JSON: the bars below are main's own numbers on the same probe
//      RW_RED=<v>    an opt-in RED case, never part of the default run. It must fail ITS bar: exit 1 = it did, exit 3 = that bar did NOT fail
//                    boots noslope   window.__sal.slope = false (diver.js's slope rig off, a live knob it ships): the boots must fail the gap bar
//                    lens  nofloor   window.__camNoFloor = true (game.js updateCamera's floor clamp off): the lens must fail clearance
//                    hose  short20   the line is 20 u short of the binding point's range (survival.hose = range - 20): the walk must yank
//                    hose  past20    the ruled case as written: the walk goes on 20 u past the binding point, straight out. It cannot yank (below)
//      RW_UP_PITCH=<rad> (lens) the look-up pitch of the stress walks and stands (0.9, inside the mouse's +-1.45 rad: player.js)
//      RW_STOP=lines, RW_ONLY=wall, RW_DUMPLIB=<f>   dev: stop after the lines / the wall-foot control alone / write the page library for node --check
// All three modes run on the live loop: W is a real CDP key (the mouse's job, yaw and pitch, is set in the page, as the other real-key probes
// do: fissure-probe climb-out, the t12 walks), and __bench.place only puts him at a line's foot. NEVER __bench.step: game.js's bench hold(false)
// adds wall time to the game clock on every step (Ruling 42), so a stepped probe needs fullplay-gate.mjs's clock plug; a live loop has no hold and
// no leak. The frame times are booked instead (dt = the game's own step, the change in __leash.clock; skipped rAF ticks; frames at the game's
// 50 ms clamp). The headless document has no focus, so the frame governor would hold the game to its 30 fps idle rate:
// Emulation.setFocusEmulationEnabled gives it the focus a player's window has (60 fps, as shipped). Every mode is a fresh load in a fresh
// profile (no save, no caches). One sample per SIM frame (a rAF tick without a leash.clock advance books nothing).
//
// THE LINES, picked by measurement. A line is a 40 u fall-line segment (a riser's steepest part is a few u wide; a walk wants a run): its centre
// is a floor cell whose 2 u central-difference slope lies in a band, and it ranks by how many of its 41 one-u samples lie in that band (ties
// by mean slope; a single steep cell is a grid artefact, and the band's top edge ties by the hundred); every sample walkable (inside the disc
// r 235, off the crack's apron, inside the wall-foot clamp, under 50 deg), one way up (the net rise is 85% of the climbing: no crest crossed,
// or the riser is both ahead of him and behind), distinct lines >= 45 u apart; the first whose corridor is clear of his body (+-1.3 u) and of
// every collider the lens's boom could meet (r + 3.6 u, from the floor - 0.5 to 7 u over it, 9 u past each end) is walked. On the branch:
//   riser   20-35 deg, the centre on a hollow riser (hollow q * N: frac > 1 - rw), every sample inside the hollow's footprint
//   upland  20-35 deg, outside the footprint (q <= 0.02), r <= 200: the uplands' own
//   steep   35-45 deg, on a riser (Review Focus 4's riser; reported, not gated, for the boots; its lens CLEARANCE is gated)
//   bed     the raft column -> her bed: the cheapest walkable route (Dijkstra over a 1 u grid, steps <= 50 deg, steep steps dear),
//           string-pulled to a few legs, ending 26 u from her centre (R x 1.7: short of her body; she must still be dormant after)
// The branch's candidates come from the SLICED REAL CODE in node (tools/relief/terrain.gen.mjs, re-sliced by gates.mjs first; gates.mjs --json
// gives her bed and the hose's binding point). Main has no replica and no hollow: the SAME ranking runs in the page on main's own terrainH,
// over the same disc, with no category (ruling 1: main's steepest floor cells in the 20-35 deg band): its A is the steepest line, its B the
// steepest 60 u from A, its S the steepest in 35-45 deg, and its bed route runs to its own bed (she lies elsewhere there).
//
// boots   real W up and down every line, 2 walks each way. Per planted stance frame (one sample per sim frame per boot; not on the deck, not
//         airborne, not staggered; the counts of those are booked) the gap is read two ways, and the ground's slope at the boot (acos of
//         terrainNormal.y, player.js's own walkable test, a 0.5 u baseline) bins it in 5 deg:
//         OWN (gated): the lowest point of the drawn sole (heel, ball, toe, from diver.legR/L.end, the lead casting's underside at SOLE_Y in
//         the foot's frame) over ITS OWN ground: min over the points of (y - terrainH(x, z)); the rig's own test (diver.js driveLegs: heel and
//         ball each over their own ground). - sinks, + hangs.
//         BRIEF (booked): the plan's __fts[i].wlo - terrainH(__fts[i].wx, __fts[i].wz). wlo is the LOWEST sole point's height but (wx, wz) is
//         the CONTACT point, a heel's or ball's length (0.16-0.3 u) from it, so a sole lying exactly on the hill reads d x tan(slope): its p50
//         |gap| tracks 0.16 x tan(slope) bin by bin (0.07 at 22 deg, 0.09 at 32), a bias that grows with the very slope under test.
//         PASS: on ground <= 35 deg OWN p95 |gap| <= 0.15 u per line (both directions pooled; the rig clamps the sole's pitch at 35.5 deg by
//         design); steeper ground is REPORTED in 5 deg bins, not gated (Michael judges); progress: no 2 s window under 0.5 u moved, except
//         where the slope under him exceeds 52 deg; no vacuous line (>= 300 planted frames on <= 35 deg ground). RED noslope.
// lens    the same lines walked DOWN (the riser behind him), 3 walks each at pitch -0.1, and once more looking up (pitch 0.9: a diver looking
//         up swings the boom DOWN behind him, toward the hill; the lens's worst case), plus a WALL-FOOT CONTROL: he stands 3 s with a 54+ deg
//         face behind him (the rim wall's foot), level and looking up. Per sim frame: clearance = camera.y - shutFloorY(camera.x, camera.z, 0),
//         the lens's step (|d camera| / dt, u/s), the boom (the lens to his centre). The lens is booked from the frame after the place, so the
//         2.6 s settle is booked too; W is pressed at the end of it. PASS (Ruling 48, like for like): CLEARANCE >= 0.3 u on EVERY frame of every
//         walk and stand, no exclusions; (a) THE SWOOP is an event: each walk's first boom pull-in IN THE WALK (the boom falls >= 1 u; see below),
//         its peak frame step; each relief line's peak <= the MAX peak over main's A, B and S, + 0.5 u/s (identical runs scatter by 0.1-0.25); a
//         line pulled in at the place has none in the walk (the place's own peak scatters 14-26 u/s, printed, not gated); (b) THE SETTLED WALK: the frames from 2 s after that pull-in
//         has completed (never before W), on both builds alike: each relief line's settled p99 <= main's on its equivalent line (riser and upland:
//         A, the steepest 20-35 deg line, ruled, and the closest in mean slope; steep: S, main's only line above 36 deg); both + 0.1 u/s (the
//         table's precision; the strict difference is printed). Printed beside them: where each first pull-in fell (at the place, in the walk),
//         the pull-ins in the walk alone, and the settled frames still over 6 u/s. The bed route's turns swing the boom: booked, clearance-gated,
//         never step-gated. RED nofloor: the walk down (level) does not fail clearance (the boom's own pull-in, game.js clearCamDistance, holds
//         the lens over 1.1 u of floor before the clamp is asked); looking up, it does, and so does the control.
// hose    from the deck with HOSE_START 380 (survival.hose is never set; FP_HOSE unset): real W over the side, C down to the seabed, then real
//         W along the route to the binding point (gates.mjs --json hose.at). PASS: arrives (within 3 u) with __leash.n === 0 and last.str === 0
//         (no yank), the farthest range the leash read <= HOSE_START - GIVE - 10 = 365 (spec §7: 10 u spare under the give). Books __leash
//         {state, r, give, n, last, maxIn, maxEnd} (state is a string property, not a function). The ruled RED ("20 u past the binding point")
//         cannot yank: past B the floor RISES into the rim wall (too steep to walk: past20 stalls him 2 u beyond B), so the 3D range FALLS (344 u at
//         20 u past, against 354 at B) and never nears the give (375) or the hold (380); short20 is the equivalent that can: the line 20 u
//         shorter than the binding point's range, so the point lies 20 u past what the hose reaches.
// Also: fuel and oxygen are refilled at each walk's start (survival.js FUEL_BURN 1/420 per second down the line: a long run's pump runs
// dry, the oxygen goes in ~35 s and he is hauled to the deck; measured as the third bed walk of a lens run, ~7 min in, thrown 36 u off its
// line with 580 airborne frames on BOTH builds, and the same empty pump reproduced alone); a walk that a creature or the haul disturbs
// (thrown, stalled, bitten) is run again, twice at most, and kept flagged if it stays disturbed.
// THE BOOM'S SWOOP. The lens's boom is 9 u back (CAM_BACK), starts at its full length at every place() and is pulled in, in eighths, wherever its
// line comes within 1.1 u of the floor (clearCamDistance), then eased at 14/s: where the hill meets it, the lens SWOOPS in from 9.5 to 3.4 u in
// ~0.4 s (6-25 u/s). The first pull-in of a walk falls either at the place (the hill is already behind him at the line's top: the spring's step
// response to the snap) or in the walk (the hill meets the boom as he descends); a later one can follow (main's B: pulled in at the place,
// eased back out, pulled in again at u 11). It is the shipped lens, on both builds, and a single line's whole-walk p99 measures where the line's
// top stands against the hill, not the slope: hence Ruling 48's two parts.
const [, , MODE, PORT] = process.argv;
const RED = process.env.RW_RED;
const RED_OF = { boots: ['noslope'], lens: ['nofloor'], hose: ['past20', 'short20'] };
if (!RED_OF[MODE] || !PORT) { console.error('usage: node tools/bench/relief-walk.mjs <boots|lens|hose> <port>'); process.exit(2); }
if (RED !== undefined && !RED_OF[MODE].includes(RED)) {   // a RED this mode lacks would be ignored, and the run would pass as GREEN
  console.error(`RW_RED: mode ${MODE} has ${RED_OF[MODE].length ? 'the variants ' + RED_OF[MODE].join(', ') : 'no RED variant'} (got ${JSON.stringify(RED)})`); process.exit(2); }
process.env.DRV_PORT = process.env.DRV_PORT || '9520';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
process.env.DRV_DIR = mkdtempSync(join(tmpdir(), 'abyssa-relief-walk-'));   // a fresh profile: no save, no caches
const { start, stop, connect, sleep } = await import('./drv.mjs');
process.on('exit', () => { stop(); try { rmSync(process.env.DRV_DIR, { recursive: true, force: true }); } catch (e) { } });
const HERE = dirname(fileURLToPath(import.meta.url)), REPO = join(HERE, '..', '..');

// ---- the bars ----
const GAP_BAR = 0.15, GAP_DEG = 35, MIN_FRAMES = 300;          // boots: p95 |gap| on <= 35 deg ground
const SWOOP_TOL = 0.5;                                          // lens: u/s, the swoop's peak is a 60 Hz sampling of a 0.4 s event: identical runs scatter by 0.1-0.25 (main S 15.61-15.87 over four runs, the upland 15.90-16.02)
const STEP_TOL = 0.1;                                           // lens: u/s, the table's own precision: two different lines' p99s are not the same number to the last digit (the riser's 2.43-2.45 against main A's 2.42)
const CLEAR_BAR = 0.3;                                          // lens: u over shutFloorY, every frame
const STALL_WIN = 2.0, STALL_MIN = 0.5, STALL_DEG = 52;         // progress
const HOSE_START = 380, GIVE = 5, SPARE_BAR = 10, ARRIVE_R = 3;  // hose (tether.js GIVE 5; spec §7: >= 10 u spare under the give)
const UP_PITCH = +(process.env.RW_UP_PITCH || 0.9);   // lens: the look-up walks and stands (looking up 52 deg, inside the mouse's +-1.45 rad (player.js), swings the boom DOWN behind him, toward the hill: the lens's worst case, and what the floor clamp is for)
const SEG = 40, RANK_R = 235, SEP = 45, BED_STOP = 26;   // SEG: a line's length (rankLines takes its half)
const REPS = +(process.env.RW_REPS || (MODE === 'lens' ? 3 : 2));
const fail = [], tags = new Set();   // tags: which bar each failure belongs to (a RED must fail ITS bar)
const bad = (tag, msg) => { tags.add(tag); fail.push(msg); };
const pct = (a, p) => { if (!a.length) return NaN; const s = Float64Array.from(a).sort(), f = (s.length - 1) * p, i = Math.floor(f); return s[i] + (s[Math.min(s.length - 1, i + 1)] - s[i]) * (f - i); };
const f3 = v => Number.isFinite(v) ? v.toFixed(3) : String(v), f2 = v => Number.isFinite(v) ? v.toFixed(2) : String(v), f1 = v => Number.isFinite(v) ? v.toFixed(1) : String(v);
const pad = (v, n) => String(v).padEnd(n), lpad = (v, n) => String(v).padStart(n);

// ---- the ranking: pure, self-contained (it runs in node on the replica AND in the page on main's terrainH; toString() carries it) ----
function mkLim(tbl) {   // player.js's wall-foot clamp: lerp over the 128-bearing table
  return (x, z) => { const th = Math.atan2(z, x), fi = ((th < 0 ? th + Math.PI * 2 : th) / (Math.PI * 2)) * 128, i = fi | 0; return tbl[i] + (tbl[i + 1] - tbl[i]) * (fi - i); };
}
function rankLines(a) {
  const { h, fd, lim, centre, all, seg, R, keep, sep, band } = a, M = R + 3, N = 2 * M + 1, D = 180 / Math.PI;
  const G = new Float32Array(N * N), SL = new Float32Array(N * N), OK = new Uint8Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) G[j * N + i] = h(i - M, j - M);
  for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) { const k = j * N + i; SL[k] = Math.atan(Math.hypot(G[k + 1] - G[k - 1], G[k + N] - G[k - N]) / 2) * D; }
  for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
    const x = i - M, z = j - M, r = Math.hypot(x, z);
    if (r <= R && fd(x, z) >= 14 && r < lim(x, z) - 2 && all(x, z)) OK[j * N + i] = 1;
  }
  const out = [];
  for (let z = -R; z <= R; z += 2) for (let x = -R; x <= R; x += 2) {
    const k = (z + M) * N + x + M;
    if (!OK[k] || SL[k] < band[0] || SL[k] > band[1] || !centre(x, z)) continue;
    const gx = (G[k + 1] - G[k - 1]) / 2, gz = (G[k + N] - G[k - N]) / 2, m = Math.hypot(gx, gz), ux = gx / m, uz = gz / m;   // uphill
    let n = 0, sum = 0, mx = 0, ok = true, cnt = 0, hp = 0, up = 0, tot = 0;
    for (let t = -seg; t <= seg; t++) {
      const i = Math.round(x + ux * t) + M, j = Math.round(z + uz * t) + M;
      if (i < 1 || j < 1 || i >= N - 1 || j >= N - 1) { ok = false; break; }
      const kk = j * N + i, s = SL[kk];
      if (!OK[kk] || s > 50) { ok = false; break; }
      if (s >= band[0] && s <= band[1]) n++;
      sum += s; cnt++; if (s > mx) mx = s;
      if (t > -seg) { up += G[kk] - hp; tot += Math.abs(G[kk] - hp); } hp = G[kk];
    }
    // one way up: the net rise is most of the climbing done (a crest crossed would put the riser both ahead of him and behind)
    if (ok && up >= 0.85 * tot) out.push({ x, z, ux, uz, n, mean: sum / cnt, max: mx, s: SL[k], rise: up });
  }
  out.sort((p, q) => q.n - p.n || q.mean - p.mean);
  const picks = [];
  for (const p of out) {
    if (picks.length >= keep) break;
    if (picks.some(q => Math.hypot(q.x - p.x, q.z - p.z) < sep)) continue;
    picks.push({ lo: [p.x - p.ux * seg, p.z - p.uz * seg], hi: [p.x + p.ux * seg, p.z + p.uz * seg], centre: [p.x, p.z], n: p.n, mean: +p.mean.toFixed(1), max: +p.max.toFixed(1), s: +p.s.toFixed(1), rise: +p.rise.toFixed(1), len: 2 * seg });
  }
  return { picks, cand: out.length };
}

// ---- the replica (the branch): candidates by category, her bed and the binding point from gates.mjs --json ----
async function replicaPlan(rank) {
  const tmp = join(process.env.DRV_DIR, 'gates.json');
  const g = spawnSync(process.execPath, [join(REPO, 'tools/relief/gates.mjs'), '--json', tmp], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (g.status !== 0) { console.error(g.stdout + g.stderr); throw new Error('gates.mjs exited ' + g.status + ': the replica gates are not green, so no line is picked on them'); }
  const J = JSON.parse(readFileSync(tmp, 'utf8')), at = n => (J.gates.find(x => x[0].startsWith(n)) || [])[2];
  const hoseG = at('L hose'), bed = J.out.bed;
  const { setSite } = await import(join(REPO, 'src/world/site.js'));
  const { fissureDist } = await import(join(REPO, 'src/world/fissureShape.js'));
  const T = await import(join(REPO, 'tools/relief/terrain.gen.mjs'));
  setSite(0); T.syncSite(); T.buildClampTable();
  const o = {}, HOL = T.HOL, q = (x, z) => T.hollowAt(x, z, o).q;
  const base = { h: (x, z) => T.terrainH(x, z, 0), fd: (x, z) => fissureDist(x, z, 0), lim: mkLim(T.clampR[0]), seg: SEG / 2, R: RANK_R, keep: 150, sep: SEP, band: [20, 35] };
  if (!rank) return { bed, skiff: J.out.skiff, hose: hoseG, J };
  const isRiser = (x, z) => { const v = q(x, z); if (!(v > 0.02 && v < 0.98)) return false; const sN = v * HOL.N; return sN - Math.floor(sN) > 1 - HOL.rw; };
  const inHollow = (x, z) => q(x, z) > 0.02, outside = (x, z) => q(x, z) <= 0.02 && x * x + z * z <= 200 * 200;
  const riser = rankLines({ ...base, centre: isRiser, all: inHollow });
  const upland = rankLines({ ...base, centre: () => true, all: outside });
  const steep = rankLines({ ...base, centre: isRiser, all: inHollow, band: [35, 45] });   // Review Focus 4's 35-45 deg riser
  return { riser: riser.picks, upland: upland.picks, steep: steep.picks, cand: { riser: riser.cand, upland: upland.cand, steep: steep.cand }, bed, skiff: J.out.skiff, hose: hoseG, J };
}

// ---- the page library (window.__rw): blocked mask, routes, the walker with its per-sim-frame booking ----
const LIB = `(async () => {
  const T = await import('/src/world/terrain.js'), CORE = await import('/src/core.js'), S = await import('/src/world/fissureShape.js');
  const FL = await import('/src/world/flora.js'), PR = await import('/src/world/props.js'), WR = await import('/src/world/wrecks.js');
  let VE = null; try { VE = await import('/src/world/vents.js'); } catch (e) { }
  const DV = await import('/src/entities/diver.js');
  const cam = CORE.camera, P = window.player, L = window.__leash, TH = (x, z) => T.terrainH(x, z, 0), D = 180 / Math.PI;
  // THE SOLE, as drawn: the lead casting's underside is exactly SOLE_Y (-0.15) in the foot's frame (diver.js); heel, ball and toe
  // points of its outline (x, z). own(i) = the lowest point over ITS OWN ground: min over them of (y - terrainH(x, z)), the
  // rig's own test (diver.js driveLegs: heel and ball each over their own ground). - sinks, + hangs.
  const ENDS = [DV.diver.legR.end, DV.diver.legL.end], V = new cam.position.constructor();
  const SOLE_PTS = [[0, -0.16], [0.08, -0.14], [-0.08, -0.14], [0.12, 0.215], [-0.12, 0.215], [0.06, 0.30], [-0.06, 0.30]];
  const own = i => { const e = ENDS[i]; e.updateWorldMatrix(true, false); let m = 1e9;
    for (const q of SOLE_PTS) { V.set(q[0], -0.15, q[1]); e.localToWorld(V); const g = V.y - TH(V.x, V.z); if (g < m) m = g; } return m; };
  const RW = window.__rw = { run: null, h: TH };
  ${mkLim.toString()}
  ${rankLines.toString()}
  RW.rankMain = (p) => rankLines({ h: TH, fd: (x, z) => S.fissureDist(x, z, 0), lim: mkLim(T.clampR[0]), centre: () => true, all: (x, z) => x * x + z * z <= 200 * 200,
    seg: p.seg, R: p.R, keep: p.keep, sep: p.sep, band: p.band });
  // THE BLOCKED MASK (1 u cells, +-240): the colliders the player is pushed out of (rocks, props, wrecks, vents) where they
  // meet his body (floor - 0.2 .. floor + 2.6), her body's disc, the crack's apron, the wall-foot clamp
  const M0 = 240, NB = 2 * M0 + 1, BL = new Uint8Array(NB * NB), HG = new Float32Array(NB * NB);
  RW.block = () => {
    const lim = mkLim(T.clampR[0]), lv = window.lev;
    for (let j = 0; j < NB; j++) for (let i = 0; i < NB; i++) { const x = i - M0, z = j - M0; HG[j * NB + i] = TH(x, z); BL[j * NB + i] = (Math.hypot(x, z) > Math.min(238, lim(x, z) - 3) || S.fissureDist(x, z, 0) < 8) ? 1 : 0; }
    const cols = [].concat(FL.rockColliders, PR.propColliders, WR.wreckColliders, VE ? VE.ventColliders : []);
    let nc = 0;
    for (const c of cols) {
      if (!(c && c.r > 0)) continue; nc++;
      const R = c.r + 1.7;
      for (let z = Math.max(-M0, Math.floor(c.z - R)); z <= Math.min(M0, Math.ceil(c.z + R)); z++) for (let x = Math.max(-M0, Math.floor(c.x - R)); x <= Math.min(M0, Math.ceil(c.x + R)); x++) {
        const fl = HG[(z + M0) * NB + x + M0]; if (c.y - c.r > fl + 2.6 || c.y + c.r < fl - 0.2) continue;
        if (Math.hypot(x - c.x, z - c.z) < R) BL[(z + M0) * NB + x + M0] = 1;
      }
    }
    if (lv && lv.lairPos) { const R = (lv.R || 15.4) + 6; for (let z = Math.floor(lv.lairPos.z - R); z <= lv.lairPos.z + R; z++) for (let x = Math.floor(lv.lairPos.x - R); x <= lv.lairPos.x + R; x++)
      if (Math.abs(x) <= M0 && Math.abs(z) <= M0 && Math.hypot(x - lv.lairPos.x, z - lv.lairPos.z) < R) BL[(z + M0) * NB + x + M0] = 1; }
    return { colliders: nc };
  };
  const blocked = (x, z) => { const i = Math.round(x) + M0, j = Math.round(z) + M0; return i < 0 || j < 0 || i >= NB || j >= NB || BL[j * NB + i] === 1; };
  // a line's corridor clear of the mask (his body, +-1.3 u) AND of every collider the lens's boom could meet: game.js clearCamDistance
  // pulls the boom in (a fast spring) at any rock / prop / wreck / vent sphere within its radius + 0.8 of the boom's line: a boulder
  // beside the line steps the lens as the hill does, and would be read as the ground's.
  // The boom runs ~6 u behind him and up to ~4.5 u over the floor: so no sphere within r + 3.6 u of the line, extended 9 u past each
  // end, that stands anywhere from the floor - 0.5 to 7 u over it
  RW.clean = (a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz), nx = -dz / l, nz = dx / l;
    for (let t = 0; t <= l; t += 0.5) for (const o of [-1.3, 0, 1.3]) if (blocked(a[0] + dx * t / l + nx * o, a[1] + dz * t / l + nz * o)) return false;
    const cols = [].concat(FL.rockColliders, PR.propColliders, WR.wreckColliders, VE ? VE.ventColliders : []);
    for (let t = -9; t <= l + 9; t += 1) { const x = a[0] + dx * t / l, z = a[1] + dz * t / l, fl = TH(x, z);
      for (const c of cols) { if (!(c && c.r > 0)) continue; if (Math.abs(c.x - x) > c.r + 3.6 || Math.abs(c.z - z) > c.r + 3.6) continue;
        if (Math.hypot(c.x - x, c.z - z) < c.r + 3.6 && c.y - c.r < fl + 7 && c.y + c.r > fl - 0.5) return false; } }
    return true; };
  // ROUTE: Dijkstra over the 1 u grid, 8 neighbours, a step of up to 50 deg; a step steeper than 30 deg costs extra
  RW.route = (sx, sz, goal, tx, tz) => {
    const idx = (x, z) => (z + M0) * NB + x + M0, n = NB * NB, cost = new Float32Array(n).fill(1e30), from = new Int32Array(n).fill(-1), done = new Uint8Array(n);
    const heap = []; const push = (c, k) => { heap.push([c, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { let l = 2 * i + 1, r = l + 1, m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    sx = Math.round(sx); sz = Math.round(sz);
    if (BL[idx(sx, sz)]) { let bd = 1e9, bx = sx, bz = sz; for (let z = sz - 12; z <= sz + 12; z++) for (let x = sx - 12; x <= sx + 12; x++) if (!BL[idx(x, z)] && Math.hypot(x - sx, z - sz) < bd) { bd = Math.hypot(x - sx, z - sz); bx = x; bz = z; } sx = bx; sz = bz; }
    const s0 = idx(sx, sz); cost[s0] = 0; push(0, s0); let hit = -1, reached = 0, nd = 1e9, nx = sx, nz = sz;
    while (heap.length) {
      const [c, k] = pop(); if (done[k]) continue; done[k] = 1;
      const i = k % NB - M0, j = ((k / NB) | 0) - M0; reached++;
      if (tx !== undefined) { const dd = Math.hypot(i - tx, j - tz); if (dd < nd) { nd = dd; nx = i; nz = j; } }
      if (goal(i, j)) { hit = k; break; }
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue; const ii = i + dx, jj = j + dz; if (Math.abs(ii) > M0 || Math.abs(jj) > M0) continue;
        const kk = idx(ii, jj); if (done[kk] || BL[kk]) continue;
        const run = dx && dz ? Math.SQRT2 : 1, sl = Math.atan(Math.abs(HG[kk] - HG[k]) / run) * D; if (sl > 50) continue;
        const nc = c + run * (1 + (sl > 30 ? 3 * ((sl - 30) / 10) * ((sl - 30) / 10) : 0)); if (nc < cost[kk]) { cost[kk] = nc; from[kk] = k; push(nc, kk); }
      }
    }
    if (hit < 0) return { err: 'no route', start: [sx, sz], startBlocked: !!BL[s0], reached, nearest: [nx, nz], nearestD: +nd.toFixed(1) };
    const cells = []; for (let k = hit; k >= 0; k = from[k]) cells.push([k % NB - M0, ((k / NB) | 0) - M0]); cells.reverse();
    // string-pull: the longest line of sight (0.5 u samples clear of the mask, no step over 45 deg) from each kept point
    const los = (a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz); let py = TH(a[0], a[1]);
      for (let t = 0.5; t <= l; t += 0.5) { const x = a[0] + dx * t / l, z = a[1] + dz * t / l; if (blocked(x, z)) return false; const y = TH(x, z); if (Math.atan(Math.abs(y - py) / 0.5) * D > 45) return false; py = y; } return true; };
    const pts = [cells[0]]; let i = 0;
    while (i < cells.length - 1) { let j = cells.length - 1; while (j > i + 1 && !los(cells[i], cells[j])) j--; pts.push(cells[j]); i = j; }
    let len = 0; for (let q = 1; q < pts.length; q++) len += Math.hypot(pts[q][0] - pts[q - 1][0], pts[q][1] - pts[q - 1][1]);
    return { pts, len, cells: cells.length, start: [sx, sz] };
  };
  // THE WALL-FOOT CONTROL's spot: ground he can stand on (under 41 deg) with a face behind him that rises 3.6+ u within 2.6 u (over 54 deg
  // there), away from every collider the boom could meet: the lens (the boom's 2.2 u minimum) is then in the rock unless the
  // floor clamp lifts it. The biggest rise wins (the rim wall's foot, r ~ 220-235: nothing inside the disc is that steep).
  // A control, not a walk: the walks never meet a face that steep behind them.
  RW.wallSpot = () => {
    const cols = [].concat(FL.rockColliders, PR.propColliders, WR.wreckColliders, VE ? VE.ventColliders : []); let best = null;
    for (let z = -238; z <= 238; z++) for (let x = -238; x <= 238; x++) {
      if (x * x + z * z > 238 * 238 || blocked(x, z)) continue;
      const h0 = TH(x, z); if (T.terrainNormal(x, z, 0).y < 0.75) continue;
      for (let a = 0; a < 16; a++) { const fx = Math.sin(a * Math.PI / 8), fz = Math.cos(a * Math.PI / 8), rise = TH(x - fx * 2.6, z - fz * 2.6) - h0;
        if (rise > 3.6 && (!best || rise > best.rise) && !blocked(x + fx * 6, z + fz * 6) && T.terrainNormal(x + fx * 4, z + fz * 4, 0).y > 0.62
          && !cols.some(c => Math.hypot(c.x - x, c.z - z) < c.r + 10)) best = { x, z, fx, fz, rise: +rise.toFixed(2), h: h0 }; } }
    return best;
  };
  // THE WALKER. One rAF loop, always on; a run books once per SIM frame (the change in leash.clock; a tick without one is a
  // skipped frame, counted). Steering is the mouse's job: yaw eases toward a point 'look' u ahead on the line at 'rate' rad/s (no
  // jumps), pitch is held; W is the real key the probe presses.
  const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  const tick = now => {
    requestAnimationFrame(tick);
    const R = RW.run; if (!R || R.done) return;
    R.ticks++;
    const clk = L.clock; if (!(clk > R.lastClk + 1e-9)) { R.skips++; return; }
    const dt = clk - R.lastClk; R.lastClk = clk; const raf = R.lastRaf ? now - R.lastRaf : 0; R.lastRaf = now; R.t = clk - R.clk0;
    const px = P.pos.x, pz = P.pos.z, pts = R.pts;
    // progress: the nearest point on the next few legs; monotone
    let bk = R.seg, bd = 1e30, bs = R.prog;
    for (let k = R.seg; k < Math.min(pts.length - 1, R.seg + 6); k++) {
      const ax = pts[k][0], az = pts[k][1], vx = pts[k + 1][0] - ax, vz = pts[k + 1][1] - az, l2 = vx * vx + vz * vz;
      const u = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / l2)) : 0, d = Math.hypot(px - ax - vx * u, pz - az - vz * u);
      if (d < bd) { bd = d; bk = k; bs = R.cum[k] + u * Math.sqrt(l2); }
    }
    R.seg = bk; R.prog = Math.max(R.prog, bs); R.off = Math.max(R.off, bd);
    const o = R.o, rem = R.total - R.prog;
    if (o.target) { const dT = Math.hypot(px - o.target[0], pz - o.target[1]); if (dT < R.minTo) R.minTo = dT; }
    if (o.pushT && R.minTo <= ${ARRIVE_R}) { if (R.pushT0 === undefined) R.pushT0 = R.t; else if (R.t - R.pushT0 > o.pushT) { R.done = true; R.why = 'pushed'; } }   // past20: pushT s on from the binding point, then stop
    if (rem < o.stopAt && !o.noStop && !R.hold) { R.done = true; R.why = 'arrived'; }
    // steer toward the point 'look' u ahead of the progress
    let ta = Math.min(R.total, R.prog + o.look), k = 0; while (k < R.cum.length - 2 && R.cum[k + 1] < ta) k++;
    const l = R.cum[k + 1] - R.cum[k], u = l > 0 ? (ta - R.cum[k]) / l : 0, tx = pts[k][0] + (pts[k + 1][0] - pts[k][0]) * u, tz = pts[k][1] + (pts[k + 1][1] - pts[k][1]) * u;
    if (!R.done || o.noStop) { const want = Math.atan2(tx - px, tz - pz), d = wrap(want - P.yaw), st = Math.max(-o.rate * dt, Math.min(o.rate * dt, d)); P.yaw += st; }
    P.pitch = o.pitch;
    // the book
    const nrm = T.terrainNormal(px, pz, 0), slS = Math.acos(Math.min(1, nrm.y)) * D, cp = cam.position;
    const f = R.f; f.dt.push(dt); f.raf.push(raf); f.x.push(px); f.z.push(pz); f.sl.push(slS); f.gr.push(P.grounded ? 1 : 0);
    const clr = cp.y - T.shutFloorY(cp.x, cp.z, 0); f.clr.push(clr); f.bm.push(Math.hypot(cp.x - px, cp.y - P.pos.y, cp.z - pz)); f.pg.push(R.prog); f.cr.push(cp.x - px, cp.y - P.pos.y, cp.z - pz); f.py.push(P.pos.y);   // bm: the boom, lens to his centre
    if (R.pc) { f.cst.push(Math.hypot(cp.x - R.pc[0], cp.y - R.pc[1], cp.z - R.pc[2]) / dt);
      f.crl.push(Math.hypot((cp.x - px) - (R.pc[0] - R.pp[0]), (cp.y - P.pos.y) - (R.pc[1] - R.pp[1]), (cp.z - pz) - (R.pc[2] - R.pp[2])) / dt); }
    else { f.cst.push(0); f.crl.push(0); }   // frame 0 has no step: every per-frame array is indexed alike
    R.pc = [cp.x, cp.y, cp.z]; R.pp = [px, P.pos.y, pz];
    for (let i = 0; i < 2; i++) { const ft = window.__fts[i]; if (!ft.planted) continue;
      if (ft.deck || P.onDeck) { R.ex.deck++; continue; } if (!P.grounded) { R.ex.air++; continue; } if (P.stagger > 0) { R.ex.stag++; continue; }
      const g = ft.wlo - TH(ft.wx, ft.wz), nn = T.terrainNormal(ft.wx, ft.wz, 0);
      R.feet.gap.push(g); R.feet.own.push(own(i)); R.feet.sl.push(Math.acos(Math.min(1, nn.y)) * D); R.feet.who.push(i); }
    // progress: a 2 s window of him moving under 0.5 u, off the ground steeper than 52 deg
    R.ring.push([clk, px, pz]); while (R.ring.length > 2 && R.ring[1][0] <= clk - ${STALL_WIN}) R.ring.shift();
    if (clk - R.ring[0][0] >= ${STALL_WIN} - 1e-6 && R.t - R.tGo >= ${STALL_WIN} && !R.done && !R.hold) {
      const mv = Math.hypot(px - R.ring[0][1], pz - R.ring[0][2]);
      if (mv < ${STALL_MIN} && slS <= ${STALL_DEG}) { R.stall.n++; R.stall.run++; if (!R.stall.first) R.stall.first = { t: +R.t.toFixed(2), x: +px.toFixed(1), z: +pz.toFixed(1), slope: +slS.toFixed(1), moved: +mv.toFixed(2), prog: +R.prog.toFixed(1) }; }
      else R.stall.run = 0;
    }
    // the hose
    if (L.r > R.maxR) R.maxR = L.r; if (L.state !== 'slack') R.nGive++; if (L.state === 'hold') R.nHold++;
    if (o.stopOnYank && L.n > R.n0) { R.done = true; R.why = 'yank'; }
    if (R.t - R.tGo > o.maxT) { R.done = true; R.why = 'timeout'; }
    if (R.stall.run > 180) { R.done = true; R.why = 'stalled'; }
  };
  requestAnimationFrame(tick);
  RW.begin = o => {
    const pts = o.pts, cum = [0]; for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
    RW.run = { o, pts, cum, total: cum[cum.length - 1], prog: 0, seg: 0, off: 0, done: false, why: '', t: 0, ticks: 0, skips: 0, clk0: L.clock, lastClk: L.clock, lastRaf: 0, pc: null, pp: null,
      f: { dt: [], raf: [], clr: [], cst: [], crl: [], bm: [], pg: [], cr: [], py: [], sl: [], gr: [], x: [], z: [] }, feet: { gap: [], own: [], sl: [], who: [] }, ex: { deck: 0, air: 0, stag: 0 }, ring: [], stall: { n: 0, run: 0, first: null },
      maxR: 0, nGive: 0, nHold: 0, n0: L.n, minTo: 1e9, hold: !!o.hold, tGo: 0, walkIdx: 0 };
    P.pitch = o.pitch; return 1;
  };
  // go(): the settle is over, the walk is on: the frames from here are the walk's (the ones before are the lens settling after the place)
  RW.go = () => { const R = RW.run; R.hold = false; R.tGo = R.t; R.walkIdx = R.f.dt.length; R.ring = []; return R.walkIdx; };
  RW.status = () => { const R = RW.run; return R ? { done: R.done, why: R.why, prog: +R.prog.toFixed(1), total: +R.total.toFixed(1), t: +R.t.toFixed(1), ticks: R.ticks, skips: R.skips, stall: R.stall.n, off: +R.off.toFixed(2), n: L.n } : null; };
  RW.end = () => { const R = RW.run; RW.run = null; if (!R) return null; R.f.sl = R.f.sl.map(v => +v.toFixed(2)); R.f.bm = R.f.bm.map(v => +v.toFixed(3)); R.f.pg = R.f.pg.map(v => +v.toFixed(2)); R.f.cr = R.f.cr.map(v => +v.toFixed(2)); R.f.py = R.f.py.map(v => +v.toFixed(2)); return { f: R.f, walkIdx: R.walkIdx, tGo: R.tGo, feet: R.feet, ex: R.ex, why: R.why, total: R.total, prog: R.prog, t: R.t, ticks: R.ticks, skips: R.skips, stall: R.stall, off: R.off, maxR: R.maxR, nGive: R.nGive, nHold: R.nHold, minTo: R.minTo }; };
  RW.nav = () => ({ x: P.pos.x, y: P.pos.y, z: P.pos.z, vy: P.vel.y, grounded: !!P.grounded, onDeck: !!P.onDeck, yaw: P.yaw, stagger: P.stagger || 0, state: window.gameState, dead: window.gameState === 'dead' });
  RW.leash = () => ({ state: L.state, r: +L.r.toFixed(2), give: +L.give.toFixed(3), n: L.n, last: { ...L.last }, maxIn: +L.maxIn.toFixed(3), maxEnd: +L.maxEnd.toFixed(3), clock: +L.clock.toFixed(2), hose: window.survival.hose });
  RW.survival = () => ({ oxygen: +window.survival.oxygen.toFixed(3), fuel: +window.survival.fuel.toFixed(3), torn: +window.survival.torn.toFixed(2), strain: +window.survival.strain.toFixed(2) });
  return 1;
})()`;

if (process.env.RW_DUMPLIB) { writeFileSync(process.env.RW_DUMPLIB, 'const lib = ' + LIB + ';\n'); process.exit(0); }   // dev: the page library as a file, for node --check (it is a string to node)
// ---- boot: about:blank, the domains on, the focus a player's window has, then the game ----
await start('about:blank');
const c = await connect();
await c.send('Runtime.enable'); await c.send('Log.enable'); await c.send('Page.enable');
await c.send('Emulation.setFocusEmulationEnabled', { enabled: true });
const URL0 = `http://localhost:${PORT}/?bench`, tNav = Date.now();
await c.send('Page.navigate', { url: URL0 });
await c.until(`!document.getElementById('load') && typeof window.setState === 'function' && !!window.__bench && !!window.__leash && !!window.lev && !!window.__fts`, 300000, 500);
console.log(`relief-walk ${MODE}${RED ? ' RED ' + RED : ''} ${URL0} (fresh profile, focus emulated): loaded in ${((Date.now() - tNav) / 1000).toFixed(1)} s`);
await c.ev(`(window.start && window.gameState === 'title' && window.start(), window.setState('play'), window.__helm = true, 1)`);
await sleep(1000);
await c.ev(LIB);
const TAG = await c.ev(`(typeof window.__relief === 'object' && !!window.__relief && !!window.__relief.rows && !!window.__relief.rows()) ? 'relief' : 'main'`);
const FPS = await c.ev(`({ cap: window.__power.state().cap, focus: document.hasFocus(), hidden: document.hidden, state: window.gameState, site: window.__chart.site(), zone: window.zone })`);
console.log(`build: ${TAG}; governor cap ${FPS.cap} fps, focus ${FPS.focus}, hidden ${FPS.hidden}, state ${FPS.state}, site ${FPS.site}, zone ${FPS.zone}`);
if (FPS.cap < 55 || !FPS.focus || FPS.hidden || FPS.state !== 'play') { console.error('the loop is not the shipped 60 fps play loop: ' + JSON.stringify(FPS)); process.exit(2); }
if (FPS.site !== 0 || FPS.zone !== 0) { console.error('the page is not at home zone 0'); process.exit(2); }

// ---- the lines ----
const bedAt = await c.ev(`({ x: window.lev.lairPos.x, z: window.lev.lairPos.z, R: window.lev.R, dormant: !!window.lev.dormant, kind: window.lev.kind })`);
let plan = null, cands;
if (MODE === 'hose' && TAG !== 'relief') { console.error('hose: the binding point is the relief replica\'s (gates.mjs --json); main has none'); process.exit(2); }
if (TAG === 'relief') { plan = await replicaPlan(MODE !== 'hose'); cands = plan.riser ? { riser: plan.riser, upland: plan.upland, steep: plan.steep } : null;
  console.log(`replica: ${plan.cand ? plan.cand.riser + ' riser-band, ' + plan.cand.upland + ' upland and ' + plan.cand.steep + ' steep-riser (35-45 deg) candidate centres; ' : ''}her bed ${JSON.stringify(plan.bed)} (live ${bedAt.x.toFixed(1)}, ${bedAt.z.toFixed(1)}); hose.at ${JSON.stringify(plan.hose.at)} spare ${plan.hose.spare}`);
  if (Math.hypot(plan.bed[0] - bedAt.x, plan.bed[1] - bedAt.z) > 0.5) fail.push(`the live bed (${bedAt.x.toFixed(1)}, ${bedAt.z.toFixed(1)}) is not the replica's ${JSON.stringify(plan.bed)}`);
} else if (MODE !== 'hose') {
  const rk = await c.ev(`window.__rw.rankMain(${JSON.stringify({ seg: SEG / 2, R: RANK_R, keep: 150, sep: SEP, band: [20, 35] })})`);
  const rs = await c.ev(`window.__rw.rankMain(${JSON.stringify({ seg: SEG / 2, R: RANK_R, keep: 150, sep: SEP, band: [35, 45] })})`);
  cands = { A: rk.picks, B: rk.picks, S: rs.picks }; console.log(`main: ${rk.cand} candidate centres in the 20-35 deg band and ${rs.cand} in 35-45 (r <= 200, off the apron), ${rk.picks.length} / ${rs.picks.length} distinct lines`);
}
const blk = await c.ev(`window.__rw.block()`);
console.log(`blocked mask: ${blk.colliders} colliders (rocks, props, wrecks, vents), her body's disc, the apron, the wall-foot clamp`);
const lines = [];   // { name, pts: [lo, hi] or a route, kind: 'line'|'route', info }
const pickClean = async (list, not) => { for (const p of list) { if (not && Math.hypot(p.centre[0] - not.centre[0], p.centre[1] - not.centre[1]) < 60) continue;
    if (await c.ev(`window.__rw.clean(${JSON.stringify(p.lo)}, ${JSON.stringify(p.hi)})`)) return p; } return null; };
const names = MODE === 'hose' ? [] : TAG === 'relief' ? ['riser', 'upland', 'steep'] : ['A', 'B', 'S'];
let first = null;
for (const nm of names) {
  const p = await pickClean(cands[nm], nm === 'B' ? first : null);
  if (!p) { fail.push(`no clean ${nm} line among ${cands[nm].length} candidates`); continue; }
  console.log(`${nm}: the ${cands[nm].indexOf(p) + 1}th ranked candidate is the first clean one (of ${cands[nm].length})`);
  if (nm === 'A') first = p;
  const y = await c.ev(`[window.__rw.h(${p.lo[0]}, ${p.lo[1]}), window.__rw.h(${p.hi[0]}, ${p.hi[1]})]`);
  lines.push({ name: nm, kind: 'line', pts: [p.lo, p.hi], info: { centre: p.centre.map(v => +v.toFixed(1)), inBand: p.n + '/' + (2 * (SEG / 2) + 1), meanDeg: p.mean, maxDeg: p.max, centreDeg: p.s, rise: +(y[1] - y[0]).toFixed(1) } });
}
if (MODE !== 'hose') {   // the raft column -> her bed: from the column's free cell nearest the ladder's foot to 26 u from her centre
  const r = await c.ev(`window.__rw.route(5, 0, (x, z) => Math.hypot(x - ${bedAt.x}, z - ${bedAt.z}) <= ${BED_STOP}, ${bedAt.x}, ${bedAt.z})`);
  if (r.err) fail.push('no route from the raft column to her bed: ' + JSON.stringify(r));
  else lines.push({ name: 'bed', kind: 'route', pts: r.pts, info: { legs: r.pts.length - 1, len: +r.len.toFixed(1), from: r.pts[0], to: r.pts[r.pts.length - 1], dBed: +Math.hypot(r.pts[r.pts.length - 1][0] - bedAt.x, r.pts[r.pts.length - 1][1] - bedAt.z).toFixed(1) } });
}
for (const L of lines) console.log(`line ${pad(L.name, 6)} ${L.kind}: ${JSON.stringify(L.info)}`);
if (process.env.RW_STOP === 'lines') { console.log(fail.length ? 'FAIL ' + JSON.stringify(fail) : 'lines ok'); c.close(); stop(); process.exit(0); }   // dev: the lines, no walk

// ---- the walker ----
const yawOf = (a, b) => Math.atan2(b[0] - a[0], b[1] - a[1]);
async function walkOnce(L, dir, rep, o = {}) {
  const pts = dir === 'rev' ? L.pts.slice().reverse() : L.pts.slice();
  await c.ev(`(window.__rw.run = null, window.__bench.place(${pts[0][0]}, ${pts[0][1]}, ${yawOf(pts[0], pts[1])}, 0), window.player.pitch = ${o.pitch === undefined ? -0.1 : o.pitch}, window.survival.hose = ${o.hose || 5000}, window.survival.fuel = 1, window.survival.oxygen = 1, 1)`);   // fuel: the pump burns 1/420 per second down the line, so a long run's pump stops, he drowns and is hauled (measured: a bed walk at ~440 s of play thrown 36 u and 10 s airborne on both builds)
  if (!o.hold) await sleep(2600);   // stood, the lens settled behind him (a place snaps it: ~150 frames)
  const total = pts.reduce((s, p, k) => k ? s + Math.hypot(p[0] - pts[k - 1][0], p[1] - pts[k - 1][1]) : 0, 0);
  const D0 = await c.ev(`window.__rw.leash()`);
  const maxT = o.maxT || Math.max(60, total / 0.5 + 30);
  await c.ev(`window.__rw.begin(${JSON.stringify({ pts, look: o.look || 4, rate: o.rate || 1.4, pitch: o.pitch === undefined ? -0.1 : o.pitch, stopAt: o.stopAt === undefined ? 1.2 : o.stopAt, maxT, stopOnYank: !!o.stopOnYank, noStop: !!o.noStop, hold: !!o.hold })})`);
  if (o.hold) { await sleep(2600); await c.ev(`window.__rw.go()`); }   // the lens books its settle too: the first pull-in of the boom is an event
  if (!o.stand) await c.key('KeyW', true);
  const t0 = Date.now(); let st;
  for (;;) { await sleep(250); st = await c.ev(`window.__rw.status()`); if (st.done || Date.now() - t0 > (maxT + 20) * 1000) break; }
  if (!o.stand) await c.key('KeyW', false);
  const R = await c.ev(`window.__rw.end()`);
  R.line = L.name; R.dir = dir; R.rep = rep; R.fromLeash = D0; R.leashEnd = await c.ev(`window.__rw.leash()`); R.surv = await c.ev(`window.__rw.survival()`); R.nav = await c.ev(`window.__rw.nav()`);
  const dts = R.f.dt, n = dts.length;
  console.log(`  ${pad(L.name, 6)} ${pad(dir === 'rev' ? 'rev' : 'fwd', 3)} #${rep}: ${R.why}, ${f1(R.t - R.tGo)} s, ${f1(R.prog)}/${f1(R.total)} u, ${n} sim frames (dt p50 ${f1(pct(dts, 0.5) * 1000)} ms, max ${f1(Math.max(...dts) * 1000)} ms, ${dts.filter(d => d > 0.0499).length} at the 50 ms clamp, ${R.skips} skipped rAF), ` +
    `${R.feet.gap.length} planted-boot samples (excl ${R.ex.deck + R.ex.air + R.ex.stag}), stall ${R.stall.n}, off the line <= ${f2(R.off)} u`);
  return R;
}
// the sea is not empty: a shark's bump or a moray's strike mid-walk throws him off his line (measured on main's bed route: 36 u off, 578 airborne
// frames, a 14852 u/s lens step), and a creature in the way stalls him. Such a run is not a reading of the ground: it is run again (twice at most),
// and a run that stays disturbed is kept, flagged, and fails the walk's progress verdict
async function walk(L, dir, rep, o = {}) {
  let R;
  for (let attempt = 1; attempt <= 3; attempt++) {
    R = await walkOnce(L, dir, rep, o); R.attempt = attempt;
    const why = o.stand ? [] : [R.off > 5 && `${f1(R.off)} u off the line`, R.ex.air > 30 && `${R.ex.air} airborne planted-boot frames`, R.ex.stag > 0 && `${R.ex.stag} staggered frames`, R.surv.torn > 0 && `torn ${R.surv.torn}`, R.surv.oxygen < 0.5 && `oxygen ${R.surv.oxygen}`, R.stall.n > 0 && `stalled ${R.stall.n} frames`, R.why !== 'arrived' && `ended '${R.why}'`].filter(Boolean);
    R.disturbed = why;
    if (!why.length) break;
    console.log(`    disturbed (${why.join(', ')}); ${attempt < 3 ? 'run again' : 'kept'}`);
  }
  return R;
}
const tables = {};
const frameTimes = rs => { const dt = rs.flatMap(r => r.f.dt), raf = rs.flatMap(r => r.f.raf).filter(v => v > 0); return { frames: dt.length, dtP50ms: +f2(pct(dt, 0.5) * 1000), dtP95ms: +f2(pct(dt, 0.95) * 1000), dtMaxMs: +f2(Math.max(...dt) * 1000), over50ms: dt.filter(d => d > 0.0499).length, rafP50ms: +f2(pct(raf, 0.5)), rafMaxMs: +f2(Math.max(...raf)), skippedTicks: rs.reduce((s, r) => s + r.skips, 0) }; };
const STEEP = n => n === 'steep' || n === 'S';   // the 35-45 deg line: Review Focus 4's riser. Walked and booked everywhere; the boots' gap and the lens's step are only REPORTED on it (steeper than 35 is not gated), its lens clearance is gated
const progressVerdict = (rs) => { for (const r of rs) {
  if (r.stall.n > 0) fail.push(`${r.line} ${r.dir} #${r.rep}: ${r.stall.n} frames in 2 s windows under ${STALL_MIN} u moved (first ${JSON.stringify(r.stall.first)})`);
  if (r.why !== 'arrived') fail.push(`${r.line} ${r.dir} #${r.rep}: the walk ended '${r.why}' at ${f1(r.prog)}/${f1(r.total)} u`);
  if (r.nav.dead || r.surv.torn > 0) fail.push(`${r.line} ${r.dir} #${r.rep}: disturbed (state ${r.nav.state}, torn ${r.surv.torn}): a bite is not a gait reading`);
  if (r.attempt > 1) console.log(`  (${r.line} ${r.dir} #${r.rep} took ${r.attempt} attempts)`); } };
const lonely = async () => { const d = await c.ev(`!!window.lev.dormant`); if (!d) fail.push('her lev.dormant is false after the walks (a walk woke her)'); return d; };
let result = { mode: MODE, tag: TAG, red: RED || null, port: PORT };

if (process.env.RW_ONLY === 'wall') lines.length = 0;   // dev: the wall-foot control alone (lens)
if (MODE === 'boots' || MODE === 'lens') {
  const runs = [];
  for (const L of lines) for (let rep = 1; rep <= REPS; rep++) for (const dir of (MODE === 'lens' ? ['rev'] : ['fwd', 'rev'])) {
    // a line's pts run lo -> hi (a route: raft -> bed); 'fwd' walks them as listed, 'rev' backwards. For the straight lines lo is
    // the foot, so 'fwd' is UP and 'rev' is DOWN, the riser behind him; the route's 'fwd' (raft -> bed) is its way down into the hollow
    const d = L.kind === 'route' && MODE === 'lens' ? 'fwd' : dir;
    if (MODE === 'lens' && RED === 'nofloor') await c.ev(`(window.__camNoFloor = true, 1)`);
    if (MODE === 'boots' && RED === 'noslope') await c.ev(`(window.__sal.slope = false, 1)`);
    runs.push(await walk(L, d, rep, { hold: MODE === 'lens' }));
    if (MODE === 'lens' && rep === REPS) runs.push(await walk({ ...L, name: L.name + '/up' }, d, 1, { pitch: UP_PITCH, hold: true }));   // once per line, looking up
  }
  tables.frames = frameTimes(runs); result.frameTimes = tables.frames;
  console.log('frame times (live loop, ruling 42: no __bench.step, no hold, no clock leak):', JSON.stringify(tables.frames));
  progressVerdict(runs);
  tables.dormant = await lonely();
  let wall = null;
  if (MODE === 'lens') {   // the wall-foot control: he stands 2 s with a 54+ deg face 2.6 u behind him; clearance with the floor clamp on (bar 0.3), off under RED
    const sp = await c.ev(`window.__rw.wallSpot()`);
    if (!sp) fail.push('no wall-foot spot found for the clearance control');
    else {
      const to = [sp.x + sp.fx * 4, sp.z + sp.fz * 4]; if (RED === 'nofloor') await c.ev(`(window.__camNoFloor = true, 1)`);
      wall = { spot: [+sp.x.toFixed(1), +sp.z.toFixed(1)], rise: sp.rise };
      for (const [nm, pitch] of [['level', -0.1], ['up', UP_PITCH]]) {
        const R = await walk({ name: 'wall-' + nm, pts: [[sp.x, sp.z], to] }, 'fwd', 1, { stand: true, maxT: 3, stopAt: -1, noStop: true, pitch });
        const clr = R.f.clr; wall[nm] = { pitch, frames: clr.length, minClr: +f3(Math.min(...clr)), below: clr.filter(v => v < CLEAR_BAR).length, boomMin: +f2(Math.min(...R.f.bm)) };
        console.log(`WALL-FOOT CONTROL ${nm} (${TAG}${RED ? ', RED ' + RED : ''}): stood at (${wall.spot}), pitch ${pitch}, ground ${wall.rise} u higher 2.6 u behind him: ${clr.length} frames, the lens's lowest clearance ${wall[nm].minClr} u (bar ${CLEAR_BAR}), ${wall[nm].below} frames under it, the boom ${wall[nm].boomMin} u at its shortest`);
        if (clr.length < 100) bad('vacuous', `the wall-foot control (${nm}) booked ${clr.length} frames`);
        if (wall[nm].below > 0) bad('clearance', `wall-foot control (${nm}): the lens was under ${CLEAR_BAR} u over the floor on ${wall[nm].below} of ${clr.length} frames (lowest ${wall[nm].minClr} u)`);
      }
    }
  }
  if (MODE === 'boots') {
    // two readings of one frame. OWN (gated): the lowest sole point over ITS OWN ground (the drawn sole's heel / ball / toe points, each
    // over terrainH at its own x, z). BRIEF: __fts[i].wlo - terrainH(wx, wz), the plan's formula: wlo is the lowest sole point's height but
    // (wx, wz) is the CONTACT point, a heel's or ball's length (0.16-0.3 u) away, so on a grade a sole lying exactly on the hill reads
    // |gap| = d x tan(slope), a bias that grows with the very slope under test (~0.10 u at 33 deg). It is booked beside OWN, not gated.
    const rd = (r, k, w) => w === 'own' ? r.feet.own[k] : r.feet.gap[k];
    const stat = a => ({ n: a.length, p50: pct(a.map(Math.abs), 0.5), p95: pct(a.map(Math.abs), 0.95), max: a.length ? Math.max(...a.map(Math.abs)) : NaN, sink: a.length ? Math.min(...a) : NaN, float: a.length ? Math.max(...a) : NaN });
    const sel = (rs, w, pred) => { const o = []; for (const r of rs) for (let k = 0; k < r.feet.gap.length; k++) if (pred(r.feet.sl[k])) o.push(rd(r, k, w)); return o; };
    const byLine = {};
    console.log(`\nBOOTS (${TAG}, port ${PORT}${RED ? ', RED ' + RED : ''}): the planted boot's gap to the ground, u (- sinks, + hangs); OWN = the sole's lowest point over its own ground (gated), BRIEF = wlo - terrainH(contact) (booked)`);
    console.log(pad('line', 7) + lpad('runs', 5) + lpad('samples', 9) + '  | ' + lpad('<=35 n', 7) + lpad('p50|g|', 8) + lpad('p95|g|', 8) + lpad('max|g|', 8) + lpad('sink', 8) + lpad('hang', 8) + lpad('BRIEF p95', 11) + '  | ' + lpad('>35 n', 7) + lpad('p95|g|', 8) + lpad('sink', 8) + lpad('share', 7) + '  verdict');
    for (const L of lines) {
      const rs = runs.filter(r => r.line === L.name), lo = sel(rs, 'own', v => v <= GAP_DEG), hi = sel(rs, 'own', v => v > GAP_DEG), bl = sel(rs, 'brief', v => v <= GAP_DEG);
      const a = stat(lo), b = stat(hi), bp = stat(bl), ok = STEEP(L.name) || (lo.length >= MIN_FRAMES && a.p95 <= GAP_BAR);
      byLine[L.name] = { runs: rs.length, samples: lo.length + hi.length, le35: lo.length ? { n: a.n, p50: +f3(a.p50), p95: +f3(a.p95), max: +f3(a.max), sink: +f3(a.sink), hang: +f3(a.float), briefP95: +f3(bp.p95) } : null, gt35: hi.length ? { n: b.n, p95: +f3(b.p95), max: +f3(b.max), sink: +f3(b.sink) } : null, pass: ok };
      console.log(pad(L.name, 7) + lpad(rs.length, 5) + lpad(lo.length + hi.length, 9) + '  | ' + lpad(a.n, 7) + lpad(f3(a.p50), 8) + lpad(f3(a.p95), 8) + lpad(f3(a.max), 8) + lpad(f3(a.sink), 8) + lpad(f3(a.float), 8) + lpad(f3(bp.p95), 11) + '  | ' + lpad(b.n, 7) + lpad(hi.length ? f3(b.p95) : '-', 8) + lpad(hi.length ? f3(b.sink) : '-', 8) + lpad(f1(hi.length / (lo.length + hi.length) * 100) + '%', 7) + '  ' + (STEEP(L.name) ? 'reported' : ok ? 'PASS' : 'FAIL'));
      if (STEEP(L.name)) { }
      else if (lo.length < MIN_FRAMES) bad('vacuous', `${L.name}: only ${lo.length} planted-boot samples on <= ${GAP_DEG} deg ground (need ${MIN_FRAMES}: a vacuous line)`);
      else if (a.p95 > GAP_BAR) bad('gap', `${L.name}: p95 |gap| ${f3(a.p95)} u on <= ${GAP_DEG} deg ground (bar ${GAP_BAR})`);
    }
    // per 5 deg bin of the ground's slope at the boot, both readings
    const binOf = v => Math.min(65, Math.floor(v / 5) * 5), keys = new Set();
    for (const r of runs) for (const v of r.feet.sl) keys.add(binOf(v));
    console.log(`\nper 5 deg bin of the ground's slope at the boot (all lines, both ways); ${GAP_DEG} deg is the gate's edge, steeper is reported, not gated (the rig clamps the sole's pitch at 35.5 deg)`);
    console.log(pad('bin', 9) + lpad('n', 7) + lpad('p50|g|', 8) + lpad('p95|g|', 8) + lpad('max|g|', 8) + lpad('sink', 8) + lpad('hang', 8) + lpad('>0.15', 7) + lpad('BRIEF p50', 11) + lpad('BRIEF p95', 11) + lpad('BRIEF sink', 11));
    const binRows = [];
    for (const k of [...keys].sort((p, q) => p - q)) {
      const o = sel(runs, 'own', v => binOf(v) === k), bq = sel(runs, 'brief', v => binOf(v) === k), s1 = stat(o), s2 = stat(bq), over = o.filter(g => Math.abs(g) > GAP_BAR).length;
      binRows.push({ bin: k, n: s1.n, p50: +f3(s1.p50), p95: +f3(s1.p95), max: +f3(s1.max), sink: +f3(s1.sink), hang: +f3(s1.float), over015: over, briefP50: +f3(s2.p50), briefP95: +f3(s2.p95), briefSink: +f3(s2.sink) });
      console.log(pad(k >= 65 ? '65+' : k + '-' + (k + 5), 9) + lpad(s1.n, 7) + lpad(f3(s1.p50), 8) + lpad(f3(s1.p95), 8) + lpad(f3(s1.max), 8) + lpad(f3(s1.sink), 8) + lpad(f3(s1.float), 8) + lpad(over, 7) + lpad(f3(s2.p50), 11) + lpad(f3(s2.p95), 11) + lpad(f3(s2.sink), 11)); }
    // per direction (up the line / down it): the down-slope heel was the rig's known weak side (diver.js groundPitch)
    const dirRows = {};
    for (const dr of ['fwd', 'rev']) { const g = sel(runs.filter(r => r.dir === dr), 'own', v => v <= GAP_DEG); if (g.length) dirRows[dr] = { n: g.length, p95: +f3(pct(g.map(Math.abs), 0.95)) }; }
    console.log('per direction, <= 35 deg, OWN: ' + JSON.stringify(dirRows) + ' (fwd = the lines as listed: straight lines up, the bed route raft -> bed; rev = the other way)');
    const allLo = sel(runs, 'own', v => v <= GAP_DEG), allB = sel(runs, 'brief', v => v <= GAP_DEG);
    result.boots = { byLine, bins: binRows, dir: dirRows, all: { n: allLo.length, p50: +f3(pct(allLo.map(Math.abs), 0.5)), p95: +f3(pct(allLo.map(Math.abs), 0.95)), briefP95: +f3(pct(allB.map(Math.abs), 0.95)) }, excluded: runs.reduce((o, r) => ({ deck: o.deck + r.ex.deck, air: o.air + r.ex.air, stag: o.stag + r.ex.stag }), { deck: 0, air: 0, stag: 0 }) };
    console.log(`pooled <= 35 deg: n ${allLo.length}, OWN p50 |gap| ${f3(pct(allLo.map(Math.abs), 0.5))}, p95 ${f3(pct(allLo.map(Math.abs), 0.95))}; BRIEF p95 ${f3(pct(allB.map(Math.abs), 0.95))}; excluded samples ${JSON.stringify(result.boots.excluded)}`);
  } else {
    // THE LENS. Ruling 48: the step is compared like for like, in two parts. (a) THE SWOOP is an event: game.js starts the boom at its full
    // 9 u at every place and pulls it in (clearCamDistance, eased at 14/s) where its line meets the hill, so each walk has a first pull-in,
    // booked from the place on (the settle too: the lens is booked from the frame after the place, W is pressed 2.6 s later): the boom
    // falling by >= 1 u, its peak frame step (u/s) from its start to 3 frames after it ends (the boom no longer falling). It is in the SETTLE
    // when the hill is already behind him at the line's top (the spring's step response to the place: 14-25 u/s, it varies with the frame the
    // first booking lands on) or in the WALK (the hill meets the boom as he descends: 15.6-16.2 u/s, the spring's own ceiling). Ruling 48's
    // 'first pull-in' is gated where it falls IN THE WALK (a lens event of the descent); the place's is printed as INFO. (b) THE SETTLED WALK:
    // the frames from 2 s after that pull-in has completed (never before W), on both builds alike; no swoop in the walk = the whole walk.
    const SWOOP_DROP = 1.0, SETTLE_AFTER = 2.0;
    const swoopOf = R => {
      const bm = R.f.bm, cst = R.f.cst, n = bm.length, W = R.walkIdx || 0; let tAcc = 0; const tt = R.f.dt.map(d => (tAcc += d));
      for (let k = 1; k < n;) {
        if (bm[k] < bm[k - 1] - 0.02) {
          let ke = k, calm = 0;
          while (ke < n - 1 && calm < 6) { if (bm[ke + 1] < bm[ke] - 0.01) calm = 0; else calm++; ke++; }
          ke -= calm;   // the last frame the boom was still falling
          if (bm[k - 1] - bm[ke] >= SWOOP_DROP) {
            let pk = 0, at = k, rl = 0; for (let j = k; j <= Math.min(n - 1, ke + 3); j++) { if (cst[j] > pk) { pk = cst[j]; at = j; } if (R.f.crl[j] > rl) rl = R.f.crl[j]; }
            return { k0: k, kc: ke, from: bm[k - 1], to: bm[ke], peak: pk, rel: rl, u: R.f.pg[at], where: k < W ? 'place' : 'walk', tC: tt[ke], tWalk: tt[ke] - (W ? tt[W - 1] : 0) };
          }
          k = ke + 1; continue;
        }
        k++;
      }
      return null;
    };
    const settledOf = (R, sw) => { const W = R.walkIdx || 0; let tAcc = 0; const tt = R.f.dt.map(d => (tAcc += d)); let j0 = W;
      if (sw) { const tS = sw.tC + SETTLE_AFTER; while (j0 < tt.length && tt[j0] < tS) j0++; } return R.f.cst.slice(Math.max(1, j0)); };
    const walkOf = (r, key) => r.f[key].slice(Math.max(1, r.walkIdx || 0));   // the walk's own frames (W pressed), as before the settle was booked
    const mainJ = process.env.RW_MAIN ? JSON.parse(readFileSync(process.env.RW_MAIN, 'utf8')).lens : null;
    const rows = {}, linesAll = lines.concat(lines.map(l => ({ ...l, name: l.name + '/up' })));
    console.log(`\nLENS (${TAG}, port ${PORT}${RED ? ', RED ' + RED : ''}): clearance = camera.y - shutFloorY(camera.x, camera.z, 0), every frame from W pressed; step = |d camera| / dt (u/s), rel = against him; walked DOWN; '/up' = looking up (pitch ${UP_PITCH})`);
    console.log(pad('line', 9) + lpad('runs', 5) + lpad('frames', 8) + '  | ' + lpad('min clr', 8) + lpad('p1 clr', 8) + lpad('<0.3', 6) + lpad('settle clr', 11) + lpad('<0.3 settle', 12) + '  | ' + lpad('step p50', 9) + lpad('p95', 7) + lpad('p99', 7) + lpad('max', 7) + '  | ' + lpad('boom p50', 9) + lpad('min', 6) + '  | ' + lpad('slope p50', 10) + lpad('max', 6));
    for (const L of linesAll) {
      const rs = runs.filter(r => r.line === L.name), clr = rs.flatMap(r => walkOf(r, 'clr')), cst = rs.flatMap(r => walkOf(r, 'cst')), sl = rs.flatMap(r => walkOf(r, 'sl')), bm = rs.flatMap(r => walkOf(r, 'bm'));
      const setl = rs.flatMap(r => r.f.clr.slice(0, r.walkIdx || 0)), below = clr.filter(v => v < CLEAR_BAR).length;
      // the settle's own clearance (not gated: the frames between the place and W): the snap puts the lens at its full boom behind him, in the hill
      // where one stands behind the line's top, for the frames before the first update lifts it; counted and dated so it is not hidden
      const setBelow = rs.map(r => { const c = r.f.clr.slice(0, r.walkIdx || 0); let last = -1, n = 0; c.forEach((v, k) => { if (v < CLEAR_BAR) { n++; last = k; } }); return { n, last: last + 1 }; });
      const sws = rs.map(swoopOf), walkSw = sws.filter(w => w && w.where === 'walk'), placeSw = sws.filter(w => w && w.where === 'place');
      const setd = rs.flatMap((r, i) => settledOf(r, sws[i]));
      rows[L.name] = { runs: rs.length, frames: clr.length, minClr: +f3(Math.min(...clr)), p1Clr: +f3(pct(clr, 0.01)), below, settleMinClr: setl.length ? +f3(Math.min(...setl)) : null, settleBelow: Math.max(...setBelow.map(x => x.n)), settleBelowLastFrame: Math.max(...setBelow.map(x => x.last)),
        stepP50: +f2(pct(cst, 0.5)), stepP95: +f2(pct(cst, 0.95)), stepP99: +f2(pct(cst, 0.99)), stepMax: +f2(Math.max(...cst)), boomP50: +f2(pct(bm, 0.5)), boomMin: +f2(Math.min(...bm)), slopeP50: +f1(pct(sl, 0.5)), slopeMax: +f1(Math.max(...sl)),
        swoop: { runs: rs.length, inWalk: walkSw.length, atPlace: placeSw.length, none: sws.filter(w => !w).length,
          peak: walkSw.length + placeSw.length ? +f2(Math.max(...sws.filter(Boolean).map(w => w.peak))) : null, peakMin: walkSw.length + placeSw.length ? +f2(Math.min(...sws.filter(Boolean).map(w => w.peak))) : null,
          peakWalk: walkSw.length ? +f2(Math.max(...walkSw.map(w => w.peak))) : null, peakWalkMin: walkSw.length ? +f2(Math.min(...walkSw.map(w => w.peak))) : null, atU: walkSw.length ? +f1(walkSw[0].u) : null,
          boom: walkSw.length ? [+f1(walkSw[0].from), +f1(walkSw[0].to)] : placeSw.length ? [+f1(placeSw[0].from), +f1(placeSw[0].to)] : null, doneAtS: walkSw.length ? +f1(walkSw[0].tWalk) : null,
          peakPlace: placeSw.length ? +f2(Math.max(...placeSw.map(w => w.peak))) : null },
        settled: { n: setd.length, p50: +f2(pct(setd, 0.5)), p95: +f2(pct(setd, 0.95)), p99: +f2(pct(setd, 0.99)), max: setd.length ? +f2(Math.max(...setd)) : NaN, over6: setd.filter(v => v > 6).length } };
      const r = rows[L.name];
      console.log(pad(L.name, 9) + lpad(rs.length, 5) + lpad(clr.length, 8) + '  | ' + lpad(f3(r.minClr), 8) + lpad(f3(r.p1Clr), 8) + lpad(below, 6) + lpad(r.settleMinClr === null ? '-' : f3(r.settleMinClr), 11) + lpad(r.settleBelow ? r.settleBelow + ' (to #' + r.settleBelowLastFrame + ')' : '0', 12) + '  | ' + lpad(f2(r.stepP50), 9) + lpad(f2(r.stepP95), 7) + lpad(f2(r.stepP99), 7) + lpad(f2(r.stepMax), 7) + '  | ' + lpad(f2(r.boomP50), 9) + lpad(f2(r.boomMin), 6) + '  | ' + lpad(f1(r.slopeP50), 10) + lpad(f1(r.slopeMax), 6));
      if (clr.length < MIN_FRAMES) bad('vacuous', `${L.name}: only ${clr.length} lens frames booked`);
      if (below > 0) bad('clearance', `${L.name}: the lens was under ${CLEAR_BAR} u over the floor on ${below} of ${clr.length} frames (lowest ${f3(r.minClr)} u)`);
    }
    console.log(`\nTHE SWOOP (the boom's first pull-in: a fall of >= ${SWOOP_DROP} u; peak frame step u/s, from its start to 3 frames after it ends) AND THE SETTLED WALK (from ${SETTLE_AFTER} s after it completes)`);
    console.log(pad('line', 9) + lpad('walks', 6) + lpad('in walk', 8) + lpad('at place', 9) + lpad('none', 5) + '  | ' + lpad('boom from-to', 13) + lpad('peak min-max', 14) + lpad('in-walk peak', 13) + lpad('at u', 6) + lpad('done at s', 10) + '  | ' + lpad('settled n', 10) + lpad('p50', 6) + lpad('p95', 7) + lpad('p99', 7) + lpad('max', 7) + lpad('>6 u/s', 8));
    for (const L of linesAll) { const r = rows[L.name], w = r.swoop, st = r.settled;
      console.log(pad(L.name, 9) + lpad(w.runs, 6) + lpad(w.inWalk, 8) + lpad(w.atPlace, 9) + lpad(w.none, 5) + '  | ' + lpad(w.boom ? w.boom.join('-') : '-', 13) + lpad(w.peak === null ? '-' : f2(w.peakMin) + '-' + f2(w.peak), 14) + lpad(w.peakWalk === null ? '-' : f2(w.peakWalk), 13) + lpad(w.atU === null ? '-' : w.atU, 6) + lpad(w.doneAtS === null ? '-' : w.doneAtS, 10) + '  | ' + lpad(st.n, 10) + lpad(f2(st.p50), 6) + lpad(f2(st.p95), 7) + lpad(f2(st.p99), 7) + lpad(f2(st.max), 7) + lpad(st.over6, 8)); }
    result.lens = { rows, frameTimes: tables.frames, wall };
    // THE BARS (Ruling 48). (a) each relief line's swoop peak (where it swoops in the walk) <= the MAX swoop peak over main's A, B and S; (b) each
    // relief line's settled p99 <= main's settled p99 on its equivalent line: A for the 20-35 deg lines (the steepest 20-35 deg line, ruled; also
    // the closest in mean slope: A 27.4 against the riser's 27.0 and the upland's 29.1, B 25.2), S for the 35-45 deg line (main's only line
    // above 36 deg: A and B top out at 32.8 and 36.2). Both + STEP_TOL (0.1 u/s, the table's precision); the strict difference is printed.
    const EQ = TAG === 'main' ? {} : { riser: 'A', upland: 'A', steep: 'S' };
    const inWalkMax = ns => { const v = ns.map(n => rows[n] && rows[n].swoop.peakWalk).filter(x => x !== null && x !== undefined); return v.length ? Math.max(...v) : null; };
    const anyMax = ns => { const v = ns.map(n => rows[n] && rows[n].swoop.peak).filter(x => x !== null && x !== undefined); return v.length ? Math.max(...v) : null; };
    if (TAG === 'main') {
      result.lens.maxSwoopPeak = anyMax(['A', 'B', 'S']); result.lens.maxSwoopPeakWalk = inWalkMax(['A', 'B', 'S']);
      console.log(`main: the max swoop peak over A, B, S in the walk ${f2(result.lens.maxSwoopPeakWalk)} u/s (first pull-ins anywhere, the place's included: ${f2(result.lens.maxSwoopPeak)}); settled p99 A ${rows.A && f2(rows.A.settled.p99)}, B ${rows.B && f2(rows.B.settled.p99)}, S ${rows.S && f2(rows.S.settled.p99)}`);
    } else if (!mainJ) { fail.push('no main to compare with: give RW_MAIN=<main\'s RW_JSON>'); }
    else {
      const mx = n => mainJ.rows[n].swoop, barWalk = mainJ.maxSwoopPeakWalk, barAny = mainJ.maxSwoopPeak;
      console.log(`\nRULING 48 (a): the swoop is an event: each line's first pull-in IN THE WALK, its peak step, relief against the MAX over main's A, B, S = ${f2(barWalk)} u/s (main: ${['A', 'B', 'S'].map(n => n + ' ' + (mx(n).peakWalk === null ? 'none in the walk (pulled in at the place: ' + f2(mx(n).peak) + ')' : f2(mx(n).peakWalkMin) + '-' + f2(mx(n).peakWalk))).join(', ')}) (+ ${SWOOP_TOL}, the scatter of identical runs):`);
      for (const n of ['riser', 'upland', 'steep']) { const w = rows[n] && rows[n].swoop; if (!w) continue;
        const ok = w.peakWalk === null || w.peakWalk <= barWalk + SWOOP_TOL;
        console.log(`  ${pad(n, 7)} ${w.peakWalk === null ? 'no pull-in in the walk (the boom was already in at the line\'s top: pulled in at the place, ' + f2(w.peakMin) + '-' + f2(w.peak) + ' u/s)' : 'peak ' + f2(w.peakWalkMin) + '-' + f2(w.peakWalk) + ' u/s in the walk (' + (w.peakWalk <= barWalk ? 'at most' : 'strict +' + f2(w.peakWalk - barWalk)) + ')'}: ${ok ? 'PASS' : 'FAIL'}`);
        if (!ok) bad('swoop', `${n}: the swoop in the walk peaks at ${f2(w.peakWalk)} u/s, over the max ${f2(barWalk)} over main's A, B, S`); }
      console.log(`  INFO (not gated): the first pull-ins at the PLACE (the spring's step response to the snap, 14-26 u/s: it scatters by 10 u/s between identical placements, the first booked frame landing at an unpredictable phase of it): relief max ${f2(anyMax(['riser', 'upland', 'steep']))} against main's ${f2(barAny)} u/s.`);
      console.log(`RULING 48 (b): the settled walk's p99, relief against main's equivalent line (+ ${STEP_TOL}):`);
      for (const n of ['riser', 'upland', 'steep']) { const r = rows[n]; if (!r) continue; const e = EQ[n], bar = mainJ.rows[e].settled.p99, ok = r.settled.n >= MIN_FRAMES && r.settled.p99 <= bar + STEP_TOL;
        console.log(`  ${pad(n, 7)} settled p99 ${f2(r.settled.p99)} (n ${r.settled.n}, ${r.settled.over6} over 6 u/s) against main ${e} ${f2(bar)} (strict ${r.settled.p99 <= bar ? 'at most' : '+' + f2(r.settled.p99 - bar)}): ${ok ? 'PASS' : 'FAIL'}`);
        if (r.settled.n < MIN_FRAMES) bad('vacuous', `${n}: only ${r.settled.n} settled frames`);
        else if (!ok) bad('step', `${n}: the settled walk's step p99 ${f2(r.settled.p99)} u/s is over main ${e}'s ${f2(bar)}`); }
    }
  }
}

if (MODE === 'hose') {
  const B = plan.hose.at, dB = 375 - plan.hose.spare;   // the binding point and its range from the live pump head (stats.mjs: the 3D range, the floor under it)
  const ang = Math.atan2(B.z - 2.895, B.x - 5.382), PAST = { x: B.x + Math.cos(ang) * 20, z: B.z + Math.sin(ang) * 20 };
  console.log(`\nHOSE: the binding point ${JSON.stringify(B)} at range ${f1(dB)} from the pump head (spec §7: ${HOSE_START} - ${GIVE} give - ${f1(dB)} = ${f1(HOSE_START - GIVE - dB)} u spare, bar ${SPARE_BAR})`);
  if (RED === 'short20') { const Lr = Math.round(dB - 20); await c.ev(`(window.survival.hose = ${Lr}, 1)`); console.log(`RED short20: the line is ${Lr} u (the binding point's range ${f1(dB)} less 20), so the point lies 20 u past what the hose reaches`); }
  else if (RED === 'past20') console.log(`RED past20: after the binding point he walks on 20 u straight out, to (${f1(PAST.x)}, ${f1(PAST.z)})`);
  console.log(`survival.hose at the deck: ${await c.ev('window.survival.hose')} (HOSE_START ${HOSE_START}; FP_HOSE never applied)`);
  await c.ev(`(window.__leash.reset(), 1)`);
  // THE DIVE, real keys: W over the side (yaw +X, through the bulwark gap), then C (vent) down to the seabed
  const t0 = Date.now(), nav = () => c.ev(`window.__rw.nav()`);
  let n = await nav(); console.log(`deck: ${JSON.stringify({ x: f2(n.x), y: f2(n.y), z: f2(n.z), onDeck: n.onDeck })}`);
  await c.ev(`(window.player.yaw = Math.PI / 2, window.player.pitch = -0.05, 1)`);
  await c.key('KeyW', true);
  for (let i = 0; i < 120; i++) { await sleep(250); n = await nav(); if (!n.onDeck && n.y < -1.5) break; }
  await c.key('KeyW', false);
  await c.ev(`(window.player.pitch = -0.3, 1)`);
  await c.key('KeyC', true);
  for (let i = 0; i < 300; i++) { await sleep(500); n = await nav(); if (n.grounded && n.y < -100) break; }
  await c.key('KeyC', false);
  console.log(`dive: ${((Date.now() - t0) / 1000).toFixed(1)} s, landed ${JSON.stringify({ x: f1(n.x), y: f1(n.y), z: f1(n.z), grounded: n.grounded })}, leash ${JSON.stringify(await c.ev('window.__rw.leash()'))}`);
  if (!(n.grounded && n.y < -100)) fail.push('he never reached the seabed from the deck');
  await sleep(1500);
  n = await nav();
  const goal = { x: Math.round(B.x), z: Math.round(B.z) };
  const rt = await c.ev(`window.__rw.route(${Math.round(n.x)}, ${Math.round(n.z)}, (x, z) => x === ${goal.x} && z === ${goal.z}, ${goal.x}, ${goal.z})`);
  if (rt.err) { fail.push('no walkable route from the landing to the binding point: ' + JSON.stringify(rt)); }
  else {
    console.log(`route: ${rt.pts.length - 1} legs, ${f1(rt.len)} u, from ${JSON.stringify(rt.pts[0])} to ${JSON.stringify(rt.pts[rt.pts.length - 1])}`);
    const pts = rt.pts.slice(); if (RED === 'past20') pts.push([PAST.x, PAST.z]);
    await c.ev(`(window.__rw.run = null, window.__rw.begin(${JSON.stringify({ pts, look: 6, rate: 1.4, pitch: -0.1, stopAt: 1.2, maxT: 900, stopOnYank: RED === 'short20', noStop: false, target: [B.x, B.z], pushT: RED === 'past20' ? 20 : 0 })}), 1)`);
    await c.key('KeyW', true);
    const tw = Date.now(); let st, lastPrint = 0;
    for (;;) { await sleep(500); st = await c.ev(`window.__rw.status()`);
      if (Date.now() - lastPrint > 20000) { lastPrint = Date.now(); const lk = await c.ev(`window.__rw.leash()`); console.log(`  ${f1((Date.now() - tw) / 1000)} s: ${st.prog}/${st.total} u, leash ${lk.state} r ${lk.r} n ${lk.n}`); }
      if (st.done || Date.now() - tw > 960000) break; }
    await c.key('KeyW', false);
    const R = await c.ev(`window.__rw.end()`); R.line = 'hose'; R.dir = 'fwd'; R.rep = 1; R.surv = await c.ev(`window.__rw.survival()`); R.nav = await c.ev(`window.__rw.nav()`);
    const lk = await c.ev(`window.__rw.leash()`);
    const fin = R.nav, dEnd = Math.hypot(fin.x - B.x, fin.z - B.z), spare = HOSE_START - GIVE - R.maxR;
    tables.frames = frameTimes([R]);
    console.log('frame times (live loop, ruling 42):', JSON.stringify(tables.frames));
    console.log(`\nHOSE RUN (${TAG}${RED ? ', RED ' + RED : ''}): ${R.why} after ${f1(R.t)} s sim, ${f1(R.prog)}/${f1(R.total)} u of the route; closest to the binding point ${f1(R.minTo)} u (ruled arrival: within ${ARRIVE_R}), ends ${f1(dEnd)} u from it at (${f1(fin.x)}, ${f1(fin.z)})`);
    console.log(`  __leash at the end: ${JSON.stringify(lk)}`);
    console.log(`  the leash's farthest range over the walk ${f1(R.maxR)} u (the give starts at ${HOSE_START - GIVE}: ${f1(spare)} u spare, bar ${SPARE_BAR}); frames in the give ${R.nGive}, in the hold ${R.nHold}; stall frames ${R.stall.n}; oxygen ${R.surv.oxygen}, fuel ${R.surv.fuel}, torn ${R.surv.torn}, strain ${R.surv.strain}`);
    result.hose = { why: R.why, simSec: +f1(R.t), prog: +f1(R.prog), total: +f1(R.total), minTo: +f1(R.minTo), dEnd: +f1(dEnd), leash: lk, maxR: +f1(R.maxR), spare: +f1(spare), nGive: R.nGive, nHold: R.nHold, surv: R.surv, rangeBinding: +f1(dB), red: RED || null, past: RED === 'past20' ? PAST : null, frameTimes: tables.frames };
    // the criteria are the PASS run's in every case; a RED is the same bar failing (past20 walks on to a point nothing lets him reach: its stall is its end)
    if (!(R.minTo <= ARRIVE_R)) bad('arrive', `he did not arrive at the binding point (${R.why}; closest ${f1(R.minTo)} u)`);
    if (RED !== 'past20' && R.why !== 'arrived' && !(RED === 'short20' && R.why === 'yank')) fail.push(`the walk ended '${R.why}'`);
    if (lk.n !== 0 || lk.last.str !== 0) bad('yank', `a yank: __leash.n ${lk.n}, last ${JSON.stringify(lk.last)}`);
    if (!(spare >= SPARE_BAR)) bad('spare', `the leash read ${f1(R.maxR)} u: ${f1(spare)} u short of the give's start (bar ${SPARE_BAR})`);
    if (RED !== 'past20' && R.stall.n > 0) fail.push(`${R.stall.n} frames in 2 s windows under ${STALL_MIN} u moved (first ${JSON.stringify(R.stall.first)})`);
    if (R.surv.torn > 0) fail.push(`disturbed (torn ${R.surv.torn}): a bite is not a hose reading`);
    if (!(await lonely())) { }
  }
}

// ---- the console, the verdict ----
const cons = await c.console();
const errs = cons.filter(l => /error|EXC/i.test(l) && !/favicon/.test(l));
if (errs.length) { console.log('CONSOLE', errs.slice(0, 5).join('\n')); fail.push('console errors: ' + errs.length); }
if (process.env.RW_JSON) { writeFileSync(process.env.RW_JSON, JSON.stringify(result, null, 1)); console.log('wrote ' + process.env.RW_JSON); }
c.close(); stop();
if (RED) {
  // a RED run must fail THE BAR IT TARGETS (not merely something). Exit 1 = it did; exit 3 = that bar did NOT fail: the case discriminates nothing
  const target = { noslope: 'gap', nofloor: 'clearance', short20: 'yank', past20: 'yank' }[RED], hit = tags.has(target);
  console.log(hit ? `RED ${RED}: the ${target} bar FAILED, as it must:` : `RED ${RED}: the ${target} bar did NOT fail: NOT RED` + (fail.length ? ` (other bars failed: ${[...tags].join(', ') || 'untagged'})` : ''));
  for (const f of fail) console.log('  ' + f);
  process.exit(hit ? 1 : 3);
}
if (fail.length) { console.error('FAIL'); for (const f of fail) console.error('  ' + f); process.exit(1); } else console.log('PASS');
