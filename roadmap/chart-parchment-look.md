---
title: Chart parchment on your monitor
status: next
tags: chart, ui
updated: 2026-10-04
---
The in-game paper chart: warmth, size, drop shadow, and the one authored margin line.

## Detail
`src/ui/chartOverlay.js`. Judged fine in the pane; only a real monitor settles it.
- The drop-shadow filter is the first thing to cut if it reads as a floating UI card.
- The margin line WHAT SLEEPS WILL WAKE FOR NOISE is the only authored copy beyond YOU RIDE HERE — delete if it oversteps.
- Check the two conditions lines clear each other at narrow widths.

- Acceptance: Michael judges warmth/size/shadow/margin-line on his monitor; each keeps or changes by his word.

## Log
- 2026-08-05 — created; overlay verified structurally + visually in pane
- 2026-10-04 — RULED by Michael: shadow "Soft, close shadow" (replace the 18px/42px floating drop-shadow with a tight low one, paper lying on the table); margin line "Replace it" — WHAT SLEEPS WILL WAKE FOR NOISE is false since the three sleepers (they wake to a taking / the furnace); proposed WHAT SLEEPS GUARDS WHAT IT KEEPS, same hand. Warmth and size not raised; unchanged. Moved decision -> next.

- 2026-10-04 — SHIPPED on branch voyage (fe87024): soft close shadow (drop-shadow 0 1px 1.5px .55 + 0 3px 7px .32, was 0 18px 42px .65); margin line now WHAT SLEEPS GUARDS WHAT IT KEEPS, same hand. Also fixed: the sheet had been pinned top-left at full window height (index.html's page-wide canvas rule beat #chartPaper), now a centred 3:2 as authored; at narrow windows (800 / 640 px) the label lines fit inside the border and the conditions lines clear each other; soundings kept off the conditions lines. Warmth and size unchanged. How to see it: [E] at the chart table.
