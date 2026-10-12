// VELFIX GATE (2026-10-12; review I2): fullplay-gate.mjs (velfix's fullplay, the pre-velhard rite policy) FP_GATE=1 through all three routes after the calm, one at a time
// (one Chrome: load changes the fight - see VELFIX-REPORT.md Findings 1), and exits 1 if any route is RED.
//   node tools/bench/velfix-gate.mjs <port> [tag] [routes=crack,follow,resettle]
// Env DRV_PORT (default 9488), passed through. Logs: shots/velfix/gates/<tag>-<route>.log
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const [, , PORT, TAG = 'vgate', ROUTES = 'crack,follow,resettle'] = process.argv;
const OUT = '/Users/michaelpaulus/sc/.abyssa-wt/shots/velfix/gates';
mkdirSync(OUT, { recursive: true });
let red = 0;
for (const route of ROUTES.split(',')) {
  const env = { ...process.env, DRV_PORT: process.env.DRV_PORT || '9488', FP_HOSE: '760', FP_GATE: '1', FP_ROUTE: route, RP_OUT: OUT };
  const r = spawnSync('node', ['tools/bench/fullplay-gate.mjs', PORT, 'perfect', `${TAG}-${route}`, '1'], { env, encoding: 'utf8', maxBuffer: 64 << 20, cwd: new URL('../..', import.meta.url).pathname });
  const log = (r.stdout || '') + (r.stderr || '');
  writeFileSync(`${OUT}/${TAG}-${route}.log`, log);
  const line = log.split('\n').find(l => l.startsWith('GATE ')) || '';
  const led = log.split('\n').find(l => l.startsWith('LEDGER ')) || '';
  let summary = 'no GATE line (the run failed)';
  if (line) {
    const d = JSON.parse(line.slice(line.indexOf('{')));
    const L = JSON.parse(led.slice(7) || '{}');
    summary = `${line.split(' ')[1]} | calm ${L.calmT} hits ${L.hits} | wash red ${d.wash.red} (max outside ${d.wash.maxOutside}, all ${d.wash.maxBlown}) | after the calm: lens surface ${d.calm.lensSurf} eggs ${d.calm.lensEggs} of ${d.calm.sampled}, Sal in her ${d.calm.salIn}, clutch dmax ${d.calm.stMaxD}, wake fx ${d.calm.wakeFx}, under ${d.calm.under}, re-rise ${d.calm.reRise} | proxy: in ${d.lens.calmIn} near ${d.lens.calmNear} | ${d.why.join('; ') || 'ok'}`;
  }
  if (!line || line.startsWith('GATE RED') || r.status !== 0) red++;
  console.log(`${route.padEnd(9)} ${summary}`);
}
console.log(red ? `VELFIX-GATE RED (${red} of ${ROUTES.split(',').length} routes)` : 'VELFIX-GATE GREEN');
process.exit(red ? 1 : 0);
