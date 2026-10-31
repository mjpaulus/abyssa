// THE BURIAL PROBE (velkath-buried-rock; spec docs/superpowers/specs/2026-10-14-velkath-buried-rock-design.md §1-§4).
//   DRV_PORT=9540 node tools/bench/burial-probe.mjs <disguise|breath|programs|rise|digin|reentry|wound> <port>
// Stepped on the PLUGGED clock (clockplug.mjs). Exit 0 pass | 1 a bar failed | 2 UNMEASURED | 3 a BP_RED whose bar did NOT fail
// | 4 LOST (clock drift) | 5 a BP_RED whose bar failed, as it must. JSON of every series judged -> BP_OUT (default
// ~/sc/.abyssa-wt/reviews/buried/burial-<mode>-<tag>.json).
//   disguise  home, zone 0, Velkath dormant at her bed. THE DRAWN SAND at (x, z) = max(terrainH, the dune's drawn surface
//             (__burial.sandAt; absent on main)). Every vertex of her legs, claws, eyes / stalks, mouthparts and every ward
//             centre: its height over the drawn sand (max, per part; bar <= 0). HER SIDES: her shell's vertices outside the
//             crest strip over the drawn sand (bar <= +0.02). THE STRIP, here and for the crest and the growth: the brief's band,
//             ring 0's edge + 0.6 u, computed from the mound by the probe itself, never the build's inStrip (Task 3a fix round 3); on
//             main (no mound) the strip's default ellipse, BURY_DEFAULT below. THE CREST: her shell's vertices over the drawn sand:
//             top over the mean ground (poseAll's 5 x 5 grid; bar 6.0-7.0 u since Task 5b, Michael's checkpoint 2026-10-20: was 3.0-4.0), length along
//             her keel (bar 16-24 u). THE EXPOSED ROCK (Task 5b): the true area of her drawn shell triangles whose three corners all stand > +0.02 u over
//             the drawn sand; bar >= 1.8 x 1ddb11a's 95.24 u^2 (pre-registered: "roughly twice"); face (>= 1.0 u over) and tips booked. THE CLUTCH (Task 6 on): every live lobe's top (r x
//             1.25) <= -0.05 u under the sand. THE HARPOON (Task 4 on; IRON: its head and shank inside her drawn shell by harpoon-probe
//             lodged's exact-hit test, and seatOk; RED on 9e6a01b's fallback seat): the seam >= +0.25 u, every pole sample >= 0 u over the
//             DRAWN SAND (terrain or dune, never the crest: harpoon.js seat()'s own test). THE GROWTH ON HER BACK (Task 3a on):
//             every DRAWN reef and weed vertex OUTSIDE the strip <= 0 over the sand (inside it, growth on a rock is allowed);
//             buried, burial.js hides the growth outside the strip, so none drawn there passes; n = every growth vertex examined
//             (the vacuity floor), nOut = those drawn outside the strip.
//             THE REPOSE (Task 3a; narrowed in fix round 2 and pre-registered on 9829f9a BEFORE the fit's repose pass was written):
//             the drawn dune is never steeper than drifted sand lies, the strip's band aside. Every triangle of the mound's quad rows
//             1 .. NI-1 (ring 1, the dune's first, out to the first buried ring; row 0 is the strip's band, where the sand meets the
//             rock, and is the ONLY area skipped) is judged by its plane's steepest slope in ANY direction, in degrees, read off
//             MD.M (the fit, without the breath). A plan-degenerate triangle with more than 5 mm of height to it is a wall: 90 deg.
//             Bar: a FIXED 33.81 deg (the repose's 28.81, BURY.repose 0.55, + 5; fixed so a knob cannot move it); >= 200 triangles
//             judged, else UNMEASURED. Booked: the counts over 33.81 / 45 / 60 deg, the worst face, the tallest face over the bar,
//             and every triangle [row, bearing, half, deg, height span, clamped corners] in the JSON. Judged only where she has a mound.
//             THE CORAL (final review item 6): every drawn vertex of her rock's coral (L.parts.coral) inside THIS bed's strip band (the
//             probe's own, from the live mound), growRock's own rule at the source; judged where she has a mound (it runs on every DISGUISE:
//             disguise, digin's clear / offbed disg, reentry's disg). Its vertices under the drawn sand are booked (info): on the first
//             build 48 of 20859 stand up to 0.57 u under the local floor, a crust following her shell where it dips under it.
//             BP_CHECK=<comma list> limits the verdict to those checks (the tasks before the mound check height / limbs only).
//   breath    THE TELL (Task 3a; spec §1 "Every 8-10 s the sand over her lifts a few centimetres and settles", "visible only
//             within about 8 u"). Home, her asleep: he is stood 6 u off the strip's edge on her SAND side, facing it (__bench.place,
//             then player.pos.y = shutFloorY + 1.35), 40 s stepped, then 12 u off for 30 s more. Booked per frame: the dune's ring-1
//             vertex y at the bearing nearest him (lev.mound.P; with no mound, the drawn sand where ring 1 would lie, 0.6 u outside
//             the default strip's edge: the floor, which never moves), L.trickleN, L.brAge, L.breathY, his and the lens's
//             distances. Bars: amplitude (max - min of that y while dormant, the 6 u leg) 0.03-0.06 u; every interval between
//             breath peaks (a peak = the top of an excursion over half the amplitude, not cut by the leg's ends) 8-10 s, >= 3
//             peaks booked or UNMEASURED; trickles >= 1 per breath at 6 u (a breath = its rise completed, brAge crossing
//             BURY.breath.up, inside the leg; none booked = UNMEASURED); trickles 0 at 12 u (>= 1 breath booked there).
//             VERDICT ORDER (breath): a bar that FAILED on a real measurement is FAIL (exit 1) even if another is UNMEASURED; with
//             no failure, any UNMEASURED bar is exit 2; nothing vacuous ever passes. A RED judges only its own bars.
//   programs  NO COMPILE IN PLAY (Task 5 on; the gate table's "No compile in play"). A program compiles only on a RENDERED draw
//             (__bench.step runs update() alone unless o.render: bench.js step), so every frame here is rendered
//             (__bench.step(n, fn, { render: true })), with her in the frame: he is stood 23 u from the strip's centre on her SAND side (Task 5b; was 14 u off its edge),
//             facing it (breath's PLACE), the follow lens behind him, so the slabs, the plume, the dune, the claw's reach and the haze
//             stay in view through every phase (he faces ring 1's vertex on the sand side's bearing, breath's PLACE, so the look runs
//             ~20 deg off the strip's centre: she is in frame, not centred; Task 5 review minor 5). Booked at each checkpoint: renderer.info.programs.length, the programs whose
//             cacheKey holds '|crust' (the crust's ONE program: Task 5), and __shaderFailed(). In order:
//               boot     right after the arrival, before anything near her is drawn (what the boot tail built)
//               first    120 rendered frames at the framing spot (first sight: on the Task 4 head three shadow-depth programs, two
//                        MeshDepth + one MeshDistance, compile here, a pre-existing count; booked by name, not judged)
//               control  THE POSITIVE CONTROL: a visible MeshBasicMaterial box with a new customProgramCacheKey 3 u in front of the
//                        lens for ONE rendered frame: the count must rise >= 1 and hold a program with that key (a draw through the
//                        composer's passes may add more than one), else exit 2 (the probe cannot see a compile); then the box is
//                        removed and its material disposed (its programs released) and the count must be back where it was, else
//                        exit 2, so (a) does not carry it. (Run after first sight, so first sight's own compiles cannot pass it.)
//               (a)      home dormant, 120 rendered frames more: THE BASELINE
//               (b)      the whole rise, rendered: she is woken with lev.cmd('wake') (the pull's onWake, wakeBrooder; a pull from
//                        the framing spot would abort: harpoon.js H.update, he is more than REACH + 1 from the anchor), stepped to
//                        L.hasStood (Task 7a on; before it, 9 s after the wake)
//               (c)      THE CALM (Task 10): survival.hose 760 (the rift line, not the short-line one), __lev.cmd('calm') (a build without the
//                        verb, the Task 9 head, is calmed directly: every unlit ward's g.lit set, booked calmBy 'direct'), then rendered until
//                        the point is done and she is on her way home (pointPh 0 after it ran, or no point at all, and >= 10 s), at most 20 s:
//                        the opening's light, the claw's reach, the walk home. Her in the frame is booked (cFrames: her shell's bounding
//                        sphere in the lens's frustum), as slabDraw is. PRE-REGISTERED (Task 10, before its GREEN): (c) every rendered
//                        frame == (a) (max and last); under BP_BASE, the base's (c) counts join vsBase when the base JSON has them, and
//                        (c) is info (not judged) when the base's own (c) failed with the same kinds new in (c), as the rise's rule
//               (d)      THE DIG-IN (Task 12, pre-registered before its build): after (c), him re-placed 35 u from her centre on her sand
//                        side facing her (digin's PLACE: she is in the frame and he is off her ground), rendered until L.dugIn (the dig-in
//                        done, bury 1), at most 45 s: the refit's job, the dune drawn back up, the haze. (d) every rendered frame == (a) (max and
//                        last); no dug-in within 45 s is UNMEASURED (the head never digs in). Her in the frame booked (dFrames)
//               sites    Pallid Bank, the Burned Ground, the Unsounded Shelf (__chart.arrive(i)), her asleep there, 120 rendered
//                        frames each from the same framing: her shell's program is home's (the same cacheKey), and with the crust
//                        (Task 5) L.crustU.uBury.value is 0 on EVERY frame
//             Bars: rise: every frame of (b), (c), (d) equal to (a) (max and last); shader: __shaderFailed() [] at every checkpoint;
//             siteKey: her shell's program at every site is home's. With the crust (__burial.crust present): crustBoot: the
//             '|crust' programs at every checkpoint are those the boot built (> 0; her body already compiles four variants on the
//             Task 4 head, two flags of three's key apart, measured: each carries '|crust', the crust adds no variant of its own) and no
//             program of her body ('|vkRim') lacks it, so nothing of the crust compiles at first sight; siteBury: uBury 0 on every
//             frame off home. Booked per frame (the series) into the JSON.
//             BP_BASE=<a programs JSON of the base build>: vsBase, every checkpoint's count (boot, first, a, the max over (b), b,
//             each site's max and last) equal to the base's, and the programs new at first sight and in (b) the same kinds: what a
//             task's change adds, when the base itself compiles in the rise (the Task 4 head does: one MeshDistance program ~1.9 s
//             into it, pre-existing). BP_RED=lazy fails it too. (Task 5b, Task 5 review minor 1) Under BP_BASE `rise` is booked as info,
//             not judged, when the base's own rise failed with the same kinds new in (b) (the pre-existing compile is the base's, carried
//             to Task 7b; vsBase still holds every count equal); BP_RED=lazy is refused without BP_BASE (its rise bar alone cannot tell
//             the RED's compile from the base's).
//             (Task 7b) slabDraw: on a build with slabs (L.slabs), they are DRAWN (visible and in the lens's frustum by their bounding
//             sphere) on >= 1 rendered frame of (b), so (b) == (a) covers their first draw; booked per frame (the series' fifth column).
//             hitch.mjs's scenarios (jet, z1, z2, voyage) do not include the rise, the point or the dig-in: this mode is the gate for those.
//   rise      THE RISE OUT OF THE SAND (Task 7a; spec §2 "A slow, heavy rise of about 6 s", "Her rising body shoves him back with a
//             stagger, but cannot tear the dress", "The fight's dangers (the drop, the hammer, the tear) start once she stands"). Home, her
//             asleep, him stood per BP_AT (default anchor): anchor = Alt+6 (the harpoon's anchor) and REAL E (the wrench, the free, the
//             wake 0.7 s later); crest = the highest drawn shell vertex (her crest's top, Review Focus 2); off = 12 u off the strip's edge on
//             her sand side (breath's PLACE); front = 2.3 R in front of her (the ring her hammer's hinge lands on: brooder.js HUNT), facing
//             her. Away from the anchor a pull would abort (harpoon.js H.update: more than REACH + 1 from it), so there she is woken with
//             lev.cmd('wake') (wakeBrooder, the pull's own onWake). Placed, 30 frames settle him (booked: grounded, his boots' gap to
//             shutFloorY), then every stepped frame is booked until 14 s after the wake (the frame L.dormant goes false). E = the E press
//             (anchor) or the wake. STOOD = the probe's OWN frame (never the build's flag alone: the code grading itself): the first frame
//             after the wake with L.stand >= 1, |heave.x - 1| < 0.02 and |heave.v| < 0.05 (brooder.js's hasStood test, read off the
//             series); L.hasStood's first frame is booked beside it. Bars (Task 7a's, pre-registered in its brief):
//               (a) from E until STOOD: no tear (window.__slamLog.length and survival.torn never rise), threatE 0 (no blow cocked), nsT 0
//                   (no drop counting); the first frame of threatE > 0, nsT > 0 and drop > 0 over the whole run booked
//               (b) BP_AT crest or anchor only: a stagger SET within 1.0 s of the wake (player.stagger rising frame on frame, so the
//                   wrench's own stagger, 0.45 s at the free and spent by the wake, cannot pass it), and his distance (plan) from the
//                   strip's centre (MD.bx, MD.bz; no mound: her centre) 1.5 s after the wake >= 0.5 u more than at the wake
//               (c) every ward's centre < 0 u over the drawn sand at the wake, > 2 u at STOOD, and none lit on any frame
//               (d) her body's |dY/dt| (L.bodyY, frame on frame x 60) <= 8 u/s on every frame from E to STOOD (after it: booked)
//               (e) his capsule (bodyBlocked at 0.45 / 1.0 / 1.6 u over his boots, margin 0: his axis inside her; the 0.45 margin, his
//                   radius, booked) on no frame from 1.5 s after the wake to STOOD; the lens never bodyBlocked(lens, 0) nor under
//                   shutFloorY(lens) + 0.3 from E to STOOD. After STOOD she hunts him: those frames are the fight's (the lensfix
//                   residual), booked apart, not judged here
//               (f) at STOOD the dune is drawn back: MD.k (the k setMoundK drew) 0 and MD.drawn false
//             >= 60 frames from E to STOOD and a STOOD frame, else UNMEASURED. Booked besides (the 7a bookings): L.bury when standE first
//             passes 0.5 and 0.9, L.bellyOver, her claws' lift / elbow and L.frontUp / clawRes through the rise, the first 12 frames
//             after the wake's BODY (bodyCols: last, hitV, push, contacts, shell) and L.shoveN, his gap to the drawn ground. The blind
//             bar is Task 8's.
//               (g) FOOTING (controller's ruling on Task 7a's NEEDS_CONTEXT; pre-registered here and RED on 1ddae5e, the build before the
//                   footing fix): from the frame before the wake to wake + 2 s, his boots' gap to the DRAWN ground (the highest of terrainH,
//                   the drawn dune (__burial.sandAt) and her drawn shell's top under his sole: the highest of five downward rays from his
//                   boots + 1.5 u, at his centre and +-0.25 u, BURY.foot.r, the footing's own disc; a centre ray alone read 2.5 u under him
//                   standing on a spine of her crest) and, on her strip, her crest's FOOTING carried by her body since the fit (burial.js
//                   footY, the walkable envelope he stands on while she is buried, carried by body now . inv(the fit's body matrix): the
//                   ruling's "her crest footing follows her rising shell") within
//                   [-0.3, +0.3] u on every frame, EXCEPT a THROW: from the frame the crack's shove lands (L.shoveN rises) until the shove's
//                   stagger is spent AND his boots are back within 0.3 u of the drawn ground. On a throw's frames: while he is still within
//                   0.3 u (plan) of where he stood when it landed, within [-0.3, +0.3] u (the ground under his feet did not vanish under
//                   him: thrown off a ledge of her rock he may fall, but not before he has left it), and his boots never rise faster than
//                   1.0 u/s (the shove's own lift is 0.10 x 11 = 1.1 u/s: anything faster is her body throwing him up). (Amended twice
//                   before any fix ran, on 1ddae5e's readings: an exempt throw passed the crest's float; a +1.2 u bound failed a man thrown
//                   off the crest's pinnacle, a legitimate fall.) AMENDED A THIRD TIME AFTER THE FIX'S FIRST GREEN RUN (anchor; recorded,
//                   and the REDs re-judged under it, FOOTING() below): (1) the rise limit applies only IN THE AIR (boots > 0.3 u over the
//                   drawn ground): shoved up the steep rock at the strip's edge he walked up it at 6 u/s ON it (gap -0.02); (2) a FALL is
//                   air too: the drawn ground dropping > 0.3 u from under him in a frame (she turned as she rose and the lip of her rock went
//                   from under his boots: 1.7 u, a ledge leaving him, not a footing gone); in the air he is never under the drawn ground by
//                   more than 0.3 u (the vanished-footing case sinks him into her rock: nofoot, -1.2 u). TIGHTENED (fix round 1, I3 and C1;
//                   committed and run on b2564ff before the fix): (i) her carried crest footing is his ground only if his boots on the frame
//                   before stood no more than 0.6 u (a step) under it (or over it), and the shell rays start at last frame's boots + 1.5 u: a
//                   floor that snaps a man up from under her belly onto her back is not ground he could stand on; (ii) a FALL, after its
//                   first 6 frames, sinks on every frame (boots' dY/dt <= 0) and by >= 0.15 u/s over each 0.25 s (the suit settles ~0.3 u/s,
//                   player.js A_SETTLE): a man hanging still in the water fails; (iii) the window runs on past 2 s while he is in the air,
//                   to his landing (within 0.3 u) or STOOD. BP_AT=under: stood at 'off' for the wake, then at wake + 5.5 s (standE ~0.98,
//                   not yet stood: the harmless window a player dashes under her in) set on the sand under her centre, afloat 0, and (g)
//                   judged from that frame on (its window as above). (v) CONTROLLER RULING 2026-10-20 (the spec: her rising body shoves him
//                   back; the proxy's over-reach is Task 3b's, measured): on a frame in the air in contact with her shell's collider
//                   (BODY.last 'shell', or a shell push that frame) the fall's sink rule pauses, his rise is at most her body's rise + 0.3
//                   u/s, and his gap over the drawn ground (her drawn shell) at most 1.0 u; out of contact the rules above. CONTROLLER RULING
//                   2026-10-20 (2nd, the last change to this bar): "in contact" includes a 0.25 s (15 frame) grace after each shell contact
//                   (resting contact on a rising surface flickers frame to frame: 19 of 74 frames at the anchor); the bounds unchanged. Judged at every BP_AT; BP_AT=dune stands
//                   him half-way down the dune on her sand side (the dune floor following moundK as it draws down)
//               (h) THE CRACK (Task 7b, pre-registered in its brief): L.crackK >= 0.9 x L.bury on some frame within BURY.crackT + 0.1 s of the
//                   wake (the crust's crack drawn at its full strength for the sand still on her). A crack that never drew (crackK never > 0
//                   after the wake: the Task 7a head) books nothing: UNMEASURED
//               (i) THE SLABS (Task 7b, its brief: "A slab hovering more than 0.3 u is a fail: they ride the surface until they sink"): read off
//                   the DRAWN mesh (L.slabs { mesh, n, vpc }), every live piece's lowest drawn vertex <= +0.3 u over the drawn surface under that
//                   vertex (the highest of terrainH, the drawn dune and her drawn shell, downward rays from the vertex + 1.5 u, the highest of five
//                   0.05 u apart, amended after rays fell through slits in her drawn shell: see slab() below; never the fit pose, her back rises under them) on every frame the mesh is drawn (sunk into the SAND is allowed: this side is one-sided), and the mesh
//                   hidden by 3.1 s after the wake. No L.slabs (the Task 7a head), or none drawn with a piece live: UNMEASURED
//               (iShell) THE SLABS' SHELL SIDE (Task 7b fix round 1, I1). PRE-REGISTERED before any run, then AMENDED TWICE AFTER THE FIRST RUNS (the
//                   review's premise was a misreading, below; every amendment is recorded with the reading that forced it; the bound, 0.3 u, never moved).
//                   AS REGISTERED: the vertical gap (the slab's lowest vertex less the highest of terrainH / dune / her shell under it, slab()'s own
//                   read) >= -0.3 u for every piece whose surface is her shell. The review's "gMin -0.234 u at t 0.0" is the FIRST frame's minimum; over
//                   the whole series gMin was already -0.867 u in burial-rise-t7b-G-off.json (the same on f6b4077 at crest and off, deterministic), a piece
//                   on her shell: so the registered bar FAILED the shipped build (gMinShell -0.867 u, 66 of 173 frames). Why: burial.js seats a piece on the
//                   LOWEST of five reads (vertex, +-0.15 u), and where her face is steep a vertical gap measured at the vertex's own x, z is large for a
//                   point that is within 0.15 u of her surface (probe lo - game gl: within 0.01 u on 23 of 29 sampled frames, the game's seat IS the lowest
//                   of five reads off the drawn mesh; the other six -0.284 .. +0.026 u).
//                   AMENDMENT 1 (kind): a piece is a SHELL piece when the lowest of those five reads (slab() re-reads them off the drawn mesh) is her
//                   shell, else dune / floor (the game's lowShell: pieces straddling her rim sink into the sand by design and are not judged). All 173
//                   frames' lowest piece was shell either way: it moved nothing.
//                   AMENDMENT 2 (the measure): DEPTH IN HER = the shortest distance from the lowest vertex to her drawn surface, an upper bound off the
//                   drawn mesh's ray heights out to 0.3 u (rings 0.075 apart, 8 bearings: sqrt(r^2 + (h - vertex)^2), 0 where the vertex is not under her
//                   top). Bar: <= 0.3 u (BP_SHELL_D overrides it for a ruling or to show a RED's reach; the default is the bar) on every drawn frame, for
//                   every shell piece. The vertical gap is booked (info.slabs.gMinShell), gMin and the kind it was read on (shell | dune | floor) on
//                   every frame and in info.slabs (gMin, gMinKind, gMinAt, kinds). No shell piece on any drawn frame, or none drawn: UNMEASURED.
//                   READING on f6b4077 (ROUND 1: bar 0.3; fix round 1 runs, deterministic): off / crest / front / dune / under max depth 0.348 u on ONE frame
//                   (anchor 0.322 on two), so the bar FAILS the shipped build by 0.05 u; vertical gap min -0.867 u (-0.886 anchor), every lowest piece
//                   a SHELL piece. At BP_SHELL_D=0.4 off passes (exit 0) and the sunk RED (max depth 0.524, 170 of 173 frames over) still exits 5, so the
//                   bar separates the build from a forced 0.5 u; the default stays 0.3 (not widened to fit: the controller's ruling). Frame: (t 1.683 s, piece 7, on a flat face, ny 0.96, vertical gap -0.452); the
//                   cause (the game's top grid against the drawn mesh, spine tips, a slit) was not established in round 1.
//                   ROUND 2 (599c72a + 4fc8e38; the build with SLAB_DIP 0.1 and SLAB_STEP 0.35): CAUSE FOUND: at a lip of her shell (a step 0.4-0.7 u
//                   down within 0.15 u, measured on f08a683) the lowest of the five reads seated a piece up to 0.45 u into her where it stood. The seat
//                   is now clamped to SLAB_DIP under the read at the vertex itself, and a piece whose five reads span more than SLAB_STEP bursts into
//                   silt. READING: off / crest / front / dune / under max depth 0.094 u (anchor 0.118 u, which exits 1 on parked (e) only); the bar
//                   0.3 holds with 0.18 u to spare and the sunk RED (0.5 u) still exits 5.
//                   RED (BP_RED=sunk, rise, any BP_AT): after each stepped frame the probe lowers the shell piece standing on the flattest face by
//                   0.5 u in the DRAWN mesh (the game rewrites every vertex each frame: no accumulation), so it is ~0.5 u deep; it judges (iShell)
//                   alone and must exit 5. (i)'s hover side must still hold under it: booked, not judged.
//             (M3, booked, not judged) info.dust: the footfx puff pool's (420 particles, shared with his boots) emissions and live-slot
//                   OVERWRITES from the wake to the end of the series (src/world/footfx.js dustStats()).
//             THE PLUME AND HER BLIND START (Task 8, pre-registered in its brief before any plume was built; the brief letters them (g)-(k),
//             which this probe already used for 7a / 7b, so here they are NAMED: brief (g) = blind, (h) = footprint, (i) = climb,
//             (j) = quadEv, (k) = riseEv). The reading is Michael's ruling (2026-10-15): she is blind for 3-4 s starting about 3 s into the
//             rise (sight() cannot lose him before standE 0.5), so she finds him about 6-7 s after the wake. He stays still after the shove.
//               blind     her FIRST blind spell: L.lostN rises from the wake to STOOD (she loses him; never = FAIL, not UNMEASURED: the head's
//                         RED), and the spell's length, (the find row - the loss row) / 60 (sight() zeroes blindT on the find frame itself), is
//                         in [3.0, 4.0] s. The loss and the find are booked from the wake too. HOW IT ENDED is booked off the find row (sight()
//                         reacquires on any of four): los = clearT >= SIGHT.reacq (clearT is not reset on a find; the row books it to 1e-3, and
//                         sight's own test is > 0.6 unrounded: a LOS find books 0.6), pd = the PREVIOUS row's
//                         L._pd < collR x 1.05 (sight runs first in the frame, _pd is written later), touch = the previous row's touchT > 0,
//                         sigil = a ward lit on the find row (brooder.js :2505 sets seen at the frame's end). Only a LOS ending is judged; a
//                         spell ended any other way is UNMEASURED (reported); a spell still open at the series' end is a FAIL (>= 4 s blind
//                         by then). The brief needs a LOS ending at BP_AT anchor and off. JUDGED AT anchor AND off (12 u, the default) ONLY,
//                         booked elsewhere (AMENDED after the first GREEN runs, recorded: the brief registers the bar "with BP_AT=anchor" and
//                         asks a LOS ending at anchor and off). `blind` is judged at the anchor (where he stands when he pulls) and at off 12 u
//                         (the spec's frame). Every other placement is booked as a reading, because Michael's 3-4 s is a feel target. The crest's
//                         4.28 s (she does lose him there at shoveV 11, tau 3.87) is on record for his look (controller ruling, Task 8 review Minor 1).
//               footprint the plume's density footprint 1.5 u over the floor: every 3rd frame, on 32 bearings from the strip's centre (MD.bx,
//                         MD.bz; no mound: her centre), the farthest r (0.25 .. 30 u, 0.25 u steps, every step read, not the first exit) where
//                         __plume.dens(x, terrainH + 1.5, z) > 0.02; the frame's reading is the farthest bearing's. At its widest from the
//                         wake to STOOD: in [15, 20] u (the full series' widest booked). No __plume on the page, or < 20 samples: UNMEASURED;
//                         no density anywhere is a reading of 0 (FAIL)
//               climb     it climbs: every 6th frame, the density's maximum over a plan grid (the centre and 16 bearings x 2 .. 20 u, 2 u apart)
//                         x heights 0 .. 20 u over terrainH (0.5 u apart): the height over the floor of that maximum. That height at 4.0 s
//                         after the wake less its height at the first sample after the wake with a maximum > 0.02: >= 3 u. (Booked beside it,
//                         not judged: the plan-integrated profile's peak height, sum over the grid's columns per height, the same samples.)
//                         No cloud > 0.02 in the first 4 s: FAIL (no climb); < 10 samples: UNMEASURED
//                         Booked beside it (info.blindWindow, not judged): from the first loss to the first LOS find, with the bump / touch
//                         re-finds between them counted (beside her shell sight() re-finds him the frame after each loss).
//               quadEv    no live particle overwritten in the 448-quad ring over the rise: __plume.state().quadEvicted from the frame before
//                         the wake to STOOD does not rise. UNMEASURED where the field is absent (the head: a count that cannot be read cannot
//                         pass) or no rise record was ever live (__plume.state().rise)
//               riseEv    __plume.state().riseEvicted does not rise over the same window (every live rise cloud keeps its density record);
//                         UNMEASURED as quadEv
//             AMENDED BEFORE ANY PLUME WAS BUILT (the RED run on 4fc8e38, burial-rise-t8-red-4fc8e38-{anchor,off}.json): footprint and
//             climb read the RISE clouds' density alone (__plume.densKind(x, y, z, 'rise'): the same model, the rise kind's records only).
//             As registered (__plume.dens, every cloud) the footprint read 28-30 u (the scan's end) from 4.0 s on with NO rise plume:
//             her heavy footfalls' own 'small' clouds (brooder.js, standE > 0.35) at her feet ~2 R (R 15.4) from the strip's centre, so
//             the bar could not pass whatever the rise plume did; and a footfall cloud is the field's maximum (d 0.20 at 1.0 u, 5 s) in
//             the climb's grid. The bands are unchanged; the every-cloud readings are booked beside them (footprintAll, climbAll). On a
//             build with no rise kind (the head) the rise density is 0 everywhere: a reading, not UNMEASURED.
//             BP_RED=noplume (__burial.set({ plume: 0 }): no rise plume) judges blind, footprint and climb (the two eviction counts would be
//             0 with no plume and are not its bars). BP_OFF=<u> moves the `off` placement to <u> off the strip's edge (default 12): the
//             blind spell at 10 and 25 u off her flank is booked with it, not gated. BP_PLUME=<json> patches __plume.kinds.rise before
//             the run (tuning trials; booked in the JSON).
//             BP_FORCE=1 (and BP_RED=tearable): THE FORCED CONTACT. Through the window the hold adds (from the first frame L.stand
//             reaches 1, where the shipped rising flag ends, to STOOD) he is set, after every frame, in the path of her fastest moving
//             leg capsule (bodyColsCaps, the first 40: 8 legs x 5; moving 3-18 u/s, under bodyCols' LIMB_VMAX 20), 0.2 u in, afloat,
//             so the next frame's resolve meets a leg coming INTO him (BODY.hitV). (Fix round 1, M4: teleported each frame he lit her wards
//             and calmed her before STOOD, and calmed game.js forbids tears: in the window ward touch is off (L.reach -1, restored at STOOD)
//             and the window is cut at a calm, booked per row.) Her shell moves < 1 u/s there (the heave settling,
//             she does not walk: measured), so her planting legs are what can close on him. Judged: aTear only, and >= 1 frame with
//             BODY.hitV > 2.5 (game.js's slam threshold) in the window, else UNMEASURED.
//   digin     DIGGING BACK IN (Task 12; spec §3 "`bury` runs from 0 back to 1 over 15-20 s"; Review Focus 3). PRE-REGISTERED here before any
//             build of the dig-in (the Task 11 head 90e1f99 never digs in: every run there is a reading of that). THE CHAIN, every run a fresh
//             load: home, Alt+6 and REAL E at the harpoon's anchor (rise's anchor: the iron comes free, the scar shows, she wakes 0.7 s on);
//             stepped until L.hasStood (at most 20 s); him PLACED 35 u from her centre along her sand side (L.sand), facing her, standing
//             on the drawn ground; BP_HUNT s (default 6) stepped while she hunts him (AMENDED before any build, after the head runs: on
//             90e1f99 she settled 0.00 u off her bed, so the refit at a new bed went unexercised; hunting she walks off it toward him, and
//             her walk home stops within 3 u and 0.12 rad of it); __lev.cmd('calm') (every dark ward lit); stepped through the point and the walk home until she has
//             SETTLED, the probe's own frame: calmed, L.stand 0, |heave.x| < 0.02, |heave.v| < 0.05, no pointPh, walkTo or homeTurn (at most
//             40 s; none = UNMEASURED); him PLACED again (the same rule, she may have moved). Every stepped frame is booked from there (the
//             WINDOW). The dig-in's FIRST frame: the first with L.bury over the last frame's by > 1e-9; its LAST: the first with bury >= 1.
//             ON HER GROUND (the pause's test) is the PROBE'S OWN, never the build's flag: the plan's onHerDune, re-computed page side
//             (bodyCols shellPlanNear(his x, y - 0.45, z, SETTLE.release) on the published shell, under a ceiling of 6 u over max(terrainH,
//             extraFloorAt)), so a build with no pause (BP_RED=nopause) still books the frames he is on it. Runs (BP_RUNS, default all):
//               clear   him 35 u off throughout; the window booked to the last frame + 2 s (at most 40 s). Bars:
//                 dur    first -> last 15.0-20.0 s (spec)
//                 end    bury >= 1 and L.dugIn on the window's last frame
//                 disg   the disguise checks on the dug-in pose (DISGUISE with L.dugIn in place of L.dormant), every check `disguise`
//                        judges but the harpoon's pole and iron (the iron came out with the pull; out.harpoon is null), and `scar` in place
//                        of `seam`: the scar's centre (H.scar's world origin, laid flush on the seam) >= +0.2 u over the drawn sand
//                 wards  on the window's last frame every ward's light.intensity 0 and its burn glow's (g.burn) material.opacity 0
//                 breath dug in, then him 6 u off the strip's edge (breath's PLACE, unchanged), 40 s booked: the ring-1 vertex's
//                        amplitude 0.03-0.06 u (breath's amp bar) over the frames L.dugIn holds; >= 1 frame, else UNMEASURED
//                 cost   (booked item 6, PRE-REGISTERED before the dig-in was measured): every frame of the window's update() wall time,
//                        ms (performance.now() between successive frames of __bench.step, which runs update() alone; the clock is set
//                        before each step call so a batch's first frame carries no round trip): the WORST frame of the window, from the
//                        re-placement to the dig-in's last frame, less the window's MEDIAN frame, <= 4.0 ms. The build's own timer of its
//                        job (L.digJobMs, per frame) is booked beside it, not judged
//               pause   (Review Focus 3, on foot) once bury >= 0.33 he is placed 3 u outside the boundary of the probe's own test on the sand
//                       side's bearing (scanned in from 40 u off the strip's centre, at the ground) facing her, and REAL W walks him in;
//                       W is released 0.5 s after his first frame on her ground; he stands until 3 s after that first frame, then is
//                       PLACED 35 u off (the leave). AMENDED after the first build run (t12-dev7; no bar changed, the procedure did): the
//                       teleport to 35 u dragged the follow lens 13 u through the ground behind it for 18 frames (lens -1.56 u, him 35 u from
//                       the dune, off her ground): a probe artifact. Now he is placed at the approach spot when the window opens (bury 0), 60
//                       frames settle him (the span the boots and lens bars judge starts after them), he waits there for bury >= 0.33, walks
//                       in as above, and the leave is a WALK OFF: turned about (player.yaw + PI) and REAL W until 30 frames off her ground,
//                       then he stands; the leave's first frame is the first frame off her ground after the 3 s on it. Bars:
//                 pause  every frame he is on her ground while the dig-in runs (0 < bury < 1 on the frame before): |d bury| <= 1e-9;
//                        >= 60 such frames, else UNMEASURED
//                 resume the first frame bury rises after the leave is <= SETTLE.hold x 60 + 1 frames after it (counting the leave's
//                        first frame off her ground as 1); UNMEASURED if none
//                 boots  his OWN boot gap (the drawn sole's lowest point, relief-walk's SOLE_PTS on diver.legR/L.end at SOLE_Y, both boots)
//                        over the drawn sand there (max(terrainH, __burial.sandAt)) >= -0.15 u on every frame from the approach to the end
//                 lens   the lens >= 0.3 u over the drawn surface (max(shutFloorY, the drawn sand) under it) on every frame of that span
//               afloat  the same at bury >= 0.4, but he is HELD 1.5 u over the drawn ground on a dune spot inside the boundary (2 u in from
//                       it on the same bearing) for 3 s: after every frame his height is booked and he is put back (vel 0, not grounded),
//                       then PLACED 35 u off. Bars: pause and resume as above; calm: BODY.calmOut 0 on every frame he is held (Task 3b's
//                       CALMCOL skip); sink: each held frame's drop <= what his own settle can give in one frame from rest,
//                       0.5 (|A_SETTLE| 0.11 + |min(0, buoy)| + the current's vertical 0.121) dt^2 + 1e-4 u (CALMCOL's 3 u/s is 0.05 u a frame)
//               crest   (fix round 1, M1, pre-registered before the fix) at bury >= 0.3 he is HELD on her crest top (the highest drawn shell vertex,
//                       his boots 0.1 u over it, put back after every frame as afloat) for 3 s, then PLACED 35 u off. Bars: pause and resume
//                       as above. On c3eaa00 the build's onHerDune measures its 6 u ceiling from max(terrainH, extraFloorAt), and mid-dig her
//                       crest is not ground, so up there he reads as off her ground and the dig-in runs under him: this run's RED is that head
//               offbed  (final review item 6, the coordinator's ruling) at the calm her bed (L.lairPos) is moved OFFBED_D 6 u along her
//                       sand side and L.lairYaw OFFBED_YAW 0.1 rad round, so the walk home lays her down well off the bed she was built on
//                       (it stops within 3 u of the moved one: ~6.2 u off the first, 0.17 rad, past play's 3 u envelope); then as clear to
//                       dug in and the DISGUISE on that pose. Bars: off (premise, >= OFFBED_MIN 2 u off the first bed, else VOID); end (dug
//                       in: L.dugIn and bury 1); coral (DISGUISE's coral check on the re-bed: every coral vertex inside the NEW bed's strip
//                       band). The other disguise checks booked (offbed.disg, info: her clutch stays on the first bed). The dig-in does NOT
//                       lay the growth again (a re-lay read as a visible pop on her exposed back): the coral rides her body, and its
//                       placement filters (the strip, the floor + 0.3, the seam) stay the first bed's; this run and clear.disg's coral
//                       catch the coral drifting out of the strip she lies in now
//               early   (final review item 1, pre-registered before the fix) THE CALM BEFORE SHE STANDS: Alt+6, __lev.cmd('wake') (the pull's
//                       own onWake), 0.5 s, __lev.cmd('calm') (the lab verb), 1 s booked; then him 35 u off, stepped to her settle and to dug
//                       in. Bars: snap (premise: bury > 0.5 on the frame before the first calmed frame, else VOID): within 2 frames of that
//                       frame bury 0, L.hasStood, L.moundK 0 and L.crackK 0, held for the 60 frames after it (on c4d60ac the rise froze
//                       part-way: the rise's easing and the stood test both want !L.calmed); dug (L.dugIn and bury 1 at the end)
//               throwpose / throwfit  (final review item 7, pre-registered before the fix) A THROW INSIDE A SLICE of the dig-in's job,
//                       injected page side after digin's chain: throwpose, the fit pose's matrix (L.digMw1, which beginDig takes) throws on
//                       its first copy, in phase 1 after digStep has posed her at bury 1; throwfit, the fit's generator, once it is the job's
//                       (phase 2), throws INSIDE it on its next slice (g.throw at its yield: it closes, as a real throw in the fit would).
//                       Every frame is then stepped on its own, a throw out of one caught and booked (esc), to 10 s after the injection.
//                       Bars: escape (no throw escapes the frame), warn (exactly one console.warn naming the dig-in's job, every page
//                       console.warn hooked), state (from the injected frame's row to 10 s after it: no L.digJob, not digging, never dug in,
//                       awake, bury 0, the dune hidden (moundK 0, MD.k <= 0), L.noPub false, her body's matrixWorld its pose's within 1e-6:
//                       bodyOff, parent matrixWorld x her local matrix). VOID when the injection never fired
//             THE PROBE'S OWN TEST (fix round 1, M1, the coordinator's ruling): the ceiling's ground is max(terrainH, extraFloorAt, bodyCols
//             shellHiAt) under him: her shell's top is ground for "on her ground" whatever the dig-in's bury.
//             BP_RED=fastdig ({digT: 8}, run clear only) must fail dur; BP_RED=nopause ({pause: 0}, run pause only) must fail pause.
//   reentry   LEAVING ZONE 0 MID-WAY AND COMING BACK (Review Focus 1). Three sessions (BP_RUNS, default i,ii,iii), each a fresh load:
//               i    mid-rise: __lev.cmd('wake'), stepped until L.stand >= 0.3
//               ii   mid-point: woken, stood, him PLACED 35 u off, calmed, stepped until pointPh 2
//               iii  mid-dig-in: digin's chain (the pull at the anchor), stepped until bury >= 0.5 after the dig-in's first frame
//             then gotoZone(1), 30 frames, gotoZone(0), 30 frames. Bars, each session: dormant (lev.dormant) and bury exactly 1; disg the
//             disguise checks (as digin: with the iron pulled in iii the scar replaces seam, pole and iron are not judged); cue
//             __pointcam.state().k 0 and the new sleeper's pointPh 0, pointK 0, calmNext false, digging / dugIn false; floor
//             extraFloorAt == __burial.sandAt (the LIVE sleeper's dune) within 1e-9 at every mid-quad point of rings 3 .. rings-2 on
//             every 4th bearing (>= 100 points, every one on the dune); clutch: the disguise's clutch check and B.drop == clutchSink / R;
//             shader __shaderFailed() []. A session whose midway state never came is UNMEASURED (iii on a head with no dig-in).
//               iv   (fix round 1, I1) mid-JOB: digin's chain, stepped until L.digJob is set (the refit under way, bury 0), then left as above
//             THE SECOND RISE (fix round 1, I1; sessions iii and iv, after the checks above): Alt+6 to the harpoon's anchor (the build there is the
//             old wound's: pulledRec), rise's booking installed, REAL E; bars: rite (the prompt "[E] PRESS THE OLD WOUND", the wound pressed,
//             she wakes within 10 s); rise's own bars on the booked 14 s at the anchor, the subset a, b, c, d, f, g, h, i, iShell (e and the
//             plume's are the anchor's parked / noisy readings, booked); reveal (L.growthBuried reaches 2 after the wake and 0 before STOOD:
//             growReveal ran and finished); then him PLACED 35 u off, the calm: point2 (pointPh 2 seen within 20 s); settled, then the dig-in
//             again: dig2 (L.dugIn within 40 s of the settle, its first -> last 15-20 s).
//             (AMENDED on c3eaa00, after data: rite reads `pressed` after the wake (it is set when the wound gives, after the 1.5 s wrench);
//             rise.c allows the REMEMBERED ward (the rebuilt sleeper is remembered: one ward dim-lit by design), every other ward unlit)
//             (Task 13, the Task 12 re-review's minor 1: the amendment allowed remembered wards but never barred their count) rise.c also bars
//             the remembered count: memN (the most wards lit AND g.mem on any booked frame) <= 1. BP_RED=mem2 (session iii only, the second rise
//             run): after the return and the second rise's Alt+6 (the jump rebuilds her), before its E, a page-side transplant flags ONE more ward
//             remembered with rememberWard's four writes (g.lit, g.mem, g.memK 0, L.memWard = its index; common.js), so two are lit AND
//             remembered: iii.rise.c must fail, exit 5
//             BP_RED=keepdig (session iii only, no second rise): the mutant re-entry that keeps the old sleeper's dig state (after the return
//             the new L is given the old L's dormant / bury / digging), which must fail iii.dormant and iii.cue: exit 5.
//   wound     THE OLD WOUND READS (branch oldwound; Michael's play report "I went down to velkath and there was no harpoon to pull", his
//             ruling: the old wound must be visible). Two sessions on the PLUGGED clock. (1) THE IRON, the reference: the probe's fresh profile
//             (no save), home, the iron in her crest; him on the sand 14 u out from the seam along her sand side (L.sand), turned so the seam sits
//             at ndc.x 0.3 beside him (aim: a player looks past his diver; straight at it his body covers it), its READ booked with the glint on.
//             (2) THE REMEMBERED BUILD: a pulled save seeded before the page's own scripts (Page.addScriptToEvaluateOnNewDocument: pulled[0],
//             sighted[0], tools.harpoon; the page's pagehide save cannot write over it), a fresh load; premise: home, buried, dormant, H.wound,
//             the seat found, the scar shown (else exit 2). window.start() (the title click's own path) and the zone line booked (the line that
//             holds 'OLD WOUND'); then the READ at 14 / 10 / 6 u on the sand side (ndc.x 0.3), at Alt+6's anchor (ndc.x 0.3) and at 10 u and the
//             anchor straight at it (ndc.x 0, info); the growth off the seam; then the RITE: Alt+6, the prompt, REAL E, she wakes.
//             THE READ (window.__bpWound.read), all on frozen captures through the whole post chain (what he sees, grain off) after 30
//             counted rendered frames: the FOOTPRINT is every pixel, inside a WINDOW +-3 u round the seam's projection at its distance from
//             the lens, that the PAINT turns hot magenta (R and B >= 40 codes over G and >= 40 codes off the plain frame): the paint is
//             one capture with everything the wound puts on screen made magenta (the scar / piece by its emissive, the glint by its colour,
//             the crust's own paint by uWound.w 2 where it has one; the iron, its line and its glint on a fresh save), so the footprint is
//             what reaches the screen past Sal, the fronds and her own rock. `floor` = the same test between two plain captures (over 2%
//             of the window is VOID). (The post bypass was tried first: on the plugged clock its frozen capture is a black frame.) The READ
//             is on the plain capture: the median luma (Rec.709, sRGB codes) of the footprint against the median of an annulus round it
//             (every pixel within r = max(4, eqD / 2) px, Chebyshev, not in it), Weber = |Lm - La| / La, and `visible` = footprint pixels
//             >= 10 codes off La. The bars' reads are taken with the glint hidden, so the wound's own marks carry them; with it on, beside.
//             BARS (a 1280 x 713 frame; the 9 u follow lens is 18-19 u from the seam at the 10 / 14 u sand views). FIRST REGISTERED (before
//             any reading of the iron): d10 visible >= 150 px and Weber >= 0.2 with the glint hidden, the anchor >= 1200 px and Weber >= 0.25.
//             RE-REGISTERED after the first build's data, before the final tuning: the iron itself, read the same way on a fresh save, is
//             46 px / Weber 0.066 at 10 u and 58 px / 0.004 at 14 u with its glint hidden (171 / 0.47 at 14 u with it): in this murk at
//             18 u no albedo mark reads, the iron's stub included, and its read from the sand WAS its glint. The first bars asked the wound
//             to read three times better than the iron ever did, against the brief ("as subtle as the iron's own read: a glint plus a dark
//             stub from 14 u"). So: d10.range (glint on) visible >= the iron's at 10 u (it reads at least as the iron did); d14.vsIron
//             (glint on) visible <= 1.25 x the iron's at 14 u (no more of a give-away); d6.mark (glint hidden) visible >= 150 px (a
//             14 x 11 px mark, ~0.3 deg on a laptop at arm's length: a thing you see, not a fleck); anchor.read (glint hidden) visible
//             >= 1200 px and >= 60% of the footprint visible (stood at it the mark is ~130 px across and most of it must stand off its
//             surround; the eye's contrast threshold for large targets is 1-2%, and the lantern's in-scatter veils everything at 3 u, so
//             dark can only fall to the veil). Re-registered a second time: its first form, Weber >= 0.1 on the medians, read 0.204 /
//             0.197 / 0.114 / 0.099 / 0.165 over five GREEN runs (the surround's median moves 106-134 codes with the lantern), while the
//             visible share held 0.83-0.90 (Weber stays booked);
//             fronds: no drawn frond and no coral vertex within GROW.near of the seam or in its sight corridor (GROW.sight); line: the zone
//             line holds 'OLD WOUND' and, she being buried, not 'RIDGE'; rite: Alt+6 -> "[E] PRESS THE OLD WOUND", REAL E, H.pressed and
//             she wakes (lev.dormant false) within 10 s; shader: __shaderFailed() []. The anchor view turns him 0.96 rad to put the seam
//             beside him: the lens then sits ~3.4 u from it against her crest (anchorc, straight at it: his body covers it, booked).
//             BP_RED=noscar: the wound hidden page-side before the reads -> d10.range, d6.mark and anchor.read fail, exit 5.
// BP_RED variants (each must fail ITS bar): ridge (__burial.set({on:0}): the shipped ridge at home) -> sides, crest;
// shallow (crest 5.5) -> crest height; steep (repose 2.0: the dune fitted to fall at 63 deg; the bar is fixed, so it must fail) ->
// repose; still (breath: __burial.set({breath:{lift:0}})) -> amplitude; lazy (programs: after (a) her shell material's key gains
// '|lazyRED' and needsUpdate, a variant compiled in play, as a crust installed at first sight would be) -> rise; noshove (rise:
// {shoveV: 0, shoveStag: 0}) -> (b); tearable (rise, BP_AT=crest only: {holdRise: 0}, the holds off) -> (a), a tear from her rising
// shell; early (rise, BP_AT=front only: {holdRise: 0}) -> (a), her hammer cocks (or lands) before she has stood. The two holdRise
// REDs judge (a)'s named PART (aTear, aHammer: see REDS), so neither can pass on the other's reason. nofoot (rise, BP_AT=crest only:
// {footRise: 0, shoveV: 0, shoveStag: 0}) -> (g). A page-side throw is
// UNMEASURED (exit 2), never a fail (1) or a RED's pass (5).
// __burial.set rebuilds her through __lev.remember(null), outside game.js keepingPrograms: her programs are released and
// rebuilt, so a `programs` reading taken after a set is not a play reading (that mode never sets knobs).
//
// MODES: `disguise` is built (Task 1), `breath` (Task 3a). `programs` (5, 7b, 10, 12, 13), `rise` (7a, 8), `digin` (12) and
// `reentry` (Tasks 2-12 fill them in, one by one) exit 2 "not built yet" until their task adds them to MODES below.
// ENV (besides DRV_PORT, a port of this probe's own: never 8777 / 8790 / 9419; the probe exits 2 before importing drv.mjs):
//   BP_KNOBS=<json>   patched through `__burial.set` before the mode (absent on main: exit 2, a patch has nothing to act on)
//   BP_RED=<variant>  an opt-in RED, never part of the default run: it must fail ITS bar (exit 5; 3 = it did not). disguise:
//                     ridge | shallow | steep | late; breath: still; programs: lazy; rise: noshove | tearable | early | nofoot | sunk | noplume. Applied through `__burial.set` too, so it needs a build that has `__burial`, except
//                     `ridge` on main: main already is the shipped ridge, the unpatched reading is that RED (exit 5 there).
//   BP_AT=<where>     where he stands for the modes that place him: anchor (Alt+6's harpoon anchor) | crest (on her) | off
//                     (clear of her ground) | front (rise: 2.3 R in front of her). `disguise` is geometry only and does not place him (the value is still checked).
//   BP_NOPLUG=1       the drift RED: plug(c, { stop: false }), the counter on and clock.stop() skipped. It must print CLOCK LOST
//                     with a NUMERIC drift over 0.05 s (exit 4). A missing reading is exit 2 and is not the RED.
//   BP_CHECK=<list>   disguise: legs,claws,eyes,mouth,wards,reef,weed,sides,top,len,repose (crest = top + len; height = top, the crest's
//                     height alone, as the plan's briefs name it),clutch,seam,pole,iron (harpoon = seam + pole + iron: Task 4)
//   BP_SHELL_D=<u>    rise (iShell): the depth bound in u (default 0.3, the bar); for a ruling, or to show where a RED lies against the build
//   BP_OUT=<file>     the JSON (default ~/sc/.abyssa-wt/reviews/buried/burial-<mode>-<tag>.json); BP_TAG=<tag> (default port<port>)
// (an empty DRV_PORT is +'' = 0, an integer: the port must be all digits and inside 1024-65535, as drv.mjs's start() demands)
const P = /^\d+$/.test(process.env.DRV_PORT || '') ? +process.env.DRV_PORT : NaN;
if (!Number.isInteger(P) || P < 1024 || P > 65535 || [8777, 8790, 9419].includes(P)) { console.error(`burial-probe: set DRV_PORT to a port of its own, an integer in 1024-65535 (not 8777 / 8790 / 9419; got ${JSON.stringify(process.env.DRV_PORT)})`); process.exit(2); }
const MODES = ['disguise', 'breath', 'programs', 'rise', 'digin', 'reentry', 'wound'], BUILT = ['disguise', 'breath', 'programs', 'rise', 'digin', 'reentry', 'wound'];
const [, , MODE, PORT] = process.argv;
if (!MODES.includes(MODE) || !/^\d+$/.test(PORT || '')) { console.error('usage: DRV_PORT=<own> node tools/bench/burial-probe.mjs <' + MODES.join('|') + '> <game port>'); process.exit(2); }
if (!BUILT.includes(MODE)) { console.error(`burial-probe: mode ${MODE} is not built yet (a later task of the velkath-buried-rock plan adds it)`); process.exit(2); }
// (ridge's `crest`: RULED (controller, Task 1 ledger) as the crest GROUP, which fails if its top OR its length fails. main's ridge is
// 19.8 u long, inside 16-24, so `len` can never fail for it and the group fails on `top` alone: bars ['sides', 'top'] are the same
// verdict on the shipped ridge, nothing loosened (its top, 8.02 u, and its sides, +6.62 u, are what make it a ridge). A crest with
// n 0 (no shell vertex over the sand in the strip) is FAIL, not UNMEASURED: also ruled there)
const REDS = { disguise: { ridge: { set: { on: 0 }, bars: ['sides', 'top'], mainIsIt: true }, shallow: { set: { crest: 5.5 }, bars: ['top'] },
    steep: { set: { repose: 2.0 }, bars: ['repose'] },
    // late (Task 6): the clutch seated AFTER the sink, as bedDown would if it kept the shipped order (page side: brood.seat() on the sunk
    // pose, then the lobes rest on the sunk floor with their tops out of the sand)
    late: { set: {}, bars: ['clutch'], page: true } },
  breath: { still: { set: { breath: { lift: 0 } }, bars: ['amp'] } },
  programs: { lazy: { set: {}, bars: ['rise'], page: true } },
  // (Task 7a) at: the only BP_AT the RED is written for
  // (a) is judged by its PARTS for the holdRise REDs, each the part its brief names (with the holds off, her threat comes on from close
  // range too, so (a) whole would fail at the crest for the hammer's reason and prove nothing about the tear): aTear = a tear from E to
  // STOOD; aHammer = threatE > 0 or nsT > 0 from E to STOOD (a blow cocked, a drop counting)
  // (controller's ruling, Task 7a NEEDS_CONTEXT) tearable is a FORCED-CONTACT case (force: BP_FORCE's hold, below): the old crest placement
  // could not reach her in the window the hold adds. footing: Task 7a's footing RED, judged on the build BEFORE the footing fix (1ddae5e)
  rise: { noshove: { set: { shoveV: 0, shoveStag: 0 }, bars: ['b'] }, tearable: { set: { holdRise: 0 }, bars: ['aTear'], at: 'crest', force: true },
    early: { set: { holdRise: 0 }, bars: ['aHammer'], at: 'front' },
    // (g)'s RED as a knob (BURY.footRise 0: her crest's footing vanishes on the wake frame, 1ddae5e's behaviour), at the crest with no shove
    // (thrown off the crest's pinnacle he may fall: unthrown he must stay on it)
    nofoot: { set: { footRise: 0, shoveV: 0, shoveStag: 0 }, bars: ['g'], at: 'crest' },
    // (Task 7b fix round 1, I1) sunk: a piece forced 0.5 u into her drawn shell (page side: R.sink) -> (iShell), the slabs' shell side
    sunk: { set: {}, bars: ['iShell'], page: true },
    // (Task 8) noplume: no rise plume -> she never loses him, and there is no cloud to spread or climb
    noplume: { set: { plume: 0 }, bars: ['blind', 'footprint', 'climb'] } },
  // (Task 12) runs: the only BP_RUNS the RED is written for
  digin: { fastdig: { set: { digT: 8 }, bars: ['dur'], runs: ['clear'] }, nopause: { set: { pause: 0 }, bars: ['pause'], runs: ['pause'] } },
  reentry: { keepdig: { set: {}, page: true, bars: ['dormant', 'cue'], runs: ['iii'] },
    // (Task 13) a second ward flagged remembered after the return -> the second rise's rise.c (memN <= 1)
    mem2: { set: {}, page: true, bars: ['rise.c'], runs: ['iii'] } },
  // (oldwound) the wound hidden page-side before the reads
  wound: { noscar: { set: {}, page: true, bars: ['d10.range', 'd6.mark', 'anchor.read'] } } };
const RED = process.env.BP_RED || '';
if (RED === 'lazy' && !process.env.BP_BASE) { console.error('BP_RED=lazy needs BP_BASE (a programs JSON of the base build): the base itself compiles in the rise, so the rise bar alone cannot tell the RED from it'); process.exit(2); }
if (RED && !(REDS[MODE] && REDS[MODE][RED])) { console.error(`BP_RED: mode ${MODE} has ${REDS[MODE] ? 'the variants ' + Object.keys(REDS[MODE]).join(', ') : 'no RED variant'} (got ${JSON.stringify(RED)})`); process.exit(2); }
const AT = process.env.BP_AT || '';
if (AT && !['anchor', 'crest', 'off', 'front', 'dune', 'under'].includes(AT)) { console.error(`BP_AT: anchor | crest | off | front | dune | under (got ${JSON.stringify(AT)})`); process.exit(2); }
const SHELL_D = process.env.BP_SHELL_D == null ? 0.3 : +process.env.BP_SHELL_D;
if (!(SHELL_D > 0 && SHELL_D <= 2)) { console.error(`BP_SHELL_D: a depth in u, 0 < d <= 2 (default 0.3; got ${JSON.stringify(process.env.BP_SHELL_D)})`); process.exit(2); }
const OFF_D = process.env.BP_OFF == null ? 12 : +process.env.BP_OFF;
if (!(OFF_D > 0 && OFF_D <= 60) || (process.env.BP_OFF != null && MODE !== 'rise')) { console.error(`BP_OFF: rise's off placement, 0 < u <= 60 (got ${JSON.stringify(process.env.BP_OFF)})`); process.exit(2); }
let PLUME_P = null;
if (process.env.BP_PLUME) { try { PLUME_P = JSON.parse(process.env.BP_PLUME); } catch (e) { console.error('BP_PLUME is not JSON: ' + e.message); process.exit(2); } if (MODE !== 'rise') { console.error('BP_PLUME is rise\'s'); process.exit(2); } }
const FORCE = process.env.BP_FORCE === '1' || !!(RED && REDS[MODE][RED].force);
if (FORCE && MODE !== 'rise') { console.error('BP_FORCE is rise\'s'); process.exit(2); }
if (RED && REDS[MODE][RED].at && (AT || 'anchor') !== REDS[MODE][RED].at) { console.error(`BP_RED ${RED} is written for BP_AT=${REDS[MODE][RED].at} (got ${JSON.stringify(AT || 'anchor')})`); process.exit(2); }
// (Task 12) BP_RUNS: digin clear | pause | afloat | crest | offbed | early | throwpose | throwfit, reentry i | ii | iii | iv (default all; a RED's own runs)
const RUNS_ALL = { digin: ['clear', 'pause', 'afloat', 'crest', 'offbed', 'early', 'throwpose', 'throwfit'], reentry: ['i', 'ii', 'iii', 'iv'] };
let RUNS = RUNS_ALL[MODE] || null;
if (process.env.BP_RUNS) {
  if (!RUNS) { console.error('BP_RUNS is digin\'s and reentry\'s'); process.exit(2); }
  const want = process.env.BP_RUNS.split(',').map(q => q.trim()).filter(Boolean);
  if (!want.length || want.some(q => !RUNS.includes(q))) { console.error(`BP_RUNS: ${RUNS.join(',')} (got ${JSON.stringify(process.env.BP_RUNS)})`); process.exit(2); }
  RUNS = want;
}
if (RED && REDS[MODE][RED].runs) {
  if (process.env.BP_RUNS && RUNS.join() !== REDS[MODE][RED].runs.join()) { console.error(`BP_RED ${RED} is written for BP_RUNS=${REDS[MODE][RED].runs.join(',')}`); process.exit(2); }
  RUNS = REDS[MODE][RED].runs;
}
const HUNT_S = process.env.BP_HUNT == null ? 6 : +process.env.BP_HUNT;
// (final review item 6) digin's offbed run: her bed moved OFFBED_D u along her sand side and OFFBED_YAW rad at the calm (the walk home stops
// within 3 u of it: she lies down ~3 u off the bed she was built on); premise OFFBED_MIN u off it at the dig-in
const OFFBED_D = 6, OFFBED_YAW = 0.1, OFFBED_MIN = 2.0;
// (Task 12) BP_SHOTS=<prefix>: digin's clear run takes stills (mid dig-in at bury ~0.42 with him 25 u off, the scar dug in from 3.5 u, night 8 u off
// the strip's edge) into ~/sc/.abyssa-wt/shots/buried/<prefix>-{mid,scar,night}.png; its frames are rendered there, so its cost bar is not a reading
const SHOTS = process.env.BP_SHOTS || '';
if (SHOTS && (!/^[\w.-]+$/.test(SHOTS) || MODE !== 'digin')) { console.error('BP_SHOTS: a plain prefix, digin only'); process.exit(2); }
if (!(HUNT_S >= 0 && HUNT_S <= 30)) { console.error('BP_HUNT: 0-30 s'); process.exit(2); }
let KNOBS = null;
if (process.env.BP_KNOBS) { try { KNOBS = JSON.parse(process.env.BP_KNOBS); } catch (e) { console.error('BP_KNOBS is not JSON: ' + e.message); process.exit(2); } }
const CHECKS = ['legs', 'claws', 'eyes', 'mouth', 'wards', 'reef', 'weed', 'sides', 'top', 'len', 'exposed', 'repose', 'clutch', 'seam', 'pole', 'iron', 'scar', 'coral'];
let ONLY = null;
if (process.env.BP_CHECK) {
  ONLY = process.env.BP_CHECK.split(',').map(s => s.trim()).filter(Boolean).flatMap(s => s === 'crest' ? ['top', 'len'] : s === 'height' ? ['top'] : s === 'rock' ? ['top', 'exposed'] : s === 'harpoon' ? ['seam', 'pole', 'iron'] : [s]);
  const bad = ONLY.filter(s => !CHECKS.includes(s));
  if (bad.length || !ONLY.length) { console.error(`BP_CHECK: ${CHECKS.join(',')},crest,height,harpoon (got ${JSON.stringify(process.env.BP_CHECK)})`); process.exit(2); }
  if (MODE !== 'disguise') { console.error(`BP_CHECK is disguise's (mode ${MODE} judges all its bars)`); process.exit(2); }
}

const { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } = await import('node:fs');
const { tmpdir, homedir } = await import('node:os');
const { join, dirname } = await import('node:path');
// a fresh profile (no save, no caches), the debug port refused if it is taken, only OUR Chrome ever stopped. DRV_PORT is set above,
// before this dynamic import (a static import is hoisted above the check and drv.mjs's DBG would already have been 9419)
process.env.DRV_DIR = mkdtempSync(join(tmpdir(), 'abyssa-burial-probe-'));
const { start, stop, connect, sleep } = await import('./drv.mjs');
const { plug, drift, unmeasured, lost, CLOCK_LOST } = await import('./clockplug.mjs');
let chromeStarted = false;
process.on('exit', () => { if (chromeStarted) stop(); try { rmSync(process.env.DRV_DIR, { recursive: true, force: true }); } catch (e) { } });
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(130));

// BURY_DEFAULT (the crest strip's default ellipse) and the page side of `disguise`: see the header
const DISGUISE = `(async () => {
  const THREE = await import('three'), T = await import('/src/world/terrain.js');
  const L = window.lev; if (!L || L.kind !== 'brooder' || !(L.dormant || L.dugIn)) return { err: 'no dormant or dug-in brooder (' + (L && L.kind) + ')' };
  L.grp.updateMatrixWorld(true);
  const B = window.__burial || null;
  const BD = { crestL: 20, crestW: 6, crestZ: -0.07 };            // BURY_DEFAULT: main has no __burial
  const sand = (x, z) => Math.max(T.terrainH(x, z, 0), B && B.sandAt ? B.sandAt(x, z) : -1e9);   // (sandAt / inStrip from Task 3a)
  const inv = new THREE.Matrix4().copy(L.body.matrixWorld).invert(), v = new THREE.Vector3(), lv = new THREE.Vector3();
  const m = new THREE.Matrix4(), m2 = new THREE.Matrix4();
  const stripEll = (lx, lz) => { const a = BD.crestW / 2 / L.R, b = BD.crestL / 2 / L.R, q = lz - BD.crestZ; return (lx / a) ** 2 + (q / b) ** 2 < 1; };
  // THE STRIP (Task 3a fix round 3, the controller's ruling on review N1): where she has a mound, the BRIEF'S band, computed here
  // from the mound itself and never from the build's inStrip: inside the straight edge, between the two bearings round the point,
  // through ring 0's ends pushed out 0.6 u (the brief's dl), i.e. ring 0's edge + 0.6 u, whatever contour the mesh's ring 1 runs on.
  // With no mound (main, BP_RED=ridge's {on:0} rebuild) the default ellipse, as main reads it
  const stripMD = (x, z) => { const MD = L.mound, NB = MD.COLS, NR = MD.NR, DT = Math.PI * 2 / NB, dlr = 0.6 / MD.R;
    const dx = x - MD.cx, dz = z - MD.cz, lx = (dx * MD.c - dz * MD.s) / MD.R, qz = (dx * MD.s + dz * MD.c) / MD.R - MD.crestZ, rho = Math.hypot(lx, qz);
    let a = Math.atan2(qz, lx) / (Math.PI * 2); if (a < 0) a += 1;
    const fa = a * NB, b0 = Math.floor(fa) % NB, b1 = (b0 + 1) % NB, t = fa - Math.floor(fa);
    const r0 = MD.RR[b0 * NR] + dlr, r1 = MD.RR[b1 * NR] + dlr;
    return rho < r0 * r1 * Math.sin(DT) / (r0 * Math.sin(t * DT) + r1 * Math.sin((1 - t) * DT)); };
  const inStrip = (x, z) => L.mound ? stripMD(x, z) : (lv.set(x, L.bodyY, z).applyMatrix4(inv), stripEll(lv.x, lv.z));
  const worst = {}, n = {};
  const book = (part, x, y, z) => { const d = y - sand(x, z); if (part !== 'reef' && part !== 'weed') n[part] = (n[part] || 0) + 1;
    if (!(part in worst) || d > worst[part].d) worst[part] = { d: +d.toFixed(3), at: [+x.toFixed(1), +y.toFixed(1), +z.toFixed(1)] }; };
  const mesh = (part, o, stride = 1) => { o.updateMatrixWorld(true); const P = o.geometry.attributes.position;
    const each = mw => { for (let i = 0; i < P.count; i += stride) { v.fromBufferAttribute(P, i).applyMatrix4(mw); book(part, v.x, v.y, v.z); } };
    if (o.isInstancedMesh) for (let k = 0; k < o.count; k++) { o.getMatrixAt(k, m); each(m2.multiplyMatrices(o.matrixWorld, m)); } else each(o.matrixWorld); };
  for (const k of ['coxa', 'femur', 'tibia', 'dactyl']) mesh('legs', L.legs[k], 3);
  for (const c of L.claws) for (const o of [c.merus, c.carpus, c.palm, c.dact]) mesh('claws', o, 3);
  mesh('eyes', L.parts.eyes); if (L.parts.stalks) mesh('eyes', L.parts.stalks);
  for (const q of L.mouth) mesh('mouth', q.hook, 3);
  for (const g of L.sigils) book('wards', g.grp.position.x, g.grp.position.y, g.grp.position.z);
  // the growth on her back, outside the strip only (a sea fan standing out of a dune is a tell; on the rock it is growth). n counts
  // EVERY vertex of the growth examined, drawn or not (the vacuity floor is the growth itself: buried, the growth outside the strip
  // is hidden and books nothing, which is the best outcome, not a missing measurement); every DRAWN vertex outside the strip is booked
  // (out[part]), the reef's by its drawn index (all three corners of every drawn triangle), a frond's unless it is scaled to 0
  const outN = {}, grow = (part, o) => { o.updateMatrixWorld(true); const P = o.geometry.attributes.position, I = o.geometry.index;
    const at = (i, mw) => { v.fromBufferAttribute(P, i).applyMatrix4(mw); if (!inStrip(v.x, v.z)) { outN[part] = (outN[part] || 0) + 1; book(part, v.x, v.y, v.z); } };
    if (o.isInstancedMesh) { for (let k = 0; k < o.count; k++) { o.getMatrixAt(k, m); n[part] = (n[part] || 0) + Math.ceil(P.count / 2);
      if (m.elements[0] === 0 && m.elements[5] === 0) continue;   // (a buried frond: scale 0)
      m2.multiplyMatrices(o.matrixWorld, m); for (let i = 0; i < P.count; i += 2) at(i, m2); } }
    else if (I) { const ix = I.array, seen = new Uint8Array(P.count); for (let q = 0; q < ix.length; q++) seen[ix[q]] = 1;   // (the index DRAWN: buried, burial.js swaps in the strip's own)
      n[part] = (n[part] || 0) + P.count; for (let i = 0; i < P.count; i++) if (seen[i]) at(i, o.matrixWorld); }
    else { n[part] = (n[part] || 0) + Math.ceil(P.count / 2); for (let i = 0; i < P.count; i += 2) at(i, o.matrixWorld); } };
  if (L.parts.reef) grow('reef', L.parts.reef);
  if (L.parts.coral) grow('reef', L.parts.coral);   // (Task 5b: the coral on the exposed rock, her reef's parts in its material: judged as the reef)
  if (L.parts.weed) grow('weed', L.parts.weed);
  // (final review item 6) THE CORAL ON THE ROCK OF THIS BED, by growRock's own rule at the source (burial.js: every vertex of every part on
  // the strip): every drawn coral vertex inside THIS bed's strip (the probe's own band, stripMD of the live mound); its vertices under the
  // drawn sand (terrain or dune) booked. After a dig-in the strip is the NEW bed's while the coral is the first bed's lay riding her body (the
  // dig-in does not lay it again): coral drifting out of the strip she lies in now reads outside it
  let coral = null;
  if (L.parts.coral && L.parts.coral.visible && L.parts.coral.geometry.attributes.position) {
    const co = L.parts.coral; co.updateMatrixWorld(true); const P = co.geometry.attributes.position;
    let n = 0, outB = 0, under = 0, low = null, wOut = null;
    for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i).applyMatrix4(co.matrixWorld); n++; const d = v.y - sand(v.x, v.z), at = [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)];
      if (!inStrip(v.x, v.z)) { outB++; if (!wOut) wOut = at; }
      if (d < 0) under++;
      if (!low || d < low.d) low = { d: +d.toFixed(3), at }; }
    coral = { n, outBand: outB, under, low, firstOut: wOut };
  }
  // her shell: sides vs crest
  const sh = L.parts.shell, P = sh.geometry.attributes.position; sh.updateMatrixWorld(true);
  let top = -1e9, zLo = 1e9, zHi = -1e9, ne = 0, sides = { d: -1e9, at: null };
  for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i).applyMatrix4(sh.matrixWorld); const d = v.y - sand(v.x, v.z);
    if (!inStrip(v.x, v.z)) { if (d > sides.d) sides = { d: +d.toFixed(3), at: [+v.x.toFixed(1), +v.y.toFixed(1), +v.z.toFixed(1)] }; continue; }
    if (d > 0.02) { ne++; top = Math.max(top, v.y); lv.copy(v).applyMatrix4(inv); zLo = Math.min(zLo, lv.z); zHi = Math.max(zHi, lv.z); } }
  // (Task 5b) THE EXPOSED ROCK: every drawn shell triangle whose three corners all stand > +0.02 u over the drawn sand, its true area
  // (u^2); face = those whose corners all stand >= 1.0 u over it; tips = exposed vertices >= 0.5 u over the sand, the highest within
  // 1.0 u (plan) of themselves (info)
  const exp = (() => { const W = new Float32Array(P.count * 4), I = sh.geometry.index;
    for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i).applyMatrix4(sh.matrixWorld); W[i * 4] = v.x; W[i * 4 + 1] = v.y; W[i * 4 + 2] = v.z; W[i * 4 + 3] = v.y - sand(v.x, v.z); }
    const nt = I ? I.count / 3 : P.count / 3, ix = k => I ? I.array[k] : k, a = new THREE.Vector3(), b = new THREE.Vector3(), c3 = new THREE.Vector3();
    let area = 0, face = 0, nTri = 0;
    for (let t = 0; t < nt; t++) { const i0 = ix(t * 3), i1 = ix(t * 3 + 1), i2 = ix(t * 3 + 2), h = Math.min(W[i0 * 4 + 3], W[i1 * 4 + 3], W[i2 * 4 + 3]);
      if (!(h > 0.02)) continue;
      a.set(W[i0 * 4], W[i0 * 4 + 1], W[i0 * 4 + 2]); b.set(W[i1 * 4], W[i1 * 4 + 1], W[i1 * 4 + 2]); c3.set(W[i2 * 4], W[i2 * 4 + 1], W[i2 * 4 + 2]);
      const ar = b.sub(a).cross(c3.sub(a)).length() / 2; area += ar; nTri++; if (h >= 1.0) face += ar; }
    const up = []; for (let i = 0; i < P.count; i++) if (W[i * 4 + 3] >= 0.5) up.push(i);
    let tips = 0;
    for (const i of up) { let top = true; for (const j of up) { if (j === i || W[j * 4 + 1] <= W[i * 4 + 1]) continue; const dx = W[j * 4] - W[i * 4], dz = W[j * 4 + 2] - W[i * 4 + 2]; if (dx * dx + dz * dz < 1) { top = false; break; } } if (top) tips++; }
    return { area: +area.toFixed(2), face: +face.toFixed(2), n: nTri, tips }; })();
  // the mean ground under her: poseAll's 5 x 5 support grid
  const cy = Math.cos(L.yaw), sy = Math.sin(L.yaw); let g = 0;
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) { const lx = (-0.8 + 0.4 * i) * L.R, lz = (-0.84 + 0.425 * j) * L.R;
    g += T.terrainH(L.pos.x + lx * cy + lz * sy, L.pos.z - lx * sy + lz * cy, 0); }
  g /= 25;
  // THE REPOSE (header; fix round 2 of Task 3a: the skipped area narrowed to row 0, the bar a fixed 33.81 deg). Every triangle of
  // the mound's quad rows 1 .. NI-1, read off MD.M (the fit; the breath excluded)
  let repose = null;
  if (L.mound && B && B.knobs) {
    const MD = L.mound, NB = MD.COLS, NR = MD.NR, NI = NR - 2, Mm = MD.M, NEED = MD.NEED;
    const tris = []; let wst = null, tall = null, nDeg = 0;
    const tri = (i, j, t, ia, ib, ic) => {
      const ax = Mm[ia * 3], ay = Mm[ia * 3 + 1], az = Mm[ia * 3 + 2], bx = Mm[ib * 3], by = Mm[ib * 3 + 1], bz = Mm[ib * 3 + 2], cx = Mm[ic * 3], cy = Mm[ic * 3 + 1], cz = Mm[ic * 3 + 2];
      const d = (bx - ax) * (cz - az) - (cx - ax) * (bz - az), span = Math.max(ay, by, cy) - Math.min(ay, by, cy);
      let deg;
      if (Math.abs(d) < 2e-6) { nDeg++; if (span <= 0.005) return; deg = 90; }
      else { const gx = ((by - ay) * (cz - az) - (cy - ay) * (bz - az)) / d, gz = ((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / d; deg = Math.atan(Math.hypot(gx, gz)) * 180 / Math.PI; }
      // (clamped corners: the corner's height is its cover requirement, over the floor: where the fit pinned it)
      let cl = 0; for (const q of [ia, ib, ic]) if (NEED[q] > -1e8 && Math.abs(Mm[q * 3 + 1] - NEED[q]) < 1e-6 && NEED[q] > T.terrainH(Mm[q * 3], Mm[q * 3 + 2], 0) + 1e-6) cl++;
      tris.push([i, j, t, +deg.toFixed(2), +span.toFixed(3), cl]);
      const at = [+((ax + bx + cx) / 3).toFixed(1), +((ay + by + cy) / 3).toFixed(1), +((az + bz + cz) / 3).toFixed(1)];
      if (!wst || deg > wst.deg) wst = { deg: +deg.toFixed(2), span: +span.toFixed(3), ring: i, bearing: j, at };
      if (deg > 33.81 && (!tall || span > tall.span)) tall = { deg: +deg.toFixed(2), span: +span.toFixed(3), ring: i, bearing: j, at }; };
    // (the triangles AS DRAWN: makeMound's index holds quad (row i, column j)'s two at ((i NB + j) 2 + half) 3; the fit may pick
    // either diagonal of a quad, so they are read from the index, never assumed)
    const IX = MD.geo.index.array;
    for (let i = 1; i <= NI - 1; i++) for (let j = 0; j < NB; j++) for (let h = 0; h < 2; h++) {
      const o = ((i * NB + j) * 2 + h) * 3; tri(i, j, h, IX[o], IX[o + 1], IX[o + 2]); }
    const over = x => tris.filter(q => q[3] > x).length;
    repose = { barDeg: 33.81, n: tris.length, nDeg, worst: wst, tallestSteep: tall, over33: over(33.81), over45: over(45), over60: over(60),
      over45tall: tris.filter(q => q[3] > 45 && q[4] > 0.2).length, tris };
  }
  const out = { worst, n, outN, sides, crest: { top: +(top - g).toFixed(2), len: ne ? +((zHi - zLo) * L.R).toFixed(1) : 0, n: ne }, exposed: exp, growN: L.growN || null, weedN: L.parts.weed ? L.parts.weed.count : null, buried: !!(B && L.buried), bury: L.bury ?? null, repose, coral };
  // (Task 4) THE HARPOON, against the drawn SAND (sand(): the floor or the dune, never the crest), as harpoon.js seat() judges it: the
  // seam's height over it, and every pole sample's (model z -0.1 .. -0.95 through H.worldM, the lodged pose). Only an iron still in her
  const H = L.harpoon;
  if (H && !H.pulled && H.seated && H.worldM) {
    const pole = [];
    for (const z of [-0.1, -0.3, -0.55, -0.8, -0.95]) { v.set(0, 0, z).applyMatrix4(H.worldM); pole.push({ z, d: +(v.y - sand(v.x, v.z)).toFixed(3), at: [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)] }); }
    const sm = H.seamWorld();
    // THE IRON IN HER (Task 4 ruling: an independent check, never the build's own seatOk alone): harpoon-probe's 'lodged' test, its logic
    // and its points: each head / shank point (model coords through H.worldM, the lodged pose) cast against her DRAWN shell (DoubleSide for
    // the test) along +-Y and +-the seam normal; INSIDE = every first hit is an exit face, depth = the nearest. Head >= 0.1 u, shank >= 0
    const shl = L.parts.shell, side0 = shl.material.side; shl.material.side = THREE.DoubleSide;
    const rc = new THREE.Raycaster(), nm = new THREE.Matrix3(), wn = new THREE.Vector3(), nn = H.normal.clone();
    const dirs = [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0), nn.clone(), nn.clone().negate()];
    const inside = p => { let dmin = 1e9;
      for (const d of dirs) { rc.set(p, d); rc.far = 40; const h = rc.intersectObject(shl, false)[0]; if (!h) return -1;
        nm.getNormalMatrix(shl.matrixWorld); wn.copy(h.face.normal).applyMatrix3(nm).normalize(); if (wn.dot(d) <= 0) return -1; dmin = Math.min(dmin, h.distance); }
      return dmin; };
    const HEAD = { tip: [0, 0, 0.62], mid: [0, 0, 0.52], barbL: [0.06, 0, 0.45], barbR: [-0.06, 0, 0.45], pin: [0, 0, 0.448], shank: [0, 0, 0.25] }, iron = {};
    let ironOk = true;
    for (const k in HEAD) { const p = new THREE.Vector3(...HEAD[k]).applyMatrix4(H.worldM), d = +inside(p).toFixed(3), need = k === 'shank' ? 0 : 0.1;
      iron[k] = d; if (!(d >= need)) ironOk = false; }
    shl.material.side = side0;
    out.harpoon = { seatOk: !!H.seatOk, seam: +(sm.y - sand(sm.x, sm.z)).toFixed(3), seamAt: [+sm.x.toFixed(2), +sm.y.toFixed(2), +sm.z.toFixed(2)], pole, poleMin: Math.min(...pole.map(q => q.d)),
      iron, ironIn: ironOk };
  } else out.harpoon = null;
  // (Task 12) THE SCAR, where the iron came out (or the revisit's old wound): its centre, the scar mesh's world origin (harpoon.js lays it
  // flush on the seam, its +Z out along the normal), over the drawn sand
  if (H && H.pulled && H.scar && H.scar.visible) { v.setFromMatrixPosition(H.scar.matrixWorld);
    out.scar = { d: +(v.y - sand(v.x, v.z)).toFixed(3), at: [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)] }; } else out.scar = null;
  // (Task 6) THE CLUTCH: every live lobe's top, in WORLD, against the drawn sand over its centre. L.brood.live is x y z r per lobe in the body's
  // frame (the shell units the lobes are authored in; the body matrix carries R, the sink and the tilt). A lobe's drawn skin stands to
  // 1.25 r (the bead field's domes and the fillets), so its top is the centre's world y + 1.25 r x the matrix's scale: the sphere's own
  // top, which is never lower than the tilted body-local y + 1.25 r. d = top - sand, bar <= -0.05 on every lobe. Lobes with r 0 (an
  // unseated clutch) are not booked: n counts the lobes judged, the vacuity floor is the lobe count itself
  const Bd = L.brood;
  if (Bd && Bd.seated && Bd.live) {
    const bwm = L.body.matrixWorld, sc = bwm.getMaxScaleOnAxis(), lobes = []; let wc = null;
    for (let k = 0; k < Bd.nL; k++) { const o = k * 4, r = Bd.live[o + 3]; if (!(r > 0)) continue;
      v.set(Bd.live[o], Bd.live[o + 1], Bd.live[o + 2]).applyMatrix4(bwm);
      const top = v.y + 1.25 * r * sc, s = sand(v.x, v.z), d = +(top - s).toFixed(3);
      lobes.push({ k, spill: !!(Bd.lobes[k] && Bd.lobes[k].spill), r: +r.toFixed(4), at: [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)], top: +top.toFixed(3), sand: +s.toFixed(3), d, over: +(top - T.terrainH(v.x, v.z, 0)).toFixed(3) });
      if (!wc || d > wc.d) wc = lobes[lobes.length - 1]; }
    out.clutch = { n: lobes.length, nL: Bd.nL, worst: wc, st: Bd.st, scale: +sc.toFixed(3), lobes };
  } else out.clutch = null;
  return out; })()`;

// the page side of `breath`. PLACE(d): him d u off the strip's edge on her SAND side (where he comes in), facing it; the point
// booked is the ring-1 vertex nearest him (breathTick's own pick for the trickle), or with no mound the drawn sand where ring 1
// would lie (0.6 u outside BURY_DEFAULT's edge). BOOK(n, leg): n stepped frames, every one booked into window.__bpS
const BREATH_PLACE = (d, fromC = false) => `(async () => {
  const T = await import('/src/world/terrain.js');
  const L = window.lev; if (!L || L.kind !== 'brooder' || !(L.dormant || L.dugIn)) return { err: 'no dormant or dug-in brooder (' + (L && L.kind) + ')' };
  const MD = L.mound || null, R = L.R, cy = Math.cos(L.yaw), sy = Math.sin(L.yaw);
  const wx = (lx, lz) => L.pos.x + (lx * cy + lz * sy) * R, wz = (lx, lz) => L.pos.z + (-lx * sy + lz * cy) * R;
  let ex, ez, cx, cz, src;
  if (MD) { const j = Math.round((L.sandSide > 0 ? 0 : 0.5) * MD.COLS) % MD.COLS; ex = MD.P[j * 3]; ez = MD.P[j * 3 + 2]; cx = MD.bx; cz = MD.bz; src = 'the mound: ring 1'; }
  else { const a = 6 / 2 / R * L.sandSide, zc = -0.07; ex = wx(a, zc); ez = wz(a, zc); cx = wx(0, zc); cz = wz(0, zc); src = 'no mound: the drawn sand 0.6 u outside the default strip'; }
  let ux = ex - cx, uz = ez - cz; const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
  // (fromC: d u from the strip's centre along the same bearing, not from ring 1's edge: the programs framing, the same spot on any build)
  const x = ${fromC ? 'cx' : 'ex'} + ux * ${d}, z = ${fromC ? 'cz' : 'ez'} + uz * ${d};
  window.__bench.place(x, z, Math.atan2(ex - x, ez - z), 0);
  window.player.pos.y = T.shutFloorY(x, z, 0) + 1.35; window.player.vel.set(0, 0, 0);
  let bj = -1, px = ex + ux * 0.6, pz = ez + uz * 0.6;
  if (MD) { let best = 1e9; for (let j = 0; j < MD.COLS; j++) { const o = (MD.COLS + j) * 3, dd = Math.hypot(MD.P[o] - x, MD.P[o + 2] - z); if (dd < best) { best = dd; bj = j; } }
    px = MD.P[(MD.COLS + bj) * 3]; pz = MD.P[(MD.COLS + bj) * 3 + 2]; }
  window.__bpPt = { bj, px, pz };
  return { d: ${d}, src, edge: [+ex.toFixed(2), +ez.toFixed(2)], him: [+x.toFixed(2), +z.toFixed(2)], bj, pt: [+px.toFixed(2), +pz.toFixed(2)],
    dPt: +Math.hypot(px - x, pz - z).toFixed(2), tr0: L.trickleN || 0, age0: L.brAge ?? null };
})()`;
// per frame: [leg, y, trickleN, brAge, breathY, dormant, him to the nearest ring-1 vertex (or the point), the lens to her centre]
const BREATH_BOOK = (n, leg) => `(async () => {
  const T = await import('/src/world/terrain.js'), { camera } = await import('/src/core.js');
  const L = window.lev, MD = L.mound || null, Q = window.__bpPt, B = window.__burial, p = window.player.pos;
  const S = window.__bpS || (window.__bpS = []);
  window.__bench.step(${n}, () => {
    const y = MD ? MD.P[(MD.COLS + Q.bj) * 3 + 1] : Math.max(T.terrainH(Q.px, Q.pz, 0), B && B.sandAt ? B.sandAt(Q.px, Q.pz) : -1e9);
    let dh = Math.hypot(Q.px - p.x, Q.pz - p.z);
    if (MD) for (let j = 0; j < MD.COLS; j++) { const o = (MD.COLS + j) * 3, dd = Math.hypot(MD.P[o] - p.x, MD.P[o + 2] - p.z); if (dd < dh) dh = dd; }
    S.push([${leg}, +y.toFixed(5), L.trickleN || 0, L.brAge == null ? null : +L.brAge.toFixed(4), +(L.breathY || 0).toFixed(5), L.dormant || L.dugIn ? 1 : 0,
      +dh.toFixed(2), +Math.hypot(camera.position.x - L.pos.x, camera.position.z - L.pos.z).toFixed(2)]);
  });
  return S.length; })()`;

// the page side of `programs` (header). PROG_INSTALL puts window.__bpProg: read(tag) books a checkpoint (count, the '|crust' programs,
// __shaderFailed(), the programs new since the last read by name); frames(n, tag) steps n RENDERED frames booking the count (and, off
// home, the crust's uBury) on every frame; control() / uncontrol() the positive control; shellKey() her shell's program's cacheKey
const PROG_INSTALL = `(async () => {
  const THREE = await import('three'), { renderer, scene, camera } = await import('/src/core.js');
  const P = () => renderer.info.programs;
  let seen = new Set(P().map(p => p.cacheKey));
  const failed = () => window.__shaderFailed ? window.__shaderFailed().length : -1;
  const crustN = () => P().filter(p => p.cacheKey.indexOf('|crust') >= 0).length, bareN = () => P().filter(p => p.cacheKey.indexOf('|vkRim') >= 0 && p.cacheKey.indexOf('|crust') < 0).length;
  const S = window.__bpProg = { series: [], marks: [],
    read(tag) { const now = P(), nw = now.filter(p => !seen.has(p.cacheKey)).map(p => (p.name || p.cacheKey.split(',')[0].slice(0, 40)) + ' ~' + p.cacheKey.slice(-60).replace(/,/g, ' '));
      seen = new Set(now.map(p => p.cacheKey));
      const m = { tag, n: now.length, crust: crustN(), bare: bareN(), failed: failed(), newNames: nw, frames: S.series.length }; S.marks.push(m); return m; },
    // (Task 7b) sl: the slabs' mesh drawn this frame (visible, in the lens's frustum by its bounding sphere): the frames the slabs' own draw
    // could compile on
    frames(n, tag) { const L = window.lev; let mx = -1, bmx = -1, sln = 0;
      window.__bench.step(n, () => { const c = P().length; if (c > mx) mx = c; const b = L && L.crustU ? L.crustU.uBury.value : null; if (b != null && b > bmx) bmx = b;
        let sl = 0; const Sm = L && L.slabs && L.slabs.mesh;
        if (Sm && Sm.visible) { const g = Sm.geometry; if (!g.boundingSphere) g.computeBoundingSphere(); Sm.updateMatrixWorld(true); camera.updateMatrixWorld(true);
          const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
          sl = fr.intersectsSphere(g.boundingSphere.clone().applyMatrix4(Sm.matrixWorld)) ? 1 : 0; }
        sln += sl;
        S.series.push([tag, c, b == null ? null : +b.toFixed(4), L && L.dormant ? 1 : 0, sl]); }, { render: true });
      return { max: mx, buryMax: bmx < 0 ? null : bmx, slabFrames: sln }; },
    shellKey() { const L = window.lev, pr = L && L.parts && L.parts.shell ? renderer.properties.get(L.parts.shell.material).currentProgram : null; return pr ? pr.cacheKey : null; },
    control() { const key = 'bp-control-' + Date.now(), f = new THREE.Vector3(); camera.getWorldDirection(f);
      const m = new THREE.MeshBasicMaterial({ color: 0xff00ff }); m.customProgramCacheKey = () => key;
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), m); box.frustumCulled = false;
      box.position.copy(camera.position).addScaledVector(f, 3); scene.add(box); S.ctl = { box, key };
      const n0 = P().length; window.__bench.step(1, null, { render: true });
      return { n0, n1: P().length, hasKey: P().some(p => p.cacheKey.indexOf(key) >= 0), at: box.position.toArray().map(v => +v.toFixed(2)) }; },
    uncontrol() { const { box, key } = S.ctl; scene.remove(box); box.geometry.dispose(); box.material.dispose(); S.ctl = null;
      seen = new Set(P().map(p => p.cacheKey)); return { n: P().length, hasKey: P().some(p => p.cacheKey.indexOf(key) >= 0) }; },
    lazyRed() { const L = window.lev, m = L.parts.shell.material, k = m.customProgramCacheKey; m.customProgramCacheKey = () => k.call(m) + '|lazyRED'; m.needsUpdate = true; return 1; }
  };
  return { n: P().length, crust: crustN(), hasCrust: !!(window.__burial && window.__burial.crust) }; })()`;

// (g) THE FOOTING, judged off a booked series (a function so a saved JSON can be re-judged: the REDs on 1ddae5e were). from: the first frame
// judged (default the frame before the wake); stood: STOOD's frame (the window's last possible frame)
function FOOTING(S, w, from = null, stood = -1) {
  const f60 = 60, sec = i => +((i - w) / f60).toFixed(3), r = v => Math.round(v * 1000) / 1000, STEP = 0.6;
  // the drawn ground under him (header (g) (i)): the floor / dune / shell rays (gBase) and her carried footing only if last frame's boots were
  // within a step under it. (A series booked before fix round 1 has drawnG only: read as before)
  const G = (q, p) => q.gBase == null ? q.drawnG : Math.max(q.gBase, q.gFoot != null && q.gFoot > -1e8 && (q.pb != null ? q.pb : p.boots) >= q.gFoot - STEP ? q.gFoot : -1e9);
  let lastShell = -99, air = 0, k = 0, tx = 0, tz = 0, throws = 0, falls = 0, gN = 0, tN = 0, gMax = -1e9, gMin = 1e9, last = -1, winS = 0, winN = 0; const gBad = [], tBad = [];
  const i0 = Math.max(1, from == null ? w - 1 : from), iEnd = stood >= 0 ? stood : S.length - 1;
  for (let i = i0; i < S.length; i++) {
    if (i > i0 + 120 && (!air || i > iEnd)) break;
    const q = S[i], p = S[i - 1]; if (q.drawnG == null && q.gBase == null) continue;
    const g = G(q, p), gp = i - 1 >= i0 && (p.drawnG != null || p.gBase != null) ? G(p, S[i - 2] || p) : null, gap = q.boots - g, pg = gp == null ? null : p.boots - gp;
    if (q.shoveN > p.shoveN) { air = 1; k = 0; throws++; tx = p.px; tz = p.pz; }
    else if (!air && pg != null && Math.abs(pg) <= 0.3 && g < gp - 0.3) { air = 2; k = 0; winS = 0; winN = 0; falls++; tx = p.px; tz = p.pz; }
    else if (air && (air === 2 || q.stag <= 0) && Math.abs(gap) <= 0.3) air = 0;
    last = i;
    if (air) { tN++; k++; const vb = (q.boots - p.boots) * f60, onSpot = air === 1 && Math.hypot(q.px - tx, q.pz - tz) < 0.3;
      // (controller ruling 2026-10-20) IN CONTACT WITH HER SHELL'S COLLIDER (BODY.last 'shell' or a shell push this frame): the fall's sink
      // rule pauses; he rises no faster than her body + 0.3 u/s and stands no more than 1.0 u over the drawn ground (her drawn shell)
      if (q.body && (q.body.last === 'shell' || q.body.shell)) lastShell = i;
      const onShell = i - lastShell <= 15, vHer = q.bodyY != null && p.bodyY != null ? (q.bodyY - p.bodyY) * f60 : 0;
      let bad = (onShell ? vb > vHer + 0.3 || gap > 1.0 : vb > 1.0 && gap > 0.3) || gap < -0.3 || (onSpot && Math.abs(gap) > 0.3);
      if (air === 2 && onShell) { winS = 0; winN = 0; }
      else if (air === 2 && k > 6) { if (vb > 0) bad = true; winS += vb; winN++; if (winN === 15) { if (winS / 15 > -0.15) bad = true; winS = 0; winN = 0; } }
      if (bad && tBad.length < 12) tBad.push([sec(i), r(vb), r(gap), air]); }
    else { gN++; if (gap > gMax) gMax = gap; if (gap < gMin) gMin = gap; if (Math.abs(gap) > 0.3 && gBad.length < 12) gBad.push([sec(i), r(gap)]); } }
  return { name: 'g', val: { from: sec(i0), to: sec(last), judged: gN, gapMax: gN ? r(gMax) : null, gapMin: gN ? r(gMin) : null, bad: gBad, throws, falls, airFrames: tN, air: tBad },
    bar: 'boots within +-0.3 u of the drawn ground (her carried footing only within a step of last frame\'s boots); in the air never rising > 1.0 u/s, never under it by > 0.3, on a throw\'s spot within 0.3, a fall sinking (<= 0 per frame, <= -0.15 u/s per 0.25 s after 6 frames)',
    ok: !gBad.length && !tBad.length, vacuous: gN + tN < 30, judged: true };
}
// the page side of `rise` (header). RISE_INSTALL puts window.__bpRise: settle(n) steps n frames booking his footing (not the series);
// step(n) steps n frames booking one row per frame into S (wake = the first row with L.dormant false, recorded as wakeF). Reads the
// sleeper's fields directly (L.probe() counts triangles: too heavy per frame). RISE_PLACE(where) stands him at crest | front.
const RISE_INSTALL = `(async () => {
  const T = await import('/src/world/terrain.js'), BC = await import('/src/entities/sleeper/bodyCols.js'), { camera } = await import('/src/core.js');
  const L = window.lev; if (!L || L.kind !== 'brooder' || !L.dormant) return { err: 'no dormant brooder (' + (L && L.kind) + ')' };
  const B = window.__burial || null, P = window.player, MD = L.mound || null;
  const sand = (x, z) => Math.max(T.terrainH(x, z, 0), B && B.sandAt ? B.sandAt(x, z) : -1e9);
  const cx = MD ? MD.bx : L.pos.x, cz = MD ? MD.bz : L.pos.z;
  const r3 = v => Math.round(v * 1000) / 1000, r2 = v => Math.round(v * 100) / 100;
  const blk = (x, y, z, m) => { for (const h of [0.45, 1.0, 1.6]) if (BC.bodyBlocked(x, y + h, z, m)) return 1; return 0; };
  const THREE = await import('three'), rc = new THREE.Raycaster(), o3 = new THREE.Vector3(), dn = new THREE.Vector3(0, -1, 0), up3 = new THREE.Vector3(0, 1, 0), nm3 = new THREE.Matrix3(), wn3 = new THREE.Vector3();
  // her drawn shell's top under (x, z), searched down from y (the first hit), or -1e9
  const shellTop = (x, y, z) => { L.parts.shell.updateMatrixWorld(true); rc.set(o3.set(x, y, z), dn); rc.far = 40; const h = rc.intersectObject(L.parts.shell, false); return h.length ? h[0].point.y : -1e9; };
  // under his sole's footprint (burial.js BURY.foot.r 0.25, the footing's own disc): the highest of five rays, centre and +-0.25 u
  const shellFoot = (x, y, z) => Math.max(shellTop(x, y, z), shellTop(x + 0.25, y, z), shellTop(x - 0.25, y, z), shellTop(x, y, z + 0.25), shellTop(x, y, z - 0.25));
  // HER CREST'S FOOTING CARRIED BY HER (the controller's ruling: it follows her rising shell): burial.js footY is the walkable envelope over
  // the strip's drawn rock at the FIT pose (MD.mw: her body at bedDown; on the strip it hangs over the drawn rock between spines, the parked
  // strip residual of Task 3b), carried to her body now: (x, y, z) into the fit pose by MD.mw . inv(body now), the envelope read there, and
  // back by body now . inv(MD.mw); two passes (the map's tilt makes x, z depend on y). -1e9 off the envelope or with no burial build
  let BU = null; try { BU = await import('/src/entities/sleeper/burial.js'); } catch (e) { }
  let FF = null; try { FF = await import('/src/world/footfx.js'); } catch (e) { }
  let BRD = null; try { BRD = await import('/src/entities/sleeper/brooder.js'); } catch (e) { }   // (Task 8) SIGHT.reacq, the LOS find's clear time   // (M3) the puff pool's totals; absent on a build without dustStats
  const Mf = new THREE.Matrix4(), Mi = new THREE.Matrix4(), Mc = new THREE.Matrix4(), Mci = new THREE.Matrix4(), q3 = new THREE.Vector3();
  const footCarried = (x, z) => { if (!BU || !BU.footY || !MD || !MD.foot) return -1e9;
    L.body.updateMatrixWorld(true); Mf.fromArray(MD.mw); Mc.copy(L.body.matrixWorld).multiply(Mi.copy(Mf).invert()); Mci.copy(Mc).invert();
    let wy = L.body.matrixWorld.elements[13];
    for (let it = 0; it < 3; it++) { q3.set(x, wy, z).applyMatrix4(Mci); const h = BU.footY(MD, q3.x, q3.z); if (h < -1e8) return -1e9; q3.y = h; q3.applyMatrix4(Mc); wy = q3.y; }
    return wy; };
  let capPrev = null; const COS8 = [], SIN8 = []; for (let i = 0; i < 8; i++) { COS8.push(Math.cos(i * Math.PI / 4)); SIN8.push(Math.sin(i * Math.PI / 4)); }
  // (Task 8, header: footprint / climb) the plume's density field, read off the game's own model (__plume.dens); null without one
  // (AMENDED, header) the rise clouds' density (densKind); a build with no rise kind has none (0); PLA every cloud (booked)
  const PLA = window.__plume && window.__plume.dens ? window.__plume.dens : null;
  const PLD = !PLA ? null : window.__plume.densKind ? (x, y, z) => window.__plume.densKind(x, y, z, 'rise') : window.__plume.kinds && window.__plume.kinds.rise ? null : () => 0;
  const fieldFoot = (PLD) => { if (!PLD) return null; let far = 0, nb = 0, fb = -1;
    for (let b = 0; b < 32; b++) { const a = b * Math.PI / 16, dx = Math.sin(a), dz = Math.cos(a); let fr = 0;
      for (let k = 1; k <= 120; k++) { const rr = k * 0.25, x = cx + dx * rr, z = cz + dz * rr; if (PLD(x, T.terrainH(x, z, 0) + 1.5, z) > 0.02) fr = rr; }
      if (fr > 0) nb++; if (fr > far) { far = fr; fb = b; } }
    return { far, nb, b: fb }; };
  const PROF = new Float64Array(41);
  const fieldPeak = (PLD) => { if (!PLD) return null; let best = 0, bh = null, bx = 0, bz = 0; PROF.fill(0);
    for (let ri = 0; ri <= 10; ri++) { const rr = ri * 2, nbz = ri ? 16 : 1;
      for (let b = 0; b < nbz; b++) { const a = b * Math.PI / 8, x = cx + Math.sin(a) * rr, z = cz + Math.cos(a) * rr, g = T.terrainH(x, z, 0);
        for (let hi = 0; hi <= 40; hi++) { const d = PLD(x, g + hi * 0.5, z); PROF[hi] += d; if (d > best) { best = d; bh = hi * 0.5; bx = x; bz = z; } } } }
    let pm = 0, ph = null; for (let hi = 0; hi <= 40; hi++) if (PROF[hi] > pm) { pm = PROF[hi]; ph = hi * 0.5; }
    return { d: r3(best), h: bh, at: [r2(bx), r2(bz)], prof: ph, profD: r3(pm) }; };
  let fieldN = 0;
  const R = window.__bpRise = { S: [], wakeF: -1, cx, cz, R: L.R,
    foot() { const p = P.pos, fl = T.shutFloorY(p.x, p.z, 0); return { him: [r2(p.x), r2(p.y), r2(p.z)], grounded: !!P.grounded, gap: r3(p.y - 1.35 - fl), sand: r3(p.y - 1.35 - sand(p.x, p.z)),
      xf: r3(T.extraFloorAt(p.x, p.z, 0)), terr: r3(T.terrainH(p.x, p.z, 0)), dC: r2(Math.hypot(p.x - cx, p.z - cz)), dormant: !!L.dormant }; },
    // (BP_FORCE) after a frame, set him in the path of her fastest leg capsule for the next one
    force() {
      const C = BC.bodyColsCaps(), nL = Math.min(40, C.length / 8), Pp = capPrev; capPrev = C;
      if (!Pp || Pp.length !== C.length) return 0;
      let best = -1, bv = 0, bx = 0, by = 0, bz = 0;
      for (let i = 0; i < nL; i++) { const o = i * 8;
        const vx = ((C[o] + C[o + 3]) - (Pp[o] + Pp[o + 3])) * 30, vy = ((C[o + 1] + C[o + 4]) - (Pp[o + 1] + Pp[o + 4])) * 30, vz = ((C[o + 2] + C[o + 5]) - (Pp[o + 2] + Pp[o + 5])) * 30, sp = Math.hypot(vx, vy, vz);
        if (sp > 3 && sp < 18 && sp > bv) { bv = sp; best = i; bx = vx; by = vy; bz = vz; } }
      if (best < 0) return 0;
      const o = best * 8, r = (C[o + 6] + C[o + 7]) / 2, k = (r + 0.25) / bv;
      // the capsule's middle a frame on, then 0.2 u inside his radius (0.45) along its motion: next frame it comes INTO him
      const mx = (C[o] + C[o + 3]) / 2 + bx / 60 + bx * k, my = (C[o + 1] + C[o + 4]) / 2 + by / 60 + by * k, mz = (C[o + 2] + C[o + 5]) / 2 + bz / 60 + bz * k;
      P.pos.set(mx, my + 0.5, mz); P.vel.set(0, 0, 0); P.grounded = false;
      R.forced = (R.forced || 0) + 1; return bv; },
    // (BP_AT=under) on the sand under her centre, afloat 0, still; booked from the next row (R.underF)
    under() { const x = L.pos.x, z = L.pos.z; P.pos.set(x, T.terrainH(x, z, 0) + 1.35, z); P.vel.set(0, 0, 0); P.grounded = true; R.prevBoots = T.terrainH(x, z, 0); R.underF = R.S.length;
      return { at: [r2(x), r2(z)], floor: r3(T.terrainH(x, z, 0)), xf: r3(T.extraFloorAt(x, z, 0)), bodyY: r3(L.bodyY), standE: r3(L.standE), hasStood: !!L.hasStood }; },
    // (Task 7b) the vertex INSIDE her shell (the slab's lowest point under a spine of her drawn top, more than 1.5 u under it: the downward
    // rays start inside her and find nothing, and the floor far below read as a 3.4 u hover, AMENDED after the third green run): an upward
    // ray, both sides, whose first hit faces UP (her top seen from inside) -> that hit's y (the vertex is in her: gap < 0); a hit facing
    // down is her underside over it (an overhang): null, the sand under it is the surface
    shellIn(x, y, z) { const sh = L.parts.shell, s0 = sh.material.side; sh.material.side = THREE.DoubleSide; sh.updateMatrixWorld(true);
      rc.set(o3.set(x, y, z), up3); rc.far = 40; const h = rc.intersectObject(sh, false)[0]; sh.material.side = s0;
      if (!h) return null; nm3.getNormalMatrix(sh.matrixWorld); wn3.copy(h.face.normal).applyMatrix3(nm3); return wn3.y > 0 ? h.point.y : null; },
    // (Task 7b) THE CRUST'S SLABS, read off the DRAWN mesh (L.slabs: { mesh, n, vpc }: n pieces of vpc vertices each, in the mesh's own
    // frame): per piece its lowest drawn vertex (world) and the drawn surface under that vertex (the highest of terrainH, the drawn dune
    // and her drawn shell, a downward ray from the vertex + 1.5 u, the highest of five, the vertex and +-0.05 u in x and z: AMENDED twice after
    // the build's first green runs, where single frames read 0.6-3.4 u at the same two spots, the piece neither moving nor bursting (the
    // game's own surface had not changed): her drawn (sculpted) shell has SLITS there, 0.01-0.03 u wide, that a ray falls through (a dense
    // 0.01 u ray scan, dormant: 285 misses of 39,600 along a line at z ~30.61 from x 91.0, 58 of 14,520 round (90.4, 47.01); 0.01 u apart
    // was the first amendment and was not enough). 0.05 u on her steepest faces is ~0.1 u of slack against the 0.3 u bar); a piece drawn collapsed (every vertex within 1e-4 u: gone) is not
    // booked. null: no slabs on this build. { v: 0 }: the mesh hidden
    slab() { const Sl = L.slabs; if (!Sl) return null; const m = Sl.mesh; if (!m || !m.visible) return { v: 0 };
      m.updateMatrixWorld(true); const A = m.geometry.attributes.position.array, e = m.matrixWorld.elements, vpc = Sl.vpc;
      let n = 0, gMax = -1e9, gMin = 1e9, wk = -1, wAt = null, gKind = null, gDet = null, gSh = 1e9, nSh = 0, dSh = 0, dDet = null; const pcs = [];
      for (let k = 0; k < Sl.n; k++) { let ly = 1e9, lx = 0, lz = 0, hi = -1e9;
        for (let i = k * vpc; i < (k + 1) * vpc; i++) { const x = A[i * 3], y = A[i * 3 + 1], z = A[i * 3 + 2];
          const wx = e[0] * x + e[4] * y + e[8] * z + e[12], wy = e[1] * x + e[5] * y + e[9] * z + e[13], wz = e[2] * x + e[6] * y + e[10] * z + e[14];
          if (wy < ly) { ly = wy; lx = wx; lz = wz; } if (wy > hi) hi = wy; }
        if (hi - ly < 1e-4) continue;
        n++; let sh = Math.max(shellTop(lx, ly + 1.5, lz), shellTop(lx + 0.05, ly + 1.5, lz), shellTop(lx - 0.05, ly + 1.5, lz), shellTop(lx, ly + 1.5, lz + 0.05), shellTop(lx, ly + 1.5, lz - 0.05));
        if (sh < -1e8) { const up = R.shellIn(lx, ly, lz); if (up != null) sh = up; }
        // (I1) which surface the gap was read on: her shell where it is strictly the highest of the three, else the dune where it stands over
        // the floor, else the floor. Designed sinking is into the sand / floor; the shell side has its own bound (header, iShell)
        const tr = T.terrainH(lx, lz, 0), du = B && B.sandAt ? B.sandAt(lx, lz) : -1e9, sand0 = Math.max(tr, du);
        // (AMENDED after the first run, header: the game's own test.) kind = the surface of the LOWEST of the five reads the game seats on
        // (burial.js slabWrite: the vertex and +-SLAB_FOOT 0.15 u, each the highest of terrain / dune / her shell): her shell if that lowest read is
        // shell, else dune / floor. A piece straddling her rim has a dune read lower than the shell under its vertex: the game sinks it into the
        // sand by design (lowShell false), and it is not a shell piece
        let kind = sh > sand0 ? 'shell' : du > tr ? 'dune' : 'floor', lo = Math.max(sand0, sh);
        for (let q = 0; q < 4; q++) { const nx = lx + (q < 2 ? (q ? -0.15 : 0.15) : 0), nz = lz + (q < 2 ? 0 : (q === 2 ? 0.15 : -0.15)), t2 = T.terrainH(nx, nz, 0), d2 = B && B.sandAt ? B.sandAt(nx, nz) : -1e9, s2 = shellTop(nx, ly + 1.5, nz), g2 = Math.max(t2, d2);
          const v = Math.max(g2, s2); if (v < lo) { lo = v; kind = s2 > g2 ? 'shell' : d2 > t2 ? 'dune' : 'floor'; } }
        const g = ly - Math.max(sand0, sh);
        // (AMENDED after the first runs, header iShell) a shell piece's DEPTH IN HER: the shortest distance from its lowest vertex to her drawn
        // surface, an upper bound off the drawn mesh's ray heights at 0 .. 0.3 u out (rings 0.075 apart, 8 bearings): sqrt(r^2 + (h - vertex)^2)
        // to the surface point (x + r dx, h, z + r dz). 0 where the vertex is not under her top (g >= 0)
        let dep = 0;
        if (kind === 'shell' && g < 0) { dep = -g;
          for (let ri = 1; ri <= 4; ri++) for (let bi = 0; bi < 8; bi++) { const rr = ri * 0.075, hh = shellTop(lx + rr * COS8[bi], ly + 1.5, lz + rr * SIN8[bi]); if (hh > -1e8) dep = Math.min(dep, Math.hypot(rr, hh - ly)); } }
        pcs.push([k, kind, g, dep, lx, ly, lz]);
        if (g > gMax) { gMax = g; wk = k; wAt = [r2(lx), r2(ly), r2(lz)]; } if (g < gMin) { gMin = g; gKind = kind; gDet = { k, age: r2(Sl.S[k * 12 + 6]), gl: r3(Sl.S[k * 12 + 9]), cy: r3(Sl.S[k * 12 + 10]), kind, lo: r3(lo), ny: R.faceNY(lx, ly + 1.5, lz), sh: r3(sh), du: r3(du), tr: r3(tr), ly: r3(ly) }; }
        if (kind === 'shell') { nSh++; if (g < gSh) gSh = g; if (dep > dSh) { dSh = dep; dDet = { k, g: r3(g), dep: r3(dep), ny: R.faceNY(lx, ly + 1.5, lz), age: r2(Sl.S[k * 12 + 6]) }; } } }
      R.pcs = pcs;
      return { v: 1, n, gMax: n ? r3(gMax) : null, gMin: n ? r3(gMin) : null, gMinKind: n ? gKind : null, gDet, gMinShell: nSh ? r3(gSh) : null, depthShell: nSh ? r3(dSh) : null, dDet, nShell: nSh, wk, at: wAt }; },
    // (BP_RED=sunk, I1's RED) after a frame: the shell piece standing on the flattest face is lowered 0.5 u in the DRAWN mesh (the game rewrites
    // every vertex of every piece each frame, so it does not accumulate); the row that follows reads it
    sink() { const Sl = L.slabs; if (!Sl || !Sl.mesh.visible) return 0; R.slab(); let p = null, py = -1; for (const q of R.pcs || []) if (q[1] === 'shell') { const ny = R.faceNY(q[4], q[5] + 1.5, q[6]); if (ny != null && ny > py) { py = ny; p = q; } } if (!p) return 0;   // (the flattest face under a shell piece: 0.5 u down there is 0.5 u deep)
     
      const A = Sl.mesh.geometry.attributes.position.array; for (let i = p[0] * Sl.vpc; i < (p[0] + 1) * Sl.vpc; i++) A[i * 3 + 1] -= 0.5; R.sunk = (R.sunk || 0) + 1; return 1; },
    // the hit face's world normal.y under (x, y, z) (down ray): 1 flat, 0 a wall; null no hit
    faceNY(x, y, z) { const sh = L.parts.shell; sh.updateMatrixWorld(true); rc.set(o3.set(x, y, z), dn); rc.far = 40; const h = rc.intersectObject(sh, false)[0]; if (!h) return null;
      nm3.getNormalMatrix(sh.matrixWorld); wn3.copy(h.face.normal).applyMatrix3(nm3).normalize(); return r3(wn3.y); },
    settle(n) { const g = []; window.__bench.step(n, () => { g.push(P.grounded ? 1 : 0); }); return Object.assign(R.foot(), { groundedFrames: g.reduce((a, b) => a + b, 0), of: n }); },
    row() {
      const p = P.pos, bo = p.y - 1.35, cp = camera.position, BD = BC.BODY, sv = window.survival;
      if (R.wakeF < 0 && !L.dormant) R.wakeF = R.S.length;
      const pb = R.prevBoots == null ? bo : R.prevBoots;   // (the shell rays start at LAST frame's boots + 1.5: header (g) (i))
      let wmax = -1e9, wmin = 1e9, lit = 0; const wh = [];
      let mem = 0;
      for (const g of L.sigils) { const d = g.grp.position.y - sand(g.grp.position.x, g.grp.position.z); wh.push(r2(d)); if (d > wmax) wmax = d; if (d < wmin) wmin = d; if (g.lit) lit++; if (g.lit && g.mem) mem++; }
      R.S.push({ dorm: L.dormant ? 1 : 0, stand: r3(L.stand), standE: r3(L.standE), bury: r3(L.bury || 0), moundK: L.moundK == null ? null : r3(L.moundK), mk: MD ? r3(MD.k) : null, drawn: MD ? (MD.drawn ? 1 : 0) : null,
        hx: r3(L.heave.x), hv: r3(L.heave.v), rising: L.rising ? 1 : 0, hasStood: L.hasStood == null ? null : (L.hasStood ? 1 : 0), risenUp: L.risenUp == null ? null : (L.risenUp ? 1 : 0),
        bodyY: r3(L.bodyY), sl: r3(L.soleLift || 0), gG: L.gG ? r3(L.gG.x) : null, threatE: r3(L.threatE), nsT: r3(L.nsT || 0), drop: L.drop || 0, seen: L.seen ? 1 : 0, tau: r2(L.tau || 0), blindT: r2(L.blindT || 0), lost: L.lostN || 0,
        stag: r3(P.stagger || 0), px: r2(p.x), py: r2(p.y), pz: r2(p.z), gr: P.grounded ? 1 : 0, gap: r3(bo - T.shutFloorY(p.x, p.z, 0)), dC: r3(Math.hypot(p.x - cx, p.z - cz)),
        slam: window.__slamLog ? window.__slamLog.length : -1, torn: r2(sv ? sv.torn : -1), wh, wmin: r2(wmin), wmax: r2(wmax), lit,
        blk0: blk(p.x, bo, p.z, 0), blk45: blk(p.x, bo, p.z, 0.45), lensClr: r3(cp.y - T.shutFloorY(cp.x, cp.z, 0)), lensBlk: BC.bodyBlocked(cp.x, cp.y, cp.z, 0) ? 1 : 0, lensWhy: BC.bodyBlocked(cp.x, cp.y, cp.z, 0) ? BC.blockWhy : null, crecam: window.__crecam && window.__crecam.state ? window.__crecam.state().creEng ?? null : null,
        lift: L.claws.map(c => r3(c.liftNow || 0)), elbow: L.claws.map(c => r3(c.elbow || 0)), frontUp: r3(L.frontUp || 0), clawRes: r3(L.clawRes || 0), clawSt: r3(L.clawSt || 0), belly: r2(L.bellyOver ?? 99),
        body: { last: BD.last, hitV: r2(BD.hitV), push: r3(BD.push), n: BD.contacts, shell: BD.shell ? 1 : 0 }, shoveN: L.shoveN || 0, cracked: L.cracked ? 1 : 0,
        gBase: r3(Math.max(T.terrainH(p.x, p.z, 0), B && B.sandAt ? B.sandAt(p.x, p.z) : -1e9, shellFoot(p.x, pb + 1.5, p.z))), gFoot: r3(footCarried(p.x, p.z)), boots: r3(bo), pb: r3(pb), forced: R.lastForce || 0,
        calmed: L.calmed ? 1 : 0, latch: L.footLatch ? 1 : 0, under: R.underF === R.S.length ? 1 : 0, gb: L.growthBuried ?? null, mem,
        crackK: L.crackK == null ? null : r3(L.crackK), slab: R.slab(), dust: FF && FF.dustStats ? FF.dustStats() : null,
        // (Task 8) sight's reacquire inputs (header: blind) and the plume's state and field; ps fields absent on a build without them are null
        clearT: r3(L.clearT || 0), pd: r3(L._pd), touchT: r3(L.touchT || 0),
        ps: (() => { const q = window.__plume ? window.__plume.state() : null; return q ? { live: q.live, rise: q.rise ?? null, riseEv: q.riseEvicted ?? null, quadEv: q.quadEvicted ?? null } : null; })(),
        pf: fieldN % 3 === 0 ? fieldFoot(PLD) : null, pk: fieldN % 6 === 0 ? fieldPeak(PLD) : null,
        pfA: fieldN % 3 === 0 ? fieldFoot(PLA) : null, pkA: fieldN % 6 === 0 ? fieldPeak(PLA) : null });
      fieldN++;
      R.prevBoots = bo;
    },
    step(n) { if (window.lev !== L) throw new Error('the sleeper was rebuilt under the booking'); window.__bench.step(n, () => { if (${RED === 'sunk' ? 'true' : 'false'}) R.sink(); R.row(); R.lastForce = 0; if (${FORCE ? 'true' : 'false'} && R.wakeF >= 0 && L.stand >= 1 && !R.stoodSeen) { if (L.hasStood) { R.stoodSeen = true; if (R.reach0 != null) L.reach = R.reach0; } else { if (R.reach0 == null) { R.reach0 = L.reach; L.reach = -1; } R.lastForce = R.force(); } } }); return { rows: R.S.length, wakeF: R.wakeF, dormant: !!L.dormant }; } };
  return { R: L.R, buried: !!L.buried, hasMound: !!MD, centre: [r2(cx), r2(cz)], hasStoodKnown: 'hasStood' in L, knobs: B ? { shoveV: B.knobs.shoveV ?? null, shoveStag: B.knobs.shoveStag ?? null, holdRise: B.knobs.holdRise ?? null, riseU: B.knobs.riseU ?? null, pourU: B.knobs.pourU ?? null, crackT: B.knobs.crackT ?? null, slabs: B.knobs.slabs ?? null, plume: B.knobs.plume ?? null } : null, hasSlabs: !!L.slabs,
    collR: L.collR, reacq: BRD && BRD.SIGHT ? BRD.SIGHT.reacq : null, hasPlume: !!PLD, riseKind: !!(window.__plume && window.__plume.kinds && window.__plume.kinds.rise), plumeRise: window.__plume && window.__plume.kinds && window.__plume.kinds.rise ? JSON.parse(JSON.stringify(window.__plume.kinds.rise)) : null };
})()`;
const RISE_PLACE = where => `(async () => {
  const T = await import('/src/world/terrain.js'), S = await import('/src/world/fissureShape.js');
  const L = window.lev, R = L.R; let x, z;
  if (${JSON.stringify(where)} === 'crest') {
    // the highest drawn shell vertex (her crest's top)
    const sh = L.parts.shell, P = sh.geometry.attributes.position, v = new (L.pos.constructor)(); sh.updateMatrixWorld(true); let top = -1e9;
    for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i).applyMatrix4(sh.matrixWorld); if (v.y > top) { top = v.y; x = v.x; z = v.z; } }
  } else if (${JSON.stringify(where)} === 'dune') {
    // half-way down the dune on her sand side (the bearing breath's PLACE uses), its drawn vertex
    const MD = L.mound; if (!MD) return { err: 'dune: no mound on this build' };
    const j = Math.round((L.sandSide > 0 ? 0 : 0.5) * MD.COLS) % MD.COLS, ring = Math.floor((MD.NR - 2) / 2), o = (ring * MD.COLS + j) * 3; x = MD.P[o]; z = MD.P[o + 2];
  } else { x = L.pos.x + Math.sin(L.yaw) * 2.3 * R; z = L.pos.z + Math.cos(L.yaw) * 2.3 * R; }
  window.__bench.place(x, z, Math.atan2(L.pos.x - x, L.pos.z - z), 0);
  window.player.pos.y = T.shutFloorY(x, z, 0) + 1.35; window.player.vel.set(0, 0, 0);
  return { where: ${JSON.stringify(where)}, him: [+x.toFixed(2), +z.toFixed(2)], fd: +S.fissureDist(x, z, 0).toFixed(2), floor: +T.shutFloorY(x, z, 0).toFixed(2), terr: +T.terrainH(x, z, 0).toFixed(2) };
})()`;
const alt = (cc, d) => cc.ev(`(window.dispatchEvent(new KeyboardEvent('keydown',{code:'Digit${d}',key:'${d}',altKey:true,bubbles:true})), window.dispatchEvent(new KeyboardEvent('keyup',{code:'Digit${d}',key:'${d}',altKey:true,bubbles:true})), window.__helm=true, window.__bench.step(60), 1)`);
const RISE_SECS = 14;

// (oldwound) the page side of `wound` (header). __bpWound: aim(mode, d, tx) places him (the follow lens behind him) and turns him until
// the seam sits at ndc.x ~ tx (0: straight at it); read(o) is THE READ (header); fronds() the growth kept off the seam; line() the zone line
const WOUND_INSTALL = `(async () => {
  const THREE = await import('three'), T = await import('/src/world/terrain.js'), core = await import('/src/core.js'), PF = await import('/src/postfx.js');
  const Bu = await import('/src/entities/sleeper/burial.js');
  const L = window.lev, P = window.player, H = L && L.harpoon;
  if (!L || L.kind !== 'brooder' || !H) return { err: 'no brooder with a harpoon (' + (L && L.kind) + ')' };
  const cam = core.camera, r2 = q => +q.toFixed(2);
  // what the wound (or, on a fresh save, the iron) adds to the frame: the build's own hook when it has one, else the scar mesh alone
  // (983224c's old wound IS the scar mesh), or the iron and its line; the glint is its own switch
  // (the seam and the anchor kept in her body's frame from the install: after a dig-in's re-bed she lies elsewhere and the wound rides her;
  // on a build that has not moved they are H.seam and H.anchor)
  L.grp.updateMatrixWorld(true);
  const bInv = new THREE.Matrix4().copy(L.body.matrixWorld).invert(), seamL = H.seam.clone().applyMatrix4(bInv), anchorL = H.anchor.clone().applyMatrix4(bInv);
  const seamNow = () => { L.grp.updateMatrixWorld(true); return seamL.clone().applyMatrix4(L.body.matrixWorld); };
  const anchorNow = () => anchorL.clone().applyMatrix4(L.body.matrixWorld);
  const show = (on, glint) => {
    if (H.wound || H.pulled) { if (H._woundShow) H._woundShow(on); else H.scar.visible = on; }
    else { H.iron.visible = on; H.rope.visible = on; }
    H.glintSpr.visible = !!(on && glint);
  };
  const R = window.__bpWound = {
    prem: { sculpted: !!L.sculpted, buried: !!L.buried, wound: !!H.wound, pulled: !!H.pulled, pressed: !!H.pressed, seatOk: !!H.seatOk, dormant: !!L.dormant, scar: !!(H.scar && H.scar.visible),
      iron: !!(H.iron && H.iron.visible), hook: typeof H._woundShow === 'function', seam: [r2(H.seam.x), r2(H.seam.y), r2(H.seam.z)], normal: [r2(H.normal.x), r2(H.normal.y), r2(H.normal.z)],
      anchor: [r2(H.anchor.x), r2(H.anchor.y), r2(H.anchor.z)] },
    show,
    _pk: null, _pg: null, _pw: null,
    // him on the sand d u out from the seam along her sand side (mode 'sand'; 'normal': along the seam's normal, for stills), or at Alt+6's anchor (mode 'anchor'); yaw so the seam sits at
    // ndc.x ~ tx beside him (a player looks past his diver, not through him); the post chain settled over each try
    aim(mode, d, tx) {
      const s = seamNow(); let x, z;
      if (mode === 'anchor') { const a = anchorNow(); x = a.x; z = a.z; } else { const v = mode === 'normal' ? H.normal : L.sand, l = Math.hypot(v.x, v.z) || 1; x = s.x + v.x / l * d; z = s.z + v.z / l * d; }
      const y0 = Math.atan2(s.x - x, s.z - z); let yo = 0, nd = new THREE.Vector3(), prev = null, k = 2.5, tries = 0;
      for (; tries < 7; tries++) {
        window.__bench.place(x, z, y0 + yo, 0); P.pitch = 0; P.pos.y = T.shutFloorY(x, z, 0) + 1.35; P.vel.set(0, 0, 0);
        window.__bench.step(60, null, { render: true });
        cam.updateMatrixWorld(); nd.copy(s).project(cam);
        if (Math.abs(nd.x - tx) < 0.03) break;
        if (prev && Math.abs(nd.x - prev.x) > 1e-3) k = Math.min(8, Math.max(0.5, (yo - prev.yo) / (nd.x - prev.x)));
        prev = { yo, x: nd.x }; yo += (tx - nd.x) * k;
      }
      window.__bench.step(60, null, { render: true }); cam.updateMatrixWorld(); nd.copy(s).project(cam);
      return { mode, d, tx, him: [r2(x), r2(P.pos.y), r2(z)], yawOff: +yo.toFixed(3), tries, ndc: [+nd.x.toFixed(3), +nd.y.toFixed(3)], camD: r2(cam.position.distanceTo(s)),
        facing: +H.normal.dot(cam.position.clone().sub(s).normalize()).toFixed(3) };
    },
    // THE READ (header): the footprint from two captures under the post bypass (the scene alone: deterministic), the wound on and off; the
    // read on ONE settled capture through the whole post chain (what he sees): the footprint against the annulus round it
    // the PAINT (the footprint's pass): everything the wound (or the iron) puts on screen turned hot magenta for one capture: the scar /
    // piece and the iron and its line by their emissive, the glint by its colour, the crust's paint by uWound.w 2 (burial.js: the probe's
    // paint, where the wound's terms are > 0.02); all uniforms, no program change
    paint(on) {
      const ms = H.wound || H.pulled ? [H.scar.material] : [H.iron.material, H.rope.material], u = L.crustU && L.crustU.uWound;
      if (on) { R._pk = ms.map(m => m.emissive ? m.emissive.clone() : null); R._pg = H.glintSpr.material.color.clone();
        for (const m of ms) if (m.emissive) m.emissive.setRGB(1.5, 0, 1.5);
        H.glintSpr.material.color.setRGB(1, 0, 1);
        if (u && u.value.w > 0.5) { R._pw = u.value.w; u.value.w = 2; } else R._pw = null; }
      else { ms.forEach((m, k) => { if (m.emissive && R._pk[k]) m.emissive.copy(R._pk[k]); }); H.glintSpr.material.color.copy(R._pg); if (u && R._pw != null) u.value.w = R._pw; }
    },
    async read(o = {}) {
      const B = window.__bench, clk = window.__plugClk ? window.__plugClk.clock : null;
      // (a frozen capture steps the world at dt 1e-4 outside __bench.step; its few ms of game time are put back, so the plugged ledger
      // books only the counted frames)
      const cap = async () => { const e = clk ? clk.elapsedTime : 0; try { return await B.capture({}); } finally { if (clk) clk.elapsedTime = e; } };
      show(true, o.glint);
      B.step(30, null, { render: true });   // (counted on the plugged clock: capture's own settle is not)
      let c, m, cc;
      try { c = await cap(); cc = await cap(); R.paint(true); m = await cap(); } finally { R.paint(false); show(true, true); }
      const W = c.w, Hh = c.h;
      // the WINDOW: +-o.win u (default 3) round the seam's projection at its distance from the lens (pixel rows bottom-up, as read back)
      const sw = seamNow(); cam.updateMatrixWorld(); const sp = sw.clone().project(cam), dist = cam.position.distanceTo(sw);
      const pxu = (Hh / 2) / Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) / dist, half = Math.max(24, Math.round((o.win || 3) * pxu));
      const cx = Math.round((sp.x + 1) / 2 * W), cy = Math.round((sp.y + 1) / 2 * Hh);
      // a footprint pixel: painted magenta (red and blue both >= 40 codes over green) and >= 40 codes off the plain frame; floor = the same
      // test between two plain frames (the post chain's own A/A)
      const hot = (p, q, k) => p.px[k] - p.px[k + 1] >= 40 && p.px[k + 2] - p.px[k + 1] >= 40 && Math.max(Math.abs(p.px[k] - q.px[k]), Math.abs(p.px[k + 2] - q.px[k + 2])) >= 40;
      const M = new Uint8Array(W * Hh);
      let area = 0, floor = 0, x0 = W, x1 = -1, y0 = Hh, y1 = -1;
      for (let y = Math.max(0, cy - half); y <= Math.min(Hh - 1, cy + half); y++) for (let x = Math.max(0, cx - half); x <= Math.min(W - 1, cx + half); x++) {
        const i = y * W + x, k = i * 4; if (hot(cc, c, k)) floor++;
        if (hot(m, c, k)) { M[i] = 1; area++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
      const Y = i => { const k = i * 4; return 0.2126 * c.px[k] + 0.7152 * c.px[k + 1] + 0.0722 * c.px[k + 2]; };
      const out = { area, floor, eqD: +(2 * Math.sqrt(area / Math.PI)).toFixed(1), bbox: area ? [x0, Hh - 1 - y1, x1, Hh - 1 - y0] : null, at: [cx, Hh - 1 - cy], half, pxu: +pxu.toFixed(1), W, H: Hh };
      if (!area) return Object.assign(out, { visible: 0, Lm: null, La: null, weber: 0 });
      // the annulus: every pixel within r px (Chebyshev) of the footprint and not in it, r = max(4, half the footprint's equivalent diameter)
      const r = Math.max(4, Math.round(out.eqD / 2)), ann = [], inM = [];
      for (let y = Math.max(0, y0 - r); y <= Math.min(Hh - 1, y1 + r); y++) for (let x = Math.max(0, x0 - r); x <= Math.min(W - 1, x1 + r); x++) {
        const i = y * W + x; if (M[i]) { inM.push(Y(i)); continue; }
        let near = false; for (let dy = -r; dy <= r && !near; dy += 1) { const yy = y + dy; if (yy < 0 || yy >= Hh) continue; for (let dx = -r; dx <= r; dx += 1) { const xx = x + dx; if (xx >= 0 && xx < W && M[yy * W + xx]) { near = true; break; } } }
        if (near) ann.push(Y(i)); }
      const med = A => { const s = A.slice().sort((p, q) => p - q); return s.length ? s[s.length >> 1] : null; };
      const Lm = med(inM), La = med(ann);
      let visible = 0; for (const v of inM) if (Math.abs(v - La) >= 10) visible++;
      return Object.assign(out, { r, nAnn: ann.length, Lm: +Lm.toFixed(1), La: +La.toFixed(1), weber: +(Math.abs(Lm - La) / Math.max(La, 1)).toFixed(3), visible });
    },
    // the growth kept off the seam (burial.js prepGrowth / growRock): every DRAWN frond (an instance not scaled to 0) and every coral vertex
    // within GROW.near u of the seam, or in the sight corridor out of it along its normal's level part (GROW.sight)
    fronds() {
      const G = Bu.GROW, s = seamNow(), hn = H.normal, l = Math.hypot(hn.x, hn.z) || 1, snx = hn.x / l, snz = hn.z / l, nr2 = G.near * G.near;
      const over = p => { const dx = p.x - s.x, dy = p.y - s.y, dz = p.z - s.z; if (dx * dx + dy * dy + dz * dz < nr2) return 1;
        const t = dx * snx + dz * snz; if (t < 0 || t > G.sight[0]) return 0; const qx = dx - snx * t, qz = dz - snz * t; return qx * qx + dy * dy + qz * qz < G.sight[1] * G.sight[1] ? 2 : 0; };
      const w = L.parts.weed, co = L.parts.coral, m = new THREE.Matrix4(), v = new THREE.Vector3(), out = { weedN: 0, weedNear: 0, weedSight: 0, coralN: 0, coralNear: 0, coralSight: 0, nearest: 1e9 };
      L.grp.updateMatrixWorld(true);
      if (w) { const WP = w.geometry.attributes.position;
        for (let k = 0; k < w.count; k++) { w.getMatrixAt(k, m); if (Math.abs(m.determinant()) < 1e-12) continue; m.premultiply(w.matrixWorld); out.weedN++;
          for (let q = 0; q < WP.count; q++) { v.fromBufferAttribute(WP, q).applyMatrix4(m); const o = over(v); out.nearest = Math.min(out.nearest, v.distanceTo(s)); if (o === 1) out.weedNear++; else if (o === 2) out.weedSight++; } } }
      if (co && co.visible && co.geometry.attributes.position) { const CP = co.geometry.attributes.position;
        for (let q = 0; q < CP.count; q++) { v.fromBufferAttribute(CP, q).applyMatrix4(co.matrixWorld); out.coralN++; const o = over(v); if (o === 1) out.coralNear++; else if (o === 2) out.coralSight++; } }
      out.nearest = r2(out.nearest);
      return out;
    }
  };
  return R.prem;
})()`;

// (Task 12) the page side of `digin` and `reentry` (header). __bpDig: row() books a frame; step(n, stop) steps n frames booking each
// (stop: a page-side condition name that ends the batch); place35(), settled(), onDune(), approach(), hold(), floorEq(), state()
const DIG_INSTALL = `(async () => {
  const THREE = await import('three'), T = await import('/src/world/terrain.js'), BC = await import('/src/entities/sleeper/bodyCols.js');
  const { camera } = await import('/src/core.js'), DV = await import('/src/entities/diver.js');
  const L = window.lev; if (!L || L.kind !== 'brooder') return { err: 'no brooder (' + (L && L.kind) + ')' };
  const B = window.__burial || null, P = window.player, SET = window.__settle;
  const sand = (x, z) => Math.max(T.terrainH(x, z, 0), B && B.sandAt ? B.sandAt(x, z) : -1e9);
  const r3 = v => Math.round(v * 1000) / 1000, r2 = v => Math.round(v * 100) / 100;
  // THE PROBE'S OWN "ON HER GROUND" (header): the plan's onHerDune, re-computed here on the published shell
  const onAt = (x, y, z) => { const g = Math.max(T.terrainH(x, z, 0), T.extraFloorAt(x, z, 0), BC.shellHiAt(x, z)); if (y - 1.35 > g + 6) return 0; return BC.shellPlanNear(x, y - 0.45, z, SET.release) ? 1 : 0; };
  // his OWN boot gap: the drawn sole's lowest point (relief-walk's SOLE_PTS, the lead casting's underside at SOLE_Y -0.15 in the foot's frame)
  const ENDS = [DV.diver.legR.end, DV.diver.legL.end], V = new THREE.Vector3();
  const SOLE_PTS = [[0, -0.16], [0.08, -0.14], [-0.08, -0.14], [0.12, 0.215], [-0.12, 0.215], [0.06, 0.30], [-0.06, 0.30]];
  const own = () => { let m = 1e9; for (const e of ENDS) { e.updateWorldMatrix(true, false); for (const q of SOLE_PTS) { V.set(q[0], -0.15, q[1]); e.localToWorld(V); const g = V.y - sand(V.x, V.z); if (g < m) m = g; } } return m; };
  // (final review item 7) every console.warn of the page, kept (the job's abandonment must log ONE): hooked once a page
  if (!window.__bpWarns) { const W = window.__bpWarns = [], w0 = console.warn; console.warn = function (...a) { W.push(a.map(q => String(q && q.message || q)).join(' ').slice(0, 240)); return w0.apply(this, a); }; }
  const R = window.__bpDig = { S: [], tEnd: 0, hold: null, holdY: 0, stops: {},
    onDune() { const p = P.pos; return onAt(p.x, p.y, p.z); },
    settled() { return !!(L.calmed && L.stand <= 0 && Math.abs(L.heave.x) < 0.02 && Math.abs(L.heave.v) < 0.05 && !L.pointPh && !L.walkTo && !L.homeTurn); },
    // him 35 u from her centre along her sand side (L.sand), facing her, on the drawn ground
    place35(d = 35) { const x = L.pos.x + L.sand.x * d, z = L.pos.z + L.sand.z * d;
      window.__bench.place(x, z, Math.atan2(L.pos.x - x, L.pos.z - z), 0); P.pos.y = T.shutFloorY(x, z, 0) + 1.35; P.vel.set(0, 0, 0); R.hold = null;
      return { him: [r2(x), r2(z)], her: [r2(L.pos.x), r2(L.pos.z)], on: R.onDune() }; },
    // (BP_SHOTS) him d u out from the scar along its normal's level part, facing it, pitched down a little
    scarView(d) { const H = L.harpoon; if (!H || !H.scar) return { err: 'no scar' }; L.grp.updateMatrixWorld(true); const v = new THREE.Vector3().setFromMatrixPosition(H.scar.matrixWorld);
      let nx = H.normal.x, nz = H.normal.z; const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l; const x = v.x + nx * d, z = v.z + nz * d;
      window.__bench.place(x, z, Math.atan2(v.x - x, v.z - z), 0); P.pitch = -0.2; P.pos.y = T.shutFloorY(x, z, 0) + 1.35; P.vel.set(0, 0, 0); R.hold = null;
      return { scar: [r2(v.x), r2(v.y), r2(v.z)], him: [r2(x), r2(z)] }; },
    // the boundary of the probe's own test along the sand side's bearing from the strip's centre, at the ground (scanned in from 40 u)
    edge() { const MD = L.mound, cx = MD ? MD.bx : L.pos.x, cz = MD ? MD.bz : L.pos.z, ux = L.sand.x, uz = L.sand.z;
      for (let d = 40; d > 0; d -= 0.25) { const x = cx + ux * d, z = cz + uz * d, g = Math.max(T.terrainH(x, z, 0), T.extraFloorAt(x, z, 0)); if (onAt(x, g + 1.35, z)) return { d, cx, cz, ux, uz }; }
      return null; },
    // (pause) 3 u outside it, facing her centre, standing
    approach() { const E = R.edge(); if (!E) return { err: 'no boundary on the sand bearing' }; const d = E.d + 3, x = E.cx + E.ux * d, z = E.cz + E.uz * d;
      window.__bench.place(x, z, Math.atan2(E.cx - x, E.cz - z), 0); P.pos.y = T.shutFloorY(x, z, 0) + 1.35; P.vel.set(0, 0, 0); R.hold = null;
      return { edge: r2(E.d), him: [r2(x), r2(z)], on: R.onDune() }; },
    // (afloat) 2 u inside it, held 1.5 u over the drawn ground after every frame
    afloat() { const E = R.edge(); if (!E) return { err: 'no boundary on the sand bearing' }; const d = E.d - 2, x = E.cx + E.ux * d, z = E.cz + E.uz * d;
      window.__bench.place(x, z, Math.atan2(E.cx - x, E.cz - z), 0); R.hold = { x, z }; R.put();
      return { edge: r2(E.d), him: [r2(x), r2(z)], on: R.onDune(), y: r3(P.pos.y) }; },
    put() { const H = R.hold, g = H.y != null ? H.y : Math.max(T.terrainH(H.x, H.z, 0), T.extraFloorAt(H.x, H.z, 0)) + 1.5; P.pos.set(H.x, g + 1.35, H.z); P.vel.set(0, 0, 0); P.grounded = false; R.holdY = P.pos.y; },
    // (crest) held with his boots 0.1 u over her drawn crest top (the highest drawn shell vertex now)
    crestHold() { const sh = L.parts.shell, Pa = sh.geometry.attributes.position; sh.updateMatrixWorld(true); let top = -1e9, x = 0, z = 0;
      for (let i = 0; i < Pa.count; i++) { V.fromBufferAttribute(Pa, i).applyMatrix4(sh.matrixWorld); if (V.y > top) { top = V.y; x = V.x; z = V.z; } }
      window.__bench.place(x, z, Math.atan2(L.pos.x - x, L.pos.z - z), 0); R.hold = { x, z, y: top + 0.1 }; R.put();
      return { top: r3(top), at: [r2(x), r2(z)], on: R.onDune(), over: r3(top - T.terrainH(x, z, 0)) }; },
    row(upd) {
      const p = P.pos, cp = camera.position, g = Math.max(T.terrainH(p.x, p.z, 0), T.extraFloorAt(p.x, p.z, 0));
      let wl = 0, wg = 0; for (const s of L.sigils) { if (s.light && s.light.intensity > wl) wl = s.light.intensity; if (s.burn && s.burn.material.opacity > wg) wg = s.burn.material.opacity; }
      R.S.push({ bury: L.bury, dig: L.digging ? 1 : 0, dug: L.dugIn ? 1 : 0, off: L.digOff == null ? null : r3(L.digOff), stand: r3(L.stand), hx: r3(L.heave.x), hv: r3(L.heave.v),
        ph: L.pointPh || 0, walk: L.walkTo ? 1 : 0, ht: L.homeTurn ? 1 : 0, calmed: L.calmed ? 1 : 0, dorm: L.dormant ? 1 : 0, mk: L.mound ? r3(L.mound.k) : null,
        px: r2(p.x), py: r3(p.y), pz: r2(p.z), gr: P.grounded ? 1 : 0, on: onAt(p.x, p.y, p.z), own: r3(own()), lens: r3(cp.y - Math.max(T.shutFloorY(cp.x, cp.z, 0), sand(cp.x, cp.z))),
        hov: r3(p.y - 1.35 - g), drop: R.hold ? r3(R.holdY - p.y) : null, held: R.hold ? 1 : 0, buoy: r3(P.buoy || 0), calmOut: r3(BC.BODY.calmOut || 0),
        upd: upd == null ? null : r3(upd), job: L.digJobMs == null ? null : r3(L.digJobMs),
        hs: L.hasStood ? 1 : 0, mk2: L.moundK == null ? null : r3(L.moundK), ck: L.crackK == null ? null : r3(L.crackK), jph: L.digJob ? L.digJob.ph : -1, np: L.noPub ? 1 : 0, bm: R.bodyOff(), esc: 0, hp: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1024) : null, wl: r3(wl), wg: r3(wg), her: [r2(L.pos.x), r2(L.pos.z), r3(L.yaw)] });
    },
    // n frames booked; stop: 'settled' | 'stood' | 'woke' | 'u03' | 'ph2' | 'b033' | 'b04' | 'b05' | 'dug' | 'on30' | 'off30' | null
    step(n, stop) {
      if (window.lev !== L) throw new Error('the sleeper was rebuilt under the booking');
      let k = 0;
      const c = { settled: () => R.settled(), stood: () => !!L.hasStood, woke: () => !L.dormant, u03: () => L.stand >= 0.3, ph2: () => L.pointPh === 2,
        b033: () => L.bury >= 0.33, b04: () => L.bury >= 0.4, b05: () => L.bury >= 0.5, dug: () => !!L.dugIn,
        job: () => !!L.digJob, b03: () => L.bury >= 0.3, calmed: () => !!L.calmed,
        on30: () => { const S = R.S; let m = 0; for (let i = S.length - 1; i >= 0 && S[i].on; i--) m++; return m >= 30; },
        off30: () => { const S = R.S; let m = 0; for (let i = S.length - 1; i >= 0 && !S[i].on; i--) m++; return m >= 30; } }[stop] || null;
      R.tEnd = performance.now();
      window.__bench.step(n, () => { const t = performance.now(), upd = t - R.tEnd; R.row(upd); if (R.hold) R.put(); k++; R.tEnd = performance.now(); if (c && c()) return false; });
      return { rows: R.S.length, k, hit: c ? c() : null, bury: L.bury, dug: !!L.dugIn, stand: L.stand, ph: L.pointPh || 0 };
    },
    // the floor provider over her dune (reentry): extraFloorAt against the LIVE sleeper's drawn dune at mid-quad points
    floorEq() { const MD = L.mound; if (!MD) return { n: 0, err: 'no mound' }; const NB = MD.COLS, NR = MD.NR; let n = 0, bad = 0, off = 0, worst = 0;
      for (let i = 3; i <= NR - 4; i++) for (let j = 0; j < NB; j += 4) { const a = (i * NB + j) * 3, b = (i * NB + (j + 1) % NB) * 3, c2 = ((i + 1) * NB + j) * 3, d = ((i + 1) * NB + (j + 1) % NB) * 3;
        const x = (MD.P[a] + MD.P[b] + MD.P[c2] + MD.P[d]) / 4, z = (MD.P[a + 2] + MD.P[b + 2] + MD.P[c2 + 2] + MD.P[d + 2]) / 4, sa = B.sandAt(x, z), xf = T.extraFloorAt(x, z, 0);
        n++; if (!(sa > -1e8)) { off++; continue; } const e = Math.abs(xf - sa); if (e > worst) worst = e; if (e > 1e-9) bad++; }
      return { n, bad, off, worst }; },
    // (final review item 7) her body's drawn matrix against the one her pose gives (parent's matrixWorld x her local matrix): the largest
    // element difference; a slice left holding the fit's bury-1 matrix reads ~1.4 u (the sink) here
    bodyOff() { const b = L.body; if (!b.parent) return null; if (b.matrixAutoUpdate) b.updateMatrix(); R.m4.multiplyMatrices(b.parent.matrixWorld, b.matrix);
      let m = 0; for (let i = 0; i < 16; i++) { const d = Math.abs(R.m4.elements[i] - b.matrixWorld.elements[i]); if (d > m) m = d; } return Math.round(m * 1e6) / 1e6; },
    m4: new THREE.Matrix4(),
    // (final review item 7) THE THROW INSIDE A JOB SLICE, injected page side. trapPose: the fit pose's matrix (beginDig takes L.digMw1 when it
    // is set) throws on its first copy, digStep's phase 1 after it has posed her at bury 1. trapFit: the fit's generator, once it is the job's
    // (phase 2), is wrapped so its next slice THROWS INSIDE it (g.throw at its yield: the generator closes, as a real throw in the fit would)
    trapPose() { const m = new THREE.Matrix4(); m.copy = function () { delete this.copy; R.injF = R.S.length; throw new Error('bp inject: the fit pose'); }; L.digMw1 = m; R.trap = 'pose'; return true; },
    trapFit() { R.trap = 'fit'; return true; },
    wrapFit() { const J = L.digJob; if (R.trap !== 'fit' || R.wrapped || !J || J.ph !== 2 || !J.gen) return; const g = J.gen; R.wrapped = R.S.length;
      J.gen = { next(a) { if (R.injF < 0) { R.injF = R.S.length; return g.throw(new Error('bp inject: the fit')); } return g.next(a); }, throw(e) { return g.throw(e); }, return(v) { return g.return(v); }, [Symbol.iterator]() { return this; } }; },
    // n frames one at a time, a throw out of a frame caught and booked (esc 1, its message in R.escaped), the frame's row booked anyway
    stepSafe(n, stop) {
      let k = 0;
      for (; k < n; k++) {
        try { window.__bench.step(1, () => { R.row(null); R.wrapFit(); }); }
        catch (e) { R.escaped.push({ f: R.S.length, msg: String(e && e.message || e).slice(0, 160) }); R.row(null); R.S[R.S.length - 1].esc = 1; }
        if (stop === 'inj600' && R.injF >= 0 && R.S.length >= R.injF + 600) { k++; break; }
      }
      return { rows: R.S.length, k, injF: R.injF, escaped: R.escaped.length, warns: R.warns.length, bury: L.bury, dug: !!L.dugIn, job: L.digJob ? L.digJob.ph : -1 };
    },
    injF: -1, trap: null, wrapped: null, escaped: [], warns: window.__bpWarns || [],
    // (final review item 6, offbed) her bed moved OFFBED_D u along her sand side and OFFBED_YAW rad round before the walk home (at the calm: the
    // walk home's goal is L.lairPos, its last turn L.lairYaw), so she lies down ~3 u off the bed she was built on (the walk home's own envelope:
    // it stops within 3 u); the bed she was built on is kept (bed0) and her offset from it booked
    shiftBed(d, a) { R.bed0 = { x: L.lairPos.x, z: L.lairPos.z, yaw: L.lairYaw }; L.lairPos.x += L.sand.x * d; L.lairPos.z += L.sand.z * d; L.lairYaw += a;
      return { bed0: [r2(R.bed0.x), r2(R.bed0.z), r3(R.bed0.yaw)], bed: [r2(L.lairPos.x), r2(L.lairPos.z), r3(L.lairYaw)] }; },
    offBed0() { const b = R.bed0 || { x: L.lairPos.x, z: L.lairPos.z, yaw: L.lairYaw }; return { off: r3(Math.hypot(L.pos.x - b.x, L.pos.z - b.z)), dYaw: r3(Math.atan2(Math.sin(L.yaw - b.yaw), Math.cos(L.yaw - b.yaw))) }; },
    state() { const pc = window.__pointcam ? window.__pointcam.state() : null, Bd = L.brood;
      return { dormant: !!L.dormant, bury: L.bury, pointPh: L.pointPh || 0, pointK: L.pointK || 0, calmNext: !!L.calmNext, digging: !!L.digging, dugIn: !!L.dugIn,
        k: pc ? pc.k : null, drop: Bd ? Bd.drop : null, dropWant: B ? B.knobs.clutchSink / L.R : null, shader: window.__shaderFailed ? window.__shaderFailed().length : -1, sameL: window.lev === L }; } };
  return { R: L.R, buried: !!L.buried, hasDig: 'digging' in L || !!(B && B.knobs.digT), knobs: B ? { digT: B.knobs.digT ?? null, pause: B.knobs.pause ?? null, haze: B.knobs.haze ?? null } : null, settle: SET ? { release: SET.release, hold: SET.hold } : null };
})()`;

// ---- boot: about:blank, the domains on, the focus a player's window has, then the game ----
try { const r = await fetch(`http://127.0.0.1:${P}/json/version`, { signal: AbortSignal.timeout(2000) });
  console.error(`the debug port ${P} already answers /json/version (HTTP ${r.status}): not starting, nothing touched`); process.exit(2); }
catch (e) { if (!(e && e.cause && e.cause.code === 'ECONNREFUSED')) { console.error(`the debug port ${P} is not free (${e && e.name}: ${e && e.cause && e.cause.code || e && e.message}): not starting, nothing touched`); process.exit(2); } }
const TAG = process.env.BP_TAG || 'port' + PORT;
const OUT = process.env.BP_OUT || join(homedir(), 'sc/.abyssa-wt/reviews/buried', `burial-${MODE}-${TAG}.json`);
const record = { mode: MODE, port: +PORT, tag: TAG, red: RED || null, noplug: process.env.BP_NOPLUG === '1', knobs: KNOBS, at: AT || null, only: ONLY, offD: MODE === 'rise' ? OFF_D : undefined };
const finish = (code, why) => {
  record.exit = code; if (why) record.why = why;
  try { mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, JSON.stringify(record, null, 1)); console.log('JSON ' + OUT); } catch (e) { console.error('could not write ' + OUT + ': ' + e.message); }
  process.exit(code);
};
// a boot that never got to the game (Chrome would not start, no CDP connection, the page never loaded: a game port nobody
// serves waits out the 300 s) is UNMEASURED with its JSON, never exit 1, which would read as a failed bar
const URL0 = `http://localhost:${PORT}/?bench&playtest`;
let c = null;
try {
  chromeStarted = true;
  await start('about:blank');
  c = await connect();
  await c.send('Runtime.enable'); await c.send('Log.enable'); await c.send('Page.enable');
  await c.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  const tNav = Date.now();
  await c.send('Page.navigate', { url: URL0 });
  await c.until(`!document.getElementById('load') && typeof window.setState === 'function' && !!window.__bench && !!window.__chart && !!window.lev`, 300000, 500);
  console.log(`burial-probe ${MODE}${RED ? ' RED ' + RED : ''}${record.noplug ? ' NOPLUG' : ''} ${URL0} (fresh profile): loaded in ${((Date.now() - tNav) / 1000).toFixed(1)} s`);
  await c.ev(`(window.__helm = true, window.setState('play'), 1)`);
  await sleep(1000);
} catch (e) {
  const why = String(e && e.message || e);
  console.error('UNMEASURED: boot: ' + why);
  try { if (c) c.close(); } catch (e2) { }
  finish(2, 'boot: ' + why);
}

// ---- the clock is plugged once the page is up; then home, zone 0, her asleep ----
let out = null, fatal = null, patch = {};
// (Task 12) a fresh load for the next run of digin / reentry: the clock booked for the run before, then the same boot as the first
const sessClocks = [];
async function reload() {
  sessClocks.push(await drift(c).catch(() => null));
  await c.ev(`(window.__bpOld = 1, 1)`).catch(() => 0);
  await c.send('Page.navigate', { url: URL0 });
  await c.until(`!window.__bpOld && !document.getElementById('load') && typeof window.setState === 'function' && !!window.__bench && !!window.__chart && !!window.lev`, 300000, 500);
  await c.ev(`(window.__helm = true, window.setState('play'), 1)`);
  await sleep(1000);
  await plug(c, { stop: !record.noplug });
  await c.ev(`(window.__helm = true, window.__chart.arrive(0), window.gotoZone(0), window.__bench.step(30), 1)`);
  if (Object.keys(patch).length) await c.ev(`(await window.__burial.set(${JSON.stringify(patch)}), window.__bench.step(30), 1)`);
}
try {
  await plug(c, { stop: !record.noplug });
  await c.ev(`(window.__helm = true, window.__chart.arrive(0), window.gotoZone(0), window.__bench.step(30), 1)`);
  const hasBurial = await c.ev(`!!(window.__burial && window.__burial.set)`);
  record.build = hasBurial ? 'burial' : 'main';
  console.log(`build: ${record.build}`);
  // the patches: __burial.set is absent on main, where there is nothing to patch (the unpatched reading IS the main RED)
  // (`ridge` is the shipped ridge, so on main its patch is the build itself and is skipped; every other patch needs __burial.set)
  const redSet = RED && !(!hasBurial && REDS[MODE][RED].mainIsIt) && !REDS[MODE][RED].page ? REDS[MODE][RED].set : {};
  patch = Object.assign({}, KNOBS || {}, redSet);
  if (!hasBurial && RED && REDS[MODE][RED].mainIsIt) console.log(`BP_RED ${RED}: no __burial on this build, which already IS the shipped ridge: the unpatched reading is the RED`);
  if (Object.keys(patch).length) {
    if (!hasBurial) throw new Error(`BP_KNOBS / BP_RED patch ${JSON.stringify(patch)}, but this build has no __burial.set: nothing to act on`);
    // (awaited: a `crest` key makes set() import site.js before it rebuilds her, so an unawaited call stepped the OLD sleeper)
    await c.ev(`(await window.__burial.set(${JSON.stringify(patch)}), window.__bench.step(30), 1)`);
    record.patch = patch;
  }
  if (MODE === 'disguise') {
    if (RED === 'late') record.late = await c.ev(`(async () => { const L = window.lev; if (!L || !L.brood || !L.buried) return { err: 'no buried brooder' }; L.grp.updateMatrixWorld(true); L.brood.seat(); window.__bench.step(5); return { reseated: true, bury: L.bury }; })()`);
    if (RED === 'late' && (!record.late || record.late.err)) throw new Error('BP_RED late: ' + (record.late && record.late.err));
    out = await c.ev(DISGUISE);
    record.hasSand = await c.ev(`!!(window.__burial && window.__burial.sandAt)`);
  }
  if (MODE === 'breath') {
    const legs = [];
    for (const [d, secs] of [[6, 40], [12, 30]]) {
      const pl = await c.ev(BREATH_PLACE(d));
      if (!pl || pl.err) { out = pl; break; }
      console.log(`leg ${d} u: ${JSON.stringify(pl)}`);
      for (let f = 0; f < secs * 60; f += 300) await c.ev(BREATH_BOOK(Math.min(300, secs * 60 - f), d));
      legs.push(pl);
    }
    if (!out) out = { legs, series: await c.ev(`window.__bpS || []`), hasMound: await c.ev(`!!window.lev.mound`),
      up: await c.ev(`(window.__burial && window.__burial.knobs.breath ? window.__burial.knobs.breath.up : null)`),
      knobs: await c.ev(`(window.__burial && window.__burial.knobs.breath ? JSON.parse(JSON.stringify(window.__burial.knobs.breath)) : null)`) };
  }
  if (MODE === 'programs') {
    const inst = await c.ev(PROG_INSTALL);
    const ph = { install: inst };
    ph.boot = await c.ev(`window.__bpProg.read('boot')`);
    // (Task 5b) him 23 u from the strip's CENTRE on the sand side's bearing (was 14 u off ring 1's edge: the 20 u strip moved that edge, and
    // the framing with it, 8.7 u out, so a base run and this build framed different spots and her moult relic came into the new frame at
    // first sight: vsBase compared two cameras). 23 u is the old framing's distance on the 20 u strip; run the base with this probe too
    const place = async () => { const pl = await c.ev(BREATH_PLACE(23, true)); if (!pl || pl.err) throw new Error('place: ' + (pl && pl.err)); return pl; };
    ph.place = await place();
    console.log(`framing: ${JSON.stringify(ph.place)}`);
    ph.firstF = await c.ev(`window.__bpProg.frames(120, 'first')`); ph.first = await c.ev(`window.__bpProg.read('first')`);
    ph.control = await c.ev(`window.__bpProg.control()`);
    ph.controlGone = await c.ev(`window.__bpProg.uncontrol()`);
    console.log(`control: ${JSON.stringify(ph.control)} -> removed ${JSON.stringify(ph.controlGone)}`);
    ph.aF = await c.ev(`window.__bpProg.frames(120, 'a')`); ph.a = await c.ev(`window.__bpProg.read('a')`);
    ph.homeKey = await c.ev(`window.__bpProg.shellKey()`);
    if (RED === 'lazy') ph.lazy = await c.ev(`window.__bpProg.lazyRed()`);
    // (b) the rise: woken as the pull's onWake wakes her; to L.hasStood (Task 7a), else 9 s
    ph.wake = await c.ev(`(window.__lev.cmd('wake'), { dormant: !!window.lev.dormant, hasStoodKnown: 'hasStood' in window.lev })`);
    let bF = { max: -1 }, nb = 0, slF = 0;
    ph.hasSlabs = await c.ev(`!!window.lev.slabs`);
    for (let k = 0; k < (ph.wake.hasStoodKnown ? 60 : 9); k++) {
      const f = await c.ev(`window.__bpProg.frames(60, 'b')`); nb += 60; slF += f.slabFrames || 0; if (f.max > bF.max) bF = f;
      if (ph.wake.hasStoodKnown && await c.ev(`!!window.lev.hasStood`)) break; }
    ph.bF = Object.assign(bF, { frames: nb, slabFrames: slF }); ph.b = await c.ev(`window.__bpProg.read('b')`);
    // (c) the calm (Task 10): the point and the walk home, rendered (header)
    ph.calm = await c.ev(`(() => { const L = window.lev; window.survival.hose = 760; window.__lev.cmd('calm'); let by = 'verb';
      if (!('calmNext' in L)) { by = 'direct'; for (const g of L.sigils) if (!g.lit) { g.lit = true; g.rev = 1; } } return { by, pointKnown: 'pointPh' in L }; })()`);
    let cF = { max: -1 }, nc = 0, cIn = 0, ran = false;
    for (let k = 0; k < 20; k++) {
      const f = await c.ev(`(async () => { const THREE = await import('three'), { camera } = await import('/src/core.js'), L = window.lev, sh = L.parts.shell; let inF = 0, ph = 0;
        const fr = new THREE.Frustum(), m4 = new THREE.Matrix4(), sp = new THREE.Sphere();
        if (!sh.geometry.boundingSphere) sh.geometry.computeBoundingSphere();
        const r = window.__bpProg.frames(60, 'c'); sh.updateMatrixWorld(true); camera.updateMatrixWorld(true);
        fr.setFromProjectionMatrix(m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)); inF = fr.intersectsSphere(sp.copy(sh.geometry.boundingSphere).applyMatrix4(sh.matrixWorld)) ? 1 : 0;
        return Object.assign(r, { inF, ph: L.pointPh || 0, calmed: !!L.calmed }); })()`);
      nc += 60; cIn += f.inF; if (f.max > cF.max) cF = f; if (f.ph > 0) ran = true;
      if (nc >= 600 && f.ph === 0 && (ran || !ph.calm.pointKnown)) break; }
    ph.c = Object.assign(await c.ev(`window.__bpProg.read('c')`), { max: cF.max, frames: nc, inFrame: cIn, of: nc / 60, pointRan: ran, by: ph.calm.by });
    // (d) the dig-in (Task 12, header): him 35 u off on her sand side facing her, rendered until L.dugIn, at most 45 s
    { const ins = await c.ev(DIG_INSTALL); ph.dPlace = ins && !ins.err ? await c.ev(`window.__bpDig.place35()`) : ins;
      let dF = { max: -1 }, nd = 0, dIn = 0, dug = false;
      for (let k = 0; k < 45 && !dug; k++) {
        const f = await c.ev(`(async () => { const THREE = await import('three'), { camera } = await import('/src/core.js'), L = window.lev, sh = L.parts.shell;
          const fr = new THREE.Frustum(), m4 = new THREE.Matrix4(), sp = new THREE.Sphere();
          if (!sh.geometry.boundingSphere) sh.geometry.computeBoundingSphere();
          const r = window.__bpProg.frames(60, 'd'); sh.updateMatrixWorld(true); camera.updateMatrixWorld(true);
          fr.setFromProjectionMatrix(m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
          return Object.assign(r, { inF: fr.intersectsSphere(sp.copy(sh.geometry.boundingSphere).applyMatrix4(sh.matrixWorld)) ? 1 : 0, dug: !!L.dugIn, bury: L.bury }); })()`);
        nd += 60; dIn += f.inF; if (f.max > dF.max) dF = f; dug = f.dug; }
      ph.d = Object.assign(await c.ev(`window.__bpProg.read('d')`), { max: dF.max, frames: nd, inFrame: dIn, of: nd / 60, dug }); }
    // the other sites: her shell's program is home's; the crust's uBury 0 on every frame
    ph.sites = [];
    for (const si of [1, 2, 3]) {
      await c.ev(`(window.__chart.arrive(${si}), window.gotoZone(0), window.__bench.step(30), 1)`);
      const pl = await place();
      const f = await c.ev(`window.__bpProg.frames(120, 's${si}')`), r = await c.ev(`window.__bpProg.read('s${si}')`);
      const st = await c.ev(`({ site: window.__chart.site(), buried: !!window.lev.buried, crustU: !!window.lev.crustU, key: window.__bpProg.shellKey() })`);
      ph.sites.push({ si, place: pl.him, frames: f, read: r, ...st });
    }
    out = { ...ph, marks: await c.ev(`window.__bpProg.marks`), series: await c.ev(`window.__bpProg.series`) };
  }
  if (MODE === 'rise') {
    // (placed FIRST: Alt+6 rebuilds the zone's sleeper, so the booking is installed on the one he then wakes)
    const where = AT || 'anchor';
    let pl;
    if (where === 'anchor') { await alt(c, 6); pl = await c.ev(`(() => { const H = window.lev.harpoon, p = window.player.pos; return { where: 'anchor', him: [+p.x.toFixed(2), +p.z.toFixed(2)], dAnchor: H && H.anchor ? +Math.hypot(p.x - H.anchor.x, p.z - H.anchor.z).toFixed(2) : null, prompt: window.lev.rite ? window.lev.rite.prompt(p) : null }; })()`); }
    else if (where === 'off' || where === 'under') pl = await c.ev(BREATH_PLACE(where === 'off' ? OFF_D : 12));
    else pl = await c.ev(RISE_PLACE(where));
    if (!pl || pl.err) throw new Error('place: ' + (pl && pl.err));
    // (Task 8) BP_PLUME: a tuning trial's patch of the rise kind (plume.js PLUME.rise), applied before the wake
    if (PLUME_P) { record.plumePatch = PLUME_P; const k = await c.ev(`(window.__plume && window.__plume.kinds.rise ? (Object.assign(window.__plume.kinds.rise, ${JSON.stringify(PLUME_P)}), JSON.parse(JSON.stringify(window.__plume.kinds.rise))) : null)`); if (!k) throw new Error('BP_PLUME: no __plume.kinds.rise on this build'); console.log('BP_PLUME rise kind: ' + JSON.stringify(k)); }
    const ins = await c.ev(RISE_INSTALL);
    if (!ins || ins.err) out = ins;
    else {
      const settle = await c.ev(`window.__bpRise.settle(30)`);
      console.log(`rise at ${where}: ${JSON.stringify(pl)}; settled ${JSON.stringify(settle)}; ${JSON.stringify(ins)}`);
      let st;
      if (where === 'anchor') {
        await c.key('KeyE', true); await c.ev(`window.__bpRise.step(2)`); await c.key('KeyE', false);
        const wr = await c.ev(`({ wrenching: !!window.lev.harpoon.wrenching, state: window.gameState, focus: document.hasFocus(), hidden: document.hidden })`);
        if (!wr.wrenching) throw new Error('real E did not start the wrench at the anchor: ' + JSON.stringify(wr));
        for (let k = 0; k < 20; k++) { st = await c.ev(`window.__bpRise.step(30)`); if (st.wakeF >= 0) break; }
        if (!(st && st.wakeF >= 0)) throw new Error('she did not wake within 10 s of E at the anchor (' + JSON.stringify(pl) + '; ' + JSON.stringify(st) + '; ' + JSON.stringify(await c.ev(`(() => { const H = window.lev.harpoon, p = window.player.pos; return { wrenching: !!H.wrenching, wT: H.wT, pulled: !!H.pulled, wakeT: H.wakeT, d: Math.hypot(p.x - H.anchor.x, p.z - H.anchor.z), dormant: window.lev.dormant, onDeck: window.player.onDeck, state: window.gameState }; })()`)) + ')');
      } else { await c.ev(`window.__bpRise.step(1)`); await c.ev(`(window.__lev.cmd('wake'), 1)`); st = await c.ev(`window.__bpRise.step(1)`); }
      let under = null;
      if (where === 'under') { st = await c.ev(`window.__bpRise.step(${330 - (st.rows - st.wakeF)})`); under = await c.ev(`window.__bpRise.under()`); console.log('under: ' + JSON.stringify(under)); }
      for (let k = 0; k < 40 && st.rows - st.wakeF < RISE_SECS * 60; k++) st = await c.ev(`window.__bpRise.step(${Math.min(300, RISE_SECS * 60 - (st.rows - st.wakeF))})`);
      out = { where, place: pl, settle, ins, wakeF: st.wakeF, under, underF: under ? await c.ev(`window.__bpRise.underF`) : null, S: await c.ev(`window.__bpRise.S`) };
    }
  }
  // (Task 12) THE DIG-IN CHAIN (header): the pull at the anchor, her stand, him 35 u off, the calm, the point, the walk home, her settle,
  // him re-placed; sess.winF = the window's first row
  const dig = (n, stop) => c.ev(`window.__bpDig.step(${n}, ${stop ? JSON.stringify(stop) : 'null'})`);
  // (BP_SHOTS) a still: n RENDERED frames counted on the plugged clock (the post chain settles), then a frozen capture (its 25 frames at dt 1e-4)
  const shot = async (name, n = 90) => {
    await c.ev(`(window.__bench.step(${n}, null, { render: true }), 1)`);
    const url = await c.ev(`(async () => window.__bench.png(await window.__bench.capture({}), 1))()`);
    const dir = join(homedir(), 'sc/.abyssa-wt/shots/buried'), file = join(dir, `${SHOTS}-${name}.png`);
    mkdirSync(dir, { recursive: true }); writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
    console.log(`still ${file} (bury ${await c.ev('window.lev.bury')})`); };
  // (oldwound) THE WOUND AFTER THE DIG-IN (clear and offbed, not under a RED): before the pull, the iron's read at 10 u (the wound mode's
  // reference, glint on; her sculpt waited for, so the framing's seam is the seated one); dug in, the wound's read at 10 u (glint on) and at
  // the anchor (glint hidden), both riding her body (WOUND_INSTALL keeps the seam and the anchor in her frame). Weather 0.5 for the reads
  // only, as the wound mode's, then handed back
  const woundRef = async sess => {
    if (RED || !(sess.run === 'clear' || sess.run === 'offbed')) return;
    await c.until(`(window.__bench.step(10), !!(window.lev && window.lev.sculpted))`, 30000, 100).catch(() => null);
    await c.ev(`(window.weather.set(0.5, 0), 1)`);
    const p = await c.ev(WOUND_INSTALL); if (!p || p.err || p.wound || !p.iron) throw new Error('wound install (the iron): ' + JSON.stringify(p));
    sess.woundIron = { prem: p, aim: await c.ev(`window.__bpWound.aim('sand', 10, 0.3)`) };
    sess.woundIron.d10 = await c.ev(`window.__bpWound.read({ glint: true })`);
    await c.ev(`(window.weather.set(null, null), 1)`);
  };
  const woundAfter = async sess => {
    if (!sess.woundIron || !sess.endState || !sess.endState.dugIn) return;
    await c.ev(`(window.weather.set(0.5, 0), 1)`);
    const W = sess.woundAfter = {};
    W.d10aim = await c.ev(`window.__bpWound.aim('sand', 10, 0.3)`); W.d10 = await c.ev(`window.__bpWound.read({ glint: true })`);
    W.anaim = await c.ev(`window.__bpWound.aim('anchor', 0, 0.3)`); W.anchor = await c.ev(`window.__bpWound.read({ glint: false })`);
    W.state = await c.ev(`(() => { const L = window.lev, H = L.harpoon; return { healed: H.healed ?? null, pulled: !!H.pulled, dugIn: !!L.dugIn, w: L.crustU && L.crustU.uWound ? L.crustU.uWound.value.w : null }; })()`);
    await c.ev(`(window.weather.set(null, null), 1)`);
    console.log(`  [${sess.run}] wound after the dig-in: d10 ${JSON.stringify(W.d10aim)} ${JSON.stringify(W.d10)}; anchor ${JSON.stringify(W.anaim)} ${JSON.stringify(W.anchor)}; ${JSON.stringify(W.state)}`);
  };
  const digChain = async sess => {
    await woundRef(sess);
    await alt(c, 6);
    const ins = await c.ev(DIG_INSTALL); if (!ins || ins.err) throw new Error('install: ' + (ins && ins.err));
    sess.ins = ins;
    await dig(30);
    await c.key('KeyE', true); await dig(2); await c.key('KeyE', false);
    const wr = await c.ev(`({ wrenching: !!window.lev.harpoon.wrenching, state: window.gameState })`);
    if (!wr.wrenching) throw new Error('real E did not start the wrench at the anchor: ' + JSON.stringify(wr));
    let st = await dig(600, 'woke'); if (!st.hit) throw new Error('she did not wake within 10 s of E');
    st = await dig(1200, 'stood'); if (!st.hit) throw new Error('she did not stand within 20 s of the wake');
    sess.pulled = await c.ev(`!!window.lev.harpoon.pulled`);
    sess.place1 = await c.ev(`window.__bpDig.place35()`);
    if (HUNT_S > 0) { await dig(Math.round(HUNT_S * 60)); sess.hunted = await c.ev(`(() => { const L = window.lev; return { her: [+L.pos.x.toFixed(2), +L.pos.z.toFixed(2)], offBed: +Math.hypot(L.pos.x - L.lairPos.x, L.pos.z - L.lairPos.z).toFixed(2), calmed: !!L.calmed }; })()`); }
    sess.calmBy = await c.ev(`(window.__lev.cmd('calm'), 'calmNext' in window.lev ? 'verb' : 'none')`);
    if (sess.run === 'offbed') sess.shift = await c.ev(`window.__bpDig.shiftBed(${OFFBED_D}, ${OFFBED_YAW})`);
    for (let k = 0; k < 4; k++) { st = await dig(600, 'settled'); if (st.hit) break; }
    if (!st.hit) throw new Error('UNSETTLED: she had not settled 40 s after the calm (' + JSON.stringify(st) + ')');
    sess.settleF = st.rows;
    sess.place2 = await c.ev(`window.__bpDig.place35()`);
    sess.winF = st.rows;
    if (sess.run === 'offbed') sess.off0 = await c.ev(`window.__bpDig.offBed0()`);
    sess.bed = await c.ev(`(() => { const L = window.lev; return { offBed: +Math.hypot(L.pos.x - L.lairPos.x, L.pos.z - L.lairPos.z).toFixed(3), dYaw: +Math.atan2(Math.sin(L.yaw - L.lairYaw), Math.cos(L.yaw - L.lairYaw)).toFixed(4) }; })()`);
    console.log(`  [${sess.run}] pulled ${sess.pulled}, hunted ${JSON.stringify(sess.hunted || null)}, settled at row ${sess.settleF} ${JSON.stringify(sess.bed)}; him ${JSON.stringify(sess.place2)}; ${JSON.stringify(ins)}`);
  };
  // (fix round 1, I1) THE SECOND RISE after a dig-in and a return (header): the old wound at the anchor, rise's booking, real E; then the calm,
  // the point, the settle and the dig-in again. sess.rise2 = rise's out for riseChecks; sess.after2 the dig-in's
  const secondRise = async sess => {
    await alt(c, 6);
    // (Task 13, BP_RED=mem2) the transplant: one more ward flagged remembered (rememberWard's four writes: lit, mem, memK, L.memWard), AFTER Alt+6 (the jump rebuilds
    // her: a transplant made before it was lost, measured: 2 flagged, 1 booked) and before the rise's booking and the E
    if (RED === 'mem2') sess.mutant = await c.ev(`(() => { const L = window.lev, was = L.sigils.filter(g => g.lit && g.mem).length, g = L.sigils.find(q => !q.mem);
      const memWardWas = L.memWard; if (g) { g.lit = true; g.mem = true; g.memK = 0; L.memWard = L.sigils.indexOf(g); }
      return { was, now: L.sigils.filter(q => q.lit && q.mem).length, marked: g ? L.sigils.indexOf(g) : -1, memWardWas, memWard: L.memWard }; })()`);
    const pl = await c.ev(`(() => { const H = window.lev.harpoon, p = window.player.pos; return { where: 'anchor', him: [+p.x.toFixed(2), +p.z.toFixed(2)], dAnchor: H && H.anchor ? +Math.hypot(p.x - H.anchor.x, p.z - H.anchor.z).toFixed(2) : null, prompt: window.lev.rite ? window.lev.rite.prompt(p) : null, wound: !!(H && H.wound), dormant: !!window.lev.dormant }; })()`);
    const ins = await c.ev(RISE_INSTALL); if (!ins || ins.err) throw new Error('second rise: install: ' + (ins && ins.err));
    const settle = await c.ev(`window.__bpRise.settle(30)`);
    await c.key('KeyE', true); await c.ev(`window.__bpRise.step(2)`); await c.key('KeyE', false);
    sess.rite2 = Object.assign({ prompt: pl.prompt, wound: pl.wound }, await c.ev(`({ pressed: !!window.lev.harpoon.pressed, wrenching: !!window.lev.harpoon.wrenching })`));
    let st = null;
    for (let k = 0; k < 20; k++) { st = await c.ev(`window.__bpRise.step(30)`); if (st.wakeF >= 0) break; }
    sess.rite2.wokeF = st.wakeF; sess.rite2.wokeT = st.wakeF >= 0 ? +(st.wakeF / 60).toFixed(3) : null;
    sess.rite2.pressed = await c.ev(`!!window.lev.harpoon.pressed`);   // (AMENDED on c3eaa00: pressed is set when the wound gives, after the 1.5 s wrench, not on the E frame)
    if (st.wakeF < 0) throw new Error('second rise: she did not wake within 10 s of E at the old wound');
    for (let k = 0; k < 40 && st.rows - st.wakeF < RISE_SECS * 60; k++) st = await c.ev(`window.__bpRise.step(${Math.min(300, RISE_SECS * 60 - (st.rows - st.wakeF))})`);
    sess.rise2 = { where: 'anchor', place: pl, settle, ins, wakeF: st.wakeF, under: null, underF: null, S: await c.ev(`window.__bpRise.S`) };
    // the calm, the point, the settle, the dig-in again (digin's booking on the same sleeper)
    const di = await c.ev(DIG_INSTALL); if (!di || di.err) throw new Error('second rise: dig install: ' + (di && di.err));
    sess.place2b = await c.ev(`window.__bpDig.place35()`);
    await c.ev(`(window.__lev.cmd('calm'), 1)`);
    st = await dig(1200, 'ph2'); sess.point2 = { hit: st.hit, rows: st.rows };
    for (let k = 0; k < 4; k++) { st = await dig(600, 'settled'); if (st.hit) break; }
    sess.settled2 = st.hit;
    if (st.hit) { sess.winF2 = st.rows; await c.ev(`window.__bpDig.place35()`); for (let k = 0; k < 4; k++) { st = await dig(600, 'dug'); if (st.hit) break; } }
    sess.after2 = await c.ev(`window.__bpDig.state()`);
    sess.S2 = await c.ev(`window.__bpDig.S`);
    console.log(`  [${sess.run}] second rise: rite ${JSON.stringify(sess.rite2)}; point2 ${JSON.stringify(sess.point2)}; settled ${sess.settled2}; after ${JSON.stringify(sess.after2)}`);
  };
  if (MODE === 'digin') {
    const sessions = [];
    for (let ri = 0; ri < RUNS.length; ri++) {
      const run = RUNS[ri], sess = { run }; sessions.push(sess);
      if (ri > 0) await reload();
      try {
        if (run === 'early') {
          // (final review item 1) THE CALM BEFORE SHE STANDS: woken (the pull's own onWake), 0.5 s, then the lab calm; 1 s booked, then him
          // 35 u off, settled and dug in
          await alt(c, 6);
          const ins = await c.ev(DIG_INSTALL); if (!ins || ins.err) throw new Error('install: ' + (ins && ins.err));
          sess.ins = ins;
          await dig(30);
          await c.ev(`(window.__lev.cmd('wake'), 1)`);
          sess.wakeF = (await dig(1)).rows - 1;
          await dig(29);
          sess.calmAt = await c.ev(`(() => { const L = window.lev; window.__lev.cmd('calm'); return { rows: window.__bpDig.S.length, bury: L.bury, stand: L.stand, cracked: !!L.cracked, hasStood: !!L.hasStood, calmNext: !!L.calmNext }; })()`);
          await dig(60);
          sess.place1 = await c.ev(`window.__bpDig.place35()`);
          let st = null;
          for (let k = 0; k < 4; k++) { st = await dig(600, 'settled'); if (st.hit) break; }
          sess.settled = !!(st && st.hit);
          if (sess.settled) { sess.place2 = await c.ev(`window.__bpDig.place35()`); for (let k = 0; k < 8; k++) { st = await dig(300, 'dug'); if (st.hit) break; } }
          sess.endState = await c.ev(`window.__bpDig.state()`);
          console.log(`  [early] calm at ${JSON.stringify(sess.calmAt)}; settled ${sess.settled}; end ${JSON.stringify(sess.endState)}`);
        } else await digChain(sess);
        if (run === 'early') { }
        else if (run === 'throwpose' || run === 'throwfit') {
          // (final review item 7) the throw injected, then every frame stepped on its own (a throw out of one caught and booked) to 10 s after it
          sess.trap = await c.ev(run === 'throwpose' ? `window.__bpDig.trapPose()` : `window.__bpDig.trapFit()`);
          sess.warn0 = await c.ev(`window.__bpWarns.length`);
          let st = null;
          for (let k = 0; k < 8; k++) { st = await c.ev(`window.__bpDig.stepSafe(300, 'inj600')`); if (st.injF >= 0 && st.rows >= st.injF + 600) break; }
          sess.inj = st; sess.injF = st ? st.injF : -1;
          sess.escaped = await c.ev(`window.__bpDig.escaped`);
          sess.warns = await c.ev(`window.__bpWarns.slice(${sess.warn0})`);
          sess.endState = await c.ev(`window.__bpDig.state()`);
          console.log(`  [${run}] injected at row ${sess.injF}; escaped ${JSON.stringify(sess.escaped)}; warns ${JSON.stringify(sess.warns)}; end ${JSON.stringify(sess.endState)}`);
        }
        else if (run === 'clear') {
          let st = null;
          if (SHOTS) {   // (BP_SHOTS) mid dig-in: him 25 u off on her sand side (off her ground), stepped to bury 0.42
            await c.ev(`(window.weather.set(0.5, 0), 1)`); sess.midShot = await c.ev(`window.__bpDig.place35(25)`);
            for (let k = 0; k < 4; k++) { st = await dig(600, 'b04'); if (st.hit) break; }
            await shot('mid');
          }
          for (let k = 0; k < 8; k++) { st = await dig(300, 'dug'); if (st.hit) break; }
          await dig(120);
          sess.endState = await c.ev(`window.__bpDig.state()`);
          sess.disg = sess.endState.dugIn ? await c.ev(DISGUISE) : { err: 'not dug in' };
          if (SHOTS && sess.endState.dugIn) {
            sess.scarShot = await c.ev(`window.__bpDig.scarView(3.5)`); await shot('scar');
            await c.ev(`(window.weather.set(0, 0), 1)`); sess.nightShot = await c.ev(BREATH_PLACE(8)); await shot('night', 150);
            await c.ev(`(window.weather.set(0.5, 0), 1)`);
          }
          if (sess.endState.dugIn) {
            const pl = await c.ev(BREATH_PLACE(6)); sess.breathPlace = pl;
            if (pl && !pl.err) { await c.ev(`(window.__bpS = [], 1)`); for (let f = 0; f < 2400; f += 300) await c.ev(BREATH_BOOK(300, 6)); sess.breath = await c.ev(`window.__bpS`); }
          }
          await woundAfter(sess);
        } else if (run === 'offbed') {
          let st = null;
          for (let k = 0; k < 8; k++) { st = await dig(300, 'dug'); if (st.hit) break; }
          await dig(120);
          sess.endState = await c.ev(`window.__bpDig.state()`);
          sess.disg = sess.endState.dugIn ? await c.ev(DISGUISE) : { err: 'not dug in' };
          await woundAfter(sess);
          console.log(`  [offbed] off the first bed ${JSON.stringify(sess.off0)}; coral ${JSON.stringify(sess.disg.coral)}; end ${JSON.stringify(sess.endState)}`);
        } else {
          let st = null;
          if (run === 'pause') { sess.appr = await c.ev(`window.__bpDig.approach()`); if (sess.appr.err) throw new Error(sess.appr.err); await dig(60); sess.apprF = (await c.ev(`window.__bpDig.S.length`)); }
          const stopAt = run === 'pause' ? 'b033' : run === 'crest' ? 'b03' : 'b04';
          for (let k = 0; k < 4; k++) { st = await dig(600, stopAt); if (st.hit) break; }
          if (!st.hit) throw new Error(`MIDWAY: bury never reached ${stopAt} within 40 s of the settle (the dig-in never ran)`);
          if (run === 'pause') {
            sess.walkF = st.rows;
            await c.key('KeyW', true); const on = await dig(300, 'on30'); await c.key('KeyW', false);
            if (!on.hit) throw new Error('walking in, he never reached her ground (' + JSON.stringify(sess.appr) + ')');
            await dig(150);
            sess.turn = await c.ev(`(window.player.yaw += Math.PI, window.player.yaw)`);
            await c.key('KeyW', true); const off = await dig(600, 'off30'); await c.key('KeyW', false);
            if (!off.hit) throw new Error('walking off, he never left her ground');
            const S0 = await c.ev(`window.__bpDig.S.map(r => r.on)`); let i = sess.walkF; while (i < S0.length && !S0[i]) i++; i += 150; while (i < S0.length && S0[i]) i++;
            sess.leaveF = i;
          } else {
            sess.apprF = st.rows;
            sess.fl = await c.ev(run === 'crest' ? `window.__bpDig.crestHold()` : `window.__bpDig.afloat()`); if (sess.fl.err) throw new Error(sess.fl.err);
            await dig(180);
            sess.leaveF = (await c.ev(`window.__bpDig.S.length`));
            sess.leave = await c.ev(`window.__bpDig.place35()`);
          }
          for (let k = 0; k < 4; k++) { const st2 = await dig(600, 'dug'); if (st2.hit) break; }
          await dig(30);
          sess.endState = await c.ev(`window.__bpDig.state()`);
        }
      } catch (e) { sess.err = String(e && e.message || e); console.error(`  [${run}] ${sess.err}`); }
      try { sess.S = await c.ev(`window.__bpDig ? window.__bpDig.S : null`); } catch (e) { sess.S = null; }
      console.log(`  [${run}] rows ${sess.S ? sess.S.length : 0}${sess.endState ? '; end ' + JSON.stringify(sess.endState) : ''}`);
    }
    out = { sessions };
  }
  if (MODE === 'reentry') {
    const sessions = [];
    for (let ri = 0; ri < RUNS.length; ri++) {
      const run = RUNS[ri], sess = { run }; sessions.push(sess);
      if (ri > 0) await reload();
      try {
        if (run === 'iii' || run === 'iv') {
          await digChain(sess);
          let st = null;
          for (let k = 0; k < 4; k++) { st = await dig(600, run === 'iii' ? 'b05' : 'job'); if (st.hit) break; }
          if (!st.hit) throw new Error(`MIDWAY: ${run === 'iii' ? 'bury never reached 0.5' : 'the refit job never started'} within 40 s of the settle (the dig-in never ran)`);
        } else {
          const ins = await c.ev(DIG_INSTALL); if (!ins || ins.err) throw new Error('install: ' + (ins && ins.err));
          await c.ev(`(window.__lev.cmd('wake'), 1)`);
          if (run === 'i') { const st = await dig(600, 'u03'); if (!st.hit) throw new Error('MIDWAY: L.stand never reached 0.3'); }
          else {
            let st = await dig(1200, 'stood'); if (!st.hit) throw new Error('she did not stand within 20 s of the wake');
            sess.place1 = await c.ev(`window.__bpDig.place35()`);
            await c.ev(`(window.__lev.cmd('calm'), 1)`);
            st = await dig(1200, 'ph2'); if (!st.hit) throw new Error('MIDWAY: pointPh never reached 2 (no point on this build?)');
          }
        }
        sess.mid = await c.ev(`window.__bpDig.state()`);
        sess.mid.stand = await c.ev(`window.lev.stand`); sess.mid.job = await c.ev(`!!window.lev.digJob`);
        await c.ev(`(window.__bpOldL = window.lev, window.gotoZone(1), window.__bench.step(30), window.gotoZone(0), 1)`);
        // (BP_RED=keepdig) the mutant: the new sleeper given the old one's dig state
        if (RED === 'keepdig') sess.mutant = await c.ev(`(() => { const o = window.__bpOldL, L = window.lev; L.dormant = o.dormant; L.calmed = o.calmed; L.bury = o.bury; L.moundK = o.moundK; L.digging = o.digging; L.dugIn = o.dugIn; return { dormant: L.dormant, bury: L.bury, digging: L.digging }; })()`);
        await c.ev(`(window.__bpOldL = null, window.__bench.step(30), 1)`);
        const ins2 = await c.ev(DIG_INSTALL); if (!ins2 || ins2.err) throw new Error('install after the return: ' + (ins2 && ins2.err));
        sess.after = await c.ev(`window.__bpDig.state()`);
        sess.floor = await c.ev(`window.__bpDig.floorEq()`);
        sess.disg = await c.ev(DISGUISE);
        console.log(`  [${run}] mid ${JSON.stringify(sess.mid)}; after ${JSON.stringify(sess.after)}; floor ${JSON.stringify(sess.floor)}`);
        if ((run === 'iii' || run === 'iv') && (!RED || RED === 'mem2')) await secondRise(sess);
      } catch (e) { sess.err = String(e && e.message || e); console.error(`  [${run}] ${sess.err}`); }
    }
    out = { sessions };
  }
  if (MODE === 'wound') {
    // (oldwound) THE OLD WOUND READS (header). Session 1: the iron, on this fresh profile
    await c.ev(`(window.weather.set(0.5, 0), 1)`);
    // her sculpt (the shell the seat and the crust are on) lands asynchronously: wait for it, stepping (counted)
    const sculpted = () => c.until(`(window.__bench.step(10), !!(window.lev && window.lev.sculpted))`, 30000, 100).catch(() => null);
    await sculpted();
    const iron = { prem: await c.ev(WOUND_INSTALL) };
    if (!iron.prem || iron.prem.err) throw new Error('install (iron): ' + (iron.prem && iron.prem.err));
    if (iron.prem.wound || !iron.prem.iron || !iron.prem.sculpted) throw new Error('session 1 is not a fresh save with the iron in her: ' + JSON.stringify(iron.prem));
    for (const d of [14, 10]) {
      iron['d' + d + 'aim'] = await c.ev(`window.__bpWound.aim('sand', ${d}, 0.3)`);
      iron['d' + d] = await c.ev(`window.__bpWound.read({ glint: true })`);
      iron['d' + d + 'bare'] = await c.ev(`window.__bpWound.read({ glint: false })`);
      console.log(`  iron d${d} ${JSON.stringify(iron['d' + d + 'aim'])} glint ${JSON.stringify(iron['d' + d])} bare ${JSON.stringify(iron['d' + d + 'bare'])}`);
    }
    // session 2: the remembered build, a pulled save seeded before the page's scripts
    await c.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('abyssa.chart.v1', JSON.stringify({ site: 0, pulled: [1, 0, 0, 0], sighted: [1, 0, 0, 0], tools: { harpoon: true } })); } catch (e) { }` });
    await reload();
    await sculpted();
    const wd = { prem: await c.ev(WOUND_INSTALL) }, reads = {};
    if (!wd.prem || wd.prem.err) throw new Error('install (wound): ' + (wd.prem && wd.prem.err));
    const p = wd.prem;
    if (!(p.sculpted && p.buried && p.dormant && p.wound && p.pulled && !p.pressed && p.seatOk && p.scar)) { out = { err: 'premise: not the remembered build (home, buried, dormant, the wound, the seat, the scar) ' + JSON.stringify(p), iron, wound: wd }; }
    else {
      // the zone line, by the title click's own path
      wd.line = await c.ev(`(() => { window.setState('title'); window.start(); window.__helm = true; const seen = []; window.__bench.step(900, () => { const m = window.__msg(); for (const t of [m.live].concat(m.queue)) if (t && !seen.includes(t)) seen.push(t); }); return seen; })()`);
      await c.ev(`(window.__helm = true, window.__chart.arrive(0), window.gotoZone(0), window.weather.set(0.5, 0), window.__bench.step(30), 1)`);
      await sculpted();
      const p2 = await c.ev(WOUND_INSTALL);
      if (!p2 || p2.err || !(p2.sculpted && p2.wound && p2.dormant)) throw new Error('the rebuilt remembered sleeper: ' + JSON.stringify(p2));
      if (RED === 'noscar') wd.mutant = await c.ev(`(() => { const H = window.lev.harpoon; if (H._woundShow) H._woundShow(false); H.scar.visible = false; H._woundShow = () => {}; H.scar.visible = false; return 'hidden'; })()`);
      for (const [name, mode, d, tx, glintToo] of [['d14', 'sand', 14, 0.3, true], ['d10', 'sand', 10, 0.3, true], ['d6', 'sand', 6, 0.3, true], ['anchor', 'anchor', 0, 0.3, true], ['d10c', 'sand', 10, 0, false], ['anchorc', 'anchor', 0, 0, false]]) {
        const aim = await c.ev(`window.__bpWound.aim('${mode}', ${d}, ${tx})`);
        const r = await c.ev(`window.__bpWound.read({ glint: false })`);
        const g = glintToo ? await c.ev(`window.__bpWound.read({ glint: true })`) : null;
        reads[name] = { aim, read: r, glint: g };
        console.log(`  wound ${name} ${JSON.stringify(aim)} read ${JSON.stringify(r)}${g ? ' glint ' + JSON.stringify(g) : ''}`);
      }
      wd.fronds = await c.ev(`window.__bpWound.fronds()`);
      // the rite: Alt+6, the prompt, REAL E, she wakes
      await alt(c, 6);
      wd.rite = await c.ev(`(() => { const L = window.lev, H = L.harpoon, p = window.player.pos; return { prompt: L.rite ? L.rite.prompt(p) : null, dAnchor: +Math.hypot(p.x - H.anchor.x, p.z - H.anchor.z).toFixed(2), dormant: !!L.dormant }; })()`);
      await c.key('KeyE', true); await c.ev(`(window.__bench.step(2), 1)`); await c.key('KeyE', false);
      Object.assign(wd.rite, await c.ev(`(() => { const L = window.lev, H = L.harpoon; let f = -1; const w0 = !!H.wrenching; window.__bench.step(600, (k) => { if (f < 0 && !L.dormant) f = k; }); return { wrenching0: w0, pressed: !!H.pressed, wokeF: f, dormant: !!L.dormant, shader: (window.__shaderFailed ? window.__shaderFailed() : []).length }; })()`));
      console.log(`  line ${JSON.stringify(wd.line)}; fronds ${JSON.stringify(wd.fronds)}; rite ${JSON.stringify(wd.rite)}`);
      out = { iron, wound: wd, reads };
    }
  }
} catch (e) { fatal = String(e && e.message || e); }
const clock = await drift(c).catch(() => null);
record.clock = clock;
const cons = (await c.console().catch(() => [])).filter(l => /error|EXC/i.test(l) && !/favicon/i.test(l));
record.consoleErrors = cons;
c.close();

// ---- the verdicts: UNMEASURED (2) and LOST (4) come before any bar ----
if (fatal) { console.error('UNMEASURED: page-side throw: ' + fatal); finish(2, 'throw: ' + fatal); }
if (out && out.err) { console.error('UNMEASURED: ' + out.err); finish(2, out.err); }
if (!out) { console.error('UNMEASURED: the page returned no reading (no out, no err)'); finish(2, 'no reading'); }
if (unmeasured(clock)) { console.error('UNMEASURED: no clock reading ' + JSON.stringify(clock)); finish(2, 'no clock reading'); }
record[MODE] = out;
if (lost(clock)) {
  console.log(`${MODE.toUpperCase()} ${JSON.stringify(MODE === 'breath' ? { legs: out.legs, frames: out.series.length } : MODE === 'programs' ? { marks: out.marks } : MODE === 'rise' ? { where: out.where, wakeF: out.wakeF, frames: out.S.length } : out.sessions ? out.sessions.map(q => ({ run: q.run, err: q.err || null })) : out)}`);
  console.log(`CLOCK LOST: drift ${clock.drift} s over ${clock.stepped} s stepped (the bar is ${CLOCK_LOST} s), clock ${clock.running ? 'RUNNING' : 'stopped'}: ${JSON.stringify(clock)}`);
  finish(4, 'clock lost');
}

// programs: the bars (header). Control failures are UNMEASURED (the probe cannot see a compile)
if (MODE === 'programs') {
  const o = out, hasCrust = !!o.install.hasCrust, A = o.a.n, marks = o.marks;
  const ctlOk = o.control.n1 >= o.control.n0 + 1 && o.control.hasKey, goneOk = o.controlGone.n === o.control.n0 && !o.controlGone.hasKey;
  record.programs = { boot: o.boot.n, first: o.first.n, firstNew: o.first.newNames, control: o.control, controlGone: o.controlGone, a: A, b: o.b.n, bMax: o.bF.max, bFrames: o.bF.frames,
    bNew: o.b.newNames, slabFrames: o.bF.slabFrames ?? null, hasSlabs: !!o.hasSlabs, c: o.c, d: o.d, homeKeyCrust: o.homeKey ? o.homeKey.indexOf('|crust') >= 0 : null, sites: o.sites.map(q => ({ si: q.si, n: q.read.n, max: q.frames.max, buryMax: q.frames.buryMax, crust: q.read.crust, sameKey: q.key === o.homeKey, buried: q.buried, newNames: q.read.newNames })) };
  console.log(`PROGRAMS ${JSON.stringify(record.programs)}`);
  if (!ctlOk) { console.error(`UNMEASURED: the positive control did not move the count (${o.control.n0} -> ${o.control.n1}, key ${o.control.hasKey}): the probe cannot see a compile`); finish(2, 'control'); }
  if (!goneOk) { console.error(`UNMEASURED: the control's program was not released (${o.controlGone.n} vs ${o.control.n0}, key ${o.controlGone.hasKey}): (a) would carry it`); finish(2, 'control not released'); }
  const ck = [
    { name: 'rise', val: { a: A, bMax: o.bF.max, b: o.b.n, frames: o.bF.frames }, bar: '(b) every rendered frame == (a) (max and last)', ok: o.bF.max === A && o.b.n === A, vacuous: !(o.bF.frames > 0), judged: true },
    // (Task 7b) the slabs' first draw is inside (b): it compiles nothing only if they were drawn there (in the lens's frustum)
    { name: 'slabDraw', val: { slabFrames: o.bF.slabFrames ?? null }, bar: 'the slabs drawn (visible, in the frustum) on >= 1 rendered frame of (b)', ok: (o.bF.slabFrames || 0) > 0, vacuous: false, judged: !!o.hasSlabs },
    { name: 'calm', val: { a: A, cMax: o.c.max, c: o.c.n, frames: o.c.frames, inFrame: o.c.inFrame + '/' + o.c.of, pointRan: o.c.pointRan, by: o.c.by }, bar: '(c) every rendered frame == (a) (max and last)', ok: o.c.max === A && o.c.n === A, vacuous: !(o.c.frames > 0), judged: true },
    { name: 'digin', val: { a: A, dMax: o.d.max, d: o.d.n, frames: o.d.frames, inFrame: o.d.inFrame + '/' + o.d.of, dug: o.d.dug }, bar: '(d) every rendered frame == (a) (max and last), to L.dugIn', ok: o.d.max === A && o.d.n === A, vacuous: !o.d.dug, judged: true },
    { name: 'shader', val: marks.map(m => m.tag + ':' + m.failed), bar: '__shaderFailed() [] at every checkpoint', ok: marks.every(m => m.failed === 0), vacuous: !marks.length, judged: true },
    { name: 'siteKey', val: o.sites.map(q => q.si + ':' + (q.key === o.homeKey)), bar: 'her shell\'s program at every site is home\'s', ok: !!o.homeKey && o.sites.length === 3 && o.sites.every(q => q.key === o.homeKey), vacuous: !o.homeKey || o.sites.length < 3, judged: true },
    { name: 'crustBoot', val: marks.map(m => m.tag + ':' + m.crust + '/' + m.bare), bar: 'the \'|crust\' programs (crust / body programs without it) at every checkpoint those the boot built (> 0), none of her body\'s without it', ok: marks.length > 0 && marks[0].crust > 0 && marks.every(m => m.crust === marks[0].crust && m.bare === 0) && !!o.homeKey && o.homeKey.indexOf('|crust') >= 0, vacuous: !marks.length, judged: hasCrust },
    { name: 'siteBury', val: o.sites.map(q => q.si + ':' + q.frames.buryMax), bar: 'uBury 0 on every frame off home', ok: o.sites.length === 3 && o.sites.every(q => q.frames.buryMax === 0 && !q.buried), vacuous: o.sites.length < 3, judged: hasCrust }];
  if (process.env.BP_BASE) { let B = null; try { B = JSON.parse(readFileSync(process.env.BP_BASE, 'utf8')).programs; } catch (e) { console.error('BP_BASE: ' + e.message); finish(2, 'BP_BASE'); }
    const P0 = record.programs, kind = a => (a || []).map(q => q.split(' ~')[0]).sort().join(';');
    const pair = (k, a, b) => ({ k, base: b, now: a, ok: a === b });
    const rows = [pair('boot', P0.boot, B.boot), pair('first', P0.first, B.first), pair('a', P0.a, B.a), pair('bMax', P0.bMax, B.bMax), pair('b', P0.b, B.b),
      pair('firstNew', kind(P0.firstNew), kind(B.firstNew)), pair('bNew', kind(P0.bNew), kind(B.bNew)),
      ...P0.sites.flatMap((q, i) => [pair('s' + q.si + 'max', q.max, B.sites[i] && B.sites[i].max), pair('s' + q.si, q.n, B.sites[i] && B.sites[i].n)]),
      // (Task 10) the calm's counts, when the base JSON has them (a base run before Task 10 skipped (c))
      ...(B.c && B.c.n != null ? [pair('cMax', P0.c.max, B.c.max), pair('c', P0.c.n, B.c.n), pair('cNew', kind(P0.c.newNames), kind(B.c.newNames))] : []),
      // (Task 12) the dig-in's counts, when the base JSON has them
      ...(B.d && B.d.n != null && B.d.dug ? [pair('dMax', P0.d.max, B.d.max), pair('d', P0.d.n, B.d.n), pair('dNew', kind(P0.d.newNames), kind(B.d.newNames))] : [])];
    ck.push({ name: 'vsBase', val: rows.filter(r => !r.ok), bar: 'every checkpoint equal to the base build (BP_BASE)', ok: rows.every(r => r.ok), vacuous: !B, judged: true });
    record.vsBase = rows; if (RED) REDS.programs[RED].bars.push('vsBase');
    // the base's own rise failed with the same kinds new in (b): rise is the base's (info), vsBase judges the counts
    const baseRiseFail = !(B.bMax === B.a && B.b === B.a), sameKinds = kind(P0.bNew) === kind(B.bNew);
    if (baseRiseFail && sameKinds && !RED) { const r = ck.find(k => k.name === 'rise'); r.judged = false; r.bar += ' (info under BP_BASE: the base\'s rise failed with the same kinds, ' + kind(B.bNew) + ')'; }
    // (Task 10, pre-registered) the same rule for the calm: the base's own (c) failed with the same kinds new in (c) -> (c) is info, vsBase judges
    if (B.c && B.c.n != null && !(B.c.max === B.a && B.c.n === B.a) && kind(P0.c.newNames) === kind(B.c.newNames) && !RED) { const r = ck.find(k => k.name === 'calm'); r.judged = false; r.bar += ' (info under BP_BASE: the base\'s calm failed with the same kinds, ' + kind(B.c.newNames) + ')'; } }
  if (RED) for (const k of ck) k.judged = REDS.programs[RED].bars.includes(k.name);
  record.checks = ck;
  for (const k of ck) console.log(`  ${k.judged ? (k.vacuous ? 'VOID' : k.ok ? 'ok  ' : 'FAIL') : 'info'} ${k.name.padEnd(8)} ${JSON.stringify(k.val)} (bar ${k.bar})`);
  console.log(`  info first sight +${o.first.n - o.boot.n}: ${JSON.stringify(o.first.newNames)}; (b) new: ${JSON.stringify(o.b.newNames)}; (c) new: ${JSON.stringify(o.c.newNames)}; (d) new: ${JSON.stringify(o.d.newNames)}`);
  if (cons.length) console.error('console errors (booked, not part of the bar): ' + JSON.stringify(cons));
  const J = ck.filter(k => k.judged), failed = J.filter(k => !k.vacuous && !k.ok), vac = J.filter(k => k.vacuous);
  if (RED) {
    if (vac.length) { console.error(`UNMEASURED: BP_RED ${RED}: nothing booked for ${vac.map(k => k.name).join(', ')}`); finish(2, 'RED bars vacuous'); }
    if (failed.length === J.length) { console.log(`RED ${RED}: ${J.map(k => k.name).join(', ')} failed as it must: exit 5`); finish(5); }
    console.error(`RED ${RED} did not fail as written: exit 3`); finish(3, 'RED did not fail');
  }
  if (failed.length) { console.error('FAIL ' + failed.map(k => `${k.name} ${JSON.stringify(k.val)} (bar ${k.bar})`).join('; ')); finish(1, 'failed: ' + failed.map(k => k.name).join(',')); }
  if (vac.length) { console.error('UNMEASURED: nothing booked for ' + vac.map(k => k.name).join(', ')); finish(2, 'vacuous'); }
  console.log('PASS'); finish(0);
}

// (Task 12) digin and reentry: the bars (header). Every session's clock is booked (a LOST one is exit 4); a check is { name: run.bar, ... };
// a RED judges only its own bars on its own runs; a real FAIL beats an UNMEASURED; nothing vacuous passes
function verdict(ck) {
  record.checks = ck;
  for (const k of ck) console.log(`  ${k.judged ? (k.vacuous ? 'VOID' : k.ok ? 'ok  ' : 'FAIL') : 'info'} ${k.name.padEnd(14)} ${JSON.stringify(k.val)} (bar ${k.bar}${k.n != null ? '; n ' + k.n : ''})`);
  if (cons.length) console.error('console errors (booked, not part of the bar): ' + JSON.stringify(cons));
  const J = ck.filter(k => k.judged), failed = J.filter(k => !k.vacuous && !k.ok), vac = J.filter(k => k.vacuous);
  if (RED) {
    if (vac.length) { console.error(`UNMEASURED: BP_RED ${RED}: nothing booked for ${vac.map(k => k.name).join(', ')}`); finish(2, 'RED bars vacuous'); }
    if (failed.length === J.length && J.length) { console.log(`RED ${RED}: ${J.map(k => k.name).join(', ')} failed as it must: exit 5`); finish(5); }
    console.error(`RED ${RED} did not fail as written (${J.filter(k => k.ok).map(k => k.name).join(', ')} held): exit 3`); finish(3, 'RED did not fail');
  }
  if (failed.length) { console.error('FAIL ' + failed.map(k => `${k.name} ${JSON.stringify(k.val)} (bar ${k.bar})`).join('; ') + (vac.length ? '; UNMEASURED ' + vac.map(k => k.name).join(', ') : '')); finish(1, 'failed: ' + failed.map(k => k.name).join(',')); }
  if (vac.length) { console.error('UNMEASURED: nothing booked for ' + vac.map(k => k.name).join(', ')); finish(2, 'vacuous: ' + vac.map(k => k.name).join(',')); }
  console.log('PASS'); finish(0);
}
// the disguise on a pose, as one check: every judged check of `disguise` ok (record: the failures and the readings)
function disgCheck(name, d) {
  if (!d || d.err) return { name, val: d ? d.err : 'no reading', bar: 'every disguise check judged on the pose passes', ok: false, vacuous: true, judged: true };
  const ck = disguiseChecks(d, true).filter(k => k.judged), bad = ck.filter(k => k.vacuous || !k.ok);
  return { name, val: bad.length ? bad.map(k => `${k.name} ${k.vacuous ? 'VOID' : k.val}`) : ck.map(k => `${k.name} ${typeof k.val === 'number' ? k.val : 'ok'}`), bar: 'every disguise check judged on the pose passes (' + ck.map(k => k.name).join(' ') + ')',
    ok: ck.length > 0 && !bad.length, vacuous: !ck.length, judged: true, detail: ck.map(k => ({ name: k.name, val: k.val, ok: k.ok, at: k.at })) };
}
if (MODE === 'digin' || MODE === 'reentry' || MODE === 'wound') {
  const lostS = sessClocks.concat([clock]).filter(q => !unmeasured(q) && lost(q));
  record.sessClocks = sessClocks.concat([clock]);
  if (lostS.length) { console.log(`CLOCK LOST in ${lostS.length} session(s): ${JSON.stringify(lostS)}`); finish(4, 'clock lost'); }
}
// (oldwound) the wound after the dig-in (header, digin): the remembered build's bars, on the fresh pull's wound once she has dug back in
function woundChecks(sess, add) {
  if (RED) return;
  const I = sess.woundIron && sess.woundIron.d10, W = sess.woundAfter || {}, pick = q => q ? { visible: q.visible, weber: q.weber, area: q.area, eqD: q.eqD, Lm: q.Lm, La: q.La, floor: q.floor } : null;
  const voidOf = q => !q || q.floor > 0.02 * Math.pow(2 * q.half + 1, 2);
  add({ name: sess.run + '.wound10', val: { wound: pick(W.d10), iron: pick(I), state: W.state || null, ndc: W.d10aim && W.d10aim.ndc }, bar: 'dug in after the pull: glint on, visible >= the iron\'s at 10 u before the pull (the wound mode\'s d10.range)',
    ok: !!W.d10 && !!I && W.d10.visible >= I.visible, vacuous: !W.d10 || voidOf(W.d10) || voidOf(I) || !I.visible });
  add({ name: sess.run + '.woundAnchor', val: Object.assign(pick(W.anchor) || {}, { ndc: W.anaim && W.anaim.ndc, camD: W.anaim && W.anaim.camD }), bar: 'dug in after the pull: glint hidden, visible >= 1200 px and >= 60% of the footprint (the wound mode\'s anchor.read)',
    ok: !!W.anchor && W.anchor.visible >= 1200 && W.anchor.visible >= 0.6 * W.anchor.area, vacuous: voidOf(W.anchor) });
}
if (MODE === 'digin') {
  const ck = [], f60 = 60, r = v => Math.round(v * 1000) / 1000;
  const redBars = RED ? REDS.digin[RED].runs.flatMap(rn => REDS.digin[RED].bars.map(b => rn + '.' + b)) : null;
  const add = q => { q.judged = !redBars || redBars.includes(q.name); ck.push(q); };
  for (const sess of out.sessions) {
    const run = sess.run, S = sess.S || [], W = sess.winF != null ? S.slice(sess.winF) : [], err = sess.err || null;
    const hold = sess.ins && sess.ins.settle ? sess.ins.settle.hold : 1.0;
    // the dig-in's first frame (bury over the last by > 1e-9) and last (bury >= 1), as rows of S
    let first = -1, last = -1;
    for (let i = (sess.winF ?? S.length) + 1; i < S.length; i++) { if (first < 0 && S[i].bury > S[i - 1].bury + 1e-9) first = i; if (first >= 0 && S[i].bury >= 1) { last = i; break; } }
    sess.first = first; sess.last = last;
    if (run === 'clear') {
      const dur = first >= 0 && last >= 0 ? r((last - first) / f60) : null;
      add({ name: 'clear.dur', val: { dur, first: first >= 0 ? r((first - sess.winF) / f60) : null, window: r(W.length / f60) }, bar: 'first -> last 15.0-20.0 s', ok: dur != null && dur >= 15 && dur <= 20, vacuous: !!err || W.length < 20 * f60 && last < 0 });
      const lr = W[W.length - 1];
      add({ name: 'clear.end', val: lr ? { bury: lr.bury, dugIn: lr.dug } : err, bar: 'bury >= 1 and L.dugIn on the window\'s last frame', ok: !!lr && lr.bury >= 1 && lr.dug === 1, vacuous: !lr });
      add(disgCheck('clear.disg', sess.disg));
      add({ name: 'clear.wards', val: lr ? { light: lr.wl, glow: lr.wg } : err, bar: 'every ward\'s light.intensity 0 and burn glow opacity 0 on the last frame', ok: !!lr && lr.wl === 0 && lr.wg === 0, vacuous: !lr });
      { const B = sess.breath || [], ys = B.filter(q => q[5] === 1).map(q => q[1]), amp = ys.length ? +(Math.max(...ys) - Math.min(...ys)).toFixed(5) : null;
        add({ name: 'clear.breath', val: { amp, frames: ys.length, of: B.length }, bar: 'dug in, 6 u off the strip\'s edge, 40 s: the ring-1 vertex\'s amplitude 0.03-0.06 u', ok: amp != null && amp >= 0.03 && amp <= 0.06, vacuous: !ys.length }); }
      { const C = (last >= 0 ? S.slice(sess.winF, last + 1) : W).map(q => q.upd).filter(q => q != null), srt = C.slice().sort((a, b) => a - b), med = srt.length ? srt[srt.length >> 1] : null, mx = srt.length ? srt[srt.length - 1] : null;
        const iMax = C.indexOf(mx), jobs = S.filter(q => q.job != null && q.job > 0).map(q => q.job), jmx = jobs.length ? Math.max(...jobs) : null;
        add({ name: 'clear.cost', val: { worst: mx, median: med, extra: mx != null ? r(mx - med) : null, atS: r(iMax / f60), p99: srt.length ? srt[Math.floor(srt.length * 0.99)] : null, jobFrames: jobs.length, jobMax: jmx },
          bar: 'the window\'s worst update() frame less its median <= 4.0 ms (pre-registered)', ok: mx != null && mx - med <= 4.0, vacuous: C.length < 600 }); }
      woundChecks(sess, add);
    } else if (run === 'early') {
      // (final review item 1, pre-registered before the fix) the calm at wake + 0.5 s: within 2 frames of the first frame she is calmed, bury 0,
      // L.hasStood, the dune drawn down (moundK 0) and the crack's crust gone (crackK 0), held for the 60 booked frames after the calm
      const cf = S.findIndex(q => q.calmed), pre = cf > 0 ? S[cf - 1] : null;
      const snap = cf >= 0 ? S.slice(cf, cf + 3).findIndex(q => q.bury === 0 && q.hs === 1 && q.mk2 === 0 && q.ck === 0) : -1;
      const heldBad = snap >= 0 ? S.slice(cf + snap, cf + 61).filter(q => !(q.bury === 0 && q.hs === 1)).length : null;
      const at = i => S[i] ? { bury: r(S[i].bury), hs: S[i].hs, mk2: S[i].mk2, ck: S[i].ck, stand: S[i].stand } : null;
      add({ name: 'early.snap', val: { calmF: cf, calmS: cf >= 0 && sess.wakeF != null ? r((cf - sess.wakeF) / f60) : null, buryBefore: pre ? r(pre.bury) : null, snapF: snap >= 0 ? snap : null, heldBad, at0: at(cf), at2: at(cf + 2), at60: at(cf + 60) },
        bar: 'a calm in the rise (bury > 0.5 the frame before): bury 0, hasStood, moundK 0, crackK 0 within 2 frames of the calm, held 60 frames', ok: snap >= 0 && heldBad === 0, vacuous: !!err || cf < 0 || !(pre && pre.bury > 0.5) });
      add({ name: 'early.dug', val: sess.endState ? { settled: sess.settled, dugIn: sess.endState.dugIn, bury: sess.endState.bury } : err, bar: 'after it she points, walks home, settles and digs in (L.dugIn, bury 1)', ok: !!sess.endState && sess.endState.dugIn && sess.endState.bury === 1, vacuous: !!err || !sess.endState });
    } else if (run === 'throwpose' || run === 'throwfit') {
      // (final review item 7, pre-registered before the fix) a throw inside a slice of the dig-in's job abandons it cleanly: nothing escapes the
      // frame; ONE console.warn; from the injected frame's row to 10 s after it the job gone (no digJob), not digging and never dug in, awake,
      // bury 0 and the dune hidden (moundK 0, MD.k <= 0), noPub false, and her body's drawn matrix her pose's (<= 1e-6)
      const f = sess.injF, A = f >= 0 ? S.slice(f) : [], bad = A.filter(q => !(q.jph === -1 && q.dig === 0 && q.dug === 0 && q.dorm === 0 && q.bury === 0 && q.mk2 === 0 && !(q.mk > 0) && q.np === 0 && q.bm != null && q.bm <= 1e-6));
      const w = (sess.warns || []).filter(q => /dig-in/i.test(q));
      add({ name: run + '.escape', val: { escaped: sess.escaped || null }, bar: 'no throw escapes the frame (the job catches its own)', ok: f >= 0 && !(sess.escaped || []).length, vacuous: !!err || f < 0 });
      add({ name: run + '.warn', val: { n: w.length, warns: (sess.warns || []).slice(0, 4) }, bar: 'exactly one console.warn of the dig-in\'s job', ok: f >= 0 && w.length === 1, vacuous: !!err || f < 0 });
      add({ name: run + '.state', val: { rows: A.length, bad: bad.length, first: bad.length ? { f: S.indexOf(bad[0]) - f, jph: bad[0].jph, dig: bad[0].dig, dug: bad[0].dug, bury: bad[0].bury, mk2: bad[0].mk2, mk: bad[0].mk, np: bad[0].np, bm: bad[0].bm, esc: bad[0].esc } : null },
        bar: 'from the injected frame to 10 s after: no job, not digging, never dug in, awake, bury 0, the dune hidden, noPub false, her body\'s matrix her pose\'s', ok: A.length >= 600 && !bad.length, vacuous: !!err || A.length < 600 });
    } else if (run === 'offbed') {
      const o = sess.off0, d = sess.disg, q = d && !d.err ? d.coral : null;
      add({ name: 'offbed.off', val: o || err, bar: `premise: she lies >= ${OFFBED_MIN} u off the bed she was built on at the dig-in`, ok: !!o && o.off >= OFFBED_MIN, vacuous: !!err || !o || !(o.off >= OFFBED_MIN) });
      add({ name: 'offbed.coral', val: q ? { outBand: q.outBand, n: q.n, firstOut: q.firstOut, under: q.under, low: q.low } : (d && d.err) || err, bar: 'dug in off her first bed: every coral vertex inside the NEW bed\'s strip band (DISGUISE coral, growRock\'s own rule at the source)', ok: !!q && q.n > 0 && q.outBand === 0, vacuous: !q || !q.n });
      add({ name: 'offbed.end', val: sess.endState ? { bury: sess.endState.bury, dugIn: sess.endState.dugIn } : err, bar: 'dug in off her first bed: L.dugIn and bury 1', ok: !!sess.endState && sess.endState.dugIn && sess.endState.bury === 1, vacuous: !!err || !sess.endState });
      ck.push(Object.assign(disgCheck('offbed.disg', d), { judged: false }));
      woundChecks(sess, add);
    } else {
      const from = sess.apprF ?? S.length, A = S.slice(from), on = [], lv = sess.leaveF;
      for (let i = Math.max(1, from); i < S.length; i++) if (S[i].on && S[i - 1].bury > 0 && S[i - 1].bury < 1) on.push({ i, d: Math.abs(S[i].bury - S[i - 1].bury) });
      const worst = on.reduce((a, q) => Math.max(a, q.d), 0), moved = on.filter(q => q.d > 1e-9).length;
      add({ name: run + '.pause', val: { onFrames: on.length, moved, worst: +worst.toExponential(3) }, bar: '|d bury| <= 1e-9 on every frame he is on her ground mid dig-in (>= 60)', ok: on.length >= 60 && moved === 0, vacuous: !!err || on.length < 60 });
      let rs = -1; if (lv != null) for (let i = lv; i < S.length; i++) if (S[i].bury > S[i - 1].bury + 1e-9) { rs = i; break; }
      const k = rs >= 0 ? rs - lv + 1 : null, kMax = Math.round(hold * f60) + 1;
      add({ name: run + '.resume', val: { frames: k, max: kMax, buryAtLeave: lv != null && S[lv] ? S[lv].bury : null }, bar: '<= SETTLE.hold x 60 + 1 frames after he leaves', ok: k != null && k <= kMax, vacuous: !!err || k == null });
      if (run === 'pause') {
        const own = A.map(q => q.own), lens = A.map(q => q.lens);
        add({ name: 'pause.boots', val: { min: own.length ? Math.min(...own) : null, n: own.length }, bar: 'his OWN boot gap over the drawn sand >= -0.15 u, every frame from the approach', ok: own.length > 0 && Math.min(...own) >= -0.15, vacuous: !!err || !own.length });
        add({ name: 'pause.lens', val: { min: lens.length ? Math.min(...lens) : null, n: lens.length }, bar: 'the lens >= 0.3 u over the drawn surface, every frame from the approach', ok: lens.length > 0 && Math.min(...lens) >= 0.3, vacuous: !!err || !lens.length });
      } else if (run === 'afloat') {
        const H = A.filter(q => q.held), dt = 1 / f60, over = H.filter(q => q.drop > 0.5 * (0.11 + Math.max(0, -q.buoy) + 0.121) * dt * dt + 1e-4);
        add({ name: 'afloat.calm', val: { held: H.length, calmOutMax: H.length ? Math.max(...H.map(q => q.calmOut)) : null, onHeld: H.filter(q => q.on).length }, bar: 'BODY.calmOut 0 on every held frame (>= 60)', ok: H.length >= 60 && H.every(q => q.calmOut === 0), vacuous: !!err || H.length < 60 });
        add({ name: 'afloat.sink', val: { held: H.length, over: over.length, dropMax: H.length ? Math.max(...H.map(q => q.drop)) : null, hovMin: H.length ? Math.min(...H.map(q => q.hov)) : null }, bar: 'each held frame\'s drop <= 0.5 (0.11 + |min(0, buoy)| + 0.121) dt^2 + 1e-4 u', ok: H.length >= 60 && !over.length, vacuous: !!err || H.length < 60 });
      }
    }
    if (err) ck.push({ name: run + '.err', val: err, bar: 'the run completed', ok: false, vacuous: true, judged: false });
  }
  console.log(`DIGIN ${JSON.stringify(out.sessions.map(q => ({ run: q.run, err: q.err || null, rows: q.S ? q.S.length : 0, winF: q.winF, first: q.first, last: q.last, place: q.place2, end: q.endState || null })))}`);
  verdict(ck);
}
if (MODE === 'reentry') {
  const ck = [];
  for (const sess of out.sessions) {
    const run = sess.run, a = sess.after, err = sess.err || null, vac = !!err || !a;
    ck.push({ name: run + '.dormant', val: a ? { dormant: a.dormant, bury: a.bury } : err, bar: 'lev.dormant and bury exactly 1', ok: !!a && a.dormant && a.bury === 1, vacuous: vac, judged: true });
    ck.push(Object.assign(disgCheck(run + '.disg', vac ? { err: err || 'no reading' } : sess.disg)));
    ck.push({ name: run + '.cue', val: a ? { k: a.k, pointPh: a.pointPh, pointK: a.pointK, calmNext: a.calmNext, digging: a.digging, dugIn: a.dugIn } : err, bar: '__pointcam k 0; pointPh 0, pointK 0, calmNext false, digging / dugIn false',
      ok: !!a && a.k === 0 && a.pointPh === 0 && a.pointK === 0 && !a.calmNext && !a.digging && !a.dugIn, vacuous: vac || (a && a.k == null), judged: true });
    ck.push({ name: run + '.floor', val: sess.floor || err, bar: 'extraFloorAt == the live dune (sandAt) within 1e-9 at every mid-quad point (>= 100, all on the dune)', ok: !!sess.floor && sess.floor.n >= 100 && !sess.floor.bad && !sess.floor.off, vacuous: vac || !sess.floor || sess.floor.n < 100, judged: true });
    { const d = sess.disg && !sess.disg.err ? disguiseChecks(sess.disg, true).find(k => k.name === 'clutch') : null;
      ck.push({ name: run + '.clutch', val: a ? { clutch: d ? d.val : null, drop: a.drop, want: a.dropWant } : err, bar: 'the disguise clutch check and B.drop == clutchSink / R', ok: !!a && !!d && d.ok && a.drop != null && Math.abs(a.drop - a.dropWant) < 1e-12, vacuous: vac || !d, judged: true }); }
    ck.push({ name: run + '.shader', val: a ? a.shader : err, bar: '__shaderFailed() []', ok: !!a && a.shader === 0, vacuous: vac, judged: true });
    // (fix round 1, I1) THE SECOND RISE (header), sessions iii and iv
    if ((run === 'iii' || run === 'iv') && (!RED || RED === 'mem2')) {
      const r2 = sess.rite2, R2 = sess.rise2, v2 = !!err && !R2;
      ck.push({ name: run + '.rite', val: r2 || err, bar: 'the prompt "[E] PRESS THE OLD WOUND", the wound pressed by real E, she wakes within 10 s', ok: !!r2 && r2.prompt === '[E] PRESS THE OLD WOUND' && r2.pressed && r2.wokeF >= 0, vacuous: !r2, judged: true });
      if (R2) { const { ck: rc } = riseChecks(R2), keep = ['a', 'b', 'c', 'd', 'f', 'g', 'h', 'i', 'iShell'];
        // (Task 13) the shipped (c), "none lit", is booked as rise.cShipped (info): rise.c is the amended reading below, the only one BP_RED=mem2 judges
        for (const k of rc) ck.push(Object.assign({}, k, { name: run + '.rise.' + (k.name === 'c' ? 'cShipped' : k.name), judged: keep.includes(k.name) && k.name !== 'c' }));
        // (c) AMENDED on c3eaa00 (data: litFrames 971): the rebuilt sleeper is REMEMBERED (game.js calmedBefore: the chart recorded the calm), so one
        // ward is dim-lit from her build by design (common.js rememberWard); "none lit" is read as none lit but the remembered ward
        { const S = R2.S, w = R2.wakeF; let s1 = -1; for (let i = w; i < S.length; i++) { const q = S[i]; if (q.stand >= 1 && Math.abs(q.hx - 1) < 0.02 && Math.abs(q.hv) < 0.05) { s1 = i; break; } }
          const cW = S[w] ? S[w].wmax : null, cS = s1 >= 0 ? S[s1].wmin : null, litN = S.filter(q => q.lit - (q.mem || 0) > 0).length, memN = S.length ? Math.max(...S.map(q => q.mem || 0)) : 0;
          ck.push({ name: run + '.rise.c', val: { wardsAtWakeMax: cW, wardsAtStoodMin: cS, litFrames: litN, remembered: memN, mutant: sess.mutant || null }, bar: 'wards < 0 over the sand at the wake, > 2 at STOOD, none lit but the remembered one, and at most one remembered (memN <= 1)',
            ok: cW != null && cW < 0 && cS != null && cS > 2 && litN === 0 && memN <= 1, vacuous: s1 < 0, judged: true }); }
        const S = R2.S, w = R2.wakeF; let s0 = -1; for (let i = w; i < S.length; i++) { const q = S[i]; if (q.stand >= 1 && Math.abs(q.hx - 1) < 0.02 && Math.abs(q.hv) < 0.05) { s0 = i; break; } }
        const g2 = S.findIndex((q, k) => k >= w && q.gb === 2), g0 = g2 < 0 ? -1 : S.findIndex((q, k) => k > g2 && q.gb === 0);
        ck.push({ name: run + '.reveal', val: { revealAt: g2 < 0 ? null : +((g2 - w) / 60).toFixed(3), fullAt: g0 < 0 ? null : +((g0 - w) / 60).toFixed(3), stoodAt: s0 < 0 ? null : +((s0 - w) / 60).toFixed(3) },
          bar: 'L.growthBuried 2 after the wake, then 0 before STOOD (growReveal ran and finished)', ok: g2 >= 0 && g0 >= 0 && s0 >= 0 && g0 <= s0, vacuous: s0 < 0, judged: true }); }
      else ck.push({ name: run + '.rise', val: err, bar: 'the second rise booked', ok: false, vacuous: true, judged: true });
      ck.push({ name: run + '.point2', val: sess.point2 || err, bar: 'pointPh 2 seen within 20 s of the calm', ok: !!sess.point2 && sess.point2.hit, vacuous: !sess.point2, judged: true });
      { const S = sess.S2 || [], w = sess.winF2; let f = -1, l = -1;
        if (w != null) for (let i = w + 1; i < S.length; i++) { if (f < 0 && S[i].bury > S[i - 1].bury + 1e-9) f = i; if (f >= 0 && S[i].bury >= 1) { l = i; break; } }
        const dur = f >= 0 && l >= 0 ? +((l - f) / 60).toFixed(3) : null, a2 = sess.after2;
        ck.push({ name: run + '.dig2', val: { settled: !!sess.settled2, dur, dugIn: a2 ? a2.dugIn : null, bury: a2 ? a2.bury : null }, bar: 'settled, then L.dugIn within 40 s, its first -> last 15-20 s', ok: !!a2 && a2.dugIn && dur != null && dur >= 15 && dur <= 20, vacuous: !sess.point2, judged: true }); }
    }
  }
  if (RED) for (const k of ck) k.judged = REDS.reentry[RED].runs.some(rn => REDS.reentry[RED].bars.some(b => k.name === rn + '.' + b));
  console.log(`REENTRY ${JSON.stringify(out.sessions.map(q => ({ run: q.run, err: q.err || null, mid: q.mid || null })))}`);
  verdict(ck);
}

// (oldwound) wound: the bars (header)
if (MODE === 'wound') {
  const ck = [], R = out.reads || {}, W = out.wound || {}, I = out.iron || {};
  const R0 = n => R[n] && R[n].read, G0 = n => R[n] && R[n].glint, pick = q => q ? { visible: q.visible, weber: q.weber, area: q.area, eqD: q.eqD, Lm: q.Lm, La: q.La, floor: q.floor } : null;
  const voidOf = q => !q || q.floor > 0.02 * Math.pow(2 * q.half + 1, 2);   // (VOID: the plain A/A turned > 2% of the window hot)
  // THE RANGE READ, as the iron's was read (its glint and its stub): at 10 u at least the iron's visible pixels there; at 14 u at most 1.25 x them
  { const w = G0('d10'), i = I.d10; ck.push({ name: 'd10.range', val: { wound: pick(w), iron: pick(i), ndc: R.d10 && R.d10.aim.ndc, camD: R.d10 && R.d10.aim.camD },
      bar: 'glint on: visible >= the iron\'s visible at 10 u on a fresh save', ok: !!w && !!i && w.visible >= i.visible, vacuous: voidOf(w) || voidOf(i) || !i.visible, judged: true }); }
  { const w = G0('d14'), i = I.d14; ck.push({ name: 'd14.vsIron', val: { wound: pick(w), iron: pick(i) },
      bar: 'glint on: visible <= 1.25 x the iron\'s at 14 u on a fresh save (no more of a give-away than the iron)', ok: !!w && !!i && w.visible <= 1.25 * i.visible, vacuous: voidOf(w) || voidOf(i) || !i.visible, judged: true }); }
  // THE MARK, the glint hidden: at 6 u on the sand and at the anchor
  { const q = R0('d6'); ck.push({ name: 'd6.mark', val: Object.assign(pick(q) || {}, { ndc: R.d6 && R.d6.aim.ndc }), bar: 'glint hidden: visible >= 150 px', ok: !!q && q.visible >= 150, vacuous: voidOf(q), judged: true }); }
  { const q = R0('anchor'); ck.push({ name: 'anchor.read', val: Object.assign(pick(q) || {}, { ndc: R.anchor && R.anchor.aim.ndc, camD: R.anchor && R.anchor.aim.camD }), bar: 'glint hidden: visible >= 1200 px and >= 60% of the footprint visible (Weber booked)', ok: !!q && q.visible >= 1200 && q.visible >= 0.6 * q.area, vacuous: voidOf(q), judged: true }); }
  for (const n of ['d10', 'd14', 'd10c', 'anchorc']) { const q = R0(n); ck.push({ name: n + '.mark', val: q ? Object.assign(pick(q), { ndc: R[n].aim.ndc }) : null, bar: 'booked (glint hidden)', ok: true, vacuous: false, judged: false }); }
  for (const n of ['anchor']) { const q = G0(n); if (q) ck.push({ name: n + '.glint', val: pick(q), bar: 'booked (the read with the glint on)', ok: true, vacuous: false, judged: false }); }
  for (const n of ['d10bare', 'd14bare']) { const q = I[n]; ck.push({ name: 'iron.' + n, val: pick(q), bar: 'booked (the iron on a fresh save, its glint hidden)', ok: true, vacuous: false, judged: false }); }
  { const f = W.fronds; ck.push({ name: 'fronds', val: f || null, bar: 'no drawn frond or coral vertex within GROW.near of the seam or in its sight corridor', ok: !!f && !f.weedNear && !f.weedSight && !f.coralNear && !f.coralSight, vacuous: !f || !f.weedN, judged: true }); }
  { const L = W.line || [], z = L.find(t => /OLD WOUND/.test(t)) || null; ck.push({ name: 'line', val: z, bar: "the zone line holds 'OLD WOUND' and not 'RIDGE' (she is buried)", ok: !!z && !/RIDGE/.test(z), vacuous: !W.line, judged: true }); }
  { const r = W.rite; ck.push({ name: 'rite', val: r || null, bar: '"[E] PRESS THE OLD WOUND" at the anchor, REAL E, pressed, she wakes within 10 s', ok: !!r && r.prompt === '[E] PRESS THE OLD WOUND' && r.pressed && r.wokeF >= 0, vacuous: !r, judged: true });
    ck.push({ name: 'shader', val: r ? r.shader : null, bar: '__shaderFailed() []', ok: !!r && r.shader === 0, vacuous: !r, judged: true }); }
  if (RED) for (const k of ck) k.judged = REDS.wound[RED].bars.includes(k.name);
  verdict(ck);
}

// breath: the bars (header). A RED judges only its own bars; otherwise a real FAIL beats an UNMEASURED, and nothing vacuous passes
if (MODE === 'breath') {
  const S = out.series, up = out.up ?? 1.6, rows = leg => S.filter(r => r[0] === leg);
  const r6 = rows(6), r12 = rows(12), dorm6 = r6.filter(r => r[5] === 1), ys = dorm6.map(r => r[1]);
  const lo = ys.length ? Math.min(...ys) : null, hi = ys.length ? Math.max(...ys) : null, amp = ys.length ? +(hi - lo).toFixed(5) : null;
  // the peaks: an excursion over half the amplitude, its top; one cut by the leg's first or last frame is not booked
  const peaks = [];
  if (amp > 1e-4) { const th = lo + amp / 2; let a = -1;
    for (let i = 0; i <= r6.length; i++) { const over = i < r6.length && r6[i][1] > th;
      if (over && a < 0) a = i;
      if (!over && a >= 0) { if (a > 0 && i < r6.length) { let m = a; for (let q = a; q < i; q++) if (r6[q][1] > r6[m][1]) m = q; peaks.push(+(m / 60).toFixed(3)); } a = -1; } } }
  const iv = peaks.slice(1).map((t, i) => +(t - peaks[i]).toFixed(3));
  // a breath = its rise completed inside the leg (brAge crossing up: the frame breathTick's trickle check runs)
  const ups = (rr, age0) => { let n = 0, prev = age0; for (const r of rr) { if (r[3] != null && prev != null && prev < up && r[3] >= up) n++; if (r[3] != null) prev = r[3]; } return n; };
  const b6 = ups(r6, out.legs[0] ? out.legs[0].age0 : null), b12 = ups(r12, r6.length ? r6[r6.length - 1][3] : null);
  const t6 = r6.length ? r6[r6.length - 1][2] - (out.legs[0] ? out.legs[0].tr0 : 0) : 0, t12 = r12.length && r6.length ? r12[r12.length - 1][2] - r6[r6.length - 1][2] : 0;
  const dh = rr => rr.length ? [Math.min(...rr.map(r => r[6])), Math.max(...rr.map(r => r[6]))] : null, dc = rr => rr.length ? [Math.min(...rr.map(r => r[7])), Math.max(...rr.map(r => r[7]))] : null;
  const ck = [
    { name: 'amp', val: amp, n: dorm6.length, bar: '0.03 - 0.06 u (max - min of the ring-1 vertex, dormant, at 6 u)', ok: amp != null && amp >= 0.03 && amp <= 0.06, vacuous: !dorm6.length },
    { name: 'interval', val: iv, n: peaks.length, peaks, bar: 'every peak-to-peak 8 - 10 s, >= 3 peaks', ok: peaks.length >= 3 && iv.every(v => v >= 8 && v <= 10), vacuous: peaks.length < 3 },
    { name: 'trickle6', val: b6 ? +(t6 / b6).toFixed(2) : null, n: b6, trickles: t6, bar: '>= 1 per breath at 6 u', ok: b6 > 0 && t6 >= b6, vacuous: b6 === 0 },
    { name: 'trickle12', val: t12, n: b12, bar: '0 at 12 u over 30 s', ok: b12 > 0 && t12 === 0, vacuous: b12 === 0 }];
  const red = RED ? REDS.breath[RED].bars : null;
  for (const k of ck) k.judged = !red || red.includes(k.name);
  record.checks = ck;
  record.legsInfo = { notDormant: S.filter(r => r[5] !== 1).length, him6: dh(r6), him12: dh(r12), lens6: dc(r6), lens12: dc(r12), breaths: [b6, b12], hasMound: out.hasMound, knobs: out.knobs };
  console.log(`BREATH ${JSON.stringify({ legs: out.legs, frames: S.length, info: record.legsInfo })}`);
  for (const k of ck) console.log(`  ${k.judged ? (k.vacuous ? 'VOID' : k.ok ? 'ok  ' : 'FAIL') : 'info'} ${k.name.padEnd(9)} ${JSON.stringify(k.val)} (bar ${k.bar}; n ${k.n}${k.peaks ? '; peaks at ' + JSON.stringify(k.peaks) + ' s' : ''}${k.trickles != null ? '; trickles ' + k.trickles : ''})`);
  if (cons.length) console.error('console errors (booked, not part of the bar): ' + JSON.stringify(cons));
  const J = ck.filter(k => k.judged), failed = J.filter(k => !k.vacuous && !k.ok), vac = J.filter(k => k.vacuous);
  if (RED) {
    if (vac.length) { console.error(`UNMEASURED: BP_RED ${RED}: nothing booked for ${vac.map(k => k.name).join(', ')}`); finish(2, 'RED bars vacuous'); }
    if (failed.length === J.length) { console.log(`RED ${RED}: ${red.join(', ')} failed as it must: exit 5`); finish(5); }
    console.error(`RED ${RED} did not fail as written (${J.filter(k => k.ok).map(k => k.name).join(', ')} held): exit 3`); finish(3, 'RED did not fail');
  }
  if (failed.length) { console.error('FAIL ' + failed.map(k => `${k.name} ${JSON.stringify(k.val)} (bar ${k.bar})`).join('; ') + (vac.length ? '; UNMEASURED ' + vac.map(k => k.name).join(', ') : '')); finish(1, 'failed: ' + failed.map(k => k.name).join(',')); }
  if (vac.length) { console.error('UNMEASURED: nothing booked for ' + vac.map(k => k.name).join(', ')); finish(2, 'vacuous: ' + vac.map(k => k.name).join(',')); }
  console.log('PASS'); finish(0);
}

// rise: the bars (header). A RED judges only its own bars; a real FAIL beats an UNMEASURED; nothing vacuous passes
// (Task 12 fix round 1) the rise's bars as a function of a booked rise (out: { S, wakeF, where, ins, settle, place, underF }): `rise` judges
// them all; `reentry` judges a subset on the second rise after a dig-in (header)
function riseChecks(out) {
  const S = out.S, w = out.wakeF, where = out.where, f60 = 60, r = v => Math.round(v * 1000) / 1000;
  const e = where === 'anchor' ? 0 : w;
  let s = -1; for (let i = w; i < S.length; i++) { const q = S[i]; if (q.stand >= 1 && Math.abs(q.hx - 1) < 0.02 && Math.abs(q.hv) < 0.05) { s = i; break; } }
  const hs = S.findIndex(q => q.hasStood === 1);
  const sec = i => i < 0 ? null : +((i - w) / f60).toFixed(3);
  const win = (a, b) => S.slice(Math.max(0, a), b < 0 ? S.length : b + 1);
  const A = s >= 0 ? win(e, s) : [];
  const first = f => { const i = S.findIndex((q, k) => k >= w && f(q)); return i < 0 ? null : sec(i); };
  const info = { wakeAt: w, stoodAt: s, stoodT: sec(s), hasStoodT: hs < 0 ? null : sec(hs), hasStoodKnown: !!out.ins.hasStoodKnown, frames: S.length, eFrames: w - e,
    firstThreat: first(q => q.threatE > 0), firstNs: first(q => q.nsT > 0), firstDrop: first(q => q.drop > 0), firstTear: (() => { const i = S.findIndex((q, k) => k > 0 && (q.slam > S[k - 1].slam || q.torn > S[k - 1].torn + 0.5)); return i < 0 ? null : sec(i); })(),
    buryAtE5: (() => { const q = S.find((q, k) => k >= w && q.standE >= 0.5); return q ? q.bury : null; })(), buryAtE9: (() => { const q = S.find((q, k) => k >= w && q.standE >= 0.9); return q ? q.bury : null; })(),
    buryZeroT: first(q => q.bury === 0), moundZeroT: first(q => q.mk === 0), standE9T: first(q => q.standE >= 0.9), standE5T: first(q => q.standE >= 0.5),
    belly: A.length ? { min: Math.min(...A.map(q => q.belly)), atE9: (S.find((q, k) => k >= w && q.standE >= 0.9) || {}).belly } : null,
    claws: A.length ? { liftMax: Math.max(...A.flatMap(q => q.lift)), elbowMax: Math.max(...A.flatMap(q => q.elbow.map(Math.abs))), frontUpMax: Math.max(...A.map(q => q.frontUp)), clawResMax: Math.max(...A.map(q => q.clawRes)),
      frontUpFrames: A.filter(q => q.frontUp > 0.001).length, frontUpAtStood: s >= 0 ? S[s].frontUp : null } : null,
    wakeBody: S.slice(w, w + 12).map(q => q.body), shoveN: S.length ? S[S.length - 1].shoveN : null, settle: out.settle, place: out.place, knobs: out.ins.knobs };
  // (a)
  const tear0 = e > 0 ? S[e - 1] : S[e];
  const aTears = A.length ? A.reduce((n, q, k) => n + ((k === 0 ? q.slam > tear0.slam || q.torn > tear0.torn + 0.5 : q.slam > A[k - 1].slam || q.torn > A[k - 1].torn + 0.5) ? 1 : 0), 0) : null;
  const aThr = A.length ? Math.max(...A.map(q => q.threatE)) : null, aNs = A.length ? Math.max(...A.map(q => q.nsT)) : null;
  // (b)
  // (the wake frame itself included: the crack beat shoves him on it; compared with the frame before, booked before the wake on every BP_AT)
  const B0 = S.slice(w, w + f60 + 1), stagSet = w < 1 ? -1 : B0.findIndex((q, k) => q.stag > (k === 0 ? S[w - 1].stag : B0[k - 1].stag) + 1e-6);
  const d0 = S[w] ? S[w].dC : null, d15 = S[w + 90] ? S[w + 90].dC : null;
  // (c)
  // (fix round 1) at BP_AT=under he is set under her: a ward he lights from there is his (the rite), not the rise's: lit judged before it
  const cW = S[w] ? S[w].wmax : null, cS = s >= 0 ? S[s].wmin : null, litN = S.filter((q, k) => q.lit > 0 && (out.underF == null || k < out.underF)).length;
  // (d)
  const vy = (a, b) => { let m = 0, at = -1; for (let i = Math.max(1, a); i <= b && i < S.length; i++) { const v = Math.abs(S[i].bodyY - S[i - 1].bodyY) * f60; if (v > m) { m = v; at = i; } } return { max: r(m), at: sec(at) }; };
  const dR = s >= 0 ? vy(e + 1, s) : null, dAfter = s >= 0 ? vy(s + 1, S.length - 1) : null;
  // (e)
  const cap = s >= 0 ? win(w + 90, s) : [], capN = cap.filter(q => q.blk0).length, cap45 = cap.filter(q => q.blk45).length;
  const lensBlk = A.filter(q => q.lensBlk).length, lensLow = A.filter(q => q.lensClr < 0.3).length, lensMin = A.length ? Math.min(...A.map(q => q.lensClr)) : null;
  const F = s >= 0 ? S.slice(s + 1) : [];
  info.fight = { frames: F.length, capBlk0: F.filter(q => q.blk0).length, lensBlk: F.filter(q => q.lensBlk).length, lensLow: F.filter(q => q.lensClr < 0.3).length, tears: F.length ? F[F.length - 1].slam - S[s].slam : null, capBlk45: cap45 };
  // (f)
  const fS = s >= 0 ? S[s] : null;
  const vacA = s < 0 || A.length < 60;
  const ck = [
    { name: 'a', val: { tears: aTears, threatEmax: aThr, nsTmax: aNs, frames: A.length }, bar: 'from E to STOOD: tears 0, threatE 0, nsT 0', ok: aTears === 0 && aThr === 0 && aNs === 0, vacuous: vacA, judged: true },
    { name: 'aTear', val: { tears: aTears, frames: A.length }, bar: '(a)\'s tear part: no tear from E to STOOD (a holdRise RED\'s bar)', ok: aTears === 0, vacuous: vacA, judged: false },
    { name: 'aHammer', val: { threatEmax: aThr, nsTmax: aNs, frames: A.length }, bar: '(a)\'s hammer and drop part: threatE 0, nsT 0 from E to STOOD (a holdRise RED\'s bar)', ok: aThr === 0 && aNs === 0, vacuous: vacA, judged: false },
    { name: 'b', val: { stagSetT: stagSet < 0 ? null : +(stagSet / f60).toFixed(3), dC0: d0, dC15: d15, out: d0 != null && d15 != null ? r(d15 - d0) : null }, bar: 'a stagger set within 1.0 s of the wake, and the strip-centre distance +>= 0.5 u by 1.5 s', ok: stagSet >= 0 && stagSet <= f60 && d0 != null && d15 != null && d15 - d0 >= 0.5, vacuous: !S[w + 90], judged: where === 'crest' || where === 'anchor' },
    { name: 'c', val: { wardsAtWakeMax: cW, wardsAtStoodMin: cS, litFrames: litN, n: S[w] ? S[w].wh.length : 0 }, bar: 'wards < 0 over the sand at the wake, > 2 at STOOD, none lit', ok: cW != null && cW < 0 && cS != null && cS > 2 && litN === 0, vacuous: s < 0 || !S[w] || !S[w].wh.length, judged: true },
    { name: 'd', val: dR, bar: '|dY/dt| <= 8 u/s, E to STOOD', ok: !!dR && dR.max <= 8, vacuous: vacA, judged: true },
    { name: 'e', val: { capBlk0: capN, capFrames: cap.length, capBlk45: cap45, lensBlk, lensLow, lensMin }, bar: 'capsule never inside her from wake + 1.5 s to STOOD; the lens never inside her nor under the drawn surface + 0.3, E to STOOD', ok: capN === 0 && lensBlk === 0 && lensLow === 0, vacuous: vacA || !cap.length, judged: true },
    { name: 'f', val: fS ? { mk: fS.mk, drawn: fS.drawn, moundK: fS.moundK } : null, bar: 'at STOOD MD.k 0 and MD.drawn false', ok: !!fS && fS.mk === 0 && fS.drawn === 0, vacuous: !fS || fS.mk == null, judged: true }];
  info.dAfter = dAfter;
  // (fix round 1, M7) THE HAND-OFF at STOOD for a man still on her carried footing: per frame his boots' rise and plan step, BODY.push, the
  // frames until the latch lets go (booked, not gated)
  if (s >= 0 && S[s].latch != null) { const H = S.slice(Math.max(1, s - 15), Math.min(S.length, s + 121)); let up = 0, st = 0, push = 0, off = null;
    H.forEach((q, k) => { const p = S[Math.max(1, s - 15) + k - 1]; up = Math.max(up, q.boots - p.boots); st = Math.max(st, Math.hypot(q.px - p.px, q.pz - p.pz)); push = Math.max(push, q.body.push); if (off == null && k > 15 && !q.latch) off = k - 15; });
    info.handoff = { latchedAtStood: S[s].latch, bootsUpMax: r(up), planStepMax: r(st), pushMax: r(push), latchOffAfter: off }; }
  // (g) THE FOOTING (header)
  ck.push(FOOTING(S, w, out.underF != null ? out.underF : null, s));
  // (h) THE CRACK (Task 7b, header): L.crackK >= 0.9 x L.bury on a frame within crackT + 0.1 s of the wake. A crack that never drew
  // (crackK never over 0 after the wake, or not booked) books nothing: UNMEASURED
  { const cT = out.ins.knobs && out.ins.knobs.crackT != null ? out.ins.knobs.crackT : 0.8, hEnd = w + Math.round((cT + 0.1) * f60);
    const H = S.slice(w, hEnd + 1), drew = S.some((q, k) => k >= w && q.crackK > 0), hit = H.findIndex(q => q.crackK != null && q.crackK >= 0.9 * q.bury);
    const cMax = S.reduce((m, q, k) => k >= w && q.crackK > m ? q.crackK : m, 0);
    info.crack = { crackT: cT, hitT: hit < 0 ? null : +(hit / f60).toFixed(3), crackKmax: cMax, atEnd: H.length ? { crackK: H[H.length - 1].crackK, bury: H[H.length - 1].bury } : null, zeroAt: first(q => q.crackK === 0 && q.cracked) };
    ck.push({ name: 'h', val: { hitT: info.crack.hitT, crackKmax: cMax, atEnd: info.crack.atEnd }, bar: `crackK >= 0.9 x bury within crackT + 0.1 s (${+(cT + 0.1).toFixed(2)} s) of the wake`, ok: hit >= 0, vacuous: !drew, judged: true }); }
  // (i) THE SLABS (Task 7b, header): while drawn, every piece's lowest drawn vertex within 0.3 u over the drawn surface under it (a slab
  // hovering is a fail; sunk into the sand is not), and the mesh hidden by 3.1 s after the wake. No slabs on the build, or none ever
  // drawn with a piece live: UNMEASURED
  { const V = S.map((q, k) => [k, q.slab]).filter(([k, q]) => k >= w && q && q.v === 1 && q.n > 0), hasSl = !!out.ins.hasSlabs;
    const bad = V.filter(([k, q]) => q.gMax > 0.3), lastV = S.reduce((m, q, k) => k >= w && q.slab && q.slab.v === 1 ? k : m, -1);
    const worst = V.reduce((a, [k, q]) => !a || q.gMax > a.gMax ? { t: sec(k), gMax: q.gMax, k: q.wk, at: q.at } : a, null);
    info.slabs = { has: hasSl, frames: V.length, firstT: V.length ? sec(V[0][0]) : null, lastVisibleT: lastV < 0 ? null : sec(lastV), worst, gMin: V.length ? Math.min(...V.map(([, q]) => q.gMin)) : null, nMax: V.length ? Math.max(...V.map(([, q]) => q.n)) : 0 };
    // (I1) gMin with the surface it was read on and when, and the shell side apart (iShell below)
    { const lo = V.reduce((a, [k, q]) => !a || q.gMin < a.gMin ? { t: sec(k), gMin: q.gMin, kind: q.gMinKind } : a, null), ls = V.reduce((a, [k, q]) => q.gMinShell != null && (!a || q.gMinShell < a.gMin) ? { t: sec(k), gMin: q.gMinShell } : a, null);
      info.slabs.gMinAt = lo; info.slabs.gMinKind = lo && lo.kind; info.slabs.gMinShell = ls; info.slabs.nShellMax = V.length ? Math.max(...V.map(([, q]) => q.nShell || 0)) : 0;
      info.slabs.shellFrames = V.filter(([, q]) => q.nShell > 0).length; info.slabs.kinds = ['shell', 'dune', 'floor'].map(kd => [kd, V.filter(([, q]) => q.gMinKind === kd).length]);
      const badS = V.filter(([, q]) => q.depthShell != null && q.depthShell > SHELL_D), dp = V.reduce((a, [k, q]) => q.depthShell != null && (!a || q.depthShell > a.depth) ? { t: sec(k), depth: q.depthShell, det: q.dDet } : a, null);
      info.slabs.depthShell = dp;
      ck.push({ name: 'iShell', val: { frames: V.length, shellFrames: info.slabs.shellFrames, maxDepth: dp && dp.depth, at: dp && dp.det && { t: dp.t, ...dp.det }, verticalGapMin: ls, bad: badS.length, firstBad: badS.length ? { t: sec(badS[0][0]), depth: badS[0][1].depthShell } : null },
        bar: `every slab on her drawn shell (its lowest of five reads is shell): lowest vertex <= ${SHELL_D} u from her drawn surface, inside it (sinking into sand / floor stays allowed)`, ok: !badS.length && info.slabs.shellFrames > 0, vacuous: !hasSl || !V.length || info.slabs.shellFrames === 0, judged: true }); }
    ck.push({ name: 'i', val: { frames: V.length, bad: bad.length, firstBad: bad.length ? { t: sec(bad[0][0]), gMax: bad[0][1].gMax, k: bad[0][1].wk, at: bad[0][1].at } : null, worstGap: worst && worst.gMax, lastVisibleT: info.slabs.lastVisibleT },
      bar: 'every drawn slab\'s lowest point <= +0.3 u over the drawn surface (terrainH, the dune, her drawn shell), hidden by 3.1 s after the wake', ok: !bad.length && lastV >= 0 && lastV <= w + Math.round(3.1 * f60), vacuous: !hasSl || !V.length, judged: true }); }
  // (Task 8, header) THE PLUME AND HER BLIND START: blind, footprint, climb, quadEv, riseEv
  { const reacq = out.ins.reacq != null ? out.ins.reacq : 0.6, collR = out.ins.collR, end = s >= 0 ? s : S.length - 1, hasP = !!out.ins.hasPlume;
    // every spell after the wake: the loss row (lostN rises: sight() set seen false) and its find row (seen 0 -> 1), and how it ended
    const spells = [];
    for (let i = Math.max(1, w); i < S.length; i++) if (S[i].lost > S[i - 1].lost) {
      let f = -1; for (let j = i + 1; j < S.length; j++) if (S[j].seen === 1 && S[j - 1].seen === 0) { f = j; break; }
      const how = f < 0 ? null : { los: S[f].clearT >= reacq, pd: S[f - 1].pd < collR * 1.05, touch: S[f - 1].touchT > 0, sigil: S[f].lit > S[f - 1].lit,
        clearT: S[f].clearT, pdPrev: S[f - 1].pd, touchPrev: S[f - 1].touchT, blindTPrev: S[f - 1].blindT, tauLoss: S[i].tau, tauFind: S[f].tau };
      spells.push({ lossRow: i, findRow: f, lossT: sec(i), findT: f < 0 ? null : sec(f), len: f < 0 ? null : +((f - i) / f60).toFixed(3), openFor: f < 0 ? +((S.length - i) / f60).toFixed(3) : null, how,
        ended: how ? ['los', 'pd', 'touch', 'sigil'].filter(k => how[k]) : ['open'] });
      if (f < 0) break; i = f; }
    const sp = spells.length && spells[0].lossRow <= end ? spells[0] : null;
    // (booked, not judged) THE BLIND WINDOW: from the first loss to the first find by line of sight, the bump / touch re-finds in between
    // counted (beside her shell, sight() re-finds him on a bump the frame after each loss: brooder.js sight, L._pd < collR x 1.05)
    const losI = spells.findIndex(q => q.how && q.how.los);
    info.blindWindow = sp ? { from: sp.lossT, losFind: losI >= 0 ? spells[losI].findT : null, len: losI >= 0 ? +(spells[losI].findT - sp.lossT).toFixed(3) : null, losSpell: losI >= 0 ? spells[losI].len : null,
      refinds: losI >= 0 ? spells.slice(0, losI).reduce((m, q) => { for (const k of q.ended) m[k] = (m[k] || 0) + 1; return m; }, {}) : null } : null;
    info.blind = { spells: spells.slice(0, 6).concat(spells.length > 6 ? [{ more: spells.length - 6 }] : []), nSpells: spells.length, reacq, collR, lostAtEnd: S.length ? S[S.length - 1].lost : null, tauMaxRise: S.slice(w, end + 1).reduce((m, q) => Math.max(m, q.tau), 0) };
    ck.push({ name: 'blind', val: sp ? { lossT: sp.lossT, findT: sp.findT, len: sp.len, openFor: sp.openFor, ended: sp.ended, how: sp.how } : { lost: 'never, from the wake to STOOD' },
      bar: 'she loses him between the wake and STOOD (lostN rises), and her first blind spell, ended by line of sight (clearT >= SIGHT.reacq), lasts 3.0-4.0 s',
      ok: !!sp && sp.findRow >= 0 && sp.len >= 3.0 && sp.len <= 4.0, vacuous: vacA || (!!sp && sp.findRow >= 0 && !sp.how.los), judged: where === 'anchor' || (where === 'off' && OFF_D === 12) });
    // footprint: the widest over the rise (wake -> STOOD) of the frame's farthest bearing
    const FP = S.map((q, k) => [k, q.pf]).filter(([k, q]) => k >= w && q), FPr = FP.filter(([k]) => k <= end);
    const wid = FPr.reduce((a, [k, q]) => !a || q.far > a.far ? { t: sec(k), far: q.far, bearings: q.nb, b: q.b } : a, null), widAll = FP.reduce((a, [k, q]) => !a || q.far > a.far ? { t: sec(k), far: q.far } : a, null);
    info.footprint = { samples: FPr.length, widest: wid, widestSeries: widAll, at: [1, 2, 3, 4, 5, 6].map(t => { const e2 = FP.find(([k]) => k >= w + t * f60); return e2 ? [t, e2[1].far, e2[1].nb] : [t, null]; }) };
    ck.push({ name: 'footprint', val: wid, bar: 'at its widest, wake to STOOD, the farthest of 32 bearings from the strip\'s centre with __plume.dens(x, floor + 1.5, z) > 0.02 is 15-20 u',
      ok: !!wid && wid.far >= 15 && wid.far <= 20, vacuous: !hasP || FPr.length < 20, judged: true });
    // climb: the density maximum's height over the floor at 4.0 s less at the first sample with a maximum > 0.02
    const PK = S.map((q, k) => [k, q.pk]).filter(([k, q]) => k >= w && q && k <= w + 4 * f60), p0 = PK.find(([, q]) => q.d > 0.02), p4 = PK.length ? PK[PK.length - 1] : null;
    const climb = p0 && p4 && p4[1].d > 0.02 ? +(p4[1].h - p0[1].h).toFixed(2) : null;
    info.climb = { samples: PK.length, first: p0 ? { t: sec(p0[0]), ...p0[1] } : null, at4: p4 ? { t: sec(p4[0]), ...p4[1] } : null, profClimb: p0 && p4 && p4[1].prof != null && p0[1].prof != null ? +(p4[1].prof - p0[1].prof).toFixed(2) : null,
      series: PK.filter((x, i) => i % 5 === 0).map(([k, q]) => [sec(k), q.h, q.d, q.prof]) };
    // (AMENDED, header) the every-cloud readings, booked beside the judged ones
    { const FA = S.map((q, k) => [k, q.pfA]).filter(([k, q]) => k >= w && k <= end && q), KA = S.map((q, k) => [k, q.pkA]).filter(([k, q]) => k >= w && q && k <= w + 4 * f60), a0 = KA.find(([, q]) => q.d > 0.02), a4 = KA.length ? KA[KA.length - 1] : null;
      info.footprintAll = FA.reduce((a, [k, q]) => !a || q.far > a.far ? { t: sec(k), far: q.far, bearings: q.nb } : a, null);
      info.climbAll = { first: a0 ? { t: sec(a0[0]), ...a0[1] } : null, at4: a4 ? { t: sec(a4[0]), ...a4[1] } : null, climb: a0 && a4 && a4[1].d > 0.02 ? +(a4[1].h - a0[1].h).toFixed(2) : null }; }
    ck.push({ name: 'climb', val: { climb, h0: p0 ? p0[1].h : null, t0: p0 ? sec(p0[0]) : null, h4: p4 ? p4[1].h : null, d4: p4 ? p4[1].d : null }, bar: 'the density maximum\'s height over the floor rises >= 3 u from its first sample (> 0.02) to 4.0 s after the wake',
      ok: climb != null && climb >= 3, vacuous: !hasP || PK.length < 10, judged: true });
    // the two eviction counts over the rise (the frame before the wake -> STOOD)
    const ps0 = S[Math.max(0, w - 1)] && S[Math.max(0, w - 1)].ps, PSr = S.slice(w, end + 1).map(q => q.ps).filter(Boolean);
    const riseMax = PSr.reduce((m, q) => Math.max(m, q.rise || 0), 0), dEv = key => ps0 && ps0[key] != null && PSr.length ? Math.max(...PSr.map(q => q[key])) - ps0[key] : null;
    info.plume = { riseLiveMax: riseMax, quadEv: dEv('quadEv'), riseEv: dEv('riseEv'), liveMax: PSr.reduce((m, q) => Math.max(m, q.live || 0), 0) };
    ck.push({ name: 'quadEv', val: { quadEvicted: info.plume.quadEv, riseLiveMax: riseMax }, bar: 'no live particle overwritten in the 448-quad ring over the rise (plumeState().quadEvicted does not rise)',
      ok: info.plume.quadEv === 0, vacuous: info.plume.quadEv == null || riseMax === 0, judged: true });
    ck.push({ name: 'riseEv', val: { riseEvicted: info.plume.riseEv, riseLiveMax: riseMax }, bar: 'no live rise record overwritten over the rise (plumeState().riseEvicted does not rise)',
      ok: info.plume.riseEv === 0, vacuous: info.plume.riseEv == null || riseMax === 0, judged: true }); }
  // (BP_FORCE) the forced contact: legs closing on him in the window the hold adds
  // (fix round 1, M4: ward touch is suppressed in the window, L.reach -1; and the window is cut at a calm, where game.js forbids tears whatever holdRise is)
  if (FORCE) { const f0 = S.findIndex((q, k) => k >= w && q.stand >= 1), c0 = S.findIndex((q, k) => k >= f0 && f0 >= 0 && q.calmed), F = f0 >= 0 && s >= 0 ? S.slice(f0, (c0 >= 0 && c0 <= s ? c0 : s + 1)) : [];
    const hits = F.filter(q => q.body.hitV > 2.5).length, aT = ck.find(k => k.name === 'aTear');
    info.force = { from: sec(f0), to: sec(s), calmedAt: c0 >= 0 ? sec(c0) : null, litMax: F.length ? Math.max(...F.map(q => q.lit)) : null, frames: F.length, forced: F.filter(q => q.forced > 0).length, hitFrames: hits, hitVmax: F.length ? Math.max(...F.map(q => q.body.hitV)) : null, tearsInWindow: F.length ? F[F.length - 1].slam - S[Math.max(0, f0 - 1)].slam : null };
    aT.vacuous = aT.vacuous || hits === 0; aT.val.force = info.force;
    for (const k of ck) k.judged = k.name === 'aTear'; }
  // (M3, booked) the puff pool's emissions and live-slot overwrites from the wake to the end of the series (the frame before the wake is the zero)
  { const d0 = S[Math.max(0, w - 1)] && S[Math.max(0, w - 1)].dust, d1 = S.length && S[S.length - 1].dust;
    info.dust = d0 && d1 ? { emitted: d1.emitted - d0.emitted, overwrites: d1.over - d0.over, pool: 420 } : null;
    if (info.dust) { const at = S.findIndex((q, k) => k >= w && q.dust && q.dust.over > d0.over); info.dust.firstOverwriteT = at < 0 ? null : sec(at); } }
  return { ck, info };
}
if (MODE === 'rise') {
  const { ck, info } = riseChecks(out), where = out.where;
  const red = RED ? REDS.rise[RED].bars : null;
  if (red) for (const k of ck) k.judged = red.includes(k.name);
  record.force = FORCE;
  record.checks = ck; record.riseInfo = info;
  console.log(`RISE ${where} ${JSON.stringify(info)}`);
  for (const k of ck) console.log(`  ${k.judged ? (k.vacuous ? 'VOID' : k.ok ? 'ok  ' : 'FAIL') : 'info'} (${k.name}) ${JSON.stringify(k.val)} (bar ${k.bar})`);
  if (cons.length) console.error('console errors (booked, not part of the bar): ' + JSON.stringify(cons));
  const J = ck.filter(k => k.judged), failed = J.filter(k => !k.vacuous && !k.ok), vac = J.filter(k => k.vacuous);
  if (RED) {
    if (vac.length) { console.error(`UNMEASURED: BP_RED ${RED}: nothing booked for ${vac.map(k => k.name).join(', ')}`); finish(2, 'RED bars vacuous'); }
    if (failed.length === J.length) { console.log(`RED ${RED}: (${red.join(', ')}) failed as it must: exit 5`); finish(5); }
    console.error(`RED ${RED} did not fail as written (${J.filter(k => k.ok).map(k => k.name).join(', ')} held): exit 3`); finish(3, 'RED did not fail');
  }
  if (failed.length) { console.error('FAIL ' + failed.map(k => `(${k.name}) ${JSON.stringify(k.val)} (bar ${k.bar})`).join('; ') + (vac.length ? '; UNMEASURED ' + vac.map(k => k.name).join(', ') : '')); finish(1, 'failed: ' + failed.map(k => k.name).join(',')); }
  if (vac.length) { console.error('UNMEASURED: nothing booked for ' + vac.map(k => k.name).join(', ')); finish(2, 'vacuous: ' + vac.map(k => k.name).join(',')); }
  console.log('PASS'); finish(0);
}

// disguise: every check as { name, val, bar, ok, judged }. judged = in BP_CHECK if given, else those this build can judge. A function
// (Task 12): digin and reentry judge the same checks on the dug-in and the rebuilt poses
function disguiseChecks(out, hasSand) {
const EXPOSED_K = 1.8, EXPOSED_BASE = 95.24;   // (Task 5b: 1ddb11a's reading, the RED run burial-disguise-t5b-red-1ddb11a.json: 3313 triangles, face 81.22, tips 11)
const checks = [];
const part = (name, bar) => { const w = out.worst[name], n = out.n[name] || 0; checks.push({ name, val: w ? w.d : null, at: w ? w.at : null, n, bar, ok: !!w && w.d <= 0, vacuous: !w || n === 0, judged: true }); };
for (const p of ['legs', 'claws', 'eyes', 'mouth', 'wards']) part(p, '<= 0');
// (from Task 3a on: before the dune covers her flanks they stand on the floor's level by design.) n = the growth's vertices examined
// (the vacuity floor); nOut = those DRAWN outside the strip; none drawn there passes (the growth outside the strip is buried)
for (const p of ['reef', 'weed']) { const w = out.worst[p], n = out.n[p] || 0, nOut = (out.outN || {})[p] || 0;
  checks.push({ name: p, val: w ? w.d : null, at: w ? w.at : null, n, nOut, bar: '<= 0 (drawn, outside the strip)', ok: n > 0 && (!w || w.d <= 0), vacuous: n === 0, judged: hasSand }); }
checks.push({ name: 'sides', val: out.sides.d, at: out.sides.at, bar: '<= +0.02', ok: out.sides.at != null && out.sides.d <= 0.02, vacuous: out.sides.at == null, judged: true });
// no shell vertex over the sand in the strip = no crest at all: a finding (the bar fails), not a missing measurement
// (Task 5b, Michael's checkpoint 2026-10-20: "it doesnt really read a rock"; his ruling re-registers the crest's height 3.0-4.0 -> 6.0-7.0 u,
// the approved proposal's "about 6-7 u high")
checks.push({ name: 'top', val: out.crest.n ? out.crest.top : null, n: out.crest.n, bar: '6.0 - 7.0 u', ok: out.crest.n > 0 && out.crest.top >= 6.0 && out.crest.top <= 7.0, vacuous: false, judged: true });
// (Task 5b, pre-registered in the ledger before any reading) THE EXPOSED ROCK: >= EXPOSED_K x the 1ddb11a reading (EXPOSED_BASE, read by
// the RED run on 1ddb11a; the approved proposal's "roughly twice as much of her back stands out"); >= 50 triangles or UNMEASURED
{ const e = out.exposed;
  checks.push({ name: 'exposed', val: e ? e.area : null, n: e ? e.n : 0, bar: `>= ${EXPOSED_K} x ${EXPOSED_BASE} u^2 (1ddb11a) = ${+(EXPOSED_K * EXPOSED_BASE).toFixed(1)}`, ok: !!e && e.n >= 50 && e.area >= EXPOSED_K * EXPOSED_BASE,
    vacuous: !e || e.n < 50, judged: hasSand, info: e ? { face: e.face, tips: e.tips, ratio: +(e.area / EXPOSED_BASE).toFixed(2) } : undefined }); }
checks.push({ name: 'len', val: out.crest.len, n: out.crest.n, bar: '16 - 24 u', ok: out.crest.n > 0 && out.crest.len >= 16 && out.crest.len <= 24, vacuous: false, judged: true });
// the repose (Task 3a, narrowed in fix round 2): judged where she has a mound (main / the ridge RED have no dune to judge); >= 200
// triangles booked, else UNMEASURED
{ const r = out.repose;
  checks.push(r ? { name: 'repose', val: r.worst ? r.worst.deg : null, at: r.worst ? r.worst.at : null, n: r.n, bar: '<= 33.81 deg (fixed)', ok: r.n >= 200 && !!r.worst && r.worst.deg <= 33.81, vacuous: r.n < 200, judged: true,
      info: { over33: r.over33, over45: r.over45, over60: r.over60, over45tall: r.over45tall, worstSpan: r.worst && r.worst.span, worstRing: r.worst && r.worst.ring, worstBearing: r.worst && r.worst.bearing, tallestSteep: r.tallestSteep, degenerate: r.nDeg } }
    : { name: 'repose', val: null, n: 0, bar: 'n/a (no mound)', ok: false, vacuous: true, judged: false }); }
// (Task 4) the harpoon: seam >= +0.25 u, pole >= 0 u over the drawn sand; judged only with an iron in her (out.harpoon), else not here
{ const h = out.harpoon;
  checks.push({ name: 'seam', val: h ? h.seam : null, at: h ? h.seamAt : null, n: h ? 1 : 0, bar: '>= +0.25 u over the drawn sand', ok: !!h && h.seam >= 0.25, vacuous: !h, judged: !!h, info: h ? { seatOk: h.seatOk } : undefined });
  const pw = h ? h.pole.reduce((a, q) => (q.d < a.d ? q : a)) : null;
  checks.push({ name: 'iron', val: h ? (h.ironIn && h.seatOk ? 'in her' : 'NOT in her') : null, at: h ? h.seamAt : null, n: h ? 6 : 0, bar: 'head (tip, mid, barbs, pin) >= 0.1 u and shank >= 0 inside her drawn shell (lodged test, exact hits) AND seatOk',
    ok: !!h && h.ironIn && h.seatOk, vacuous: !h, judged: !!h, info: h ? { depths: h.iron, seatOk: h.seatOk } : undefined });
  checks.push({ name: 'pole', val: h ? h.poleMin : null, at: pw ? pw.at : null, n: h ? h.pole.length : 0, bar: '>= 0 u over the drawn sand (min of 5 samples)', ok: !!h && h.poleMin >= 0, vacuous: !h, judged: !!h }); }
// (Task 6) THE CLUTCH (header): every live lobe's top <= -0.05 u under the drawn sand. Judged where she is buried (L.buried: there is a
// dune to be under); on the shipped ridge the clutch rests on the floor by design (its tops stand over it), so it is not judged there
{ const q = out.clutch, bar = '<= -0.05 u (every live lobe: centre world y + 1.25 r, under the drawn sand)';
  checks.push({ name: 'clutch', val: q && q.worst ? q.worst.d : null, at: q && q.worst ? q.worst.at : null, n: q ? q.n : 0, bar, ok: !!q && q.n >= 1 && q.worst.d <= -0.05, vacuous: !q || q.n < 1,
    judged: hasSand && !!out.buried, info: q ? { lobes: q.n, of: q.nL, worstLobe: q.worst && q.worst.k, spill: q.worst && q.worst.spill, topOverFloor: q.worst && q.worst.over, st: q.st } : undefined }); }
// (final review item 6) THE CORAL ON THIS BED'S ROCK (DISGUISE's coral): every drawn coral vertex inside the probe's strip band of the LIVE
// mound (growRock's own rule at the source, every vertex of a part on the strip, judged here by the probe's band). Judged wherever she has a
// mound and coral (a bed, a dug-in pose, a re-entry). Its vertices under the drawn sand are booked, not judged: on the first build (c4d60ac)
// 48 of 20859 stand up to 0.57 u under the local floor, a crust or lump following her shell where it dips under the floor inside the strip
{ const q = out.coral;
  checks.push({ name: 'coral', val: q ? `outBand ${q.outBand} of ${q.n}` : null, at: q ? q.firstOut : null, n: q ? q.n : 0, info: q ? { under: q.under, low: q.low } : undefined,
    bar: 'every coral vertex inside this bed\'s strip band', ok: !!q && q.n > 0 && q.outBand === 0, vacuous: !q || !q.n, judged: hasSand && !!out.repose }); }
// (Task 12) THE SCAR, where the iron came out: judged where the harpoon is out of her (out.scar), in place of the seam
{ const q = out.scar;
  checks.push({ name: 'scar', val: q ? q.d : null, at: q ? q.at : null, n: q ? 1 : 0, bar: '>= +0.2 u over the drawn sand (the scar\'s centre)', ok: !!q && q.d >= 0.2, vacuous: !q, judged: !!q }); }
return checks;
}
const hasSand = !!record.hasSand;
const checks = MODE === 'disguise' ? disguiseChecks(out, hasSand) : [];
for (const k of checks) if (ONLY) k.judged = ONLY.includes(k.name);
for (const need of ONLY || []) if (!checks.some(k => k.name === need)) { console.error(`UNMEASURED: BP_CHECK ${need} is not built into this probe yet`); finish(2, 'BP_CHECK ' + need + ' not built'); }
record.checks = checks;
console.log(`DISGUISE ${JSON.stringify({ ...out, repose: out.repose ? { ...out.repose, tris: out.repose.tris.length + ' triangles (JSON)' } : null, checks: checks.map(k => ({ name: k.name, val: k.val, ok: k.ok, judged: k.judged })) })}`);
for (const k of checks) console.log(`  ${k.judged ? (k.vacuous ? 'VOID' : k.ok ? 'ok  ' : 'FAIL') : 'info'} ${k.name.padEnd(6)} ${k.val == null ? 'n/a' : k.val} (bar ${k.bar}; n ${k.n ?? '-'}${k.nOut != null ? '; drawn outside the strip ' + k.nOut : ''}${k.at ? '; worst at ' + JSON.stringify(k.at) : ''}${k.info ? '; ' + JSON.stringify(k.info) : ''})${k.judged ? '' : ' [not judged here]'}`);
const judged = checks.filter(k => k.judged);
const vac = judged.filter(k => k.vacuous);
if (vac.length) { console.error('UNMEASURED: nothing booked for ' + vac.map(k => k.name).join(', ')); finish(2, 'vacuous: ' + vac.map(k => k.name).join(',')); }
if (cons.length) console.error('console errors (booked, not part of the bar): ' + JSON.stringify(cons));
const failed = judged.filter(k => !k.ok);
if (RED) {
  const bars = REDS[MODE][RED].bars, notJudged = bars.filter(b => !judged.some(k => k.name === b));
  if (notJudged.length) { console.error(`UNMEASURED: BP_RED ${RED} targets ${bars.join(', ')} and ${notJudged.join(', ')} is not among the judged checks`); finish(2, 'RED bars not judged'); }
  const hit = bars.filter(b => failed.some(k => k.name === b)), miss = bars.filter(b => !hit.includes(b));
  console.log(`RED ${RED}: targeted ${bars.join(', ')}; failed ${hit.join(', ') || 'none'}${miss.length ? '; did NOT fail ' + miss.join(', ') : ''}`);
  if (miss.length) { console.error(`RED ${RED} did not fail as written (${miss.join(', ')} held): exit 3`); finish(3, 'RED did not fail: ' + miss.join(',')); }
  console.log(`RED ${RED} failed as it must: exit 5`); finish(5);
}
if (failed.length) { console.error('FAIL ' + failed.map(k => `${k.name} ${k.val} (bar ${k.bar})`).join('; ')); finish(1, 'failed: ' + failed.map(k => k.name).join(',')); }
console.log('PASS'); finish(0);
