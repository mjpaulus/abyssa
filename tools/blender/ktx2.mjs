// STEP 3 of the sculpt pipeline (node, optional): block-compressed KTX2 maps.
//   node tools/blender/ktx2.mjs <build dir> <out dir> [set ...]
// Runs when a creature's pipeline() asks for it (compress: { tex: 'ktx2' }); bake.py then
// leaves raw top-down RGBA8 dumps of every map in the build dir. Written here, by hand,
// because the rule is that every asset byte is ours: no basisu, no toktx.
//   <set>_albedo.ktx2  BC1 (sRGB)        4 bpp   the painted albedo
//   <set>_normal.ktx2  BC5 (RG, linear)  8 bpp   tangent normal XY; the shader rebuilds Z
// ORM stays WebP: its three channels are independent, and BC1's single colour line per
// 4x4 block measured RMSE 10-16/255 per channel on them (AO banding); a 1024 WebP decodes
// in a few ms. (Albedo BC1 measures 1.4-2.2/255, normals BC5 43 dB.)
// Full mip chains built here (albedo filtered in LINEAR light, normals renormalised per
// level), each level zstd-supercompressed (the zstd CLI; three's KTX2Loader decodes with
// its own zstddec). Encoders: BC1 = principal-axis endpoints + two least-squares
// refinement passes, 4-colour mode only; BC4/BC5 = min/max endpoints, 8-level mode.
// The WebP maps stay beside them: a GPU without S3TC/RGTC (most phones) loads those.
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const [BUILD, OUT, ...ONLY] = process.argv.slice(2);
if (!BUILD || !OUT) { console.error('usage: ktx2.mjs <build dir> <out dir> [set ...]'); process.exit(1); }
const man = JSON.parse(fs.readFileSync(path.join(BUILD, 'manifest.json'), 'utf8'));
const ZSTD = process.env.ZSTD || 'zstd';

// ---- colour helpers
const S2L = new Float32Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; S2L[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
const l2s = c => { c = c < 0 ? 0 : c > 1 ? 1 : c; return 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055); };

// ---- mip chains (Float32 planes, values 0..255 in the file's encoding)
function planes(u8, w, ch) {
  const P = [];
  for (let c = 0; c < ch.length; c++) { const a = new Float32Array(w * w); for (let i = 0; i < w * w; i++) a[i] = u8[i * 4 + ch[c]]; P.push(a); }
  return P;
}
function down(P, w, mode) {
  const h = w >> 1, out = P.map(() => new Float32Array(h * h));
  for (let y = 0; y < h; y++) for (let x = 0; x < h; x++) {
    const i00 = (2 * y) * w + 2 * x, i01 = i00 + 1, i10 = i00 + w, i11 = i10 + 1, o = y * h + x;
    if (mode === 'srgb') {
      for (let c = 0; c < P.length; c++) {
        const p = P[c];
        const v = (lin(p[i00]) + lin(p[i01]) + lin(p[i10]) + lin(p[i11])) * 0.25;
        out[c][o] = l2s(v);
      }
    } else if (mode === 'normal') {
      let sx = 0, sy = 0, sz = 0;
      for (const i of [i00, i01, i10, i11]) {
        const nx = P[0][i] / 127.5 - 1, ny = P[1][i] / 127.5 - 1;
        sx += nx; sy += ny; sz += Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      }
      const l = Math.hypot(sx, sy, sz) || 1;
      out[0][o] = (sx / l + 1) * 127.5; out[1][o] = (sy / l + 1) * 127.5;
    } else {
      for (let c = 0; c < P.length; c++) { const p = P[c]; out[c][o] = (p[i00] + p[i01] + p[i10] + p[i11]) * 0.25; }
    }
  }
  return out;
}
function lin(v) { const i = v < 0 ? 0 : v > 255 ? 255 : v; const f = Math.floor(i), t = i - f; return f >= 255 ? S2L[255] : S2L[f] + (S2L[f + 1] - S2L[f]) * t; }
function chain(P, w, mode) {
  const L = [{ P, w }];
  while (w > 1) { P = down(P, w, mode); w >>= 1; L.push({ P, w }); }
  return L;
}

// ---- BC1 (RGB, 4-colour mode)
const q565 = (r, g, b) => {
  const R = Math.max(0, Math.min(31, Math.round(r * 31 / 255))), G = Math.max(0, Math.min(63, Math.round(g * 63 / 255))), B = Math.max(0, Math.min(31, Math.round(b * 31 / 255)));
  return (R << 11) | (G << 5) | B;
};
const x565 = (c, o) => { const R = c >> 11, G = (c >> 5) & 63, B = c & 31; o[0] = (R << 3) | (R >> 2); o[1] = (G << 2) | (G >> 4); o[2] = (B << 3) | (B >> 2); };
const _c0 = [0, 0, 0], _c1 = [0, 0, 0], _pal = new Float32Array(12), _idx = new Uint8Array(16);
function palette(c0, c1) {
  x565(c0, _c0); x565(c1, _c1);
  for (let k = 0; k < 3; k++) { _pal[k] = _c0[k]; _pal[3 + k] = _c1[k]; _pal[6 + k] = (2 * _c0[k] + _c1[k]) / 3; _pal[9 + k] = (_c0[k] + 2 * _c1[k]) / 3; }
}
let WR = 0.30, WG = 0.59, WB = 0.11;      // error weights: luminance for albedo, equal for data maps
function assign(px, idx) {
  let err = 0;
  for (let i = 0; i < 16; i++) {
    const r = px[i * 3], g = px[i * 3 + 1], b = px[i * 3 + 2];
    let best = 0, bd = 1e30;
    for (let k = 0; k < 4; k++) { const dr = r - _pal[k * 3], dg = g - _pal[k * 3 + 1], db = b - _pal[k * 3 + 2], d = dr * dr * WR + dg * dg * WG + db * db * WB; if (d < bd) { bd = d; best = k; } }
    idx[i] = best; err += bd;
  }
  return err;
}
const W4 = [1, 0, 2 / 3, 1 / 3];
function encBC1(px, out, off) {
  // principal axis by power iteration on the covariance
  let mr = 0, mg = 0, mb = 0;
  for (let i = 0; i < 16; i++) { mr += px[i * 3]; mg += px[i * 3 + 1]; mb += px[i * 3 + 2]; }
  mr /= 16; mg /= 16; mb /= 16;
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  for (let i = 0; i < 16; i++) { const r = px[i * 3] - mr, g = px[i * 3 + 1] - mg, b = px[i * 3 + 2] - mb; xx += r * r; xy += r * g; xz += r * b; yy += g * g; yz += g * b; zz += b * b; }
  let ax = 0.577, ay = 0.577, az = 0.577;
  for (let it = 0; it < 8; it++) { const nx = xx * ax + xy * ay + xz * az, ny = xy * ax + yy * ay + yz * az, nz = xz * ax + yz * ay + zz * az; const l = Math.hypot(nx, ny, nz); if (l < 1e-9) break; ax = nx / l; ay = ny / l; az = nz / l; }
  let tmin = 1e30, tmax = -1e30;
  for (let i = 0; i < 16; i++) { const t = (px[i * 3] - mr) * ax + (px[i * 3 + 1] - mg) * ay + (px[i * 3 + 2] - mb) * az; if (t < tmin) tmin = t; if (t > tmax) tmax = t; }
  let e0 = [mr + ax * tmax, mg + ay * tmax, mb + az * tmax], e1 = [mr + ax * tmin, mg + ay * tmin, mb + az * tmin];
  let bc0 = 0, bc1 = 0, bestErr = 1e30;
  const bidx = new Uint8Array(16);
  for (let pass = 0; pass < 3; pass++) {
    let c0 = q565(e0[0], e0[1], e0[2]), c1 = q565(e1[0], e1[1], e1[2]);
    if (c0 === c1) { if (c0 < 0xffff) c0++; else c1--; }
    if (c0 < c1) { const t = c0; c0 = c1; c1 = t; }
    palette(c0, c1);
    const err = assign(px, _idx);
    if (err < bestErr) { bestErr = err; bc0 = c0; bc1 = c1; bidx.set(_idx); }
    // least squares on the current assignment
    let a = 0, b = 0, c = 0; const X = [0, 0, 0], Y = [0, 0, 0];
    for (let i = 0; i < 16; i++) { const w = W4[_idx[i]], v = 1 - w; a += w * w; b += w * v; c += v * v; for (let k = 0; k < 3; k++) { X[k] += w * px[i * 3 + k]; Y[k] += v * px[i * 3 + k]; } }
    const det = a * c - b * b;
    if (Math.abs(det) < 1e-6) break;
    e0 = [0, 1, 2].map(k => (c * X[k] - b * Y[k]) / det);
    e1 = [0, 1, 2].map(k => (a * Y[k] - b * X[k]) / det);
  }
  let bits = 0;
  for (let i = 0; i < 16; i++) bits |= bidx[i] << (2 * i);
  out[off] = bc0 & 255; out[off + 1] = bc0 >> 8; out[off + 2] = bc1 & 255; out[off + 3] = bc1 >> 8;
  out[off + 4] = bits & 255; out[off + 5] = (bits >>> 8) & 255; out[off + 6] = (bits >>> 16) & 255; out[off + 7] = (bits >>> 24) & 255;
  return bestErr;
}
// ---- BC4 (one channel, 8-level mode)
function encBC4(v, out, off) {
  let lo = 255, hi = 0;
  for (let i = 0; i < 16; i++) { if (v[i] < lo) lo = v[i]; if (v[i] > hi) hi = v[i]; }
  let r0 = Math.round(hi), r1 = Math.round(lo), err = 0;
  if (r0 === r1) { if (r0 < 255) r0++; else r1--; }
  const pal = [r0, r1];
  for (let k = 1; k < 7; k++) pal.push(((7 - k) * r0 + k * r1) / 7);
  let lowBits = 0, highBits = 0;
  for (let i = 0; i < 16; i++) {
    let best = 0, bd = 1e30;
    for (let k = 0; k < 8; k++) { const d = Math.abs(v[i] - pal[k]); if (d < bd) { bd = d; best = k; } }
    err += bd * bd;
    if (i < 8) lowBits |= best << (3 * i); else highBits |= best << (3 * (i - 8));
  }
  out[off] = r0; out[off + 1] = r1;
  out[off + 2] = lowBits & 255; out[off + 3] = (lowBits >> 8) & 255; out[off + 4] = (lowBits >> 16) & 255;
  out[off + 5] = highBits & 255; out[off + 6] = (highBits >> 8) & 255; out[off + 7] = (highBits >> 16) & 255;
  return err;
}
// per-channel RMSE of an encoded BC1 level against its source (stats only)
function rmseBC1(P, w, data) {
  const bw = Math.max(1, Math.ceil(w / 4)), e = [0, 0, 0], c0 = [0, 0, 0], c1 = [0, 0, 0];
  for (let by = 0; by < bw; by++) for (let bx = 0; bx < bw; bx++) {
    const o = (by * bw + bx) * 8, a = data[o] | (data[o + 1] << 8), b = data[o + 2] | (data[o + 3] << 8);
    const bits = (data[o + 4] | (data[o + 5] << 8) | (data[o + 6] << 16) | (data[o + 7] << 24)) >>> 0;
    x565(a, c0); x565(b, c1);
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      const x = bx * 4 + i, y = by * 4 + j;
      if (x >= w || y >= w) continue;
      const k = (bits >>> (2 * (j * 4 + i))) & 3;
      for (let ch = 0; ch < 3; ch++) {
        const v = k === 0 ? c0[ch] : k === 1 ? c1[ch] : k === 2 ? (2 * c0[ch] + c1[ch]) / 3 : (c0[ch] + 2 * c1[ch]) / 3;
        const d = v - P[ch][y * w + x]; e[ch] += d * d;
      }
    }
  }
  return e.map(q => +Math.sqrt(q / (w * w)).toFixed(2));
}
// one mip level -> block bytes (edge texels clamp for levels under 4 px)
function encodeLevel(P, w, fmt) {
  const bw = Math.max(1, Math.ceil(w / 4)), bpb = fmt === 'bc5' ? 16 : 8, out = new Uint8Array(bw * bw * bpb);
  const px = new Float32Array(48), v0 = new Float32Array(16), v1 = new Float32Array(16);
  let err = 0;
  for (let by = 0; by < bw; by++) for (let bx = 0; bx < bw; bx++) {
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      const x = Math.min(w - 1, bx * 4 + i), y = Math.min(w - 1, by * 4 + j), s = y * w + x, t = j * 4 + i;
      if (fmt === 'bc5') { v0[t] = P[0][s]; v1[t] = P[1][s]; }
      else { px[t * 3] = P[0][s]; px[t * 3 + 1] = P[1][s]; px[t * 3 + 2] = P[2][s]; }
    }
    const o = (by * bw + bx) * bpb;
    if (fmt === 'bc5') { err += encBC4(v0, out, o); err += encBC4(v1, out, o + 8); }
    else err += encBC1(px, out, o);
  }
  return { data: out, mse: err / (w * w) / (fmt === 'bc5' ? 2 : 1) };
}

// ---- KTX2 container (KHR Data Format descriptor + zstd supercompression)
const VK = { bc1: 131, bc1s: 132, bc5: 141 };
function dfd(fmt, srgb) {
  const samples = fmt === 'bc5' ? [[0, 0], [64, 1]] : [[0, 0]];
  const blockSize = 24 + 16 * samples.length, b = Buffer.alloc(4 + blockSize);
  b.writeUInt32LE(4 + blockSize, 0);
  b.writeUInt32LE(0, 4);                                   // vendor 0 (Khronos), descriptor type 0
  b.writeUInt16LE(2, 8); b.writeUInt16LE(blockSize, 10);   // version 2
  b[12] = fmt === 'bc5' ? 132 : 128;                       // colorModel: BC5 / BC1A
  b[13] = 1;                                               // primaries BT.709
  b[14] = srgb ? 2 : 1;                                    // transfer sRGB / linear
  b[15] = 0;                                               // flags: straight alpha
  b[16] = 3; b[17] = 3; b[18] = 0; b[19] = 0;              // 4x4 texel blocks
  b[20] = fmt === 'bc5' ? 16 : 8;                          // bytesPlane0
  samples.forEach(([bit, ch], i) => {
    const o = 28 + 16 * i;
    b.writeUInt16LE(bit, o); b[o + 2] = 63; b[o + 3] = ch;
    b.writeUInt32LE(0, o + 8); b.writeUInt32LE(0xffffffff, o + 12);
  });
  return b;
}
function kvd() {
  const kv = Buffer.concat([Buffer.from('KTXwriter\0'), Buffer.from('ABYSSA tools/blender/ktx2.mjs\0')]);
  const b = Buffer.alloc(4 + kv.length + ((4 - (kv.length % 4)) % 4));
  b.writeUInt32LE(kv.length, 0); kv.copy(b, 4);
  return b;
}
function writeKTX2(file, w, fmt, srgb, levels) {
  const vk = fmt === 'bc5' ? VK.bc5 : srgb ? VK.bc1s : VK.bc1;
  // through temp files, not pipes (a piped zstd once sat blocked forever on a full pipe)
  const tmp = path.join(BUILD, '.ktx2-level');
  const zs = levels.map(l => {
    fs.writeFileSync(tmp, l);
    execFileSync(ZSTD, ['-19', '-q', '-f', tmp, '-o', tmp + '.zst'], { stdio: 'ignore' });
    return fs.readFileSync(tmp + '.zst');
  });
  fs.rmSync(tmp, { force: true }); fs.rmSync(tmp + '.zst', { force: true });
  const D = dfd(fmt, srgb), K = kvd(), n = levels.length;
  const head = 80 + 24 * n, dOff = head, kOff = dOff + D.length;
  let dataOff = kOff + K.length;
  const hdr = Buffer.alloc(head);
  Buffer.from([0xAB, 0x4B, 0x54, 0x58, 0x20, 0x32, 0x30, 0xBB, 0x0D, 0x0A, 0x1A, 0x0A]).copy(hdr, 0);
  [vk, 1, w, w, 0, 0, 1, n, 2].forEach((v, i) => hdr.writeUInt32LE(v, 12 + 4 * i));
  hdr.writeUInt32LE(dOff, 48); hdr.writeUInt32LE(D.length, 52); hdr.writeUInt32LE(kOff, 56); hdr.writeUInt32LE(K.length, 60);
  hdr.writeBigUInt64LE(0n, 64); hdr.writeBigUInt64LE(0n, 72);
  // level data smallest first (the spec's recommended order); the index lists level 0 first
  const offs = new Array(n);
  for (let i = n - 1; i >= 0; i--) { offs[i] = dataOff; dataOff += zs[i].length; }
  for (let i = 0; i < n; i++) {
    const o = 80 + 24 * i;
    hdr.writeBigUInt64LE(BigInt(offs[i]), o); hdr.writeBigUInt64LE(BigInt(zs[i].length), o + 8); hdr.writeBigUInt64LE(BigInt(levels[i].byteLength), o + 16);
  }
  const parts = [hdr, D, K];
  for (let i = n - 1; i >= 0; i--) parts.push(zs[i]);
  const buf = Buffer.concat(parts);
  fs.writeFileSync(file, buf);
  return buf.length;
}

const t00 = Date.now(), stats = {};
for (const set of Object.keys(man.sets)) {
  if (ONLY.length && !ONLY.includes(set)) continue;
  const rj = path.join(BUILD, set + '_raw.json');
  if (!fs.existsSync(rj)) { console.log('ktx2: no raw dumps for', set, '(bake.py writes them when compress.tex is ktx2)'); continue; }
  const { size } = JSON.parse(fs.readFileSync(rj, 'utf8'));
  const raw = n => new Uint8Array(fs.readFileSync(path.join(BUILD, set + '_' + n + '.rgba')));
  stats[set] = {};
  for (const [name, w, fmt, srgb, mode, ch] of [
    ['albedo', size, 'bc1', true, 'srgb', [0, 1, 2]],
    ['normal', size, 'bc5', false, 'normal', [0, 1]]]) {
    const t0 = Date.now();
    if (mode === 'srgb') { WR = 0.30; WG = 0.59; WB = 0.11; } else { WR = WG = WB = 1 / 3; }
    const L = chain(planes(raw(name), w, ch), w, mode);
    const enc = L.map(l => encodeLevel(l.P, l.w, fmt));
    const bytes = writeKTX2(path.join(OUT, set + '_' + name + '.ktx2'), w, fmt, srgb, enc.map(e => e.data));
    const psnr = 10 * Math.log10(255 * 255 / Math.max(1e-9, enc[0].mse));
    stats[set][name] = { fmt, w, bytes, gpuBytes: enc.reduce((a, e) => a + e.data.byteLength, 0), psnr0: +psnr.toFixed(2) };
    if (fmt === 'bc1') stats[set][name].rmse = rmseBC1(L[0].P, w, enc[0].data);
    console.log('ktx2', set, name, fmt, w, (bytes / 1024).toFixed(0) + ' KB', 'gpu ' + (stats[set][name].gpuBytes / 1048576).toFixed(2) + ' MB', 'psnr ' + psnr.toFixed(1) + ' dB', (stats[set][name].rmse ? 'rmse ' + stats[set][name].rmse.join('/') : ''), ((Date.now() - t0) / 1000).toFixed(1) + ' s');
  }
}
// record in the creature's .json (the runtime reads meta.compress; stats are for people)
const mj = path.join(OUT, man.name + '.json');
if (fs.existsSync(mj)) {
  const meta = JSON.parse(fs.readFileSync(mj, 'utf8'));
  meta.stats = meta.stats || {};
  meta.stats.ktx2 = Object.assign(meta.stats.ktx2 || {}, stats);
  fs.writeFileSync(mj, JSON.stringify(meta));
}
console.log('ktx2 done', ((Date.now() - t00) / 1000).toFixed(1) + ' s');
