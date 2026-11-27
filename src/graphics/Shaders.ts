import * as THREE from 'three';

export interface AnimeSkyUniforms {
  [uniform: string]: THREE.IUniform;
  uTime: THREE.IUniform<number>;
  uTopColor: THREE.IUniform<THREE.Color>;
  uMidColor: THREE.IUniform<THREE.Color>;
  uHorizonColor: THREE.IUniform<THREE.Color>;
  uSunDir: THREE.IUniform<THREE.Vector3>;
  uSunColor: THREE.IUniform<THREE.Color>;
  uCloudLitColor: THREE.IUniform<THREE.Color>;
  uCloudShadowColor: THREE.IUniform<THREE.Color>;
  uStarIntensity: THREE.IUniform<number>;
}

export function createAnimeSkyMaterial(): {
  material: THREE.ShaderMaterial;
  uniforms: AnimeSkyUniforms;
} {
  const uniforms: AnimeSkyUniforms = {
    uTime: { value: 0 },
    uTopColor: { value: new THREE.Color('#0f2d5e') },
    uMidColor: { value: new THREE.Color('#3b82f6') },
    uHorizonColor: { value: new THREE.Color('#bae6fd') },
    uSunDir: { value: new THREE.Vector3(0.45, 0.35, -0.82).normalize() },
    uSunColor: { value: new THREE.Color('#fffbeb') },
    uCloudLitColor: { value: new THREE.Color('#ffffff') },
    uCloudShadowColor: { value: new THREE.Color('#93c5fd') },
    uStarIntensity: { value: 0.0 }
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vWorldDir;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        // The dome is anchored at the origin, but shading must follow the eye:
        // using local position makes the sun/cloud field swim while driving.
        vWorldDir = worldPos.xyz - cameraPosition;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vWorldDir;
      uniform float uTime;
      uniform vec3 uTopColor;
      uniform vec3 uMidColor;
      uniform vec3 uHorizonColor;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uCloudLitColor;
      uniform vec3 uCloudShadowColor;
      uniform float uStarIntensity;

      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      float noise2D(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash21(i);
        float b = hash21(i + vec2(1.0, 0.0));
        float c = hash21(i + vec2(0.0, 1.0));
        float d = hash21(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }

      float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
        for (int i = 0; i < 4; i++) {
          v += a * noise2D(p);
          p = rot * p * 2.05;
          a *= 0.5;
        }
        return v;
      }

      void main() {
        vec3 dir = normalize(vWorldDir);
        float h = clamp(dir.y, 0.0, 1.0);

        // Multi-stop Makoto Shinkai style sky gradient
        vec3 sky = mix(uHorizonColor, uMidColor, smoothstep(0.0, 0.24, h));
        sky = mix(sky, uTopColor, smoothstep(0.22, 0.85, h));

        // Atmospheric sun/moon glow + crisp disc
        float sunDot = max(dot(dir, normalize(uSunDir)), 0.0);
        float halo = pow(sunDot, 12.0) * 0.45 + pow(sunDot, 90.0) * 0.65;
        float disc = smoothstep(0.9978, 0.9988, sunDot);
        sky += uSunColor * (halo + disc * 1.6);

        // Twinkling stars at night
        if (uStarIntensity > 0.01 && dir.y > 0.05) {
          vec2 starUv = dir.xz / (dir.y + 0.35) * 38.0;
          vec2 id = floor(starUv);
          vec2 gv = fract(starUv) - 0.5;
          float rnd = hash21(id);
          if (rnd > 0.92) {
            float d = length(gv);
            float twinkle = 0.55 + 0.45 * sin(uTime * 3.0 + rnd * 40.0);
            float star = smoothstep(0.14, 0.02, d) * twinkle * smoothstep(0.05, 0.3, dir.y);
            sky += vec3(0.85, 0.93, 1.0) * star * uStarIntensity;
          }
        }

        // Stylized Cel-Shaded Anime Cumulus Clouds
        if (dir.y > 0.035) {
          vec2 cloudUv = dir.xz / (dir.y + 0.22) * 1.45;
          cloudUv += vec2(uTime * 0.012, uTime * 0.005);
          float n1 = fbm(cloudUv);
          float n2 = fbm(cloudUv * 2.1 + vec2(3.1, -1.7));
          float density = n1 * 0.72 + n2 * 0.28;

          float cloudMask = smoothstep(0.49, 0.54, density) * smoothstep(0.035, 0.16, dir.y);
          float shadeBand = smoothstep(0.54, 0.68, density + sunDot * 0.12);
          float silverRim = smoothstep(0.47, 0.52, density) * (1.0 - smoothstep(0.52, 0.58, density)) * (0.4 + 0.6 * pow(sunDot, 3.0));

          vec3 cloudCol = mix(uCloudShadowColor, uCloudLitColor, shadeBand);
          cloudCol += uSunColor * silverRim * 0.65;
          sky = mix(sky, cloudCol, cloudMask * 0.92);
        }

        // Horizon haze blend so distant terrain melts smoothly
        float horizonHaze = exp(-abs(dir.y) * 9.5);
        sky = mix(sky, uHorizonColor, horizonHaze * 0.42);

        gl_FragColor = vec4(sky, 1.0);
      }
    `
  });

  return { material, uniforms };
}

export interface AnimeWaterUniforms {
  [uniform: string]: THREE.IUniform;
  uTime: THREE.IUniform<number>;
  uShallowColor: THREE.IUniform<THREE.Color>;
  uDeepColor: THREE.IUniform<THREE.Color>;
  uFoamColor: THREE.IUniform<THREE.Color>;
  uSunDir: THREE.IUniform<THREE.Vector3>;
  uSunColor: THREE.IUniform<THREE.Color>;
  uShoreRadius: THREE.IUniform<number>;
}

export function createAnimeWaterMaterial(shoreRadius = 82.0): {
  material: THREE.ShaderMaterial;
  uniforms: AnimeWaterUniforms;
} {
  const uniforms: AnimeWaterUniforms = {
    uTime: { value: 0 },
    uShallowColor: { value: new THREE.Color('#06b6d4') },
    uDeepColor: { value: new THREE.Color('#0c4a6e') },
    uFoamColor: { value: new THREE.Color('#e0f2fe') },
    uSunDir: { value: new THREE.Vector3(0.45, 0.35, -0.82).normalize() },
    uSunColor: { value: new THREE.Color('#fef3c7') },
    uShoreRadius: { value: shoreRadius }
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    // Alpha-blended water must not occlude other transparent FX behind it.
    depthWrite: false,
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vWorldPos;
      varying vec2 vLocalXZ;
      varying float vWave;

      void main() {
        vec3 pos = position;
        vec4 worldPos = modelMatrix * vec4(pos, 1.0);
        float wave = sin(worldPos.x * 0.14 + uTime * 1.8) * 0.12
                   + cos(worldPos.z * 0.17 - uTime * 1.45) * 0.10;
        worldPos.y += wave;
        vWorldPos = worldPos.xyz;
        vLocalXZ = pos.xz;
        vWave = wave;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uShallowColor;
      uniform vec3 uDeepColor;
      uniform vec3 uFoamColor;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform float uShoreRadius;

      varying vec3 vWorldPos;
      varying vec2 vLocalXZ;
      varying float vWave;

      float wavePattern(vec2 p) {
        float a = sin(p.x * 0.45 + uTime * 1.5 + sin(p.y * 0.32 - uTime * 0.9));
        float b = cos(p.y * 0.52 - uTime * 1.2 + cos(p.x * 0.28 + uTime * 1.1));
        return (a + b) * 0.5;
      }

      void main() {
        float distCenter = length(vLocalXZ);
        float edgeFactor = uShoreRadius > 0.0
          ? clamp(distCenter / uShoreRadius, 0.0, 1.0)
          : 0.45;

        // Stepped anime depth bands
        float depthMix = smoothstep(0.15, 0.88, 1.0 - edgeFactor * 0.72);
        vec3 baseCol = mix(uShallowColor, uDeepColor, depthMix);

        // Stylized animated caustics grid
        float c1 = wavePattern(vWorldPos.xz * 0.55);
        float c2 = wavePattern(vWorldPos.xz * 0.85 + vec2(4.2, -3.1));
        float caustic = smoothstep(0.62, 0.82, abs(c1 + c2) * 0.55);
        baseCol = mix(baseCol, uFoamColor, caustic * 0.28);

        // Sun/Moon specular shimmer ripples
        vec3 n = normalize(vec3(
          cos(vWorldPos.x * 0.35 + uTime * 2.0) * 0.18,
          1.0,
          sin(vWorldPos.z * 0.35 - uTime * 1.7) * 0.18
        ));
        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        vec3 halfDir = normalize(normalize(uSunDir) + viewDir);
        float spec = pow(max(dot(n, halfDir), 0.0), 42.0);
        baseCol += uSunColor * spec * 0.85;

        // Crisp shoreline foam ring
        if (uShoreRadius > 0.0) {
          float foamBand = smoothstep(0.87, 0.96, edgeFactor + vWave * 0.22);
          baseCol = mix(baseCol, uFoamColor, foamBand * 0.82);
        }

        gl_FragColor = vec4(baseCol, 0.91);
      }
    `
  });

  return { material, uniforms };
}

/** Screen-space Anime Speed Lines + Nitro Chromatic Aberration + Drift Heat Vignette */
export const SpeedLinesShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uSpeedNorm: { value: 0 },
    uNitro: { value: 0 },
    uDriftHeat: { value: 0 }
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uSpeedNorm;
    uniform float uNitro;
    uniform float uDriftHeat;
    varying vec2 vUv;

    float hash(float n) { return fract(sin(n) * 43758.5453123); }

    void main() {
      vec2 centered = vUv - 0.5;
      float dist = length(centered);
      vec2 dir = dist > 0.0001 ? centered / dist : vec2(0.0);

      // Radial Chromatic Aberration during Nitro & Extreme Speed
      float chromaStrength = (uNitro * 0.0075 + max(0.0, uSpeedNorm - 0.6) * 0.004) * dist;
      float r = texture2D(tDiffuse, vUv + dir * chromaStrength).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv - dir * chromaStrength).b;
      vec3 col = vec3(r, g, b);

      // Anime Manga Speed Lines around screen periphery
      float lineIntensity = clamp(uNitro * 0.85 + max(0.0, uSpeedNorm - 0.55) * 1.15, 0.0, 1.0);
      if (lineIntensity > 0.02 && dist > 0.28) {
        float angle = atan(centered.y, centered.x);
        float sector = floor(angle * 48.0);
        float rnd = hash(sector + floor(uTime * 22.0) * 0.13);
        float streak = smoothstep(0.74, 0.96, rnd) * smoothstep(0.28, 0.68, dist);
        vec3 lineCol = mix(vec3(0.85, 0.95, 1.0), vec3(0.22, 0.82, 1.0), uNitro);
        col = mix(col, lineCol, streak * lineIntensity * 0.42);
      }

      // Drift Combo / Nitro Edge Vignette
      float edgeMask = smoothstep(0.36, 0.82, dist);
      vec3 driftGlow = vec3(1.0, 0.48, 0.08) * uDriftHeat * 0.34;
      vec3 nitroGlow = vec3(0.08, 0.72, 1.0) * uNitro * 0.25;
      col += (driftGlow + nitroGlow) * edgeMask;

      gl_FragColor = vec4(col, 1.0);
    }
  `
};
