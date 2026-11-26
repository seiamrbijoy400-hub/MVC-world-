import { defineConfig } from 'vite';
import { lanLobbyPlugin } from './server/lanLobbyPlugin.ts';

export default defineConfig({
  // Relative build URLs make the offline PWA work from a project subpath too.
  base: './',
  plugins: [lanLobbyPlugin()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    cors: true
  },
  preview: {
    host: '0.0.0.0',
    port: 5174,
    cors: true,
    // Render terminates TLS and forwards HTTP with its public Host header.
    // Vite 8 preview rejects unknown hosts unless they are allowlisted.
    allowedHosts: ['mvc-world.onrender.com']
  },
  build: {
    target: 'esnext',
    outDir: 'dist'
  }
});
