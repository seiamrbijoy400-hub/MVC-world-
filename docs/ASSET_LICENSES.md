# APEX ZERO: NEON VELO — Asset & License Inventory
**Date:** 2026-11-26

All runtime assets are stored locally under `public/assets/` with no runtime network dependency on external CDN model/texture URLs.

| Asset Path | Type | Size | Provenance / License Status |
| :--- | :--- | :--- | :--- |
| `public/assets/models/car 1203.fbx` | 3D Vehicle Body (FBX) | 922 KB | Bundled in repository prior to current audit; no upstream LICENSE file present in `public/assets/` (`UNKNOWN` third-party source — founder must verify original source license before commercial distribution; `README.md` notes inspiration from `PaulinaCzapla/Realistic-Racing-Game`). |
| `public/assets/models/wheel_front_right.fbx` | 3D Front Wheel (FBX) | 109 KB | Same as above (`UNKNOWN` license — verify prior to release). |
| `public/assets/models/wheel_back_right.fbx` | 3D Rear Wheel (FBX) | 108 KB | Same as above (`UNKNOWN` license — verify prior to release). |
| `public/assets/sounds/low.wav` | Engine Low RPM Sample | 730 KB | Bundled locally (`UNKNOWN` upstream author/license). |
| `public/assets/sounds/high ACC.wav` | Engine High Accel Sample | 925 KB | Bundled locally (`UNKNOWN` upstream author/license). |
| `public/assets/sounds/high Deacc.wav` | Engine High Decel Sample | 865 KB | Bundled locally (`UNKNOWN` upstream author/license). |
| `public/assets/sounds/CarColision.wav` | Car Impact SFX | 338 KB | Bundled locally (`UNKNOWN` upstream author/license). |
| `public/assets/sounds/TrackColision.wav` | Barrier Impact SFX | 231 KB | Bundled locally (`UNKNOWN` upstream author/license). |
| `public/assets/sounds/step-inside-your-mind-instrumental-eurobeat-royalty-free-music.mp3` | Background Music | 10.2 MB | Filename indicates royalty-free instrumental Eurobeat track; artist/platform attribution certificate not stored in repo (`UNKNOWN` exact terms — keep credit/receipt on record before publishing). |
| Procedural Geometries, Canvas Textures, GLSL & Web Audio Synths (`src/**`) | Code / Procedural Assets | — | Authored directly in project TypeScript (`OpenWorldMap.ts`, `TrackEnvironment.ts`, `HumanCharacterMesh.ts`, `Shaders.ts`, `SoundManager.ts`). |
