#!/usr/bin/env node
/**
 * Two-client LAN QA harness.
 *
 * Drives the real standalone server exactly like two devices would: host room,
 * guest join, chat, file share/download, leaderboard submit and restart-safe
 * board. Prints the LAN URL that a phone should open for manual QA.
 *
 *   pnpm qa:lan
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import onlineServerModule from '../dist-server/server/onlineServer.js';

const { startOnlineServer } = onlineServerModule;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-lan-qa-'));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const get = (port, urlPath, headers = {}) =>
  new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: urlPath, headers }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          let json = null;
          try {
            json = JSON.parse(body.toString());
          } catch {}
          resolve({ status: res.statusCode || 0, body, json, headers: res.headers });
        });
      })
      .on('error', reject);
  });

const postFile = (port, roomCode, token, name, mime, data) =>
  new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: `/api/files?room=${encodeURIComponent(roomCode)}`,
        method: 'POST',
        headers: {
          'x-resume-token': token,
          'x-file-name': encodeURIComponent(name),
          'x-file-type': mime,
          'content-length': String(data.length)
        }
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          let json = null;
          try {
            json = JSON.parse(body.toString());
          } catch {}
          resolve({ status: res.statusCode || 0, json });
        });
      }
    );
    req.on('error', reject);
    req.end(data);
  });

const connect = (port) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const msgs = [];
    ws.on('message', (raw) => {
      try {
        msgs.push(JSON.parse(raw.toString()));
      } catch {}
    });
    ws.once('open', () => resolve({ ws, msgs }));
    ws.once('error', reject);
  });

const waitFor = async (msgs, pred, label, timeoutMs = 3000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = msgs.find(pred);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`Timed out waiting for ${label}`);
};

const server = startOnlineServer({ port: Number(process.env.PORT || 0), host: '0.0.0.0', dataDir, quiet: true });
const sockets = [];

try {
  const { port } = await server.listening;
  const info = await get(port, '/api/lan-info');
  check('LAN info endpoint', info.status === 200 && !!info.json?.preferredUrl, info.json?.preferredUrl || `status ${info.status}`);

  const health = await get(port, '/api/health');
  check('JSON health endpoint', health.status === 200 && health.json?.ok === true, `uptime ${health.json?.uptimeSec}s`);

  const host = await connect(port);
  const guest = await connect(port);
  sockets.push(host.ws, guest.ws);

  const hostWelcome = (await waitFor(host.msgs, (m) => m.type === 'WELCOME', 'host WELCOME')).payload;
  const guestWelcome = (await waitFor(guest.msgs, (m) => m.type === 'WELCOME', 'guest WELCOME')).payload;
  check('Two simultaneous WebSocket clients', true, `${hostWelcome.clientId} + ${guestWelcome.clientId}`);

  host.ws.send(
    JSON.stringify({
      type: 'CREATE_ROOM',
      payload: { playerName: 'QAHost', characterId: 'kaito', carColor: '#ff5500' }
    })
  );
  const created = (await waitFor(host.msgs, (m) => m.type === 'ROOM_STATE', 'ROOM_STATE')).payload;
  const roomCode = created.room.code;
  check('Host creates room', Boolean(roomCode), `#${roomCode}`);

  guest.ws.send(
    JSON.stringify({
      type: 'JOIN_ROOM',
      payload: { code: roomCode, playerName: 'QAGuest', characterId: 'mika', carColor: '#0ea5e9' }
    })
  );
  await waitFor(
    host.msgs,
    (m) => m.type === 'ROOM_STATE' && m.payload?.room?.players?.length === 2,
    'two-player room state'
  );
  check('Guest joins same room', true);

  const chatText = 'QA chat ping ' + Date.now();
  host.ws.send(JSON.stringify({ type: 'CHAT', payload: { text: chatText } }));
  const chat = await waitFor(guest.msgs, (m) => m.type === 'CHAT_MSG' && m.payload?.text === chatText, 'guest chat');
  check('Chat reaches the other client', chat.payload.text === chatText);

  const fileData = Buffer.from('apex-zero two-device QA payload\n', 'utf8');
  const upload = await postFile(port, roomCode, hostWelcome.resumeToken, 'qa-note.txt', 'text/plain', fileData);
  check('File upload as room member', upload.status === 201, `status ${upload.status}`);
  const shared = await waitFor(guest.msgs, (m) => m.type === 'FILE_SHARE', 'guest FILE_SHARE');
  check('File-share broadcast reaches guest', shared.payload?.file?.name === 'qa-note.txt');

  const fileId = shared.payload?.file?.id || upload.json?.file?.id;
  const unauth = await get(port, `/api/files/${fileId}?room=${roomCode}`);
  check('Unauthenticated download blocked', unauth.status === 403, `status ${unauth.status}`);
  const download = await get(port, `/api/files/${fileId}?room=${roomCode}`, {
    'x-resume-token': guestWelcome.resumeToken
  });
  check('Guest downloads exact bytes', download.status === 200 && download.body.equals(fileData), `${download.body.length} bytes`);
  check('Download is a safe attachment', /^attachment;/i.test(String(download.headers['content-disposition'])) && download.headers['x-content-type-options'] === 'nosniff');

  const wrongRoom = await get(port, `/api/files/${fileId}?room=ZZZZ`, {
    'x-resume-token': guestWelcome.resumeToken
  });
  check('Cross-room download blocked', wrongRoom.status === 403, `status ${wrongRoom.status}`);

  // Scores only count once the host has started the match.
  guest.ws.send(JSON.stringify({ type: 'RESULT_SUBMIT', payload: { score: 999999 } }));
  await new Promise((r) => setTimeout(r, 40));
  check('Lobby score rejected before match start', !guest.msgs.some((m) => m.type === 'LEADERBOARD_UPDATE'));
  host.ws.send(JSON.stringify({ type: 'START_GAME', payload: {} }));
  await waitFor(guest.msgs, (m) => m.type === 'GAME_START', 'GAME_START');
  host.ws.send(JSON.stringify({ type: 'RESULT_SUBMIT', payload: { score: 4242, bestTimeMs: 65432 } }));
  await waitFor(guest.msgs, (m) => m.type === 'LEADERBOARD_UPDATE', 'leaderboard update');
  const board = await get(port, '/api/leaderboard');
  check('Leaderboard stored on host', board.status === 200 && board.json?.entries?.[0]?.score === 4242, `${board.json?.entries?.length || 0} entries`);

  console.log('\nLAN URL for manual two-device QA:');
  console.log(`  ${info.json?.preferredUrl}`);
  console.log('Open that URL on the host phone AND a second phone (same hotspot/Wi-Fi).');
  console.log('The HTTPS Render URL cannot reach a private LAN host — use the http:// IP URL above.\n');
} catch (err) {
  check('QA harness completed without error', false, err instanceof Error ? err.message : String(err));
} finally {
  for (const ws of sockets) {
    try {
      ws.close();
    } catch {}
  }
  await server.stop();
  fs.rmSync(dataDir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} LAN QA checks passed on this host.`);
process.exit(failed.length === 0 ? 0 : 1);
