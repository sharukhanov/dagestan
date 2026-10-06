import { defineConfig } from 'vite';

// Относительные пути: один и тот же билд работает и на https://<user>.github.io/<repo>/,
// и на собственном домене в корне (https://sharukhanov.com/).
export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 1500 },
});
