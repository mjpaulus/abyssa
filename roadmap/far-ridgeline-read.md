---
title: Far ridgeline read
status: done
tags: terrain
updated: 2026-10-04
---
Does the W2 rampart read against the rim? 4.5% vs 13.1% transmittance — measured 2.9x separation, but subtle.

## Detail
`RAM_H` in `src/world/terrain.js` (currently 66) is the lever if too faint on a real monitor.
Also of note: the rampart breaches the surface in places — distant 'islands' on the horizon from the deck. Looks intentional; confirm you like it.

- Acceptance: Michael judges the horizon from mid-water and from the deck; RAM_H moves or stays; islands blessed or cut.

## Log
- 2026-08-05 — carried from W2; islands observation added during the raft round
- 2026-10-04 — RULED by Michael (islands): "Keep the islands". The rampart's mid-water read (RAM_H) goes on the side-by-side capture page with fly-remote-sites; stays in decision until he rules on RAM_H from it.
- 2026-10-04 — RULED by Michael from the capture page: ridge "Raise it" (RAM_H up until it reads as a second, paler wall above the rim from mid-water); islands — the capture proved NONE exist (highest crest -19.7 home); Michael: "Build a few far islands" (two or three low dark breaches far off). The earlier "keep the islands" ruling was made on a false premise from this card. Moved decision -> next.
- 2026-10-04 — BUILT on branch horizon. RIDGE: zone 0's rampart now peaks at r 348 (was 410), craggy to -9 under a soft ceiling (the 0.15 shelf kink had flattened every crest to -21..-34), pale carbonate drape on its upper faces faded in past ~100 u; zones 1/2 unchanged. Far-ridge skyline Weber contrast from seven pinned mid-water cameras (y -80/-110/-130, S/E/W, 120 u off the raft) 2.4-3.9% -> 3.9-12.2%; into the sun the shafts still dominate. ISLANDS: 2-3 per site (home: a broken crown, a needle, the teeth at 346/113/250 deg, 400-424 u), basalt stacks on drowned shoals (world/islands.js, one draw, ~6k tris), wet band + surf on the local swell, haze darkened in storms; from below they are dark columns into the surface. Home terrain fingerprint (canonical probe __ridge.fp) 4ff3a4f6 -> 119f0cae. See it: compare2/B_mid_*.jpg (before/after) and compare2/B_island_*.jpg (deck noon/dusk/storm, every site); live: sail out and look along those bearings, or swim up to y -110 and look outward.
- 2026-10-04 — Merged to main (33eb425): RIDGE moved in and roughened with a pale drape; islands.js — 2-3 basalt stacks per site at ~400 u. Fresh-tab verified. Moved next -> done.
