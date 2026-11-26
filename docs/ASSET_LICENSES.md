# APEX ZERO: NEON VELO — Asset & License Inventory
**Date:** 2026-11-26

All runtime assets are stored locally under `public/assets/` with no runtime network dependency on external CDN model/texture URLs.

Character GLBs were copied into this repository as new files; the originally attached upload files were not modified. Both rigs keep their original base-color textures, and per-character outfit/hair/skin variety is produced at runtime by softly tinting cloned materials. Punch/hit/KO poses are authored in code (`src/graphics/GLTFCharacterMesh.ts`) because the source GLBs contain locomotion, jump and talking clips but no combat clips. Runtime modifications (CC BY 4.0 §3(b)): per-instance material tinting, 180° instance rotation to align source `+Z` facing with world `-Z`, code-authored combat poses, and native sitting/stair clips with the female stair root-motion track frozen. This notice is also shown in the in-game Settings credits.

| Asset Path | Type | Size | Provenance / License Status |
| :--- | :--- | :--- | :--- |
| `public/assets/models/male.glb` | Rigged Animated Human (72 bones, 25 clips) | 6.0 MB | “Business Man - Low Polygon Game Character” by [manoeldarochadeoliveira](https://sketchfab.com/manoeldarochadeoliveira), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Source: https://sketchfab.com/3d-models/business-man-low-polygon-game-character-b6f6740f883b4749abac47af0045a9dd (attribution metadata embedded in GLB `asset.extras`). |
| `public/assets/models/female.glb` | Rigged Animated Human (89 bones, 35 clips) | 8.8 MB | “Low Poly Girl” by [manoeldarochadeoliveira](https://sketchfab.com/manoeldarochadeoliveira), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Source: https://sketchfab.com/3d-models/low-poly-girl-4cb87c1d3c3c4b9ea3b4c61ab407500a (attribution metadata embedded in GLB `asset.extras`). |
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
