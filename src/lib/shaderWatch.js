// SHADER-FAILURE WATCH + RELINK (roadmap/shader-link-failure.md). OWNED BY: orchestrator (core.js).
//
// THE BUG. On Mac, Chrome's WebGL runs through ANGLE's GLSL -> Metal (MSL) translator. Now and
// then that translator emits ONE function parameter with a spurious reference qualifier
// (`constant float & _ualpha`, `thread float & ...`, `constant metal::float3 & ...`) while the
// call site passes an ordinary value, and the Metal compiler rejects the program at link:
// "no matching function for call to ...". Seen four times in a week on four different
// functions (three's V_GGX_SmithCorrelated, getPointShadow, two of ANGLE's own helpers), in
// fragment AND vertex shaders. It is NOT a property of our GLSL: the exact source of the
// failing program (rebuilt here, its MSL lands the call and the declaration on the very lines
// the error named, 1339 and 1288) links cleanly hundreds of times running, as does every other
// program the game builds (~11k links across both Chromes, every zone, site, refraction state
// and quality rung). Likely mechanism, upstream: the MSL backend keeps a variable -> address
// space table (SymbolEnv) whose key equality, VarField::operator==, compares a variable's id
// with ITSELF instead of with the other variable's, so the guard against a stale entry at a
// reused address never fires. Whatever the mechanism, it is a translator hiccup, not a rule
// of the source, so no GLSL rewrite can target it (it picks a different parameter each time).
//
// THE WORKAROUND. three calls renderer.debug.onShaderError (in place of its own console report)
// on a program's first use, with the shaders still attached and BEFORE it reads the program's
// uniform and attribute locations. Here every failed program is RE-TRANSLATED IN PLACE: one
// `#define ABYSSA_RELINK n` line goes in after #version (a new source string, so ANGLE's
// translation cache cannot hand back the bad MSL; an unused macro changes nothing compiled),
// both shaders recompile and the same GL program relinks. three then carries on exactly as if
// the first link had worked: same WebGLProgram, same cache key, same uniforms, no new variant,
// the picture bit-identical. Up to 3 attempts; a program that still fails (a REAL source bug)
// is recorded as broken. One synchronous recompile on a failure (~tens of ms, rare), else free.
//
//   window.__shaderFailed()         -> programs still broken (the invariant: must be [])
//   window.__shaderFailed.all()     -> every link failure, relinked ones too ({ relinked: n })
//   window.__shaderFailed.detail(i) -> .all()[i] with full logs, GLSL and ANGLE's translated source
// A broken program is console.error'd once; a relinked one console.warn'd once (it draws).
// The hook never throws: a broken diagnostic must not take the frame with it.

const all = [];        // compact records, every failure
const details = [];    // full text, same index
const seen = new Set();
const MAX_RELINK = 3;

// Variant summary: the #defines three's prefix put in front of the fragment shader (features,
// material defines), plus the light / shadow / clip counts three inlines into the chunks.
function variantOf(src) {
  const out = [];
  const lines = src.split('\n');
  for (let i = 0; i < lines.length && i < 260; i++) {
    const m = /^#define\s+(\w+)(?:\s+(\S+))?\s*$/.exec(lines[i]);
    if (!m) continue;
    const [, k, v] = m;
    if (/^(SHADER_TYPE|SHADER_NAME|PI|PI_HALF|RECIPROCAL_PI|RECIPROCAL_PI2|EPSILON|LOG2|saturate|whiteComplement|varying|attribute|texture2D|gl_FragColor|textureCube|texture2DLodEXT|HIGH_PRECISION|STANDARD|OPAQUE|ABYSSA_RELINK)$/.test(k)) continue;
    if (/^(gl_|texture)/.test(k)) continue;   // the GLSL3 compatibility aliases
    out.push(v !== undefined && v !== '' ? k + ' ' + v : k);
  }
  const n = (re) => { const m = src.match(re); return m ? +m[1] : 0; };
  const counts = [['dir', /DirectionalLight directionalLights\[ (\d+) \]/], ['point', /PointLight pointLights\[ (\d+) \]/],
    ['spot', /SpotLight spotLights\[ (\d+) \]/], ['hemi', /HemisphereLight hemisphereLights\[ (\d+) \]/],
    ['dirShadow', / directionalShadowMap\[ (\d+) \];/], ['pointShadow', / pointShadowMap\[ (\d+) \];/],
    ['clip', /uniform vec4 clippingPlanes\[ (\d+) \]/]]
    .map(([k, re]) => [k, n(re)]).filter(([, v]) => v > 0).map(([k, v]) => k + ' ' + v);
  return out.concat(counts).join(', ');
}

function firstError(...logs) {
  // the line that names the fault: a compiler "ERROR: 0:12: ..." or the Metal "...: error: ..."
  for (const l of logs) {
    const line = (l || '').split('\n').find(s => /(^ERROR:|: error:)/.test(s.trim()));
    if (line) return line.trim().slice(0, 240);
  }
  for (const l of logs) {
    const line = (l || '').split('\n').find(s => s.trim());
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

// Re-translate and relink the SAME program: a new source string per attempt (a #define line
// right after #version, which must stay the first line), both shaders, then link. Returns the
// attempt that linked, or 0.
function relink(gl, program, vs, fs) {
  for (let a = 1; a <= MAX_RELINK; a++) {
    for (const sh of [vs, fs]) {
      const src = (gl.getShaderSource(sh) || '').replace(/\n#define ABYSSA_RELINK \d+\n/, '\n');
      const v = /^\s*#version[^\n]*\n/.exec(src), i = v ? v[0].length : 0;
      gl.shaderSource(sh, src.slice(0, i) + '#define ABYSSA_RELINK ' + a + '\n' + src.slice(i));
      gl.compileShader(sh);
    }
    gl.linkProgram(program);
    if (gl.getProgramParameter(program, gl.LINK_STATUS)) return a;
  }
  return 0;
}

export function installShaderWatch(renderer, scene) {
  renderer.debug.checkShaderErrors = true;
  renderer.debug.onShaderError = (gl, program, vs, fs) => {
    try {
      // capture the failure as it happened, before the relink rewrites the shaders
      const pLog = (gl.getProgramInfoLog(program) || '').trim();
      const vLog = (gl.getShaderInfoLog(vs) || '').trim();
      const fLog = (gl.getShaderInfoLog(fs) || '').trim();
      const vSrc = gl.getShaderSource(vs) || '', fSrc = gl.getShaderSource(fs) || '';
      const dbg = gl.getExtension('WEBGL_debug_shaders');
      let tFs = '', tVs = '';
      try { if (dbg) { tFs = dbg.getTranslatedShaderSource(fs); tVs = dbg.getTranslatedShaderSource(vs); } } catch (e) { /* none */ }
      let relinked = 0;
      try { relinked = relink(gl, program, vs, fs); } catch (e) { relinked = 0; }
      const wp = renderer.info.programs && renderer.info.programs.find(p => p.program === program);
      const own = ownerOf(renderer, scene, program);
      const m = own && own.material;
      const rec = {
        type: (m && m.type) || (wp && wp.name) || '?',
        name: (m && m.name) || '',
        owner: own ? own.object : '',
        variant: variantOf(fSrc),
        error: firstError(fLog, vLog, pLog),
        relinked
      };
      all.push(rec);
      details.push({ ...rec, programLog: pLog, vertexLog: vLog, fragmentLog: fLog, vertex: vSrc, fragment: fSrc, translatedVertex: tVs, translatedFragment: tFs, cacheKey: wp ? wp.cacheKey : '' });
      const key = vSrc.length + ':' + fSrc.length + ':' + rec.variant + ':' + rec.error + ':' + (relinked > 0);
      if (seen.has(key)) return;
      seen.add(key);
      const who = `${rec.type}${rec.name ? ' "' + rec.name + '"' : ''}${rec.owner ? ' on ' + rec.owner : ''}`;
      if (relinked) console.warn(`ABYSSA: shader program failed to link and was re-translated (attempt ${relinked}, it draws): ${who}: ${rec.error}\n  variant: ${rec.variant}`);
      else console.error(`ABYSSA: shader program failed (${who}): ${rec.error}\n  variant: ${rec.variant}`);
    } catch (e) {
      try { all.push({ type: '?', name: '', owner: '', variant: '', error: 'onShaderError threw: ' + e.message, relinked: 0 }); } catch (e2) { /* never throw */ }
    }
  };
  const api = () => all.filter(r => !r.relinked).map(r => ({ ...r }));
  api.all = () => all.map(r => ({ ...r }));
  api.detail = (i) => details[i];
  api.count = () => all.length;
  // TEST HOOK (the relink path cannot be provoked on demand: the ANGLE fault is random).
  // A program that only links once it has been re-translated: its fragment shader breaks
  // unless ABYSSA_RELINK is defined. Drawn once off screen; returns the new record.
  api.selfTest = async () => {
    const THREE = await import('three');
    const n0 = all.length;
    const mat = new THREE.ShaderMaterial({
      name: 'abyssa-relink-selftest',
      vertexShader: 'void main() { gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 ); }',
      fragmentShader: '#ifndef ABYSSA_RELINK\n  this does not compile\n#endif\nvoid main() { gl_FragColor = vec4( 0.0 ); }'
    });
    const cam = new THREE.Camera(), tmp = new THREE.Scene(), mesh = new THREE.Mesh(new THREE.PlaneGeometry(), mat);
    mesh.frustumCulled = false; tmp.add(mesh);
    const rt = new THREE.WebGLRenderTarget(1, 1), prev = renderer.getRenderTarget();
    try { renderer.setRenderTarget(rt); renderer.render(tmp, cam); }
    finally { renderer.setRenderTarget(prev); rt.dispose(); mesh.geometry.dispose(); mat.dispose(); }
    // the test's own record is not a game failure: take it back out of the lists
    const r = all.slice(n0);
    all.length = n0; details.length = n0;
    return r;
  };
  window.__shaderFailed = api;
}
