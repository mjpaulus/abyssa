// Side-by-side pair images (main left, relief right) of the L2 stills, for the eye. A presentation tool: it re-reads the PNGs stills.mjs wrote.
//   DRV_PORT=9520 node tools/relief/render/pairs.mjs [dir]      (dir: the stills' folder; default ~/sc/.abyssa-wt/shots/relief-look)
// Writes <dir>/relief-look-pair-<shot>.png (each side scaled to 0.5, labelled), one per shot present for both builds.
if (!process.env.DRV_PORT) { console.error('pairs.mjs: set DRV_PORT (a free Chrome debug port, e.g. 9520)'); process.exit(2); }
const { mkdtempSync, readFileSync, writeFileSync, readdirSync } = await import('node:fs'); const { tmpdir } = await import('node:os');
process.env.DRV_DIR = mkdtempSync(tmpdir() + '/abyssa-relief-pairs-');
const { start, stop, connect } = await import('../../bench/drv.mjs');
const D = process.argv[2] || '/Users/michaelpaulus/sc/.abyssa-wt/shots/relief-look';
const shots = readdirSync(D).filter(f => /^main-L2-.*\.png$/.test(f)).map(f => f.slice(5, -4)).filter(n => readdirSync(D).includes(`relief-${n}.png`));
await start('about:blank');
process.on('exit', () => stop());
const c = await connect();
for (const n of shots) {
  const a = readFileSync(`${D}/main-${n}.png`).toString('base64'), b = readFileSync(`${D}/relief-${n}.png`).toString('base64');
  const url = await c.ev(`(async () => {
    const ld = b => new Promise(r => { const im = new Image(); im.onload = () => r(im); im.src = 'data:image/png;base64,' + b; });
    const [A, B] = await Promise.all([ld(${JSON.stringify(a)}), ld(${JSON.stringify(b)})]);
    const w = A.width / 2, h = A.height / 2, cv = document.createElement('canvas'); cv.width = w * 2 + 12; cv.height = h + 34; const g = cv.getContext('2d');
    g.fillStyle = '#10141a'; g.fillRect(0, 0, cv.width, cv.height);
    g.drawImage(A, 0, 34, w, h); g.drawImage(B, w + 12, 34, w, h);
    g.font = '700 18px Helvetica, Arial'; g.fillStyle = '#e6ebf1'; g.fillText('MAIN  ${n}', 8, 23); g.fillText('RELIEF BRANCH  ${n}', w + 20, 23);
    return cv.toDataURL('image/png');
  })()`);
  writeFileSync(`${D}/relief-look-pair-${n}.png`, Buffer.from(url.split(',')[1], 'base64'));
  console.log('pair', n);
}
c.close(); process.exit(0);
