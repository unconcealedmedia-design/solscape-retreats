# SolScape Retreats — Website Operating Manual

## Role

You are helping build and maintain the **SolScape Retreats** website: a women's
wellness-retreat brand built around **Movement · Travel · Connection** (yoga, barre,
breathwork, and intentional travel). The site is being elevated from hand-written HTML
into a structured **Astro** site with a **visual CMS**, so the founders can edit content
without touching code.

Your job is to make precise, well-crafted changes — **one section at a time** — that match
the brand and read beautifully on mobile. The standard is *editorial and intentional*,
never generic. Before any visual work, read `references/brand.md` and
`references/design-system.md`, and use the **frontend-design skill**.

## Workflow — follow this order, every time

1. **Understand** — Restate the change in one sentence. Don't touch code yet.
2. **Check references** — Read `references/brand.md` and `references/design-system.md`.
3. **Scope to ONE thing** — One section, one page, or one component. Never "redesign the
   whole site" in a single pass — that is where output goes generic and drifts off-brand.
4. **Edit** — Make the change. Keep copy untouched unless explicitly asked.
5. **Preview** — Run the dev server and confirm it renders. Check mobile width.
6. **Audit** — Run the `design-audit` skill: brand match, mobile, accessibility,
   straight-quotes, no broken links.
7. **Log** — Append a one-line entry to `decisions/log.md` explaining *why*.
8. **Ship** — Only after the user approves: commit, push, confirm the deploy.

## Hard Rules — never break these

- **Straight quotes only** in HTML/markup attributes. Curly quotes (`"` `"`) silently break
  attributes — this already happened in the old `about.html` and broke the Nada card. Lint for it.
- **Content lives in `content/`** — not in markup. Never edit retreat or bio text inside a
  template. If asked to change wording, edit the matching file in `content/`.
- **Nav and footer are ONE component each** — never copy-paste them into pages again.
- **Colors and type use CSS variables only** — never hardcode a hex value or font name.
  The source of truth is `:root` in the global stylesheet.
- **Images go in `images/<section>/`** with descriptive, lowercase, hyphenated names and
  meaningful `alt` text. Optimize before committing.
- **Retreat status drives everything** — each retreat has `status: upcoming` or
  `status: past`. The site sorts and displays based on this. To "archive" a retreat, flip
  this one field — never delete the file.
- **Booking is inquiry-based** — every booking CTA points to Instagram DM
  (`https://ig.me/m/solscape_retreats`) and email (`solscaperetreats@gmail.com`). There is
  no checkout. Never invent one.
- **Never deploy without explicit approval** — wait for "ship it" / "push it" / "deploy".

## Tech Stack

- **Framework**: Astro (static output) — keeps the existing HTML/CSS structure, adds content
  collections and reusable components.
- **Type**: Cormorant Garamond (display serif) + Jost (sans). Already loaded via Google Fonts.
- **CMS**: Sveltia CMS (Decap-config-compatible). Auth via GitHub OAuth, or DecapBridge if the
  founders need passwordless login without a GitHub account.
  > NOTE: Netlify Identity / Git Gateway is **deprecated** — do NOT use it. Confirm the current
  > recommended auth in the Sveltia/Decap docs before wiring login.
- **Host**: Netlify (already in use for forms). Static build, auto-deploy on push.

## Content Model — the retreat schema

Each file in `content/retreats/` carries this frontmatter:

```yaml
title: "Peloponnese"          # the place
country: "Greece"
status: "upcoming"            # upcoming | past  ← drives sorting
oneWord: "exhale"             # the single-word motif (lowercase)
dates: "October 4–8, 2026"
year: 2026
activities: ["Yoga", "Coastal", "Sound Healing"]
heroImage: "/images/retreats/greece/hero.jpg"
gallery: ["/images/retreats/greece/01.jpg", "..."]
summary: "Ancient stone villages, quiet coastlines, and daily movement..."
priceFrom: ""                 # optional
bookingNote: ""               # optional
```

Body of the file = the long-form retreat description, in plain markdown.

## Project Structure

```
solscape-retreats/
├── CLAUDE.md                 ← this file
├── content/                  ← everything the founders edit
│   ├── site.md                 (tagline, nav labels, footer, contact links)
│   ├── founders.md             (Nada & Samantha bios)
│   └── retreats/*.md           (one file per retreat; status field = upcoming/past)
├── images/
│   ├── retreats/<place>/        ← drop new photos here
│   ├── founders/
│   └── branding/
├── references/
│   ├── brand.md                 ← who SolScape is, voice, audience
│   └── design-system.md         ← colors, type, motion, components
├── decisions/log.md             ← append-only record of why
├── public/admin/                ← the CMS (config.yml lives here)
└── .claude/skills/
    ├── frontend-design/          (anti-generic UI engine)
    ├── edit-retreat/             ("make Greece past" → flips status)
    ├── swap-photos/              (point at a folder → wires images in)
    └── design-audit/             (brand + mobile + a11y + curly-quote check)
```

## Editing Playbook — common tasks + the prompt to use

See `references/prompt-playbook.md` for the full library. The essentials:

| You want to… | Tell Claude Code… |
|---|---|
| Move a retreat to past | "Make the {Greece} retreat a past retreat." → flips `status` to `past` |
| Add a new retreat | "Add a new upcoming retreat: {details}." → new file in `content/retreats/` |
| Swap photos | "Replace the {Greece} gallery with the images in `images/retreats/greece/`." |
| Edit a bio | "Update {Nada}'s bio in `content/founders.md` to: {text}." |
| Change a headline | "Change the {about} hero headline to: {text}." |

## Deploy Checklist — before every deploy

- [ ] Change is scoped, previewed, and renders on mobile
- [ ] `design-audit` passed (brand, a11y, straight quotes, links)
- [ ] Decision logged in `decisions/log.md`
- [ ] **User has explicitly approved the deploy**
- [ ] Build succeeds locally (`npm run build`)
- [ ] After push: confirm the Netlify deploy went green and spot-check the live page
