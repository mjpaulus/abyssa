Ward touch harness (roadmap/fifth-ward.md). Page must be loaded with ?bench (the bench host,
tools/bench/cdp.mjs) and in play (start(), window.__helm = true).
  node tools/bench/cdp.mjs run tools/bench/wards/harness.js        -> installs window.__wt
  node tools/bench/cdp.mjs eval "window.__arg={site:1,rem:true}"
  node tools/bench/cdp.mjs run tools/bench/wards/velkath.js         (orune.js / mhor.js)
Each script satisfies the kind's gate through the game's own input (KeyE takes the egg /
the ship's lamp / feeds the furnace, KeyT pings, a strike aimed through the furnace flare
stuns Mhor), then walks Sal to every ward along its normal with the REAL update stepping
(__bench.step) and records lit / light / burial / messages. before/ = results on f4d86cc.
