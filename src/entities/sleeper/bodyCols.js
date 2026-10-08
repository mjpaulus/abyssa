// A SLEEPER'S BODY IS SOLID (brooderfix; Michael 2026-10-08: "Sal can walk through multiple
// parts of the crab and the camera is bad"). Velkath's live pose, published every frame as
// collision volumes that Sal is pushed out of (game.js, right after the sleeper moves) and
// the camera's boom is walked against:
//   * CAPSULES: every leg segment and every claw piece, tapered (ra at a, rb at b), fitted
//     once from the piece's own geometry (fitCapsule) and carried by its live matrix.
//   * THE SHELL: a polar height-band proxy of the carapace (shellProxy): per bearing, the
//     outer radius, and per radial ring the lowest and highest point of the shell there.
//     A point is inside her only where the shell actually IS at its height, so the space
//     under her belly, between her legs, stays open (the rite needs Sal UNDER her: her wards
//     are on the underside and the sand-plume rush runs in under her). Asleep, the bedded
//     ridge's rim is at the floor, so the same test makes the ridge solid.
// Pushes resolve on POSITION (out along the contact normal; on the ground only sideways, so
// the floor never fights it), and his velocity along the normal is made to match the
// part's own (a leg sweeping into him carries him, never tunnels; last frame's pose gives
// each part's velocity, and a fast part is tested along its sweep).
// Zero per-frame allocation: fixed typed pools, module scratch.
// OWNED BY: the sleepers (brooder.js publishes; game.js resolves and probes).

const MAXC = 48;
const CAP = new Float32Array(MAXC * 8), PREV = new Float32Array(MAXC * 8);   // ax ay az bx by bz ra rb
let nC = 0, nPrev = 0, prevOk = false;
const SHM = new Float32Array(16), SHP = new Float32Array(16), SHI = new Float32Array(16);
let shell = null, shellOk = false, shellPrevOk = false, shR = 1;
let bx = 0, by = 0, bz = 0, bRad = 0;           // a bounding sphere over everything published
let on = false;
export const BODY = { contacts: 0, push: 0, hitV: 0, under: false, last: '' };   // probe: this frame's resolve

export function bodyColsOn() { return on; }
export function clearBodyCols() { on = false; nC = nPrev = 0; prevOk = shellOk = shellPrevOk = false; shell = null; }

// ---- publishing (the sleeper's pose step) -----------------------------------------------
export function beginBodyCols() {
  PREV.set(CAP.subarray(0, nC * 8));
  nPrev = nC; prevOk = on && nC > 0;
  if (shellOk) { SHP.set(SHM); shellPrevOk = true; }
  nC = 0;
}
export function addCapsule(ax, ay, az, bx_, by_, bz_, ra, rb) {
  if (nC >= MAXC) return;
  const o = nC * 8;
  CAP[o] = ax; CAP[o + 1] = ay; CAP[o + 2] = az; CAP[o + 3] = bx_; CAP[o + 4] = by_; CAP[o + 5] = bz_; CAP[o + 6] = ra; CAP[o + 7] = rb;
  nC++;
}
// m: the body's matrixWorld elements (local shell units -> world, uniform scale R)
export function setShell(proxy, m, R) {
  shell = proxy; shR = R;
  if (!proxy) { shellOk = false; return; }
  SHM.set(m); shellOk = true;
  invertAffine(SHM, SHI, R);
}
export function endBodyCols(cx, cy, cz, rad) {
  bx = cx; by = cy; bz = cz; bRad = rad; on = true;
  if (nPrev !== nC) prevOk = false;               // a changed pool has no motion to read
}
// uniform-scale affine inverse: R^T / s^2 on the 3x3, then the translation
function invertAffine(m, o, s) {
  const k = 1 / (s * s);
  o[0] = m[0] * k; o[1] = m[4] * k; o[2] = m[8] * k; o[3] = 0;
  o[4] = m[1] * k; o[5] = m[5] * k; o[6] = m[9] * k; o[7] = 0;
  o[8] = m[2] * k; o[9] = m[6] * k; o[10] = m[10] * k; o[11] = 0;
  o[12] = -(o[0] * m[12] + o[4] * m[13] + o[8] * m[14]);
  o[13] = -(o[1] * m[12] + o[5] * m[13] + o[9] * m[14]);
  o[14] = -(o[2] * m[12] + o[6] * m[13] + o[10] * m[14]);
  o[15] = 1;
}

// ---- geometry fits (build time only: allocation is fine here) -----------------------------
// A tapered capsule along a limb piece's own X: the end centroids and radii of its first and
// last slices (a high percentile of the distance from the axis, so the knobs and spines
// count but a lone thorn does not).
export function fitCapsule(geo, pct = 0.85) {
  const P = geo.attributes.position.array;
  let x0 = 1e9, x1 = -1e9;
  for (let i = 0; i < P.length; i += 3) { if (P[i] < x0) x0 = P[i]; if (P[i] > x1) x1 = P[i]; }
  const span = Math.max(1e-4, x1 - x0), NB = 6;
  const cy = new Float64Array(NB), cz = new Float64Array(NB), cn = new Float64Array(NB);
  for (let i = 0; i < P.length; i += 3) {
    const b = Math.min(NB - 1, ((P[i] - x0) / span * NB) | 0);
    cy[b] += P[i + 1]; cz[b] += P[i + 2]; cn[b]++;
  }
  const ctr = b => [cn[b] ? cy[b] / cn[b] : 0, cn[b] ? cz[b] / cn[b] : 0];
  const [ay, az] = ctr(0), [by_, bz_] = ctr(NB - 1);
  const ax = x0, bxx = x1;
  // radius per half, from the axis line a->b
  const dx = bxx - ax, dy = by_ - ay, dz = bz_ - az, L2 = dx * dx + dy * dy + dz * dz;
  const r0 = [], r1 = [];
  for (let i = 0; i < P.length; i += 3) {
    const px = P[i] - ax, py = P[i + 1] - ay, pz = P[i + 2] - az;
    const t = Math.max(0, Math.min(1, (px * dx + py * dy + pz * dz) / L2));
    const ex = px - dx * t, ey = py - dy * t, ez = pz - dz * t;
    (t < 0.5 ? r0 : r1).push(Math.sqrt(ex * ex + ey * ey + ez * ez));
  }
  const q = a => { if (!a.length) return 0; a.sort((u, v) => u - v); return a[Math.min(a.length - 1, Math.floor(a.length * pct))]; };
  const ra = q(r0), rb = q(r1);
  // the caps are part of the capsule: pull the ends in by their radius (never past the middle)
  const len = Math.sqrt(L2), ka = Math.min(0.45, ra / len), kb = Math.min(0.45, rb / len);
  return { a: [ax + dx * ka, ay + dy * ka, az + dz * ka], b: [bxx - dx * kb, by_ - dy * kb, bz_ - dz * kb], ra, rb };
}

// The shell's polar height bands (body-local shell units): B bearings x K rings about the
// plan centre. rOut[b] = outermost radius on that bearing; lo/hi[b*K+k] = the lowest and
// highest shell point in ring k (ring k spans k/K..(k+1)/K of rOut). Empty cells borrow from
// their ring neighbours, then their bearing neighbours.
export function shellProxy(geos, B = 48, K = 8) {
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const g of geos) {
    const P = g.attributes.position.array;
    for (let i = 0; i < P.length; i += 3) { if (P[i] < x0) x0 = P[i]; if (P[i] > x1) x1 = P[i]; if (P[i + 2] < z0) z0 = P[i + 2]; if (P[i + 2] > z1) z1 = P[i + 2]; }
  }
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const rOut = new Float32Array(B), lo = new Float32Array(B * K).fill(NaN), hi = new Float32Array(B * K).fill(NaN);
  const bOf = (dx, dz) => { let a = Math.atan2(dz, dx) / (Math.PI * 2); if (a < 0) a += 1; return Math.min(B - 1, (a * B) | 0); };
  for (const g of geos) {
    const P = g.attributes.position.array;
    for (let i = 0; i < P.length; i += 3) {
      const dx = P[i] - cx, dz = P[i + 2] - cz, r = Math.hypot(dx, dz), b = bOf(dx, dz);
      if (r > rOut[b]) rOut[b] = r;
    }
  }
  for (let b = 0; b < B; b++) if (!(rOut[b] > 0)) rOut[b] = Math.max(rOut[(b + B - 1) % B], rOut[(b + 1) % B]);
  for (const g of geos) {
    const P = g.attributes.position.array;
    for (let i = 0; i < P.length; i += 3) {
      const dx = P[i] - cx, dz = P[i + 2] - cz, r = Math.hypot(dx, dz), b = bOf(dx, dz);
      const k = Math.min(K - 1, (r / rOut[b] * K) | 0), o = b * K + k, y = P[i + 1];
      if (!(y >= lo[o])) lo[o] = y;
      if (!(y <= hi[o])) hi[o] = y;
    }
  }
  for (let pass = 0; pass < 2; pass++) for (let b = 0; b < B; b++) for (let k = 0; k < K; k++) {
    const o = b * K + k;
    if (lo[o] === lo[o]) continue;
    const cand = [k > 0 ? o - 1 : -1, k < K - 1 ? o + 1 : -1, ((b + B - 1) % B) * K + k, ((b + 1) % B) * K + k];
    for (const c of cand) if (c >= 0 && lo[c] === lo[c]) { lo[o] = lo[c]; hi[o] = hi[c]; break; }
  }
  for (let o = 0; o < B * K; o++) if (lo[o] !== lo[o]) { lo[o] = 1e9; hi[o] = -1e9; }   // nothing there: open
  let rMax = 0;
  for (let b = 0; b < B; b++) rMax = Math.max(rMax, rOut[b]);
  return { B, K, cx, cz, rOut, lo, hi, rMax };
}

// ---- the shell test --------------------------------------------------------------------
// The bands are read CONTINUOUSLY: bilinear between the two nearest bearings and the two
// nearest ring centres (a ring is not a step: her back slopes, and a stair-stepped band let
// a walker sink a ring deep before it caught him, then threw him out by a ring's width).
const _sh = { x: 0, y: 0, z: 0 };
let _upMax = 1e9;
let _lo = 0, _hi = 0, _ro = 0;
// band at fractional bearing index fa (0..B) and radius rho: writes _lo, _hi, _ro
function band(S, fa, rho) {
  const B = S.B, K = S.K;
  const b0 = Math.floor(fa) % B, b1 = (b0 + 1) % B, wb = fa - Math.floor(fa);
  const ro = S.rOut[b0] + (S.rOut[b1] - S.rOut[b0]) * wb;
  let fk = rho / ro * K - 0.5;
  if (fk < 0) fk = 0; else if (fk > K - 1) fk = K - 1;
  const k0 = Math.floor(fk), k1 = Math.min(K - 1, k0 + 1), wk = fk - k0;
  const l00 = S.lo[b0 * K + k0], l01 = S.lo[b0 * K + k1], l10 = S.lo[b1 * K + k0], l11 = S.lo[b1 * K + k1];
  const h00 = S.hi[b0 * K + k0], h01 = S.hi[b0 * K + k1], h10 = S.hi[b1 * K + k0], h11 = S.hi[b1 * K + k1];
  // an open cell (nothing there) never interpolates into a solid one
  if (l00 > 1e8 || l01 > 1e8 || l10 > 1e8 || l11 > 1e8) { _lo = Math.min(l00, l01, l10, l11); _hi = Math.max(h00, h01, h10, h11); }
  else {
    _lo = (l00 + (l01 - l00) * wk) * (1 - wb) + (l10 + (l11 - l10) * wk) * wb;
    _hi = (h00 + (h01 - h00) * wk) * (1 - wb) + (h10 + (h11 - h10) * wk) * wb;
  }
  _ro = ro;
}
function inBand(S, fa, rho, py, rr) {
  band(S, fa, rho);
  if (rho > _ro + rr) return false;
  return py + rr > _lo && py - rr < _hi;
}
// Local point (px, py, pz), sphere radius rr (local units). Writes the minimal way out into
// _sh (dx, dy, dz local) and returns its length, or 0 when clear. The ways out: along the
// bearing OUTWARD past where the band stops containing his height, INWARD (when he came at
// it from under her), or UP over her back (only from its upper half).
function shellPen(S, px, py, pz, rr) {
  const dx = px - S.cx, dz = pz - S.cz, rho = Math.hypot(dx, dz);
  if (rho > S.rMax + rr) return 0;
  let a = Math.atan2(dz, dx) / (Math.PI * 2); if (a < 0) a += 1;
  const fa = a * S.B;
  if (!inBand(S, fa, rho, py, rr)) return 0;
  const lo0 = _lo, hi0 = _hi, ro = _ro, st = ro / (S.K * 6);
  let pOut = 1e9, pIn = 1e9;
  for (let r = rho + st; ; r += st) { if (!inBand(S, fa, r, py, rr)) { pOut = r - rho; break; } if (r > ro + rr) { pOut = ro + rr - rho; break; } }
  for (let r = rho - st; r > 0; r -= st) { if (!inBand(S, fa, r, py, rr)) { pIn = rho - r; break; } }
  const pUp = py > 0.5 * (lo0 + hi0) && hi0 + rr - py < _upMax ? hi0 + rr - py : 1e9;
  const ux = rho > 1e-5 ? dx / rho : 0, uz = rho > 1e-5 ? dz / rho : 1;
  if (pUp < pOut && pUp < pIn) { _sh.x = 0; _sh.y = pUp; _sh.z = 0; return pUp; }
  if (pIn < pOut) { _sh.x = -ux * pIn; _sh.y = 0; _sh.z = -uz * pIn; return pIn; }
  _sh.x = ux * pOut; _sh.y = 0; _sh.z = uz * pOut; return pOut;
}
// Inside the shell's plan, under its belly? (the camera frames low there)
export function underShell(x, y, z) {
  if (!on || !shellOk) return false;
  const M = SHI, S = shell;
  const px = M[0] * x + M[4] * y + M[8] * z + M[12], py = M[1] * x + M[5] * y + M[9] * z + M[13], pz = M[2] * x + M[6] * y + M[10] * z + M[14];
  const dx = px - S.cx, dz = pz - S.cz, rho = Math.hypot(dx, dz);
  let a = Math.atan2(dz, dx) / (Math.PI * 2); if (a < 0) a += 1;
  band(S, a * S.B, rho);
  return rho < _ro * 0.9 && py < _lo;
}

// ---- segment math ------------------------------------------------------------------------
// closest points between segments P0P1 and Q0Q1 (Ericson 5.1.9); writes s, t
let _s = 0, _t = 0;
function segSeg(p0x, p0y, p0z, p1x, p1y, p1z, q0x, q0y, q0z, q1x, q1y, q1z) {
  const d1x = p1x - p0x, d1y = p1y - p0y, d1z = p1z - p0z, d2x = q1x - q0x, d2y = q1y - q0y, d2z = q1z - q0z;
  const rx = p0x - q0x, ry = p0y - q0y, rz = p0z - q0z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z, e = d2x * d2x + d2y * d2y + d2z * d2z, f = d2x * rx + d2y * ry + d2z * rz;
  let s, t;
  if (a <= 1e-9 && e <= 1e-9) { s = t = 0; }
  else if (a <= 1e-9) { s = 0; t = Math.max(0, Math.min(1, f / e)); }
  else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= 1e-9) { t = 0; s = Math.max(0, Math.min(1, -c / a)); }
    else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z, den = a * e - b * b;
      s = den > 1e-9 ? Math.max(0, Math.min(1, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.max(0, Math.min(1, -c / a)); }
      else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (b - c) / a)); }
    }
  }
  _s = s; _t = t;
}

// ---- Sal ----------------------------------------------------------------------------------
// His body: a vertical capsule from 0.45 over his boots to his eye (pos is the eye, EYE_H
// 1.35 over the boots), radius 0.45: the helmet's crown is at eye + 0.45.
const EYE_H = 1.35, SAL_R = 0.45;
const _n = { x: 0, y: 0, z: 0 };
// One contact against capsule i of pool A (CAP or an interpolation of PREV->CAP at f):
// returns penetration, the normal in _n, and the part's point (s param in _t).
function capPen(A, i, f, px, y0, y1, pz) {
  const o = i * 8;
  let ax = A[o], ay = A[o + 1], az = A[o + 2], qx = A[o + 3], qy = A[o + 4], qz = A[o + 5];
  if (f < 1) {
    ax = PREV[o] + (ax - PREV[o]) * f; ay = PREV[o + 1] + (ay - PREV[o + 1]) * f; az = PREV[o + 2] + (az - PREV[o + 2]) * f;
    qx = PREV[o + 3] + (qx - PREV[o + 3]) * f; qy = PREV[o + 4] + (qy - PREV[o + 4]) * f; qz = PREV[o + 5] + (qz - PREV[o + 5]) * f;
  }
  segSeg(px, y0, pz, px, y1, pz, ax, ay, az, qx, qy, qz);
  const sy = y0 + (y1 - y0) * _s;
  const cx = ax + (qx - ax) * _t, cy = ay + (qy - ay) * _t, cz = az + (qz - az) * _t;
  let ex = px - cx, ey = sy - cy, ez = pz - cz;
  const d = Math.sqrt(ex * ex + ey * ey + ez * ez);
  const r = A[o + 6] + (A[o + 7] - A[o + 6]) * _t + SAL_R;
  if (d >= r) return 0;
  if (d > 1e-5) { ex /= d; ey /= d; ez /= d; }
  else { const hx = px - (ax + qx) * 0.5, hz = pz - (az + qz) * 0.5, hl = Math.hypot(hx, hz) || 1; ex = hx / hl; ey = 0; ez = hz / hl; }
  _n.x = ex; _n.y = ey; _n.z = ez;
  return r - d;
}

// Push Sal out of her (positions, then velocities) and report the hardest closing speed
// of any part that met him this frame (u/s; the game's slam) in BODY.hitV.
export function resolveBodyCols(player, dt, grounded) {
  BODY.contacts = 0; BODY.push = 0; BODY.hitV = 0; BODY.under = false; BODY.last = '';
  if (!on) return 0;
  const p = player.pos, v = player.vel;
  { const dx = p.x - bx, dy = p.y - by, dz = p.z - bz; if (dx * dx + dy * dy + dz * dz > (bRad + 3) * (bRad + 3)) return 0; }
  const idt = dt > 1e-5 ? 1 / dt : 0;
  for (let it = 0; it < 2; it++) {
    // the limbs
    for (let i = 0; i < nC; i++) {
      const o = i * 8;
      const y0 = p.y - EYE_H + SAL_R, y1 = p.y;
      // cheap reject on the segment's box
      const r = Math.max(CAP[o + 6], CAP[o + 7]) + SAL_R + 0.5;
      if (p.x < Math.min(CAP[o], CAP[o + 3]) - r || p.x > Math.max(CAP[o], CAP[o + 3]) + r) continue;
      if (p.z < Math.min(CAP[o + 2], CAP[o + 5]) - r || p.z > Math.max(CAP[o + 2], CAP[o + 5]) + r) continue;
      if (y1 < Math.min(CAP[o + 1], CAP[o + 4]) - r || y0 > Math.max(CAP[o + 1], CAP[o + 4]) + r) continue;
      let pen = capPen(CAP, i, 1, p.x, y0, y1, p.z);
      let nx = _n.x, ny = _n.y, nz = _n.z;
      // a fast part is tested along its sweep: the EARLIEST contact names the side he is
      // shoved to (a leg that swept past him in one frame must not pull him through)
      if (prevOk && it === 0) {
        const mv = Math.max(Math.abs(CAP[o] - PREV[o]) + Math.abs(CAP[o + 1] - PREV[o + 1]) + Math.abs(CAP[o + 2] - PREV[o + 2]),
          Math.abs(CAP[o + 3] - PREV[o + 3]) + Math.abs(CAP[o + 4] - PREV[o + 4]) + Math.abs(CAP[o + 5] - PREV[o + 5]));
        const rr = Math.min(CAP[o + 6], CAP[o + 7]) + SAL_R;
        if (mv > rr * 0.5) {
          const ns = Math.min(4, Math.ceil(mv / (rr * 0.5)));
          for (let k = 1; k < ns; k++) {
            if (capPen(CAP, i, k / ns, p.x, y0, y1, p.z) > 0) {
              nx = _n.x; ny = _n.y; nz = _n.z;
              // out of the CURRENT part along that side
              capPen(CAP, i, 1, p.x, y0, y1, p.z);
              const o2 = i * 8, t = _t;
              const cx = CAP[o2] + (CAP[o2 + 3] - CAP[o2]) * t, cy = CAP[o2 + 1] + (CAP[o2 + 4] - CAP[o2 + 1]) * t, cz = CAP[o2 + 2] + (CAP[o2 + 5] - CAP[o2 + 2]) * t;
              const sy = Math.max(y0, Math.min(y1, cy));
              const along = (p.x - cx) * nx + (sy - cy) * ny + (p.z - cz) * nz;
              pen = Math.max(pen, CAP[o2 + 6] + (CAP[o2 + 7] - CAP[o2 + 6]) * t + SAL_R - along);
              break;
            }
          }
        }
      }
      if (pen <= 0) continue;
      // on the ground only sideways: the floor holds him up, a push into it would fight it
      if (grounded && ny < 0.75) { const h = Math.hypot(nx, nz); if (h < 1e-4) continue; nx /= h; ny = 0; nz /= h; }
      p.x += nx * pen; p.y += ny * pen; p.z += nz * pen;
      BODY.contacts++; BODY.push += pen; BODY.last = i < 32 ? 'leg' : 'claw';
      // velocity: never INTO the part faster than the part itself moves (it carries him)
      let pvx = 0, pvy = 0, pvz = 0;
      if (prevOk) {
        const t = _t;
        pvx = ((CAP[o] - PREV[o]) * (1 - t) + (CAP[o + 3] - PREV[o + 3]) * t) * idt;
        pvy = ((CAP[o + 1] - PREV[o + 1]) * (1 - t) + (CAP[o + 4] - PREV[o + 4]) * t) * idt;
        pvz = ((CAP[o + 2] - PREV[o + 2]) * (1 - t) + (CAP[o + 5] - PREV[o + 5]) * t) * idt;
      }
      contactVel(v, nx, ny, nz, pvx, pvy, pvz);
    }
    // the shell
    if (shellOk) {
      const S = shell, M = SHI, W = SHM, rr = SAL_R / shR;
      _upMax = grounded ? 0.4 / shR : 1e9;
      for (let q = 0; q < 3; q++) {
        const wy = q === 0 ? p.y - EYE_H + SAL_R : q === 1 ? p.y - 0.45 : p.y;
        const lx = M[0] * p.x + M[4] * wy + M[8] * p.z + M[12];
        const ly = M[1] * p.x + M[5] * wy + M[9] * p.z + M[13];
        const lz = M[2] * p.x + M[6] * wy + M[10] * p.z + M[14];
        if (shellPen(S, lx, ly, lz, rr) <= 0) continue;
        // the way out, in the world (the matrix carries her scale R)
        let nx = W[0] * _sh.x + W[4] * _sh.y + W[8] * _sh.z, ny = W[1] * _sh.x + W[5] * _sh.y + W[9] * _sh.z, nz = W[2] * _sh.x + W[6] * _sh.y + W[10] * _sh.z;
        let pen = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (pen < 1e-5) continue;
        nx /= pen; ny /= pen; nz /= pen;
        if (grounded && ny < 0.75) { const h = Math.hypot(nx, nz); if (h < 1e-4) continue; pen *= 1 / h; nx /= h; ny = 0; nz /= h; pen = Math.min(pen, 3); }
        p.x += nx * pen; p.y += ny * pen; p.z += nz * pen;
        BODY.contacts++; BODY.push += pen; BODY.last = 'shell';
        let pvx = 0, pvy = 0, pvz = 0;
        if (shellPrevOk) {
          // the shell's own velocity at this local point
          const P = SHP;
          const ox = P[0] * lx + P[4] * ly + P[8] * lz + P[12], oy = P[1] * lx + P[5] * ly + P[9] * lz + P[13], oz = P[2] * lx + P[6] * ly + P[10] * lz + P[14];
          const cx = W[0] * lx + W[4] * ly + W[8] * lz + W[12], cy = W[1] * lx + W[5] * ly + W[9] * lz + W[13], cz = W[2] * lx + W[6] * ly + W[10] * lz + W[14];
          pvx = (cx - ox) * idt; pvy = (cy - oy) * idt; pvz = (cz - oz) * idt;
        }
        contactVel(v, nx, ny, nz, pvx, pvy, pvz);
      }
      _upMax = 1e9;
    }
  }
  if (shellOk && underShell(p.x, p.y, p.z)) BODY.under = true;
  return BODY.contacts;
}
function contactVel(v, nx, ny, nz, pvx, pvy, pvz) {
  const pn = pvx * nx + pvy * ny + pvz * nz;          // the part's speed out along the normal
  const vn = v.x * nx + v.y * ny + v.z * nz;
  if (pn > BODY.hitV) BODY.hitV = pn;
  if (vn < pn) { const k = pn - vn; v.x += nx * k; v.y += ny * k; v.z += nz * k; }
}

// ---- the camera ---------------------------------------------------------------------------
// Is the world point inside her (any part grown by margin m)?
export let blockWhy = -2;     // probe: the last bodyBlocked hit (capsule index, -1 = the shell)
export function bodyBlocked(x, y, z, m) {
  if (!on) return false;
  { const dx = x - bx, dy = y - by, dz = z - bz; if (dx * dx + dy * dy + dz * dz > (bRad + m) * (bRad + m)) return false; }
  for (let i = 0; i < nC; i++) {
    const o = i * 8;
    const ax = CAP[o], ay = CAP[o + 1], az = CAP[o + 2], dx = CAP[o + 3] - ax, dy = CAP[o + 4] - ay, dz = CAP[o + 5] - az;
    const L2 = dx * dx + dy * dy + dz * dz;
    let t = L2 > 1e-9 ? ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = x - ax - dx * t, ey = y - ay - dy * t, ez = z - az - dz * t, r = CAP[o + 6] + (CAP[o + 7] - CAP[o + 6]) * t + m;
    if (ex * ex + ey * ey + ez * ez < r * r) { blockWhy = i; return true; }
  }
  if (shellOk) {
    const M = SHI;
    const lx = M[0] * x + M[4] * y + M[8] * z + M[12], ly = M[1] * x + M[5] * y + M[9] * z + M[13], lz = M[2] * x + M[6] * y + M[10] * z + M[14];
    if (shellPen(shell, lx, ly, lz, m / shR) > 0) { blockWhy = -1; return true; }
  }
  return false;
}
// Is she anywhere near the boom (centre within rad + her bound)?
export function bodyNear(x, y, z, rad) {
  if (!on) return false;
  const dx = x - bx, dy = y - by, dz = z - bz, r = bRad + rad;
  return dx * dx + dy * dy + dz * dz < r * r;
}
// probe: the published pool (dev)
export function bodyColsState() { return { on, n: nC, shell: shellOk, prevOk, bound: [bx, by, bz, bRad] }; }
export function bodyColsCaps() { return Array.from(CAP.subarray(0, nC * 8)); }
