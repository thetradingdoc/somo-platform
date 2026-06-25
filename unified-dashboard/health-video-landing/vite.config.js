import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.HEALTH_API_PROXY || 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  base: '/health-video/',
  build: {
    outDir: 'dist',
    emptyOutDir: true
  },
  server: {
    port: 5174,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/assets': { target: apiTarget, changeOrigin: true },
      '/unified-dashboard': { target: apiTarget, changeOrigin: true },
      '/health-terms.html': { target: apiTarget, changeOrigin: true },
      '/health-privacy.html': { target: apiTarget, changeOrigin: true }
    }
  }
});
