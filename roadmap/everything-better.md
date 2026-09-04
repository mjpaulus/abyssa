---
title: Everything better (the campaign)
status: wip
tags: campaign, quality, design
updated: 2026-09-01
---
Michael: "make every detail of this game better all of it." Run as a campaign: every actionable card on the board, plus fresh sweeps of the domains never audited. Decisions stay his.

## Detail
WAVE 1 (five parallel branches, disjoint files):
- w1-design — the evaluation's design/onboarding batch: settle the verb, bearing strip legible, HUD hierarchy, threaten the air (TORN DRESS leak state), shark-bite lantern flicker + light dip, force the rite to day, rift-shut message, hose gate announced at calm.
- w1-story — home mooring seeded with the mariner's story (a keepsake at the skiff + three lines in his hand), tool-shaped reasons per zone (Orune's wards answer the sonar; Mhor's wards are squid-guarded), octopus lantern theft designed and shipped bounded.
- w1-audio — sailing soundscape (hull creak, canvas, water on the strakes), one bell no longer answers everything (a voice per event class), Web Audio engineering audit (node leaks, scheduling, ducking ramps, master compressor), deck bed, __audio dev surface. Levels conservative and knobbed — the ear pass is still Michael's.
- w1-world — raft shadow on the sea (surface samples the sun map), marine snow thins in vent warm columns, ladder rung wear where the grip lands, rift bowl floor glow while it wakes.
- w1-audit (read-only) — the never-swept domains: input/interaction, UI/HUD/typography, survival economy on paper, performance/robustness (context loss, error boundaries, tab-hidden), accessibility/options. Feeds WAVE 2.

## Log
2026-09-01: WAVE 1 merged (7d7771d / 5c36aa6 / 8e5726c / eec2480) — 15 cards closed: the seven design cards, both story cards, octopus theft, shark-bite flicker, sailing soundscape, raft shadow on the sea, vent-column snow, ladder wear. The audit of the unswept domains found first-ten-minutes bugs (Ctrl+W closes the tab while venting; keys stick on tab-out; Esc is not a pause; zone 2 is a fuel death by arithmetic; no context-loss handler; crafting never saves) → WAVE 2 (branch w2-integrate) applies wave-1 wiring patches + 15 audit fixes + the coherent economy set. Decision cut: hose-leash-decision. First wave-2 attempt died to a rate limit before starting; relaunched with per-task commits.
