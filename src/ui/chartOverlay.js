// THE PAPER CHART — Sal's sea chart of the three anchorages. OWNED BY: chart agent.
//
// A hand-drawn chart in a dead mariner's hand, annotated over years, now Sal's.
// Menu, save file and story document at once. Everything on the sheet comes from
// site.js or is period voice kept sparse. Ink is near-black brown, pencil is grey,
// nothing glows.
//
// API (the orchestrator wires input, pointer lock and the voyage):
//   openChart(state, onChoose, onClose)  state = { currentSite, calmed }
//   closeChart()
//   isChartOpen()
// For THE PASSAGE (ui/passage.js — the voyage inked on this same sheet):
//   paintSheet(canvas, cssW, cssH, dpr, state, opts)  the whole sheet into any canvas
//   sheetObstacles(W, H, state)  where the lettering sits, for routing a course clear of it
//   letter(..., capture) / setCtx(c)  the same hand, captured as glyphs or drawn elsewhere
//
// No per-frame work while closed. Open redraws only on open / hover change / resize.

import { siteAt, siteCount, stream } from '../world/site.js';

// ---------------------------------------------------------------------------
// palette
export const INK = '#2a2018';            // near-black brown
export const INK_FADE = 'rgba(42,32,24,0.55)';
export const PENCIL = 'rgba(90,88,84,0.85)';
export const PENCIL_SOFT = 'rgba(96,94,90,0.6)';
const RED_FADE = 'rgba(140,52,40,0.55)';
export const PAPER = '#d8c9a3';
// The sheet LIES on the chart table (Michael, 2026-10-04: "Soft, close shadow"): a
// contact shadow hugging the deckle and a short soft skirt, no float. Was
// drop-shadow(0 18px 42px rgba(0,0,0,.65)) — that read as a UI card hovering.
export const PAPER_SHADOW = 'drop-shadow(0 1px 1.5px rgba(0,0,0,.55)) drop-shadow(0 3px 7px rgba(0,0,0,.32))';

// anchorage placement on the sheet (fractions of canvas w/h)
export const SPOTS = [
  { x: 0.235, y: 0.640 },   // THE HOME MOORING — lower-left-ish
  { x: 0.685, y: 0.270 },   // PALLID BANK — upper-right
  { x: 0.720, y: 0.700 },   // THE BURNED GROUND — lower-right
  { x: 0.435, y: 0.430 }    // THE UNSOUNDED SHELF — blank water, mid-sheet
];

// ---------------------------------------------------------------------------
// module state
let root = null, paperC = null, ctx = null;
let openFlag = false;
let curState = null, chooseCb = null, closeCb = null;
let hoverIdx = -1;
let hitRects = [];                // {x,y,w,h,i} in CSS pixels
let styleDone = false;
let passOpts = null;              // set only while paintSheet runs (null = the chart table)

function injectStyle() {
  if (styleDone) return;
  styleDone = true;
  const css = document.createElement('style');
  css.textContent = `
  #chartWrap{position:fixed;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;
    background:rgba(1,4,9,.78);pointer-events:auto;opacity:0;transition:opacity .35s}
  #chartWrap.on{opacity:1}
  #chartPaper{width:min(78vw,1100px);aspect-ratio:3/2;display:block;
    position:relative;top:auto;left:auto;height:auto;z-index:auto;
    filter:${PAPER_SHADOW};cursor:default}
  `;
  // (position..z-index: index.html's page-wide canvas rule — fixed, top-left, 100vh,
  // there for the WebGL canvas — used to win here, pinning the sheet to the window's
  // top-left corner at full height instead of a centred 3:2 sheet.)
  document.head.appendChild(css);
}

// ---------------------------------------------------------------------------
// lettering: period hand — serif small caps, letter-spaced, slight per-glyph jitter.
// `capture` (an array) records each glyph { ch, x, y, rot, font, color } instead of
// drawing it — the passage letters a name in glyph by glyph at exactly these places.
// Either way the rng is consumed identically, so the rest of the sheet never shifts.
export function letter(text, x, y, px, tracking, color, rng, align = 'center', capture = null) {
  ctx.save();
  ctx.fillStyle = color;
  const font = `${px}px Georgia, 'Times New Roman', serif`;
  ctx.font = font;
  ctx.textBaseline = 'alphabetic';
  const widths = [];
  let total = 0;
  for (const ch of text) { const w = ctx.measureText(ch).width + tracking; widths.push(w); total += w; }
  let cx = align === 'center' ? x - total / 2 : x;
  let i = 0;
  for (const ch of text) {
    const rot = (rng() - 0.5) * 0.045;
    const jy = (rng() - 0.5) * px * 0.06;
    if (capture) {
      if (ch !== ' ') capture.push({ ch, x: cx, y: y + jy, rot, font, color });
    } else {
      ctx.save();
      ctx.translate(cx, y + jy);
      ctx.rotate(rot);
      ctx.fillText(ch, 0, 0);
      ctx.restore();
    }
    cx += widths[i++];
  }
  ctx.restore();
  return total;
}

// Point the hand at another canvas (the passage's layers); returns the previous one.
export function setCtx(c) { const p = ctx; ctx = c; return p; }

// A label line that must stay on the sheet. On a narrow sheet the lettering's minimum
// sizes (names 10 px, conditions 8 px) outgrow the W-relative layout and the long
// conditions lines ran off the paper past the border rule (THE SLEEPERS SIT SHALLOW at
// a 640 px window). Fit the line inside the inner border, centred where it was: close the
// letter-spacing first (down to a quarter), then the size (never under 6.5 px). A no-op
// at every ordinary size. Shared by the draw, the hit rects and sheetObstacles.
const FIT = { px: 0, tr: 0, w: 0 };
function fitLine(text, x, px, tracking, W) {
  const m = Math.round(W * 0.025), avail = 2 * Math.min(x - (m + 9), W - (m + 9) - x);
  let w = measure(text, px, tracking);
  if (w > avail) {
    const n = [...text].length;
    tracking = Math.max(tracking * 0.25, tracking - (w - avail) / n);
    w = measure(text, px, tracking);
    if (w > avail) { px = Math.max(6.5, px * avail / w); w = measure(text, px, tracking); }
  }
  FIT.px = px; FIT.tr = tracking; FIT.w = w;
  return FIT;
}

export function measure(text, px, tracking) {
  ctx.font = `${px}px Georgia, 'Times New Roman', serif`;
  let total = 0;
  for (const ch of text) total += ctx.measureText(ch).width + tracking;
  return total;
}

// slightly unsteady ink line
function inkLine(x0, y0, x1, y1, rng, width = 1) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  const n = 4;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    ctx.lineTo(x0 + (x1 - x0) * t + (rng() - 0.5) * 1.2, y0 + (y1 - y0) * t + (rng() - 0.5) * 1.2);
  }
  ctx.lineWidth = width;
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// draw layers, in order:
//  1 deckled-edge clip + parchment fill
//  2 mottling (broad translucent patches)
//  3 stains / blotches
//  4 fold creases (two)
//  5 edge vignette
//  6 border rule (double ink line)
//  7 open-water soundings (fathom numerals)
//  8 compass rose
//  9 anchorages (anchor, ring, name, conditions, calmed strikes, hover underline)
// 10 title + margin note
function draw(state) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cssW = paperC.clientWidth, cssH = paperC.clientHeight;
  if (cssW === 0) return;
  paperC.width = Math.round(cssW * dpr);
  paperC.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  hitRects.length = 0;
  sheet(cssW, cssH, state, null);
}

// The whole sheet into any canvas at any size — the passage paints the same chart.
// opts: { hideName: i }  that anchorage's name is held back (the passage letters it in
//       on arrival; `captured` receives its glyphs) — rng consumed as if drawn.
export function paintSheet(canvas, cssW, cssH, dpr, state, opts) {
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const prev = ctx;
  ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  sheet(cssW, cssH, state, opts || {});
  ctx = prev;
}

function sheet(W, H, state, opts) {
  passOpts = opts;

  const rng = stream(0xC4A87001);           // deterministic: same sheet every open

  // -- 1 deckled edge ------------------------------------------------------
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  const edge = [];
  const per = 26;
  const deckle = () => (rng() - 0.5) * 7;
  for (let i = 0; i <= per; i++) edge.push([W * i / per + (i && i < per ? deckle() : 0), Math.max(0, deckle() + 3)]);
  for (let i = 0; i <= per; i++) edge.push([W - 3 + deckle() * 0.6, H * i / per]);
  for (let i = per; i >= 0; i--) edge.push([W * i / per + (i && i < per ? deckle() : 0), H - 3 + Math.min(0, deckle())]);
  for (let i = per; i >= 0; i--) edge.push([Math.max(0, 3 + deckle() * 0.6), H * i / per]);
  ctx.beginPath();
  ctx.moveTo(edge[0][0], edge[0][1]);
  for (let i = 1; i < edge.length; i++) ctx.lineTo(edge[i][0], edge[i][1]);
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);

  // -- 2 mottling ----------------------------------------------------------
  for (let i = 0; i < 60; i++) {
    const x = rng() * W, y = rng() * H, r = 30 + rng() * 90;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const warm = rng() > 0.5;
    g.addColorStop(0, warm ? 'rgba(184,158,110,0.045)' : 'rgba(226,216,188,0.05)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // -- 3 stains ------------------------------------------------------------
  for (let i = 0; i < 5; i++) {
    const x = rng() * W, y = rng() * H, r = 14 + rng() * 34;
    const g = ctx.createRadialGradient(x, y, r * 0.55, x, y, r);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.8, `rgba(122,96,52,${0.05 + rng() * 0.06})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.7 + rng() * 0.5), rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  // -- 4 fold creases ------------------------------------------------------
  const crease = (vertical, at) => {
    const g = vertical
      ? ctx.createLinearGradient(at - 7, 0, at + 7, 0)
      : ctx.createLinearGradient(0, at - 7, 0, at + 7);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.46, 'rgba(74,58,34,0.10)');
    g.addColorStop(0.5, 'rgba(74,58,34,0.16)');
    g.addColorStop(0.54, 'rgba(240,232,208,0.10)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    if (vertical) ctx.fillRect(at - 7, 0, 14, H); else ctx.fillRect(0, at - 7, W, 14);
  };
  crease(true, W * 0.5 + (rng() - 0.5) * 8);
  crease(false, H * 0.5 + (rng() - 0.5) * 8);

  // -- 5 edge vignette -----------------------------------------------------
  const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.42, W / 2, H / 2, Math.max(W, H) * 0.72);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(84,64,34,0.30)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  // -- 6 border rule -------------------------------------------------------
  ctx.strokeStyle = INK_FADE;
  const m = Math.round(W * 0.025);
  ctx.lineWidth = 1.4;
  ctx.strokeRect(m, m, W - 2 * m, H - 2 * m);
  ctx.lineWidth = 0.7;
  ctx.strokeRect(m + 5, m + 5, W - 2 * m - 10, H - 2 * m - 10);

  // -- 7 soundings ---------------------------------------------------------
  ctx.fillStyle = 'rgba(42,32,24,0.42)';
  const sRng = stream(0x50D1265);
  const lab = sheetObstacles(W, H, state).rects;
  for (let i = 0; i < 46; i++) {
    const x = m + 30 + sRng() * (W - 2 * m - 60);
    const y = m + 30 + sRng() * (H - 2 * m - 60);
    // keep clear of anchorage labels and the rose
    let clear = true;
    for (const s of SPOTS) if (Math.hypot(x - s.x * W, y - s.y * H) < W * 0.085) clear = false;
    if (Math.hypot(x - W * 0.155, y - H * 0.30) < W * 0.075) clear = false;
    if (!clear) continue;
    const f = 8 + Math.floor(sRng() * 90);
    const px = 9 + sRng() * 2.5;
    const rot = (sRng() - 0.5) * 0.22;
    // ...and off the long conditions lines, which run far wider than that radius (a
    // sounding printed into SIT SHALLOW). Tested after all its draws, so every other
    // sounding keeps its place and figure.
    const fw = px * (f > 9 ? 1.15 : 0.6);
    let onLabel = false;
    for (const r of lab) if (x + fw > r.x0 - 3 && x < r.x1 + 3 && y > r.y0 - 2 && y - px < r.y1 + 2) onLabel = true;
    if (onLabel) continue;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.font = `${px}px Georgia, 'Times New Roman', serif`;
    ctx.fillText(String(f), 0, 0);
    ctx.restore();
  }

  // -- 8 compass rose ------------------------------------------------------
  drawRose(W * 0.155, H * 0.30, W * 0.052, rng);

  // -- 9 anchorages --------------------------------------------------------
  const n = Math.min(siteCount(), SPOTS.length);
  for (let i = 0; i < n; i++) drawAnchorage(i, W, H, state, rng);

  // -- 10 title + margin note ---------------------------------------------
  const tRng = stream(0x717713);
  letter('THE THREE ANCHORAGES', W / 2, m + H * 0.058, Math.max(13, W * 0.0165), W * 0.008, INK, tRng);
  inkLineCentered(W / 2, m + H * 0.072, W * 0.11, tRng);
  letter('SOUNDINGS IN FATHOMS', W / 2, m + H * 0.095, Math.max(8, W * 0.0082), W * 0.004, INK_FADE, tRng);
  // margin note in the dead owner's hand, then Sal's pencil beneath
  // (Michael, 2026-10-04: "Replace it" — the old line, WHAT SLEEPS WILL WAKE FOR NOISE,
  // stopped being true when the three sleepers came: they wake to a taking, a furnace.)
  letter('WHAT SLEEPS GUARDS WHAT IT KEEPS', W * 0.5, H - m - H * 0.030, Math.max(8, W * 0.0085), W * 0.004, INK_FADE, tRng);

  ctx.restore();
  passOpts = null;
}

// Where the sheet's lettering and marks sit (CSS px of a W x H sheet), so the passage
// can rule a course that never crosses a name. Same arithmetic as the draw. Needs a
// context for measuring: call after setCtx() or paintSheet().
//   { m, aS, namePx, condPx, rects: [{x0,y0,x1,y1,site}], circles: [{x,y,r,site}] }
export function sheetObstacles(W, H, state) {
  const m = Math.round(W * 0.025);
  const aS = W * 0.016;
  const namePx = Math.max(10, W * 0.0122);
  const condPx = Math.max(8, W * 0.0084);
  const rects = [], circles = [];
  const n = Math.min(siteCount(), SPOTS.length);
  for (let i = 0; i < n; i++) {
    const site = siteAt(i);
    if (!site) continue;
    const x = SPOTS[i].x * W, y = SPOTS[i].y * H;
    const found = !site.hidden || (state.found && state.found[i]);
    circles.push({ x, y, r: aS * 1.5, site: i });
    if (!found) continue;
    const nameY = y + aS * 2.6, condY = nameY + condPx * 1.7;
    const nw = fitLine(site.name, x, namePx, W * 0.0042, W).w / 2;
    const cw = fitLine(site.conditions, x, condPx, W * 0.0022, W).w / 2;
    rects.push({ x0: x - nw, y0: nameY - namePx * 0.85, x1: x + nw, y1: nameY + namePx * 0.25, site: i });
    const calmed = (state.calmed && state.calmed[i]) || [];
    const struck = (calmed[0] ? 1 : 0) + (calmed[1] ? 1 : 0) + (calmed[2] ? 1 : 0);
    rects.push({ x0: x - cw, y0: condY - condPx * 0.85, x1: x + cw, y1: condY + (struck ? condPx * 1.9 : condPx * 0.25), site: i });
  }
  // the rose with its letters, the title block, the margin note
  circles.push({ x: W * 0.155, y: H * 0.30 + W * 0.004, r: W * 0.052 * 1.5, site: -1 });
  const tw = measure('THE THREE ANCHORAGES', Math.max(13, W * 0.0165), W * 0.008) / 2;
  rects.push({ x0: W / 2 - tw, y0: m + H * 0.035, x1: W / 2 + tw, y1: m + H * 0.102, site: -1 });
  const mpx = Math.max(8, W * 0.0085);
  const mw = measure('WHAT SLEEPS GUARDS WHAT IT KEEPS', mpx, W * 0.004) / 2;
  rects.push({ x0: W / 2 - mw, y0: H - m - H * 0.030 - mpx, x1: W / 2 + mw, y1: H - m - H * 0.030 + mpx * 0.3, site: -1 });
  return { m, aS, namePx, condPx, rects, circles };
}

function inkLineCentered(cx, y, halfW, rng) {
  ctx.strokeStyle = INK_FADE;
  inkLine(cx - halfW, y, cx + halfW, y, rng, 0.8);
}

function drawRose(cx, cy, r, rng) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = 0.9;
  // rings
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2); ctx.lineWidth = 0.5; ctx.stroke();
  // eight points, long cardinals short intercardinals
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4 - Math.PI / 2;
    const len = (k % 2 === 0) ? r * 0.95 : r * 0.55;
    const half = r * 0.10;
    const px = Math.cos(a), py = Math.sin(a);
    const qx = -py, qy = px;
    const north = (k === 0);
    ctx.beginPath();
    ctx.moveTo(px * len, py * len);
    ctx.lineTo(qx * half, qy * half);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fillStyle = north ? RED_FADE : INK;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(px * len, py * len);
    ctx.lineTo(-qx * half, -qy * half);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fillStyle = north ? RED_FADE : 'rgba(42,32,24,0.25)';
    ctx.fill();
  }
  ctx.fillStyle = INK;
  letter('N', 0, -r * 1.18, r * 0.34, 0, RED_FADE, rng);
  letter('S', 0, r * 1.42, r * 0.34, 0, INK_FADE, rng);
  letter('E', r * 1.28, r * 0.12, r * 0.34, 0, INK_FADE, rng);
  letter('W', -r * 1.28, r * 0.12, r * 0.34, 0, INK_FADE, rng);
  ctx.restore();
}

// small fouled anchor in ink at (x,y); scale s ~ half-height
function drawAnchor(x, y, s, color, rng) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((rng() - 0.5) * 0.06);
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.1, s * 0.13);
  ctx.lineCap = 'round';
  // shank
  ctx.beginPath(); ctx.moveTo(0, -s * 0.75); ctx.lineTo(0, s * 0.8); ctx.stroke();
  // ring
  ctx.beginPath(); ctx.arc(0, -s * 0.92, s * 0.2, 0, Math.PI * 2); ctx.stroke();
  // stock
  ctx.beginPath(); ctx.moveTo(-s * 0.5, -s * 0.55); ctx.lineTo(s * 0.5, -s * 0.55); ctx.stroke();
  // arms + flukes
  ctx.beginPath(); ctx.arc(0, s * 0.25, s * 0.62, Math.PI * 0.12, Math.PI * 0.88); ctx.stroke();
  const fl = (sx) => {
    const ax = sx * s * 0.605, ay = s * 0.25 + Math.sin(Math.PI * 0.12) * s * 0.62;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax + sx * s * 0.22, ay - s * 0.3);
    ctx.stroke();
  };
  fl(1); fl(-1);
  ctx.restore();
}

function drawAnchorage(i, W, H, state, rng) {
  const site = siteAt(i);
  if (!site) return;
  const x = SPOTS[i].x * W, y = SPOTS[i].y * H;
  const aS = W * 0.016;
  const isCur = state.currentSite === i;
  const namePx = Math.max(10, W * 0.0122);
  const condPx = Math.max(8, W * 0.0084);

  // A hidden anchorage the sounding set has not yet given up: blank water and a
  // pencil question mark in Sal's hand. Not an anchorage yet — no name, no hit.
  const found = !site.hidden || (state.found && state.found[i]);
  if (!found) {
    letter('?', x, y + aS, aS * 2.4, 0, PENCIL_SOFT, rng);
    return;
  }

  // The dead owner drew three anchorages in ink. A discovered one is Sal's:
  // everything at this spot goes down in pencil.
  const hand = site.hidden ? PENCIL : INK;
  const handFade = site.hidden ? PENCIL_SOFT : INK_FADE;

  drawAnchor(x, y, aS, hand, rng);

  // current anchorage: pencil ring + note
  if (isCur) {
    ctx.save();
    ctx.strokeStyle = PENCIL;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    const rr = aS * 2.1;
    for (let k = 0; k <= 26; k++) {
      const a = k / 26 * Math.PI * 2.04 - 0.4;      // slightly overlapped, hand-drawn
      const wob = 1 + (rng() - 0.5) * 0.09;
      const px = x + Math.cos(a) * rr * wob, py = y + Math.sin(a) * rr * 0.92 * wob;
      k === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.restore();
    letter('YOU RIDE HERE', x, y - aS * 2.9, condPx, W * 0.003, PENCIL, rng);
  }

  // name + conditions
  const nameY = y + aS * 2.6;
  const held = passOpts && passOpts.hideName === i;
  const nf = fitLine(site.name, x, namePx, W * 0.0042, W), nPx = nf.px, nTr = nf.tr, nW = nf.w;
  letter(site.name, x, nameY, nPx, nTr, hand, rng, 'center', held ? (passOpts.captured = []) : null);
  const condY = nameY + condPx * 1.7;
  const cf = fitLine(site.conditions, x, condPx, W * 0.0022, W), cW = cf.w;
  letter(site.conditions, x, condY, cf.px, cf.tr, handFade, rng);

  // calmed sleepers: pencil strike marks, one per becalmed sleeper
  const calmed = (state.calmed && state.calmed[i]) || [];
  let struck = 0;
  for (let k = 0; k < 3; k++) if (calmed[k]) struck++;
  if (struck > 0) {
    ctx.save();
    ctx.strokeStyle = PENCIL;
    ctx.lineCap = 'round';
    const mw = W * 0.018, gap = W * 0.009;
    const total = struck * mw + (struck - 1) * gap;
    let sx = x - total / 2;
    const sy = condY + condPx * 1.5;
    for (let k = 0; k < struck; k++) {
      ctx.lineWidth = 1.5 + rng() * 0.7;
      inkLine(sx, sy + (rng() - 0.5) * 2, sx + mw, sy + (rng() - 0.5) * 2, rng);
      sx += mw + gap;
    }
    ctx.restore();
  }

  // hover: faint pencil underline beneath the name
  if (hoverIdx === i && !isCur && !passOpts) {
    ctx.save();
    ctx.strokeStyle = PENCIL_SOFT;
    const hw = measure(site.name, nPx, nTr) / 2;
    ctx.lineWidth = 1.1;
    inkLine(x - hw, nameY + namePx * 0.35, x + hw, nameY + namePx * 0.35, rng);
    ctx.restore();
  }

  // hit region: from above the anchor to below the conditions line
  if (passOpts) return;
  const hw = Math.max(nW, cW) / 2 + 8;
  hitRects.push({ x: x - hw, y: y - aS * 3.4, w: hw * 2, h: (condY + condPx * 2.4) - (y - aS * 3.4), i });
}

// ---------------------------------------------------------------------------
// interaction
function hitTest(e) {
  const r = paperC.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  for (const h of hitRects) if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h.i;
  return -1;
}

function onMove(e) {
  const i = hitTest(e);
  if (i !== hoverIdx) {
    hoverIdx = i;
    paperC.style.cursor = i >= 0 ? 'pointer' : 'default';
    draw(curState);
  }
}

function onClick(e) {
  e.stopPropagation();
  const i = hitTest(e);
  if (i < 0) return;
  if (i === curState.currentSite) { doClose(false); return; }
  const cb = chooseCb;
  doClose(false);
  if (cb) cb(i);
}

function onBackdrop(e) {
  if (e.target === root) doClose(true);
}

function onKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); doClose(true); }
}

function onResize() { if (openFlag) draw(curState); }

function doClose(fireClose) {
  if (!openFlag) return;
  openFlag = false;
  window.removeEventListener('keydown', onKey, true);
  window.removeEventListener('resize', onResize);
  const cb = closeCb;
  chooseCb = null; closeCb = null;
  hoverIdx = -1;
  root.classList.remove('on');
  const el = root;
  setTimeout(() => { if (!openFlag && el.parentNode) el.style.display = 'none'; }, 380);
  if (fireClose && cb) cb();
}

// ---------------------------------------------------------------------------
// public API
export function openChart(state, onChoose, onClose) {
  injectStyle();
  if (!root) {
    root = document.createElement('div');
    root.id = 'chartWrap';
    paperC = document.createElement('canvas');
    paperC.id = 'chartPaper';
    root.appendChild(paperC);
    (document.getElementById('ui') || document.body).appendChild(root);
    ctx = paperC.getContext('2d');
    root.addEventListener('click', onBackdrop);
    paperC.addEventListener('mousemove', onMove);
    paperC.addEventListener('click', onClick);
  }
  curState = {
    currentSite: (state && state.currentSite) | 0,
    calmed: (state && state.calmed) || [],
    found: (state && state.found) || null   // null = everything authored is known
  };
  chooseCb = onChoose || null;
  closeCb = onClose || null;
  hoverIdx = -1;
  openFlag = true;
  root.style.display = 'flex';
  // force layout so the fade-in transition runs, then draw at real size
  void root.offsetWidth;
  root.classList.add('on');
  draw(curState);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onResize);
}

export function closeChart() { doClose(false); }

export function isChartOpen() { return openFlag; }
