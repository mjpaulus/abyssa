// In-page: switch to ARGS.site (via __chart.arrive) if needed, sample terrainH on a 1 u grid
// x,z in [-300, 300] for ARGS.zones (Float64, base64), plus the site's pins as metadata (also written as meta_s<site>.json,
// so the renderer can take both builds' pins from files: it never has to be in the build whose pins it draws).
//   DRV_PORT=<chrome> OUT=<dir> node tools/relief/render/drive.mjs run tools/relief/render/sample.page.js '{"zones":[0]}'
const T = await import('/src/world/terrain.js');
const S = await import('/src/world/fissureShape.js');
const Lr = await import('/src/entities/sleeper/lair.js');
const W = await import('/src/world/wrecks.js');
const Si = await import('/src/world/site.js');
const C = await import('/src/config.js');
const R = await import('/src/systems/raft.js');
if (ARGS.site != null && window.__chart.site() !== ARGS.site) window.__chart.arrive(ARGS.site);
const site = window.__chart.site();
const N = 601, X0 = -300;
const files = {};
const b64 = arr => { const u8 = new Uint8Array(arr.buffer); let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const t0 = performance.now();
for (const zi of ARGS.zones || []) {
  const H = new Float64Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) H[j * N + i] = T.terrainH(X0 + i, X0 + j, zi);
  files[`H_s${site}_z${zi}.f64`] = b64(H);
}
const ms = performance.now() - t0;
const sp = Si.siteParams();
const row = (sp.sleepers || [])[0] || {};
const Rv = C.LEVIATHAN_CFG[0].size * Lr.R_OF_SIZE;
const lair = Lr.velkathLair(0, Rv, { lair: row.lair, idle: row.idle });
const lev = window.lev;
const meta = {
  site, key: sp.key, fp: window.__ridge.fp(), fp12: window.__ridge.fp([1, 2]), ms: Math.round(ms),
  clampR: T.clampR.map(a => Array.from(a)),
  bed: Lr.bedAt(), R: Rv, BED_R: Lr.BED_R,
  lair: { lip: [lair.lip.x, lair.lip.z], out: [lair.out.x, lair.out.z], sand: [lair.sand.x, lair.sand.z], g: lair.g, ok: lair.ok },
  wrecks: W.wreckSites().map(w => ({ zi: w.zi, x: w.x, y: w.y, z: w.z, clear: w.clear, dev: w.site.dev })),
  pump: [R.pumpPos.x, R.pumpPos.y, R.pumpPos.z],
  jam: [0, 1, 2].map(zi => ({ top: S.jamTopY(zi, T.terrainH), lipMean: S.lipMeanY(zi, T.terrainH) })),
  lev: lev && lev.pos ? { idx: lev.idx, pos: [lev.pos.x, lev.pos.y, lev.pos.z], yaw: lev.yaw, kind: lev.kind, dormant: lev.dormant } : null,
  terra: sp.terra, shape: sp.shape, ISLES: T.ISLES.map(s => ({ x: s.x, z: s.z, kind: s.kind, rc: s.rc, rIn: s.rIn, rOut: s.rOut })),
  RIDGE: { ...T.RIDGE }, rift: [0, 1, 2].map(i => C.riftPos(i)), zoneBottom: [0, 1, 2].map(C.zoneBottom), zoneTop: [0, 1, 2].map(C.zoneTop)
};
files[`meta_s${site}.json`] = btoa(unescape(encodeURIComponent(JSON.stringify(meta))));
return { meta: { site, fp: meta.fp }, files };
