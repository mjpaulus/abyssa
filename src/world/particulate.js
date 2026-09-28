// THE WATER COLUMN'S CLOSE-UP LIFE — lens flakes and bioluminescent plankton.
// OWNED BY: atmos track (water column). Built and driven by world/water.js only
// (buildWater -> buildParticulate, updateAtmosphere -> updateParticulate); game.js knows
// nothing about it.
//
// Two GPU-driven Points draws, zero per-frame allocation, no CPU simulation:
//
//  1. BOKEH. A few hundred flakes in an 8-unit box wrapped round the CAMERA, drawn only
//     where they sit 0.5..7 units from the lens — i.e. between the lens and Sal, who is
//     always ~9 units ahead. They are far inside the focal plane, so they render as
//     large, faint, soft-edged discs with a slightly brighter rim (the way a real lens
//     draws an out-of-focus mote), lit by the SAME lantern slot the fog chunk's in-scatter
//     reads: a flake beside the flame blooms warm, one in the dark is gone. Parallax
//     against the sharp grit behind them is most of what says "there is water between
//     me and him".
//
//  2. PLANKTON. Dinoflagellate-style bioluminescence: invisible until disturbed. The
//     CPU keeps a 12-slot ring of where the lantern hand has been (sampled every 0.12 s,
//     each slot carrying the hand's speed at that moment) and uploads it as a vec4
//     array: xyz = the sample, w = speed x exp(-age / TAU). Every particle sums a
//     Gaussian kick from each slot, so a swimming diver leaves a pale wake that
//     sparks, then fades over ~2 s. Sitting still, nothing glows. Zones 1 and 2 only
//     (gated by camera height), cold blue-green and dim — a trace, never neon.
//
// Budgets (measured, see the atmos report): each is one draw of <= 3400 points with a
// small vertex loop; fragment cost is the point sprites themselves.
import * as THREE from 'three';

const BOKEH_N = 260, BOKEH_L = 8.0;
const PLANK_N = 3400, PLANK_L = 12.0;
const TRAIL_N = 12, TRAIL_DT = 0.12, TRAIL_TAU = 1.9;

let bokeh = null, plank = null;
const trail = new Float32Array(TRAIL_N * 4);     // uploaded as vec4[TRAIL_N]
const trailT = new Float32Array(TRAIL_N);        // sample time per slot
const trailS = new Float32Array(TRAIL_N);        // hand speed per slot
let trailHead = 0, trailLastT = -1;
const _prev = new THREE.Vector3(), _hand = new THREE.Vector3();
let _havePrev = false;

const uBokehK = { value: 1 };
const uPlankK = { value: 0 };
const uAmb = { value: new THREE.Vector3() };
const uHand = { value: new THREE.Vector3() };

function seededPoints(N, L, seed) {
  // Deterministic layout (mulberry32), so a reload draws the same water.
  let a = seed >>> 0;
  const r = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const g = new THREE.BufferGeometry();
  const p = new Float32Array(N * 3), s = new Float32Array(N * 3);
  for (let i = 0; i < N * 3; i++) { p[i] = r() * L; s[i] = r(); }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(s, 3));
  return g;
}

// The lantern's light at a point: the same inverse-square + three range window the fog
// chunk's lampScatter uses, so a flake is lit exactly as the water round it glows.
const GLSL_LAMP_AT = `
uniform vec4 abyssaLampA, abyssaLampAC;
float lampE( vec3 w, out vec3 dl ){
  dl = w - abyssaLampA.xyz;
  float d2 = dot( dl, dl );
  float q = d2 / max( abyssaLampAC.w * abyssaLampAC.w, 1.0 );
  float win = clamp( 1.0 - q * q, 0.0, 1.0 );
  return abyssaLampA.w * win * win / max( d2, 0.5 );
}`;

export function buildParticulate(scene, shared) {
  const { uTime, uCam, uExtG, uPix, lampA, lampAC } = shared;

  // ---- 1. BOKEH ---------------------------------------------------------------
  {
    const u = {
      uTime, uCam, uExtG, uPix, uK: uBokehK, uAmb,
      abyssaLampA: { value: lampA }, abyssaLampAC: { value: lampAC }
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: u, transparent: true, depthWrite: false, depthTest: true,
      blending: THREE.AdditiveBlending, fog: false,
      vertexShader: `uniform vec3 uCam, uAmb; uniform float uTime, uPix, uExtG, uK;
        attribute vec3 aSeed;
        varying vec3 vC; varying float vA, vRim;
        ${GLSL_LAMP_AT}
        void main(){
          vec3 p = position;
          // The same slow drift the marine snow carries, a touch livelier up close.
          p.y -= uTime * 0.10 * ( 0.4 + aSeed.y );
          p.x += sin( uTime * 0.23 + aSeed.z * 31.0 ) * 0.9;
          p.z += cos( uTime * 0.19 + aSeed.x * 17.0 ) * 0.9;
          vec3 w = mod( p - uCam + ${(BOKEH_L * 0.5).toFixed(3)}, ${BOKEH_L.toFixed(3)} ) - ${(BOKEH_L * 0.5).toFixed(3)} + uCam;
          vec4 mv = viewMatrix * vec4( w, 1.0 );
          float dist = -mv.z;
          // Circle of confusion: the lens focuses on Sal (~9 units), so a mote at d
          // blurs in proportion to |1/d - 1/9|. Radius in world units x pixel scale.
          float coc = abs( 1.0 / max( dist, 0.3 ) - 0.111 );
          gl_PointSize = clamp( ( 0.018 + 0.040 * aSeed.x ) * uPix * coc * 2.2, 2.0, 150.0 );
          vec3 dl; float E = lampE( w, dl );
          // Forward glint: a mote between the flame and the lens lights up most.
          float mu = dot( normalize( dl ), normalize( uCam - w ) );
          float ph = 0.30 + 1.6 * pow( 0.5 + 0.5 * mu, 3.0 );
          vC = uAmb * 0.35 + abyssaLampAC.rgb * ( E * ph * 0.020 );
          // Energy spreads over the disc: a bigger blur is a fainter one.
          float spread = 1.0 / ( 1.0 + gl_PointSize * gl_PointSize * 0.0016 );
          vA = uK * spread
             * smoothstep( 0.5, 1.4, dist ) * ( 1.0 - smoothstep( 4.5, 7.0, dist ) )
             * ( 1.0 - smoothstep( -0.6, 0.0, w.y ) )          // water-borne only
             * ( 0.55 + 0.45 * aSeed.z );
          vRim = 0.10 + 0.22 * aSeed.y;   // a faint rim: more than that and a mote reads as a bubble
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `varying vec3 vC; varying float vA, vRim;
        void main(){
          vec2 q = gl_PointCoord * 2.0 - 1.0;
          float r = length( q );
          if ( r > 1.0 ) discard;
          // Flat disc, soft edge, faint brighter ring: an out-of-focus highlight.
          float disc = 1.0 - smoothstep( 0.78, 1.0, r );
          float ring = smoothstep( 0.55, 0.9, r ) * ( 1.0 - smoothstep( 0.9, 1.0, r ) );
          float a = ( disc * 0.55 + ring * vRim ) * vA;
          if ( a < 0.002 ) discard;
          gl_FragColor = vec4( vC * a, 1.0 );
        }`
    });
    bokeh = new THREE.Points(seededPoints(BOKEH_N, BOKEH_L, 0xB0CE), mat);
    bokeh.frustumCulled = false;
    bokeh.renderOrder = 7;   // after the snow and bubbles: nearest thing to the lens
    scene.add(bokeh);
  }

  // ---- 2. PLANKTON ------------------------------------------------------------
  {
    const u = {
      uTime, uCam, uExtG, uPix, uK: uPlankK, uHand,
      uTrail: { value: trail }
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: u, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: false,
      vertexShader: `uniform vec3 uCam, uHand; uniform float uTime, uPix, uExtG, uK;
        uniform vec4 uTrail[ ${TRAIL_N} ];
        attribute vec3 aSeed;
        varying float vA; varying vec3 vC;
        void main(){
          vec3 p = position;
          p.y += sin( uTime * 0.13 + aSeed.x * 40.0 ) * 0.6;
          p.x += sin( uTime * 0.09 + aSeed.y * 23.0 ) * 0.8;
          // The box rides the HAND, not the lens: the only water that can spark is the
          // water the diver is moving through, so every particle is spent where it can
          // be seen (~2 cells per cubic unit round him, against 0.09 in a camera box).
          vec3 w = mod( p - uHand + ${(PLANK_L * 0.5).toFixed(3)}, ${PLANK_L.toFixed(3)} ) - ${(PLANK_L * 0.5).toFixed(3)} + uHand;
          // Excitation: a Gaussian kick from every recent hand sample, weighted by how
          // fast the hand was moving then and how long ago that was (CPU folds both
          // into .w). Radius ~1.6 units: the water the diver actually disturbs.
          float ex = 0.0;
          for ( int i = 0; i < ${TRAIL_N}; i++ ) {
            vec4 s = uTrail[ i ];
            if ( s.w <= 0.001 ) continue;
            vec3 d = w - s.xyz;
            ex += s.w * exp( -dot( d, d ) * 0.38 );
          }
          // Each cell answers on its own: a per-particle threshold and a flicker, so
          // the wake SPARKS instead of glowing as a smooth tube.
          float thr = 0.08 + 0.5 * aSeed.z;
          float spark = smoothstep( thr, thr + 0.35, ex )
                      * ( 0.55 + 0.45 * sin( uTime * ( 9.0 + 14.0 * aSeed.y ) + aSeed.x * 60.0 ) );
          vec4 mv = viewMatrix * vec4( w, 1.0 );
          float dist = -mv.z;
          gl_PointSize = clamp( ( 0.030 + 0.03 * aSeed.x ) * uPix / max( dist, 0.4 ), 1.0, 9.0 );
          vA = uK * spark
             * ( 1.0 - smoothstep( ${(PLANK_L * 0.30).toFixed(2)}, ${(PLANK_L * 0.5).toFixed(2)}, length( w - uHand ) ) )
             * smoothstep( 0.6, 2.0, dist )
             * exp( -dist * uExtG * 0.6 );
          // Cold blue-green, a little variance cell to cell; never saturated.
          vC = mix( vec3( 0.20, 0.62, 0.70 ), vec3( 0.35, 0.72, 0.62 ), aSeed.y );
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `varying float vA; varying vec3 vC;
        void main(){
          vec2 q = gl_PointCoord - 0.5;
          float a = exp( -dot( q, q ) * 16.0 ) * vA;
          if ( a < 0.003 ) discard;
          gl_FragColor = vec4( vC * a, 1.0 );
        }`
    });
    plank = new THREE.Points(seededPoints(PLANK_N, PLANK_L, 0x91A4C7), mat);
    plank.frustumCulled = false;
    plank.renderOrder = 5;
    plank.visible = false;
    scene.add(plank);
  }
}

// Called once a frame from water.js updateAtmosphere, after game.js has placed the
// lantern. t = the shared clock; hand = the lantern's world position; amb = the water's
// ambient radiance at the camera (rgb, scene-linear); camY = camera height.
export function updateParticulate(t, hand, amb, camY, bokehOn) {
  if (!bokeh) return;
  uAmb.value.set(amb.r, amb.g, amb.b);
  uBokehK.value = bokehOn ? 1 : 0;
  bokeh.visible = bokehOn && camY < -0.4;

  // Plankton band: fades in from y = -300 (the zone-1 descent) down.
  const k = Math.min(1, Math.max(0, (-camY - 300) / 60));
  uPlankK.value = k * 0.9;
  plank.visible = k > 0.001;

  // Hand trail ring. Speed is measured over the sample interval; a teleport (> 8 u in
  // one sample) is not a swim stroke and does not light the sea.
  _hand.copy(hand);
  uHand.value.copy(hand);
  if (trailLastT < 0 || t < trailLastT) { trailLastT = t; _prev.copy(_hand); _havePrev = true; }
  const since = t - trailLastT;
  if (since >= TRAIL_DT && _havePrev) {
    const d = _hand.distanceTo(_prev);
    const sp = d < 8 ? d / since : 0;
    trailHead = (trailHead + 1) % TRAIL_N;
    const o = trailHead * 4;
    trail[o] = _hand.x; trail[o + 1] = _hand.y; trail[o + 2] = _hand.z;
    trailT[trailHead] = t; trailS[trailHead] = sp;
    _prev.copy(_hand); trailLastT = t;
  }
  for (let i = 0; i < TRAIL_N; i++) {
    const age = t - trailT[i];
    // 0 below a drift, full kick at a brisk swim (~2.5 u/s).
    const drive = Math.min(1.6, Math.max(0, (trailS[i] - 0.25) / 1.6));
    trail[i * 4 + 3] = age >= 0 ? drive * Math.exp(-age / TRAIL_TAU) : 0;
  }
}

export function particulateState() {
  return { bokeh: !!(bokeh && bokeh.visible), plank: !!(plank && plank.visible), plankK: uPlankK.value,
    trailW: Array.from({ length: TRAIL_N }, (_, i) => +trail[i * 4 + 3].toFixed(3)) };
}
