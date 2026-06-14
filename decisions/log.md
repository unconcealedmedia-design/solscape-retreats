# Decisions Log

## 2026-06-14 — Astro scaffold (lift-and-shift, Phase 1)

Installed Astro v6 (static output, `build.format: 'file'`) and converted all 14 HTML pages to `.astro` equivalents in `src/pages/`. Assets (css/, js/, images/, assets/) moved to `public/`. Internal href links converted to absolute extensionless paths; local image `src` and `url()` values converted to root-relative `/images/...`; `<script src>` changed to `<script is:inline src="/js/main.js">`. npm scripts use `node ./node_modules/astro/bin/astro.mjs …` directly to avoid a Windows CMD bug where the `&` in the project directory name breaks npm's `.cmd` wrapper. Original `.html` files kept in place; they no longer render standalone (broken CSS paths after asset move) but are preserved until explicitly deleted.
