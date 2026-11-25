# APEX ZERO: NEON VELO — Master Game Audit
**Date:** 2026-11-26 | **Inspector:** Game Director AI | **Verified Build:** Clean (`tsc && vite build`, 62 modules) | **Headless Sim Tests:** 6/6 Pass

---

## Project Identity
- **Game:** APEX ZERO: Neon Velo | **World:** Neo Velo (5 districts)
- **Stack:** Three.js `0.187.0` + TypeScript `5.8.2` + Vite `8.3.8` + `ws` (`pnpm`)
- **Target:** Android mobile browser (offline-capable PWA/web app + optional Vite WebSocket LAN plugin), desktop keyboard + gamepad fallback.

---

## 1. End-to-End Architecture & Ownership (VERIFIED)
- **Game Loop & State (`src/main.ts`, `GameApp`):** Owns Three.js scene/camera/renderer, `GameState` (`OPEN_WORLD`, `COUNTDOWN`, `TIMED_RACE`, `FINISHED`), active vehicle vs on-foot switching, `ownZenvo` vs stolen `parkedCars` & `civicCars`, LAN sync, and UI handlers.
- **Physics:**
  - `CarPhysics.ts` (180Hz sub-steps, Ackermann steering, Pacejka-style lateral curves, aero downforce, 7-speed + R gearbox `AUTO`/`SEMI`/`MANUAL`, Nitrous Overdrive, `HYPER`/`DRIFT`/`TOUGE` archetypes, Stage 0–3 Engine & Nitro tuning).
  - `CharacterController.ts` (camera-relative walk/sprint, jump/land event, punch cooldown + hit-stun `HIT`, `KO` collapse + delayed revive, out-of-combat HP regen).
- **World & AI:**
  - `OpenWorldMap.ts` (5 districts via `getDistrictAt()`, AABB `colliders`, ramps, Touge elevated summit, Harbor quay + pier, Stunt Arena + Rocket-Soccer pitch, smashable cones, anime water shader).
  - `RoadGraph.ts` (Dijkstra intersection routing + 2D segment-vs-AABB `hasLineOfSight()`).
  - `PedestrianSystem.ts` (14 patrol civilians on sidewalks, near-miss flee, vehicle impact, victim `FLEE` vs bystander `WITNESS` line-of-sight police call-in, distance culling >110m/80m).
  - `PoliceSystem.ts` (0–5 wanted stars, building/unit-safe dispatch, LOS vs searching `lastKnownPos`, road-graph pursuit, on-foot bust meter, natural escape reward decay, stealable cruisers).
  - `RaceBotAI.ts` (`RaceBot`, lane-keeping `CityCruiserBot` with pedestrian yielding & horn challenges, leashed `SparringFighter`).
  - `WorldActivities.ts` (4 speed traps, 3 reactive drift zones, 12 3D-reachable Apex Log shards, 4 sequential-checkpoint 1v1 Rival Sprints with live beacon & resource disposal).
- **Persistence (`SaveManager.ts`):** `localStorage` (`apex_zero_save_v1`) with legacy-safe defaults for rank XP, `credits`, tuning stages (`engineStage`, `nitroStage`), `unlockedUnderglows`, trap/drift/shard/district/rival records, and best-lap ghost frames.

---

## 2. Resolved Critical & High Bugs (VERIFIED BY INSPECTION & SIMULATION TESTS)
1. **Engine & Nitro Upgrades Clamped by Launch Traction (`CarPhysics.ts`):** `maxRearTraction` previously capped total long force to static `1.65× rearLoad`, completely erasing Stage 1–3 torque and nitro gains in gears 1–4. Fixed by scaling tire traction with `engineStage` and adding `nitroJetForce` outside the tire slip clamp.
2. **Police Escape Reward Unreachable (`PoliceSystem.ts`):** `update()` decremented `this.heat` to `0` before calling `this.clearHeat(true)`, making `const hadHeat = this.heat > 0` always `false` and blocking `onEscaped`. Fixed cleanly.
3. **Police Omniscient Search Telemetry (`PoliceSystem.ts`):** `spawnUnit()` overwrote `lastKnownPos` with current `playerPos` and spawned units within ~35m of hiding players; `driveUnit()` also compared against distance to `playerPos` instead of `goalPos`. Fixed to target `lastKnownPos` when unspotted and avoid popping in beside hidden players.
4. **Rival 1v1 Sprints Missing Checkpoint Beacons & Resource Leaks (`WorldActivities.ts`, `main.ts`):** Sequential waypoints had no visual/minimap indicator other than the distant final finish marker, and `cancelSprint()` leaked `CarMesh` + geometries/materials. Added pulsing gold `nextWpMarker`, minimap checkpoint/rival indicators, and proper GPU disposal.
5. **Struck Pedestrian AI State Bug (`PedestrianSystem.ts`, `main.ts`):** Punched or hit-and-run pedestrians turned into calm `'WITNESS'` callers while stunned. Added `markVictimFlee()` and witness `exclude` parameter so victims flee while uninjured bystanders report crimes.
6. **Traffic / Bot / Fighter Missing Collisions (`main.ts`):** On-foot player previously ignored `cityCruisers` and `raceBots` hulls/impacts; player car drove cleanly through `SparringFighter`s. Added unified on-foot pushback/damage and high-speed fighter impacts.
7. **Credits Dead Economy (`SaveManager.ts`, `index.html`, `main.ts`):** Added Drift Garage & Tuning shop (`#garage-modal` + in-world Drift Garage prompt) to spend `₡` credits on Stage 1–3 Engine/Nitro upgrades, unlockable underglow kits, and police heat resprays, plus Career Stats visibility.
8. **Stolen Car vs GP Race Ownership & Settings Sync (`main.ts`):** Tracked `ownZenvo` separately so GP races always restore the player's tuned Zenvo, retained gearbox/assist preferences across stolen vehicles (`configureActiveCar()`), and preserved police cruiser lightbar flashing (`H` toggles strobes).
9. **Blind City Minimap (`HUD.ts`):** Expanded minimap canvas to render Neo Velo avenues/streets, Touge Summit, Harbor Quay/Pier, Stunt Arena, Drift Garage, activity icons, and live sprint waypoints.

---

## 3. Remaining Known Weaknesses & Technical Debt (HONEST AUDIT)
- **Monolithic Orchestrator (`src/main.ts` ~2,500 lines):** Game loop, UI modals, collision checks, and multiplayer sync remain concentrated in `GameApp`. **LIKELY** maintenance bottleneck if adding story missions.
- **High Mesh Material / Canvas Texture Count (`OpenWorldMap.ts`, `HumanCharacterMesh.ts`):** Each building generates its own CanvasTexture (`createBuildingTexture`) + unique materials (~100+ materials across 16 buildings), and pedestrians use unbatched multi-part rigs (~35 meshes/character within 110m). **LIKELY** GPU overhead on low-end Android phones at HIGH quality (partially mitigated by cull distances and Graphics Quality `LOW` shadow disabling).
- **Car Occupant & Interior Visibility:** Player/AI characters remain hidden inside the car (`avatarMesh.root.visible = false`) with tinted `CarMesh` glass (`opacity: 0.78`). **VERIFIED** by inspection.
- **UI/Browser Visuals & Touch Controls:** Multi-touch drag look, safe-area layout, Web Audio mobile unlock, FPS telemetry on real Android Chrome, and LAN WebSocket gameplay are **NOT TESTED** in a live browser/device environment (headless Node only).
