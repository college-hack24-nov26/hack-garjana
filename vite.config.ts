import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Where the FastAPI backend (Backend/backend) listens. Override with AUTOTWIN_API in .env.local.
  const env = loadEnv(mode, process.cwd(), '');
  const backend = env.AUTOTWIN_API || 'http://127.0.0.1:8000';

  return {
    plugins: [react()],
    server: {
      port: 5173,
      // Browser calls /api/... on the dev server; Vite forwards them to the backend (no CORS needed).
      proxy: { '/api': { target: backend, changeOrigin: true } },
      // Don't watch the reference frontend, the Python backend (venv, SQLite, storage) or media.
      watch: { ignored: ['**/frontend/**', '**/Backend/**', '**/*.mp4', '**/*.zip'] },
    },
  };
});
