import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backendPort = env.PORT || '3001';
  const clientPort = parseInt(env.STARTER_CHAT_CLIENT_PORT || '17276', 10);

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: clientPort,
      proxy: {
        '/api': `http://localhost:${backendPort}`,
      },
    },
    build: {
      outDir: 'dist',
    },
    // `@teamsuzie/*` packages are linked locally (link: deps). Vite's default
    // optimizeDeps pre-bundles them into node_modules/.vite/deps and caches
    // that bundle. When the upstream dist/ updates (e.g. agent-runtime
    // rebuilt after a bug fix), Vite serves the stale cached bundle and the
    // generated app keeps the old behavior. Excluding them tells Vite to
    // serve them fresh from dist on every page load, so a dist rebuild +
    // browser refresh suffices.
    optimizeDeps: {
      exclude: [
        '@teamsuzie/agent-runtime',
        '@teamsuzie/ui',
        '@teamsuzie/legal-research',
      ],
    },
  };
});
