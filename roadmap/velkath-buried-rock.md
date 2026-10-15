---
title: Velkath buried — a rock with a harpoon in it
status: wip
tags: brooder, sleepers, rite, particles, design
updated: 2026-10-15
---
Michael's idea: Velkath sleeps fully buried in the sand and reads as a rock with an old harpoon in it. Pulling the harpoon wakes her, and she rises out of the sand as it pours off her in a dust plume. Michael approved the spec; the implementation plan comes once the relief lands. To be built after the sea-floor relief lands.

## Detail
- **Michael, 2026-10-14:** "it would be interesting if she was buried in the sand and looked like a rock. Sal would just see what looked like a harpoon in the rock and pulls it out and she rises from the sand. There would be a dust plum as the sand falls off of her"
- **Builds on:**
  - her bedded shale-ridge sleep and its generated silt drift (`brooder.js` dormant terms, `brood.js`; polish-brooder follow-ups);
  - the wake heave, about 6 s;
  - `plume.js` silt clouds, and the `SIGHT` rule that a cloud blinds her (brooder-ground-plume);
  - the harpoon seat in her near flank (`sleeper/harpoon.js` `seat()`; fissure-and-harpoon);
  - her new bed on the relief's flat, turned so the harpoon sits in her left flank, with her stance raised (seafloor-relief, Task 8b; Michael 2026-10-14).
- **Acceptance (the spec will sharpen these):**
  - From 10–20 u, in his own light, a player reads a rock with a harpoon in it, not a creature.
  - The pull raises her out of the sand. The plume reads as sand falling off her.
  - Once she stands, the rite plays as shipped: riteplay parity against main, the same pre-registered campaign as relief Task 8b.
- **Hazards:**
  - The harpoon seat must still find a seam in her drawn shell. A mound under her broke it in relief Task 8b's bank mutant.
  - Her wards stay buried and dark until she stands.
  - A wake plume blinds her by the existing `SIGHT` rule. It must not hand him a free blind window unless that is intended.
  - Any change to where the harpoon sits moves the fight's opening, so re-measure fight parity.

## Log
- 2026-10-14 — created from Michael's idea; brainstorming started (it changes her sleep and her wake, so it gets a spec and a plan).
- 2026-10-14 — his picks: tell B (the sand breathes up close), crest only A (a ~20 u low outcrop), slow 6 s rise A (blind 3-4 s in the plume), after the calm she points her great claw at the opening crack (his idea) and digs back in A, the camera follows the point A, build approach 1 (a drawn burial skin over a sunken body); sections 1-4 approved; spec docs/superpowers/specs/2026-10-14-velkath-buried-rock-design.md.
- 2026-10-14 — Michael approved the spec ("approved", confirmed "yes"); next: writing-plans after the sea-floor relief lands.
- 2026-10-15 — The sea-floor relief has landed (merged a5d3ee2), so the plan is unblocked. Scope note from Michael's call to focus on home ("we should focus on getting one right now", card anchorages-as-missions): the spec says she is buried at every anchorage; the plan builds and judges home and only keeps the other anchorages working.
- 2026-10-15 — Plan being drafted (Opus agent; brief ~/sc/.abyssa-wt/reviews/buried-plan/brief.md) to docs/superpowers/plans/2026-10-15-velkath-buried-rock.md, home only, built after lensfix lands; Michael reviews it before anything is built.
- 2026-10-15 — Plan drafted (docs/superpowers/plans/2026-10-15-velkath-buried-rock.md, 17 tasks, home only; under review before commit). Its open feel calls went to Michael: she is blind 3-4 s from about 3 s into the rise (so she finds him ~6-7 s after the wake), the sand's breathing may be too subtle to see (he judges it on stills), and if no crest seat is both buried and in reach the build stops for his call. Michael: "I thought I already approved this but yes these are fine to proceed with". Builds after lensfix lands.
- 2026-10-15 — Plan committed (docs/superpowers/plans/2026-10-15-velkath-buried-rock.md, 2,241 lines, 17 tasks with 7a/7b, home only by a site-row key `bury`). Reviewed twice (Opus review: 5 Critical / 14 Important / 12 Minor, all fixed; Sonnet re-review: all closed, 1 new Important (the crest seat's burial test could not see the crest) + 12 Minor, all fixed). Builds on branch `buried` once lensfix merges. Michael's look-ins: the disguise with the harpoon in the rock (Task 5), the turn speed only if its bar fails, the look (Task 16), and the stop rules (no crest seat).
- 2026-10-15 — Building: lensfix merged (4bc2db6), so branch `buried` was cut from main 644879b (worktree ~/sc/.abyssa-wt/buried), subagent-driven (ledger .superpowers/sdd/2026-10-15-velkath-buried-rock/progress.md in the worktree). Task 1 (the base) started. Moved backlog -> wip.
