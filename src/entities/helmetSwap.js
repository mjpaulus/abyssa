// Optional authored Mark V helmet. OWNED BY: orchestrator.
//
// If assets/models/markv_helmet/helmet.glb exists (BeaVex's CC-BY 1916 U.S. Navy
// Mark V from Sketchfab — see assets/models/CREDITS.md), it replaces the procedural
// bonnet: diver.helmGroup is hidden and the glTF is mounted on the same neck joint,
// so the helmet-lag spring and every animation keep working. If the file is absent
// the fetch 404s and the procedural helmet quietly stays — the game never breaks on
// a missing optional asset.
//
// Alignment: the procedural bonnet spans y 0..0.95 with radius ~0.45 on the neck
// joint. TUNE holds the transform that maps the authored model into that envelope;
// window.__helm exposes live adjusters so the fit can be dialed in-game, then baked
// back into TUNE.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { diver } from './diver.js';
import { envTex } from '../core.js';

const URL_GLB = 'assets/models/markv_helmet/helmet.glb';

const TUNE = { scale: 1.0, y: 0.0, z: 0.0, rotY: 0.0 };

const draco = new DRACOLoader().setDecoderPath('https://unpkg.com/three@0.160.0/examples/jsm/libs/draco/');
const loader = new GLTFLoader().setDRACOLoader(draco);

fetch(URL_GLB, { method: 'HEAD' }).then(r => {
  if (!r.ok) return;   // no authored helmet shipped; procedural stays
  loader.load(URL_GLB, gltf => {
    const m = gltf.scene;

    // Normalize: center in x/z, rest the rim at y=0, scale to the procedural
    // bonnet's height so TUNE starts from a sane fit.
    const box = new THREE.Box3().setFromObject(m);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const s = (0.95 / Math.max(size.y, 1e-4)) * TUNE.scale;
    m.scale.setScalar(s);
    m.position.set(-center.x * s + 0, -box.min.y * s + TUNE.y, -center.z * s + TUNE.z);
    m.rotation.y = TUNE.rotY;

    m.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        if (o.material) {
          o.material.envMap = envTex;
          o.material.envMapIntensity = 0.9;
          o.material.needsUpdate = true;
        }
      }
    });

    diver.helmGroup.visible = false;
    diver.helmGroup.parent.add(m);

    // live fit adjusters — dial in, then bake the numbers into TUNE
    window.__helm = {
      m,
      scale(k) { m.scale.setScalar(s * k); },
      y(v) { m.position.y = -new THREE.Box3().setFromObject(m).min.y + v; },
      rot(v) { m.rotation.y = v; },
      procedural(on) { diver.helmGroup.visible = on; m.visible = !on; }
    };
    console.info('ABYSSA: authored Mark V helmet mounted (window.__helm to adjust fit)');
  }, undefined, e => console.warn('helmet glb failed to load:', e));
}).catch(() => {});
