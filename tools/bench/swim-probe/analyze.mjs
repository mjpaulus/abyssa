// usage: node analyze.mjs file.json [...]
import { readFileSync } from 'node:fs';
const F = { seg: 0, dt: 1, gr: 2, deck: 3, buoy: 4, fill: 5, jet: 6, bT: 7, sp: 8, hs: 9, va: 10, vy: 11, scZ: 12, lx: 13, ly: 14, lz: 15, rx: 16, ry: 17, rz: 18, mode: 19, agl: 20, bl: 21, lsx: 22, le: 23, rsx: 24, lsz: 25 };
for (const f of process.argv.slice(2)) {
  const L = JSON.parse(readFileSync(f, 'utf8'));
  console.log('==', f, L.length, 'frames');
  const segs = [];
  for (const r of L) { const s = segs.at(-1); if (!s || s.name !== r[0]) segs.push({ name: r[0], rows: [r] }); else s.rows.push(r); }
  for (const s of segs) {
    const R = s.rows.slice(Math.min(30, s.rows.length >> 2));   // skip the first ~0.5 s
    if (!R.length) continue;
    const T = R.reduce((a, r) => a + r[F.dt], 0) / 1000;
    let un = 0; for (let i = 1; i < R.length; i++) { let d = R[i][F.sp] - R[i - 1][F.sp]; if (d < -0.5) d += 1; un += d; }
    const p2p = k => { let lo = 1e9, hi = -1e9; for (const r of R) { lo = Math.min(lo, r[k]); hi = Math.max(hi, r[k]); } return +(hi - lo).toFixed(3); };
    const mean = k => +(R.reduce((a, r) => a + r[k], 0) / R.length).toFixed(2);
    const modes = [...new Set(R.map(r => r[F.mode]))].join('/');
    console.log(s.name.padEnd(9), `T ${T.toFixed(1)}s fps ${(R.length / T).toFixed(0)} grounded ${(mean(F.gr) * 100).toFixed(0)}% agl ${mean(F.agl)} fill ${mean(F.fill)} jet ${mean(F.jet)}`,
      `| hs ${mean(F.hs)} vAlong ${mean(F.va)} vy ${mean(F.vy)} scZ ${mean(F.scZ)} | stroke ${(un / T).toFixed(3)} Hz (${un.toFixed(2)} cyc)`,
      `| L p2p x ${p2p(F.lx)} y ${p2p(F.ly)} z ${p2p(F.lz)} | R p2p x ${p2p(F.rx)} y ${p2p(F.ry)} z ${p2p(F.rz)} | Lsx p2p ${p2p(F.lsx)} Le ${p2p(F.le)} Rsx ${p2p(F.rsx)} Lsz ${p2p(F.lsz)} | bl ${mean(F.bl)} | ${modes}`);
  }
}
