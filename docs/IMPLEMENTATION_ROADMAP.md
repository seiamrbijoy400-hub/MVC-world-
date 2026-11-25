# APEX ZERO: NEON VELO — Implementation Roadmap
**Date:** 2026-11-25 | **Baseline:** Clean build, 60 modules

---

## Sprint 3 (Current) — Bug fixes, world clarity, and feel

### Priority order
1. ✅ **[P2-F] Ghost pitch double-add** — 5-line fix, visual correctness
2. ✅ **[P2-D] Elevated shard pickup radius** — 2-line fix, gameplay critical
3. ✅ **[P2-C] Minimap: add activity markers** — shards + traps + rival portals on minimap
4. ✅ **[P1-A] Drift zone ring heights** — terrain-sample the ring Y at build time
5. ✅ **[P4-E] Air time tracking** — wire `onAirLanding` → `save.data.maxAirTime`
6. ✅ **[P4-C] Civic car respawn** — respawn stolen civics at their original position after a delay
7. ✅ **[P3-B] Sparring fighter leash** — return to home if >80m away
8. ✅ **[P2-E] Rival portal prompt gate** — require inCar + narrower radius (8m)
9. ✅ **[P1-D] Character-car pushback + building clamp** — run worldCollider after push
10. ⬜ **[P3-A/F] Gearbox setting in settings modal** — wire gearbox-options handler

### Sprint 4 — World richness
- Minimap shard/trap icon legend
- More civic car variants with different physics (lighter, slower)
- District discovery: trigger when first entering city zones
- NPC reactions: pedestrians flee police/fights
- Weather-reactive visual: wet road sheen on track surface

### Sprint 5 — Activities and progression depth
- Delivery missions using existing WorldActivities scaffolding
- Vehicle recovery missions: bring stolen civic cars back to their owners
- Police escape bonus: credits for clean getaway
- Leaderboard screen in results modal

### Sprint 6 — Performance and polish
- Three.js resource disposal on peer leave
- Code-split main.ts into GameLoop + GameSystems managers  
- LOD for distant character meshes (replace full mesh with billboard beyond 60m)
- Shadow map radius follows player (currently fixed at scene load)

---

## Definition of Done (per AGENTS.md §8)
A feature is PASS only when complete player-facing behaviour is implemented and tested.
Every sprint must end with: clean TypeScript build, honest test record, no regressions.

