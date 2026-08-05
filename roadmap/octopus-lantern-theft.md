---
title: Octopus Steals Sal's Lantern
status: backlog
tags: octopus, predators, light
updated: 2026-08-05
---
The octopus should sometimes snatch Sal's hand lantern during a grab and drag it back to its den, forcing the player to go retrieve it.

## Detail
Idea only, not yet designed or scheduled. There is already a `lightSteal` event emitted from the octopus grab logic in `src/world/predators.js`'s octopus grab handling, and `game.js` already consumes `pev.lightSteal` to drain `player.light`. That existing hookup drains light on steal but does not model the octopus carrying the lantern into its den or give the player a way to get it back — this card is about extending that into a real steal-and-retrieve mechanic.

Open questions / acceptance criteria (still needs design pass before moving to next):
- What triggers the steal vs. a normal grab (chance? proximity? already-provoked state?)
- Where the octopus's den is and how the player locates/reaches it
- What "retrieval" looks like — is the lantern lootable at the den, does the octopus need to be fought/scared off, is there a timer
- How this interacts with the existing light-drain-on-steal behavior — does draining still happen, or does losing the lantern outright override it

## Log
- 2026-08-05 — captured as backlog idea
