// VELFIX GATE (2026-10-12; review I2; Task 9 of the seafloor relief, 2026-10-14): fullplay-gate.mjs FP_GATE=1 through all
// three routes after the calm, one at a time, and exits 1 if any route is RED. The fight is ritepolicy.mjs's AVERAGE player
// (riteplay's and fullplay's own), on the stepped clock (fullplay-gate.mjs stops the game clock's wall-time feed and gates
// its drift). The wash is booked and gated per phase (the fight; after the calm), and the crack route must reach zone 1.
//   node tools/bench/velfix-gate.mjs <port> [tag] [routes=crack,follow,resettle]
// Env DRV_PORT (the gate's Chrome debug port; set it: the default 9488 is a shared one), passed through with every other
// FP_* knob (FP_NOVENT=1: the crack route never vents, the route bound's RED case; FP_WASHSHOT=<n>: PNGs of red frames).
// VG_LOAD=<port>:<debugPort> runs the gate UNDER LOAD: a second headless Chrome on <debugPort> plays fullplay.mjs (the
// average player) from the server on <port>, back to back, from before the first route until the last one ends; the
// routes wait for its first fight to start. Its logs go to <out>/load/.
// Logs: shots/velfix/gates/<tag>-<route>.log
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
const [, , PORT, TAG = 'vgate', ROUTES = 'crack,follow,resettle'] = process.argv;
const OUT = '/Users/michaelpaulus/sc/.abyssa-wt/shots/velfix/gates';
const CWD = new URL('../..', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const run = (cmd, args, env) => new Promise(res => {
  const ch = spawn(cmd, args, { env, cwd: CWD });
  let out = '';
  ch.stdout.setEncoding('utf8'); ch.stderr.setEncoding('utf8');   // (a multi-byte character split across two chunks stays whole)
  ch.stdout.on('data', d => { out += d; }); ch.stderr.on('data', d => { out += d; });
  ch.on('close', status => res({ status, out }));
});
// THE LOAD (VG_LOAD): a detached shell loop, killed (its process group, then its Chrome by debug port) at the end.
// (Task 10) The ports are NORMALISED (String(+x)) and range-checked, and the Chrome kill's pattern is anchored: it must never
// reach a port that merely begins with the load's (941 -> 9419), nor a reserved one (8777 the game, 8790, 9419 the shared
// Chrome), nor the gate's own server or Chrome.
const RESERVED = [8777, 8790, 9419];
const portOk = n => Number.isInteger(n) && n >= 1024 && n <= 65535 && !RESERVED.includes(n);
const GATE_DBG = +(process.env.DRV_PORT || 9488);
if (!portOk(GATE_DBG)) { console.log(`VELFIX-GATE: DRV_PORT ${process.env.DRV_PORT || 9488} is not a usable port (1024-65535, not ${RESERVED.join('/')})`); process.exit(2); }
let load = null;
if (process.env.VG_LOAD) {
  const [lpRaw, ldpRaw] = process.env.VG_LOAD.split(':');
  const lp = +lpRaw, ldp = +ldpRaw, own = [+PORT, GATE_DBG];
  if (!/^\d+$/.test(lpRaw || '') || !/^\d+$/.test(ldpRaw || '') || !portOk(lp) || !portOk(ldp) || ldp === lp || own.includes(lp) || own.includes(ldp) || !/^[\w.-]+$/.test(TAG)) {
    console.log(`VG_LOAD=<port>:<debugPort>: two numbers of their own in 1024-65535, not ${RESERVED.join('/')} and not the gate's server ${PORT} or Chrome ${GATE_DBG}; and a plain tag`); process.exit(2);
  }
  const LD = `${OUT}/load`; mkdirSync(LD, { recursive: true });
  const sh = `i=0; while true; do i=$((i+1)); DRV_PORT=${String(ldp)} RP_OUT=${LD} node tools/bench/fullplay.mjs ${String(lp)} average ${TAG}-load-$i $i 240 > ${LD}/${TAG}-load-$i.log 2>&1; done`;
  const lenv = { ...process.env }; for (const k of Object.keys(lenv)) if (/^(DRV_DIR|FP_|RP_)/.test(k)) delete lenv[k];   // (its own profile; none of the gate's knobs)
  const ch = spawn('/bin/sh', ['-c', sh], { cwd: CWD, detached: true, stdio: 'ignore', env: lenv });
  ch.unref();
  load = { pid: ch.pid, ldp, stop() {
    try { process.kill(-ch.pid, 'SIGTERM'); } catch (e) { }
    try { execFileSync('pkill', ['-f', `remote-debugging-port=${String(ldp)}( |$)`]); } catch (e) { }
  } };
  process.on('exit', () => load && load.stop());
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { if (load) load.stop(); process.exit(130); });
  const first = `${LD}/${TAG}-load-1.log`;
  let up = false;
  for (let i = 0; i < 300 && !(up = existsSync(first) && /START/.test(readFileSync(first, 'utf8'))); i++) await sleep(1000);
  if (!up) { console.log(`VELFIX-GATE: the load never reached its fight in 300 s (${first}); no run under load`); load.stop(); load = null; process.exit(2); }
  console.log(`load: fullplay.mjs on ${lp} (Chrome ${ldp}) is in its fight; routes start`);
}
let red = 0;
for (const route of ROUTES.split(',')) {
  const env = { ...process.env, DRV_PORT: String(GATE_DBG), FP_HOSE: '760', FP_GATE: '1', FP_ROUTE: route, RP_OUT: OUT };
  const r = await run('node', ['tools/bench/fullplay-gate.mjs', PORT, 'average', `${TAG}-${route}`, '1'], env);
  const log = r.out;
  writeFileSync(`${OUT}/${TAG}-${route}.log`, log);
  const line = log.split('\n').find(l => l.startsWith('GATE ')) || '';
  const led = log.split('\n').find(l => l.startsWith('LEDGER ')) || '';
  let summary = 'no GATE line (the run failed)';
  if (line) {
    const d = JSON.parse(line.slice(line.indexOf('{')));
    const L = JSON.parse(led.slice(7) || '{}'), F = d.wash.fight, Cw = d.wash.calm;
    const fight = L.calmT != null && L.takeT != null ? (L.calmT - L.takeT).toFixed(1) : '-';
    summary = `${line.split(' ')[1]} | take ${L.takeT} calm ${L.calmT} (fight ${fight} s) hits ${L.hits} drops ${L.drops} (slam ${L.dropHits} sweep ${L.sweeps} clean ${L.cleanDrops}) | clock drift ${d.clock.drift} s` +
      ` | wash fight: red ${F.red} of ${F.booked} (max outside ${F.maxOutside}, all ${F.maxBlown}); after the calm: red ${Cw.red} of ${Cw.booked} (max outside ${Cw.maxOutside}, all ${Cw.maxBlown})` +
      ` | after the calm: lens surface ${d.calm.lensSurf} eggs ${d.calm.lensEggs} of ${d.calm.sampled}, Sal in her ${d.calm.salIn}, clutch dmax ${d.calm.stMaxD}, wake fx ${d.calm.wakeFx}, under ${d.calm.under}, re-rise ${d.calm.reRise}` +
      ` | proxy: in ${d.lens.calmIn} near ${d.lens.calmNear}${route === 'crack' ? ` | zone 1 at ${d.way ? d.way.zoneAt : null}` : ''} | ${d.why.join('; ') || 'ok'}`;
  }
  if (!line || line.startsWith('GATE RED') || r.status !== 0) red++;
  console.log(`${route.padEnd(9)} ${summary}`);
}
if (load) { load.stop(); load = null; }
console.log(red ? `VELFIX-GATE RED (${red} of ${ROUTES.split(',').length} routes)` : 'VELFIX-GATE GREEN');
process.exit(red ? 1 : 0);
