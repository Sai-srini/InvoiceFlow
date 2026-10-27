import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In Docker the API is reachable by its service name; outside Docker set VITE_API_BACKEND=http://localhost:3001.
const backend = process.env.VITE_API_BACKEND || 'http://server:3001';
export default defineConfig({
  plugins: [react()],
  server: { host: '0.0.0.0', port: 5173, proxy: { '/api': { target: backend, changeOrigin: true } } },
});
