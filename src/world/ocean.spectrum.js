// THE OCEAN'S SPECTRUM, CPU side — shared by world/ocean.js (main thread: stats, the
// analytic fallback, waveLow) and world/ocean.worker.js (the CPU height field). Pure
// maths, no THREE, no DOM, so it loads in a module worker. The GLSL in ocean.js is the
// line-for-line twin of specDensity below; change one, change both.
// Units: k per METRE inside the spectrum; the callers convert (1 world unit = 3 m).
export const GRAV = 9.81;
export const OCEAN_N = 256;
export const CASCADE_L = [287.0, 67.0, 17.0];
// Band edges in rad per world unit: a cascade keeps the waves with at least six
// wavelengths across the NEXT patch; disjoint, so no wavenumber is counted twice.
export const K_EDGE = [0.0, 6 * 2 * Math.PI / CASCADE_L[1], 6 * 2 * Math.PI / CASCADE_L[2], 1e9];
// Frequency quantisation: the field repeats every T_REP seconds, so the phase argument
// stays small however long the game has run.
export const T_REP = 400.0, W0 = 2 * Math.PI / T_REP;

function lgammaS(x) {
  return (x - 0.5) * Math.log(x) - x + 0.91893853 + 1 / (12 * x) - 1 / (360 * x * x * x);
}
function spreadD(cosT, s) {
  const c2 = Math.min(1, Math.max(0, 0.5 + 0.5 * cosT));
  const lq = 2 * lgammaS(s + 1) - lgammaS(2 * s + 1) + (2 * s - 1) * 0.69314718 - 1.14472989;
  return Math.exp(lq + s * Math.log(Math.max(c2, 1e-12)));
}
function peakR(w, wp) {
  const sg = w <= wp ? 0.07 : 0.09, x = (w - wp) / (sg * wp);
  return Math.exp(-0.5 * x * x);
}
// SP = { A: [U, fetch, gamma, ampK], B: [wdx, wdz, sdx, sdz], C: [swellHs, swellWp,
// swellGamma, swellSpread], D: [spreadK, shortCut, 0, 0] } -- see ocean.js setSeaState.
// Omnidirectional S(w) in m^2 s, wind sea + swell.
export function specW(SP, w) {
  const U = Math.max(SP.A[0], 0.5), F = SP.A[1], gam = SP.A[2];
  const alpha = 0.076 * Math.pow(U * U / (F * GRAV), 0.22);
  const wp = 22 * Math.pow(GRAV * GRAV / (U * F), 1 / 3);
  const r = wp / w, r2 = r * r;
  let S = alpha * GRAV * GRAV / w ** 5 * Math.exp(-1.25 * r2 * r2) * Math.pow(gam, peakR(w, wp));
  const Hs = SP.C[0], wps = SP.C[1], gs = SP.C[2];
  if (Hs > 1e-3) {
    const sp = wps / w, sp2 = sp * sp;
    S += 0.3125 * Hs * Hs * wps ** 4 / w ** 5 * Math.exp(-1.25 * sp2 * sp2) * Math.pow(gs, peakR(w, wps)) * (1 - 0.287 * Math.log(gs));
  }
  const k = w * w / GRAV;
  return S * Math.exp(-k * k * SP.D[1] * SP.D[1]) * SP.A[3];
}
// Directional variance density at (kx, kz) per metre.
export function specDensity(SP, kx, kz) {
  const k = Math.hypot(kx, kz);
  if (k < 1e-6) return 0;
  const w = Math.sqrt(GRAV * k);
  const U = Math.max(SP.A[0], 0.5), F = SP.A[1], gam = SP.A[2], ampK = SP.A[3];
  const alpha = 0.076 * Math.pow(U * U / (F * GRAV), 0.22);
  const wp = 22 * Math.pow(GRAV * GRAV / (U * F), 1 / 3);
  const r = wp / w, r2 = r * r;
  const Sw = alpha * GRAV * GRAV / w ** 5 * Math.exp(-1.25 * r2 * r2) * Math.pow(gam, peakR(w, wp));
  const wr = w / wp;
  let sW = (wr < 1 ? 9 * wr ** 4 : 9 * wr ** -2.5) * SP.D[0];
  sW = Math.min(40, Math.max(0.6, sW));
  const dx = kx / k, dz = kz / k;
  const Dw = spreadD(dx * SP.B[0] + dz * SP.B[1], sW);
  let Ss = 0;
  const Hs = SP.C[0], wps = SP.C[1], gs = SP.C[2], ss = SP.C[3];
  if (Hs > 1e-3) {
    const sp = wps / w, sp2 = sp * sp;
    Ss = 0.3125 * Hs * Hs * wps ** 4 / w ** 5 * Math.exp(-1.25 * sp2 * sp2) * Math.pow(gs, peakR(w, wps)) * (1 - 0.287 * Math.log(gs));
    Ss *= spreadD(dx * SP.B[2] + dz * SP.B[3], ss);
  }
  const E = (Sw * Dw + Ss) * (GRAV / (2 * w)) / k;
  return E * Math.exp(-k * k * SP.D[1] * SP.D[1]) * ampK;
}
// Bin amplitude scale for cascade patch L (world units): E|xi|^2 = 2 and every wave
// lands in its bin AND the conjugate bin, so a bin carries a quarter of E dk^2 per
// draw. Returns metres -> units already applied.
export function binAmp(SP, kxU, kzU, L) {
  const dk = 2 * Math.PI / (L * 3);
  return Math.sqrt(0.25 * specDensity(SP, kxU / 3, kzU / 3)) * dk / 3;
}
export function omegaQ(kU) {
  const w = Math.sqrt(GRAV * kU / 3);
  return Math.floor(w / W0) * W0;
}
// The fixed Gaussian draws, generated in code (mulberry32 + Box-Muller). The texture the
// GPU evolves and the worker's CPU field read the SAME numbers: index (row * N + col) * 4,
// rows stacked per cascade (cascade c occupies rows c*N .. c*N + N - 1).
export function fillNoise(out) {
  let s = 0x0CEA11 >>> 0;
  const rnd = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const n = out.length >> 2;
  for (let i = 0; i < n; i++) {
    const u1 = Math.max(rnd(), 1e-9), u2 = rnd(), u3 = Math.max(rnd(), 1e-9), u4 = rnd();
    const r1 = Math.sqrt(-2 * Math.log(u1)), r2 = Math.sqrt(-2 * Math.log(u3));
    out[i * 4] = r1 * Math.cos(2 * Math.PI * u2);
    out[i * 4 + 1] = r1 * Math.sin(2 * Math.PI * u2);
    out[i * 4 + 2] = r2 * Math.cos(2 * Math.PI * u4);
    out[i * 4 + 3] = r2 * Math.sin(2 * Math.PI * u4);
  }
  return out;
}
