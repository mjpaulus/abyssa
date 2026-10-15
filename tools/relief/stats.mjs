// Relief statistics over a 1 u height grid (x, z in [-300, 300]) — used by tools/relief/gates.mjs.
import { FISSURE, fissureDist, fissureWorld, _halfWAt, APRON } from '../../src/world/fissureShape.js';
import { zoneBottom, ZONE_GAP } from '../../src/config.js';
export const N = 601, X0 = -300;
export const idx = (i, j) => j * N + i;
const c01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

// the rim's onset radius per bearing (terrain.js heightAt: rin = rimIn + 46 c01(aR 0.62 + 0.5))
export function rinAt(T, zi, x, z) {
  const rr = Math.hypot(x, z), ir = 1 / Math.max(rr, 1e-3), cx = x * ir, cz = z * ir;
  const c2 = cx * cx - cz * cz, s2 = 2 * cx * cz, c3 = cx * c2 - cz * s2, s3 = cx * s2 + cz * c2;
  const c5 = c2 * c3 - s2 * s3, s5 = c2 * s3 + s2 * c3, K = T.RIM_KR[zi];
  const aR = K[0] * c2 + K[1] * s2 + K[2] * c3 + K[3] * s3 + K[4] * c5 + K[5] * s5;
  return T.ZP[zi].rimIn + 46 * c01(aR * 0.62 + 0.5);
}
// player.js's wall-foot clamp: lerp over the 128-bearing table
export function clampLim(tbl, x, z) {
  const th = Math.atan2(z, x), fi = ((th < 0 ? th + Math.PI * 2 : th) / (Math.PI * 2)) * 128, i = fi | 0;
  return tbl[i] + (tbl[i + 1] - tbl[i]) * (fi - i);
}
// per-sample classes: 0 outside, 1 THROAT (fd < 0), 2 APRON (0 <= fd < 14), 3 OPEN (fd >= 14, r < rin), 4 RIMFOOT (rin <= r < clamp)
export function classify(T, zi, clampTbl) {
  const C = new Uint8Array(N * N), FD = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = X0 + i, z = X0 + j, k = idx(i, j), r = Math.hypot(x, z);
    const fd = fissureDist(x, z, zi); FD[k] = fd;
    const lim = clampLim(clampTbl, x, z);
    if (fd < 0) C[k] = r < lim ? 1 : 0;
    else if (fd < APRON) C[k] = r < lim ? 2 : 0;
    else if (r < rinAt(T, zi, x, z) && r < lim) C[k] = 3;
    else if (r < lim) C[k] = 4;
  }
  return { C, FD };
}
export function pct(sorted, p) { if (!sorted.length) return NaN; const f = (sorted.length - 1) * p, i = Math.floor(f); return sorted[i] + (sorted[Math.min(sorted.length - 1, i + 1)] - sorted[i]) * (f - i); }
const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;
export function dist(vals) {
  const s = Float64Array.from(vals).sort();
  let m = 0; for (const v of s) m += v; m /= s.length || 1;
  let sd = 0; for (const v of s) sd += (v - m) * (v - m); sd = Math.sqrt(sd / (s.length || 1));
  return { n: s.length, min: r1(s[0]), p1: r1(pct(s, 0.01)), p5: r1(pct(s, 0.05)), p10: r1(pct(s, 0.1)), p25: r1(pct(s, 0.25)), p50: r1(pct(s, 0.5)), p75: r1(pct(s, 0.75)), p90: r1(pct(s, 0.9)), p95: r1(pct(s, 0.95)), p99: r1(pct(s, 0.99)), max: r1(s[s.length - 1]), mean: r1(m), sd: r2(sd), sorted: s };
}
const strip = d => { const o = { ...d }; delete o.sorted; return o; };
// sliding max-min over square windows (side w, odd) using only samples where mask is set; valid where coverage >= cov
function windowRelief(H, M, w, cov) {
  const h = (w - 1) / 2, mx = new Float64Array(N * N), mn = new Float64Array(N * N), tx = new Float64Array(N * N), tn = new Float64Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    let a = -Infinity, b = Infinity;
    for (let d = -h; d <= h; d++) { const ii = i + d; if (ii < 0 || ii >= N) continue; const k = idx(ii, j); if (!M[k]) continue; const v = H[k]; if (v > a) a = v; if (v < b) b = v; }
    tx[idx(i, j)] = a; tn[idx(i, j)] = b;
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    let a = -Infinity, b = Infinity;
    for (let d = -h; d <= h; d++) { const jj = j + d; if (jj < 0 || jj >= N) continue; const k = idx(i, jj); if (tx[k] > a) a = tx[k]; if (tn[k] < b) b = tn[k]; }
    mx[idx(i, j)] = a; mn[idx(i, j)] = b;
  }
  // coverage via a summed-area table
  const S = new Float64Array((N + 1) * (N + 1));
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) S[(j + 1) * (N + 1) + i + 1] = (M[idx(i, j)] ? 1 : 0) + S[j * (N + 1) + i + 1] + S[(j + 1) * (N + 1) + i] - S[j * (N + 1) + i];
  const out = [], map = new Float32Array(N * N).fill(NaN);
  for (let j = h; j < N - h; j++) for (let i = h; i < N - h; i++) {
    const k = idx(i, j); if (!M[k]) continue;
    const a0 = (j - h) * (N + 1) + (i - h), a1 = (j - h) * (N + 1) + (i + h + 1), b0 = (j + h + 1) * (N + 1) + (i - h), b1 = (j + h + 1) * (N + 1) + (i + h + 1);
    const c = (S[b1] - S[a1] - S[b0] + S[a0]) / (w * w);
    if (c < cov) continue;
    out.push(mx[k] - mn[k]); map[k] = mx[k] - mn[k];
  }
  return { d: out, map };
}
// slope on the 1 u grid (central difference, a 2 u baseline) and a regional slope over a 20 u baseline
function slopes(H, M) {
  const loc = [], reg = [];
  for (let j = 10; j < N - 10; j++) for (let i = 10; i < N - 10; i++) {
    const k = idx(i, j); if (!M[k]) continue;
    const gx = (H[idx(i + 1, j)] - H[idx(i - 1, j)]) / 2, gz = (H[idx(i, j + 1)] - H[idx(i, j - 1)]) / 2;
    loc.push(Math.atan(Math.hypot(gx, gz)) * 180 / Math.PI);
    const Gx = (H[idx(i + 10, j)] - H[idx(i - 10, j)]) / 20, Gz = (H[idx(i, j + 10)] - H[idx(i, j - 10)]) / 20;
    reg.push(Math.atan(Math.hypot(Gx, Gz)) * 180 / Math.PI);
  }
  return { loc, reg };
}
const frac = (arr, f) => { let n = 0; for (const v of arr) if (f(v)) n++; return arr.length ? n / arr.length : 0; };
// connected low regions (4-neighbour) of mask&(H <= thr)
function lowBlobs(H, M, thr, bed) {
  const seen = new Uint8Array(N * N), blobs = [];
  for (let k0 = 0; k0 < N * N; k0++) {
    if (seen[k0] || !M[k0] || H[k0] > thr) continue;
    const st = [k0]; seen[k0] = 1; let n = 0, sx = 0, sz = 0, mn = Infinity, mk = k0;
    while (st.length) {
      const k = st.pop(), i = k % N, j = (k / N) | 0; n++; sx += X0 + i; sz += X0 + j; if (H[k] < mn) { mn = H[k]; mk = k; }
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue; const kk = idx(ii, jj); if (!seen[kk] && M[kk] && H[kk] <= thr) { seen[kk] = 1; st.push(kk); } }
    }
    const cx = sx / n, cz = sz / n, mx = X0 + (mk % N), mz = X0 + ((mk / N) | 0);
    blobs.push({ area: n, cx: r1(cx), cz: r1(cz), min: r1(mn), at: [mx, mz], dBed: bed ? r1(Math.hypot(cx - bed.x, cz - bed.z)) : null, dBedMin: bed ? r1(Math.hypot(mx - bed.x, mz - bed.z)) : null });
  }
  blobs.sort((a, b) => b.area - a.area);
  return blobs;
}
export function analyze({ T, H, zi, clampTbl, bed, R, pump, terms, fdCls }) {
  const { C, FD } = fdCls || classify(T, zi, clampTbl);
  const OPEN = new Uint8Array(N * N), WALK = new Uint8Array(N * N);
  const vOpen = [], vWalk = [], vApron = [], vThroat = [], vRimFoot = [];
  for (let k = 0; k < N * N; k++) {
    const c = C[k];
    if (c === 3) { OPEN[k] = 1; vOpen.push(H[k]); }
    if (c >= 2) { WALK[k] = 1; vWalk.push(H[k]); }
    if (c === 2) vApron.push(H[k]); if (c === 1) vThroat.push(H[k]); if (c === 4) vRimFoot.push(H[k]);
  }
  const dOpen = dist(vOpen), dWalk = dist(vWalk);
  const med = dOpen.p50;
  const hist = {}; for (const v of vOpen) { const b = Math.floor(v / 2) * 2; hist[b] = (hist[b] || 0) + 1; }
  const near = { pm2: frac(vOpen, v => Math.abs(v - med) <= 2), pm5: frac(vOpen, v => Math.abs(v - med) <= 5), pm10: frac(vOpen, v => Math.abs(v - med) <= 10), pm20: frac(vOpen, v => Math.abs(v - med) <= 20) };
  const w20 = windowRelief(H, OPEN, 21, 0.9), w50 = windowRelief(H, OPEN, 51, 0.9), w100 = windowRelief(H, OPEN, 101, 0.8);
  const sl = slopes(H, OPEN);
  const deg = n => Math.acos(n) * 180 / Math.PI;
  const slope = {
    local: strip(dist(sl.loc)), regional20: strip(dist(sl.reg)),
    over: { g5: r3(frac(sl.loc, v => v > 5)), g10: r3(frac(sl.loc, v => v > 10)), g14_gait25pct: r3(frac(sl.loc, v => v > 14.04)), g20: r3(frac(sl.loc, v => v > 20)),
      kelp_ny084: r3(frac(sl.loc, v => v > deg(0.84))), turf_ny072: r3(frac(sl.loc, v => v > deg(0.72))), sal_ny062: r3(frac(sl.loc, v => v > deg(0.62))) },
    regOver: { g3: r3(frac(sl.reg, v => v > 3)), g5: r3(frac(sl.reg, v => v > 5)), g10: r3(frac(sl.reg, v => v > 10)) }
  };
  // radial profile (no throat, no apron): median/p10/p90 per 10 u ring
  const rings = [];
  for (let r0 = 0; r0 < 300; r0 += 10) {
    const v = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const k = idx(i, j); if (FD[k] < APRON) continue; const r = Math.hypot(X0 + i, X0 + j); if (r >= r0 && r < r0 + 10) v.push(H[k]); }
    const d = dist(v); rings.push({ r: r0 + 5, p10: d.p10, p50: d.p50, p90: d.p90 });
  }
  // low regions
  const lo1 = pct(dOpen.sorted, 0.01), lo5 = pct(dOpen.sorted, 0.05);
  const centroid = thr => { let n = 0, sx = 0, sz = 0; for (let k = 0; k < N * N; k++) if (OPEN[k] && H[k] <= thr) { n++; sx += X0 + (k % N); sz += X0 + ((k / N) | 0); } return { n, x: r1(sx / n), z: r1(sz / n), dBed: bed ? r1(Math.hypot(sx / n - bed.x, sz / n - bed.z)) : null }; };
  let mink = -1; for (let k = 0; k < N * N; k++) if (OPEN[k] && (mink < 0 || H[k] < H[mink])) mink = k;
  let minW = -1; for (let k = 0; k < N * N; k++) if (WALK[k] && (minW < 0 || H[k] < H[minW])) minW = k;
  const at = k => ({ x: X0 + (k % N), z: X0 + ((k / N) | 0), h: r1(H[k]), fd: r1(FD[k]), dBed: bed ? r1(Math.hypot(X0 + (k % N) - bed.x, X0 + ((k / N) | 0) - bed.z)) : null, r: r1(Math.hypot(X0 + (k % N), X0 + ((k / N) | 0))) });
  const low = { p1: r1(lo1), p5: r1(lo5), c1: centroid(lo1), c5: centroid(lo5), minOpen: at(mink), minWalk: at(minW), blobs1: lowBlobs(H, OPEN, lo1, bed).slice(0, 5), blobs5: lowBlobs(H, OPEN, lo5, bed).slice(0, 5) };
  // her bed
  let lair = null;
  if (bed) {
    const vb = [], vB = [], v40 = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const k = idx(i, j), d = Math.hypot(X0 + i - bed.x, X0 + j - bed.z); if (d <= R) vb.push(H[k]); if (d <= bed.r) vB.push(H[k]); if (d <= 45 && FD[k] >= APRON) v40.push(H[k]); }
    const db = dist(vb), dB = dist(vB), d40 = dist(v40);
    const rank = v => { const s = dOpen.sorted; let lo = 0, hi = s.length; while (lo < hi) { const m = (lo + hi) >> 1; if (s[m] < v) lo = m + 1; else hi = m; } return r3(lo / s.length); };
    lair = { x: r1(bed.x), z: r1(bed.z), underR: { mean: db.mean, min: db.min, max: db.max, relief: r1(db.max - db.min) }, underBED: { mean: dB.mean, min: dB.min, max: dB.max, relief: r1(dB.max - dB.min) },
      arena45: { min: d40.min, max: d40.max, p50: d40.p50 }, pctOfOpen: rank(db.mean), fdCentre: r1(fissureDist(bed.x, bed.z, zi)) };
  }
  // hose reach from the live pump, over the walkable floor (throat excluded)
  let hose = null;
  if (pump) {
    let mx = 0, mk = -1, beyond375 = 0, n = 0;
    for (let k = 0; k < N * N; k++) { if (!WALK[k]) continue; n++; const x = X0 + (k % N), z = X0 + ((k / N) | 0), d = Math.hypot(x - pump[0], H[k] - pump[1], z - pump[2]); if (d > mx) { mx = d; mk = k; } if (d > 375) beyond375++; }
    hose = { maxDist: r1(mx), at: at(mk), margin380: r1(380 - mx), margin375give: r1(375 - mx), fracBeyond375: r3(beyond375 / n) };
  }
  const trig = zoneBottom(zi) - ZONE_GAP * 0.55;
  const trigger = { plane: trig, minWalk: r1(H[minW]), margin: r1(H[minW] - trig) };
  // lip difference along the crack (both lips at each station, 0.25 u)
  const F = FISSURE[zi], wp = { x: 0, z: 0 };
  let ld = 0, ldMid = 0, ldAt = 0;
  for (let u = -F.halfLen; u <= F.halfLen + 1e-9; u += 0.25) {
    fissureWorld(u, _halfWAt(F, u, 1), zi, wp); const a = T.terrainH(wp.x, wp.z, zi);
    fissureWorld(u, -_halfWAt(F, u, 0), zi, wp); const b = T.terrainH(wp.x, wp.z, zi);
    const d = Math.abs(a - b); if (d > ld) { ld = d; ldAt = u; } if (Math.abs(u) <= 0.5 * F.halfLen && d > ldMid) ldMid = d;
  }
  // the berm: the lip band (0 <= fd < 3) over the ground just past the apron (20 <= fd < 35)
  let bl = 0, bn = 0, ol = 0, on = 0;
  for (let k = 0; k < N * N; k++) { const f = FD[k]; if (f >= 0 && f < 3) { bl += H[k]; bn++; } else if (f >= 20 && f < 35) { ol += H[k]; on++; } }
  const rp = { x: F.cx, z: F.cz };
  const crack = { lipDiffMax: r2(ld), lipDiffMaxAtU: ldAt, lipDiffMid: r2(ldMid), throatFloorAtRift: r1(T.terrainH(rp.x, rp.z, zi)), lipBand: r1(bl / bn), beyondApron: r1(ol / on), berm: r1(bl / bn - ol / on) };
  // clampR's per-bearing reference: terrainH at r 150 + 30
  const href = [];
  for (let b = 0; b < 128; b++) { const a = b / 128 * Math.PI * 2; href.push(T.terrainH(150 * Math.cos(a), 150 * Math.sin(a), zi) + 30); }
  const dh = dist(href);
  const clamp = clampTbl ? { min: r1(Math.min(...clampTbl)), max: r1(Math.max(...clampTbl)), hrefMin: dh.min, hrefMax: dh.max, hrefSd: dh.sd } : null;
  let termStats = null;
  if (terms) {
    termStats = {};
    for (const [name, arr] of Object.entries(terms)) { const v = []; for (let k = 0; k < N * N; k++) if (OPEN[k]) v.push(arr[k]); termStats[name] = strip(dist(v)); }
    const rk = terms.rk; let a = 0, b = 0, c = 0, n = 0; for (let k = 0; k < N * N; k++) if (OPEN[k]) { n++; if (rk[k] < 0.1) a++; if (rk[k] < 0.25) b++; if (rk[k] > 0.5) c++; }
    termStats.rkShare = { lt010: r3(a / n), lt025: r3(b / n), gt050: r3(c / n) };
    const pre = terms.pre; let kn = 0, mnp = Infinity; for (let k = 0; k < N * N; k++) if (OPEN[k]) { if (pre[k] < 4) kn++; if (pre[k] < mnp) mnp = pre[k]; }
    termStats.softFloor = { knee: zoneBottom(zi) + 4, fracOpenBelowKnee: r3(kn / n), minPreRel: r1(mnp), minPreAbs: r1(mnp + zoneBottom(zi)) };
  }
  return {
    zi, open: strip(dOpen), walk: strip(dWalk), apron: strip(dist(vApron)), throat: strip(dist(vThroat)), rimFoot: strip(dist(vRimFoot)),
    nearMedian: { pm2: r3(near.pm2), pm5: r3(near.pm5), pm10: r3(near.pm10), pm20: r3(near.pm20) },
    relief20: strip(dist(w20.d)), relief50: strip(dist(w50.d)), relief100: strip(dist(w100.d)), slope, rings, low, lair, hose, trigger, crack, clamp, terms: termStats,
    hist, _maps: { relief50: w50.map, C, FD }
  };
}
