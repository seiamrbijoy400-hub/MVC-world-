# Two-Device LAN QA Checklist — APEX ZERO: NEON VELO

**Status: NOT TESTED on physical devices.** The automated host-side harness passes
(`pnpm qa:lan`: 12/12 checks), but no hotspot/cable run with two physical devices
has been observed. Run the steps below and record the evidence columns.

## 0. Why the URL matters

The Render app is served over **HTTPS** (`https://mvc-world.onrender.com`). Chrome
blocks an insecure `ws://192.168.x.x` connection from an HTTPS page. For LAN
play, **both devices must open the host's `http://IP:PORT` URL**, not the Render
URL. If a user types a private LAN host into the Render page, the app now shows
an actionable error: *"Open http://IP:PORT directly — HTTPS blocks ws:// LAN hosts."*

## 1. Prepare the host

On the device that will run the central server (laptop or phone with Node.js):

```bash
cd realistic-racing-offline
pnpm install --frozen-lockfile
pnpm run build
APEX_DATA_DIR=.apex-data pnpm start
```

`pnpm start` binds `0.0.0.0` and prints/serves:

```bash
curl http://127.0.0.1:3000/api/lan-info
# {"mode":"LAN","ips":["192.168.43.x"],"port":3000,"preferredUrl":"http://192.168.43.x:3000"}
```

For a fast host-side smoke test before involving phones:

```bash
pnpm qa:lan   # prints the exact LAN URL and 12 PASS/FAIL checks
```

## 2. Physical device matrix

| Step | Device A (host) | Device B (guest) | Expected | Evidence | Status |
| :--- | :--- | :--- | :--- | :--- | :---: |
| 1 | Hotspot / Wi-Fi ON | Joined same hotspot / Wi-Fi | Both get `192.168.x.x` or `10.x` IPs | IP screenshots | NOT TESTED |
| 2 | Opens `http://IP:3000` | Opens `http://IP:3000` | Game loads, LAN badge shows `LAN READY (IP)` | Badge text | NOT TESTED |
| 3 | Lobby → LAN mode → Host Room | Lobby → LAN mode → sees room in list → Join | Both show 2/8 roster, same room code | Room code + roster | NOT TESTED |
| 4 | Change driver to Mika in lobby | Look at roster | Guest sees Mika on A's player slot | Roster text | NOT TESTED |
| 5 | Launch world | Launch world | Both see each other's 3D character moving | Screenshots | NOT TESTED |
| 6 | In-game chat "ping" | Receives chat | Text appears on B within ~1s | Chat log | NOT TESTED |
| 7 | Style drawer → switch to Sora while in game | Look at A's avatar | Model/palette changes on both | Screenshots | NOT TESTED |
| 8 | Room view → 📎 Share File (≤4 MB) | Sees system chat notice + file list | Download works, bytes identical | Shared file hash | NOT TESTED |
| 9 | Try a >4 MB file | — | Rejected with "File too large (max 4 MB)" | Toast text | NOT TESTED |
| 10 | Finish a race on A | Open lobby on B | Top-5 board shows A's score on both | Board text | NOT TESTED |
| 11 | Stop and restart host server | Reopen lobby | Score still present (`.apex-data/leaderboard.json`) | JSON content | NOT TESTED |
| 12 | Both devices → Offline Solo → airplane mode | Same | Solo still playable from cached assets | Screenshots | NOT TESTED |
| 13 | Open Render HTTPS URL, type `192.168.x.x:3000` as LAN host | — | Clear error, no silent failure | Toast text | NOT TESTED |

## 3. Evidence format

Record for each row:

```
Device A: <model>, <browser>, <IP>
Device B: <model>, <browser>, <IP>
Room: #<code>   Time: <UTC>
Result: PASS | FAIL   Detail: <text/screenshot name>
```

Screenshots can be attached to the session, but **text/log descriptions are more
useful here** — this model cannot read image inputs.

## 4. Known limits (not bugs to re-test)

- Central storage is memory + a leaderboard JSON file. Shared file bytes stay in
  RAM and expire after 30 minutes; room state is not restored after restart.
- Render free tier has an ephemeral disk and no `APEX_DATA_DIR`, so its live
  `/api/leaderboard` correctly reports `"persistent":false`.
- No mDNS/UDP auto-discovery: the host URL or room code must be shared manually.
- No voice chat, no private DMs, no cross-room file access.
- Auto-discovery of LAN through a cloud-hosted page is intentionally blocked by
  browser mixed-content rules (see step 13).
