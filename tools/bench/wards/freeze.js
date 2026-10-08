// Install window.__freezeWhen(src): a rAF watcher that, on the first frame the expression is
// true, drops the frame governor to 0.01 fps (the canvas keeps that frame) so a slow CDP
// screenshot catches a short beat exactly. __thaw() restores 60.
window.__frozen = false;
window.__freezeWhen = src => {
  const f = new Function('return (' + src + ')');
  window.__frozen = false;
  const tick = () => { let ok = false; try { ok = !!f(); } catch (e) { /* */ } if (ok) { window.__power.set(0.01); window.__frozen = true; } else requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  return true;
};
window.__thaw = () => { window.__power.set(60, 60); window.__bench.step(0); window.__frozen = false; return true; };   // step(0): hold+release resets the governor's frameDue
return 'ok';
