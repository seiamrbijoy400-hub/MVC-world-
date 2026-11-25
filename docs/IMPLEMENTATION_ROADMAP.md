# APEX ZERO: NEON VELO — Implementation Roadmap
**Date:** 2026-11-26 | **Build:** Clean (`tsc && vite build`, 62 modules) | **Sim Tests:** 6/6 Pass (`tests/gameplay.test.ts`)

---

## Completed Sprints
- **Sprint 3 & 4:** Ghost pitch fix, shard 3D pickup radius, drift zone ground sampling, Harbor seawall & Touge ramp gap alignment, unmirrored building signs + per-face UV scaling, Nitro touch/tachometer HUD, input blur safety, District discovery.
- **Sprint 4.5 (Checkpoint `bb7c08b`):** `RoadGraph.ts` Dijkstra routing & building `hasLineOfSight()`, `PedestrianSystem.ts` (14 patrolling NPCs, crime witness & fleeing), stopped traffic/police hijacking, `CarMesh.dispose()` & `HumanCharacterMesh.dispose()`, hit stun & prone KO poses, footstep/jump/land/punch/door SFX.
- **Sprint 5 (Current):**
  - Fixed `CarPhysics` rear traction clamping so Stage 1–3 Engine & Nitro tuning deliver measurable acceleration/speed (`CarPhysics.ts`).
  - Fixed `PoliceSystem` unreachable `onEscaped` reward (`clearHeat` ordering), blind/non-omniscient spawn & search navigation (`lastKnownPos`, `goalDist`).
  - Added Drift Garage & Tuning Shop (`index.html`, `SaveManager.ts`, `main.ts`) giving `₡` credits real mechanical/visual progression + Career Stats view.
  - Added Rival Sprint sequential checkpoint beacons (`nextWpMarker`), GPU disposal on sprint end/cancel (`WorldActivities.ts`), and minimap checkpoint markers.
  - Fixed assaulted pedestrian behavior (`markVictimFlee`), on-foot collision/damage with all moving vehicles, car vs `SparringFighter` collision, `ownZenvo` GP race restore, and full Neo Velo street/Touge/Harbor minimap rendering (`HUD.ts`).
  - Created headless Node simulation suite (`tests/gameplay.test.ts`) verifying 6 core gameplay systems end-to-end.

---

## Next Priorities
### Sprint 6 — Real Device QA, Performance & Modularization
1. **Live Browser / Android Chrome QA (HIGHEST VALUE):** Run `pnpm dev` / `pnpm preview` on target Android phone to measure real FPS across `HIGH`/`MED`/`LOW`, verify multi-touch steering + pedal/joystick ergonomics, verify FBX HQ car model loading, and check HUD safe-area clearances.
2. **Modularize `src/main.ts`:** Extract `GarageController`, `CollisionResolver`, and `SessionManager` out of the 2,500-line `GameApp` class.
3. **GPU Draw-Call Reduction for Mobile (`OpenWorldMap.ts`):** Share building window atlas textures across palette buckets instead of 2 `256×512` textures per building; verify draw calls with `renderer.info`.
4. **LAN Multiplayer Verification:** Test two devices on Android hotspot using `server/lanLobbyPlugin.ts` WebSocket sync (character appearance, combat hits, ball sync).
5. **Gameplay Depth:** Add repeatable Time-Trial / Delivery Sprint contracts at Harbor Cargo & Drift Garage once modularization lands.
