---
title: Playtest jumps — one key to each scenario
status: wip
tags: tools, playtest
updated: 2026-10-08
---
Michael playtests at 60 fps in his own browser against a checklist. With `?playtest` in the URL, Alt+digit (Option on a Mac) jumps straight to each scenario through the game's real code paths, so a full pass takes ~15 minutes. Without `?playtest` nothing changes: no listeners, no DOM.

## Detail
Files: src/ui/playtest.js (the jumps, panel, toast; loaded by a guarded dynamic import), src/game.js (the install hook + a cancellable rescue timer), src/ending.js (abortEnding). Keys by e.code with altKey (Option on a Mac), preventDefault + stopImmediatePropagation in the capture phase, repeats ignored. No pointer lock is taken: without one the game pauses as always and a click takes the helm. Every jump first brings the game into ordinary play from wherever it is (title -> start(); chart closed; a voyage's passage cut, its reseed run if it had not yet; the post-drowning haul cancelled; the ending taken down), clears the message line and marks the one-shot onboarding tips said, and (except 0) re-dresses him still at the spot, re-lays the line, and cuts the lens behind him.

Keys (exact):
- Alt+1 DECK, CALM: home (sails home directly if elsewhere), weather forced calm midday (weather.set(1, 0)), zone 0 rebuilt (Velkath dormant), on deck at the spawn facing +X, air/reserve/dress/lantern full, pump at least half.
- Alt+2 DECK, GALE: as 1 with weather.set(1, 1) (full gale at midday; the sea and the raft's roll ease up over a few seconds).
- Alt+3 SEABED, ZONE 0: home, standing on the zone-0 seabed 25 u (horizontal) off the pump's line, facing out, reserve full. Line raised only if it would not reach (never lowered).
- Alt+4 HOSE END: the Alt+3 spot with survival.hose = his range from the pump + 8. The line hangs steeply there (seabed ~240 down), so walking straight out reaches the end after ~21 u of walking (measured: one yank at the hold); range, not walking distance, is what is 8 u.
- Alt+5 SHARK: home, zone 0 mid-water above the Alt+3 spot (halfway between the floor and the zone top), the zone-0 shark set 40 u off, already INTERESTED and circling in; its wind-up and run come ~5 s later (measured: interest -> windup -> strike within ~7 s).
- Alt+6 VELKATH: the CURRENT anchorage's zone 0 rebuilt (Brooder dormant, clutch whole), standing at the nest with an egg in reach ([E] TAKE THE EGG is live).
- Alt+7 ORUNE: current anchorage, zone 1 rebuilt (Orune dormant, ship's lamp back on the hoard), ~14 u off the lamp facing it; he walks in for [E].
- Alt+8 MHOR: current anchorage, zone 2 rebuilt (furnace cold, Mhor absent), inside the furnace's feeding reach facing it, bitumen raised to 2 ([E] FEED THE FURNACE is live).
- Alt+9 CHART: current anchorage, zone 0 rebuilt, on deck at the chart table facing it, the chart opened through the [E] consult path (pick an anchorage for the inked passage; Esc puts it down).
- Alt+0 RESTORE: air, reserve, pump fuel to full, dress mended, lantern full; position, zone and sleeper untouched.
- Alt+- NEXT ANCHORAGE: reseedWorld straight to the next site (home -> Pallid Bank -> Burned Ground -> home; the Unsounded Shelf goes home), no passage, landing on deck.
- Alt+/ hides / shows the panel (remembered per browser).
Spots are found, not hard-coded: gentle ground clear of every collider list, and a boom line the game's camera probe will not cut short (the look tips down a little in a bowl, e.g. Mhor's furnace). Every placement raises the line to reach with room (never TAUT on arrival). A sleeper the chart pencil already records as calmed rebuilds `remembered` (one ward pre-lit) as in the real game; the toast says so.
Caveats: the jumps write the normal save like play does (site after Alt+-, line length, bitumen); the save clamps the line back into 380..1000 on the next load. Alt+digit on Linux Chrome may switch tabs (Mac is fine).

## Log
- 2026-10-04 — built on branch playtest: open the game with ?playtest, the brass panel bottom-right lists the keys. Verified every key with real (CDP) Alt+key events from the title, the deck, zones 0/1/2, mid-voyage, the drowned wait and the ending; rites re-arm (egg taken -> Alt+6 dormant again; furnace fed -> Alt+8 cold again); walk / step off / ladder / seabed walk / pack / voyage fine after. Invariants with and without ?playtest: 14 lights, __lev.fp 15ce888c c938fe6e 652d0412, __chart.fp home 119f0cae (Pallid 2c0df461, Burned ff316095 via Alt+-), __safeFailed [], console clean bar the favicon. Without ?playtest: module never fetched, no DOM, Alt+keys do nothing. 32 jumps + 8 reseeds: +1 geometry, +1 program.
