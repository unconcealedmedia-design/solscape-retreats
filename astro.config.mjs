import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://solscaperetreats.com',
  base: '/',
  output: 'static',
  build: {
    format: 'file',
  },
  integrations: [sitemap()],
});
