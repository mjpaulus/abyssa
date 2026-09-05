---
title: The Flow lean (a style between NMS and Flow)
status: next
tags: art-direction, style, postfx, materials, camera
updated: 2026-09-05
---
Michael: "make a card that finds a style in the middle but leaning towards flow." Reference: Flow (2024, Zilbalodis) — real-time-rendered painting: matte, low-detail painted surfaces; naturalistic light + heavy atmosphere doing the work textures don't; colour authored per scene in the shaders (no compositing); documentary camera (long takes, layered handheld, shallow DoF). Our current bar (recent NMS underwater) sits at the glossy-PBR end. The target is the midpoint, leaning Flow: keep our physics (stratified column, real waves, real weather), soften how we PAINT them.

## Detail
PRINCIPLES (the style in one paragraph): surfaces read as pigment, not plastic — matte first, specular only where it tells a story (wet brass, the glitter path, a jelly's rim). Detail is suggested at the edge and dissolved in the middle. Light and haze carry depth; the eye reads form and distance, not micro-texture. Every zone commits to one strong mood colour authored by hand. The camera has a point of view. Never neon — Flow's glow is halation on light, not emissive objects.

THE PASS, in order of leverage (each an A/B behind a GLASS knob so the midpoint is dialable, not a cliff):
1. MATERIAL RESPONSE — a global "paint" law: raise roughness floors across the generated PBR sets (rocks, terrain triplanar, flora, gardens, fauna, wrecks) so nothing but authored hero metal has a tight specular; clamp metalness on non-metals to 0; pull the new rock/deck normal-map strengths down so relief reads as brushwork not bump. Keep brass/copper/glitter as the exceptions.
2. EDGE-NOT-MIDDLE DETAIL — the screen-derivative relief and detail normals already fade by footprint; add a mid-tone flattening term (detail contrast scaled by 1 - luminance-in-band) so texture lives in the shadow/edge transitions and dissolves on lit faces. Flow's cat: strokes at the silhouette, nothing on the flank.
3. ATMOSPHERE FORWARD — one stop more haze in every regime than physics says (airK, the nepheloid amps, the lid ring) with a matching lift in halation: bloom threshold lower + wider radius but LOWER intensity, so light blooms softly into haze instead of hot-spotting. Sun/lantern get a halo, objects never glow.
4. AUTHORED SCENE COLOUR — one committed mood per zone and per weather stop, pushed further than now: gold/apricot on the deck at dusk, mossy teal reef, sulphur-amber boiler room, violet-black abyss. Extend the depth CDL grade (__grade) into a per-zone grade stack with hand-tuned lift/gamma/gain; saturation slightly UP in the mood hue, DOWN everywhere else.
5. DEPTH OF FIELD WITH INTENT — DoF currently focuses on the diver; add a subject-aware focus (nearest fauna/ward/keepsake in the centre third pulls focus over ~0.6s) and a wider aperture underwater; deck stays sharp.
6. CAMERA WITH A POINT OF VIEW — the FEEL channel becomes Flow's layered handheld: separate standstill / walking / swimming noise layers (4-octave sine on position, look AND roll), mixed by state, plus a slow "interest drift" toward the nearest living thing. Sal's gait fenced; this is the lens, not the legs.
7. SILHOUETTE STROKES — an optional edge treatment on organic things (fur/fin/frond): a thin screen-space rim of darkened, slightly broken alpha (dither) so creatures and plants read as painted at the edge. Gate: must not read as an outline shader.
8. WATER STAYS PHYSICAL BUT MATTE — keep the spectrum-filtering work; lower the mirror's clarity (roughness floor on the reflection) so the sea reads as painted swell not glass, except in the glitter path.

GATES: quiet, never neon; the hard rule holds (everything generated); A/B every step against main with GLASS.style.flowLean (0 = today, 1 = full lean) so Michael dials the midpoint by eye; storm walls, silt line, and the deck's brass keep their reads. Reference shots to judge against: the cat on the bow (matte painted hull, soft island), the capybara sunset (halation, haze), the underwater cyan sequences.
