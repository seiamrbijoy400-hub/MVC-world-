import * as THREE from 'three';
import { CarPhysics, GearboxType, GroundSample } from './physics/CarPhysics';
import { CharacterController } from './physics/CharacterController';
import { CarMesh } from './graphics/CarMesh';
import { AnimeCharacterMesh } from './graphics/AnimeCharacterMesh';
import { TrackEnvironment, TimeOfDay } from './graphics/TrackEnvironment';
import { OpenWorldMap } from './graphics/OpenWorldMap';
import { ParticleSystem } from './graphics/ParticleSystem';
import { SoundManager } from './audio/SoundManager';
import { LapManager, LapStats } from './game/LapManager';
import { RaceBot, CityCruiserBot, SparringFighter } from './ai/RaceBotAI';
import { HUD, MinimapActor, TouchMode } from './ui/HUD';
import { LobbyClient } from './network/LobbyClient';
import { LobbyUI, LobbyConfig } from './ui/LobbyUI';
import { CharacterStudio } from './ui/CharacterStudio';
import { SaveManager } from './game/SaveManager';
import type { WeatherMode } from './game/SaveManager';
import { WeatherSystem } from './graphics/WeatherSystem';
import { GhostSystem } from './game/GhostSystem';
import { WorldActivities, type RivalSprintDef } from './game/WorldActivities';
import type { NetworkPlayerSync } from './network/LobbyProtocol';

enum CameraView {
  CHASE = 'CHASE',
  HOOD = 'HOOD',
  ORBIT = 'ORBIT'
}

enum GameState {
  OPEN_WORLD = 'OPEN_WORLD',
  COUNTDOWN = 'COUNTDOWN',
  TIMED_RACE = 'TIMED_RACE',
  FINISHED = 'FINISHED'
}

interface RemotePeer {
  id: string;
  carMesh: CarMesh;
  charMesh: AnimeCharacterMesh;
  lastState: NetworkPlayerSync;
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

  private physics: CarPhysics;
  private charCtrl: CharacterController;
  private inCar = false; // Spawn on foot right beside car in Open World!

  private carMesh: CarMesh;
  private avatarMesh: AnimeCharacterMesh;
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
  private ghostReplayEnabled = true;
  private nearbyRival: RivalSprintDef | null = null;
  private baseAmbientIntensity = 0.72;
  private baseHemiIntensity = 0.55;
  private baseSunIntensity = 1.9;

  private raceBots: RaceBot[] = [];
  private cityCruisers: CityCruiserBot[] = [];
  private sparringFighters: SparringFighter[] = [];
  private remotePeers = new Map<string, RemotePeer>();

  private gameState: GameState = GameState.OPEN_WORLD;
  private countdownTimer = 0;
  private lastCountdownStep = -1;
  private elapsedSec = 0;

  private cameraView: CameraView = CameraView.CHASE;
  private chaseCamPos = new THREE.Vector3(12, 3, 30);
  private chaseCamLook = new THREE.Vector3(14, 1, 22);
  private orbitAngle = 0.55;
  private footCamYaw = 0.45;
  private cameraShake = 0;
  private syncAccumulator = 0;
  private boostCooldown = 0;
  private peerScratch = new THREE.Vector3();

  private lastTime = performance.now();
  private isPaused = false;

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
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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

    const sampleUnifiedGround = (x: number, z: number): GroundSample => {
      const base = this.track.sampleGround(x, z);
      const rampH = this.openWorld.sampleRampHeight(x, z);
      const inCity = this.openWorld.isInsideCityOrPlayground(x, z);
      return {
        ...base,
        height: Math.max(base.height, rampH),
        isRoad: base.isRoad || inCity || rampH > 0
      };
    };

    // Car Physics
    this.physics = new CarPhysics();
    this.physics.enforceTrackWalls = false;
    this.physics.trackMaxHalfWidth = this.track.wallOffset;
    this.physics.groundHeightSampler = sampleUnifiedGround;
    this.physics.worldCollider = (pos, vel, rad) => this.openWorld.resolveCollision(pos, vel, rad);
    this.physics.gearboxType = this.save.data.gearbox;
    this.physics.assistMode = this.save.data.assistMode;
    this.physics.applyArchetype(this.save.data.carArchetype);
    this.physics.weatherGripMultiplier = this.weather.gripMultiplier;
    this.physics.onWallCollision = (impactKmh) => {
      this.sound.playCrash(impactKmh);
      this.particles.emitSparks(this.physics.position, 14);
      this.cameraShake = Math.min(0.42, impactKmh / 140);
      this.lapManager.handleDriftCrash(impactKmh);
    };

    // Character Controller
    this.charCtrl = new CharacterController();
    this.charCtrl.groundHeightSampler = (x, z) => sampleUnifiedGround(x, z).height;
    this.charCtrl.worldCollider = (pos, vel, rad) => this.openWorld.resolveCollision(pos, vel, rad);
    this.charCtrl.onPunchStrike = (origin, fwd) => this.handlePlayerPunch(origin, fwd);

    this.carMesh = new CarMesh(true);
    this.carMesh.setColor(this.save.data.carColor);
    this.carMesh.setUnderglowColor(this.save.data.underglowColor);
    this.scene.add(this.carMesh.root);

    this.studio = new CharacterStudio();
    this.studio.applyPreset(this.save.data.characterId);
    this.avatarMesh = new AnimeCharacterMesh(this.save.data.characterId, this.save.data.playerName, this.studio.appearance);
    this.avatarMesh.setNameAndHp(this.save.data.playerName, 100);
    this.scene.add(this.avatarMesh.root);

    this.ghost = new GhostSystem(this.scene, this.save.data.bestLapGhost);

    this.studio.onChange = (app) => {
      this.avatarMesh.setAppearance(app);
    };
    this.studio.onToggle = (open) => {
      if (open && this.inCar) {
        this.toggleEnterExitCar();
      }
    };

    this.particles = new ParticleSystem(this.scene);

    this.hud = new HUD();
    this.hud.onToggleEnterExit = () => this.toggleEnterExitCar();
    this.hud.onStartCircuitRace = () => this.startTimedCircuitRace(3);
    this.hud.onHorn = () => this.handleHornPressed();
    this.hud.onSendChat = (txt) => this.sendInGameChat(txt);
    this.hud.onSendEmoji = (emoji) => this.sendEmojiReaction(emoji);
    this.refreshProfile();

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
        this.hud.showNotification(`APEX LOG ${found}/${total}: ${shard.title}`, shard.lore, 3.6);
        this.award(150, 120);
      },
      onNearRivalPrompt: (rival) => this.setRivalPrompt(rival),
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
      }
    });

    // Spawn 2 Roaming Anime Sparring Fighters in City Plaza & Playground!
    const f1 = new SparringFighter('Kenji', 'kaito', new THREE.Vector3(34, 0, 22), this.scene);
    const f2 = new SparringFighter('Yuki', 'mika', new THREE.Vector3(84, 0, 75), this.scene);
    for (const f of [f1, f2]) {
      f.controller.groundHeightSampler = (x, z) => sampleUnifiedGround(x, z).height;
      f.controller.worldCollider = (pos, vel, rad) => this.openWorld.resolveCollision(pos, vel, rad);
      f.controller.onPunchStrike = (origin, fwd) => {
        if (!this.inCar && origin.distanceTo(this.charCtrl.position) < 2.2) {
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
    };
    this.lobbyUI.onColorPreview = (color) => {
      this.carMesh.setColor(color);
      this.save.data.carColor = color;
      this.save.scheduleSave();
    };
    this.lobbyUI.onGearboxChange = (gb) => {
      this.physics.gearboxType = gb;
      this.save.data.gearbox = gb;
      this.save.scheduleSave();
      this.hud.updateTouchVisibility(gb);
    };
    this.lobbyUI.onLaunchSession = (cfg) => this.applyLobbyLaunch(cfg);

    this.lobbyUI.config.playerName = this.save.data.playerName;
    this.lobbyUI.config.characterId = this.save.data.characterId;
    this.lobbyUI.config.carColor = this.save.data.carColor;
    this.lobbyUI.config.gearbox = this.save.data.gearbox;
    const savedNameInput = document.getElementById('input-player-name') as HTMLInputElement | null;
    if (savedNameInput) savedNameInput.value = this.save.data.playerName;
    document.querySelectorAll('.color-swatch').forEach((s) => {
      s.classList.toggle('selected', s.getAttribute('data-color') === this.save.data.carColor);
    });
    document.querySelectorAll('.char-card').forEach((c) => {
      c.classList.toggle('selected', c.getAttribute('data-char') === this.save.data.characterId);
    });

    this.spawnCityCruisers();
    const savedTod = this.save.data.atmospherePref === 'AUTO' ? 'SUNSET' : this.save.data.atmospherePref;
    this.setAtmosphere(savedTod);
    this.bindMultiplayerEvents();
    this.setupCameraDragLook(canvas);
    this.spawnInOpenWorld();
    this.setupUIHandlers();
    this.syncSavedSettings();
    this.refreshProfile();

    window.addEventListener('resize', () => this.onResize());
    requestAnimationFrame((t) => this.loop(t));
  }

  private spawnInOpenWorld(): void {
    this.gameState = GameState.OPEN_WORLD;
    this.inCar = false;
    this.activities.cancelSprint();
    this.setRivalPrompt(null);
    this.ghost.updatePlayback(false, 0);
    // Park car at South Track-City Boulevard Junction facing the GP Track Gate
    this.physics.enforceTrackWalls = false;
    this.physics.resetToTrack(new THREE.Vector3(16, 0, 26), Math.PI * 0.42);
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
    this.hud.showNotification('ZENVO OPEN WORLD', 'Tap DRIVE to get in car, or explore Metro City!', 3.0);
  }

  private startTimedCircuitRace(laps = 3): void {
    this.sound.init();
    this.hud.setRacePrompt(false);
    this.setRivalPrompt(null);
    this.activities.cancelSprint();
    document.getElementById('results-modal')!.classList.remove('open');

    // Automatically put player inside car on Starting Grid!
    this.inCar = true;
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

  private applyLobbyLaunch(cfg: LobbyConfig): void {
    this.sound.init();
    this.physics.gearboxType = cfg.gearbox;
    this.carMesh.setColor(cfg.carColor);
    this.avatarMesh.setAppearance(this.studio.appearance);
    this.avatarMesh.setNameAndHp(cfg.playerName, 100);
    this.save.data.playerName = cfg.playerName;
    this.save.data.characterId = cfg.characterId;
    this.save.data.carColor = cfg.carColor;
    this.save.data.gearbox = cfg.gearbox;
    this.save.scheduleSave();
    this.refreshProfile();

    if (cfg.mode === 'CIRCUIT_RACE') {
      this.startTimedCircuitRace(cfg.laps || 3);
    } else {
      this.spawnInOpenWorld();
    }
  }

  private bindMultiplayerEvents(): void {
    this.lobbyClient.onWorldState = (states) => {
      for (const [id, peer] of this.remotePeers.entries()) {
        if (!states[id]) {
          this.scene.remove(peer.carMesh.root);
          this.scene.remove(peer.charMesh.root);
          this.remotePeers.delete(id);
        }
      }

      for (const [id, st] of Object.entries(states)) {
        if (id === this.lobbyClient.clientId) continue;
        let peer = this.remotePeers.get(id);
        if (!peer) {
          const carM = new CarMesh();
          carM.setColor(st.carColor || '#2563eb');
          const charM = new AnimeCharacterMesh(st.characterId || 'mika', st.name || 'Friend', st.appearance);
          this.scene.add(carM.root);
          this.scene.add(charM.root);
          peer = { id, carMesh: carM, charMesh: charM, lastState: st };
          this.remotePeers.set(id, peer);
        } else if (st.appearance) {
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
      if (data.targetId === this.lobbyClient.clientId && !this.inCar) {
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

  private handlePlayerPunch(origin: THREE.Vector3, fwd: THREE.Vector3): void {
    this.sound.playGearShift();
    this.avatarMesh.triggerPunchVisual();

    // 1. Kick giant soccer ball if nearby
    if (origin.distanceTo(this.openWorld.ballPos) < this.openWorld.ballRadius + 2.2) {
      this.openWorld.ballVel.x += fwd.x * 16;
      this.openWorld.ballVel.z += fwd.z * 16;
      this.openWorld.ballVel.y += 6.5;
      this.particles.emitSparks(this.openWorld.ballPos, 8);
    }

    // 2. Hit Roaming Sparring Fighters
    for (const f of this.sparringFighters) {
      const toF = f.controller.position.clone().sub(origin);
      const d = Math.hypot(toF.x, toF.z);
      if (d < 2.5 && d > 0.01) {
        toF.y = 0;
        toF.normalize();
        if (toF.dot(fwd) > 0.05) {
          f.controller.takeDamage(25, fwd.x, fwd.z);
          this.sound.playCrash(28);
          this.particles.emitSparks(f.controller.position, 10);
          this.cameraShake = 0.14;
        }
      }
    }

    // 3. Hit Remote Hotspot Friends (PvP Brawl!)
    for (const [peerId, peer] of this.remotePeers.entries()) {
      if (peer.lastState.inCar) continue;
      const peerPos = peer.charMesh.root.position;
      const toP = peerPos.clone().sub(origin);
      const d = Math.hypot(toP.x, toP.z);
      if (d < 2.5 && d > 0.01) {
        toP.y = 0;
        toP.normalize();
        if (toP.dot(fwd) > 0.05) {
          this.lobbyClient.sendMeleeHit(peerId, 20, fwd.x, fwd.z);
          this.sound.playCrash(30);
          this.particles.emitSparks(peerPos, 12);
          this.cameraShake = 0.15;
        }
      }
    }
  }

  private toggleEnterExitCar(): void {
    if (this.gameState === GameState.COUNTDOWN) return;
    if (this.activities.activeSprint) {
      this.hud.showNotification('SPRINT IN PROGRESS', 'Finish the 1v1 before leaving the car!', 1.6);
      return;
    }

    if (this.inCar) {
      if (this.physics.speedKmh > 35) {
        this.hud.showNotification('BRAKE FIRST', 'Slow below 35 km/h to jump out!', 1.2);
        return;
      }
      this.inCar = false;
      const rgt = this.physics.getRightVector();
      const exitPos = this.physics.position.clone().addScaledVector(rgt, -1.9);
      this.charCtrl.resetAt(exitPos, this.physics.rotation.y);
      this.footCamYaw = this.physics.rotation.y;
      this.avatarMesh.root.visible = true;
      this.avatarMesh.root.position.copy(this.charCtrl.position);
      this.sound.updateTireSkid(0);
      this.hud.setOnFootMode(true, true, this.charCtrl.hp, this.physics.gearboxType);
      this.hud.showNotification('ON FOOT', 'Walk/Run • Fight [J] • Drive [F]', 1.8);
      this.setRivalPrompt(null);
    } else {
      const dist = Math.hypot(
        this.charCtrl.position.x - this.physics.position.x,
        this.charCtrl.position.z - this.physics.position.z
      );
      if (dist < 5.0) {
        this.inCar = true;
        this.avatarMesh.root.visible = false;
        this.hud.setOnFootMode(false, true, this.charCtrl.hp, this.physics.gearboxType);
        this.hud.showNotification('DRIVING', 'Drive to Green Gate on Track to Race!', 1.6);
        this.setRivalPrompt(this.nearbyRival);
      } else {
        this.hud.showNotification('TOO FAR', 'Walk closer to your Zenvo car!', 1.2);
      }
    }
  }

  private setupLighting(): void {
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.72);
    this.scene.add(this.ambientLight);

    this.sunLight = new THREE.DirectionalLight(0xfffbeb, 1.9);
    this.sunLight.position.set(80, 140, 60);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 340;

    const shadowDist = 55;
    this.sunLight.shadow.camera.left = -shadowDist;
    this.sunLight.shadow.camera.right = shadowDist;
    this.sunLight.shadow.camera.top = shadowDist;
    this.sunLight.shadow.camera.bottom = -shadowDist;
    this.sunLight.shadow.bias = -0.0004;

    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    this.hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x166534, 0.55);
    this.scene.add(this.hemiLight);
  }

  private setAtmosphere(tod: TimeOfDay): void {
    this.timeOfDay = tod;
    this.track.setTimeOfDay(tod);
    this.carMesh.setHeadlights(tod !== 'DAY');

    if (tod === 'SUNSET') {
      this.scene.fog = new THREE.FogExp2(0xfb923c, 0.0014);
      this.sunLight.color.setHex(0xfdba74);
      this.sunLight.intensity = 1.65;
      this.ambientLight.intensity = 0.55;
      this.hemiLight.color.setHex(0xfed7aa);
      this.hemiLight.groundColor.setHex(0x312e81);
      this.hemiLight.intensity = 0.5;
      this.renderer.toneMappingExposure = 1.12;
    } else if (tod === 'NIGHT') {
      this.scene.fog = new THREE.FogExp2(0x090d16, 0.0018);
      this.sunLight.color.setHex(0x93c5fd);
      this.sunLight.intensity = 0.52;
      this.ambientLight.intensity = 0.42;
      this.hemiLight.color.setHex(0x38bdf8);
      this.hemiLight.groundColor.setHex(0x090d16);
      this.hemiLight.intensity = 0.45;
      this.renderer.toneMappingExposure = 1.25;
    } else {
      this.scene.fog = new THREE.FogExp2(0x93c5fd, 0.0011);
      this.sunLight.color.setHex(0xfffbeb);
      this.sunLight.intensity = 1.9;
      this.ambientLight.intensity = 0.72;
      this.hemiLight.color.setHex(0xdbeafe);
      this.hemiLight.groundColor.setHex(0x166534);
      this.hemiLight.intensity = 0.55;
      this.renderer.toneMappingExposure = 1.08;
    }

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
    envScene.add(new THREE.Mesh(domeGeo, new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide })));

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    if (this.envRT) this.envRT.dispose();
    this.envRT = pmrem.fromScene(envScene, 0.04);
    this.scene.environment = this.envRT.texture;
    pmrem.dispose();
    tex.dispose();
    domeGeo.dispose();

    const todLabel = tod === 'DAY' ? 'Day' : (tod === 'SUNSET' ? 'Sunset' : 'Night');
    const todNameEl = document.getElementById('tod-name');
    if (todNameEl) todNameEl.textContent = todLabel;
    this.syncOptionSelection('.tod-options .option-btn', 'data-tod', tod);
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
  }

  private handleHornPressed(): void {
    this.sound.init();
    this.sound.playHorn();
    const origin = this.inCar ? this.physics.position : this.charCtrl.position;

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
    this.syncOptionSelection('.gearbox-options .option-btn', 'data-gearbox', this.physics.gearboxType);
    this.syncOptionSelection('.tod-options .option-btn', 'data-tod', this.timeOfDay);
    this.syncOptionSelection('.cam-options .option-btn', 'data-cam', this.cameraView);
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
      btn.style.opacity = unlocked ? '1' : '0.5';
    }
    el.style.display = 'flex';
  }

  private startNearbyRival(): void {
    const rival = this.nearbyRival;
    if (!rival) return;
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
    this.lapManager.resetRace(0);
    this.hud.showNotification(
      `${rival.rivalName.toUpperCase()} CHALLENGE`,
      `${rival.tauntStart} Follow the green gate!`,
      4.0
    );
  }

  private showRaceResults(stats: LapStats): void {
    this.gameState = GameState.FINISHED;
    this.physics.enforceTrackWalls = false;
    this.ghost.updatePlayback(false, 0);
    this.award(250, 300);
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

    document.getElementById('results-modal')!.classList.add('open');
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
      this.lobbyUI.setVisible(true);
    });

    document.getElementById('btn-studio')?.addEventListener('click', () => {
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
      if (this.inCar) {
        this.physics.resetToTrack();
      } else {
        this.charCtrl.resetAt(this.physics.position.clone().add(new THREE.Vector3(-2, 0, 0)), 0);
      }
      this.hud.showNotification('RESET', 'Returned to safe zone', 1.2);
    });

    const soundBtn = document.getElementById('btn-sound')!;
    soundBtn.addEventListener('click', () => {
      const muted = this.sound.toggleMute();
      soundBtn.style.opacity = muted ? '0.45' : '1.0';
      soundBtn.innerHTML = muted ? '<span>🔇</span><span>Muted</span>' : '<span>🔊</span><span>Audio</span>';
    });

    document.getElementById('res-again-btn')!.addEventListener('click', () => {
      this.startTimedCircuitRace(3);
    });
    document.getElementById('res-garage-btn')!.addEventListener('click', () => {
      document.getElementById('results-modal')!.classList.remove('open');
      this.gameState = GameState.OPEN_WORLD;
      this.physics.enforceTrackWalls = false;
      this.lapManager.resetRace(0);
    });

    const modal = document.getElementById('settings-modal')!;
    const openModal = () => {
      modal.classList.add('open');
      this.isPaused = true;
      this.sound.pauseAudio();
    };
    const closeModal = () => {
      modal.classList.remove('open');
      this.isPaused = false;
      this.sound.resumeAudio();
    };

    document.getElementById('btn-settings')!.addEventListener('click', openModal);
    document.getElementById('modal-close-btn')!.addEventListener('click', closeModal);
    document.getElementById('modal-resume-btn')!.addEventListener('click', closeModal);
    document.getElementById('modal-lobby-btn')!.addEventListener('click', () => {
      closeModal();
      this.lobbyUI.setVisible(true);
    });

    window.addEventListener('keydown', (e) => {
      if (this.hud.isTypingChat()) return;
      if (e.code === 'Escape') {
        if (modal.classList.contains('open')) closeModal();
        else openModal();
      }
      if (e.code === 'KeyV') cycleCam();
      if (e.code === 'KeyM') soundBtn.click();
      if (e.code === 'KeyY') this.startNearbyRival();
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
        this.hud.showNotification('BEST-LAP GHOST', on ? 'Ghost replay enabled' : 'Ghost replay disabled', 1.6);
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
        this.hud.showNotification('EUROBEAT', on ? 'Music channel on' : 'Music channel off', 1.4);
      });
    });

    document.getElementById('btn-start-rival')?.addEventListener('click', () => this.startNearbyRival());

    document.querySelectorAll('.assist-options .option-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const assist = btn.getAttribute('data-assist') as 'ARCADE' | 'PRO';
        this.physics.assistMode = assist;
        this.save.data.assistMode = assist;
        this.save.scheduleSave();
        this.syncOptionSelection('.assist-options .option-btn', 'data-assist', assist);
      });
    });
  }

  private syncOptionSelection(selector: string, attr: string, val: string): void {
    document.querySelectorAll(selector).forEach((el) => {
      el.classList.toggle('selected', el.getAttribute(attr) === val);
    });
  }

  private onResize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  private separateVehiclePair(a: CarPhysics, b: CarPhysics, withEffects: boolean): void {
    const minDist = 3.1;
    const dx = a.position.x - b.position.x;
    const dz = a.position.z - b.position.z;
    const dSq = dx * dx + dz * dz;
    if (dSq >= minDist * minDist || dSq <= 0.0001) return;

    const d = Math.sqrt(dSq);
    const nx = dx / d;
    const nz = dz / d;
    const overlap = (minDist - d) * 0.5;
    a.position.x += nx * overlap;
    a.position.z += nz * overlap;
    b.position.x -= nx * overlap;
    b.position.z -= nz * overlap;

    const rvx = a.velocity.x - b.velocity.x;
    const rvz = a.velocity.z - b.velocity.z;
    const relDot = rvx * nx + rvz * nz;
    if (relDot < 0) {
      const impulse = -relDot * 0.68;
      a.velocity.x += nx * impulse;
      a.velocity.z += nz * impulse;
      b.velocity.x -= nx * impulse;
      b.velocity.z -= nz * impulse;
      if (withEffects && Math.abs(relDot) > 5) {
        this.sound.playCrash(Math.abs(relDot) * 3.6);
        this.particles.emitSparks(a.position, 8);
      }
    }
  }

  private resolveCarVsCarCollisions(): void {
    const vehicles: CarPhysics[] = [
      this.physics,
      ...this.raceBots.map(b => b.physics),
      ...this.cityCruisers.map(c => c.physics),
      ...(this.activities.activeSprint ? [this.activities.activeSprint.rivalPhysics] : [])
    ];
    for (let i = 0; i < vehicles.length; i++) {
      for (let j = i + 1; j < vehicles.length; j++) {
        this.separateVehiclePair(vehicles[i], vehicles[j], i === 0);
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

    const dt = Math.min((currentTime - this.lastTime) * 0.001, 0.04);
    this.lastTime = currentTime;
    this.elapsedSec += dt;

    const focusPos = this.inCar ? this.physics.position : this.charCtrl.position;
    this.sunLight.position.set(focusPos.x + 70, focusPos.y + 120, focusPos.z + 50);
    this.sunLight.target.position.copy(focusPos);

    if (!this.isPaused) {
      const weatherForward = this.inCar ? this.physics.getForwardVector() : this.charCtrl.getForwardVector();
      this.weather.update(dt, focusPos, weatherForward);
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
          this.hud.showNotification(`${step}`, 'Rev your engine!', 0.9);
        }
        if (this.countdownTimer <= 0) {
          this.gameState = GameState.TIMED_RACE;
          this.track.setCountdownLights(5, true);
          this.sound.playBeep(1040, 0.32);
          this.hud.showNotification('GO!', 'Race Started — Hit All Cyan Gates!', 1.4);
        }
      }

      const isTimedRace = this.gameState === GameState.TIMED_RACE;
      const canDrive = this.gameState === GameState.OPEN_WORLD || this.gameState === GameState.TIMED_RACE;

      if (this.inCar) {
        const inputs = this.hud.pollInputs(this.physics.gearboxType);
        const prevGear = this.physics.gear;
        this.physics.update(dt, inputs, canDrive);

        if (isTimedRace) {
          this.ghost.recordStep(
            dt,
            this.lapManager.stats.currentLapTime,
            this.physics.position.x,
            this.physics.position.y,
            this.physics.position.z,
            this.physics.rotation.y,
            this.physics.rotation.x + this.physics.bodyPitch,
            this.physics.rotation.z + this.physics.bodyRoll,
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
          this.save.scheduleSave();
        }

        if (this.boostCooldown <= 0) {
          for (const pad of this.openWorld.boostPads) {
            if (Math.hypot(this.physics.position.x - pad.x, this.physics.position.z - pad.z) < pad.radius) {
              const fwd = this.physics.getForwardVector();
              this.physics.velocity.addScaledVector(fwd, 18);
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
        this.avatarMesh.updateAnimation(dt, 'IDLE');
      } else {
        // ON-FOOT ANIME CHARACTER
        const charInputs = this.hud.pollCharacterInputs();
        this.charCtrl.update(dt, charInputs, this.footCamYaw);

        // Character vs Parked Car Hull Collision
        const dx = this.charCtrl.position.x - this.physics.position.x;
        const dz = this.charCtrl.position.z - this.physics.position.z;
        const carRad = 1.75;
        const dSq = dx * dx + dz * dz;
        if (dSq < carRad * carRad && dSq > 0.0001) {
          const d = Math.sqrt(dSq);
          this.charCtrl.position.x = this.physics.position.x + (dx / d) * carRad;
          this.charCtrl.position.z = this.physics.position.z + (dz / d) * carRad;
        }

        this.avatarMesh.root.position.copy(this.charCtrl.position);
        this.avatarMesh.root.rotation.y = this.charCtrl.yaw;
        this.avatarMesh.updateAnimation(dt, this.charCtrl.animState);
        this.avatarMesh.setNameAndHp(this.lobbyUI.config.playerName, this.charCtrl.hp);

        this.physics.update(dt, { throttle: 0, brake: 1, steer: 0, handbrake: true, clutch: false, shiftUp: false, shiftDown: false, reset: false }, false);
        this.carMesh.update(this.physics, 0, dt);
        this.sound.updateEngineSound(1000, 9500, 0, false, false, 0);
        this.sound.updateTireSkid(0);

        const nearCar = Math.hypot(
          this.charCtrl.position.x - this.physics.position.x,
          this.charCtrl.position.z - this.physics.position.z
        ) < 5.0;
        this.hud.setOnFootMode(true, nearCar, this.charCtrl.hp, this.physics.gearboxType);
      }

      // Lap timer ticks even when player is on foot during a timed race
      if (isTimedRace && !this.inCar) {
        this.lapManager.update(dt, this.physics.position, false, 0, 0, this.weather.driftScoreMultiplier);
        this.ghost.updatePlayback(false, this.lapManager.stats.currentLapTime);
      }

      // Check proximity to In-World GP Race Start Portal (0, 0, -4)
      const activePos = this.inCar ? this.physics.position : this.charCtrl.position;

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
        && !this.activities.activeSprint
        && Math.hypot(activePos.x - 0, activePos.z - (-4)) < 14;
      this.hud.setRacePrompt(nearStartGate);

      // Update Checkpoint Portal Visuals
      this.track.updateCheckpointVisuals(this.lapManager.nextCheckpointIndex, isTimedRace, this.elapsedSec);

      // Update AI Race Bots (roaming freely in Open World, or racing in Timed Race!)
      const allTrackCars = [this.physics.position, ...this.raceBots.map(b => b.physics.position)];
      const playerProg = isTimedRace ? this.computePlayerProgress() : undefined;
      for (const bot of this.raceBots) {
        bot.update(dt, canDrive, allTrackCars, playerProg);
      }

      // Update Friendly City Traffic Cruisers
      const cityPositions = this.cityCruisers.map(c => c.physics.position);
      const footRef = !this.inCar ? this.charCtrl.position : null;
      for (const cruiser of this.cityCruisers) {
        cruiser.update(dt, this.physics.position, footRef, cityPositions);
      }

      this.resolveCarVsCarCollisions();

      // Update City Sparring Fighters
      for (const f of this.sparringFighters) {
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

    this.updateCamera(dt);

    const playerMarker = this.inCar
      ? { x: this.physics.position.x, z: this.physics.position.z, yaw: this.physics.rotation.y }
      : { x: this.charCtrl.position.x, z: this.charCtrl.position.z, yaw: this.charCtrl.yaw };

    const extraMarkers: MinimapActor[] = [
      ...this.raceBots.map(b => ({ x: b.physics.position.x, z: b.physics.position.z, color: '#facc15' })),
      ...this.cityCruisers.map(c => ({ x: c.physics.position.x, z: c.physics.position.z, color: '#38bdf8' })),
      ...Array.from(this.remotePeers.values()).map(p => ({
        x: p.lastState.inCar ? p.lastState.carX : p.lastState.x,
        z: p.lastState.inCar ? p.lastState.carZ : p.lastState.z,
        color: '#4ade80'
      }))
    ];

    this.hud.render(
      this.physics,
      this.lapManager,
      this.track,
      dt,
      playerMarker,
      this.gameState === GameState.TIMED_RACE,
      this.computeRacePositionText(),
      extraMarkers
    );
    this.renderer.render(this.scene, this.camera);
  }

  private updateCamera(dt: number): void {
    if (this.cameraShake > 0) {
      this.cameraShake = Math.max(0, this.cameraShake - dt * 1.6);
    }

    if (!this.inCar) {
      const cPos = this.charCtrl.position;

      // Dedicated Studio turntable showcase angle when Character Studio drawer is open
      if (this.studio.isOpen) {
        this.camera.fov = 44;
        this.camera.updateProjectionMatrix();
        const fwd = this.charCtrl.getForwardVector();
        const rgt = new THREE.Vector3(-fwd.z, 0, fwd.x);
        const focus = new THREE.Vector3(cPos.x + rgt.x * 0.55, cPos.y + 1.08, cPos.z + rgt.z * 0.55);
        const camWanted = new THREE.Vector3(
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

      this.camera.fov = 62;
      this.camera.updateProjectionMatrix();

      const dist = 4.4;
      const focusPt = new THREE.Vector3(cPos.x, cPos.y + 1.35, cPos.z);
      const rawCam = new THREE.Vector3(
        cPos.x + Math.sin(this.footCamYaw) * dist,
        cPos.y + 2.15,
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
      const targetFov = 62 + Math.min(20, (speedKmh / 280) * 20);
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 7, dt);
      this.camera.updateProjectionMatrix();

      const posAlpha = 1 - Math.exp(-10 * dt);
      const lookAlpha = 1 - Math.exp(-14 * dt);

      // Drift corner-peek: blend car forward with travel direction at speed so apex stays visible
      const camDir = forward.clone();
      const speedMs = Math.hypot(this.physics.velocity.x, this.physics.velocity.z);
      if (speedMs > 7 && this.physics.forwardVelocity > 2) {
        const velDir = new THREE.Vector3(this.physics.velocity.x, 0, this.physics.velocity.z).normalize();
        camDir.lerp(velDir, 0.28).normalize();
      }

      const targetCamPos = carPos.clone().addScaledVector(camDir, -6.2).addScaledVector(up, 2.25);
      this.chaseCamPos.lerp(targetCamPos, posAlpha);
      this.camera.position.copy(this.chaseCamPos);

      if (this.cameraShake > 0) {
        this.camera.position.x += (Math.random() - 0.5) * this.cameraShake;
        this.camera.position.y += (Math.random() - 0.5) * this.cameraShake;
      }

      const targetLook = carPos.clone().addScaledVector(camDir, 3.4).addScaledVector(up, 0.85);
      this.chaseCamLook.lerp(targetLook, lookAlpha);
      this.camera.lookAt(this.chaseCamLook);
    } else if (this.cameraView === CameraView.HOOD) {
      this.camera.fov = 74;
      this.camera.updateProjectionMatrix();

      const hoodPos = carPos.clone().addScaledVector(forward, 0.65).addScaledVector(up, 1.05);
      this.camera.position.copy(hoodPos);
      const hoodLook = carPos.clone().addScaledVector(forward, 35).addScaledVector(up, 0.9);
      this.camera.lookAt(hoodLook);
    } else if (this.cameraView === CameraView.ORBIT) {
      this.camera.fov = 52;
      this.camera.updateProjectionMatrix();

      this.orbitAngle += dt * 0.3;
      const dist = 7.0;
      const ox = carPos.x + Math.sin(this.orbitAngle) * dist;
      const oz = carPos.z + Math.cos(this.orbitAngle) * dist;
      const oy = carPos.y + 2.1;

      this.camera.position.set(ox, oy, oz);
      this.camera.lookAt(carPos.x, carPos.y + 0.75, carPos.z);
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new GameApp();
});
