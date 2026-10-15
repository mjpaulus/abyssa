# Velkath: no safe spot (Michael, 2026-10-12)

Michael, after watching the full play-through: "you were right beating her is too easy now". He chose
"No safe spot": stay under her more than about 2 s and she drops her body on you or sweeps you out, so
each ward is a dash in and out timed to her hammer swings. She also turns to keep her belly away from
you, and ward reach drops from 7 to 5 u.

Measured now (tools/bench/riteplay.mjs, home): perfect calm 19.5 s, 0 hits; average calm 17.9 s
(Pallid), 0 hits. The refuge under her body (brooder.js STAND/HUNT: "under her body is a refuge (no
hammer; she shifts her stance every ~3 s instead)") is the main cause: a player stands under her and
lights every ward within reach 7.

TARGET: an average player calms her in 60-90 s and takes 1-3 hits; a perfect player in ~35-50 s with
0-1 hits. Never unwinnable: hits tear the dress (existing tearDress / slam path), never a death loop;
the air pack and the pump must still carry an average player through.

THE DESIGN (binding):
1. No refuge. Under her body counts up. Past ~2 s of continuous time under her she DROPS: a
   telegraph first (~0.7 s: a shudder, silt sifting off her plates, a deep groan, her legs bracing),
   then a fast body slam that tears/staggers him if he is still under, or a leg SWEEP that throws him
   out sideways (flat throw, never toward the fissure — keep safeThrow). Then she rises back to her
   standing height (no lingering crouch: Michael rejected the crouch, "crouched too low and I kept
   colliding"). The counter decays when he leaves.
2. She turns her belly away. While hunting she keeps her front (claws) toward him, turning at a rate
   that a determined diver can beat by circling or by going in during her recovery; her belly wards
   are reachable from the side/under only in the windows.
3. Windows. After a hammer strike (and after a drop) she is slow to turn for ~1.0-1.4 s: that is the
   dash-in window. Her hammer rhythm is readable (existing telegraphs).
4. Ward reach 7 -> 5 u.
5. Keep from the fairness pass: claws spread open her front when he comes in, flat throws, a slam
   tears at most once per 0.8 s, her back a slick dome, BOSSCAM framing, she never enters the crack.

VALIDATE: riteplay.mjs must play the new rule honestly. Update its PERFECT policy to exploit the
windows (dash in after a strike, out before the drop) and its AVERAGE policy to be what it is now
(late reads, +-20 deg aim, overlong bursts) plus lingering under her a little too long. Runs: home and
Pallid, perfect and average, 3 seeds each; report calm time, hits, tears, min reserve, completion.
Tune the numbers (drop timer, turn rate, window length, reach) until the targets hold. Then one
recorded fullplay.mjs run (RP_VIDEO into /Users/michaelpaulus/sc/.abyssa-wt/video/full-frames-velhard).
