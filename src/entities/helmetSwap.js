// The helmet mount point. OWNED BY: orchestrator.
//
// THIS MODULE NO LONGER LOADS ANYTHING. It used to HEAD-probe an authored Mark V glTF
// (BeaVex's CC-BY Sketchfab model) and mount it over the procedural bonnet if the user
// had downloaded it. The all-generated hard rule (CLAUDE.md, 2026-08-07) retired that
// plan: the helmet is spun in code now, in diver.js, like everything else. The dead
// fetch is gone with it, and so is the `helmet.glb 404` that every session's console
// opened with.
//
// The module stays because `diver.helmGroup` is still the mount point, and because
// `window.__helm` is a documented debug surface. Anything that wants to hang a
// different bonnet on the neck joint — a damaged variant, a dress-station spare —
// mounts it here, on `diver.helmGroup.parent`, and the helmet-lag spring and every
// animation keep working untouched.
import { diver } from './diver.js';

window.__helm = {
  get group() { return diver.helmGroup; },
  // show/hide the generated bonnet (the dressing station's empty helmet stand beat)
  procedural(on = true) { diver.helmGroup.visible = on; },
  // mount an alternate bonnet on the same neck joint; returns it for further tweaking
  mount(obj) {
    diver.helmGroup.visible = false;
    diver.helmGroup.parent.add(obj);
    return obj;
  }
};
