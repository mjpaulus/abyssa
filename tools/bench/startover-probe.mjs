// START OVER probe (roadmap/start-over-saved-harpoon.md; Michael 2026-10-26: "1 start over on the title screen").
// The title offers a quiet START OVER only when a save exists; one click ARMS it (the text becomes the confirm), a second one
// within ~4 s wipes `abyssa.chart.v1` and reloads. REAL mouse and key events over tools/bench/drv.mjs, a fresh private profile,
// the console captured from byte one (the page is navigated from about:blank after the domains are on).
//   DRV_PORT=9540 node tools/bench/startover-probe.mjs <port>      (serve.py must already serve <port>; SO_SHOTS=<dir> saves PNGs)
// It walks: a FRESH load (empty storage): no START OVER, and no save written by the title alone -> open, close (pagehide writes the
// default save), reopen: still no START OVER, and each progress field set on that save shows it -> a load with a SAVED HARPOON
// (pulled [1,0,0,0], tools.harpoon: shaped as saveChart() writes it): START OVER shown -> one click arms it and the game does NOT
// start -> a key disarms it -> the 4 s timeout disarms it -> a double click (two clicks 80 ms apart) does not confirm -> two clicks
// clear the save and reload -> after the reload: the key is gone (pagehide's saveChart must not write it back), no START OVER,
// Sal has no harpoon (state and drawn iron), a click on the title still starts the game, Alt+6 at home finds the iron in her crest
// with '[E] PULL THE HARPOON' (not '[E] PRESS THE OLD WOUND') -> the console is clean but the favicon 404.
// EXIT: 0 PASS / 1 FAIL (a check failed) / 2 UNMEASURED (the page never booted to the title, or the probe itself threw).
// RED (on 94de095, which has no START OVER): exit 1 at 'START OVER is shown with a save'; GREEN on the build that adds it.
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const [, , PORT = '8886'] = process.argv;
if (!process.env.DRV_PORT) process.env.DRV_PORT = '9540';
process.env.DRV_DIR = mkdtempSync(join(tmpdir(), 'abyssa-startover-'));   // a fresh profile: no save, no caches
const { start, stop, connect, sleep } = await import('./drv.mjs');
process.on('exit', () => { stop(); try { rmSync(process.env.DRV_DIR, { recursive: true, force: true }); } catch (e) { } });
const SHOTS = process.env.SO_SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const KEY = 'abyssa.chart.v1', IDLE = 'START OVER', ARMED_RE = /^START OVER\? .+ CLICK AGAIN$/;
const SAVE = {
  site: 0, rec: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]], found: [1, 1, 1, 0], keeps: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]],
  pulled: [1, 0, 0, 0], sighted: [1, 0, 0, 0], endingSeen: false, hose: 380, mute: false,
  tools: { sonar: false, spear: false, thruster: false, harpoon: true }
};
const fails = [];
const show = v => typeof v === 'string' ? v : JSON.stringify(v);
const check = (name, ok, v) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (v === undefined ? '' : ' -> ' + show(v))); if (!ok) fails.push(name); };
const READY = `!document.getElementById('load') && typeof window.setState === 'function' && !!window.__chart && !!window.__bench`;
const SO = `document.querySelector('#title .startover')`;
const SEE = `(() => { const e = ${SO}, base = { titleInner: document.getElementById('title').innerText, state: window.gameState,
    titleHidden: document.getElementById('title').classList.contains('hidden'), save: localStorage.getItem('${KEY}'), mark: window.__soMark === 1 };
  if (!e) return { ...base, exists: false, shown: false, text: null };
  const cs = getComputedStyle(e), r = e.getBoundingClientRect();
  return { ...base, exists: true, shown: !e.hidden && cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0, text: e.textContent, inner: e.innerText,
    rect: [r.x + r.width / 2, r.y + r.height / 2], fs: cs.fontSize, ls: cs.letterSpacing, ff: cs.fontFamily, op: cs.opacity }; })()`;

async function main() {
  await start('about:blank');
  const c = await connect();
  await c.send('Runtime.enable'); await c.send('Log.enable'); await c.send('Page.enable');
  const URL0 = `http://localhost:${PORT}/?bench&playtest`;
  const load = async () => { await c.send('Page.navigate', { url: URL0 }); await c.until(`window.__soMark === undefined && ${READY}`, 240000, 500); };
  const loadWith = async save => {
    const id = (await c.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('${KEY}', ${JSON.stringify(typeof save === 'string' ? save : JSON.stringify(save))}); } catch (e) { }` })).result.identifier;
    await load();
    await c.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: id });   // a reload must not seed it back
  };
  try {
    // ---- 1. a FRESH load: empty storage ----
    await load(); await sleep(3000);
    let s = await c.ev(SEE);
    check('fresh load: the title is up, no save in storage', s.state === 'title' && s.save === null, [s.state, s.save]);
    check('fresh load: no START OVER is shown', !s.shown && !/START OVER/i.test(s.titleInner), s.titleInner);
    if (SHOTS) await c.png(join(SHOTS, 'title-fresh.png'));

    // ---- 1b. open, close, reopen: closing writes the DEFAULT save (pagehide's saveChart); that is not progress ----
    await c.send('Page.navigate', { url: 'about:blank' }); await sleep(800);
    await load(); await sleep(1500);
    s = await c.ev(SEE);
    check('a fresh session closed (pagehide) left its default save behind', s.save !== null, s.save === null ? null : 'a save of ' + s.save.length + ' chars');
    check('reopened over that default save: START OVER stays hidden', !s.shown && !/START OVER/i.test(s.titleInner), [s.shown, s.titleInner.includes('START OVER')]);
    let def = null; try { def = JSON.parse(s.save); } catch (e) { }
    check('the default save parses (the variants below are made from it)', !!def && typeof def === 'object', def && Object.keys(def));
    // each field that is progress, set on the save a fresh boot wrote: START OVER shows. Nothing is hard-coded but the one change.
    if (def) {
      const mut = f => { const d = JSON.parse(s.save); f(d); return d; };
      const VARIANTS = {
        'a pulled flag': d => { d.pulled[0] = 1; }, 'a sighting': d => { d.sighted[1] = 1; }, 'a chart record': d => { d.rec[2][1] = 1; },
        'the hidden shelf found': d => { d.found[3] = 1; }, 'a keepsake': d => { d.keeps[1][0] = 1; }, 'a site other than the start': d => { d.site = 1; },
        'a tool owned (sonar)': d => { d.tools.sonar = true; }, 'the harpoon': d => { d.tools.harpoon = true; },
        'a longer hose': d => { d.hose = d.hose + 40; }, 'the ending seen': d => { d.endingSeen = true; }
      };
      for (const [name, f] of Object.entries(VARIANTS)) {
        await loadWith(mut(f)); await sleep(800);
        const v = await c.ev(SEE);
        check('progress shows START OVER: ' + name, v.shown && v.text === IDLE, [v.shown, v.text]);
      }
    }

    // ---- 2. a load with a SAVED HARPOON (seeded before the page's first script, on this one navigation only) ----
    await loadWith(SAVE);
    await sleep(3000);
    const pre = await c.ev(`({ site: __chart.site(), pulled: __chart.pulled(), harpoon: !!survival.hasHarpoon, wound: !!(lev && lev.harpoon && lev.harpoon.wound) })`);
    console.log('  the save, read: ' + show(pre));
    check('the saved harpoon was read (site 0, pulled[0], the iron owned, her harpoon the old wound)', pre.site === 0 && pre.pulled[0] === 1 && pre.harpoon && pre.wound, pre);
    s = await c.ev(SEE);
    console.log('  START OVER: ' + show({ text: s.text, fs: s.fs, ls: s.ls, op: s.op, ff: s.ff }));
    check('START OVER is shown with a save', s.exists && s.shown && s.text === IDLE && /START OVER/.test(s.titleInner), [s.exists, s.shown, s.text]);
    if (!s.shown) throw Object.assign(new Error('no START OVER to drive'), { red: true });
    if (SHOTS) await c.png(join(SHOTS, 'title-startover.png'));
    await c.ev(`(window.__soMark = 1, 1)`);   // cleared by a reload

    // one click ARMS it; the title's own click-to-start must not run
    await c.click(...s.rect); await sleep(500);
    s = await c.ev(SEE);
    check('one click arms it: the confirm copy', ARMED_RE.test(s.text), s.text);
    check('one click does NOT start the game (still the title, not hidden)', s.state === 'title' && !s.titleHidden, [s.state, s.titleHidden]);
    check('one click clears nothing', s.save !== null && s.mark, [s.save !== null, s.mark]);
    if (SHOTS) await c.png(join(SHOTS, 'title-startover-armed.png'));

    // anything else disarms it: a key
    await c.tap('KeyW', 60); await sleep(300);
    s = await c.ev(SEE);
    check('a key disarms it', s.text === IDLE && s.state === 'title' && s.save !== null, [s.text, s.state]);

    // the timeout disarms it
    await c.click(...s.rect); await sleep(400);
    s = await c.ev(SEE);
    check('armed again', ARMED_RE.test(s.text), s.text);
    await sleep(4600);
    s = await c.ev(SEE);
    check('the ~4 s timeout disarms it', s.text === IDLE && s.state === 'title' && s.save !== null && s.mark, [s.text, s.state]);

    // a double click is not a confirm
    await c.click(...s.rect); await sleep(80); await c.click(...s.rect); await sleep(700);
    s = await c.ev(SEE);
    check('a double click (80 ms apart) arms it and does not confirm', ARMED_RE.test(s.text) && s.save !== null && s.mark && s.state === 'title', [s.text, s.save !== null, s.mark]);

    // two clicks: clear the save and reload (it is still armed from the double click; a deliberate second click confirms)
    await c.click(...s.rect);
    await c.until(`window.__soMark === undefined && ${READY}`, 240000, 500);
    await sleep(3000);
    s = await c.ev(SEE);
    check('confirmed: the page reloaded and the save is gone', s.save === null && s.state === 'title', [s.save, s.state]);
    check('after the reload START OVER is gone (pagehide did not write the save back)', !s.shown && !/START OVER/i.test(s.titleInner), s.titleInner);
    const post = await c.ev(`({ harpoon: !!survival.hasHarpoon, pulled: __chart.pulled(), wound: !!(lev && lev.harpoon && lev.harpoon.wound) })`);
    check('after the reload Sal owns no harpoon and none is pulled', !post.harpoon && post.pulled.every(v => !v) && !post.wound, post);

    // a click on the title still starts the dive; Sal carries no iron on the raft
    await c.click(300, 200);
    await c.until(`window.gameState === 'play'`, 20000, 200);
    await c.ev(`(window.__helm = true, __bench.step(40), 1)`);
    const raft = await c.ev(`({ owns: !!survival.hasHarpoon, drawn: !!(diver.harpoon && diver.harpoon.visible), onDeck: !!player.onDeck })`);
    check('on the raft Sal has no harpoon in his hand (state and drawn iron)', !raft.owns && !raft.drawn && raft.onDeck, raft);

    // home (Alt+6): the iron is in her crest, the prompt is the pull
    await c.key('Digit6', true, 1); await sleep(80); await c.key('Digit6', false, 1);
    await sleep(2000);
    const h = await c.ev(`(() => { const L = window.lev, H = L && L.harpoon, e = document.getElementById('craft');
      return { prompt: L && L.rite ? L.rite.prompt(player.pos) : null, hud: e.textContent, op: e.style.opacity, wound: !!(H && H.wound), pulled: !!(H && H.pulled), kind: L && L.kind, dormant: !!(L && L.dormant), buried: !!(L && L.buried), last: window.__playtest ? window.__playtest.last() : null }; })()`);
    console.log('  Alt+6: ' + show(h));
    check('Alt+6 jumped to VELKATH, asleep and buried', /VELKATH/.test(h.last || '') && h.kind === 'brooder' && h.dormant && h.buried, [h.last, h.kind, h.dormant, h.buried]);
    check("the iron is in her crest: the prompt is '[E] PULL THE HARPOON', not the old wound", h.prompt === '[E] PULL THE HARPOON' && !h.wound && !h.pulled, [h.prompt, h.wound, h.pulled]);
    check('the HUD shows it', h.hud === '[E] PULL THE HARPOON' && h.op === '1', [h.hud, h.op]);

    // the console: clean but the favicon 404
    await sleep(300);
    const bad = [];
    for (const e of c.events) {
      if (e.method === 'Runtime.exceptionThrown') bad.push('EXC ' + (e.params.exceptionDetails.exception && e.params.exceptionDetails.exception.description || e.params.exceptionDetails.text));
      else if (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') bad.push('console.error ' + e.params.args.map(a => a.value ?? a.description).join(' '));
      else if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error' && !(/\/favicon\.ico$/.test(e.params.entry.url || '') && /404/.test(e.params.entry.text))) bad.push('log ' + e.params.entry.text + ' ' + (e.params.entry.url || ''));
    }
    check('console: no error but the favicon 404', bad.length === 0, bad.slice(0, 5));
  } catch (e) {
    if (e.red) { console.log('STARTOVER FAIL: ' + fails.join('; ')); c.close(); process.exit(1); }
    throw e;
  }
  c.close();
  console.log(fails.length ? 'STARTOVER FAIL: ' + fails.join('; ') : 'STARTOVER PASS');
  process.exit(fails.length ? 1 : 0);
}
main().catch(e => { console.error('STARTOVER UNMEASURED: ' + (e && e.message || e)); process.exit(2); });
