---
title: Sleepers-persist decision
status: next
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

