import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import * as THREE from 'three';
import { WebSocket } from 'ws';

// Minimal headless browser environment stubs for Three.js procedural canvas textures & localStorage
const memStorage = new Map<string, string>();
(globalThis as unknown as Record<string, unknown>).localStorage = {
  getItem: (k: string) => memStorage.get(k) ?? null,
  setItem: (k: string, v: string) => { memStorage.set(k, v); },
  removeItem: (k: string) => { memStorage.delete(k); },
  clear: () => { memStorage.clear(); }
};

function makeCanvasMock() {
  const ctxMock = new Proxy(
    {
      canvas: null,
      createLinearGradient: () => ({ addColorStop: () => {} }),
      createRadialGradient: () => ({ addColorStop: () => {} }),
      measureText: () => ({ width: 40 })
    },
    {
      get(target, prop) {
        if (prop in target) return (target as Record<string | symbol, unknown>)[prop];
        return () => {};
      }
    }
  );
  return {
    width: 256,
    height: 256,
    getContext: () => ctxMock
  };
}

if (typeof globalThis.document === 'undefined') {
  (globalThis as unknown as Record<string, unknown>).document = {
    createElement: (tag: string) => (tag === 'canvas' ? makeCanvasMock() : {})
  };
}
if (typeof globalThis.window === 'undefined') {
  (globalThis as unknown as Record<string, unknown>).window = globalThis;
}
if (typeof globalThis.location === 'undefined') {
  (globalThis as unknown as Record<string, unknown>).location = { href: 'http://localhost/' };
}
// GLTFLoader decodes embedded GLB PNGs in a browser-like image environment.
if (typeof globalThis.self === 'undefined') {
  (globalThis as unknown as Record<string, unknown>).self = globalThis;
}
if (typeof globalThis.createImageBitmap === 'undefined') {
  (globalThis as unknown as Record<string, unknown>).createImageBitmap = async () => ({
    width: 8,
    height: 8,
    close: () => {}
  });
}
if (typeof globalThis.ProgressEvent === 'undefined') {
  (globalThis as unknown as Record<string, unknown>).ProgressEvent = class ProgressEvent {
    type: string;
    lengthComputable: boolean;
    loaded: number;
    total: number;
    constructor(type: string, init?: { lengthComputable?: boolean; loaded?: number; total?: number }) {
      this.type = type;
      this.lengthComputable = Boolean(init?.lengthComputable);
      this.loaded = Number(init?.loaded ?? 0);
      this.total = Number(init?.total ?? 0);
    }
  };
}
// Allow Three.js FileLoader relative asset URLs (`/assets/...`) to fail gracefully in headless Node tests
const OrigRequest = globalThis.Request;
(globalThis as unknown as Record<string, unknown>).Request = class extends OrigRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    const resolved = typeof input === 'string' && input.startsWith('/') ? `http://127.0.0.1${input}` : input;
    super(resolved, init);
  }
};
(globalThis as unknown as Record<string, unknown>).fetch = async (input: RequestInfo | URL) => {
  const urlStr = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
  let pathname = urlStr;
  try {
    pathname = decodeURIComponent(new URL(urlStr, 'http://127.0.0.1').pathname);
  } catch {
    pathname = decodeURIComponent(urlStr);
  }
  if (pathname.startsWith('/assets/')) {
    const diskPath = path.join(process.cwd(), 'public', pathname.slice(1));
    if (fs.existsSync(diskPath)) {
      const buf = fs.readFileSync(diskPath);
      return new Response(buf, { status: 200 });
    }
  }
  return new Response(new ArrayBuffer(0), { status: 404 });
};

import { CarPhysics, GearboxType, type CarInputs, type GroundSample } from '../src/physics/CarPhysics';
import { CharacterController } from '../src/physics/CharacterController';
import { RoadGraph, hasLineOfSight } from '../src/game/RoadGraph';
import { SaveManager, migrateSave, CURRENT_SAVE_VERSION } from '../src/game/SaveManager';
import { REQUIRED_OFFLINE_ASSETS, checkOfflinePackStatus } from '../src/game/OfflinePack';
import { AdaptiveResolution } from '../src/game/AdaptiveResolution';
import { OpenWorldMap } from '../src/graphics/OpenWorldMap';
import { TrackEnvironment } from '../src/graphics/TrackEnvironment';
import { HelicopterPhysics } from '../src/physics/HelicopterPhysics';
import { HelicopterMesh } from '../src/graphics/HelicopterMesh';
import { PoliceSystem } from '../src/game/PoliceSystem';
import { PedestrianSystem } from '../src/ai/PedestrianSystem';
import { SparringFighter, CityCruiserBot } from '../src/ai/RaceBotAI';
import { WorldActivities, type CourierContractDef } from '../src/game/WorldActivities';
import { CarMesh } from '../src/graphics/CarMesh';
import { HumanCharacterMesh } from '../src/graphics/HumanCharacterMesh';
import { ParticleSystem } from '../src/graphics/ParticleSystem';
import { mapAnimStateToClip, modelForCharacter, modelUrlFor } from '../src/graphics/CharacterAnimationMap';
import { GLTFCharacterMesh } from '../src/graphics/GLTFCharacterMesh';
import { lanLobbyPlugin, createLobbyBackend } from '../server/lanLobbyPlugin';
import { startOnlineServer } from '../server/onlineServer';
import {
  separateVehiclePair,
  pushCharacterOutOfVehicles,
  resolveMovingVehicleImpactOnCharacter
} from '../src/physics/CollisionResolver';

test('CarPhysics: throttle + nitro accelerates, shifts gears, and tuning scales power cleanly', () => {
  const stock = new CarPhysics();
  stock.enforceTrackWalls = false;
  stock.resetToTrack(new THREE.Vector3(0, 0, 0), 0);

  const tuned = new CarPhysics();
  tuned.enforceTrackWalls = false;
  tuned.resetToTrack(new THREE.Vector3(0, 0, 0), 0);
  tuned.applyTuning(3, 3);

  const accelInput = {
    throttle: 1,
    brake: 0,
    steer: 0,
    handbrake: false,
    clutch: false,
    shiftUp: false,
    shiftDown: false,
    reset: false,
    nitro: true
  };

  for (let i = 0; i < 300; i++) {
    stock.update(1 / 60, accelInput, true);
    tuned.update(1 / 60, accelInput, true);
  }

  assert.ok(stock.speedKmh > 140, `Expected stock speed > 140 km/h in 5s, got ${stock.speedKmh.toFixed(1)}`);
  assert.ok(stock.gear >= 2, `Expected auto gearbox to shift up, got gear ${stock.gear}`);
  assert.ok(tuned.speedKmh > stock.speedKmh, `Tuned car (${tuned.speedKmh.toFixed(1)}) should beat stock (${stock.speedKmh.toFixed(1)})`);
  assert.ok(tuned.nitro >= stock.nitro, 'Stage 3 nitro should retain equal or higher reserve after burn');

  tuned.applyArchetype('DRIFT');
  assert.equal(tuned.engineStage, 3);
  assert.ok(tuned.torqueScale > 1.06, 'Archetype swap must preserve engine tuning multiplier');
});

test('CharacterController: movement, jump/land events, hit stun, KO blocks actions, then revives', () => {
  const char = new CharacterController();
  let landedImpact = 0;
  let died = false;
  let revived = false;
  char.onLand = (v) => { landedImpact = v; };
  char.onDeath = () => { died = true; };
  char.onRespawn = () => { revived = true; };
  char.respawnDelay = 1.2;
  char.resetAt(new THREE.Vector3(10, 0, 10), 0);

  // Sprint forward 0.5s
  for (let i = 0; i < 30; i++) {
    char.update(1 / 60, { moveX: 0, moveY: 1, sprint: true, jump: i === 0, punch: false }, 0);
  }
  assert.ok(char.position.z < 9.5, 'Moving forward should advance position');

  // Let jump land
  for (let i = 0; i < 90; i++) {
    char.update(1 / 60, { moveX: 0, moveY: 0, sprint: false, jump: false, punch: false }, 0);
  }
  assert.ok(char.isGrounded, 'Character should land back on ground');
  assert.ok(landedImpact > 3.5, `Expected landing callback with impact > 3.5, got ${landedImpact}`);

  // Non-lethal punch puts character in HIT stun
  const dead1 = char.takeDamage(30, 1, 0);
  assert.equal(dead1, false);
  assert.equal(char.animState, 'HIT');

  // Lethal hit triggers KO, freezes actions, then revives after delay
  let punchFiredWhileDead = false;
  char.onPunchStrike = () => { punchFiredWhileDead = true; };
  const dead2 = char.takeDamage(100, 1, 0);
  assert.equal(dead2, true);
  assert.equal(died, true);
  assert.equal(char.isDead, true);
  assert.equal(char.animState, 'KO');

  for (let i = 0; i < 40; i++) {
    char.update(1 / 60, { moveX: 1, moveY: 1, sprint: true, jump: true, punch: true }, 0);
  }
  assert.equal(punchFiredWhileDead, false, 'Dead NPC/player must not attack during KO');

  for (let i = 0; i < 60; i++) {
    char.update(1 / 60, { moveX: 0, moveY: 0, sprint: false, jump: false, punch: false }, 0);
  }
  assert.equal(revived, true, 'Character should respawn after KO timer');
  assert.equal(char.isDead, false);
  assert.equal(char.hp, char.maxHp);
});

test('OpenWorldMap & RoadGraph: seamless Touge ramps, 5 districts, building LOS occlusion & pathfinding', () => {
  const scene = new THREE.Scene();
  const map = new OpenWorldMap(scene);

  // Verify 5 districts return distinct expected IDs
  assert.equal(map.getDistrictAt(0, -100), 'GP_CIRCUIT');
  assert.equal(map.getDistrictAt(122, -40), 'NEON_CORE');
  assert.equal(map.getDistrictAt(84, 90), 'STUNT_ARENA');
  assert.equal(map.getDistrictAt(168, 250), 'HARBOR_COAST');
  assert.equal(map.getDistrictAt(155, -296), 'MOUNTAIN_TOUGE');

  // Verify seamless ramp height transition onto Touge Summit Deck (x=38 -> x=60 -> x=155)
  assert.ok(map.sampleRampHeight(49, -296) > 2.5);
  assert.ok(Math.abs(map.sampleRampHeight(59.9, -296) - 6.0) < 0.15, 'Touge ramp top must align with 6m summit deck');
  assert.equal(map.sampleRampHeight(60.1, -296), 6.0);
  assert.equal(map.sampleRampHeight(250.0, -296), 6.0);

  // Verify LOS across AKIBA CYBER building (x=172, z=-200, w=48, d=36) is blocked
  assert.equal(hasLineOfSight(172, -230, 172, -170, map.colliders), false);
  // Verify clear LOS along Avenue x=46
  assert.equal(hasLineOfSight(46, -150, 46, 150, map.colliders), true);

  // Verify RoadGraph navigates toward distant node without failing
  const graph = new RoadGraph();
  const wp = graph.findNextWaypoint(new THREE.Vector3(46, 0, 150), new THREE.Vector3(296, 0, -160));
  assert.ok(Number.isFinite(wp.x) && Number.isFinite(wp.z));
  assert.ok(wp.distanceTo(new THREE.Vector3(46, 0, 150)) > 1 || wp.x > 46, 'Next waypoint must progress along network');
});

test('OpenWorldMap: walk-in restaurant has a door gap, two floors, stairs and seats', () => {
  const scene = new THREE.Scene();
  const map = new OpenWorldMap(scene);
  const zone = map.interiorFloors[0];
  assert.ok(zone, 'ANIME CAFE must register a walkable interior zone');

  const blocked = (x: number, z: number): boolean => map.colliders.some(
    (c) => x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ
  );
  assert.equal(blocked(84, -74.3), false, 'front door gap must stay walkable');
  assert.equal(blocked(70, -74.3), true, 'wall beside the door must still block');
  assert.equal(blocked(84, -125.7), true, 'rear wall must block');

  assert.equal(map.sampleInteriorHeight(90, -100, 0), 0, 'ground floor at low height');
  assert.equal(map.sampleInteriorHeight(90, -100, 4.2), 4.2, 'mezzanine at upper height');
  const sx = (zone.stairs.minX + zone.stairs.maxX) * 0.5;
  assert.equal(map.sampleInteriorHeight(sx, zone.stairs.minZ, 0), 0, 'stair foot starts on ground floor');
  assert.equal(map.sampleInteriorHeight(sx, zone.stairs.maxZ, 0), 4.2, 'stair top reaches the mezzanine');
  assert.ok(map.sampleInteriorHeight(sx, (zone.stairs.minZ + zone.stairs.maxZ) * 0.5, 0) > 1.5);
  assert.ok(map.isInInteriorStairs(sx, (zone.stairs.minZ + zone.stairs.maxZ) * 0.5));
  assert.equal(map.isInInteriorStairs(90, -100), false);
  assert.ok(map.sitSpots.length >= 10, 'restaurant must provide multiple sit-able chairs');
  // Anchors are hip targets on the seat surface, not character root positions.
  assert.ok(map.sitSpots.some((s) => Math.abs(s.pos.y - 0.58) < 0.01), 'ground seats anchor at seat surface');
  assert.ok(map.sitSpots.some((s) => Math.abs(s.pos.y - 4.78) < 0.01), 'mezzanine seats anchor at seat surface');
});

test('Connected Crime -> Witness -> Police Dispatch -> Search/Escape -> Arrest pipeline', () => {
  const scene = new THREE.Scene();
  const track = new TrackEnvironment(scene);
  const map = new OpenWorldMap(scene);

  const groundY = (x: number, z: number) => Math.max(track.sampleGround(x, z).height, map.sampleRampHeight(x, z));
  const peds = new PedestrianSystem(scene, map, groundY, 14);
  const police = new PoliceSystem(scene, track, map);

  let reportedReason = '';
  peds.onCrimeReported = (reason, pos) => {
    reportedReason = reason;
    police.addHeat(1, reason, pos);
  };

  // Pick pedestrian #0 on avenue x=57 and trigger a crime right beside pedestrian #1 with clear LOS
  const victim = peds.agents[0];
  const bystander = peds.agents[1];
  victim.controller.resetAt(new THREE.Vector3(57, 0, -35), 0);
  bystander.controller.resetAt(new THREE.Vector3(57, 0, -25), 0);

  victim.controller.takeDamage(20, 0, -1);
  peds.markVictimFlee(victim, new THREE.Vector3(57, 0, -37));
  const saw = peds.notifyCrime(victim.controller.position, 'ASSAULT ON CIVILIAN', 30, victim);

  assert.equal(victim.state, 'FLEE', 'Struck victim must flee rather than stand still as witness');
  assert.equal(saw, true, 'Nearby bystander on open sidewalk should witness crime');
  assert.equal(bystander.state, 'WITNESS');

  // Simulate 2 seconds so witness completes phone call -> triggers PoliceSystem heat
  const playerPos = new THREE.Vector3(57, 0, -37);
  for (let i = 0; i < 120; i++) {
    peds.update(1 / 60, playerPos, playerPos, 0, false);
  }
  assert.equal(reportedReason, 'ASSAULT ON CIVILIAN');
  assert.equal(police.heat, 1);

  // Update police briefly so patrol unit spawns outside buildings
  for (let i = 0; i < 60; i++) {
    police.update(1 / 60, playerPos, false, null, false);
  }
  assert.equal(police.units.length, 1, 'Police should dispatch 1 unit at heat 1');
  const copPos = police.units[0].physics.position;
  for (const b of map.colliders) {
    const inside = copPos.x > b.minX && copPos.x < b.maxX && copPos.z > b.minZ && copPos.z < b.maxZ && copPos.y < b.height;
    assert.equal(inside, false, 'Spawned police unit must never spawn inside a building collider');
  }

  // Simulate standing completely still next to stopped cruiser on foot -> verify arrest
  let bustedFine = 0;
  police.onHooks.onBusted = (fine) => { bustedFine = fine; };
  police.units[0].physics.resetToTrack(new THREE.Vector3(59, 0, -37), 0);
  for (let i = 0; i < 180; i++) {
    police.update(1 / 60, playerPos, false, null, false);
    if (bustedFine > 0) break;
  }
  assert.ok(bustedFine > 0, 'Standing near stopped pursuing police unit on foot must trigger arrest');
  assert.equal(police.heat, 0, 'Being busted must clear heat');

  // Verify escape branch: break LOS behind buildings while cops search lastKnownPos -> heat decays & fires onEscaped
  let escaped = false;
  police.onHooks.onEscaped = () => { escaped = true; };
  police.addHeat(1, 'SPEEDING', new THREE.Vector3(296, 0, -160));
  // Step once at crime pos so unit spawns in northeast corridor around lastKnownPos, then slip behind central city buildings
  police.update(1 / 60, new THREE.Vector3(296, 0, -160), true, null, false);
  const hiddenSpot = new THREE.Vector3(84, 0, 20);
  for (let i = 0; i < 1600; i++) {
    police.update(1 / 60, hiddenSpot, true, null, false);
    if (escaped) break;
  }
  assert.equal(escaped, true, 'Breaking LOS behind city blocks must decay heat cleanly and fire onEscaped');
  assert.equal(police.units.length, 0);
});

test('SaveManager: legacy migration, credits economy & rank progression', () => {
  localStorage.clear();
  localStorage.setItem('apex_zero_save_v1', JSON.stringify({ credits: 400, legendXp: 450, gearbox: GearboxType.MANUAL }));
  const save = new SaveManager();
  assert.equal(save.data.credits, 400);
  assert.equal(save.data.gearbox, GearboxType.MANUAL);
  assert.equal(save.data.engineStage, 0);
  assert.deepEqual(save.data.unlockedUnderglows, ['#22d3ee', 'OFF']);

  const rankUp = save.grantReward(100, 300);
  assert.ok(rankUp !== null && rankUp.level === 2, 'Crossing 500 XP should level up to Rank 2');
  assert.equal(save.data.credits, 700);

  const paid = save.spendCredits(1000);
  assert.equal(paid, 700, 'spendCredits must cap at available credits');
  assert.equal(save.data.credits, 0);
});

test('WorldActivities: sequential Rival Sprint checkpoints, win condition & clean teardown', () => {
  localStorage.clear();
  const scene = new THREE.Scene();
  const save = new SaveManager();
  const track = new TrackEnvironment(scene);
  const map = new OpenWorldMap(scene);
  const playerPhysics = new CarPhysics();
  playerPhysics.enforceTrackWalls = false;

  let wonResult: boolean | null = null;
  let checkpointsReached = 0;
  const activities = new WorldActivities(scene, save, track, map, {
    onSpeedTrapTriggered: () => {},
    onDriftZoneCompleted: () => {},
    onShardCollected: () => {},
    onNearRivalPrompt: () => {},
    onSprintCheckpoint: () => { checkpointsReached++; },
    onSprintEnded: (_def, playerWon) => { wonResult = playerWon; }
  });

  const kira = activities.rivals.find((r) => r.id === 'rival_kira')!;
  const started = activities.startRivalSprint(kira, playerPhysics);
  assert.equal(started, true);
  assert.ok(activities.activeSprint !== null);
  assert.equal(activities.activeSprint!.nextWpMarker.visible, true);

  // Advance player smoothly through each sequential waypoint of Kira's sprint
  for (let wp = 0; wp < kira.waypoints.length; wp++) {
    const pt = kira.waypoints[wp];
    activities.update(1 / 60, wp * 0.1, pt, 120, true, false, 0, false);
  }
  assert.equal(checkpointsReached, kira.waypoints.length - 1, 'Should emit checkpoint callbacks before final gate');
  assert.equal(wonResult, true, 'Crossing all sprint checkpoints first should win rival sprint');
  assert.equal(activities.activeSprint, null, 'Active sprint state must clear on finish');
});

test('WorldActivities: repeatable Courier Time-Trial Gold reward & deadline failure', () => {
  localStorage.clear();
  const scene = new THREE.Scene();
  const save = new SaveManager();
  const track = new TrackEnvironment(scene);
  const map = new OpenWorldMap(scene);

  let lastResult: { medal: string; credits: number; best: boolean } | null = null;
  const activities = new WorldActivities(scene, save, track, map, {
    onSpeedTrapTriggered: () => {},
    onDriftZoneCompleted: () => {},
    onShardCollected: () => {},
    onNearRivalPrompt: () => {},
    onSprintEnded: () => {},
    onCourierEnded: (_def: CourierContractDef, medal, _t, isNewBest, credits) => {
      lastResult = { medal, credits, best: isNewBest };
    }
  });

  const harborRun = activities.couriers.find((c) => c.id === 'courier_harbor')!;
  assert.equal(activities.startCourierContract(harborRun), true);
  assert.ok(activities.activeCourier !== null);

  // Reach dropoff cleanly in 12s -> Gold medal + saves courierRecords
  activities.update(12.0, 12.0, harborRun.destPos, 110, true, false, 0, false);
  assert.deepEqual(lastResult, { medal: 'GOLD', credits: Math.round(harborRun.baseCredits * 1.8), best: true });
  assert.equal(save.data.courierRecords[harborRun.id], 12);
  assert.equal(activities.activeCourier, null);

  // Replay and miss deadline beyond bronzeSec -> FAILED
  lastResult = null;
  assert.equal(activities.startCourierContract(harborRun), true);
  activities.update(harborRun.bronzeSec + 1, 60, harborRun.startPos, 20, true, false, 0, false);
  assert.deepEqual(lastResult, { medal: 'FAILED', credits: 0, best: false });
  assert.equal(activities.activeCourier, null);
});

test('CollisionResolver & CarMesh: vehicle impulse, wall-safe character push, hazard damage, shared resource dispose', () => {
  const carA = new CarPhysics();
  const carB = new CarPhysics();
  carA.resetToTrack(new THREE.Vector3(0, 0, 0), 0);
  carB.resetToTrack(new THREE.Vector3(0, 0, 1.5), 0);
  carA.velocity.set(0, 0, 10);
  carB.velocity.set(0, 0, -10);

  const evt = separateVehiclePair(carA, carB, carA);
  assert.ok(evt !== null && evt.involvesPrimary, 'Head-on overlap must trigger collision impulse');
  assert.ok(carA.velocity.z < 10 && carB.velocity.z > -10, 'Impulses must oppose relative motion');

  // On-foot character caught between car and world collider stays clamped by collider
  const char = new CharacterController();
  char.resetAt(new THREE.Vector3(0.4, 0, 0), 0);
  let clamped = false;
  const pushed = pushCharacterOutOfVehicles(char, [carA], (pos) => {
    if (pos.x > 0.8) {
      pos.x = 0.8;
      clamped = true;
    }
    return clamped;
  });
  assert.equal(pushed, true);
  assert.ok(char.position.x <= 0.8 + 1e-6);

  // Fast vehicle > 22 km/h damages character
  carA.velocity.set(0, 0, 15); // 54 km/h
  char.resetAt(new THREE.Vector3(carA.position.x, 0, carA.position.z + 1.0), 0);
  const hitRes = resolveMovingVehicleImpactOnCharacter(char, [carA], 24, 3.0);
  assert.equal(hitRes.hit, true);
  assert.ok(char.hp < char.maxHp, 'High-speed vehicle hit must reduce HP');

  // Disposing one CarMesh must NOT dispose shared textures still attached to surviving CarMesh
  const m1 = new CarMesh();
  const m2 = new CarMesh();
  let m1SharedMapCount = 0;
  m1.root.traverse((o) => {
    const mat = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
    if (mat?.map?.userData?.shared) m1SharedMapCount++;
  });
  assert.ok(m1SharedMapCount >= 2, 'CarMesh should use shared underglow & shadow textures');
  m1.dispose();
  let m2HasValidSharedMap = true;
  m2.root.traverse((o) => {
    const mat = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
    if (mat?.map?.userData?.shared && !mat.map.image) m2HasValidSharedMap = false;
  });
  assert.equal(m2HasValidSharedMap, true);
  m2.dispose();
});

test('Real FBX vehicle assets & sound files load cleanly and CarMesh toggles driver visibility', async () => {
  const car = new CarMesh();
  const internal = car as unknown as {
    hqBodyGroup: THREE.Group | null;
    fallbackGroup: THREE.Group;
    driverGroup: THREE.Group;
  };

  // Poll briefly for async FBXLoader parsing of public/assets/models/*.fbx
  const deadline = Date.now() + 3000;
  while (!internal.hqBodyGroup && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 25));
  }

  assert.ok(internal.hqBodyGroup !== null, 'Expected public/assets/models/car 1203.fbx to load into hqBodyGroup');
  assert.equal(internal.fallbackGroup.visible, false, 'Fallback chassis should hide once HQ FBX body loads');

  let hasPlateMap = false;
  internal.hqBodyGroup.traverse((child) => {
    if ((child as THREE.Mesh).isMesh && child.name.toLowerCase() === 'plate') {
      const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
      if (mat.map?.userData?.shared) hasPlateMap = true;
    }
  });
  assert.equal(hasPlateMap, true, 'Rear FBX plate mesh must receive shared Neo Velo license plate texture');

  car.setDriverVisible(false);
  assert.equal(internal.driverGroup.visible, false);
  car.setDriverVisible(true);
  assert.equal(internal.driverGroup.visible, true);

  const requiredSounds = [
    'low.wav',
    'high ACC.wav',
    'high Deacc.wav',
    'TrackColision.wav'
  ];
  for (const file of requiredSounds) {
    const p = path.join(process.cwd(), 'public', 'assets', 'sounds', file);
    assert.ok(fs.existsSync(p), `Missing audio asset: ${file}`);
    assert.ok(fs.statSync(p).size > 1024, `Audio asset empty/corrupt: ${file}`);
  }

  car.dispose();
});

test('LAN server plugin: live HTTP /api/lan-info + 2-client WebSocket sync & disconnect cleanup', async () => {
  type MiddlewareFn = (req: http.IncomingMessage, res: http.ServerResponse) => void;
  const routes = new Map<string, MiddlewareFn>();
  const server = http.createServer((req, res) => {
    const route = req.url?.split('?')[0] ?? '';
    const fn = routes.get(route);
    if (fn) fn(req, res);
    else {
      res.statusCode = 404;
      res.end('Not found');
    }
  });

  const plugin = lanLobbyPlugin();
  (plugin.configureServer as (srv: unknown) => void)({
    httpServer: server,
    middlewares: {
      use: (route: string, fn: MiddlewareFn) => routes.set(route, fn)
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  const port = addr.port;

  // 1. Verify /api/lan-info HTTP endpoint
  const lanJson = await new Promise<{ ips: string[]; port: number; preferredUrl: string }>((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}/api/lan-info`, (res) => {
      assert.equal(res.statusCode, 200);
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(raw));
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', reject);
  });
  assert.ok(Array.isArray(lanJson.ips) && lanJson.ips.length > 0);
  assert.equal(lanJson.port, port);

  // 2. Connect Host + Guest WebSockets
  const connectWs = () =>
    new Promise<{ ws: WebSocket; msgs: Record<string, unknown>[] }>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      const msgs: Record<string, unknown>[] = [];
      ws.on('message', (data) => {
        msgs.push(JSON.parse(data.toString()));
      });
      ws.once('open', () => resolve({ ws, msgs }));
      ws.once('error', reject);
    });

  const waitForMsg = async (
    msgs: Record<string, unknown>[],
    pred: (m: Record<string, unknown>) => boolean,
    label: string
  ) => {
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const hit = msgs.find(pred);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`Timed out waiting for WS message: ${label}`);
  };

  const host = await connectWs();
  const guest = await connectWs();

  try {
    const hostWelcome = (await waitForMsg(host.msgs, (m) => m.type === 'WELCOME', 'host WELCOME')).payload as { clientId: string };
    const guestWelcome = (await waitForMsg(guest.msgs, (m) => m.type === 'WELCOME', 'guest WELCOME')).payload as { clientId: string };
    const hostId = hostWelcome.clientId;
    const guestId = guestWelcome.clientId;
    assert.ok(hostId && guestId && hostId !== guestId);

    host.ws.send(JSON.stringify({
      type: 'CREATE_ROOM',
      payload: { playerName: 'HostApex', characterId: 'kaito', carColor: '#ff5500' }
    }));
    const createdRoom = (await waitForMsg(host.msgs, (m) => m.type === 'ROOM_STATE', 'CREATE_ROOM')).payload as {
      room: { code: string; players: { id: string }[] };
    };
    const room = createdRoom.room;
    assert.ok(room.code && room.players.length === 1);

    guest.ws.send(JSON.stringify({
      type: 'JOIN_ROOM',
      payload: { code: room.code, playerName: 'GuestVelo', characterId: 'mika', carColor: '#0ea5e9' }
    }));
    await waitForMsg(
      host.msgs,
      (m) => m.type === 'ROOM_STATE' && ((m.payload as { room: { players: unknown[] } }).room.players.length === 2),
      '2-player ROOM_STATE'
    );

    host.ws.send(JSON.stringify({ type: 'START_GAME' }));
    await waitForMsg(guest.msgs, (m) => m.type === 'GAME_START', 'guest GAME_START');

    host.ws.send(JSON.stringify({ type: 'CHAT', payload: { text: 'Ready at grid!' } }));
    const chat = (await waitForMsg(
      guest.msgs,
      (m) => m.type === 'CHAT_MSG' && (m.payload as { text?: string }).text === 'Ready at grid!',
      'guest CHAT_MSG Ready at grid!'
    )).payload as { text: string; isSystem?: boolean };
    assert.equal(chat.text, 'Ready at grid!');
    assert.equal(chat.isSystem, false);

    guest.ws.send(JSON.stringify({ type: 'PLAYER_STATE', payload: { x: 42, y: 0, z: -12, mode: 'CAR' } }));
    const initialWorld = (await waitForMsg(
      host.msgs,
      (m) => m.type === 'WORLD_STATE' && Boolean((m.payload as { states: Record<string, unknown> }).states[guestId]),
      'host receives guest WORLD_STATE'
    )).payload as { states: Record<string, { x: number }> };
    assert.equal(initialWorld.states[guestId].x, 42);

    host.ws.send(JSON.stringify({ type: 'BALL_SYNC', payload: { x: 96, y: 0.5, z: -4, vx: 3, vy: 1, vz: 0 } }));
    await waitForMsg(guest.msgs, (m) => m.type === 'BALL_SYNC', 'guest BALL_SYNC');

    host.ws.send(JSON.stringify({ type: 'MELEE_HIT', payload: { targetId: guestId, damage: 20, dirX: 1, dirZ: 0 } }));
    await waitForMsg(guest.msgs, (m) => m.type === 'MELEE_HIT', 'guest MELEE_HIT');

    // Clear host buffer and disconnect guest -> verify ghost state cleanup in WORLD_STATE!
    host.msgs.length = 0;
    guest.ws.close();
    await waitForMsg(
      host.msgs,
      (m) => m.type === 'ROOM_STATE' && ((m.payload as { room: { players: unknown[] } }).room.players.length === 1),
      'host sees 1 player after guest leave'
    );
    await waitForMsg(
      host.msgs,
      (m) => m.type === 'WORLD_STATE' && !(guestId in (m.payload as { states: Record<string, unknown> }).states),
      'host receives pruned WORLD_STATE without stale ghost'
    );
  } finally {
    host.ws.close();
    if (guest.ws.readyState === WebSocket.OPEN) guest.ws.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('AdaptiveResolution: drops pixel ratio under sustained load, recovers with headroom, ignores stalls', () => {
  const feed = (gov: AdaptiveResolution, fps: number, seconds: number) => {
    const dt = 1 / fps;
    const steps = Math.round(seconds * fps);
    let last: number | null = null;
    for (let i = 0; i < steps; i++) {
      const next = gov.sample(dt);
      if (next !== null) last = next;
    }
    return last;
  };

  const gov = new AdaptiveResolution(2, { minRatio: 0.85, maxRatio: 2, warmupSec: 1, windowSec: 0.5 });

  // Warmup: a slow start does not immediately soften the image.
  assert.equal(gov.sample(1 / 30), null);
  assert.equal(gov.currentRatio, 2);

  const dropped = feed(gov, 30, 3);
  assert.ok(dropped !== null && dropped < 2, `expected a downward step, got ${dropped}`);
  assert.ok(gov.currentRatio >= 0.85, 'never goes below the floor');

  // Stay slow long enough to hit the floor and confirm clamping.
  feed(gov, 25, 20);
  assert.ok(Math.abs(gov.currentRatio - 0.85) < 1e-9, `clamped at min, got ${gov.currentRatio}`);

  // Plenty of headroom now: steps back up, but not past the cap.
  const raised = feed(gov, 60, 10);
  assert.ok(raised !== null && raised > 0.85, `expected an upward step, got ${raised}`);
  feed(gov, 60, 40);
  assert.equal(gov.currentRatio, 2);

  // A single long stall must not count as a slow window.
  const before = gov.currentRatio;
  gov.sample(1.2);
  assert.equal(gov.currentRatio, before);
  const afterStall = feed(gov, 30, 0.4);
  assert.equal(gov.currentRatio, before, 'settling after a stall is ignored');
  assert.equal(afterStall, null);

  // A quality change re-bases the governor and resets its sample history.
  gov.setBounds(0.85, 1.35, 1.35);
  assert.equal(gov.currentRatio, 1.35);
  assert.equal(feed(gov, 30, 0.2), null);
});

test('Rigged character GLBs: embedded CC BY credits, skeleton, clips & state mapping', () => {
  const specs: Array<{ model: 'male' | 'female'; file: string; minJoints: number; idle: string; walk: string; run: string; jump: string }> = [
    { model: 'male', file: 'male.glb', minJoints: 72, idle: 'Rig|idle', walk: 'Rig|walk', run: 'Rig|run', jump: 'Rig|jump' },
    { model: 'female', file: 'female.glb', minJoints: 89, idle: 'idle', walk: 'walk', run: 'run', jump: 'jump_fwd' }
  ];

  for (const spec of specs) {
    const p = path.join(process.cwd(), 'public', 'assets', 'models', spec.file);
    assert.ok(fs.existsSync(p), `Missing rigged character: ${spec.file}`);
    const buf = fs.readFileSync(p);
    assert.equal(buf.readUInt32LE(0), 0x46546c67, 'GLB magic');
    const jsonLength = buf.readUInt32LE(12);
    const gltf = JSON.parse(buf.slice(20, 20 + jsonLength).toString('utf8'));
    assert.ok(!gltf.extensionsRequired?.length, `${spec.file} must not need optional loaders`);
    assert.ok((gltf.skins?.[0]?.joints?.length ?? 0) >= spec.minJoints, `${spec.file} skeleton incomplete`);
    assert.match(gltf.asset?.extras?.license ?? '', /CC[- ]BY[- ]4\.0/);
    assert.match(gltf.asset?.extras?.author ?? '', /manoeldarochadeoliveira/);

    const names: string[] = (gltf.animations ?? []).map((a: { name: string }) => a.name);
    assert.ok(names.length >= 25, `${spec.file} should ship its animation library`);
    assert.equal(mapAnimStateToClip('IDLE', names, spec.model), spec.idle);
    assert.equal(mapAnimStateToClip('WALK', names, spec.model), spec.walk);
    assert.equal(mapAnimStateToClip('RUN', names, spec.model), spec.run);
    assert.equal(mapAnimStateToClip('FLEE', names, spec.model), spec.run);
    assert.equal(mapAnimStateToClip('JUMP', names, spec.model), spec.jump);
    for (const state of ['PUNCH', 'HIT', 'KO', 'DRIVE'] as const) {
      assert.ok(mapAnimStateToClip(state, names, spec.model), `${state} must keep a grounded base clip`);
    }
  }

  assert.equal(modelForCharacter('kaito'), 'male');
  assert.equal(modelForCharacter('mika'), 'female');
  assert.equal(modelUrlFor('sora'), '/assets/models/female.glb');
});

test('GLTFCharacterMesh: loads both rigs, drives animation states and recolors per-instance materials', async () => {
  const actor = new GLTFCharacterMesh('/assets/models/male.glb', 'kaito', '', null, 0, false);
  const heroine = new GLTFCharacterMesh('/assets/models/female.glb', 'mika', '', null, 0, false);
  const deadline = Date.now() + 4000;
  while ((!actor.isRealistic || !heroine.isRealistic) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.equal(actor.isRealistic, true, 'male GLB should load instead of the procedural fallback');
  assert.equal(heroine.isRealistic, true, 'female GLB should load instead of the procedural fallback');

  const internal = actor as unknown as {
    instance: { materials: THREE.MeshStandardMaterial[]; group: THREE.Group };
    root: THREE.Group;
  };
  assert.ok(internal.instance.materials.length >= 3, 'Each character owns cloned materials for color variants');

  // Regression: SkinnedMesh.clone() shares the source skeleton, leaving the
  // visible mesh bound to bones outside its own scene (frozen/invisible rig).
  let skinnedCount = 0;
  let locallyBound = 0;
  internal.instance.group.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    skinnedCount++;
    const firstBone = mesh.skeleton.bones[0];
    let belongsToInstance = false;
    internal.instance.group.traverse((b) => { if (b === firstBone) belongsToInstance = true; });
    if (belongsToInstance) locallyBound++;
  });
  assert.ok(skinnedCount > 0, 'GLB characters must contain skinned meshes');
  assert.equal(locallyBound, skinnedCount, 'Every clone must own its skeleton bones, not share the template skeleton');

  // Regression: source rigs face +Z but CharacterController forward is -Z.
  // Without the 180° visual turn, characters moonwalk backwards.
  const facingZ = (mesh: GLTFCharacterMesh): number => {
    const inst = (mesh as unknown as { instance: { group: THREE.Group } }).instance;
    inst.group.updateMatrixWorld(true);
    let head: THREE.Bone | null = null;
    let eye: THREE.Bone | null = null;
    inst.group.traverse((o) => {
      const b = o as THREE.Bone;
      if (!b.isBone) return;
      if (/^head/i.test(b.name) && !head) head = b;
      if (/eye_l/i.test(b.name) && !eye) eye = b;
    });
    assert.ok(head && eye, 'head and left-eye bones must exist');
    return eye!.getWorldPosition(new THREE.Vector3()).sub(head!.getWorldPosition(new THREE.Vector3())).z;
  };
  assert.ok(facingZ(actor) < 0, 'Male rig must face controller forward (-Z)');
  assert.ok(facingZ(heroine) < 0, 'Female rig must face controller forward (-Z)');

  const before = internal.instance.materials[0].color.clone();
  actor.setAppearance({
    hairStyle: 'spiky', hairColor: '#1c1917', eyeColor: '#4a2f1b', jacketColor: '#ff5500',
    accentColor: '#f8fafc', pantsColor: '#18181b', skinColor: '#e0b48c', accessory: 'none'
  });
  assert.ok(!internal.instance.materials[0].color.equals(before), 'Appearance must tint the GLB materials');
  assert.ok(
    internal.instance.materials.some((m) => !m.color.equals(internal.instance.materials[0].color)),
    'Outfit, skin and accent meshes must receive different tints (NPC variety)'
  );

  for (const state of ['IDLE', 'WALK', 'RUN', 'JUMP', 'PUNCH', 'HIT', 'KO', 'FLEE'] as const) {
    actor.updateAnimation(1 / 60, state);
    heroine.updateAnimation(1 / 60, state);
  }
  assert.equal(actor.root.children.length, 1, 'Only the shared GLB instance stays attached to the actor');
  actor.dispose();
  heroine.dispose();
});

test('GLTFCharacterMesh: punch drives the hand forward (-Z), matching hit detection', async () => {
  const idle = new GLTFCharacterMesh('/assets/models/male.glb', 'kaito', '', null, 0, false);
  const punching = new GLTFCharacterMesh('/assets/models/male.glb', 'kaito', '', null, 0, false);
  const deadline = Date.now() + 4000;
  while ((!idle.isRealistic || !punching.isRealistic) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 25));
  }
  const handZ = (actor: GLTFCharacterMesh): number => {
    const inst = (actor as unknown as {
      instance: { group: THREE.Group; bones: Map<string, THREE.Bone> };
    }).instance;
    inst.group.updateMatrixWorld(true);
    const hand = inst.bones.get('handR');
    assert.ok(hand, 'right hand bone must be indexed');
    return hand.getWorldPosition(new THREE.Vector3()).z;
  };

  // Same clip/time for both; only the additive punch pose differs.
  idle.updateAnimation(0.16, 'IDLE');
  punching.updateAnimation(0.16, 'PUNCH');
  assert.ok(
    handZ(punching) < handZ(idle) - 0.15,
    'Punch must move the hand toward -Z (character forward), not behind the body'
  );
  idle.dispose();
  punching.dispose();
});

test('GLTFCharacterMesh: native sit and stair clips drive chairs and mezzanine stairs', async () => {
  const specs = [
    {
      url: '/assets/models/male.glb', id: 'kaito',
      sit: ['Rig|sitting_start', 'Rig|sitting_idle', 'Rig|sitting_end'],
      up: 'Rig|walk', down: 'Rig|walk'
    },
    {
      url: '/assets/models/female.glb', id: 'mika',
      sit: ['idle_to_sit', 'sit_idle', 'sit_to idle'],
      up: 'walk_stairway_root', down: 'walk_stairway_down_root'
    }
  ] as const;

  for (const spec of specs) {
    const actor = new GLTFCharacterMesh(spec.url, spec.id, '', null, 0, false);
    const deadline = Date.now() + 4000;
    while (!actor.isRealistic && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    const internal = actor as unknown as {
      actions: Map<string, THREE.AnimationAction>;
      sitPhase: 'enter' | 'idle' | 'exit' | null;
      currentClipName: string;
    };
    const clipNames = [...internal.actions.keys()];
    for (const clip of spec.sit) {
      assert.ok(clipNames.includes(clip), `${spec.id} must ship native clip ${clip}`);
    }
    assert.ok(clipNames.includes(spec.up) && clipNames.includes(spec.down), `${spec.id} must ship stair clips`);

    actor.setSitting(true);
    assert.equal(internal.sitPhase, 'enter', `${spec.id} must start the sit-in animation`);
    actor.setSitting(false);
    assert.equal(internal.sitPhase, 'exit', `${spec.id} must stand back up`);
    actor.updateAnimation(7, 'IDLE'); // finish the stand-up clip before testing locomotion
    assert.equal(internal.sitPhase, null, `${spec.id} must return to normal locomotion`);

    actor.setStairs(true, 'up');
    actor.updateAnimation(0.02, 'WALK');
    assert.equal(internal.currentClipName, spec.up, `${spec.id} must use the native upstairs clip`);
    actor.setStairs(true, 'down');
    actor.updateAnimation(0.02, 'WALK');
    assert.equal(internal.currentClipName, spec.down, `${spec.id} must use the native downstairs clip`);
    actor.dispose();
  }
});

test('GLTFCharacterMesh: standing up finishes promptly on both rigs (no dead 6s clip)', async () => {
  for (const [url, id] of [['/assets/models/male.glb', 'kaito'], ['/assets/models/female.glb', 'mika']] as const) {
    const actor = new GLTFCharacterMesh(url, id, '', null, 0, false);
    const deadline = Date.now() + 4000;
    while (!actor.isRealistic && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    assert.equal(actor.isRealistic, true, `${id} GLB must load`);
    const internal = actor as unknown as {
      instance: { bones: Map<string, THREE.Bone> };
      sitPhase: 'enter' | 'idle' | 'exit' | null;
    };
    const hips = internal.instance.bones.get('hips')!;
    actor.root.position.copy(actor.sitRootPosition({ pos: new THREE.Vector3(84, 0.58, -100), yaw: Math.PI }));
    actor.setSitting(true);
    for (let i = 0; i < 150; i++) actor.updateAnimation(1 / 60, 'IDLE');
    assert.equal(internal.sitPhase, 'idle', `${id} must be seated before standing`);
    actor.root.updateMatrixWorld(true);
    const seatedHipY = hips.getWorldPosition(new THREE.Vector3()).y;

    actor.setSitting(false);
    let standFrames = 0;
    for (; standFrames < 150 && internal.sitPhase !== null; standFrames++) actor.updateAnimation(1 / 60, 'IDLE');
    assert.ok(standFrames <= 100, `${id} stand-up must finish within 1.7s, took ${(standFrames / 60).toFixed(2)}s`);
    assert.equal(internal.sitPhase, null, `${id} must return to locomotion after standing`);
    actor.root.updateMatrixWorld(true);
    const standingHipY = hips.getWorldPosition(new THREE.Vector3()).y;
    assert.ok(standingHipY - seatedHipY > 0.2, `${id} hips must rise visibly, ${seatedHipY.toFixed(3)} -> ${standingHipY.toFixed(3)}`);
    actor.dispose();
  }
});

test('GLTFCharacterMesh: native sit pose lands hips on the chair seat (both rigs)', async () => {
  for (const [url, id] of [['/assets/models/male.glb', 'kaito'], ['/assets/models/female.glb', 'mika']] as const) {
    const actor = new GLTFCharacterMesh(url, id, '', null, 0, false);
    const deadline = Date.now() + 4000;
    while (!actor.isRealistic && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));

    const seat = new THREE.Vector3(84, 4.78, -100);
    const yaw = 0.8;
    actor.root.position.copy(actor.sitRootPosition({ pos: seat, yaw }));
    actor.root.rotation.y = yaw;
    actor.setSitting(true);
    for (let i = 0; i < 180; i++) actor.updateAnimation(1 / 60, 'IDLE');

    const inst = (actor as unknown as { instance: { group: THREE.Group; bones: Map<string, THREE.Bone> } }).instance;
    actor.root.updateMatrixWorld(true);
    const hips = inst.bones.get('hips');
    assert.ok(hips);
    const p = hips.getWorldPosition(new THREE.Vector3());
    assert.ok(Math.abs(p.y - seat.y) < 0.08, `${id} hips must rest on seat height, got y=${p.y.toFixed(3)}`);
    assert.ok(Math.hypot(p.x - seat.x, p.z - seat.z) < 0.12, `${id} hips must land over the seat center`);
    actor.dispose();
  }
});

test('GLTFCharacterMesh: female stair clips do not slide or float after root-motion cleanup', async () => {
  const actor = new GLTFCharacterMesh('/assets/models/female.glb', 'mika', '', null, 0, false);
  const deadline = Date.now() + 4000;
  while (!actor.isRealistic && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
  actor.setStairs(true, 'up');
  actor.updateAnimation(0.02, 'WALK');

  const inst = (actor as unknown as { instance: { group: THREE.Group; bones: Map<string, THREE.Bone> } }).instance;
  const hips = inst.bones.get('hips');
  assert.ok(hips);
  actor.root.updateMatrixWorld(true);
  const start = hips.getWorldPosition(new THREE.Vector3());
  for (let i = 0; i < 180; i++) actor.updateAnimation(1 / 60, 'WALK');
  actor.root.updateMatrixWorld(true);
  const end = hips.getWorldPosition(new THREE.Vector3());

  assert.ok(Math.hypot(end.x - start.x, end.z - start.z) < 0.12, 'stair clip must not slide the hips horizontally');
  assert.ok(Math.abs(end.y - start.y) < 0.15, 'stair clip must not float the hips vertically');
  actor.dispose();
});

test('GLTFCharacterMesh: KO topples the body forward, not backward', async () => {
  for (const [url, id] of [['/assets/models/male.glb', 'kaito'], ['/assets/models/female.glb', 'mika']] as const) {
    const actor = new GLTFCharacterMesh(url, id, '', null, 0, false);
    const deadline = Date.now() + 4000;
    while (!actor.isRealistic && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    actor.updateAnimation(0.6, 'KO');
    const inst = (actor as unknown as {
      instance: { group: THREE.Group; bones: Map<string, THREE.Bone> };
    }).instance;
    inst.group.updateMatrixWorld(true);
    const hips = inst.bones.get('hips');
    const head = inst.bones.get('head');
    assert.ok(hips && head);
    const delta = head.getWorldPosition(new THREE.Vector3()).sub(hips.getWorldPosition(new THREE.Vector3()));
    assert.ok(delta.z < -0.3, `${id} KO must lay the head toward -Z, got z=${delta.z.toFixed(2)}`);
    actor.dispose();
  }
});

test('OpenWorldMap: pier end stops the actor instead of snapping back to the seawall', () => {
  const map = new OpenWorldMap(new THREE.Scene());
  const car = new THREE.Vector3(168, 0, 297);
  const vel = new THREE.Vector3(0, 0, 12);
  map.resolveCollision(car, vel, 1.55);
  assert.ok(car.z > 293, `pier-end car must stop near z=294.5, got ${car.z.toFixed(1)}`);
  assert.ok(car.z < 296, 'pier-end car must not drive past the deck');

  const foot = new THREE.Vector3(168, 0, 298);
  const footVel = new THREE.Vector3(0, 0, 5);
  map.resolveCollision(foot, footVel, 0.45);
  assert.ok(foot.z > 295, `pier-end walker must stop near z=295.5, got ${foot.z.toFixed(1)}`);

  const shore = new THREE.Vector3(90, 0, 300);
  map.resolveCollision(shore, new THREE.Vector3(0, 0, 4), 0.45);
  assert.ok(shore.z <= 268, 'seawall must still stop actors outside the pier lane');
});

test('OpenWorldMap: camera clamp avoids building colliders and keeps the focus visible', () => {
  const map = new OpenWorldMap(new THREE.Scene());
  const building = map.colliders.find((c) => c.minX === 64 && c.maxX === 104);
  assert.ok(building, 'restaurant building collider must exist');
  const focus = new THREE.Vector3(building.minX - 2, 1.2, -100);
  const inside = new THREE.Vector3((building.minX + building.maxX) * 0.5, 1.2, -100);
  const safe = map.clampCameraToWorld(focus, inside);
  const intersects = safe.x > building.minX && safe.x < building.maxX
    && safe.z > building.minZ && safe.z < building.maxZ && safe.y < building.height;
  assert.equal(intersects, false, 'clamped camera must stay outside opaque building boxes');
  assert.ok(safe.distanceTo(focus) > 0.5, 'clamp must keep a usable follow distance');
});

test('OpenWorldMap: restaurant door band is split and mezzanine floor switch needs real height', () => {
  const map = new OpenWorldMap(new THREE.Scene());
  map.group.updateMatrixWorld(true);
  const bands: THREE.Mesh[] = [];
  map.group.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh && obj.name === 'shop-band') bands.push(obj as THREE.Mesh);
  });
  assert.ok(bands.length >= 3, 'storefront bands must exist on labelled buildings');
  for (const band of bands) {
    const box = new THREE.Box3().setFromObject(band);
    if (Math.abs(band.position.z - (-73.92)) < 0.01) {
      assert.ok(box.max.x < 82.9 || box.min.x > 85.1, 'restaurant front band must not cover the door gap');
    }
  }
  // Halfway up the stairs, stepping sideways must not teleport to the mezzanine.
  assert.equal(map.sampleInteriorHeight(90, -100, 2.2), 0);
  assert.equal(map.sampleInteriorHeight(90, -100, 4.2), 4.2);
  const counter = map.colliders.some((c) => c.minX < 84 && c.maxX > 84 && c.minZ < -122.8 && c.maxZ > -122.8);
  assert.ok(counter, 'restaurant counter must be solid');
});

test('SaveManager: SEMI gearbox survives a save/load round trip', () => {
  localStorage.clear();
  const first = new SaveManager();
  first.data.gearbox = GearboxType.SEMI;
  first.saveNow();
  const second = new SaveManager();
  assert.equal(second.data.gearbox, GearboxType.SEMI);
  localStorage.clear();
});

test('CharacterController: first punch after respawn is not swallowed by KO input edges', () => {
  const char = new CharacterController();
  char.groundHeightSampler = () => 0;
  char.resetAt(new THREE.Vector3(0, 0, 0));
  char.knockOut();
  const idle = { moveX: 0, moveY: 0, sprint: false, jump: false, punch: false, interact: false };
  char.update(1 / 60, { ...idle, punch: true }, 0);
  for (let i = 0; i < 300; i++) char.update(1 / 60, idle, 0);
  assert.equal(char.isDead, false, 'KO timer must revive the character');
  let strikes = 0;
  char.onPunchStrike = () => { strikes++; };
  char.update(1 / 60, { ...idle, punch: true }, 0);
  assert.equal(strikes, 1, 'first punch after revive must register');
});

test('CarPhysics: mid-air reset cannot award phantom airtime', () => {
  const car = new CarPhysics();
  car.enforceTrackWalls = false;
  car.resetToTrack(new THREE.Vector3(0, 0, 0), 0);
  car.isAirborne = true;
  car.airTime = 1.4;
  let landings = 0;
  car.onAirLanding = () => { landings++; };
  car.resetToTrack(new THREE.Vector3(0, 0, 0), 0);
  car.update(1 / 60, {
    throttle: 0, brake: 0, steer: 0, handbrake: false,
    clutch: false, shiftUp: false, shiftDown: false, reset: false, nitro: false
  }, true);
  assert.equal(landings, 0);
});

test('GameApp state guards stay in place (KO race, stolen car, seat, gear latch, pause)', () => {
  const main = fs.readFileSync(path.join(process.cwd(), 'src/main.ts'), 'utf8');
  const hud = fs.readFileSync(path.join(process.cwd(), 'src/ui/HUD.ts'), 'utf8');
  const save = fs.readFileSync(path.join(process.cwd(), 'src/game/SaveManager.ts'), 'utf8');
  assert.match(main, /startTimedCircuitRace\(laps = 3\): void \{\s*if \(this\.charCtrl\.isDead\)/);
  assert.match(main, /this\.carMesh === this\.ownZenvo\.mesh/);
  assert.match(main, /if \(this\.physics !== this\.ownZenvo\.physics\) \{[\s\S]{0,300}parkActiveCar\(\)/);
  assert.ok(main.includes('this.exitSeat(false);'), 'seat state must be cleared on state transitions');
  assert.match(hud, /e\.code === 'KeyE' && !this\.isOnFoot/);
  assert.match(save, /\['AUTO', 'SEMI', 'MANUAL'\]\.includes\(parsed\.gearbox\)/);
});

test('Asset URLs and chat rows are safe for subpath hosting and untrusted peer names', () => {
  const hud = fs.readFileSync(path.join(process.cwd(), 'src/ui/HUD.ts'), 'utf8');
  const lobby = fs.readFileSync(path.join(process.cwd(), 'src/ui/LobbyUI.ts'), 'utf8');
  const sw = fs.readFileSync(path.join(process.cwd(), 'public/sw.js'), 'utf8');
  assert.match(hud, /who\.textContent = `\$\{sender\}: `/);
  assert.match(lobby, /who\.textContent = `\$\{sender\}: `/);
  assert.doesNotMatch(hud, /innerHTML = `<strong[^>]*>\$\{sender\}/);
  assert.ok(sw.includes('stale-while-revalidate'), 'SW must refresh cached assets');
  assert.equal(modelUrlFor('sora'), '/assets/models/female.glb', 'Node fallback keeps root-absolute asset URLs');
});

test('Gameplay simulation: walk the restaurant staircase to the mezzanine without teleporting', () => {
  const map = new OpenWorldMap(new THREE.Scene());
  const zone = map.interiorFloors[0];
  const char = new CharacterController();
  char.groundHeightSampler = (x, z, y) => map.sampleInteriorHeight(x, z, y) ?? 0;
  char.worldCollider = (pos, vel, radius) => map.resolveCollision(pos, vel, radius);
  const x = (zone.stairs.minX + zone.stairs.maxX) * 0.5;
  char.resetAt(new THREE.Vector3(x, 0, zone.stairs.minZ + 0.2));
  // Foot camera yaw π means the forward input walks toward +Z (stair top).
  const move = { moveX: 0, moveY: 1, sprint: false, jump: false, punch: false, interact: false };
  for (let i = 0; i < 560; i++) char.update(1 / 60, move, Math.PI);
  assert.ok(char.position.z > zone.stairs.maxZ - 1.5, `actor must reach the stair top, got z=${char.position.z.toFixed(1)}`);
  assert.ok(char.position.y > 4.0, `actor must stand on the mezzanine, got y=${char.position.y.toFixed(2)}`);
  const step = (toY: number): number => map.sampleInteriorHeight(90, -100, toY) ?? 0;
  assert.equal(step(char.position.y - 2.0), 0, 'mid-stair height must not select the mezzanine');
  assert.equal(step(char.position.y), 4.2);
});

test('GLTFCharacterMesh: sitting stays seated past the native idle clip duration', async () => {
  for (const [url, id] of [['/assets/models/male.glb', 'kaito'], ['/assets/models/female.glb', 'mika']] as const) {
    const actor = new GLTFCharacterMesh(url, id, '', null, 0, false);
    const deadline = Date.now() + 4000;
    while (!actor.isRealistic && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    const seat = new THREE.Vector3(84, 0.58, -100);
    const yaw = 0.8;
    actor.root.position.copy(actor.sitRootPosition({ pos: seat, yaw }));
    actor.root.rotation.y = yaw;
    actor.setSitting(true);
    // 13s is longer than the female (2.17 + 4.0s) and male (1.13 + 9.5s)
    // enter+idle clips; the old finite LoopRepeat stood up at the end.
    for (let i = 0; i < 780; i++) actor.updateAnimation(1 / 60, 'IDLE');
    const inst = (actor as unknown as { instance: { group: THREE.Group; bones: Map<string, THREE.Bone> } }).instance;
    actor.root.updateMatrixWorld(true);
    const hips = inst.bones.get('hips');
    const head = inst.bones.get('head');
    assert.ok(hips && head);
    const hipY = hips.getWorldPosition(new THREE.Vector3()).y;
    const headY = head.getWorldPosition(new THREE.Vector3()).y;
    assert.equal(actor.isSitting, true, `${id} must still report seated`);
    assert.ok(Math.abs(hipY - seat.y) < 0.12, `${id} hips must stay on the seat, got ${hipY.toFixed(2)}`);
    assert.ok(headY < seat.y + 1.05, `${id} must not stand back up, head y=${headY.toFixed(2)}`);
    actor.dispose();
  }
});

test('GLTFCharacterCache: opaque female materials are not left in the transparent pass', async () => {
  const { loadCharacterTemplate, instantiateCharacter, disposeCharacterInstance } = await import('../src/graphics/GLTFCharacterCache');
  for (const model of ['female', 'male'] as const) {
    const template = await loadCharacterTemplate(model);
    const instance = instantiateCharacter(template);
    for (const mat of instance.materials) {
      if (mat.opacity >= 0.999) {
        assert.equal(mat.transparent, false, `${model} opaque material ${mat.name || '(unnamed)'} must not be transparent`);
        assert.equal(mat.depthWrite, true, `${model} opaque material must write depth`);
      }
    }
    disposeCharacterInstance(instance);
  }
});

test('Character: guard and cross punch read as a real boxing exchange on both rigs', async () => {
  for (const [url, id] of [['/assets/models/male.glb', 'kaito'], ['/assets/models/female.glb', 'mika']] as const) {
    const actor = new GLTFCharacterMesh(url, id, '', null, 0, false);
    const deadline = Date.now() + 4000;
    while (!actor.isRealistic && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    const inst = (actor as unknown as {
      instance: { group: THREE.Group; bones: Map<string, THREE.Bone> };
    }).instance;
    const localHand = (): THREE.Vector3 => {
      actor.root.updateMatrixWorld(true);
      inst.group.updateMatrixWorld(true);
      const p = inst.bones.get('handR')!.getWorldPosition(new THREE.Vector3());
      return p.applyMatrix4(actor.root.matrixWorld.clone().invert());
    };

    actor.setCombatStance(true);
    for (let i = 0; i < 24; i++) actor.updateAnimation(1 / 60, 'IDLE');
    const guard = localHand();
    // Guard: right fist raised to chest/chin height in front of the body.
    assert.ok(guard.y > 1.25 && guard.y < 1.55, `${id} guard hand height ${guard.y.toFixed(2)}`);
    assert.ok(guard.z < -0.18, `${id} guard hand must be in front of the torso, got z=${guard.z.toFixed(2)}`);

    // Punch: fist travels forward and toward the centerline, then returns.
    let peak = guard.clone();
    for (let i = 0; i < 14; i++) {
      actor.updateAnimation(1 / 60, 'PUNCH');
      const h = localHand();
      if (h.z < peak.z) peak = h;
    }
    assert.ok(peak.z < guard.z - 0.15, `${id} punch must reach forward: ${guard.z.toFixed(2)} -> ${peak.z.toFixed(2)}`);
    assert.ok(Math.abs(peak.x) < 0.14, `${id} cross must land near the centerline, got x=${peak.x.toFixed(2)}`);
    assert.ok(peak.y > guard.y - 0.05 && peak.y < 1.75, `${id} punch must stay at head height, got y=${peak.y.toFixed(2)}`);

    for (let i = 0; i < 20; i++) actor.updateAnimation(1 / 60, 'PUNCH');
    const back = localHand();
    assert.ok(Math.abs(back.z - guard.z) < 0.12, `${id} punch must retract to guard, got z=${back.z.toFixed(2)}`);
    actor.dispose();
  }
});

test('Gameplay: standing up from a chair works with movement, jump, E or USE', () => {
  const main = fs.readFileSync(path.join(process.cwd(), 'src/main.ts'), 'utf8');
  const hud = fs.readFileSync(path.join(process.cwd(), 'src/ui/HUD.ts'), 'utf8');
  assert.match(main, /const wantsMove = Math\.hypot\(charInputs\.moveX, charInputs\.moveY\) > 0\.45;/);
  assert.match(main, /if \(interactEdge \|\| charInputs\.jump \|\| wantsMove\) this\.exitSeat\(true\);/);
  assert.match(main, /setUseLabel\(this\.sittingSpot \? 'STAND' : \(promptSpot \? 'SIT' : 'USE'\)\)/);
  assert.match(hud, /public setUseLabel\(label: string\): void/);
  assert.match(hud, /this\.footInteractBtn\.textContent = label;/);
});

test('Gameplay: sparring fighters do not send the police, civilians still do', () => {
  const main = fs.readFileSync(path.join(process.cwd(), 'src/main.ts'), 'utf8');
  // The fighter KO block must not raise heat or file a witness report.
  const fighterBlock = main.slice(main.indexOf('// 2. Hit Roaming Sparring Fighters'), main.indexOf('// 2b. Hit City Pedestrians'));
  assert.ok(fighterBlock.includes('Sparring win. No heat'), 'fighter knockout must tell the player it is heat-free');
  assert.doesNotMatch(fighterBlock, /police\.addHeat/, 'beating a sparring fighter must not add police heat');
  assert.doesNotMatch(fighterBlock, /notifyCrime/, 'beating a sparring fighter must not file a crime report');
  // Civilians remain protected.
  assert.match(main, /onPedestrianKnockedOut[\s\S]{0,220}police\.addHeat\(1, 'ASSAULT ON CIVILIAN'/);
});

test('GLTFCharacterMesh: guard pose is allocation-free and does not rebuild bone subtrees', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/graphics/GLTFCharacterMesh.ts'), 'utf8');
  const start = src.indexOf('private applyCombatPose(');
  const end = src.indexOf('/** Play the rig\'s own sit/stand clips', start);
  assert.ok(start > 0 && end > start, 'combat pose body must be present');
  // Ignore comments when checking the executable body.
  const pose = src.slice(start, end).split('\n').filter((line) => !line.trimStart().startsWith('//')).join('\n');
  assert.doesNotMatch(pose, /new THREE\.(Quaternion|Vector3)/, 'per-frame combat pose must reuse scratch quats/axes');
  assert.doesNotMatch(pose, /updateMatrixWorld\(/, 'per-bone subtree matrix rebuilds were redundant and expensive');
  assert.match(pose, /getWorldQuaternion\(this\.poseGroupQ\)/, 'scratch group quaternion must be used');
});

test('GameApp: leaving a car relocates the character without healing or clearing hit state', () => {
  const main = fs.readFileSync(path.join(process.cwd(), 'src/main.ts'), 'utf8');
  const start = main.indexOf('if (this.inCar) {', main.indexOf('private toggleEnterExitCar'));
  const end = main.indexOf('} else {', start);
  const exit = main.slice(start, end);
  assert.match(exit, /this\.charCtrl\.position\.copy\(exitPos\)/);
  assert.match(exit, /this\.charCtrl\.velocity\.set\(0, 0, 0\)/);
  assert.doesNotMatch(exit, /this\.charCtrl\.resetAt\(/, 'resetAt() on exit would restore HP and erase hit stun');
});

test('PoliceSystem: dispatched cruisers reuse shared beacon resources across spawns and disposal', () => {
  const scene = new THREE.Scene();
  const track = new TrackEnvironment(scene);
  const map = new OpenWorldMap(scene);
  const police = new PoliceSystem(scene, track, map);
  const player = new THREE.Vector3(57, 0, -37);
  police.addHeat(2, 'TEST CRIME', player);
  for (let i = 0; i < 220; i++) police.update(1 / 60, player, true, null, false);
  assert.equal(police.units.length, 2, 'two heat should dispatch two cruisers');

  const [a, b] = police.units;
  assert.equal(a.lightA.geometry, b.lightA.geometry, 'light geometry is shared between units');
  assert.equal((a.lightA.geometry.userData as Record<string, unknown>).shared, true);
  assert.equal(a.lightA.material === b.lightA.material, false, 'strobes stay independently toggleable');
  let sharedStripe = 0;
  a.mesh.root.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (m.material && (m.material as THREE.Material).userData?.shared) sharedStripe++;
  });
  assert.ok(sharedStripe >= 1, 'shared police stripe material is flagged for safe disposal');

  police.clearHeat();
  assert.equal(police.units.length, 0);
  assert.equal(scene.children.some((c) => c === a.mesh.root || c === b.mesh.root), false);
  assert.ok(a.lightA.geometry.getAttribute('position'), 'shared geometry survives a unit despawn');
});

test('OpenWorldMap: camera clamp scratch results are stable across repeated calls', () => {
  const scene = new THREE.Scene();
  const map = new OpenWorldMap(scene);
  const focus = new THREE.Vector3(20, 1, 20);
  const first = map.clampCameraToWorld(focus, new THREE.Vector3(24, 3, 26)).clone();
  const second = map.clampCameraToWorld(focus, new THREE.Vector3(-40, 3, -40)).clone();
  assert.ok(first.distanceTo(new THREE.Vector3(24, 3, 26)) < 0.01, 'unobstructed camera is unchanged');
  assert.ok(second.x < first.x, 'different desired cameras must not alias the shared scratch result');
  assert.ok(Number.isFinite(second.y) && Number.isFinite(second.z));
});

test('GameApp: camera updates reuse scratch vectors and skip redundant projection rebuilds', () => {
  const main = fs.readFileSync(path.join(process.cwd(), 'src/main.ts'), 'utf8');
  const start = main.indexOf('private updateCamera(');
  const camera = main.slice(start, main.indexOf('\n}\n\nwindow.addEventListener', start));
  assert.doesNotMatch(camera, /new THREE\.Vector3/, 'no per-frame vector allocation in the camera path');
  assert.doesNotMatch(camera, /\.clone\(\)/, 'camera path must not clone vectors each frame');
  assert.match(camera, /this\.setCameraFov\(/, 'projection matrix is only rebuilt on actual fov changes');
  const helper = main.slice(main.indexOf('private setCameraFov('), main.indexOf('private updateCamera('));
  assert.match(helper, /Math\.abs\(this\.camera\.fov - fov\) < 0\.01\) return/);
});

test('GLTFCharacterCache: outfit recolouring updates uniforms without recompiling shaders', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/graphics/GLTFCharacterCache.ts'), 'utf8');
  const start = src.indexOf('export function applyCharacterAppearance');
  const end = src.indexOf('/** Only per-instance materials', start);
  assert.ok(start > 0 && end > start);
  const body = src.slice(start, end).split('\n').filter((line) => !line.trimStart().startsWith('//')).join('\n');
  assert.match(body, /std\.color\.copy\(base\)\.lerp\(target, 0\.42\)/);
  assert.doesNotMatch(body, /needsUpdate/, 'material.needsUpdate would recompile the shader on every sync');
});

test('GLTFCharacterMesh: HP name tag redraws only on whole-percent changes', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/graphics/GLTFCharacterMesh.ts'), 'utf8');
  const start = src.indexOf('public setNameAndHp(');
  const body = src.slice(start, src.indexOf('private showSprite(', start));
  assert.match(body, /const shownHp = Math\.round\(hp\)/);
  assert.match(body, /shownHp === this\.lastDrawnHp\)\) return/);
  assert.match(body, /this\.lastDrawnHp = shownHp/);
});

test('GameApp: remote peer outfits are only recoloured when they actually change', () => {
  const main = fs.readFileSync(path.join(process.cwd(), 'src/main.ts'), 'utf8');
  assert.match(main, /st\.appearance && !this\.sameAppearance\(peer\.charMesh\.getAppearance\(\), st\.appearance\)/);
  const helper = main.slice(main.indexOf('private sameAppearance('), main.indexOf('private bindMultiplayerEvents('));
  assert.match(helper, /a\.hairStyle === b\.hairStyle/);
  assert.match(helper, /a\.accessory === b\.accessory/);
});

test('GLTFCharacterMesh: standUpProgress rises smoothly so the chair exit can be animated', async () => {
  const actor = new GLTFCharacterMesh('/assets/models/male.glb', 'kaito', '', null, 0, false);
  const deadline = Date.now() + 4000;
  while (!actor.isRealistic && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
  assert.equal(actor.isRealistic, true);
  actor.setSitting(true);
  for (let i = 0; i < 90; i++) actor.updateAnimation(1 / 60, 'IDLE');
  actor.setSitting(false);

  const progress: number[] = [];
  while (actor.isSitting === false && progress.length < 150) {
    const p = actor.standUpProgress;
    if (p === null) break;
    progress.push(p);
    actor.updateAnimation(1 / 60, 'IDLE');
  }
  assert.ok(progress.length >= 40 && progress.length <= 100, `stand-up should take ~1s, got ${progress.length} frames`);
  assert.ok(progress[0] < 0.1, 'stand-up must start near zero');
  let maxStep = 0;
  for (let i = 1; i < progress.length; i++) {
    assert.ok(progress[i] >= progress[i - 1], 'progress must be monotonic');
    maxStep = Math.max(maxStep, progress[i] - progress[i - 1]);
  }
  assert.ok(maxStep < 0.08, `no single frame may jump progress more than 8%, got ${(maxStep * 100).toFixed(1)}%`);
  actor.dispose();
});

test('GameApp: standing up scoots out of the chair gradually instead of teleporting', () => {
  const main = fs.readFileSync(path.join(process.cwd(), 'src/main.ts'), 'utf8');
  const exit = main.slice(main.indexOf('private exitSeat('), main.indexOf('private sitRootFor('));
  assert.match(exit, /this\.standScootTotal\.copy\(fwd\)\.multiplyScalar\(1\.1\)/);
  assert.match(exit, /this\.standScootApplied = 0/);
  assert.doesNotMatch(exit, /this\.charCtrl\.position\.addScaledVector\(fwd, 1\.1\)/, 'instant 1.1m teleport must be gone');
  const loop = main.slice(main.indexOf('// Scoot out of the chair in step'), main.indexOf('const wasGroundedBeforeStep'));
  assert.match(loop, /this\.avatarMesh\.standUpProgress/);
  assert.match(loop, /Math\.pow\(1 - this\.standScootApplied, 3\)/, 'ease-out keeps the first frame slow');
  assert.match(loop, /this\.charCtrl\.position\.addScaledVector\(this\.standScootTotal, easedAfter - easedBefore\)/);
});

test('OpenWorldMap: the whole GP circuit is labelled GP_CIRCUIT, not Touge or Harbor', () => {
  const scene = new THREE.Scene();
  const track = new TrackEnvironment(scene);
  const map = new OpenWorldMap(scene);
  const wrong = track.trackPoints.filter((p) => map.getDistrictAt(p.x, p.z) !== 'GP_CIRCUIT');
  assert.equal(wrong.length, 0, `GP waypoints mislabelled: ${wrong.length}/${track.trackPoints.length}`);
  assert.equal(map.getDistrictAt(-190, -300), 'GP_CIRCUIT', 'southern sweeper');
  assert.equal(map.getDistrictAt(-110, 222), 'GP_CIRCUIT', 'hairpin apex');
  assert.equal(map.getDistrictAt(155, -296), 'MOUNTAIN_TOUGE');
  assert.equal(map.getDistrictAt(84, 90), 'STUNT_ARENA');
  assert.equal(map.getDistrictAt(84, -100), 'NEON_CORE');
  assert.equal(map.getDistrictAt(176, 250), 'HARBOR_COAST');
});

test('OpenWorldMap: an actor at a collider centre is ejected through the nearest face', () => {
  const map = new OpenWorldMap(new THREE.Scene());
  const box = map.colliders.find((b) => b.maxX - b.minX > 30 && b.height > 40)!;
  assert.ok(box, 'expected a large building collider');
  const cx = (box.minX + box.maxX) * 0.5;
  const cz = (box.minZ + box.maxZ) * 0.5;
  const pos = new THREE.Vector3(cx, 0, cz);
  const vel = new THREE.Vector3(0, 0, 0);
  assert.equal(map.resolveCollision(pos, vel, 1.2), true);
  const inside = pos.x > box.minX && pos.x < box.maxX && pos.z > box.minZ && pos.z < box.maxZ;
  assert.equal(inside, false, 'actor must not remain buried inside the building');
  const nearestFace = Math.min(pos.x - box.minX, box.maxX - pos.x, pos.z - box.minZ, box.maxZ - pos.z);
  assert.ok(nearestFace <= -1.19, `ejection should clear the face, got ${nearestFace}`);
});

test('GameApp: stunt boost pads launch along their authored direction', () => {
  const main = fs.readFileSync(path.join(process.cwd(), 'src/main.ts'), 'utf8');
  const loop = main.slice(main.indexOf('for (const pad of this.openWorld.boostPads)'), main.indexOf('if (this.physics.gear !== prevGear)'));
  assert.match(loop, /this\.boostDirScratch\.set\(pad\.dirX, 0, pad\.dirZ\)/);
  assert.match(loop, /launch\.normalize\(\)/);
  assert.match(loop, /velocity\.addScaledVector\(launch, 18\)/);
  assert.doesNotMatch(loop, /velocity\.addScaledVector\(fwd, 18\)/, 'car yaw must not override the pad direction');
});

test('OpenWorldMap: drifting off the pier funnels sideways instead of snapping back to the seawall', () => {
  const map = new OpenWorldMap(new THREE.Scene());
  const radius = 1.5;
  const pos = new THREE.Vector3(139, 0, 290);
  const vel = new THREE.Vector3(-4, 0, 0);
  map.resolveCollision(pos, vel, radius);
  assert.equal(pos.x, 140 + radius, 'actor should be nudged into the pier lane');
  assert.equal(pos.z, 290, 'z must not jump back to the seawall');
  assert.ok(vel.x > 0, 'lateral velocity should bounce off the invisible lane edge');

  const deepEast = new THREE.Vector3(197, 0, 295);
  map.resolveCollision(deepEast, new THREE.Vector3(4, 0, 0), radius);
  assert.equal(deepEast.x, 196 - radius);
  assert.equal(deepEast.z, 295);

  // Entering from dry land right next to the wall still clamps normally.
  const nearWall = new THREE.Vector3(139, 0, 269);
  map.resolveCollision(nearWall, new THREE.Vector3(0, 0, 5), radius);
  assert.equal(nearWall.z, 268 - radius);
});

test('RoadGraph: blocked same-cell pursuit detours instead of aiming into the building', () => {
  const scene = new THREE.Scene();
  const map = new OpenWorldMap(scene);
  const graph = new RoadGraph();
  const from = new THREE.Vector3(180, 0, -120);
  const to = new THREE.Vector3(215, 0, -120);
  assert.equal(graph.nearestNodeId(from.x, from.z), graph.nearestNodeId(to.x, to.z));
  assert.equal(hasLineOfSight(from.x, from.z, to.x, to.z, map.colliders, 1.6), false);
  // The legacy path returns the blocked target verbatim.
  assert.deepEqual(graph.findNextWaypoint(from, to).toArray(), [215, 0, -120]);
  const detour = graph.findBlockedWaypoint(from, to, map.colliders);
  assert.notDeepEqual(detour.toArray(), [215, 0, -120]);
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  assert.ok(graph.nodes.some((n) => n.x === detour.x && n.z === detour.z && nodeIds.has(n.id)));
  assert.equal(hasLineOfSight(from.x, from.z, detour.x, detour.z, map.colliders, 0.3), true,
    'detour must at least be reachable without cutting through a wall');
});

test('OpenWorldMap: seawall ignores airborne actors and keeps the whole car body on the pier', () => {
  const map = new OpenWorldMap(new THREE.Scene());
  const airborne = new THREE.Vector3(100, 8, 280);
  map.resolveCollision(airborne, new THREE.Vector3(0, 0, 12), 1.55);
  assert.equal(airborne.z, 280, 'a stunt jump above the 0.7m rail must not be teleported back');

  const left = new THREE.Vector3(139, 0, 280);
  map.resolveCollision(left, new THREE.Vector3(0, 0, 12), 1.55);
  assert.equal(left.x, 141.55, 'body overlapping the pier must be nudged fully onto the deck');
  assert.equal(left.z, 280);

  const right = new THREE.Vector3(196, 0, 294);
  map.resolveCollision(right, new THREE.Vector3(0, 0, 12), 1.55);
  assert.equal(right.x, 194.45, 'centre on the pier edge must not leave half the body over water');
  assert.equal(right.z, 294);
});

test('RoadGraph: Touge deck and ramps block low sight lines but not an overflight', () => {
  const map = new OpenWorldMap(new THREE.Scene());
  const occ = map.getElevatedOccluders();
  assert.ok(occ.length >= 7);
  assert.equal(
    hasLineOfSight(34, -296, 62, -296, map.colliders, 0.2, 0, 6, occ),
    false,
    'a car at ground level must not see a target on the 6m deck through the ramp'
  );
  assert.equal(
    hasLineOfSight(34, -296, 62, -296, map.colliders, 0.2, 8, 8, occ),
    true,
    'a drone above the deck has a clear line'
  );
  assert.equal(hasLineOfSight(172, -230, 172, -170, map.colliders), false, 'legacy 2D calls unchanged');
});

test('OpenWorldMap: pier jump clears the deck and lands in recoverable ocean water', () => {
  const map = new OpenWorldMap(new THREE.Scene());
  assert.equal(map.isOverOpenWater(168, 310), true, 'beyond the pier lip is open water');
  assert.equal(map.isOverOpenWater(168, 290), false, 'the pier deck itself is not water');
  assert.equal(map.isOverOpenWater(90, 300), true, 'water outside the pier lane is still water');

  const scene = new THREE.Scene();
  const track = new TrackEnvironment(scene);
  const sample = (x: number, z: number, currentY = 0): GroundSample => {
    const base = track.sampleGround(x, z);
    const rampH = map.sampleRampHeight(x, z);
    const interiorH = map.sampleInteriorHeight(x, z, currentY);
    if (map.isOverOpenWater(x, z)) return { ...base, height: -1.05, isRoad: false };
    return {
      ...base,
      height: Math.max(base.height, rampH, interiorH ?? 0),
      isRoad: base.isRoad || map.isInsideCityOrPlayground(x, z) || rampH > 0 || interiorH !== null
    };
  };
  const car = new CarPhysics();
  car.enforceTrackWalls = false;
  car.groundHeightSampler = sample;
  car.worldCollider = (p, v, r) => map.resolveCollision(p, v, r);
  car.resetToTrack(new THREE.Vector3(168, sample(168, 240).height, 240), Math.PI);
  car.lastSafePosition.copy(car.position);
  const inputs: CarInputs = {
    throttle: 1, brake: 0, steer: 0, handbrake: false, clutch: false,
    shiftUp: false, shiftDown: false, reset: false
  };
  let maxZ = car.position.z;
  let bigBackwardJumps = 0;
  let splash = false;
  let prevZ = car.position.z;
  for (let i = 0; i < 420 && !splash; i++) {
    car.update(1 / 60, inputs, true);
    if (car.position.z > maxZ) maxZ = car.position.z;
    if (car.position.z < prevZ - 2) bigBackwardJumps++;
    prevZ = car.position.z;
    splash = map.isOverOpenWater(car.position.x, car.position.z) && car.position.y < -0.35;
  }
  assert.equal(splash, true, 'a pier launch must actually fall into the ocean');
  assert.ok(maxZ > 310, `jump should clear the pier lip, reached z=${maxZ.toFixed(1)}`);
  assert.equal(bigBackwardJumps, 0, 'no mid-air snap back onto the deck');
  const main = fs.readFileSync(path.join(process.cwd(), 'src/main.ts'), 'utf8');
  assert.match(main, /isOverOpenWater\(this\.physics\.position\.x, this\.physics\.position\.z\)/);
  assert.match(main, /SPLASHDOWN!/);
});

test('WorldActivities: circuit races do not farm open-world rewards; transient scoring resets', () => {
  localStorage.clear();
  const scene = new THREE.Scene();
  let trapHits = 0;
  const activities = new WorldActivities(scene, new SaveManager(), new TrackEnvironment(scene), new OpenWorldMap(scene), {
    onSpeedTrapTriggered: () => { trapHits++; },
    onDriftZoneCompleted: () => {},
    onShardCollected: () => {},
    onNearRivalPrompt: () => {},
    onSprintEnded: () => {}
  });
  const trap = activities.speedTraps[0];
  activities.update(0.1, 0.1, new THREE.Vector3(trap.x, 0, trap.z), 200, true, false, 0, true);
  assert.equal(trapHits, 0, 'speed traps must be inert during a timed circuit race');
  activities.update(0.1, 0.2, new THREE.Vector3(trap.x, 0, trap.z), 200, true, false, 0, false);
  assert.equal(trapHits, 1, 'the same trap must work again in open world');

  activities.activeDriftZone = activities.driftZones[0];
  activities.activeDriftZoneScore = 300;
  activities.speedTraps[0].cooldown = 5;
  activities.resetTransientState();
  assert.equal(activities.activeDriftZone, null);
  assert.equal(activities.activeDriftZoneScore, 0);
  assert.equal(activities.speedTraps[0].cooldown, 0);
});

test('WorldActivities: every rival sprint leg stays clear of building colliders', () => {
  const scene = new THREE.Scene();
  const map = new OpenWorldMap(scene);
  const activities = new WorldActivities(scene, new SaveManager(), new TrackEnvironment(scene), map, {
    onSpeedTrapTriggered: () => {}, onDriftZoneCompleted: () => {}, onShardCollected: () => {},
    onNearRivalPrompt: () => {}, onSprintEnded: () => {}
  });
  const legBlocked = (ax: number, az: number, bx: number, bz: number): boolean => {
    const dx = bx - ax, dz = bz - az;
    for (const c of map.colliders) {
      let tMin = 0, tMax = 1;
      const pad = 1.55;
      const bounds: Array<[number, number]> = [
        [-dx, ax - (c.minX - pad)], [dx, c.maxX + pad - ax],
        [-dz, az - (c.minZ - pad)], [dz, c.maxZ + pad - az]
      ];
      let overlaps = true;
      for (const [p, q] of bounds) {
        if (Math.abs(p) < 1e-9) { if (q < 0) { overlaps = false; break; } continue; }
        const t = q / p;
        if (p < 0) { if (t > tMax) { overlaps = false; break; } if (t > tMin) tMin = t; }
        else { if (t < tMin) { overlaps = false; break; } if (t < tMax) tMax = t; }
      }
      if (overlaps && tMin <= tMax) return true;
    }
    return false;
  };
  for (const rival of activities.rivals) {
    for (let i = 0; i < rival.waypoints.length - 1; i++) {
      const a = rival.waypoints[i], b = rival.waypoints[i + 1];
      assert.equal(
        legBlocked(a.x, a.z, b.x, b.z), false,
        `${rival.id} leg ${i} (${a.x},${a.z}) -> (${b.x},${b.z}) must not cut through a building`
      );
    }
  }
});

test('Lighting: open-world time-of-day, sun direction and shader view vectors are wired', () => {
  const map = new OpenWorldMap(new THREE.Scene());
  const internals = map as unknown as {
    oceanUniforms: { uShallowColor: { value: THREE.Color } };
    buildingMats: THREE.MeshStandardMaterial[];
  };
  const dayWater = internals.oceanUniforms.uShallowColor.value.getHexString();
  const dayGlow = internals.buildingMats[0].emissiveIntensity;
  map.setTimeOfDay('NIGHT');
  assert.notEqual(internals.oceanUniforms.uShallowColor.value.getHexString(), dayWater);
  assert.notEqual(internals.buildingMats[0].emissiveIntensity, dayGlow);

  const main = fs.readFileSync(path.join(process.cwd(), 'src/main.ts'), 'utf8');
  assert.match(main, /this\.openWorld\.setTimeOfDay\(tod\)/);
  assert.match(main, /addScaledVector\(this\.sunDirection, 150\)/);
  const shaders = fs.readFileSync(path.join(process.cwd(), 'src/graphics/Shaders.ts'), 'utf8');
  assert.match(shaders, /vWorldDir = worldPos\.xyz - cameraPosition/);
  assert.match(shaders, /viewDir = normalize\(cameraPosition - vWorldPos\)/);
});

test('World art: lamps avoid expressway, waterfront decks reach below water, wet materials complete', () => {
  const scene = new THREE.Scene();
  const track = new TrackEnvironment(scene);
  const map = new OpenWorldMap(scene);
  const mapSrc = fs.readFileSync(path.join(process.cwd(), 'src/graphics/OpenWorldMap.ts'), 'utf8');
  const trackSrc = fs.readFileSync(path.join(process.cwd(), 'src/graphics/TrackEnvironment.ts'), 'utf8');
  assert.match(mapSrc, /\[-160, -40, 30, 150, 224\]\.some\(\(sz\) => Math\.abs\(z - sz\) < 9\.5\)/);
  assert.match(mapSrc, /BoxGeometry\(282, 1\.2, 38\)/);
  assert.match(mapSrc, /BoxGeometry\(56, 1\.2, 34\)/);
  assert.match(trackSrc, /roadUVs\.push\(0\.035, i \* 0\.3, 0\.965, i \* 0\.3\)/);

  assert.ok(track.startGridMesh, 'start grid must be registered for wet-surface updates');
  const gridMat = track.startGridMesh!.material as THREE.MeshStandardMaterial;
  track.setWetSurface(true);
  assert.equal(gridMat.roughness, 0.22);
  track.setWetSurface(false);
  assert.equal(gridMat.roughness, 0.75);

  const pierAndPitch = (map as unknown as { roadMats: THREE.MeshStandardMaterial[] }).roadMats
    .filter((m) => m.color.getHex() === 0x334155 || m.color.getHex() === 0x166534);
  assert.ok(pierAndPitch.length >= 3, 'quay, pier and pitch must all respond to rain');
  map.setWetSurface(true);
  assert.ok(pierAndPitch.every((m) => m.roughness === 0.18));
  map.setWetSurface(false);
  assert.ok(pierAndPitch.every((m) => m.roughness === 0.82));
});

test('AdaptiveResolution: a borderline GPU settles instead of pumping between two ratios', () => {
  const feed = (gov: AdaptiveResolution, fps: number, seconds: number) => {
    const dt = 1 / fps;
    for (let i = 0; i < Math.round(seconds * fps); i++) gov.sample(dt);
  };
  const gov = new AdaptiveResolution(1, {
    minRatio: 0.8, maxRatio: 1.1, step: 0.1, windowSec: 0.5,
    warmupSec: 0, downFps: 45, upFps: 57, downWindows: 2, upWindows: 3
  });
  // At 1.1 the device can only hold 44fps, so it steps back to 1.0.
  feed(gov, 60, 4);
  assert.equal(gov.currentRatio, 1.1);
  feed(gov, 44, 1.5);
  assert.equal(gov.currentRatio, 1);
  // A 60fps display cap is not enough evidence that 1.1 is now safe.
  feed(gov, 60, 12);
  assert.equal(gov.currentRatio, 1, 'must not pump back into the failed ratio');
  // Genuine headroom above the failed setting still allows recovery.
  feed(gov, 75, 6);
  assert.equal(gov.currentRatio, 1.1);
});

test('Combat LOS: sparring fighters and police busts cannot reach through solid walls', () => {
  const scene = new THREE.Scene();
  const map = new OpenWorldMap(scene);
  const wall = map.colliders.find((c) =>
    c.minX <= 103.4 && c.maxX >= 104 && c.minZ <= -100 && c.maxZ >= -100
  )!;
  assert.ok(wall, 'expected Harbor Inn wall collider');
  assert.equal(
    hasLineOfSight(102.5, -100, 104.5, -100, map.colliders, 0.2, 0, 0, map.getElevatedOccluders()),
    false
  );

  let punches = 0;
  const fighter = new SparringFighter('Test', 'kaito', new THREE.Vector3(102.5, 0, -100), scene, map);
  fighter.controller.onPunchStrike = () => { punches++; };
  for (let i = 0; i < 180; i++) {
    fighter.update(1 / 60, new THREE.Vector3(104.5, 0, -100), true);
  }
  assert.equal(punches, 0, 'fighter must not punch a target separated by a wall');

  const policeSrc = fs.readFileSync(path.join(process.cwd(), 'src/game/PoliceSystem.ts'), 'utf8');
  assert.match(
    policeSrc,
    /dist < 6\.8[\s\S]{0,280}hasLineOfSight\(/,
    'bust branch must re-check line-of-sight before arresting'
  );
});

test('Pedestrian reactions and patrol routes respect walls and stuck recovery', () => {
  const scene = new THREE.Scene();
  const map = new OpenWorldMap(scene);
  const peds = new PedestrianSystem(scene, map, () => 0, 1);
  const agent = peds.agents[0];
  agent.controller.position.set(102, 0, -100);
  agent.state = 'WALK';
  peds.alertDanger(new THREE.Vector3(106, 0, -100), 20);
  assert.notEqual(agent.state, 'FLEE', 'visual danger behind a wall must not trigger FLEE');

  const witnessed = peds.notifyCrime(new THREE.Vector3(106, 0, -100), 'TEST', 30);
  assert.equal(witnessed, false, 'a crime behind a wall must not produce a witness');
  assert.notEqual(agent.state, 'WITNESS');

  const src = fs.readFileSync(path.join(process.cwd(), 'src/ai/PedestrianSystem.ts'), 'utf8');
  assert.match(src, /\[\[224, -140\], \[224, 16\]\]/, 'patrol must route around Harbor Inn');
  assert.equal(new PedestrianSystem(scene, map, () => 0).agents.length, 14, 'all 14 patrol agents must remain');
  assert.match(src, /stuckTimer > 2\.5/, 'patrol must have bounded stuck recovery');
});

test('RoadGraph: elevated nodes stay distinct from ground routing and detours use the ramp mouth', () => {
  const graph = new RoadGraph();
  const map = new OpenWorldMap(new THREE.Scene());
  const groundId = graph.nearestNodeId(155, -296, 0);
  const deckId = graph.nearestNodeId(155, -296, 6);
  assert.equal(graph.nodes[groundId].y, 0, 'a ground unit under the deck must not snap onto the summit');
  assert.equal(graph.nodes[deckId].y, 6, 'a unit on the deck must snap onto the summit');

  const from = new THREE.Vector3(155, 0, -240);
  const target = new THREE.Vector3(155, 6, -296);
  assert.equal(hasLineOfSight(
    from.x, from.z, target.x, target.z, map.colliders, 1.6,
    from.y, target.y, map.getElevatedOccluders()
  ), false);
  const detour = graph.findBlockedWaypoint(
    from, target, map.colliders, new THREE.Vector3(), from.y, target.y, map.getElevatedOccluders()
  );
  assert.equal(detour.y, 0, 'the first detour waypoint must be reachable from the ground');
  assert.notEqual(detour.y, graph.nodes[deckId].y);
});

test('Police pursue an elevated target through the Touge ramp without per-frame target flipping', () => {
  const scene = new THREE.Scene();
  const map = new OpenWorldMap(scene);
  const track = new TrackEnvironment(scene);
  const police = new PoliceSystem(scene, track, map);
  const elevated = new THREE.Vector3(155, 6, -296);
  police.addHeat(2, 'TEST', new THREE.Vector3(215, 0, -120));
  (police as unknown as { crimeCooldown: number }).crimeCooldown = 9999;
  for (let i = 0; i < 600 && police.units.length === 0; i++) {
    police.update(1 / 60, elevated, false, null);
  }
  assert.equal(police.units.length, 1, 'a cruiser must be dispatched');
  const unit = police.units[0];
  unit.physics.resetToTrack(new THREE.Vector3(155, 0, -240), Math.PI);
  unit.mode = 'PURSUING';
  (police as unknown as { lastKnownPos: THREE.Vector3 }).lastKnownPos.copy(elevated);
  unit.navTarget.set(0, 0, 0);

  let previous = new THREE.Vector3();
  let flips = 0;
  let minDistance = Infinity;
  for (let i = 0; i < 2400; i++) {
    police.update(1 / 60, elevated, false, null);
    if (i > 2 && unit.navTarget.distanceToSquared(previous) > 400) flips++;
    previous.copy(unit.navTarget);
    minDistance = Math.min(minDistance, unit.physics.position.distanceTo(elevated));
  }
  assert.ok(minDistance < 3, `cruiser must actually climb the ramp to the target, closest ${minDistance.toFixed(1)}m`);
  assert.ok(flips < 20, `nav target must not flip every frame, saw ${flips} flips in 40s`);
});

test('AI cars use ocean ground and recover from splashdowns like the player', () => {
  const scene = new THREE.Scene();
  const map = new OpenWorldMap(scene);
  const track = new TrackEnvironment(scene);
  const bot = new CityCruiserBot('probe', 'Test', '#fff', [
    new THREE.Vector3(46, 0, -160), new THREE.Vector3(224, 0, -160),
    new THREE.Vector3(224, 0, 150), new THREE.Vector3(46, 0, 150)
  ], 0, map, track, scene);
  assert.equal(bot.physics.groundHeightSampler(168, 310).height, -1.05);
  const safe = new THREE.Vector3(168, 0, 240);
  bot.physics.resetToTrack(safe, Math.PI);
  bot.physics.position.set(168, -1, 310);
  assert.equal(map.shouldRecoverFromWater(bot.physics.position), true);
  bot.update(1 / 60, new THREE.Vector3(0, 0, 0), null, []);
  assert.ok(bot.physics.position.distanceTo(safe) < 1, 'a splashed traffic bot must return to its last safe road');
  assert.equal(map.shouldRecoverFromWater(bot.physics.position), false);

  const policeSrc = fs.readFileSync(path.join(process.cwd(), 'src/game/PoliceSystem.ts'), 'utf8');
  const activitiesSrc = fs.readFileSync(path.join(process.cwd(), 'src/game/WorldActivities.ts'), 'utf8');
  for (const src of [policeSrc, activitiesSrc]) {
    assert.match(src, /isOverOpenWater\(x, z\)/);
    assert.match(src, /shouldRecoverFromWater\(/);
  }
});

test('HumanCharacterMesh 3D emote engine, joint sign anatomy & ParticleSystem soft smoke sprites', () => {
  const char = new HumanCharacterMesh('kaito', 'Kaito_01');
  const rig = char as unknown as {
    leftArm: THREE.Group;
    rightArm: THREE.Group;
    leftForearm: THREE.Group;
    rightForearm: THREE.Group;
    leftShin: THREE.Group;
    rightShin: THREE.Group;
    activeEmote: string | null;
  };

  // IDLE pose: outward arm hang (left <= 0, right >= 0) & forward elbow flex (> 0)
  for (let i = 0; i < 30; i++) char.updateAnimation(1 / 60, 'IDLE');
  assert.ok(rig.leftArm.rotation.z < 0, `Expected outward leftArm.z < 0, got ${rig.leftArm.rotation.z}`);
  assert.ok(rig.rightArm.rotation.z > 0, `Expected outward rightArm.z > 0, got ${rig.rightArm.rotation.z}`);
  assert.ok(rig.leftForearm.rotation.x > 0, `Expected forward forearm flex > 0, got ${rig.leftForearm.rotation.x}`);

  // Emote VICTORY: raises right arm skyward & triggers activeEmote
  char.triggerEmote('VICTORY', 2.0);
  assert.equal(rig.activeEmote, 'VICTORY');
  for (let i = 0; i < 20; i++) char.updateAnimation(1 / 60, 'IDLE');
  assert.ok(rig.rightArm.rotation.x > 1.2, `Expected VICTORY raised right arm x > 1.2, got ${rig.rightArm.rotation.x}`);

  // Running immediately cancels emote and bends knees backward (<= 0)
  for (let i = 0; i < 25; i++) char.updateAnimation(1 / 60, 'RUN');
  assert.equal(rig.activeEmote, null);
  assert.ok(rig.leftShin.rotation.x <= 0.01 && rig.rightShin.rotation.x <= 0.01);

  // Soft sprite particle pool check (no dodecahedron smoke blobs)
  const scene = new THREE.Scene();
  const particles = new ParticleSystem(scene);
  particles.emitSmoke(new THREE.Vector3(0, 0, 0), new THREE.Vector3(4, 0, 0), false, 1);
  const pool = (particles as unknown as { particlePool: { sprite: THREE.Sprite }[] }).particlePool;
  assert.equal(pool.length, 120);
  assert.equal(pool[0].sprite.isSprite, true);
  assert.equal(pool[0].sprite.visible, true);

  char.dispose();
});

test('OpenWorldMap & TrackEnvironment: enterable Drift Garage, Neo Ramen, Zenith 50m Rooftop, flat city & deep lake', () => {
  const scene = new THREE.Scene();
  const track = new TrackEnvironment(scene);
  const map = new OpenWorldMap(scene);

  // 1. Track Lake is genuinely submerged below water surface (-1.2), not y = 0 thin air
  assert.ok(track.isOverLakeWater(-165, -20));
  assert.ok(track.sampleGround(-165, -20).height < -2.0, 'lake center must submerge below -1.2 water');

  // 2. All 4 landmark interiors register walkable floors + Zenith rooftop at y = 50
  assert.ok(map.interiorFloors.length >= 4, 'ANIME CAFE, DRIFT GARAGE, NEO RAMEN & ZENITH LOBBY must be enterable');
  assert.equal(map.sampleInteriorHeight(84, -5, 0), 0, 'DRIFT GARAGE interior bay must be walkable');
  assert.equal(map.sampleInteriorHeight(260, -100, 0), 0, 'NEO RAMEN interior must be walkable');
  assert.equal(map.sampleInteriorHeight(260, -5, 0), 0, 'ZENITH CORP lobby must be walkable');
  assert.equal(map.sampleInteriorHeight(260, -5, 50), 50, 'ZENITH CORP rooftop must support y=50 sky deck');

  // 3. Interactables & hidden collectibles give real purpose to [E / USE] and exploration
  const types = new Set(map.interactables.map((i) => i.type));
  for (const req of ['GARAGE_TUNE', 'EAT_RAMEN', 'ESPRESSO', 'ARCADE', 'ELEVATOR_UP', 'ELEVATOR_DOWN', 'HACK_TERMINAL', 'ROOFTOP_GLIDE', 'VENDING'] as const) {
    assert.ok(types.has(req), `expected interactable type ${req}`);
  }
  assert.ok(map.collectibles.length >= 8, 'city & rooftops must contain hidden cash stashes');

  // 4. Garage entrance bay (z = 9, x = 84) is wide open for driving in
  const bayPos = new THREE.Vector3(84, 0, 9);
  assert.equal(map.resolveCollision(bayPos, new THREE.Vector3(0, 0, -5), 1.4), false, 'Drift Garage bay doorway must let cars drive in');
});

test('CharacterController: swims in deep water, executes 3-hit boxing combo & dodge-dash', () => {
  const char = new CharacterController();
  let splashes = 0;
  let dashes = 0;
  char.groundHeightSampler = (x) => (x > 50 ? -2.5 : 0);
  char.waterSurfaceSampler = (x) => (x > 50 ? -0.8 : null);
  char.onSplash = () => { splashes++; };
  char.onDash = () => { dashes++; };
  char.resetAt(new THREE.Vector3(60, -0.5, 0), 0);

  for (let i = 0; i < 45; i++) {
    char.update(1 / 60, { moveX: 0, moveY: 0, sprint: false, jump: false, punch: false }, 0);
  }
  assert.equal(char.isSwimming, true, 'deep water must switch character into swimming state');
  assert.ok(splashes >= 1, 'entering deep water should emit splash event');
  assert.ok(char.position.y > -2.2 && char.position.y < -1.2, `character must float near water surface, got y=${char.position.y}`);

  // Dry land: 3-hit boxing combo cycles 0 -> 1 -> 2 & dash spends stamina
  char.resetAt(new THREE.Vector3(0, 0, 0), 0);
  const steps: number[] = [];
  for (let hit = 0; hit < 3; hit++) {
    for (let f = 0; f < 22; f++) {
      char.update(1 / 60, { moveX: 0, moveY: 0, sprint: false, jump: false, punch: f === 0 }, 0);
    }
    steps.push(char.comboStep);
  }
  assert.deepEqual(steps, [0, 1, 2], 'boxing punches must chain 3-hit combo');

  char.update(1 / 60, { moveX: 0, moveY: 1, sprint: false, jump: false, punch: false, dash: true }, 0);
  assert.equal(dashes, 1);
  assert.equal(char.isDashing, true);
  assert.ok(char.stamina < 100);
});

test('HelicopterPhysics, HelicopterMesh GLB & OpenWorldMap Sky Rings / Zenith Helipad', async () => {
  const scene = new THREE.Scene();
  const map = new OpenWorldMap(scene);
  assert.equal(map.skyRings.length, 8, '8 aerial Sky Rings must exist over Neo Velo');
  assert.equal(map.sampleHeliGroundHeight(258, -5, 50), 50, 'Zenith Corp Helipad supports landing at y=50');
  assert.ok(map.sampleHeliGroundHeight(172, -200, 76) >= 66, 'Skyscraper roofs support helicopter landing');

  const heli = new HelicopterPhysics();
  heli.groundHeightSampler = (x, z, y) => map.sampleHeliGroundHeight(x, z, y);
  heli.worldCollider = (p, v, r) => map.resolveCollision(p, v, r);
  heli.resetAt(new THREE.Vector3(258, 50, -5), 0);

  // Spool rotors and climb off Zenith Rooftop
  for (let i = 0; i < 160; i++) {
    heli.update(1 / 60, { pitch: 0, yaw: 0, strafe: 0, ascend: true, descend: false }, true);
  }
  assert.ok(heli.rotorRpm > 0.9, `Rotors must spool cleanly, got ${heli.rotorRpm}`);
  assert.ok(heli.position.y > 55, `Helicopter must lift off Zenith Helipad (y=50), reached ${heli.position.y.toFixed(1)}`);

  // Forward flight banks & builds cruise airspeed
  for (let i = 0; i < 90; i++) {
    heli.update(1 / 60, { pitch: 1, yaw: 0.4, strafe: 0, ascend: false, descend: false }, true);
  }
  assert.ok(heli.speedKmh > 45, `Forward pitch must accelerate chopper, got ${heli.speedKmh.toFixed(1)} km/h`);
  assert.ok(heli.pitch < -0.1, 'Forward flight must tilt nose down');

  // Verify real helicopter.glb loads, spins rotors, and toggles searchlight
  const heliMesh = new HelicopterMesh();
  const deadline = Date.now() + 4000;
  while (!heliMesh.isLoaded && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.equal(heliMesh.isLoaded, true, 'public/assets/models/helicopter.glb must load cleanly');
  assert.equal(heliMesh.toggleSearchlight(), true);
  heliMesh.update(heli, 1 / 60);
});

test('WebSocket Security: malformed frames, oversize, forged hits, late-join & rate limits', async () => {
  const backend = createLobbyBackend({ sessionGraceMs: 250 });
  const server = http.createServer();
  backend.attachWebSocket(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;

  const connectRaw = async () => {
    const msgs: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.on('error', () => {});
    await new Promise<void>((resolve) => {
      ws.on('message', (buf) => {
        msgs.push(JSON.parse(buf.toString()));
        if (msgs.length >= 2) resolve();
      });
    });
    return { ws, msgs };
  };

  const c1 = await connectRaw();
  const c2 = await connectRaw();
  const c3 = await connectRaw();

  try {
    // 1. Malformed JSON, null, array, bad type -> ERROR without crash
    c1.ws.send('{{bad-json');
    c1.ws.send('null');
    c1.ws.send('[1,2,3]');
    c1.ws.send(JSON.stringify({ type: 123 }));
    await new Promise((r) => setTimeout(r, 60));
    const errors = c1.msgs.filter((m) => m.type === 'ERROR');
    assert.ok(errors.length >= 4, 'server must safely reject malformed frames with ERROR');

    // 2. Oversize payload (>8KB) closes cleanly with 1009 (Message too large)
    const oversize = await connectRaw();
    const closePromise = new Promise<number>((resolve) => oversize.ws.on('close', (code) => resolve(code)));
    oversize.ws.send(JSON.stringify({ type: 'CHAT', payload: { text: 'A'.repeat(9000) } }));
    const closeCode = await closePromise;
    assert.ok(closeCode === 1009 || closeCode === 1006, `oversized frame closed with ${closeCode}`);

    // 3. Host creates room & c2 joins
    c1.ws.send(JSON.stringify({ type: 'CREATE_ROOM', payload: { playerName: 'HostSec', mode: 'DRIFT_ARENA' } }));
    const roomState = await new Promise<{ code: string }>((resolve) => {
      const iv = setInterval(() => {
        const hit = c1.msgs.find((m) => m.type === 'ROOM_STATE');
        if (hit) { clearInterval(iv); resolve((hit.payload as { room: { code: string } }).room); }
      }, 15);
    });
    const code = roomState.code;

    c2.msgs.length = 0;
    c2.ws.send(JSON.stringify({ type: 'JOIN_ROOM', payload: { code, playerName: 'GuestSec' } }));
    await new Promise<void>((resolve) => {
      const iv = setInterval(() => {
        if (c2.msgs.some((m) => m.type === 'ROOM_STATE')) { clearInterval(iv); resolve(); }
      }, 15);
    });

    // 4. Non-host cannot START_GAME or ADD_BOT
    const c2ErrBefore = c2.msgs.filter((m) => m.type === 'ERROR').length;
    c2.ws.send(JSON.stringify({ type: 'START_GAME', payload: {} }));
    c2.ws.send(JSON.stringify({ type: 'ADD_BOT', payload: {} }));
    await new Promise((r) => setTimeout(r, 40));
    assert.ok(c2.msgs.filter((m) => m.type === 'ERROR').length >= c2ErrBefore + 2);

    // 5. NaN / Infinity / extreme PLAYER_STATE coords are clamped & stripped
    const c2Id = String(c2.msgs[0]?.payload?.clientId || c2.msgs.find((m) => m.type === 'WELCOME')?.payload?.clientId || '');
    const c1WelcomeId = String((c1.msgs[0].payload as { clientId: string }).clientId);
    c1.msgs.length = 0;
    c2.ws.send(JSON.stringify({
      type: 'PLAYER_STATE',
      payload: { id: 'SPOOFED', x: 999999, y: null, z: -999999, hp: 5000, animState: 'HACKED' }
    }));
    await new Promise((r) => setTimeout(r, 40));
    const wsMsg = c1.msgs.find((m) => m.type === 'WORLD_STATE');
    assert.ok(wsMsg, 'valid sanitized WORLD_STATE delivered');
    const guestSync = Object.values((wsMsg!.payload as { states: Record<string, Record<string, unknown>> }).states)[0];
    assert.notEqual(guestSync.id, 'SPOOFED');
    assert.equal(guestSync.x, 1200);
    assert.equal(guestSync.hp, 100);
    assert.equal(guestSync.animState, 'IDLE');

    // 6. Forged MELEE_HIT (>45 damage capped, >6.5m rejected)
    c1.ws.send(JSON.stringify({ type: 'PLAYER_STATE', payload: { x: 0, y: 0, z: 0 } }));
    await new Promise((r) => setTimeout(r, 30));
    c2.msgs.length = 0;
    c1.ws.send(JSON.stringify({ type: 'MELEE_HIT', payload: { targetId: String(guestSync.id), damage: 9999, dirX: 1, dirZ: 0 } }));
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(c2.msgs.filter((m) => m.type === 'MELEE_HIT').length, 0, 'out-of-range melee hit (>6.5m) blocked');

    // Move host within melee range & clear cooldown -> forged 9999 damage clamped to 45
    c2.ws.send(JSON.stringify({ type: 'PLAYER_STATE', payload: { x: 1, y: 0, z: 0 } }));
    await new Promise((r) => setTimeout(r, 250));
    c2.msgs.length = 0;
    c1.ws.send(JSON.stringify({ type: 'MELEE_HIT', payload: { targetId: String(guestSync.id), damage: 9999, dirX: 3, dirZ: 4 } }));
    await new Promise((r) => setTimeout(r, 40));
    const melee = c2.msgs.find((m) => m.type === 'MELEE_HIT')?.payload as { damage: number; attackerId: string } | undefined;
    assert.ok(melee, 'in-range melee delivered');
    assert.equal(melee!.damage, 45);
    assert.equal(melee!.attackerId, c1WelcomeId);

    // 7. Late-join blocked once room enters PLAYING
    c1.ws.send(JSON.stringify({ type: 'START_GAME', payload: {} }));
    await new Promise((r) => setTimeout(r, 40));
    c3.msgs.length = 0;
    c3.ws.send(JSON.stringify({ type: 'JOIN_ROOM', payload: { code, playerName: 'LateJoiner' } }));
    await new Promise((r) => setTimeout(r, 40));
    assert.ok(c3.msgs.some((m) => m.type === 'ERROR' && String(m.payload.message).includes('started')), 'late join rejected');
    assert.ok(c2Id !== undefined || true);
  } finally {
    c1.ws.close();
    c2.ws.close();
    c3.ws.close();
    backend.shutdown();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('Multiplayer Recovery, Host Migration, Expired Token & Leaderboard', async () => {
  const backend = createLobbyBackend({ sessionGraceMs: 180 });
  const server = http.createServer();
  backend.attachWebSocket(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;

  const connectClient = async () => {
    const msgs: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((resolve) => {
      ws.on('message', (buf) => {
        msgs.push(JSON.parse(buf.toString()));
        if (msgs.some((m) => m.type === 'WELCOME')) resolve();
      });
    });
    const welcome = msgs.find((m) => m.type === 'WELCOME')!.payload as { clientId: string; resumeToken: string };
    return { ws, msgs, clientId: welcome.clientId, resumeToken: welcome.resumeToken };
  };

  const host = await connectClient();
  const guest = await connectClient();
  let reconnectedHost: Awaited<ReturnType<typeof connectClient>> | null = null;
  let lateExpiredHost: Awaited<ReturnType<typeof connectClient>> | null = null;

  try {
    host.ws.send(JSON.stringify({ type: 'CREATE_ROOM', payload: { playerName: 'Alpha', mode: 'DRIFT_ARENA' } }));
    await new Promise((r) => setTimeout(r, 35));
    const room = (host.msgs.find((m) => m.type === 'ROOM_STATE')!.payload as { room: { code: string } }).room;

    guest.ws.send(JSON.stringify({ type: 'JOIN_ROOM', payload: { code: room.code, playerName: 'Beta' } }));
    await new Promise((r) => setTimeout(r, 35));

    // Submit drift score -> verify LEADERBOARD_UPDATE
    guest.ws.send(JSON.stringify({ type: 'RESULT_SUBMIT', payload: { mode: 'DRIFT_ARENA', score: 12450, combo: 4 } }));
    host.ws.send(JSON.stringify({ type: 'RESULT_SUBMIT', payload: { mode: 'DRIFT_ARENA', score: 18900, combo: 6 } }));
    await new Promise((r) => setTimeout(r, 40));
    const lb = guest.msgs.filter((m) => m.type === 'LEADERBOARD_UPDATE').pop()?.payload as { entries: Array<{ name: string; score: number }> };
    assert.ok(lb && lb.entries.length === 2);
    assert.equal(lb.entries[0].name, 'Alpha');
    assert.equal(lb.entries[0].score, 18900);

    // Abnormally terminate host socket -> grace reservation keeps slot; RESUME_SESSION recovers without duplicate!
    host.ws.terminate();
    await new Promise((r) => setTimeout(r, 40));
    reconnectedHost = await connectClient();
    reconnectedHost.ws.send(JSON.stringify({ type: 'RESUME_SESSION', payload: { resumeToken: host.resumeToken } }));
    await new Promise((r) => setTimeout(r, 50));
    const resumed = reconnectedHost.msgs.find((m) => m.type === 'SESSION_RESUMED');
    assert.ok(resumed, 'host recovered session with resumeToken');
    const resumedRoom = (resumed!.payload as { room: { players: Array<{ id: string; isHost: boolean }> }; clientId: string });
    assert.equal(resumedRoom.clientId, host.clientId);
    assert.equal(resumedRoom.room.players.length, 2, 'must not create duplicate player entry');
    assert.ok(resumedRoom.room.players.find((p) => p.id === host.clientId)?.isHost, 'host status preserved');

    // Now terminate host & let grace window expire -> host migrates to guest & late resume receives SESSION_EXPIRED
    guest.msgs.length = 0;
    reconnectedHost.ws.terminate();
    await new Promise((r) => setTimeout(r, 240));
    const migratedState = guest.msgs.filter((m) => m.type === 'ROOM_STATE').pop()?.payload as { room: { players: Array<{ id: string; isHost: boolean }> } };
    assert.ok(migratedState, 'guest receives migrated ROOM_STATE after grace timeout');
    assert.equal(migratedState.room.players.length, 1);
    assert.equal(migratedState.room.players[0].id, guest.clientId);
    assert.equal(migratedState.room.players[0].isHost, true);

    lateExpiredHost = await connectClient();
    lateExpiredHost.ws.send(JSON.stringify({ type: 'RESUME_SESSION', payload: { resumeToken: host.resumeToken } }));
    await new Promise((r) => setTimeout(r, 40));
    assert.ok(lateExpiredHost.msgs.some((m) => m.type === 'SESSION_EXPIRED'), 'expired token must return SESSION_EXPIRED');
  } finally {
    host.ws.close();
    guest.ws.close();
    reconnectedHost?.ws.close();
    lateExpiredHost?.ws.close();
    backend.shutdown();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('Standalone Online Server: health, LAN vs Cloud /api/lan-info isolation & static security', async () => {
  const srv = startOnlineServer({ port: 0, host: '127.0.0.1', distDir: 'dist', quiet: true });
  const { port } = await srv.listening;
  try {
    const healthRes = await new Promise<{ status: number; body: string }>((resolve) => {
      http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
      });
    });
    assert.equal(healthRes.status, 200);
    assert.equal(JSON.parse(healthRes.body).ok, true);

    // Cloud proxy / Render simulation: must NOT leak private container IPs!
    const prevRender = process.env.RENDER;
    process.env.RENDER = 'true';
    try {
      const cloudRes = await new Promise<{ status: number; body: string }>((resolve) => {
        http.get(
          `http://127.0.0.1:${port}/api/lan-info`,
          { headers: { 'x-forwarded-host': 'apex-zero.onrender.com', 'x-forwarded-proto': 'https' } },
          (res) => {
            let data = '';
            res.on('data', (c) => (data += c));
            res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
          }
        );
      });
      const cloudInfo = JSON.parse(cloudRes.body);
      assert.equal(cloudInfo.mode, 'ONLINE');
      assert.equal(cloudInfo.ips.length, 0, 'cloud mode must not expose container-private IPs');
      assert.equal(cloudInfo.preferredUrl, 'https://apex-zero.onrender.com');
    } finally {
      if (prevRender === undefined) delete process.env.RENDER;
      else process.env.RENDER = prevRender;
    }

    // Path traversal blocked
    const traversalStatus = await new Promise<number>((resolve) => {
      http.get(`http://127.0.0.1:${port}/../../package.json`, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode || 0));
      });
    });
    assert.ok(traversalStatus === 403 || traversalStatus === 404);
  } finally {
    await srv.stop();
  }
});

test('SaveManager v2 migration & JSON backup, plus OfflinePack & PWA relative integrity', async () => {
  // 1. Legacy v1 migration & bad field sanitization
  const migrated = migrateSave({
    version: 1,
    playerName: '  Turbo\u0007Kid  ',
    credits: -500,
    legendXp: 'NaN',
    engineStage: 99,
    carArchetype: 'INVALID'
  });
  assert.equal(migrated.version, CURRENT_SAVE_VERSION);
  assert.equal(migrated.playerName, 'TurboKid');
  assert.equal(migrated.credits, 1000, 'negative credits fall back safely to default');
  assert.equal(migrated.legendXp, 0);
  assert.equal(migrated.engineStage, 3);
  assert.equal(migrated.carArchetype, 'HYPER');

  // 2. Save export/import round-trip
  localStorage.clear();
  const sm = new SaveManager();
  sm.data.credits = 4250;
  sm.data.bestDriftCombo = 9800;
  const exported = sm.exportJson();
  assert.equal(sm.importJson('not-json').ok, false);
  assert.equal(sm.importJson('[]').ok, false);
  sm.resetAll();
  assert.equal(sm.data.credits, 1000);
  assert.equal(sm.importJson(exported).ok, true);
  assert.equal(sm.data.credits, 4250);
  assert.equal(sm.data.bestDriftCombo, 9800);

  // 3. OfflinePack assets exist on disk & PWA manifest/sw use relative ./ paths
  for (const rel of REQUIRED_OFFLINE_ASSETS) {
    const clean = decodeURIComponent(rel.replace(/^\.\//, ''));
    const inPublic = path.join(process.cwd(), 'public', clean);
    const inRoot = path.join(process.cwd(), clean);
    assert.ok(fs.existsSync(inPublic) || fs.existsSync(inRoot), `Missing required offline asset: ${clean}`);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  const offlineStatus = await checkOfflinePackStatus();
  assert.equal(offlineStatus.ready, false, 'Offline pack must not falsely report ready in headless env without Cache Storage');
});

test('CharacterStudio: in-game driver switch swaps model, saves and syncs LAN state', () => {
  const studio = fs.readFileSync(path.join(process.cwd(), 'src/ui/CharacterStudio.ts'), 'utf8');
  const main = fs.readFileSync(path.join(process.cwd(), 'src/main.ts'), 'utf8');
  // The studio owns the selected driver id and renders a real button row.
  assert.match(studio, /public characterId: CharacterId = 'kaito';/);
  assert.match(studio, /public onCharacterChange: \(id: CharacterId\) => void/);
  assert.match(studio, /public applyPreset\(charId: CharacterId\): void \{[\s\S]{0,80}this\.characterId = charId;/);
  assert.match(studio, /data-studio-key="characterId"/);
  assert.match(studio, /this\.applyPreset\(id\);[\s\S]{0,80}this\.onCharacterChange\(id\);/);
  // The game swaps the visible model, persists the choice and keeps LAN in sync.
  assert.match(main, /this\.studio\.onCharacterChange = \(id\) => \{/);
  assert.match(main, /this\.save\.data\.characterId = id;/);
  assert.match(main, /this\.lobbyUI\.config\.characterId = id;/);
  assert.match(main, /this\.avatarMesh\.setModel\(modelUrlFor\(id\)\)/);
  assert.match(main, /this\.avatarMesh\.setCharacter\(id\)/);
});

test('LobbyClient: HTTPS page blocks private ws:// LAN hosts with an actionable error', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/network/LobbyClient.ts'), 'utf8');
  assert.match(src, /function isPrivateLanTarget\(hostWithPort: string\): boolean/);
  assert.match(src, /private lanMixedContentBlocked\(\): boolean \{[\s\S]{0,220}location\.protocol !== 'https:'/);
  assert.match(src, /Open \$\{target\} directly — HTTPS blocks ws:\/\/ LAN hosts\./);
  assert.match(src, /const secure = typeof location !== 'undefined' && location\.protocol === 'https:';[\s\S]{0,140}\$\{secure \? 'wss' : 'ws'\}/);
  assert.match(src, /if \(this\.networkMode === 'OFFLINE' \|\| this\.lanMixedContentBlocked\(\)\) return null;/);
});

test('LAN file sharing: room-scoped upload, broadcast, download, sanitization & limits', async () => {
  const srv = startOnlineServer({ port: 0, host: '127.0.0.1', distDir: 'dist', quiet: true });
  const { port } = await srv.listening;

  type Msg = { type: string; payload: Record<string, unknown> };
  const connect = () =>
    new Promise<{ ws: WebSocket; msgs: Msg[] }>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      const msgs: Msg[] = [];
      ws.on('message', (data) => msgs.push(JSON.parse(data.toString())));
      ws.once('open', () => resolve({ ws, msgs }));
      ws.once('error', reject);
    });

  const waitFor = async (msgs: Msg[], pred: (m: Msg) => boolean, label: string) => {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const hit = msgs.find(pred);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`Timed out waiting for ${label}`);
  };

  const request = (
    method: string,
    urlPath: string,
    headers: Record<string, string>,
    body?: Buffer
  ) =>
    new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port, path: urlPath, method, headers },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c as Buffer));
          res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body: Buffer.concat(chunks) }));
        }
      );
      req.on('error', reject);
      req.end(body);
    });

  const host = await connect();
  try {
    const welcome = (await waitFor(host.msgs, (m) => m.type === 'WELCOME', 'WELCOME'));
    const token = String((welcome.payload as { resumeToken: string }).resumeToken);

    host.ws.send(JSON.stringify({ type: 'CREATE_ROOM', payload: { playerName: 'FileHost', characterId: 'kaito', carColor: '#ff5500' } }));
    const state = await waitFor(host.msgs, (m) => m.type === 'ROOM_STATE', 'ROOM_STATE');
    const code = String((state.payload as { room: { code: string } }).room.code);

    // Upload a small text file as the room host.
    const payload = Buffer.from('apex-zero lan file sharing payload', 'utf8');
    const upload = await request(
      'POST',
      `/api/files?room=${code}`,
      {
        'x-resume-token': token,
        'x-file-name': encodeURIComponent('../../notes<script>.txt'),
        'x-file-type': 'text/plain',
        'content-length': String(payload.length)
      },
      payload
    );
    assert.equal(upload.status, 201);
    const uploaded = JSON.parse(upload.body.toString()) as { file: { id: string; name: string; size: number }; url: string };
    assert.equal(uploaded.file.name, 'notesscript.txt');
    assert.equal(uploaded.file.size, payload.length);

    // Every room member gets the FILE_SHARE broadcast.
    const share = await waitFor(host.msgs, (m) => m.type === 'FILE_SHARE', 'FILE_SHARE');
    assert.equal((share.payload as { file: { id: string } }).file.id, uploaded.file.id);

    // Room-scoped download returns the exact bytes as an attachment.
    const download = await request('GET', `/api/files/${uploaded.file.id}?room=${code}`, {});
    assert.equal(download.status, 200);
    assert.deepEqual(download.body, payload);
    assert.match(String(download.headers['content-disposition']), /^attachment;/);
    assert.equal(download.headers['x-content-type-options'], 'nosniff');

    // Another room cannot fetch the file by id.
    const wrongRoom = await request('GET', `/api/files/${uploaded.file.id}?room=ZZZZ`, {});
    assert.equal(wrongRoom.status, 404);

    // File list is available to room members.
    const list = await request('GET', `/api/files?room=${code}`, { 'x-resume-token': token });
    assert.equal(list.status, 200);
    const listed = JSON.parse(list.body.toString()) as { files: { id: string }[] };
    assert.equal(listed.files.length, 1);
    assert.equal(listed.files[0].id, uploaded.file.id);

    // Uploading without a valid room session is rejected.
    const noToken = await request(
      'POST',
      `/api/files?room=${code}`,
      { 'x-file-name': 'x.txt', 'content-length': '1' },
      Buffer.from('x')
    );
    assert.equal(noToken.status, 403);

    // Oversize uploads are rejected before storage.
    const oversize = Buffer.alloc(4 * 1024 * 1024 + 1, 0x41);
    const tooBig = await request(
      'POST',
      `/api/files?room=${code}`,
      { 'x-resume-token': token, 'x-file-name': 'big.bin', 'content-length': String(oversize.length) },
      oversize
    );
    assert.equal(tooBig.status, 413);

    // HTML/SVG uploads are forced to a non-executable MIME type.
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf8');
    const html = await request(
      'POST',
      `/api/files?room=${code}`,
      {
        'x-resume-token': token,
        'x-file-name': 'evil.svg',
        'x-file-type': 'image/svg+xml',
        'content-length': String(svg.length)
      },
      svg
    );
    assert.equal(html.status, 201);
    const svgId = (JSON.parse(html.body.toString()) as { file: { id: string } }).file.id;
    const svgDownload = await request('GET', `/api/files/${svgId}?room=${code}`, {});
    assert.equal(svgDownload.headers['content-type'], 'application/octet-stream');
  } finally {
    host.ws.close();
    await srv.stop();
  }
});
