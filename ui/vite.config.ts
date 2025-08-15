import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Build to "build" so core-service can serve it from UI_DIST
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'build',
    sourcemap: false,
    emptyOutDir: true
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
