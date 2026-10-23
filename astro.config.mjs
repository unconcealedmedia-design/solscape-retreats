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
  redirects: {
    '/retreats/greece': '/retreats/past/greece',
  },
  integrations: [sitemap()],
});
