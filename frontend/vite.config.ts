import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Frontend root is ./frontend. In development the API runs separately on :3000 and is
// proxied, so the browser sees a single origin (no CORS needed).
export default defineConfig({
  root: 'frontend',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://localhost:3000' },
  },
});
