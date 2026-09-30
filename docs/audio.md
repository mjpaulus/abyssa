# ABYSSA audio: listening guide

Every sound is generated in code. There are no samples: the rooms are generated impulse responses and the grain textures come from an AudioWorklet. Use headphones. The design relies on HRTF placement and on sub-bass, and laptop speakers reproduce neither.

## Where to go and what to listen for

| # | Where | What to listen for |
|---|---|---|
| 1 | **Title → click → standing on deck** | Wind in the stays, water lapping and slapping the strakes (irregular knocks, left/right), hull creaks, the pump thudding beside you (it is *placed*: turn and it moves). Walk: the boots knock timber. On a fair day with little wind, an occasional far gull. |
| 2 | **A storm on deck** (`weather.set` / wait for one) | Rain ticking on timber, the gust whistle rising with wind, **thunder placed on the bolt's real bearing and delayed by range** (count the seconds after the flash). A near strike cracks before it rolls. |
| 3 | **Step over the side** | Surface slap, then the world closes around the helmet: a falling roar, a boil of bubbles. From here on everything outside is muffled by water, and the muffling deepens as you sink. |
| 4 | **Sinking through zone 0** | Your breath is *inside* a copper helmet (close, resonant) and follows the shoulders exactly. Constant air hiss at the gooseneck swells with each pump stroke; the pump itself comes down the hose as a faint thump in the helmet. Exhaust bubbles leave the valve on the right on every exhale. |
| 5 | **Zone 0 floor** | Snapping-shrimp crackle (a far carpet plus near snaps), boots in silt (a dull puff with a slow settle), a sharper clack near rocks. Far off: rock settling, and a long, rough, throat-like call from something big, rarely. |
| 6 | **Velkath** (take an egg) | She wakes: the score cuts to silence, then the shell grinds up out of the silt. Every foot she plants shakes the floor *where that foot is*. As she rears, the plates grind under the strain, and then the hammer lands (the biggest hit in the game). |
| 7 | **Zone 1, the boiler room** | Pressure rumble, boiling, and the **two nearest vents roaring from their real positions**. Swim past a chimney and it pans. Crust crunches underfoot; a deep knock now and then. The reverb has metal in it. |
| 8 | **Orune** (take the ship's lamp) | A slow, resonant siphon exhale on every breath she takes, with big bubbles. An arm lash is a slither with suckers popping at the arm's tip. The grab clamps wet and then squeezes. When you cut it, the release pops. |
| 9 | **Zone 2, the abyss** | Mostly nothing, and that is intended. Sub pressure, a faint ringing air, a far metal tick every so often, a very long dark reverb with late echoes off walls you can't see. |
| 10 | **Mhor** (feed the furnace) | He arrives as a low bending call from below. While circling he makes jet whoomps and click trains that come faster as he closes. **The strike** is a click train that speeds up until it fuses into a tone, cut dead at the dash, then the jet. Stunned, he convulses (irregular clicks and a falling groan). |
| 11 | **Tools** | Sonar (T): the key clacks and the ping goes out. Echoes come back from the real wards (bright), the sleeper (low, long) and the floor (diffuse), each placed and delayed by the round trip. The knife pushes water. The thruster's lever clacks, then the jet and the bubbles. |
| 12 | **Getting hurt** | A bite gets a crunch and a thrash. A torn dress rips, then keeps a small leak hissing with bubbles until you mend it at the raft. **Let the pump run dry:** the air hiss dies, and that silence is the warning. |
| 13 | **Score** | The score is sparse on purpose. Expect a low brass swell or a bowed-metal texture roughly every 1–2 minutes below the surface, none on deck, and none while threatened. Threat brings a tightening bowed cluster. Each ward lit adds a note to the next phrase. A calm resolves with a major third. |

**Controls:** M mutes, and muting suspends the audio thread. Esc or losing focus suspends everything, and it resumes when you return. With reduced motion enabled, every startle (impacts, stingers, thunder) is 40% quieter.

## Knobs (live, in the console)

`__audio.kb` (beds), `__audio.ks` (Sal), `__audio.kc` (creatures), `__audio.km` (score), `__audio.k` (master/limiter/ducks). `__audio.group('amb'|'sfx'|'cre'|'suit'|'mus', v)`, `__audio.solo(g)` / `unsolo()`, `__audio.fire(name)` (see `__audio.list()`), `__audio.log()`, `__audio.peak()`, `__audio.perf()`.

The offline lab renders any scene through the real engine and measures it:

```js
const lab = await __audio.lab();
await lab.analyse('velkath');   // LUFS-ish, peak, LRA, spectrum, realtime factor
await lab.masking('reef');      // per-group stems, band overlap
await lab.play('mhor');         // audition the render
open(await lab.wav('abyss'));   // WAV export
```

## Measured (offline, 48 kHz, K-weighted, integrated / momentary max / sample peak)

| scene | I (LUFS) | M max | peak dBFS | LRA |
|---|---|---|---|---|
| deck, fair | -27.2 | -22.3 | -9.7 | 5.1 |
| deck, gale + thunder | -24.1 | -17.3 | -7.3 | 3.8 |
| descent | -24.9 | -22.1 | -11.6 | 2.6 |
| reef floor | -23.6 | -20.7 | -9.7 | 1.4 |
| boiler room | -21.5 | -18.9 | -9.2 | 1.8 |
| abyss | -25.4 | -19.0 | -10.5 | 3.6 |
| Velkath encounter | -17.6 | -10.9 | -2.2 | 3.7 |
| Orune encounter | -17.1 | -13.3 | -3.0 | 1.8 |
| Mhor encounter | -24.3 | -17.7 | -9.0 | 4.6 |
| Sal under stress | -24.3 | -20.2 | -7.0 | 1.8 |
| score cues | -21.8 | -11.0 | -1.8 | 9.0 |

No scene clips. The highest sample peak is -1.8 dBFS (the score cues and the Velkath hammer), which touches the -2.5 dB limiter only briefly.
