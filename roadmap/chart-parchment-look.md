---
title: Chart parchment on your monitor
status: decision
tags: chart, ui
updated: 2026-08-05
---
The in-game paper chart: warmth, size, drop shadow, and the one authored margin line.

## Detail
`src/ui/chartOverlay.js`. Judged fine in the pane; only a real monitor settles it.
- The drop-shadow filter is the first thing to cut if it reads as a floating UI card.
- The margin line WHAT SLEEPS WILL WAKE FOR NOISE is the only authored copy beyond YOU RIDE HERE — delete if it oversteps.
- Check the two conditions lines clear each other at narrow widths.

## Log
- 2026-08-05 — created; overlay verified structurally + visually in pane
