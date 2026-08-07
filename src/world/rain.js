// FALLING RAIN — the air-side streaks. OWNED BY: rain agent.
//
// The sea has drummed under a storm since the weather landed, but the AIR between the
// deck and the cloud deck was empty: a gale you could only read off the water. This is
// the missing half — wind-slanted streaks in the air, and nothing else. The splash field
// on the water (water.js splash()) and the from-below rain lens are separate systems;
// this one never touches either.
//
// ARCHITECTURE
//   ONE InstancedBufferGeometry, ONE material, ONE draw call, GLASS.rain.streaks quads
//   (420 shipped). The per-instance data is a SINGLE static vec4 seed written once at
//   build and never touched again; every streak's position, slant, recycling and fade
//   is computed in the VERTEX SHADER off uTime and four uniforms. The CPU writes six
//   floats a frame and allocates nothing, ever.
//
//   The cylinder is CAMERA-ANCHORED in x/z and SURFACE-ANCHORED in y. Camera-anchored is
//   invisible for rain in a way it would never be for waves: every streak is
//   interchangeable, so a field that travels with the eye and a field that does not are
//   the same picture. Surface-anchored in y is what makes "no rain below the waterline"
//   structural rather than a clamp — a streak lives in [surfY, surfY + top] by
//   construction, and `top` grows with the camera so pulling up 20 units still fills the
//   air instead of leaving the eye above the weather.
//
//   RECYCLING is fract(): phase runs 0..1, height is surfY + top * (1 - phase), so a
//   streak that reaches the water reappears at the top on the same frame. No pool, no
//   list, no branch.
//
// RENDERING DISCIPLINE (same rules the puff clouds live under, same reasons)
//   fog: false        — this is AIR. The globally patched Beer-Lambert fog chunk measures
//                       in metres of seawater and would turn a raindrop teal (the
//                       raft-lantern lesson, again).
//   depthWrite: false — hundreds of overlapping transparent quads must not fight.
//   depthTest: true   — the raft's mast and davit occlude rain in front of them.
//   alpha             — GLASS.rain.alpha is 0.16 and the colour is a grey-silver 0.78;
//                       peak scene-linear is ~0.12, well under BloomEffect's 0.28. Rain
//                       is never allowed to glow. It is sheeting grey, not white noise.
//   underwater        — the whole mesh is hidden when the eye is under the surface. The
//                       from-below rain lens already owns that view and is untouched.
//
// COST
//   Calm (env.sky under GLASS.rain.skyOn) is ONE compare in updateRain and a hidden mesh:
//   zero draw calls, zero uniform writes. In a storm it is +1 draw call and 420 quads.
import * as THREE from 'three';
import { scene, camera } from '../core.js';
import { GLASS, SURFACE_Y } from '../config.js';
import { localSurfaceY, refrHide } from './water.js';

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const ms = (x, a, b) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

let mesh = null, mat = null, geo = null;
let uni = null;
let envSky = 0, wSpeed = 0, wdx = 1, wdz = 0;
let surfY = SURFACE_Y;
let live = 0;          // the resolved intensity, 0..1 — the one number this file drives

export function buildRain() {
  if (mesh) return;
  const R = GLASS.rain;
  const N = Math.max(1, R.streaks | 0);

  const base = new THREE.PlaneGeometry(1, 1);
  geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.attributes.position = base.attributes.position;
  geo.attributes.uv = base.attributes.uv;

  // ONE static attribute: x/z on the unit disc, phase offset, per-streak size/alpha
  // jitter. Written once here; the shader does the rest forever.
  const seed = new Float32Array(N * 4);
  // A deterministic stream, so a screenshot of storm 1 is the same storm every session.
  let s = 0x9E3779B9;
  const rnd = () => {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  for (let i = 0; i < N; i++) {
    // sqrt on the radius = uniform area density. Without it the near field is a curtain
    // and the far field is empty, which reads as rain following you.
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd());
    seed[i * 4] = Math.cos(a) * r;
    seed[i * 4 + 1] = Math.sin(a) * r;
    seed[i * 4 + 2] = rnd();                 // phase
    seed[i * 4 + 3] = 0.55 + 0.75 * rnd();   // length/alpha jitter
  }
  const aSeed = new THREE.InstancedBufferAttribute(seed, 4);
  geo.setAttribute('aSeed', aSeed);
  geo.instanceCount = N;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  uni = {
    uTime: { value: 0 },
    // x,z = wind-aligned horizontal drift per unit of fall; y = intensity 0..1
    uWind: { value: new THREE.Vector3(0, 0, 0) },
    // radius, top (height of the column), streak length, half-width
    uGeo: { value: new THREE.Vector4(R.radius, R.top, R.len, R.wide) },
    // fall speed, peak alpha, surface y
    uP: { value: new THREE.Vector3(R.fall, R.alpha, SURFACE_Y) },
    uCol: { value: new THREE.Color(R.col[0], R.col[1], R.col[2]) }
  };

  mat = new THREE.ShaderMaterial({
    uniforms: uni,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    fog: false,
    side: THREE.DoubleSide,
    // ONE draw call, not two. Since r163 three renders a transparent DoubleSide material
    // in two passes (back faces, then front) unless this is set — measured here, 2.0
    // draws per frame for one mesh. These quads are camera-facing billboards built in
    // view space, so back and front are the same picture and the second pass buys
    // nothing but a submission.
    forceSinglePass: true,
    blending: THREE.NormalBlending,
    vertexShader: `
      attribute vec4 aSeed;     // disc x, disc z, phase, size jitter
      uniform float uTime;
      uniform vec3 uWind;       // drift.x, drift.z, intensity
      uniform vec4 uGeo;        // radius, top, length, half-width
      uniform vec3 uP;          // fall speed, peak alpha, surface y
      varying float vA;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        float top = uGeo.y;
        // RECYCLING. One fract, no branch: phase 0 is the top of the column, phase 1 is
        // the water. Rate is fall speed over column height, so a taller column (the
        // camera climbed) does not make the rain fall slower.
        float ph = fract( aSeed.z + uTime * uP.x / top );
        float fallen = top * ph;
        // THE SLANT. Horizontal offset grows with how far this streak has already
        // fallen, which is exactly what a constant crosswind does to a falling drop —
        // and it means the slant of the STREAK and the lean of the whole column are the
        // same number, so a gust re-aims both together.
        vec3 wp;
        wp.x = cameraPosition.x + aSeed.x * uGeo.x + uWind.x * fallen;
        wp.z = cameraPosition.z + aSeed.y * uGeo.x + uWind.y * fallen;
        wp.y = uP.z + top - fallen;

        // The streak's own axis: down, dragged onto the wind. Normalised in WORLD space
        // then taken to view space, so the screen-space angle is a real perspective
        // projection of a slanted fall and not a 2D rotation pasted on.
        vec3 dir = normalize( vec3( uWind.x, -1.0, uWind.y ) );
        vec4 mv = viewMatrix * vec4( wp, 1.0 );
        vec3 dv = ( viewMatrix * vec4( dir, 0.0 ) ).xyz;
        vec2 d2 = dv.xy;
        float dl = length( d2 );
        // Looking straight down the fall axis a streak is a point; give it a stable
        // fallback direction so it degenerates to a dot instead of to NaN.
        d2 = dl > 1e-4 ? d2 / dl : vec2( 0.0, 1.0 );
        vec2 pp = vec2( -d2.y, d2.x );
        float len = uGeo.z * aSeed.w * ( 0.35 + 0.65 * uWind.z );
        mv.xy += position.y * len * d2 + position.x * uGeo.w * pp;

        // ALPHA. Intensity, per-streak jitter, a near fade so a streak never lands in
        // the eye as a grey bar, and a far fade so the column has no rim.
        float dist = length( mv.xyz );
        float a = uP.y * uWind.z * aSeed.w
                * smoothstep( 0.6, 2.6, dist )
                * ( 1.0 - smoothstep( uGeo.x * 0.55, uGeo.x, dist ) );
        // Never below the water. The column is surface-anchored so this only catches the
        // half-streak straddling the interface, but that half-streak IS the waterline.
        a *= 1.0 - step( wp.y, uP.z );
        vA = a;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uCol;
      varying float vA;
      varying vec2 vUv;
      void main() {
        if ( vA < 0.004 ) discard;
        // Soft along the width, tapered at both ends: a streak is a smear of a drop, not
        // a rectangle. One abs() each, no texture.
        float w = 1.0 - abs( vUv.x - 0.5 ) * 2.0;
        float l = 1.0 - abs( vUv.y - 0.5 ) * 2.0;
        gl_FragColor = vec4( uCol, vA * w * smoothstep( 0.0, 0.45, l ) );
      }`
  });
  // creatures.js's hazard: three silently shares a compiled program between materials
  // whose sources hash alike.
  mat.customProgramCacheKey = () => 'abyssa-rainstreak-v1';

  mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.visible = false;
  // OUT of the screen-space refraction render. That pass keeps the half-world the
  // transmitted ray enters, and from the air that half is the water — rain drawn into it
  // would appear THROUGH the surface, as if it were falling underwater. A plain
  // ShaderMaterial does not honour renderer.clippingPlanes, so the clip plane cannot do
  // this job; being hidden for the pass is the honest fix and costs one bool.
  refrHide.push(mesh);
  scene.add(mesh);
}

// Called by game.js beside setCloudWeather. Storage only — windState() hands back the
// object water.js reuses forever, so this reads it rather than keeping it.
export function setRainWeather(env, wind) {
  envSky = env ? clamp(env.sky, 0, 1) : 0;
  if (wind) { wSpeed = clamp(wind.speed, 0, 1); wdx = wind.dx; wdz = wind.dz; }
}

// Optional override of the column's foot. Nothing calls it — updateRain reads water.js's
// own localSurfaceY() so game.js needs no extra wiring line — but it is the seam if the
// rain ever has to sit on something other than the sea.
export function setRainSurface(y) { surfY = y; }

export function updateRain(dt, t) {
  const R = GLASS.rain;
  // THE EARLY-OUT. In a calm this function is one compare and a return: no uniform
  // writes, no draw call, nothing allocated.
  if (envSky <= R.skyOn) {
    if (live !== 0) { live = 0; if (mesh) mesh.visible = false; }
    return;
  }
  if (!mesh) return;
  // The live surface under the camera (updateWater resolved it this frame), so the
  // column's foot rides the swell instead of the nominal plane.
  surfY = localSurfaceY();

  // Rain arrives with the sky half-made and is at full sheet well before the storm
  // peaks — the squall's own leading edge is the wettest part of it.
  live = ms(envSky, R.skyOn, 0.55);
  // THE GUST. wind.speed already carries weather.js's smooth three-sine gust term, so
  // both density and slant ride it without a second clock. A lull thins the sheet and
  // stands it up; a gust thickens it and lays it over.
  const g = 1 - R.gustK + R.gustK * (0.35 + 1.15 * wSpeed);
  const k = clamp(live * g, 0, 1);

  // Above the eye by enough that the column never ends inside the frame, and it grows
  // with the camera so a pull-up still has weather over it.
  const top = Math.max(R.top, camera.position.y - surfY + 10);
  const slant = R.slantK * wSpeed;
  uni.uTime.value = t;
  uni.uWind.value.set(wdx * slant, wdz * slant, k);
  uni.uGeo.value.y = top;
  uni.uP.value.z = surfY;

  // Underwater the from-below lens owns the rain and this system has nothing to say.
  mesh.visible = camera.position.y > surfY + 0.05;
}

if (typeof window !== 'undefined') {
  window.__rain = {
    state() {
      return {
        envSky, wind: wSpeed, live, k: uni ? uni.uWind.value.z : 0,
        slant: uni ? Math.hypot(uni.uWind.value.x, uni.uWind.value.y) : 0,
        dir: [wdx, wdz],
        top: uni ? uni.uGeo.value.y : 0,
        visible: !!(mesh && mesh.visible),
        count: geo ? geo.instanceCount : 0
      };
    }
  };
}
