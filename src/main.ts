import * as THREE from 'three';
import { CarPhysics, GearboxType, GroundSample } from './physics/CarPhysics';
import { CharacterController } from './physics/CharacterController';
import { HelicopterPhysics } from './physics/HelicopterPhysics';
import { CarMesh } from './graphics/CarMesh';
import { HelicopterMesh } from './graphics/HelicopterMesh';
import { HumanCharacterMesh } from './graphics/HumanCharacterMesh';
import { GLTFCharacterMesh } from './graphics/GLTFCharacterMesh';
import { modelUrlFor } from './graphics/CharacterAnimationMap';
import { TrackEnvironment, TimeOfDay } from './graphics/TrackEnvironment';
import { OpenWorldMap, DISTRICTS, type DistrictId, type WorldInteractable } from './graphics/OpenWorldMap';
import { ParticleSystem } from './graphics/ParticleSystem';
import { SoundManager } from './audio/SoundManager';
import { LapManager, LapStats } from './game/LapManager';
import { RaceBot, CityCruiserBot, SparringFighter } from './ai/RaceBotAI';
import { PedestrianSystem } from './ai/PedestrianSystem';
import { HUD, MinimapActor, TouchMode } from './ui/HUD';
import { LobbyClient } from './network/LobbyClient';
import { LobbyUI, LobbyConfig } from './ui/LobbyUI';
import { CharacterStudio } from './ui/CharacterStudio';
import { SaveManager } from './game/SaveManager';
import type { CarArchetypeId, GraphicsQuality, WeatherMode } from './game/SaveManager';
import { WeatherSystem } from './graphics/WeatherSystem';
import { GhostSystem } from './game/GhostSystem';
import { WorldActivities, type RivalSprintDef, type CourierContractDef } from './game/WorldActivities';
import { GarageController } from './game/GarageController';
import { AdaptiveResolution } from './game/AdaptiveResolution';
import {
  separateVehiclePair,
  pushCharacterOutOfVehicles,
  resolveMovingVehicleImpactOnCharacter
} from './physics/CollisionResolver';
import { PoliceSystem } from './game/PoliceSystem';
import { hasLineOfSight } from './game/RoadGraph';
import type { NetworkPlayerSync, CharacterAppearance } from './network/LobbyProtocol';

enum CameraView {
  CHASE = 'CHASE',
  HOOD = 'HOOD',
  ORBIT = 'ORBIT'
}

enum GameState {
  OPEN_WORLD = 'OPEN_WORLD',
  COUNTDOWN = 'COUNTDOWN',
  TIMED_RACE = 'TIMED_RACE',
  DRIFT_ARENA = 'DRIFT_ARENA',
  FINISHED = 'FINISHED'
}

interface RemotePeer {
  id: string;
  carMesh: CarMesh;
  charMesh: HumanCharacterMesh | GLTFCharacterMesh;
  lastState: NetworkPlayerSync;
}

interface CivicSpawnSpec {
  x: number;
  z: number;
  heading: number;
  color: string;
  name: string;
  archetype: CarArchetypeId;
}

interface VehicleEntry {
  physics: CarPhysics;
  mesh: CarMesh;
  name: string;
  spawnSpec?: CivicSpawnSpec;
  policeLights?: { a: THREE.Mesh; b: THREE.Mesh; active: boolean };
}

class GameApp {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private sunLight!: THREE.DirectionalLight;
  private ambientLight!: THREE.AmbientLight;
  private hemiLight!: THREE.HemisphereLight;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private timeOfDay: TimeOfDay = 'DAY';
  // Kept in sync with sky/water shader sun directions so shadows and PBR
  // highlights agree with the disc the player actually sees in the sky.
  private sunDirection = new THREE.Vector3(0.42, 0.48, -0.77).normalize();

  private physics: CarPhysics;
  private charCtrl: CharacterController;
  private heliPhysics!: HelicopterPhysics;
  private heliMesh!: HelicopterMesh;
  private inCar = false; // Spawn on foot right beside car in Open World!
  private inHeli = false;
  private heliRotorWashTimer = 0;
  private skyRingsCleared = 0;
  private wasAirShadow = false;

  private carMesh: CarMesh;
  private avatarMesh: HumanCharacterMesh | GLTFCharacterMesh;
  private track: TrackEnvironment;
  private openWorld: OpenWorldMap;
  private particles: ParticleSystem;
  private sound: SoundManager;
  private lapManager: LapManager;
  private hud: HUD;
  private lobbyClient: LobbyClient;
  private lobbyUI: LobbyUI;
  private studio: CharacterStudio;

  private save: SaveManager;
  private weather: WeatherSystem;
  private ghost: GhostSystem;
  private activities: WorldActivities;
  private garage!: GarageController;
  private police: PoliceSystem;
  private ghostReplayEnabled = true;
  private nearbyRival: RivalSprintDef | null = null;
  private nearbyCourier: CourierContractDef | null = null;
  private currentDistrictId: DistrictId | null = null;
  private baseAmbientIntensity = 0.72;
  private baseHemiIntensity = 0.55;
  private baseSunIntensity = 1.9;
  private qualityRatioCap = 2;
  private adaptiveRes = new AdaptiveResolution(1, { maxRatio: 2 });
  private lastMaxSpeedSaveAt = -10;

  private raceBots: RaceBot[] = [];
  private cityCruisers: CityCruiserBot[] = [];
  private sparringFighters: SparringFighter[] = [];
  private pedestrians!: PedestrianSystem;
  private remotePeers = new Map<string, RemotePeer>();

  /** Player's primary owned Zenvo TS1 (always restored cleanly for GP races & garage tuning). */
  private ownZenvo!: VehicleEntry;
  /** Player-owned cars left in the world (own Zenvo + anything stolen and abandoned). */
  private parkedCars: VehicleEntry[] = [];
  /** Stealable civilian cars parked around the city. */
  private civicCars: VehicleEntry[] = [];
  private nearbyCivic: VehicleEntry | null = null;
  private activeCarName = 'Your Zenvo';
  private activePoliceLights: { a: THREE.Mesh; b: THREE.Mesh; active: boolean } | undefined;
  private lastGaragePrompt = false;
  private sittingSpot: { pos: THREE.Vector3; yaw: number; label: string; root: THREE.Vector3 } | null = null;
  // Smooth scoot out of the chair, driven by the avatar's stand-up clip progress.
  private standScootTotal = new THREE.Vector3();
  private standScootApplied = 1;
  private wasInteract = false;
  private fighterHitCooldown = 0;
  private policeHitCooldown = 0;
  private footstepTimer = 0;
  private koReason: 'WASTED' | 'BUSTED' | null = null;
  private sampleUnifiedGround!: (x: number, z: number, currentY?: number) => GroundSample;

  private gameState: GameState = GameState.OPEN_WORLD;
  private countdownTimer = 0;
  private lastCountdownStep = -1;
  private driftArenaTimer = 0;
  private driftArenaDuration = 90;
  private driftArenaBestCombo = 1.0;
  private pendingRaceMode: 'CIRCUIT_RACE' | 'DRIFT_ARENA' = 'CIRCUIT_RACE';
  private elapsedSec = 0;

  private cameraView: CameraView = CameraView.CHASE;
  private chaseCamPos = new THREE.Vector3(12, 3, 30);
  private chaseCamLook = new THREE.Vector3(14, 1, 22);
  // Reused by updateCamera(): allocating 8-10 vectors per frame in the chase
  // camera was a steady source of GC stutter on Android browsers.
  private camScratchA = new THREE.Vector3();
  private camScratchB = new THREE.Vector3();
  private camScratchC = new THREE.Vector3();
  private camScratchD = new THREE.Vector3();
  private camScratchE = new THREE.Vector3();
  private orbitAngle = 0.55;
  private footCamYaw = 0.45;
  private cameraShake = 0;
  private camRoll = 0;
  private syncAccumulator = 0;
  private boostCooldown = 0;
  private peerScratch = new THREE.Vector3();
  private boostDirScratch = new THREE.Vector3();
  // Per-frame HUD lookups are cached; getElementById walks the DOM each call.
  private interactPromptEl = document.getElementById('interact-prompt');
  private garagePromptEl = document.getElementById('garage-prompt');
  private timerPillEl = document.getElementById('activity-timer-pill');
  private speedVignetteEl = document.getElementById('speed-vignette');
  private impactFlashEl = document.getElementById('impact-flash');
  private impactFlashAlpha = 0;
  private hitStopTimer = 0;
  private interactCooldowns = new Map<string, number>();

  private lastTime = performance.now();
  private isPaused = false;
  private lobbyOpen = false;

  constructor() {
    const canvas = document.getElementById('render-canvas') as HTMLCanvasElement;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x93c5fd, 0.0011);

    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1400);

    this.setupLighting();
    this.sound = new SoundManager();
    this.track = new TrackEnvironment(this.scene);
    this.openWorld = new OpenWorldMap(this.scene);

    this.save = new SaveManager();
    this.sound.isMusicEnabled = this.save.data.musicEnabled;
    this.weather = new WeatherSystem(this.scene);
    this.weather.onThunderFlash = () => this.sound.playThunder();
    this.weather.setMode(this.save.data.weatherMode);
    this.ghostReplayEnabled = this.save.data.ghostReplayEnabled;
    const wet = this.weather.mode !== 'CLEAR';
    this.track.setWetSurface(wet);
    this.openWorld.setWetSurface(wet);

    this.openWorld.onGoalScored = (side) => {
      this.sound.playBeep(1280, 0.4);
      this.particles.emitSparks(this.openWorld.ballPos, 24);
      this.hud.showNotification('GOOOAAAL!!', `${side} Net Scored in Playground!`, 2.5);
      this.save.data.goalsScored++;
      this.save.scheduleSave();
      this.award(80, 120);
    };
    this.openWorld.onPropSmashed = (pos) => {
      this.sound.playCrash(22);
      this.particles.emitSparks(pos, 6);
      this.lapManager.addStyleBonus(25, 0.1);
    };

    this.sampleUnifiedGround = (x: number, z: number, currentY = 0): GroundSample => {
      const base = this.track.sampleGround(x, z);
      const rampH = this.openWorld.sampleRampHeight(x, z);
      const interiorH = this.openWorld.sampleInteriorHeight(x, z, currentY);
      const inCity = this.openWorld.isInsideCityOrPlayground(x, z);
      if (this.openWorld.isOverOpenWater(x, z)) {
        // The ocean surface is below the quay. Without this, the invisible
        // y=0 track plane lets cars "land" on water after a pier jump.
        return { ...base, height: -1.05, isRoad: false };
      }
      const groundH = interiorH !== null
        ? Math.max(base.height, rampH, interiorH)
        : Math.max(base.height, rampH);
      return {
        ...base,
        height: groundH,
        isRoad: base.isRoad || inCity || rampH > 0 || interiorH !== null
      };
    };

    // Car Physics
    this.physics = new CarPhysics();
    this.physics.enforceTrackWalls = false;
    this.physics.trackMaxHalfWidth = this.track.wallOffset;
    this.physics.groundHeightSampler = this.sampleUnifiedGround;
    this.physics.worldCollider = (pos, vel, rad) => this.openWorld.resolveCollision(pos, vel, rad);
    this.physics.gearboxType = this.save.data.gearbox;
    this.physics.assistMode = this.save.data.assistMode;
    this.physics.applyArchetype(this.save.data.carArchetype);
    this.physics.applyTuning(this.save.data.engineStage, this.save.data.nitroStage);
    this.physics.weatherGripMultiplier = this.weather.gripMultiplier;
    this.physics.onAirLanding = (airSec) => {
      if (airSec > 0.8) {
        this.particles.emitSparks(this.physics.position, Math.min(40, Math.round(airSec * 20)));
        this.hud.showNotification('AIRTIME!', `${airSec.toFixed(1)}s hang time`, 1.4);
        this.award(Math.round(airSec * 30), Math.round(airSec * 20));
      }
      if (airSec > this.save.data.maxAirTime) {
        this.save.data.maxAirTime = Number(airSec.toFixed(2));
        this.save.scheduleSave();
      }
    };
    this.physics.onWallCollision = (impactKmh) => {
      this.sound.playCrash(impactKmh);
      this.particles.emitSparks(this.physics.position, 14);
      this.cameraShake = Math.min(0.42, impactKmh / 140);
      if (impactKmh > 48) {
        this.impactFlashAlpha = Math.min(0.32, (impactKmh - 40) / 260);
      }
      this.lapManager.handleDriftCrash(impactKmh);
    };

    // Character Controller
    this.charCtrl = new CharacterController();
    this.charCtrl.groundHeightSampler = (x, z, y) => this.sampleUnifiedGround(x, z, y).height;
    this.charCtrl.waterSurfaceSampler = (x, z) => {
      if (this.openWorld.isOverOpenWater(x, z)) return -0.8;
      if (this.track.isOverLakeWater(x, z)) return -1.2;
      return null;
    };
    this.charCtrl.worldCollider = (pos, vel, rad) => this.openWorld.resolveCollision(pos, vel, rad);
    this.charCtrl.onPunchStrike = (origin, fwd) => this.handlePlayerPunch(origin, fwd);
    this.charCtrl.onLand = (impact) => this.sound.playLand(impact);
    this.charCtrl.onDash = () => {
      this.sound.playPunchWhoosh();
      this.particles.emitSparks(this.charCtrl.position, 6);
    };
    this.charCtrl.onSplash = (pos) => {
      this.sound.playLand(7.5);
      this.particles.emitSparks(pos, 14);
      this.hud.showWorldPopup('SPLASH!', '#38bdf8');
    };
    this.charCtrl.respawnPoint = new THREE.Vector3(13.8, 0, 24.5);
    this.charCtrl.onDeath = () => {
      this.koReason = 'WASTED';
      this.sound.playCrash(90);
      this.sound.playBeep(110, 0.55);
      this.police?.clearHeat();
      this.activities.cancelSprint();
      this.activities.cancelCourier();
      this.activities.resetTransientState();
      this.setRivalPrompt(null);
      this.setCourierPrompt(null);
      this.hud.setStealPrompt(null);
      this.hud.showKoOverlay('WASTED', 'You were beaten down. Respawning at South Junction…');
      this.hud.showNotification('KNOCKED OUT', 'You are down. Wait for the revive.', 2.4);
    };
    this.charCtrl.onRespawn = (spawn) => {
      this.avatarMesh.root.position.copy(spawn);
      this.avatarMesh.root.rotation.y = this.charCtrl.yaw;
      this.avatarMesh.root.rotation.x = 0;
      this.footCamYaw = this.charCtrl.yaw;
      this.chaseCamPos.set(spawn.x + 4, 2.6, spawn.z + 6);
      this.chaseCamLook.copy(spawn);
      if (this.koReason === 'BUSTED') {
        // handleBusted owns the overlay and message in this case.
      } else {
        this.koReason = null;
        this.hud.hideKoOverlay();
        this.hud.showNotification('BACK ON YOUR FEET', 'HP restored. Keep it clean.', 1.8);
      }
    };

    this.carMesh = new CarMesh(true);
    this.carMesh.setColor(this.save.data.carColor);
    this.carMesh.setUnderglowColor(this.save.data.underglowColor);
    this.scene.add(this.carMesh.root);
    this.ownZenvo = { physics: this.physics, mesh: this.carMesh, name: 'Your Zenvo' };

    // Apex Skyhawk Helicopter parked on Zenith Corp Rooftop Helipad (258, 50.0, -5)
    this.heliPhysics = new HelicopterPhysics();
    this.heliPhysics.groundHeightSampler = (x, z, y) => this.openWorld.sampleHeliGroundHeight(x, z, y);
    this.heliPhysics.waterSurfaceSampler = (x, z) => {
      if (this.openWorld.isOverOpenWater(x, z)) return -0.8;
      if (this.track.isOverLakeWater(x, z)) return -1.2;
      return null;
    };
    this.heliPhysics.worldCollider = (pos, vel, rad) => this.openWorld.resolveCollision(pos, vel, rad);
    this.heliPhysics.onImpact = (spd) => {
      this.sound.playCrash(spd);
      this.particles.emitSparks(this.heliPhysics.position, 14);
      this.cameraShake = Math.min(0.4, spd / 130);
    };
    this.heliPhysics.onWaterSplash = () => {
      this.sound.playCrash(50);
      this.particles.emitSparks(this.heliPhysics.position, 18);
      this.hud.showNotification('WATER SPLASH!', 'Recovered helicopter to last safe landing zone.', 2.2);
    };
    this.heliPhysics.resetAt(new THREE.Vector3(258, 50.0, -5), 0.35);
    this.heliMesh = new HelicopterMesh();
    this.heliMesh.update(this.heliPhysics, 0);
    this.scene.add(this.heliMesh.root);

    this.studio = new CharacterStudio();
    this.studio.applyPreset(this.save.data.characterId);
    const modelUrl = modelUrlFor(this.save.data.characterId);
    this.avatarMesh = new GLTFCharacterMesh(
      modelUrl,
      this.save.data.characterId,
      this.save.data.playerName,
      this.studio.appearance,
      0,
      false
    );
    GLTFCharacterMesh.onModelStatus(() => {
      const playerReady = this.avatarMesh instanceof GLTFCharacterMesh && this.avatarMesh.isRealistic;
      const badge = document.getElementById('btn-model-status');
      if (badge) badge.textContent = playerReady ? '3D characters: ready' : '3D characters: fallback';
      this.studio.setRigged(playerReady);
    });
    this.avatarMesh.setNameAndHp(this.save.data.playerName, 100);
    this.scene.add(this.avatarMesh.root);

    this.ghost = new GhostSystem(this.scene, this.save.data.bestLapGhost);

    this.studio.onChange = (app) => {
      this.avatarMesh.setAppearance(app);
    };
    this.studio.onCharacterChange = (id) => {
      this.save.data.characterId = id;
      this.save.scheduleSave();
      if (this.lobbyUI) this.lobbyUI.config.characterId = id;
      if (this.avatarMesh instanceof GLTFCharacterMesh) {
        this.avatarMesh.setModel(modelUrlFor(id));
      } else {
        this.avatarMesh.setCharacter(id);
      }
      // applyPreset already pushed the new palette through onChange; reapply
      // after a procedural rebuild so both paths end on the same look.
      this.avatarMesh.setAppearance(this.studio.appearance);
      document.querySelectorAll('.char-card').forEach((c) => {
        const selected = c.getAttribute('data-char') === id;
        c.classList.toggle('selected', selected);
        c.setAttribute('aria-pressed', String(selected));
      });
    };
    this.studio.onToggle = (open) => {
      if (open && this.inCar) {
        this.toggleEnterExitCar();
      }
      // Character Studio is a modal showcase: freeze simulation and on-foot
      // input so the avatar cannot wander into traffic behind the drawer.
      this.syncPause();
    };

    this.particles = new ParticleSystem(this.scene);

    this.hud = new HUD();
    this.hud.onToggleEnterExit = () => this.toggleEnterExitCar();
    this.hud.onStartCircuitRace = () => this.startTimedCircuitRace(3);
    this.hud.onHorn = () => this.handleHornPressed();
    this.hud.onSendChat = (txt) => this.sendInGameChat(txt);
    this.hud.onSendEmoji = (emoji) => this.sendEmojiReaction(emoji);
    this.refreshProfile();

    this.police = new PoliceSystem(this.scene, this.track, this.openWorld);
    this.police.onHooks = {
      onHeatChanged: (level, label) => {
        this.hud.setWanted(level);
        if (level > 0) {
          this.sound.playBeep(level >= 3 ? 520 : 700, 0.18);
          this.hud.showNotification(`WANTED ${level}`, label, 2.0);
        } else {
          this.hud.showNotification('CLEAN', 'You lost the police.', 1.8);
        }
      },
      onBustProgress: (pct) => this.hud.setBustedProgress(pct),
      onBusted: (fine, heat) => this.handleBusted(fine, heat),
      onEscaped: () => {
        this.hud.showNotification('ESCAPED!', '+80 XP • Clean getaway', 2.2);
        this.award(80, 100);
      },
      onImpact: (impact, pos) => {
        this.sound.playCrash(impact);
        this.particles.emitSparks(pos, 8);
        if (this.inCar && pos.distanceTo(this.physics.position) < 6) {
          this.cameraShake = Math.max(this.cameraShake, Math.min(0.35, impact / 150));
        }
      }
    };

    this.pedestrians = new PedestrianSystem(
      this.scene,
      this.openWorld,
      (x, z) => this.sampleUnifiedGround(x, z).height,
      14
    );
    this.pedestrians.onCrimeReported = (reason, reporterPos) => {
      this.sound.playCrimeAlarm();
      this.police.addHeat(1, reason, reporterPos);
      this.hud.showNotification('WITNESS REPORT', `Pedestrian called police: ${reason}`, 2.0);
    };
    this.pedestrians.onPedestrianKnockedOut = (ped) => {
      this.save.data.knockouts++;
      this.save.scheduleSave();
      this.police.addHeat(1, 'ASSAULT ON CIVILIAN', ped.controller.position);
      this.pedestrians.alertDanger(ped.controller.position, 24);
    };

    this.lapManager = new LapManager(
      this.track,
      this.sound,
      (title, desc) => this.hud.showNotification(title, desc),
      (stats) => this.showRaceResults(stats)
    );
    this.lapManager.onLapRecorded = (lapTime, isNewBest) => this.handleLapRecorded(lapTime, isNewBest);
    this.lapManager.onDriftBanked = (banked, multiplier) => {
      this.hud.showNotification(`DRIFT BANKED +${banked.toLocaleString()}`, `${multiplier.toFixed(1)}× chain multiplier`, 1.8);
      this.save.data.totalDriftPoints += banked;
      this.save.data.bestDriftCombo = Math.max(this.save.data.bestDriftCombo, banked);
      this.save.scheduleSave();
      this.award(Math.round(banked / 12), Math.round(banked / 18));
    };
    this.lapManager.onDriftLost = (lost) => {
      if (lost >= 100) this.hud.showNotification('DRIFT LOST', `-${lost.toLocaleString()} pts — crashed`, 1.4);
    };

    this.activities = new WorldActivities(this.scene, this.save, this.track, this.openWorld, {
      onSpeedTrapTriggered: (trap, speedKmh, isNewBest) => {
        this.sound.playSpeedTrapFlash();
        this.hud.showNotification(
          isNewBest ? `TRAP RECORD: ${speedKmh} KM/H` : trap.name,
          isNewBest ? `New personal best! Target ${trap.targetKmh} km/h` : `${speedKmh} / ${trap.targetKmh} km/h`,
          2.0
        );
        if (isNewBest) this.award(120, 200);
        else if (speedKmh >= trap.targetKmh) this.award(25, 40);
        if (this.gameState === GameState.OPEN_WORLD && speedKmh >= 245 && trap.id !== 'trap_gp_straight') {
          this.police.addHeat(1, 'EXTREME SPEEDING', this.physics.position);
        }
      },
      onDriftZoneCompleted: (zone, score, medal, isNewBest) => {
        this.sound.playDiscoveryChime();
        const label = medal === 'NONE' ? 'DRIFT ZONE CLOSED' : `${medal} DRIFT ZONE`;
        this.hud.showNotification(
          label,
          `${zone.name}: ${score.toLocaleString()} pts${isNewBest ? ' • NEW BEST' : ''}`,
          2.4
        );
        if (medal !== 'NONE') {
          const xp = medal === 'GOLD' ? 240 : (medal === 'SILVER' ? 160 : 90);
          const credits = medal === 'GOLD' ? 450 : (medal === 'SILVER' ? 260 : 120);
          this.award(Math.round(xp * (isNewBest ? 1.5 : 1)), Math.round(credits * (isNewBest ? 1.5 : 1)));
        }
      },
      onShardCollected: (shard, found, total) => {
        this.sound.playDiscoveryChime();
        this.hud.showCollectible(found, total, shard.title);
        this.award(150, 120);
      },
      onNearRivalPrompt: (rival) => this.setRivalPrompt(rival),
      onNearCourierPrompt: (c) => this.setCourierPrompt(c),
      onSprintCheckpoint: (wpIdx, totalWps) => {
        this.sound.playBeep(880, 0.08);
        this.hud.showNotification(
          `CHECKPOINT ${wpIdx}/${totalWps}`,
          wpIdx === totalWps - 1 ? 'Final push — hit the GREEN Finish Gate!' : 'Follow the GOLD beacon to the next block!',
          1.4
        );
      },
      onSprintEnded: (def, playerWon, timeSec) => {
        this.setRivalPrompt(null);
        if (playerWon) {
          if (!this.save.data.rivalsDefeated.includes(def.id)) {
            this.save.data.rivalsDefeated.push(def.id);
            this.save.scheduleSave();
          }
          this.sound.playRankUpFanfare();
          this.hud.showNotification(
            `RIVAL DEFEATED: ${def.rivalName}`,
            `${def.tauntWin} (${this.lapManager.formatTime(timeSec)})`,
            4.5
          );
          this.award(def.rewardXp, def.rewardCredits);
        } else {
          this.sound.playBeep(220, 0.3);
          this.hud.showNotification(`RIVAL WINS: ${def.rivalName}`, def.tauntLose, 4.0);
        }
        this.refreshProfile();
      },
      onCourierEnded: (def, medal, timeSec, isNewBest, credits, xp) => {
        this.setCourierPrompt(null);
        if (medal === 'FAILED') {
          this.sound.playBeep(190, 0.3);
          this.hud.showNotification('DELIVERY EXPIRED', `${def.title} missed deadline — try again!`, 2.6);
        } else {
          this.sound.playRankUpFanfare();
          this.hud.showNotification(
            `${medal} DELIVERY: ${def.title}`,
            `${timeSec.toFixed(2)}s${isNewBest ? ' • NEW BEST' : ''} (+₡${credits})`,
            3.2
          );
          this.award(xp, credits);
        }
        this.refreshProfile();
      }
    });

    // Spawn 2 roaming sparring fighters in City Plaza & Playground
    const f1 = new SparringFighter('Kenji', 'kaito', new THREE.Vector3(34, 0, 22), this.scene, this.openWorld);
    const f2 = new SparringFighter('Yuki', 'mika', new THREE.Vector3(84, 0, 75), this.scene, this.openWorld);
    for (const f of [f1, f2]) {
      f.controller.groundHeightSampler = (x, z, y) => this.sampleUnifiedGround(x, z, y).height;
      f.controller.worldCollider = (pos, vel, rad) => this.openWorld.resolveCollision(pos, vel, rad);
      f.controller.onPunchStrike = (origin, fwd) => {
        if (!this.inCar && !this.inHeli && origin.distanceTo(this.charCtrl.position) < 2.2 && hasLineOfSight(
          origin.x, origin.z, this.charCtrl.position.x, this.charCtrl.position.z,
          this.openWorld.colliders, 0.2,
          origin.y, this.charCtrl.position.y,
          this.openWorld.getElevatedOccluders()
        )) {
          this.charCtrl.takeDamage(12, fwd.x, fwd.z);
          this.sound.playCrash(25);
          this.particles.emitSparks(this.charCtrl.position, 8);
          this.cameraShake = 0.2;
        }
      };
      this.sparringFighters.push(f);
    }

    this.lobbyClient = new LobbyClient();
    this.lobbyUI = new LobbyUI(this.lobbyClient);
    this.lobbyUI.onCharacterPreview = (charId) => {
      this.studio.applyPreset(charId);
      // Preview the correct rig immediately when a driver card is tapped.
      if (this.avatarMesh instanceof GLTFCharacterMesh) this.avatarMesh.setModel(modelUrlFor(charId));
    };
    this.lobbyUI.onColorPreview = (color) => {
      this.ownZenvo.mesh.setColor(color);
      // Only repaint the active mesh when it is actually the owned Zenvo;
      // a stolen cruiser/civic must keep its original livery.
      if (this.carMesh === this.ownZenvo.mesh) this.carMesh.setColor(color);
      this.save.data.carColor = color;
      this.save.scheduleSave();
    };
    this.lobbyUI.onGearboxChange = (gb) => {
      this.ownZenvo.physics.gearboxType = gb;
      this.physics.gearboxType = gb;
      this.save.data.gearbox = gb;
      this.save.scheduleSave();
      this.hud.updateTouchVisibility(gb);
    };
    this.lobbyUI.onLaunchSession = (cfg) => this.applyLobbyLaunch(cfg);
    this.lobbyUI.onErrorToast = (message) =>
      this.hud.showNotification('LAN ERROR', message, 3.2, { kind: 'error' });
    this.lobbyUI.onVisibilityChange = (visible) => {
      this.lobbyOpen = visible;
      if (visible) this.hud.clearAllInputs();
      this.syncPause();
    };

    this.lobbyUI.config.playerName = this.save.data.playerName;
    this.lobbyUI.config.characterId = this.save.data.characterId;
    this.lobbyUI.config.carColor = this.save.data.carColor;
    this.lobbyUI.config.gearbox = this.save.data.gearbox;
    const savedNameInput = document.getElementById('input-player-name') as HTMLInputElement | null;
    if (savedNameInput) savedNameInput.value = this.save.data.playerName;
    document.querySelectorAll('.color-swatch').forEach((s) => {
      const selected = s.getAttribute('data-color') === this.save.data.carColor;
      s.classList.toggle('selected', selected);
      s.setAttribute('aria-pressed', String(selected));
    });
    document.querySelectorAll('.char-card').forEach((c) => {
      const selected = c.getAttribute('data-char') === this.save.data.characterId;
      c.classList.toggle('selected', selected);
      c.setAttribute('aria-pressed', String(selected));
    });

    this.spawnCityCruisers();
    this.spawnCivicCars();
    this.applyGraphicsQuality(this.save.data.graphicsQuality);
    const savedTod = this.save.data.atmospherePref === 'AUTO' ? 'SUNSET' : this.save.data.atmospherePref;
    this.setAtmosphere(savedTod);
    this.bindMultiplayerEvents();
    this.setupCameraDragLook(canvas);
    this.spawnInOpenWorld();
    this.setupUIHandlers();
    this.applySavedRuntimeSettings();

    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('orientationchange', () => {
      // Some Android browsers report stale innerWidth/innerHeight for a beat.
      window.setTimeout(() => this.onResize(), 120);
    });
    window.visualViewport?.addEventListener('resize', () => this.onResize());
    this.bindLifecycle();
    this.registerServiceWorker();
    this.bindPwaInstall();
    requestAnimationFrame((t) => this.loop(t));
  }

  private registerServiceWorker(): void {
    if (!('serviceWorker' in navigator)) return;
    // A new SW taking over must refresh an already-open tab, otherwise the
    // player keeps running the previous bundle until they manually reload.
    let hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController && !reloaded) {
        reloaded = true;
        location.reload();
      }
      hadController = !!navigator.serviceWorker.controller;
    });
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }

  private bindPwaInstall(): void {
    let deferred: any = null;
    window.addEventListener('beforeinstallprompt', (e: Event) => {
      e.preventDefault();
      deferred = e;
      const btn = document.getElementById('btn-install-app');
      if (btn) btn.style.display = 'inline-flex';
    });
    const btn = document.getElementById('btn-install-app');
    if (btn) {
      btn.addEventListener('click', async () => {
        if (!deferred) return;
        deferred.prompt();
        await deferred.userChoice.catch(() => {});
        deferred = null;
        btn.style.display = 'none';
      });
    }
  }

  /**
   * Mobile lifecycle: stop audio and flush progress when the app is
   * backgrounded, then restore the frame clock instead of simulating a huge
   * delta when it returns. Also flushes the save when the page is discarded.
   */
  private bindLifecycle(): void {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.sound.pauseAudio();
        this.save.saveNow();
        this.hud.clearAllInputs();
      } else {
        this.lastTime = performance.now();
        this.adaptiveRes.reset();
        if (!this.isPaused) this.sound.resumeAudio();
      }
    });
    window.addEventListener('pagehide', () => {
      this.save.saveNow();
      this.sound.pauseAudio();
    });
  }

  private spawnInOpenWorld(): void {
    this.gameState = GameState.OPEN_WORLD;
    this.resetHelicopterState();
    this.inCar = false;
    this.exitSeat(false);
    this.activities.cancelSprint();
    this.activities.cancelCourier();
    this.activities.resetTransientState();
    this.setRivalPrompt(null);
    this.setCourierPrompt(null);
    this.ghost.updatePlayback(false, 0);

    // Always restore the owned Zenvo here. A lobby relaunch while driving a
    // stolen car must not reset/park that stolen car as the player's home car.
    if (this.physics !== this.ownZenvo.physics) {
      this.parkActiveCar();
      this.parkedCars = this.parkedCars.filter((p) => p.physics !== this.ownZenvo.physics);
      this.physics = this.ownZenvo.physics;
      this.carMesh = this.ownZenvo.mesh;
      this.activeCarName = this.ownZenvo.name;
      this.activePoliceLights = undefined;
      this.configureActiveCar();
    } else {
      this.parkedCars = this.parkedCars.filter((p) => p.physics !== this.ownZenvo.physics);
    }

    // Park car at South Track-City Boulevard Junction facing the GP Track Gate
    this.physics.enforceTrackWalls = false;
    this.physics.resetToTrack(new THREE.Vector3(16, 0, 26), Math.PI * 0.42);
    this.carMesh.setDriverVisible(false);
    this.parkActiveCar();
    this.hud.setStealPrompt(null);
    this.hud.hideKoOverlay();
    this.koReason = null;
    this.hud.setWanted(this.police.heat);
    // Stand right beside the driver's door!
    this.charCtrl.resetAt(new THREE.Vector3(13.8, 0, 24.5), Math.PI * 0.42);
    this.footCamYaw = Math.PI * 0.42;

    this.avatarMesh.root.visible = true;
    this.avatarMesh.root.position.copy(this.charCtrl.position);
    this.avatarMesh.root.rotation.y = this.charCtrl.yaw;

    this.chaseCamPos.set(16.5, 2.5, 28);
    this.chaseCamLook.copy(this.charCtrl.position);

    this.spawnRaceBots(this.lobbyUI.config);
    this.lapManager.resetRace(0);
    this.hud.setVisible(true, this.physics.gearboxType);
    this.hud.setOnFootMode(true, true, 100, this.physics.gearboxType);
    this.hud.showNotification('APEX ZERO: NEON VELO', 'Tap DRIVE to get in car, or explore Neo Velo!', 3.0);
  }

  private startTimedCircuitRace(laps = 3): void {
    if (this.charCtrl.isDead) {
      this.hud.showNotification('KNOCKED OUT', 'Wait until you are back on your feet.', 1.4);
      return;
    }
    this.resetHelicopterState();
    this.sound.init();
    this.hud.setRacePrompt(false);
    this.setRivalPrompt(null);
    this.exitSeat(false);
    this.hud.setStealPrompt(null);
    this.hud.hideKoOverlay();
    this.police.clearHeat();
    this.hud.setWanted(0);
    this.activities.cancelSprint();
    this.activities.cancelCourier();
    this.activities.resetTransientState();
    document.getElementById('results-modal')!.classList.remove('open');
    this.syncPause();

    // Always put player inside their tuned Zenvo on the Starting Grid (keep any stolen ride parked cleanly)
    if (this.physics !== this.ownZenvo.physics) {
      this.parkActiveCar();
      this.parkedCars = this.parkedCars.filter((p) => p.physics !== this.ownZenvo.physics);
      this.physics = this.ownZenvo.physics;
      this.carMesh = this.ownZenvo.mesh;
      this.activeCarName = this.ownZenvo.name;
      this.activePoliceLights = undefined;
      this.configureActiveCar();
    } else {
      this.parkedCars = this.parkedCars.filter((p) => p.physics !== this.ownZenvo.physics);
    }
    this.inCar = true;
    this.carMesh.setDriverVisible(true);
    this.avatarMesh.root.visible = false;
    this.physics.enforceTrackWalls = true;
    this.physics.resetToTrack(new THREE.Vector3(0, 0, 2), 0);
    this.physics.topSpeedKmh = 0;

    this.spawnRaceBots(this.lobbyUI.config);
    this.lapManager.resetRace(laps);
    this.hud.setOnFootMode(false, true, this.charCtrl.hp, this.physics.gearboxType);

    this.gameState = GameState.COUNTDOWN;
    this.countdownTimer = 3.2;
    this.lastCountdownStep = -1;
    this.track.setCountdownLights(1, false);
    this.ghost.startRecording();
    this.ghost.updatePlayback(false, 0);
    if (this.ghostReplayEnabled && this.ghost.hasGhost) {
      this.hud.showNotification('GHOST ACTIVE', 'Racing against your best lap!', 2.0);
    }
  }

  private startDriftArenaRun(durationSec = 90): void {
    if (this.charCtrl.isDead) {
      this.hud.showNotification('KNOCKED OUT', 'Wait until you are back on your feet.', 1.4);
      return;
    }
    this.resetHelicopterState();
    this.sound.init();
    this.hud.setRacePrompt(false);
    this.setRivalPrompt(null);
    this.exitSeat(false);
    this.hud.setStealPrompt(null);
    this.hud.hideKoOverlay();
    this.police.clearHeat();
    this.hud.setWanted(0);
    this.activities.cancelSprint();
    this.activities.cancelCourier();
    this.activities.resetTransientState();
    document.getElementById('results-modal')!.classList.remove('open');
    this.syncPause();

    if (this.physics !== this.ownZenvo.physics) {
      this.parkActiveCar();
      this.parkedCars = this.parkedCars.filter((p) => p.physics !== this.ownZenvo.physics);
      this.physics = this.ownZenvo.physics;
      this.carMesh = this.ownZenvo.mesh;
      this.activeCarName = this.ownZenvo.name;
      this.activePoliceLights = undefined;
      this.configureActiveCar();
    } else {
      this.parkedCars = this.parkedCars.filter((p) => p.physics !== this.ownZenvo.physics);
    }

    this.inCar = true;
    this.carMesh.setDriverVisible(true);
    this.avatarMesh.root.visible = false;
    this.physics.enforceTrackWalls = false;
    this.physics.resetToTrack(new THREE.Vector3(84, 0, 72), 0);
    this.physics.topSpeedKmh = 0;

    this.lapManager.resetRace(0);
    this.hud.setOnFootMode(false, true, this.charCtrl.hp, this.physics.gearboxType);

    this.pendingRaceMode = 'DRIFT_ARENA';
    this.driftArenaDuration = durationSec;
    this.driftArenaTimer = durationSec;
    this.driftArenaBestCombo = 1.0;
    this.gameState = GameState.DRIFT_ARENA;
    this.sound.playBeep(880, 0.2);
    this.hud.showNotification('DRIFT ARENA', `${durationSec}s Drift Attack — Chain corners & boost!`, 3.0, { hero: true });
  }

  private applyLobbyLaunch(cfg: LobbyConfig): void {
    this.sound.init();
    this.physics.gearboxType = cfg.gearbox;
    this.ownZenvo.mesh.setColor(cfg.carColor);
    if (this.avatarMesh instanceof GLTFCharacterMesh) {
      this.avatarMesh.setModel(modelUrlFor(cfg.characterId));
    }
    this.avatarMesh.setAppearance(this.studio.appearance);
    this.avatarMesh.setNameAndHp(cfg.playerName, 100);
    this.save.data.playerName = cfg.playerName;
    this.save.data.characterId = cfg.characterId;
    this.save.data.carColor = cfg.carColor;
    this.save.data.gearbox = cfg.gearbox;
    this.save.scheduleSave();
    this.refreshProfile();

    if (cfg.mode === 'CIRCUIT_RACE') {
      this.pendingRaceMode = 'CIRCUIT_RACE';
      this.startTimedCircuitRace(cfg.laps || 3);
    } else if (cfg.mode === 'DRIFT_ARENA') {
      this.pendingRaceMode = 'DRIFT_ARENA';
      this.startDriftArenaRun(90);
    } else {
      this.spawnInOpenWorld();
    }
  }

  private sameAppearance(a: CharacterAppearance | null, b: CharacterAppearance): boolean {
    return !!a
      && a.hairStyle === b.hairStyle && a.hairColor === b.hairColor
      && a.eyeColor === b.eyeColor && a.jacketColor === b.jacketColor
      && a.accentColor === b.accentColor && a.pantsColor === b.pantsColor
      && a.skinColor === b.skinColor && a.accessory === b.accessory;
  }

  private bindMultiplayerEvents(): void {
    this.lobbyClient.onWorldState = (states) => {
      for (const [id, peer] of this.remotePeers.entries()) {
        if (!states[id]) {
          this.scene.remove(peer.carMesh.root);
          this.scene.remove(peer.charMesh.root);
          peer.carMesh.dispose();
          peer.charMesh.dispose();
          this.remotePeers.delete(id);
        }
      }

      for (const [id, st] of Object.entries(states)) {
        if (id === this.lobbyClient.clientId) continue;
        let peer = this.remotePeers.get(id);
        if (!peer) {
          const carM = new CarMesh();
          carM.setColor(st.carColor || '#2563eb');
          const charM = new GLTFCharacterMesh(
            modelUrlFor(st.characterId), st.characterId || 'mika', st.name || 'Friend', st.appearance ?? null
          );
          this.scene.add(carM.root);
          this.scene.add(charM.root);
          peer = { id, carMesh: carM, charMesh: charM, lastState: st };
          this.remotePeers.set(id, peer);
        } else if (st.appearance && !this.sameAppearance(peer.charMesh.getAppearance(), st.appearance)) {
          // World sync arrives ~20x/second; recolouring an unchanged outfit
          // would traverse every skinned mesh and dirty its material each time.
          peer.charMesh.setAppearance(st.appearance);
        }
        peer.lastState = st;
      }
    };

    this.lobbyClient.onChatMessage = (sender, text, isSystem, senderId) => {
      this.hud.appendChatMessage(sender, text, isSystem);
      if (!isSystem && senderId) {
        if (senderId === this.lobbyClient.clientId) {
          this.avatarMesh.showSpeechBubble(text);
        } else {
          const peer = this.remotePeers.get(senderId);
          if (peer) peer.charMesh.showSpeechBubble(text);
        }
      }
    };

    this.lobbyClient.onEmojiFx = (senderId, _name, emoji) => {
      if (senderId === this.lobbyClient.clientId) {
        this.avatarMesh.triggerEmoji(emoji);
      } else {
        const peer = this.remotePeers.get(senderId);
        if (peer) peer.charMesh.triggerEmoji(emoji);
      }
    };

    this.lobbyClient.onMeleeHit = (data) => {
      if (data.attackerId === data.targetId) return;
      if (data.targetId === this.lobbyClient.clientId && !this.inCar && !this.inHeli) {
        this.charCtrl.takeDamage(data.damage, data.dirX, data.dirZ);
        this.sound.playCrash(30);
        this.particles.emitSparks(this.charCtrl.position, 10);
        this.cameraShake = 0.25;
      }
    };

    this.lobbyClient.onBallSync = (data) => {
      this.openWorld.ballPos.set(data.x, data.y, data.z);
      this.openWorld.ballVel.set(data.vx, data.vy, data.vz);
    };

    this.lobbyClient.onLeaderboardUpdate = (data) => {
      const lapListEl = document.getElementById('res-lap-list');
      const resultsModal = document.getElementById('results-modal');
      if (!lapListEl || !resultsModal?.classList.contains('open')) return;
      const rows = data.entries.map((entry, idx) => {
        const scoreStr = data.mode === 'CIRCUIT_RACE' && entry.bestTimeMs
          ? this.lapManager.formatTime(entry.bestTimeMs / 1000)
          : `${entry.score} PTS`;
        return `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.08);"><span>#${idx + 1} ${entry.name.replace(/[<>&]/g, '')}</span><strong>${scoreStr}</strong></div>`;
      }).join('');
      if (rows) {
        lapListEl.innerHTML = `<div style="font-size:10px;color:#38bdf8;font-weight:800;margin-bottom:4px;text-transform:uppercase;">Live Room Standings</div>${rows}`;
      }
    };
  }

  private setupCameraDragLook(canvas: HTMLCanvasElement): void {
    // Isolate by pointerId so multi-touch left thumb movement never interrupts camera orbit
    let camPointerId: number | null = null;
    let lastX = 0;

    canvas.addEventListener('pointerdown', (e) => {
      if (!this.inCar && !this.studio.isOpen && camPointerId === null) {
        camPointerId = e.pointerId;
        lastX = e.clientX;
      }
    });
    window.addEventListener('pointermove', (e) => {
      if (e.pointerId === camPointerId && !this.inCar && !this.studio.isOpen) {
        const dx = e.clientX - lastX;
        lastX = e.clientX;
        this.footCamYaw -= dx * 0.0065;
      }
    });
    const endCamDrag = (e: PointerEvent) => {
      if (e.pointerId === camPointerId) {
        camPointerId = null;
      }
    };
    window.addEventListener('pointerup', endCamDrag);
    window.addEventListener('pointercancel', endCamDrag);
  }

  private sendInGameChat(text: string): void {
    if (this.lobbyClient.currentRoom) {
      this.lobbyClient.sendChat(text);
    } else {
      this.hud.appendChatMessage(this.lobbyUI.config.playerName, text, false);
      this.avatarMesh.showSpeechBubble(text);
    }
  }

  private sendEmojiReaction(emoji: string): void {
    this.sound.playBeep(1100, 0.08);
    this.avatarMesh.triggerEmoji(emoji);
    if (this.lobbyClient.currentRoom) {
      this.lobbyClient.sendEmoji(emoji);
    }
  }

  private handlePlayerPunch(origin: THREE.Vector3, _fwd: THREE.Vector3): void {
    this.sound.playPunchWhoosh();
    const combo = this.charCtrl.comboStep;
    if (this.avatarMesh instanceof GLTFCharacterMesh) {
      this.avatarMesh.setPunchCombo(combo);
    } else {
      this.avatarMesh.triggerPunchVisual();
    }

    // Soft auto-aim: smoothly turn toward the closest target within 3.6m so punches feel responsive!
    let bestTarget: THREE.Vector3 | null = null;
    let bestDist = 3.6;
    for (const f of this.sparringFighters) {
      if (f.isDead) continue;
      const d = Math.hypot(f.controller.position.x - origin.x, f.controller.position.z - origin.z);
      if (d < bestDist && Math.abs(f.controller.position.y - origin.y) < 2.2) {
        bestDist = d;
        bestTarget = f.controller.position;
      }
    }
    if (!bestTarget) {
      for (const ped of this.pedestrians.agents) {
        if (ped.controller.isDead) continue;
        const d = Math.hypot(ped.controller.position.x - origin.x, ped.controller.position.z - origin.z);
        if (d < 3.0 && d < bestDist && Math.abs(ped.controller.position.y - origin.y) < 2.2) {
          bestDist = d;
          bestTarget = ped.controller.position;
        }
      }
    }
    if (!bestTarget) {
      for (const peer of this.remotePeers.values()) {
        if (peer.lastState.inCar) continue;
        const pp = peer.charMesh.root.position;
        const d = Math.hypot(pp.x - origin.x, pp.z - origin.z);
        if (d < bestDist && Math.abs(pp.y - origin.y) < 2.2) {
          bestDist = d;
          bestTarget = pp;
        }
      }
    }
    if (bestTarget) {
      this.charCtrl.faceTarget(bestTarget.x, bestTarget.z);
    }
    const fwd = this.charCtrl.getForwardVector();
    const comboLabels = ['CROSS', 'JAB', 'UPPERCUT!!'];
    const baseDamages = [24, 28, 44];
    const buffMult = this.charCtrl.powerBuffTimer > 0 ? 1.5 : 1.0;
    const dmg = Math.round(baseDamages[combo] * buffMult);
    const isFinisher = combo === 2;

    // 1. Kick giant soccer ball if nearby
    if (origin.distanceTo(this.openWorld.ballPos) < this.openWorld.ballRadius + 2.4) {
      this.openWorld.ballVel.x += fwd.x * (isFinisher ? 22 : 16);
      this.openWorld.ballVel.z += fwd.z * (isFinisher ? 22 : 16);
      this.openWorld.ballVel.y += isFinisher ? 9.5 : 6.5;
      this.particles.emitSparks(this.openWorld.ballPos, 10);
    }

    // 2. Hit Roaming Sparring Fighters
    for (const f of this.sparringFighters) {
      if (f.isDead) continue;
      const dx = f.controller.position.x - origin.x;
      const dz = f.controller.position.z - origin.z;
      const d = Math.hypot(dx, dz);
      if (d < 2.9 && d > 0.01 && Math.abs(f.controller.position.y - origin.y) < 2.2) {
        const dot = (dx * fwd.x + dz * fwd.z) / d;
        if (dot > -0.15) {
          const killed = f.controller.takeDamage(dmg, fwd.x * (isFinisher ? 1.45 : 1), fwd.z * (isFinisher ? 1.45 : 1));
          this.sound.playCrash(isFinisher ? 44 : 28);
          this.particles.emitSparks(f.controller.position, killed ? 26 : (isFinisher ? 16 : 10));
          this.cameraShake = isFinisher ? 0.28 : 0.16;
          this.hitStopTimer = isFinisher ? 0.05 : 0.025;
          this.hud.showWorldPopup(`${comboLabels[combo]} ${dmg}`, isFinisher ? '#f97316' : '#facc15');

          if (killed) {
            this.save.data.knockouts++;
            this.save.scheduleSave();
            this.award(140, 180);
            this.hud.showNotification(
              `${f.name.toUpperCase()} DOWN`,
              'Sparring win. No heat — +₡140 & +180 XP.',
              2.6
            );
            this.sound.playRankUpFanfare();
          }
        }
      }
    }

    // 2b. Hit City Pedestrians (triggers panic & witness reporting!)
    for (const ped of this.pedestrians.agents) {
      if (ped.controller.isDead) continue;
      const dx = ped.controller.position.x - origin.x;
      const dz = ped.controller.position.z - origin.z;
      const d = Math.hypot(dx, dz);
      if (d < 2.7 && d > 0.01 && Math.abs(ped.controller.position.y - origin.y) < 2.2) {
        const dot = (dx * fwd.x + dz * fwd.z) / d;
        if (dot > -0.1) {
          ped.controller.takeDamage(dmg, fwd.x, fwd.z);
          this.pedestrians.markVictimFlee(ped, origin);
          this.sound.playCrash(24);
          this.particles.emitSparks(ped.controller.position, 8);
          this.cameraShake = 0.14;
          this.hitStopTimer = 0.025;
          this.hud.showWorldPopup(`${comboLabels[combo]} ${dmg}`, '#f87171');
          this.pedestrians.alertDanger(origin, 22);
          this.pedestrians.notifyCrime(origin, 'ASSAULT ON CIVILIAN', 32, ped);
        }
      }
    }

    // 3. Hit Remote Hotspot Friends (PvP Brawl!)
    for (const [peerId, peer] of this.remotePeers.entries()) {
      if (peer.lastState.inCar) continue;
      const peerPos = peer.charMesh.root.position;
      const dx = peerPos.x - origin.x;
      const dz = peerPos.z - origin.z;
      const d = Math.hypot(dx, dz);
      if (d < 2.8 && d > 0.01 && Math.abs(peerPos.y - origin.y) < 2.2) {
        const dot = (dx * fwd.x + dz * fwd.z) / d;
        if (dot > -0.1) {
          this.lobbyClient.sendMeleeHit(peerId, dmg, fwd.x, fwd.z);
          this.sound.playCrash(30);
          this.particles.emitSparks(peerPos, 12);
          this.cameraShake = 0.16;
          this.hud.showWorldPopup(`${comboLabels[combo]} ${dmg}`, '#38bdf8');
        }
      }
    }
  }

  private toggleEnterExitCar(): void {
    if (
      this.gameState === GameState.COUNTDOWN ||
      this.gameState === GameState.TIMED_RACE ||
      this.gameState === GameState.FINISHED ||
      this.gameState === GameState.DRIFT_ARENA
    ) return;
    if (this.charCtrl.isDead) {
      this.hud.showNotification('KNOCKED OUT', 'Wait until you are back on your feet.', 1.4);
      return;
    }
    if (this.activities.activeSprint || this.activities.activeCourier) {
      this.hud.showNotification('RUN IN PROGRESS', 'Finish the current run before leaving the car!', 1.6);
      return;
    }

    // Exit / Enter Helicopter first when piloting or standing beside it
    if (this.inHeli) {
      this.exitHelicopter();
      return;
    }

    // On foot, F/E acts on the nearby chair first; press again to drive/fly.
    if (!this.inCar && this.sittingSpot) {
      this.exitSeat(true);
      return;
    }

    if (!this.inCar && this.isNearHelicopter()) {
      this.enterHelicopter();
      return;
    }

    if (this.inCar) {
      if (this.physics.speedKmh > 35) {
        this.hud.showNotification('BRAKE FIRST', 'Slow below 35 km/h to jump out!', 1.2);
        return;
      }
      this.inCar = false;
      this.carMesh.setDriverVisible(false);
      this.parkActiveCar();
      const rgt = this.physics.getRightVector();
      const exitPos = this.physics.position.clone().addScaledVector(rgt, -1.9);
      // Only relocate the character: resetAt() would also restore full HP and
      // clear hit stun, letting players heal instantly by stepping out of a car.
      this.charCtrl.position.copy(exitPos);
      this.charCtrl.velocity.set(0, 0, 0);
      this.charCtrl.yaw = this.physics.rotation.y;
      this.charCtrl.isGrounded = true;
      this.charCtrl.animState = 'IDLE';
      this.footCamYaw = this.physics.rotation.y;
      this.avatarMesh.root.visible = true;
      this.avatarMesh.root.position.copy(this.charCtrl.position);
      this.sound.playCarDoor();
      this.sound.updateTireSkid(0);
      this.hud.setOnFootMode(true, true, this.charCtrl.hp, this.physics.gearboxType);
      this.hud.showNotification('ON FOOT', 'Walk/Run • Fight [J] • Drive [F]', 1.8);
      this.hud.setStealPrompt(null);
      this.setRivalPrompt(null);
    } else {
      const owned = this.findNearestParkedCar(5.0);
      if (owned) {
        this.enterOwnedCar(owned);
        return;
      }

      // Check stopped police cruiser theft!
      const cop = this.police.takeNearestUnit(this.charCtrl.position, 4.4);
      if (cop) {
        this.hijackVehicle(
          cop.physics,
          cop.mesh,
          'Police Cruiser',
          2,
          'POLICE VEHICLE STOLEN',
          { a: cop.lightA, b: cop.lightB, active: true }
        );
        return;
      }

      // Check stopped city traffic cruiser hijacking!
      const trafficIdx = this.cityCruisers.findIndex((c) => {
        if (c.physics.speedKmh > 22) return false;
        return Math.hypot(
          this.charCtrl.position.x - c.physics.position.x,
          this.charCtrl.position.z - c.physics.position.z
        ) < 4.4;
      });
      if (trafficIdx !== -1) {
        const cruiser = this.cityCruisers.splice(trafficIdx, 1)[0];
        const stolen = cruiser.detachForTheft();
        this.hijackVehicle(stolen.physics, stolen.mesh, `${stolen.name}'s Coupe`, 1, 'VEHICLE HIJACKED');
        return;
      }

      const civic = this.findNearestCivicCar(4.2);
      if (civic) {
        this.stealCar(civic);
        return;
      }

      this.hud.showNotification('NO VEHICLE IN REACH', 'Walk up to your car, traffic, or the Zenith Helicopter.', 1.6);
    }
  }

  private isNearHelicopter(): boolean {
    const p = this.charCtrl.position;
    const h = this.heliPhysics.position;
    return Math.hypot(p.x - h.x, p.z - h.z) < 5.8 && Math.abs(p.y - h.y) < 3.6;
  }

  private enterHelicopter(): void {
    this.sound.init();
    this.sound.playCarDoor();
    this.inHeli = true;
    this.inCar = false;
    this.exitSeat(false);
    this.avatarMesh.root.visible = false;
    this.carMesh.setDriverVisible(false);
    this.hud.setStealPrompt(null);
    this.setRivalPrompt(null);
    this.setCourierPrompt(null);
    this.hud.setHelicopterMode(true, this.physics.gearboxType);
    this.hud.showNotification(
      'APEX SKYHAWK',
      'Space/UP: Climb • Shift/DOWN: Descend • WASD: Fly • H: Searchlight',
      3.4
    );
  }

  /** Clear helicopter state without moving the player (used by race/bust/spawn transitions). */
  private resetHelicopterState(): void {
    if (!this.inHeli) return;
    this.inHeli = false;
    this.sound.updateHelicopterSound(false, 0, 0);
    this.hud.setHelicopterMode(false, this.physics.gearboxType);
  }

  private exitHelicopter(): void {
    this.sound.playCarDoor();
    this.resetHelicopterState();
    const rgt = this.heliPhysics.getRightVector();
    const exitPos = this.heliPhysics.position.clone().addScaledVector(rgt, -2.8);
    this.charCtrl.position.copy(exitPos);
    this.charCtrl.velocity.set(0, 0, 0);
    this.charCtrl.yaw = this.heliPhysics.yaw;
    this.footCamYaw = this.heliPhysics.yaw;
    const isBailout = this.heliPhysics.agl > 8.0;
    this.charCtrl.isGrounded = !isBailout;
    this.charCtrl.isGliding = isBailout;
    this.charCtrl.animState = isBailout ? 'JUMP' : 'IDLE';
    this.avatarMesh.root.visible = true;
    this.avatarMesh.root.position.copy(this.charCtrl.position);
    this.hud.setOnFootMode(true, false, this.charCtrl.hp, this.physics.gearboxType);
    this.hud.showNotification(
      isBailout ? 'SKY BAILOUT!' : 'ON FOOT',
      isBailout ? 'Parachute glide engaged — steer cleanly!' : 'Landed safely. Press [F] to re-board.',
      2.2
    );
  }

  /** Keeps a reference to the car you just left so you can re-enter it later. */
  private parkActiveCar(): void {
    if (this.parkedCars.some((p) => p.physics === this.physics)) return;
    this.parkedCars.push({
      physics: this.physics,
      mesh: this.carMesh,
      name: this.activeCarName,
      policeLights: this.activePoliceLights
    });
  }

  private findNearestParkedCar(radius: number): VehicleEntry | null {
    let best: VehicleEntry | null = null;
    let bestDist = radius;
    for (const entry of this.parkedCars) {
      const d = Math.hypot(
        this.charCtrl.position.x - entry.physics.position.x,
        this.charCtrl.position.z - entry.physics.position.z
      );
      if (d < bestDist) {
        bestDist = d;
        best = entry;
      }
    }
    return best;
  }

  private findNearestCivicCar(radius: number): VehicleEntry | null {
    let best: VehicleEntry | null = null;
    let bestDist = radius;
    for (const entry of this.civicCars) {
      const d = Math.hypot(
        this.charCtrl.position.x - entry.physics.position.x,
        this.charCtrl.position.z - entry.physics.position.z
      );
      if (d < bestDist) {
        bestDist = d;
        best = entry;
      }
    }
    return best;
  }

  private enterOwnedCar(entry: VehicleEntry): void {
    this.inCar = true;
    this.parkedCars = this.parkedCars.filter((p) => p !== entry);
    this.physics = entry.physics;
    this.carMesh = entry.mesh;
    this.carMesh.setDriverVisible(true);
    this.activeCarName = entry.name;
    this.activePoliceLights = entry.policeLights;
    this.configureActiveCar();
    this.avatarMesh.root.visible = false;
    const interactPrompt = document.getElementById('interact-prompt');
    if (interactPrompt) interactPrompt.style.display = 'none';
    this.sound.playCarDoor();
    this.hud.setOnFootMode(false, true, this.charCtrl.hp, this.physics.gearboxType);
    this.hud.setStealPrompt(null);
    if (this.gameState === GameState.OPEN_WORLD) {
      this.hud.showNotification('DRIVING', `${entry.name} • Drive to Green Gate on Track to Race!`, 1.6);
    }
    this.setRivalPrompt(this.nearbyRival);
  }

  private hijackVehicle(
    physics: CarPhysics,
    mesh: CarMesh,
    label: string,
    directHeat: number,
    crimeReason: string,
    policeLights?: { a: THREE.Mesh; b: THREE.Mesh; active: boolean }
  ): void {
    this.sound.init();
    this.parkActiveCar();
    this.inCar = true;
    this.physics = physics;
    this.carMesh = mesh;
    this.carMesh.setDriverVisible(true);
    this.activeCarName = label;
    this.activePoliceLights = policeLights;
    this.configureActiveCar();
    this.avatarMesh.root.visible = false;
    this.save.data.carsStolen++;
    this.save.scheduleSave();
    this.sound.playCarDoor();
    this.sound.playGearShift();
    const witnessed = this.pedestrians.notifyCrime(physics.position, crimeReason, 32);
    this.pedestrians.alertDanger(physics.position, 22);
    this.police.addHeat(witnessed ? directHeat + 1 : directHeat, crimeReason, physics.position);
    this.hud.setStealPrompt(null);
    this.hud.setOnFootMode(false, true, this.charCtrl.hp, this.physics.gearboxType);
    this.hud.showNotification(
      crimeReason,
      policeLights ? `${label} stolen — press Horn [H] to toggle strobes!` : `${label} is yours — lose the heat!`,
      2.6
    );
    this.setRivalPrompt(null);
    this.setCourierPrompt(null);
  }

  private stealCar(civic: VehicleEntry): void {
    this.sound.init();
    this.parkActiveCar();
    this.civicCars = this.civicCars.filter((c) => c !== civic);

    this.inCar = true;
    this.physics = civic.physics;
    this.carMesh = civic.mesh;
    this.carMesh.setDriverVisible(true);
    this.activeCarName = `${civic.name}'s Ride`;
    this.activePoliceLights = undefined;
    this.configureActiveCar();
    this.avatarMesh.root.visible = false;

    this.save.data.carsStolen++;
    this.save.scheduleSave();
    this.sound.playCarDoor();
    this.sound.playGearShift();
    this.sound.playBeep(460, 0.22);

    const witnessed = this.pedestrians.notifyCrime(civic.physics.position, 'GRAND THEFT AUTO', 30);
    if (!witnessed) {
      // Unwitnessed theft still risks a car alarm, but rewards stealth!
      this.police.addHeat(1, 'CAR ALARM TRIGGERED', civic.physics.position);
    }
    this.pedestrians.alertDanger(civic.physics.position, 18);

    this.hud.setStealPrompt(null);
    this.hud.setOnFootMode(false, true, this.charCtrl.hp, this.physics.gearboxType);
    this.hud.showNotification(
      witnessed ? 'WITNESSED THEFT!' : 'VEHICLE STOLEN',
      witnessed
        ? `Pedestrian spotted you stealing ${civic.name}'s car!`
        : `${civic.name}'s car hotwired — lose the police to keep it.`,
      3.0
    );
    this.setRivalPrompt(null);

    // Respawn a fresh replacement at the exact original home spot & color after 90s.
    if (civic.spawnSpec) {
      const home = civic.spawnSpec;
      window.setTimeout(() => {
        const occupied = this.civicCars.some(
          (c) => Math.hypot(c.physics.position.x - home.x, c.physics.position.z - home.z) < 4
        );
        if (!occupied) {
          this.createCivicCar(home);
        }
      }, 90_000);
    }
  }

  /** Re-applies the player-car callbacks and preferences after swapping into a different chassis. */
  private configureActiveCar(): void {
    this.physics.enforceTrackWalls = false;
    this.physics.gearboxType = this.save.data.gearbox;
    this.physics.assistMode = this.save.data.assistMode;
    this.physics.weatherGripMultiplier = this.weather.gripMultiplier;
    this.physics.onAirLanding = (airSec) => {
      if (airSec > 0.8) {
        this.particles.emitSparks(this.physics.position, Math.min(40, Math.round(airSec * 20)));
        this.hud.showNotification('AIRTIME!', `${airSec.toFixed(1)}s hang time`, 1.4);
        this.award(Math.round(airSec * 30), Math.round(airSec * 20));
      }
      if (airSec > this.save.data.maxAirTime) {
        this.save.data.maxAirTime = Number(airSec.toFixed(2));
        this.save.scheduleSave();
      }
    };
    this.physics.onWallCollision = (impactKmh) => {
      this.sound.playCrash(impactKmh);
      this.particles.emitSparks(this.physics.position, 14);
      this.cameraShake = Math.min(0.42, impactKmh / 140);
      this.lapManager.handleDriftCrash(impactKmh);
    };
    this.carMesh.setHeadlights(this.timeOfDay !== 'DAY');
    this.hud.updateTouchVisibility(this.physics.gearboxType);
  }

  private handleBusted(fine: number, heat: number): void {
    this.activities.cancelSprint();
    this.activities.cancelCourier();
    this.activities.resetTransientState();
    this.setRivalPrompt(null);
    this.setCourierPrompt(null);
    const paid = this.save.spendCredits(fine);
    this.save.data.timesBusted++;
    this.save.scheduleSave();
    this.koReason = 'BUSTED';
    this.resetHelicopterState();
    this.inCar = false;
    this.exitSeat(false);
    this.avatarMesh.root.visible = true;
    this.avatarMesh.root.rotation.x = 0;

    const release = new THREE.Vector3(48, 0, 34);
    this.charCtrl.respawnPoint = release;
    this.charCtrl.revive(release);
    this.avatarMesh.root.position.copy(release);
    this.footCamYaw = Math.PI;
    this.hud.hideKoOverlay();
    this.hud.showKoOverlay(
      'BUSTED',
      `Wanted level ${heat} • Fine ₡${paid.toLocaleString()} • Released at the plaza`,
      '#38bdf8'
    );
    this.sound.playBeep(200, 0.4);
    window.setTimeout(() => {
      if (this.koReason === 'BUSTED') {
        this.hud.hideKoOverlay();
        this.koReason = null;
      }
    }, 2800);
    this.hud.showNotification('BUSTED', `You paid ₡${paid.toLocaleString()} and lost the cops.`, 3.0);
    this.hud.setWanted(0);
    this.hud.setStealPrompt(null);
    this.charCtrl.respawnPoint = new THREE.Vector3(13.8, 0, 24.5);
  }

  private setupLighting(): void {
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.26);
    this.scene.add(this.ambientLight);

    const isCoarseTouch = window.matchMedia?.('(pointer: coarse)')?.matches ?? false;
    const shadowRes = isCoarseTouch ? 1024 : 2048;
    this.sunLight = new THREE.DirectionalLight(0xfffbeb, 2.15);
    this.sunLight.position.set(80, 140, 60);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = shadowRes;
    this.sunLight.shadow.mapSize.height = shadowRes;
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 340;

    const shadowDist = isCoarseTouch ? 48 : 55;
    this.sunLight.shadow.camera.left = -shadowDist;
    this.sunLight.shadow.camera.right = shadowDist;
    this.sunLight.shadow.camera.top = shadowDist;
    this.sunLight.shadow.camera.bottom = -shadowDist;
    this.sunLight.shadow.bias = -0.0004;

    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    this.hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x166534, 0.52);
    this.scene.add(this.hemiLight);
  }

  private syncVehicleHeadlights(): void {
    const on = this.timeOfDay !== 'DAY';
    this.carMesh.setHeadlights(on);
    this.police.setHeadlights(on);
    this.activities.headlightsOn = on;
    for (const bot of this.raceBots) bot.mesh.setHeadlights(on);
    for (const c of this.cityCruisers) c.mesh.setHeadlights(on);
    if (this.activities.activeSprint) this.activities.activeSprint.rivalMesh.setHeadlights(on);
  }

  private setAtmosphere(tod: TimeOfDay): void {
    this.timeOfDay = tod;
    this.track.setTimeOfDay(tod);
    this.openWorld.setTimeOfDay(tod);
    this.syncVehicleHeadlights();

    if (tod === 'SUNSET') {
      this.scene.fog = new THREE.FogExp2(0xfb923c, 0.0014);
      this.sunLight.color.setHex(0xfdba74);
      this.sunLight.intensity = 1.85;
      this.ambientLight.intensity = 0.22;
      this.hemiLight.color.setHex(0xfed7aa);
      this.hemiLight.groundColor.setHex(0x1e1b4b);
      this.hemiLight.intensity = 0.44;
      this.renderer.toneMappingExposure = 1.1;
    } else if (tod === 'NIGHT') {
      this.scene.fog = new THREE.FogExp2(0x090d16, 0.0018);
      this.sunLight.color.setHex(0x93c5fd);
      this.sunLight.intensity = 0.78;
      this.ambientLight.intensity = 0.16;
      this.hemiLight.color.setHex(0x38bdf8);
      this.hemiLight.groundColor.setHex(0x090d16);
      this.hemiLight.intensity = 0.38;
      this.renderer.toneMappingExposure = 1.22;
    } else {
      this.scene.fog = new THREE.FogExp2(0x93c5fd, 0.0011);
      this.sunLight.color.setHex(0xfffbeb);
      this.sunLight.intensity = 2.15;
      this.ambientLight.intensity = 0.26;
      this.hemiLight.color.setHex(0xdbeafe);
      this.hemiLight.groundColor.setHex(0x166534);
      this.hemiLight.intensity = 0.52;
      this.renderer.toneMappingExposure = 1.06;
    }

    if (tod === 'NIGHT') this.sunDirection.set(-0.4, 0.42, -0.82).normalize();
    else if (tod === 'SUNSET') this.sunDirection.set(0.55, 0.14, -0.82).normalize();
    else this.sunDirection.set(0.42, 0.48, -0.77).normalize();

    this.baseAmbientIntensity = this.ambientLight.intensity;
    this.baseHemiIntensity = this.hemiLight.intensity;
    this.baseSunIntensity = this.sunLight.intensity;

    // Outdoor sky reflection probe so car metallic paint reflects sky & horizon naturally
    const envScene = new THREE.Scene();
    const skyColors = tod === 'NIGHT'
      ? [0x020617, 0x0f172a, 0x1e293b]
      : (tod === 'SUNSET' ? [0x312e81, 0xf97316, 0xfde047] : [0x1d4ed8, 0x60a5fa, 0xe0f2fe]);
    const domeGeo = new THREE.SphereGeometry(20, 16, 12);
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, '#' + skyColors[0].toString(16).padStart(6, '0'));
    grad.addColorStop(0.55, '#' + skyColors[1].toString(16).padStart(6, '0'));
    grad.addColorStop(1, '#' + skyColors[2].toString(16).padStart(6, '0'));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 4, 64);
    const tex = new THREE.CanvasTexture(canvas);
    const envMat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide });
    envScene.add(new THREE.Mesh(domeGeo, envMat));

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    if (this.envRT) this.envRT.dispose();
    this.envRT = pmrem.fromScene(envScene, 0.04);
    this.scene.environment = this.envRT.texture;
    pmrem.dispose();
    envMat.dispose();
    tex.dispose();
    domeGeo.dispose();

    const todLabel = tod === 'DAY' ? 'Day' : (tod === 'SUNSET' ? 'Sunset' : 'Night');
    const todNameEl = document.getElementById('tod-name');
    if (todNameEl) todNameEl.textContent = todLabel;
    this.syncOptionSelection('.tod-options .option-btn', 'data-tod', tod);

    // Night-mode: boost underglow on all cars + apply CSS bloom to canvas
    const isNight = tod === 'NIGHT';
    this.carMesh.setNightMode(isNight);
    for (const bot of this.raceBots) bot.mesh.setNightMode(isNight);
    for (const c of this.cityCruisers) c.mesh.setNightMode(isNight);
    const rc = document.getElementById('render-canvas');
    if (rc) {
      if (isNight) {
        rc.style.filter = 'brightness(1.04) contrast(1.06) saturate(1.14)';
      } else if (tod === 'SUNSET') {
        rc.style.filter = 'brightness(1.02) contrast(1.03) saturate(1.08)';
      } else {
        rc.style.filter = '';
      }
    }
  }

  private spawnCityCruisers(): void {
    const outerLoop = [
      new THREE.Vector3(46, 0, -160),
      new THREE.Vector3(224, 0, -160),
      new THREE.Vector3(224, 0, 150),
      new THREE.Vector3(46, 0, 150)
    ];
    const plazaLoop = [
      new THREE.Vector3(46, 0, -40),
      new THREE.Vector3(122, 0, -40),
      new THREE.Vector3(122, 0, 30),
      new THREE.Vector3(46, 0, 30)
    ];
    this.cityCruisers.push(
      new CityCruiserBot('city_1', 'Haruto', '#38bdf8', outerLoop, 0, this.openWorld, this.track, this.scene),
      new CityCruiserBot('city_2', 'Mei', '#ec4899', outerLoop, 2, this.openWorld, this.track, this.scene),
      new CityCruiserBot('city_3', 'Daichi', '#22c55e', plazaLoop, 1, this.openWorld, this.track, this.scene)
    );
    for (const c of this.cityCruisers) c.mesh.setHeadlights(this.timeOfDay !== 'DAY');
  }

  /** Parked civilian cars: varied specs & archetypes you can hotwire on foot. */
  private spawnCivicCars(): void {
    const specs: CivicSpawnSpec[] = [
      { x: 24, z: 34, heading: -1.2, color: '#0ea5e9', name: 'Aiko', archetype: 'TOUGE' },
      { x: 50.5, z: 62, heading: 0, color: '#f97316', name: 'Takeda', archetype: 'DRIFT' },
      { x: 50.5, z: 108, heading: Math.PI, color: '#22c55e', name: 'Rin', archetype: 'TOUGE' },
      { x: 118, z: 2, heading: Math.PI * 0.5, color: '#e11d48', name: 'Jiro', archetype: 'HYPER' },
      { x: 50.5, z: -72, heading: 0, color: '#a855f7', name: 'Nao', archetype: 'DRIFT' },
      { x: 170, z: -157, heading: Math.PI * 0.5, color: '#facc15', name: 'Ken', archetype: 'HYPER' }
    ];

    for (const spec of specs) {
      this.createCivicCar(spec);
    }
  }

  private createCivicCar(spec: CivicSpawnSpec): void {
    const physics = new CarPhysics();
    physics.enforceTrackWalls = false;
    physics.groundHeightSampler = this.sampleUnifiedGround;
    physics.worldCollider = (pos, vel, rad) => this.openWorld.resolveCollision(pos, vel, rad);
    physics.applyArchetype(spec.archetype);

    const ground = this.sampleUnifiedGround(spec.x, spec.z);
    physics.resetToTrack(new THREE.Vector3(spec.x, ground.height, spec.z), spec.heading);
    // Nudge out of any building collider so the car never spawns inside a wall.
    this.openWorld.resolveCollision(physics.position, new THREE.Vector3(), 1.5);
    physics.position.y = this.sampleUnifiedGround(physics.position.x, physics.position.z).height;
    physics.lastSafePosition.copy(physics.position);
    physics.lastSafeRotation = physics.rotation.y;

    const mesh = new CarMesh();
    mesh.setDriverVisible(false);
    mesh.setColor(spec.color);
    mesh.update(physics, 0, 0.016);
    this.scene.add(mesh.root);

    this.civicCars.push({ physics, mesh, name: spec.name, spawnSpec: spec });
  }

  private updateParkedVehicles(dt: number): void {
    const idleInput = {
      throttle: 0,
      brake: 0,
      steer: 0,
      handbrake: true,
      clutch: false,
      shiftUp: false,
      shiftDown: false,
      reset: false
    };
    for (const c of this.parkedCars) {
      if (c.physics.speedKmh > 0.6 || c.physics.isAirborne) {
        c.physics.update(dt, idleInput, false);
      }
      c.mesh.update(c.physics, 0, dt);
    }
    for (const c of this.civicCars) {
      c.mesh.update(c.physics, 0, dt);
    }
  }

  private handleHornPressed(): void {
    this.sound.init();
    if (this.inHeli) {
      const on = this.heliMesh.toggleSearchlight();
      this.sound.playBeep(on ? 880 : 520, 0.12);
      this.hud.showNotification('SEARCHLIGHT', on ? 'Skyhawk floodlight ON' : 'Skyhawk floodlight OFF', 1.2);
      return;
    }
    this.sound.playHorn();
    const origin = this.inCar ? this.physics.position : this.charCtrl.position;

    if (this.inCar && this.activePoliceLights) {
      this.activePoliceLights.active = !this.activePoliceLights.active;
      this.hud.showNotification(
        'POLICE STROBES',
        this.activePoliceLights.active ? 'Emergency lightbar ON' : 'Emergency lightbar OFF',
        1.1
      );
    }

    for (const c of this.cityCruisers) {
      if (c.physics.position.distanceTo(origin) < 18) {
        c.startFriendlySprint();
        this.sound.playChallengeChime();
        this.hud.showNotification('STREET SPRINT!', `${c.name} accepted your horn challenge!`, 2.0);
        break;
      }
    }
  }

  private spawnRaceBots(cfg: LobbyConfig): void {
    for (const bot of this.raceBots) bot.dispose(this.scene);
    this.raceBots = [];

    if (cfg.room) {
      const botSlots = cfg.room.players.filter(p => p.isBot);
      botSlots.forEach((b, idx) => {
        this.raceBots.push(
          new RaceBot(b.id, b.name, b.carColor, b.botDifficulty || 'PRO', this.track, this.openWorld, idx + 1, this.scene)
        );
      });
    } else {
      this.raceBots.push(
        new RaceBot('bot_1', 'BOT Takumi', '#f8fafc', 'PRO', this.track, this.openWorld, 1, this.scene),
        new RaceBot('bot_2', 'BOT Mika', '#dc2626', 'PRO', this.track, this.openWorld, 2, this.scene),
        new RaceBot('bot_3', 'BOT Ren', '#2563eb', 'CHILL', this.track, this.openWorld, 3, this.scene)
      );
    }
    for (const bot of this.raceBots) bot.mesh.setHeadlights(this.timeOfDay !== 'DAY');
  }

  private handleLapRecorded(lapTime: number, isNewBest: boolean): void {
    if (this.save.data.bestLapTime === null || lapTime < this.save.data.bestLapTime) {
      this.save.data.bestLapTime = lapTime;
      this.save.scheduleSave();
    }

    if (isNewBest) {
      const frames = this.ghost.commitBestLap();
      if (frames && frames.length > 10) {
        this.save.data.bestLapGhost = frames;
        this.save.saveNow();
        this.hud.showNotification('GHOST SAVED', 'Your best lap is now racing with you', 2.2);
      }
      this.award(200, 250);
    }

    this.ghost.startRecording();
    this.refreshProfile();
  }

  private award(xp: number, credits: number): void {
    if (xp <= 0 && credits <= 0) return;
    const newRank = this.save.grantReward(xp, credits);
    if (newRank) {
      this.sound.playRankUpFanfare();
      this.hud.showNotification(`RANK UP: ${newRank.title}`, `${newRank.jpTitle} • LV.${newRank.level}`, 3.2);
    }
    this.refreshProfile();
  }

  private refreshProfile(): void {
    const rank = this.save.getRank();
    const next = this.save.getNextRank();
    const span = next ? Math.max(1, next.minXp - rank.minXp) : 1;
    const progress = next ? (this.save.data.legendXp - rank.minXp) / span : 1;
    this.hud.setProfile(
      rank.title,
      rank.level,
      rank.color,
      this.save.data.legendXp,
      Math.max(0, Math.min(1, progress)),
      this.save.data.credits
    );
  }

  private syncSavedSettings(): void {
    this.syncOptionSelection('.weather-options .option-btn', 'data-weather', this.weather.mode);
    this.syncOptionSelection('.ghost-options .option-btn', 'data-ghost', this.ghostReplayEnabled ? 'ON' : 'OFF');
    this.syncOptionSelection('.music-options .option-btn', 'data-music', this.sound.isMusicEnabled ? 'ON' : 'OFF');
    this.syncOptionSelection('.assist-options .option-btn', 'data-assist', this.physics.assistMode);
    this.syncOptionSelection('.archetype-options .option-btn', 'data-arch', this.save.data.carArchetype);
    this.syncOptionSelection('.quality-options .option-btn', 'data-quality', this.save.data.graphicsQuality);
    this.syncOptionSelection('.gearbox-options .option-btn', 'data-gearbox', this.physics.gearboxType);
    this.syncOptionSelection('.tod-options .option-btn', 'data-tod', this.timeOfDay);
    this.syncOptionSelection('.cam-options .option-btn', 'data-cam', this.cameraView);
  }

  /** Apply every persisted setting to live systems after startup or a save import. */
  private applySavedRuntimeSettings(): void {
    const d = this.save.data;
    if (this.sound.isMusicEnabled !== d.musicEnabled) this.sound.toggleMusic();
    this.weather.setMode(d.weatherMode);
    const wet = d.weatherMode !== 'CLEAR';
    this.track.setWetSurface(wet);
    this.openWorld.setWetSurface(wet);
    this.physics.weatherGripMultiplier = this.weather.gripMultiplier;

    this.ghostReplayEnabled = d.ghostReplayEnabled;
    this.ghost.loadFrames(d.bestLapGhost);

    this.ownZenvo.physics.gearboxType = d.gearbox;
    this.physics.gearboxType = d.gearbox;
    this.ownZenvo.physics.assistMode = d.assistMode;
    this.physics.assistMode = d.assistMode;
    this.ownZenvo.physics.applyArchetype(d.carArchetype);
    this.physics.applyArchetype(d.carArchetype);
    this.physics.applyTuning(d.engineStage, d.nitroStage);
    this.hud.updateTouchVisibility(d.gearbox);

    this.setAtmosphere(d.atmospherePref === 'AUTO' ? 'SUNSET' : d.atmospherePref);
    this.applyGraphicsQuality(d.graphicsQuality);
    this.ownZenvo.mesh.setColor(d.carColor);

    this.lobbyUI.config.playerName = d.playerName;
    this.lobbyUI.config.characterId = d.characterId;
    this.lobbyUI.config.carColor = d.carColor;
    this.lobbyUI.config.gearbox = d.gearbox;
    const nameInput = document.getElementById('input-player-name') as HTMLInputElement | null;
    if (nameInput) nameInput.value = d.playerName;
    this.refreshProfile();
    this.syncSavedSettings();
  }

  private applyGraphicsQuality(q: GraphicsQuality): void {
    const dpr = window.devicePixelRatio || 1;
    if (q === 'LOW') {
      this.qualityRatioCap = Math.min(dpr, 1.0);
      this.renderer.shadowMap.enabled = false;
      this.sunLight.castShadow = false;
    } else if (q === 'MED') {
      this.qualityRatioCap = Math.min(dpr, 1.35);
      this.renderer.shadowMap.enabled = true;
      this.sunLight.castShadow = true;
      if (this.sunLight.shadow.mapSize.width !== 1024) {
        this.sunLight.shadow.mapSize.set(1024, 1024);
        this.sunLight.shadow.map?.dispose();
        this.sunLight.shadow.map = null;
      }
    } else {
      this.qualityRatioCap = Math.min(dpr, 2.0);
      this.renderer.shadowMap.enabled = true;
      this.sunLight.castShadow = true;
      if (this.sunLight.shadow.mapSize.width !== 2048) {
        this.sunLight.shadow.mapSize.set(2048, 2048);
        this.sunLight.shadow.map?.dispose();
        this.sunLight.shadow.map = null;
      }
    }
    this.renderer.setPixelRatio(this.qualityRatioCap);
    // Let the governor trade a little sharpness for a stable frame rate, but
    // never drop below a still-legible floor on high-density phone screens.
    this.adaptiveRes.setBounds(
      Math.min(0.85, this.qualityRatioCap),
      this.qualityRatioCap,
      this.qualityRatioCap
    );
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.syncOptionSelection('.quality-options .option-btn', 'data-quality', q);
  }

  /** One decision per rendered frame; returns true when the pixel ratio changed. */
  private updateAdaptiveResolution(dt: number): void {
    if (this.isPaused || document.hidden) {
      this.adaptiveRes.reset();
      return;
    }
    const next = this.adaptiveRes.sample(dt);
    if (next === null) return;
    this.renderer.setPixelRatio(next);
  }

  private setWeatherMode(mode: WeatherMode): void {
    this.weather.setMode(mode);
    this.save.data.weatherMode = mode;
    this.save.scheduleSave();
    const wet = mode !== 'CLEAR';
    this.track.setWetSurface(wet);
    this.openWorld.setWetSurface(wet);
    this.physics.weatherGripMultiplier = this.weather.gripMultiplier;
    this.syncOptionSelection('.weather-options .option-btn', 'data-weather', mode);
    const label = mode === 'CLEAR'
      ? 'Clear skies — full grip'
      : (mode === 'RAIN' ? 'Wet roads — grip reduced, 1.3× drift score' : 'Storm — low grip, 1.5× drift score');
    this.hud.showNotification(`WEATHER: ${mode}`, label, 2.2);
  }

  private exitSeat(standUp = true): void {
    if (!this.sittingSpot) return;
    if (standUp) {
      const fwd = new THREE.Vector3(-Math.sin(this.charCtrl.yaw), 0, -Math.cos(this.charCtrl.yaw));
      // Don't teleport a seated character 1.1m forward in a single frame. The
      // offset is applied gradually, in sync with the rig's stand-up clip.
      this.standScootTotal.copy(fwd).multiplyScalar(1.1);
      this.standScootApplied = 0;
      this.charCtrl.velocity.set(0, 0, 0);
    } else {
      this.standScootTotal.set(0, 0, 0);
      this.standScootApplied = 1;
    }
    this.sittingSpot = null;
    if (this.avatarMesh instanceof GLTFCharacterMesh) this.avatarMesh.setSitting(false);
    if (this.interactPromptEl) this.interactPromptEl.style.display = 'none';
  }

  private sitRootFor(spot: { pos: THREE.Vector3; yaw: number }): THREE.Vector3 {
    if (this.avatarMesh instanceof GLTFCharacterMesh) return this.avatarMesh.sitRootPosition(spot);
    // Procedural fallback has no native sit pose; keep it close to the seat.
    return spot.pos.clone().setY(spot.pos.y - 0.55);
  }

  private nearbySitSpot(): { pos: THREE.Vector3; yaw: number; label: string } | null {
    let best: { pos: THREE.Vector3; yaw: number; label: string } | null = null;
    let bestDist = 1.9;
    for (const spot of this.openWorld.sitSpots) {
      const d = this.charCtrl.position.distanceTo(spot.pos);
      if (d < bestDist) {
        best = spot;
        bestDist = d;
      }
    }
    return best;
  }

  private nearbyInteractable(): WorldInteractable | null {
    let best: WorldInteractable | null = null;
    let bestDist = Infinity;
    const p = this.charCtrl.position;
    for (const item of this.openWorld.interactables) {
      if (Math.abs(item.y - p.y) > 3.2) continue;
      const d = Math.hypot(item.x - p.x, item.z - p.z);
      if (d <= item.radius && d < bestDist) {
        best = item;
        bestDist = d;
      }
    }
    return best;
  }

  private handleInteractableUse(item: WorldInteractable): void {
    const cd = this.interactCooldowns.get(item.id) ?? 0;
    if (cd > 0) {
      this.hud.showNotification('RECHARGING', `${item.title} ready in ${Math.ceil(cd)}s`, 1.4);
      return;
    }

    switch (item.type) {
      case 'ELEVATOR_UP':
        this.sound.playDiscoveryChime();
        this.charCtrl.position.set(item.x, 50.0, item.z - 1.5);
        this.charCtrl.velocity.set(0, 0, 0);
        this.charCtrl.isGrounded = true;
        this.footCamYaw = Math.PI * 0.25;
        this.hud.showWorldPopup('50M SKY ROOFTOP', '#22d3ee');
        this.hud.showNotification('ZENITH ROOFTOP', 'Helipad, Data Vault & Sky-Launch Basejump!', 2.4);
        break;

      case 'ELEVATOR_DOWN':
        this.sound.playDiscoveryChime();
        this.charCtrl.position.set(item.x, 0.22, item.z - 1.5);
        this.charCtrl.velocity.set(0, 0, 0);
        this.charCtrl.isGrounded = true;
        this.hud.showWorldPopup('STREET LOBBY', '#facc15');
        break;

      case 'GARAGE_TUNE':
        this.ownZenvo.physics.nitro = 100;
        this.physics.nitro = 100;
        this.sound.playDiscoveryChime();
        this.hud.showWorldPopup('NITRO 100% & TUNED', '#38bdf8');
        this.garage.open();
        break;

      case 'EAT_RAMEN':
        this.interactCooldowns.set(item.id, 18);
        this.charCtrl.hp = this.charCtrl.maxHp;
        this.charCtrl.stamina = this.charCtrl.maxStamina;
        this.charCtrl.speedBuffTimer = Math.max(this.charCtrl.speedBuffTimer, 45);
        this.charCtrl.powerBuffTimer = Math.max(this.charCtrl.powerBuffTimer, 45);
        this.sound.playDiscoveryChime();
        this.hud.showWorldPopup('TONKOTSU BUFF 45s!', '#facc15');
        this.hud.showNotification('SPICY NEO RAMEN', 'Full HP + 45s Super Speed & +50% Punch Power!', 2.6);
        break;

      case 'ESPRESSO':
        this.interactCooldowns.set(item.id, 15);
        this.charCtrl.hp = Math.min(this.charCtrl.maxHp, this.charCtrl.hp + 50);
        this.charCtrl.stamina = this.charCtrl.maxStamina;
        this.charCtrl.speedBuffTimer = Math.max(this.charCtrl.speedBuffTimer, 30);
        this.sound.playChallengeChime();
        this.hud.showWorldPopup('+50 HP • SPEED 30s', '#4ade80');
        this.hud.showNotification('MATCHA ESPRESSO', '+50 HP & 30s Sprint Boost!', 2.2);
        break;

      case 'VENDING':
        this.interactCooldowns.set(item.id, 12);
        this.charCtrl.hp = Math.min(this.charCtrl.maxHp, this.charCtrl.hp + 30);
        this.charCtrl.stamina = this.charCtrl.maxStamina;
        this.charCtrl.speedBuffTimer = Math.max(this.charCtrl.speedBuffTimer, 20);
        this.sound.playBeep(920, 0.14);
        this.hud.showWorldPopup('NEON FIZZ +30 HP', '#22d3ee');
        break;

      case 'ARCADE':
        this.interactCooldowns.set(item.id, 25);
        this.sound.playRankUpFanfare();
        this.award(60, 120);
        this.hud.showWorldPopup('HIGH SCORE +₡120!', '#ec4899');
        this.hud.showNotification('NEON VELO ARCADE', 'New cabinet record! +₡120 & +60 XP', 2.4);
        break;

      case 'HACK_TERMINAL':
        this.interactCooldowns.set(item.id, 45);
        this.sound.playRankUpFanfare();
        this.particles.emitSparks(this.charCtrl.position, 18);
        this.award(180, 650);
        this.police.addHeat(1, 'ZENITH VAULT BREACH', this.charCtrl.position);
        this.hud.showWorldPopup('VAULT +₡650!', '#22d3ee');
        this.hud.showNotification('ZENITH VAULT HACKED', '+₡650 & +180 XP • Watch out for Police!', 2.8);
        break;

      case 'ROOFTOP_GLIDE':
        this.sound.playPunchWhoosh();
        this.charCtrl.position.set(item.x - 2.5, 51.0, item.z);
        this.charCtrl.yaw = Math.PI * 0.5;
        this.charCtrl.isGrounded = false;
        this.charCtrl.isGliding = true;
        this.charCtrl.velocity.set(-22, 6.2, 0);
        this.hud.showWorldPopup('SKY-LAUNCH!!', '#38bdf8');
        this.hud.showNotification('BASEJUMP GLIDE', 'Steer smoothly in mid-air over Neo Velo!', 2.4);
        break;
    }
  }

  private setRivalPrompt(rival: RivalSprintDef | null): void {
    this.nearbyRival = rival;
    const el = document.getElementById('rival-prompt');
    if (!el) return;
    if (!rival || !this.inCar || this.gameState !== GameState.OPEN_WORLD) {
      el.style.display = 'none';
      return;
    }
    const unlocked = this.save.getRank().level >= rival.minRank;
    const nameEl = document.getElementById('rival-prompt-name');
    const subEl = document.getElementById('rival-prompt-sub');
    if (nameEl) nameEl.textContent = rival.rivalName.toUpperCase();
    if (subEl) {
      subEl.textContent = unlocked
        ? `1v1 Sprint • ${rival.rewardCredits.toLocaleString()}₡ reward`
        : `Locked — Legend Rank ${rival.minRank} required`;
    }
    const btn = document.getElementById('btn-start-rival') as HTMLButtonElement | null;
    if (btn) {
      btn.disabled = !unlocked;
      btn.style.opacity = unlocked ? '1' : '0.62';
      btn.setAttribute('aria-disabled', String(!unlocked));
      btn.title = unlocked ? 'Start 1v1 sprint' : `Requires Legend Rank ${rival.minRank}`;
    }
    // Portal triggers overlap: show only one prompt at a time (rival wins).
    document.getElementById('courier-prompt')!.style.display = 'none';
    el.style.display = 'flex';
  }

  private startNearbyRival(): void {
    const rival = this.nearbyRival;
    if (!rival || this.activities.activeCourier) return;
    if (!this.inCar) {
      this.hud.showNotification('GET IN YOUR CAR', 'You need your Zenvo to challenge a rival', 2.0);
      return;
    }
    if (this.gameState !== GameState.OPEN_WORLD) return;
    if (this.save.getRank().level < rival.minRank) {
      this.hud.showNotification('LOCKED', `Reach Legend Rank ${rival.minRank} to challenge ${rival.rivalName}`, 2.4);
      return;
    }
    if (!this.activities.startRivalSprint(rival, this.physics)) return;
    this.setRivalPrompt(null);
    this.setCourierPrompt(null);
    this.lapManager.resetRace(0);
    this.hud.showNotification(
      `${rival.rivalName.toUpperCase()} CHALLENGE`,
      `${rival.tauntStart} Follow the green gate!`,
      4.0
    );
  }

  private setCourierPrompt(contract: CourierContractDef | null): void {
    this.nearbyCourier = contract;
    const el = document.getElementById('courier-prompt');
    if (!el) return;
    if (!contract || !this.inCar || this.gameState !== GameState.OPEN_WORLD) {
      el.style.display = 'none';
      return;
    }
    // Both portals share the same spot; never stack two clickable cards.
    if (document.getElementById('rival-prompt')?.style.display === 'flex') {
      el.style.display = 'none';
      return;
    }
    const nameEl = document.getElementById('courier-prompt-name');
    const subEl = document.getElementById('courier-prompt-sub');
    if (nameEl) nameEl.textContent = contract.title.toUpperCase();
    if (subEl) {
      const best = this.save.data.courierRecords[contract.id];
      subEl.textContent = `${contract.routeDesc} • Gold < ${contract.goldSec}s${best ? ` (Best ${best.toFixed(1)}s)` : ''}`;
    }
    el.style.display = 'flex';
  }

  private startNearbyCourier(): void {
    const c = this.nearbyCourier;
    if (!c || !this.inCar || this.gameState !== GameState.OPEN_WORLD) return;
    if (!this.activities.startCourierContract(c)) return;
    this.setCourierPrompt(null);
    this.setRivalPrompt(null);
    this.sound.playBeep(920, 0.16);
    this.hud.showNotification(
      `${c.title.toUpperCase()}`,
      `Reach the AMBER dropoff within ${c.bronzeSec}s (Gold < ${c.goldSec}s)!`,
      3.2
    );
  }

  private finishDriftArenaRun(): void {
    this.gameState = GameState.FINISHED;
    this.physics.enforceTrackWalls = false;
    const stats = this.lapManager.stats;
    const finalScore = Math.round(stats.driftScore + stats.currentDriftPoints);
    stats.driftScore = finalScore;
    stats.currentDriftPoints = 0;

    this.save.data.totalDriftPoints += finalScore;
    if (finalScore > this.save.data.bestDriftCombo) {
      this.save.data.bestDriftCombo = finalScore;
    }
    this.save.scheduleSave();

    const rewardCredits = Math.max(120, Math.min(2500, Math.round(finalScore / 15)));
    const rewardXp = Math.max(100, Math.min(1800, Math.round(finalScore / 20)));
    this.award(rewardXp, rewardCredits);
    this.sound.playRankUpFanfare();

    if (this.lobbyClient.currentRoom) {
      this.lobbyClient.submitModeResult({
        mode: 'DRIFT_ARENA',
        score: finalScore,
        combo: Math.round(this.driftArenaBestCombo)
      });
    }

    const titleEl = document.getElementById('results-title');
    const subEl = document.getElementById('results-subtitle');
    if (titleEl) titleEl.textContent = 'DRIFT ARENA COMPLETE!';
    if (subEl) subEl.textContent = `Harbor Stunt & Drift Arena • Peak Combo x${this.driftArenaBestCombo.toFixed(1)}`;

    document.getElementById('res-total-time')!.textContent = `${this.driftArenaDuration}s`;
    document.getElementById('res-best-lap')!.textContent = `x${this.driftArenaBestCombo.toFixed(1)}`;
    document.getElementById('res-top-speed')!.textContent = `${Math.round(this.physics.topSpeedKmh)} km/h`;
    document.getElementById('res-drift-score')!.textContent = `${finalScore}`;

    const lapListEl = document.getElementById('res-lap-list')!;
    lapListEl.innerHTML = `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.08);"><span>Session Score</span><strong>${finalScore} PTS</strong></div>
      <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.08);"><span>Best Recorded Combo</span><strong>${this.save.data.bestDriftCombo} PTS</strong></div>
      <div style="display:flex;justify-content:space-between;padding:4px 0;"><span>Payout</span><strong>+${rewardCredits} CR / +${rewardXp} XP</strong></div>`;

    const resultsModal = document.getElementById('results-modal')!;
    resultsModal.classList.add('open');
    (document.getElementById('results-close-btn') as HTMLElement | null)?.focus();
    this.syncPause();
  }

  private showRaceResults(stats: LapStats): void {
    this.gameState = GameState.FINISHED;
    this.pendingRaceMode = 'CIRCUIT_RACE';
    this.physics.enforceTrackWalls = false;
    this.ghost.updatePlayback(false, 0);
    this.award(250, 300);

    const titleEl = document.getElementById('results-title');
    const subEl = document.getElementById('results-subtitle');
    if (titleEl) titleEl.textContent = 'RACE COMPLETE!';
    if (subEl) subEl.textContent = 'Zenvo GP Lake Circuit Summary';

    if (this.lobbyClient.currentRoom) {
      this.lobbyClient.submitModeResult({
        mode: 'CIRCUIT_RACE',
        score: Math.max(100, Math.round(100_000 - stats.totalRaceTime * 10)),
        bestTimeMs: stats.bestLapTime ? Math.round(stats.bestLapTime * 1000) : Math.round(stats.totalRaceTime * 1000)
      });
    }

    document.getElementById('res-total-time')!.textContent = this.lapManager.formatTime(stats.totalRaceTime);
    document.getElementById('res-best-lap')!.textContent = stats.bestLapTime
      ? this.lapManager.formatTime(stats.bestLapTime)
      : '--:--.--';
    document.getElementById('res-top-speed')!.textContent = `${Math.round(this.physics.topSpeedKmh)} km/h`;
    document.getElementById('res-drift-score')!.textContent = `${stats.driftScore}`;

    const lapListEl = document.getElementById('res-lap-list')!;
    lapListEl.innerHTML = stats.lapTimes
      .map((t, i) => `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.08);"><span>Lap ${i + 1}</span><strong>${this.lapManager.formatTime(t)}</strong></div>`)
      .join('');

    const resultsModal = document.getElementById('results-modal')!;
    resultsModal.classList.add('open');
    (document.getElementById('results-close-btn') as HTMLElement | null)?.focus();
    this.syncPause();
  }

  private setupUIHandlers(): void {
    const camBtn = document.getElementById('btn-cam')!;
    const camName = document.getElementById('cam-name')!;
    const cycleCam = () => {
      if (this.cameraView === CameraView.CHASE) {
        this.cameraView = CameraView.HOOD;
        camName.textContent = 'Hood';
      } else if (this.cameraView === CameraView.HOOD) {
        this.cameraView = CameraView.ORBIT;
        camName.textContent = 'Orbit';
      } else {
        this.cameraView = CameraView.CHASE;
        camName.textContent = 'Chase';
      }
      this.syncOptionSelection('.cam-options .option-btn', 'data-cam', this.cameraView);
    };
    camBtn.addEventListener('click', cycleCam);

    document.getElementById('btn-hotspot')!.addEventListener('click', () => {
      this.hud.clearAllInputs();
      this.lobbyUI.setVisible(true);
    });

    document.getElementById('btn-studio')?.addEventListener('click', () => {
      this.hud.clearAllInputs();
      this.studio.open(!this.studio.isOpen);
    });

    document.getElementById('btn-tod')?.addEventListener('click', () => {
      const order: TimeOfDay[] = ['DAY', 'SUNSET', 'NIGHT'];
      const next = order[(order.indexOf(this.timeOfDay) + 1) % order.length];
      this.setAtmosphere(next);
      this.save.data.atmospherePref = next;
      this.save.scheduleSave();
    });

    document.getElementById('btn-reset')!.addEventListener('click', () => {
      if (this.inHeli) {
        this.heliPhysics.resetAt(new THREE.Vector3(258, 50.0, -5), 0.35);
        this.hud.showNotification('HELIPAD RESET', 'Returned Apex Skyhawk to Zenith Rooftop.', 1.6);
        return;
      }
      if (this.inCar) {
        this.physics.resetToTrack();
      } else {
        this.charCtrl.resetAt(this.physics.position.clone().add(new THREE.Vector3(-2, 0, 0)), 0);
      }
      this.hud.showNotification('RESET', 'Returned to safe zone', 1.2);
    });

    const soundBtn = document.getElementById('btn-sound')!;
    const soundLabel = document.getElementById('sound-label');
    soundBtn.addEventListener('click', () => {
      const muted = this.sound.toggleMute();
      soundBtn.style.opacity = muted ? '0.45' : '1.0';
      soundBtn.setAttribute('aria-pressed', String(!muted));
      soundBtn.classList.toggle('is-off', muted);
      if (soundLabel) soundLabel.textContent = muted ? '🔇 Muted' : '🔊 Audio';
    });

    document.getElementById('res-again-btn')!.addEventListener('click', () => {
      if (this.pendingRaceMode === 'DRIFT_ARENA') {
        this.startDriftArenaRun(90);
      } else {
        this.startTimedCircuitRace(3);
      }
    });
    const closeResults = () => {
      document.getElementById('results-modal')!.classList.remove('open');
      this.gameState = GameState.OPEN_WORLD;
      this.physics.enforceTrackWalls = false;
      this.lapManager.resetRace(0);
      this.syncPause();
    };
    document.getElementById('res-garage-btn')!.addEventListener('click', closeResults);
    document.getElementById('results-close-btn')?.addEventListener('click', closeResults);
    document.getElementById('results-modal')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeResults();
    });

    const modal = document.getElementById('settings-modal')!;
    const openModal = () => {
      this.hud.clearAllInputs();
      modal.classList.add('open');
      (document.getElementById('modal-close-btn') as HTMLElement | null)?.focus();
      this.syncPause();
    };
    const closeModal = () => {
      modal.classList.remove('open');
      this.syncPause();
    };

    document.getElementById('btn-settings')!.addEventListener('click', openModal);
    document.getElementById('modal-close-btn')!.addEventListener('click', closeModal);
    document.getElementById('modal-resume-btn')!.addEventListener('click', closeModal);
    document.getElementById('btn-export-save')?.addEventListener('click', () => {
      const json = this.save.exportJson();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `apex-zero-save-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.hud.showModalStatus('settings-modal', 'Save backup exported.');
    });

    const importInput = document.getElementById('input-import-save') as HTMLInputElement | null;
    document.getElementById('btn-import-save')?.addEventListener('click', () => importInput?.click());
    importInput?.addEventListener('change', async () => {
      const file = importInput.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const res = this.save.importJson(text);
        if (!res.ok) {
          this.hud.showNotification('IMPORT FAILED', res.error || 'Invalid save file', 2.4);
        } else {
          this.applySavedRuntimeSettings();
          this.hud.showNotification('SAVE RESTORED', 'Profile & progress imported!', 2.4);
        }
      } catch {
        this.hud.showNotification('IMPORT FAILED', 'Could not read selected file', 2.4);
      } finally {
        importInput.value = '';
      }
    });

    document.getElementById('modal-lobby-btn')!.addEventListener('click', () => {
      closeModal();
      this.lobbyUI.setVisible(true);
    });

    window.addEventListener('keydown', (e) => {
      if (this.hud.isTypingChat()) return;
      if (e.repeat && e.key !== 'Tab') return;
      const topModal = Array.from(document.querySelectorAll<HTMLElement>('.modal-backdrop.open')).pop();
      if (e.key === 'Escape') {
        // Escape always closes the topmost surface instead of stacking modals.
        const closers: Record<string, () => void> = {
          'results-modal': closeResults,
          'garage-modal': () => this.garage.close(),
          'settings-modal': closeModal,
          'studio-modal': () => this.studio.open(false)
        };
        if (topModal) (closers[topModal.id] ?? (() => topModal.classList.remove('open')))();
        else if (this.lobbyOpen) this.lobbyUI.setVisible(false);
        else openModal();
        e.preventDefault();
        return;
      }
      if (topModal && e.key === 'Tab') {
        const focusables = Array.from(topModal.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])'
        )).filter((el) => el.offsetParent !== null);
        if (focusables.length) {
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
        return;
      }
      if (this.isPaused || this.lobbyOpen) return;
      if (e.code === 'KeyV') cycleCam();
      if (e.code === 'KeyM') soundBtn.click();
      if (e.code === 'KeyY') this.startNearbyRival();
      if (e.code === 'KeyU') this.startNearbyCourier();
      if (e.code === 'KeyB') this.garage.toggle();
    });

    this.garage = new GarageController({
      save: this.save,
      getPlayerZenvo: () => this.ownZenvo,
      getActiveMesh: () => this.carMesh,
      getHeat: () => this.police.heat,
      clearHeat: () => this.police.clearHeat(false),
      onRefreshProfile: () => this.refreshProfile(),
      onNotify: (title, desc, dur) => {
        // The garage backdrop paints above the HUD, so show feedback inside it.
        const garageOpen = document.getElementById('garage-modal')?.classList.contains('open');
        if (garageOpen) this.hud.showModalStatus('garage-status', `${title} — ${desc}`);
        else this.hud.showNotification(title, desc, dur);
      },
      onPlayBeep: (freq, dur) => this.sound.playBeep(freq, dur),
      onPlaySuccess: () => this.sound.playRankUpFanfare(),
      onPlayChime: () => this.sound.playDiscoveryChime(),
      onPlayDoor: () => this.sound.playCarDoor(),
      onPauseChange: () => this.syncPause(),
      clearAllInputs: () => this.hud.clearAllInputs()
    });

    document.querySelectorAll('.cam-options .option-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cv = btn.getAttribute('data-cam') as CameraView;
        this.cameraView = cv;
        camName.textContent = cv === CameraView.CHASE ? 'Chase' : (cv === CameraView.HOOD ? 'Hood' : 'Orbit');
        this.syncOptionSelection('.cam-options .option-btn', 'data-cam', cv);
      });
    });

    document.querySelectorAll('.touch-mode-options .option-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.getAttribute('data-touch') as TouchMode;
        this.hud.touchMode = mode;
        this.hud.updateTouchVisibility(this.physics.gearboxType);
        this.syncOptionSelection('.touch-mode-options .option-btn', 'data-touch', mode);
      });
    });

    document.querySelectorAll('.tod-options .option-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tod = btn.getAttribute('data-tod') as TimeOfDay;
        this.setAtmosphere(tod);
        this.save.data.atmospherePref = tod;
        this.save.scheduleSave();
      });
    });

    document.querySelectorAll('.weather-options .option-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.getAttribute('data-weather') as WeatherMode;
        this.setWeatherMode(mode);
      });
    });

    document.querySelectorAll('.ghost-options .option-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const on = btn.getAttribute('data-ghost') === 'ON';
        this.ghostReplayEnabled = on;
        this.save.data.ghostReplayEnabled = on;
        this.save.scheduleSave();
        this.syncOptionSelection('.ghost-options .option-btn', 'data-ghost', on ? 'ON' : 'OFF');
        this.hud.showModalStatus('settings-status', on ? 'BEST-LAP GHOST • enabled' : 'BEST-LAP GHOST • disabled');
      });
    });

    document.querySelectorAll('.music-options .option-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const on = btn.getAttribute('data-music') === 'ON';
        this.sound.init();
        if (this.sound.isMusicEnabled !== on) this.sound.toggleMusic();
        this.save.data.musicEnabled = on;
        this.save.scheduleSave();
        this.syncOptionSelection('.music-options .option-btn', 'data-music', on ? 'ON' : 'OFF');
        this.hud.showModalStatus('settings-status', on ? 'EUROBEAT • music on' : 'EUROBEAT • music off');
      });
    });

    document.getElementById('btn-start-rival')?.addEventListener('click', () => this.startNearbyRival());
    document.getElementById('btn-start-courier')?.addEventListener('click', () => this.startNearbyCourier());

    document.querySelectorAll('.assist-options .option-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const assist = btn.getAttribute('data-assist') as 'ARCADE' | 'PRO';
        this.ownZenvo.physics.assistMode = assist;
        this.physics.assistMode = assist;
        this.save.data.assistMode = assist;
        this.save.scheduleSave();
        this.syncOptionSelection('.assist-options .option-btn', 'data-assist', assist);
      });
    });

    document.querySelectorAll('.archetype-options .option-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const arch = btn.getAttribute('data-arch') as CarArchetypeId;
        this.ownZenvo.physics.applyArchetype(arch);
        if (this.physics !== this.ownZenvo.physics) this.physics.applyArchetype(arch);
        this.save.data.carArchetype = arch;
        this.save.scheduleSave();
        this.syncOptionSelection('.archetype-options .option-btn', 'data-arch', arch);
        this.hud.showModalStatus('settings-status', `SPEC: ${arch} — handling & suspension tuned`);
      });
    });

    document.querySelectorAll('.quality-options .option-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const q = btn.getAttribute('data-quality') as GraphicsQuality;
        this.save.data.graphicsQuality = q;
        this.save.scheduleSave();
        this.applyGraphicsQuality(q);
        this.hud.showModalStatus('settings-status', `GRAPHICS: ${q} — ${q === 'LOW' ? 'shadows off, max mobile FPS' : 'display quality updated'}`);
      });
    });
  }

  /** Single source of truth for pause: lobby, studio and every modal. */
  private syncPause(): void {
    const isOpen = (id: string) => document.getElementById(id)?.classList.contains('open') ?? false;
    const lobbyVisible = !(document.getElementById('lobby-overlay')?.classList.contains('hidden') ?? true);
    const paused =
      this.lobbyOpen ||
      lobbyVisible ||
      isOpen('settings-modal') ||
      isOpen('garage-modal') ||
      isOpen('results-modal') ||
      (this.studio?.isOpen ?? false) ||
      (this.garage?.isOpen ?? false);
    this.isPaused = paused;
    this.hud.setPaused(paused);
    if (paused) this.sound.pauseAudio();
    else this.sound.resumeAudio();
  }

  private syncOptionSelection(selector: string, attr: string, val: string): void {
    document.querySelectorAll(selector).forEach((el) => {
      const selected = el.getAttribute(attr) === val;
      el.classList.toggle('selected', selected);
      el.setAttribute('aria-pressed', String(selected));
    });
  }

  private onResize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  private resolveCarVsCarCollisions(): void {
    const all: CarPhysics[] = [
      this.physics,
      ...this.raceBots.map(b => b.physics),
      ...this.cityCruisers.map(c => c.physics),
      ...this.parkedCars.map(c => c.physics),
      ...this.civicCars.map(c => c.physics),
      ...this.police.units.map(u => u.physics),
      ...(this.activities.activeSprint ? [this.activities.activeSprint.rivalPhysics] : [])
    ];
    const vehicles = Array.from(new Set(all));
    const focus = this.inCar ? this.physics.position : this.charCtrl.position;
    for (let i = 0; i < vehicles.length; i++) {
      for (let j = i + 1; j < vehicles.length; j++) {
        const evt = separateVehiclePair(vehicles[i], vehicles[j], this.physics);
        if (!evt) continue;
        const nearFocus = Math.hypot(evt.pos.x - focus.x, evt.pos.z - focus.z) < 55;
        if (nearFocus) {
          this.sound.playCrash(evt.impactKmh);
          this.particles.emitSparks(evt.pos, 8);
          if (this.inCar && evt.involvesPrimary) {
            this.cameraShake = Math.max(this.cameraShake, Math.min(0.32, evt.impactKmh / 145));
          }
        }
      }
    }
  }

  private computePlayerProgress(): number {
    const pts = this.track.trackPoints;
    const total = pts.length - 1;
    let playerWp = 0;
    let bestD = Infinity;
    for (let i = 0; i < total; i += 2) {
      const d = Math.hypot(pts[i].x - this.physics.position.x, pts[i].z - this.physics.position.z);
      if (d < bestD) { bestD = d; playerWp = i; }
    }
    return this.lapManager.stats.currentLap * total + playerWp;
  }

  private computeRacePositionText(): string {
    if (this.gameState !== GameState.TIMED_RACE || this.raceBots.length === 0) return '--';
    const playerProgress = this.computePlayerProgress();
    let rank = 1;
    for (const b of this.raceBots) {
      if (b.getRaceProgress() > playerProgress) rank++;
    }
    const suffix = rank === 1 ? 'st' : (rank === 2 ? 'nd' : (rank === 3 ? 'rd' : 'th'));
    return `${rank}${suffix} / ${this.raceBots.length + 1}`;
  }

  private loop(currentTime: number): void {
    requestAnimationFrame((t) => this.loop(t));

    const rawDt = (currentTime - this.lastTime) * 0.001;
    const dt = Math.min(rawDt, 0.04);
    this.lastTime = currentTime;

    // Backgrounded tab: skip simulation/render to save battery and avoid
    // running a full game loop against a suspended AudioContext.
    if (document.hidden) {
      return;
    }
    this.elapsedSec += dt;

    const focusPos = this.inHeli
      ? this.heliPhysics.position
      : (this.inCar ? this.physics.position : this.charCtrl.position);
    this.sunLight.position.copy(focusPos).addScaledVector(this.sunDirection, 150);
    this.sunLight.target.position.copy(focusPos);
    const needAirShadow = this.inHeli && this.heliPhysics.agl > 10;
    if (needAirShadow !== this.wasAirShadow) {
      this.wasAirShadow = needAirShadow;
      const dist = needAirShadow ? 88 : 52;
      this.sunLight.shadow.camera.left = -dist;
      this.sunLight.shadow.camera.right = dist;
      this.sunLight.shadow.camera.top = dist;
      this.sunLight.shadow.camera.bottom = -dist;
      this.sunLight.shadow.camera.updateProjectionMatrix();
    }

    if (!this.isPaused) {
      for (const [id, rem] of this.interactCooldowns.entries()) {
        if (rem <= dt) this.interactCooldowns.delete(id);
        else this.interactCooldowns.set(id, rem - dt);
      }
      if (this.hitStopTimer > 0) {
        this.hitStopTimer = Math.max(0, this.hitStopTimer - dt);
      }
      const simDt = this.hitStopTimer > 0 ? dt * 0.14 : dt;

      const weatherForward = this.inHeli
        ? this.heliPhysics.getForwardVector()
        : (this.inCar ? this.physics.getForwardVector() : this.charCtrl.getForwardVector());
      this.weather.update(simDt, focusPos, weatherForward);
      this.physics.weatherGripMultiplier = this.weather.gripMultiplier;
      const flash = this.weather.lightningFlash;
      this.ambientLight.intensity = this.baseAmbientIntensity + flash * 0.75;
      this.hemiLight.intensity = this.baseHemiIntensity + flash * 2.0;
      this.sunLight.intensity = this.baseSunIntensity + flash * 0.9;
      this.sound.updateNitroAndRain(
        this.physics.isNitroActive,
        this.weather.rainIntensity,
        this.gameState === GameState.TIMED_RACE ? 1 : 0.35
      );

      if (this.boostCooldown > 0) this.boostCooldown -= dt;

      if (this.gameState === GameState.COUNTDOWN) {
        this.countdownTimer -= dt;
        const step = Math.ceil(this.countdownTimer);
        if (step !== this.lastCountdownStep && step >= 1 && step <= 3) {
          this.lastCountdownStep = step;
          this.sound.playBeep(520, 0.14);
          this.track.setCountdownLights(4 - step + 2, false);
          this.hud.showNotification(`${step}`, 'Rev your engine!', 0.9, { hero: true });
        }
        if (this.countdownTimer <= 0) {
          this.gameState = GameState.TIMED_RACE;
          this.track.setCountdownLights(5, true);
          this.sound.playBeep(1040, 0.32);
          this.hud.showNotification('GO!', 'Race Started — Hit All Cyan Gates!', 1.4, { hero: true });
        }
      }

      if (this.gameState === GameState.DRIFT_ARENA) {
        this.driftArenaTimer = Math.max(0, this.driftArenaTimer - dt);
        this.driftArenaBestCombo = Math.max(this.driftArenaBestCombo, this.lapManager.stats.driftMultiplier);
        if (this.driftArenaTimer <= 0) {
          this.finishDriftArenaRun();
        }
      }

      const isTimedRace = this.gameState === GameState.TIMED_RACE;
      const canDrive =
        this.gameState === GameState.OPEN_WORLD ||
        this.gameState === GameState.TIMED_RACE ||
        this.gameState === GameState.DRIFT_ARENA;

      if (this.inHeli) {
        const heliInputs = this.hud.pollHelicopterInputs();
        this.heliPhysics.update(simDt, heliInputs, true);
        this.sound.updateHelicopterSound(true, this.heliPhysics.rotorRpm, this.heliPhysics.speedKmh);
        this.sound.updateTireSkid(0);
        this.hud.updateHeliTelemetry(
          this.heliPhysics.position.y,
          this.heliPhysics.speedKmh,
          this.heliPhysics.rotorRpm,
          this.skyRingsCleared,
          this.openWorld.skyRings.length
        );

        // Rotor wash dust/sparks near helipad & streets
        if (this.heliPhysics.agl < 6.5 && this.heliPhysics.rotorRpm > 0.65) {
          this.heliRotorWashTimer -= dt;
          if (this.heliRotorWashTimer <= 0) {
            this.heliRotorWashTimer = 0.09;
            this.particles.emitSmoke(
              this.camScratchD.set(
                this.heliPhysics.position.x + (Math.random() - 0.5) * 4,
                this.heliPhysics.position.y - this.heliPhysics.agl + 0.15,
                this.heliPhysics.position.z + (Math.random() - 0.5) * 4
              ),
              this.camScratchE.set((Math.random() - 0.5) * 8, 1.5, (Math.random() - 0.5) * 8),
              false,
              1
            );
          }
        }

        // Keep parked car & avatar synced while flying
        this.physics.update(dt, { throttle: 0, brake: 0, steer: 0, handbrake: true, clutch: false, shiftUp: false, shiftDown: false, reset: false }, false);
        this.carMesh.update(this.physics, 0, dt);
        this.avatarMesh.root.position.copy(this.heliPhysics.position);

        // Check aerial Sky Rings!
        for (const ring of this.openWorld.skyRings) {
          if (ring.passed) continue;
          const d = Math.hypot(
            this.heliPhysics.position.x - ring.x,
            this.heliPhysics.position.y - ring.y,
            this.heliPhysics.position.z - ring.z
          );
          if (d < ring.radius) {
            ring.passed = true;
            ring.mesh.visible = false;
            this.skyRingsCleared++;
            this.sound.playRankUpFanfare();
            this.particles.emitSparks(this.heliPhysics.position, 22);
            const allDone = this.skyRingsCleared >= this.openWorld.skyRings.length;
            const bonus = allDone ? 1500 : 200;
            const xp = allDone ? 500 : 120;
            this.award(xp, bonus);
            this.hud.showWorldPopup(allDone ? 'SKY ACE +₡1,500!' : `RING ${this.skyRingsCleared}/8 +₡200`, '#22d3ee');
            this.hud.showNotification(
              allDone ? 'APEX SKY ACE!' : `SKY RING: ${ring.label.toUpperCase()}`,
              allDone ? 'Cleared every aerial gate over Neo Velo! +₡1,500 & +500 XP' : `+₡200 & +120 XP (${this.skyRingsCleared}/${this.openWorld.skyRings.length})`,
              allDone ? 3.4 : 2.2
            );
          }
        }
      } else if (this.inCar) {
        const inputs = this.hud.pollInputs(this.physics.gearboxType);
        const prevGear = this.physics.gear;
        this.physics.update(simDt, inputs, canDrive);

        // Recover car cleanly from either harbor ocean OR central circuit lake water
        if (
          (this.openWorld.isOverOpenWater(this.physics.position.x, this.physics.position.z)
            || this.track.isOverLakeWater(this.physics.position.x, this.physics.position.z))
          && this.physics.position.y < -0.55
        ) {
          this.particles.emitSparks(this.physics.position, 12);
          this.sound.playCrash(55);
          this.physics.resetToTrack();
          this.hud.showNotification('SPLASHDOWN!', 'Recovered to the last safe road.', 2.2);
          this.cameraShake = Math.min(0.3, this.cameraShake + 0.18);
        }

        if (isTimedRace) {
          this.ghost.recordStep(
            dt,
            this.lapManager.stats.currentLapTime,
            this.physics.position.x,
            this.physics.position.y,
            this.physics.position.z,
            this.physics.rotation.y,
            this.physics.bodyPitch,
            this.physics.bodyRoll,
            this.physics.wheels[0]?.steerAngle ?? 0
          );
        } else {
          this.lapManager.updateDriftOnly(
            dt,
            this.physics.isDrifting,
            this.physics.speedKmh,
            this.physics.driftAngle,
            this.weather.driftScoreMultiplier
          );
        }

        const speedNow = Math.round(this.physics.speedKmh);
        if (speedNow > this.save.data.maxSpeedKmh) {
          this.save.data.maxSpeedKmh = speedNow;
          // Speed climbs every frame; don't serialise the whole save that
          // often. A flush on backgrounding still captures the final value.
          if (this.elapsedSec - this.lastMaxSpeedSaveAt > 4) {
            this.lastMaxSpeedSaveAt = this.elapsedSec;
            this.save.scheduleSave();
          }
        }

        if (this.boostCooldown <= 0) {
          for (const pad of this.openWorld.boostPads) {
            if (Math.hypot(this.physics.position.x - pad.x, this.physics.position.z - pad.z) < pad.radius) {
              const fwd = this.physics.getForwardVector();
              // Launch along the pad's own direction so a stunt pad always
              // feeds its ramp, even if the car arrives sideways or backwards.
              const launch = this.boostDirScratch.set(pad.dirX, 0, pad.dirZ);
              if (launch.lengthSq() > 0.0001) launch.normalize();
              else launch.copy(fwd);
              this.physics.velocity.addScaledVector(launch, 18);
              this.boostCooldown = 1.0;
              this.sound.playExhaustPop();
              this.particles.triggerBackfire(this.physics.position, fwd, this.physics.getRightVector());
              this.hud.showNotification('NITRO BOOST!', '+65 km/h', 0.9);
            }
          }
        }

        if (this.physics.gear !== prevGear) {
          this.sound.playGearShift();
          if (this.physics.currentRpm > 5400) {
            const fwd = this.physics.getForwardVector();
            const rgt = this.physics.getRightVector();
            this.particles.triggerBackfire(this.physics.position, fwd, rgt);
            this.sound.playExhaustPop();
          }
        }

        this.carMesh.update(this.physics, inputs.brake, dt);
        this.particles.update(dt, this.physics);

        if (this.activePoliceLights) {
          const on = this.activePoliceLights.active;
          const red = Math.sin(this.elapsedSec * 9.0) > 0;
          (this.activePoliceLights.a.material as THREE.MeshBasicMaterial).color.setHex(
            on ? (red ? 0xff2a3c : 0x3b0a0f) : 0x3b0a0f
          );
          (this.activePoliceLights.b.material as THREE.MeshBasicMaterial).color.setHex(
            on ? (red ? 0x0a1c40 : 0x38bdf8) : 0x0a1c40
          );
        }

        if (isTimedRace) {
          this.lapManager.update(
            dt,
            this.physics.position,
            this.physics.isDrifting,
            this.physics.speedKmh,
            this.physics.driftAngle,
            this.weather.driftScoreMultiplier
          );
          this.ghost.updatePlayback(this.ghostReplayEnabled, this.lapManager.stats.currentLapTime);
        }

        const onCurb = this.physics.wheels.some(w => w.isCurb);        if (onCurb && this.physics.speedKmh > 30) this.cameraShake = Math.max(this.cameraShake, 0.035);

        this.sound.updateEngineSound(this.physics.currentRpm, this.physics.maxRpm, inputs.throttle, this.physics.revLimiterBounce, onCurb, this.physics.speedKmh);
        const maxSkid = Math.max(...this.physics.wheels.map(w => w.skidAmount));
        this.sound.updateTireSkid(maxSkid);

        this.avatarMesh.root.position.copy(this.physics.position);
        if (this.avatarMesh instanceof GLTFCharacterMesh) this.avatarMesh.setCombatStance(false);
        this.avatarMesh.updateAnimation(dt, 'IDLE');
      } else {
        // ON-FOOT CHARACTER
        const charInputs = this.studio.isOpen
          ? { moveX: 0, moveY: 0, sprint: false, jump: false, punch: false, interact: false }
          : this.hud.pollCharacterInputs();
        const interactPressed = Boolean(charInputs.interact);
        const interactEdge = interactPressed && !this.wasInteract;
        this.wasInteract = interactPressed;
        if (this.charCtrl.isDead && this.sittingSpot) this.exitSeat(false);

        if (!this.charCtrl.isDead) {
          if (this.sittingSpot) {
            const wantsMove = Math.hypot(charInputs.moveX, charInputs.moveY) > 0.45;
            if (interactEdge || charInputs.jump || wantsMove) this.exitSeat(true);
          } else if (interactEdge) {
            const worldItem = this.nearbyInteractable();
            if (worldItem) {
              this.handleInteractableUse(worldItem);
            } else if (this.isNearHelicopter()) {
              this.enterHelicopter();
            } else {
              const spot = this.nearbySitSpot();
              if (spot) {
                const root = this.sitRootFor(spot);
                this.sittingSpot = { ...spot, root };
                this.standScootTotal.set(0, 0, 0);
                this.standScootApplied = 1;
                this.charCtrl.position.copy(root);
                this.charCtrl.yaw = spot.yaw;
                this.charCtrl.velocity.set(0, 0, 0);
                if (this.avatarMesh instanceof GLTFCharacterMesh) this.avatarMesh.setSitting(true);
                this.hud.showNotification('SEATED', `${spot.label} • Move / Jump / USE to stand`, 1.8);
              }
            }
          }
        }

        // While seated, keep the avatar glued to the chair and ignore locomotion.
        const seated = this.sittingSpot !== null;
        if (seated && this.sittingSpot) {
          charInputs.moveX = 0;
          charInputs.moveY = 0;
          charInputs.sprint = false;
          charInputs.jump = false;
          charInputs.punch = false;
          charInputs.interact = false;
          this.charCtrl.position.copy(this.sittingSpot.root);
          this.charCtrl.yaw = this.sittingSpot.yaw;
          this.charCtrl.velocity.set(0, 0, 0);
        }

        // Scoot out of the chair in step with the native stand-up animation
        // instead of jumping 1.1m in a single frame while still seated.
        if (!seated && this.standScootApplied < 1 && this.standScootTotal.lengthSq() > 0) {
          const clipProgress = this.avatarMesh instanceof GLTFCharacterMesh
            ? this.avatarMesh.standUpProgress
            : null;
          const progress = clipProgress === null ? 1 : Math.max(this.standScootApplied, clipProgress);
          const easedBefore = 1 - Math.pow(1 - this.standScootApplied, 3);
          this.standScootApplied = Math.min(1, progress);
          const easedAfter = 1 - Math.pow(1 - this.standScootApplied, 3);
          this.charCtrl.position.addScaledVector(this.standScootTotal, easedAfter - easedBefore);
        }

        const wasGroundedBeforeStep = this.charCtrl.isGrounded;
        this.charCtrl.update(simDt, charInputs, this.footCamYaw);
        if (seated && this.sittingSpot) {
          this.charCtrl.position.copy(this.sittingSpot.root);
          this.charCtrl.yaw = this.sittingSpot.yaw;
          this.charCtrl.velocity.set(0, 0, 0);
          this.charCtrl.isGrounded = true;
        }

        // Character vs every car hull (parked, civic, police, moving traffic, race bots, sprint rival)
        pushCharacterOutOfVehicles(
          this.charCtrl,
          [
            this.physics,
            ...this.parkedCars.map((p) => p.physics),
            ...this.civicCars.map((c) => c.physics),
            ...this.police.units.map((u) => u.physics),
            ...this.cityCruisers.map((c) => c.physics),
            ...this.raceBots.map((b) => b.physics),
            ...(this.activities.activeSprint ? [this.activities.activeSprint.rivalPhysics] : [])
          ],
          (pos, vel, rad) => this.openWorld.resolveCollision(pos, vel, rad)
        );
        if (seated && this.sittingSpot) this.charCtrl.position.copy(this.sittingSpot.root);

        this.avatarMesh.root.position.copy(this.charCtrl.position);
        this.avatarMesh.root.rotation.y = this.charCtrl.yaw;
        if (this.avatarMesh instanceof GLTFCharacterMesh) {
          const stairFwdZ = -Math.cos(this.footCamYaw) * charInputs.moveY - Math.sin(this.footCamYaw) * charInputs.moveX;
          const onStairs = !seated && this.openWorld.isInInteriorStairs(this.charCtrl.position.x, this.charCtrl.position.z)
            && (this.charCtrl.animState === 'WALK' || this.charCtrl.animState === 'RUN');
          this.avatarMesh.setStairs(onStairs, stairFwdZ >= 0 ? 'up' : 'down');
          this.avatarMesh.setSwimming(this.charCtrl.isSwimming);
          // Raise the fists while a sparring opponent is in striking range.
          const nearFighter = this.sparringFighters.some(
            (f) => !f.isDead && f.controller.position.distanceTo(this.charCtrl.position) < 9
          );
          this.avatarMesh.setCombatStance(nearFighter && !seated && !this.charCtrl.isSwimming);
        }
        this.avatarMesh.updateAnimation(simDt, this.charCtrl.animState);
        this.avatarMesh.setNameAndHp(this.lobbyUI.config.playerName, this.charCtrl.hp);
        this.hud.updateFootStatus(
          this.charCtrl.stamina,
          this.charCtrl.speedBuffTimer,
          this.charCtrl.powerBuffTimer,
          this.charCtrl.isSwimming
        );

        const nearbyItem = !this.charCtrl.isDead && !this.sittingSpot ? this.nearbyInteractable() : null;
        const nearHeli = !this.charCtrl.isDead && !this.sittingSpot && !nearbyItem && this.isNearHelicopter();
        const promptSpot = this.sittingSpot ?? (nearbyItem || nearHeli ? null : this.nearbySitSpot());
        if (nearbyItem) {
          this.hud.setUseLabel(
            nearbyItem.type === 'ELEVATOR_UP' ? 'ROOF'
              : nearbyItem.type === 'ELEVATOR_DOWN' ? 'LOBBY'
              : nearbyItem.type === 'GARAGE_TUNE' ? 'TUNE'
              : nearbyItem.type === 'EAT_RAMEN' ? 'EAT'
              : nearbyItem.type === 'HACK_TERMINAL' ? 'HACK'
              : nearbyItem.type === 'ROOFTOP_GLIDE' ? 'JUMP'
              : 'USE'
          );
        } else if (nearHeli) {
          this.hud.setUseLabel('FLY');
        } else {
          this.hud.setUseLabel(this.sittingSpot ? 'STAND' : (promptSpot ? 'SIT' : 'USE'));
        }
        if (this.interactPromptEl) {
          if (!this.charCtrl.isDead && (this.sittingSpot || nearbyItem || nearHeli || promptSpot)) {
            const label = this.sittingSpot
              ? 'E / USE — Stand up'
              : (nearbyItem ? nearbyItem.prompt : (nearHeli ? 'F / USE — Fly Apex Skyhawk Helicopter' : `E / USE — Sit (${promptSpot!.label})`));
            if (this.interactPromptEl.textContent !== label) this.interactPromptEl.textContent = label;
            this.interactPromptEl.style.display = 'block';
          } else {
            this.interactPromptEl.style.display = 'none';
          }
        }

        this.physics.update(dt, { throttle: 0, brake: 0, steer: 0, handbrake: true, clutch: false, shiftUp: false, shiftDown: false, reset: false }, false);
        this.carMesh.update(this.physics, 0, dt);
        this.sound.updateEngineSound(1000, 9500, 0, false, false, 0, false);
        this.sound.updateTireSkid(0);

        // Footstep cadence when walking/running on ground
        if (this.charCtrl.isGrounded && (this.charCtrl.animState === 'WALK' || this.charCtrl.animState === 'RUN')) {
          const isSprint = this.charCtrl.animState === 'RUN';
          this.footstepTimer -= dt;
          if (this.footstepTimer <= 0) {
            this.sound.playFootstep(isSprint);
            this.footstepTimer = isSprint ? 0.28 : 0.44;
          }
        } else {
          this.footstepTimer = 0.06;
        }
        // Play the take-off sound only on the grounded -> airborne transition;
        // the old velocity check retriggered it for a few frames per jump.
        if (wasGroundedBeforeStep && !this.charCtrl.isGrounded && this.charCtrl.velocity.y > 0) {
          this.sound.playJump();
        }

        const nearCar = this.findNearestParkedCar(5.0) !== null;
        const nearCop = this.police.units.find(
          (u) => u.physics.speedKmh < 22 && Math.hypot(this.charCtrl.position.x - u.physics.position.x, this.charCtrl.position.z - u.physics.position.z) < 4.4
        ) || null;
        const nearTraffic = this.cityCruisers.find(
          (c) => c.physics.speedKmh < 22 && Math.hypot(this.charCtrl.position.x - c.physics.position.x, this.charCtrl.position.z - c.physics.position.z) < 4.4
        ) || null;
        this.nearbyCivic = this.findNearestCivicCar(4.2);

        const stealLabel = nearCop
          ? 'Police Cruiser'
          : (nearTraffic ? `${nearTraffic.name}'s Coupe` : (this.nearbyCivic ? this.nearbyCivic.name : null));
        const nearHeliAct = this.isNearHelicopter();
        const canAct = nearCar || nearHeliAct || stealLabel !== null;
        this.hud.setOnFootMode(true, canAct, this.charCtrl.hp, this.physics.gearboxType);
        this.hud.setFootAction(canAct, nearHeliAct ? 'Fly Heli' : (nearCar ? 'Drive Car' : (stealLabel ? 'Steal Car' : 'Walk to Car')));
        this.hud.setStealPrompt(!nearCar && !nearHeliAct ? stealLabel : null);
      }

      // Spin-down helicopter mesh & audio smoothly even when parked
      if (!this.inHeli) {
        if (this.heliPhysics.rotorRpm > 0 || !this.heliPhysics.isGrounded) {
          this.heliPhysics.update(dt, { pitch: 0, yaw: 0, strafe: 0, ascend: false, descend: false }, false);
        }
        this.sound.updateHelicopterSound(false, this.heliPhysics.rotorRpm, 0);
      }
      this.heliMesh.update(this.heliPhysics, dt);

      // Lap timer ticks even when player is on foot during a timed race
      if (isTimedRace && !this.inCar && !this.inHeli) {
        this.lapManager.update(dt, this.physics.position, false, 0, 0, this.weather.driftScoreMultiplier);
        this.ghost.updatePlayback(false, this.lapManager.stats.currentLapTime);
      }

      // Check proximity to In-World GP Race Start Portal (0, 0, -4)
      const activePos = this.inHeli ? this.heliPhysics.position : (this.inCar ? this.physics.position : this.charCtrl.position);
      const activeVel = this.inHeli ? this.heliPhysics.velocity : (this.inCar ? this.physics.velocity : this.charCtrl.velocity);

      // Update ocean waves & smashable traffic cones + hidden Neon Cash Stash pickups!
      this.openWorld.updateWorldDynamics(dt, this.elapsedSec, activePos, activeVel, this.inCar);
      for (const item of this.openWorld.collectibles) {
        if (item.collected) continue;
        if (Math.abs(activePos.y - item.y) < 2.6 && Math.hypot(activePos.x - item.x, activePos.z - item.z) < (this.inCar ? 2.8 : 1.7)) {
          item.collected = true;
          item.mesh.visible = false;
          this.sound.playDiscoveryChime();
          this.particles.emitSparks(activePos, 18);
          this.award(item.xp, item.reward);
          this.hud.showWorldPopup(`+₡${item.reward} STASH!`, '#facc15');
          this.hud.showNotification(`FOUND: ${item.label.toUpperCase()}`, `+₡${item.reward} Credits & +${item.xp} XP`, 2.6);
        }
      }

      // District tracking & first-discovery bonus
      const districtId = this.openWorld.getDistrictAt(activePos.x, activePos.z);
      if (districtId !== this.currentDistrictId) {
        this.currentDistrictId = districtId;
        const info = DISTRICTS[districtId];
        this.hud.setDistrict(info.name, info.accentColor);
        if (!this.save.data.discoveredDistricts.includes(districtId)) {
          this.save.data.discoveredDistricts.push(districtId);
          this.save.scheduleSave();
          this.sound.playDiscoveryChime();
          this.hud.showNotification(`NEW DISTRICT: ${info.name}`, `${info.jpName} • ${info.subtitle}`, 3.0);
          this.award(100, 150);
        }
      }

      // Open-world activities: speed traps, drift zones, Apex Logs, rival sprints
      this.activities.update(
        dt,
        this.elapsedSec,
        activePos,
        this.physics.speedKmh,
        this.inCar,
        this.physics.isDrifting,
        this.lapManager.lastDriftRate * this.weather.driftScoreMultiplier,
        isTimedRace
      );

      const nearStartGate = this.gameState === GameState.OPEN_WORLD
        && !this.inHeli
        && !this.charCtrl.isDead
        && !this.activities.activeSprint
        && !this.activities.activeCourier
        && Math.hypot(activePos.x - 0, activePos.z - (-4)) < 14;
      this.hud.setRacePrompt(nearStartGate);

      const nearDriftGarage = this.gameState === GameState.OPEN_WORLD
        && !this.inHeli
        && !this.activities.activeSprint
        && !this.activities.activeCourier
        && Math.hypot(activePos.x - 84, activePos.z - 15) < 12;
      if (nearDriftGarage !== this.lastGaragePrompt) {
        this.lastGaragePrompt = nearDriftGarage;
        if (this.garagePromptEl) this.garagePromptEl.style.display = nearDriftGarage ? 'flex' : 'none';
      }

      const timerPill = this.timerPillEl;
      if (timerPill) {
        if (this.activities.activeCourier) {
          const ac = this.activities.activeCourier;
          const rem = Math.max(0, ac.def.bronzeSec - ac.elapsed);
          timerPill.textContent = `📦 ${ac.def.title.toUpperCase()} • ${rem.toFixed(1)}s LEFT`;
          timerPill.style.borderColor = rem < 8 ? '#ef4444' : '#f59e0b';
          timerPill.style.display = 'block';
        } else if (this.activities.activeSprint) {
          const sp = this.activities.activeSprint;
          timerPill.textContent = `⚡ VS ${sp.def.rivalName.toUpperCase()} • CP ${sp.playerWpIdx + 1}/${sp.def.waypoints.length} • ${sp.elapsed.toFixed(1)}s`;
          timerPill.style.borderColor = '#ec4899';
          timerPill.style.display = 'block';
        } else {
          timerPill.style.display = 'none';
        }
      }

      // Update Checkpoint Portal Visuals
      this.track.updateCheckpointVisuals(this.lapManager.nextCheckpointIndex, isTimedRace, this.elapsedSec);

      // Update AI Race Bots (roaming freely in Open World, or racing in Timed Race!)
      const allTrackCars = [this.physics.position, ...this.raceBots.map(b => b.physics.position)];
      const playerProg = isTimedRace ? this.computePlayerProgress() : undefined;
      for (const bot of this.raceBots) {
        bot.update(dt, canDrive, allTrackCars, playerProg);
      }

      // Update Living Neo Velo Pedestrians (walking, fleeing, witnessing & reporting crimes)
      this.pedestrians.update(dt, activePos, this.physics.position, this.physics.speedKmh, this.inCar);

      // Update Friendly City Traffic Cruisers
      const cityPositions = this.cityCruisers.map(c => c.physics.position);
      const pedPositions = this.pedestrians.agents
        .filter((p) => !p.controller.isDead)
        .map((p) => p.controller.position);
      const footRef = !this.inCar ? this.charCtrl.position : null;
      for (const cruiser of this.cityCruisers) {
        cruiser.update(dt, this.physics.position, footRef, cityPositions, pedPositions);
      }

      // Police heat, pursuit, sirens and on-foot arrests
      if (this.gameState === GameState.OPEN_WORLD) {
        this.police.update(
          dt,
          activePos,
          this.inCar || this.inHeli || this.charCtrl.isDead,
          this.inCar ? this.physics : null,
          this.charCtrl.isDead
        );
        this.sound.updateSiren(
          this.police.units.length > 0,
          1 - Math.min(1, this.police.nearestDistance / 150)
        );

        // Any fast vehicle (police, traffic, race bot) clipping you on foot hurts.
        if (this.policeHitCooldown > 0) this.policeHitCooldown -= dt;
        if (!this.inCar && !this.inHeli && !this.charCtrl.isDead && this.policeHitCooldown <= 0) {
          const impact = resolveMovingVehicleImpactOnCharacter(
            this.charCtrl,
            [
              ...this.police.units.map((u) => u.physics),
              ...this.cityCruisers.map((c) => c.physics),
              ...this.raceBots.map((b) => b.physics)
            ],
            24,
            3.0
          );
          if (impact.hit) {
            this.policeHitCooldown = 1.2;
            this.cameraShake = 0.3;
            this.sound.playCrash(impact.speedKmh);
            this.particles.emitSparks(this.charCtrl.position, 8);
          }
        }
      } else if (this.police.isActive) {
        this.police.clearHeat();
        this.sound.updateSiren(false, 0);
      }

      this.resolveCarVsCarCollisions();
      this.updateParkedVehicles(dt);

      // Update City Sparring Fighters + car impact check
      if (this.fighterHitCooldown > 0) this.fighterHitCooldown -= dt;
      for (const f of this.sparringFighters) {
        if (!f.isDead && this.inCar && this.physics.speedKmh > 20 && this.fighterHitCooldown <= 0) {
          const d = Math.hypot(f.controller.position.x - this.physics.position.x, f.controller.position.z - this.physics.position.z);
          if (d < 2.3 && Math.abs(f.controller.position.y - this.physics.position.y) < 2.0) {
            const awayX = f.controller.position.x - this.physics.position.x;
            const awayZ = f.controller.position.z - this.physics.position.z;
            const len = Math.hypot(awayX, awayZ) || 1;
            const dmg = Math.min(80, Math.round(this.physics.speedKmh * 0.75));
            const killed = f.controller.takeDamage(dmg, awayX / len, awayZ / len);
            this.fighterHitCooldown = 0.7;
            this.sound.playCrash(this.physics.speedKmh);
            this.particles.emitSparks(f.controller.position, killed ? 22 : 10);
            this.cameraShake = 0.18;
            this.pedestrians.alertDanger(f.controller.position, 22);
            if (killed) {
              this.save.data.knockouts++;
              this.save.scheduleSave();
              this.award(120, 160);
              this.police.addHeat(2, 'HIT AND RUN', f.controller.position);
              this.hud.showNotification(`${f.name.toUpperCase()} DOWN`, 'Hit-and-run reported!', 2.4);
            } else {
              this.pedestrians.notifyCrime(f.controller.position, 'RECKLESS DRIVING', 28);
            }
          }
        }
        f.update(dt, this.charCtrl.position, !this.inCar);
      }

      // Update Giant Playground Soccer Ball
      const ballActors = [
        { pos: this.physics.position, vel: this.physics.velocity, radius: 2.0, kickPower: 3.0 },
        ...(!this.inCar ? [{ pos: this.charCtrl.position, vel: this.charCtrl.velocity, radius: 0.7, kickPower: 6.0 }] : []),
        ...this.raceBots.map(b => ({ pos: b.physics.position, vel: b.physics.velocity, radius: 2.0, kickPower: 2.0 }))
      ];
      this.openWorld.updateSoccerBall(dt, ballActors);

      // Update Remote Hotspot Friends
      for (const peer of this.remotePeers.values()) {
        const st = peer.lastState;
        peer.carMesh.root.position.lerp(this.peerScratch.set(st.carX, st.carY, st.carZ), 0.3);
        peer.carMesh.root.rotation.y = st.carYaw;
        peer.charMesh.root.visible = !st.inCar;
        if (!st.inCar) {
          peer.charMesh.root.position.lerp(this.peerScratch.set(st.x, st.y, st.z), 0.35);
          peer.charMesh.root.rotation.y = st.yaw;
          peer.charMesh.updateAnimation(dt, st.animState);
          peer.charMesh.setNameAndHp(st.name, st.hp);
        }
      }

      if (this.lobbyClient.currentRoom) {
        this.syncAccumulator += dt;
        if (this.syncAccumulator >= 0.05) {
          this.syncAccumulator = 0;
          this.lobbyClient.sendWorldSync({
            name: this.lobbyUI.config.playerName,
            x: this.charCtrl.position.x,
            y: this.charCtrl.position.y,
            z: this.charCtrl.position.z,
            yaw: this.charCtrl.yaw,
            carX: this.physics.position.x,
            carY: this.physics.position.y,
            carZ: this.physics.position.z,
            carYaw: this.physics.rotation.y,
            speedKmh: this.physics.speedKmh,
            inCar: this.inCar,
            animState: this.inCar ? 'DRIVE' : this.charCtrl.animState,
            steer: this.physics.wheels[0].steerAngle,
            hp: this.charCtrl.hp,
            carColor: this.lobbyUI.config.carColor,
            characterId: this.lobbyUI.config.characterId,
            appearance: this.studio.appearance
          });

          const me = this.lobbyClient.currentRoom.players.find(p => p.id === this.lobbyClient.clientId);
          if (me?.isHost) {
            this.lobbyClient.sendBallSync({
              x: this.openWorld.ballPos.x,
              y: this.openWorld.ballPos.y,
              z: this.openWorld.ballPos.z,
              vx: this.openWorld.ballVel.x,
              vy: this.openWorld.ballVel.y,
              vz: this.openWorld.ballVel.z
            });
          }
        }
      }
    }

    if (this.impactFlashAlpha > 0) {
      this.impactFlashAlpha = Math.max(0, this.impactFlashAlpha - dt * 2.2);
      if (this.impactFlashEl) this.impactFlashEl.style.opacity = this.impactFlashAlpha.toFixed(3);
    }
    if (this.speedVignetteEl) {
      const vig = this.inHeli
        ? Math.min(0.45, Math.max(0, (this.heliPhysics.speedKmh - 95) / 180))
        : (this.inCar
          ? Math.min(0.65, Math.max(0, (this.physics.speedKmh - 105) / 180))
          : (this.charCtrl.isDead ? 0.72 : (this.charCtrl.isDashing || this.charCtrl.isGliding ? 0.28 : 0)));
      this.speedVignetteEl.style.opacity = vig.toFixed(2);
    }
    this.updateCamera(dt);

    const playerMarker = this.inHeli
      ? { x: this.heliPhysics.position.x, z: this.heliPhysics.position.z, yaw: this.heliPhysics.yaw }
      : (this.inCar
        ? { x: this.physics.position.x, z: this.physics.position.z, yaw: this.physics.rotation.y }
        : { x: this.charCtrl.position.x, z: this.charCtrl.position.z, yaw: this.charCtrl.yaw });

    const extraMarkers: MinimapActor[] = [
      ...(!this.inHeli ? [{ x: this.heliPhysics.position.x, z: this.heliPhysics.position.z, color: '#22d3ee', shape: 'diamond' as const, size: 3.4 }] : []),
      ...(this.inHeli ? this.openWorld.skyRings.filter(r => !r.passed).map(r => ({ x: r.x, z: r.z, color: '#22d3ee', shape: 'ring' as const, size: 4.0 })) : []),
      ...this.raceBots.map(b => ({ x: b.physics.position.x, z: b.physics.position.z, color: '#facc15' })),
      ...this.cityCruisers.map(c => ({ x: c.physics.position.x, z: c.physics.position.z, color: '#38bdf8' })),
      ...this.police.units.map(u => ({ x: u.physics.position.x, z: u.physics.position.z, color: '#ef4444' })),
      ...this.sparringFighters
        .filter(f => !f.isDead)
        .map(f => ({ x: f.controller.position.x, z: f.controller.position.z, color: '#fb923c' })),
      ...this.civicCars.map(c => ({ x: c.physics.position.x, z: c.physics.position.z, color: '#a3e635' })),
      ...this.pedestrians.agents
        .filter(p => !p.controller.isDead)
        .map(p => ({ x: p.controller.position.x, z: p.controller.position.z, color: p.state === 'WITNESS' ? '#f43f5e' : '#cbd5e1', size: 2.0 })),
      ...Array.from(this.remotePeers.values()).map(p => ({
        x: p.lastState.inCar ? p.lastState.carX : p.lastState.x,
        z: p.lastState.inCar ? p.lastState.carZ : p.lastState.z,
        color: '#4ade80'
      })),
      // Activity markers: uncollected shards (yellow diamonds), speed traps (cyan squares), rival portals (rings)
      ...this.activities.shards
        .filter(s => !s.collected)
        .map(s => ({ x: s.x, z: s.z, color: '#facc15', shape: 'diamond' as const, size: 2.5 })),
      ...this.activities.speedTraps.map(t => ({ x: t.x, z: t.z, color: '#22d3ee', shape: 'square' as const, size: 2.5 })),
      ...this.activities.rivals
        .filter(r => !this.save.data.rivalsDefeated.includes(r.id))
        .map(r => ({ x: r.startPos.x, z: r.startPos.z, color: '#ec4899', shape: 'ring' as const, size: 3.0 })),
      ...this.activities.couriers.map(c => ({
        x: c.startPos.x,
        z: c.startPos.z,
        color: '#f59e0b',
        shape: 'square' as const,
        size: 2.5
      })),
      ...(this.activities.activeCourier ? [{
        x: this.activities.activeCourier.def.destPos.x,
        z: this.activities.activeCourier.def.destPos.z,
        color: '#fbbf24',
        shape: 'ring' as const,
        size: 4.6
      }] : []),
      ...(this.activities.activeSprint ? [
        {
          x: this.activities.activeSprint.rivalPhysics.position.x,
          z: this.activities.activeSprint.rivalPhysics.position.z,
          color: '#ec4899',
          size: 3.6
        },
        {
          x: this.activities.activeSprint.def.waypoints[this.activities.activeSprint.playerWpIdx].x,
          z: this.activities.activeSprint.def.waypoints[this.activities.activeSprint.playerWpIdx].z,
          color: '#22c55e',
          shape: 'ring' as const,
          size: 4.5
        }
      ] : [])
    ];

    const driftHudInfo = this.gameState === GameState.DRIFT_ARENA
      ? {
          remainingSec: this.driftArenaTimer,
          totalPoints: Math.round(this.lapManager.stats.driftScore + this.lapManager.stats.currentDriftPoints),
          mult: this.lapManager.stats.driftMultiplier
        }
      : undefined;

    this.hud.render(
      this.physics,
      this.lapManager,
      this.track,
      dt,
      playerMarker,
      this.gameState === GameState.TIMED_RACE,
      this.computeRacePositionText(),
      extraMarkers,
      driftHudInfo
    );
    // Keep the sky dome centered on the camera so world-edge views never clip
    // through its far side (radius 980 < far plane 1400 + world-corner offset).
    if (this.track?.skyDomeMesh) this.track.skyDomeMesh.position.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
    this.updateAdaptiveResolution(rawDt);
  }

  /** Changing fov forces a projection-matrix rebuild; skip it when unchanged. */
  private setCameraFov(fov: number): void {
    if (Math.abs(this.camera.fov - fov) < 0.01) return;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  private updateCamera(dt: number): void {
    if (this.cameraShake > 0) {
      this.cameraShake = Math.max(0, this.cameraShake - dt * 1.6);
    }

    if (this.inHeli) {
      const hPos = this.heliPhysics.position;
      const fwdX = -Math.sin(this.heliPhysics.yaw);
      const fwdZ = -Math.cos(this.heliPhysics.yaw);

      if (this.cameraView === CameraView.HOOD) {
        this.setCameraFov(72);
        this.camScratchC.set(hPos.x + fwdX * 1.4, hPos.y + 1.55, hPos.z + fwdZ * 1.4);
        this.camera.position.copy(this.camScratchC);
        this.camScratchE.set(hPos.x + fwdX * 42, hPos.y - 3.5 + this.heliPhysics.pitch * 22, hPos.z + fwdZ * 42);
        this.camera.lookAt(this.camScratchE);
        return;
      }

      if (this.cameraView === CameraView.ORBIT) {
        this.setCameraFov(56);
        this.orbitAngle += dt * 0.35;
        const dist = 12.5;
        this.camScratchC.set(hPos.x + Math.sin(this.orbitAngle) * dist, hPos.y + 4.2, hPos.z + Math.cos(this.orbitAngle) * dist);
        this.camScratchD.set(hPos.x, hPos.y + 1.4, hPos.z);
        const safe = this.openWorld.clampCameraToWorld(this.camScratchD, this.camScratchC);
        this.camera.position.copy(safe);
        this.camera.lookAt(hPos.x, hPos.y + 1.4, hPos.z);
        return;
      }

      const targetHeliFov = 64 + Math.min(12, (this.heliPhysics.speedKmh / 168) * 12);
      this.setCameraFov(THREE.MathUtils.damp(this.camera.fov, targetHeliFov, 6, dt));
      const camDist = 11.2 + Math.min(2.0, (this.heliPhysics.speedKmh / 168) * 2.0);
      this.camScratchA.set(fwdX, 0, fwdZ);
      this.camScratchC.set(hPos.x - fwdX * camDist, hPos.y + 4.1, hPos.z - fwdZ * camDist);
      this.camScratchD.set(hPos.x, hPos.y + 1.5, hPos.z);
      const safe = this.openWorld.clampCameraToWorld(this.camScratchD, this.camScratchC);
      this.chaseCamPos.lerp(safe, 1 - Math.exp(-9 * dt));
      this.camera.position.copy(this.chaseCamPos);
      if (this.cameraShake > 0) {
        this.camera.position.x += (Math.random() - 0.5) * this.cameraShake;
        this.camera.position.y += (Math.random() - 0.5) * this.cameraShake;
      }
      this.camScratchE.set(hPos.x + fwdX * 8, hPos.y + 1.1, hPos.z + fwdZ * 8);
      this.chaseCamLook.lerp(this.camScratchE, 1 - Math.exp(-12 * dt));
      this.camera.lookAt(this.chaseCamLook);
      this.camRoll = THREE.MathUtils.damp(this.camRoll, -this.heliPhysics.roll * 0.25, 6.0, dt);
      this.camera.rotateZ(this.camRoll);
      return;
    }

    if (!this.inCar) {
      const cPos = this.charCtrl.position;

      // Dedicated Studio turntable showcase angle when Character Studio drawer is open
      if (this.studio.isOpen) {
        this.setCameraFov(44);
        const fwd = this.charCtrl.getForwardVector();
        const rgt = this.camScratchD.set(-fwd.z, 0, fwd.x);
        const focus = this.camScratchA.set(cPos.x + rgt.x * 0.55, cPos.y + 1.08, cPos.z + rgt.z * 0.55);
        const camWanted = this.camScratchB.set(
          cPos.x + fwd.x * 2.55 + rgt.x * 0.85,
          cPos.y + 1.38,
          cPos.z + fwd.z * 2.55 + rgt.z * 0.85
        );
        this.chaseCamPos.lerp(camWanted, 1 - Math.exp(-9 * dt));
        this.chaseCamLook.lerp(focus, 1 - Math.exp(-12 * dt));
        this.camera.position.copy(this.chaseCamPos);
        this.camera.lookAt(this.chaseCamLook);
        return;
      }

      if (this.charCtrl.isDead) {
        this.footCamYaw += dt * 0.48;
        this.setCameraFov(THREE.MathUtils.damp(this.camera.fov, 54, 4, dt));
        const koDist = 3.3;
        const focusPt = this.camScratchA.set(cPos.x, cPos.y + 0.42, cPos.z);
        const rawCam = this.camScratchB.set(
          cPos.x + Math.sin(this.footCamYaw) * koDist,
          cPos.y + 1.25,
          cPos.z + Math.cos(this.footCamYaw) * koDist
        );
        const safeCam = this.openWorld.clampCameraToWorld(focusPt, rawCam);
        this.chaseCamPos.lerp(safeCam, 1 - Math.exp(-8 * dt));
        this.camera.position.copy(this.chaseCamPos);
        this.chaseCamLook.lerp(focusPt, 1 - Math.exp(-10 * dt));
        this.camera.lookAt(this.chaseCamLook);
        return;
      }

      const targetFootFov = this.charCtrl.animState === 'RUN' || this.charCtrl.isGliding ? 66 : 62;
      this.setCameraFov(THREE.MathUtils.damp(this.camera.fov, targetFootFov, 7, dt));

      const dist = 4.3;
      const focusPt = this.camScratchA.set(cPos.x, cPos.y + 1.32, cPos.z);
      const rawCam = this.camScratchB.set(
        cPos.x + Math.sin(this.footCamYaw) * dist,
        cPos.y + 2.05,
        cPos.z + Math.cos(this.footCamYaw) * dist
      );
      const safeCam = this.openWorld.clampCameraToWorld(focusPt, rawCam);
      this.chaseCamPos.lerp(safeCam, 1 - Math.exp(-14 * dt));
      this.camera.position.copy(this.chaseCamPos);
      if (this.cameraShake > 0) {
        this.camera.position.x += (Math.random() - 0.5) * this.cameraShake;
        this.camera.position.y += (Math.random() - 0.5) * this.cameraShake;
      }
      this.chaseCamLook.lerp(focusPt, 1 - Math.exp(-15 * dt));
      this.camera.lookAt(this.chaseCamLook);
      return;
    }

    const carPos = this.physics.position;
    const forward = this.physics.getForwardVector();
    const up = this.physics.getUpVector();

    if (this.cameraView === CameraView.CHASE) {
      const speedKmh = this.physics.speedKmh;
      const targetFov = 62 + Math.min(16, (speedKmh / 260) * 16) + (this.physics.isNitroActive ? 6.0 : 0);
      this.setCameraFov(THREE.MathUtils.damp(this.camera.fov, targetFov, 7.5, dt));

      const posAlpha = 1 - Math.exp(-10.5 * dt);
      const lookAlpha = 1 - Math.exp(-14.5 * dt);

      // Drift corner-peek: blend car forward with travel direction at speed so apex stays visible
      const camDir = this.camScratchA.copy(forward);
      const speedMs = Math.hypot(this.physics.velocity.x, this.physics.velocity.z);
      if (speedMs > 7 && this.physics.forwardVelocity > 2) {
        const velDir = this.camScratchB.set(this.physics.velocity.x, 0, this.physics.velocity.z).normalize();
        camDir.lerp(velDir, 0.30).normalize();
      }

      const camDist = 6.0 + Math.min(1.15, (speedKmh / 260) * 1.15);
      const wantedCam = this.camScratchC.copy(carPos).addScaledVector(camDir, -camDist).addScaledVector(up, 2.2);
      const targetCamPos = this.openWorld.clampCameraToWorld(
        this.camScratchD.copy(carPos).addScaledVector(up, 0.8), wantedCam
      );
      this.chaseCamPos.lerp(targetCamPos, posAlpha);
      this.camera.position.copy(this.chaseCamPos);

      if (this.cameraShake > 0) {
        this.camera.position.x += (Math.random() - 0.5) * this.cameraShake;
        this.camera.position.y += (Math.random() - 0.5) * this.cameraShake;
      }

      const targetLook = this.camScratchE.copy(carPos).addScaledVector(camDir, 3.6).addScaledVector(up, 0.85);
      this.chaseCamLook.lerp(targetLook, lookAlpha);
      this.camera.lookAt(this.chaseCamLook);

      const targetRoll = THREE.MathUtils.clamp(this.physics.yawRate * Math.min(1, speedKmh / 140) * 0.042, -0.045, 0.045);
      this.camRoll = THREE.MathUtils.damp(this.camRoll, targetRoll, 7.0, dt);
      this.camera.rotateZ(this.camRoll);
    } else if (this.cameraView === CameraView.HOOD) {
      this.setCameraFov(74);

      const hoodPos = this.camScratchC.copy(carPos).addScaledVector(forward, 0.65).addScaledVector(up, 1.05);
      this.camera.position.copy(hoodPos);
      const hoodLook = this.camScratchE.copy(carPos).addScaledVector(forward, 35).addScaledVector(up, 0.9);
      this.camera.lookAt(hoodLook);
    } else if (this.cameraView === CameraView.ORBIT) {
      this.setCameraFov(52);

      this.orbitAngle += dt * 0.3;
      const dist = 7.0;
      const wanted = this.camScratchC.set(
        carPos.x + Math.sin(this.orbitAngle) * dist,
        carPos.y + 2.1,
        carPos.z + Math.cos(this.orbitAngle) * dist
      );
      const safe = this.openWorld.clampCameraToWorld(this.camScratchD.copy(carPos).addScaledVector(up, 0.8), wanted);
      this.camera.position.copy(safe);
      this.camera.lookAt(carPos.x, carPos.y + 0.75, carPos.z);
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new GameApp();
});
