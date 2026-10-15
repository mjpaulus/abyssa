// THE PLUGGED CLOCK for stepped probes (seafloor relief Ruling 42; CLAUDE.md "THE BENCH CLOCK LEAK"). game.js's bench hold(false)
// calls clock.getDelta(), and three r184's getDelta ADDS the wall time since its last call to clock.elapsedTime, so every
// __bench.step pushed the game's t on by its own wall time (1.5-2.1x the stepped time): the current, the tear gate, the weather.
// riteplay.mjs and fullplay-gate.mjs plug it inline; new probes import this. plug(c) once the page is up: the live loop is held,
// the clock stopped, every stepped frame counted. drift(c) at the end: unmeasured(d) = no reading at all (exit 2); lost(d) = a
// reading over the bar (exit 4, re-run). plug(c, { stop: false }) keeps the counter and skips only clock.stop(): the drift RED
// (fullplay-gate.mjs FP_NOPLUG's way), which must show a NUMERIC drift over the bar, never a missing one.
export const CLOCK_LOST = 0.05;
export async function plug(c, { stop = true } = {}) {
  await c.ev(`(window.requestAnimationFrame = cb => { window.__rafCb = cb; return 0; }, 1)`);
  await new Promise(r => setTimeout(r, 300));
  return c.ev(`(async () => {
    const { clock } = await import(new URL('src/core.js', document.baseURI).href);
    if (${stop}) clock.stop();
    const S0 = window.__bench.step;
    window.__plugClk = { clock, e0: clock.elapsedTime, n: 0 };
    window.__bench.step = (n, fn, o) => S0(n, i => { window.__plugClk.n++; return fn ? fn(i) : undefined; }, o);
    return 1; })()`);
}
export async function drift(c) {
  return c.ev(`(() => { const k = window.__plugClk; if (!k) return null; const run = k.clock.elapsedTime - k.e0, stepped = k.n / 60;
    return { run: +run.toFixed(3), stepped: +stepped.toFixed(3), drift: +(run - stepped).toFixed(4), running: !!k.clock.running }; })()`);
}
export const unmeasured = d => !d || !Number.isFinite(d.drift) || !(d.stepped > 0);
export const lost = d => !unmeasured(d) && (Math.abs(d.drift) > CLOCK_LOST || d.running);
