# APEX ZERO: NEON VELO — Implementation Roadmap
**Date:** 2026-11-26 | **Build:** Clean (`tsc && vite build`, 64 modules, `936ms`) | **Automated Tests:** 10/10 Pass (`tests/gameplay.test.ts`)

---

## Completed Sprints
- **Sprint 3 & 4:** Ghost pitch fix, shard 3D pickup radius, drift zone ground sampling, Harbor seawall & Touge ramp gap alignment, unmirrored building signs + per-face UV scaling, Nitro touch/tachometer HUD, input blur safety, District discovery.
- **Sprint 4.5 (Checkpoint `bb7c08b`):** `RoadGraph.ts` Dijkstra routing & building `hasLineOfSight()`, `PedestrianSystem.ts` (14 patrolling NPCs, crime witness & fleeing), stopped traffic/police hijacking, `CarMesh.dispose()` & `HumanCharacterMesh.dispose()`, hit stun & prone KO poses, footstep/jump/land/punch/door SFX.
- **Sprint 5 (`03e6334`):**
  - Fixed `CarPhysics` rear traction clamping so Stage 1–3 Engine & Nitro tuning deliver measurable acceleration/speed (`CarPhysics.ts`).
  - Fixed `PoliceSystem` unreachable `onEscaped` reward (`clearHeat` ordering), blind/non-omniscient spawn & search navigation (`lastKnownPos`, `goalDist`).
  - Added Drift Garage & Tuning Shop (`index.html`, `SaveManager.ts`, `main.ts`) + sequential Rival Sprint checkpoint beacons + full Neo Velo street minimap (`HUD.ts`).
  - Created initial 6-test headless Node simulation suite (`tests/gameplay.test.ts`).
- **Sprint 6 (`bc3efd0`):**
  - Eliminated GPU texture leaks on `HumanCharacterMesh`, `RaceBotAI`, `CarMesh`, and deduplicated `OpenWorldMap` textures/materials.
  - Extracted `GarageController` (`src/game/GarageController.ts`) and `CollisionResolver` (`src/physics/CollisionResolver.ts`).
  - Added 3 repeatable **Street Courier Time-Trial Contracts** and expanded simulation suite to 8/8 passing tests.
- **Sprint 7 (Current — Craft, Lighting, Silhouette & Real LAN/FBX Verification):**
  - **Architectural & World Visual Overhaul (`OpenWorldMap.ts`):** Upgraded roads with asphalt speckle aggregate, tire wear paths, concrete curbs, and warm centerlines; replaced flat neon-grid walls with curtain-wall mullion/spandrel facades, parapet roofs, recessed warm shopfront alcoves, multi-cluster foliage trees in planters, instanced street benches, dual-arm streetlamps with ground light pools, and corrugated Harbor containers.
  - **Vehicle & Character Craft (`CarMesh.ts`, `HumanCharacterMesh.ts`, `main.ts`):** Added shared Neo Velo rear license plate texture on FBX `plate` mesh, brushed gunmetal grille finish, toggleable seated driver cabin silhouette (`setDriverVisible`), tailored jacket lapel collars + refined adult eye/brow proportions, and high-contrast Day/Sunset/Night lighting balance (`ambientLight` `0.26`/`0.22`/`0.16`, `sunLight` `2.15`/`1.85`/`0.78`).
  - **Tactical HUD, Mobile Polish & LAN Reliability (`index.html`, `SoundManager.ts`, `lanLobbyPlugin.ts`):** Replaced top HUD & drawer emoji icons with crisp SVG stroke icons, protected notch safe areas on `#mobile-controls`/`#foot-controls`, hardened mobile `AudioContext` gesture unlock until `running`, and fixed stale peer ghost cleanup by broadcasting pruned `WORLD_STATE` on disconnect.
  - **Expanded Automated Verification (`tests/gameplay.test.ts`):** Added real FBX asset load/mesh verification, WAV audio presence checks, and live 2-client WebSocket + HTTP `/api/lan-info` end-to-end tests (`10/10` pass).

---

## Next Priorities
### Sprint 8 — Live Browser / Android Hardware QA
1. **Live WebGL Visual & Touch Inspection (HIGHEST VALUE):** Boot `pnpm dev` / `pnpm preview` in a real WebGL-capable Chromium/Android browser (or enable Browser Automation MCP) to verify shader/lighting balance, FBX framing, touch ergonomics, and frame times across `HIGH`/`MED`/`LOW`.
2. **Audio Playback & Hotspot Two-Device Trial:** Verify live engine/drift/collision WAV mixing and physical Android hotspot LAN pairing (`LobbyClient.ts`).
3. **Optional `GameApp` Decomposition:** Extract `MultiplayerSync` from `src/main.ts` if expanding online gameplay modes further.

---

## Sprint 8 — Mobile Lifecycle & Adaptive Resolution (in progress)
- Added `AdaptiveResolution` governor (`src/game/AdaptiveResolution.ts`) + unit test; wired into render loop.
- Mobile lifecycle hardening: audio pause/resume + save flush on background/pagehide, frame-clock reset on return, orientation/visualViewport resize, throttled max-speed saves.
- Jump take-off SFX dedup; cancelable `preventDefault` guard; cheaper `PCFShadowMap`.
- Verification: `pnpm run build` clean, `11/11` tests pass. Live WebGL/Android hardware QA still requires a real browser (not available in this environment).
