// The drawn coarse terrain mesh, as terrain.js builds it: SEG x SEG cells on the graded axis axisMap, each cell split
// (a, b, d) / (b, c, d) exactly as terrain.js coarseLerp interpolates it. S6 compares this with terrainH.
//
// LAYOUT, CONFIRMED against terrain.js (2026-10-13, Task 1): no flip, no mirror.
//  - fillTerrain writes vertex i = j (SEG+1) + k at (x, y, z) = (AX[k], terrainH(AX[k], AX[j]), AX[j]): the z loop
//    (j) is outer, the x loop (k) inner, and every PlaneGeometry position is rewritten in world space (the geometry's
//    rotateX(-PI/2) runs before the rewrite, so it moves only the discarded positions; the mesh sits at the origin).
//  - The index is PlaneGeometry's own topology (buildFissurePatch's "cut" index repeats it): a = k + n j,
//    b = k + n (j+1), c = k+1 + n (j+1), d = k+1 + n j, faces (a, b, d) and (b, c, d), n = SEG + 1.
//  - coarseLerp reads the same four corners with the same weights: (a, b, d) where fx + fz <= 1, else (b, c, d).
//  So vertex k + (SEG+1) j sits at (AX[k], AX[j]) and meshH below interpolates the drawn mesh as is.
// Two limits, neither material to S6's 0.3 u bar:
//  - the game keeps AX and the vertex heights in Float32Arrays; this uses float64. Measured over S6's domain (1 u
//    grid): |AX64 - AX32| <= 1.9e-5 u, |meshH64 - meshH32| <= 1.4e-5 u.
//  - the coarse mesh is the drawn floor only OUTSIDE the fissure patch: buildFissurePatch cuts a cell out of the index
//    when its centre has fd < PATCH_FD (17) + 0.6 x its diagonal. S6 samples fd >= 17, so a band a few u wide just
//    past fd 17 still lies in cut cells; there meshH is the coarse surface the 0.5 u patch replaced.
export function makeMesh(T) {
  const AX = Float64Array.from({ length: T.SEG + 1 }, (_, i) => T.axisMap((i / T.SEG) * 2 - 1));
  const ax = v => { let lo = 0, hi = T.SEG; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (AX[m] <= v) lo = m; else hi = m; } return lo; };
  function meshH(x, z, zi) {
    const k = ax(x), j = ax(z), fx = (x - AX[k]) / (AX[k + 1] - AX[k]), fz = (z - AX[j]) / (AX[j + 1] - AX[j]);
    const ha = T.terrainH(AX[k], AX[j], zi), hb = T.terrainH(AX[k], AX[j + 1], zi);
    const hc = T.terrainH(AX[k + 1], AX[j + 1], zi), hd = T.terrainH(AX[k + 1], AX[j], zi);
    return fx + fz <= 1 ? ha * (1 - fx - fz) + hb * fz + hd * fx : hb * (1 - fx) + hc * (fx + fz - 1) + hd * (1 - fz);
  }
  return { AX, meshH };
}
