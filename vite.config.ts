import { defineConfig } from 'vite';

// На GitHub Pages сайт живёт по адресу https://<user>.github.io/<repo>/,
// поэтому base берётся из переменной окружения, которую задаёт workflow.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 1500 },
});
