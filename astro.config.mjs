import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://solscaperetreats.com',
  base: '/',
  output: 'static',
  build: {
    format: 'file',
  },
  // Archived retreats move under /retreats/past/; keep their old URLs working.
  // Kenya was removed (2026-11-17); its old URL lands on the upcoming grid.
  // Croatia, Spain and Tuscany were removed (2026-11-18, Phase 0); their old URLs land on Experience.
  redirects: {
    '/retreats/greece': '/retreats/past/greece',
    '/retreats/kenya': '/#retreats',
    '/retreats/past/croatia': '/experience',
    '/retreats/past/spain': '/experience',
    '/retreats/past/tuscany': '/experience',
  },
  integrations: [sitemap()],
});
