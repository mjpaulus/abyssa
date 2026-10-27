---
title: Starting over, and the harpoon on the raft
status: wip
tags: save, harpoon, title, user
updated: 2026-10-26
---
Sal carries the harpoon on the raft every time Michael opens the game, because the save keeps it once it has been pulled, and nothing in the game can start over. Michael picks what should happen.

## Detail
- **Michael, 2026-10-15:** "every time I open the game sal has a harpoon in his hand on the raft"
- **Cause (found):** game.js loads `abyssa.chart.v1` before the world builds; `tools.harpoon` sets `survival.hasHarpoon`, and diver.js shows the iron whenever it is owned (not stowed only mid-wrench), on the deck and at the title. It is granted on the first pull ever (sleeper/harpoon.js) or by playtest Alt+= (ui/playtest.js), and saved. There is no new-game or reset anywhere in the game.
- **Workaround given:** open with `?playtest`, press Alt+= once (revokes and saves), reload.
- **Options put to him:**
  1. A "start over" choice on the title screen that clears the save (recommended: nobody can start fresh today).
  2. Keep the save, but stow the harpoon on the raft; he carries it only in the water.
  3. Stop saving progress between sessions.
- **Also asked:** whether he pulled it himself. If he never did, something else granted it in his browser, and that gets investigated.
- **Acceptance (a ruling looks like):** Michael picks an option (or another), then it is built and verified on a fresh load and on a load with a saved harpoon.

## Log
- 2026-10-15 — created from Michael's report; cause traced; options and the question put to him.
- 2026-10-26 — Michael ruled: "1 start over on the title screen" (decision -> wip). Raised again by his playtest of the buried branch: with home's harpoon saved as pulled, he went down and "there was no harpoon to pull". Built on branch `buried`.
- 2026-10-26 — built on branch `buried`: a quiet START OVER on the title, only with a save; click arms, a second click clears `abyssa.chart.v1` and reloads (99ec986 probe RED on 94de095, bcae48b the feature, startover-probe GREEN). Not merged.
