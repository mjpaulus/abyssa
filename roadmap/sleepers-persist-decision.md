---
title: Sleepers-persist decision
status: done
tags: chart, design
updated: 2026-10-04
---
V1: the chart records history but sleepers re-wake per visit. Keep as ritual, or persist the calm per site?

## Detail
Design question, then small build. Persisting needs makeLeviathan to boot calmed (sigils lit, `calmed=true`) — modest leviathan surgery.
The ritual reading: the sleepers stir again when you leave; the chart remembers that you HAVE calmed them, the water does not.

- Acceptance: Michael rules ritual (re-wake) or persistence; if persistence, a follow-up card scopes the leviathan boot-calmed work.

## Log
- 2026-08-05 — deferred deliberately at phase 4; user call pending
- 2026-08-05 — moved next -> decision; the generic columns made it obvious this is blocked on the user, not queued work

## Log
2026-09-01: Evaluation's recommended ruling — "ritual, remembered": sleepers re-wake per visit, but a previously calmed one carries its wards already dim-lit and needs N-1 touches; the water half-remembers. Keeps the ritual, shortens revisits; cost is a calmedBefore bool into the makeLeviathan override. Michael's call.
- 2026-10-04 — RULED by Michael: "Ritual, remembered". Build: a sleeper calmed on an earlier visit still wakes, but her wards start dim-lit and calming needs one fewer touch (a calmedBefore flag per site from the chart into the sleeper boot). Applies to all three (Velkath, Orune, Mhor) — each sleeper's own rite still has to run (egg, lamp, furnace). Moved decision -> next.
- 2026-10-04 — SHIPPED on branch remember (79dd698): "ritual, remembered". A sleeper the chart records as stilled (chartRec[site][zone], localStorage 'abyssa.chart.v1', so it survives reloads) wakes to her rite on every later build but boots `remembered`: one ward counted lit and drawn DIM-LIT (slow ~8 s amber ember breath, between idle iron and the lit burn), so the calm needs N-1 touches; at the calm it answers with its own flash. Velkath keeps the FRONT socket (never the brood-rule ward: the rule is "last DARK ward", so it still lands on a flank ward: one touch, then the clutch); Orune keeps arm 0's ward (burns without a ping; the other three still need the sonar); Mhor keeps the aft-most ward (the longest swim of the stun window). One line per kind on the first remembered wake ("SHE KNOWS YOUR HAND. ONE WARD STILL REMEMBERS." / "SHE KNOWS YOUR LAMP..." / "HE KNOWS THIS FIRE..."). HOW TO SEE IT: calm a sleeper, then reload (or sail away and back, or re-enter the zone) and trigger her rite again; or `__lev.remember(true)` rebuilds the live zone's sleeper remembered (`false` = fresh, `null` = the chart decides). Verified live: Velkath calm -> reload -> remembered -> 1 touch + egg back -> calm; Orune fresh 4 / remembered 3 touches; Mhor fresh 5 / remembered 4 (real stun through the furnace flare). Fresh-path creature fingerprints unchanged; serpent fp 15ce888c/c938fe6e/652d0412; lights 14; console clean.
- 2026-10-04 — Merged to main (8ac424a), fresh-tab verified. Moved next -> done.
