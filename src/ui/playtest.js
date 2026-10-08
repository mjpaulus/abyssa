// THE PLAYTEST JUMPS (roadmap/playtest-jumps.md). Loaded ONLY under ?playtest (game.js's
// guarded dynamic import): a normal load never fetches this file, so it adds no listener
// and builds no DOM. Michael plays the checklist at 60 fps in his own browser; each Alt+key
// (Option on a Mac) puts the game straight into one scenario through the game's own paths
// (start / enterZone / reseedWorld / weather.set / the respawn's placement, still and
// re-dressed, the line re-laid, the lens cut behind him), then leaves ordinary play: no
// pointer lock is taken, so without one the game pauses as always and a click takes the helm.
//
//   Alt+1 DECK, CALM      Alt+2 DECK, GALE      Alt+3 SEABED, ZONE 0   Alt+4 HOSE END
//   Alt+5 SHARK           Alt+6 VELKATH         Alt+7 ORUNE            Alt+8 MHOR
//   Alt+9 CHART           Alt+0 RESTORE         Alt+- NEXT ANCHORAGE   Alt+/ the panel
//
// Keys go by e.code (Digit1.., Minus, Slash) so Option's typed symbols never matter, and
// every one is preventDefault'ed and stopped here (capture phase) so nothing else sees it.
// None of this runs per frame: the panel and the toast change only on a key.
// OWNED BY: orchestrator (dev tool).
import { player } from '../player.js';
import { survival, reserveCapacity, mendDress } from '../systems/survival.js';
import { terrainH, terrainNormal } from '../world/terrain.js';
import { rockColliders } from '../world/flora.js';
import { propColliders } from '../world/props.js';
import { wreckColliders } from '../world/wrecks.js';
import { ventColliders } from '../world/vents.js';
import { raft, pumpPos, chartAnchor } from '../systems/raft.js';
import { placeOnDeck } from '../player.js';
import { riftPos, RIFT_R, zoneTop } from '../config.js';
import { currentSiteIndex, siteAt } from '../world/site.js';
import { bodyBlocked } from '../entities/sleeper/bodyCols.js';

const EYE_H = 1.35;                 // player.js: his eye over his boots
const TAU = Math.PI * 2;
// Home seabed spot for 3 / 4 / 5: ~25 u off the raft's hose line (horizontally from the
// pump), on this bearing from it, or the nearest clear, gentle ground round from it.
const SEABED_R = 25, SEABED_BEAR = -2.2;
const SHARK_D = 40;

let H = null;                       // game.js hooks
let $panel = null, $now = null, $toast = null, toastT = 0;
let last = '—';

const ORDER = [
  ['1', 'DECK, CALM'], ['2', 'DECK, GALE'], ['3', 'SEABED, ZONE 0'], ['4', 'HOSE END'],
  ['5', 'SHARK'], ['6', 'VELKATH'], ['7', 'ORUNE'], ['8', 'MHOR'],
  ['9', 'CHART'], ['0', 'RESTORE'], ['−', 'NEXT ANCHORAGE'], ['/', 'HIDE / SHOW']
];

export function installPlaytest(hooks) {
  H = hooks;
  buildDom();
  addEventListener('keydown', onKey, true);
  window.__playtest = { jump: k => jump(k), last: () => last };
}

function onKey(e) {
  if (!e.altKey || e.ctrlKey || e.metaKey) return;
  const c = e.code;
  let k = null;
  if (c.length === 6 && c.startsWith('Digit')) k = c[5];
  else if (c === 'Minus') k = '-';
  else if (c === 'Slash') k = '/';
  if (k === null) return;
  e.preventDefault();               // Option+digit would type a symbol
  e.stopImmediatePropagation();     // nothing else in the game hears an Alt+key
  if (e.repeat) return;
  if (k === '/') { togglePanel(); return; }
  jump(k);
}

// ---- placement helpers (key-press time only: allocation is fine here) --------------------
const yawTo = (dx, dz) => Math.atan2(dx, dz);   // he faces (sin yaw, cos yaw)
const COLS = [rockColliders, propColliders, wreckColliders, ventColliders];
// Gentle ground, clear of every solid the push-out knows, out of the rift bowls.
function clearGround(x, z, zi, pad) {
  if (terrainNormal(x, z, zi).y < 0.9) return false;
  const y = terrainH(x, z, zi) + 1;
  for (const L of COLS) for (let i = 0; i < L.length; i++) {
    const c = L[i], dx = x - c.x, dy = y - c.y, dz = z - c.z, rr = c.r + pad;
    if (dx * dx + dy * dy + dz * dz < rr * rr) return false;
  }
  for (let r = zi; r <= zi; r++) {
    const rp = riftPos(r);
    if (Math.hypot(x - rp.x, z - rp.z) < RIFT_R * 3.2) return false;
  }
  return true;
}
// The lens hangs from his eye straight back along his look (game.js clearCamDistance stops
// the boom where that ray comes within 1.1 of the ground or a solid). So for a spot, find
// the shallowest downward look (pitch) whose boom clears: level ground takes the usual
// -0.05, a bowl (Mhor's furnace sits in one) needs him looking a little down. null: none.
const PITCHES = [-0.05, -0.15, -0.25, -0.35];
function lensPitch(x, z, zi, dx, dz) {
  const y0 = terrainH(x, z, zi);
  for (const pt of PITCHES) {
    const up = Math.sin(-pt);
    let ok = true;
    for (const d of [2, 4, 6, 8, 10]) {
      const bx = x + dx * d, bz = z + dz * d, by = y0 + EYE_H + up * d;
      if (terrainH(bx, bz, zi) + 1.3 > by) { ok = false; break; }
      for (const L of COLS) { for (let i = 0; i < L.length; i++) {
        const c = L[i], ex = bx - c.x, ey = by - c.y, ez = bz - c.z, rr = c.r + 1.2;
        if (ex * ex + ey * ey + ez * ez < rr * rr) { ok = false; break; }
      } if (!ok) break; }
      if (!ok) break;
    }
    if (ok) return pt;
  }
  return null;
}
// Round about (cx, cz) at radius r from `bear`, alternating either side, then a little
// nearer and further: the first clear spot whose boom clears wins (then, failing every one,
// the first merely clear one). Deterministic for a given world. `back`: which way the lens
// hangs along the radius (+1: he faces the centre, so it is further out; -1: he faces out).
function findGround(cx, cz, r, bear, zi, pad = 2.5, ok = null, back = 1) {
  for (const strict of [true, false]) {
    for (const rr of [r, r * 0.85, r * 1.2, r * 0.7, r * 1.45]) {
      for (let k = 0; k < 48; k++) {
        const a = bear + (k & 1 ? 1 : -1) * Math.ceil(k / 2) * (TAU / 48);
        const sx = Math.sin(a), sz = Math.cos(a), x = cx + sx * rr, z = cz + sz * rr;
        if (!clearGround(x, z, zi, pad) || (ok && !ok(x, z))) continue;
        const pitch = lensPitch(x, z, zi, sx * back, sz * back);
        if (strict && pitch === null) continue;
        return { x, z, pitch: pitch === null ? -0.05 : pitch };
      }
    }
  }
  return { x: cx + Math.sin(bear) * r, z: cz + Math.cos(bear) * r, pitch: -0.05 };   // nothing clear: the plain spot
}
let pitchNext = -0.05;   // the look a spot's boom needs (lensPitch), for the settle
function standAt(x, z, zi, yaw, pitch = -0.05) {
  player.pos.set(x, terrainH(x, z, zi) + EYE_H, z);
  player.yaw = yaw;
  pitchNext = pitch;
}
// Raise the line to reach where he stands, with room to move (never lowers it).
// (the HUD calls the line TAUT past 0.92 of it: arrive well inside that)
function lineFor(margin = 30) {
  const d = player.pos.distanceTo(pumpPos);
  const need = Math.ceil(Math.max(d + margin, d / 0.85));
  if (survival.hose < need) { survival.hose = need; return ' · LINE ' + Math.round(need * 3) + ' M'; }
  return '';
}
function refill() {
  survival.oxygen = 1;
  survival.reserve = survival.reserveCap = reserveCapacity();
  survival.fuel = Math.max(survival.fuel, 0.5);
  survival.sputter = 0; survival.strain = 0;
  mendDress();
  player.light = 1;
}
function home() {
  if (currentSiteIndex() === 0) return '';
  H.reseedWorld(0);
  return 'SAILED HOME · ';
}
function seabedSpot() {
  return findGround(pumpPos.x, pumpPos.z, SEABED_R, SEABED_BEAR, 0, 2.5, null, -1);
}
function sleeperNote() {
  const L = H.lev;
  return L && L.remembered ? ' · SHE REMEMBERS: ONE WARD ALREADY LIT (CHART PENCIL)' : '';
}
function deck() {
  H.deckSpawn();
  player.yaw = H.DECK_SPAWN_YAW;
  H.settle(true, true);
}

// ---- the jumps ----------------------------------------------------------------------------
function jump(k) {
  if (!H) return;
  pitchNext = -0.05;
  let pre = H.toPlay();
  if (pre) pre += ' · ';
  let line = '', label = '';
  switch (k) {
    case '1': {
      label = '1 · DECK, CALM';
      pre += home();
      window.weather.set(1, 0);
      H.enterZone(0);
      deck(); refill();
      line = 'DECK, CALM — CALM MIDDAY AT THE HOME MOORING';
      break;
    }
    case '2': {
      label = '2 · DECK, GALE';
      pre += home();
      window.weather.set(1, 1);
      H.enterZone(0);
      deck(); refill();
      line = 'DECK, GALE — FULL GALE (THE SEA BUILDS OVER A FEW SECONDS)';
      break;
    }
    case '3': case '4': {
      pre += home();
      H.enterZone(0);
      const s = seabedSpot();
      // facing out, away from the raft: open ground ahead
      standAt(s.x, s.z, 0, yawTo(s.x - pumpPos.x, s.z - pumpPos.z), s.pitch);
      refill();
      if (k === '3') {
        label = '3 · SEABED, ZONE 0';
        line = 'SEABED, ZONE 0 — ' + SEABED_R + ' U OFF THE LINE, RESERVE FULL' + lineFor();
      } else {
        // THE LINE ENDS 8 U ON: the leash measures range straight from the pump, so this
        // is 8 u of range left. Here the line hangs steeply (the seabed is ~240 down, he is
        // 25 out), so walking straight out spends that range slowly (~20 u of walking);
        // a burst up-and-out spends it fastest. Not in the give band on arrival (last 5 u).
        label = '4 · HOSE END';
        survival.hose = player.pos.distanceTo(pumpPos) + 8;
        line = 'HOSE END — 8 U OF LINE LEFT (' + Math.round(survival.hose * 3) + ' M). WALK OUT OR BURST UP-AND-OUT INTO IT';
      }
      H.settle(false, true, pitchNext);
      break;
    }
    case '5': {
      label = '5 · SHARK';
      pre += home();
      H.enterZone(0);
      const s = seabedSpot();
      const fy = terrainH(s.x, s.z, 0);
      const yaw = yawTo(s.x - pumpPos.x, s.z - pumpPos.z);
      player.pos.set(s.x, (fy + zoneTop(0)) * 0.5, s.z);
      player.yaw = yaw;
      refill();
      line = 'SHARK — ' + shark(yaw) + lineFor();
      H.settle(false, false);
      break;
    }
    case '6': {
      label = '6 · VELKATH';
      H.enterZone(0);
      line = 'VELKATH — ' + velkath();
      refill();
      line += lineFor() + sleeperNote();
      H.settle(false, true, pitchNext);
      break;
    }
    case '7': {
      label = '7 · ORUNE';
      H.enterZone(1);
      player.hasLamp = false;   // the ship's lamp is back on the hoard
      line = 'ORUNE — ' + orune();
      refill();
      line += lineFor() + sleeperNote();
      H.settle(false, true, pitchNext);
      break;
    }
    case '8': {
      label = '8 · MHOR';
      H.enterZone(2);
      survival.bitumen = Math.max(survival.bitumen, 2);
      line = 'MHOR — ' + mhor();
      refill();
      line += lineFor() + sleeperNote();
      H.settle(false, true, pitchNext);
      break;
    }
    case '9': {
      label = '9 · CHART';
      H.enterZone(0);
      chartTable();
      refill();
      H.settle(true, true);
      H.consultChart();
      line = 'CHART — PICK AN ANCHORAGE (ESC PUTS IT DOWN)';
      break;
    }
    case '0': {
      label = last === '—' ? '0 · RESTORED' : last.replace(/ · RESTORED$/, '') + ' · RESTORED';
      survival.oxygen = 1;
      survival.reserve = survival.reserveCap = reserveCapacity();
      survival.fuel = 1;
      survival.sputter = 0;
      mendDress();
      player.light = 1;
      line = 'RESTORED — AIR, RESERVE, FUEL, DRESS, LANTERN';
      break;
    }
    case '-': {
      const cur = currentSiteIndex();
      const next = cur === 0 ? 1 : cur === 1 ? 2 : 0;   // home -> Pallid Bank -> Burned Ground -> home
      H.reseedWorld(next);   // the voyage's own reseed, without the passage: lands on deck
      deck(); refill();
      label = '− · NEXT ANCHORAGE';
      line = 'SAILED TO ' + siteAt(next).name;
      break;
    }
    default: return;
  }
  H.hush();
  last = label;
  $now.textContent = label + ' — ' + siteAt(currentSiteIndex()).name;
  toast(pre + line);
}

// The zone-0 shark (window.pred is predators.js's dev surface; its objects are live): set it
// 40 u off him, ahead and a little to the side, already INTERESTED and circling in from that
// range. Interest -> windup needs 10 s of circling (SH.minInterest); it starts at 5, so the
// approach runs ~5 s, then the wind-up and the run come when he is inside 42 u.
function shark(yaw) {
  const P = window.pred;
  const S = P && P.sharks.find(s => s.cfg.zi === 0);
  if (!S) return 'NO SHARK IN ZONE 0';
  const a = yaw + 0.45;
  S.pos.set(player.pos.x + Math.sin(a) * SHARK_D, player.pos.y + 4, player.pos.z + Math.cos(a) * SHARK_D);
  const dx = S.pos.x - player.pos.x, dz = S.pos.z - player.pos.z;
  S.orbitPh = Math.atan2(dz, dx);   // predators.js orbits at (cos ph, sin ph) * R about him
  S.orbitR = SHARK_D;
  S.fwd.set(-Math.sin(S.orbitPh), 0, Math.cos(S.orbitPh)).normalize();   // on its circle
  S.state = 'interest'; S.tState = 5;
  S.arousal = 1.2; S.cool = 0; S.bit = false; S.blinded = 0;
  return 'ONE CIRCLES IN FROM ' + SHARK_D + ' U. ITS RUN COMES IN ~5 S. SWIM, BURST, OR INK';
}

// The Brooder's clutch (brooder-clutch): stand him where it bulges out from under her rim,
// in reach of it (the rite's own test, brood.canTake, says so), clear of her body (the
// collider the push-out uses), facing it.
function velkath() {
  const L = H.lev, B = L && L.brood;
  if (!B || !B.seated) return 'NO CLUTCH HERE (' + (L ? L.kind : 'NO SLEEPER') + ')';
  const t = B.takeAt, bx = L.pos.x, bz = L.pos.z;
  const out = yawTo(t.x - bx, t.z - bz);
  const probe = player.pos.clone();
  const ok = (x, z) => {
    const y = terrainH(x, z, 0);
    if (terrainNormal(x, z, 0).y < 0.6) return false;
    probe.set(x, y + EYE_H, z);
    if (!B.canTake(probe)) return false;
    for (const h of [0.45, 1.0, 1.6]) if (bodyBlocked(x, y + h, z, 0.45)) return false;
    return true;
  };
  let s = null;
  for (const r of [2.0, 2.6, 1.4, 3.2, 3.8, 1.0, 4.4]) {
    for (let k = 0; k < 24 && !s; k++) {
      const a = out + (k & 1 ? 1 : -1) * Math.ceil(k / 2) * (TAU / 24);
      const x = t.x + Math.sin(a) * r, z = t.z + Math.cos(a) * r;
      if (ok(x, z)) s = { x, z };
    }
    if (s) break;
  }
  if (!s) s = { x: t.x + Math.sin(out) * 2.5, z: t.z + Math.cos(out) * 2.5 };
  standAt(s.x, s.z, 0, yawTo(t.x - s.x, t.z - s.z), -0.3);
  return 'AT HER CLUTCH, IN REACH. [E] PRIES A CLUMP AND SHE WAKES';
}

// Orune's hoard: stand him ~14 u off the ship's lamp, on the open side away from her body,
// facing the lamp, so the hoard and the lamp are ahead and the walk in is his.
function orune() {
  const L = H.lev, Hd = L && L.hoard;
  if (!Hd) return 'NO HOARD HERE (' + (L ? L.kind : 'NO SLEEPER') + ')';
  const lp = Hd.lampPos, c = Hd.center || lp;
  const bx = L.pos ? L.pos.x : c.x + 1, bz = L.pos ? L.pos.z : c.z;
  let bear = yawTo(lp.x - bx, lp.z - bz);
  if (Math.hypot(lp.x - bx, lp.z - bz) < 1) bear = 0;
  const s = findGround(lp.x, lp.z, 14, bear, 1, 2.5);
  standAt(s.x, s.z, 1, yawTo(lp.x - s.x, lp.z - s.z), s.pitch);
  return "THE SHIP'S LAMP AHEAD. WALK IN; [E] TAKES IT AND SHE WAKES";
}

// Mhor's field: the cold furnace (hunter.js L.furnace), him inside its feeding reach, on
// the side toward the rift he came down, facing it. 2 bitumen are in his bag.
function mhor() {
  const L = H.lev, F = L && L.furnace;
  if (!F) return 'NO FURNACE HERE (' + (L ? L.kind : 'NO SLEEPER') + ')';
  const f = F.pos, rp = riftPos(1);
  const s = findGround(f.x, f.z, 8.5, yawTo(rp.x - f.x, rp.z - f.z), 2, 0.8,
    (x, z) => Math.hypot(x - f.x, z - f.z) < 9.8);
  standAt(s.x, s.z, 2, yawTo(f.x - s.x, f.z - s.z), s.pitch);
  return 'THE COLD FURNACE, 2 BITUMEN IN THE BAG. [E] FEEDS IT';
}

// The chart table's standing spot (raft-local chartAnchor), facing the board (raft -Z).
function chartTable() {
  placeOnDeck(chartAnchor.x, chartAnchor.z);
  raft.updateMatrixWorld(true);
  const e = raft.matrixWorld.elements;   // the raft's local -Z, in the world
  player.yaw = yawTo(-e[8], -e[10]);
}

// ---- the panel and the toast ---------------------------------------------------------------
function buildDom() {
  const st = document.createElement('style');
  st.textContent = `
  #ptDock{position:absolute;right:1.2em;bottom:2em;z-index:3;pointer-events:none;display:flex;flex-direction:column;
    align-items:flex-end;gap:.6em;font-family:Georgia,'Times New Roman',serif;text-transform:uppercase}
  #ptPanel{font-size:.56em;letter-spacing:.16em;color:#d8cdb2;background:rgba(1,4,9,.58);
    border:1px solid rgba(201,164,106,.34);border-radius:2px;padding:.75em .95em .7em;max-width:min(30em,40vw)}
  #ptPanel.off{display:none}
  #ptPanel h4{margin:0 0 .55em;font-weight:400;font-size:1em;letter-spacing:.3em;color:#c9a46a;opacity:.9}
  #ptPanel .g{display:grid;grid-template-columns:auto 1fr auto 1fr;gap:.28em .7em;align-items:baseline}
  #ptPanel b{font-weight:400;color:#d9b97c;font-variant-numeric:tabular-nums}
  #ptPanel .now{margin-top:.65em;padding-top:.5em;border-top:1px solid rgba(201,164,106,.22);color:#bfe3e8;opacity:.85}
  #ptToast{font-size:.62em;letter-spacing:.16em;color:#e8d4a6;background:rgba(1,4,9,.62);
    border-left:2px solid rgba(217,184,119,.75);padding:.45em .8em;max-width:min(52em,62vw);white-space:nowrap;
    overflow:hidden;text-overflow:ellipsis;opacity:0;transition:opacity .25s}
  #ptToast.on{opacity:1}`;
  document.head.appendChild(st);
  const ui = document.getElementById('ui') || document.body;
  $panel = document.createElement('div');
  $panel.id = 'ptPanel';
  const h = document.createElement('h4');
  h.textContent = 'PLAYTEST · ALT / ⌥ +';
  const g = document.createElement('div');
  g.className = 'g';
  for (const [key, name] of ORDER) {
    const kb = document.createElement('b'); kb.textContent = key;
    const nm = document.createElement('span'); nm.textContent = name;
    g.append(kb, nm);
  }
  $now = document.createElement('div');
  $now.className = 'now';
  $now.textContent = 'NOW — ' + (siteAt(currentSiteIndex()) || { name: '' }).name;
  $panel.append(h, g, $now);
  $toast = document.createElement('div');
  $toast.id = 'ptToast';
  const dock = document.createElement('div');
  dock.id = 'ptDock';
  dock.append($toast, $panel);
  ui.append(dock);
  let off = false;
  try { off = localStorage.getItem('abyssa.playtest.panel') === 'off'; } catch (e) { /* private mode */ }
  $panel.classList.toggle('off', off);
}
function togglePanel() {
  const off = !$panel.classList.contains('off');
  $panel.classList.toggle('off', off);
  try { localStorage.setItem('abyssa.playtest.panel', off ? 'off' : 'on'); } catch (e) { /* private mode */ }
}
function toast(text) {
  $toast.textContent = text;
  $toast.title = text;
  $toast.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => $toast.classList.remove('on'), 3200);
}
