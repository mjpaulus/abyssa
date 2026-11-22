// Bakes the seabed's detail maps off the main thread (lib/terrainMaps.js; lib/triplanar.js posts here).
import { bakeTerrainMaps } from './terrainMaps.js';
self.onmessage = (e) => {
  const m = bakeTerrainMaps(e.data && e.data.size);
  self.postMessage(m, [m.albedo.buffer, m.rough.buffer, m.nSilt.buffer, m.nSed.buffer, m.nRock.buffer]);
};
