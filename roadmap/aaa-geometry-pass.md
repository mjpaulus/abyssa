---
title: AAA geometry pass (go hard)
status: wip
tags: quality, geometry
updated: 2026-08-26
---
The deep one — every asset is generated, so geometry IS the art. Michael's call: "the geometry pass is probably the one to spend most time on for aaa quality. go hard on this one." Three parallel domain audits (hero objects / world / life) with explicit license to spend triangles where the camera lives, then implementation branches.

## Detail
Audit axes: engineering (indexing, segment counts vs viewing distance, tangent frames for the new normal maps, dispose/reseed, bounding volumes under deformation) and the AAA heart — silhouette quality: chamfers and castings on the raft's hardware, plank edge relief, terrain ridges at the fog wall, wreck hull sheer/camber, anatomical read on every creature (fins, frills, asymmetry, per-instance variety). Budget deltas estimated per proposal and sanity-checked against 60fps.

## Log
2026-08-26: Three audits complete. Headlines: (1) BUG — the trawler's six portholes (including its "one light still burning" story beat) are built and never rendered, lost in an unbaked Part; (2) all three zones' terrain (~500k tris) renders every frame — zone gating saves ~330k/frame and pays for every uplift below several times over; (3) rock scatter culls at 175u while clear-band sightlines reach ~460u — the "empty seabed" feel is the LOD collapsing; (4) vent chimneys are 7-gons at walk-up; trawler plating authored but under-sampled; (5) the raft reads as primitive-assembly at 9u — no plank chamfers, 12-sided drums, strobing 18-seg flywheel; (6) creatures: fish tails are rigid 2-tri fans with no eyes, the shark is a painted body-of-revolution (no depressed snout, no caudal keel), leviathan cross-section aliases its own 7-lobe scallop, jelly frills are painted not shaped. Total plan ≈ +55k tris of detail, net −265k/frame, zero new draw calls/programs. Three implementation branches in flight (aaa-geo-hero / -world / -life).

DECISION (Michael): terrain skyline redistribution — bending vertex density toward ridge crests fixes the polyline skyline at the fog wall at zero tri cost, but CHANGES the site-0 terrain fingerprint (the bit-identical regression anchor). Re-anchor deliberately, or keep the anchor and live with the faceted skyline?
