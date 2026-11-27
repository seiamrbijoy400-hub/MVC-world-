# APEX ZERO: NEON VELO — Honest Verification & Test Report
**Date:** 2026-11-26 | **Environment:** Termux/Linux (`node v26.13.1`, `pnpm`, no headless Chromium / Browser Automation MCP / physical Android browser attached)

---

## 1. Typecheck & Production Build — PASS
Command executed after final edits:
`pnpm run build` (`tsc && vite build`)
- **Result:** Exit code `0`
- **Modules:** `72 modules transformed`
- **Bundle Output:** `dist/index.html` (`52.92 kB` / `12.20 kB` gzip), `dist/assets/index-DqIJ4VqU.js` (`1,059.11 kB` / `282.62 kB` gzip) in `937ms` (2026-11-26 final Sprint 15 gate)
- **Subpath hosting:** built `index.html` references `./assets/...`; a static server at `/game/` returned HTTP 200 for the built JS and `male.glb` (6,264,280 bytes) — verified 2026-11-26.
- **TypeScript Errors:** `0`

---

## 2. Automated Headless Simulation, Asset & LAN Tests (`tests/gameplay.test.ts`) — PASS (74/74)
Run with `pnpm test` (compiles the suite + `server/onlineServer.ts` to a temp dir and executes `node --test`) — `74` pass, `0` fail, `0` skipped, `~20.0s`:

### Host-side two-client LAN harness (`pnpm qa:lan`) — 12/12 PASS
Drives the real standalone server with two WebSocket clients on the host machine: LAN info, JSON health, host room, guest join, chat relay, file upload/broadcast/byte-exact download, cross-room block and leaderboard storage. It prints the exact `http://IP:PORT` URL that phones must open. Physical two-device hotspot/cable QA is in `docs/LAN_QA_CHECKLIST.md` and remains **NOT TESTED** (no device/browser attached).

### Sprint 20 — durable host storage (2026-11-27)
| Item | Status | Evidence |
| :--- | :---: | :--- |
| "Central server" lost all data on restart | **FIXED (self-hosted)** | `APEX_DATA_DIR` enables atomic `leaderboard.json` writes (debounced + on shutdown). Test submits a score, stops the server, restarts with the same dir and reads the score back via `/api/leaderboard`. |
| Stored data had no visibility | **FIXED** | `GET /api/leaderboard` returns top 20 + `persistent` flag; lobby home renders a top-5 board with `textContent`-safe rows. |
| Cloud hosts would falsely claim durability | **FIXED** | `persistent` is `false` unless a data dir is configured. Render free tier has an ephemeral disk, so this is honest rather than misleading. |

**Limits:** shared file bytes stay in RAM with a 30-minute TTL; room state is still ephemeral. Real two-device transfer and Android QA remain **NOT TESTED**.

### Sprint 19 — room file sharing (2026-11-27)
| Item | Status | Evidence |
| :--- | :---: | :--- |
| "Data sharing" only covered chat/state, no real files | **FIXED** | `POST /api/files?room=CODE` stores bytes on the host; `GET /api/files/:id?room=CODE` returns them as an attachment. Test uploads, downloads and compares bytes. |
| Files could leak across rooms or via path traversal | **FIXED** | Download requires the matching room code; filename is basename-sanitized (`../../notes<script>.txt` → `notesscript.txt`). Test asserts a wrong room returns `404`. |
| Upload abuse (size, count, executable types) | **FIXED** | 4 MB/file, 20 files & 16 MB/room, 30-min TTL; HTML/SVG/JS MIME forced to `application/octet-stream` + `nosniff` + `attachment`. Test asserts `413`, MIME rewrite and room isolation. |
| No UI to share or fetch files | **FIXED** | Room view has "📎 Share File", a member-only file list with download links, and a system chat notice on every share. |

**Limits:** real two-device hotspot/cable transfer and Android download-sheet behavior are **NOT TESTED**.

### Sprint 18 — LAN/offline server hardening (2026-11-27)
| Item | Status | Evidence |
| :--- | :---: | :--- |
| Cloud `/api/lan-info` leaked container-private IPs | **FIXED (source)** | `resolveNetworkInfo()` detects `RENDER` / `x-forwarded-host` / `x-forwarded-proto` and returns `mode:'ONLINE'`, `ips:[]`, public URL + warning. Covered by the standalone-server test. |
| `/api/health` returned the SPA HTML | **FIXED (source)** | Plugin and `onlineServer` now serve JSON `{ ok, rooms, clients, recoverable, uptimeSec }`; test asserts `ok:true`. |
| HTTPS page silently failed on `ws://` LAN host | **FIXED** | `LobbyClient` blocks private `ws://` targets from HTTPS and emits an actionable "open `http://host:port` directly" error; non-private manual hosts upgrade to `wss://`/`https://`. Source guard test added. |
| Offline pack + helicopter assets missing from build | **FIXED (source)** | `OfflinePack` (SW `apex-zero-v4`) downloads/caches required GLB/FBX/WAV assets; helicopter GLB + physics/mesh wired into the world. Build includes `helicopter.glb`. |

**Limits:** real two-device hotspot/cable pairing, Chrome mixed-content behavior on physical Android, and offline PWA install are **NOT TESTED**.

### Sprint 17 — in-game driver switch (2026-11-27)
| Item | Status | Evidence |
| :--- | :---: | :--- |
| No way to change Kaito/Mika/Ren/Sora outside the lobby | **FIXED** | `CharacterStudio` renders a `studio-char-grid`; selecting a driver calls `applyPreset()` + `onCharacterChange()`. |
| Model, save and LAN state could drift apart | **FIXED** | `main.ts` swaps the GLTF model (or procedural `setCharacter`), persists `save.data.characterId`, mirrors `lobbyUI.config.characterId`, and updates `.char-card` selection. Source guard test added. |

### Sprint 16 — UI/UX design repair (`4916b2b`)
| Issue | Status | Evidence |
| :--- | :---: | :--- |
| `APEX LOG 4/12` looked like a generic login/title screen | **FIXED** | `main.ts` shard callback now calls `HUD.showCollectible()`; compact `#toast-layer` card with diamond icon, lore and progress bar; `.center-notice` reserved for countdown/GO (`{ hero: true }`). Source-level markup/CSS verified. |
| Notices overwrote each other / hid behind modals | **FIXED** | Root toast portal at `z-index:120` with up-to-4 stacked independent timers; garage/settings/results use in-modal `role="status"` regions; hero notices expire by wall clock on tab return. |
| HUD stacking trap / overlapping prompts | **FIXED** | `#hud-overlay` raised to `z-index:30`; world popups capped at 12 and clamped; rival/courier prompts mutually exclusive; drift pill hidden while prompts are visible; courier card offset below rival card. |
| 320–390px control overflow, notch clipping, tiny targets | **FIXED (source)** | Class-based touch sizing with `clamp()`/wrapping, `dvh` + `env(safe-area-inset-*)`, 44px coarse-pointer minimums. |
| A11y / untrusted LAN strings | **FIXED** | `aria-live`, dialog roles, close buttons, Tab trap, Escape closes topmost overlay, focus restore after re-render, `aria-pressed`, `textContent` DOM building for room/roster data, no native `alert()`. |
| Deployed site appeared stale after push | **FIXED** | Live `/` HTML was byte-identical to the committed build (`sha256 6234201e…`) and live JS contained `showCollectible()`, proving Render was current. Added SW cache bump (`apex-zero-v3`) + `controllerchange` reload so an open tab auto-refreshes when a new worker takes over. |

**Limits:** no browser/Android attached — screenshots, real touch gestures, GPU/FPS/memory and final visual appearance are **NOT TESTED**.

### Sprint 15 — world gameplay coherence & AI navigation
| Issue | Status | Evidence |
| :--- | :---: | :--- |
| Pier jump snapped the car ~17m backwards onto the deck | **FIXED** | `isOverOpenWater()` + clearance-based pier clamp; real `CarPhysics` drive from (168,240): max `z=327.97`, `maxY=5.27`, **0** backward jumps, splashdown in ocean. `main.ts` now samples ocean height `-1.05` and recovers to `lastSafePosition` with SPLASHDOWN notification. |
| Time-of-day never reached the open world; sky/water highlights ignored camera position | **FIXED** | `setAtmosphere()` calls `openWorld.setTimeOfDay(tod)` and drives sun/shadows from `sunDirection`; sky/water view vectors are camera-relative; headlights are centralized via `syncVehicleHeadlights()` for player, bots and cruisers. Runtime check: NIGHT water/building uniforms differ from DAY. |
| Timed circuit races still paid open-world trap/drift rewards | **FIXED** | `WorldActivities.update()` returns early for `isTimedCircuitRace`; probe: 0 callbacks during race, 1 afterwards. `resetTransientState()` clears active drift score and trap cooldowns on race start/death/bust/teleport. |
| Rival sprint routes cut through buildings | **FIXED** | Takumi waypoints moved to `x=284` and APEX ZERO inserted `(46,224)`; segment-vs-AABB probe over all 4 rivals: **0/0 blocked legs**. |
| Police could bust / fighters could punch / pedestrians could witness through solid walls | **FIXED** | Height-aware LOS added to all four reaction paths. Runtime: LOS through Harbor Inn wall `false`, 180 fighter frames **0 punches**, pedestrian `WITNESS`/`FLEE` suppressed. |
| Police detour targets flipped and Touge deck chase was height-blind | **FIXED** | `RoadGraph` now has 3D nearest-node gate, ramp-mouth nodes, `findPath()`; `PoliceSystem` follows a cached path with a segment projection gate and re-plans below elevated waypoints. Runtime: deck target reached at **1.4m** 3D distance, target flips **6/60s** (was per-frame); ground chase flips **4/60s**. No reverse-stall on the ramp. |
| AI traffic/rivals drove on the invisible plane over open water | **FIXED** | Police, city traffic and rival physics use the ocean sampler (`-1.05`) and splash recovery; real `CityCruiserBot` probe returns to last safe road. |
| Lamps stood in the expressway; quay/pier floated above water; edge stripes sampled asphalt | **FIXED** | z=30 lamp row skipped near `z=30` expressway; quay/pier extended to `y=-1.15`, pier registered as wet material; track grid registered for rain; edge UVs sample the painted stripes. |
| Adaptive resolution pumped forever between two ratios on a borderline GPU | **FIXED** | Failed-ratio memory requires `max(upFps, failedFps*1.35+6)` before retry. Probe: 60fps display cap settles at 1.0; genuine 75fps headroom returns to 1.1. |
| Patrol route crossed Harbor Inn and had no stuck recovery | **FIXED** | Route shifted to `x=224` avenue, 14 agents preserved; bounded 2.5s stuck flip added. |

### Sprint 14 — map navigation & height-aware occlusion
| Issue | Status | Evidence |
| :--- | :---: | :--- |
| Police steered into a building when start and goal shared a road-graph cell | **FIXED** | `findNextWaypoint()` returned the raw goal when `startId === goalId`, even though patrol steering only calls it when LOS is blocked. Repro (180,-120) → (215,-120): old waypoint was the blocked target itself; new `findBlockedWaypoint()` returns a reachable road node. Added a same-cell regression test. |
| Seawall teleported airborne actors and used centre-only pier bounds | **FIXED** | Clamp now ignores actors above the 0.7m rail (y=8 at z=280 stays put), clamps the whole body to x=141.55..194.45 on the pier, and still funnels lateral slips instead of snapping backwards. Far-off-sea actors still hit the seawall. |
| Police saw through the 6m Touge deck and rising ramps | **FIXED** | `hasLineOfSight()` now accepts endpoint heights plus height-aware extra occluders; `OpenWorldMap.getElevatedOccluders()` exposes the deck + ramp AABBs. Probe: ground→deck LOS now false, y=8 overflight true, legacy 2D calls unchanged. |

## Sprint 13 — map subsystem repair (2026-11-26, current)
| Issue | Status | Evidence |
| :--- | :---: | :--- |
| GP circuit mislabelled as Mountain Touge / Harbor Coast | **FIXED** | `getDistrictAt()` checked `x < 14 && z > -245`, so the southern sweeper and hairpin fell through to the Touge/Harbor branches. Measured 89/481 circuit spline samples mislabelled; after the fix 0/481. West half (`x < 14`) is now always GP_CIRCUIT. |
| Stunt boost pads ignored their authored launch direction | **FIXED** | `BoostPad.dirX/dirZ` were stored but never read: `main.ts` boosted along the car's yaw, so a backwards/sideways approach fired the car away from its ramp. Boost now uses the pad's normalized direction with a car-forward fallback. |
| Actor exactly at a collider centre was shoved +X forever | **FIXED** | `resolveCircleVsAABB()` degenerate branch did `pos.x += radius` unconditionally. Deep spawn/teleport inside a 38m-wide building left the actor buried and drifting into neighbours. Now ejects through the nearest face with momentum reflection; probe: building centre (84,-200) ejects to z=-218.6 instead of x=85.2. |
| Leaving the stunt pier sideways teleported the actor 13-28m back to the seawall | **FIXED** | Pier-lane check only covered `x=140..196`; stepping to x=139 at z=290 snapped z to 266.5. Lateral drift now funnels back into the lane (x=141.5) with velocity bounce; actors far out at sea still hit the seawall. |

## Sprint 11 — stand-up responsiveness (2026-11-26, current)
| Issue | Status | Evidence |
| :--- | :---: | :--- |
| Male rig stand-up froze locomotion for 6.17s; first ~4.2s of `Rig|sitting_end` kept the hips in the seated pose | **FIXED** | Measured GLB keyframes: hips.position.y constant at 0.217 until t=4.2, rises to 0.010 by t=5.0, clip duration 6.167s. `SIT_EXIT_WINDOW` now starts the action at t=4.2 and returns to locomotion after 1.05s. Headless rig probe: before = seated hip 0.586 still at t=3.0, stood at t≈5.0; after = standing hip 0.872 at t=1.0. Female unchanged (1.567s native clip). |
| Standing up teleported the character 1.1m forward in a single frame while still in the seated pose | **FIXED** | `exitSeat(true)` now records the offset; `main.ts` applies it gradually with an ease-out cubic driven by `GLTFCharacterMesh.standUpProgress` (native clip progress, 0..1). Runtime test: progress is monotonic over ~63 frames, max step <8%/frame. |
| Repeated sit/stand cycles could leave the avatar locked in the sit phase | **FIXED** | 3 consecutive cycles on the male rig: each entered `idle`, stood in 63 frames (~1.05s), returned to `null` with hip height 0.874m. New runtime regression test verifies both rigs stand within 1.7s and hips rise >0.2m. |

## Sprint 10 — performance & state repair (2026-11-26, current)
| Issue | Status | Evidence |
| :--- | :---: | :--- |
| Procedural guard pose rebuilt bone subtrees and allocated ~20 quaternions/vectors per character per frame | **FIXED** | Headless 600-frame microbenchmark: guard overhead over neutral idle **202.1 µs/frame before → 14.2-48.2 µs/frame after** (3 runs, same rig/clip). Scratch quaternion/axis reuse; removed redundant `updateMatrixWorld(true)` per bone. Both rigs' guard/punch trajectory regressions still pass. |
| Camera path allocated ~8-10 vectors/frame and rebuilt the projection matrix unconditionally | **FIXED** | Source guards in `tests/gameplay.test.ts`; `setCameraFov()` skips unchanged fov; `clampCameraToWorld()` now reuses three scratch vectors (31 colliders, ~13.4 µs/call measured). |
| Remote peer outfit sync recoloured every 50 ms and set `material.needsUpdate`, forcing shader recompiles | **FIXED** | Appearance equality gate added; colour is a uniform update only. Source guards verify both. |
| Fractional HP regeneration redrew and re-uploaded the 256x64 name canvas every frame | **FIXED** | Name tag now caches whole-percent HP. |
| Police cruiser spawns allocated fresh beacon geometry and disposed a material shared by all units | **FIXED** | Runtime test: two dispatched units share geometry, keep independent strobe materials, and survive a unit despawn. |
| Exiting a car restored full HP via `resetAt()` | **FIXED** | Exit path now only relocates/zeros velocity, preserving HP and hit state. |
| Static scene baseline (headless, before GLB characters/vehicles are added) | **MEASURED** | `285` normal meshes + `24` instanced meshes, `131` unique materials, `276` unique geometries, `31` world colliders. Real GPU draw calls / FPS remain unmeasured (no WebGL context available). |
| Reported issues re-verified | **MIXED** | Crime→witness→dispatch→arrest→escape pipeline passes end-to-end; dead fighters/pedestrians stop acting (KO animation only) and respawn after 24s/4s; police dispatch from player punch was removed for sanctioned sparring but remains for civilian assaults. Visual quality of procedural world assets is **NOT TESTED** on a real display. |

## Sprint 9 regression coverage (added 2026-11-26)
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
| Boxing guard & cross punch | **PASS** | Both rigs raise fists to chin height in guard, the right cross travels 0.23-0.25m forward to the centerline at head height, and returns to guard within 0.34s (numeric bone simulation). |
| Stand-up from chairs | **PASS** | Source guard confirms movement, jump, E/USE and the relabelled touch STAND button all exit the seat. |
| Sparring vs police | **PASS** | Fighter knockouts no longer add heat or file a witness report; civilian assaults still call the police. |
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

## Sprint 16 — AAA Audit Batch 1 + 2 (2026-11-27)
- **Rendering/assets:** sky dome follows the camera; water `depthWrite:false`; wet road and time-of-day material state unified; PMREM env target disposed before regeneration; GPU resources released for detached hair/accessories, wheels and rig caches; ghost cars skip HQ FBX loading; skidmark updates use bounded ranges; helicopter GLB retry + reset on race/spawn/bust.
- **Gameplay/input:** KO/bust guards, competition-state car-exit lock, gamepad in foot/heli/car modes, coyote time + jump buffer, archetype steering scale, activity mutual exclusion, `e.repeat` hotkey guard, save-import runtime sync, saved runtime settings, save sanitization (`migrateSave`), offline pack now includes the licensed MP3.
- **Network/security:** room-scoped `x-resume-token` file auth (GET/HEAD/POST), path containment + null-byte/symlink/malformed-percent guards, XSS-safe file names, 4 MB/file / 20 files / 16 MB per room / 64 MB global caps, message type + range validation for `MELEE_HIT`, `START_GAME`-only `RESULT_SUBMIT` (mode matched to room), server-issued session id identity for global scores, rate limits, `apex-zero-v5` SW precache including hashed JS chunks.
- **Test harness sync:** regressions updated to the new rules — lobby melee/score submissions are rejected until `START_GAME`, melee needs both live `PLAYER_STATE`s within 6.5 m, downloads need a resume token and cross-room access is denied, `collectRuntimeBundleUrls()` tolerates a partial headless `document` stub.

### Gates (host-side, VERIFIED)
| Gate | Result |
| :--- | :--- |
| `pnpm exec tsc --noEmit` | clean |
| `pnpm run build` | clean — `index-eZtlV1lB.js` 431.10 kB, `vendor-three-CihgsWzn.js` 725.93 kB, SW v5 precaches hashed chunks |
| `pnpm test` | **74/74 pass** (21.3 s, 0 fail) |
| `pnpm qa:lan` | **14/14 pass** — 2 real WS clients, chat, file auth, cross-room isolation, lobby-score rejection, durable leaderboard |

**NOT TESTED:** live WebGL visual shading/FPS, touch/gamepad hardware, Web Audio hardware, physical two-device hotspot LAN, and the live Render deployment (deployed SW is still `apex-zero-v4`; these local changes are not live). Mini App Developer MCP and in-app browser were not attached in this session, so no mini app / browser screenshots were produced.
