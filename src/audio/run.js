// ---------------------------------------------------------------------------
// ABYSSA audio — assembly and the two clocks. OWNED BY: audio agent.
//   assemble(ctx)  build every part on a context (live or offline)
//   tick(E, dt)    20 Hz: smooth the state, write the mix, run the schedulers + director
//   frame(E, dt,W) per game frame: emitters follow the world, breath follows the
//                  breath clock, creature/fauna/thunder edges fire on their frame
// ---------------------------------------------------------------------------
import { createEngine, cl01 } from './engine.js';
import { buildBed, mixBed, mixPump, tickBed, frameBed, DRONE_ROOT } from './bed.js';
import { buildSal, frameSal, mixSal } from './sal.js';
import { buildCre, frameCre } from './creatures.js';
import { buildScore, tickScore } from './score.js';

const SMOOTH = ['depth', 'prox', 'calm', 'speed', 'wind', 'rain', 'day', 'light', 'air', 'pumpSpd', 'supplied', 'taut', 'rite'];
// (strain is not smoothed here: it is already eased in survival.js, and the creak keys on it)

export function assemble(ctx, opt = {}) {
  const E = createEngine(ctx, opt);
  buildBed(E); buildSal(E); buildCre(E); buildScore(E);
  E.S.zone = E.T.zone = 0;
  return E;
}

export function tick(E, dt = 0.05) {
  const S = E.S, T = E.T;
  const k = 1 - Math.exp(-dt / 0.7), ka = 1 - Math.exp(-dt / 0.12), kz = 1 - Math.exp(-dt / 4);
  for (let i = 0; i < SMOOTH.length; i++) { const n = SMOOTH[i]; S[n] += (T[n] - S[n]) * k; }
  S.above += (T.above - S.above) * ka;
  S.torn = T.torn;
  S.strain = T.strain;
  S.zone = T.zone;
  for (let i = 0; i < 3; i++) S.zw[i] += ((i === S.zone ? 1 : 0) - S.zw[i]) * kz;
  mixBed(E); mixPump(E); mixSal(E);
  tickBed(E); tickScore(E);
}

export function frame(E, dt, W) {
  E.updateEmitters();
  frameSal(E, dt);
  frameCre(E, W);
  frameBed(E, W);
}

export function setZone(E, i) {
  const zi = Math.max(0, Math.min(2, i | 0));
  if (zi === E.T.zone && E.zoneSet) return;
  E.zoneSet = true;
  E.T.zone = zi;
  const t = E.now();
  for (const d of E.bed.drones) { E.hold(d.o.frequency, t); d.o.frequency.exponentialRampToValueAtTime(DRONE_ROOT[zi] * d.r, t + 14); }
  E.score.enterZone(zi);
}

export { cl01 };
