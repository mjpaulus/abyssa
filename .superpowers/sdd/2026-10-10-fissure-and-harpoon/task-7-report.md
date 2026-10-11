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
