// The keepsakes: the small things the previous chart-owner left at each remote wreck.
// OWNED BY: keepsake agent.
//
// Shapes only. They are needed in TWO places that must agree exactly — the berth at the
// wreck (world/wrecks.js) and the shelf by the chart table (systems/raft/shelf.js) — and
// the whole point of the shelf is that the thing on it is the thing you picked up. So the
// geometry lives here, alone, and both sides merge it into their own material.
//
// DEPENDENCY-LIGHT on purpose (three only): wrecks.js reaches into systems/ for nothing
// else, and raft/ reaches into world/ for nothing at all. A shared leaf module is the only
// import either side can take without inventing an edge between them.
//
// Every function returns FRESH indexed BufferGeometries, already placed in a local frame
// whose origin is the object's footprint centre and whose +Y is up. Nothing is merged and
// no material is touched here: the caller buckets them into its own Part.
import * as THREE from 'three';

const _o = new THREE.Object3D();
function xf(g, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  _o.position.set(x, y, z); _o.rotation.set(rx, ry, rz); _o.scale.setScalar(1); _o.updateMatrix();
  return g.applyMatrix4(_o.matrix);
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, s = 10, open = false) => new THREE.CylinderGeometry(rt, rb, h, s, 1, open);
const sph = (r, w = 8, h = 6) => new THREE.SphereGeometry(r, w, h);
const tor = (r, t, rs = 5, ts = 12) => new THREE.TorusGeometry(r, t, rs, ts);
const H = Math.PI / 2;

// WHICH keepsake sits at which berth. Site-major, [site][zone]; site 0 is the home
// mooring, where the relics themselves still are and no keepsake is left.
// THE UNSOUNDED SHELF (site 3) has no owner's things on it — nobody's owner ever
// arrived — so its berths carry older, stranger objects.
export const KEEP_KIND = [
  null,
  ['pipe', 'watch', 'cup'],
  ['knife', 'button', 'tin'],
  ['doll', 'coin', 'key']
];

export function keepsakeKind(site, zi) {
  const row = KEEP_KIND[site];
  return row ? row[zi] || null : null;
}

// ---- the objects -------------------------------------------------------------------
// All authored at true size (a briar pipe is 140 mm), so the shelf can take them at 1.0
// and the seabed berth can take them at a legibility scale without either being a guess.
const SHAPES = {
  // A briar pipe, bowl down, stem out along +X.
  pipe: () => [
    xf(cyl(0.022, 0.017, 0.038, 10), 0, 0.019, 0),
    xf(cyl(0.019, 0.019, 0.004, 10), 0, 0.036, 0),
    xf(cyl(0.006, 0.005, 0.105, 7), 0.062, 0.009, 0, 0, 0, H),
    xf(box(0.022, 0.007, 0.013), 0.124, 0.009, 0)
  ],
  // A pocket watch face up, crown and a few chain links trailing off +X.
  watch: () => [
    xf(cyl(0.026, 0.026, 0.008, 16), 0, 0.004, 0),
    xf(cyl(0.023, 0.023, 0.002, 16), 0, 0.009, 0),
    xf(cyl(0.005, 0.005, 0.009, 6), 0.030, 0.004, 0, 0, 0, H),
    xf(tor(0.008, 0.003), 0.042, 0.004, 0, H),
    xf(tor(0.007, 0.0025), 0.058, 0.003, 0.006, H, 0.4),
    xf(tor(0.007, 0.0025), 0.072, 0.003, 0.016, H, 0.9)
  ],
  // A tin cup, scoured thin, handle to +X.
  cup: () => [
    xf(cyl(0.033, 0.026, 0.076, 12, true), 0, 0.038, 0),
    xf(cyl(0.026, 0.026, 0.004, 12), 0, 0.003, 0),
    xf(tor(0.019, 0.0035, 4, 12), 0.043, 0.042, 0),
    xf(tor(0.033, 0.0025, 4, 14), 0, 0.075, 0, H)
  ],
  // A clasp knife, folded shut.
  knife: () => [
    xf(box(0.090, 0.017, 0.024), 0, 0.009, 0),
    xf(box(0.076, 0.006, 0.013), 0.006, 0.020, 0),
    xf(sph(0.006, 6, 5), -0.040, 0.010, 0.012),
    xf(box(0.090, 0.003, 0.004), 0, 0.010, 0.013)
  ],
  // A coat button, four holes' worth of thread long gone.
  button: () => [
    xf(cyl(0.017, 0.017, 0.004, 14), 0, 0.002, 0),
    xf(tor(0.014, 0.002, 4, 14), 0, 0.004, 0, H),
    xf(cyl(0.006, 0.006, 0.005, 6), 0, 0.005, 0)
  ],
  // A tobacco tin, lid knocked ajar.
  tin: () => [
    xf(cyl(0.038, 0.038, 0.022, 14, true), 0, 0.011, 0),
    xf(cyl(0.038, 0.038, 0.003, 14), 0, 0.002, 0),
    xf(cyl(0.041, 0.041, 0.006, 14), 0.016, 0.026, 0.004, 0, 0, 0.22)
  ],
  // A doll's head, salt-white, looking up out of the silt.
  doll: () => [
    xf(sph(0.038, 12, 9), 0, 0.036, 0),
    xf(sph(0.007, 6, 5), 0.036, 0.036, 0),
    xf(sph(0.006, 6, 5), 0.030, 0.048, 0.016),
    xf(sph(0.006, 6, 5), 0.030, 0.048, -0.016),
    xf(cyl(0.020, 0.024, 0.010, 10), 0, 0.005, 0)
  ],
  // A coin with no face and no year.
  coin: () => [
    xf(cyl(0.021, 0.021, 0.003, 18), 0, 0.002, 0, 0.10, 0, 0.06),
    xf(tor(0.019, 0.0015, 4, 16), 0, 0.003, 0, H)
  ],
  // A key of black glass.
  key: () => [
    xf(cyl(0.005, 0.005, 0.086, 8), 0.020, 0.005, 0, 0, 0, H),
    xf(tor(0.016, 0.005, 5, 14), -0.031, 0.005, 0, H),
    xf(box(0.008, 0.017, 0.005), 0.050, 0.013, 0),
    xf(box(0.007, 0.012, 0.005), 0.064, 0.011, 0)
  ]
};

// Fresh geometries for one keepsake, uniformly scaled about its own footprint centre.
export function keepsakeGeo(kind, scale = 1) {
  const f = SHAPES[kind];
  if (!f) return [];
  const list = f();
  if (scale !== 1) for (const g of list) g.scale(scale, scale, scale);
  return list;
}
