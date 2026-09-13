# The Three Sleepers — design

Date: 2026-09-13. Status: draft for Michael's review.

Michael's brief: the leviathan is boring, one serpent scaled three ways. Each zone
should have its own creature — crab, octopus and squid *characteristics*, not those
animals. Monolithic next to Sal. Different strengths and weaknesses. Something in the
level triggers each one showing up, so the world needs to be bigger and more
discoverable. Wards stay the verb; the payoff differs per zone. Reveal grammar is mixed:
one buried in the zone, one lairing inside something, one arriving from off-map.
Everything else below is my call, and he asked to be surprised rather than consulted.

Hard rule stands: every asset generated in code.

## 1. The shape of the change

Today: the sleeper is present and idling from the moment you enter the zone. You swim to
it, touch N wards, it stills, the rift opens. Zone 1 adds a sonar gate on the wards,
zone 2 adds squid keepers. Three sizes of one animal.

After: each zone is a **place with a secret** before it is a fight. The zone is explored
first, with the creature either hidden in it or not there at all. A discoverable
**trigger** brings it. The trigger is also the zone's **reward**, so the summon is a
choice you make for something you want. The wards are on the body, but each body hides
them a different way, so *access* to the wards is the fight. Calming asks something
different of you each time, and pays differently.

Three creatures, three files, one shared contract with game.js. The current
`leviathan.js` becomes the base module (spine texture skinning, sigil pool, event
protocol, contact blobs), and each creature composes it.

## 2. The three

### Zone 0 — VELKATH, THE BROODER (crab-based, *buried*)

**Body.** A plated colossus, low and wide: a domed carapace ~28 u across with a raised
central keel, eight jointed walking legs on the existing spine-chain skinning (one chain
per leg), two asymmetric forelimbs, one a crusher and one a long cutter. Eye stalks that
track Sal. The carapace is the shallow zone's colour language: pale chalk plates, barnacle
crust, weed in the joints, the hide already in the god rays at 62/38. Ward count 3, on the
**underside**: one under the mouthparts, one under each hip joint. Visible only when she
stands.

**Reveal.** She is the ridge. The zone-0 site gets a new landmark: a shell-mound ridge
that the terrain generator raises as a low dome with a crescent of chalk boulders. The
carapace is baked into the terrain silhouette from the first frame (a mesh laid over the
dome that shares its colour and gets sediment), so the player walks on her without
knowing. The **nest** is a shallow crater in the lee of the ridge holding a clutch of
eggs, each the size of Sal's helmet, faintly lit from inside (a new keepsake class:
`egg`, three per clutch, pencilled on the chart).

**Trigger.** Take an egg. The moment one leaves the crater the ground rises: the dome
lifts on eight legs over ~6 s (sediment cascades, the boulders were her claws, the crest
was her keel), she turns to face the crater, and the message reads her name. From here
the zone-0 rite is live.

**Fight.** Strength: nothing hurts her. Armour ignores spear and knife; a stomp near Sal
throws sediment and a shockwave that knocks him back and pops his exhaust (surfaceBoil is
already there for the boil). She is slow but she covers ground in lunges. Weakness: she
must **stand up to move**, and her wards are underneath. The play is to bait a lunge and
be under her when she comes over you, light a hip ward, get out before she settles. The
mouth ward only shows when she rears to threaten, which she does when you hold an egg in
front of her. Existing zone-0 idle (shallow, crossing the rays) is kept as her patrol
between lunges.

**Payoff.** The third ward will not light while you hold an egg. Return the eggs to the
crater (carry one at a time, walk into the nest) and the last ward wakes on its own. She
settles back over the nest, the rift she was lying on is the rift you need, and she
leaves you one egg in the sand as she goes down: the chart keepsake. The moral is
Shadow of the Colossus: you rob her to meet her, you give it back to pass.

### Zone 1 — ORUNE, THE HOARDER (octopus-based, *lairing inside the wreck*)

**Body.** A mantle ~14 u long that changes colour with the rock (the paint law's matte
hook drives a chromatophore field, so its hide matches the zone's palette when still and
flushes crown-of-thorns purple when roused), eight arms on the spine skinning at full
leviathan length (40 segments each), suckers as instanced discs down the inner faces, one
enormous slit eye. Ward count 4, one on the **inner face of four arms**, near the base.
Coiled into the wreck they are invisible; an arm reaching out shows its ward.

**Reveal.** The trawler (zone 1's biggest story object, the one with the burning
porthole) is her lair. The hold is a **hoard**: every light the deep ever took, drowned
lanterns, a ship's lamp, the diving bells' portlights, arranged in the dark, some still
glowing. This is where the octopus lantern-theft card lands: the predators' octopus steal
now carries Sal's lantern *here*, and the hoard is where you get it back. Arms lie among
the hoard as cargo, reading as hose, chain, weed.

**Trigger.** Take the centrepiece: the ship's lamp on the hoard's altar (a relic, lit,
worth a chart keepsake and it doubles Sal's hand light for the rest of the game). The
arms stir, the hull groans, the hoard's lights go out one by one as she draws them in,
and she pours out of the hold.

**Fight.** Strength: she takes the **hose**. A grab on the air line pulls Sal toward the
hold, the tautness gauge climbs, supply drops. Knife on the arm frees it (the hose-leash
decision resolves here as clamp-with-give: the elastic band is her pull). Ink blinds
(reuses the existing ink cloud). Weakness: **light**. A ward on any arm that touches Sal's
lit lantern flushes, and she cannot hold that arm still: a lit ward pulls the arm out of
the wreck. Sonar (the existing zone-1 mechanic) reveals arms through camouflage and rings
the wards, so the two tools you have by zone 1 both matter. Her wards are dark iron
until sonar rings them, as now.

**Payoff.** You keep the lamp. She stills coiled around the wreck's mast with all four
arms out, wards lit, and the wreck becomes a lit landmark you can see from the zone's
far edge, a lighthouse in the trench. The rift is under the hull. The hoard's other
relics are now free to take.

### Zone 2 — MHOR, THE HUNTER (squid-based, *arrives from below*)

**Body.** A torpedo mantle ~32 u with two triangular fins running its whole length on the
membrane rig, eight arms and two hunting tentacles with clubs at twice the arm length,
photophores in rows that pulse when it hunts (the emissive travelling-ring already in the
hide shader), a beak the size of the raft. Furnace-red hide from the existing config. Ward
count 5 on the **mantle** and the two tentacle clubs. Nothing on it is still.

**Reveal.** The vent field is cold. Zone 2's last furnace, the tallest chimney, is dead,
and the zone is the darkest in the game. A new discoverable: bitumen seams in the vent
field (the resources system already knows bitumen). Feeding the furnace chimney relights
it and the whole field wakes: vents flare, the vent life comes out, and the glow makes a
**warm pocket** where the pump-line pressure loss stops mattering, a refuelling and
resting station at the bottom of the trench, which is the largest practical reward in the
game at a depth where the hose is the leash.

**Trigger.** The light. Mhor hunts heat. Within a minute of the field waking, the fog wall
below shows a shape, the photophores come up out of the black, and it comes in fast.
The message beat is silence, then the name.

**Fight.** Strength: **speed and reach**. It never stops moving; the tentacle strike
lands from far outside knife reach and drags. The existing squid keepers stay: the field's
small squid station on the unlit wards as now. Weakness: **the furnace**. It is drawn to
the light and it is blinded by it. A strike into the chimney's flare stuns it for seconds,
the mantle stalls in the glow, and that is when its wards can be reached. The tentacle
club wards light when a strike is baited over a flaring vent: it plants the club in the
fire. The ink sac (Q, already breaks a shark's charge) breaks its strike too.

**Payoff.** Passage. Mhor stilled in the furnace light is the last rite, and the ending
(the ascent, "one light returns") already follows.

## 3. The bigger world: discoverability

Each zone gains a **story chain** of three to four discoverable points that lead to the
trigger, so the summon is found, not stumbled on:

- Zone 0: crab tracks in the sand → broken egg shells → the shell-mound ridge → the nest.
  The zone's small crabs (fauna) converge on the nest, so following the animals works.
- Zone 1: drowned lanterns dropped along a line → the trawler's lit porthole → the hold →
  the hoard. Sonar pings return a hard echo from the hoard's metal.
- Zone 2: bitumen seams → cold chimneys with old scorch → the tall dead furnace → the
  fuel port.

Each point, when found, is pencilled on the chart (chart v2 already pencils discovered
anchorages; this extends `found[]` to points within a site). The bearing strip gets a
"?" bearing for the nearest unfound point of the chain once the first is found.

Zone footprint: the playable radius per zone grows by widening the rock-scatter and
gardens bands to the terrain edge rather than enlarging the terrain, so the site-0
fingerprint (35acc2d0) is untouched. The ridge in zone 0 is the one terrain change and
it lands on a new probe-free region. Each chain's points sit at the zone's far edges, so
the zone is crossed before the fight.

## 4. Shared contract

game.js keeps talking to one object: `lev` with `head`, `spine` (for physics and
collision), `sigils[]`, `calmed`, `name`, `size`, and the event stream
(`sigilLit`, `calmed`, `msg`). New fields: `present` (false until triggered),
`trigger()` (called by the world when the trigger fires), `summonT`. The bearing strip
shows the sleeper bearing only when `present`. Sigil light pool of 5 is unchanged, light
count stays sacred. `disposeLeviathan` contract unchanged so voyages and reseeds hold.

The base module keeps: spine texture upload, `rebuildBody` per chain, hide maps, rune
texture, ward placement on a chain at a parameter, the calming wave, the ember burst,
contact blobs. Each creature file provides: geometry assembly (which chains, what body
mesh), idle and roused steering, the reveal, the access rule per ward, and its payoff
hook.

Chart overlays (`over`) for remote sites still merge over the config; a remote site's
row picks which of the three creatures by `kind`.

## 5. Geometry bar

This is the geometry pass the leviathan never got. Targets: each creature at 80–120k tris
in hero range, per-plate chamfers on the crab, sucker instancing, a real beak. Reuse the
spine-texture skinning for every limb so all three animate on the GPU path that exists.
All three built from code; Blender is not used.

## 6. Not in scope

Persisting calms across visits (own decision card). Changing the ending. New tools.
Difficulty settings. Voice.

## 7. Order of work

1. Base/creature split with the current serpent still shipping (no visible change).
2. Zone 0 Brooder end to end: ridge, nest, eggs, reveal, fight, payoff, chain.
3. Zone 1 Hoarder (folds in lantern theft and the hose-leash decision).
4. Zone 2 Hunter (folds in the furnace).
5. Chart pencilling of chain points and the "?" bearing.

Each step ships alone and is playable; the serpent stays for any zone not yet replaced.

## 8. Testing

Per creature: the reveal from a cold load, the rite completes, the rift opens, dispose
and reseed clean, voyage to a remote site with an overlay row builds the right kind,
light count unchanged (14), program count logged, fingerprint 35acc2d0 for site 0, the
existing degrade ladder and governor unaffected, console clean.
