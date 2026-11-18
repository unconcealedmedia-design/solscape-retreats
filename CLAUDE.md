# SolScape Retreats — Website Operating Manual

## Role

You are helping build and maintain the **SolScape Retreats** website: a women's
wellness-retreat brand built around **Movement · Travel · Connection** (yoga, barre,
breathwork, and intentional travel). The site has moved from hand-written HTML to
**Astro** (static) and is hosted on **GitHub Pages**. There is no CMS: all copy is typed
into the page templates, so every content change is a code change.

Your job is to make precise, well-crafted changes — **one section at a time** — that match
the brand and read beautifully on mobile. The standard is *editorial and intentional*,
never generic. Before any visual work, read `references/brand.md` and
`references/design-system.md`. (The frontend-design skill this file used to name is not
installed in this repo.)

## Workflow — follow this order, every time

1. **Understand** — Restate the change in one sentence. Don't touch code yet.
2. **Check references** — Read `references/brand.md` and `references/design-system.md`.
3. **Scope to ONE thing** — One section, one page, or one component. Never "redesign the
   whole site" in a single pass — that is where output goes generic and drifts off-brand.
4. **Edit** — Make the change. Keep copy untouched unless explicitly asked.
5. **Preview** — Run the dev server and confirm it renders. Check mobile width.
6. **Audit** — Check by hand (the `design-audit` skill is not installed): brand match,
   mobile, accessibility, straight-quotes, no broken links.
7. **Log** — Append a one-line entry to `decisions/log.md` explaining *why*.
8. **Ship** — Only after the user approves: commit, push, confirm the deploy. A push to
   `main` is a live deploy.

## Hard Rules — never break these

- **Straight quotes only** in HTML/markup attributes. Curly quotes (`"` `"`) silently break
  attributes — this already happened in the old `about.html` and broke the Nada card. Lint for it.
- **Copy lives in the page templates** — each page's text, dates, prices and image paths
  are typed into its `.astro` file in `src/pages/` (nav and footer in `src/components/`).
  There are no content collections and no content files for copy, so a wording change is
  an edit to that template, touching nothing else in it. The one data folder is
  `content/retreat-galleries/`: the photo lists `RetreatGallery.astro` reads.
- **Nav and footer are ONE component each** — never copy-paste them into pages again.
- **Colors and type use CSS variables only** — never hardcode a hex value or font name.
  The source of truth is `:root` in the global stylesheet.
- **Images go in `public/images/<section>/`** with descriptive, lowercase, hyphenated names
  and meaningful `alt` text. Optimize before committing.
- **Archiving is done by hand** — there is no `status` field. To archive a retreat, move its
  page to `src/pages/retreats/past/`, redirect the old URL in `astro.config.mjs`
  (`redirects`), and take it off the upcoming surfaces: nav dropdown and mobile menu,
  footer, homepage grid, and the "Explore other retreats" strips. The 2026-10-23 Greece
  entry in `decisions/log.md` is the worked example.
- **Booking is inquiry-based** — every booking CTA points to Instagram DM
  (`https://ig.me/m/solscape_retreats`) and email (`solscaperetreats@gmail.com`). There is
  no checkout. Never invent one. There are no forms either: GitHub Pages can't receive
  submissions, so never add one (Netlify or otherwise).
- **Never deploy without explicit approval** — wait for "ship it" / "push it" / "deploy".
  A push to `main` deploys.

## Tech Stack

- **Framework**: Astro 6, static output (`build.format: 'file'`). Pages in `src/pages/`;
  shared `Layout`, `Nav`, `Footer` and `RetreatGallery` components. No content collections.
- **Type**: Cormorant Garamond (display serif) + Jost (sans). Already loaded via Google Fonts.
- **CMS**: none.
- **Host**: GitHub Pages, custom domain `solscaperetreats.com` (`public/CNAME`).
  `.github/workflows/deploy.yml` builds with `withastro/action` and deploys every push to
  `main`. Static only: no form handling and no server redirects (Astro `redirects` emit
  meta-refresh pages).

## Where content lives

There is no content model yet. Copy, dates, prices and photo lists are typed into each
page's template:

- Home, About, Experience, Contact: `src/pages/index.astro`, `about.astro`,
  `experience.astro`, `contact.astro`
- Upcoming retreats: `src/pages/retreats/<slug>.astro`; archived:
  `src/pages/retreats/past/<slug>.astro`
- Nav and footer: `src/components/Nav.astro`, `src/components/Footer.astro`
- Retreat Gallery photos: `content/retreat-galleries/<retreat>.json` (see the README there)

The same text often appears in several places (a retreat's homepage card, its strip cards
on other retreat pages, the founders' bios on About and on retreat pages), so grep `src/`
before and after any wording change.

The root-level `*.html` and `retreats/*.html` files are the old pre-Astro site. They are not
built or deployed; don't edit them.

## Project Structure

```
SolScape Website/
├── CLAUDE.md                     ← this file
├── astro.config.mjs              ← site URL, redirects, sitemap
├── .github/workflows/deploy.yml  ← GitHub Pages deploy on every push to main
├── src/
│   ├── layouts/Layout.astro      ← <head>, GA4, Nav + Footer around every page
│   ├── components/               ← Nav, Footer, RetreatGallery
│   └── pages/                    ← one .astro per page; the copy lives here
│       └── retreats/             ← upcoming retreats; past/ = archived
├── public/                       ← copied into dist/ as-is
│   ├── css/styles.css            ← :root tokens = colour/type source of truth
│   ├── js/main.js                ← shared JS (menu, carousel, lightbox, …)
│   ├── images/<section>/
│   └── CNAME, robots.txt
├── content/retreat-galleries/    ← Retreat Gallery photo lists (JSON) + README
├── references/                   ← brand.md, design-system.md, prompt-playbook.md
├── decisions/log.md              ← append-only record of why
└── *.html, retreats/*.html       ← the OLD pre-Astro site: not built, not deployed
```

There is no `.claude/skills/` folder in this repo: the frontend-design, design-audit,
edit-retreat and swap-photos skills earlier versions of this file named are not installed.

## Editing Playbook — common tasks + the prompt to use

`references/prompt-playbook.md` predates the Astro move and is out of date; use this table.

| You want to… | Tell Claude Code… |
|---|---|
| Archive a retreat | "Archive the {Greece} retreat." → page moves to `retreats/past/`, old URL redirects, it leaves the upcoming surfaces |
| Add a new retreat | "Add a new upcoming retreat: {details}." → new page in `src/pages/retreats/`, plus its nav, footer and homepage card |
| Swap photos | "Replace the {Greece} photos with the images in `public/images/{greece}/`." |
| Edit a bio | "Update {Nada}'s bio to: {text}." → About page, plus the host cards on retreat pages that repeat it |
| Change a headline | "Change the {about} hero headline to: {text}." → edits that page's template |

## Deploy Checklist — before every deploy

- [ ] Change is scoped, previewed, and renders on mobile
- [ ] Audit checks passed by hand (brand, a11y, straight quotes, links)
- [ ] Decision logged in `decisions/log.md`
- [ ] **User has explicitly approved the deploy**
- [ ] Build succeeds locally (`npm run build`)
- [ ] After push: confirm the "Deploy to GitHub Pages" run went green in GitHub Actions and
      spot-check the live page
