# Orune — menace notes (research → levers)

Michael, 2026-10-03: "the octopus also needs to feel more menacing". Same note he gave the
Brooder ("crab-like and menacing"); he liked a reference with a looming, shadowed,
predatory mass. Tone holds: quiet dread, brass-age, never neon, never cartoon.

## What real octopuses do (and what we take)

- **Dark = aggression, pale = retreat.** Scheel et al. (Current Biology 2016, gloomy
  octopus agonistic encounters): an aggressor DARKENS and stands tall, spreads the web,
  raises the mantle and seeks high ground; the loser blanches and backs off.
  -> Awake and hunting she darkens (counter-shaded: near-black dorsum, paler underside),
  rears her mantle and flares her web. Source: https://www.sciencedirect.com/science/article/pii/S0960982215015596
- **Deimatic (startle) display.** A sudden flash or paling, a dark ring round the eye,
  the arms and web spread, the body raised to look bigger, the pupil dilated near round.
  -> Her DEIMATIC FLASH: a ~0.7 s blanch to bone-pale with the eye rings and arm edges
  staying black, the pupils blowing round. Used as a TELL (wake, the lantern burning an
  arm, the moment before an ambush) — never decoration.
  Sources: https://en.wikipedia.org/wiki/Deimatic_behaviour ,
  https://octonation.com/facts-about-octopus-eyes-and-vision/
- **Papillae.** Skin bumps lifted by their own muscles in under a second; used for
  camouflage and to look bigger and harder to read.
  -> A papilla field displaced in the vertex shader (and shaded by derivative normals)
  over her existing sculpt, raised as she becomes aware of the diver and full in threat.
  Source: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6059360/
- **Hunting.** Ambush from a den; arms PROBE crevices and the seabed (sucker
  recruitment: neighbouring suckers turn toward a touch); the WEB-OVER — parachuting the
  web over prey to net it; a pounce.
  -> Probing arms that test the silt toward Sal (silt puffs, sucker pops), the web-over as
  her waking reveal, freeze-then-lash ambush.
  Sources: https://www.biorxiv.org/content/10.1101/2023.03.13.532148.full.pdf ,
  https://news.berkeley.edu/2015/08/12/octopus-shows-unique-hunting-social-and-sexual-behavior/
- **The stare.** A horizontal bar pupil that holds level whatever the body does — the
  thing that makes an octopus feel like it is thinking about you.
  -> Asleep, one lid cracks and the bar pupil follows Sal; it shuts when he looks at it.

## How films and games land a cephalopod/leviathan threat

- **Withhold.** The Jaws rule: the unseen thing is scarier than any reveal; reveal late,
  in pieces. Sources: https://thedailyjaws.com/blog/the-jaws-rule-movies-that-keep-the-monster-hidden-for-maximum-fear ,
  https://www.gradesaver.com/jaws/study-guide/the-art-of-what-we-dont-see
- **Sound ahead of sight.** Subnautica's Reaper: you HEAR it (and can't place it) long
  before you see it; the roar comes only when it has seen you.
  Sources: https://thegeekwave.com/2020/06/subnautica-and-sound/ ,
  https://subnautica.fandom.com/wiki/Reaper_Leviathan
- **Unsettle, don't jump-scare.** Dredge leaves things to the player's imagination and
  weaponises murk; once seen, a monster loses impact unless it keeps changing.
  Sources: https://www.gamedeveloper.com/production/leveraging-the-unseen-to-turn-players-worst-fears-against-them-in-dredge ,
  https://80.lv/articles/tidal-terrors-designing-the-monsters-of-dredge

## Rules for this pass

1. Every new threat has a readable TELL (sight AND sound) a beat before it can hurt.
2. Presence before the wake is never harmful — it is the Jaws rule: things that moved
   when you weren't looking, an eye that was shut and now isn't.
3. No THREE light added (14). Light comes from the hoard and the ward pool / slot B.
4. Rite contracts untouched: lamp wakes, knife frees, light makes arms flinch, sonar
   rings sucker-face wards, calm -> lighthouse, collR, grab <= 5 s.

## Threat -> tell table (as built)

| threat | tell |
|---|---|
| asleep: arms resettle out of view | silt hangs where an arm moved; a wet drag sound |
| asleep: the eye that watches | eyeshine in the lantern; the lid snaps shut when faced |
| the wake: web-over | lanterns die one by one, a long exhale you feel, arms rise slowly over him (no lash for its length) |
| probing arm (awake) | silt puffs along the seabed, sucker pops near Sal |
| the freeze -> ambush lash | breathing stops, the bed goes silent, skin darkens, pupils blow round; then the arm blanches and cocks (0.45-0.6 s) before it throws |
| lash from behind (after circling the light) | longer cock (0.6 s), the pale arm, a positional pop behind him |
| grab -> beak | "IT HAS YOU. CUT IT.", the mantle rears to bare the beak, the beak snaps in time with a click |
| ink (the lantern held into two arms ~1.2 s) | the siphon swells on a deep exhale ~0.9 s before the cloud; no lash for 2.5 s after |
