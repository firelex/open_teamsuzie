import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backendPort = env.STARTER_CHAT_PORT || '16311';
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
  };
});
