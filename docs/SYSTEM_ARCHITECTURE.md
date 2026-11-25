# APEX ZERO: NEON VELO — System Architecture
**Date:** 2026-11-26

```
index.html (Lobby, HUD, Touch Controls, Studio, Garage, Settings, Results)
 └─ src/main.ts (GameApp orchestrator & requestAnimationFrame loop)
     ├─ Physics
     │   ├─ src/physics/CarPhysics.ts        (180Hz sub-step V8/tire/drift/nitro/tuning sim)
     │   ├─ src/physics/CharacterController.ts (camera-rel movement, stun, melee, KO/revive)
     │   └─ src/physics/CollisionResolver.ts (car-vs-car impulse, wall-safe pushback, vehicle hazards)
     ├─ World & Graphics
     │   ├─ src/graphics/TrackEnvironment.ts (GP circuit spline, curbs, gantry, sky/lighting)
     │   ├─ src/graphics/OpenWorldMap.ts     (5 districts, AABB colliders, ramps, ocean, soccer, cones)
     │   ├─ src/graphics/CarMesh.ts          (procedural fallback + async FBX car/wheel loader)
     │   ├─ src/graphics/HumanCharacterMesh.ts (procedural articulated PBR character + animations)
     │   ├─ src/graphics/WeatherSystem.ts    (CLEAR/RAIN/STORM particles, grip/drift modifiers)
     │   ├─ src/graphics/ParticleSystem.ts   (sparks, exhaust backfire)
     │   └─ src/graphics/Shaders.ts          (custom GLSL anime ocean water material)
     ├─ AI & Connected Open World
     │   ├─ src/game/RoadGraph.ts            (Neo Velo street graph Dijkstra + segment-vs-AABB LOS)
     │   ├─ src/game/PoliceSystem.ts         (heat, LOS spotting, search/pursuit, bust/escape)
     │   ├─ src/ai/PedestrianSystem.ts       (sidewalk patrols, near-miss flee, crime witnesses)
     │   ├─ src/ai/RaceBotAI.ts              (RaceBot, CityCruiserBot, SparringFighter)
     │   ├─ src/game/WorldActivities.ts      (speed traps, drift zones, Shards, 1v1 Rivals, Courier runs)
     │   └─ src/game/GarageController.ts     (Drift Garage UI upgrades, underglow unlocks, career stats)
     ├─ Progression, Audio, UI, LAN
     │   ├─ src/game/SaveManager.ts          (localStorage versioned persistence & ranks)
     │   ├─ src/game/LapManager.ts           (GP sectors, lap timing, drift score chaining)
     │   ├─ src/game/GhostSystem.ts          (15Hz personal-best lap recording/playback)
     │   ├─ src/audio/SoundManager.ts        (Web Audio synths + bundled WAV/MP3 engine/music)
     │   ├─ src/ui/HUD.ts                    (tachometer, minimap, touch pedals, chat/wanted)
     │   ├─ src/ui/FloatingJoystick.ts       (analog thumbstick for on-foot touch control)
     │   ├─ src/ui/CharacterStudio.ts        (live avatar customizer)
     │   ├─ src/ui/LobbyUI.ts                (offline solo + LAN room configuration)
     │   └─ src/network/LobbyClient.ts + LobbyProtocol.ts (+ server/lanLobbyPlugin.ts)
     └─ Tests
         └─ tests/gameplay.test.ts           (Node headless simulation suite across core systems)
```
