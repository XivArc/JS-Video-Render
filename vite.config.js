import { defineConfig } from 'vite';

// configure-pages supplies the deployed subfolder; local development uses '/'.
const pagesPath = (process.env.GITHUB_PAGES_BASE_PATH || '').replace(/^\/+|\/+$/g, '');

export default defineConfig({
  base: pagesPath ? '/' + pagesPath + '/' : '/',
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'] },
  worker: { format: 'es' },
});
