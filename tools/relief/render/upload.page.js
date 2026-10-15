// In-page: store a Float32 grid (base64) as window.__G[ARGS.key]
const bin = atob(ARGS.b64), u8 = new Uint8Array(bin.length);
for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
window.__G = window.__G || {};
window.__G[ARGS.key] = new Float32Array(u8.buffer);
return { key: ARGS.key, n: window.__G[ARGS.key].length, keys: Object.keys(window.__G) };
