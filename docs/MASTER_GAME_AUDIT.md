# APEX ZERO: NEON VELO — Master Game Audit
**Date:** 2026-11-26 | **Inspector:** Game Director AI | **Verified Build:** Clean (`tsc && vite build`, 72 modules) | **Automated Tests:** 72/72 Pass

---

## Project Identity
- **Game:** APEX ZERO: Neon Velo | **World:** Neo Velo (5 districts)
- **Stack:** Three.js `0.187.0` + TypeScript `5.8.2` + Vite `8.3.8` + `ws` (`pnpm`)
- **Target:** Android mobile browser (offline-capable PWA/web app + optional Vite WebSocket LAN plugin), desktop keyboard + gamepad fallback.

---

## 1. End-to-End Architecture & Ownership (VERIFIED)
- **Game Loop & State (`src/main.ts`, `GameApp`):** Owns Three.js scene/camera/renderer, `GameState` (`OPEN_WORLD`, `COUNTDOWN`, `TIMED_RACE`, `FINISHED`), active vehicle vs on-foot switching, `ownZenvo` vs stolen `parkedCars` & `civicCars`, LAN sync, high-contrast Day/Sunset/Night PBR lighting + PMREM sky reflection, and UI bindings.
- **Physics & Collisions (`CarPhysics.ts`, `CharacterController.ts`, `CollisionResolver.ts`):**
  - `CarPhysics` (180Hz sub-steps, Ackermann steering, Pacejka-style lateral curves, aero downforce, 7-speed + R gearbox `AUTO`/`SEMI`/`MANUAL`, Nitrous Overdrive, `HYPER`/`DRIFT`/`TOUGE` archetypes, Stage 0–3 Engine & Nitro tuning).
  - `CharacterController` (camera-relative walk/sprint, jump/land event, punch cooldown + hit-stun `HIT`, `KO` collapse + delayed revive, out-of-combat HP regen).
  - `CollisionResolver` (car-vs-car separation impulses, wall-clamped pedestrian pushback, velocity-scaled character/fighter impact damage).
- **World, Vehicles, Characters & AI:**
  - `OpenWorldMap.ts` (5 districts via `getDistrictAt()`, AABB `colliders`, Touge ramps/summit, Harbor quay/pier + corrugated containers, Stunt Arena + Rocket-Soccer, architectural curtain-wall buildings with deduplicated textures/materials, multi-cluster foliage trees, instanced streetlamps & benches).
  - `CarMesh.ts` (static cached async FBX loading for `car 1203.fbx` + front/back wheel meshes, rear license plate texture, gunmetal grilles, toggleable seated driver cabin silhouette `setDriverVisible()`, shared underglow/shadow/headlight resources, leak-safe `dispose()`).
  - `HumanCharacterMesh.ts` (articulated PBR fallback rig) + `GLTFCharacterCache.ts` / `GLTFCharacterMesh.ts` / `CharacterAnimationMap.ts` (shared male/female CC BY GLB templates, per-instance skeleton/materials/mixer, native clips for locomotion/sitting/stairs, procedural combat poses layered on top).
  - `RoadGraph.ts`, `PedestrianSystem.ts`, `PoliceSystem.ts`, `RaceBotAI.ts`, `WorldActivities.ts` (4 speed traps, 3 drift zones, 12 shards, 4 1v1 Rival Sprints, 3 repeatable Street Courier Time-Trials).
- **Garage & Persistence (`SaveManager.ts`, `GarageController.ts`):** `localStorage` (`apex_zero_save_v1`) + Drift Garage UI for Stage 0–3 Engine/Nitro upgrades, underglows, heat resprays, and Courier/Sprint telemetry.
- **LAN Multiplayer (`server/lanLobbyPlugin.ts`, `src/network/LobbyClient.ts`):** HTTP `/api/lan-info` hotspot IP discovery + `ws` `/ws` room management, `WORLD_STATE` broadcasting with disconnect state pruning, chat, combat hits, and soccer ball sync.

---

## 2. Resolved Critical & High Bugs (VERIFIED BY TESTS & INSPECTION)
1. **Engine & Nitro Upgrades Clamped by Launch Traction (`CarPhysics.ts`)** — fixed and verified.
2. **Police Escape Reward Unreachable & Omniscient Spawn Telemetry (`PoliceSystem.ts`)** — fixed and verified.
3. **Rival 1v1 Sprints Missing Checkpoint Beacons & Disposal Leaks (`WorldActivities.ts`)** — fixed and verified.
4. **Struck Pedestrian AI State Bug (`PedestrianSystem.ts`, `main.ts`)** — fixed and verified.
5. **Credits Dead Economy (`SaveManager.ts`, `GarageController.ts`, `index.html`)** — fixed and verified.
6. **Texture / Material Leaks in World & Characters (`CarMesh.ts`, `HumanCharacterMesh.ts`, `OpenWorldMap.ts`, `RaceBotAI.ts`)** — fixed and verified via shared-resource disposal test.
7. **LAN Peer Disconnect Ghost State (`server/lanLobbyPlugin.ts`)** — fixed `leaveCurrentRoom()` to broadcast pruned `WORLD_STATE` and verified via live 2-client WebSocket test.
8. **Empty vs Occupied Car Visual Distinction & Amateur Lighting/UI Polish (`CarMesh.ts`, `main.ts`, `OpenWorldMap.ts`, `HumanCharacterMesh.ts`, `index.html`, `SoundManager.ts`)** — implemented and typechecked/built cleanly; visual WebGL framing remains to be observed on a live screen.
9. **Pier jump snap-back & fake water driving (`OpenWorldMap.ts`, `main.ts`, `PoliceSystem.ts`, `RaceBotAI.ts`, `WorldActivities.ts`)** — FIXED: ocean sampler `-1.05`, splash recovery to last safe road for player and all AI cars. Runtime pier drive reached `z=327.97` with 0 backward jumps (was `z≈307` then snapped to `290`).
10. **Time-of-day/AI coherence (`main.ts`, `Shaders.ts`, `WorldActivities.ts`, `PedestrianSystem.ts`, `RaceBotAI.ts`)** — FIXED: `openWorld.setTimeOfDay()` + sun direction + camera-relative sky/water specular; centralized headlights; no timed-race reward farming; rivals clear of colliders; LOS required for bust/punch/witness/danger.
11. **Police navigation (`RoadGraph.ts`, `PoliceSystem.ts`)** — FIXED: 3D node selection, ramp-mouth nodes, cached path following and ramp re-planning. Deck chase reached the target at 1.4m with 6 target changes in 60s; ground detours no longer flip per frame.
12. **World art & governor (`OpenWorldMap.ts`, `TrackEnvironment.ts`, `AdaptiveResolution.ts`)** — FIXED: lamps off the expressway, decks below water, wet-surface coverage, painted edge UVs, bounded adaptive-resolution retry for borderline GPUs.

---

## 3. Remaining Known Weaknesses & Unverified Areas (HONEST AUDIT)
- **Live WebGL Visual Rendering, Mobile Touch & Web Audio Hardware:** Because no browser binary, Android device, or Browser Automation MCP is active in this environment, live GPU shading, FPS across `HIGH`/`MED`/`LOW`, touchscreen multi-finger feel, and real speaker playback remain **NOT TESTED**.
- **Large Monolithic Orchestrator (`src/main.ts`, ~2,400 lines):** Further feature growth should extract `MultiplayerSync` from `GameApp`.
- **Bundle Chunk Size Warning:** `vite build` reports `dist/assets/index-DqIJ4VqU.js` at `1,059.11 kB` (`282.62 kB` gzip) because Three.js + game code sit in a single bundle (`codeSplitting` optional for faster mobile load). Real mobile download/parse time remains **NOT TESTED**.
