// SHADER SOAK (roadmap/shader-link-failure.md). Imported by the PAGE (served from the
// worktree root) under ?bench&playtest:
//   const S = await import('/tools/bench/shader-soak.js'); window.__soak = S.soak({ ms: 1500 });
//   await __soak  -> { steps: [{ label, newPrograms, failed }], programs, failed }
// Visits every zone at every anchorage (home, Pallid Bank, Burned Ground) through the game's
// own jumps: the deck (camera in air, refraction + sun shadow live), gotoZone 0/1/2 from the
// deck (the refraction pass's clip-plane variants of the deeper zones' materials), mid-water
// just under the surface (refraction live from below), the seabed of every zone and every
// sleeper (deep: refraction off), then the quality ladder's rungs down and back. Records each
// program built at each step and every failed program (window.__shaderFailed). Works in the
// bench host (rAF live) and in a hidden pane (drives the loop with __power.drive).
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export async function soak(o = {}) {
  const ms = o.ms || 1500;
  const { renderer, camera, scene } = await import('/src/core.js');
  const { currentSiteIndex } = await import('/src/world/site.js');
  const P = window.__playtest;
  if (!P) throw new Error('load with ?bench&playtest');
  const progKey = (p) => p.name + '|' + p.cacheKey.length + '|' + hash(p.cacheKey);
  const seen = new Set(renderer.info.programs.map(progKey));
  const steps = [];
  const drive = document.hidden;
  if (drive) window.__power.drive(true);
  window.__helm = true;
  const settle = async (label) => {
    window.__helm = true;
    if (window.survival) { window.survival.hose = 5000; window.survival.oxygen = 1; }
    await sleep(ms);
    const fresh = [];
    for (const p of renderer.info.programs) {
      const k = progKey(p);
      if (!seen.has(k)) { seen.add(k); fresh.push(p.name); }
    }
    steps.push({ label, site: currentSiteIndex(), camY: +camera.position.y.toFixed(1), newPrograms: fresh.length, names: summarise(fresh), failed: window.__shaderFailed().length });
  };
  const midWater = (y) => { const p = window.player; p.pos.y = y; p.vel.set(0, 0, 0); p.grounded = false; p.onDeck = false; };
  try {
    for (let s = 0; s < 3; s++) {
      // the deck at this anchorage: '1' is the home deck, '-' sails on to the next anchorage
      // and lands on its deck. ('1' and '3' sail HOME first, so neither is used away from it.)
      P.jump(s === 0 ? '1' : '-');
      await settle(`site${s} deck`);
      for (const z of [1, 2, 0]) { window.gotoZone(z); await settle(`site${s} deck gotoZone(${z})`); }
      // every object drawn (no frustum cull), per zone, from the deck and from just under the
      // surface: the refraction pass's clip-plane variants of anything it could ever see
      const unculled = async (label) => {
        const off = [];
        scene.traverse(x => { if (x.frustumCulled) { off.push(x); x.frustumCulled = false; } });
        try { await settle(label); } finally { for (const x of off) x.frustumCulled = true; }
      };
      if (o.unculled !== false) for (const z of [0, 1, 2]) { window.gotoZone(z); await unculled(`site${s} deck z${z} unculled`); }
      for (const z of [0, 1, 2]) {
        window.gotoZone(z);
        midWater(-12); await settle(`site${s} z${z} y-12 (refraction from below)`);
        if (o.unculled !== false) { midWater(-12); await unculled(`site${s} z${z} y-12 unculled`); }
        midWater(-30); await settle(`site${s} z${z} y-30`);
      }
      if (s === 0) { P.jump('3'); await settle(`site${s} seabed z0`); }
      else { const V = window.__bench.VIEWS.z0; window.__bench.place(V.x, V.z, V.yaw, 0); await settle(`site${s} seabed z0`); }
      P.jump('6'); await settle(`site${s} Velkath z0`);
      P.jump('7'); await settle(`site${s} Orune z1`);
      P.jump('8'); await settle(`site${s} Mhor z2`);
      if (s === 0 && window.__bench) {
        for (const v of Object.keys(window.__bench.VIEWS)) {
          const V = window.__bench.VIEWS[v];
          window.__bench.place(V.x, V.z, V.yaw, V.zone);
          await settle(`site0 view ${v}`);
        }
      }
    }
    // the quality ladder: down every rung from the deck and a seabed, then back up
    if (o.ladder !== false && window.__perf) {
      const rung = async () => {
        P.jump('1'); await settle(`rung ${window.__perf.stage()} deck`);
        midWater(-12); await settle(`rung ${window.__perf.stage()} y-12`);
        P.jump('3'); await settle(`rung ${window.__perf.stage()} seabed z0`);
      };
      for (let i = 0; i < 3; i++) { window.__perf.degrade(); await rung(); }
      for (let i = 0; i < 3; i++) window.__perf.restore();
      await rung();
      // the terminal rung (permanent: shadows off) last
      for (let i = 0; i < 4; i++) window.__perf.degrade();
      await rung();
    }
  } finally {
    if (drive) window.__power.drive(false);
  }
  return { steps, programs: renderer.info.programs.length, failed: window.__shaderFailed() };
}

function hash(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16); }
function summarise(names) { const c = {}; for (const n of names) c[n] = (c[n] || 0) + 1; return Object.entries(c).map(([k, v]) => v > 1 ? `${k} x${v}` : k).join(', '); }
