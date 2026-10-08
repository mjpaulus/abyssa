// Pin the look-dev camera (?lab) beside the last ward for the proof shots, aim Sal at the ward.
const L = window.lev, P = window.player, g = window.__last, wp = g.grp.position, A = window.__pinArg || {};
const c = L.pos; let ox = wp.x - c.x, oz = wp.z - c.z; const ol = Math.hypot(ox, oz) || 1; ox /= ol; oz /= ol;
const sx = -oz, sz = ox;   // side
const k = A.side || 9, b = A.back || 3, d = A.down || 2.5;
window.__camPin = { pos: [wp.x + sx * k + ox * b, wp.y - d, wp.z + sz * k + oz * b], look: [wp.x + ox * 2.5, wp.y - 0.6, wp.z + oz * 2.5] };
// Sal faces the ward, pitch aimed at it
const dx = wp.x - P.pos.x, dy = wp.y - P.pos.y, dz = wp.z - P.pos.z;
P.yaw = Math.atan2(dx, dz); P.pitch = Math.atan2(dy, Math.hypot(dx, dz));
window.__t0 = 0;
if (A.freeze) { window.__thaw(); window.__freezeWhen(A.freeze); }
if (A.go) window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w' }));
return { pin: window.__camPin, d: +Math.hypot(dx, dy, dz).toFixed(1) };
