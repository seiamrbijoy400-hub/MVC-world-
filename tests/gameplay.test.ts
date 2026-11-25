import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

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
// Allow Three.js FileLoader relative asset URLs (`/assets/...`) to fail gracefully in headless Node tests
const OrigRequest = globalThis.Request;
(globalThis as unknown as Record<string, unknown>).Request = class extends OrigRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    const resolved = typeof input === 'string' && input.startsWith('/') ? `http://127.0.0.1${input}` : input;
    super(resolved, init);
  }
};
(globalThis as unknown as Record<string, unknown>).fetch = async () => new Response(new ArrayBuffer(0), { status: 404 });

import { CarPhysics, GearboxType } from '../src/physics/CarPhysics';
import { CharacterController } from '../src/physics/CharacterController';
import { RoadGraph, hasLineOfSight } from '../src/game/RoadGraph';
import { SaveManager } from '../src/game/SaveManager';
import { OpenWorldMap } from '../src/graphics/OpenWorldMap';
import { TrackEnvironment } from '../src/graphics/TrackEnvironment';
import { PoliceSystem } from '../src/game/PoliceSystem';
import { PedestrianSystem } from '../src/ai/PedestrianSystem';
import { WorldActivities } from '../src/game/WorldActivities';

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
