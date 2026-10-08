#!/bin/sh
# AFTER (this branch): the last ward with an egg out, Sal hauled in on a held W (real keydown).
D=$(dirname "$0"); S=${BENCH:-node $D/../cdp.mjs}
$S eval "window.__arg={site:${SITE:-0},rem:${REM:-false},R:${R:-6.5}}"
$S run $D/velshot.js
$S eval "window.__pinArg={side:2,back:8,down:7,go:true,freeze:'window.__last.coldT > 0.15 && window.__last.coldT < 0.6'}"
$S run $D/velpin.js
node $D/shot.mjs "$1" "window.__frozen" 20000
$S eval "(()=>{ window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyW',key:'w'})); const g=window.__last; return { coldT: g.coldT, lit: g.lit, d: +g.grp.position.distanceTo(window.player.pos).toFixed(2), msg: window.__msg(), tally: document.querySelector('#bmLev .tally').textContent }; })()"
$S eval "window.__thaw()"
