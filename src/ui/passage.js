// THE PASSAGE — the voyage, inked. OWNED BY: chart agent.
//
// Michael, 2026-10-04 ("Inked chart passage"): the hold-at-black is gone. As the sea
// fades, the paper chart comes up under the lamp and fills the screen, and Sal's course
// inks itself from the departure anchorage to the destination — a dip-pen line ruled in
// three legs, wobbling a little in the hand, pooling where the nib rests, thinning and
// splitting dry on a long stroke, dead-reckoning ticks along it, the two position fixes
// ringed and lettered in the chart's own hand. The raft's little pencil mark rides the
// line. The bell rings as the nib touches the mark, the destination's name is lettered
// in, and the chart dissolves into the new water. It IS the chart at the table: the sheet
// is painted by ui/chartOverlay.js's own renderer, lettering by its `letter()`.
//
// THE HITCH. The world reseeds during the passage (game.js reseedWorld: measured 0.5-0.67 s
// of main thread in a headless Chrome on this machine, plus 0.1-0.25 s for the first
// render after it, and sometimes a second slow frame). Nothing the main thread draws can
// move while that runs, so the reseed is SCHEDULED where nothing is meant to move: the
// moment the chart has come up and lies under the lamp, before the pen goes down — the
// navigator's look at the sheet (PT.RESEED .. PT.REST_END). The passage clock runs on
// WALL time: inside that beat it swallows any wall gap whole, and it does not leave the
// beat until the world has SETTLED (two consecutive frames under 50 ms after the reseed),
// so a slow machine gets a longer look, never a stutter in the line. Everywhere else one
// frame advances the clock at most 50 ms (the game's own dt clamp), so a stray stall
// costs a little time and never jumps the nib. What keeps the still beat alive is
// compositor-thread CSS: the sheet's slow sway on the rolling table, the push-in and the
// lamp's flicker animate transform/opacity only, and Chrome runs those off the main
// thread straight through a stall.
//
// API (game.js wires it; it owns the reseed, the bell and the state change):
//   startPassage(from, to, chartState)   build the sheet + route (a load event: allocates)
//   updatePassage(hold) -> event bits    once per frame in the voyage state; hold = paused
//       PEV_RESEED  reseed the world now (once)      PEV_BELL  the nib touched the mark
//       PEV_DONE    the chart has dissolved: back to play
//   setPassageSound(fn)                  fn(kind, dur, pan0, pan1, dry): 'stroke' | 'ring' | 'letter' | 'tick'
//   PT                                   the timeline (seconds on the passage clock)
//
// Per frame: no allocation outside the 2D canvas API itself (typed arrays and module
// state, built at start; the DOM and canvases are built once and reused every voyage).

import { paintSheet, sheetObstacles, setCtx, letter, SPOTS, INK, INK_FADE, PENCIL, PAPER, PAPER_SHADOW } from './chartOverlay.js';
import { siteAt, stream } from '../world/site.js';

// ---------------------------------------------------------------------------
// THE TIMELINE (passage clock, seconds). Nominal 5.95 s; the look at the sheet stretches
// by however much of the reseed's stall overruns its 0.3 s (~0.5-0.7 s here), so ~6.5 s
// of wall time on this machine. The old fade / black / return was 6.2 s.
export const PT = {
  BACK_IN: [0.0, 0.85],     // the sea darkens to the lamp-lit table
  SHEET_IN: [0.15, 0.95],   // the chart comes up into the lamplight (no hard cut)
  RESEED: 1.0,              // the world reseeds under the opaque sheet — its stall lands in...
  REST_END: 1.3,            // ...the look at the chart before the pen goes down (min; waits to settle)
  RING_OUT: [1.3, 1.95],    // YOU RIDE HERE is rubbed out at the departure
  LEG1: [1.3, 2.12],        // nib set down; the first leg ruled to the first fix
  FIX1_RING: [2.18, 2.4],   // the fix ringed
  FIX1_LABEL: [2.34, 2.64], // and dated
  LEG2: [2.68, 3.32],
  FIX2_RING: [3.32, 3.48],
  FIX2_LABEL: [3.42, 3.64],
  LEG3: [3.68, 4.32],       // the last leg, drier, into the mark
  BELL: 4.32,               // the nib touches the anchorage: the ship's bell
  NAME: [4.4, 4.9],         // the destination's name lettered in
  OUT: [4.7, 5.95],         // the chart dissolves into the new water
  END: 5.95
};
export const PEV_RESEED = 1, PEV_BELL = 2, PEV_DONE = 4;

const FIX_LABELS = ['4 BELLS', '8 BELLS'];   // the fixes, dated by the watch's bells
const INK_WET = '#1e150d';                    // fresh ink: deeper than the owner's dried brown
const SHEEN = 'rgba(255,238,206,0.55)';       // the lamp on wet ink
const BEAD = '#120b06';

// ---------------------------------------------------------------------------
// DOM (built once)
let root = null, pushEl = null, swayEl = null, baseC = null, inkC = null, topC = null;
let inkX = null, topX = null, sheetC = null;
const PAD = 16;   // CSS px round the sheet on the base canvas: room for its baked shadow
let sound = null;
export function setPassageSound(fn) { sound = fn; }

function build() {
  const css = document.createElement('style');
  css.textContent = `
  #passage{position:fixed;inset:0;z-index:15;pointer-events:none;display:none;opacity:0;overflow:hidden;
    background:radial-gradient(ellipse 80% 75% at 42% 38%,#1b130b 0%,#0d0906 52%,#040302 100%)}
  #passage .ps-push{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;will-change:transform}
  #passage .ps-sway{position:relative;flex:none;will-change:transform,opacity}
  #passage canvas{position:absolute;left:0;top:0;width:100%;height:100%;display:block}
  #passage canvas.ps-base{left:-${PAD}px;top:-${PAD}px;width:calc(100% + ${2 * PAD}px);height:calc(100% + ${2 * PAD}px)}
  #passage .ps-ink{mix-blend-mode:multiply}
  #passage .ps-lamp{position:absolute;inset:0;will-change:opacity;
    background:radial-gradient(ellipse 72% 68% at 40% 36%,rgba(255,200,130,.075) 0%,rgba(0,0,0,0) 46%,rgba(5,3,1,.28) 80%,rgba(2,1,0,.58) 100%)}
  #passage.run .ps-push{animation:psPush ${PT.END}s cubic-bezier(.25,0,.55,1) forwards}
  #passage.run .ps-sway{animation:psSway 5.6s ease-in-out infinite alternate}
  #passage.run .ps-lamp{animation:psLamp 4.3s linear infinite}
  #passage.hold .ps-push,#passage.hold .ps-sway,#passage.hold .ps-lamp{animation-play-state:paused}
  @keyframes psPush{from{transform:scale(1)}to{transform:scale(1.06)}}
  @keyframes psSway{0%{transform:translate(-1.5px,1px) rotate(-.24deg)}100%{transform:translate(1.5px,-1.5px) rotate(.26deg)}}
  @keyframes psLamp{0%{opacity:1}17%{opacity:.93}24%{opacity:.98}46%{opacity:.9}52%{opacity:.97}71%{opacity:.92}88%{opacity:1}100%{opacity:1}}
  @media (prefers-reduced-motion: reduce){#passage.run .ps-push,#passage.run .ps-sway,#passage.run .ps-lamp{animation:none}}
  `;
  document.head.appendChild(css);
  root = document.createElement('div');
  root.id = 'passage';
  pushEl = document.createElement('div'); pushEl.className = 'ps-push';
  swayEl = document.createElement('div'); swayEl.className = 'ps-sway';
  baseC = document.createElement('canvas'); baseC.className = 'ps-base';
  inkC = document.createElement('canvas'); inkC.className = 'ps-ink';
  topC = document.createElement('canvas'); topC.className = 'ps-top';
  const lamp = document.createElement('div'); lamp.className = 'ps-lamp';
  swayEl.append(baseC, inkC, topC);
  pushEl.appendChild(swayEl);
  root.append(pushEl, lamp);
  document.body.appendChild(root);
  sheetC = document.createElement('canvas');
  inkX = inkC.getContext('2d');
  topX = topC.getContext('2d');
}

// ---------------------------------------------------------------------------
// route + ink samples (typed arrays, sized once)
const MAXS = 6144;
const sx = new Float32Array(MAXS), sy = new Float32Array(MAXS), sw = new Float32Array(MAXS);
const sm = new Uint8Array(MAXS);                 // 0 ink, 1 railroad (dry tines), 2 gap, 3 stroke start
const sAt = new Float32Array(MAXS);              // passage time the sample was inked (wet sheen)
const nxA = new Float32Array(MAXS), nyA = new Float32Array(MAXS);
let nS = 0;
const legI0 = new Int32Array(3), legI1 = new Int32Array(3);
const MAXT = 128;
const tkI = new Int32Array(MAXT), tkX = new Float32Array(MAXT), tkY = new Float32Array(MAXT), tkNX = new Float32Array(MAXT), tkNY = new Float32Array(MAXT);
let nT = 0, tkDone = 0;
const ptX = new Float32Array(4), ptY = new Float32Array(4);   // start, fix1, fix2, end (on the paper)
let W = 0, H = 0, dpr = 1, U = 1;                             // sheet CSS size, canvas scale, line unit
let P = 0, prevP = 0, lastNow = 0, live = false, drawn = 0, poolsDone = 0, reseedFired = false, calm = 0;
let glyphs = [], fixGlyphs = [[], []], ringPts = null, yrhGlyphs = [], fixR = 0;
let ringDone = [0, 0], labelDone = [0, 0], nameDone = 0, hand = INK;
const stats = { maxMoveGap: 0, restGap: 0, reseedP: -1, frames: 0 };
let lastOp = -1, lastSwayOp = -1, held = false;

// 1D value noise from a fixed table (deterministic; no Math.random)
const NT = new Float32Array(256);
{ const r = stream(0x1A7E5EED); for (let i = 0; i < 256; i++) NT[i] = r() * 2 - 1; }
function noise1(x) {
  const i = Math.floor(x), f = x - i, a = NT[i & 255], b = NT[(i + 1) & 255];
  const u = f * f * (3 - 2 * f);
  return a + (b - a) * u;
}
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const span = (a, t) => clamp01((t - a[0]) / (a[1] - a[0]));
const smooth = u => u * u * (3 - 2 * u);
// the hand along a ruled leg: off the mark briskly, steady, easing into the fix
const nibEase = u => ((-0.95 * u + 1.25) * u + 0.7) * u;

// ---- obstacle cost: how badly a point sits on lettering --------------------------------
let OB = null, CLEAR = 20, FROM = 0, TO = 0;
function pointCost(x, y, clear) {
  let c = 0;
  const m = OB.m + 14;
  if (x < m) c += (m - x) * (m - x) * 4; else if (x > W - m) c += (x - W + m) * (x - W + m) * 4;
  if (y < m) c += (m - y) * (m - y) * 4; else if (y > H - m) c += (y - H + m) * (y - H + m) * 4;
  for (let k = 0; k < OB.rects.length; k++) {
    const r = OB.rects[k];
    const dx = Math.max(r.x0 - x, 0, x - r.x1), dy = Math.max(r.y0 - y, 0, y - r.y1);
    let d = Math.hypot(dx, dy);
    if (d === 0) d = -Math.min(x - r.x0, r.x1 - x, y - r.y0, r.y1 - y);
    if (d < clear) c += (clear - d) * (clear - d);
  }
  for (let k = 0; k < OB.circles.length; k++) {
    const q = OB.circles[k];
    if (q.site === FROM || q.site === TO) continue;   // the route starts and ends on these
    const d = Math.hypot(x - q.x, y - q.y) - q.r;
    if (d < clear) c += (clear - d) * (clear - d);
  }
  return c;
}
function segCost(ax, ay, bx, by) {
  const L = Math.hypot(bx - ax, by - ay), n = Math.max(2, Math.ceil(L / 6));
  let c = 0;
  for (let i = 0; i <= n; i++) { const t = i / n; c += pointCost(ax + (bx - ax) * t, ay + (by - ay) * t, CLEAR); }
  return c * (L / n) / 6;                  // per ~6 px of line, whatever the sampling
}

// Where a fix's date goes: beside the fix, off the line, on whichever side is clearer.
// The text is horizontal (the chart's hand), so a steep leg pushes it out by half its
// width. Tries the normals of both legs meeting at the fix; returns the cost, and the
// chosen centre in LBL_X/LBL_Y.
let LBL_X = 0, LBL_Y = 0;
function labelSpot(fx, fy, ax, ay, bx, by) {
  const hw = W * 0.026, off = W * 0.02;
  let best = Infinity;
  for (let leg = 0; leg < 2; leg++) {
    const dx = leg ? bx - fx : fx - ax, dy = leg ? by - fy : fy - ay, d = Math.hypot(dx, dy) || 1;
    const nx = -dy / d, ny = dx / d;
    for (let sg = -1; sg <= 1; sg += 2) {
      const k = off + Math.abs(nx) * hw;
      const cx = fx + nx * k * sg, cy = fy + ny * k * sg;
      const c = pointCost(cx - hw, cy, CLEAR) + pointCost(cx, cy, CLEAR) + pointCost(cx + hw, cy, CLEAR)
        + lineNear(cx, cy, hw, ax, ay, fx, fy) + lineNear(cx, cy, hw, fx, fy, bx, by);
      if (c < best) { best = c; LBL_X = cx; LBL_Y = cy; }
    }
  }
  return best;
}
// a label box crossed by one of the course's own legs
function lineNear(cx, cy, hw, ax, ay, bx, by) {
  let c = 0;
  for (let i = 0; i <= 12; i++) {
    const t = i / 12, x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
    const dx = Math.max(cx - hw - x, 0, x - cx - hw), dy = Math.max(cy - W * 0.009 - y, 0, y - cy - W * 0.004);
    const d = Math.hypot(dx, dy);
    if (d < W * 0.008) c += 400;
  }
  return c;
}

// Rule a course: three rhumb legs, P0 -> F1 -> F2 -> P1, the fixes where the course
// alters. Searched (deterministic) to keep every leg off the sheet's lettering, the rose
// and the borders, short, with honest turns and legs of comparable length.
function planRoute(from, to) {
  const x0 = SPOTS[from].x * W, y0 = SPOTS[from].y * H, x1 = SPOTS[to].x * W, y1 = SPOTS[to].y * H;
  const L = Math.hypot(x1 - x0, y1 - y0), ux = (x1 - x0) / L, uy = (y1 - y0) / L, nx = -uy, ny = ux;
  const aS = OB.aS, r0 = aS * 1.55, r1 = aS * 1.25;
  const cand = (u, b) => [x0 + ux * u * L + nx * b * L, y0 + uy * u * L + ny * b * L];
  const A = [], B = [];
  for (let u = -0.15; u <= 0.651; u += 0.05) for (let b = -1.0; b <= 1.001; b += 0.05) {
    const [fx, fy] = cand(u, b), d = Math.hypot(fx - x0, fy - y0);
    if (d < L * 0.2) continue;
    const sx0 = x0 + (fx - x0) / d * r0, sy0 = y0 + (fy - y0) / d * r0;
    A.push({ fx, fy, sx: sx0, sy: sy0, c: segCost(sx0, sy0, fx, fy) + pointCost(fx, fy, CLEAR * 1.6) + labelSpot(fx, fy, x0, y0, fx + (x1 - fx) * 0.3, fy + (y1 - fy) * 0.3) });
  }
  for (let u = 0.35; u <= 1.151; u += 0.05) for (let b = -1.0; b <= 1.001; b += 0.05) {
    const [fx, fy] = cand(u, b), d = Math.hypot(x1 - fx, y1 - fy);
    if (d < L * 0.2) continue;
    const ex = x1 - (x1 - fx) / d * r1, ey = y1 - (y1 - fy) / d * r1;
    B.push({ fx, fy, ex, ey, c: segCost(fx, fy, ex, ey) + pointCost(fx, fy, CLEAR * 1.6) + labelSpot(fx, fy, fx + (x0 - fx) * 0.3, fy + (y0 - fy) * 0.3, x1, y1) });
  }
  A.sort((p, q) => p.c - q.c); B.sort((p, q) => p.c - q.c);
  const nA = Math.min(60, A.length), nB = Math.min(60, B.length);
  let best = null, bestC = Infinity;
  for (let i = 0; i < nA; i++) for (let j = 0; j < nB; j++) {
    const a = A[i], b = B[j];
    const l1 = Math.hypot(a.fx - a.sx, a.fy - a.sy), l2 = Math.hypot(b.fx - a.fx, b.fy - a.fy), l3 = Math.hypot(b.ex - b.fx, b.ey - b.fy);
    if (l2 < L * 0.15) continue;
    const tot = l1 + l2 + l3;
    let c = a.c + b.c + segCost(a.fx, a.fy, b.fx, b.fy)
      + labelSpot(a.fx, a.fy, a.sx, a.sy, b.fx, b.fy) + labelSpot(b.fx, b.fy, a.fx, a.fy, b.ex, b.ey);
    c += (tot / L - 1) * 2600;                                     // short
    const t1 = turn(a.sx, a.sy, a.fx, a.fy, b.fx, b.fy), t2 = turn(a.fx, a.fy, b.fx, b.fy, b.ex, b.ey);
    c += Math.max(0, t1 - 0.5) ** 2 * 2600 + Math.max(0, t2 - 0.5) ** 2 * 2600;   // honest alterations
    if (t1 < 0.05 && t2 < 0.05) c += 300;                           // a dead-straight line hides the fixes
    const lo = Math.min(l1, l2, l3) / tot;
    if (lo < 0.22) c += (0.22 - lo) * 9000;                         // three legs, not a stub
    if (c < bestC) { bestC = c; best = { a, b }; }
  }
  if (!best) best = { a: A[0], b: B[0] };
  ptX[0] = best.a.sx; ptY[0] = best.a.sy; ptX[1] = best.a.fx; ptY[1] = best.a.fy;
  ptX[2] = best.b.fx; ptY[2] = best.b.fy; ptX[3] = best.b.ex; ptY[3] = best.b.ey;
  return bestC;
}
function turn(ax, ay, bx, by, cx, cy) {
  const a1 = Math.atan2(by - ay, bx - ax), a2 = Math.atan2(cy - by, cx - bx);
  let d = Math.abs(a2 - a1); if (d > Math.PI) d = Math.PI * 2 - d; return d;
}

// Sample the three legs into the ink: wobble in the hand, load falling as the nib runs
// dry (re-dipped at the first fix only, so the last two legs run long and finish dry —
// thinning, then the tines splitting into two hairlines, then breaking on the paper's
// tooth), ticks every so often, a press at each set-down.
function sampleInk() {
  nS = 0; nT = 0;
  const step = 1.25;
  const len = [0, 0, 0];
  for (let k = 0; k < 3; k++) len[k] = Math.hypot(ptX[k + 1] - ptX[k], ptY[k + 1] - ptY[k]);
  const dipD = [len[0] * 1.8, (len[1] + len[2]) * 1.32];
  const tickEvery = W * 0.026;
  let sinceDip = 0, sAll = 0, nextTick = tickEvery * 0.8;
  for (let k = 0; k < 3; k++) {
    if (k === 1) sinceDip = 0;                                   // re-dipped at the first fix
    const D = k === 0 ? dipD[0] : dipD[1];
    const ax = ptX[k], ay = ptY[k], bx = ptX[k + 1], by = ptY[k + 1], Lk = len[k];
    const dx = (bx - ax) / Lk, dy = (by - ay) / Lk, nx = -dy, ny = dx;
    const n = Math.max(2, Math.ceil(Lk / step));
    legI0[k] = nS;
    for (let i = 0; i <= n && nS < MAXS; i++) {
      const t = i / n, s = t * Lk, sg = sAll + s;
      const win = Math.min(1, t * 9, (1 - t) * 9);
      const wob = (noise1(sg * 0.018 + k * 31) * 0.75 + noise1(sg * 0.075 + 7) * 0.3) * U * 1.1 * win;
      sx[nS] = ax + dx * s + nx * wob; sy[nS] = ay + dy * s + ny * wob;
      nxA[nS] = nx; nyA[nS] = ny;
      const load = Math.max(0.1, 1 - (sinceDip + s) / D);
      let w = U * 1.55 * (0.4 + 0.72 * Math.pow(load, 0.8)) * (1 + 0.1 * noise1(sg * 0.05 + 3));
      if (s < 4 * U) w *= 1.3;                                    // the press as the nib lands
      sw[nS] = w;
      let mode = i === 0 ? 3 : 0;
      if (mode === 0 && load < 0.3 && noise1(sg * 0.05 + 90) > -0.2) mode = 1;
      if (mode !== 3 && load < 0.4) {
        // the paper's tooth skips a dry nib: short misses, not a dashed rule
        const g = noise1(sg * 0.42 + 50) * 0.5 + 0.5;
        if (g > 0.66 + load * 0.8) mode = 2;
      }
      sm[nS] = mode;
      // dead-reckoning ticks, kept clear of the fixes and the ends
      if (sg >= nextTick) {
        if (s > W * 0.018 && Lk - s > W * 0.018 && nT < MAXT) {
          tkI[nT] = nS; tkX[nT] = sx[nS]; tkY[nT] = sy[nS]; tkNX[nT] = nx; tkNY[nT] = ny; nT++;
        }
        nextTick += tickEvery;
      }
      nS++;
    }
    legI1[k] = nS - 1;
    sinceDip += Lk; sAll += Lk;
  }
}

// ---------------------------------------------------------------------------
export function startPassage(from, to, chartState) {
  const t0 = performance.now();
  if (!root) build();
  const vw = window.innerWidth, vh = window.innerHeight;
  W = Math.round(Math.min(vw * 0.95, vh * 0.95 * 1.5));
  H = Math.round(W / 1.5);
  dpr = Math.min(2, window.devicePixelRatio || 1, 2400 / W);
  U = W / 1400;
  swayEl.style.width = W + 'px'; swayEl.style.height = H + 'px';
  FROM = from; TO = to;

  // 1 the sheet, as the chart table drew it — with nobody's ring on it (the departure's
  //   YOU RIDE HERE is drawn on top so it can be rubbed out) and the destination's name
  //   held back to be lettered in on arrival.
  const sheetState = { currentSite: -1, calmed: chartState.calmed || [], found: chartState.found || null };
  const opts = { hideName: to, captured: null };
  paintSheet(sheetC, W, H, dpr, sheetState, opts);
  glyphs = opts.captured || [];
  // The sheet lies on the table: the chart table's soft close shadow (chartOverlay
  // PAPER_SHADOW), baked once round the deckle here rather than a CSS filter the
  // compositor would re-run every frame under the sway.
  baseC.width = Math.round((W + 2 * PAD) * dpr); baseC.height = Math.round((H + 2 * PAD) * dpr);
  const bx = baseC.getContext('2d');
  bx.setTransform(1, 0, 0, 1, 0, 0);
  bx.clearRect(0, 0, baseC.width, baseC.height);
  bx.filter = PAPER_SHADOW.replace(/([\d.]+)px/g, (_, v) => (+v * dpr).toFixed(2) + 'px');
  bx.drawImage(sheetC, Math.round(PAD * dpr), Math.round(PAD * dpr));
  bx.filter = 'none';
  const site = siteAt(to);
  hand = site && site.hidden ? PENCIL : INK;

  // 2 the course
  const prev = setCtx(inkX);
  OB = sheetObstacles(W, H, sheetState);
  CLEAR = W * 0.018;
  planRoute(from, to);
  sampleInk();

  // 3 the fixes' rings and dates, the departure's pencil ring + YOU RIDE HERE
  fixR = W * 0.0062;
  const lpx = OB.condPx, lrng = stream(0xF1C5 + from * 7 + to * 131);
  for (let f = 0; f < 2; f++) {
    const fx = ptX[f + 1], fy = ptY[f + 1];
    labelSpot(fx, fy, ptX[f], ptY[f], ptX[f + 2], ptY[f + 2]);   // the date, beside the fix, clear of the line
    fixGlyphs[f] = [];
    letter(FIX_LABELS[f], LBL_X, LBL_Y + lpx * 0.35, lpx, W * 0.0022, INK_FADE, lrng, 'center', fixGlyphs[f]);
  }
  const x0 = SPOTS[from].x * W, y0 = SPOTS[from].y * H, aS = OB.aS;
  const rr = aS * 2.1, rrng = stream(0x5A1 + from);
  ringPts = new Float32Array(27 * 2);
  for (let k = 0; k <= 26; k++) {
    const a = k / 26 * Math.PI * 2.04 - 0.4, wob = 1 + (rrng() - 0.5) * 0.09;
    ringPts[k * 2] = x0 + Math.cos(a) * rr * wob; ringPts[k * 2 + 1] = y0 + Math.sin(a) * rr * 0.92 * wob;
  }
  yrhGlyphs = [];
  letter('YOU RIDE HERE', x0, y0 - aS * 2.9, OB.condPx, W * 0.003, PENCIL, rrng, 'center', yrhGlyphs);
  setCtx(prev);

  // 4 canvases cleared, the clock wound
  inkC.width = sheetC.width; inkC.height = sheetC.height;
  topC.width = sheetC.width; topC.height = sheetC.height;
  inkX.setTransform(dpr, 0, 0, dpr, 0, 0); topX.setTransform(dpr, 0, 0, dpr, 0, 0);
  inkX.lineCap = 'round'; inkX.lineJoin = 'round';
  topX.lineCap = 'round'; topX.lineJoin = 'round';
  P = 0; prevP = 0; lastNow = performance.now(); live = true; held = false;
  sAt.fill(0, 0, nS + 1);
  drawn = legI0[0]; tkDone = 0; poolsDone = 0; reseedFired = false; calm = 0;
  ringDone[0] = ringDone[1] = 0; labelDone[0] = labelDone[1] = 0; nameDone = 0;
  stats.maxMoveGap = 0; stats.restGap = 0; stats.reseedP = -1; stats.frames = 0;
  lastOp = lastSwayOp = -1;

  // 5 the push-in leans toward the middle of the course
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (let k = 0; k < 4; k++) { bx0 = Math.min(bx0, ptX[k]); bx1 = Math.max(bx1, ptX[k]); by0 = Math.min(by0, ptY[k]); by1 = Math.max(by1, ptY[k]); }
  const ox = (vw - W) / 2 + (bx0 + bx1) / 2, oy = (vh - H) / 2 + (by0 + by1) / 2;
  pushEl.style.transformOrigin = `${(ox / vw * 100).toFixed(2)}% ${(oy / vh * 100).toFixed(2)}%`;
  root.classList.remove('run', 'hold');
  root.style.display = 'block';
  root.style.opacity = '0';
  swayEl.style.opacity = '0';
  void root.offsetWidth;                 // restart the CSS animations from their first frame
  root.classList.add('run');
  stats.buildMs = performance.now() - t0;
  stats.startWall = t0; stats.wallMs = 0;
}

// ---------------------------------------------------------------------------
// per frame
const crossed = t => prevP < t && P >= t;
function pan(x) { return (x / W - 0.5) * 0.7; }

export function updatePassage(hold) {
  if (!live) return 0;
  const now = performance.now();
  const wall = (now - lastNow) / 1000;
  lastNow = now;
  if (hold !== held) { held = hold; root.classList.toggle('hold', hold); }
  if (hold) return 0;                     // Esc / blur: the passage holds where it is
  prevP = P;
  // The clock: wall time. The look at the sheet swallows the reseed's stall whole and is
  // not left until the world has settled; elsewhere a frame is worth at most 50 ms.
  if (P >= PT.RESEED && P < PT.REST_END) {
    if (reseedFired) {
      stats.restGap = Math.max(stats.restGap, wall);
      calm = wall < 0.05 ? calm + 1 : 0;
    }
    const settled = reseedFired && calm >= 2;
    P = P + wall;
    if (P >= PT.REST_END - 1e-4) P = settled ? PT.REST_END + 1e-4 : PT.REST_END - 1e-4;
  } else {
    P += Math.min(wall, 0.05);
    if (isMoving(prevP)) stats.maxMoveGap = Math.max(stats.maxMoveGap, wall);
  }
  stats.frames++;
  let ev = 0;

  // ---- the room: the sea darkens, the chart comes up, at the end it dissolves ----
  const outK = smooth(span(PT.OUT, P));
  const op = Math.min(smooth(span(PT.BACK_IN, P)), 1 - outK);
  const sop = Math.min(smooth(span(PT.SHEET_IN, P)), 1);
  if (Math.abs(op - lastOp) > 0.002 || (op === 0) !== (lastOp === 0)) { root.style.opacity = op.toFixed(3); lastOp = op; }
  if (Math.abs(sop - lastSwayOp) > 0.002 || (sop === 1 && lastSwayOp !== 1)) { swayEl.style.opacity = sop.toFixed(3); lastSwayOp = sop; }

  // ---- the sound of the hand ----
  if (sound) {
    if (crossed(PT.LEG1[0])) { sound('tick', 0.05, pan(ptX[0]), pan(ptX[0]), 0); sound('stroke', PT.LEG1[1] - PT.LEG1[0], pan(ptX[0]), pan(ptX[1]), 0.25); }
    if (crossed(PT.FIX1_RING[0])) sound('ring', PT.FIX1_RING[1] - PT.FIX1_RING[0], pan(ptX[1]), pan(ptX[1]), 0.1);
    if (crossed(PT.FIX1_LABEL[0])) sound('letter', PT.FIX1_LABEL[1] - PT.FIX1_LABEL[0], pan(ptX[1]), pan(ptX[1]), 0.1);
    if (crossed(PT.LEG2[0])) { sound('tick', 0.05, pan(ptX[1]), pan(ptX[1]), 0); sound('stroke', PT.LEG2[1] - PT.LEG2[0], pan(ptX[1]), pan(ptX[2]), 0.45); }
    if (crossed(PT.FIX2_RING[0])) sound('ring', PT.FIX2_RING[1] - PT.FIX2_RING[0], pan(ptX[2]), pan(ptX[2]), 0.5);
    if (crossed(PT.FIX2_LABEL[0])) sound('letter', PT.FIX2_LABEL[1] - PT.FIX2_LABEL[0], pan(ptX[2]), pan(ptX[2]), 0.5);
    if (crossed(PT.LEG3[0])) sound('stroke', PT.LEG3[1] - PT.LEG3[0], pan(ptX[2]), pan(ptX[3]), 0.85);
    if (crossed(PT.BELL)) sound('tick', 0.05, pan(ptX[3]), pan(ptX[3]), 0);
    if (crossed(PT.NAME[0])) sound('letter', PT.NAME[1] - PT.NAME[0], pan(ptX[3]), pan(ptX[3]), 0.2);
  }

  paint();

  if (!reseedFired && P >= PT.RESEED) { reseedFired = true; stats.reseedP = P; ev |= PEV_RESEED; }
  if (crossed(PT.BELL)) ev |= PEV_BELL;
  if (P >= PT.END) { finish(); ev |= PEV_DONE; }
  return ev;
}

function paint() {
  // the ink (accumulating layer: only what is new this frame is drawn)
  const head = headIndex();
  inkUpTo(head);
  pools();
  fixMarks();
  nameIn();
  // the live layer: raft mark, the nib's bead, wet sheen, the rubbed-out ring
  drawTop(head);
}

function isMoving(t) {
  return (t >= PT.LEG1[0] && t < PT.LEG1[1]) || (t >= PT.LEG2[0] && t < PT.LEG2[1]) || (t >= PT.LEG3[0] && t < PT.LEG3[1])
    || (t >= PT.FIX1_RING[0] && t < PT.FIX1_LABEL[1]) || (t >= PT.FIX2_RING[0] && t < PT.FIX2_LABEL[1]) || (t >= PT.NAME[0] && t < PT.NAME[1]);
}

// sample index of the nib on the clock
const LEGS = [PT.LEG1, PT.LEG2, PT.LEG3];
const RAFT_IN = [PT.LEG1[0] - 0.15, PT.LEG1[0] + 0.15];
function headIndex() {
  if (P < PT.LEG1[0]) return legI0[0];
  for (let k = 2; k >= 0; k--) {
    const L = LEGS[k];
    if (P >= L[0]) {
      const u = nibEase(span(L, P));
      return legI0[k] + Math.round(u * (legI1[k] - legI0[k]));
    }
  }
  return legI0[0];
}

function inkUpTo(head) {
  if (head <= drawn) return;
  const c = inkX;
  c.strokeStyle = INK_WET;
  for (let i = drawn + 1; i <= head; i++) {
    sAt[i] = P;
    const m = sm[i];
    if (m === 2 || m === 3) continue;
    const w = sw[i];
    if (m === 1) {
      // dry: the tines part and drag two hairlines
      const ox = nxA[i] * w * 0.36, oy = nyA[i] * w * 0.36;
      c.lineWidth = w * 0.3;
      c.beginPath();
      c.moveTo(sx[i - 1] + ox, sy[i - 1] + oy); c.lineTo(sx[i] + ox, sy[i] + oy);
      c.moveTo(sx[i - 1] - ox, sy[i - 1] - oy); c.lineTo(sx[i] - ox, sy[i] - oy);
      c.stroke();
    } else {
      c.lineWidth = w;
      c.beginPath(); c.moveTo(sx[i - 1], sy[i - 1]); c.lineTo(sx[i], sy[i]); c.stroke();
    }
  }
  // dead-reckoning ticks the nib has passed
  c.strokeStyle = INK_FADE;
  c.lineWidth = Math.max(0.8, U * 0.9);
  const tl = W * 0.0042;
  while (tkDone < nT && tkI[tkDone] <= head) {
    const k = tkDone++;
    c.beginPath();
    c.moveTo(tkX[k] - tkNX[k] * tl, tkY[k] - tkNY[k] * tl);
    c.lineTo(tkX[k] + tkNX[k] * tl, tkY[k] + tkNY[k] * tl);
    c.stroke();
  }
  drawn = head;
}

// where the nib rests the ink pools: set-down, each fix, the mark
function pool(x, y, r) {
  const c = inkX;
  c.fillStyle = INK_WET;
  c.globalAlpha = 0.82;
  c.beginPath(); c.ellipse(x, y, r, r * 0.9, 0.6, 0, Math.PI * 2); c.fill();
  c.globalAlpha = 0.5;                       // the dried rim of a pool is its darkest edge
  c.strokeStyle = INK_WET; c.lineWidth = Math.max(0.6, r * 0.28);
  c.beginPath(); c.ellipse(x, y, r * 0.95, r * 0.86, 0.6, 0, Math.PI * 2); c.stroke();
  c.globalAlpha = 1;
}
function pools() {
  const r = U * 2.1;
  if (poolsDone === 0 && P >= PT.LEG1[0]) { pool(ptX[0], ptY[0], r * 0.9); poolsDone = 1; }
  if (poolsDone === 1 && P >= PT.LEG1[1]) { pool(ptX[1], ptY[1], r * 1.05); poolsDone = 2; }
  if (poolsDone === 2 && P >= PT.LEG2[1]) { pool(ptX[2], ptY[2], r * 0.85); poolsDone = 3; }
  if (poolsDone === 3 && P >= PT.BELL) { pool(ptX[3], ptY[3], r * 1.2); poolsDone = 4; }
}

// the fix: a small ring round the position, then its time lettered beside it
const FIXT = [[PT.FIX1_RING, PT.FIX1_LABEL], [PT.FIX2_RING, PT.FIX2_LABEL]];
function fixMarks() {
  const c = inkX;
  for (let f = 0; f < 2; f++) {
    const rw = FIXT[f][0], lw = FIXT[f][1];
    const u = span(rw, P);
    if (u > ringDone[f]) {
      const a0 = -1.9 + f * 1.3, aTo = a0 + (Math.PI * 2 + 0.35) * u, aFrom = a0 + (Math.PI * 2 + 0.35) * ringDone[f];
      c.strokeStyle = INK_WET; c.lineWidth = Math.max(0.85, U * 1.0);
      c.beginPath(); c.ellipse(ptX[f + 1], ptY[f + 1], fixR, fixR * 0.94, 0, aFrom, aTo); c.stroke();
      ringDone[f] = u;
    }
    const g = fixGlyphs[f], want = Math.round(span(lw, P) * g.length);
    while (labelDone[f] < want) glyph(c, g[labelDone[f]++]);
  }
}
function nameIn() {
  const want = Math.round(span(PT.NAME, P) * glyphs.length);
  while (nameDone < want) glyph(inkX, glyphs[nameDone++], hand);
}
function glyph(c, g, color) {
  c.save();
  c.fillStyle = color || g.color;
  c.font = g.font;
  c.translate(g.x, g.y); c.rotate(g.rot);
  c.fillText(g.ch, 0, 0);
  c.restore();
}

function drawTop(head) {
  const c = topX;
  c.clearRect(0, 0, W, H);
  // departure: the pencil ring and YOU RIDE HERE, rubbed out as the nib leaves
  const ringA = 1 - smooth(span(PT.RING_OUT, P));
  if (ringA > 0.01) {
    c.globalAlpha = ringA;
    c.strokeStyle = PENCIL; c.lineWidth = 1.3;
    c.beginPath(); c.moveTo(ringPts[0], ringPts[1]);
    for (let k = 1; k <= 26; k++) c.lineTo(ringPts[k * 2], ringPts[k * 2 + 1]);
    c.stroke();
    for (let k = 0; k < yrhGlyphs.length; k++) glyph(c, yrhGlyphs[k]);
    c.globalAlpha = 1;
  }
  // wet ink: the lamp catches the last of the line until it dries (~0.5 s)
  c.strokeStyle = SHEEN;
  for (let i = head; i > legI0[0] && i > head - 600; i -= 3) {
    const age = P - sAt[i];
    if (age > 0.5 || sAt[i] === 0) break;
    const m = sm[i];
    if (m !== 0) continue;
    const j = Math.max(legI0[0], i - 3);
    c.globalAlpha = (1 - age / 0.5) * 0.55;
    c.lineWidth = sw[i] * 0.3;
    const ox = -sw[i] * 0.2, oy = -sw[i] * 0.22;         // lamp is up and to the left
    c.beginPath(); c.moveTo(sx[j] + ox, sy[j] + oy); c.lineTo(sx[i] + ox, sy[i] + oy); c.stroke();
  }
  c.globalAlpha = 1;
  // the nib's bead, only while it runs a leg
  if (inLeg(P)) {
    c.fillStyle = BEAD;
    c.beginPath(); c.arc(sx[head], sy[head], sw[head] * 0.75, 0, Math.PI * 2); c.fill();
  }
  // the raft's pencil mark, riding the line just astern of the nib
  const ra = Math.min(smooth(span(RAFT_IN, P)), 1 - smooth(span(PT.NAME, P)));
  if (ra > 0.01) {
    const i0 = Math.max(legI0[0], head - 3), i1 = Math.min(nS - 1, Math.max(head, i0 + 1));
    let dx = sx[i1] - sx[i0], dy = sy[i1] - sy[i0];
    const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
    const L = W * 0.0085, B = W * 0.0033, back = W * 0.014;
    const cx = sx[head] - dx * back, cy = sy[head] - dy * back;
    c.globalAlpha = ra;
    c.save();
    c.translate(cx, cy); c.rotate(Math.atan2(dy, dx));
    c.beginPath();
    c.moveTo(L, 0); c.quadraticCurveTo(L * 0.2, -B * 1.25, -L, -B * 0.8);
    c.lineTo(-L, B * 0.8); c.quadraticCurveTo(L * 0.2, B * 1.25, L, 0);
    c.closePath();
    c.fillStyle = PAPER; c.fill();
    c.strokeStyle = PENCIL; c.lineWidth = Math.max(0.9, U * 1.05); c.stroke();
    c.beginPath(); c.moveTo(-L * 0.35, 0); c.lineTo(L * 0.25, 0); c.stroke();   // her deck-line
    c.restore();
    c.globalAlpha = 1;
  }
}
function inLeg(t) { return (t >= PT.LEG1[0] && t < PT.LEG1[1]) || (t >= PT.LEG2[0] && t < PT.LEG2[1]) || (t >= PT.LEG3[0] && t <= PT.BELL); }

function finish() {
  live = false;
  stats.wallMs = performance.now() - stats.startWall;
  root.style.opacity = '0';
  root.style.display = 'none';
  root.classList.remove('run', 'hold');
}

// Abort (e.g. a death or a reset mid-passage): put the sheet away now.
export function endPassage() { if (live) finish(); }
export function passageLive() { return live; }

// dev surface: the clock, the route, and the stall ledger (maxMoveGap = the worst wall
// gap between two frames while something on the sheet was MOVING; restGap = the worst
// gap swallowed by the rest beat — the reseed's hitch)
window.__passage = {
  state: () => ({ live, P: +P.toFixed(3), held, head: drawn, samples: nS, ticks: nT, W, H, dpr: +dpr.toFixed(2),
    route: live || nS ? [0, 1, 2, 3].map(k => [Math.round(ptX[k]), Math.round(ptY[k])]) : null,
    maxMoveGapMs: Math.round(stats.maxMoveGap * 1000), restGapMs: Math.round(stats.restGap * 1000),
    reseedP: +stats.reseedP.toFixed(3), frames: stats.frames, buildMs: Math.round(stats.buildMs || 0), wallMs: Math.round(stats.wallMs || 0) }),
  PT,
  // DEV look-check: lay a course and draw it up to passage time t with no clock, no
  // events, no sound (the world is untouched). end() puts the sheet away.
  preview(from, to, t = PT.NAME[1]) {
    startPassage(from | 0, to | 0, { calmed: [], found: [1, 1, 1, 1] });
    root.classList.remove('run');
    root.style.opacity = '1'; swayEl.style.opacity = '1';
    while (P < t) { prevP = P; P = Math.min(t, P + 1 / 60); paint(); }
    return window.__passage.state();
  },
  end: () => endPassage()
};
