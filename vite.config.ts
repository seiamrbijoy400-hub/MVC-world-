import { defineConfig } from 'vite';
import { lanLobbyPlugin } from './server/lanLobbyPlugin.ts';

export default defineConfig({
  plugins: [lanLobbyPlugin()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    cors: true
  },
  preview: {
    host: '0.0.0.0',
    port: 5174,
    cors: true
  },
  build: {
    target: 'esnext',
    outDir: 'dist'
  }
});
