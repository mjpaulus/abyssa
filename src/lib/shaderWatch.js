// SHADER-FAILURE WATCH (roadmap/shader-link-failure.md). OWNED BY: orchestrator (core.js).
//
// three only ever console.errors a program that fails to compile or link, and the object
// using it then silently never draws. The game's own checks (__safeFailed) cannot see that.
// This hooks renderer.debug.onShaderError (three calls it in place of its own report, on the
// program's first use, with the shaders still attached) and records every failed program:
//   window.__shaderFailed()        -> [{ type, name, owner, variant, error }]   (must be [])
//   window.__shaderFailed.detail(i) -> the full logs + GLSL (+ ANGLE's translated source)
// Each failure is console.error'd ONCE (by its source pair, so a variant that fails for
// several materials is one line), and the hook never throws: a broken diagnostic must not
// take the frame with it. Cost: zero until a program fails.

const failed = [];     // compact records (the invariant)
const details = [];    // full text, same index
const seen = new Set();

// Variant summary: the #defines three's prefix put in front of the fragment shader (the
// features + light/shadow/clip counts), with the zero counts dropped.
function variantOf(src) {
  const out = [];
  const lines = src.split('\n');
  for (let i = 0; i < lines.length && i < 260; i++) {
    const m = /^#define\s+(\w+)(?:\s+(\S+))?\s*$/.exec(lines[i]);
    if (!m) continue;
    const [, k, v] = m;
    if (/^(SHADER_TYPE|SHADER_NAME|PI|PI_HALF|RECIPROCAL_PI|RECIPROCAL_PI2|EPSILON|LOG2|saturate|whiteComplement|varying|texture2D|gl_FragColor|textureCube|texture2DLodEXT|HIGH_PRECISION|STANDARD|OPAQUE)$/.test(k)) continue;
    if (/^(gl_|texture)/.test(k)) continue;   // the GLSL3 compatibility aliases
    if (/^NUM_/.test(k) && (v === '0' || v === undefined)) continue;
    if (/^(UNION_CLIPPING_PLANES)$/.test(k) && v === '0') continue;
    out.push(v !== undefined && v !== '' ? k + ' ' + v : k);
  }
  return out.join(', ');
}

function firstError(...logs) {
  for (const l of logs) {
    if (!l) continue;
    const line = l.split('\n').find(s => /error/i.test(s)) || l.split('\n').find(s => s.trim());
    if (line) return line.trim().slice(0, 240);
  }
  return '(no log)';
}

// Which material / object used this GL program. Only runs on a failure.
function ownerOf(renderer, scene, program) {
  let hit = null;
  try {
    scene.traverse(o => {
      if (hit || !o.material) return;
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of ms) {
        const p = renderer.properties.get(m);
        let match = p.currentProgram && p.currentProgram.program === program;
        if (!match && p.programs) for (const wp of p.programs.values()) if (wp.program === program) { match = true; break; }
        if (match) {
          const path = [];
          for (let a = o; a && path.length < 4; a = a.parent) if (a.name) path.push(a.name);
          hit = { material: m, object: (path.join(' < ') || o.type) };
          return;
        }
      }
    });
  } catch (e) { /* diagnostics only */ }
  return hit;
}

export function installShaderWatch(renderer, scene) {
  renderer.debug.checkShaderErrors = true;
  renderer.debug.onShaderError = (gl, program, vs, fs) => {
    try {
      const pLog = (gl.getProgramInfoLog(program) || '').trim();
      const vLog = (gl.getShaderInfoLog(vs) || '').trim();
      const fLog = (gl.getShaderInfoLog(fs) || '').trim();
      const vSrc = gl.getShaderSource(vs) || '', fSrc = gl.getShaderSource(fs) || '';
      const wp = renderer.info.programs && renderer.info.programs.find(p => p.program === program);
      const own = ownerOf(renderer, scene, program);
      const m = own && own.material;
      const rec = {
        type: (m && m.type) || (wp && wp.name) || '?',
        name: (m && m.name) || '',
        owner: own ? own.object : '',
        variant: variantOf(fSrc),
        error: firstError(fLog, vLog, pLog)
      };
      const key = vSrc.length + ':' + fSrc.length + ':' + rec.variant + ':' + rec.error;
      if (seen.has(key)) return;
      seen.add(key);
      failed.push(rec);
      const dbg = gl.getExtension('WEBGL_debug_shaders');
      let tFs = '';
      try { tFs = dbg ? dbg.getTranslatedShaderSource(fs) : ''; } catch (e) { /* none */ }
      details.push({ ...rec, programLog: pLog, vertexLog: vLog, fragmentLog: fLog, vertex: vSrc, fragment: fSrc, translatedFragment: tFs, cacheKey: wp ? wp.cacheKey : '' });
      console.error(`ABYSSA: shader program failed (${rec.type}${rec.name ? ' "' + rec.name + '"' : ''}${rec.owner ? ' on ' + rec.owner : ''}): ${rec.error}\n  variant: ${rec.variant}`);
    } catch (e) {
      try { failed.push({ type: '?', name: '', owner: '', variant: '', error: 'onShaderError threw: ' + e.message }); } catch (e2) { /* never throw */ }
    }
  };
  const api = () => failed.map(r => ({ ...r }));
  api.detail = (i) => details[i];
  api.count = () => failed.length;
  window.__shaderFailed = api;
}
