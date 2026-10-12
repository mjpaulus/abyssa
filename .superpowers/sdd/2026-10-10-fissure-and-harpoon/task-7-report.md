# Task 7 report: the harpoon as Sal's blade

Branch `fissure`. Base 72e4af7. Commits: 6127c18 (look-dev driver), 1a9ebde (RED probes), bfbd11b (implementation), b7c3dc4 (GREEN probes), b8ad593 (Alt+=, CLAUDE.md, README), 68abda0 (invariants probe), 3a4d818 (roadmap log), c6092be (unused import), 8f189c7 (stow during a second pull), the burst-trail commit, and the report commit.

## What was built

**Input path (game.js).**
- `BLADE = { knife: { contact 0.22, reach 3.4, cd 0.45, power 1 }, harpoon: { contact 0.30, reach 5.5, cd 0.9, power 1.8 } }`.
- `doSlash()` picks the harpoon when `survival.hasHarpoon` is set and calls `triggerSlash(kind)`. It sets `pendingSlash = b.contact` and `pendingBlade = b`.
- The contact frame calls `slash(pos, fwd, B.reach, B.power)` and `lev.onSlash(pos, fwd, B.reach - 0.4)`. That is 3.0 for the knife, exactly as before, and 5.1 for the harpoon.
- The contact frame also sets `window.__bladeLast` to one reused object `{ t, reach, kind }` (no allocation).
- `window.__programs()` is a probe surface for the first-sight compile check.

**predators.slash(pos, fwd, range = 3.4, power = 1).** A shark in reach is sent to flee, as before. Power then scales three things:
- `cool` × power: it stays off longer.
- `blinded = min(1, 0.7 × power)`: the hard peel-away turn.
- A roll stagger away from the side the iron came in (`rollKick` × power, only when power > 1).

At power 1 every value is the old one. Squid kills are unchanged (cone and reach). Octopus spooks are unchanged.

**hoarder.js.**
- `L.onSlash(pos, fwd, reach = 3)` uses `A.r0 * 1.2 + reach`.
- The grab line is "IT HAS YOU. CUT IT — CLICK TO THRUST." when owned and the old SLASH line otherwise. `survival` is imported; there is no import cycle.
- No other sleeper has an `onSlash`, so the harpoon does nothing against Velkath or Mhor (checked by grep).

**diver.js: the prop.**
- `diver.harpoon` is a Group under `armL.end` with `harpoonModel()`'s mesh inside. salInstall retires only a bone's direct meshes, so it survives on both the sculpted rig and `?salproc` (frames prove both).
- The mesh starts procedural and swaps to the sculpted set on `HARPOON_ASSET.then`. The boot waits for the ledger, so the swap lands before compile.
- It is hidden until owned. `forceAllDrawn` in the warm frames draws it, so there is no first-sight compile: programs were 722 → 722 across grant, first thrust and settle.
- `castShadow = false`, because it passes a hand's breadth from the lantern's point light. No lights were added.

**diver.js: the carry.** The shaft comes out of the left fist and runs back up along the outside of the forearm, the head past the elbow and the butt a hand below the fist (grip HG_L = -0.67).
- Standing, it stands upright at his side with the head beside the shoulder.
- Walking, it slopes with the forearm: head back over the shoulder, butt forward-low and outboard.
- In the haul stroke and the burst lean it trails the arm. Measured in the diver's frame, the tip stays behind the left fist through a whole haul cycle (dz -0.10 to -1.29). In the burst a second carry pose blends in by burstW: the iron swings out, and its slerp's midway is outboard. It then trails past the fist, with the tip behind the fist (dz -0.03 to -0.84) and behind and below the bonnet (dz -0.68 to -1.74). Without this the head pointed forward past his helmet.
- While he wrenches a lodged iron out of Velkath (a second pull, already owning one), his own is not drawn (`diverBladeStowed`, set before `updateDiver`). Checked on a second pull: the prop is hidden for the whole wrench. On the "comes free" frame the prop shows and the lodged iron hides, so there are never two irons and never none.
- Nothing else goes into his left hand: no module outside diver.js attaches to the rig, the hoard lamp is a flag, and keepsakes and relics are not carried.
- I chose along-the-forearm over a back sling. Measured clearance: the bonnet sphere is never touched (min 0.19 u over idle, walk, haul, burst and thrust). The corselet sphere is touched only in the 0.1 s draw and return sweeps (below). The back is crowded with the pack, the hose dock and the helmet's rear.

**diver.js: the thrust** (`triggerSlash('harpoon')`, its own clock `thrustT`, 0.9 s).
- **Key data.** The THK keys give the LEFT palm in the spine frame, the iron's aim (yaw/pitch, spine frame), the body yaw off the look, spine yaw/pitch, body lean and drop. The RIGHT palm is derived: (HG_R - HG_L) = 0.35 further along the aim. `armIK` is an analytic 2-bone solve to the fitted palm points (salSkinSculpt KNIFE_C for the left, GRIP mirrored for the right), with an elbow pole down/out/back. It runs post-compliance and is blended by weight. The iron is placed from the left palm along the line of the two palm keys and converted into the hand's frame, so the right fist is on the shaft by construction.
- **Motion.**
  - 0 → 0.18 s (wind-up): he sits back (lean -0.06, drop 0.035), turns his body and twists the corselet left into a bladed stance, and draws the iron to his left hip. The right fist comes across and closes on the shaft.
  - 0.30 s (contact): driven from the boots. The lean is +0.14 and the twist unwinds. The iron is level, along the look, down his left flank.
  - 0.40 s: the weight goes on past (lean 0.17).
  - 0.56 s: settled, the iron held out.
  - 0.9 s: handed back to the gait.
  - At contact the heel-strike springs fire: settle -1.9, kneeSoft +3.2 × gb, rcP +0.55. The frame drops onto the legs and the trunk carries a beat.
  - The squaring-up (`sqW`) drives the body onto the look + the keyed bladed offset, held through the follow-through.
- **The lantern.** It stays in the right fist and hangs plumb from it through the thrust (its pivot is slerped to a gravity frame by the IK weight; the pendulum rides on top). The light stays live and follows.
- **Hands and idles.** The left hand holds the hilt pose (the same bar radius) whenever owned. The valve idle and the low-air reach are suppressed when owned, because a 1.7 u pole would swing past the bonnet. The peer idle still runs.
- **Knife path unchanged.** Every new term multiplies a thrust weight that is 0 (or is gated on ownership), so not owning keeps it identical. See `knife-trace` below.

**Copy.** The title hint is "click: blade". The grab line changes as above. The README controls row is updated. No other user-facing KNIFE or SLASH strings exist; I grepped src, index.html and README.

**Playtest.** Alt+= (code Equal, unused) grants or revokes the harpoon. It writes the save both ways (`saveChart` hook), the toast says which, and the panel has a row "= HARPOON / KNIFE".

**CLAUDE.md.** The contact line reads "Knife slash contact at t=0.22s; the harpoon's thrust contact at t=0.30s (game.js BLADE / pendingSlash match — keep in sync)". A paragraph on the blade follows it, and Orune's onSlash note is updated.

**Tools.**
- `tools/bench/blade-shots.mjs`: a persistent look-dev page with pinned side lenses, `at <sec>`, and a 0.05 s strip.
- `__bench.hold(on)`: a new dev-only bench export. Without it the live loop animates Sal between CDP calls even while paused, so earlier "strips" were in wall time.
- `tools/bench/knife-trace.mjs`: the knife's exact per-frame channel path.
- `tools/bench/blade-invariants.mjs`.

## RED → GREEN

RED (1a9ebde):
- thrust-contact: contactFrames -1, `__bladeLast` undefined, `__programs` missing.
- orune-cut: grab line was SLASH.
- shark-thrust: the owned thrust did not abort (the reach was the knife's).

GREEN (b7c3dc4, re-run at head):
- **thrust-contact:** knife 13 frames / 3.4, harpoon 18 frames / 5.5. Programs 722 → 722 across a fresh grant, the first thrust and the settle.
- **orune-cut:** grabbed, one thrust frees him, and the line is "IT HAS YOU. CUT IT — CLICK TO THRUST."
  - The real cut does not discriminate. At the cut the holding arm's tested rings are inside their own girth of him (ringGapAtCut -1.22), so the knife would free him too. The arm's tip is what holds him.
  - I added the reach rule as a discriminating case. Re-grabbed, the cut is tried from a point the rings are 4.01 u (past girth) from: the knife's 3.0 does not free him and the harpoon's 5.1 does.
- **shark-thrust:** zone-0 shark in strike, held 8.3 u ahead.
  - Knife control: the strike goes on.
  - Owned thrust: flee on frame 18 (the contact), bit = true, blinded 0.93, aborted 4.78 u off its flank (≥ 4.5).

## All probe modes

All 29 modes PASS at c6092be, run in sequence with DRV_PORT 9485 on fresh profiles.
- harpoon-probe: routes, rite, remote, lodged, abort, thrust-contact, orune-cut, shark-thrust.
- fissure-probe: shape, jam-stand, throat-edges, slabs, tips, walls, climb-out, open-ledge, floor-readers, opening, jam-mesh, seep-depth, reascend, open-persist, calm-open, open-light, pour-hide, below-dark, walls-inside, clearance, velkath-crack.

Re-run after the stow and burst changes: thrust-contact PASS, remote PASS, and the knife-trace and invariants are unchanged.

## Knife path (bit-identical)

`knife-trace` compares a fresh load, Alt+3, 120 frames and `__slash()` over 38 frames, base vs head.
- Arm channels Lsx/Lsy/Lsz/Le and knifeHeld visibility: max diff 1e-5 (print rounding).
- Hand world position: 0.8 mm.
- sYaw: 0.0004.
- The base-vs-base A/A noise is 1 mm / 0.0003 (the scene's random fauna and look).

Frames `blade-t7-knife-before-side/game.png` (served from a 72e4af7 worktree) and `blade-t7-knife-after-side/game.png` show the same pose frame for frame.

## Invariants (fresh profile, `?bench&playtest`, 30 s live play, then the voyage soak)

- Lights: 14 at base and at every stop.
- `__lev.fp`: 15ce888c / c938fe6e / 652d0412, before and after.
- Terrain `__ridge.fp()`: home 3b526986, Pallid b1c58f8d, Burned d2b6fb68. Zones 1+2: d49d451d.
- `__safeFailed()` [] and `__shaderFailed()` [].
- Console errors: 0. Favicon is not logged under `?bench` here.
- Soak: home → Pallid → Burned → home, ×2, with an owned thrust at every stop. Programs 723 flat, geometries 304/305 by site with no growth, textures 380 flat.

## Frames (/Users/michaelpaulus/sc/.abyssa-wt/shots/)

- **Idle carry:** `blade-t7-idle-seabed-game.png`, `-seabed-34.png`, `-seabed-left.png`, `blade-t7-idle-deck-game.png`, `-deck-34.png`.
- **Walk:** `blade-t7-walk.png` (left and front, mid-stride).
- **Haul stroke:** `blade-t7-haul-reach.png` (swimP 0.86), `blade-t7-haul-pull.png` (0.31) and `blade-t7-haul-game.png`.
- **Burst lean:** `blade-t7-burst-lean.png` (the head trailing back along his wake) and `blade-t7-burst-game.png`.
- **Thrust strips,** one frame every 0.05 s from t = 0.017 to 0.917 s: `blade-t7-thrust-strip-game.png` (follow lens) and `blade-t7-thrust-strip-side.png` (pinned 3.6 u off his left). Raw frames are in `blade-t7-strips/`.
- **Draw and recover sweep:** `blade-t7-draw-and-recover.png` (3/4 front, 0.05 / 0.10 / 0.70 / 0.75 / 0.80 s).
- **Knife unchanged:** `blade-t7-knife-before-{side,game}.png` and `blade-t7-knife-after-{side,game}.png`.
- **Procedural Sal (`?salproc`):** `blade-t7-salproc.png` (idle, contact 3/4, contact side) plus the singles.
- **Ladder:** `blade-t7-ladder.png` (owned, mid-climb; the iron lies across the gunwale).

## Self-review

- **Allocation.** Zero per-frame allocation: keys, temps (`_ik*`, `thA`, `carryQ/P`) and the `bladeLast` object are all module-scope. `evalThrust` uses a module function, not a closure.
- **Materials.** No new material variants beyond `harpoonModel`'s own ('harpoon|sculpt' / '|proc'). No GLSL.
- **Syntax and load.** Every edited .js passed `node --check` as .mjs and loads in the browser (console clean).
- **Timing sync.** The contact is 0.30 s in both game.js `BLADE` and the diver keys (contact key at 0.300). CLAUDE.md is in sync.
- **Knife path.** The knife path's state (`slashT`, SLK, compliance bypass, knifeHeld swap) is untouched. `triggerSlash()` without an argument is still the knife.

## Concerns

1. **The thrust barely reads from the follow lens.** A forward thrust is foreshortened, and a 0.07 u dark iron at 9 u is a few pixels. I moved the hold to a bladed stance (iron down his LEFT flank, outside the silhouette), so from behind the read is the body turning, the lantern swinging across to his left and the lean. The iron itself shows mainly in the draw. The old knife reads no better from there (before frames). Side and 3/4 frames read clearly.
2. **The real Orune cut cannot tell the blades apart.** The arm's tip holds him, so both reach. The harpoon's longer reach is proven by the reach-rule case, not by play.
3. **The draw and return sweep the head across the chest.** For about 0.1 s in the wind-up and in the recovery, the head passes in front of the chest. The corselet's occluder sphere is touched (min -0.1 u); in frames it passes in front of the breastplate. Michael should judge it live.
4. **Carry while walking.** The shaft slopes with the forearm, head over and behind the left shoulder near the pack and the hose dock. No measured bonnet contact, but the hose can cross it.
5. **The burst swing.** On a burst the iron swings about 150 degrees outboard over about 0.3 s to trail. It reads as the wash taking it, but it is a visible twirl.
6. **Valve check and low-air reach are off once owned.** A design choice: the low-air tell is now only the HUD and audio while he carries the harpoon.
7. **Geometries +1 (304/305 against Task 6's 303/304).** The procedural harpoon geometry is built at import for the hand and stays cached. It is flat, with no growth.
8. **Dev-only bench export.** `__bench.hold` was added to src/lib/bench.js. It is only loaded under `?bench` / `?lab`.

---

# Fix round 1 (rulings in progress.md, Task 7 "Ruling:" lines)

Commits: 183b6b7, 50dba3b, bb07a20, e5d0f9c, c8833c7 (plus this report).

## What changed

**I1, the idle carry is invisible from the follow lens.**
- `CARRY_DIR` is now (0.60, 1, -0.10), about 16° off the sleeve. The iron is not scaled and has no back sling.
- From the game camera it now reads as its own line standing off the left arm: `blade-t7f-idle-seabed-game(-zoom).png` and `blade-t7f-idle-deck-game(-zoom).png`.
- The gate is `tools/bench/blade-clear.js`: 21 points along the iron, measured against rig capsules. The table is below.
  - Over a real stride (walk 2.17 u/s and hurry 2.58 u/s), the butt clears the left thigh by ≥ 0.22, the sheath by ≥ 0.18 and the hips by ≥ 0.43.

**I2, first-sight compile.**
- `harpoon-probe thrust-contact` reads `__programs()` first, on a fresh profile. It asserts `hasHarpoon` is false; the read happens before the first grant ever.
  - Then it runs the knife, the grant, the first thrust and a settle.
  - Then a CONTROL hangs a mesh with an unwarmed material where the iron is. It must add a program, which proves the check can fail.
  - Result: 722 → 722, control 722 → 723.
- The soak (`blade-invariants`) reads programs at home before the grant, then again after the grant + first thrust at the same spot: 721 → 721.
  - The voyages after it read 723 at every stop.
  - `NOGRANT=1` (never granting) reads the same 721 → 723, so those 2 programs belong to the voyage, not the harpoon.

**I3, idle gestures.** The valve-check idle and the low-air reach run again while the harpoon is owned.
- The iron hangs plumb from the raised fist, out past his arm. It is a world-frame carry (`plumbLocal`) blended by `valveW`, the same way the burst carry blends.
- For that pose the fist slides to the butt end (VALVE_HG -1.00); held at the normal grip, the butt stood up into the bonnet.
- Frames: `blade-t7f-valve-34/left/game(-zoom).png`.

**Orune, "frees her grab from further out" (ruled parry).** The new signature is `lev.onSlash(pos, fwd, reach, tipReach, guard)`.
- **Not held.** An arm REACHING for him (lash > 0, not recoiling) is parried when its tip is inside the blade's full reach (knife 3.4, harpoon 5.5) and in his 70° cone. Parried means it recoils (no grab while it does) and the lash is spent. The line is "THE ARM RECOILS FROM THE BLADE."
- **Guard window.** The harpoon's point, held out after contact, is a 0.26 s guard (game.js `bladeGuard`) that parries but does not cut.
  - Why it was needed: measured, a throw closes from 29.8 u to 3.3 u in about 0.45 s, and passes the 5.5 → 3.2 band in about 3 frames. A contact-frame-only test is nearly unhittable even for the harpoon.
  - With the guard, a click as the throw begins (the tell over) parries it. The knife keeps the contact frame only (the last-instant cut).
- **Held.** One cut frees him, with either blade (unchanged).
- **New probe `orune-parry`.**
  - An arm caught reaching, at 4.4–4.6 u: the contact frame's knife call leaves it coming; the harpoon's call parries it; no grab follows.
  - Real input: a click as the throw starts (tip 28–32 u out) parries it before it closes. 2/2 runs pass.

**Shark.** Avoidance after a thrust is back to the knife's 60–90 s (`cool` is no longer × power). Power scales only `blinded` (the abort's hard turn) and the roll stagger.

**Reach scaling, stated honestly** (predators.js header and CLAUDE.md):
- squid kill: range + size × 0.35, in the 70° cone (5.5 + … with the harpoon);
- shark: range + size × 0.5, a SPHERE (6.7 → 8.8 u), so a forward thrust also spooks a shark beside or behind him;
- octopus spook: range + 2.2 (5.6 → 7.7 u).

**BLADE.cd is wired.** The knife is 0.55 (= SLASH_DUR) and the harpoon 0.9.
- `doSlash` refuses a swing inside `cd - half a frame` of the last one.
- The game clock's delta is never smaller than the anim's dt, so the cd can never refuse a click the anim would take.
- Knife-trace against the base: channels within 1e-5, hand within 0.7 mm (the A/A noise is 1 mm). The knife path is still bit-identical.

**Wrench.** `doSlash` returns while `lev.rite.wrenching`, the same way `packUsable` does.

**Thrust readability.**
- On contact, diver.js spits 12 bubbles off the iron's point (the exhaust's own pool).
- game.js puts a silt puff AT the point (footfx `emitDust`, existing program) when within 3 u of the bed, and a centimetre lens punch along the look (`camYank`, v 0.9, about 3 cm; an event, per the grounded-camera rule). These fire only for the harpoon.
- From the follow lens, the silt shows past his left shoulder from t ≈ 0.37 s: `blade-t7f-thrust-strip-game.png`. It uses no new programs (first-sight check above).

**Motion polish.**
- **Draw and recover.** They now pass through a waypoint (world, per frame): the iron held forward and up from the fist.
  - The head turns over in the fist's fore-and-aft plane, never across the breastplate.
  - Corselet clearance in the thrust: −0.107 → +0.281.
  - An outboard waypoint was tried first. It swung the butt into the left thigh (−0.06), which is why the waypoint is forward-and-up.
- **Burst.** BURST_DIR is splayed too (about 105° from the carry, not 150°). The blend is sprung (`bwS`, 6.5 rad/s, damping 0.8), and the fist slides to the butt end (BURST_HG -0.92) so the butt clears the hip and sheath.
- **Ladder.** Both hands are on the rungs (`kw = 1 - ladderF` hands the left fist to the rung pose). The iron hangs from the left wrist by its butt, outboard (`plumbLocal`, LADDER_HG -0.94). Frame: `blade-t7f-ladder.png`.

**`bladeLast.t`** is now the contact time (it was always 0).

## Clearance (`blade-clear.js`; clearance to each part's surface in u, minimum over the state; < 0 is inside)

| state | speed max | thigh L | sheath | hips | bonnet | corselet | worst |
|---|---|---|---|---|---|---|---|
| idle | 0 | 0.276 | 0.177 | 0.426 | 0.854 | 0.602 | forearm 0.095 |
| walk | 2.17 | 0.287 | 0.236 | 0.446 | 0.891 | 0.601 | forearm 0.093 |
| hurry | 2.58 | 0.219 | 0.312 | 0.459 | 0.934 | 0.601 | forearm 0.093 |
| thrust | — | 0.063 | 0.097 | 0.042 | 0.681 | 0.281 | forearm 0.039 |
| swim thrust | — | 0.072 | 0.067 | 0.040 | 0.758 | 0.281 | forearm 0.039 |
| haul | 7.47 | 0.447 | 0.466 | 0.447 | 0.646 | 0.525 | forearm 0.093 |
| burst | 7.11 | 0.175 | 0.086 | 0.233 | 0.652 | 0.575 | forearm 0.016 (the fist itself) |
| ladder | — | 0.285 | 0.280 | 0.457 | 0.789 | 0.634 | forearm 0.093 |
| valve | — | 0.405 | 0.467 | 0.387 | **−0.127** | 0.111 | — |

The valve's −0.127 is the butt at the bonnet sphere. With the slid grip the butt is at the palm, and the palm itself measures −0.074 there, because the valve check puts his hand on the helmet. The sphere is a rough fit of the bonnet's bbox.

## Probes and invariants (head e5d0f9c / c8833c7)

- **harpoon-probe:** routes, rite, remote, lodged, abort, thrust-contact, orune-cut, orune-parry, shark-thrust all PASS.
  - shark-thrust: aborted at 4.79 u off its flank; the knife control at 8.3 u does not abort.
  - orune-cut: one thrust frees him held; the reach rule at 4.03 u gives knife no, harpoon yes.
- **fissure-probe:** 20/21 PASS in the batch. `seep-depth` failed twice in a row under load (z2 E 0.174 / 0.179 against 0.17), then PASSED twice in isolation at the same head (z2 0.124 / 0.128, matching its documented depth-stable 0.13). Nothing in this round touches the seep, silt or terrain render. I read it as a flaky capture under load.
- **Invariants:** 14 lights; `__lev.fp` 15ce888c / c938fe6e / 652d0412; terrain home 3b526986, Pallid b1c58f8d, Burned d2b6fb68, zones 1+2 d49d451d; `__safeFailed` [] and `__shaderFailed` []; console errors 0.
- **Soak:** 6 voyages with an owned thrust at every stop. Programs 723 flat, geometries 304/305, textures 380.
- **Knife-trace vs base:** identical (channels 1e-5, hand 0.7 mm).

## Frames (shots/)

- **Idle carry:** `blade-t7f-idle-seabed-game.png` (+ `-zoom`), `blade-t7f-idle-deck-game.png` (+ `-zoom`), `blade-t7f-idle-seabed-34.png`.
- **Valve check:** `blade-t7f-valve-34.png`, `-left.png`, `-game.png` (+ `-zoom`).
- **Ladder:** `blade-t7f-ladder.png`.
- **Burst:** `blade-t7f-burst-left.png` and `-game.png`.
- **Thrust strip with the puff:** `blade-t7f-thrust-strip-game.png` (follow lens; silt past the left shoulder from 0.37 s) and `blade-t7f-thrust-strip-side.png`. Raw frames are in `blade-t7f-strips/`.

## Remaining concerns

1. **The guard window is my addition to make the ruled parry playable.** It is 0.26 s after the harpoon's contact, while its point is held out. Without it, the harpoon's parry window against a real throw is about 3 frames. It applies to Orune's arms only.
2. **The iron slides in the fist** for the valve check (to the butt end) and in the burst, so the grip is no longer a single invariant everywhere. It is still single through the carry, draw, thrust and haul.
3. **The bubbles at the point are hard to see from behind;** the silt carries the read. Above about 3 u off the bed (open water) there is no silt, only the bubbles and the lens punch.
4. **The valve's butt sits at the bonnet sphere,** where his hand already is (see the table).
