// THE SCULPT PIPELINE — one entry point.
//   node tools/blender/build.mjs <creature> [--sets body,limbs] [--pieces a,b] [--skip-export]
// 1. export_hi.mjs: SDF specs (src/entities/sleeper/<creature>Sculpt.js) -> PLYs
// 2. bake.py in headless Blender: decimate, unwrap, Cycles high-to-low bake, .glb + .webp
// Outputs land in the creature's `out` (assets/sleepers/<creature>/). See README.md.
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '../..');
const BLENDER = process.env.BLENDER || '/Applications/Blender.app/Contents/MacOS/Blender';
const args = process.argv.slice(2), creature = args[0];
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
if (!creature) { console.error('usage: build.mjs <creature> [--sets a,b] [--pieces a,b] [--skip-export]'); process.exit(1); }
const run = (cmd, a) => { const r = spawnSync(cmd, a, { stdio: 'inherit', cwd: ROOT }); if (r.status !== 0) process.exit(r.status || 1); };
if (!args.includes('--skip-export')) run(process.execPath, [path.join(HERE, 'export_hi.mjs'), creature, ...(opt('--pieces') ? opt('--pieces').split(',') : [])]);
run(BLENDER, ['-b', '--factory-startup', '--python', path.join(HERE, 'bake.py'), '--', path.join(HERE, '.build', creature), ROOT, ...(opt('--sets') ? opt('--sets').split(',') : [])]);
// 3 (optional, the creature's pipeline().compress.tex === 'ktx2'): block-compressed KTX2
// maps from the raw dumps bake.py left in the build dir (WebP stays as the fallback)
{
  const fs = await import('fs');
  const man = JSON.parse(fs.readFileSync(path.join(HERE, '.build', creature, 'manifest.json'), 'utf8'));
  if (man.compress && man.compress.tex === 'ktx2') run(process.execPath, [path.join(HERE, 'ktx2.mjs'), path.join(HERE, '.build', creature), path.join(ROOT, man.out), ...(opt('--sets') ? opt('--sets').split(',') : [])]);
}
