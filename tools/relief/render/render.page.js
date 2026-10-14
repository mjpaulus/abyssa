// In-page renderer (2D canvas -> PNG data URLs), Task 13 L1. ARGS.mode: 'map2' | 'sections'.
// Grids: window.__G[key] (Float32, 601 x 601, x/z = -300..300 step 1, row = z), uploaded by upload.page.js from the game's own terrainH
// samples (sample.page.js, one per build). EVERY PIN COMES FROM ARGS (prep.mjs, from each build's meta_s0.json): this page can be
// any build's Chrome, because it reads nothing live from the build it runs in except the frozen crack geometry (fissureShape.js is
// identical on main and the branch: the crack, its frame and fissureDist are frozen literals). No `live` profiles: a live terrainH
// would draw the page's OWN build for both lines.
const S = await import('/src/world/fissureShape.js');
const N = 601, X0 = -300;
const G = window.__G;
const at = (H, i, j) => H[Math.max(0, Math.min(N - 1, j)) * N + Math.max(0, Math.min(N - 1, i))];
const bil = (H, x, z) => { const fx = x - X0, fz = z - X0, i = Math.floor(fx), j = Math.floor(fz), a = fx - i, b = fz - j; return (at(H, i, j) * (1 - a) + at(H, i + 1, j) * a) * (1 - b) + (at(H, i, j + 1) * (1 - a) + at(H, i + 1, j + 1) * a) * b; };
const STOPS = [[-330, '#0b1026'], [-270, '#1b2f6b'], [-258, '#2c5d9e'], [-250, '#3d8fb0'], [-244, '#6fb8a0'], [-238, '#c8d27e'], [-232, '#e8c070'], [-224, '#d99b5e'], [-200, '#b98a6a'], [-160, '#c9b8a8'], [-100, '#f2efe9']]
  .map(([h, c]) => [h, parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]);
function ramp(h) {
  if (h <= STOPS[0][0]) return STOPS[0].slice(1);
  for (let k = 1; k < STOPS.length; k++) if (h <= STOPS[k][0]) { const a = STOPS[k - 1], b = STOPS[k], t = (h - a[0]) / (b[0] - a[0]); return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t]; }
  return STOPS[STOPS.length - 1].slice(1);
}
// hillshade x hypsometric tint into an ImageData at s px per u over [x0, x1] x [z0, z1]
function shadeImage(ctx, H, s, off = 0, zf = 2.0, x0 = -300, x1 = 300, z0 = -300, z1 = 300) {
  const w = Math.round((x1 - x0) * s), h = Math.round((z1 - z0) * s), img = ctx.createImageData(w, h);
  const L = [-0.5, 0.62, -0.6]; const ll = Math.hypot(...L); L[0] /= ll; L[1] /= ll; L[2] /= ll;
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    const x = x0 + (px + 0.5) / s, z = z0 + (py + 0.5) / s;
    const hc = bil(H, x, z), gx = (bil(H, x + 1, z) - bil(H, x - 1, z)) / 2, gz = (bil(H, x, z + 1) - bil(H, x, z - 1)) / 2;
    let nx = -zf * gx, ny = 1, nz = -zf * gz; const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
    const sh = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
    const c = ramp(hc + off), k = 0.32 + 0.82 * sh, o = (py * w + px) * 4;
    img.data[o] = Math.min(255, c[0] * k); img.data[o + 1] = Math.min(255, c[1] * k); img.data[o + 2] = Math.min(255, c[2] * k); img.data[o + 3] = 255;
  }
  return img;
}
// marching squares iso-lines of grid F (N x N over world -300..300) at level lv; draw(xa, za, xb, zb)
function iso(F, lv, draw, i0 = 0, i1 = N - 1, j0 = 0, j1 = N - 1) {
  for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
    const a = F[j * N + i] - lv, b = F[j * N + i + 1] - lv, c = F[(j + 1) * N + i + 1] - lv, d = F[(j + 1) * N + i] - lv;
    const code = (a > 0 ? 8 : 0) | (b > 0 ? 4 : 0) | (c > 0 ? 2 : 0) | (d > 0 ? 1 : 0);
    if (code === 0 || code === 15) continue;
    const x = X0 + i, z = X0 + j;
    const e = [[x + a / (a - b), z], [x + 1, z + b / (b - c)], [x + d / (d - c), z + 1], [x, z + a / (a - d)]];
    const segs = { 1: [[3, 2]], 2: [[2, 1]], 3: [[3, 1]], 4: [[0, 1]], 5: [[3, 0], [2, 1]], 6: [[0, 2]], 7: [[3, 0]], 8: [[3, 0]], 9: [[0, 2]], 10: [[0, 1], [3, 2]], 11: [[0, 1]], 12: [[3, 1]], 13: [[2, 1]], 14: [[3, 2]] }[code];
    for (const [p, q] of segs) draw(e[p][0], e[p][1], e[q][0], e[q][1]);
  }
}
function fdGrid(zi) { const F = new Float32Array(N * N); for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) F[j * N + i] = S.fissureDist(X0 + i, X0 + j, zi); return F; }
function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d'); ctx.fillStyle = '#10141a'; ctx.fillRect(0, 0, w, h); return { c, ctx }; }
function label(ctx, txt, x, y, opt = {}) {
  ctx.font = opt.font || '600 15px Helvetica, Arial, sans-serif'; ctx.textAlign = opt.align || 'left'; ctx.textBaseline = opt.base || 'middle';
  if (opt.halo !== false) { ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.strokeText(txt, x, y); }
  ctx.fillStyle = opt.color || '#fff'; ctx.fillText(txt, x, y);
}
function circle(ctx, X, Z, x, z, r, s, style, dash = [], lw = 2) { ctx.save(); ctx.setLineDash(dash); ctx.strokeStyle = style; ctx.lineWidth = lw; ctx.beginPath(); ctx.arc(X(x), Z(z), r * s, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
// one map panel: hillshade + contours + crack outline at (ox, oy), s px/u, world window [x0,x1]x[z0,z1]
function mapPanel(ctx, H, ox, oy, s, opt = {}) {
  const x0 = opt.x0 ?? -300, x1 = opt.x1 ?? 300, z0 = opt.z0 ?? -300, z1 = opt.z1 ?? 300, off = opt.off || 0;
  ctx.putImageData(shadeImage(ctx, H, s, off, opt.zf ?? 2.0, x0, x1, z0, z1), ox, oy);
  const X = x => ox + (x - x0) * s, Z = z => oy + (z - z0) * s;
  ctx.save(); ctx.beginPath(); ctx.rect(ox, oy, (x1 - x0) * s, (z1 - z0) * s); ctx.clip();
  // contours: every 5 u below the wall band, every 25 u everywhere (heights relative to off)
  const lines = (lv, style, lw) => { ctx.strokeStyle = style; ctx.lineWidth = lw; ctx.beginPath(); iso(H, lv, (xa, za, xb, zb) => { ctx.moveTo(X(xa), Z(za)); ctx.lineTo(X(xb), Z(zb)); }); ctx.stroke(); };
  for (let lv = -300; lv <= -100; lv += 5) { const a = lv - off; if (lv % 25 === 0) lines(a, 'rgba(0,0,0,0.55)', 1.3); else if (lv < -215) lines(a, 'rgba(0,0,0,0.22)', 0.8); }
  ctx.restore();
  return { X, Z };
}
const files = {};


// ---- one map panel with every overlay, pins from `p` (see prep.mjs) ----
function mapWithPins(ctx, p, ox, oy, s, sections) {
  const H = G[p.key], NUM = p.num, FD = fdGrid(0), SZ = 600 * s;
  const { X, Z } = mapPanel(ctx, H, ox, oy, s);
  ctx.save(); ctx.beginPath(); ctx.rect(ox, oy, SZ, SZ); ctx.clip();
  // the lowest 1% / 5% of the OPEN floor (fd >= 14, inside the rim onset + the walk clamp)
  const OPEN = new Float32Array(N * N), tbl = p.clampR;
  const clampLim = (x, z) => { const th = Math.atan2(z, x), fi = ((th < 0 ? th + Math.PI * 2 : th) / (Math.PI * 2)) * 128, i = fi | 0; return tbl[i] + (tbl[i + 1] - tbl[i]) * (fi - i); };
  const c01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
  const rinAt = (x, z) => { const rr = Math.hypot(x, z), ir = 1 / Math.max(rr, 1e-3), cx = x * ir, cz = z * ir, c2 = cx * cx - cz * cz, s2 = 2 * cx * cz, c3 = cx * c2 - cz * s2, s3 = cx * s2 + cz * c2, c5 = c2 * c3 - s2 * s3, s5 = c2 * s3 + s2 * c3, K = NUM.rimKR; return NUM.rimIn + 46 * c01((K[0] * c2 + K[1] * s2 + K[2] * c3 + K[3] * s3 + K[4] * c5 + K[5] * s5) * 0.62 + 0.5); };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const k = j * N + i, x = X0 + i, z = X0 + j; OPEN[k] = FD[k] >= 14 && Math.hypot(x, z) < Math.min(clampLim(x, z), rinAt(x, z)) ? H[k] : -100; }
  ctx.fillStyle = 'rgba(214, 60, 255, 0.55)';
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (OPEN[j * N + i] <= NUM.p1) ctx.fillRect(X(X0 + i) - 0.5, Z(X0 + j) - 0.5, 1.4, 1.4);
  ctx.strokeStyle = 'rgba(232, 120, 255, 0.95)'; ctx.lineWidth = 1.4; ctx.setLineDash([5, 4]); ctx.beginPath();
  iso(OPEN, NUM.p5, (xa, za, xb, zb) => { ctx.moveTo(X(xa), Z(za)); ctx.lineTo(X(xb), Z(zb)); }); ctx.stroke(); ctx.setLineDash([]);
  // the crack: lip (fd 0) white, apron edge (fd 14) dashed
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.8; ctx.beginPath(); iso(FD, 0, (xa, za, xb, zb) => { ctx.moveTo(X(xa), Z(za)); ctx.lineTo(X(xb), Z(zb)); }); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1; ctx.setLineDash([6, 5]); ctx.beginPath(); iso(FD, 14, (xa, za, xb, zb) => { ctx.moveTo(X(xa), Z(za)); ctx.lineTo(X(xb), Z(zb)); }); ctx.stroke(); ctx.setLineDash([]);
  // the walk limit (clampR) and the hose's give onset (3D 375 u from this build's pump, on the drawn floor)
  ctx.strokeStyle = '#ff9d2e'; ctx.lineWidth = 1.8; ctx.setLineDash([10, 6]); ctx.beginPath();
  for (let b = 0; b <= 128; b++) { const a = b / 128 * Math.PI * 2, r = tbl[b % 128]; const x = Math.cos(a) * r, z = Math.sin(a) * r; if (b === 0) ctx.moveTo(X(x), Z(z)); else ctx.lineTo(X(x), Z(z)); } ctx.stroke(); ctx.setLineDash([]);
  const P = p.pump, HD = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) HD[j * N + i] = Math.hypot(X0 + i - P[0], H[j * N + i] - P[1], X0 + j - P[2]);
  ctx.strokeStyle = '#ff4fa3'; ctx.lineWidth = 2; ctx.beginPath(); iso(HD, 375, (xa, za, xb, zb) => { ctx.moveTo(X(xa), Z(za)); ctx.lineTo(X(xb), Z(zb)); }); ctx.stroke();
  // section lines
  for (const L of sections) {
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.6; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(X(L.a[0]), Z(L.a[1])); ctx.lineTo(X(L.b[0]), Z(L.b[1])); ctx.stroke(); ctx.setLineDash([]);
    label(ctx, L.name, X(L.a[0]), Z(L.a[1]), { font: '800 20px Helvetica, Arial', align: 'center', color: '#fff' });
    label(ctx, L.name + "'", X(L.b[0]), Z(L.b[1]), { font: '800 20px Helvetica, Arial', align: 'center', color: '#fff' });
  }
  // pins: the raft + pump, the skiff, her bed, the lowest open floor, the hose's binding point
  ctx.fillStyle = '#8a5a2b'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.fillRect(X(-4.7), Z(-4.7), 9.4 * s, 9.4 * s); ctx.strokeRect(X(-4.7), Z(-4.7), 9.4 * s, 9.4 * s);
  label(ctx, 'RAFT + PUMP', X(8), Z(-12), { color: '#ffe2c0', font: '600 13px Helvetica, Arial' });
  const wr = p.wreck, bed = p.bed;
  circle(ctx, X, Z, wr.x, wr.z, wr.clear, s, '#ffd166', [4, 3], 1.8);
  ctx.fillStyle = '#ffd166'; ctx.beginPath(); ctx.moveTo(X(wr.x), Z(wr.z) - 9); ctx.lineTo(X(wr.x) + 8, Z(wr.z) + 6); ctx.lineTo(X(wr.x) - 8, Z(wr.z) + 6); ctx.closePath(); ctx.fill();
  label(ctx, `SKIFF  (${wr.x.toFixed(0)}, ${wr.z.toFixed(0)})  floor ${wr.y.toFixed(1)}`, X(wr.x) + 14, Z(wr.z) + 14, { color: '#ffd166', font: '600 13px Helvetica, Arial' });
  circle(ctx, X, Z, bed.x, bed.z, bed.r, s, '#ff6b5b', [7, 5], 1.8);
  circle(ctx, X, Z, bed.x, bed.z, p.R, s, '#ff6b5b', [], 2.6);
  label(ctx, `VELKATH'S BED  (${bed.x.toFixed(1)}, ${bed.z.toFixed(1)})`, X(bed.x) - bed.r * s - 6, Z(bed.z) - 8, { color: '#ffb3a8', align: 'right', font: '700 13px Helvetica, Arial' });
  label(ctx, `mean under her ${NUM.bedMean.toFixed(1)}, ${Math.round(NUM.bedPct * 100)}th pct of the open floor`, X(bed.x) - bed.r * s - 6, Z(bed.z) + 8, { color: '#ffb3a8', align: 'right', font: '600 12px Helvetica, Arial' });
  ctx.fillStyle = '#ff3df5'; ctx.beginPath(); ctx.moveTo(X(NUM.min[0]) - 8, Z(NUM.min[1]) - 7); ctx.lineTo(X(NUM.min[0]) + 8, Z(NUM.min[1]) - 7); ctx.lineTo(X(NUM.min[0]), Z(NUM.min[1]) + 7); ctx.closePath(); ctx.fill();
  label(ctx, `lowest open floor ${NUM.min[2].toFixed(1)}`, X(NUM.min[0]) + 12, Z(NUM.min[1]), { color: '#ffb3ff', font: '600 12px Helvetica, Arial' });
  const F = S.FISSURE[0];
  label(ctx, 'THE CRACK', X(F.cx + 30), Z(F.cz - 4), { color: '#ffffff', font: '700 13px Helvetica, Arial' });
  label(ctx, `throat to ${NUM.throatMin.toFixed(0)}`, X(F.cx + 30), Z(F.cz + 5), { color: '#ffffff', font: '600 12px Helvetica, Arial' });
  // the hose's binding point: the farthest walkable point from the pump (a diamond, pink)
  const hz = p.hose;
  ctx.fillStyle = '#ff4fa3'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(X(hz.x), Z(hz.z) - 9); ctx.lineTo(X(hz.x) + 9, Z(hz.z)); ctx.lineTo(X(hz.x), Z(hz.z) + 9); ctx.lineTo(X(hz.x) - 9, Z(hz.z)); ctx.closePath(); ctx.fill(); ctx.stroke();
  label(ctx, `HOSE BINDING POINT  ${hz.maxDist} u  (give at 375)`, X(hz.x) + (hz.x > 0 ? 10 : -10), Z(hz.z) + 24, { color: '#ffb0d6', align: hz.x > 0 ? 'right' : 'left', font: '600 12px Helvetica, Arial' });
  ctx.restore();
  // frame, ticks, scale bar
  ctx.strokeStyle = '#7d8794'; ctx.lineWidth = 1; ctx.strokeRect(ox, oy, SZ, SZ);
  ctx.font = '12px Helvetica, Arial'; ctx.fillStyle = '#aab3bf'; ctx.textAlign = 'center';
  for (let v = -300; v <= 300; v += 100) { ctx.fillText(`x ${v}`, X(v), oy + SZ + 14); ctx.save(); ctx.translate(ox - 10, Z(v)); ctx.rotate(-Math.PI / 2); ctx.fillText(`z ${v}`, 0, 0); ctx.restore(); }
  ctx.fillStyle = '#fff'; ctx.fillRect(ox + 20, oy + SZ - 30, 50 * s, 5); label(ctx, '50 u', ox + 20 + 25 * s, oy + SZ - 42, { align: 'center', font: '600 13px Helvetica, Arial' });
  label(ctx, p.title, ox, oy - 40, { font: '700 20px Helvetica, Arial', halo: false });
  label(ctx, p.subtitle, ox, oy - 16, { font: '13px Helvetica, Arial', halo: false, color: '#c4ccd6' });
}

if (ARGS.mode === 'map2') {
  const s = ARGS.s || 1.5, SZ = 600 * s, LEG = 330, W = 40 + SZ + 50 + SZ + 40 + LEG, oy = 130, Hh = oy + SZ + 70 + (ARGS.notes ? ARGS.notes.length * 19 + 20 : 0);
  const { c, ctx } = mkCanvas(W, Hh);
  label(ctx, ARGS.title, 40, 34, { font: '700 26px Helvetica, Arial', halo: false });
  label(ctx, ARGS.subtitle, 40, 66, { font: '14px Helvetica, Arial', halo: false, color: '#c4ccd6' });
  ARGS.panels.forEach((p, k) => mapWithPins(ctx, p, 40 + k * (SZ + 50), oy, s, ARGS.sections));
  const lx = 40 + 2 * SZ + 50 + 40, ly = oy + 20;
  label(ctx, 'height (u), both panels', lx, ly, { font: '700 15px Helvetica, Arial', halo: false });
  for (let k = 0; k <= 440; k++) { const h = -330 + k / 440 * 230, cc = ramp(h); ctx.fillStyle = `rgb(${cc[0] | 0},${cc[1] | 0},${cc[2] | 0})`; ctx.fillRect(lx, ly + 460 - k, 28, 1.2); }
  ctx.font = '12px Helvetica, Arial'; ctx.fillStyle = '#d8dee6'; ctx.textAlign = 'left';
  for (const h of [-330, -310, -290, -270, -258, -250, -244, -238, -232, -224, -200, -150, -100]) { const yy = ly + 460 - (h + 330) / 230 * 440; ctx.fillRect(lx + 28, yy, 6, 1); ctx.fillText(String(h), lx + 38, yy + 1); }
  const items = [['#ffffff', [], 'crack lip (fd 0)'], ['rgba(255,255,255,0.7)', [6, 5], 'apron edge (fd 14)'], ['#ff9d2e', [10, 6], 'walk limit (clampR)'], ['#ff4fa3', [], 'hose give onset: 375 u from the pump'], ['#ff6b5b', [], 'Velkath R 15.4 / bed 23.9'], ['#ffd166', [4, 3], 'skiff + clear 12'], ['rgba(232,120,255,0.95)', [5, 4], 'lowest 5% of the open floor'], ['rgba(214,60,255,0.55)', null, 'lowest 1%'], ['rgba(255,255,255,0.9)', [2, 3], 'cross-sections A, B, C, D']];
  let yy = ly + 500;
  for (const [col, dash, txt] of items) {
    if (dash) { ctx.strokeStyle = col; ctx.lineWidth = 2.4; ctx.setLineDash(dash); ctx.beginPath(); ctx.moveTo(lx, yy); ctx.lineTo(lx + 34, yy); ctx.stroke(); ctx.setLineDash([]); } else { ctx.fillStyle = col; ctx.fillRect(lx, yy - 6, 34, 12); }
    label(ctx, txt, lx + 42, yy, { font: '12px Helvetica, Arial', halo: false, color: '#e6ebf1' }); yy += 24;
  }
  yy = oy + SZ + 70;
  for (const t of ARGS.notes || []) { label(ctx, t, 40, yy, { font: '13px Helvetica, Arial', halo: false, color: '#c4ccd6' }); yy += 19; }
  files[ARGS.out] = c.toDataURL('image/png');
}

if (ARGS.mode === 'sections') {
  const W = 1900, PH = ARGS.ph || 330, gap = 56, top = 96, Hh = top + ARGS.sections.length * (PH + gap) + 30;
  const { c, ctx } = mkCanvas(W, Hh);
  label(ctx, ARGS.title, 30, 30, { font: '700 24px Helvetica, Arial', halo: false });
  label(ctx, ARGS.subtitle, 30, 62, { font: '14px Helvetica, Arial', halo: false, color: '#c4ccd6' });
  ARGS.sections.forEach((L, si) => {
    const y0 = (L.yRange || ARGS.yRange)[0], y1 = (L.yRange || ARGS.yRange)[1];
    const px0 = 90, py0 = top + si * (PH + gap), pw = W - 360, ph = PH;
    const len = Math.hypot(L.b[0] - L.a[0], L.b[1] - L.a[1]), ux = (L.b[0] - L.a[0]) / len, uz = (L.b[1] - L.a[1]) / len;
    const sx = pw / len, sy = ph / (y1 - y0), Xs = d => px0 + d * sx, Ys = y => py0 + (y1 - y) * sy;
    ctx.fillStyle = '#161c24'; ctx.fillRect(px0, py0, pw, ph);
    for (const [lv, col, txt] of ARGS.refs) { if (lv < y0 || lv > y1) continue; ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.setLineDash([8, 5]); ctx.beginPath(); ctx.moveTo(px0, Ys(lv)); ctx.lineTo(px0 + pw, Ys(lv)); ctx.stroke(); ctx.setLineDash([]); label(ctx, txt, px0 + pw + 8, Ys(lv), { align: 'left', font: '12px Helvetica, Arial', color: col, halo: false }); }
    // fill under the relief profile (the last), then the lines; main first so the relief draws over it
    { const pr0 = ARGS.profiles[ARGS.profiles.length - 1], H = G[pr0.key]; ctx.fillStyle = 'rgba(200,180,140,0.10)'; ctx.beginPath(); ctx.moveTo(Xs(0), py0 + ph); for (let d = 0; d <= len; d += 0.5) { const x = L.a[0] + ux * d, z = L.a[1] + uz * d; ctx.lineTo(Xs(d), Math.max(py0, Math.min(py0 + ph, Ys(bil(H, x, z))))); } ctx.lineTo(Xs(len), py0 + ph); ctx.closePath(); ctx.fill(); }
    for (const pr of ARGS.profiles) {
      const H = G[pr.key]; ctx.strokeStyle = pr.color; ctx.lineWidth = pr.width || 2; ctx.setLineDash(pr.dash || []); ctx.beginPath();
      for (let d = 0; d <= len; d += 0.25) { const x = L.a[0] + ux * d, z = L.a[1] + uz * d, y = bil(H, x, z); const yy = Math.max(py0, Math.min(py0 + ph, Ys(y))); if (d === 0) ctx.moveTo(Xs(d), yy); else ctx.lineTo(Xs(d), yy); }
      ctx.stroke(); ctx.setLineDash([]);
    }
    for (const m of L.spans || []) { ctx.fillStyle = m.color; ctx.globalAlpha = 0.18; ctx.fillRect(Xs(m.d0), py0, (m.d1 - m.d0) * sx, ph); ctx.globalAlpha = 1; label(ctx, m.txt, Xs((m.d0 + m.d1) / 2), py0 + 14 + (m.row || 0) * 17, { align: 'center', font: '600 12px Helvetica, Arial', color: m.color }); }
    for (const m of L.marks || []) { ctx.strokeStyle = m.color; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(Xs(m.d), py0); ctx.lineTo(Xs(m.d), py0 + ph); ctx.stroke(); const rgt = Xs(m.d) > px0 + pw - 260; label(ctx, m.txt, Xs(m.d) + (rgt ? -4 : 4), py0 + ph - 30 - (m.row || 0) * 17, { font: '600 12px Helvetica, Arial', color: m.color, align: rgt ? 'right' : 'left' }); }
    ctx.strokeStyle = '#7d8794'; ctx.lineWidth = 1; ctx.strokeRect(px0, py0, pw, ph);
    ctx.font = '12px Helvetica, Arial'; ctx.fillStyle = '#aab3bf'; ctx.textAlign = 'right';
    for (let y = Math.ceil(y0 / 10) * 10; y <= y1; y += 10) { ctx.fillText(String(y), px0 - 6, Ys(y) + 4); ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(px0, Ys(y), pw, 1); ctx.fillStyle = '#aab3bf'; }
    ctx.textAlign = 'center'; for (let d = 0; d <= len; d += 50) ctx.fillText(`${d} u`, Xs(d), py0 + ph + 15);
    const ve = (sy / sx).toFixed(1);
    label(ctx, `${L.name}–${L.name}'  ${L.desc}   (vertical exaggeration x${ve}; profiles clipped to ${y0}..${y1})`, px0, py0 - 14, { font: '700 15px Helvetica, Arial', halo: false });
  });
  ctx.font = '12px Helvetica, Arial'; let lx = W - 20 - ARGS.profiles.reduce((a, pr) => a + 36 + ctx.measureText(pr.name).width + 26, 0);
  for (const pr of ARGS.profiles) { ctx.strokeStyle = pr.color; ctx.lineWidth = pr.width || 2; ctx.setLineDash(pr.dash || []); ctx.beginPath(); ctx.moveTo(lx, 72); ctx.lineTo(lx + 30, 72); ctx.stroke(); ctx.setLineDash([]); label(ctx, pr.name, lx + 36, 72, { font: '12px Helvetica, Arial', halo: false }); lx += 36 + ctx.measureText(pr.name).width + 26; }
  files[ARGS.out] = c.toDataURL('image/png');
}
return { files, mode: ARGS.mode };
