import fs from 'fs';
import http from 'http';
import path from 'path';
import { createLobbyBackend } from './lanLobbyPlugin';

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const DIST_DIR = path.resolve(process.cwd(), process.env.DIST_DIR || 'dist');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.fbx': 'application/octet-stream',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2'
};

export function startOnlineServer(options?: { port?: number; host?: string; distDir?: string; quiet?: boolean }) {
  const port = options?.port ?? PORT;
  const host = options?.host ?? HOST;
  const distDir = path.resolve(options?.distDir ?? DIST_DIR);
  const quiet = options?.quiet ?? false;
  const backend = createLobbyBackend();

  const server = http.createServer((req, res) => {
    const rawUrl = (req.url || '/').split('?')[0];

    if (rawUrl === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: true, ...backend.getStats() }));
      return;
    }

    if (rawUrl === '/api/lan-info') {
      const addr = server.address();
      const boundPort = typeof addr === 'object' && addr ? addr.port : port;
      const info = backend.getNetworkInfo(req, boundPort);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(info));
      return;
    }

    if (rawUrl === '/api/files' || rawUrl.startsWith('/api/files/')) {
      const parsed = new URL(req.url || '/', 'http://localhost');
      const filePath = parsed.pathname.replace(/^\/api\/files/, '') || '/';
      backend.handleFileRequest(req, res, filePath, parsed.searchParams);
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Method Not Allowed');
      return;
    }

    let relPath = rawUrl === '/' ? 'index.html' : decodeURIComponent(rawUrl).replace(/^\/+/, '');
    const candidate = path.resolve(distDir, relPath);
    if (!candidate.startsWith(distDir)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    let filePath = candidate;
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      const indexFallback = path.join(distDir, 'index.html');
      if (relPath.includes('.') || !fs.existsSync(indexFallback)) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
        return;
      }
      filePath = indexFallback;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    const baseName = path.basename(filePath);
    const cacheControl =
      baseName === 'sw.js' || baseName === 'index.html' || baseName === 'manifest.webmanifest'
        ? 'no-cache, must-revalidate'
        : relPath.startsWith('assets/') && /-[a-zA-Z0-9]{6,}\./.test(baseName)
          ? 'public, max-age=31536000, immutable'
          : 'public, max-age=3600';

    const stat = fs.statSync(filePath);
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': stat.size,
      'Cache-Control': cacheControl
    });

    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    fs.createReadStream(filePath).pipe(res);
  });

  backend.attachWebSocket(server);

  const listening = new Promise<{ port: number }>((resolve) => {
    server.listen(port, host, () => {
      const addr = server.address();
      const boundPort = typeof addr === 'object' && addr ? addr.port : port;
      if (!quiet) {
        console.log(JSON.stringify({ event: 'server_started', host, port: boundPort, distDir }));
      }
      resolve({ port: boundPort });
    });
  });

  const stop = async () => {
    backend.shutdown();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };

  return { server, backend, listening, stop };
}

const isDirectEntry =
  typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module;

if (isDirectEntry) {
  const instance = startOnlineServer();
  const handleSignal = async (signal: string) => {
    console.log(JSON.stringify({ event: 'server_stopping', signal }));
    await instance.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void handleSignal('SIGINT'));
  process.on('SIGTERM', () => void handleSignal('SIGTERM'));
}
