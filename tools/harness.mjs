#!/usr/bin/env node
// SolScape — browser harness: measures the built site (dist/) in headless Chrome over CDP.
// Dev-only: not built, not deployed. Serves dist/ from memory on 127.0.0.1; Google Analytics /
// Tag Manager are blocked so test runs never send pageviews (Unsplash photos are blocked too:
// they are CSS backgrounds, so layout is unaffected). Google Fonts load, because type sets the layout.
//
//   node tools/harness.mjs                     all 11 pages, all widths; exit 1 on any problem
//   node tools/harness.mjs --pages /,/about --widths 375,1280
//   node tools/harness.mjs --dist <dir>        measure another build (e.g. a scratch copy)
//   node tools/harness.mjs --negative          self-test: one injected fault per check, on scratch copies
//
// Modes: "window" = desktop emulation with a classic scrollbar (layout width = window − scrollbar),
// "phone" = mobile emulation with touch, overlay scrollbar (layout width = window), widths ≤ 430 only.
// A check that cannot observe reports "not measured", never a pass. Requires Chrome (CHROME=path to override).
// HARNESS_DEBUG=1 prints step timings to stderr.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EXPECTED_PAGES, readBuild, tags, attr } from './audit.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── Fixed expectations ──────────────────────────────────────────────────────
export const WIDTHS = [320, 360, 375, 390, 414, 430, 600, 768, 769, 1024, 1280, 1440, 1920];
const PHONE_MAX = 430;
const MARGIN = 24;            // px: the site's own phone gutter; text must not sit closer to the screen edge
const TARGET = 44;            // px: touch-target box, probed by hit-testing (so ::before extensions count)
const MOTION_MS = 6500;       // observation window under reduced motion (the carousel ticks at 5.5s)
const GRIDS = ['.categories-grid', '.retreat-cards', '.other-retreat-cards', '.offerings-grid', '.sus-grid', '.values-grid',
  '.team-grid', '.hosts-grid', '.property-gallery', '.includes-grid', '.pillars-grid', '.retreat-gallery', '.inc-exc-grid'];
// [label, selector, exempt with a fine pointer (dense footer/menu lists, Guide §6)]
const CONTROLS = [
  ['bar link', '.nav-item > a', false], ['bar logo', 'nav .logo', false], ['Book Now (bar)', '.nav-cta', false],
  ['Instagram (bar)', '.nav-insta', false], ['menu button', '.hamburger', false], ['menu sheet link', '.mobile-menu a', false],
  ['button', '.btn', false], ['card link', '.card-link', false], ['carousel dot', '.carousel-dot', false],
  ['View Room', '.view-room-btn', false], ['founder Instagram', '.team-card-body a', false],
  ['footer link', '.footer-col ul a', true], ['footer icon', '.footer-social a', false], ['dropdown link', '.dropdown a', true],
];
// Every page target the site navigation offers; each must be reachable from the header/footer without JS.
const NAV_TARGETS = ['/', '/#retreats', '/retreats/winter-wonderland', '/retreats/egypt-nile', '/retreats/morocco',
  '/retreats/provence', '/retreats/geneva', '/retreats/exotic', '/experience', '/about', '/contact'];
const BLOCK = ['*googletagmanager.com*', '*google-analytics.com*', '*analytics.google.com*', '*doubleclick.net*', '*images.unsplash.com*'];
const CHECKS = {
  overflow: 'no sideways scroll (clip lifted)', margins: 'content-column margins', lone: 'no lone card on a last row',
  targets: `${TARGET}px targets on named controls`, anchors: 'anchor targets clear of the fixed bar',
  motion: 'still under reduced motion', nojs: 'navigation reachable without JS',
};

// ── Server and Chrome ───────────────────────────────────────────────────────
const TYPES = { html: 'text/html; charset=utf-8', css: 'text/css', js: 'text/javascript', json: 'application/json', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', svg: 'image/svg+xml', xml: 'application/xml', txt: 'text/plain', pdf: 'application/pdf', ico: 'image/x-icon' };
export function serve(dist) {
  return new Promise((res) => {
    const s = http.createServer((req, rsp) => {
      const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let f = path.join(dist, u);
      if (u.endsWith('/')) f = path.join(f, 'index.html'); else if (!path.extname(u)) f += '.html';
      if (!f.startsWith(dist) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
        const nf = path.join(dist, '404.html'); rsp.writeHead(404, { 'content-type': TYPES.html });
        return rsp.end(fs.existsSync(nf) ? fs.readFileSync(nf) : 'not found');
      }
      rsp.writeHead(200, { 'content-type': TYPES[path.extname(f).slice(1).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
      fs.createReadStream(f).pipe(rsp);
    });
    s.listen(0, '127.0.0.1', () => res(s));
  });
}
const CHROME_PATHS = [process.env.CHROME, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean);
const T0 = Date.now(); const dbg = process.env.HARNESS_DEBUG ? (m) => process.stderr.write(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${m}
`) : () => { };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class CDP {
  constructor(ws) {
    this.ws = ws; this.n = 0; this.pending = new Map(); this.waiters = [];
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id) { const p = this.pending.get(m.id); if (!p) return; this.pending.delete(m.id); m.error ? p.reject(new Error(`${p.method}: ${m.error.message}`)) : p.resolve(m.result); }
      else for (const w of [...this.waiters]) if (w.method === m.method) { this.waiters.splice(this.waiters.indexOf(w), 1); clearTimeout(w.t); w.resolve(m.params); }
    };
  }
  send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++this.n; this.pending.set(id, { resolve, reject, method }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  wait(method, ms = 30000) {
    return new Promise((resolve, reject) => {
      const w = { method, resolve }; w.t = setTimeout(() => { this.waiters.splice(this.waiters.indexOf(w), 1); reject(new Error(`timeout waiting for ${method}`)); }, ms);
      this.waiters.push(w);
    });
  }
  async ev(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`in page: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result.value;
  }
}
export async function launch() {
  const exe = CHROME_PATHS.find((p) => fs.existsSync(p)); if (!exe) throw new Error('Chrome not found; set CHROME=<path>');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'solscape-cdp-'));
  const proc = spawn(exe, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--disable-sync', '--mute-audio', 'about:blank'], { stdio: 'ignore' });
  const portFile = path.join(profile, 'DevToolsActivePort'); let port;
  for (let i = 0; i < 100 && !port; i++) { await sleep(100); if (fs.existsSync(portFile)) port = fs.readFileSync(portFile, 'utf8').split('\n')[0].trim(); }
  if (!port) { proc.kill(); throw new Error('Chrome did not start'); }
  let target;
  for (let i = 0; i < 50 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'); } catch { } if (!target) await sleep(100); }
  const version = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).Browser;
  const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const cdp = new CDP(ws);
  await cdp.send('Page.enable'); await cdp.send('Network.enable');
  await cdp.send('Network.setBlockedURLs', { urls: BLOCK }); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  return {
    cdp, version,
    async close() {   // wait for Chrome to exit (Windows keeps its profile locked until then), then remove the temp profile
      try { ws.close(); } catch { }
      const exited = proc.exitCode !== null ? Promise.resolve() : new Promise((r) => proc.once('exit', r));
      proc.kill(); await Promise.race([exited, sleep(5000)]);
      for (let i = 0; i < 15; i++) { try { fs.rmSync(profile, { recursive: true, force: true }); break; } catch { await sleep(200); } }
    },
  };
}
export async function emulate(c, mode, width) {
  const phone = mode === 'phone';
  await c.send('Emulation.setDeviceMetricsOverride', { width, height: phone ? 812 : 900, deviceScaleFactor: 1, mobile: phone });
  await c.send('Emulation.setTouchEmulationEnabled', { enabled: phone, maxTouchPoints: phone ? 5 : 1 });
  // With page scripts disabled, rAF/setTimeout callbacks never run, so wait on the Node side instead.
  if (c.noScript) await sleep(150); else await c.ev('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
}
export async function go(c, url) {
  // A stalled third-party request (e.g. a font) can hold back the load event; after 30s stop loading and retry once.
  for (let attempt = 1; ; attempt++) {
    const loaded = c.wait('Page.loadEventFired', 30000);
    await c.send('Page.navigate', { url });
    try { await loaded; break; } catch (e) {
      await c.send('Page.stopLoading');
      if (attempt >= 2) throw new Error(`${url}: ${e.message} (twice)`);
      process.stderr.write(`  slow load, retrying: ${url}\n`);
    }
  }
  // Receipt: every web-font face the page requested has finished loading (faces it doesn't use stay "unloaded").
  const fontsOk = `(() => { const f = [...document.fonts]; return document.fonts.status === 'loaded' && f.some((x) => x.status === 'loaded') && !f.some((x) => x.status === 'loading' || x.status === 'error'); })()`;
  if (c.noScript) { for (let i = 0; i < 40 && !(await c.ev(fontsOk)); i++) await sleep(100); await sleep(150); return c.ev(fontsOk); }
  return c.ev(`Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 8000))]).then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
    .then(() => ${fontsOk})`);
}
export async function scripts(c, on) { await c.send('Emulation.setScriptExecutionDisabled', { value: !on }); c.noScript = !on; }

// ── In-page measurement code (runs in Chrome; helpers come from PRELUDE) ─────
const PRELUDE = `
const desc = (el) => { if (!el || !el.tagName) return String(el); let s = el.tagName.toLowerCase(); if (el.id) s += '#' + el.id;
  const cn = typeof el.className === 'string' ? el.className : (el.className && el.className.baseVal) || '';
  const c = cn.trim().split(/\\s+/).filter(Boolean)[0]; if (c) s += '.' + c; return s; };
const inChrome = (el) => !!(el.closest && el.closest('header, nav, .mobile-menu, footer, .lightbox'));
const shown = (el) => { const r = el.getBoundingClientRect(); if (!r.width || !r.height) return false; const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none'; };
const clipBy = (start, r) => { let L = r.left, R = r.right, T = r.top, B = r.bottom;
  for (let a = start; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
    const cs = getComputedStyle(a);
    if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') { const ar = a.getBoundingClientRect(); L = Math.max(L, ar.left); R = Math.min(R, ar.right); T = Math.max(T, ar.top); B = Math.min(B, ar.bottom); } }
  return { L, R, T, B, empty: R - L < 1 || B - T < 1 }; };`;
const inPage = (fn, arg) => `(() => { ${PRELUDE}\n return (${fn.toString()})(${JSON.stringify(arg)}); })()`;

function pLayout(cfg) {
  const de = document.documentElement, body = document.body;
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  const vw = de.clientWidth; const out = { vw, overflow: 0, offenders: [], margins: [], grids: [] };
  // overflow, with the site's own clip on html/body lifted
  const s0 = de.style.overflowX, s1 = body.style.overflowX;
  de.style.overflowX = 'visible'; body.style.overflowX = 'visible';
  const sw = de.scrollWidth;
  if (sw > vw) {
    out.overflow = sw - vw; const seen = new Map();
    for (const el of body.querySelectorAll('*')) {
      const r = el.getBoundingClientRect(); if (!r.width || r.right <= vw + 0.5) continue;
      const p = el.parentElement; if (p && p !== body && p.getBoundingClientRect().right > vw + 0.5) continue;
      if (clipBy(el.parentElement, r).R <= vw + 0.5) continue;   // clipped by an ancestor (e.g. carousel slides): can't scroll the page
      const k = desc(el); const v = seen.get(k) || { n: 0, px: 0 }; v.n++; v.px = Math.max(v.px, Math.round(r.right - vw)); seen.set(k, v);
    }
    out.offenders = [...seen].map(([k, v]) => `${k}${v.n > 1 ? ' ×' + v.n : ''} +${v.px}px`);
  }
  de.style.overflowX = s0; body.style.overflowX = s1;
  if (de.getAttribute('style') === '') de.removeAttribute('style'); if (body.getAttribute('style') === '') body.removeAttribute('style');
  // margins: (a) painted text no closer than M to either screen edge; (b) nothing paints outside its .container
  const M = cfg.margin; const flagged = new Set();
  const note = (el, what, val) => { for (let a = el.parentElement; a; a = a.parentElement) if (flagged.has(a)) return; flagged.add(el); out.margins.push({ what: desc(el) + ' ' + what, val }); };
  for (const el of body.querySelectorAll('*')) {
    if (inChrome(el)) continue;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    let done = false;
    for (const n of el.childNodes) {
      if (done || n.nodeType !== 3 || !n.textContent.trim()) continue;
      const rg = document.createRange(); rg.selectNodeContents(n);
      for (const rr of rg.getClientRects()) {
        if (!rr.width || !rr.height) continue;
        const c = clipBy(el, rr); if (c.empty) continue;
        if (c.L < M - 0.5 || c.R > vw - M + 0.5) { note(el, `text closer than ${M}px to the screen edge`, `${Math.round(c.L)}–${Math.round(c.R)} of ${vw}`); done = true; break; }
      }
    }
    if (done) continue;
    const box = el.parentElement && el.parentElement.closest('.container');
    if (box) {
      const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
      const c = clipBy(el.parentElement, r); const br = box.getBoundingClientRect();
      if (!c.empty && (c.L < br.left - 0.5 || c.R > br.right + 0.5)) note(el, 'paints outside its .container', `${Math.round(Math.max(br.left - c.L, c.R - br.right))}px`);
    }
  }
  // grids: row distribution; a lone card = one item on the last row while another row holds more, not spanning the row
  for (const sel of cfg.grids) document.querySelectorAll(sel).forEach((g, gi) => {
    if (inChrome(g) || !shown(g)) return;
    const items = [...g.children].filter(shown); if (items.length < 2) return;
    const rows = [];
    for (const it of items) { const t = Math.round(it.getBoundingClientRect().top); const last = rows[rows.length - 1]; if (last && Math.abs(last.top - t) < 2) last.n++; else rows.push({ top: t, n: 1 }); }
    const lastIt = items[items.length - 1].getBoundingClientRect(); const gw = g.getBoundingClientRect().width;
    const lone = rows.length > 1 && rows[rows.length - 1].n === 1 && rows.some((r) => r.n > 1) && lastIt.width < gw * 0.9;
    out.grids.push({ grid: sel + (gi ? '#' + (gi + 1) : ''), pattern: rows.map((r) => r.n).join('+'), lone });
  });
  return out;
}

function pTargets(cfg) {
  const res = [];
  const menu = document.querySelector('.mobile-menu'), burger = document.querySelector('.hamburger');
  const openMenu = cfg.openMenu && burger && shown(burger);
  for (const [label, sel, exempt] of cfg.controls) {
    const isSheet = sel.startsWith('.mobile-menu');
    if (isSheet && openMenu && menu && !menu.classList.contains('open')) burger.click();
    const els = [...document.querySelectorAll(sel)];
    const vis = els.filter(shown);
    const r0 = { label, sel, total: els.length, measured: 0, fails: 0, minW: Infinity, minH: Infinity, sizes: {} };
    for (const el of vis) {
      el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      const r = el.getBoundingClientRect(); r0.measured++;
      const sz = `${Math.round(r.width)}×${Math.round(r.height)}`; r0.sizes[sz] = (r0.sizes[sz] || 0) + 1;
      r0.minW = Math.min(r0.minW, Math.round(r.width)); r0.minH = Math.min(r0.minH, Math.round(r.height));
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2, h = cfg.target / 2 - 1; let ok = true;   // 1px inset: elementFromPoint rounds to whole pixels
      for (const dx of [-h, 0, h]) for (const dy of [-h, 0, h]) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) { ok = false; continue; }
        const hit = document.elementFromPoint(x, y); if (!hit || (hit !== el && !el.contains(hit))) ok = false;
      }
      if (!ok) r0.fails++;
    }
    if (isSheet && openMenu && menu && menu.classList.contains('open')) burger.click();
    r0.exempt = exempt && cfg.fine; res.push(r0);
  }
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  return res;
}

async function pAnchors(ids) {
  const res = [];
  const frames = async () => {   // two frames, then until no CSS transition is running (the bar's padding eases over 0.3s)
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    for (let i = 0; i < 40 && document.getAnimations().some((a) => a instanceof CSSTransition && a.playState === 'running'); i++) await new Promise((r) => setTimeout(r, 50));
  };
  for (const id of ids) {
    const t = document.getElementById(id); if (!t) { res.push({ id, missing: true }); continue; }
    t.scrollIntoView({ block: 'start', behavior: 'instant' });
    await frames();   // let the site's scroll handlers (the bar shrinks after 60px) settle before measuring
    let bar = 0;
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el); if ((cs.position !== 'fixed' && cs.position !== 'sticky') || cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect(); if (r.top <= 1 && r.bottom > 0 && r.height < innerHeight * 0.5 && r.width > innerWidth * 0.5) bar = Math.max(bar, r.bottom);
    }
    let first = null, heading = null;
    const tw = document.createTreeWalker(t, NodeFilter.SHOW_TEXT);
    while (tw.nextNode()) {
      const n = tw.currentNode; if (!n.textContent.trim()) continue;
      const pe = n.parentElement; if (getComputedStyle(pe).visibility === 'hidden') continue;
      const rg = document.createRange(); rg.selectNodeContents(n); const rr = [...rg.getClientRects()].find((x) => x.width && x.height); if (!rr) continue;
      if (!first) first = { top: Math.round(rr.top), el: desc(pe), text: n.textContent.trim().slice(0, 30) };
      if (!heading && pe.closest('h1,h2,h3,h4,h5,h6')) heading = { top: Math.round(rr.top), el: desc(pe.closest('h1,h2,h3,h4,h5,h6')) };
      if (first && heading) break;
    }
    res.push({ id, bar: Math.round(bar), first, heading });
  }
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  return res;
}

function pMotion(ms) {
  return new Promise((done) => {
    const muts = new Set();
    const mo = new MutationObserver((list) => { for (const m of list) muts.add(desc(m.target) + ' [' + m.attributeName + ']'); });
    mo.observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['style', 'class'] });
    setTimeout(() => { try {
      mo.disconnect();
      const running = document.getAnimations().filter((a) => a.playState === 'running')
        .map((a) => (a.animationName || a.transitionProperty || 'animation') + ' on ' + desc(a.effect && a.effect.target));
      const trans = new Map();
      for (const el of document.querySelectorAll('body *')) {
        const cs = getComputedStyle(el);
        if (cs.transitionDuration.split(',').some((d) => parseFloat(d) > 0)) { const k = desc(el); trans.set(k, (trans.get(k) || 0) + 1); }
      }
      done({ rm: matchMedia('(prefers-reduced-motion: reduce)').matches, scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
        running, mutated: [...muts], transitions: [...trans].map(([k, n]) => `${k}${n > 1 ? ' ×' + n : ''}`), transitionCount: [...trans.values()].reduce((a, b) => a + b, 0) });
    } catch (e) { done({ error: String(e && e.stack || e) }); } }, ms);
  });
}

// ── Static info from the build ──────────────────────────────────────────────
function anchorsByPage(dist) {
  const { pages } = readBuild(dist); const map = {};
  for (const p of pages) for (const t of tags(p.clean)) {
    if (t.close || t.name !== 'a') continue;
    const href = attr(t.attrs, 'href'); if (!href || !href.includes('#') || /^(https?:|mailto:)/.test(href)) continue;
    const [pp, id] = href.split('#'); if (!id) continue;
    const target = pp ? (pp.replace(/\/$/, '') || '/') : p.url;
    (map[target] ||= new Set()).add(id);
  }
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, [...v]]));
}

// ── Keyboard reachability without JS (real Tab key presses) ─────────────────
async function tabCycle(c) {
  await c.ev('document.activeElement && document.activeElement.blur && document.activeElement.blur(); window.scrollTo({ top: 0, left: 0, behavior: "instant" }); 1');
  const reach = new Set(); let first = null;
  for (let i = 0; i < 400; i++) {
    for (const type of ['keyDown', 'keyUp']) await c.send('Input.dispatchKeyEvent', { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
    // Let CSS transitions started by the focus (e.g. a dropdown fading in from visibility:hidden) finish, as they would
    // for a person; a keypress every few ms would otherwise skip panels that open on :focus-within.
    for (let k = 0; k < 20; k++) { await sleep(30); if (!(await c.ev('document.getAnimations().some((a) => a instanceof CSSTransition && a.playState === "running")'))) break; }
    const a = await c.ev(`(() => { const el = document.activeElement; if (!el || el === document.body) return null; const p = [];
      for (let e = el; e && e !== document.body; e = e.parentElement) p.push(e.tagName + ':' + [...e.parentElement.children].indexOf(e));
      return { key: p.join('/'), href: el.getAttribute('href'), chrome: !!el.closest('header, nav, .mobile-menu, footer') }; })()`);
    if (!a) { if (i > 0) break; continue; }
    if (a.key === first) break; if (!first) first = a.key;
    if (a.chrome && a.href && !/^(https?:|mailto:)/.test(a.href)) reach.add(a.href.length > 1 ? a.href.replace(/\/$/, '') : a.href);
  }
  return reach;
}

// ── Run ─────────────────────────────────────────────────────────────────────
export async function runHarness({ dist, pages = EXPECTED_PAGES, widths = WIDTHS, log = () => { } }) {
  const anchors = anchorsByPage(dist);
  const P = Object.fromEntries(Object.keys(CHECKS).map((k) => [k, []]));     // problems
  const N = Object.fromEntries(Object.keys(CHECKS).map((k) => [k, []]));     // not measured
  const read = Object.fromEntries(Object.keys(CHECKS).map((k) => [k, 0]));
  const obs = { layoutWidth: {}, fonts: {}, grids: [], targets: [], anchors: [], motion: [], nojs: [] };
  const server = await serve(dist); const base = `http://127.0.0.1:${server.address().port}`;
  const chrome = await launch(); const c = chrome.cdp;
  const prob = (k, page, at, what, val = '') => P[k].push({ page, at, what, val });
  try {
    for (const page of pages) {
      log(`  ${page}`);
      for (const mode of ['window', 'phone']) {
        const ws = widths.filter((w) => mode === 'window' || w <= PHONE_MAX).sort((a, b) => b - a); if (!ws.length) continue;
        dbg(`load ${page} ${mode}`); await emulate(c, mode, ws[0]); const fonts = await go(c, base + page); obs.fonts[`${page} ${mode}`] = fonts;
        for (const w of ws) {
          await emulate(c, mode, w); const at = `${w} ${mode}`;
          dbg(`layout ${page} ${at}`); const L = await c.ev(inPage(pLayout, { margin: MARGIN, grids: GRIDS }));
          obs.layoutWidth[at] = L.vw;
          read.overflow++; if (L.overflow > 0) prob('overflow', page, `${at} (layout ${L.vw})`, `+${L.overflow}px: ${L.offenders.join(', ')}`);
          read.margins++; for (const m of L.margins) prob('margins', page, `${at}`, m.what, m.val);
          for (const g of L.grids) { read.lone++; obs.grids.push({ page, at, ...g }); if (g.lone) prob('lone', page, `${at} (layout ${L.vw})`, `${g.grid} ${g.pattern}`); }
          for (const a of await c.ev(inPage(pAnchors, anchors[page] || []))) {
            read.anchors++; obs.anchors.push({ page, at, ...a });
            if (a.missing) prob('anchors', page, at, `#${a.id} has no target`);
            else if (!a.first) N.anchors.push(`${page} #${a.id} @${at}: no visible text in target`);
            else if (a.first.top < a.bar - 0.5) prob('anchors', page, at, `#${a.id}: first text "${a.first.text}" at ${a.first.top}px${a.heading ? `, heading at ${a.heading.top}px` : ''}, bar ends at ${a.bar}px`);
          }
          if ((mode === 'window' && w === 1280) || mode === 'phone') {
            dbg(`targets ${page} ${at}`); for (const t of await c.ev(inPage(pTargets, { controls: CONTROLS, target: TARGET, fine: mode === 'window', openMenu: mode === 'phone' }))) {
              if (!t.total) continue;
              obs.targets.push({ page, at, ...t });
              if (!t.measured) { N.targets.push(`${page} ${t.label} @${at}: present but hidden`); continue; }
              read.targets += t.measured;
              if (t.fails && !t.exempt) prob('targets', page, at, `${t.label}: ${t.fails} of ${t.measured} under ${TARGET}px (smallest ${t.minW}×${t.minH})`, t.fails);
            }
          }
        }
      }
      // reduced motion
      await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      await emulate(c, 'window', 1280); await go(c, base + page);
      dbg(`motion ${page}`); const m = await c.ev(inPage(pMotion, MOTION_MS)); if (m.error) throw new Error(`motion probe: ${m.error}`);
      await c.send('Emulation.setEmulatedMedia', { features: [] });
      obs.motion.push({ page, ...m });
      if (!m.rm) N.motion.push(`${page}: reduced motion not in effect`);
      else {
        read.motion++;
        for (const r of m.running) prob('motion', page, '1280 reduced-motion', `running: ${r}`, 1);
        for (const r of m.mutated) prob('motion', page, '1280 reduced-motion', `changed by script: ${r}`, 1);
        if (m.scrollBehavior === 'smooth') prob('motion', page, '1280 reduced-motion', 'scroll-behavior stays smooth', 1);
        if (m.transitionCount) prob('motion', page, '1280 reduced-motion', `transitions kept on ${m.transitionCount} element(s): ${m.transitions.slice(0, 6).join(', ')}${m.transitions.length > 6 ? ', …' : ''}`, m.transitionCount);
      }
      // without JS: real Tab presses through header + footer
      await scripts(c, false);
      for (const [mode, w] of [['phone', 375], ['window', 1280]]) {
        await emulate(c, mode, w); await go(c, base + page);
        const off = await c.ev('typeof window.dataLayer === "undefined"');   // the inline GA snippet did not run
        if (!off) { N.nojs.push(`${page} @${w}: scripts still ran`); continue; }
        dbg(`tab cycle ${page} ${w}`); const reach = await tabCycle(c); read.nojs++;
        const missing = NAV_TARGETS.filter((t) => !reach.has(t));
        obs.nojs.push({ page, at: `${w} ${mode}`, reachable: [...reach].sort(), missing });
        for (const t of missing) prob('nojs', page, `${w} ${mode}`, `cannot reach ${t}`, 1);
      }
      await scripts(c, true);
    }
  } finally { await chrome.close(); server.close(); }
  const count = (k) => P[k].reduce((a, p) => a + (typeof p.val === 'number' && k !== 'margins' ? p.val : 1), 0);
  return { version: chrome.version, pages: pages.length, widths, problems: P, notMeasured: N, read, obs,
    counts: Object.fromEntries(Object.keys(CHECKS).map((k) => [k, count(k)])) };
}

// ── Output ──────────────────────────────────────────────────────────────────
function group(list) {
  const g = new Map();
  for (const p of list) { const k = `${p.page}  ${p.what}`; const v = g.get(k) || []; v.push(p.val && typeof p.val !== 'number' ? `${p.at} (${p.val})` : p.at); g.set(k, v); }
  const squash = (ats) => { const m = new Map(); for (const a of ats) m.set(a, (m.get(a) || 0) + 1); return [...m].map(([a, n]) => n > 1 ? `${a} ×${n}` : a).join(', '); };
  return [...g].map(([k, ats]) => `${k}  @ ${squash(ats)}`);
}
function print(run, detail = 14) {
  console.log(`Chrome ${run.version}; ${run.pages} page(s); widths ${run.widths.join(', ')}\n`);
  let failed = 0;
  for (const [k, name] of Object.entries(CHECKS)) {
    const n = run.counts[k], nm = run.notMeasured[k];
    const status = n ? 'FAIL' : (run.read[k] ? 'PASS' : 'NOT MEASURED'); if (n || !run.read[k]) failed++;
    console.log(`${status.padEnd(4)}  ${name} — ${run.read[k]} measurement(s) read; ${n} problem(s)${nm.length ? `; ${nm.length} not measured` : ''}`);
    const lines = group(run.problems[k]);
    for (const l of lines.slice(0, detail)) console.log(`          ${l}`);
    if (lines.length > detail) console.log(`          … ${lines.length - detail} more group(s)`);
    for (const l of nm.slice(0, 4)) console.log(`          not measured: ${l}`);
  }
  const fontsOff = Object.entries(run.obs.fonts).filter(([, v]) => !v).map(([k]) => k);
  console.log(`\nReceipts: web fonts loaded on ${Object.keys(run.obs.fonts).length - fontsOff.length}/${Object.keys(run.obs.fonts).length} loads${fontsOff.length ? ` (missing: ${fontsOff.join(', ')})` : ''}; ` +
    `layout widths ${Object.entries(run.obs.layoutWidth).filter(([k]) => /^(320|360|1440) /.test(k)).map(([k, v]) => `${k}→${v}`).join(', ')}.`);
  console.log(`Problems by kind: ${Object.entries(run.counts).map(([k, v]) => `${k} ${v}`).join(' · ')} (gate: zero of every kind)`);
  return failed;
}

// ── Negative tests ──────────────────────────────────────────────────────────
const edit = (dist, rel, fn) => { const f = path.join(dist, rel); fs.writeFileSync(f, fn(fs.readFileSync(f, 'utf8'))); };
const once = (s, find, repl) => { const i = s.indexOf(find); if (i < 0) throw new Error(`fault anchor not found: ${find}`); return s.slice(0, i) + repl + s.slice(i + find.length); };
const CASES = [
  { check: 'overflow', page: '/contact', name: 'a 2000px-wide empty block in <body>', fault: (d) => edit(d, 'contact.html', (s) => once(s, '<body>', '<body><div style="width:2000px;height:1px"></div>')) },
  { check: 'margins', page: '/contact', name: 'a paragraph pulled 60px left out of its column', fault: (d) => edit(d, 'contact.html', (s) => once(s, '<p style="margin-top: 24px;', '<p style="margin-left:-60px;text-align:left">Injected</p><p style="margin-top: 24px;')) },
  { check: 'lone', page: '/retreats/egypt-nile', name: 'two extra cards in the strip (4 → 3+1 on desktop)', fault: (d) => edit(d, 'retreats/egypt-nile.html', (s) => once(s, '<div class="other-retreat-cards">', '<div class="other-retreat-cards"><div style="height:120px"></div><div style="height:120px"></div>')) },
  { check: 'targets', page: '/contact', name: '.btn shrunk to 1px vertical padding', fault: (d) => edit(d, 'contact.html', (s) => once(s, '</head>', '<style>.btn{padding:1px 6px!important}</style></head>')) },
  { check: 'anchors', page: '/about', name: 'a jump link to the founders section', fault: (d) => edit(d, 'about.html', (s) => once(once(s, '<section class="team-section">', '<section class="team-section" id="t">'), '</h1>', '</h1><a href="#t">Jump</a>')) },
  { check: 'motion', page: '/about', name: 'an infinite animation only under reduced motion', fault: (d) => edit(d, 'about.html', (s) => once(s, '</head>', '<style>@media (prefers-reduced-motion: reduce){.cta-band h2{animation:scrollPulse 2s infinite}}</style></head>')) },
  { check: 'nojs', page: '/contact', name: 'bar links hidden only when scripting is off', fault: (d) => edit(d, 'contact.html', (s) => once(s, '</head>', '<noscript><style>.nav-links{display:none!important}</style></noscript></head>')) },
];
async function negative(dist) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'solscape-harness-neg-'));
  let passed = 0; const widths = [375, 1280];
  try {
    for (const c of CASES) {
      const dir = path.join(tmp, `case-${c.check}`); fs.cpSync(dist, dir, { recursive: true });
      const before = (await runHarness({ dist: dir, pages: [c.page], widths })).counts;
      c.fault(dir);
      const after = (await runHarness({ dist: dir, pages: [c.page], widths })).counts;
      const rose = after[c.check] > before[c.check];
      const others = Object.keys(after).filter((k) => k !== c.check && after[k] !== before[k]);
      const ok = rose && !others.length; if (ok) passed++;
      console.log(`${ok ? 'ok  ' : 'BAD '} ${c.check.padEnd(8)} ← ${c.name} (${c.page} @ 375 phone/window + 1280): ${before[c.check]} → ${after[c.check]}${others.length ? `; also moved: ${others.map((k) => `${k} ${before[k]}→${after[k]}`).join(', ')}` : '; no other check moved'}`);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  console.log(`\n${passed} of ${CASES.length} faults failed as expected (each case: an unmodified scratch copy measured first as its control).`);
  return passed === CASES.length ? 0 : 1;
}

// ── CLI ─────────────────────────────────────────────────────────────────────
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2); const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
  const dist = path.resolve(opt('--dist') || path.join(ROOT, 'dist'));
  if (!fs.existsSync(dist)) { console.error(`no build at ${dist} — run npm run build first`); process.exit(2); }
  if (args.includes('--negative')) process.exit(await negative(dist));
  const run = await runHarness({ dist, pages: opt('--pages') ? opt('--pages').split(',') : EXPECTED_PAGES,
    widths: opt('--widths') ? opt('--widths').split(',').map(Number) : WIDTHS, log: (s) => process.stderr.write(s + '\n') });
  if (args.includes('--json')) fs.writeFileSync(path.resolve(opt('--json')), JSON.stringify(run, null, 1));
  console.log(`SolScape harness — ${dist}`);
  process.exit(print(run) ? 1 : 0);
}
