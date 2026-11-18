#!/usr/bin/env node
// SolScape — computed-style snapshot, for changes that must leave the look unchanged.
// Dev-only: not built, not deployed. Same headless Chrome + in-memory server as tools/harness.mjs.
//
//   node tools/style-snapshot.mjs                 write the baseline (refuses if one exists)
//   node tools/style-snapshot.mjs --diff          capture the current dist/ and diff it against the baseline; exit 1 on any line
//   node tools/style-snapshot.mjs --rebaseline    overwrite the baseline on purpose (never to make a run pass)
//   options: --dist <dir>  --baseline <file>  --pages /,/about  --max <n lines shown per page>
//   node tools/style-snapshot.mjs --negative      self-test: injected faults must produce a diff; an untouched copy must not
//
// What is recorded, at 1280×800 (desktop, mouse) and 375×812 (phone, touch):
//   • every element (html, body and all body descendants): every computed property whose value differs from that
//     tag's default in a blank standards-mode page at the same size, plus its document-relative box;
//     custom properties (--tokens) are recorded on <html> only, where they are defined;
//   • the same for each named control and its subtree with :hover forced, and with :focus + :focus-visible forced.
// Before capture the page is frozen: its timers are cleared, transitions finished, animations paused at 0.
// Diff: element lists are aligned by signature (tag#id.classes, LCS), so an added wrapper shows as one inserted
// element; matched elements report every property and box change.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { EXPECTED_PAGES, readBuild, tags } from './audit.mjs';
import { serve, launch, emulate, go } from './harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_BASELINE = path.join(ROOT, 'tools', 'baselines', 'style-snapshot.json.gz');   // gzip-compressed JSON
const readSnap = (f) => JSON.parse((f.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(f)) : fs.readFileSync(f)).toString('utf8'));
const writeSnap = (f, o) => { const j = JSON.stringify(o); fs.writeFileSync(f, f.endsWith('.gz') ? zlib.gzipSync(j, { level: 9 }) : j); };
const SETUPS = [
  { name: '1280', mode: 'window', width: 1280 },
  { name: '375', mode: 'phone', width: 375 },
];
// Controls whose interactive states are captured (each instance, with its subtree).
const STATE_CONTROLS = ['nav .logo', '.nav-item', '.nav-item > a', '.dropdown a', '.nav-cta', '.nav-insta', '.hamburger', '.mobile-menu a',
  '.btn', '.card', '.card-link', '.cat-tile', '.pillar', '.carousel-dot', '.view-room-btn', '.property-item', '.retreat-gallery-item',
  '.team-card-body a', '.footer-col ul a', '.footer-social a'];
const STATES = [['hover'], ['focus', 'focus-visible']];
const SVG_TAGS = new Set(['svg', 'circle', 'path', 'line', 'rect', 'polyline', 'polygon', 'ellipse', 'g', 'use', 'defs', 'title']);

// ── In-page code ────────────────────────────────────────────────────────────
// Freeze: clear timers set by the site, finish transitions, pause animations at their start.
const FREEZE = `(() => { const hi = setTimeout(() => {}, 0); for (let i = 1; i <= hi + 50; i++) { clearTimeout(i); clearInterval(i); }
  for (const a of document.getAnimations()) { if (a instanceof CSSTransition) a.finish(); else { a.pause(); a.currentTime = 0; } } return hi; })()`;
const COLLECT = `function collect(rootEl, defaults, withCustom) {
  const els = rootEl === document.documentElement ? [document.documentElement, document.body, ...document.body.querySelectorAll('*')] : [rootEl, ...rootEl.querySelectorAll('*')];
  void getComputedStyle(rootEl).color;
  for (const a of document.getAnimations()) { if (a instanceof CSSTransition) a.finish(); else if (a.playState !== 'paused') { a.pause(); a.currentTime = 0; } }
  const sig = (el) => { const cn = typeof el.className === 'string' ? el.className : (el.className && el.className.baseVal) || '';
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + cn.trim().split(/\\s+/).filter(Boolean).map((c) => '.' + c).join(''); };
  const pathOf = (el) => { const p = []; for (let e = el; e && e !== document.documentElement && p.length < 4; e = e.parentElement) p.unshift(sig(e)); return p.join(' > '); };
  return els.map((el) => {
    const cs = getComputedStyle(el); const d = defaults[el.tagName.toLowerCase()] || {}; const props = {};
    for (let i = 0; i < cs.length; i++) { const n = cs[i]; if (n.startsWith('--') && !(withCustom && el === document.documentElement)) continue;
      const v = cs.getPropertyValue(n).split(location.origin).join(''); if (d[n] !== v) props[n] = v; }   // drop the test server's random port
    const r = el.getBoundingClientRect(); const q = (x) => Math.round(x * 100) / 100;
    return [sig(el), pathOf(el), props, [q(r.left + scrollX), q(r.top + scrollY), q(r.width), q(r.height)]];
  });
}`;
const DEFAULTS = (tagList) => `(() => {
  document.open(); document.write('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body></body></html>'); document.close();
  const svgTags = ${JSON.stringify([...SVG_TAGS])}; const out = {};
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); document.body.appendChild(svg);
  for (const t of ${JSON.stringify(tagList)}) {
    const el = t === 'html' ? document.documentElement : t === 'body' ? document.body : svgTags.includes(t) && t !== 'svg' ? document.createElementNS('http://www.w3.org/2000/svg', t) : t === 'svg' ? document.createElementNS('http://www.w3.org/2000/svg', 'svg') : document.createElement(t);
    if (t !== 'html' && t !== 'body') (svgTags.includes(t) && t !== 'svg' ? svg : document.body).appendChild(el);
    const cs = getComputedStyle(el); const p = {}; for (let i = 0; i < cs.length; i++) p[cs[i]] = cs.getPropertyValue(cs[i]);
    out[t] = p; if (t !== 'html' && t !== 'body') el.remove();
  }
  return out; })()`;

// ── Capture ─────────────────────────────────────────────────────────────────
function tagSet(dist) {
  const s = new Set(['html', 'body']);
  for (const p of readBuild(dist).pages) for (const t of tags(p.clean.slice(p.clean.search(/<body\b/i)))) if (!t.close) s.add(t.name);
  return [...s].filter((t) => !['script', 'noscript', 'style', 'template'].includes(t)).sort();
}
async function capture({ dist, pages = EXPECTED_PAGES, log = () => { } }) {
  const tl = tagSet(dist);
  const server = await serve(dist); const base = `http://127.0.0.1:${server.address().port}`;
  const chrome = await launch(); const c = chrome.cdp;
  const snap = { meta: { chrome: chrome.version, setups: SETUPS, pages, fonts: {} }, captures: {}, states: {} };
  try {
    await c.send('DOM.enable'); await c.send('CSS.enable');
    for (const s of SETUPS) {
      await emulate(c, s.mode, s.width);
      await c.send('Page.navigate', { url: 'about:blank' }); await new Promise((r) => setTimeout(r, 200));
      const defaults = await c.ev(DEFAULTS(tl));
      for (const page of pages) {
        log(`  ${page} @${s.name}`);
        const key = `${page} @${s.name}`;
        snap.meta.fonts[key] = await go(c, base + page);
        await c.ev(FREEZE); await c.ev('window.scrollTo({ top: 0, left: 0, behavior: "instant" }); 1');
        snap.captures[key] = await c.ev(`(() => { ${COLLECT}; return collect(document.documentElement, ${JSON.stringify(defaults)}, true); })()`);
        // forced states
        const st = {}; const { root } = await c.send('DOM.getDocument', { depth: -1 });
        const fn = `function () { ${COLLECT}; return collect(this, ${JSON.stringify(defaults)}, false); }`;
        for (const sel of STATE_CONTROLS) {
          const { nodeIds } = await c.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: sel });
          for (let i = 0; i < nodeIds.length; i++) {
            const { object } = await c.send('DOM.resolveNode', { nodeId: nodeIds[i] });
            for (const state of STATES) {
              await c.send('CSS.forcePseudoState', { nodeId: nodeIds[i], forcedPseudoClasses: state });
              const r = await c.send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: fn, returnByValue: true });
              await c.send('CSS.forcePseudoState', { nodeId: nodeIds[i], forcedPseudoClasses: [] });
              if (r.exceptionDetails) throw new Error(`state capture ${sel}: ${r.exceptionDetails.exception?.description}`);
              st[`${state.join('+')} | ${sel} | ${i}`] = r.result.value;
            }
          }
        }
        await c.ev(FREEZE);
        snap.states[key] = st;
      }
    }
  } finally { await chrome.close(); server.close(); }
  return snap;
}

// ── Diff ────────────────────────────────────────────────────────────────────
function align(a, b) {   // LCS on signatures → list of [i|null, j|null]
  const n = a.length, m = b.length; const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i][0] === b[j][0] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n && j < m) { if (a[i][0] === b[j][0]) out.push([i++, j++]); else if (L[i + 1][j] >= L[i][j + 1]) out.push([i++, null]); else out.push([null, j++]); }
  while (i < n) out.push([i++, null]); while (j < m) out.push([null, j++]);
  return out;
}
function diffLists(a = [], b = []) {
  const lines = [];
  for (const [i, j] of align(a, b)) {
    if (j === null) { lines.push(`removed   ${a[i][1]}`); continue; }
    if (i === null) { lines.push(`inserted  ${b[j][1]}`); continue; }
    const [, p, A, ra] = a[i]; const [, , B, rb] = b[j];
    for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) if (A[k] !== B[k]) lines.push(`changed   ${p}  ${k}: ${A[k] ?? '(default)'} → ${B[k] ?? '(default)'}`);
    if (ra.some((v, x) => Math.abs(v - rb[x]) > 0.01)) lines.push(`moved     ${p}  box [${ra.join(', ')}] → [${rb.join(', ')}]`);
  }
  return lines;
}
function diff(base, cur, max) {
  let total = 0; const out = [];
  if (base.meta.chrome !== cur.meta.chrome) out.push(`note: baseline Chrome ${base.meta.chrome}, now ${cur.meta.chrome} — differences may come from the browser`);
  for (const key of Object.keys(cur.captures)) {
    if (!base.captures[key]) { out.push(`${key}: not in the baseline`); total++; continue; }
    if (base.meta.fonts[key] !== cur.meta.fonts[key]) out.push(`note: ${key} web fonts loaded ${base.meta.fonts[key]} → ${cur.meta.fonts[key]}`);
    const lines = diffLists(base.captures[key], cur.captures[key]);
    const bs = base.states[key] || {}, cs = cur.states[key] || {};
    for (const k of new Set([...Object.keys(bs), ...Object.keys(cs)])) {
      if (!bs[k]) { lines.push(`state     ${k}: new control`); continue; }
      if (!cs[k]) { lines.push(`state     ${k}: control gone`); continue; }
      for (const l of diffLists(bs[k], cs[k])) lines.push(`state     ${k}: ${l}`);
    }
    total += lines.length;
    if (lines.length) { out.push(`${key}: ${lines.length} line(s)`); for (const l of lines.slice(0, max)) out.push(`    ${l}`); if (lines.length > max) out.push(`    … ${lines.length - max} more`); }
  }
  return { total, out };
}

// ── Negative tests ──────────────────────────────────────────────────────────
const edit = (dist, rel, fn) => { const f = path.join(dist, rel); fs.writeFileSync(f, fn(fs.readFileSync(f, 'utf8'))); };
const once = (s, find, repl) => { const i = s.indexOf(find); if (i < 0) throw new Error(`fault anchor not found: ${find}`); return s.slice(0, i) + repl + s.slice(i + find.length); };
const CASES = [
  { page: '/about', name: 'one property on section titles (letter-spacing)', expect: /changed .*letter-spacing/, fault: (d) => edit(d, 'about.html', (s) => once(s, '</head>', '<style>.section-title{letter-spacing:.01em}</style></head>')) },
  { page: '/contact', name: 'one extra empty element', expect: /inserted /, fault: (d) => edit(d, 'contact.html', (s) => once(s, '<section class="contact-form-section">', '<section class="contact-form-section"><span class="injected"></span>')) },
  { page: '/contact', name: 'a :hover-only rule on primary buttons', expect: /^state +hover \| \.btn/, only: /^state +hover/, fault: (d) => edit(d, 'contact.html', (s) => once(s, '</head>', '<style>.btn-primary:hover{outline:3px solid red}</style></head>')) },
  { page: '/retreats/egypt-nile', name: 'a :focus-visible-only rule on card links', expect: /^state +focus\+focus-visible \| \.card-link/, only: /^state +focus/, fault: (d) => edit(d, 'retreats/egypt-nile.html', (s) => once(s, '</head>', '<style>.card-link:focus-visible{outline-offset:9px}</style></head>')) },
];
async function negative(dist, baselineFile) {
  if (!fs.existsSync(baselineFile)) { console.error(`no baseline at ${baselineFile}`); return 1; }
  const base = readSnap(baselineFile);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'solscape-snap-neg-'));
  let passed = 0;
  try {
    const ctlDir = path.join(tmp, 'control'); fs.cpSync(dist, ctlDir, { recursive: true });
    const pages = [...new Set(CASES.map((c) => c.page))];
    const ctl = diff(base, await capture({ dist: ctlDir, pages }), 5);
    console.log(`control: unmodified scratch copy of ${pages.join(', ')} → ${ctl.total} diff line(s) against the baseline${ctl.total ? ' (expected 0)' : ''}`);
    if (ctl.total) { console.log(ctl.out.join('\n')); return 1; }
    for (const c of CASES) {
      const dir = path.join(tmp, `case-${passed}-${c.page.replace(/\W/g, '')}`); fs.cpSync(dist, dir, { recursive: true });
      c.fault(dir);
      const d = diff(base, await capture({ dist: dir, pages: [c.page] }), 1e9);
      const lines = d.out.filter((l) => l.startsWith('    ')).map((l) => l.trim());
      const hit = lines.some((l) => c.expect.test(l)); const stray = c.only ? lines.filter((l) => !c.only.test(l)) : [];
      const ok = d.total > 0 && hit && !stray.length; if (ok) passed++;
      console.log(`${ok ? 'ok  ' : 'BAD '} ${c.name} (${c.page}): ${d.total} diff line(s)${hit ? '' : ', expected line missing'}${stray.length ? `, ${stray.length} line(s) outside the forced state` : ''}; e.g. ${lines.find((l) => c.expect.test(l)) || lines[0] || '—'}`);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  console.log(`\n${passed} of ${CASES.length} faults failed as expected (and the untouched copy diffed to 0 lines).`);
  return passed === CASES.length ? 0 : 1;
}

// ── CLI ─────────────────────────────────────────────────────────────────────
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2); const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
  const dist = path.resolve(opt('--dist') || path.join(ROOT, 'dist'));
  const baselineFile = path.resolve(opt('--baseline') || DEFAULT_BASELINE);
  const pages = opt('--pages') ? opt('--pages').split(',') : EXPECTED_PAGES;
  const log = (s) => process.stderr.write(s + '\n');
  if (!fs.existsSync(dist)) { console.error(`no build at ${dist} — run npm run build first`); process.exit(2); }
  if (args.includes('--negative')) process.exit(await negative(dist, baselineFile));
  if (args.includes('--diff')) {
    if (!fs.existsSync(baselineFile)) { console.error(`no baseline at ${baselineFile}; create it first`); process.exit(2); }
    const base = readSnap(baselineFile);
    const cur = await capture({ dist, pages, log });
    const d = diff(base, cur, +(opt('--max') || 40));
    console.log(d.out.join('\n'));
    console.log(`\n${d.total} diff line(s) across ${Object.keys(cur.captures).length} capture(s) (${pages.length} page(s) × ${SETUPS.map((s) => s.name).join(' + ')}).`);
    process.exit(d.total ? 1 : 0);
  }
  if (fs.existsSync(baselineFile) && !args.includes('--rebaseline')) { console.error(`baseline exists at ${baselineFile}; use --diff, or --rebaseline to replace it on purpose`); process.exit(2); }
  const snap = await capture({ dist, pages, log });
  fs.mkdirSync(path.dirname(baselineFile), { recursive: true });
  writeSnap(baselineFile, snap);
  const els = Object.values(snap.captures).reduce((a, v) => a + v.length, 0);
  const st = Object.values(snap.states).reduce((a, v) => a + Object.keys(v).length, 0);
  console.log(`baseline written: ${path.relative(ROOT, baselineFile)} — ${Object.keys(snap.captures).length} captures, ${els} elements, ${st} forced-state captures, ${(fs.statSync(baselineFile).size / 1048576).toFixed(1)} MB (Chrome ${snap.meta.chrome})`);
}
