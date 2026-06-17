import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://unconcealedmedia-design.github.io',
  base: '/solscape-retreats',
  output: 'static',
  build: {
    format: 'file',
  },
});
