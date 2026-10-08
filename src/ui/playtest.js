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
// Round about (cx, cz) at radius r from `bear`, alternating either side, then a little
// nearer and further: the first clear spot wins. Deterministic for a given world.
function findGround(cx, cz, r, bear, zi, pad = 2.5, ok = null) {
  for (const rr of [r, r * 0.85, r * 1.2, r * 0.7, r * 1.45]) {
    for (let k = 0; k < 48; k++) {
      const a = bear + (k & 1 ? 1 : -1) * Math.ceil(k / 2) * (TAU / 48);
      const x = cx + Math.sin(a) * rr, z = cz + Math.cos(a) * rr;
      if (clearGround(x, z, zi, pad) && (!ok || ok(x, z))) return { x, z };
    }
  }
  return { x: cx + Math.sin(bear) * r, z: cz + Math.cos(bear) * r };   // nothing clear: the plain spot
}
function standAt(x, z, zi, yaw) {
  player.pos.set(x, terrainH(x, z, zi) + EYE_H, z);
  player.yaw = yaw;
}
// Raise the line to reach where he stands, with room to move (never lowers it).
function lineFor(margin = 30) {
  const need = Math.ceil(player.pos.distanceTo(pumpPos) + margin);
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
  return findGround(pumpPos.x, pumpPos.z, SEABED_R, SEABED_BEAR, 0);
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
      standAt(s.x, s.z, 0, yawTo(s.x - pumpPos.x, s.z - pumpPos.z));
      refill();
      if (k === '3') {
        label = '3 · SEABED, ZONE 0';
        line = 'SEABED, ZONE 0 — ' + SEABED_R + ' U OFF THE LINE, RESERVE FULL' + lineFor();
      } else {
        // THE LINE ENDS ~8 U AHEAD: the leash measures straight from the pump, so the
        // length that puts its end 8 u along his heading is the range of THAT point (the
        // line hangs steeply here, so range + 8 would end it ~20 u off instead).
        label = '4 · HOSE END';
        const ax = player.pos.x + Math.sin(player.yaw) * 8, az = player.pos.z + Math.cos(player.yaw) * 8;
        const ay = terrainH(ax, az, 0) + EYE_H;
        survival.hose = Math.hypot(ax - pumpPos.x, ay - pumpPos.y, az - pumpPos.z);
        line = 'HOSE END — THE LINE RUNS OUT 8 U AHEAD (' + Math.round(survival.hose * 3) + ' M). WALK OR BURST INTO IT';
      }
      H.settle(false, true);
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
      H.settle(false, true);
      break;
    }
    case '7': {
      label = '7 · ORUNE';
      H.enterZone(1);
      player.hasLamp = false;   // the ship's lamp is back on the hoard
      line = 'ORUNE — ' + orune();
      refill();
      line += lineFor() + sleeperNote();
      H.settle(false, true);
      break;
    }
    case '8': {
      label = '8 · MHOR';
      H.enterZone(2);
      survival.bitumen = Math.max(survival.bitumen, 2);
      line = 'MHOR — ' + mhor();
      refill();
      line += lineFor() + sleeperNote();
      H.settle(false, true);
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
      label = '− · ' + siteAt(next).name;
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
// range. Interest -> windup needs 10 s of circling (SH.minInterest); it starts at 7, so the
// approach runs ~3 s, then the wind-up and the run come when he is inside 42 u.
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
  S.state = 'interest'; S.tState = 7;
  S.arousal = 1.2; S.cool = 0; S.bit = false; S.blinded = 0;
  return 'ONE CIRCLES IN FROM ' + SHARK_D + ' U. ITS RUN COMES IN ~3 S. SWIM, BURST, OR INK';
}

// The Brooder's nest: stand him on the far side of the nest from her body, the nearest egg
// in arm's reach (the rite's own test, brood.nearEgg, says so), facing the clutch and her.
function velkath() {
  const L = H.lev, B = L && L.brood;
  if (!B) return 'NO BROOD HERE (' + (L ? L.kind : 'NO SLEEPER') + ')';
  const n = B.nest, bx = L.pos ? L.pos.x : n.x + 1, bz = L.pos ? L.pos.z : n.z;
  const bear = yawTo(n.x - bx, n.z - bz);
  const probe = player.pos.clone();
  const reach = (x, z) => { probe.set(x, terrainH(x, z, 0) + EYE_H, z); return B.nearEgg(probe) >= 0; };
  let s = null;
  for (const r of [3.0, 2.4, 3.6, 1.8, 4.2]) {
    const c = findGround(n.x, n.z, r, bear, 0, 0.6, reach);
    if (reach(c.x, c.z)) { s = c; break; }
  }
  if (!s) s = { x: n.x + Math.sin(bear) * 2, z: n.z + Math.cos(bear) * 2 };
  standAt(s.x, s.z, 0, yawTo(n.x - s.x, n.z - s.z));
  return 'AT THE NEST, AN EGG IN REACH. [E] TAKES IT AND SHE WAKES';
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
  standAt(s.x, s.z, 1, yawTo(lp.x - s.x, lp.z - s.z));
  return "THE SHIP'S LAMP AHEAD. WALK IN; [E] TAKES IT AND SHE WAKES";
}

// Mhor's field: the cold furnace (hunter.js L.furnace), him inside its feeding reach, on
// the side toward the rift he came down, facing it. 2 bitumen are in his bag.
function mhor() {
  const L = H.lev, F = L && L.furnace;
  if (!F) return 'NO FURNACE HERE (' + (L ? L.kind : 'NO SLEEPER') + ')';
  const f = F.pos, rp = riftPos(1);
  const s = findGround(f.x, f.z, 7.5, yawTo(rp.x - f.x, rp.z - f.z), 2, 0.8,
    (x, z) => Math.hypot(x - f.x, z - f.z) < 9.5);
  standAt(s.x, s.z, 2, yawTo(f.x - s.x, f.z - s.z));
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
