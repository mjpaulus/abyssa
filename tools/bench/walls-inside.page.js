// THE THROAT WALLS FROM INSIDE (fissure Task 5b): the page half of fissure-probe.mjs `walls-inside`.
// Imported by the PAGE (served from the worktree root) under ?bench&playtest:
//   const W = await import('/tools/bench/walls-inside.page.js');
// Runs on any build: where terrain.js has no throat wall (fissureWallGeo, Task 5b) the drawn wall is
// the fissure patch's own triangles inside the lip (b511877 and before), so the same probe gives the
// RED there and the GREEN after.
//   bound(zi)  - the DRAWN crack surfaces against the heightfield Sal stands on (terrainUnderH): a
//                signed distance per sample, + = the drawn rock stands out in the water (lens and
//                body could sit inside it), - = the drawn rock lies back inside the collision rock.
//                Measured as the nearer of the vertical gap and the horizontal gap across the crack
//                (on a 15:1 face a vertical error means nothing); every vertex and every centroid.
//   rays(zi)   - rays from the throat's axis to both walls (several depths, along the crack, three
//                elevations): the drawn hit (THREE.Raycaster on every drawn crack mesh) against the
//                heightfield hit (a CPU march). A drawn miss where the heightfield is hit = a gap you
//                see water through; the hit distances bound what the lens sees.
//   look(zi)   - settled frames from inside the throat looking up along it (open): the FACET energy
//                of a view-space normal pass of the drawn crack meshes (the teeth: sawtooth facets
//                flip the normal every half unit), and the settled full chain's luminance band-pass
//                energy along the wall's vertical axis (the detail kept; and the chevrons' signature).
const S = await import('/src/world/fissureShape.js');
const T = await import('/src/world/terrain.js');
const THREE = await import('three');
const { renderer, scene, camera } = await import('/src/core.js');

// every drawn crack triangle: { pos (Float32Array), tris: Int32Array of vertex triples, mesh list }
function drawn(zi) {
  const P = T.fissurePatchGeo(zi), A = P.pos.array, tris = [];
  const wall = T.fissureWallGeo ? T.fissureWallGeo(zi) : null;
  const fdv = i => S.fissureDist(A[i * 3], A[i * 3 + 2], zi);
  const surf = [];
  // the patch: its own triangles (slab bodies excluded: they are rock over the void by design,
  // probed by `slabs`); with a throat wall only the kept ones (the index the patch draws)
  for (const I of P.index) for (let t = 0; t < I.length; t += 3) {
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
// signed distance of a drawn point to the heightfield: + in the water, - in the rock
function sdist(x, y, z, zi, F) {
  const h = T.terrainUnderH(x, z, zi), dv = y - h, nx = -F.dz, nz = F.dx;
  let dh = 1e9;
  for (let t = 0.02; t <= 2.5 && dh > 1e8; t += 0.02) for (const sg of [-1, 1]) {
    const h2 = T.terrainUnderH(x + nx * t * sg, z + nz * t * sg, zi);
    if ((h2 - y) * (h - y) <= 0) { dh = t; break; }
  }
  return Math.sign(dv) * Math.min(Math.abs(dv), dh);
}
export function bound(zi) {
  const F = S.FISSURE[zi], out = {};
  for (const s of drawn(zi)) {
    const A = s.A, I = s.tris, n = I.length / 3;
    const step = Math.max(1, Math.floor(n / 12000));
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
  let n = 0, gaps = 0, protrude = 0, worstGap = 0, worstIn = 0, worstOut = 0; const bad = [];
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
          rc.set(org, dir);
          const hit = rc.intersectObjects(meshes, false)[0];
          const td = hit ? hit.distance : 1e9;
          n++;
          // (a drawn slab body hit first is the slab, not the wall: the station filter keeps rays off them)
          const d = td - th;
          if (d > 1.6) { gaps++; if (bad.length < 6) bad.push({ u: +u.toFixed(1), dep, sg, el, al, th: +th.toFixed(2), td: hit ? +td.toFixed(2) : null }); }
          if (d < -0.3) protrude++;
          if (d > worstIn && hit) worstIn = d;
          if (!hit) worstGap = Math.max(worstGap, 1);
          if (-d > worstOut) worstOut = -d;
        }
      }
    }
  } finally { meshes.forEach((m, i) => { m.visible = vis[i]; }); }
  return { rays: n, gaps, protrude, hitBehindMax: +worstIn.toFixed(3), hitInFrontMax: +worstOut.toFixed(3), missed: worstGap, bad };
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
  window.__camPin = null;
  return { zi, open: pin.open, rockPx: fn, facet: +(fe / Math.max(1, fn)).toFixed(3), bandV: +(ev / Math.max(1, en)).toFixed(4), bandA: +(ea / Math.max(1, en)).toFixed(4),
    localContrast: +(lc / Math.max(1, en)).toFixed(4), meanL: +(mean / Math.max(1, en)).toFixed(2), cap, normals: N, W, H };
}
// PNG of a normal pass (for eyes)
export function normalsPng(N, W, H, s = 0.5) {
  return window.__bench.png({ w: W, h: H, px: N }, s);
}
