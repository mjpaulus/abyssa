import { readFileSync } from 'node:fs';
// mean speed along heading over whole stroke cycles in a segment, after skip s
const [, , seg, skip, ...files] = process.argv;
for (const f of files) {
  const L = JSON.parse(readFileSync(f, 'utf8')).filter(r => r[0] === seg);
  let t = 0; const R = []; for (const r of L) { t += r[1] / 1000; if (t > +skip) R.push([t, r[8], r[10], r[1]]); }
  const w = []; for (let i = 1; i < R.length; i++) if (R[i][1] < R[i - 1][1] - 0.3) w.push(i);
  if (w.length < 2) { console.log(f, 'cycles<1'); continue; }
  let s = 0, T = 0; for (let i = w[0]; i < w.at(-1); i++) { s += R[i][2] * R[i][3]; T += R[i][3]; }
  console.log(f, seg, 'cycles', w.length - 1, 'T', (T / 1000).toFixed(1), 'mean vAlong', (s / T).toFixed(2));
}
