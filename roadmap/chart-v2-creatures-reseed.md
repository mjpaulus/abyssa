---
title: Creatures reseed per site
status: done
tags: chart, v2
updated: 2026-08-05
---
Schools and jellies are identical everywhere; V1 deliberately skipped them.

## Detail
[risk]'s audit: mid-water Y-band placement means nothing breaks unseeded — it just repeats. Reseed = same pattern as flora (seed streams + dispose/rebuild), lower stakes.

- Acceptance: Schools/jellies differ per site, deterministic per seed, zero recompiles in the reseed soak.

## Log
- 2026-08-05 — deliberate V1 cut
- 2026-08-05 — V2 round started; orchestrator wired contracts (site.js 4th hidden site, game.js found/keeps persistence), agents on keepsakes + creatures
- 2026-08-05 — shipped: creatures layout is a pure function of siteParams('creatures').rng (kills the last raw Math.random layout); schools/jellies/drifters/sparks re-lay in place per site. Verified: fresh boots identical, per-site hashes differ, 12-voyage soak flat at 353 programs / 148 geometries
