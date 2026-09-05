// THE GLASS — weather & light lab. DEV ONLY. OWNED BY: lab agent.
//
// Loaded by a dynamic import at the end of game.js, guarded by `?lab` in the URL, so
// a normal load never fetches, parses or runs a byte of this file.
//
// It is a panel over the RUNNING GAME (the sandbox is the game itself — a standalone
// page would lie about interactions). It pokes two things:
//   config.js GLASS — plain mutable data, re-read by every consumer each frame.
//   window.weather  — scrub / pause / speed / set / flash, published by systems/weather.js.
// It reads nothing back except `weather.state()`, and it NEVER touches localStorage
// ('abyssa.chart.v1' is the save; the lab must not be able to corrupt a session).
//
// COLOUR MAPPING (the one genuinely lossy bit, documented because it must round-trip):
// the stop colours are SCENE-LINEAR RADIANCE and routinely exceed 1 (the sun disc is
// [3.4, 3.0, 2.3]). An <input type=color> can only carry 8-bit sRGB in 0..1. So each
// colour field carries its own GAIN `k`, seeded at panel init to the largest component
// of its boot value. The picker shows  srgbEncode(component / k)  and writes back
//   component = k * srgbDecode(picker) .
// At boot the brightest channel therefore sits at 1.0 (picker-white) and the ratio
// between channels — which is all the hue is — survives exactly; the round trip is
// exact to 8-bit quantisation. The gain box beside each well is the absolute
// brightness, edited as a number because that is what it is. Editing gain alone
// rescales the triplet and leaves the hue untouched.
import { GLASS, SUN } from '../config.js';

const wx = () => window.weather;

// --- boot snapshot (deep copy, taken before anything can be poked) -----------
const clone = o => JSON.parse(JSON.stringify(o));
const BOOT = clone(GLASS);

// --- colour transfer ---------------------------------------------------------
const enc = x => x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
const dec = x => x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
const h2 = v => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0');
const toHex = (c, k) => '#' + h2(enc(Math.min(1, Math.max(0, c[0] / k))))
  + h2(enc(Math.min(1, Math.max(0, c[1] / k)))) + h2(enc(Math.min(1, Math.max(0, c[2] / k))));
const fromHex = (hex, k) => [
  k * dec(parseInt(hex.slice(1, 3), 16) / 255),
  k * dec(parseInt(hex.slice(3, 5), 16) / 255),
  k * dec(parseInt(hex.slice(5, 7), 16) / 255)
];

// ---------------------------------------------------------------------------
const CSS = `
#lab,#labTab{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
  -webkit-font-smoothing:antialiased;color:#c8bfa8}
#labTab{position:fixed;left:12px;bottom:12px;z-index:6;background:#0d1215;
  border:1px solid #2a3238;color:#c8bfa8;font-size:10px;letter-spacing:.28em;
  padding:6px 12px;cursor:pointer;text-transform:uppercase;opacity:.55}
#labTab:hover{opacity:1;border-color:#8a6a34}
#lab{position:fixed;left:12px;top:12px;bottom:12px;width:342px;z-index:6;
  background:#0d1215;border:1px solid #232b31;box-shadow:0 0 0 1px rgba(0,0,0,.5);
  display:flex;flex-direction:column;font-size:11px;line-height:1.5}
#lab.off,#labTab.off{display:none}
#lab .hd{display:flex;align-items:center;justify-content:space-between;
  padding:8px 10px;border-bottom:1px solid #232b31;flex:0 0 auto}
#lab .hd b{font-weight:400;font-size:10px;letter-spacing:.34em;text-transform:uppercase;opacity:.75}
#lab .bd{overflow-y:auto;overflow-x:hidden;padding:8px 10px 16px;flex:1 1 auto;
  scrollbar-width:thin;scrollbar-color:#2a3238 #0d1215}
#lab h4{margin:14px 0 6px;font-size:9px;font-weight:400;letter-spacing:.34em;
  text-transform:uppercase;opacity:.42;border-bottom:1px solid #1c2429;padding-bottom:4px}
#lab .ro{white-space:pre-wrap;font-size:10px;opacity:.72;margin:6px 0 2px;
  letter-spacing:.04em;min-height:44px}
#lab .row{display:flex;align-items:center;gap:6px;margin:3px 0}
#lab .row .nm{width:80px;flex:0 0 auto;font-size:10px;letter-spacing:.1em;opacity:.68;
  text-transform:uppercase;overflow:hidden;text-overflow:ellipsis}
#lab .row .vl{width:46px;flex:0 0 auto;text-align:right;font-size:10px;opacity:.55}
#lab .dot{width:5px;height:5px;flex:0 0 auto;border-radius:50%;background:transparent}
#lab .dot.on{background:#c08a3a;box-shadow:0 0 5px rgba(192,138,58,.8)}
#lab input[type=range]{flex:1 1 auto;min-width:0;-webkit-appearance:none;appearance:none;
  height:2px;background:#232b31;outline:none;margin:0}
#lab input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:9px;height:14px;
  background:#9a917c;border:0;cursor:ew-resize}
#lab input[type=range]::-moz-range-thumb{width:9px;height:14px;background:#9a917c;
  border:0;cursor:ew-resize}
#lab input[type=color]{width:34px;height:16px;padding:0;border:1px solid #2a3238;
  background:#0d1215;cursor:pointer;flex:0 0 auto}
#lab input[type=number],#lab .num{width:52px;flex:0 0 auto;background:#111a1e;
  border:1px solid #232b31;color:#c8bfa8;font:inherit;font-size:10px;padding:1px 3px}
#lab button{background:#111a1e;border:1px solid #2a3238;color:#c8bfa8;font:inherit;
  font-size:9px;letter-spacing:.2em;text-transform:uppercase;padding:3px 7px;cursor:pointer}
#lab button:hover{border-color:#8a6a34;color:#e0d6bc}
#lab button.on{border-color:#c08a3a;color:#e6c98d}
#lab .btns{display:flex;gap:5px;flex-wrap:wrap;margin:6px 0}
#lab .stop{border:1px solid #1c2429;margin:5px 0}
#lab .stop>summary{list-style:none;cursor:pointer;padding:4px 7px;font-size:10px;
  letter-spacing:.24em;text-transform:uppercase;opacity:.8;display:flex;
  align-items:center;justify-content:space-between}
#lab .stop>summary::-webkit-details-marker{display:none}
#lab .stop[open]>summary{border-bottom:1px solid #1c2429;color:#e6c98d}
#lab .stop .in{padding:5px 7px 7px}
/* index.html styles the GAME canvas with a bare \`canvas{position:fixed;...100vw}\`
   selector, which lands on this one too — pin it back into the flow explicitly. */
#lab canvas.ring{position:static;width:100%;height:26px;display:block;margin:2px 0 4px;
  cursor:pointer;z-index:auto}
#lab .note{font-size:9px;opacity:.34;letter-spacing:.06em;margin:4px 0 0}
`;

// ---------------------------------------------------------------------------
const ctrls = [];                      // {dot, mod(), sync()}
let panel = null, tab = null, tick = 0;

function el(tag, cls, parent, txt) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt !== undefined) n.textContent = txt;
  if (parent) parent.appendChild(n);
  return n;
}

function refresh() { for (let i = 0; i < ctrls.length; i++) ctrls[i].dot.classList.toggle('on', ctrls[i].mod()); }
function syncAll() { for (let i = 0; i < ctrls.length; i++) ctrls[i].sync(); refresh(); }

// A slider bound to one numeric field of a plain object.
function slider(parent, name, obj, key, min, max, step, bootVal, fmt) {
  const row = el('div', 'row', parent);
  const dot = el('span', 'dot', row);
  el('span', 'nm', row, name);
  const r = el('input', null, row); r.type = 'range';
  r.min = min; r.max = max; r.step = step;
  const v = el('span', 'vl', row);
  const f = fmt || (x => (+x).toFixed(step < 0.01 ? 3 : step < 1 ? 2 : 1));
  const sync = () => { r.value = obj[key]; v.textContent = f(obj[key]); };
  r.addEventListener('input', () => {
    obj[key] = parseFloat(r.value); v.textContent = f(obj[key]); refresh();
  });
  sync();
  ctrls.push({ dot, sync, mod: () => Math.abs(obj[key] - bootVal) > 1e-6 });
  return r;
}

// A colour well + gain box bound to one [r,g,b] scene-linear field. See the header.
function colorField(parent, name, holder, key, boot) {
  const row = el('div', 'row', parent);
  const dot = el('span', 'dot', row);
  el('span', 'nm', row, name);
  const c = el('input', null, row); c.type = 'color';
  const g = el('input', 'num', row); g.type = 'number'; g.step = '0.01'; g.min = '0.0001';
  const lbl = el('span', 'vl', row);
  let k = Math.max(boot[0], boot[1], boot[2], 1e-4);
  const arr = () => holder[key];
  const show = () => {
    const a = arr();
    c.value = toHex(a, k);
    g.value = (+k.toFixed(4));
    lbl.textContent = a[0].toFixed(2);
  };
  const write = () => {
    const n = fromHex(c.value, k), a = arr();
    a[0] = n[0]; a[1] = n[1]; a[2] = n[2];
    lbl.textContent = a[0].toFixed(2); refresh();
  };
  c.addEventListener('input', write);
  g.addEventListener('input', () => {
    const nk = parseFloat(g.value);
    if (!(nk > 0)) return;
    // rescale the triplet, keeping the picker (the hue) exactly where it is
    const rel = fromHex(c.value, 1), a = arr();
    k = nk; a[0] = k * rel[0]; a[1] = k * rel[1]; a[2] = k * rel[2];
    lbl.textContent = a[0].toFixed(2); refresh();
  });
  const sync = () => { k = Math.max(boot[0], boot[1], boot[2], 1e-4); show(); };
  show();
  ctrls.push({
    dot, sync,
    mod: () => { const a = arr(); return Math.abs(a[0] - boot[0]) > 1e-6 || Math.abs(a[1] - boot[1]) > 1e-6 || Math.abs(a[2] - boot[2]) > 1e-6; }
  });
}

// --- the constants block, formatted exactly like config.js -------------------
const n3 = x => {
  const s = Math.abs(x) >= 1 ? x.toFixed(3) : x.toFixed(4);
  return s.replace(/0+$/, '').replace(/\.$/, '.0');
};
const trip = a => `[${n3(a[0])}, ${n3(a[1])}, ${n3(a[2])}]`;
function serialize() {
  const s = GLASS.sun, o = GLASS.stops;
  let out = 'export const GLASS = {\n  sun: {\n';
  out += `    elevNoon: ${n3(s.elevNoon)},\n    elevDawn: ${n3(s.elevDawn)},\n`;
  out += `    elevNight: ${n3(s.elevNight)},\n    azimCenter: ${n3(s.azimCenter)},\n`;
  out += `    azimSweep: ${n3(s.azimSweep)}\n  },\n  stops: {\n`;
  const names = ['night', 'dawn', 'noon', 'dusk', 'storm'];
  out += names.map(nm => {
    const p = o[nm];
    return `    ${nm}: {\n      zen: ${trip(p.zen)}, hor: ${trip(p.hor)},\n` +
      `      disc: ${trip(p.disc)}, tint: ${trip(p.tint)}, surfK: ${n3(p.surfK)}, desat: ${n3(p.desat)}\n    }`;
  }).join(',\n');
  out += '\n  },\n  cloud: {\n';
  const c = GLASS.cloud;
  out += `    scale: ${n3(c.scale)}, drift: ${n3(c.drift)},\n` +
    `    covCalm: ${n3(c.covCalm)}, covGain: ${n3(c.covGain)}, covStorm: ${n3(c.covStorm)},\n` +
    `    softCalm: ${n3(c.softCalm)}, softStorm: ${n3(c.softStorm)},\n` +
    `    litK: ${n3(c.litK)}, baseK: ${n3(c.baseK)}, baseDark: ${n3(c.baseDark)}, stormLit: ${n3(c.stormLit)},\n` +
    `    emberK: ${n3(c.emberK)}, emberElev: ${n3(c.emberElev)}, emberGain: ${n3(c.emberGain)}\n  },\n`;
  const fg = GLASS.fog;
  out += '  fog: {\n';
  out += `    thr: ${n3(fg.thr)}, full: ${n3(fg.full)}, burnBand: ${n3(fg.burnBand)},\n` +
    `    maxK: ${n3(fg.maxK)}, zenK: ${n3(fg.zenK)}, discK: ${n3(fg.discK)},\n` +
    `    stormKill: ${n3(fg.stormKill)}, nightK: ${n3(fg.nightK)},\n` +
    `    col: ${trip(fg.col)}\n  },\n`;
  const mo = GLASS.moon;
  out += '  moon: {\n';
  out += `    elevMax: ${n3(mo.elevMax)}, azimOffset: ${n3(mo.azimOffset)}, radius: ${n3(mo.radius)},\n` +
    `    bright: ${n3(mo.bright)}, earthshine: ${n3(mo.earthshine)}, halo: ${n3(mo.halo)},\n` +
    `    col: ${trip(mo.col)}, hemiLift: ${n3(mo.hemiLift)}\n  },\n`;
  const ww = GLASS.windwater;
  out += '  windwater: {\n';
  out += `    capThr: ${n3(ww.capThr)}, capK: ${n3(ww.capK)}, anisoK: ${n3(ww.anisoK)},\n` +
    `    ampK: ${n3(ww.ampK)}, currentK: ${n3(ww.currentK)}, decayH: ${n3(ww.decayH)}\n  },\n`;
  const st = GLASS.style;
  out += '  style: {\n';
  out += `    flowLean: ${n3(st.flowLean)}, paint: ${n3(st.paint)}, edge: ${n3(st.edge)}, strokes: ${n3(st.strokes)},\n` +
    `    haze: ${n3(st.haze)}, grade: ${n3(st.grade)}, dof: ${n3(st.dof)}, camera: ${n3(st.camera)},\n` +
    `    light: ${n3(st.light)}, matte: ${n3(st.matte)}\n  }\n};\n`;
  return out;
}

// ---------------------------------------------------------------------------
function build() {
  const st = document.createElement('style');
  st.textContent = CSS;
  document.head.appendChild(st);

  tab = el('button', 'off', document.body, 'lab');
  tab.id = 'labTab';

  panel = el('div', null, document.body);
  panel.id = 'lab';

  const hd = el('div', 'hd', panel);
  el('b', null, hd, 'the glass — lab');
  const xb = el('button', null, hd, 'esc');
  const bd = el('div', 'bd', panel);

  // --- TIME ------------------------------------------------------------------
  el('h4', null, bd, 'time');
  const ring = el('canvas', 'ring', bd);
  const rx = ring.getContext('2d');
  const time = el('input', null, bd);
  time.type = 'range'; time.min = 0; time.max = 1000; time.step = 1; time.value = 500;
  time.style.width = '100%';
  let dragging = false;
  time.addEventListener('pointerdown', () => { dragging = true; });
  addEventListener('pointerup', () => { dragging = false; });
  time.addEventListener('input', () => { dragging = true; wx().scrub(time.value / 1000); });
  time.addEventListener('change', () => { dragging = false; });
  ring.addEventListener('click', e => {
    const r = ring.getBoundingClientRect();
    const u = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    time.value = Math.round(u * 1000); wx().scrub(u);
  });

  const ro = el('div', 'ro', bd);
  const bts = el('div', 'btns', bd);
  const speeds = [['pause', 0], ['1x', 1], ['4x', 4], ['16x', 16]];
  const sb = speeds.map(([lb, k]) => {
    const b = el('button', null, bts, lb);
    b.addEventListener('click', () => {
      if (k === 0) { wx().pause(true); } else { wx().pause(false); wx().speed(k); }
      sb.forEach(o => o.classList.remove('on')); b.classList.add('on');
    });
    return b;
  });
  sb[1].classList.add('on');

  // --- STORM -----------------------------------------------------------------
  el('h4', null, bd, 'storm');
  const srow = el('div', 'row', bd);
  el('span', 'dot', srow);
  el('span', 'nm', srow, 'storm');
  const sr = el('input', null, srow); sr.type = 'range';
  sr.min = 0; sr.max = 1; sr.step = 0.01; sr.value = 0;
  const sv = el('span', 'vl', srow, '—');
  // set() forces the RAW storm number only; weather.js's sky/sea/below envelope is a
  // first-order lag off that number, so the real easing (and the surface-leads-below
  // ordering) is preserved untouched. Nothing here bypasses it.
  sr.addEventListener('input', () => { wx().set(null, parseFloat(sr.value)); sv.textContent = (+sr.value).toFixed(2); });
  const sbt = el('div', 'btns', bd);
  const auto = el('button', null, sbt, 'auto');
  auto.addEventListener('click', () => { wx().set(null, null); sv.textContent = '—'; });
  el('button', null, sbt, 'squall').addEventListener('click', () => wx().storm());
  el('button', null, sbt, 'flash').addEventListener('click', () => wx().flash(0.95, 0.25));

  // --- TODAY'S HAND ------------------------------------------------------------
  el('h4', null, bd, "today's hand");
  const hro = el('div', 'ro', bd);
  const hbt = el('div', 'btns', bd);
  el('button', null, hbt, 'prev day').addEventListener('click', () => { wx().day(wx().day() - 1); });
  el('button', null, hbt, 'next day').addEventListener('click', () => { wx().day(wx().day() + 1); });
  const filtSel = el('select', null, bd);
  filtSel.style.cssText = 'background:#111a1e;border:1px solid #232b31;color:#c8bfa8;' +
    'font:inherit;font-size:10px;padding:2px 4px;margin:4px 0';
  [['any', 'any'], ['foggy', 'foggy (fog>0.5)'], ['storm', 'storm'],
    ['clear', 'clear (clouds<0.2 & fog<0.3)'], ['moon', 'big moon (moonK>0.8)']]
    .forEach(([v, lb]) => { const o = el('option', null, filtSel, lb); o.value = v; });
  const rbt = el('div', 'btns', bd);
  const rrBtn = el('button', null, rbt, 'reroll');
  const handStatus = el('p', 'note', bd, '');
  function handMatches(h, filt) {
    switch (filt) {
      case 'foggy': return h.fog > 0.5;
      case 'storm': return h.stormDay;
      case 'clear': return h.clouds < 0.2 && h.fog < 0.3;
      case 'moon': return h.moonK > 0.8;
      default: return true;
    }
  }
  rrBtn.addEventListener('click', () => {
    const w = wx(); if (!w) return;
    const cur = w.day();
    for (let i = 1; i <= 60; i++) {
      const idx = cur + i;
      const h = w.peek(idx);
      if (handMatches(h, filtSel.value)) {
        w.day(idx);
        handStatus.textContent = `landed on day ${idx} (+${i}, filter: ${filtSel.value})`;
        return;
      }
    }
    handStatus.textContent = `none in 60 (filter: ${filtSel.value})`;
  });

  // --- WIND ---------------------------------------------------------------------
  el('h4', null, bd, 'wind');
  const wro = el('div', 'ro', bd);
  const wsRow = el('div', 'row', bd);
  el('span', 'dot', wsRow).style.visibility = 'hidden';
  el('span', 'nm', wsRow, 'speed');
  const wsR = el('input', null, wsRow); wsR.type = 'range'; wsR.min = 0; wsR.max = 1; wsR.step = 0.01;
  const wsV = el('span', 'vl', wsRow);
  const wdRow = el('div', 'row', bd);
  el('span', 'dot', wdRow).style.visibility = 'hidden';
  el('span', 'nm', wdRow, 'dir');
  const wdR = el('input', null, wdRow); wdR.type = 'range'; wdR.min = 0; wdR.max = 360; wdR.step = 1;
  const wdV = el('span', 'vl', wdRow);
  let windState = { speed: 0, dirDeg: 0 };
  function pushWind() {
    windState.speed = parseFloat(wsR.value); windState.dirDeg = parseFloat(wdR.value);
    wsV.textContent = windState.speed.toFixed(2); wdV.textContent = windState.dirDeg.toFixed(0) + '°';
    window.__sky && window.__sky.wind(windState.speed, windState.dirDeg * Math.PI / 180);
  }
  wsR.addEventListener('input', pushWind);
  wdR.addEventListener('input', pushWind);
  wsR.value = 0; wdR.value = 0; wsV.textContent = '0.00'; wdV.textContent = '0°';
  const wbt = el('div', 'btns', bd);
  el('button', null, wbt, 'auto').addEventListener('click', () => {
    window.__sky && window.__sky.windOff();
  });

  // --- CLOUDS / FOG / MOON / WINDWATER -----------------------------------------
  el('h4', null, bd, 'sky drama');
  function knobGroup(title, holder, boot, spec) {
    const d = el('details', 'stop', bd);
    const sm = el('summary', null, d);
    el('span', null, sm, title);
    const in_ = el('div', 'in', d);
    spec.forEach(f => {
      if (f.color) colorField(in_, f.key, holder, f.key, boot[f.key]);
      else slider(in_, f.key, holder, f.key, f.min, f.max, f.step, boot[f.key]);
    });
  }
  knobGroup('clouds', GLASS.cloud, BOOT.cloud, [
    { key: 'scale', min: 0, max: 10, step: 0.05 },
    { key: 'drift', min: 0, max: 0.1, step: 0.001 },
    { key: 'covCalm', min: 0, max: 1, step: 0.01 },
    { key: 'covGain', min: 0, max: 1, step: 0.01 },
    { key: 'covStorm', min: 0, max: 1, step: 0.01 },
    { key: 'softCalm', min: 0, max: 1, step: 0.01 },
    { key: 'softStorm', min: 0, max: 1, step: 0.01 },
    { key: 'litK', min: 0, max: 2, step: 0.01 },
    { key: 'baseK', min: 0, max: 2, step: 0.01 },
    { key: 'baseDark', min: 0, max: 1, step: 0.01 },
    { key: 'stormLit', min: 0, max: 1, step: 0.01 },
    { key: 'emberK', min: 0, max: 1, step: 0.01 },
    { key: 'emberElev', min: 0, max: 60, step: 0.5 },
    { key: 'emberGain', min: 0, max: 5, step: 0.05 }
  ]);
  knobGroup('fog', GLASS.fog, BOOT.fog, [
    { key: 'thr', min: 0, max: 1, step: 0.01 },
    { key: 'full', min: 0, max: 1, step: 0.01 },
    { key: 'burnBand', min: 0, max: 30, step: 0.5 },
    { key: 'maxK', min: 0, max: 1, step: 0.01 },
    { key: 'zenK', min: 0, max: 1, step: 0.01 },
    { key: 'discK', min: 0, max: 1, step: 0.01 },
    { key: 'stormKill', min: 0, max: 1, step: 0.01 },
    { key: 'nightK', min: 0, max: 1, step: 0.01 },
    { key: 'col', color: true }
  ]);
  knobGroup('moon', GLASS.moon, BOOT.moon, [
    { key: 'elevMax', min: 0, max: 90, step: 0.5 },
    { key: 'azimOffset', min: 0, max: 360, step: 1 },
    { key: 'radius', min: 0, max: 0.2, step: 0.001 },
    { key: 'bright', min: 0, max: 3, step: 0.01 },
    { key: 'earthshine', min: 0, max: 1, step: 0.01 },
    { key: 'halo', min: 0, max: 0.3, step: 0.005 },
    { key: 'col', color: true },
    { key: 'hemiLift', min: 0, max: 1, step: 0.01 }
  ]);
  knobGroup('wind / water', GLASS.windwater, BOOT.windwater, [
    { key: 'capThr', min: 0, max: 1, step: 0.01 },
    { key: 'capK', min: 0, max: 2, step: 0.01 },
    { key: 'anisoK', min: 0, max: 1, step: 0.01 },
    { key: 'ampK', min: 0, max: 1, step: 0.01 },
    { key: 'currentK', min: 0, max: 5, step: 0.05 },
    { key: 'decayH', min: 0, max: 300, step: 1 }
  ]);

  // --- THE FLOW LEAN (roadmap/flow-lean-style.md) -----------------------------
  // ONE master dial; each axis can peel off. -1 on a sub-knob = follow the master.
  el('h4', null, bd, 'the flow lean');
  {
    const d = el('details', 'stop', bd); d.open = true;
    const sm = el('summary', null, d); el('span', null, sm, 'style');
    const in_ = el('div', 'in', d);
    const follow = x => (+x < 0 ? 'follow' : (+x).toFixed(2));
    slider(in_, 'flowLean (master)', GLASS.style, 'flowLean', 0, 1, 0.01, BOOT.style.flowLean);
    [['paint', 'roughness/metalness law'], ['edge', 'edge-not-middle detail'], ['strokes', 'silhouette strokes'],
     ['haze', 'atmosphere + halation'], ['grade', 'zone colour'], ['dof', 'focus with intent'],
     ['camera', 'handheld + interest'], ['light', 'rim-led light + shadows'], ['matte', 'matte sea']]
      .forEach(([k, why]) => {
        const r = slider(in_, k, GLASS.style, k, -1, 1, 0.01, BOOT.style[k], follow);
        r.title = why + ' — drag left of 0 to follow the master';
      });
    el('p', 'note', in_, '0 = shipped look, 1 = full lean. sub-knobs at "follow" track the master.');
  }

  // --- SURFACE: the sun -------------------------------------------------------
  el('h4', null, bd, 'surface — sun');
  const s = GLASS.sun, bs = BOOT.sun;
  slider(bd, 'elev noon', s, 'elevNoon', 5, 89, 0.5, bs.elevNoon);
  slider(bd, 'elev dawn', s, 'elevDawn', 0, 60, 0.5, bs.elevDawn);
  slider(bd, 'elev night', s, 'elevNight', 0, 40, 0.5, bs.elevNight);
  slider(bd, 'azim centre', s, 'azimCenter', -180, 180, 0.5, bs.azimCenter);
  slider(bd, 'azim sweep', s, 'azimSweep', 0, 360, 1, bs.azimSweep);

  // --- SURFACE: the palette stops ---------------------------------------------
  el('h4', null, bd, 'surface — stops');
  el('p', 'note', bd, 'zen / hor / disc paint the sky. gain = absolute radiance; the well is hue only.');
  const details = [];
  ['night', 'dawn', 'noon', 'dusk', 'storm'].forEach(nm => {
    const d = el('details', 'stop', bd);
    details.push(d);
    const sm = el('summary', null, d);
    el('span', null, sm, nm);
    const in_ = el('div', 'in', d);
    const p = GLASS.stops[nm], bp = BOOT.stops[nm];
    colorField(in_, 'zen', p, 'zen', bp.zen);
    colorField(in_, 'hor', p, 'hor', bp.hor);
    colorField(in_, 'disc', p, 'disc', bp.disc);
    colorField(in_, 'tint', p, 'tint', bp.tint);
    slider(in_, 'surfK', p, 'surfK', 0, 2, 0.01, bp.surfK);
    slider(in_, 'desat', p, 'desat', 0, 1, 0.01, bp.desat);
    // one stop open at a time
    d.addEventListener('toggle', () => {
      if (d.open) details.forEach(o => { if (o !== d) o.open = false; });
    });
  });

  // --- BELOW ------------------------------------------------------------------
  el('h4', null, bd, 'below');
  el('p', 'note', bd,
    'the column reads the same GLASS through the storm envelope (sky leads, sea trails, ' +
    'below lags ~8s). tint / surfK / desat above are the subsurface knobs; the readout ' +
    'shows all three envelope taps so surface and depth can be watched moving together.');
  const bro = el('div', 'ro', bd);

  // --- OUT --------------------------------------------------------------------
  el('h4', null, bd, 'out');
  const obt = el('div', 'btns', bd);
  const cp = el('button', null, obt, 'copy the constants');
  const status = el('p', 'note', bd, '');
  cp.addEventListener('click', async () => {
    const txt = serialize();
    let ok = false;
    try { await navigator.clipboard.writeText(txt); ok = true; } catch (e) { /* insecure ctx */ }
    const blob = new Blob([JSON.stringify({ sun: GLASS.sun, stops: GLASS.stops }, null, 2)],
      { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'glass-snapshot.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    status.textContent = (ok ? 'copied + ' : 'clipboard blocked — see console + ') + 'glass-snapshot.json';
    if (!ok) console.log(txt);
  });
  const rs = el('button', null, obt, 'reset');
  rs.addEventListener('click', () => {
    const b = clone(BOOT);
    Object.assign(GLASS.sun, b.sun);
    for (const nm in b.stops) Object.assign(GLASS.stops[nm], b.stops[nm]);
    Object.assign(GLASS.cloud, b.cloud);
    Object.assign(GLASS.fog, b.fog);
    Object.assign(GLASS.moon, b.moon);
    Object.assign(GLASS.windwater, b.windwater);
    Object.assign(GLASS.style, b.style);
    syncAll();
    status.textContent = 'boot values restored';
  });
  el('p', 'note', bd, 'the lab never writes the save. closing returns the natural clock.');

  // --- readout, 5 Hz (no rAF, no per-frame allocation in the game loop) --------
  const TICKS = [[0, 'mid'], [0.25, 'dawn'], [0.5, 'noon'], [0.75, 'dusk'], [1, 'mid']];
  function drawRing(u01, day) {
    const w = ring.clientWidth || 300, h = 26;
    if (ring.width !== w) { ring.width = w; ring.height = h; }
    rx.clearRect(0, 0, w, h);
    // day/night band
    for (let i = 0; i < w; i += 2) {
      const uu = i / w;
      const e = -Math.cos(Math.PI * 2 * uu);
      const d = Math.min(1, Math.max(0, (e + 0.393) / 0.786));
      const v = Math.round(14 + d * 58);
      rx.fillStyle = `rgb(${v + 6},${v + 4},${Math.round(v * 0.9)})`;
      rx.fillRect(i, 8, 2, 12);
    }
    rx.fillStyle = 'rgba(200,191,168,0.5)';
    rx.font = '8px ui-monospace,monospace';
    for (const [u, nm] of TICKS) {
      const x = Math.min(w - 1, Math.round(u * w));
      rx.fillRect(x, 4, 1, 18);
      if (u < 1) rx.fillText(nm, Math.min(w - 20, x + 2), 3 + 5);
    }
    const px = Math.round(u01 * w);
    rx.fillStyle = '#c08a3a';
    rx.fillRect(px - 1, 2, 2, 22);
  }

  tick = setInterval(() => {
    if (panel.classList.contains('off')) return;
    const w = wx(); if (!w) return;
    const q = w.state();
    ro.textContent =
      `phase ${q.phase01.toFixed(3)}  ring ${q.ring.toFixed(2)}\n` +
      `day   ${q.day.toFixed(3)}  storm ${q.storm.toFixed(3)}  flash ${q.flash.toFixed(2)}\n` +
      `sun   elev ${q.sunElev.toFixed(1)}°  azim ${q.sunAzim.toFixed(1)}°\n` +
      `dir   ${SUN.dir.x.toFixed(3)} ${SUN.dir.y.toFixed(3)} ${SUN.dir.z.toFixed(3)}`;
    bro.textContent =
      `env  sky ${q.env.sky.toFixed(3)}\n     sea ${q.env.sea.toFixed(3)}\n` +
      `   below ${q.env.below.toFixed(3)}`;
    if (!dragging) time.value = Math.round(q.phase01 * 1000);
    drawRing(q.phase01, q.day);

    // --- today's hand -----------------------------------------------------
    const h = q.hand;
    const stormTxt = h.stormDay
      ? `at ${h.stormAt.toFixed(2)} len ${h.stormLen.toFixed(0)} peak ${h.stormPeak.toFixed(2)}`
      : '—';
    hro.textContent =
      `day    ${q.dayIndex}\n` +
      `fog    ${h.fog.toFixed(2)}  burn ${h.fogBurn.toFixed(1)}\n` +
      `clouds ${h.clouds.toFixed(2)}  tex ${h.cloudTex.toFixed(2)}\n` +
      `storm  ${stormTxt}\n` +
      `sunset drama ${h.sunsetDrama.toFixed(2)}\n` +
      `moon   K ${h.moonK.toFixed(2)}  phase ${h.moonPhase.toFixed(2)}\n` +
      `wind base ${h.windBase.toFixed(2)}`;

    // --- wind ---------------------------------------------------------------
    const sky = window.__sky;
    if (sky) {
      const p = sky.probe();
      wro.textContent =
        `eased  speed ${p.windS.toFixed(3)}\n` +
        `target speed ${p.windT[0].toFixed(3)}  ${p.forced ? '(forced)' : '(auto)'}`;
    }
  }, 200);

  // --- input containment ------------------------------------------------------
  // game.js listens for keydown on window (bubble phase). Anything typed inside the
  // panel is stopped here, so a hex digit in a colour field can never fire a game key.
  const eat = e => {
    if (e.key === 'Escape') { close(); return; }
    e.stopPropagation();
  };
  panel.addEventListener('keydown', eat);
  panel.addEventListener('keyup', e => e.stopPropagation());
  panel.addEventListener('keypress', e => e.stopPropagation());
  // Escape anywhere closes the panel. Nothing in game.js binds Escape.
  addEventListener('keydown', e => {
    if (e.key === 'Escape' && !panel.classList.contains('off')) close();
  });
  xb.addEventListener('click', close);
  tab.addEventListener('click', open);

  function close() {
    panel.classList.add('off'); tab.classList.remove('off');
    const w = wx(); if (w) { w.pause(false); w.speed(1); }
    sb.forEach(o => o.classList.remove('on')); sb[1].classList.add('on');
    if (document.activeElement && panel.contains(document.activeElement)) document.activeElement.blur();
  }
  function open() { panel.classList.remove('off'); tab.classList.add('off'); }

  refresh();
  console.info('ABYSSA: the glass — lab open (?lab). Esc closes.');
}

// weather.js publishes window.weather inside initWeather(), which runs during the world
// build; this module is imported at the end of game.js module scope, which is earlier.
// Wait for the surface rather than racing it.
(function wait() {
  if (!document.body || !window.weather) { setTimeout(wait, 60); return; }
  build();
})();
