---
title: THE GLASS lab v2 — day hands + wind knobs
status: done
tags: lab
updated: 2026-08-05
---
The lab learns the new vocabulary: today's hand on display, a reroll button to audition days, and knobs for wind, clouds, fog, and moon.

## Detail
`ui/lab.js` only. Mechanical spec once the machinery cards land: day-hand readout (fog/storm/clouds/sunset/moon), REROLL ("deal me a foggy morning" — jump day index), wind speed/dir override, cloud coverage/thickness, whitecap threshold, fog density/burn-off.
- Acceptance: Michael can deal days until he sees a foggy morning and a storm day without waiting through cycles; every new knob writes live.

## Log
- 2026-08-05 — cut from the west-coast round; last, cheapest (mechanical spec)
- 2026-08-06 — shipped: TODAY'S HAND readout + PREV/NEXT DAY + REROLL filter (any/foggy/storm/clear/big-moon, peek-scan capped at 60 days — foggy landed day 2 fog 0.865 in test), wind override dial with eased-vs-target readout, knob groups for GLASS cloud/fog/moon/windwater, RESET + COPY extended. Verified live: all four groups present, reroll works, plain load stays clean
