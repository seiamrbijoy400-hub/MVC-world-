# APEX ZERO: NEON VELO — Master Game Audit
**Date:** 2026-11-25 | **Inspector:** Game Director AI | **Baseline Build:** ✅ Clean (0 TS errors, 60 modules)

---

## Project Identity
- **IP:** APEX ZERO: Neon Velo | **City:** Neo Velo
- **Stack:** Three.js 0.187 + TypeScript 5.8 + Vite 8.3 | **Target:** Android mobile browser, offline-first
- **Repo:** `master` branch, 7 commits, 9,327 lines of source

---

## 1. What exists and works (VERIFIED by code inspection)

### Physics
- **CarPhysics.ts (729L):** VERIFIED solid. 180Hz sub-step, real Ackermann steering, Pacejka-inspired tire curves, aero downforce, real 7-speed gearbox with auto/semi/manual, drift detection, nitro, archetype variants, NaN guard. Best-in-class for a browser racing game.
- **CharacterController.ts (221L):** VERIFIED. Camera-relative movement, gravity, jump, punch edge-triggering, HP/death/respawn lifecycle, out-of-combat HP regen.

### Graphics
- **HumanCharacterMesh.ts (1235L):** VERIFIED. Full procedural human anatomy (skull lathe, ears, nose, lips, articulated arms/legs/hands with fingers, clothing, hair dynamics, accessories). Eye texture canvas rendering. Nameplate + HP sprite. Speech bubbles. Emoji FX.
- **CarMesh.ts (508L):** LIKELY solid, not read in full.
- **TrackEnvironment.ts (759L):** LIKELY solid GP circuit + countdown lights.
- **OpenWorldMap.ts (1041L):** LIKELY large city with ramps, soccer pitch, buildings, collision.
- **ParticleSystem.ts (243L):** VERIFIED minimal. Sparks + backfire.
- **WeatherSystem.ts (120L):** VERIFIED. Rain/storm particle lines, lightning flash, grip multiplier.
- **Shaders.ts (306L):** NOT READ. Likely custom GLSL.

### Game Systems
- **SaveManager.ts (190L):** VERIFIED. localStorage persistence, versioned, default merge, rank XP/credits system, 6 legend ranks.
- **LapManager.ts (225L):** VERIFIED. Circuit lap timer, drift score + multiplier chain, checkpoint gates, race results.
- **GhostSystem.ts (99L):** VERIFIED. 15Hz recording, interpolated playback, committed on personal best.
- **WorldActivities.ts (562L):** VERIFIED. 4 speed traps, 3 drift zones, 12 Apex Log shards (world lore), 4 rival 1v1 sprint races with AI rival physics.
- **PoliceSystem.ts (340L):** VERIFIED. 5-star heat system, decay, spawn-safe pathing, pursuit AI, stuck/reverse recovery, busted flow.

### AI
- **RaceBotAI.ts (450L):** VERIFIED. RaceBot, CityCruiserBot, SparringFighter. Waypoint-following, stuck recovery.
- **WorldActivities sprint AI:** VERIFIED inline.

### HUD / Input
- **HUD.ts (742L):** VERIFIED. Canvas tachometer, minimap, touch controls, keyboard+gamepad, chat, notifications, wanted stars, KO overlay, profile bar, drift pill.
- **FloatingJoystick.ts (103L):** VERIFIED analog.
- **CharacterStudio.ts (162L):** VERIFIED character customization.
- **LobbyUI.ts (398L):** LIKELY working lobby/room config.

### Audio
- **SoundManager.ts (609L):** LIKELY full engine/tire/crash/siren/music/nitro/rain synthesis.

### Networking
- **LobbyClient.ts (207L) + LobbyProtocol.ts (78L):** LIKELY WebSocket-based local multiplayer. Offline fallback present.

### Main Loop (main.ts 1875L)
- VERIFIED: Full open-world lifecycle, circuit race + countdown, car theft, sparring fighters, police integration, weather, ghost, activities, multiplayer sync at 20Hz, camera (chase/hood/orbit), car-vs-car collision, civicCar steal system, busted flow.

---

## 2. Confirmed Problems (VERIFIED)

### P1 — CRITICAL

#### [P1-A] Drift Zone ring meshes have no Y offset for terrain height
- **File:** `WorldActivities.ts:165`
- **Code:** `ring.position.set(d.x, 0.08, d.z)` — hardcoded Y=0.08. Harbor Dock zone is at world coords where openworld terrain may be elevated. Ring clips into ground or floats.
- **Impact:** Visually broken, immersion-breaking. Easy fix.

#### [P1-B] `configureActiveCar()` does not restore gearbox/archetype from stolen car
- **File:** `main.ts:784-794`
- **Code:** When stealing a civic car (new CarPhysics()), the archetype defaults to 'HYPER' with save gearbox but civic cars have no archetype applied. All stolen cars behave identically.
- **Impact:** Car theft feels fake. Minor physics inconsistency.

#### [P1-C] Police busted flow: `charCtrl.revive()` called but dead body physics may not have landed yet
- **File:** `main.ts:806-828`. `charCtrl.revive(release)` is called synchronously in `onBusted` callback. If `isDead` was set by a police car hit in the same frame, the respawn position may teleport while fall physics are mid-air.
- **Impact:** LIKELY rare jank but not a crash. Low severity.

#### [P1-D] Character pushback from car hulls ignores facing — character can be pushed through buildings
- **File:** `main.ts:1544-1561` — simple radial push from car center ignores `worldCollider`. If a car parks against a building and the player walks between them, the car push can clip player into the building.
- **Impact:** Gameplay annoyance. Can strand the character.

### P2 — HIGH

#### [P2-A] Camera drag (`setupCameraDragLook`) conflicts with joystick on mobile
- **File:** `main.ts:550-574`
- **Code:** `camPointerId` is set on any `pointerdown` on canvas when `!inCar && !studio.isOpen`. The joystick lives inside `foot-joystick-zone` which is a DOM overlay, not the canvas — so they should not conflict. HYPOTHESIS: on some Android Chrome, the pointer may still reach the canvas through the overlay at certain touch sizes. NOT TESTED on device.

#### [P2-B] `parkActiveCar()` guard does not deduplicate by identity correctly when switching between stolen cars
- **File:** `main.ts:706-708`
- **Code:** `if (this.parkedCars.some(p => p.physics === this.physics)) return;` — this correctly deduplicates by physics reference. But if player steals car A, parks it, steals car B, parks B, then re-enters A, `this.physics` becomes A's physics. `configureActiveCar()` does not remove A from `parkedCars` until `enterOwnedCar()` calls `this.parkedCars.filter(p => p !== entry)`. This is correct. VERIFIED OK.

#### [P2-C] Minimap world offset hardcoded, doesn't match city bounds
- **File:** `HUD.ts:688-694`
- **Code:** Metro city grid drawn at `28*scale + offsetX`, `−220*scale + offsetY` with size `210*scale × 440*scale`. The actual city in OpenWorldMap may differ. Speed trap markers, shards, and rival portals are NOT on the minimap — player has no way to find them.
- **Impact:** Navigation is essentially blind. High-value fix.

#### [P2-D] Apex Shard pickup radius too tight for elevated shards
- **File:** `WorldActivities.ts:463-466` — `dy < 4.0` check but shard_6 is at `y=4.5` (on ramp), shard_9 at `y=5.5`, shard_11 at `y=7.4`, shard_12 at `y=7.4`. Player on-foot (y≈0) will have `dy` = 7.4 — will NEVER collect elevated shards on foot. Only possible in car.
- **Impact:** 4 of 12 shards uncollectable on foot. VERIFIED bug.

#### [P2-E] Rival sprint portal detection radius too generous + no direction check
- **File:** `WorldActivities.ts:487-489` — `d < 12` triggers rival prompt. Portal is a flat ring of radius 4-5. Player can trigger portal from 12m away (past nearby buildings). No `inCar` check here — a walking player can accidentally trigger a sprint prompt.
- **Impact:** UI spam, accidental sprint starts.

#### [P2-F] Ghost record uses `rotation.x + bodyPitch` double-adding pitch
- **File:** `main.ts:1473` — `this.physics.rotation.x + this.physics.bodyPitch`. But in `CarPhysics.stepSub()` line 668: `this.rotation.x = this.bodyPitch;` — so `rotation.x` IS bodyPitch. This double-adds pitch, making the ghost car tilt twice as much on slopes.
- **Impact:** Ghost car visually wrong on any banked section.

### P3 — MEDIUM

#### [P3-A] `gearbox-options` buttons in settings do NOT update `save.data.gearbox` or call `hud.updateTouchVisibility` — found in `lobbyUI.onGearboxChange` and in `setupUIHandlers` but no `gearbox-options` handler there
- **File:** `main.ts` — scan of `setupUIHandlers` has no `.gearbox-options` handler. Gearbox IS handled by `lobbyUI.onGearboxChange` but that only fires from the lobby panel, not the settings modal.
- **HYPOTHESIS:** May work via lobby only; settings modal gearbox options may be cosmetic only. Needs index.html inspection.

#### [P3-B] SparringFighters roam permanently — no patrol radius limiting
- **File:** `RaceBotAI.ts` SparringFighter class — will follow player across the map. No leash distance.
- **Impact:** Fighters can wander far from their intended zones (City Plaza, Playground).

#### [P3-C] Police car collision vs player car has no damage feedback
- **File:** `main.ts` — police hit player on foot triggers damage, but police ramming the player's car has no camera shake or crash sound (only via `onWallCollision` on the player car physics, which fires when player car hits something, not when something hits player car).
- **Impact:** Police T-bones feel silent.

#### [P3-D] Rain system: `drops` array is 420 entries, rain mesh covers only 60×60m around focus
- **File:** `WeatherSystem.ts:84-85` — 60m radius rain. At 100+ km/h the car can outrun the rain leading edge if driving into it. Minor visual artifact.

#### [P3-E] No district discovery logic wired — `discoveredDistricts` in SaveData is never populated
- **File:** `SaveManager.ts:49`, never written in `main.ts` or `WorldActivities.ts`.
- **Impact:** Feature exists in save schema but is dead code.

#### [P3-F] `gearbox-options` buttons in `setupUIHandlers` are MISSING
- Confirmed by reading all of `setupUIHandlers`. Gearbox can only be changed from the Lobby panel.

### P4 — LOW / POLISH

- P4-A: Drift zone rings pulse uniformly regardless of player proximity — a "you're inside" flash would help
- P4-B: Speed trap pillars always face +Z — should orient perpendicular to road direction
- P4-C: Civic cars never respawn after theft — after stealing all 6, the city is clean of targets
- P4-D: Wanted level HUD uses `setWanted(this.police.heat)` on spawn but not dynamically rechecked after returning from race
- P4-E: AirTime stat tracked in CarPhysics (`onAirLanding`) but `save.data.maxAirTime` never updated in main.ts
- P4-F: `save.data.carsStolen` incremented on steal but never shown to player in any UI
- P4-G: Ghost pitch double-add (P2-F) results in ghost car sinking into track on downhill exits

---

## 3. What is NOT TESTED (requires device/browser)
- Actual render performance on Android Chrome (mobile GPU)
- Touch input multi-finger conflicts in practice
- Audio context initialization on first touch (browser restriction)
- Actual minimap accuracy vs world geometry
- Police spawn points vs city collision mesh — may spawn inside buildings
- WebSocket lobby in LAN environment

---

## 4. Architecture Notes
- `main.ts` at 1875 lines is a God Object. All game state lives here. This is acceptable for current scope but risky to extend.
- No pooling for `HumanCharacterMesh` remote peers — each join/leave creates/destroys full mesh (geometry + materials). Acceptable for expected lobby size.
- `CarPhysics.worldCollider` callback pattern is clean but creates closure allocations per-frame in `PoliceSystem.spawnUnit`. Minor.
- Three.js resources (geometries, materials) in `HumanCharacterMesh` are never disposed when peers leave — memory leak for multiplayer sessions.

