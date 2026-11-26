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

import { CarPhysics, GearboxType } from '../src/physics/CarPhysics';
import { CharacterController } from '../src/physics/CharacterController';
import { RoadGraph, hasLineOfSight } from '../src/game/RoadGraph';
import { SaveManager } from '../src/game/SaveManager';
import { AdaptiveResolution } from '../src/game/AdaptiveResolution';
import { OpenWorldMap } from '../src/graphics/OpenWorldMap';
import { TrackEnvironment } from '../src/graphics/TrackEnvironment';
import { PoliceSystem } from '../src/game/PoliceSystem';
import { PedestrianSystem } from '../src/ai/PedestrianSystem';
import { WorldActivities, type CourierContractDef } from '../src/game/WorldActivities';
import { CarMesh } from '../src/graphics/CarMesh';
import { mapAnimStateToClip, modelForCharacter, modelUrlFor } from '../src/graphics/CharacterAnimationMap';
import { GLTFCharacterMesh } from '../src/graphics/GLTFCharacterMesh';
import { lanLobbyPlugin } from '../server/lanLobbyPlugin';
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
