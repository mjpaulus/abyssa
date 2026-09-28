// THE SHARED SURFACE RESPONSE. OWNED BY: lighting/post agent.
//
// ONE global patch on three's lighting chunks, so every lit built-in material (every
// MeshStandardMaterial / MeshPhysicalMaterial in the game, including the ones that
// extend themselves through onBeforeCompile) answers light the same way. There is no
// per-material variant and no define, so nothing needs a customProgramCacheKey and the
// program count does not move: the chunks are rewritten ONCE at module evaluation,
// before the first compile, and every program is built from the patched text.
//
// Every term is gated by a live uniform whose ZERO is the identity, so SURF.set with
// all zeros is bit-identical to stock three (and any ShaderMaterial that includes these
// chunks without carrying the uniforms reads 0 and is untouched).
//
// What it adds, in the order it matters on screen:
//  1. LANTERN PATH EXTINCTION (lights_pars_begin, getPointLightInfo). Light leaving a
//     point source crosses water before it lands, and water eats red first. The fog chunk
//     already extinguishes the EYE leg; this is the LIGHT leg, per channel, so a lantern
//     pool has a warm core and a teal-green rim, and a ward 20 units off lights the rock
//     green-gold instead of white. uPath.rgb is per-unit extinction (lighting.js writes it
//     from scene.fog.density every frame and zeroes it in air).
//  2. WRAP DIFFUSE (RE_Direct_Physical). A scattering medium lights the terminator: the
//     light that reaches a surface arrives from a cone, not a ray. (N.L + w)/(1 + w),
//     applied as the share it adds over Lambert, so a face turned to the light keeps its
//     exact value and only the terminator opens; softens the hard CG edge on bodies, kelp
//     and rock under water; 0 in air, where the deck wants its sunlight hard.
//  3. BACKSCATTER RIM (RE_Direct_Physical). When a light sits BEHIND a surface relative
//     to the eye, the silhouette picks up the forward-scattered glow of that light in
//     the water around it: pow(1 - N.V) x a forward-scatter lobe on (L . -V). This is
//     what separates a creature from the murk when the lantern or a ward is beyond it,
//     and it costs nothing when nothing is behind.
//  4. WET FILM (RE_Direct_Physical). A second, tighter GGX lobe on ROUGH dielectrics
//     only (smoothstep on roughness, x (1 - metalness)): chitin, wet rock, slick kelp
//     catch a narrow sheen off the lantern without the whole surface going plastic.
//  4b. THIN-SHEET TRANSMISSION (RE_Direct_Physical, DOUBLE_SIDED programs only). Light
//     from behind a leaf, fin or sail comes through it, coloured by the sheet itself.
//  5. THE MEDIUM AS ENVIRONMENT (lights_fragment_maps). Materials without an envMap had
//     ZERO indirect specular, so metal and wet surfaces went dead black away from a
//     direct light, and grazing silhouettes had no Fresnel at all. The hemisphere light
//     already IS the environment (sky/water above, ground below), so its two colours
//     along the reflection vector, blurred toward their mean by roughness, become the
//     radiance three's own split-sum then weights by Fresnel. Materials WITH an envMap
//     keep their own.
//  6. HORIZON OCCLUSION (lights_fragment_maps). A perturbed normal can reflect a vector
//     that points INTO the geometric surface; that reflection sees the inside of the
//     object, not the sky. Faded by (1 + k R.Ng)^2 on every specular environment
//     sample, envMap or not — the fix for glowing speckle on normal-mapped rock.
import * as THREE from 'three';

// Live uniform storage. Float32Arrays, not Vector4s: UniformsUtils.clone keeps typed
// arrays BY REFERENCE (it only clones three's math objects and plain Arrays), so every
// material that clones these entries shares the same four numbers and one write per
// frame reaches all of them. water.js uses the same trick for its fog uniforms.
const SURF_U = new Float32Array([0, 0, 0, 0]);   // x wrap, y env gain, z horizon k, w wet film gain
const SURF2_U = new Float32Array([0, 0, 0, 0]);  // x rim gain, y rim fwd power, z wet roughness, w thin transmission
const PATH_U = new Float32Array([0, 0, 0, 0]);   // rgb per-unit extinction on the light leg

export const SURF = {
  wrap: 0, env: 0, horizon: 0, wet: 0, rim: 0, rimPow: 4, wetRough: 0.32,
  path: [0, 0, 0],
  patched: false
};

// Called by lighting.js every frame (plain number writes into the shared arrays).
export function setSurface(o) {
  SURF_U[0] = o.wrap; SURF_U[1] = o.env; SURF_U[2] = o.horizon; SURF_U[3] = o.wet;
  SURF2_U[0] = o.rim; SURF2_U[1] = o.rimPow; SURF2_U[2] = o.wetRough; SURF2_U[3] = o.trans;
}
export function setPath(r, g, b) { PATH_U[0] = r; PATH_U[1] = g; PATH_U[2] = b; }
export function surfaceState() {
  return { wrap: SURF_U[0], env: SURF_U[1], horizon: SURF_U[2], wet: SURF_U[3], rim: SURF2_U[0], rimPow: SURF2_U[1], wetRough: SURF2_U[2], trans: SURF2_U[3], path: [PATH_U[0], PATH_U[1], PATH_U[2]], patched: SURF.patched };
}

(function patchSurface() {
  // ?nosurf = the unpatched chunks, for a paired GPU A/B across two loads (the uniforms
  // alone cannot measure it: at zero they skip the branches but keep the ALU).
  if (typeof location !== 'undefined' && location.search.includes('nosurf')) return;
  const C = THREE.ShaderChunk;
  const fail = (what) => { console.warn('surface.js: chunk text changed, skipped ' + what); };

  // --- uniforms onto every lit table ------------------------------------------------
  const add = (u) => {
    u.abyssaSurf = { value: SURF_U };
    u.abyssaSurf2 = { value: SURF2_U };
    u.abyssaPath = { value: PATH_U };
  };
  add(THREE.UniformsLib.lights);
  for (const k in THREE.ShaderLib) {
    const u = THREE.ShaderLib[k] && THREE.ShaderLib[k].uniforms;
    if (u && u.pointLights) add(u);
  }

  let ok = 0;

  // --- 1. the light leg's extinction ---------------------------------------------------
  {
    const s = C.lights_pars_begin;
    const a = 'light.color *= getDistanceAttenuation( lightDistance, pointLight.distance, pointLight.decay );';
    if (s.includes(a)) {
      C.lights_pars_begin = 'uniform vec4 abyssaPath;\n' + s.replace(a, a + '\n\t\tlight.color *= exp( - abyssaPath.rgb * lightDistance );');
      ok++;
    } else fail('path extinction');
  }

  // --- 2-4. the direct term -----------------------------------------------------------
  {
    const s = C.lights_physical_pars_fragment;
    const a = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution );\n}';
    if (s.includes(a) && s.includes('void RE_Direct_Physical(')) {
      const add = /* glsl */`{
		// ABYSSA SURFACE: wrap, backscatter rim, wet film (lib/surface.js)
		float abW = abyssaSurf.x;
		float abNL = dot( geometryNormal, directLight.direction );
		// only the share the wrap adds over Lambert: w (1 - N.L) / (1 + w) on the lit side,
		// fading to 0 at N.L = -w. Zero on a face that looks straight at the light, so lit
		// faces keep their value and only the terminator opens.
		float abWrap = max( ( abNL + abW ) / ( 1.0 + abW ), 0.0 ) - max( abNL, 0.0 );
		vec3 abDiff = directLight.color * abWrap;
		// backscatter rim: light beyond the silhouette, scattered forward toward the eye
		float abNV = saturate( dot( geometryNormal, geometryViewDir ) );
		float abFwd = saturate( dot( directLight.direction, - geometryViewDir ) );
		float abEdge = 1.0 - abNV;
		abEdge *= abEdge; abEdge *= abEdge;
		abDiff += directLight.color * ( abyssaSurf2.x * abEdge * pow( abFwd, abyssaSurf2.y ) );
		reflectedLight.directDiffuse += abDiff * BRDF_Lambert( material.diffuseContribution );
		// thin-sheet transmission: a DOUBLE_SIDED surface lit from its far side passes some
		// of that light through, deepened in its own colour (albedo squared) and biased
		// forward toward the eye. DOUBLE_SIDED is already a program define, so this adds
		// no variant; leaves, fins, sails and nets are exactly the double-sided things.
		#ifdef DOUBLE_SIDED
		if ( abyssaSurf2.w > 0.0 && abNL < 0.0 ) {
			float abT = ( - abNL ) * ( 0.35 + 0.65 * abFwd * abFwd );
			vec3 abAlb = material.diffuseContribution;
			reflectedLight.directDiffuse += directLight.color * ( abyssaSurf2.w * abT ) * BRDF_Lambert( min( abAlb * abAlb * 3.0, vec3( 1.0 ) ) );
		}
		#endif
		// wet film: tight lobe on rough dielectrics only
		if ( abyssaSurf.w > 0.0 && abNL > 0.0 ) {
			float abWk = abyssaSurf.w * smoothstep( 0.45, 0.85, material.roughness ) * ( 1.0 - material.metalness );
			vec3 abH = normalize( directLight.direction + geometryViewDir );
			float abNH = saturate( dot( geometryNormal, abH ) );
			float abA = abyssaSurf2.z * abyssaSurf2.z;
			// NO Schlick ramp: a film of water on a surface IN water has almost no index step,
			// so the grazing boost that makes dry-in-air sheen is physically absent here (and
			// with it, the sun's grazing glare turned sand into ice). A flat 0.04.
			float abF = 0.04;
			// D_GGX times a cheap Kelemen visibility, 0.25 / (L.H)^2
			float abLH = max( dot( directLight.direction, abH ), 0.05 );
			reflectedLight.directSpecular += directLight.color * saturate( abNL ) * abWk * abF * D_GGX( abA, abNH ) * ( 0.25 / ( abLH * abLH ) );
		}
	}
}`;
      C.lights_physical_pars_fragment = 'uniform vec4 abyssaSurf;\nuniform vec4 abyssaSurf2;\n' +
        s.replace(a, 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution );\n\t' + add);
      ok++;
    } else fail('direct term');
  }

  // --- 5-6. medium environment + horizon occlusion ------------------------------------
  // Appended to lights_fragment_maps, which runs after the envMap sample and before
  // lights_fragment_end hands `radiance` to RE_IndirectSpecular. Guarded to programs
  // that have an indirect-specular path (STANDARD / PHYSICAL); abyssaSurf is declared
  // by lights_physical_pars_fragment, which those programs always include.
  {
    C.lights_fragment_maps = C.lights_fragment_maps + /* glsl */`
#if defined( RE_IndirectSpecular ) && defined( STANDARD )
	{
		vec3 abR = reflect( - geometryViewDir, geometryNormal );
		float abHo = saturate( 1.0 + abyssaSurf.z * dot( abR, nonPerturbedNormal ) );
		abHo *= abHo;
		#ifdef USE_ENVMAP
			radiance *= mix( 1.0, abHo, step( 0.0001, abyssaSurf.z ) );
		#elif NUM_HEMI_LIGHTS > 0
			if ( abyssaSurf.y > 0.0 ) {
				HemisphereLight abHl = hemisphereLights[ 0 ];
				float abUp = dot( abR, abHl.direction );
				vec3 abEnv = mix( abHl.groundColor, abHl.skyColor, smoothstep( -0.55, 0.85, abUp ) );
				vec3 abMean = 0.5 * ( abHl.groundColor + abHl.skyColor );
				abEnv = mix( abEnv, abMean, material.roughness * material.roughness );
				radiance += abEnv * ( abyssaSurf.y * RECIPROCAL_PI * mix( 1.0, abHo, step( 0.0001, abyssaSurf.z ) ) );
			}
		#endif
	}
#endif`;
    ok++;
  }
  SURF.patched = ok === 3;
})();
