# Velkath buried: a rock with a harpoon in it — design (2026-10-14)

Michael (verbatim): "it would be interesting if she was buried in the sand and looked like a rock. Sal would just see what
looked like a harpoon in the rock and pulls it out and she rises from the sand. There would be a dust plum as the sand falls
off of her"

His picks (brainstorm, 2026-10-14):
- **The tell (B).** Only a careful eye catches it: up close, the sand over her breathes, very slowly.
- **What shows (A).** Only her back's crest: a long, low outcrop of crusted stone, about 20 u long and 3–4 u high, with the
  harpoon in its flank.
- **The rise (A).** A slow, heavy rise of about 6 s. Sand pours off her in a plume, and she is blind for the first 3–4 s.
- **After the calm.** She turns and points her great claw at the opening crack: "can she turn and point to the void with her
  giant claw". Then she buries herself again (A).
- **The camera (A).** It follows her point briefly, and any mouse look drops it.
- **Build (approach 1).** A drawn burial skin over a sunken body. Real terrain under her was rejected, because it would break
  the terrain fingerprints every probe rests on. A disguise without burial was rejected, because her outline stays above the
  sand.
- Michael approved all four sections ("section 1 looks right" through "section 4 looks right").

Card: `roadmap/velkath-buried-rock.md`.

## Where it starts

This builds on the sea-floor relief branch once it lands:
- her bed sits on the hollow's levelled flat at (89.7, 39.1);
- she is turned at her bed, so the harpoon sits in her left flank and the fight opens at her back-left as shipped;
- her stance is raised 0.55 u (Michael 2026-10-14; relief Task 8b).

Today she sleeps as a bedded ridge of shale shards. A generated silt drift closes the gap under her rim (brooder.js, the
dormant terms scaled by `1 − standE`). She wakes over a 6 s heave (`RISE_T`). Her hammer throws silt clouds
(`sleeper/plume.js`) that blind her by the `SIGHT` rule (brooder-ground-plume).

## 1. Asleep: the burial

- **One value drives it.** `L.bury`, 0 (risen) to 1 (buried). She is built asleep at `bury = 1` at every anchorage.
- **Her body sinks** until only her back's crest stands 3–4 u over the sand.
  - The sink is the depth that puts the crest's top 3–4 u above the mean ground under her.
  - Her folded legs, claws, eyes and the thorns along her sides end up under the sand line.
- **The sand mound** grows out of the existing silt drift.
  - The drift's per-bearing profile rises over her shell to a crest line and leaves only a strip of crest, about 20 u long,
    showing.
  - It uses the seabed's own material and vertex channels, resampled from the terrain mesh as the drift already is, so the
    mound and the floor read as one.
  - It is drawn-only: the terrain heightfield and its fingerprints are untouched.
- **The crest reads as stone.**
  - Her exposed shell takes the hollow outcrops' rock shading (lib/textures.js `rockMapSet`, triplanar), blended in by
    `bury`, with sand settled in its hollows.
  - This is a shading term on her shell material, driven by a uniform.
  - No program is added mid-play: anything new is compiled in the boot tail.
- **Look-dev gate.** From 10 u and from 20 u, in his own light, the crest reads as rock, not a creature. If her dorsal thorns
  still betray her, they shrink into the crust while `bury > 0`.
- **The tell.** It is visible only within about 8 u.
  - Every 8–10 s the sand over her lifts a few centimetres and settles: a slow vertex rise and fall on the mound near the
    crest.
  - A thin trickle of silt slides off the crest's edge with each breath.
- **The harpoon.**
  - `seat()` searches only the exposed crest, on her left flank: relief Task 8b's back-half seat, restricted to the crest.
  - The head and shank are buried in the rock; the pole is clear.
  - The brass glint and its one-time catch are unchanged.
  - On a revisit the OLD WOUND is a dark scar at the same seat.
- **Footing.**
  - The mound and the crest are solid to Sal and to the lens. He walks up the sand and stands on the "rock".
  - This runs through her per-part collision (`sleeper/bodyCols.js`), as the clutch is soft-solid today: he stops at the
    drawn surface, and the lens never rests inside it.
- **Unchanged while dormant:**
  - her wards stay buried and dark;
  - her name, bearing and dread stay hidden until she wakes (`lev.dormant`);
  - the dive-start line and the brood trail stay as they are.

## 2. The wake: her rise

- **The trigger is unchanged.** [E] PULL THE HARPOON starts the 1.5 s wrench. "IT COMES FREE. SHE FEELS IT." follows (prio
  3), she wakes 0.7 s later, and her name follows at prio 3.
- **The rise takes about 6 s**, on `RISE_T`. `bury` eases from 1 to 0 as she lifts out of the sand, in three beats:
  1. **The crack.**
     - The crest's crust cracks along its length.
     - `ev.quake` jolts the camera (the existing shake event).
     - Slabs of crust slough off.
  2. **The pour.**
     - Sheets of sand slide off her flanks as the mound draws back down her sides.
     - Sand streams off her rim as falling particles.
  3. **The plume.**
     - A ring of silt clouds bursts round her rim at the crack, with more as the sheets fall.
     - This is a new `rise` kind in plume.js, inside its existing quad budget.
     - It spreads to 15–20 u and climbs.
- **Her blind start.** The existing `SIGHT` rule measures the optical depth between her eyes and him, so she cannot see him for
  the first 3–4 s, until the plume thins. Then she finds him as today. No new rule is needed; this is the plume's density over
  time.
- **No tear during the rise.**
  - He stands at the crest when it heaves. Her rising body shoves him back with a stagger, but cannot tear the dress.
  - The fight's dangers (the drop, the hammer, the tear) start once she stands.
  - This also covers what relief Task 8 measured: her rising shell caught a perfect player in 8 of 12 fights. Task 8b's turn
    brought that to 0.
- **Her wards** come up out of the sand with her, dark, as today.
- **Sound, generated as the hard rule requires.** A deep grinding crack, then a long hiss of pouring sand under her growl.
- **On a revisit** she is buried again, with the old wound as a scar in the rock's flank. [E] PRESS THE OLD WOUND raises her the
  same way.

## 3. The calm: the point, and digging back in

- **The calm itself is unchanged.**
  1. The last ward lights and her wards burn.
  2. The crack opens: quake, pour, silt, then the pale light.
  3. "A RIFT OPENS BELOW." lands as the light arrives.
- **The point.**
  - During the pour she turns her front to the crack's opening, the throat's centre at `riftPos(0)`.
  - As the light comes up, her major claw (the hammer's arm) rises and reaches toward the opening. She holds it for about 3 s
    through the line, then lowers it.
  - It is not a blow: no tear and no swing. If he is in the claw's path, contact only pushes him aside.
- **The camera cue (`POINTCAM`, game.js),** built like `CLAWCAM`:
  - The lens eases round to the opening crack over about 1.5 s, framing her claw where it can, holds through the light, and
    hands back over about 0.5 s.
  - A real mouse look drops it at once, with the claw look-up's tolerances: past 5° net or 15° of looking about.
  - It is the lens's last rotation, so off means the grounded lens bit for bit.
  - Debug: `__pointcam`.
  - It also pulls the lens out of her shell at the calm instant, the case Task 9's frames caught.
- **Walking home** is unchanged. She keeps her clearance and walks to her bed.
- **Digging back in.**
  - Once he is off her ground (today's settle rule), `bury` runs from 0 back to 1 over 15–20 s.
  - She sinks, the sand slides back up her flanks, the crust fades back in, and a low haze of silt drifts off. Calmed, she is
    blinded by nothing.
  - If he walks back onto her ground, it pauses. It resumes when he leaves.
  - When it ends she is the outcrop again, with the scar where the harpoon was, and her burning wards are embers under the
    sand.
- **The ending's flyby** of her walking home is a separate cinematic and stays as it is.

## 4. Code, invariants, gates

**Where it lives:**
- `sleeper/brooder.js`: `L.bury`, her sunken dormant pose, the rise's beats, the point, digging back in.
- The silt drift becomes the mound.
- Her shell material gets the crust term.
- `sleeper/plume.js`: the `rise` kind.
- `sleeper/harpoon.js`: the crest seat and the scar.
- `sleeper/bodyCols.js`: the mound and the crest.
- `game.js`: `POINTCAM` (orchestrator-owned).
- The audio module: the crack and the sand pour.

**Invariants:**
- 14 lights. Zero per-frame allocation. No reversed smoothstep.
- A distinct `customProgramCacheKey` per material variant. Everything new is built in the boot tail.
- The terrain fingerprints hold.
- `sleeperFingerprint(0)` moves, with the burial as its named cause; the other sleepers do not.

**Sequencing:** its own branch off main, after the relief lands.

**Gates** (each with a failing case where the plan can build one):

| What | Pass |
|---|---|
| Disguise, measured | A burial probe: none of her eyes, thorns, legs or claws stands above the drawn sand; the crest is 3–4 u high and ~20 u long |
| Disguise, judged | Stills from 10 u and 20 u in his light, judged by Michael |
| Footing | He stands on the mound and the crest without sinking; the lens is never inside her (Task 9's lens-in-her-surface count is 0) |
| The rise | Blind 3–4 s by the `SIGHT` readout; no tear in the rise; the wards come up |
| The point | It aims at the crack's opening. The cue engages, holds, hands back and drops on a mouse look. Off, the lens is bit-identical |
| Digging back in | Completes in 15–20 s once he is clear; pauses when he is near; ends at `bury` 1 with the scar |
| Fight parity | The paired 48-fight campaign against main under relief Task 8b's pre-registered bars (a)–(d) and (f), with (e) booked |
| Existing probes | harpoon-probe (the crest seat at all four anchorages, the rite, the old wound); fissure-probe velkath-crack and clearance; brooder-invariants; relief-load |
| Cost | Cross-load ABBA against main at `z0b`: ≤ +0.3 ms per frame |
| The look | Stills asleep, mid-rise in the plume, the point with the light, and buried again; a full-take MP4 |

**Out of scope:** Orune, Mhor, the ending's flyby and the claw look-up.
