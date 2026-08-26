// Zone-exit rifts and the light motes that refuel the lantern.
// OWNED BY: water/atmosphere agent (rift VFX) — motes logic is shared, coordinate before changing.
import * as THREE from 'three';
import { scene, camera } from '../core.js';
import { WORLD_R, RIFT_R, riftPos, zoneTop, zoneBottom } from '../config.js';
import { rng, lerp, clamp } from '../lib/math.js';
import { makeGlow } from '../lib/textures.js';
import { terrainH } from './terrain.js';

export const rifts = [];

// Rift light reads as a beacon, so it survives murk better than the general fog.
const BEACON_EXT = 0.010;

const NOISE = `
float h21(vec2 p){vec3 q=fract(vec3(p.xyx)*0.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float vn(vec2 p){vec2 i=floor(p),g=fract(p);g=g*g*(3.0-2.0*g);
return mix(mix(h21(i),h21(i+vec2(1,0)),g.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),g.x),g.y);}
float fbm3(vec2 p){float v=0.0,a=0.5;for(int i=0;i<3;i++){v+=a*vn(p);p*=2.11;a*=0.5;}return v;}`;

// Shafts are cylinder shells shaded so alpha tracks |N.V|, which is the chord length
// through the enclosed volume. That is what stops a cone reading as cardboard.
const SHAFT_VS = `
  varying vec3 vN, vW; varying vec2 vUv;
  void main(){
    vN = normalMatrix * normal;
    vec4 mv = modelViewMatrix * vec4( position, 1.0 );
    vW = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
    vUv = uv;
    gl_Position = projectionMatrix * mv;
  }`;

const SHAFT_FS = `
  uniform vec3 uColor; uniform float uTime, uOpen, uPower, uSwirl, uTop, uBot;
  varying vec3 vN, vW; varying vec2 vUv;
  ${NOISE}
  void main(){
    vec3 N = normalize( vN );
    vec3 Vv = normalize( -( viewMatrix * vec4( vW, 1.0 ) ).xyz );
    float chord = pow( abs( dot( N, Vv ) ), uPower );
    // seamless swirl: sample the noise field on a circle so the wrap has no seam
    float a = vUv.x * 6.28318;
    vec2 cir = vec2( cos( a ), sin( a ) ) * 2.2;
    float n = fbm3( cir + vec2( vUv.y * 3.5 - uTime * uSwirl, vUv.y * 2.0 + uTime * 0.31 ) );
    float vert = smoothstep( uBot, uBot + 0.14, vUv.y ) * ( 1.0 - smoothstep( uTop - 0.45, uTop, vUv.y ) );
    float dist = distance( vW, cameraPosition );
    float al = chord * vert * ( 0.30 + 1.35 * n ) * uOpen * exp( -dist * ${BEACON_EXT.toFixed(4)} );
    if ( al <= 0.003 ) discard;
    gl_FragColor = vec4( uColor, al );
  }`;

function shaft(rTop, rBot, h, color, power, swirl, opacity, seg = 28) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 6, true);
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Vector3(...color) }, uTime: { value: 0 },
      uOpen: { value: 0 }, uPower: { value: power }, uSwirl: { value: swirl },
      uTop: { value: 1.0 }, uBot: { value: 0.0 }
    },
    vertexShader: SHAFT_VS, fragmentShader: SHAFT_FS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    // DoubleSide is load-bearing (the chord shading reads both walls of the shell);
    // forceSinglePass only kills r163+'s transparent double-pass split, it does not
    // change which faces draw, so the tuned look is unchanged.
    side: THREE.DoubleSide, forceSinglePass: true, fog: false
  });
  m.uniforms.uColor.value.multiplyScalar(opacity);
  return new THREE.Mesh(g, m);
}

// Caustic pool cast on the crater floor by the light pouring out of the rift.
function causticDisc(color) {
  const g = new THREE.RingGeometry(RIFT_R * 0.18, RIFT_R * 2.6, 72, 1);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Vector3(...color) }, uTime: { value: 0 }, uOpen: { value: 0 }
    },
    vertexShader: `varying vec2 vP;
      void main(){ vP = position.xz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
    fragmentShader: `uniform vec3 uColor; uniform float uTime, uOpen;
      varying vec2 vP;
      ${NOISE}
      void main(){
        float r = length( vP ) / ${RIFT_R.toFixed(1)};
        float a = atan( vP.y, vP.x );
        float ripple = sin( r * 5.5 - uTime * 1.6 );
        float spokes = 0.5 + 0.5 * sin( a * 9.0 + uTime * 0.75 + ripple * 2.2 );
        float band = smoothstep( 0.22, 0.62, r ) * ( 1.0 - smoothstep( 0.9, 2.55, r ) );
        float n = fbm3( vP * 0.16 + vec2( uTime * 0.09, -uTime * 0.06 ) );
        float al = ( pow( spokes, 3.0 ) * 0.9 + 0.25 ) * band * ( 0.35 + 1.1 * n ) * uOpen;
        if ( al <= 0.004 ) discard;
        gl_FragColor = vec4( uColor, al );
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide, forceSinglePass: true, fog: false
  });
  return new THREE.Mesh(g, m);
}

// Glowing rim: a torus shaded with a moving chromatic fringe, which is a cheap stand-in
// for the refraction shimmer a real screen-space distortion pass would give.
function rimRing(color) {
  const g = new THREE.TorusGeometry(RIFT_R, 1.15, 10, 64);
  g.rotateX(Math.PI / 2);
  const m = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Vector3(...color) }, uTime: { value: 0 }, uOpen: { value: 0 } },
    vertexShader: `varying vec2 vUv; varying vec3 vN, vW;
      void main(){ vUv = uv; vN = normalMatrix * normal;
        vW = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
    fragmentShader: `uniform vec3 uColor; uniform float uTime, uOpen;
      varying vec2 vUv; varying vec3 vN, vW;
      ${NOISE}
      void main(){
        float band = vn( vec2( vUv.x * 22.0, uTime * 0.6 ) );
        vec3 N = normalize( vN );
        vec3 Vv = normalize( cameraPosition - vW );
        float rim = pow( max( 0.0, 1.0 - abs( dot( N, Vv ) ) ), 1.4 );
        float pulse = 0.55 + 0.45 * sin( uTime * 2.2 - vUv.x * 12.56 );
        // split the channels slightly so the rim shimmers instead of sitting flat
        vec3 c = uColor * ( 0.6 + 0.9 * band ) + vec3( 0.35, 0.0, 0.55 ) * pow( band, 3.0 );
        float al = ( 0.35 + 0.75 * rim ) * pulse * uOpen
                 * exp( -distance( vW, cameraPosition ) * ${BEACON_EXT.toFixed(4)} );
        gl_FragColor = vec4( c, al );
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide, forceSinglePass: true, fog: false
  });
  return new THREE.Mesh(g, m);
}

// Particles: most spiral inward and down the throat, a third rise inside the shaft.
const SWIRL_N = 620;
const swirlGeo = (() => {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(SWIRL_N * 3), par = new Float32Array(SWIRL_N * 4);
  for (let i = 0; i < SWIRL_N; i++) {
    par[i * 4] = rng(RIFT_R * 0.55, RIFT_R * 2.9);  // start radius
    par[i * 4 + 1] = rng(0, 6.283);                 // start angle
    par[i * 4 + 2] = rng(-2, 22);                   // start height
    par[i * 4 + 3] = rng(0.35, 1.0);                // rate + riser flag via fract
    pos[i * 3 + 1] = par[i * 4 + 2];
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aP', new THREE.BufferAttribute(par, 4));
  return g;
})();

function swirl(color) {
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Vector3(...color) }, uTime: { value: 0 },
      uOpen: { value: 0 }, uPix: { value: 900 }
    },
    vertexShader: `uniform float uTime, uOpen, uPix; attribute vec4 aP;
      varying float vA;
      void main(){
        float rise = step( 0.78, fract( aP.w * 13.7 ) );
        float k = fract( aP.w * uTime * 0.075 + aP.x * 0.31 );
        float e = k * k;                                   // accelerates into the throat
        float r = mix( aP.x, 0.6, rise > 0.5 ? k * 0.3 : e );
        float ang = aP.y + e * 8.0 + uTime * 0.25;
        float y = rise > 0.5 ? mix( -4.0, 66.0, k ) : mix( aP.z, -8.0, e );
        vec3 p = vec3( cos( ang ) * r, y, sin( ang ) * r );
        vec4 mv = modelViewMatrix * vec4( p, 1.0 );
        float dist = -mv.z;
        gl_PointSize = clamp( ( 0.05 + 0.09 * fract( aP.w * 7.3 ) ) * uPix / max( dist, 0.5 ), 1.0, 22.0 );
        vA = uOpen * smoothstep( 0.0, 0.10, k ) * ( 1.0 - smoothstep( 0.82, 1.0, k ) )
           * exp( -dist * ${BEACON_EXT.toFixed(4)} );
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform vec3 uColor; varying float vA;
      void main(){
        vec2 q = gl_PointCoord - 0.5;
        float a = exp( -dot( q, q ) * 11.0 ) * vA;
        if ( a <= 0.004 ) discard;
        gl_FragColor = vec4( uColor, a );
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false
  });
  const p = new THREE.Points(swirlGeo, m);
  p.frustumCulled = false;
  return p;
}

export function buildRifts() {
  const _s = new THREE.Vector2();
  for (let zi = 0; zi < 3; zi++) {
    const rp = riftPos(zi), y = terrainH(rp.x, rp.z, zi) + 2;
    const grp = new THREE.Group();
    grp.position.set(rp.x, y, rp.z);
    grp.visible = false;

    // light pouring upward out of the hole, plus the throat continuing down
    const beam = shaft(RIFT_R * 2.2, RIFT_R * 0.60, 86, [0.42, 0.86, 1.0], 1.0, 0.55, 0.32, 30);
    beam.position.y = 40;
    const core = shaft(RIFT_R * 0.85, RIFT_R * 0.30, 62, [0.72, 0.96, 1.0], 0.85, 0.95, 0.55, 22);
    core.position.y = 26;
    const throat = shaft(RIFT_R * 0.92, RIFT_R * 0.28, 70, [0.55, 0.90, 1.0], 1.1, 0.40, 0.40, 22);
    throat.position.y = -34;
    // wide, faint, high-frequency shell: the shimmer that stands in for heat haze
    const haze = shaft(RIFT_R * 3.4, RIFT_R * 1.1, 96, [0.30, 0.62, 0.85], 2.2, 1.9, 0.14, 20);
    haze.position.y = 42;

    const ring = rimRing([0.55, 0.92, 1.0]);
    const disc = causticDisc([0.30, 0.78, 1.0]);
    disc.position.y = 0.4;
    const sw = swirl([0.72, 0.98, 1.0]);
    const glow = makeGlow(0x8fe8ff, 0);
    glow.position.y = 6;

    grp.add(beam, core, throat, haze, ring, disc, sw, glow);
    scene.add(grp);
    const shafts = [beam, core, throat, haze, ring, disc, sw];
    rifts.push({ grp, ring, beam, core, throat, haze, disc, sw, glow, shafts, open: 0 });

    sw.onBeforeRender = (r, s, cam) => {
      r.getSize(_s);
      sw.material.uniforms.uPix.value = _s.y * r.getPixelRatio() / (2 * Math.tan(cam.fov * Math.PI / 360));
    };
  }
}

// Rift positions never move (riftPos is frozen — THE CHART may not touch it), but a
// site swap regrows terrain under them, so the group's cached floor height goes stale.
// Re-seat each rift's y exactly the way buildRifts() first set it, off the CURRENT
// terrainH; x/z are re-set too (cheap, and keeps this the single source of truth for
// "where a rift group sits" rather than a delta applied on top of build's own math).
export function reseatRifts() {
  for (let zi = 0; zi < 3; zi++) {
    const R = rifts[zi];
    if (!R) continue;
    const rp = riftPos(zi), y = terrainH(rp.x, rp.z, zi) + 2;
    R.grp.position.set(rp.x, y, rp.z);
  }
}

export function updateRifts(dt, t, activeZone, isCalmed) {
  for (let zi = 0; zi < 3; zi++) {
    const R = rifts[zi], isOpen = zi === activeZone && isCalmed;
    R.open = lerp(R.open, isOpen ? 1 : 0, Math.min(1, dt * 1.6));
    R.grp.visible = R.open > 0.004;
    if (!R.grp.visible) continue;
    // slow breath plus a faster flutter, so the portal never sits still
    const puls = 0.82 + 0.18 * Math.sin(t * 1.15) + 0.06 * Math.sin(t * 4.3);
    const o = R.open * R.open * puls;
    for (const m of R.shafts) { m.material.uniforms.uTime.value = t; m.material.uniforms.uOpen.value = o; }
    R.core.material.uniforms.uOpen.value = o * (0.85 + 0.35 * Math.sin(t * 2.7));
    R.ring.rotation.y = t * 0.22;
    R.disc.rotation.y = -t * 0.09;
    R.haze.rotation.y = t * 0.05;
    R.glow.scale.setScalar(R.open * RIFT_R * 2.2 * (0.9 + 0.14 * Math.sin(t * 1.9)));
    R.glow.material.opacity = 0.75 * R.open;
  }
}

// ---- motes ----
const moteGeo = new THREE.IcosahedronGeometry(0.75, 1);
// Template only: each mote clones this so its core can fade with distance (below).
const moteMat = new THREE.MeshBasicMaterial({ color: 0xdffff0, fog: false, transparent: true });
export let motes = [];

export function seedMotes(zi) {
  for (const m of motes) {
    scene.remove(m.grp);
    m.coreMat.dispose();
    m.grp.children[1].material.dispose();
    m.grp.children[2].material.dispose();
  }
  motes = [];
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2, r = rng(15, WORLD_R * 0.85);
    const grp = new THREE.Group();
    grp.position.set(Math.cos(a) * r, rng(zoneBottom(zi) + 18, zoneTop(zi) - 15), Math.sin(a) * r);
    const coreMat = moteMat.clone();
    grp.add(new THREE.Mesh(moteGeo, coreMat));
    grp.add(makeGlow(0x9fffcf, 10));
    const halo = makeGlow(0x4fffb0, 22);
    halo.material.opacity = 0.28;
    grp.add(halo);
    scene.add(grp);
    motes.push({ grp, coreMat, alive: true, respawn: 0, ph: Math.random() * 7, home: grp.position.clone() });
  }
}

// Returns the number collected this frame so the caller can award light and play audio.
export function updateMotes(dt, t, playerPos) {
  let collected = 0;
  for (const m of motes) {
    if (!m.alive) {
      m.respawn -= dt;
      if (m.respawn <= 0) { m.alive = true; m.grp.visible = true; m.grp.position.copy(m.home); }
      continue;
    }
    m.grp.rotation.y += dt * 0.9;
    m.grp.rotation.x += dt * 0.35;
    const d = m.grp.position.distanceTo(playerPos);
    // drift home, then swim toward the diver once he is close enough to notice
    m.grp.position.y = m.home.y + Math.sin(t * 1.5 + m.ph) * 0.9;
    if (d < 11) m.grp.position.lerp(playerPos, Math.min(1, dt * clamp((11 - d) / 8, 0, 1) * 2.2));
    const p = 8 + 3 * Math.sin(t * 2 + m.ph);
    m.grp.children[1].scale.setScalar(p);
    m.grp.children[2].scale.setScalar(18 + 7 * Math.sin(t * 1.3 + m.ph * 1.7));
    // Beacon extinction (same law as the rift shafts): additive glow with fog:false
    // must fade to black with range or it reads as neon across the basin. No allocation:
    // distanceTo on module-held vectors, scalar math only.
    const fade = Math.exp(-m.grp.position.distanceTo(camera.position) * BEACON_EXT);
    m.coreMat.opacity = fade;
    m.grp.children[1].material.opacity = 0.8 * fade;
    m.grp.children[2].material.opacity = 0.28 * fade;
    if (d < 3.4) {
      m.alive = false; m.respawn = 14; m.grp.visible = false;
      collected++;
    }
  }
  return collected;
}
