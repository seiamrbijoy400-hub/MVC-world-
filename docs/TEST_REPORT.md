# APEX ZERO: NEON VELO — Honest Verification & Test Report
**Date:** 2026-11-26 | **Environment:** Termux/Linux (`node v26.13.1`, `pnpm`, no headless Chromium / mobile device attached)

---

## 1. Typecheck & Production Build — PASS
Command executed after final edits:
`pnpm run build` (`tsc && vite build`)
- **Result:** Exit code `0`
- **Modules:** `62 modules transformed`
- **Bundle Output:** `dist/index.html` (45.11 kB), `dist/assets/index-CnkbByTV.js` (940.86 kB / 251.57 kB gzip) in `909ms`
- **TypeScript Errors:** `0`

---

## 2. Automated Headless Simulation Tests (`tests/gameplay.test.ts`) — PASS (6/6)
Compiled via `./node_modules/.bin/tsc` and executed with `node --test` against real project TypeScript classes (with minimal in-memory `localStorage`, procedural `<canvas>` mock, and offline `404` fetch stub so Three.js mesh construction runs headless):

| Test Case | Outcome | What Was Verified |
| :--- | :---: | :--- |
| `CarPhysics`: throttle + nitro acceleration, gears, Stage 3 tuning | **PASS** | Stock Zenvo reaches `>140 km/h` in 5s and shifts through `gear >= 2`; Stage 3 engine + nitro tuning produces strictly higher speed and nitro retention, and survives `applyArchetype('DRIFT')`. Caught and fixed real bug where `maxRearTraction` clamped all upgrades to stock launch force. |
| `CharacterController`: movement, jump/land, hit stun, KO, revive | **PASS** | Sprint updates position, jump/land triggers `onLand(>3.5)`, non-lethal hit enters `HIT` stun, lethal hit sets `isDead=true`/`KO`, blocks punch during KO, and restores full HP on revive. |
| `OpenWorldMap` & `RoadGraph`: districts, ramps, LOS, pathing | **PASS** | All 5 districts match world coordinates; Touge West/East ramps transition cleanly (`y ≈ 6.0` at `x=59.9`) onto deck; `hasLineOfSight` is blocked by buildings (`AKIBA CYBER`) and open along avenues; `RoadGraph` routes across grid intersections. |
| Crime -> Witness -> Police Dispatch -> Search/Escape -> Arrest | **PASS** | Punched pedestrian switches to `FLEE` while unharmed bystander witnesses (`WITNESS`) and dispatches police at `heat=1`; spawned cruiser is outside all building AABBs; standing by stopped cop triggers `onBusted` fine; breaking LOS behind buildings decays heat and fires `onEscaped`. Caught and fixed unreachable `onEscaped` and omniscient `spawnUnit` telemetry bugs. |
| `SaveManager`: legacy migration, credits economy, rank progression | **PASS** | Older saves migrate cleanly with default `engineStage=0`, `unlockedUnderglows`, XP levels rank 1->2 at 500 XP, and `spendCredits()` clamps cleanly. |
| `WorldActivities`: Rival 1v1 Sprint sequential checkpoints & teardown | **PASS** | Starts sprint with active `nextWpMarker`, emits intermediate `onSprintCheckpoint` updates, ends sprint with win callback, and clears `activeSprint`. |

---

## 3. Not Tested (Requires Real Browser / Mobile Device) — NOT TESTED
- WebGL visual rendering, lighting, shadows, shader output, car FBX model geometry alignment (`car 1203.fbx`), and human character aesthetics.
- Touch input multi-finger ergonomics on Android Chrome (joystick + drag camera + pedals).
- Web Audio hardware playback & browser autoplay unlock flow.
- Real FPS / frame-time / thermal throttling on Android GPU across `HIGH`, `MED`, `LOW`.
- LAN WebSocket hotspot multiplayer across two physical clients (`LobbyClient` + `server/lanLobbyPlugin.ts`).
