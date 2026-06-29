import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Dev server proxies /api to the starter's Express server (see ../src).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5273,
    proxy: {
      '/api': { target: 'http://localhost:5211', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
  },
});
