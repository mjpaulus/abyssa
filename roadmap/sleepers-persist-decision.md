---
title: Sleepers-persist decision
status: decision
tags: chart, design
updated: 2026-08-05
---
V1: the chart records history but sleepers re-wake per visit. Keep as ritual, or persist the calm per site?

## Detail
Design question, then small build. Persisting needs makeLeviathan to boot calmed (sigils lit, `calmed=true`) — modest leviathan surgery.
The ritual reading: the sleepers stir again when you leave; the chart remembers that you HAVE calmed them, the water does not.

## Log
- 2026-08-05 — deferred deliberately at phase 4; user call pending
- 2026-08-05 — moved next -> decision; the generic columns made it obvious this is blocked on the user, not queued work
