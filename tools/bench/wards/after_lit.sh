#!/bin/sh
# RETIRED (fissure-and-harpoon Task 6: the pry, the carried clump and the brood rule are gone; this script drives that removed API and no longer runs. Kept because roadmap logs cite its results.)
# AFTER, continued from after_cold.sh: Sal back at the nest, the egg set down with a real E;
# the held ward lights on its own (the brood rule). Frozen on the flash, camera still pinned.
D=$(dirname "$0"); S=${BENCH:-node $D/../cdp.mjs}
$S eval "(()=>{ window.__thaw(); window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyW',key:'w'})); const L=window.lev,B=L.brood,P=window.player; const n=B.nest.clone(); window.__bench.place(n.x+0.8, n.z, 0, 0); window.__freezeWhen('window.__last.lit && window.__last.flashT > ${FT:-0.35}'); window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyE',key:'e'})); window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyE',key:'e'})); return { out: B.out(), held: B.held }; })()"
node $D/shot.mjs "$1" "window.__frozen" 20000
$S eval "(()=>{ const g=window.__last; return { lit: g.lit, calmed: window.lev.calmed, msg: window.__msg(), tally: document.querySelector('#bmLev .tally').textContent }; })()"
$S eval "window.__thaw()"
