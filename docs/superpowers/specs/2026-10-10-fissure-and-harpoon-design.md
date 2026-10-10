# The Fissure and the Harpoon — design (2026-10-10)

Michael (verbatim): "so lets design the rift so its more realistic. Glowing when it opens makes sense,
like a portal. Also maybe taking Velkath's eggs isnt the thing that wakes her. They are hard to get to."
Context: he did not know what "the rift" was — from 40 u away it is hidden by Velkath's ridge and the
terrain, and today it is a round crater with a dim warm floor glow (shut) and shafts + a torus rim
ring + swirl particles (open) (`src/world/rifts.js`).

Rulings (brainstorm, 2026-10-10):
- The rift is **a fissure in the seabed** (not a blue hole, not "the sleeper is the seal").
- The open glow is **the deep's own pale light** (cold blue-white, no visible source, a slow breath).
- Velkath is woken by **pulling an old harpoon from her shell** (not the eggs).
- Her **clutch stays; the brood rule goes**.
- The harpoon becomes **Sal's blade: a longer, harder thrust** that replaces the knife.
- Build approach: **carve the fissure into the terrain** (accepting new terrain fingerprints).
- Applies to all three zones' rifts.

## 1. The fissure (all three zones)

**Form.** Each rift becomes a long jagged crack carved into terrainH: ~60–80 u long, 10–16 u wide,
steep layered walls, broken lips with slumped blocks and a few overhangs, a throat into black. It runs
along a per-zone authored bearing THROUGH the existing rift opening — `riftPos(i)` is frozen and the
ending's rift-threaded ascent spline passes through it, so the opening (and fall-through region) stays
centred where it is. Rock character per zone: zone 0 pale limestone + sand drift; zone 1 scorched,
vent-crusted; zone 2 black glassy basalt; remote anchorages tint through their existing site palette.

**Shut.** The throat is choked a few units below the lip by a rubble jam: real boulder instances + a
packed-silt surface Sal can stand on and cannot pass. A faint cold breath of pale light seeps between
the boulders (replaces the warm `floorGlow`). Fall-through stays disabled exactly as today (`riftOpen`).

**The opening moment** (when the zone's last ward lights): a seabed shudder (`ev.quake` + camera), the
jam cracks, slumps and pours down the throat over ~3–4 s with a silt plume (stir pulse + particles),
then the pale light wells up and swells to full over a few more seconds; "A RIFT OPENS BELOW." lands
as the light arrives (message ordering through the showMsg queue).

**Open.** Cold pale blue-white light breathes up from the depth (slow pulse), faint caustics on the
walls, a column of drifting motes, a soft glow on the water above marking the place from a distance.
Never neon. The existing beacon shader terms (shaft/caustic) are retuned to this; the torus `rimRing`
is removed. No new THREE lights (sacred count 14); any light is emissive/additive with the house
rules (fog:false + own distance curve; never fogged additive).

**Descent.** Unchanged mechanics: entering the glowing throat sinks Sal into the next zone as the
current fall-through does — only the opening's shape changes (an elongated region instead of a
circle; HOSE_REQ, the ending, riftPos unchanged).

**Lairs.** Sleeper lairs must keep clear of the crack. Velkath now lies ALONGSIDE her fissure (not on
its rim crest); her per-site lair rows still apply relative to it. Orune's trawler and Mhor's furnace
are checked for clearance at every anchorage.

**Costs/accepted changes.** Zone terrain fingerprints change (record new home/Pallid/Burned values on
the canonical probe `__ridge.fp()` and in CLAUDE.md). Serpent fingerprints `__lev.fp` must not change.

## 2. Velkath's rite — the harpoon

**Asleep.** She lies alongside the fissure as a ridge of plated shale with her clutch under her apron
(as now). On her near flank, at standing height and on the sand side (never over the crack), an old
harpoon is lodged deep in a seam between two plates: weathered brass fittings, a frayed line trailing
into the silt. A short discoverable trail leads to it — an old diver's lead boot half-buried, then a
broken air-hose coupling — each found once with a line. The first time the lantern finds the harpoon,
its brass catches the light (a glint on lantern facing, like her eyeshine).

**Trigger.** Prompt "[E] PULL THE HARPOON". Sal braces a boot on her shell and wrenches it free over
~1.5 s (a short pose). She shudders, silt pours off, she rises over ~6 s with her name and growl; the
wound weeps a dark plume a few seconds. Lines: first sight "A HARPOON IN HER SIDE. SOMEONE CAME BEFORE
YOU."; on the pull "IT COMES FREE. SHE FEELS IT." The dive-start goal line points at "what pins the
ridge".

**Awake.** Her hunt/fight as the fairness pass left it (refuge under her, claws part, plume blinds,
flat throws, burst/vent control, boss framing). She hunts whoever pulled the harpoon.

**Wards.** Just lit; no carrying, no cold last ward: the brood rule, its refusal line and the "CLUTCH
ROBBED" tally state are removed (keep `wardRefuse` for Orune/Mhor). The clutch stays as look + soft
solid; the pry/return interactions are removed.

**Calm.** Last ward lit → she stills, walks back and settles alongside the fissure → the fissure opens
(Section 1). The harpoon stays with Sal.

**Every anchorage, every visit.** Each anchorage's Velkath carries her own harpoon on the first
visit there (other divers came before — at a remote site the pull line reads "ANOTHER DIVER'S
HARPOON."; it is the trigger only, the blade reward is granted once, ever). On a REVISIT to an
anchorage whose harpoon was already pulled, the trigger is the healed wound in the same seam:
"[E] PRESS THE OLD WOUND" — same place, same commitment, no item. Per-anchorage pulled state is saved
with the chart record (like the calmed record).

**Kept working.** Remembered visits (one ward pre-lit), `?playtest` Alt+6 (now places Sal at the
harpoon or the wound), all three anchorages, per-site lair rows, persistence (the harpoon OWNERSHIP
persists — Section 3).

## 3. The harpoon as Sal's blade

Replaces the knife once owned (same input: left click / pad RT); before that Sal keeps the knife.
Feel: a deliberate two-handed jab — contact ~0.3 s (knife 0.22), reach ~5.5 u (knife 3.4), ~0.9 s
recovery; weighted. Effects through existing systems (`predators.slash`, `lev.onSlash`): staggers a
shark and aborts its strike more reliably; frees Orune's grab in one hit from further out; kills
squid as the knife does; nothing against a sleeper. Look: carried in the free (knife) hand, shaft along
the forearm at idle; trails along the arm in swim stroke and burst lean; generated model (old iron
whaling-style head, brass ferrule, frayed line stub) via the sculpt pipeline with a procedural
fallback. Persisted with the tools in the save. Text: "CUT IT — CLICK TO SLASH" → "CLICK TO THRUST"
once owned; title controls "click: blade". `game.js` `pendingSlash` timing must match the new contact.

## 4. Verification

- Orchestrator plays each zone's rite with `tools/bench/play.mjs` and RECORDS video (perfect + average
  player): Velkath home + Pallid (pull → survive → wards → fissure opens → swim down to zone 1); Orune
  and Mhor quick runs (their fissures open; the harpoon vs Orune's grab).
- Frames of each zone's fissure shut / opening / open / from the water above; the harpoon in hand.
- Invariants: 14 lights, `__shaderFailed()` [], `__safeFailed()` [], console clean; terrain
  fingerprints change only for the fissures (record new); `__lev.fp` unchanged; the ending's ascent
  threads all three openings (playEnding); voyages to every anchorage, reloads, remembered visits,
  playtest jumps; cost of the fissure + light measured on the bench host.

## Build order

1. The fissure terrain + shut/opening/open visuals (terrain.js rift carving, rifts.js, a rubble/jam
   module; game.js only for the opening event wiring).
2. Velkath's harpoon rite (brooder.js / brood.js / common.js / game.js rite wiring / playtest Alt+6).
3. The harpoon as Sal's blade (diver.js hand prop + thrust pose, game.js input/timing, predators.js
   reach hook, hoarder.js onSlash range, survival/save).
Separate agents, separate files where possible; the orchestrator merges and verifies each.
