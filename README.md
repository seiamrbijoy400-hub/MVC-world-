# Realistic Racing Game - Offline Edition 🏎️💨

An offline 3D racing simulator inspired by [PaulinaCzapla/Realistic-Racing-Game](https://github.com/PaulinaCzapla/Realistic-Racing-Game), built using **Three.js**, **Web Audio API**, and **TypeScript**.

Playable offline on mobile (Android) and desktop browsers with realistic supercar driving physics, Ackermann steering, anti-roll stabilization, drift dynamics, and multi-mode transmissions.

---

## ✨ Features

### 🚗 Vehicle Physics & Mechanics
- **Zenvo TS1 Supercar**: Calibrated mass (1450 kg), 2.65m wheelbase, 1.65m track width, and low center of gravity.
- **Ackermann Steering Geometry**: Implements true inner/outer wheel turning angle divergence based on axle separation and width.
- **Speed-Sensitive Steering**: Dynamic steering angle attenuation (36° at low speeds down to 10° at 250 km/h) prevents twitchy rollovers.
- **Anti-Roll Bar System**: Transfers suspension compression loads between left and right wheels (`(travelL - travelR) * rollForce`) to suppress roll.
- **Supercharged V8 Powertrain**:
  - Idle: 1,000 RPM · Peak Torque: 6,000 RPM · Redline: 8,200 RPM · Rev Limiter: 9,500 RPM with limiter cut-off bouncing.
  - 6 Forward Gears + Reverse: R (-3.4), 1st (3.82), 2nd (2.36), 3rd (1.68), 4th (1.31), 5th (1.00), 6th (0.79), Final Drive (3.44).
- **Three Gearbox Modes**:
  - **Automatic (AUTO)**: Intelligent upshifts at 7,800 RPM and downshifts below 2,700 RPM.
  - **Semi-Automatic (SEMI)**: Paddle / button manual gear shifting (`E` / `Q`) without clutch.
  - **Manual (MANUAL)**: Requires clutch depression (`C` key or touch pedal) to shift gears.
- **Drift Controller**: Handbrake (`Space` or on-screen Drift button) drops rear lateral tire friction from 1.0 to 0.35, enabling smooth, controllable power oversteer and counter-steering drifts.

### 🏁 Grand Prix Lake Circuit
- High-speed grand prix track inspired by the original `race-track-lake` asset.
- Features high-speed straightaways, chicane S-curves, sweeping banked corners, and a drift hairpin.
- Red & white striped rumble curbs on corner apexes.
- Orange impact safety barriers and guardrails.
- Surrounding scenery: deep blue lake, mountain rock formations, and pine trees.
- Start / Finish gantry with timing lights and checkerboard starting grid.

### ⏱️ Lap Timing & Checkpoints
- Real-time lap timing (`MM:SS.ms`), current lap, and best lap records.
- Multi-checkpoint sector splits (Start/Finish, Sector 1, Sector 2, Sector 3).
- Anti-shortcut verification and reset-to-track checkpoint respawn.

### 🎨 Visual & Particle Effects
- Detailed 3D Zenvo TS1 supercar body with active aerodynamic rear wing/spoiler (acts as airbrake during heavy braking).
- 4 customizable paint color finishes: **Zenvo Sunset Orange**, **Championship Red**, **Electric Riviera Blue**, **Stealth Matte Black**, and **Speed Yellow**.
- Front wheels visibly articulate with Ackermann angles; all 4 wheels spin relative to velocity.
- Red brake light illumination during deceleration and white reverse lights.
- Tire smoke particle emitters during drifts and wheelspins.
- Persistent black rubber skidmark trails laid down on the asphalt.
- High-RPM exhaust backfire flame bursts.

### 🧍 Rigged Characters & Crowd
- Player, sparring fighters and hotspot peers use rigged GLB humans (male business-man / female low-poly girl) with their own idle/walk/run/jump clips.
- Punch, hit-recoil and KO poses are layered procedurally on top of the rigs; pedestrians alternate both rigs with distinct outfit/hair/skin tints and body scales.
- Geometry, textures and clips are shared across all characters; only materials and animation mixers are per-instance. Procedural characters remain as an automatic fallback if a GLB fails to load.
- Character GLBs are CC BY 4.0 by manoeldarochadeoliveira — credited in-game in Settings and in `docs/ASSET_LICENSES.md`.

### 🔊 Dynamic Audio Synthesis
- 100% offline Web Audio synthesizer simulating V8 harmonic firing frequencies matched to exact engine RPM.
- Throttle load growl and exhaust deceleration crackles / pops.
- Resonant bandpass-filtered tire screech synthesizer scaling with lateral slip.
- Barrier collision impact sounds and checkpoint notification beeps.
- Optional Eurobeat soundtrack with one-tap audio mute.

### 🥊 Street Life: Combat, Police & Car Theft
- **Real knockdowns**: Sparring fighters have HP, stagger, and a 24-second KO before walking back in. The player has HP too — lose it and you get a **WASTED** overlay and revive at the South Junction.
- **Heat & wanted stars**: Assault and grand theft auto raise a 0–5 wanted level. Police cruisers spawn from the city ring, chase, ram, and arrest you on foot. Lay low far from them to let heat decay.
- **Busted flow**: Get caught on foot and you pay a fine scaled to your wanted level, then get released at the plaza with your heat cleared.
- **Car theft**: Parked civilian cars around Neo Velo can be hotwired on foot. A stolen car becomes your active ride and can be parked and re-entered later — just lose the cops first.
- **Human-scale characters**: Procedural realistic build with natural proportions, sculpted skull, ears, brows, nose, lips, fingers, cloth seams, and PBR fabric/skin shading (no cel outlines, no anime eyes).

### 🎮 Controls & HUD
- **Analog Tachometer & Speedometer**: Smooth 60fps canvas gauge with glowing needle, redline alert, digital gear numeral, and km/h speed readout.
- **Live Minimap Radar**: Overhead track layout showing checkpoints and real-time player orientation.
- **Telemetry Bars**: Real-time visual feedback for throttle, brake, and clutch pressure.
- **3 Camera Views**: Chase Cam (with speed-sensitive dynamic FOV), Cockpit / Hood Cam, and Orbit Cam.
- **Full Input Support**:
  - **Keyboard**: `W`/`S` (Throttle/Brake), `A`/`D` (Steer), `Space` (Handbrake), `E`/`Q` (Gear Shift), `C` (Clutch), `R` (Reset), `V` (Camera), `M` (Mute), `Y` (Rival Challenge), `F` (Enter/Exit or Steal Car), `J` (Punch), `Esc` (Settings).
  - **Mobile Touch**: Left/Right steering pads, Gas, Brake, Drift, Shift Up/Down buttons.
  - **Gamepad**: Analog triggers and steering sticks mapped via HTML5 Gamepad API.
- **Legend Progression**: XP, credits, six Legend ranks, speed-trap and drift-zone records, Apex Logs, and a four-rival ladder — all saved locally.
- **Dynamic Weather**: Clear / Rain / Storm, with real grip loss, wet asphalt, lightning, and drift-score bonuses.
- **Best-Lap Ghost**: your fastest lap is recorded and replays beside you on the next attempt.

---

## 🚀 How to Run

From this project directory:

```bash
# Start local development server
pnpm dev

# Or run the built production preview
pnpm preview
```

Open `http://localhost:5173` in your browser to start racing!
