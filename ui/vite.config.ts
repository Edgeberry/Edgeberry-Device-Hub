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
        // Override to point the dev server somewhere else - a different hub,
        // or a local stand-in when reviewing the interface without one:
        //   DEVICEHUB_API=http://127.0.0.1:8099 npm run dev
        target: process.env.DEVICEHUB_API || 'http://192.168.1.116:80',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
