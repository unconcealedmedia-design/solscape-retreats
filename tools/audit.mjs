#!/usr/bin/env node
// SolScape — static audit of the built site (dist/).
// Dev-only: not built, not deployed. Reads files, never writes into dist/.
//
//   npm run build && node tools/audit.mjs            one PASS/FAIL line per check, exit 1 on any FAIL
//   node tools/audit.mjs --dist <dir>                audit another build (e.g. a scratch copy)
//   node tools/audit.mjs --print-labels              list every label → target pair found (to review)
//   node tools/audit.mjs --negative                  self-test: inject one fault per check into a
//                                                    scratch copy of dist/ and confirm the named check catches it
//
// Plain text matching only (no HTML parser). Expected values are fixed lists below: a new page,
// label or retired URL fails until it is added here on purpose. Known limits are noted per check.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── Fixed expectations ──────────────────────────────────────────────────────
// Pages that must be written (URL paths). 404 is not in the sitemap and is listed separately.
export const EXPECTED_PAGES = [
  '/', '/about', '/contact', '/experience',
  '/retreats/egypt-nile', '/retreats/exotic', '/retreats/geneva', '/retreats/morocco',
  '/retreats/provence', '/retreats/winter-wonderland', '/retreats/past/greece',
];
const NOT_IN_SITEMAP = ['/404'];

// Retired URL → where its one redirect stub must send the reader.
export const RETIRED = {
  '/retreats/greece': '/retreats/past/greece',
  '/retreats/kenya': '/#retreats',
  '/retreats/past/croatia': '/experience',
  '/retreats/past/spain': '/experience',
  '/retreats/past/tuscany': '/experience',
};

// Closed list of every link/button label and the targets it may point to (recorded 2026-11-18
// from the build of ebadefd). A new label, or a known label pointing somewhere new, fails until
// it is approved and added here. "(button)" = a <button> with that visible text.
const IG = 'https://ig.me/m/solscape_retreats';
const IG_PROFILE = 'https://www.instagram.com/solscape_retreats/';
const MAIL = 'mailto:solscaperetreats@gmail.com?subject=Retreat%20Enquiry';
export const LABELS = {
  // shared chrome
  'SolScape Retreats': ['/'],
  'Retreats': ['/#retreats'],
  'Winter Wonderland': ['/retreats/winter-wonderland'],
  'Luxor Aswan': ['/retreats/egypt-nile'],
  'Morocco': ['/retreats/morocco'],
  'Provence': ['/retreats/provence'],
  'Geneva': ['/retreats/geneva'],
  'Exotic — TBA': ['/retreats/exotic'],
  'Experience': ['/experience'],
  'The Experience': ['/experience'],
  'About': ['/about'],
  'About Us': ['/about'],
  'Contact': ['/contact'],
  'Instagram': [IG_PROFILE],
  'Book Now': [IG],
  'DM to Book': [IG],
  'Email': [MAIL],
  'Skip to content': ['#main'],   // added in Structure Guide Phase 1 (skip link)
  // page actions
  'View Upcoming Retreats': ['#retreats', '/#retreats'],
  'Meet Samantha and Nada': ['/about'],
  'Our Story': ['/about'],
  'Retreat Details →': ['/retreats/winter-wonderland'],
  'Retreat details →': ['/retreats/winter-wonderland', '/retreats/egypt-nile', '/retreats/morocco',
    '/retreats/provence', '/retreats/geneva', '/retreats/exotic', '/retreats/past/greece'],
  'Message Us on Instagram': [IG],
  'Message us on Instagram': [IG],
  'Send an Inquiry': [MAIL],
  'Email us': [MAIL, 'mailto:solscaperetreats@gmail.com?subject=Winter%20Wonderland%20Enquiry'],
  'Get in Touch': ['/contact'],
  'All Retreats': ['/#retreats'],
  'Enquire Now': ['#booking'],
  'View Room →': ['(button)'],
  '@oneyogasamantha': ['https://www.instagram.com/oneyogasamantha/'],
  '@forbarre': ['https://www.instagram.com/forbarre/'],
};

// ── Small HTML helpers (text matching, documented limits) ───────────────────
const ENT = { amp: '&', nbsp: ' ', lt: '<', gt: '>', quot: '"', apos: "'", rarr: '→', times: '×', mdash: '—', ndash: '–', middot: '·' };
export function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENT[e.toLowerCase()] ?? m;
  });
}
export const textOf = (inner) => decode(inner.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
// Remove script/style bodies and comments so their contents can't be read as markup.
export const scrub = (html) => html
  .replace(/<!--[\s\S]*?-->/g, (m) => ' '.repeat(m.length))
  .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, (m) => m.replace(/>[\s\S]*</, (x) => '>' + ' '.repeat(x.length - 2) + '<'));
const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;
export function* tags(html) {
  TAG_RE.lastIndex = 0; let m;
  while ((m = TAG_RE.exec(html))) yield { close: !!m[1], name: m[2].toLowerCase(), attrs: m[3] || '', index: m.index, end: TAG_RE.lastIndex };
}
export function attr(attrs, name) {
  const m = attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? decode(m[2] ?? m[3] ?? m[4] ?? '') : null;
}
const hasAttr = (attrs, name) => new RegExp(`(?:^|\\s)${name}(?:\\s*=|\\s|$)`, 'i').test(attrs);
// Outer HTML of the element whose opening tag starts at `start` (balanced on the same tag name).
export function outerAt(html, start) {
  const open = html.slice(start).match(/^<([a-zA-Z][a-zA-Z0-9-]*)/); if (!open) return null;
  const name = open[1].toLowerCase(); let depth = 0;
  for (const t of tags(html.slice(start))) {
    if (t.name !== name) continue;
    depth += t.close ? -1 : 1;
    if (depth === 0) return html.slice(start, start + t.end);
  }
  return null;
}
const pairs = (html, name) => [...html.matchAll(new RegExp(`<${name}\\b([^>]*)>([\\s\\S]*?)<\\/${name}>`, 'gi'))].map((m) => ({ attrs: m[1], inner: m[2], index: m.index }));

// Name of a control: visible text, aria-label, aria-labelledby, title, or an inner image's alt.
export function accName(attrs, inner) {
  const t = textOf(inner); if (t) return t;
  for (const a of ['aria-label', 'title']) { const v = attr(attrs, a); if (v && v.trim()) return v.trim(); }
  if (attr(attrs, 'aria-labelledby')) return '(labelledby)';
  for (const t2 of tags(inner)) if (t2.name === 'img') { const alt = attr(t2.attrs, 'alt'); if (alt && alt.trim()) return alt.trim(); }
  return '';
}

// ── Reading the build ───────────────────────────────────────────────────────
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    e.isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
}
const isStub = (html) => /<meta\s+http-equiv="refresh"/i.test(html);
const urlOf = (dist, file) => {
  let u = '/' + path.relative(dist, file).split(path.sep).join('/');
  u = u.replace(/\.html$/, '').replace(/\/index$/, '/');
  return u === '/index' ? '/' : (u.length > 1 ? u.replace(/\/$/, '') : u);
};
export function readBuild(dist) {
  if (!fs.existsSync(dist)) throw new Error(`no build at ${dist} — run npm run build first`);
  const files = walk(dist);
  const html = files.filter((f) => f.endsWith('.html'));
  const pages = [], stubs = [];
  for (const f of html) {
    const src = fs.readFileSync(f, 'utf8');
    (isStub(src) ? stubs : pages).push({ file: f, url: urlOf(dist, f), src, clean: scrub(src) });
  }
  pages.sort((a, b) => EXPECTED_PAGES.indexOf(a.url) - EXPECTED_PAGES.indexOf(b.url));
  return { dist, files, pages, stubs };
}
// Resolve an internal URL path to a file in dist (clean URLs: /about → about.html).
function resolveFile(dist, p) {
  const clean = decodeURIComponent(p.split('?')[0]);
  const base = path.join(dist, clean);
  const cands = clean.endsWith('/') ? [path.join(base, 'index.html')] : [base, base + '.html', path.join(base, 'index.html')];
  return cands.find((c) => fs.existsSync(c) && fs.statSync(c).isFile()) || null;
}
// Every internal reference on a page: href, src, srcset, url(...) in style attributes, data-gallery image srcs.
function refsOf(page) {
  const out = [];
  for (const t of tags(page.clean)) {
    if (t.close) continue;
    for (const a of ['href', 'src']) { const v = attr(t.attrs, a); if (v != null) out.push({ ref: v, kind: `${t.name}[${a}]` }); }
    const ss = attr(t.attrs, 'srcset'); if (ss) for (const part of ss.split(',')) out.push({ ref: part.trim().split(/\s+/)[0], kind: `${t.name}[srcset]` });
    const st = attr(t.attrs, 'style'); if (st) for (const m of st.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) out.push({ ref: m[1], kind: 'style url()' });
    const dg = attr(t.attrs, 'data-gallery');
    if (dg) { try { for (const im of JSON.parse(dg).images || []) out.push({ ref: im.src, kind: 'data-gallery' }); } catch { out.push({ ref: '(unparseable data-gallery)', kind: 'data-gallery' }); } }
  }
  return out;
}
const SITE = 'https://solscaperetreats.com';
const internal = (ref) => {
  if (!ref) return null;
  if (ref.startsWith(SITE)) ref = ref.slice(SITE.length) || '/';
  if (/^(https?:|mailto:|tel:|javascript:|data:|\/\/)/i.test(ref)) return null;
  return ref;
};

// ── Checks ──────────────────────────────────────────────────────────────────
// Each returns { id, name, read, problems: [string] }. A check passes when problems is empty.
export function runAudit(dist) {
  const b = readBuild(dist);
  const P = b.pages;
  const results = [];
  const add = (id, name, read, problems) => results.push({ id, name, read, problems });

  // 1. one h1
  {
    const probs = [];
    for (const p of P) { const n = (p.clean.match(/<h1\b/gi) || []).length; if (n !== 1) probs.push(`${p.url}: ${n} h1`); }
    add(1, 'one h1 per page', `${P.length} pages read`, probs);
  }
  // 2. no skipped heading levels (document order, header and footer included)
  {
    const probs = []; let total = 0;
    for (const p of P) {
      let prev = 0;
      for (const m of p.clean.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
        const l = +m[1]; total++;
        if (prev && l > prev + 1) probs.push(`${p.url}: h${prev}→h${l} "${textOf(m[2]).slice(0, 40)}"`);
        prev = l;
      }
    }
    add(2, 'no skipped heading levels', `${P.length} pages, ${total} headings read`, probs);
  }
  // 3. landmarks: one header, one main, one footer; every nav labelled, labels unique
  {
    const probs = [];
    for (const p of P) {
      const c = (n) => (p.clean.match(new RegExp(`<${n}\\b`, 'gi')) || []).length;
      for (const n of ['header', 'main', 'footer']) if (c(n) !== 1) probs.push(`${p.url}: <${n}> ×${c(n)}`);
      const navs = [...tags(p.clean)].filter((t) => !t.close && t.name === 'nav');
      if (!navs.length) probs.push(`${p.url}: no <nav>`);
      const labels = [];
      navs.forEach((t, i) => {
        const l = attr(t.attrs, 'aria-label') || (attr(t.attrs, 'aria-labelledby') ? `#${attr(t.attrs, 'aria-labelledby')}` : '');
        if (!l) probs.push(`${p.url}: <nav> #${i + 1} has no label`); else labels.push(l);
      });
      if (new Set(labels).size !== labels.length) probs.push(`${p.url}: duplicate nav labels (${labels.join(', ')})`);
    }
    add(3, 'landmarks: header, labelled nav, main, footer once each', `${P.length} pages read`, probs);
  }
  // 4. skip link is the first focusable element and points at <main id="main">
  {
    const probs = [];
    const focusable = (t) => (t.name === 'a' && hasAttr(t.attrs, 'href')) || ['button', 'select', 'textarea', 'summary', 'iframe'].includes(t.name)
      || (t.name === 'input' && attr(t.attrs, 'type') !== 'hidden') || (attr(t.attrs, 'tabindex') != null && +attr(t.attrs, 'tabindex') >= 0);
    for (const p of P) {
      const body = p.clean.slice(p.clean.search(/<body\b/i));
      const first = [...tags(body)].find((t) => !t.close && focusable(t));
      const href = first && attr(first.attrs, 'href');
      const target = /<main\b[^>]*\sid="main"/i.test(p.clean);
      if (!first || first.name !== 'a' || href !== '#main' || !target)
        probs.push(`${p.url}: first focusable is ${first ? `<${first.name}${href ? ` href="${href}"` : ''}>` : 'none'}${target ? '' : '; no <main id="main">'}`);
    }
    add(4, 'skip link is the first focusable element', `${P.length} pages read`, probs);
  }
  // 5. header and footer byte-identical on every page.
  //    Header = <header>…</header> when present (plus anything between <body> and it, e.g. a skip link);
  //    before that exists, the bar <nav> plus the .mobile-menu sheet. Footer = <footer>…</footer>.
  {
    const probs = []; const H = new Map(), F = new Map();
    for (const p of P) {
      let header = null;
      const bodyAt = p.src.search(/<body\b[^>]*>/i);
      const hAt = p.src.indexOf('<header');
      if (hAt >= 0) { const o = outerAt(p.src, hAt); header = o && p.src.slice(p.src.indexOf('>', bodyAt) + 1, hAt) + o; }
      else {
        const nAt = p.src.indexOf('<nav'); const mAt = p.src.search(/<div[^>]*class="mobile-menu"/);
        if (nAt >= 0) header = outerAt(p.src, nAt) + (mAt >= 0 ? outerAt(p.src, mAt) : '');
      }
      const fAt = p.src.indexOf('<footer'); const footer = fAt >= 0 ? outerAt(p.src, fAt) : null;
      if (!header) probs.push(`${p.url}: no header region found`);
      if (!footer) probs.push(`${p.url}: no footer found`);
      const h = crypto.createHash('sha1').update(header || '').digest('hex').slice(0, 10);
      const f = crypto.createHash('sha1').update(footer || '').digest('hex').slice(0, 10);
      H.set(h, [...(H.get(h) || []), p.url]); F.set(f, [...(F.get(f) || []), p.url]);
    }
    if (H.size > 1) probs.push(`header: ${H.size} variants — ${[...H.values()].map((v) => v.join(' ')).join(' | ')}`);
    if (F.size > 1) probs.push(`footer: ${F.size} variants — ${[...F.values()].map((v) => v.join(' ')).join(' | ')}`);
    add(5, 'header and footer byte-identical', `${P.length} pages read; header ${H.size} variant(s), footer ${F.size} variant(s)`, probs);
  }
  // 6. curly quotes: none inside any tag (attributes); text count reported for information.
  {
    const probs = []; let inText = 0;
    for (const p of P) {
      for (const t of tags(p.clean)) if (/[“”‘’]/.test(t.attrs)) probs.push(`${p.url}: <${t.name}${t.attrs.slice(0, 50)}>`);
      inText += (p.clean.replace(/<[^>]*>/g, '').match(/[“”‘’]/g) || []).length;
    }
    add(6, '0 curly quotes in markup', `${P.length} pages read; ${probs.length} in attributes, ${inText} in text (text allowed)`, probs);
  }
  // 7. no unnamed buttons (or links). Limit: names from text, aria-label, title or an inner img alt only.
  {
    const probs = []; let n = 0;
    for (const p of P) for (const k of ['button', 'a']) for (const e of pairs(p.clean, k)) {
      if (k === 'a' && !hasAttr(e.attrs, 'href')) continue;
      n++;
      if (!accName(e.attrs, e.inner)) probs.push(`${p.url}: <${k} class="${attr(e.attrs, 'class') || ''}"> has no name`);
    }
    add(7, 'no unnamed buttons or links', `${P.length} pages, ${n} controls read`, probs);
  }
  // 8. alt attribute on every image (empty alt allowed for decoration).
  {
    const probs = []; let n = 0;
    for (const p of P) for (const t of tags(p.clean)) if (!t.close && t.name === 'img') { n++; if (!hasAttr(t.attrs, 'alt')) probs.push(`${p.url}: <img src="${attr(t.attrs, 'src')}"> has no alt`); }
    add(8, 'alt on every image', `${P.length} pages, ${n} images read`, probs);
  }
  // 9. internal links, assets and anchors resolve.
  {
    const probs = []; let n = 0;
    const ids = new Map(P.map((p) => [p.url, new Set([...p.clean.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))]));
    for (const p of P) for (const { ref, kind } of refsOf(p)) {
      const r = internal(ref); if (r == null) continue; n++;
      const [pathPart, frag] = r.split('#');
      let targetUrl = p.url;
      if (pathPart) {
        const abs = pathPart.startsWith('/') ? pathPart : path.posix.join(path.posix.dirname(p.url), pathPart);
        const f = resolveFile(dist, abs);
        if (!f) { probs.push(`${p.url}: ${kind} → ${r} (no file)`); continue; }
        targetUrl = f.endsWith('.html') ? urlOf(dist, f) : null;
      }
      if (frag && targetUrl && ids.has(targetUrl) && !ids.get(targetUrl).has(frag)) probs.push(`${p.url}: ${kind} → ${r} (no id="${frag}")`);
    }
    add(9, 'internal links, assets and anchors resolve', `${P.length} pages, ${n} internal refs read`, probs);
  }
  // 10. retired URLs: exactly one stub each, redirecting to the fixed target with noindex; no inbound refs; not in the sitemap.
  const sitemapUrls = (() => {
    const out = []; const idx = path.join(dist, 'sitemap-index.xml');
    const maps = fs.existsSync(idx) ? [...fs.readFileSync(idx, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => path.join(dist, m[1].replace(SITE, ''))) : [];
    for (const m of maps) if (fs.existsSync(m)) for (const l of fs.readFileSync(m, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)) {
      let u = l[1].replace(SITE, '') || '/'; if (u.length > 1) u = u.replace(/\/$/, ''); out.push(u);
    }
    return { maps: maps.length, urls: out };
  })();
  {
    const probs = [];
    for (const [url, to] of Object.entries(RETIRED)) {
      const cands = [path.join(dist, url + '.html'), path.join(dist, url, 'index.html')].filter((f) => fs.existsSync(f));
      if (cands.length !== 1) probs.push(`${url}: ${cands.length} stub files`);
      else {
        const s = fs.readFileSync(cands[0], 'utf8');
        const m = s.match(/http-equiv="refresh"\s+content="\d+;url=([^"]+)"/i);
        if (!m) probs.push(`${url}: stub is not a meta refresh`);
        else if (m[1] !== to) probs.push(`${url}: redirects to ${m[1]}, expected ${to}`);
        if (!/name="robots"\s+content="noindex"/i.test(s)) probs.push(`${url}: stub lacks noindex`);
      }
      for (const p of P) for (const { ref, kind } of refsOf(p)) {
        const r = internal(ref); if (!r) continue;
        const bare = r.split('#')[0].split('?')[0].replace(/\.html$/, '').replace(/\/$/, '');
        if (bare === url) probs.push(`${url}: linked from ${p.url} (${kind})`);
      }
      if (sitemapUrls.urls.includes(url)) probs.push(`${url}: listed in the sitemap`);
    }
    add(10, 'retired URLs: one stub, 0 inbound links, not in sitemap', `${Object.keys(RETIRED).length} retired URLs, ${b.stubs.length} stubs, ${P.length} pages read`, probs);
  }
  // 11. sitemap equals pages written, and pages written equal the fixed list.
  {
    const probs = [];
    const written = P.map((p) => p.url);
    for (const u of EXPECTED_PAGES) if (!written.includes(u)) probs.push(`expected page not written: ${u}`);
    for (const u of written) if (!EXPECTED_PAGES.includes(u) && !NOT_IN_SITEMAP.includes(u)) probs.push(`page written but not in the fixed list: ${u}`);
    const want = written.filter((u) => !NOT_IN_SITEMAP.includes(u));
    for (const u of want) if (!sitemapUrls.urls.includes(u)) probs.push(`written but missing from sitemap: ${u}`);
    for (const u of sitemapUrls.urls) if (!want.includes(u)) probs.push(`in sitemap but not a written page: ${u}`);
    const dup = sitemapUrls.urls.filter((u, i, a) => a.indexOf(u) !== i); for (const u of dup) probs.push(`listed twice in sitemap: ${u}`);
    add(11, 'sitemap equals pages written (fixed page list)', `${written.length} pages written, ${sitemapUrls.urls.length} sitemap URLs in ${sitemapUrls.maps} file(s)`, probs);
  }
  // 12. closed label → target list.
  {
    const probs = []; const seen = collectLabels(P);
    for (const [key, where] of seen) {
      const [label, target] = JSON.parse(key);
      if (!(LABELS[label] || []).includes(target)) probs.push(`not approved: "${label}" → ${target} (on ${[...where].slice(0, 3).join(', ')}${where.size > 3 ? '…' : ''})`);
    }
    const stale = Object.entries(LABELS).flatMap(([l, ts]) => ts.filter((t) => !seen.has(JSON.stringify([l, t]))).map((t) => `"${l}" → ${t}`));
    add(12, 'closed label/target list', `${seen.size} distinct label→target pairs read; ${stale.length} approved pair(s) not seen${stale.length ? ': ' + stale.slice(0, 3).join('; ') : ''}`, probs);
  }
  return { pages: P.length, stubs: b.stubs.length, results };
}

export function collectLabels(P) {
  const seen = new Map();
  for (const p of P) {
    for (const e of pairs(p.clean, 'a')) {
      const href = attr(e.attrs, 'href'); if (href == null) continue;
      const label = accName(e.attrs, e.inner); if (!label) continue;
      const k = JSON.stringify([label, href]); seen.set(k, (seen.get(k) || new Set()).add(p.url));
    }
    for (const e of pairs(p.clean, 'button')) {
      const label = textOf(e.inner); if (!label) continue; // icon-only buttons are covered by check 7
      const k = JSON.stringify([label, '(button)']); seen.set(k, (seen.get(k) || new Set()).add(p.url));
    }
  }
  return seen;
}

// ── Output ──────────────────────────────────────────────────────────────────
function print(run, { detail = 12 } = {}) {
  for (const r of run.results) {
    const ok = !r.problems.length;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${String(r.id).padStart(2)}  ${r.name} — ${r.read}${ok ? '' : `; ${r.problems.length} problem(s)`}`);
    for (const pr of r.problems.slice(0, detail)) console.log(`          ${pr}`);
    if (r.problems.length > detail) console.log(`          … ${r.problems.length - detail} more`);
  }
  const failed = run.results.filter((r) => r.problems.length).length;
  console.log(`\n${run.results.length - failed} of ${run.results.length} checks pass (${run.pages} pages, ${run.stubs} redirect stubs read).`);
  return failed;
}

// ── Negative tests ──────────────────────────────────────────────────────────
// Each case: optional `prepare` (applied to both control and fault runs), then `fault`.
// Expected: the named check's problem count rises; every other check's count is unchanged.
const edit = (dist, rel, fn) => { const f = path.join(dist, rel); fs.writeFileSync(f, fn(fs.readFileSync(f, 'utf8'))); };
const once = (s, find, repl) => { const i = s.indexOf(find); if (i < 0) throw new Error(`fault anchor not found: ${find}`); return s.slice(0, i) + repl + s.slice(i + find.length); };
const CASES = [
  { check: 1, name: 'second h1 on About', fault: (d) => edit(d, 'about.html', (s) => once(s, '</h1>', '</h1><h1>Injected</h1>')) },
  { check: 2, name: 'h2→h4 jump on Experience', fault: (d) => edit(d, 'experience.html', (s) => once(s, '</h2>', '</h2><h4>Injected</h4>')) },
  { check: 3, name: 'second <footer> on Luxor Aswan', fault: (d) => edit(d, 'retreats/egypt-nile.html', (s) => once(s, '</body>', '<footer></footer></body>')) },
  {
    // Since Phase 1 the build has a real skip link. Moved on every page alike, so the header stays
    // byte-identical across pages and check 5 doesn't move.
    check: 4, name: 'skip link moved after the bar (every page)',
    fault: (d) => { const link = '<a href="#main" class="skip-link">Skip to content</a>';
      for (const p of readBuild(d).pages) edit(d, path.relative(d, p.file), (s) => once(once(s, link, ''), '</header>', '</header>' + link)); },
  },
  { check: 5, name: 'one footer differs by a character (About)', fault: (d) => edit(d, 'about.html', (s) => once(s, 'All rights reserved', 'All rights reserved.')) },
  { check: 6, name: 'curly-quoted class attribute on Geneva', fault: (d) => edit(d, 'retreats/geneva.html', (s) => once(s, '</body>', '<span class=“oops”></span></body>')) },
  { check: 7, name: 'empty <button> on Morocco', fault: (d) => edit(d, 'retreats/morocco.html', (s) => once(s, '</body>', '<button type="button"></button></body>')) },
  { check: 8, name: '<img> without alt on Provence', fault: (d) => edit(d, 'retreats/provence.html', (s) => once(s, '</body>', '<img src="/images/branding/solscape-logo.png"></body>')) },
  { check: 9, name: 'missing image file on Exotic', fault: (d) => edit(d, 'retreats/exotic.html', (s) => once(s, '</body>', '<img src="/images/missing-file.webp" alt=""></body>')) },
  { check: 10, name: 'inbound reference to retired /retreats/kenya (Winter Wonderland)', fault: (d) => edit(d, 'retreats/winter-wonderland.html', (s) => once(s, '</head>', '<link rel="prefetch" href="/retreats/kenya"></head>')) },
  { check: 11, name: 'Contact dropped from the sitemap', fault: (d) => edit(d, 'sitemap-0.xml', (s) => s.replace(/<url><loc>https:\/\/solscaperetreats\.com\/contact<\/loc><\/url>/, '')) },
  { check: 12, name: 'label "Our Story" → "Our story" on the homepage', fault: (d) => edit(d, 'index.html', (s) => once(s, '>Our Story<', '>Our story<')) },
];
function copyDir(src, dst) { fs.cpSync(src, dst, { recursive: true }); }
function negative(dist) {
  const live = runAudit(dist);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'solscape-audit-neg-'));
  const counts = (run) => Object.fromEntries(run.results.map((r) => [r.id, r.problems.length]));
  let passed = 0; const lines = [];
  try {
    const base = path.join(tmp, 'control'); copyDir(dist, base);
    const ctl = counts(runAudit(base)); const liveC = counts(live);
    const same = Object.keys(liveC).every((k) => liveC[k] === ctl[k]);
    lines.push(`control: unmodified scratch copy ${same ? 'matches' : 'DOES NOT match'} the live build (${Object.values(ctl).join(' ')})`);
    if (!same) { console.log(lines.join('\n')); return 1; }
    for (const c of CASES) {
      const dir = path.join(tmp, `case-${c.check}`); copyDir(dist, dir);
      if (c.prepare) c.prepare(dir);
      const before = counts(runAudit(dir));
      c.fault(dir);
      const after = counts(runAudit(dir));
      const rose = after[c.check] > before[c.check];
      const others = Object.keys(after).filter((k) => +k !== c.check && after[k] !== before[k]);
      const ok = rose && !others.length;
      if (ok) passed++;
      lines.push(`${ok ? 'ok  ' : 'BAD '} check ${String(c.check).padStart(2)} ← ${c.name}: ${before[c.check]} → ${after[c.check]} problem(s)${others.length ? `; also moved: ${others.map((k) => `#${k} ${before[k]}→${after[k]}`).join(', ')}` : '; no other check moved'}`);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  console.log(lines.join('\n'));
  console.log(`\n${passed} of ${CASES.length} faults failed as expected (scratch copies in ${os.tmpdir()}, removed).`);
  return passed === CASES.length ? 0 : 1;
}

// ── CLI ─────────────────────────────────────────────────────────────────────
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const di = args.indexOf('--dist');
  const dist = path.resolve(di >= 0 ? args[di + 1] : path.join(ROOT, 'dist'));
  if (args.includes('--print-labels')) {
    const seen = collectLabels(readBuild(dist).pages);
    for (const [k, where] of [...seen].sort()) { const [l, t] = JSON.parse(k); console.log(`${JSON.stringify(l)} → ${t}   (${where.size} page(s))`); }
    process.exit(0);
  }
  if (args.includes('--negative')) process.exit(negative(dist));
  console.log(`SolScape audit — ${dist}\n`);
  process.exit(print(runAudit(dist)) ? 1 : 0);
}
