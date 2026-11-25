# Building a Real Android APK (APEX ZERO: Neon Velo)

The in-game "Download APK" button only appears when `window.__APK_URL__` is set in `index.html`.
To produce a real APK, wrap the web build with Capacitor on a machine with the Android SDK:

```bash
# 1. Install Capacitor
pnpm add @capacitor/core @capacitor/cli @capacitor/android

# 2. Init (once)
npx cap init "APEX ZERO" "com.apexzero.neonvelo" --web-dir dist

# 3. Build the web bundle
pnpm build

# 4. Add Android platform
npx cap add android

# 5. Sync web assets into Android project
npx cap sync

# 6. Build APK (requires Android SDK + Java)
cd android && ./gradlew assembleDebug
# APK lands at android/app/build/outputs/apk/debug/app-debug.apk
```

Then host the APK (e.g. GitHub Releases) and set in `index.html`:

```html
<script>window.__APK_URL__ = "https://github.com/.../app-debug.apk";</script>
```

The "Download APK" button will automatically appear in the lobby.

Notes:
- Bluetooth/Nearby multiplayer in a real APK needs a native plugin (e.g. `@capacitor-community/bluetooth-le` or the Android Nearby Connections API) wired into `LobbyClient` instead of the WebSocket path.
- The web (PWA) build remains the primary, always-available install path via "Install App".
EOF
echo done