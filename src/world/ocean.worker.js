// THE OCEAN'S CPU HEIGHT FIELD — a module worker. OWNED BY: water/atmosphere agent.
//
// The GPU draws the sea from three FFT cascades; the raft, Sal, the tether, bubbles and
// the camera's air/water answer need that SAME height on the CPU. A GPU readback was
// built first and measured: on this platform (ANGLE/Metal) getBufferSubData of even a
// fence-signalled 24 KB PBO costs ~7.5 ms of main-thread time a frame (a synchronous
// round trip behind the GPU process) and halved the frame rate. So the CPU recomputes
// the field itself, off the main thread:
//   * cascades 0 and 1 (287 u and 67 u patches) carry every wave longer than 2.85 u --
//     all the swell and the whole wind-sea peak. Their bands sit inside |n|,|m| <= 24 of
//     the GPU's 256-grid, so a 128-point inverse FFT of the identical bins (same Gaussian
//     draws, same spectrum, same quantised omegas, same chop) is EXACTLY those cascades,
//     sampled at 2.24 u and 0.52 u and interpolated bicubically on the main thread;
//   * cascade 2 (17 u: the short chop, a few centimetres) is the only part missing.
// The main thread asks for fields ahead of its own clock and interpolates between the
// two that bracket "now", so the answer is never extrapolated.
import { CASCADE_L, K_EDGE, T_REP, OCEAN_N, binAmp, omegaQ, fillNoise } from './ocean.spectrum.js';

const M = 128, LOGM = 7, R = 32;           // grid points per patch, bins kept per side
const NB = (2 * R + 1) * (2 * R + 1);
const N = OCEAN_N;
const NOISE = fillNoise(new Float32Array(N * 3 * N * 4));

// Per cascade, per bin: kx, kz, |k|, omega, h0P (re, im), conj partner h0M (re, im).
const bins = [0, 1].map(() => ({ kx: new Float64Array(NB), kz: new Float64Array(NB), kl: new Float64Array(NB),
  w: new Float64Array(NB), pr: new Float64Array(NB), pi: new Float64Array(NB), mr: new Float64Array(NB), mi: new Float64Array(NB),
  idx: new Int32Array(NB), n: 0 }));
let SP = null, chop = 1;

function buildBins() {
  for (let c = 0; c < 2; c++) {
    const L = CASCADE_L[c], B = bins[c];
    let q = 0;
    for (let mm = -R; mm <= R; mm++) for (let nn = -R; nn <= R; nn++) {
      const kx = nn * 2 * Math.PI / L, kz = mm * 2 * Math.PI / L, kl = Math.hypot(kx, kz);
      if (kl < K_EDGE[c] || kl >= K_EDGE[c + 1] || kl < 1e-6) continue;
      const n = (nn + N) % N, m = (mm + N) % N, ni = (N - n) % N, mi = (N - m) % N;
      const iP = ((c * N + m) * N + n) * 4, iM = ((c * N + mi) * N + ni) * 4;
      const aP = binAmp(SP, kx, kz, L), aM = binAmp(SP, -kx, -kz, L);
      B.kx[q] = kx; B.kz[q] = kz; B.kl[q] = kl; B.w[q] = omegaQ(kl);
      B.pr[q] = NOISE[iP] * aP; B.pi[q] = NOISE[iP + 1] * aP;
      B.mr[q] = NOISE[iM] * aM; B.mi[q] = NOISE[iM + 1] * aM;
      B.idx[q] = ((mm + M) % M) * M + ((nn + M) % M);
      q++;
    }
    B.n = q;
  }
}

// In-place inverse FFT (sign +) along rows then columns of an M x M complex grid.
const rev = new Int32Array(M), twc = new Float64Array(M / 2), tws = new Float64Array(M / 2);
for (let i = 0; i < M; i++) { let r = 0; for (let b = 0; b < LOGM; b++) r |= ((i >> b) & 1) << (LOGM - 1 - b); rev[i] = r; }
for (let i = 0; i < M / 2; i++) { twc[i] = Math.cos(2 * Math.PI * i / M); tws[i] = Math.sin(2 * Math.PI * i / M); }
function fft1(re, im, off, stride) {
  for (let i = 0; i < M; i++) {
    const j = rev[i];
    if (j > i) {
      const a = off + i * stride, b = off + j * stride;
      let t = re[a]; re[a] = re[b]; re[b] = t;
      t = im[a]; im[a] = im[b]; im[b] = t;
    }
  }
  for (let size = 2; size <= M; size <<= 1) {
    const half = size >> 1, step = M / size;
    for (let s = 0; s < M; s += size) for (let k = 0; k < half; k++) {
      const a = off + (s + k) * stride, b = a + half * stride;
      const c = twc[k * step], sn = tws[k * step];
      const xr = re[b] * c - im[b] * sn, xi = re[b] * sn + im[b] * c;
      re[b] = re[a] - xr; im[b] = im[a] - xi;
      re[a] += xr; im[a] += xi;
    }
  }
}
function ifft2(re, im) {
  for (let r = 0; r < M; r++) fft1(re, im, r * M, 1);
  for (let c = 0; c < M; c++) fft1(re, im, c, M);
}

const Are = [new Float64Array(M * M), new Float64Array(M * M)], Aim = [new Float64Array(M * M), new Float64Array(M * M)];
const Bre = new Float64Array(M * M), Bim = new Float64Array(M * M);

function field(t, out0, out1) {
  const tw = t % T_REP;
  Bre.fill(0); Bim.fill(0);
  for (let c = 0; c < 2; c++) {
    const re = Are[c], im = Aim[c], B = bins[c];
    re.fill(0); im.fill(0);
    for (let q = 0; q < B.n; q++) {
      const ph = B.w[q] * tw, co = Math.cos(ph), si = Math.sin(ph);
      // h = h0P e^{-i ph} + conj(h0M) e^{+i ph}
      const hr = B.pr[q] * co + B.pi[q] * si + B.mr[q] * co + B.mi[q] * si;
      const hi = B.pi[q] * co - B.pr[q] * si - B.mi[q] * co + B.mr[q] * si;
      const ux = B.kx[q] / B.kl[q], uz = B.kz[q] / B.kl[q];
      // Dx = i ux h = (-ux hi, ux hr); packed A = h + i Dx = (hr - ux hr, hi - ux hi)
      const dxr = -ux * hi, dxi = ux * hr;
      const dzr = -uz * hi, dzi = uz * hr;
      const i = B.idx[q];
      re[i] += hr - dxi; im[i] += hi + dxr;
      // B packs cascade 0's Dz as the real field and cascade 1's as the imaginary one.
      if (c === 0) { Bre[i] += dzr; Bim[i] += dzi; } else { Bre[i] -= dzi; Bim[i] += dzr; }
    }
    ifft2(re, im);
  }
  ifft2(Bre, Bim);
  for (let p = 0; p < M * M; p++) {
    out0[p * 3] = Are[0][p]; out0[p * 3 + 1] = Aim[0][p] * chop; out0[p * 3 + 2] = Bre[p] * chop;
    out1[p * 3] = Are[1][p]; out1[p * 3 + 1] = Aim[1][p] * chop; out1[p * 3 + 2] = Bim[p] * chop;
  }
}

self.onmessage = (e) => {
  const d = e.data;
  if (d.type === 'params') { SP = d.SP; chop = d.chop; buildBins(); return; }
  if (d.type === 'req') {
    if (!SP) { self.postMessage({ type: 'none', b0: d.b0, b1: d.b1 }, [d.b0.buffer, d.b1.buffer]); return; }
    field(d.t, d.b0, d.b1);
    self.postMessage({ type: 'field', t: d.t, gen: d.gen, b0: d.b0, b1: d.b1 }, [d.b0.buffer, d.b1.buffer]);
  }
};
