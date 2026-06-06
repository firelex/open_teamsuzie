import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Starter Vite config. The backend is left unwired — when you add a server,
 * proxy `/api` to it here (see `starter-external-agent-teamsuzie` for an
 * example with env-driven ports).
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
  },
  build: {
    outDir: 'dist',
  },
});
