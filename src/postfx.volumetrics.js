// Raymarched volumetric light shafts. OWNED BY: volumetrics agent.
//
// PARANOIA NOTES (see the black-rectangle history in postfx.js):
//  * This pass owns exactly two render targets, rtCaust (fixed 512x512, never
//    resized) and rtHalf. Neither is ever shared or handed out, and rtHalf is only
//    ever resized from setSize(), which the composer calls from its own setSize
//    path. Nothing else touches its dimensions.
//  * Three draws, each writing a target it does not read: bake -> rtCaust; march
//    reads rtCaust + the depth texture -> rtHalf; composite reads rtHalf +
//    inputBuffer -> outputBuffer. No colour target is ever sampled and written in
//    the same draw.
//  * When the pass has nothing to contribute (deep water, night, kill switch) it
//    sets needsSwap = false and returns without touching a single buffer, so the
//    rest of the chain sees byte-identical behaviour to the pass not existing.
//  * setVolumetrics(false) removes the pass from the composer entirely.
//
// Architecture: half-res raymarch (front-to-back, blue-noise jittered) -> depth-aware
// bilateral upsample composited additively over the scene colour.
import * as THREE from 'three';
import { Pass } from 'postprocessing';
import { camera, scene } from './core.js';
import { sun } from './lighting.js';

// ---------------------------------------------------------------------------
// Water optics, mirrored from world/water.js so the shafts are made of the same
// water as everything else. Kept as literals rather than an import because
// water.js does not export them and this module must not edit it.
// ---------------------------------------------------------------------------
const K_ABS = [0.0520, 0.0062, 0.0042];   // downwelling absorption, per world unit
const K_EXT = [3.50, 1.45, 1.00];         // view-path extinction, relative, x fog.density
const SURF_LIGHT = [0.055, 0.135, 0.112]; // surface irradiance (scene-linear)
const SUN_REF_I = 2.60;                   // lighting.js STOPS[0].sunI — the surface reference

// Quality knobs. MARCH_STEPS x (1 + OCC_STEPS / OCC_EVERY) texture fetches per
// half-res pixel is the cost model, but measurement says the march is not where the
// time goes: at 3840x2400, dropping to a quarter-res march saved only 0.17 ms of the
// pass's 0.64 ms, and the screen-space shadow march costs ~0.07 ms. The composite is
// the expensive half, and it is full-res by necessity.
const MARCH_STEPS = 26;
const OCC_STEPS = 7;
const OCC_EVERY = 2;
const MAX_DIST = 320;

// The shaft pattern is a 2D function of the point where the shaft pierces the
// surface, so it is baked once per frame into a small seamlessly tiling texture
// instead of being evaluated as fbm at every one of the MARCH_STEPS samples.
// Evaluating it inline measured 4.5-6 ms; one texture fetch is ~free. CAUST_TILE
// world units map to the full texture, and shafts are only visible out to ~200
// units, so the repeat is never in frame twice.
const CAUST_RES = 512;
const CAUST_TILE = 512;   // world units per texture repeat
const CAUST_PER = 28;     // coarse lattice cells across the tile (must be an integer)
const CAUST_PER2 = 88;    // fine lattice cells across the tile (must be an integer)

const f = v => v.toFixed(6);
const v3 = a => `vec3(${f(a[0])},${f(a[1])},${f(a[2])})`;

const VERT = `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4( position.xy, 1.0, 1.0 ); }`;

// Value noise in the same style water.js uses — so the shaft pattern is a sibling
// of the surface chop — but with the lattice wrapped to a period, which is what
// makes the baked tile seamless. Translating by a non-integer offset still tiles,
// because the wrap is applied to the lattice indices rather than to p.
const CAUSTIC_FRAG = `
precision highp float;
uniform float uTime;
varying vec2 vUv;
float h21(vec2 p){vec3 q=fract(vec3(p.xyx)*0.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float vnp(vec2 p,float per){vec2 i=floor(p),g=fract(p);g=g*g*(3.0-2.0*g);
  return mix(mix(h21(mod(i,per)),h21(mod(i+vec2(1,0),per)),g.x),
             mix(h21(mod(i+vec2(0,1),per)),h21(mod(i+vec2(1,1),per)),g.x),g.y);}
float fbmp(vec2 p,float per){float v=0.0,a=0.5;
  for(int i=0;i<4;i++){v+=a*vnp(p,per);p*=2.0;per*=2.0;a*=0.5;}return v;}
void main(){
  // Two drift rates, so the beams both slide and breathe rather than translate rigidly.
  float c = fbmp( vUv * ${f(CAUST_PER)} + vec2( uTime * 0.030, -uTime * 0.024 ), ${f(CAUST_PER)} ) * 0.85
          + vnp( vUv * ${f(CAUST_PER2)} + vec2( -uTime * 0.055, uTime * 0.046 ), ${f(CAUST_PER2)} ) * 0.32;
  float shaft = smoothstep( 0.40, 0.88, c );
  gl_FragColor = vec4( shaft * shaft, 0.0, 0.0, 1.0 );
}`;

const MARCH_FRAG = `
precision highp float;
#define STEPS ${MARCH_STEPS}
#define OCC ${OCC_STEPS}
#define OCC_EVERY ${OCC_EVERY}
uniform sampler2D tDepth, tCaust;
uniform vec3 uCamPos, uSunDir, uSurf;
uniform mat4 uCamW, uViewProj;
uniform vec2 uTanHalf;
uniform float uNear, uFar, uDens, uSunK, uJitter, uOcclude, uDensK;
varying vec2 vUv;

// perspectiveDepthToViewZ, negated: distance along a ray whose view-space z is -1
float sceneT( float d ){
  return -( ( uNear * uFar ) / ( ( uFar - uNear ) * d - uFar ) );
}

void main(){
  vec2 nd = vUv * 2.0 - 1.0;
  vec3 vr = vec3( nd * uTanHalf, -1.0 );
  vec3 rd = mat3( uCamW ) * vr;           // world direction, view-z normalised to -1
  float rlen = length( rd );
  vec3 rdn = rd / rlen;

  float tS = sceneT( texture2D( tDepth, vUv ).x );
  // Store the half-res linear depth in alpha for the bilateral upsample.
  float tMax = min( tS, ${f(MAX_DIST)} );
  float t0 = 0.6;
  float dt = ( tMax - t0 ) / float( STEPS );
  if ( dt <= 0.0 ) { gl_FragColor = vec4( 0.0, 0.0, 0.0, tS ); return; }

  // Blue-ish noise: interleaved gradient noise, cheap and stable under motion.
  float jit = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) + uJitter );

  // Mie-ish forward lobe: shafts blaze when you look up-sun, fade looking down-sun.
  float phase = 0.45 + 1.75 * pow( max( 0.0, dot( rdn, uSunDir ) ), 3.0 );

  // Everything that varies linearly or exponentially along the ray is stepped
  // incrementally. The straightforward version evaluates six exp() and a divide per
  // sample and measured 2.5 ms; this is the same maths as three multiplies.
  float t = t0 + dt * jit;
  vec3 p = uCamPos + rd * t;
  vec3 pStep = rd * dt;

  // Project the sample up the sun direction onto the surface plane: the caustic
  // pattern there is what the shaft is a slice of, so shafts stay coherent columns
  // instead of 3D noise mush. The projection is affine in p, so it steps too.
  vec2 sunProj = uSunDir.xz / max( uSunDir.y, 0.25 );
  vec2 q = ( p.xz - sunProj * p.y ) * ${f(1 / CAUST_TILE)};
  vec2 qStep = ( pStep.xz - sunProj * pStep.y ) * ${f(1 / CAUST_TILE)};

  // Beer-Lambert down the water column, and extinction back along the view ray.
  vec3 down = uSurf * exp( ${v3(K_ABS)} * p.y );
  vec3 downStep = exp( ${v3(K_ABS)} * pStep.y );
  vec3 tr = exp( -( t * rlen * uDens ) * ${v3(K_EXT)} );
  vec3 trStep = exp( -( dt * rlen * uDens ) * ${v3(K_EXT)} );

  vec3 acc = vec3( 0.0 );

  for ( int i = 0; i < STEPS; i++ ) {
    // Exactly the billboard-ray fade curve from water.js updateWater(): gone by
    // y = -245.9, which is zone 0's silt datum. Shafts do not exist inside the
    // nepheloid layer and fade in as the diver climbs out of it. If this constant
    // ever drifts from water.js's the billboards read where the columns do not.
    // The smoothstep ramps the shafts IN over the top 50 units. Without it the curve
    // peaks at y = 0, which is where the game starts, and this pass alone tripled total
    // frame luminance there (measured 140 vs 40) — the opening dive was a blown-out
    // cyan wash. A shaft needs depth to form and darker water to read against; right
    // under the surface you are inside the light. Identical shaping lives in water.js
    // updateWater as the rayBand term -- if the two ever disagree the billboards are
    // visible where the raymarched columns are not, which reads as a bug.
    // (No backticks in this comment: it sits inside a JS template literal.)
    float d01 = clamp( -p.y / 900.0, 0.0, 1.0 );
    float fade = max( 0.0, 1.0 - d01 * 3.66 ) * smoothstep( 0.0, 0.055, d01 );
    // SQUARED, and water.js's rayBand squares the same factor. The linear curve left
    // 21% strength at y = -193, where the illuminated free path is at its longest —
    // measured, a diver on the zone-0 upper wall stood in a cyan wash that outshone
    // the terrain under his boots. Squaring costs the tuned top-of-column look ~10%
    // (0.90 to 0.81 at the y = -25 peak) and takes the mid-column down fivefold.
    fade *= fade;

    if ( fade > 0.002 && p.y < 0.0 ) {
      float shaft = texture2D( tCaust, q ).r;

      if ( shaft > 0.004 ) {
        float occ = 1.0;
        if ( uOcclude > 0.5 && ( i / OCC_EVERY ) * OCC_EVERY == i ) {
          // Screen-space shadow march toward the sun. Geometric step growth so a
          // handful of taps still reaches a terrain arch or a leviathan flank.
          vec3 sp = p;
          float ss = ( 2.5 + t * 0.05 ) * ( 0.6 + 0.8 * jit );
          for ( int j = 0; j < OCC; j++ ) {
            sp += uSunDir * ss;
            ss *= 1.65;
            vec4 cp = uViewProj * vec4( sp, 1.0 );
            if ( cp.w <= 0.001 ) break;
            vec2 su = cp.xy / cp.w * 0.5 + 0.5;
            if ( su.x < 0.0 || su.x > 1.0 || su.y < 0.0 || su.y > 1.0 ) break;
            float sz = sceneT( texture2D( tDepth, su ).x );
            float diff = cp.w - sz;                       // >0: geometry in front of us
            // Thickness window: a far background surface must not shadow the world.
            if ( diff > 0.8 + cp.w * 0.035 && diff < 55.0 ) { occ = 0.0; break; }
          }
        }
        if ( occ > 0.0 ) acc += down * tr * ( shaft * fade * occ * phase );
      }
    }
    t += dt;
    p += pStep;
    q += qStep;
    down *= downStep;
    tr *= trStep;
  }

  // uDensK is the SCATTERING coefficient the source term always needed. Inscatter per
  // unit length is sigma_s * L — proportional to how much water there is to scatter —
  // but only the extinction here ever used density. In murky water extinction kills
  // the ray fast, so the omission was invisible when this pass was calibrated; in the
  // CLEAR bands the silt line created, transmittance stays near 1 for the whole
  // 320-unit march and the integral grows linearly instead of converging. Measured: a
  // diver standing on the zone-0 upper wall (y = -193, the clear band) could not see
  // the floor under his own boots for cyan. Normalised to the surface density the pass
  // was tuned at, so at y = 0 this multiplies by ~1.0 and changes nothing.
  gl_FragColor = vec4( acc * ( dt * rlen * uSunK * uDensK ), tS );
}`;

const COMPOSITE_FRAG = `
precision highp float;
uniform sampler2D tDiffuse, tVol, tDepth;
uniform vec2 uHalfSize, uHalfTexel;
uniform float uNear, uFar, uIntensity;
varying vec2 vUv;

float sceneT( float d ){
  return -( ( uNear * uFar ) / ( ( uFar - uNear ) * d - uFar ) );
}

void main(){
  vec3 base = texture2D( tDiffuse, vUv ).rgb;

  // Depth-aware 4-tap upsample. Without it the half-res shafts halo around the
  // leviathan silhouette; with it the beam stops exactly at his edge.
  float zc = sceneT( texture2D( tDepth, vUv ).x );
  vec2 fp = vUv * uHalfSize - 0.5;
  vec2 bp = floor( fp );
  vec2 fr = fp - bp;
  vec2 base_uv = ( bp + 0.5 ) * uHalfTexel;

  vec3 sum = vec3( 0.0 );
  float wsum = 0.0;
  vec4 s;
  float bw, w;

  s = texture2D( tVol, base_uv );
  bw = ( 1.0 - fr.x ) * ( 1.0 - fr.y );
  w = bw / ( 0.05 + abs( s.a - zc ) ); sum += s.rgb * w; wsum += w;

  s = texture2D( tVol, base_uv + vec2( uHalfTexel.x, 0.0 ) );
  bw = fr.x * ( 1.0 - fr.y );
  w = bw / ( 0.05 + abs( s.a - zc ) ); sum += s.rgb * w; wsum += w;

  s = texture2D( tVol, base_uv + vec2( 0.0, uHalfTexel.y ) );
  bw = ( 1.0 - fr.x ) * fr.y;
  w = bw / ( 0.05 + abs( s.a - zc ) ); sum += s.rgb * w; wsum += w;

  s = texture2D( tVol, base_uv + uHalfTexel );
  bw = fr.x * fr.y;
  w = bw / ( 0.05 + abs( s.a - zc ) ); sum += s.rgb * w; wsum += w;

  vec3 vol = wsum > 1e-6 ? sum / wsum : texture2D( tVol, vUv ).rgb;
  gl_FragColor = vec4( base + max( vec3( 0.0 ), vol ) * uIntensity, 1.0 );
}`;

// ---------------------------------------------------------------------------
function fullscreenTri() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
  return g;
}

export class VolumetricLightPass extends Pass {
  constructor() {
    super('VolumetricLight');
    this.needsSwap = true;
    this.needsDepthTexture = true;

    // Fixed-size caustic tile. Never resized, never shared, wrapped so a world-space
    // lookup can run off the edge in either direction.
    this.rtCaust = new THREE.WebGLRenderTarget(CAUST_RES, CAUST_RES, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,
      type: THREE.UnsignedByteType, depthBuffer: false, stencilBuffer: false
    });
    this.rtCaust.texture.name = 'Volumetrics.Caustic';
    this.rtCaust.texture.generateMipmaps = false;

    // The one size-dependent render target this pass owns. No depth/stencil
    // attachment: the march
    // never depth-tests, and an attachment here is exactly the kind of shared state
    // the old chain died on.
    this.rtHalf = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false
    });
    this.rtHalf.texture.name = 'Volumetrics.Half';
    this.rtHalf.texture.generateMipmaps = false;

    const geo = fullscreenTri();

    this.caustMaterial = new THREE.ShaderMaterial({
      name: 'VolumetricCaustic',
      uniforms: { uTime: { value: 0 } },
      vertexShader: VERT, fragmentShader: CAUSTIC_FRAG,
      depthTest: false, depthWrite: false
    });
    this.caustScene = new THREE.Scene();
    const caustMesh = new THREE.Mesh(geo, this.caustMaterial);
    caustMesh.frustumCulled = false;
    this.caustScene.add(caustMesh);

    this.marchMaterial = new THREE.ShaderMaterial({
      name: 'VolumetricMarch',
      uniforms: {
        tDepth: { value: null },
        tCaust: { value: this.rtCaust.texture },
        uCamPos: { value: new THREE.Vector3() },
        uSunDir: { value: new THREE.Vector3(0.2, 1, 0.1).normalize() },
        uSurf: { value: new THREE.Vector3(...SURF_LIGHT) },
        uCamW: { value: new THREE.Matrix4() },
        uViewProj: { value: new THREE.Matrix4() },
        uTanHalf: { value: new THREE.Vector2(1, 1) },
        uNear: { value: 0.1 }, uFar: { value: 700 }, uDens: { value: 0.0078 }, uDensK: { value: 1 },
        uSunK: { value: 1 }, uJitter: { value: 0 }, uOcclude: { value: 1 }
      },
      vertexShader: VERT, fragmentShader: MARCH_FRAG,
      depthTest: false, depthWrite: false
    });
    this.marchScene = new THREE.Scene();
    const marchMesh = new THREE.Mesh(geo, this.marchMaterial);
    marchMesh.frustumCulled = false;
    this.marchScene.add(marchMesh);

    this.fullscreenMaterial = new THREE.ShaderMaterial({
      name: 'VolumetricComposite',
      uniforms: {
        tDiffuse: { value: null },
        tVol: { value: this.rtHalf.texture },
        tDepth: { value: null },
        uHalfSize: { value: new THREE.Vector2(1, 1) },
        uHalfTexel: { value: new THREE.Vector2(1, 1) },
        uNear: { value: 0.1 }, uFar: { value: 700 },
        uIntensity: { value: 1 }
      },
      vertexShader: VERT, fragmentShader: COMPOSITE_FRAG,
      depthTest: false, depthWrite: false
    });

    // Public tuning surface.
    // RE-TUNED 2026-08-25: the 1.05 default was "tuned against the billboard rays" —
    // which a reversed-edge smoothstep had silently zeroed, so it was tuned against
    // nothing and carried the whole god-ray look alone. With the billboards alive
    // (water.js vFade fixed, base 0.42) the pair double-exposed at 1.05; 0.85 keeps
    // the broad columns under the billboard accents — lit, not milky (judged live at
    // ~20 m, clear noon).
    this.intensity = 0.85;
    this.occlusion = true;
    this.resDiv = 2;

    this._time = 0;
    this._frame = 0;
    this._w = 0; this._h = 0;
  }

  setDepthTexture(depthTexture) {
    this.marchMaterial.uniforms.tDepth.value = depthTexture;
    this.fullscreenMaterial.uniforms.tDepth.value = depthTexture;
  }

  // Trades march resolution for cost. Shafts are a very low-frequency signal, so the
  // depth-aware upsample hides the difference everywhere except silhouette edges.
  setResolutionDivisor(d) {
    const n = Math.max(1, Math.min(8, Math.round(d)));
    if (n === this.resDiv) return;
    this.resDiv = n;
    const w = this._w, h = this._h;
    this._w = 0; this._h = 0;      // force setSize past its unchanged-size guard
    if (w && h) this.setSize(w, h);
  }

  // Only ever called by EffectComposer.addPass / EffectComposer.setSize (and by
  // setResolutionDivisor, which resets the guard first).
  setSize(width, height) {
    const w = Math.max(1, Math.floor(width)), h = Math.max(1, Math.floor(height));
    if (w === this._w && h === this._h) return;   // never reallocate on an unchanged frame
    this._w = w; this._h = h;
    const d = this.resDiv;
    const hw = Math.max(1, Math.ceil(w / d)), hh = Math.max(1, Math.ceil(h / d));
    this.rtHalf.setSize(hw, hh);
    const cu = this.fullscreenMaterial.uniforms;
    cu.uHalfSize.value.set(hw, hh);
    cu.uHalfTexel.value.set(1 / hw, 1 / hh);
    // The march target is drawn with a fullscreen triangle, so uv 0..1 maps to the
    // whole frame regardless of the rounding above — no edge scaling is needed and
    // no frame-edge sliver can go unwritten.
  }

  render(renderer, inputBuffer, outputBuffer, deltaTime) {
    const mu = this.marchMaterial.uniforms;

    // sun.intensity already carries the depth-stop blend AND the weather day/storm/
    // flash modulation applied by lighting.js updateLighting(), so the shafts follow
    // night, storms and lightning for free with no extra wiring.
    const sunK = Math.max(0, sun.intensity) / SUN_REF_I;
    // Nothing to add: skip entirely and leave the chain byte-identical.
    if (!(sunK > 0.004) || camera.position.y < -340) {
      this.needsSwap = false;
      return;
    }
    this.needsSwap = true;

    this._frame = (this._frame + 1) % 64;
    this._time += deltaTime || 0;

    const tan = Math.tan(camera.fov * Math.PI / 360);
    mu.uCamPos.value.copy(camera.position);
    mu.uCamW.value.copy(camera.matrixWorld);
    mu.uViewProj.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    mu.uTanHalf.value.set(tan * camera.aspect, tan);
    mu.uNear.value = camera.near;
    mu.uFar.value = camera.far;
    this.caustMaterial.uniforms.uTime.value = this._time;
    mu.uSunK.value = sunK;
    mu.uJitter.value = this._frame * 0.6180339887;
    mu.uOcclude.value = this.occlusion ? 1 : 0;
    mu.uSunDir.value.copy(sun.position).normalize();
    // Turbidity: water.js drives scene.fog.density from depth + storm murk, so the
    // shafts dim in murky water on their own.
    if (scene.fog) {
      mu.uDens.value = scene.fog.density;
      // Scattering strength, normalised at the 0.0078 surface density the pass was
      // calibrated against and soft-capped: silt THICKER than the surface must not
      // push the shafts brighter than their tuned look, only clearer water dimmer.
      mu.uDensK.value = Math.min(1.15, scene.fog.density / 0.0078);
    }

    const cu = this.fullscreenMaterial.uniforms;
    cu.uNear.value = camera.near;
    cu.uFar.value = camera.far;
    cu.uIntensity.value = this.intensity;
    cu.tDiffuse.value = inputBuffer.texture;

    // 1) bake the seamless caustic tile (reads nothing)
    renderer.setRenderTarget(this.rtCaust);
    renderer.render(this.caustScene, this.camera);

    // 2) half-res march -> rtHalf (samples the depth texture + the caustic tile)
    renderer.setRenderTarget(this.rtHalf);
    renderer.render(this.marchScene, this.camera);

    // 3) bilateral upsample + additive composite -> outputBuffer
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.rtHalf.dispose();
    this.rtCaust.dispose();
    this.marchMaterial.dispose();
    this.caustMaterial.dispose();
    this.marchScene.children[0].geometry.dispose();
    if (this.fullscreenMaterial) this.fullscreenMaterial.dispose();
  }
}
