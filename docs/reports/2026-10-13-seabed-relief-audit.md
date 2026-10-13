> Copied into the repo 2026-10-13 from `~/sc/.abyssa-wt/reviews/seabed-relief.md` (the read-only relief audit behind `docs/superpowers/specs/2026-10-13-seafloor-relief-design.md`). Images and the replica tool stay at the paths it names.

# Seabed relief, zone 0: why it reads "one level, like a big pit", and the levers

Read-only investigation, 2026-10-13. Repo `/Users/michaelpaulus/sc/abyssa`, main `5ab282b`. No game code was changed and nothing was committed.

Michael's note: *"the sea floor is all one level, like a big pit. Lets make that more dynamic but keep velkaths lair in the deepest part."*

## How it was measured

- **The game itself.** I served the repo with `serve.py 8857` and ran my own headless Chrome on DRV_PORT 9502 with a fresh profile (`?bench&playtest`). I sampled `terrainH` on a 1 u grid over x, z = −300..300 for:
  - zones 0, 1 and 2 at home;
  - Pallid Bank and the Burned Ground, all zones (via `__chart.arrive(i)`).
- **Fingerprints checked before trusting any number.**
  - home `__ridge.fp()` 3b526986;
  - zones 1+2 d49d451d;
  - Pallid b1c58f8d;
  - Burned d2b6fb68;
  - after `arrive(0)`, home was back to 3b526986.
- **Live pins.** Read from the running modules: `bedAt()`, `velkathLair`, `wreckSites()`, live `pumpPos`, `clampR`, `jamTopY` / `lipMeanY`.
- **A node replica for the experiments.** `replica.mjs` slices `heightAt` and the clamp table verbatim out of `terrain.js` (lines 17–480). `pins.mjs` slices wrecks.js `findSite` and lair.js `velkathLair`/`rimR` the same way. Against the browser grids the replica:
  - agrees to ≤ 2e-13 everywhere;
  - differs at all on <1% of samples, where Chrome's and Node's `Math.exp` disagree in the last bit;
  - reproduces all four fingerprints exactly;
  - reproduces the skiff and Velkath's bed exactly.

  All lever numbers below come from this replica. No game code was touched.
- **The hillshade tool from Task 5 was not found.** I searched tools/bench, every worktree, all of ~/sc and the git history (`--all`). It was probably lost in the /tmp wipe. A new one was written: `reviews/seabed-relief-tool/` (see the last section).

### Images

All in `/Users/michaelpaulus/sc/.abyssa-wt/shots/`:

| File | What it shows |
|---|---|
| `seabed-relief-home-z0-map.png` | Top-down hillshade of zone 0 at home with every pin marked: raft and pump, crack lip and apron, Velkath's bed and her rejected first station, the skiff and its clear radius, the walk limit, the hose give contour, the lowest 1% and 5% of the open floor, and section lines A/B/C. |
| `seabed-relief-home-z0-sections.png` | Three cross-sections at near true scale. Reference lines: median, silt datum, soft-floor knee, descent trigger. |
| `seabed-relief-compare.png` | Zone 0 at home, Pallid and Burned, plus zones 1 and 2 at home. Each panel's colour ramp is shifted to its own median. |
| `seabed-relief-levers.png` and `seabed-relief-levers-sections.png` | The lever prototypes (node replica). |

### Masks

These are never pooled:

- **THROAT:** `fd < 0`.
- **APRON:** `0 ≤ fd < 14`.
- **OPEN floor:** `fd ≥ 14` and r below the per-bearing rim onset `rin`. This is 124k u².
- **WALK:** r below the lerped `clampR`, throat excluded.

## 1. Answer first

- **Zone 0 is a table about 25 u deep inside a ring wall.**
  - Over the open floor, p1..p99 = **−255.7..−231.1** (a 24.6 u span), and sd is **5.55 u**.
  - **62%** of the floor lies within ±5 u of the median (−242.7) and **93%** within ±10 u.
  - Median relief is **5.1 u** in a 20 u window, **10.6 u** in a 50 u window (p90 15.5) and **17 u** in a 100 u window.
  - The ring medians stay at −240.4..−243.5 from r = 5 all the way to r = 205. Then the wall climbs: −233 at r 225, −199 at 255, −136 at 285.
  - Zones 1 and 2 have 2.3–3× the relief: 50 u medians of 23.9 and 31.6, 100 u medians of 31.5 and 47.4.
- **Root cause: zone 0's landform row is the "sandy shelf".**
  - `rbias −0.32` holds the massif mask off: rk < 0.1 on **81%** of the open floor and > 0.5 on 0.6%. So the ridged massifs (`ramp 28`) and the outcrops (`r3amp 1.2`) almost never appear.
  - What is left:
    - a 233 u swell (`camp 34`, measured sd 4.55);
    - 139 u canyons averaging −2.1 u (sd 2.4);
    - 48 u dune ripples (sd 1.3);
    - no terraces.
  - Those wavelengths are longer than the 84–105 u visibility, so in view the floor is texture over a table.
  - The only large relief is the rim, a radially symmetric 65–171 u wall that starts at r 177–223. That ring around a table is the "pit".
  - **Not** the cause: the soft-floor knee. Only 0.9% of the open floor sits below −256, and the noise's own minimum is only −263.
- **Velkath is not in the deepest part today.**
  - Her bed is at (43.5, 113.4) on the crack's NW flank. The mean under her body is −239.5, the **73rd percentile** of the open floor.
  - The deepest open floor is **−257.8 at (127, 121)**, beyond the crack's NE tip. The lowest 1% is one 1.2k u² blob centred **80 u** from her bed.
  - Her *designed* first station is the raft-side SE flank (89.7, 39.1), which is low ground at the 9th percentile. The skiff vetoes it by 4 u: it lies 42.8 u away and the rule needs 46.8; her trail head lies 15.3 u away and the rule needs 22. So she flips across the crack.
  - The only place deeper than everything is the throat itself (floor −315 at `riftPos(0)`, about −330 at its deepest).
  - So "keep her lair in the deepest part" means **making it true**, not preserving it.
- **The strongest levers, all prototyped:**
  - **THE HOLLOW**, keyed to `riftPos(0)`: about −28 u, a levelled flat bottom of r 85, rising out to r 215.
  - **Wake zone 0's uplands**: `rbias`, `ramp`, `roc`, `r3amp`, `s2amp`, `camp`.
  - **Break the ring wall**: spurs, benches, onset (described here, not prototyped).

  Together, V9c, the Hollow with the uplands woken, reaches 50 / 100 u relief of **19.6 / 37.2**, close to zone 1. In it Velkath's bed is at the **3rd percentile**, the deepest open floor is beside the crack, and every frozen budget holds.

## 2. How zone 0's floor is built today (`terrain.js heightAt`, home: shipped rows, `shape: null`)

**Landform terms**, in order. All except `f` (which uses raw x, z) run on the domain-warped `px, pz`. The "measured" column is over the open floor at home.

| Term | Wavelength | Amplitude (row) | Measured contribution |
|---|---|---|---|
| warp | 238 u (0.0042) | ±0.7×46 ≈ ±32 u lateral | (displacement) |
| continental base `fbm2(cf)` | 233 u (0.0043), 3 oct | camp 34 | sd **4.55**, −12..+12 |
| massif mask rk | 357 u (0.0028), smoothstep of `fbm2×2.2+0.5+rbias` | rbias **−0.32** | rk < 0.1 on **81%**, < 0.25 on 91% |
| massifs `rmf(rf)×ramp×rk` | 200 u (0.005), roc 3 | ramp 28 | mean 0.6, sd 1.42, p75 **0.5** |
| secondary ridges `rmf(s2f)` | 61 u (0.0165) | s2amp 3.5 × (0.3+0.7rk) | sd 0.36 |
| canyons `−rmf(cnf)²` | 139 u (0.0072), 2 oct | cnamp 9 × (1−0.8rk) | mean −2.1, sd 2.39, min −10.3 |
| dunes (rotated, anisotropic) | 167 × 48 u | damp 4.5 × (1−0.75rk) | sd 1.33, 0..4.8 |
| outcrops `rmf(r3f)` | 18 u (0.055) | r3amp 1.2 × rk | ≈0 (sd 0.07) |
| rubble `fbm2(mf)` | 48 u | mamp 1.0 | sd 0.16 |
| fine `fbm2(ff)` | 14 u | famp 0.28 | sd 0.04 |
| terraces | — | tq 0, tamt 0 (`tflat` 0) | none |
| lift | — | +17 → base level −243 | |
| soft floor | — | h < 4 (−256) → 4 + (h−4)×0.25 | 0.9% of the floor engaged |

**THE FISSURE carving.** It is active within `apronR2`, about 53 u of `riftPos(0)` = (81.5, 83.9). The frame is frozen: bearing 0.55, halfLen 36, halfW 6.5, throatHalfW 4.2, lipDrop 6.

- **The apron** (`fd < 14`) blends the landform 60% toward a fixed relative 18 (−242) at the lip.
- **The broken lip** heaves +1.7..3 u.
- **The throat** is carved about 60–80 u into stepped strata, with slabs and joint blocks.
- **Drawing:** a ≤0.5 u patch draws it, plus strata walls (drawn only; the fingerprint is untouched). The patch topology comes from `fissureDist` and is built once; `fillTerrain` refills only the heights.
- **Measured:**
  - throat floor at `riftPos(0)` −315.3, deepest about −330;
  - jam top −245.6 and lip mean −242.6;
  - the lips differ by ≤ **1.17 u**. The jam hangs 2 u under the higher lip and is capped 0.4 u under the lower, so past a 1.6 u lip difference the cap takes over and the higher lip stands proud of the jam. That is not a failure line: zones 1 and 2 ship at 5.8 and 3.8 u. The real walk-out check is a ~2.5 u hop plus a step, tested by fissure-probe `climb-out` and `jam-stand`;
  - the crack sits on a **5.4 u berm** above the ground just past its apron.

**Basin rim, and what lies beyond it:**

- **Onset:** `rin = 176.8 + 46·c01(aR)`, using the 2nd/3rd/5th Chebyshev harmonics per bearing. This gives 176.8..222.8. It is "outward only": the basin never shrinks, and scatter reaches 257.
- **Wall height:** `RIM_H 118 × (0.55..1.45)` = 65–171 u, over a 114 u span (smootherstep), × (1 + fbm×0.55), plus a 95 u ridged jag (`rimJag 30`).
- **THE FAR RIDGE (`RIDGE`):** envelope 300/348/540, h0 74 (fbm ×0.62), j0 44 (125 u ridged), j2 28 (48 u crag). A soft ceiling runs from c0 −75 up to top −8. Zones 1 and 2 keep W2 instead (340/410/540, h 66, ridged 22).
- **Island shoals:** `ISLES` lie 392–428 u out and are lifted 150 u under each crown, soft-capped to −6.5. Elsewhere the drowned-shelf kink compresses everything above −34 (×0.15).
- **None of this touches the basin.** The ridge, shoals and ceiling apply only beyond r 300.

**Mesh.** `SEG 288` with a graded axis out to `HALF 560`, giving about 1.7 u pitch in the basin. `WORLD_R 260` is frozen (`riftPos`, bubble vents, the ending's spline).

**Per-site `shape` rows.** These are the only remote-site landform knobs, and home is null by contract.

| Site | Landform overrides | Rim overrides |
|---|---|---|
| Pallid | ramp 19, s2amp 2.4, warp 62, rbias −0.42, cnamp 5.5, terraces tq 5 / tamt 0.6 / tflat 0.7 | h 0.8, span 1.22, jag 0.55 |
| Burned | ramp 38, roc 4, rbias −0.16, s2amp 5, r3amp 2.2, damp 2, terraces tq 3.6 / tamt 0.5 / tflat 0.25 | h 1.15, span 0.82, jag 1.6, out 28 |

Knobs neither remote row overrides leak to all three sites when a `ZP[0]` literal changes. That is `camp`, every wavelength, `lift`, the knee, `famp` and `mamp`. Two more leak to one site each: `roc` and `r3amp` to Pallid, `cnamp` to Burned. `rbias`, `ramp`, `s2amp` and the terraces are home-only edits.

## 3. The numbers

### Height and relief

| | home z0 | Pallid z0 | Burned z0 | home z1 | home z2 |
|---|---|---|---|---|---|
| open floor p1..p99 (span) | −255.7..−231.1 (24.6) | −254.9..−234.1 (20.8) | −254.6..−222.1 (32.5) | −566.9..−524.7 (42.2) | −873.8..−815.0 (58.8) |
| sd | 5.55 | 4.33 | 6.92 | 8.86 | 13.17 |
| within ±5 / ±10 u of the median | 62% / 93% | 77% / 97% | 53% / 85% | 48% / 75% | 29% / 53% |
| relief 20 u window (median) | 5.1 | 4.7 | 6.1 | 13.3 | 17.2 |
| relief 50 u (median / p90) | **10.6 / 15.5** | 9.6 / 13.7 | 13.1 / 22.2 | 23.9 / 31.4 | 31.6 / 42.4 |
| relief 100 u (median) | **17.0** | 15.1 | 21.6 | 31.5 | 47.4 |
| local slope p50 (2 u baseline) / regional (20 u) | 12.2° / 9.6° | 10.9° / 9.5° | 14.1° / 11.9° | 27.4° / 21.5° | 39.4° / 25.9° |
| rk < 0.1 (massifs off) | 81% | 73% | 40% | 57% | 16% |
| Velkath's bed percentile (mean under R) | **73%** (−239.5) | 8% (−249.8) | 11% (−246.5) | — | — |
| crack lip difference | 1.17 | 0.80 | 0.91 | 5.8 | 3.8 |
| floor margin to the descent trigger | 51.7 | 52.9 | 52.6 | 49.3 | 51.1 |
| hose margin to the give (375 u) | **25.0** | **6.6** | **6.7** | (gated by HOSE_REQ) | |

Relief, slope and the lair percentiles above are all over the OPEN floor mask.

### Histogram of the walkable basin at home (WALK mask: clampR, throat excluded; 6 u bins)

The WALK mask is 191k u²: 65% open floor, 34% rim foot, 1% apron. 73% of it lies in the 18 u band from −252 to −234. The long upper tail is the rim foot climbing the wall to −151, 14.6% above −230. That tail is the pit's shape: a table, then a wall.

```
-258..-252   3.4%  ####
-252..-246  17.6%  #####################
-246..-240  35.5%  ###########################################
-240..-234  20.0%  ########################
-234..-228  10.9%  #############
-228..-222   3.7%  ####
-222..-216   2.9%  ####
-216..-210   2.1%  ##
-210..-204   1.3%  ##
-204..-198   0.6%  #
-198..-192   0.5%  #
-192..-186   0.4%  #
-186..-180   0.4%  #
-180..-174   0.3%  #
-174..-168   0.2%  #
-168..-162   0.1%  #
-162..-150   0.1%  #
```

WALK p1..p99 is −255.2..−184.7, median −241.1, sd 12.5.

### Histogram of the open floor at home (OPEN mask: fd ≥ 14, inside the rim onset; 2 u bins)

There is no pile-up at the −256 knee. 44% of the floor sits in the 6 u band from −246 to −240.

```
-258..-256  0.9%  ##
-256..-254  0.8%  ##
-254..-252  2.1%  ####
-252..-250  4.7%  #########
-250..-248  7.0%  ##############
-248..-246 10.2%  ####################
-246..-244 14.3%  #############################
-244..-242 14.6%  #############################
-242..-240 14.9%  ##############################
-240..-238  8.6%  #################
-238..-236  5.8%  ############
-236..-234  7.5%  ###############
-234..-232  6.1%  ############
-232..-230  2.1%  ####
-230..-228  0.4%  #
```

### Slope at home, open floor

- At a 2 u baseline: 88% is over 5°, 61% over 10°, **41% over 14°** (the gait was tuned and measured on a 25% grade), 20% over 20°.
- **2.4% is steeper than kelp's gate** (n.y 0.84, 33°), 0.1% steeper than turf's (0.72), and 0% steeper than Sal's limit (0.62, 52°).
- At a 20 u baseline the median is 9.6°.
- The floor is lumpy at metre scale (ridged dunes and canyon lips) but flat at landform scale.

### Deepest points at home

- **Lowest open floor:** −257.8 at (127, 121). That is r 175, 23 u off the crack lip and 84 u from her bed. It lies on the crack's axis, 22 u past its NE tip.
- **Lowest 1%** (≤ −255.7): one blob of 1,232 u² centred at (124, 109), 80 u from her bed.
- **Lowest 5%** (≤ −251.4): five or more blobs. The largest is 3,752 u² by the crack's NE/SE side; the others lie far west at (−190, 49), (−164, −68) and (−137, 24).
- **Her bed** (43.5, 113.4):
  - mean −239.5, the 73rd percentile;
  - relief 2.9 u under her body (R 15.4) and 6.1 u under her bed (23.9);
  - her 45 u arena spans −249.5..−238.1.
- **Her rejected SE station:** −249.8, the 9th percentile, but with 6.9 u of relief under her.

### Other

- **clampR reference** (`terrainH` at r 150 + 30): −226.3..−201, sd 6.1. The walk limit runs 235–262.5.
- **Hose:** the farthest walkable point from the live pump (5.4, 4.2, 2.9) is **350 u**, at the west rim foot (−242, 42). The give starts at 375, so the margin is 25 u. Pallid and Burned are already within **7 u** of the give at their far rim feet, at (−239, −170) and (−277, −29).

## 4. Why it reads "one level, like a big pit"

1. **The relief that exists is too long for the water to show.**
   - The only landform-scale term is the 233 u swell, sd 4.5 u: a ±5 u rise over about 100 u, roughly a 3° grade.
   - Visibility is about 84–105 u (red 2% reach), so from any standing spot you see a fraction of one wavelength.
   - In view, only the 48 u dunes and the canyon lips register (12° median local slope), and they read as texture on a plane.
2. **The machinery that makes landforms is switched off in zone 0.**
   - `rbias −0.32` collapses rk, so `ramp 28` and `r3amp 1.2` contribute p75 0.5 u and about 0 u.
   - Zones 1 and 2 run the same code with `rbias −0.10 / −0.14`, `ramp 42 / 48`, `roc 4` and terraces. Their 50 u relief is 2.3–3× zone 0's (compare image).
3. **The one big relief is a ring.**
   - The wall rises 125–170 u from r about 205–220 on every bearing.
   - Its onset varies only 46 u in azimuth, through smooth low-order harmonics, and is outward-only by design.
   - Every horizon you see is the same wall at the same distance, around a floor that never moves more than about 10 u. That reads as a pit.
4. **Depth cues are uniform too.**
   - Light and water are keyed to absolute y: `depth01 = −y/900`, the ambient `exp(K_ABS·y)`, and the silt layer at `NEPH_YF[0] = −246` with hs 24.
   - The whole floor lies within ±10 u of the silt datum, so the water looks the same everywhere. Nothing is higher, and nothing is deeper, darker or murkier.
5. **Ruled out:**
   - the soft-floor knee (0.9% engaged);
   - the apron (it only acts within 14 u of the crack, though it does pin a 5.4 u berm there);
   - mesh resolution (about 1.7 u pitch holds the dune ripples fine).

## 5. What pins zone 0, and what each pin reads from `terrainH`

- **Raft at the origin.**
  - `RAFT_POS (0, 0.55, 0)`; the hose head is at the sheave, live at about (5.4, 4.2, 2.9).
  - Nothing pins the floor height under the raft. Keep-offs: the skiff stays 55 u off, flora stays 10 u off.
  - Bench views `z0` (4, 4) and `z0r` / `z0b` stand on fixed seabed spots.
  - Noticed in passing: `z0b` "Velkath's ridge from 30 u" at (15, 18) is now about 100 u from her bed. Her bed moved with fissure Task 5; the view's comment is stale.
- **`riftPos(i)`, frozen.**
  - `WORLD_R × 0.45` at angles 0.8, 3.2 and 5.6 rad. `FISSURE` rows are frozen on it.
  - The carving reads the landform under it, and the apron's fixed target 18 cancels 60% of any regional change within 14 u of the lip.
  - Measured: a −28 u hollow with the shipped apron leaves a **21.5 u berm** round the crack (V6), against 5.4 u today.
  - The patch topology is frozen; it refills cleanly.
- **Velkath's lair (`velkathLair`, pure).** It is a function of:
  - `FISSURE[0]` and `APRON 14`, her outline (`rimR` + 0.4) and `R 15.4`;
  - **the zone's wreck**, which is a flatness search over `terrainH`;
  - on Pallid only (`arc` + `idle` row), mean `terrainH` over each candidate.

  Effects:
  - `clearOfBed` (23.9 u) keeps every scatter off her bed.
  - The rite assumes level ground: `STAND.ride` is 0.06 R (0.9 u) over the ground under her belly, her wards sit about 6 u over flat ground, ward reach is 5, and a bank under one side lifted her wards to 10–17 u in earlier measurements.
  - Pallid's authored line "VELKATH KEEPS NO DEPTH HERE / THE SLEEPERS SIT SHALLOW" picks the high lip among its candidates, yet measures at the 8th percentile. A hollow at every site would contradict that epithet outright.
- **Wrecks (`findSite`).** Zone 0 holds one wreck, the skiff. The trawler and the submersible lie on the zone 1 and zone 2 floors.
  - The flattest spot (max |dh| at 8 points on the footprint) in a ring 70–135 u round `riftPos` (zone 0). Constraints: r < 187, more than 55 u from the raft, clear of the crack by 6 + 12 u. It beds on the highest ground under the footprint and tilts 0.55 to the normal.
  - The skiff sits at (114.5, 4.2), dev 0.31.
  - **Any landform change moves it, and with it her bed.** In the prototypes the skiff lands at (111, 12), (32, 133), (14, 123), (−36, 68) and so on. In every hollow variant except the wide tilt (V8), the levelled bottom is the flattest ground, so the skiff lands *in the hollow* and pushes her to the other flank.
- **The ending's ascent spline.**
  - Built at `startEnding` from `terrainH`: `corridorMax` / `corridorMin` (excluding 44.8 u round each rift), `tf` (the throat floor at `riftPos`) and `lipTop`, with CLEAR 18 and DIP 14.
  - Today: yD −329.3 (under zone 0's throat) against yC −527.9 (clear of zone 1), a gap of 198.6. The lens marches the same heightfield (FLOOR_UNDER, LOS_F).
  - It adapts on its own; it needs re-verifying, not retuning.
- **Hose reach.**
  - The leash is the 3D straight distance from the eased pump: give over 375–380, then hold and yank.
  - Lowering a floor point by D adds about D × (its depth share of the distance): roughly 0.7 D at the far rim foot, 0.9 D at her bed and 1.0 D under the raft.
  - Home has 25 u of margin at the west rim foot, so her area, about 270 u from the pump, is unconstrained. **Pallid and Burned have only 6.6 / 6.7 u.**
- **Flora, props and gardens** (`place()`).
  - Slope gates on n.y: kelp 0.84, pens 0.85, seagrass 0.8, turf 0.72, fans 0.5–0.97, logs 0.78, barrels 0.8. Plus `clearOfCrack` (lip + 6 + r), `clearOfBed`, `nearWreck`, and r ≤ 0.98 `WORLD_R`.
  - Starved gates relax, so counts hold.
  - Every layout is a pure function of its stream, so **any** `terrainH` change reshuffles every downstream draw: deterministic, but nothing lands where it did.
- **Zone gating by camera Y.**
  - Bands: zone 0 is y ∈ (−410, 80); zone 1 is (−720, −230), and the zone-0 floor already sits inside it.
  - `ZONE_SEEN` is exact occlusion: camera below the zone-0 floor + 0.5 u, two `terrainH` taps a frame. Zone 0's roof shell (H − 22) is drawn for cameras in (−600, −300).
  - Floors anywhere in −211..−285 need no change; the gates follow `terrainH`.
- **The descent trigger** (game.js ~2510).
  - Fires when `y < −309.5` and the fissure is open, **anywhere in the basin**, not only in the throat.
  - Budget today: floor min −257.8 (margin 51.7); jam top −245.6 (63.9).
  - The throat floor already lies below the plane by design, and `holdInShaft(zi − 1)` keeps him in zone 0's shaft after the switch.
- **clampR.** For each bearing it bisects for `terrainH ≥ terrainH(r = 150) + 30`, clamps to 235–305 and applies a 1-2-1 smooth. A ridge or valley crossing r 150 moves that bearing's walk limit: the uplands prototype lifts the reference to −180, the hollow drops it to −247.
- **Fingerprints.**
  - The canonical probe (32×32, x, z ±248 step 16) covers the whole basin, so **any** zone-0 change re-anchors home 3b526986. That breaks site 0's bit-identical contract and needs Michael's ruling; precedents are THE FAR RIDGE (→ 119f0cae) and THE FISSURE (→ 3b526986).
  - Gated on `zi === 0`, zones 1+2 stay d49d451d. Verified in every prototype.
  - Gated per site, Pallid and Burned keep b1c58f8d / d2b6fb68.
  - `sleeperFingerprint(0)` (ecfa371e) hashes her ward positions, so it will move with her ground and bed. `__lev.fp(0)` probably moves too.
- **Reseed order** (`fillTerrain → resetJam → reseatFissures → reseedWrecks → reseedFlora → …`).
  - A new term must live inside `heightAt` / `syncSite` so every consumer sees it.
  - **Nothing may be keyed to `bedAt()` / `velkathLair`.** Her bed depends on the wreck, the wreck on `terrainH`, and a depression centred on her bed would close the loop. Key it to `FISSURE[0]` / `riftPos(0)`, both frozen.

## 6. The levers in `terrain.js`

All are measured on the node replica, zone 0 at home, each variant gated to `zi === 0` (zones 1+2 fp d49d451d unchanged). "Bed" is wherever the shipped `velkathLair` puts her once the skiff has been re-sought.

| variant | fp | open p1..p99 (sd) | relief 50 / 100 u | slope p50; >14°; >33° | her bed: percentile | trigger / jam margin | hose margin | lip diff / berm | throat floor |
|---|---|---|---|---|---|---|---|---|---|
| V0 shipped | 3b526986 | −255.7..−231.1 (5.55) | 10.6 / 17.0 | 12.2; 41%; 2% | NW: 73% | 51.7 / 63.9 | 25.0 | 1.17 / 5.4 | −315.3 |
| V1 rbias −0.10, r3amp 2.4 | 8a06bf7f | −255.6..−223.6 (6.6) | 11.3 / 18.6 | 13.0; 45%; 4% | NW: 63% | 51.7 / 63.9 | 28.7 | 1.17 / 5.4 | −315.3 |
| **V1b uplands**: rbias −0.05, ramp 42, roc 4, r3amp 3, s2amp 6 | 34bb3305 | −255.1..−212.2 (8.65) | 13.1 / 21.4 | 15.0; 54%; 10% | NW: 52% | 51.9 / 64.0 | 30.9 | 1.21 / 5.1 | −315.0 |
| V2 hills: camp 60, cnamp 16, zone-0 knee −18 | 754e186e | −266.2..−225.5 (9.37) | 17.4 / 28.3 | 17.2; 61%; 14% | NW: 70% | 31.3 / 61.4 | 18.3 | 1.62 / 9.7 | −317.4 |
| V7 hollow −28 *before* the knee | 1e01bf7b | −262.9..−231.4 (9.22) | 11.3 / 20.3 | 10.0; 38%; 2% | SE (moved): 4% | 44.7 / 58.9 | 25.0 | 0.59 / 12.5 | −320.9 |
| V6 hollow −28 after the knee, **shipped apron** | ccddd7a1 | −283.5..−231.4 (13.7) | 15.6 / 27.7 | 16.0; 59%; 4% | SE (moved): 3% | 23.7 / 52.7 | 24.6 | 1.17 / **21.5** | −326.5 |
| V3 same, relative apron | 42d9bac6 | −283.5..−231.4 (13.7) | 15.6 / 27.7 | 16.0; 59%; 4% | SE (moved): 3% | 23.7 / 35.9 | 24.6 | 1.17 / 5.4 | −343.3 |
| V8 tilt: hollow −28 out to r 320 | 5900a552 | −283.6..−234.8 (11.8) | 14.0 / 24.4 | 14.0; 50%; 3% | SE (moved): 4% | 23.7 / 35.9 | **15.5** | 1.17 / 5.4 | −343.3 |
| **V3c THE HOLLOW on `riftPos(0)`**: −28, flat r < 85, out to 215, bottom levelled 85%, +5 u dish | 0abf41fc | −275.9..−231.3 (13.8) | 14.3 / 25.3 | 13.7; 48%; 2% | SE (moved): **3%**; NW would be 8% | 32.2 / 33.1 | 21.2 | **0.55 / 0.9** | −347.1 |
| V5 = V1 + V3 + terraces tq 6 / tamt 0.5 / tflat 0.6 | eccc1d24 | −283.3..−224.4 (15.1) | 17.3 / 30.4 | 16.9; 61%; 8% | SE: 3% | 23.8 / 35.9 | 24.5 | 1.38 / 5.4 | −343.4 |
| **V9c = V1b + camp 50 + V3c** | fb469119 | −276.2..−211.4 (18.3) | **19.6 / 37.2** | 17.3; 60%; 13% | SE (moved): **3%**; NW 9% | 32.0 / 32.9 | 20.7 | 0.57 / 0.9 | −347.2 |

### Lever A: THE HOLLOW (a slope down toward her lair; makes "deepest part" true)

**What it is.** A term added in `heightAt` **after** the soft floor, zone 0 only:

```
h += −D·(1 − sst(rFlat, rOut, d)) − dish·(1 − sst(0, rDish, d)),   d = |(x,z) − riftPos(0)|
```

The bottom is also levelled toward the zone's mean level, the way the apron levels: `h += (17 − h)·0.85·w`, where w is the hollow's weight. V3c used D 28, rFlat 85, rOut 215, dish 5 over 110.

**What it does.**
- Her bed reaches the 3rd percentile, and the other flank station the 8th. Both flank stations sit inside the flat bottom, so it does not matter which one the skiff leaves her.
- The deepest open floor (−277.3) is 20 u off the crack's lip.
- Relief rises: sd 5.5 → 13.8, 100 u relief 17 → 25.
- Her arena gets flatter: 5.5 u of relief over 45 u, against 11.4 u today.

**What it forces:**
- **The apron target must become relative** (`18 + hollow(x, z)`). With the shipped absolute 18, V6 leaves a 21.5 u berm round the crack, and the throat, jam and lips stay up at −242.
- **Apply it after the knee, or move the knee with it.** Before the knee (V7), the 4:1 compression eats about 10 of the 28 u and flattens the bottom onto a −257..−260 plateau.
- **Descent trigger budget.** The floor margin drops 51.7 → 32 u. Keep D ≤ about 35–40 u so the floor stays above about −295.
- **The throat floor drops with the lip**: −315 → −347. The trigger then fires mid-throat (about 35 u under the lip) instead of near its floor; the shaft hold, `THROAT_CAM` and the ending's `FLOOR_UNDER` / `LOS_F` already handle a man under zone 0's floor after the switch. Re-verify with fissure-probe `fall-lens`, `rise`, `reascend` and `ending`. The alternative is to shorten the carve (60–80 u) so the throat floor stays near −315.
- **The ending's spline adapts** (gap 198.6 → 166.9) but must be re-run.
- **Jam:** top −274, margin 33. The lips stay level (0.55 u) because the whole crack plus apron lies in the flat bottom.
- **The skiff lands in the hollow's flat bottom** (32, 133). `findSite` should exclude the hollow, or home gets an authored `wrecks.band` / `lair` row, so neither wanders.
- **The rim and far field.** With rOut 215 about `riftPos(0)`, the hollow reaches r 332 on the NE side. That lowers the NE rim foot (hose binding point moves to (212, 108), margin 21.2) and grazes the far-ridge envelope (300+). Fade it by r ≈ `rin`, or accept a taller NE wall.
- **Look.**
  - At −275 the bottom is 1.2 silt scale heights under the datum: full nepheloid density against 88% today.
  - Ambient green × about 0.82 (`exp(−K_ABS·Δy)`, 0.0062/u × 33 u); `depth01` +0.03. It reads darker and murkier than the shelf around it. Michael judges.
- **Pins.** The flora and gardens slope share is unchanged (2% over 33°), but every layout reshuffles. Bench views z0, z0r and z0b move: the raft column sinks about 25 u, from a −240.4 ring median at r 5 to −266.
- **Fingerprints.** Home fp re-anchors. Gate the term per site: Pallid's epithet says she "keeps no depth" there, so give remote sites their own `shape` field. `sleeperFingerprint(0)` moves.

### Lever B: wake zone 0's uplands (ridges and outcrops)

**What it is.** Change the `ZP[0]` row toward zones 1 and 2: `rbias` −0.32 → −0.05, `ramp` 28 → 42, `roc` 3 → 4, `r3amp` 1.2 → 3, `s2amp` 3.5 → 6, and optionally `camp` 34 → 50.

**What it does.**
- Ridged massifs up to about 30 u over the floor: p99 −231 → −212.
- V1b alone: 50 u relief 10.6 → 13.1, 100 u 17 → 21.4. With the hollow (V9c): 19.6 / 37.2, which is zone-1 territory.
- `rbias −0.10` alone (V1) is weak (+0.7 / +1.6); the amplitude (`ramp`) is what matters.

**What it forces:**
- **Where the massifs land is wherever the noise puts them.** The mask is fbm at 357 u. At home they form a NW ridge band and miss the crack, her bed and the raft column, but on another site or with another offset they could not. If it must not land on pins, mask rk off the crack (`fd`), the bed stations and the raft column, with frozen geometry only.
- **Slope gates start to bite.** Steeper than kelp's 33°: 2% → 10% (V1b), 13% (V9c). Over the gait's 25% grade: 41% → 54–60%. Unwalkable (> 52°): 0 → 1.2%; Sal slides on those. Flora counts hold through `place()`'s relaxation, but kelp and pens thin on the uplands.
- **clampR** reference spread 6 → 9–19 u, so walk limits move on those bearings.
- **Leakage.** `ramp`, `rbias` and `s2amp` are home-only edits (both remote rows override them). `roc` and `r3amp` leak to Pallid; `camp` leaks to both.
- **Look.** Ridge tops at −211 sit 1.5 scale heights above the silt datum (silt × 0.23), so they become clear lookouts. That is the "rising is the reveal" payoff, at the cost of a look change.
- **Fingerprints:** home and Pallid (through `roc` and `r3amp`) re-anchor; zones 1+2 hold.

### Lever C: break the ring (rim spurs and benches) — not prototyped

The pit read is the uniform wall. Options:

- **Radial spurs:** ridged noise in the bearing, gated over r 140–230, pushing buttresses inward.
- **Benches:** `terrace()` on the rim term, giving ledges the jet pack can reach.
- **A wider onset swing:** more than 46 u, or higher harmonics.
- **A gentler wall:** the Pallid treatment, `rim.h 0.8` and `span 1.22`.

What it forces:

- **"Outward only."** Spurs move the wall inside the r 257 scatter and the 235 clamp floor. Flora's slope gates keep plants off the faces, but `clampR` and the scatter band would need re-deriving.
- **Hose margin** at the rim foot: home 25 u, but Pallid and Burned only about 7 u. A rim edit that pushes their walkable foot out or down breaks the "reach all of zone 0 on the starting hose" rule there.
- **Wreck ring:** r < 187 must stay off spurs.
- **The ending corridor** (rift 0 → raft): yE rises if a spur crosses it.
- **Fingerprints.**

### Lever D: valleys and hills (`camp` / `cnamp` + the knee)

V2 (`camp` 60, `cnamp` 16, zone-0 knee −18):

- **Gains:** 50 / 100 u relief 17.4 / 28.3; valleys reach −266..−278.
- **Costs:**
  - the trigger margin halves (31.3);
  - hose margin 18.3;
  - lips 1.62 (just past where the jam's cap engages, so the higher lip starts to stand proud);
  - berm 9.7;
  - her rejected SE station gets 13.9 u of relief under her (an unfair rite there);
  - `camp` leaks to all sites;
  - and the deepest valley (−278) is still beyond the crack's NE tip, **not** at her lair.

Use it only together with Lever A.

### Lever E: terraces (`tq` / `tamt` / `tflat`)

On ±5 u relief they add one or two treads: V5 changes the stats by less than 0.2 u against V4. They are a *read* lever once relief exists, giving literal "levels" and benches down into the hollow, and they are home-only knobs. In the hollow they would also step the jam's lips: lips 1.17 → 1.38.

## 7. "Her lair in the deepest part": three ways to make it true

1. **The floor falling toward her crack.**
   - A broad hollow or tilt about `riftPos(0)` (V8, rOut 320) makes the whole basin lean toward the crack.
   - It costs the hose most: 15.5 u, because the raft column and the east floor sink 20–25 u.
   - It reaches the far ridge envelope on the NE.
2. **A trench (graben) along the crack.**
   - The crack's axis passes 29 u from the raft column, so a valley along it runs under the raft and on to the NE rim, where the deepest ground already is.
   - Its floor should fall along its axis toward her stations.
   - Keep both flank stations (about 45 u off the axis) and the apron inside its flat floor. A floor tilting across the crack raises one lip over the other; keeping them level (and the jam walk-out within a hop and a step) needs the relative apron.
   - Strongest geological read: a rift valley with the fissure in its keel. It is also the biggest change to the raft-column and z0 views.
3. **A depression round her bed.**
   - It must be keyed to frozen geometry (`FISSURE[0]`, `riftPos(0)`, or the two flank stations as literals), never to `bedAt()`.
   - Its flat bottom must hold her body plus her 45 u arena; the rite assumes level ground there, so slopes under her stay under about 5°.
   - Otherwise the skiff wanders in and pushes her to the other flank. Containing *both* flank stations (V3c) makes this moot.

**Recommendation for the design session.** Use the Hollow keyed to `riftPos(0)`, with:

- flat r about 85, containing the crack, the apron and both flank stations;
- a levelled bottom;
- D 25–35;
- placement after the knee;
- the relative apron;
- `zi === 0` and a per-site gate.

Add a rk-masked uplands ring outside it, for relief the eye can find. Pin the skiff and lair, or exclude the hollow from `findSite`. Decide the throat depth: keep the about −315 floor by shortening the carve, or let it deepen. Expect re-anchored fingerprints (home, and `sleeperFingerprint` z0) and a look pass on the darker hollow.

## 8. Gates to re-run after any change

- `__ridge.fp()` (new home anchor, recorded) and `__ridge.fp([1, 2])` = d49d451d.
- Pallid and Burned fps, unchanged if gated.
- `__lev.fp`, `sleeperFingerprint(0)`, `__safeFailed()`, `__shaderFailed()`, 14 lights.
- **`tools/bench/fissure-probe.mjs`**: `clearance`, `velkath-crack`, `jam-stand`, `throat-edges`, `climb-out`, `fall-lens`, `rise`, `reascend`, `ending`, `wave-minors`, `floor-readers`, `opening`.
- **`velfix-gate.mjs` / `fullplay-gate.mjs`**: the three post-calm routes.
- **`riteplay` / `ritepolicy.mjs`**: the rite timings, 45–165 s and 0–3 hits.
- **`brooder-invariants.mjs`.**
- **Bench views** z0, z0r and z0b (their spots move), plus a hitch / boot check.
- **The hose:** a walk to the far rim foot on every site (Pallid and Burned have only about 7 u).
- **Wreck and keepsake reachability** at every site.

## 9. Tooling (durable, outside the repo): `/Users/michaelpaulus/sc/.abyssa-wt/reviews/seabed-relief-tool/`

| File | What it does |
|---|---|
| `drive.mjs` | `boot` / `run <page.js> [@args.json]` / `stop`. Own Chrome on DRV_PORT 9502, fresh profile; the game served on 8857. |
| `sample.page.js` | Samples the 1 u grids and the live pins, per site and zone. |
| `upload.page.js` | Stores a grid in the page. |
| `render.page.js` | Canvas renderer: hillshade, marching-squares contours, overlays, sections, panels. |
| `replica.mjs` → `terrainH.gen.mjs` | Verbatim `heightAt` + clamp slice with experiment hooks. `validate.mjs` checks it against the browser grids and the fingerprints. |
| `pins.mjs` → `pins.gen.mjs` | Verbatim `findSite` / `velkathLair` / `rimR`. `lairdiag.mjs` explains home's flank flip. |
| `stats.mjs`, `analyze.mjs` | Masks and statistics → `data/stats.json`. |
| `levers.mjs` | The variants → `data/levers.json`. |
| `mkargs.mjs`, `mkargs2.mjs` | Build the image arguments. |

To re-run:

1. `node drive.mjs boot`;
2. for each site s and zone z, `node drive.mjs run sample.page.js '{"site":s,"zones":[z]}'` (with OUT=data);
3. `node analyze.mjs`, then `node levers.mjs`;
4. `node prep.mjs` and upload;
5. render with `OUT=…/shots node drive.mjs run render.page.js @data/args_*.json`.
