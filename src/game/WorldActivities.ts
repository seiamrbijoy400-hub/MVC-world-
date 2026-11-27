import * as THREE from 'three';
import { CarPhysics, CarInputs } from '../physics/CarPhysics';
import { CarMesh } from '../graphics/CarMesh';
import type { TrackEnvironment } from '../graphics/TrackEnvironment';
import type { OpenWorldMap } from '../graphics/OpenWorldMap';
import type { SaveManager } from './SaveManager';

export interface SpeedTrapDef {
  id: string;
  name: string;
  x: number;
  z: number;
  targetKmh: number;
  radius: number;
  cooldown: number;
  meshGroup: THREE.Group;
}

export interface DriftZoneDef {
  id: string;
  name: string;
  x: number;
  z: number;
  radius: number;
  bronze: number;
  silver: number;
  gold: number;
  ringMesh: THREE.Mesh;
}

export interface ApexShardDef {
  id: string;
  title: string;
  lore: string;
  x: number;
  y: number;
  z: number;
  collected: boolean;
  group: THREE.Group;
  crystal: THREE.Mesh;
}

export interface RivalSprintDef {
  id: string;
  rivalName: string;
  rivalTitle: string;
  carColor: string;
  minRank: number;
  startPos: THREE.Vector3;
  waypoints: THREE.Vector3[];
  rewardXp: number;
  rewardCredits: number;
  tauntStart: string;
  tauntWin: string;
  tauntLose: string;
  portalMesh: THREE.Mesh;
}

export interface ActiveSprintState {
  def: RivalSprintDef;
  rivalPhysics: CarPhysics;
  rivalMesh: CarMesh;
  rivalWpIdx: number;
  playerWpIdx: number;
  elapsed: number;
  nextWpMarker: THREE.Mesh;
  finishMarker: THREE.Mesh;
}

export interface CourierContractDef {
  id: string;
  title: string;
  routeDesc: string;
  startPos: THREE.Vector3;
  destPos: THREE.Vector3;
  goldSec: number;
  silverSec: number;
  bronzeSec: number;
  baseCredits: number;
  baseXp: number;
  portalMesh: THREE.Mesh;
}

export interface ActiveCourierState {
  def: CourierContractDef;
  elapsed: number;
  destBeacon: THREE.Mesh;
}

export interface ActivityCallbacks {
  onSpeedTrapTriggered: (trap: SpeedTrapDef, speedKmh: number, isNewBest: boolean) => void;
  onDriftZoneCompleted: (zone: DriftZoneDef, score: number, medal: 'GOLD' | 'SILVER' | 'BRONZE' | 'NONE', isNewBest: boolean) => void;
  onShardCollected: (shard: ApexShardDef, totalFound: number, totalCount: number) => void;
  onNearRivalPrompt: (rival: RivalSprintDef | null) => void;
  onNearCourierPrompt?: (contract: CourierContractDef | null) => void;
  onSprintCheckpoint?: (wpIdx: number, totalWps: number) => void;
  onSprintEnded: (def: RivalSprintDef, playerWon: boolean, timeSec: number) => void;
  onCourierEnded?: (
    def: CourierContractDef,
    medal: 'GOLD' | 'SILVER' | 'BRONZE' | 'FAILED',
    timeSec: number,
    isNewBest: boolean,
    credits: number,
    xp: number
  ) => void;
}

export class WorldActivities {
  private scene: THREE.Scene;
  private save: SaveManager;
  private track: TrackEnvironment;
  private openWorld: OpenWorldMap;
  private cb: ActivityCallbacks;

  public speedTraps: SpeedTrapDef[] = [];
  public driftZones: DriftZoneDef[] = [];
  public shards: ApexShardDef[] = [];
  public rivals: RivalSprintDef[] = [];
  public couriers: CourierContractDef[] = [];

  public activeDriftZone: DriftZoneDef | null = null;
  public activeDriftZoneScore = 0;

  public headlightsOn = true;
  public activeSprint: ActiveSprintState | null = null;
  public nearbyRival: RivalSprintDef | null = null;
  public activeCourier: ActiveCourierState | null = null;
  public nearbyCourier: CourierContractDef | null = null;

  constructor(
    scene: THREE.Scene,
    save: SaveManager,
    track: TrackEnvironment,
    openWorld: OpenWorldMap,
    cb: ActivityCallbacks
  ) {
    this.scene = scene;
    this.save = save;
    this.track = track;
    this.openWorld = openWorld;
    this.cb = cb;

    this.buildSpeedTraps();
    this.buildDriftZones();
    this.buildApexShards();
    this.buildRivalSprints();
    this.buildCourierContracts();
  }

  private buildSpeedTraps(): void {
    const defs = [
      { id: 'trap_gp_straight', name: 'GP Main Straight Radar', x: 0, z: -85, targetKmh: 220, rotY: 0 },
      { id: 'trap_neon_blvd', name: 'Neo Velo Expressway', x: 122, z: -100, targetKmh: 185, rotY: 0 },
      { id: 'trap_harbor_coast', name: 'Harbor Coastal Strip', x: 170, z: 224, targetKmh: 195, rotY: Math.PI * 0.5 },
      { id: 'trap_touge_summit', name: 'Touge Summit Pass', x: 155, z: -296, targetKmh: 175, rotY: Math.PI * 0.5 }
    ];

    const pillarGeo = new THREE.CylinderGeometry(0.18, 0.22, 6.0, 10);
    const beamGeo = new THREE.BoxGeometry(16, 0.16, 0.16);
    const mat = new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.85 });

    for (const d of defs) {
      const grp = new THREE.Group();
      const yBase = d.id === 'trap_touge_summit' ? 6.0 : 0;
      const p1 = new THREE.Mesh(pillarGeo, mat);
      p1.position.set(-8, 3.0, 0);
      const p2 = new THREE.Mesh(pillarGeo, mat);
      p2.position.set(8, 3.0, 0);
      const beam = new THREE.Mesh(beamGeo, mat);
      beam.position.set(0, 5.5, 0);
      grp.add(p1, p2, beam);
      grp.position.set(d.x, yBase, d.z);
      grp.rotation.y = d.rotY;
      this.scene.add(grp);

      this.speedTraps.push({
        ...d,
        radius: 9.5,
        cooldown: 0,
        meshGroup: grp
      });
    }
  }

  private buildDriftZones(): void {
    const defs = [
      { id: 'drift_gp_hairpin', name: 'Lake Hairpin Drift Zone', x: -135, z: 210, radius: 36, bronze: 1200, silver: 2800, gold: 5200 },
      { id: 'drift_neon_plaza', name: 'Akiba Neon S-Drift', x: 122, z: -5, radius: 32, bronze: 1000, silver: 2400, gold: 4500 },
      { id: 'drift_harbor_dock', name: 'Harbor Pier Sweep', x: 224, z: 195, radius: 34, bronze: 1100, silver: 2600, gold: 4800 }
    ];

    for (const d of defs) {
      const geo = new THREE.RingGeometry(d.radius - 0.8, d.radius, 48);
      geo.rotateX(-Math.PI * 0.5);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xf97316,
        transparent: true,
        opacity: 0.42,
        side: THREE.DoubleSide
      });
      const ring = new THREE.Mesh(geo, mat);
      // Sample terrain height so the ring sits on the ground at any elevation.
      const groundY = this.track.sampleGround(d.x, d.z).height;
      const rampY = this.openWorld.sampleRampHeight(d.x, d.z);
      ring.position.set(d.x, Math.max(groundY, rampY) + 0.08, d.z);
      this.scene.add(ring);

      this.driftZones.push({ ...d, ringMesh: ring });
    }
  }

  private buildApexShards(): void {
    const shardData: { id: string; title: string; lore: string; x: number; y: number; z: number }[] = [
      { id: 'shard_1', title: 'Apex Log #01: Arrival', lore: '"Every legend starts as an unknown car at a quiet junction."', x: 34, y: 1.4, z: 16 },
      { id: 'shard_2', title: 'Apex Log #02: Grandstand Echo', lore: '"Before Apex Zero vanished, they set a 0:58 lap nobody matched."', x: -24, y: 1.4, z: -55 },
      { id: 'shard_3', title: 'Apex Log #03: Lake Mist', lore: '"Midnight fog over Lake Velo hides the cleanest apexes."', x: -85, y: 1.4, z: -20 },
      { id: 'shard_4', title: 'Apex Log #04: Neon Core', lore: '"Akiba Neon Core never sleeps — neither does the underground."', x: 122, y: 1.4, z: -130 },
      { id: 'shard_5', title: 'Apex Log #05: Drift Garage', lore: '"Tuned twin-superchargers scream loudest at 8,200 RPM."', x: 56, y: 1.4, z: -5 },
      { id: 'shard_6', title: 'Apex Log #06: Stunt Apex', lore: '"Airborne over the stunt ramp — gravity is only a suggestion."', x: 84, y: 4.5, z: 90 },
      { id: 'shard_7', title: 'Apex Log #07: Rocket Pitch', lore: '"Even supercars need a halftime break with a giant soccer ball."', x: 174, y: 1.4, z: 124 },
      { id: 'shard_8', title: 'Apex Log #08: Harbor Cargo', lore: '"Smugglers used to race containers down the coast at dawn."', x: 74, y: 1.4, z: 262 },
      { id: 'shard_9', title: 'Apex Log #09: Pier Leap', lore: '"Full throttle off the south pier — don\'t lift."', x: 168, y: 5.2, z: 285 },
      { id: 'shard_10', title: 'Apex Log #10: Lighthouse', lore: '"The eastern beacon guides racers home through neon storms."', x: 288, y: 1.4, z: 258 },
      { id: 'shard_11', title: 'Apex Log #11: Touge Torii', lore: '"Under the red gate lies the purest drift tarmac in Neo Velo."', x: 155, y: 7.4, z: -296 },
      { id: 'shard_12', title: 'Apex Log #12: Zero\'s Secret', lore: '"Apex Zero isn\'t gone — they\'re waiting for someone worthy."', x: 242, y: 7.4, z: -272 }
    ];

    const crystalGeo = new THREE.OctahedronGeometry(0.95, 0);
    const beamGeo = new THREE.CylinderGeometry(0.18, 0.65, 16, 12, 1, true);

    for (const s of shardData) {
      const collected = this.save.data.discoveredShards.includes(s.id);
      const grp = new THREE.Group();
      grp.position.set(s.x, s.y, s.z);

      const crystalMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
      const crystal = new THREE.Mesh(crystalGeo, crystalMat);

      const beamMat = new THREE.MeshBasicMaterial({
        color: 0xfde047,
        transparent: true,
        opacity: 0.22,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.position.y = 7.5;

      grp.add(crystal, beam);
      grp.visible = !collected;
      this.scene.add(grp);

      this.shards.push({
        ...s,
        collected,
        group: grp,
        crystal
      });
    }
  }

  private buildRivalSprints(): void {
    const rivalDefs: Omit<RivalSprintDef, 'portalMesh'>[] = [
      {
        id: 'rival_kira',
        rivalName: 'Kira',
        rivalTitle: 'Harbor Queen • 湾岸の女王',
        carColor: '#ec4899',
        minRank: 1,
        startPos: new THREE.Vector3(46, 0, 150),
        waypoints: [
          new THREE.Vector3(122, 0, 150),
          new THREE.Vector3(224, 0, 150),
          new THREE.Vector3(224, 0, 224),
          new THREE.Vector3(122, 0, 224),
          new THREE.Vector3(46, 0, 224)
        ],
        rewardXp: 350,
        rewardCredits: 600,
        tauntStart: 'Think a rookie can keep up on my harbor asphalt? Follow my taillights!',
        tauntWin: 'Whoa... that cornering line was surgical! Respect, driver.',
        tauntLose: 'Come back when your tires actually grip the coast!'
      },
      {
        id: 'rival_ren',
        rivalName: 'Ren',
        rivalTitle: 'Cyber Phantom • 電脳の幻',
        carColor: '#38bdf8',
        minRank: 1,
        startPos: new THREE.Vector3(46, 0, -40),
        waypoints: [
          new THREE.Vector3(122, 0, -40),
          new THREE.Vector3(224, 0, -40),
          new THREE.Vector3(224, 0, -160),
          new THREE.Vector3(122, 0, -160),
          new THREE.Vector3(46, 0, -160)
        ],
        rewardXp: 480,
        rewardCredits: 850,
        tauntStart: 'Neo Velo grid belongs to precision. Let\'s see your telemetry!',
        tauntWin: 'Impossible... you out-braked my predictive line!',
        tauntLose: 'Too slow through the neon intersections.'
      },
      {
        id: 'rival_takumi',
        rivalName: 'Takumi',
        rivalTitle: 'Touge Ghost • 峠の亡霊',
        carColor: '#f8fafc',
        minRank: 2,
        startPos: new THREE.Vector3(32, 0, -160),
        waypoints: [
          new THREE.Vector3(32, 0, -296),
          new THREE.Vector3(155, 6, -296),
          new THREE.Vector3(284, 0, -296),
          new THREE.Vector3(284, 0, -160),
          new THREE.Vector3(224, 0, -160)
        ],
        rewardXp: 650,
        rewardCredits: 1200,
        tauntStart: 'Up the mountain deck and back down. Don\'t spill your focus.',
        tauntWin: 'That weight transfer over the summit... you\'re a natural.',
        tauntLose: 'You hesitated at the crest. The Touge punishes fear.'
      },
      {
        id: 'rival_apex_zero',
        rivalName: 'APEX ZERO',
        rivalTitle: 'The Living Legend • 頂点・零',
        carColor: '#18181b',
        minRank: 3,
        startPos: new THREE.Vector3(46, 0, 30),
        waypoints: [
          new THREE.Vector3(224, 0, 30),
          new THREE.Vector3(296, 0, 30),
          new THREE.Vector3(296, 0, 224),
          new THREE.Vector3(122, 0, 224),
          new THREE.Vector3(46, 0, 224),
          new THREE.Vector3(46, 0, 150),
          new THREE.Vector3(46, 0, -160)
        ],
        rewardXp: 1200,
        rewardCredits: 2500,
        tauntStart: 'So you\'re the one tearing up my city. Show me everything you\'ve learned.',
        tauntWin: 'Brilliant. The crown of Neo Velo is yours — you ARE Apex Zero.',
        tauntLose: 'Not yet. Chase the lines, master the drift, then find me again.'
      }
    ];

    const ringGeo = new THREE.RingGeometry(4.0, 5.2, 32);
    ringGeo.rotateX(-Math.PI * 0.5);

    for (const r of rivalDefs) {
      const mat = new THREE.MeshBasicMaterial({
        color: r.id === 'rival_apex_zero' ? 0xfacc15 : 0xec4899,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide
      });
      const portalMesh = new THREE.Mesh(ringGeo, mat);
      portalMesh.position.set(r.startPos.x, 0.12, r.startPos.z);
      this.scene.add(portalMesh);
      this.rivals.push({ ...r, portalMesh });
    }
  }

  public startRivalSprint(rival: RivalSprintDef, playerPhysics: CarPhysics): boolean {
    if (this.activeSprint || this.activeCourier) return false;
    const myRank = this.save.getRank().level;
    if (myRank < rival.minRank) return false;

    const firstWp = rival.waypoints[0];
    const heading = Math.atan2(-(firstWp.x - rival.startPos.x), -(firstWp.z - rival.startPos.z));

    playerPhysics.enforceTrackWalls = false;
    playerPhysics.resetToTrack(rival.startPos.clone().add(new THREE.Vector3(-2.5, 0, 0)), heading);

    const rivalPhys = new CarPhysics();
    rivalPhys.enforceTrackWalls = false;
    rivalPhys.groundHeightSampler = (x, z) => {
      const g = this.track.sampleGround(x, z);
      const rH = this.openWorld.sampleRampHeight(x, z);
      if (this.openWorld.isOverOpenWater(x, z)) return { ...g, height: -1.05, isRoad: false };
      return {
        ...g,
        height: Math.max(g.height, rH),
        isRoad: g.isRoad || this.openWorld.isInsideCityOrPlayground(x, z) || rH > 0
      };
    };
    rivalPhys.worldCollider = (pos, vel, rad) => this.openWorld.resolveCollision(pos, vel, rad);
    rivalPhys.resetToTrack(rival.startPos.clone().add(new THREE.Vector3(2.5, 0, 0)), heading);

    const rivalMesh = new CarMesh(true);
    rivalMesh.setColor(rival.carColor);
    rivalMesh.setUnderglowColor(rival.id === 'rival_apex_zero' ? '#facc15' : '#ec4899');
    rivalMesh.setHeadlights(this.headlightsOn);
    this.scene.add(rivalMesh.root);

    const finalWp = rival.waypoints[rival.waypoints.length - 1];
    const finGeo = new THREE.CylinderGeometry(5.5, 5.5, 14, 24, 1, true);
    const finMat = new THREE.MeshBasicMaterial({
      color: 0x22c55e,
      transparent: true,
      opacity: 0.42,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const finishMarker = new THREE.Mesh(finGeo, finMat);
    finishMarker.position.set(finalWp.x, finalWp.y + 7, finalWp.z);
    this.scene.add(finishMarker);

    const wp0 = rival.waypoints[0];
    const nextWpMarker = new THREE.Mesh(
      new THREE.CylinderGeometry(4.8, 4.8, 12, 20, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xfacc15,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    );
    nextWpMarker.position.set(wp0.x, wp0.y + 6, wp0.z);
    this.scene.add(nextWpMarker);

    this.activeSprint = {
      def: rival,
      rivalPhysics: rivalPhys,
      rivalMesh,
      rivalWpIdx: 0,
      playerWpIdx: 0,
      elapsed: 0,
      nextWpMarker,
      finishMarker
    };
    return true;
  }

  public cancelSprint(): void {
    if (!this.activeSprint) return;
    this.scene.remove(this.activeSprint.rivalMesh.root);
    this.activeSprint.rivalMesh.dispose();
    this.scene.remove(this.activeSprint.nextWpMarker);
    this.activeSprint.nextWpMarker.geometry.dispose();
    (this.activeSprint.nextWpMarker.material as THREE.Material).dispose();
    this.scene.remove(this.activeSprint.finishMarker);
    this.activeSprint.finishMarker.geometry.dispose();
    (this.activeSprint.finishMarker.material as THREE.Material).dispose();
    this.activeSprint = null;
  }

  private buildCourierContracts(): void {
    const specs: Omit<CourierContractDef, 'portalMesh'>[] = [
      {
        id: 'courier_harbor',
        title: 'Harbor Parts Express',
        routeDesc: 'Core Plaza → South Stunt Pier',
        startPos: new THREE.Vector3(46, 0, 30),
        destPos: new THREE.Vector3(168, 0, 256),
        goldSec: 26,
        silverSec: 34,
        bronzeSec: 46,
        baseCredits: 320,
        baseXp: 160
      },
      {
        id: 'courier_touge',
        title: 'Touge Summit Delivery',
        routeDesc: 'North Touge Gate → Red Torii Overlook',
        startPos: new THREE.Vector3(122, 0, -160),
        destPos: new THREE.Vector3(155, 6, -296),
        goldSec: 25,
        silverSec: 33,
        bronzeSec: 45,
        baseCredits: 380,
        baseXp: 190
      },
      {
        id: 'courier_akiba',
        title: 'Akiba Midnight Run',
        routeDesc: 'Harbor Inn → Akiba Cyber Tower',
        startPos: new THREE.Vector3(122, 0, 150),
        destPos: new THREE.Vector3(224, 0, -160),
        goldSec: 27,
        silverSec: 36,
        bronzeSec: 48,
        baseCredits: 400,
        baseXp: 210
      }
    ];

    const ringGeo = new THREE.RingGeometry(3.4, 4.5, 28);
    ringGeo.rotateX(-Math.PI * 0.5);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.82,
      side: THREE.DoubleSide
    });

    for (const c of specs) {
      const portalMesh = new THREE.Mesh(ringGeo, ringMat);
      portalMesh.position.set(c.startPos.x, 0.14, c.startPos.z);
      this.scene.add(portalMesh);
      this.couriers.push({ ...c, portalMesh });
    }
  }

  public startCourierContract(contract: CourierContractDef): boolean {
    if (this.activeSprint || this.activeCourier) return false;
    const destBeacon = new THREE.Mesh(
      new THREE.CylinderGeometry(5.2, 5.2, 16, 22, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xf59e0b,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    );
    destBeacon.position.set(contract.destPos.x, contract.destPos.y + 8, contract.destPos.z);
    this.scene.add(destBeacon);
    this.activeCourier = { def: contract, elapsed: 0, destBeacon };
    this.nearbyCourier = null;
    this.cb.onNearCourierPrompt?.(null);
    return true;
  }

  public cancelCourier(): void {
    if (!this.activeCourier) return;
    this.scene.remove(this.activeCourier.destBeacon);
    this.activeCourier.destBeacon.geometry.dispose();
    (this.activeCourier.destBeacon.material as THREE.Material).dispose();
    this.activeCourier = null;
  }

  /** Clear transient scoring so a teleport/restart cannot bank a half-finished drift or stale trap. */
  public resetTransientState(): void {
    this.activeDriftZone = null;
    this.activeDriftZoneScore = 0;
    for (const trap of this.speedTraps) trap.cooldown = 0;
  }

  public update(
    dt: number,
    timeSec: number,
    playerPos: THREE.Vector3,
    playerSpeedKmh: number,
    inCar: boolean,
    isDrifting: boolean,
    driftRatePtsPerSec: number,
    isTimedCircuitRace: boolean
  ): void {
    // A circuit race is a closed competition. Speed-trap records, drift
    // medals and shard discoveries must not leak XP/credits from the racing
    // line, and stale prompts must not survive the teleport to the grid.
    if (isTimedCircuitRace) return;

    // 1. Speed Traps
    for (const trap of this.speedTraps) {
      if (trap.cooldown > 0) trap.cooldown -= dt;
      if (inCar && trap.cooldown <= 0) {
        const d = Math.hypot(playerPos.x - trap.x, playerPos.z - trap.z);
        if (d < trap.radius && playerSpeedKmh > 75) {
          trap.cooldown = 5.0;
          const rounded = Math.round(playerSpeedKmh);
          const prevBest = this.save.data.speedTrapRecords[trap.id] || 0;
          const isNewBest = rounded > prevBest;
          if (isNewBest) {
            this.save.data.speedTrapRecords[trap.id] = rounded;
            this.save.scheduleSave();
          }
          this.cb.onSpeedTrapTriggered(trap, rounded, isNewBest);
        }
      }
    }

    // 2. Drift Zones
    if (inCar) {
      let insideZone: DriftZoneDef | null = null;
      for (const z of this.driftZones) {
        const d = Math.hypot(playerPos.x - z.x, playerPos.z - z.z);
        z.ringMesh.scale.setScalar(1.0 + Math.sin(timeSec * 3.0) * 0.02);
        if (d < z.radius) {
          insideZone = z;
          break;
        }
      }

      if (insideZone) {
        if (this.activeDriftZone?.id !== insideZone.id) {
          this.activeDriftZone = insideZone;
          this.activeDriftZoneScore = 0;
        }
        (insideZone.ringMesh.material as THREE.MeshBasicMaterial).color.setHex(
          isDrifting ? 0xfacc15 : 0x22c55e
        );
        if (isDrifting && playerSpeedKmh > 32) {
          this.activeDriftZoneScore += driftRatePtsPerSec * dt;
        }
      } else {
        for (const z of this.driftZones) {
          (z.ringMesh.material as THREE.MeshBasicMaterial).color.setHex(0xf97316);
        }
      }
      if (!insideZone && this.activeDriftZone) {
        const finished = this.activeDriftZone;
        const finalScore = Math.round(this.activeDriftZoneScore);
        this.activeDriftZone = null;
        this.activeDriftZoneScore = 0;

        if (finalScore >= 250) {
          const medal = finalScore >= finished.gold
            ? 'GOLD'
            : (finalScore >= finished.silver ? 'SILVER' : (finalScore >= finished.bronze ? 'BRONZE' : 'NONE'));
          const prev = this.save.data.driftZoneRecords[finished.id] || 0;
          const isNewBest = finalScore > prev;
          if (isNewBest) {
            this.save.data.driftZoneRecords[finished.id] = finalScore;
            this.save.scheduleSave();
          }
          this.cb.onDriftZoneCompleted(finished, finalScore, medal, isNewBest);
        }
      }
    }

    // 3. Apex Shards Collectibles
    for (const shard of this.shards) {
      if (shard.collected) continue;
      shard.crystal.rotation.y = timeSec * 2.2;
      shard.crystal.position.y = Math.sin(timeSec * 3.0 + shard.x) * 0.25;

      // Use full 3-D distance so elevated shards (ramps, rooftops) are reachable on foot and in car.
      const d3 = Math.hypot(playerPos.x - shard.x, playerPos.y - shard.y, playerPos.z - shard.z);
      if (d3 < 6.5) {
        shard.collected = true;
        shard.group.visible = false;
        if (!this.save.data.discoveredShards.includes(shard.id)) {
          this.save.data.discoveredShards.push(shard.id);
          this.save.scheduleSave();
        }
        this.cb.onShardCollected(shard, this.save.data.discoveredShards.length, this.shards.length);
      }
    }

    // 4. Rival Sprint Portals & Active Sprint Race
    let closestRival: RivalSprintDef | null = null;
    if (!this.activeSprint && !this.activeCourier && !isTimedCircuitRace) {
      for (const r of this.rivals) {
        if (this.save.data.rivalsDefeated.includes(r.id)) {
          r.portalMesh.visible = false;
          continue;
        }
        r.portalMesh.visible = true;
        const pulse = 0.92 + Math.sin(timeSec * 4.5) * 0.08;
        r.portalMesh.scale.set(pulse, 1, pulse);
        const d = Math.hypot(playerPos.x - r.startPos.x, playerPos.z - r.startPos.z);
        // Only trigger the prompt when the player is driving — avoids accidental on-foot prompts.
        if (d < 8 && inCar) {
          closestRival = r;
        }
      }
    } else {
      for (const r of this.rivals) r.portalMesh.visible = false;
    }

    if (closestRival?.id !== this.nearbyRival?.id) {
      this.nearbyRival = closestRival;
      this.cb.onNearRivalPrompt(closestRival);
    }

    // 5. Repeatable Street Courier Time-Trial Contracts
    let closestCourier: CourierContractDef | null = null;
    if (!this.activeSprint && !this.activeCourier && !isTimedCircuitRace) {
      for (const c of this.couriers) {
        c.portalMesh.visible = true;
        const pulse = 0.92 + Math.sin(timeSec * 3.8 + c.startPos.x) * 0.08;
        c.portalMesh.scale.set(pulse, 1, pulse);
        const d = Math.hypot(playerPos.x - c.startPos.x, playerPos.z - c.startPos.z);
        if (d < 8 && inCar) {
          closestCourier = c;
        }
      }
    } else {
      for (const c of this.couriers) c.portalMesh.visible = false;
    }

    if (closestCourier?.id !== this.nearbyCourier?.id) {
      this.nearbyCourier = closestCourier;
      this.cb.onNearCourierPrompt?.(closestCourier);
    }

    if (this.activeCourier) {
      const ac = this.activeCourier;
      ac.elapsed += dt;
      ac.destBeacon.rotation.y = timeSec * 1.8;

      const dDest = Math.hypot(
        playerPos.x - ac.def.destPos.x,
        playerPos.y - ac.def.destPos.y,
        playerPos.z - ac.def.destPos.z
      );
      if (dDest < 9.5 && inCar) {
        const def = ac.def;
        const timeSecTaken = ac.elapsed;
        this.cancelCourier();
        const medal: 'GOLD' | 'SILVER' | 'BRONZE' = timeSecTaken <= def.goldSec
          ? 'GOLD'
          : (timeSecTaken <= def.silverSec ? 'SILVER' : 'BRONZE');
        const mult = medal === 'GOLD' ? 1.8 : (medal === 'SILVER' ? 1.3 : 1.0);
        const prev = this.save.data.courierRecords[def.id];
        const isNewBest = prev === undefined || timeSecTaken < prev;
        if (isNewBest) {
          this.save.data.courierRecords[def.id] = Number(timeSecTaken.toFixed(2));
          this.save.scheduleSave();
        }
        this.cb.onCourierEnded?.(
          def,
          medal,
          timeSecTaken,
          isNewBest,
          Math.round(def.baseCredits * mult),
          Math.round(def.baseXp * mult)
        );
      } else if (ac.elapsed > ac.def.bronzeSec) {
        const def = ac.def;
        const timeSecTaken = ac.elapsed;
        this.cancelCourier();
        this.cb.onCourierEnded?.(def, 'FAILED', timeSecTaken, false, 0, 0);
      }
    }

    // Active 1v1 Sprint Update
    if (this.activeSprint) {
      const sp = this.activeSprint;
      sp.elapsed += dt;

      // Advance player waypoint progress
      const pTarget = sp.def.waypoints[sp.playerWpIdx];
      if (Math.hypot(playerPos.x - pTarget.x, playerPos.z - pTarget.z) < 22) {
        sp.playerWpIdx++;
        if (sp.playerWpIdx >= sp.def.waypoints.length) {
          const finishedDef = sp.def;
          const time = sp.elapsed;
          this.cancelSprint();
          this.cb.onSprintEnded(finishedDef, true, time);
          return;
        }
        const nxt = sp.def.waypoints[sp.playerWpIdx];
        sp.nextWpMarker.position.set(nxt.x, nxt.y + 6, nxt.z);
        sp.nextWpMarker.visible = sp.playerWpIdx < sp.def.waypoints.length - 1;
        this.cb.onSprintCheckpoint?.(sp.playerWpIdx, sp.def.waypoints.length);
      }
      sp.nextWpMarker.rotation.y = -timeSec * 2.2;

      // Drive AI Rival toward its waypoint
      const rPhys = sp.rivalPhysics;
      const rTarget = sp.def.waypoints[sp.rivalWpIdx];
      if (Math.hypot(rPhys.position.x - rTarget.x, rPhys.position.z - rTarget.z) < 16) {
        sp.rivalWpIdx++;
        if (sp.rivalWpIdx >= sp.def.waypoints.length) {
          const finishedDef = sp.def;
          const time = sp.elapsed;
          this.cancelSprint();
          this.cb.onSprintEnded(finishedDef, false, time);
          return;
        }
      }

      const targetPt = sp.def.waypoints[sp.rivalWpIdx];
      const toT = targetPt.clone().sub(rPhys.position);
      toT.y = 0;
      const distT = toT.length();
      if (distT > 0.1) toT.divideScalar(distT);
      const rgt = rPhys.getRightVector();
      const steer = THREE.MathUtils.clamp(toT.dot(rgt) * 2.2, -1, 1);

      const paceTarget = sp.def.id === 'rival_apex_zero' ? 195 : (sp.def.id === 'rival_takumi' ? 168 : 152);
      const cornerFactor = Math.abs(steer) > 0.45 ? 0.68 : 1.0;
      const desiredSpeed = paceTarget * cornerFactor;
      const speed = rPhys.speedKmh;

      const aiInputs: CarInputs = {
        throttle: speed < desiredSpeed ? 0.96 : 0.15,
        brake: speed > desiredSpeed + 22 ? 0.65 : 0,
        steer,
        handbrake: false,
        clutch: false,
        shiftUp: false,
        shiftDown: false,
        reset: false,
        nitro: sp.def.id === 'rival_apex_zero' && Math.abs(steer) < 0.18
      };
      if (this.openWorld.shouldRecoverFromWater(rPhys.position)) rPhys.resetToTrack();
      rPhys.update(dt, aiInputs, true);
      sp.rivalMesh.update(rPhys, aiInputs.brake, dt);
      sp.finishMarker.rotation.y = timeSec * 1.4;
    }
  }
}
