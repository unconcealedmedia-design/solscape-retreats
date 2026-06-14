# SolScape Retreats — Design System

> The look, made repeatable. Read before any visual change. Exact token *values* live in
> `:root` of the global stylesheet (`css/styles.css` today) — **that file is the source of
> truth.** The first migration step is to extract those real values into this doc so they
> match exactly. Until then, treat the values below as the intended direction.

## Color

Defined as CSS variables (names confirmed from the existing site):

| Variable | Role |
|---|---|
| `--charcoal` | Dark section backgrounds, primary text on light |
| `--cream` | Light backgrounds, text on dark |
| `--terra` | Terracotta accent — labels, dividers, highlights |
| `--sand` | Warm muted neutral — secondary text, soft fills |

The mood: **sun-washed Mediterranean** — warm earth tones (camel, caramel, terracotta, cream)
with charcoal for depth. The Instagram leans on a muted **sage/olive** as a cool counterpoint —
worth adding as a token (e.g. `--sage`) if not present. Never introduce off-palette colors;
extend the system instead.

> TODO on migration: paste the real hex values from `:root` here.

## Typography

- **Display:** Cormorant Garamond (serif). High-contrast, elegant. Used large for headlines.
  Italic (`<em>`) carries the accent phrase inside a headline — a signature move
  (e.g. "Retreats rooted in movement, *beauty and intentional living*").
- **Body / UI:** Jost (sans). Weights 300–500. Used for body copy, labels, buttons, nav.
- **Section label:** small, uppercase, letter-spaced, often in `--terra` (`.section-label`).
- **Fluid sizing:** headlines use `clamp()` so they scale with viewport. Keep this pattern.
- Generous letter-spacing on short phrases ("move · explore · reconnect").

## Motion — "we slow down on purpose"

This is the brand's tagline *and* its motion principle. Everything moves **slowly and
gently**, like an exhale:

- Long, eased transitions (≈600–900ms, ease-out). Nothing snappy or bouncy.
- Soft fade-and-rise on scroll-in for sections and cards.
- Subtle, slow parallax on hero imagery — a drift, not a ride.
- **Always** respect `prefers-reduced-motion: reduce` — disable non-essential motion.

## Components (observed — reuse, don't reinvent)

- **Nav** — logo left, links + dropdown for Retreats, Instagram + "Book Now" right, hamburger
  + slide-in `mobile-menu` on small screens. Becomes one Astro component.
- **Hero** — `detail-hero` / `hero-bg` (background image) / `hero-overlay` / `hero-content`
  with `.sub` label + headline. Reusable across pages.
- **Buttons** — `.btn .btn-primary` (filled) and `.btn .btn-outline` (ghost).
- **Section pattern** — `.section-label` → `.section-title` (with `<em>` accent) → `.divider`
  → content. Keep this rhythm.
- **Cards** — retreat cards, value tiles, team cards. Drive retreat cards from `content/`.
- **CTA band** — `.cta-band` full-width closing call-to-action.
- **Forms** — newsletter + Netlify contact form, with success states.

## Layout principles

- Editorial, not boxed-template. Use asymmetry and white space with intention.
- Each retreat should feel like *its place* — vary imagery and accent, hold the system.
- Mobile is not an afterthought: design the small screen as carefully as the large.

## Quality bar (what `design-audit` checks)

Straight quotes only · CSS variables only (no stray hex) · descriptive alt text · visible focus
states · labeled inputs · adequate tap targets · `prefers-reduced-motion` honored · no broken
links · headline hierarchy intact · reads beautifully at 375px wide.
