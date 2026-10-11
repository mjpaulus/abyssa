// THE THROAT WALLS FROM INSIDE (fissure Task 5b): the page half of fissure-probe.mjs `walls-inside`.
// Imported by the PAGE (served from the worktree root) under ?bench&playtest:
//   const W = await import('/tools/bench/walls-inside.page.js');
// Runs on any build: where terrain.js has no throat wall (fissureWallGeo, Task 5b) the drawn wall is
// the fissure patch's own triangles inside the lip (b511877 and before), so the same probe gives the
// RED there and the GREEN after.
//   bound(zi)  - the DRAWN crack surfaces against the heightfield Sal stands on (terrainUnderH): a
//                signed 3-D distance per sample (every ~9th triangle: its centroid and a corner),
//                + = the drawn rock stands out in the water (lens, body), - = it lies back inside the
//                collision rock. Size: the nearest surface point on twelve horizontal bearings out to
//                2.5 u (a ground point at sqrt(d^2 + gap^2), or a riser crossing the point's height);
//                sign: the vertical gap's.
//   rays(zi)   - rays from the throat's axis to both walls (several depths, along the crack, three
//                elevations x three bearings): the drawn hit (THREE.Raycaster on every drawn crack mesh)
//                against the heightfield hit (a CPU march). A drawn miss = a gap; drawn rock > 0.3 u in
//                front of the heightfield's = protrusion. Grazes of a lip and overhang-slab faces aside.
//   look(zi)   - a settled frame from inside the throat looking up along it (open):
//                STREAK (geometry: a view-space normal pass): the normals' change across the wall's
//                  vertical axis over their change along it. The old grid's vertical slivers: 6-8;
//                  the throat walls: 2.0-2.5.
//                LINES and LINE SHARE (the settled full chain: what the shader draws): the fine band of
//                  the luminance (less its 9 px mean) that runs in coherent lines, against the mean
//                  luminance, and its share of the fine band. Rock grit points every way; stretched
//                  2-D noise drew fine wavy lines that close into eyes (wood grain, agate: fix round 1).
//                Also reported: local contrast (detail kept), facet energy, contour turn / tilt / spread.
//   fallLens(zi) - the REAL follow camera while Sal sinks through the open throat (C held), every 3rd
//                frame: the lens's nearest distance to any drawn crack triangle (the patch, the walls,
//                the slabs) against the camera's near plane.
const S = await import('/src/world/fissureShape.js');
const T = await import('/src/world/terrain.js');
const THREE = await import('three');
const { renderer, scene, camera } = await import('/src/core.js');

// every drawn crack triangle: { pos (Float32Array), tris: Int32Array of vertex triples, mesh list }
function drawn(zi) {
  const P = T.fissurePatchGeo(zi), A = P.pos.array, tris = [];
  const on = T.fissureWallOn ? T.fissureWallOn() : false;
  const wall = on ? T.fissureWallGeo(zi) : null;
  const fdv = i => S.fissureDist(A[i * 3], A[i * 3 + 2], zi);
  const surf = [];
  // the patch: its own triangles (slab bodies excluded: they are rock over the void by design,
  // probed by `slabs`); with a throat wall only the kept ones (the index the patch draws)
  for (const I of (on || !P.indexFull ? P.index : P.indexFull)) for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    if (a >= P.nv || b >= P.nv || c >= P.nv) continue;
    if (Math.min(fdv(a), fdv(b), fdv(c)) >= 0) continue;           // only what lies inside the lip
    tris.push(a, b, c);
  }
  surf.push({ name: 'patch', A, tris });
  if (wall) {
    const W = wall.pos.array, I = wall.index, wt = [];
    for (let t = 0; t < I.length; t++) wt.push(I[t]);
    surf.push({ name: 'wall', A: W, tris: wt });
  }
  return surf;
}
const _l = { u: 0, v: 0 };
// signed distance of a drawn point to the heightfield surface: + in the water, - in the rock. Its
// size: the nearest surface point found on twelve horizontal bearings out to 2.5 u: a ground point
// (x', h(x')) at sqrt(d^2 + (y - h)^2), or a riser crossing the point's own height at d (a riser is
// the heightfield's vertical face between two samples). Its sign: the vertical gap's at the point.
const DIRS = [];
export function sdist(x, y, z, zi, F) {
  if (!DIRS.length || DIRS.zi !== zi) { DIRS.length = 0; DIRS.zi = zi;
    for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6, cu = Math.cos(a), cv = Math.sin(a); DIRS.push([F.dx * cu - F.dz * cv, F.dz * cu + F.dx * cv]); } }
  const h = T.terrainUnderH(x, z, zi), dv = y - h;
  let best = Math.abs(dv);
  for (const [ex, ez] of DIRS) {
    let prev = dv;
    for (let t = 0.04; t <= 2.5 && t < best; t += 0.04) {
      const g = y - T.terrainUnderH(x + ex * t, z + ez * t, zi);
      if (g * prev <= 0) { best = Math.min(best, t); break; }
      const d = Math.hypot(t, g); if (d < best) best = d;
      prev = g;
    }
  }
  return Math.sign(dv) * best;
}
export function bound(zi) {
  const F = S.FISSURE[zi], out = {};
  for (const s of drawn(zi)) {
    const A = s.A, I = s.tris, n = I.length / 3;
    const step = Math.max(1, Math.floor(n / 8000));
    let pMax = -1e9, rMax = -1e9, cnt = 0, gt = 0, wp = null, wr = null; const hist = [];
    const take = (x, y, z) => {
      const d = sdist(x, y, z, zi, F); cnt++;
      if (d > pMax) { pMax = d; wp = [+x.toFixed(2), +y.toFixed(2), +z.toFixed(2)]; }
      if (-d > rMax) { rMax = -d; wr = [+x.toFixed(2), +y.toFixed(2), +z.toFixed(2)]; }
      if (d > 0.25) gt++;
      hist.push(d);
    };
    for (let t = 0; t < n; t += step) {
      const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
      take((A[a] + A[b] + A[c]) / 3, (A[a + 1] + A[b + 1] + A[c + 1]) / 3, (A[a + 2] + A[b + 2] + A[c + 2]) / 3);
      take(A[a], A[a + 1], A[a + 2]);
    }
    hist.sort((p, q) => p - q);
    const q = f => +hist[Math.min(hist.length - 1, Math.floor(f * hist.length))].toFixed(3);
    out[s.name] = { tris: n, samples: cnt, protrudeMax: +pMax.toFixed(3), recessMax: +rMax.toFixed(3), over025: +(gt / Math.max(1, cnt)).toFixed(4),
      p001: q(0.001), p50: q(0.5), p999: q(0.999), worstOut: wp, worstIn: wr };
  }
  return out;
}

// the meshes that draw the crack (patch chunks, the throat wall); slab triangles ride in the patch
function crackMeshes(zi) {
  const m = [], g = scene.getObjectByName('fissurePatch' + zi);
  if (g) g.traverse(o => { if (o.isMesh) m.push(o); });
  const w = scene.getObjectByName('fissureWall' + zi);
  if (w) m.push(w);
  return m;
}
export function rays(zi) {
  const F = S.FISSURE[zi], lip = S.lipMeanY(zi, T.terrainH), o = { x: 0, z: 0 };
  const meshes = crackMeshes(zi), vis = meshes.map(m => m.visible);
  meshes.forEach(m => { m.visible = true; m.updateMatrixWorld(true); });
  const rc = new THREE.Raycaster(); rc.far = 45;
  const org = new THREE.Vector3(), dir = new THREE.Vector3();
  let n = 0, gaps = 0, behind = 0, protrude = 0, worstIn = 0, worstOut = 0, outAt = null; const bad = [];
  try {
    for (let u = -0.7 * F.halfLen; u <= 0.7 * F.halfLen; u += 3.1) {
      if (S.SLABS[zi].some(sl => Math.abs(u - sl.u0) < sl.hu + 1.5)) continue;
      const wd = S._widths(F, u);
      for (const dep of [4, 10, 20, 35]) {
        // the axis at this depth: the middle of the open interval across the crack at y
        const y = lip - dep;
        let lo = null, hi = null;
        for (let v = -wd.w0; v <= wd.w1; v += 0.05) { S.fissureWorld(u, v, zi, o); if (T.terrainUnderH(o.x, o.z, zi) < y - 0.6) { if (lo === null) lo = v; hi = v; } }
        if (lo === null || hi - lo < 0.4) continue;
        S.fissureWorld(u, (lo + hi) / 2, zi, o); org.set(o.x, y, o.z);
        for (const sg of [-1, 1]) for (const el of [-0.35, 0, 0.45]) for (const al of [-0.4, 0, 0.4]) {
          dir.set(-F.dz * sg + F.dx * al, 0, F.dx * sg + F.dz * al).normalize();
          dir.multiplyScalar(Math.cos(el)); dir.y = Math.sin(el); dir.normalize();
          // the heightfield's hit
          let th = -1;
          for (let t = 0.02; t < 45; t += 0.02) { const px = org.x + dir.x * t, py = org.y + dir.y * t, pz = org.z + dir.z * t;
            if (py < T.terrainUnderH(px, pz, zi)) { th = t; break; } }
          if (th < 0 || th > 12) continue; // out over the lip (the apron beyond is not the crack's rock)
          // a graze (the ray skims a lip and goes on over it) is not a hit: it must go 0.3 u into the rock
          let into = 0;
          for (let t = th; t < th + 1; t += 0.02) into = Math.max(into, T.terrainUnderH(org.x + dir.x * t, org.z + dir.z * t, zi) - (org.y + dir.y * t));
          if (into < 0.3) continue;
          rc.set(org, dir);
          const hit = rc.intersectObjects(meshes, false)[0];
          const td = hit ? hit.distance : 1e9;
          n++;
          // (a drawn slab body hit first is the slab, not the wall: the station filter keeps rays off them)
          // a GAP is a drawn miss: water seen through where the heightfield has rock. A drawn hit far
          // behind the heightfield's is reported (the heightfield's thin fins at joint-block seams,
          // narrower than a column, are not drawn by the patch or the walls), not failed.
          const d = td - th;
          if (!hit) { gaps++; if (bad.length < 6) bad.push({ u: +u.toFixed(1), dep, sg, el, al, th: +th.toFixed(2), td: null }); }
          else if (d > 2.2) behind++;
          if (hit && d > worstIn) worstIn = d;
          const slabHit = hit && hit.object.name.startsWith('fissurePatch') && hit.face && hit.face.a >= T.fissurePatchGeo(zi).nv;
          if (slabHit) continue;           // an overhang slab is drawn rock over the water by design (probed by the slabs mode)
          if (d < -0.3) protrude++;
          if (-d > worstOut) { worstOut = -d; outAt = { u: +u.toFixed(1), dep, sg, el, al, th: +th.toFixed(2), td: +td.toFixed(2), mesh: hit.object.name, face: hit.faceIndex, slabFace: hit.object.name.startsWith('fissurePatch') && hit.face && hit.face.a >= T.fissurePatchGeo(zi).nv }; }
        }
      }
    }
  } finally { meshes.forEach((m, i) => { m.visible = vis[i]; }); }
  return { rays: n, gaps, behind, protrude, hitBehindMax: +worstIn.toFixed(3), hitInFrontMax: +worstOut.toFixed(3), inFrontAt: outAt, bad };
}

// ---- the look ----------------------------------------------------------------------------------
const NL = 7;   // a spare layer for the normal pass
let rt = null, nmat = null;
function normalPass(zi, W, H) {
  if (!rt || rt.width !== W || rt.height !== H) { if (rt) rt.dispose(); rt = new THREE.WebGLRenderTarget(W, H); }
  if (!nmat) nmat = new THREE.MeshNormalMaterial();
  const meshes = crackMeshes(zi), mask = camera.layers.mask, bg = scene.background, ov = scene.overrideMaterial, fog = scene.fog;
  const cc = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha();
  const px = new Uint8Array(W * H * 4);
  meshes.forEach(m => m.layers.enable(NL));
  try {
    camera.layers.set(NL); scene.background = null; scene.overrideMaterial = nmat; scene.fog = null;
    renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear(true, true, true);
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(rt, 0, 0, W, H, px);
  } finally {
    renderer.setRenderTarget(null); renderer.setClearColor(cc, ca);
    camera.layers.mask = mask; scene.background = bg; scene.overrideMaterial = ov; scene.fog = fog;
    meshes.forEach(m => m.layers.disable(NL));
  }
  return px;
}
// the throat view: on the open interval's middle, `dep` under the lip, looking up and along the crack
export function throatPin(zi, dep = 25, u0 = -3) {
  const F = S.FISSURE[zi], lip = S.lipMeanY(zi, T.terrainH), o = { x: 0, z: 0 }, o2 = { x: 0, z: 0 }, wd = S._widths(F, u0);
  const y = lip - dep;
  let lo = null, hi = null;
  for (let v = -wd.w0; v <= wd.w1; v += 0.05) { S.fissureWorld(u0, v, zi, o); if (T.terrainUnderH(o.x, o.z, zi) < y - 0.6) { if (lo === null) lo = v; hi = v; } }
  if (lo === null) return null;
  S.fissureWorld(u0, (lo + hi) / 2, zi, o); S.fissureWorld(u0 + 11, (lo + hi) / 2, zi, o2);
  const p = [o.x, y, o.z], t = [o.x + (o2.x - o.x) * 0.35, lip + 40, o.z + (o2.z - o.z) * 0.35];
  return { p, t, pos: p, look: t, open: +(hi - lo).toFixed(2), inVoid: T.terrainUnderH(o.x, o.z, zi) < y - 0.6 };
}
export async function look(zi, o = {}) {
  const pin = throatPin(zi, o.dep || 25, o.u0 == null ? -3 : o.u0);
  if (!pin || !pin.inVoid) return { zi, err: 'the throat view is not in the water', pin };
  window.__camPin = pin;
  const cap = await window.__bench.capture({ settle: o.settle || 120 });
  const W = cap.w, H = cap.h, N = normalPass(zi, W, H);
  // facet energy: |dN| between neighbours over pixels the crack's rock covers
  let fe = 0, fn = 0;
  const cov = i => N[i * 4 + 3] > 0;
  for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
    const i = y * W + x, r = i + 1, d = i + W;
    if (!cov(i) || !cov(r) || !cov(d)) continue;
    let s = 0;
    for (let ch = 0; ch < 3; ch++) s += Math.abs(N[i * 4 + ch] - N[r * 4 + ch]) + Math.abs(N[i * 4 + ch] - N[d * 4 + ch]);
    fe += s * 0.5; fn++;
  }
  // the streaks: the normal pass's change ACROSS the wall's vertical axis (tangential) against ALONG
  // it (radial, toward the zenith's vanishing point), 2 px each way. A heightfield grid on a 30 u
  // riser draws long vertical slivers: the normal changes across them, hardly along them (6-8);
  // layered rock changes much more along the vertical (beds, ledges: 2.0-2.5 measured).
  const vpN = new THREE.Vector3(camera.position.x, camera.position.y + 1e4, camera.position.z).project(camera);
  const nvx = (vpN.x * 0.5 + 0.5) * W, nvy = (vpN.y * 0.5 + 0.5) * H;
  const nb = (x, y, ch) => { const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, i = (y0 * W + x0) * 4 + ch;
    return (N[i] * (1 - fx) + N[i + 4] * fx) * (1 - fy) + (N[i + W * 4] * (1 - fx) + N[i + W * 4 + 4] * fx) * fy; };
  let eR = 0, eT = 0;
  for (let y = 4; y < H - 4; y += 2) for (let x = 4; x < W - 4; x += 2) {
    let ax = nvx - x, ay = nvy - y; const al = Math.hypot(ax, ay) || 1; ax /= al; ay /= al;
    const ok = (dx, dy) => cov(Math.round(y + dy) * W + Math.round(x + dx)) && cov(Math.round(y - dy) * W + Math.round(x - dx));
    if (!cov(y * W + x) || !ok(2 * ax, 2 * ay) || !ok(-2 * ay, 2 * ax)) continue;
    for (let ch = 0; ch < 3; ch++) {
      eR += Math.abs(nb(x + 2 * ax, y + 2 * ay, ch) - nb(x - 2 * ax, y - 2 * ay, ch));
      eT += Math.abs(nb(x - 2 * ay, y + 2 * ax, ch) - nb(x + 2 * ay, y - 2 * ax, ch));
    }
  }
  // luminance band-pass along the wall's vertical axis: the screen direction world-up projects to
  // at each pixel (toward the zenith's vanishing point), second difference at 2 px, over the local
  // mean (a 9 px box); only on rock pixels whose whole stencil is rock
  const L = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) L[i] = 0.2126 * cap.px[i * 4] + 0.7152 * cap.px[i * 4 + 1] + 0.0722 * cap.px[i * 4 + 2];
  const vp = new THREE.Vector3(camera.position.x, camera.position.y + 1e4, camera.position.z).project(camera);
  const vx = (vp.x * 0.5 + 0.5) * W, vy = (vp.y * 0.5 + 0.5) * H;   // (readPixels rows run bottom-up, as NDC y)
  const SA = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += L[y * W + x]; SA[(y + 1) * (W + 1) + x + 1] = SA[y * (W + 1) + x + 1] + row; } }
  const box = (x, y, R) => (SA[(y + R + 1) * (W + 1) + x + R + 1] - SA[(y - R) * (W + 1) + x + R + 1] - SA[(y + R + 1) * (W + 1) + x - R] + SA[(y - R) * (W + 1) + x - R]) / ((2 * R + 1) * (2 * R + 1));
  const bil = (x, y) => { const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, i = y0 * W + x0;
    return (L[i] * (1 - fx) + L[i + 1] * fx) * (1 - fy) + (L[i + W] * (1 - fx) + L[i + W + 1] * fx) * fy; };
  let ev = 0, ea = 0, en = 0, mean = 0, lc = 0;
  for (let y = 8; y < H - 8; y += 2) for (let x = 8; x < W - 8; x += 2) {
    if (!cov(y * W + x)) continue;
    let ax = vx - x, ay = vy - y; const al = Math.hypot(ax, ay) || 1; ax /= al; ay /= al;
    const sx = 2 * ax, sy = 2 * ay;
    if (!cov(Math.round(y + sy) * W + Math.round(x + sx)) || !cov(Math.round(y - sy) * W + Math.round(x - sx))) continue;
    if (!cov(Math.round(y + sx) * W + Math.round(x - sy)) || !cov(Math.round(y - sx) * W + Math.round(x + sy))) continue;
    const m = box(x, y, 4) + 2;
    const c = L[y * W + x];
    ev += Math.abs(bil(x + sx, y + sy) - 2 * c + bil(x - sx, y - sy)) / m;        // along the vertical axis
    ea += Math.abs(bil(x - sy, y + sx) - 2 * c + bil(x + sy, y - sx)) / m;        // across it
    lc += Math.abs(c - m + 2) / m; mean += c; en++;
  }
  // THE CONTOURS (fix round 1): the settled frame's own grain. Bedding seen from inside runs level,
  // so the luminance gradient on the rock points up and down the wall (along the radial axis to the
  // zenith's vanishing point); 2-D noise stretched into bands draws wandering, closing contours
  // (wood grain, agate eyes) whose gradient turns every way. Luminance smoothed (two 3 px boxes),
  // Sobel; per 24 px block of rock, the gradient's doubled angle to the radial axis, weighted by its
  // energy: ALIGN = sum(gr^2 - gt^2) / sum(gr^2 + gt^2) (1: level bands, 0: no preferred way, -1:
  // vertical), and COHERENCE = |sum of the doubled-angle vectors| / energy. Reported: alignment and
  // coherence medians over the blocks, and WANDER = the share of energetic blocks whose alignment
  // is under 0.2 (their grain runs any way but level).
  const sm = new Float32Array(W * H), sm2 = new Float32Array(W * H);
  const box3 = (src, dst) => { for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { let t = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) t += src[(y + dy) * W + x + dx]; dst[y * W + x] = t / 9; } };
  box3(L, sm); box3(sm, sm2);
  const BS = 24, blocks = [];
  for (let by = 4; by + BS < H - 4; by += BS) for (let bx = 4; bx + BS < W - 4; bx += BS) {
    let e = 0, c2 = 0, s2 = 0, n = 0;
    for (let y = by; y < by + BS; y++) for (let x = bx; x < bx + BS; x++) {
      const i = y * W + x; if (!cov(i)) continue; n++;
      const gx = (sm2[i - W + 1] + 2 * sm2[i + 1] + sm2[i + W + 1]) - (sm2[i - W - 1] + 2 * sm2[i - 1] + sm2[i + W - 1]);
      const gy = (sm2[i + W - 1] + 2 * sm2[i + W] + sm2[i + W + 1]) - (sm2[i - W - 1] + 2 * sm2[i - W] + sm2[i - W + 1]);
      let ax = vx - x, ay = vy - y; const al = Math.hypot(ax, ay) || 1; ax /= al; ay /= al;
      const gr = gx * ax + gy * ay, gt = -gx * ay + gy * ax;
      e += gr * gr + gt * gt; c2 += gr * gr - gt * gt; s2 += 2 * gr * gt;
    }
    if (n < BS * BS * 0.9 || e <= 0) continue;
    blocks.push({ e: e / n, al: c2 / e, co: Math.hypot(c2, s2) / e, c2: c2 / e, s2: s2 / e });
  }
  const eMed = blocks.map(b => b.e).sort((p, q) => p - q)[Math.floor(blocks.length / 2)] || 0;
  const strong = blocks.filter(b => b.e >= eMed);
  const med = a => { const v = a.slice().sort((p, q) => p - q); return v.length ? v[Math.floor(v.length / 2)] : 0; };
  const align = med(strong.map(b => b.al)), coher = med(strong.map(b => b.co)), wander = strong.filter(b => b.al < 0.2).length / Math.max(1, strong.length);
  // the grain's way, block to block: each block's doubled angle (0 = level bands); TILT = the median
  // of its size in degrees, SPREAD = 1 - the resultant length of the unit doubled angles
  let rx = 0, ry = 0; const tilts = [];
  for (const b of strong) { const l = Math.hypot(b.c2, b.s2) || 1; rx += b.c2 / l; ry += b.s2 / l; tilts.push(Math.abs(Math.atan2(b.s2, b.c2)) * 90 / Math.PI); }
  const spread = 1 - Math.hypot(rx, ry) / Math.max(1, strong.length), tilt = med(tilts);
  // THE GRAIN'S PATH: how much the contours turn as they run. A smoothed structure tensor (Sobel on the
  // smoothed luminance, 5 px box) gives each pixel its grain's way; stepping 3 px along the grain,
  // the change of that way, weighted by the tensor's strength, over the coherent rock pixels. Level
  // beds and laminae run straight (small); wood grain, agate eyes and wandering contours turn (large).
  const Jxx = new Float32Array(W * H), Jyy = new Float32Array(W * H), Jxy = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    const gx = (sm2[i - W + 1] + 2 * sm2[i + 1] + sm2[i + W + 1]) - (sm2[i - W - 1] + 2 * sm2[i - 1] + sm2[i + W - 1]);
    const gy = (sm2[i + W - 1] + 2 * sm2[i + W] + sm2[i + W + 1]) - (sm2[i - W - 1] + 2 * sm2[i - W] + sm2[i - W + 1]);
    Jxx[i] = gx * gx; Jyy[i] = gy * gy; Jxy[i] = gx * gy;
  }
  const bx5 = A => { const o = new Float32Array(W * H); for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) { let t = 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) t += A[(y + dy) * W + x + dx]; o[y * W + x] = t / 25; } return o; };
  const Sxx = bx5(Jxx), Syy = bx5(Jyy), Sxy = bx5(Jxy);
  const phiAt = i => 0.5 * Math.atan2(2 * Sxy[i], Sxx[i] - Syy[i]);
  const ens = []; for (let y = 8; y < H - 8; y += 3) for (let x = 8; x < W - 8; x += 3) { const i = y * W + x; if (cov(i)) ens.push(Sxx[i] + Syy[i]); }
  ens.sort((p, q) => p - q); const eCut = ens[Math.floor(ens.length / 2)] || 0;
  let kw = 0, ks = 0;
  for (let y = 8; y < H - 8; y += 3) for (let x = 8; x < W - 8; x += 3) {
    const i = y * W + x; if (!cov(i)) continue;
    const e = Sxx[i] + Syy[i]; if (e < eCut || e <= 0) continue;
    const c = Math.hypot(Sxx[i] - Syy[i], 2 * Sxy[i]) / e; if (c < 0.4) continue;
    const ph = phiAt(i), tx = -Math.sin(ph), ty = Math.cos(ph);
    const x2 = Math.round(x + 3 * tx), y2 = Math.round(y + 3 * ty), j = y2 * W + x2;
    if (!cov(j)) continue;
    let d = Math.abs(phiAt(j) - ph); if (d > Math.PI / 2) d = Math.PI - d;
    kw += c * e; ks += c * e * d;
  }
  const turn = ks / Math.max(1e-9, kw) * 180 / Math.PI;
  // FINE COHERENT LINES: the band of fine structure (the luminance less its 9 px box mean), its own
  // structure tensor's coherence over a 5 px box; the share of the fine band's energy that lies in
  // coherent lines, and that energy against the mean luminance. Rock grit is fine but points every
  // way; wood grain and agate are fine lines running together.
  const b9 = new Float32Array(W * H), SA2 = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += sm[y * W + x]; SA2[(y + 1) * (W + 1) + x + 1] = SA2[y * (W + 1) + x + 1] + row; } }
  for (let y = 4; y < H - 4; y++) for (let x = 4; x < W - 4; x++) b9[y * W + x] = (SA2[(y + 5) * (W + 1) + x + 5] - SA2[(y - 4) * (W + 1) + x + 5] - SA2[(y + 5) * (W + 1) + x - 4] + SA2[(y - 4) * (W + 1) + x - 4]) / 81;
  const Dd = new Float32Array(W * H); for (let i = 0; i < W * H; i++) Dd[i] = sm[i] - b9[i];
  const Fxx = new Float32Array(W * H), Fyy = new Float32Array(W * H), Fxy = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x, gx = Dd[i + 1] - Dd[i - 1], gy = Dd[i + W] - Dd[i - W]; Fxx[i] = gx * gx; Fyy[i] = gy * gy; Fxy[i] = gx * gy; }
  const Gxx = bx5(Fxx), Gyy = bx5(Fyy), Gxy = bx5(Fxy);
  let lineE = 0, allE = 0, lum = 0, ln = 0;
  for (let y = 8; y < H - 8; y += 2) for (let x = 8; x < W - 8; x += 2) {
    const i = y * W + x; if (!cov(i)) continue;
    const e = Gxx[i] + Gyy[i], c = e > 0 ? Math.hypot(Gxx[i] - Gyy[i], 2 * Gxy[i]) / e : 0;
    allE += Dd[i] * Dd[i]; lineE += c * c * Dd[i] * Dd[i]; lum += b9[i] + 2; ln++;
  }
  const lineShare = lineE / Math.max(1e-9, allE), lines = Math.sqrt(lineE / Math.max(1, ln)) / Math.max(1e-6, lum / Math.max(1, ln));
  window.__camPin = null;
  return { zi, open: pin.open, rockPx: fn, lines: +lines.toFixed(4), lineShare: +lineShare.toFixed(3), turn: +turn.toFixed(2), tilt: +tilt.toFixed(1), spread: +spread.toFixed(3), align: +align.toFixed(3), coherence: +coher.toFixed(3), wander: +wander.toFixed(3), blocks: strong.length, facet: +(fe / Math.max(1, fn)).toFixed(3), streak: +(eT / Math.max(1, eR)).toFixed(3), bandV: +(ev / Math.max(1, en)).toFixed(4), bandA: +(ea / Math.max(1, en)).toFixed(4),
    localContrast: +(lc / Math.max(1, en)).toFixed(4), meanL: +(mean / Math.max(1, en)).toFixed(2), cap, normals: N, W, H };
}
// PNG of a normal pass (for eyes)
export function normalsPng(N, W, H, s = 0.5) {
  return window.__bench.png({ w: W, h: H, px: N }, s);
}

// ---- the lens on the fall path ----------------------------------------------------------------
// point-triangle distance (Ericson, closest point on triangle), no allocation beyond the scratch
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Vector3(), _tri = new THREE.Triangle();
export async function fallLens(zi, o = {}) {
  const F = S.FISSURE[zi], lip = S.lipMeanY(zi, T.terrainH), w = { x: 0, z: 0 };
  window.setState('play'); window.__helm = true; window.survival.hose = 5000; window.__camPin = null;
  window.gotoZone(zi); window.lev.calmed = true; window.__fissure.setOpen(zi, 1);
  const u0 = o.u == null ? -4 : o.u;
  S.fissureWorld(u0, (S._halfWAt(F, u0, 1) - S._halfWAt(F, u0, 0)) / 2, zi, w);
  window.__bench.place(w.x + F.dz * 9, w.z - F.dx * 9, 0, zi);
  window.__bench.step(30, null, { render: true });
  window.player.pos.set(w.x, lip - 1, w.z); window.player.vel.set(0, -2, 0); window.player.grounded = false;
  // the drawn crack triangles in a column round the fall (the lens trails within ~10 u)
  const tris = [];
  const take = (A, I) => { for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const cx = (A[a] + A[b] + A[c]) / 3, cz = (A[a + 2] + A[b + 2] + A[c + 2]) / 3;
    if (Math.hypot(cx - w.x, cz - w.z) < 16) tris.push(A[a], A[a + 1], A[a + 2], A[b], A[b + 1], A[b + 2], A[c], A[c + 1], A[c + 2]); } };
  const P = T.fissurePatchGeo(zi); for (const I of P.index) take(P.pos.array, I);
  const Wg = T.fissureWallGeo ? T.fissureWallGeo(zi) : null; if (Wg) take(Wg.pos.array, Wg.index);
  const n = tris.length / 9, cam = window.camera;
  let minD = 1e9, at = null, frames = 0, startZone = window.zone, closeFrames = 0, samples = 0;
  window.keys.KeyC = true;
  try {
    for (let f = 0; f < (o.frames || 600) && window.zone === startZone && window.gameState === 'play'; f += 3) {
      window.__bench.step(3); frames = f; samples++;
      const p = cam.position; let fMin = 1e9;
      for (let k = 0; k < n; k++) {
        const o9 = k * 9;
        const mx = Math.min(tris[o9], tris[o9 + 3], tris[o9 + 6]) - 1, Mx = Math.max(tris[o9], tris[o9 + 3], tris[o9 + 6]) + 1;
        if (p.x < mx || p.x > Mx) continue;
        const mz = Math.min(tris[o9 + 2], tris[o9 + 5], tris[o9 + 8]) - 1, Mz = Math.max(tris[o9 + 2], tris[o9 + 5], tris[o9 + 8]) + 1;
        if (p.z < mz || p.z > Mz) continue;
        const my = Math.min(tris[o9 + 1], tris[o9 + 4], tris[o9 + 7]) - 1, My = Math.max(tris[o9 + 1], tris[o9 + 4], tris[o9 + 7]) + 1;
        if (p.y < my || p.y > My) continue;
        _a.set(tris[o9], tris[o9 + 1], tris[o9 + 2]); _b.set(tris[o9 + 3], tris[o9 + 4], tris[o9 + 5]); _c.set(tris[o9 + 6], tris[o9 + 7], tris[o9 + 8]);
        _tri.set(_a, _b, _c); _tri.closestPointToPoint(p, _q);
        const d = _q.distanceTo(p);
        if (d < fMin) fMin = d;
        if (d < minD) {
          // which side: the triangle's front (its winding faces the water) or behind it, in the rock
          _b.sub(_a); _c.sub(_a); _b.cross(_c);
          const side = _b.dot(_q.set(p.x - _q.x, p.y - _q.y, p.z - _q.z)) >= 0 ? 1 : -1;
          minD = d; at = { f, side, cam: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)], below: +(lip - p.y).toFixed(1) };
        }
      }
      if (fMin < cam.near) closeFrames++;
    }
  } finally { window.keys.KeyC = false; }
  return { zi, tris: n, frames, samples, closeFrames, endY: +window.player.pos.y.toFixed(1), zoneEnd: window.zone, near: cam.near, minD: +minD.toFixed(3), at };
}

// ---- the lens on the REAL descent (final fix wave, I1) ----------------------------------------
// descentLens(zi, { u, yaw, pitch, yawRate, frames, every }): Sal stood on the SHUT jam at crack
// station u (the middle of the crack there) facing `yaw` (radians, RELATIVE TO THE CRACK'S BEARING:
// 0 = along +u, PI/2 = across toward +v) with the look pitched `pitch`, the follow camera settled
// behind him (3 s), then the fissure opened under him (setOpen 1) and he sinks through the throat, C
// held (vent), to just above the zone-change plane (zone 2: the ending's), turning `yawRate` rad/s
// all the way down if given (a player looking round as he falls). Every
// `every` frames the lens (the real follow camera, nothing pinned) is tested against every DRAWN crack
// triangle within 16 u of the station (the patch, the throat walls, the slabs):
//   close  - the nearest drawn triangle is nearer than the camera's near plane (0.1 u): the frame clips
//   inside - the lens sits BEHIND the nearest drawn triangle (within 3 u; its winding faces the water):
//            the frame shows the void behind the rock; and `hfIn` (reported) = below the heightfield
//            Sal collides with at its own (x, z) by more than 0.1 u
//   offFrame - Sal (his chest) projects outside 85% of the frame (or behind the lens): the lens kept
//            off the rock must still show him (ndcLow/ndcHigh/ndcSide: the extremes)
// Only frames with the pivot below the lip count (`samples`); `minD` is the nearest approach.
export async function descentLens(zi, o = {}) {
  const F = S.FISSURE[zi], lip = S.lipMeanY(zi, T.terrainH), w = { x: 0, z: 0 };
  window.setState('play'); window.__helm = true; window.survival.hose = 5000; window.__camPin = null;
  window.survival.fuel = 1; window.survival.oxygen = 1;   // (seventy cases run the pump dry: he drowns on the jam)
  window.gotoZone(zi); if (window.lev) window.lev.calmed = false; window.__fissure.setOpen(zi, 0);
  const u0 = o.u == null ? -4 : o.u, every = o.every || 2;
  S.fissureWorld(u0, (S._halfWAt(F, u0, 1) - S._halfWAt(F, u0, 0)) / 2, zi, w);
  // he faces (sin yaw, cos yaw) = cos(a) (dx, dz) + sin(a) (-dz, dx): a = 0 along +u, PI/2 across toward +v
  const a = o.yaw || 0, fx = Math.cos(a) * F.dx - Math.sin(a) * F.dz, fz = Math.cos(a) * F.dz + Math.sin(a) * F.dx;
  window.__bench.place(w.x, w.z, Math.atan2(fx, fz), zi);
  const jam = T.shutFloorY(w.x, w.z, zi);
  window.player.pos.y = jam + 1.35; window.player.vel.set(0, 0, 0); window.player.pitch = o.pitch || 0;
  window.__bench.step(180, null, { render: !!o.render });                     // the lens settles behind him on the jam
  const tris = [];
  const take = (A, I) => { for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const cx = (A[a] + A[b] + A[c]) / 3, cz = (A[a + 2] + A[b + 2] + A[c + 2]) / 3;
    if (Math.hypot(cx - w.x, cz - w.z) < 16) tris.push(A[a], A[a + 1], A[a + 2], A[b], A[b + 1], A[b + 2], A[c], A[c + 1], A[c + 2]); } };
  const P = T.fissurePatchGeo(zi); for (const I of P.index) take(P.pos.array, I);
  const Wg = T.fissureWallOn && T.fissureWallOn() ? T.fissureWallGeo(zi) : null; if (Wg) take(Wg.pos.array, Wg.index);
  const n = tris.length / 9, cam = window.camera;
  let minD = 1e9, at = null, samples = 0, close = 0, inside = 0, hfIn = 0, worstIn = null, lensBelowPivotMax = -1e9, boomMin = 1e9, boomMax = 0, fallV = 0, ndcLow = 9, ndcHigh = -9, ndcSide = 0, offFrame = 0;
  const startZone = window.zone, shots = o.shots || [], got = [];
  // the measure ends just above the zone-change plane (zones 0/1) or the ending's (zone 2: the
  // cinematic takes the lens there)
  const C = await import('/src/config.js'), trig = zi < 2 ? C.zoneBottom(zi) - C.ZONE_GAP * 0.55 : C.zoneBottom(2) - 70;
  window.__fissure.setOpen(zi, 1);
  window.keys.KeyC = true;
  try {
    for (let f = 0; f < (o.frames || 1500) && window.zone === startZone && window.gameState === 'play' && window.player.pos.y > trig + 1.5; f += every) {
      if (o.yawRate) window.__bench.step(every, () => { window.player.yaw += o.yawRate / 60; }, { render: !!o.render });
      else window.__bench.step(every, null, { render: !!o.render });
      const p = cam.position, pv = window.player.pos;
      if (shots.length && got.length < shots.length && lip - pv.y >= shots[got.length]) {
        got.push({ below: shots[got.length], png: window.__bench.png(await window.__bench.capture({ frames: 6 }), 0.5) });
      }
      if (pv.y > lip - 1) continue;                                         // the pivot is not in the throat yet
      samples++;
      boomMin = Math.min(boomMin, p.distanceTo(pv)); boomMax = Math.max(boomMax, p.distanceTo(pv)); fallV = Math.max(fallV, -window.player.vel.y);
      lensBelowPivotMax = Math.max(lensBelowPivotMax, pv.y - p.y);
      if (p.y < T.terrainUnderH(p.x, p.z, zi) - 0.1) hfIn++;
      // where Sal sits in the frame (his chest: 0.5 u under the eye): NDC, -1 = the bottom edge
      cam.updateMatrixWorld(); _q.set(pv.x, pv.y - 0.5, pv.z).project(cam);
      if (_q.z < 1) { ndcLow = Math.min(ndcLow, _q.y); ndcHigh = Math.max(ndcHigh, _q.y); ndcSide = Math.max(ndcSide, Math.abs(_q.x)); if (Math.abs(_q.y) > 0.85 || Math.abs(_q.x) > 0.85) offFrame++; }
      else offFrame++;
      let fMin = 1e9, fSide = 1;
      for (let k = 0; k < n; k++) {
        const o9 = k * 9;
        const mx = Math.min(tris[o9], tris[o9 + 3], tris[o9 + 6]) - 3, Mx = Math.max(tris[o9], tris[o9 + 3], tris[o9 + 6]) + 3;
        if (p.x < mx || p.x > Mx) continue;
        const mz = Math.min(tris[o9 + 2], tris[o9 + 5], tris[o9 + 8]) - 3, Mz = Math.max(tris[o9 + 2], tris[o9 + 5], tris[o9 + 8]) + 3;
        if (p.z < mz || p.z > Mz) continue;
        const my = Math.min(tris[o9 + 1], tris[o9 + 4], tris[o9 + 7]) - 3, My = Math.max(tris[o9 + 1], tris[o9 + 4], tris[o9 + 7]) + 3;
        if (p.y < my || p.y > My) continue;
        _a.set(tris[o9], tris[o9 + 1], tris[o9 + 2]); _b.set(tris[o9 + 3], tris[o9 + 4], tris[o9 + 5]); _c.set(tris[o9 + 6], tris[o9 + 7], tris[o9 + 8]);
        _tri.set(_a, _b, _c); _tri.closestPointToPoint(p, _q);
        const d = _q.distanceTo(p);
        if (d < fMin) {
          fMin = d;
          _b.sub(_a); _c.sub(_a); _b.cross(_c);
          fSide = _b.dot(_q.set(p.x - _q.x, p.y - _q.y, p.z - _q.z)) >= 0 ? 1 : -1;
        }
      }
      if (fMin < cam.near) close++;
      if (fSide < 0 && fMin < 3) { inside++; if (!worstIn || fMin > worstIn.d) worstIn = { f, d: +fMin.toFixed(2), below: +(lip - pv.y).toFixed(1) }; }
      if (fMin < minD) { minD = fMin; at = { f, side: fSide, cam: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)], below: +(lip - pv.y).toFixed(1), boom: +p.distanceTo(pv).toFixed(2) }; }
    }
  } finally { window.keys.KeyC = false; }
  return { zi, u: u0, yaw: +(o.yaw || 0).toFixed(3), pitch: o.pitch || 0, yawRate: o.yawRate || 0, tris: n, samples, endBelowLip: +(lip - window.player.pos.y).toFixed(1), trigBelowLip: +(lip - trig).toFixed(1), close, inside, hfIn, worstIn, zoneEnd: window.zone, near: cam.near, minD: +minD.toFixed(3), at,
    ndcLow: +ndcLow.toFixed(2), ndcHigh: +ndcHigh.toFixed(2), ndcSide: +ndcSide.toFixed(2), offFrame,
    boomMin: +boomMin.toFixed(2), boomMax: +boomMax.toFixed(2), fallV: +fallV.toFixed(1), lensBelowPivotMax: +lensBelowPivotMax.toFixed(2), shots: got };
}
