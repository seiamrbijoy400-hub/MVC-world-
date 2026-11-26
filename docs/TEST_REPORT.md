# APEX ZERO: NEON VELO — Honest Verification & Test Report
**Date:** 2026-11-26 | **Environment:** Termux/Linux (`node v26.13.1`, `pnpm`, no headless Chromium / Browser Automation MCP / physical Android browser attached)

---

## 1. Typecheck & Production Build — PASS
Command executed after final edits:
`pnpm run build` (`tsc && vite build`)
- **Result:** Exit code `0`
- **Modules:** `72 modules transformed`
- **Bundle Output:** `dist/index.html` (`52.91 kB` / `12.24 kB` gzip), `dist/assets/index-sa94nyxn.js` (`1,045.74 kB` / `281.85 kB` gzip) in `1.10s`
- **Subpath hosting:** built `index.html` references `./assets/...`; a static server at `/game/` returned HTTP 200 for the built JS and `male.glb` (6,264,280 bytes) — verified 2026-11-26.
- **TypeScript Errors:** `0`

---

## 2. Automated Headless Simulation, Asset & LAN Tests (`tests/gameplay.test.ts`) — PASS (30/30)
Compiled with `pnpm exec tsc tests/gameplay.test.ts --outDir "$TMPDIR/apx-tests" --module commonjs --moduleResolution node --target ES2022 --esModuleInterop --skipLibCheck --resolveJsonModule` and executed via `NODE_PATH="$PWD/node_modules" node --test "$TMPDIR/apx-tests/tests/gameplay.test.js"` (`30` pass, `0` fail, `0` skipped):

### Sprint 9 regression coverage (added 2026-11-26)
| Test Case | Outcome | What Was Verified |
| :--- | :---: | :--- |
| Pier-end collision | **PASS** | Car stops at `z≈294.5` and walker at `z≈295.5` instead of snapping ~30m back to the seawall; non-pier shoreline still blocks at `z≈268`. |
| Follow-camera clamp | **PASS** | Chase/orbit desired points sampled through `clampCameraToWorld()` stay outside restaurant AABB while keeping a usable focus distance. |
| Restaurant door & mezzanine | **PASS** | Front storefront band is split around the `x=84` doorway; halfway up the stairs, stepping sideways does not teleport to `y=4.2`; counter is solid. |
| `SaveManager` SEMI | **PASS** | `SEMI` survives a `saveNow()` / new `SaveManager()` round trip. |
| KO input edges | **PASS** | Punch held into KO then released revives cleanly and the first new punch registers. |
| Phantom airtime | **PASS** | A mid-air reset clears `isAirborne`/`airTime` and fires no `onAirLanding`. |
| GameApp state guards | **PASS** | Source-level guards confirm KO race block, owned-car restore, seat clearing, `E` gear latch fix and `SEMI` validation remain in place. |
| Subpath assets & LAN chat | **PASS** | Node asset URLs remain root-absolute while built HTML uses relative paths; untrusted peer names are appended as text, never parsed as HTML; SW uses stale-while-revalidate (`apex-zero-v2`). |
| Rig sitting & stairs | **PASS** | Both rigs' hips land on the seat anchor including yaw; female stair clips no longer drift horizontally/float after per-template root-motion cleanup. |
| Sit persistence & opacity | **PASS** | Female/male sit idle loops indefinitely (13s simulated) with hips staying on the seat; female opaque skin/dress materials are restored to the opaque depth-writing pass. |
| Full stair traversal simulation | **PASS** | `CharacterController` walks from the stair foot to `y≈4.2` mezzanine through real `OpenWorldMap` height sampling and AABB collision; mid-stair sideways exit resolves to ground, not an upward teleport. |

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
| Rigged character GLBs: CC metadata, skeleton, clips & mapping | **PASS** | Both GLBs parse, require no optional loader extensions, carry embedded CC BY 4.0 author metadata, expose 72/89-joint skeletons and 25/35 clips; idle/walk/run/flee/jump map to real native clips and combat states keep a grounded base clip. |
| `GLTFCharacterMesh`: shared load, animation states, per-instance tint | **PASS** | Both GLBs load through `GLTFLoader` in the headless harness (no procedural fallback), every `CharAnimState` advances without error, outfit/skin/accent meshes receive distinct tints for NPC variety, and disposal leaves shared template assets intact. |

---

## 3. Not Tested (Requires Live WebGL Browser / Physical Android Hardware) — NOT TESTED
- Live WebGL visual rendering quality (lighting contrast, shadows, curtain-wall building facades, multi-cluster foliage, FBX geometry alignment on GPU canvas, avatar proportions in 3D view).
- Touchscreen multi-finger ergonomics on Android Chrome (joystick + drag camera + pedals + safe-area insets on notched screens).
- Real browser `AudioContext` hardware playback and autoplay resume behavior on mobile touch events.
- Actual GPU FPS, frame times, and thermal behavior across `HIGH`, `MED`, and `LOW` quality tiers.
- Real client UI wiring (`LobbyClient` DOM bindings) across two physical devices over hotspot LAN.

---

## Sprint 8 — Mobile Lifecycle & Adaptive Resolution (2026-11-26)
- New module `src/game/AdaptiveResolution.ts`: per-frame rolling-window FPS governor that lowers the renderer pixel ratio under sustained load and restores it with hysteresis. Long stalls / tab returns are ignored.
- `src/main.ts`: lifecycle binding — pause/resume `SoundManager` on `visibilitychange`, flush `SaveManager` on backgrounding/pagehide, reset frame clock on return, reset governor on return; `orientationchange` + `visualViewport` resize handling; max-speed save throttled to every 4s (still flushed on background); jump take-off SFX now fires only on the grounded → airborne transition (no retrigger spam); adaptive resolution sample wired into the render loop using raw (pre-clamp) frame deltas.
- `src/ui/HUD.ts`: `preventDefault` guarded by `cancelable` on touch buttons (avoids console errors on synthetic events).
- `src/main.ts`: shadow map switched from `PCFSoftShadowMap` to `PCFShadowMap` for cheaper mobile shadow sampling.
- Tests: 11/11 pass (added `AdaptiveResolution` coverage).

## Sprint 8 — Rigged GLB Characters (2026-11-26)
- New modules `src/graphics/CharacterAnimationMap.ts`, `src/graphics/GLTFCharacterCache.ts`, rewritten `src/graphics/GLTFCharacterMesh.ts`: male/female Sketchfab GLBs are parsed once, cloned per character with per-instance materials and independent `AnimationMixer`s, normalized to 1.78m, and driven by their own native clip names.
- `PUNCH`/`HIT`/`KO` get short additive procedural poses layered over the rig's idle clip (source GLBs have no combat clips); pedestrians alternate rigs plus outfit/hair/skin tints and scale to avoid clone-looking crowds; chat/emoji bubbles preserved.
- Procedural `HumanCharacterMesh` remains a graceful fallback when a GLB fails. Lobby shows a model-ready/fallback badge and Settings lists CC BY 4.0 credits from the GLB `asset.extras` metadata.
- Tests: 14/14 pass (added GLB integrity, CC metadata, clip-mapping and runtime load coverage). Live on-screen look of the rigs still needs a physical WebGL browser (none attached in this environment).

## Sprint 8 — Character Visibility & Punch Fix (2026-11-26)
- `SkeletonUtils.clone()` now remaps skeleton bones per instance. Plain `Object3D.clone()` had shared the template skeleton, leaving rigged meshes frozen/invisible — the cause of “character not showing” and broken-looking fights.
- The source GLB rigs face `+Z` (eye bones at `+Z`); instances are rotated 180° so world forward is `-Z`. Additive punch/hit/KO pose signs were corrected for that world-space facing (later commits completed the fix).
- New regressions assert every skinned clone owns its skeleton bones and that punching moves the right hand toward `-Z`.
