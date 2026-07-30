// Ocean surface (Snell's window), volumetric god rays, particulates, bubble vents,
// and the depth-absorption atmosphere model.
// OWNED BY: water/atmosphere agent.
import * as THREE from 'three';
import { scene, camera } from '../core.js';
import { WORLD_R, SURFACE_Y } from '../config.js';
import { rng, clamp } from '../lib/math.js';
import { scatter } from './flora.js';

export let surface = null;
export const rays = [];
export const bubbles = { pts: null, data: [] };
export let snow = null;

// ---------------------------------------------------------------------------
// Water optics
// ---------------------------------------------------------------------------
// Beer-Lambert absorption of the downwelling sunlight column, per world unit
// (1 unit ~= 3 m of displayed depth). Red dies first, then green; blue carries
// deepest. Roughly 5x gentler than real clear seawater so the trench stays legible.
// Green sits well below red so green light carries deep — the luminous mid-water of the
// reference frame. Red still dies fast, which is what keeps warm accents punchy up close.
const K_ABS = [0.0520, 0.0062, 0.0042];
// Relative extinction along the *viewing* path (turbidity), scaled by fog.density.
const K_EXT = [3.50, 1.45, 1.00];
// Surface irradiance tint; scene.fog.color carries it, everything else derives from it.
// Green-dominant at the surface (coastal teal) — absorption alone turns it blue with depth.
// These are scene-linear radiances: postfx does ACES + auto-exposure downstream.
const SURF_LIGHT = [0.055, 0.135, 0.112];
const SUN_DIR = new THREE.Vector3(0.20, 0.94, 0.16).normalize();

const f = v => v.toFixed(5);
const v3 = a => `vec3(${f(a[0])},${f(a[1])},${f(a[2])})`;

const GLSL_NOISE = `
float h21(vec2 p){vec3 q=fract(vec3(p.xyx)*0.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float vn(vec2 p){vec2 i=floor(p),g=fract(p);g=g*g*(3.0-2.0*g);
return mix(mix(h21(i),h21(i+vec2(1,0)),g.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),g.x),g.y);}
float fbm2(vec2 p){float v=0.0,a=0.5;for(int i=0;i<4;i++){v+=a*vn(p);p*=2.07;a*=0.5;}return v;}`;

// Ambient (fully scattered) water radiance at world height y. Evaluated per fragment,
// so one frame can show teal overhead and ink below at the same time.
const GLSL_AMBIENT = `
vec3 zoneGlow(float y){
  float t=clamp(-y/900.0,0.0,1.0);
  vec3 g=mix(vec3(0.0060,0.0210,0.0185),vec3(0.0102,0.0043,0.0203),smoothstep(0.20,0.52,t));
  g=mix(g,vec3(0.0197,0.0067,0.0040),smoothstep(0.62,0.92,t));
  // Floor the scatter so open mid-water is always legibly coloured. Without it the
  // sunlight term dies by ~60 units and empty water tone-maps to pure black, which
  // reads as a rendering fault rather than as darkness.
  return g*(0.15+0.85*smoothstep(0.03,0.30,t));
}
vec3 abyssaAmbient(vec3 surf,float y){
  return surf*exp(${v3(K_ABS)}*min(y,0.0))+zoneGlow(y);
}`;

// Weather scaling of the surface irradiance (set by game.js): night and storms dim
// what reaches the water; the zoneGlow floor is untouched so the deep stays itself.
let wSurfK = 1, wMurk = 0, rayDim = 1;
export function setWeatherWater(surfK, murk) { wSurfK = surfK; wMurk = murk; }
export function setRayDim(k) { rayDim = k; }

// CPU mirror of abyssaAmbient, for scene.background and the returned tint.
const ms = THREE.MathUtils.smoothstep, ml = THREE.MathUtils.lerp;
function ambientAt(y, out) {
  const t = clamp(-y / 900, 0, 1);
  const a = ms(t, 0.20, 0.52), b = ms(t, 0.62, 0.92), c = ms(t, 0.03, 0.30), d = Math.min(0, y);
  return out.setRGB(
    SURF_LIGHT[0] * wSurfK * Math.exp(K_ABS[0] * d) + ml(ml(0.0020, 0.0064, a), 0.0123, b) * c,
    SURF_LIGHT[1] * wSurfK * Math.exp(K_ABS[1] * d) + ml(ml(0.0073, 0.0027, a), 0.0042, b) * c,
    SURF_LIGHT[2] * wSurfK * Math.exp(K_ABS[2] * d) + ml(ml(0.0115, 0.0127, a), 0.0025, b) * c,
    THREE.LinearSRGBColorSpace
  );
}

// Replace three's grey-mix fog with per-channel Beer-Lambert extinction plus
// depth-tinted inscatter. scene.fog stays a FogExp2 so USE_FOG / FOG_EXP2 and the
// fogColor / fogDensity uniform plumbing keep working on every built-in material.
// NOTE: fogColor now means "surface irradiance", not "colour of the far field".
(function patchFog() {
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex = `#ifdef USE_FOG
  varying float vFogDepth;
  varying float vFogY;
#endif`;
  // viewMatrix[1].xyz is row 1 of the inverse view rotation, so world height comes back
  // without needing worldpos_vertex (which is not emitted by every material).
  C.fog_vertex = `#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogY = dot( viewMatrix[ 1 ].xyz, mvPosition.xyz ) + cameraPosition.y;
#endif`;
  C.fog_pars_fragment = `#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying float vFogY;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
${GLSL_AMBIENT}
#endif`;
  // The inscatter is dominated by the near end of a long ray, so weight the sample
  // height by extinction: wgt = 1/a - 1/(e^a - 1), which tends to 1/2 for short rays
  // and to 1/a for deep ones. That also makes an infinitely distant surface converge
  // on exactly what the background dome draws, so there is no seam between them.
  C.fog_fragment = `#ifdef USE_FOG
  {
    #ifdef FOG_EXP2
      float dens = fogDensity;
    #else
      float dens = 1.0 / max( 1.0, fogFar - fogNear );
    #endif
    float ea = clamp( dens * ${f(K_EXT[1])} * vFogDepth, 1e-4, 30.0 );
    // series form below 0.6: the closed form is two large reciprocals that cancel,
    // which loses all precision in fp32 on nearby geometry
    float wgt = ea < 0.6
      ? 0.5 - ea * 0.0833333 + ea * ea * ea * 0.0013889
      : 1.0 / ea - 1.0 / ( exp( ea ) - 1.0 );
    float ay = cameraPosition.y + ( vFogY - cameraPosition.y ) * wgt;
    vec3 tr = exp( -dens * ${v3(K_EXT)} * vFogDepth );
    gl_FragColor.rgb = gl_FragColor.rgb * tr + abyssaAmbient( fogColor, ay ) * ( 1.0 - tr );
  }
#endif`;
})();

const fogUniforms = () => THREE.UniformsUtils.clone(THREE.UniformsLib.fog);

// ---------------------------------------------------------------------------
let dome = null, rayMesh = null;
const snowLayers = [];
const uTime = { value: 0 };
const uCam = { value: new THREE.Vector3() };
const uExtG = { value: 0.024 };          // green-channel extinction, for manual fades
const uRayFade = { value: 0.55 };
const uLightPos = { value: new THREE.Vector3() };
const _tmp = new THREE.Vector3();
const _size = new THREE.Vector2();
const _outCol = new THREE.Color();

function pixScale(r, cam) {
  r.getSize(_size);
  return _size.y * r.getPixelRatio() / (2 * Math.tan(cam.fov * Math.PI / 360));
}

// ---------------------------------------------------------------------------
// Background dome: the far field, shaded by the same absorption model so empty
// water reads as an unbounded volume instead of a flat clear colour.
// ---------------------------------------------------------------------------
function buildDome() {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uSurf: { value: new THREE.Vector3(...SURF_LIGHT) },
      uReach: { value: 46 }, uTime, uSunGlow: { value: new THREE.Vector3() }
    },
    side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: `varying vec3 vDir;
      void main(){ vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        gl_Position = vec4( p.xy, p.w * 0.999999, p.w ); }`,
    fragmentShader: `uniform vec3 uSurf, uSunGlow; uniform float uReach, uTime;
      varying vec3 vDir;
      ${GLSL_NOISE}
      ${GLSL_AMBIENT}
      void main(){
        vec3 d = normalize( vDir );
        // uReach is one mean free path: the extinction-weighted height this ray samples
        vec3 c = abyssaAmbient( uSurf, cameraPosition.y + d.y * uReach );
        float up = max( 0.0, d.y );
        c += uSunGlow * ( up * up * up + 0.25 * up );
        // volume texture, faded out near the horizon so the ocean plane's far edge
        // blends into the dome without a step
        vec2 q = d.xz / max( 0.30, abs( d.y ) + 0.22 );
        float na = 0.16 * smoothstep( 0.05, 0.42, abs( d.y ) );
        c *= 1.0 - na * 0.5 + na * fbm2( q * 2.0 + vec2( uTime * 0.012, uTime * 0.008 ) );
        gl_FragColor = vec4( c, 1.0 );
      }`
  });
  dome = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), mat);
  dome.frustumCulled = false;
  dome.renderOrder = 900;   // last opaque draw, so early-z rejects everything already covered
  dome.onBeforeRender = (r, s, cam) => {
    dome.position.copy(cam.position);
    dome.updateMatrix();
    dome.matrixWorld.copy(dome.matrix);
  };
  scene.add(dome);
}

// ---------------------------------------------------------------------------
// God rays: cylindrically billboarded additive shafts whose positions wrap around
// the camera, so shaft density stays constant wherever the diver swims.
// ---------------------------------------------------------------------------
const RAY_N = 48, RAY_L = 205;

function buildRays() {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(RAY_N * 6 * 3);
  const cen = new Float32Array(RAY_N * 6 * 3);
  const par = new Float32Array(RAY_N * 6 * 4);
  const CS = [[-1, 0], [1, 0], [1, 1], [-1, 0], [1, 1], [-1, 1]];
  for (let i = 0; i < RAY_N; i++) {
    const cx = Math.random() * RAY_L, cz = Math.random() * RAY_L;
    const hw = rng(1.4, 4.8), len = rng(120, 250), sd = Math.random();
    for (let k = 0; k < 6; k++) {
      const o = i * 6 + k;
      pos[o * 3] = CS[k][0]; pos[o * 3 + 1] = CS[k][1];
      cen[o * 3] = cx; cen[o * 3 + 1] = SURFACE_Y - 1.0; cen[o * 3 + 2] = cz;
      par[o * 4] = hw; par[o * 4 + 1] = len; par[o * 4 + 2] = rng(0, 40); par[o * 4 + 3] = sd;
    }
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aCenter', new THREE.BufferAttribute(cen, 3));
  g.setAttribute('aParam', new THREE.BufferAttribute(par, 4));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime, uCam, uExtG, uFade: uRayFade,
      uColor: { value: new THREE.Vector3(0.36, 0.55, 0.68) }
    },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide, fog: false,
    vertexShader: `uniform vec3 uCam; uniform float uFade, uExtG;
      attribute vec3 aCenter; attribute vec4 aParam;
      varying vec2 vUv; varying float vSeed, vFade;
      void main(){
        vec2 w = mod( aCenter.xz - uCam.xz + ${f(RAY_L * 0.5)}, ${f(RAY_L)} ) - ${f(RAY_L * 0.5)} + uCam.xz;
        vec3 c = vec3( w.x, aCenter.y, w.y );
        vec2 d = uCam.xz - c.xz; float l = length( d );
        vec3 rt = l > 0.001 ? vec3( -d.y, 0.0, d.x ) / l : vec3( 1.0, 0.0, 0.0 );
        float v = position.y;
        vec3 wp = c + rt * ( position.x * aParam.x * ( 1.0 + v * 1.35 ) );
        wp.y -= v * aParam.y;
        wp.xz += vec2( 0.15, 0.13 ) * ( v * aParam.y );   // shafts lean along the sun azimuth
        float dist = distance( wp, uCam );
        vFade = uFade
          * smoothstep( ${f(RAY_L * 0.5)}, ${f(RAY_L * 0.30)}, dist )   // hides the wrap boundary
          * smoothstep( 8.0, 34.0, dist )                               // no near-plane slicing
          * exp( -dist * uExtG );
        vUv = vec2( position.x, v ); vSeed = aParam.w;
        gl_Position = projectionMatrix * viewMatrix * vec4( wp, 1.0 );
      }`,
    fragmentShader: `uniform vec3 uColor; uniform float uTime;
      varying vec2 vUv; varying float vSeed, vFade;
      ${GLSL_NOISE}
      void main(){
        float x = vUv.x, v = vUv.y;
        float edge = 1.0 - x * x; edge = edge * edge * edge;
        float n  = fbm2( vec2( x * 1.2 + vSeed * 27.0, v * 2.6 - uTime * 0.055 + vSeed * 13.0 ) );
        float n2 = vn(   vec2( x * 3.4 + vSeed * 5.0,  v * 8.0 - uTime * 0.14 ) );
        float a = edge * smoothstep( 0.0, 0.05, v ) * pow( max( 0.0, 1.0 - v ), 1.7 )
                * ( 0.24 + 0.95 * n + 0.28 * n2 ) * vFade;
        if ( a <= 0.0025 ) discard;
        gl_FragColor = vec4( uColor, a );
      }`
  });
  rayMesh = new THREE.Mesh(g, mat);
  rayMesh.frustumCulled = false;
  rayMesh.renderOrder = 4;
  rayMesh.onBeforeRender = (r, s, cam) => uCam.value.copy(cam.position);
  scene.add(rayMesh);
  rays.push({ m: rayMesh, ph: 0 });   // legacy handle
}

// ---------------------------------------------------------------------------
// Particulates: two GPU-wrapped layers of suspended matter. Positions live in a
// box that follows the camera modulo its own size, so density stays constant and
// nothing is simulated on the CPU.
// ---------------------------------------------------------------------------
function snowLayer(N, L, sizeMul, alpha, fall, colA, colB) {
  const g = new THREE.BufferGeometry();
  const p = new Float32Array(N * 3), s = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    p[i * 3] = Math.random() * L; p[i * 3 + 1] = Math.random() * L; p[i * 3 + 2] = Math.random() * L;
    // seed.x biases size (squared: mostly grit, a few big detritus flakes), y speed, z tint
    s[i * 3] = Math.random(); s[i * 3 + 1] = Math.random(); s[i * 3 + 2] = Math.random();
  }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(s, 3));

  const u = {
    uTime, uCam, uExtG, uLightPos,
    uL: { value: L }, uSize: { value: sizeMul }, uAlpha: { value: alpha },
    uFall: { value: fall }, uPix: { value: 900 }, uDepth: { value: 0.5 },
    uColA: { value: new THREE.Vector3(...colA) }, uColB: { value: new THREE.Vector3(...colB) }
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: false,
    vertexShader: `uniform vec3 uCam, uLightPos, uColA, uColB;
      uniform float uTime, uL, uSize, uAlpha, uFall, uPix, uExtG, uDepth;
      attribute vec3 aSeed;
      varying float vA; varying vec3 vC;
      void main(){
        vec3 p = position;
        p.y -= uTime * uFall * ( 0.45 + aSeed.y );
        p.x += sin( uTime * 0.21 + aSeed.z * 39.0 ) * 1.7;
        p.z += cos( uTime * 0.17 + aSeed.z * 23.0 ) * 1.7;
        vec3 w = mod( p - uCam + uL * 0.5, uL ) - uL * 0.5 + uCam;
        vec4 mv = viewMatrix * vec4( w, 1.0 );
        float dist = -mv.z;
        gl_PointSize = clamp( ( 0.25 + aSeed.x * aSeed.x * 2.0 ) * uSize * uPix / max( dist, 0.4 ), 0.7, 22.0 );
        vec3 dl = w - uLightPos;
        float lb = exp( -dot( dl, dl ) * 0.006 );   // the lantern picking grit out of the dark
        vA = uAlpha * uDepth
           * smoothstep( uL * 0.5, uL * 0.32, length( w - uCam ) )
           * smoothstep( 0.5, 3.0, dist )
           * exp( -dist * uExtG * 0.75 );
        vC = mix( uColA, uColB, aSeed.z ) * ( 0.45 + 2.6 * lb );
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `varying float vA; varying vec3 vC;
      void main(){
        vec2 q = gl_PointCoord - 0.5;
        float a = exp( -dot( q, q ) * 13.0 ) * vA;
        if ( a <= 0.003 ) discard;
        gl_FragColor = vec4( vC, a );
      }`
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 5;
  pts.onBeforeRender = (r, s2, cam) => { uCam.value.copy(cam.position); u.uPix.value = pixScale(r, cam); };
  snowLayers.push(u);
  return pts;
}

// ---------------------------------------------------------------------------
// Ocean surface seen from beneath: Snell's window, total internal reflection,
// a refracted sun disc and chop. No reflection render target.
// ---------------------------------------------------------------------------
const GLSL_WAVES = `
// wave height plus analytic gradient, world space
vec3 waveHN( vec2 p, float t ){
  float a1 = p.x * 0.085 + t * 1.10;
  float a2 = p.y * 0.062 - t * 0.85;
  float a3 = ( p.x + p.y ) * 0.041 + t * 0.62;
  float a4 = ( p.x - p.y * 1.7 ) * 0.150 + t * 1.90;
  float h = 0.55 * sin( a1 ) + 0.65 * sin( a2 ) + 0.85 * sin( a3 ) + 0.22 * sin( a4 );
  float dx = 0.04675 * cos( a1 ) + 0.03485 * cos( a3 ) + 0.03300 * cos( a4 );
  float dz = -0.04030 * cos( a2 ) + 0.03485 * cos( a3 ) - 0.05610 * cos( a4 );
  return vec3( h, dx, dz );
}`;

function buildSurface() {
  const g = new THREE.PlaneGeometry(820, 820, 132, 132);
  g.rotateX(-Math.PI / 2);
  const u = Object.assign(fogUniforms(), {
    uTime, uCam,
    uSun: { value: SUN_DIR.clone() },
    uSky: { value: new THREE.Vector3(0.30, 0.42, 0.60) },
    uHaze: { value: new THREE.Vector3(0.44, 0.45, 0.46) },
    uDeep: { value: new THREE.Vector3(0.006, 0.019, 0.029) },
    uBright: { value: 1 }, uFade: { value: 1 }
  });
  const mat = new THREE.ShaderMaterial({
    uniforms: u, fog: true, side: THREE.DoubleSide,
    vertexShader: `#include <fog_pars_vertex>
      ${GLSL_WAVES}
      uniform float uTime; uniform vec3 uCam;
      varying vec3 vW;
      void main(){
        vec3 p = position;
        p.x += uCam.x; p.z += uCam.z;               // the surface follows the diver
        p.y += ${f(SURFACE_Y)};
        // flatten far chop so the coarse outer tessellation cannot alias
        float fade = 1.0 - smoothstep( 30.0, 210.0, distance( p.xz, uCam.xz ) );
        p.y += waveHN( p.xz, uTime ).x * fade * 0.9;
        vW = p;
        vec4 mvPosition = viewMatrix * vec4( p, 1.0 );
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `#include <fog_pars_fragment>
      ${GLSL_NOISE}
      ${GLSL_WAVES}
      uniform float uTime, uBright, uFade; uniform vec3 uCam, uSun, uSky, uHaze, uDeep;
      varying vec3 vW;
      void main(){
        vec3 V = normalize( vW - uCam );
        vec3 hn = waveHN( vW.xz, uTime );
        vec2 q = vW.xz;
        // fine ripple layer, normal only: this is what makes the window rim dance
        float c3 = cos( q.x * 0.7 - q.y * 0.9 + uTime * 3.6 );
        float dx = hn.y + 0.0551 * cos( q.x * 0.95 + uTime * 3.1 ) + 0.0280 * c3
                 + 0.0620 * cos( q.x * 2.30 - q.y * 0.6 + uTime * 5.2 );
        float dz = hn.z + 0.0575 * cos( q.y * 1.15 - uTime * 2.7 ) - 0.0360 * c3
                 + 0.0480 * cos( q.y * 2.05 + q.x * 0.5 - uTime * 4.6 );
        vec3 N = normalize( vec3( -dx, 1.0, -dz ) );

        float ct = abs( dot( V, N ) );                       // cos of incidence at the interface
        float st = sqrt( max( 0.0, 1.0 - ct * ct ) );
        // total internal reflection past the critical angle: sin(theta) > 1/1.333
        float win = smoothstep( 0.652, 0.674, ct );

        float sa = clamp( st * 1.333, 0.0, 1.0 );            // Snell, water -> air
        float hl = length( V.xz );
        vec2 hdir = hl > 1e-5 ? V.xz / hl : vec2( 1.0, 0.0 );
        vec3 R = vec3( hdir.x * sa, sqrt( max( 0.0, 1.0 - sa * sa ) ), hdir.y * sa );

        vec3 sky = mix( uHaze, uSky, clamp( R.y, 0.0, 1.0 ) );
        float sd = max( 0.0, dot( R, uSun ) );
        sky += vec3( 3.4, 3.0, 2.3 ) * pow( sd, 700.0 );     // refracted sun disc
        sky += vec3( 0.34, 0.36, 0.36 ) * pow( sd, 18.0 );   // glare halo
        float ch = fbm2( q * 0.50 + vec2( uTime * 0.11, -uTime * 0.09 ) )
                 * 0.72 + 0.28 * vn( q * 1.7 + vec2( -uTime * 0.20, uTime * 0.16 ) );
        sky *= 0.70 + 0.62 * ch;                             // chop breaking up the window

        vec3 tir = uDeep * ( 0.5 + 0.9 * fbm2( q * 0.11 - vec2( uTime * 0.05 ) ) );
        // the critical-angle rim is the brightest thing in the frame.
        // NB: squared by multiplication — GLSL pow() is undefined for a negative base.
        float rd = ( ct - 0.663 ) / 0.018;
        float rim = exp( -rd * rd )
                  * ( 0.30 + 1.5 * vn( q * 1.1 + vec2( uTime * 0.30, uTime * 0.21 ) ) );

        vec3 col = mix( tir, sky, win ) + vec3( 0.72, 0.92, 1.0 ) * rim * 0.75;
        // foam flecks, only close enough to resolve
        col += vec3( 0.9, 0.97, 1.0 ) * ( 1.0 - smoothstep( 12.0, 70.0, distance( vW, uCam ) ) )
             * smoothstep( 0.72, 0.95, ch ) * 0.35 * win;

        // uFade retires the surface as the diver descends. Without it the depth fog
        // drives this plane to near-black while the dome behind stays lit, and the
        // horizon reads as a hard black rectangle whenever you look up.
        gl_FragColor = vec4( col * uBright, uFade );
        #include <fog_fragment>
      }`
  });
  mat.transparent = true;
  mat.depthWrite = false;
  surface = new THREE.Mesh(g, mat);
  surface.renderOrder = -1;          // behind everything; it is a ceiling, not an occluder
  surface.frustumCulled = false;
  surface.onBeforeRender = (r, s, cam) => uCam.value.copy(cam.position);
  scene.add(surface);
}

// ---------------------------------------------------------------------------
// Bubble vents: GPU streams with wobble, growth and acceleration on the rise.
// ---------------------------------------------------------------------------
function buildBubbles() {
  const vents = [];
  for (let zi = 0; zi < 3; zi++) for (const p of scatter(5, zi, 20, WORLD_R * 0.7)) vents.push(p);
  bubbles.data = vents;

  const N = 1100, g = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3), par = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    const v = vents[i % vents.length];
    pos[i * 3] = v.x + rng(-0.9, 0.9); pos[i * 3 + 1] = v.y + 0.6; pos[i * 3 + 2] = v.z + rng(-0.9, 0.9);
    par[i * 4] = Math.random();        // phase
    par[i * 4 + 1] = rng(0.30, 0.85);  // rise rate
    par[i * 4 + 2] = rng(0.030, 0.115);// radius
    par[i * 4 + 3] = rng(0, 6.283);    // wobble seed
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aParam', new THREE.BufferAttribute(par, 4));

  const u = { uTime, uExtG, uPix: { value: 900 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, fog: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `uniform float uTime, uPix, uExtG;
      attribute vec4 aParam;
      varying float vA;
      void main(){
        float k = fract( aParam.x + uTime * aParam.y * 0.11 );   // 0..1 along the plume
        float h = k * k * 0.55 + k * 0.45;                       // gas accelerates as pressure drops
        vec3 p = position;
        p.y += h * 42.0;
        float wob = 0.6 + h * 2.6;                               // and wobbles harder as it grows
        p.x += sin( uTime * 3.1 + aParam.w + h * 9.0 ) * wob;
        p.z += cos( uTime * 2.6 + aParam.w * 1.7 + h * 7.0 ) * wob;
        vec4 mv = viewMatrix * vec4( p, 1.0 );
        float dist = -mv.z;
        gl_PointSize = clamp( aParam.z * ( 0.55 + h * 1.1 ) * uPix / max( dist, 0.4 ), 1.0, 40.0 );
        vA = smoothstep( 0.0, 0.06, k ) * ( 1.0 - smoothstep( 0.80, 1.0, k ) )
           * exp( -dist * uExtG * 0.9 ) * smoothstep( 0.4, 2.0, dist );
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `varying float vA;
      void main(){
        vec2 q = ( gl_PointCoord - 0.5 ) * 2.0;
        float d = length( q );
        if ( d > 1.0 ) discard;
        float rim = smoothstep( 0.50, 0.97, d ) * ( 1.0 - smoothstep( 0.97, 1.0, d ) );
        float spec = pow( max( 0.0, 1.0 - length( q - vec2( -0.34, 0.34 ) ) * 2.2 ), 3.0 );
        gl_FragColor = vec4( vec3( 0.70, 0.90, 1.0 ), ( rim * 0.42 + spec * 0.75 ) * vA );
      }`
  });
  bubbles.pts = new THREE.Points(g, mat);
  bubbles.pts.frustumCulled = false;
  bubbles.pts.renderOrder = 6;
  bubbles.pts.onBeforeRender = (r, s, cam) => { u.uPix.value = pixScale(r, cam); };
  scene.add(bubbles.pts);
}

// ---------------------------------------------------------------------------
export function buildWater() {
  buildDome();
  buildSurface();
  buildRays();
  snow = new THREE.Group();
  // near grit gives the parallax that sells "I am inside a medium"
  snow.add(snowLayer(2400, 30, 0.020, 0.36, 0.55, [0.55, 0.75, 0.85], [0.80, 0.86, 0.78]));
  // far snow: bigger, slower, with a few large detritus flakes from the size^2 bias
  snow.add(snowLayer(3200, 170, 0.075, 0.30, 0.35, [0.50, 0.70, 0.85], [0.86, 0.80, 0.62]));
  scene.add(snow);
  buildBubbles();
  updateAtmosphere(0.03);   // prime fog / background before the title screen renders
}

export function updateWater(dt, t) {
  uTime.value = t;
  const y = camera.position.y, d01 = clamp(-y / 900, 0, 1);

  // shafts only exist while sunlight does; when the raymarched volumetric pass is
  // active the billboards drop to accents over its broad columns (rayDim, game.js)
  uRayFade.value = 0.62 * rayDim * Math.max(0, 1 - d01 * 4.2) * (0.82 + 0.18 * Math.sin(t * 0.23));
  rayMesh.visible = uRayFade.value > 0.004;
  // Fade the surface out over the first ~150 units rather than cutting it off, so it
  // never lingers as a black ceiling once absorption has swallowed it.
  const sFade = clamp(1 - (-y - 45) / 105, 0, 1);
  surface.visible = sFade > 0.004;
  if (surface.visible) {
    const su = surface.material.uniforms;
    if (su.uFade) su.uFade.value = sFade;   // tolerate a shader built without it
    su.uBright.value = clamp(1 - d01 * 0.6, 0.45, 1) * (0.35 + 0.65 * sFade);
  }

  // particulates thicken with depth
  const dens = clamp(d01 * 1.6, 0, 1);
  snowLayers[0].uDepth.value = 0.55 + dens * 0.75;
  snowLayers[1].uDepth.value = 0.50 + dens * 0.90;

  // the lantern rides roughly where the camera looks, ~8.5 units ahead
  camera.getWorldDirection(_tmp);
  uLightPos.value.copy(camera.position).addScaledVector(_tmp, 8.5);

  dome.material.uniforms.uSurf.value.set(SURF_LIGHT[0] * wSurfK, SURF_LIGHT[1] * wSurfK, SURF_LIGHT[2] * wSurfK);
  dome.material.uniforms.uReach.value = 1 / uExtG.value;
  dome.material.uniforms.uSunGlow.value.set(
    0.018 * Math.max(0, 1 - d01 * 3.4),
    0.050 * Math.max(0, 1 - d01 * 3.0),
    0.080 * Math.max(0, 1 - d01 * 2.6)
  );
}

// Depth-driven water optics. depth01 = 0 at the surface, 1 at the deepest zone.
// scene.fog.color is the *surface irradiance*; the shader applies the vertical
// absorption ramp per fragment, so a frame can be teal above and ink below.
export function updateAtmosphere(depth01) {
  scene.fog.color.setRGB(SURF_LIGHT[0] * wSurfK, SURF_LIGHT[1] * wSurfK, SURF_LIGHT[2] * wSurfK, THREE.LinearSRGBColorSpace);
  // Long visibility in the shallows (the reference reads 200+ units), closing to a
  // slightly murkier abyss than before so the descent arc is brightness you give up.
  // Storms stir the top of the column: extra murk that fades out with depth.
  scene.fog.density = (0.0078 + depth01 * 0.0205) * (1 + wMurk * 0.55 * Math.max(0, 1 - depth01 * 2.4));
  uExtG.value = scene.fog.density * K_EXT[1];
  scene.background = ambientAt(-depth01 * 900, _outCol);
  return _outCol;
}

export { clamp };
