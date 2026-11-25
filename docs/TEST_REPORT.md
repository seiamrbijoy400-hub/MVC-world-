# APEX ZERO: NEON VELO — Honest Verification & Test Report
**Date:** 2026-11-26 | **Environment:** Termux/Linux (`node v26.13.1`, `pnpm`, no headless Chromium / Browser Automation MCP / physical Android browser attached)

---

## 1. Typecheck & Production Build — PASS
Command executed after final edits:
`pnpm run build` (`tsc && vite build`)
- **Result:** Exit code `0`
- **Modules:** `64 modules transformed`
- **Bundle Output:** `dist/index.html` (`50.71 kB` / `11.57 kB` gzip), `dist/assets/index-mWQCux-j.js` (`953.14 kB` / `254.93 kB` gzip) in `936ms`
- **TypeScript Errors:** `0`

---

## 2. Automated Headless Simulation, Asset & LAN Tests (`tests/gameplay.test.ts`) — PASS (10/10)
Compiled with `pnpm exec tsc tests/gameplay.test.ts --outDir "$TMPDIR/apx-tests" --module commonjs --moduleResolution node --target ES2022 --esModuleInterop --skipLibCheck --resolveJsonModule` and executed via `NODE_PATH="$PWD/node_modules" node --test "$TMPDIR/apx-tests/tests/gameplay.test.js"` (`10` pass, `0` fail, `0` skipped in `5211.66ms`):

| Test Case | Outcome | What Was Verified |
| :--- | :---: | :--- |
| `CarPhysics`: throttle + nitro acceleration, gears, Stage 3 tuning | **PASS** | Stock Zenvo reaches `>140 km/h` in 5s and shifts through `gear >= 2`; Stage 3 engine + nitro tuning produces strictly higher speed and nitro retention, and survives `applyArchetype('DRIFT')`. |
| `CharacterController`: movement, jump/land, hit stun, KO, revive | **PASS** | Sprint updates position, jump/land triggers `onLand(>3.5)`, non-lethal hit enters `HIT` stun, lethal hit sets `isDead=true`/`KO`, blocks punch during KO, and restores full HP on revive. |
| `OpenWorldMap` & `RoadGraph`: districts, ramps, LOS, pathing | **PASS** | All 5 districts match world coordinates; Touge West/East ramps transition cleanly onto deck; `hasLineOfSight` is blocked by buildings (`AKIBA CYBER`) and open along avenues; `RoadGraph` routes across grid intersections. |
| Crime -> Witness -> Police Dispatch -> Search/Escape -> Arrest | **PASS** | Punched pedestrian switches to `FLEE` while unharmed bystander witnesses (`WITNESS`) and dispatches police at `heat=1`; spawned cruiser is outside all building AABBs; standing by stopped cop triggers `onBusted` fine; breaking LOS behind buildings decays heat and fires `onEscaped`. |
| `SaveManager`: legacy migration, credits economy, rank progression | **PASS** | Older saves migrate cleanly with default `engineStage=0`, `unlockedUnderglows`, XP levels rank 1->2 at 500 XP, and `spendCredits()` clamps cleanly. |
| `WorldActivities`: Rival 1v1 Sprint sequential checkpoints & teardown | **PASS** | Starts sprint with active `nextWpMarker`, emits intermediate `onSprintCheckpoint` updates, ends sprint with win callback, and clears `activeSprint`. |
| `WorldActivities`: repeatable Courier Time-Trial Gold & timeout failure | **PASS** | Starts Courier run, awards Gold multiplier & persists `courierRecords` on timely finish; expires cleanly to `FAILED` beyond `bronzeSec`. |
| `CollisionResolver` & `CarMesh`: impulse, wall-safe push, hazard, shared dispose | **PASS** | Opposite impulses on head-on overlap, character pushed out of hull remains clamped inside world collider, fast vehicle hit damages HP, disposing one `CarMesh` leaves shared textures intact on sibling mesh. |
| Real FBX vehicle assets & audio files + driver visibility toggle | **PASS** | Serves real `public/assets/models/` FBX files (`car 1203.fbx`, `wheel_front_right.fbx`, `wheel_back_right.fbx`) via Node `fetch`, verifies `hqBodyGroup` populates (`fallbackGroup.visible === false`), rear `plate` mesh receives shared license plate map, `CarMesh.setDriverVisible()` toggles cabin driver silhouette, and required WAV files (`low.wav`, `high ACC.wav`, `high Deacc.wav`, `TrackColision.wav`) exist and exceed 1 KB. |
| Live LAN server plugin: HTTP `/api/lan-info` + 2-client WebSocket sync | **PASS** | Boots live HTTP + `ws` server via `lanLobbyPlugin()`, verifies `GET /api/lan-info` HTTP 200 JSON `{ ips, port, preferredUrl }`, runs real Host + Guest WebSocket flow (`WELCOME`, `CREATE_ROOM`, `JOIN_ROOM`, `START_GAME`, `CHAT -> CHAT_MSG`, `PLAYER_STATE -> WORLD_STATE`, `BALL_SYNC`, `MELEE_HIT`), and verifies clean guest disconnect broadcasts `ROOM_STATE` + pruned `WORLD_STATE` removing the departed client's state. |

---

## 3. Not Tested (Requires Live WebGL Browser / Physical Android Hardware) — NOT TESTED
- Live WebGL visual rendering quality (lighting contrast, shadows, curtain-wall building facades, multi-cluster foliage, FBX geometry alignment on GPU canvas, avatar proportions in 3D view).
- Touchscreen multi-finger ergonomics on Android Chrome (joystick + drag camera + pedals + safe-area insets on notched screens).
- Real browser `AudioContext` hardware playback and autoplay resume behavior on mobile touch events.
- Actual GPU FPS, frame times, and thermal behavior across `HIGH`, `MED`, and `LOW` quality tiers.
- Real client UI wiring (`LobbyClient` DOM bindings) across two physical devices over hotspot LAN.
