import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { lanLobbyPlugin } from './server/lanLobbyPlugin.ts';

/** Precache the actual hashed entry chunks so a fresh SW install is offline-complete. */
function precacheChunksPlugin(): Plugin {
  let chunks: string[] = [];
  return {
    name: 'apex-zero-precache',
    apply: 'build',
    generateBundle(_options, bundle) {
      chunks = Object.keys(bundle).filter((file) => /\.(js|css)$/.test(file));
    },
    closeBundle() {
      const swPath = path.resolve(process.cwd(), 'dist', 'sw.js');
      if (!fs.existsSync(swPath)) return;
      const shell = ['./', './index.html', './manifest.webmanifest', ...chunks.map((file) => `./${file}`)];
      const source = fs.readFileSync(swPath, 'utf8');
      const updated = source.replace(/const SHELL = \[[^\]]*\];/, `const SHELL = ${JSON.stringify(shell)};`);
      if (updated !== source) fs.writeFileSync(swPath, updated);
    }
  };
}

export default defineConfig({
  // Relative build URLs make the offline PWA work from a project subpath too.
  base: './',
  plugins: [lanLobbyPlugin(), precacheChunksPlugin()],
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
    outDir: 'dist',
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'vendor-three',
              test: /node_modules\/three/
            }
          ]
        }
      }
    }
  }
});
