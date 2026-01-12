import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';

export const CFG = {
    radius: 8,
    spring: 0.035,
    pushRange: 7.8,
    pinchThreshold: 0.15,
    gripRange: 15,
    gripStrength: 0.95,
    ghostTimeout: 3000,
    handScale: 1.0
};

export const BLACK_HOLE = {
    // dynamics (Cinematic Physics)
    mass: 1050,        // Less acceleration at distance
    spin: 0.75,        // Reduced spin for stability
    drag: 0.22,        // Less drag -> longer orbits
    maxAccel: 120,     // Clamp for stability
    eps: 3.6,          // Softer center
    influenceRadius: 95,

    // tidal (spaghettification)
    tidalStrength: 1.25,
    tidalRadius: 22,

    // absorption / tunnel
    horizonRadius: 6.5,
    absorbRadius: 15,
    absorbRate: 0.55,  // Slower fade
    shrinkRate: 0.06,  // Slower shrink
    tunnelDepth: 16,   // Reduced Z-pull per frame

    // VISUALS
    accretion: {
        enabled: true,
        particles: 520,          // tier 0
        innerR: 8,
        outerR: 34,
        thickness: 2.2,
        spiralIn: 0.55,
        orbitSpeed: 2.4,
        turbulence: 0.35,
        heatGain: 1.1,
        absorbFade: 1.4,
        size: 0.9
    },
    lensing: {
        enabled: true,
        strength: 0.35,
        radius: 28,
        feather: 16
    },
    rayCount: 8, // Base ray count for HUD
    jets: {
        enabled: true,
        particles: 120,
        length: 60,
        speed: 14,
        jitter: 0.35,
        size: 0.7,
        pulse: 0.6
    }
};

// Low-light mode settings for improved detection in dark conditions
export const LOW_LIGHT = {
    enabled: false,
    brightness: 2.2,        // Very strong brightness boost
    contrast: 1.8,          // High contrast
    saturation: 1.3,        // Boost colors
    minDetectionConfidence: 0.1,   // Very low threshold
    minTrackingConfidence: 0.1
};

// M1/Apple Silicon optimization settings
export const M1_MODE = {
    enabled: false,
    throttleMs: 80,         // ~12 FPS for MediaPipe (reduces GPU load significantly)
    modelComplexity: 0,     // 0 = lite, 1 = full (lite is better for M1)
    autoDetect: true        // Auto-detect Apple Silicon
};

export const STATE = {
    hands: {},
    ghosts: {},
    grabs: {},
    ar: false,
    lastChatAt: 0,
    stressEMA: 0,
    streamReady: false,
    tier: 0,
    fpsAvg: 60,
    sphereVelocity: new THREE.Vector3(),
    recording: false,
    recordedPath: [],
    lastGesture: null,
    gestureTimeout: 0,
    twoHandData: null,
    voiceActive: false,
    calibrated: false,
    calibrationData: null,
    mode: 'NORMAL', // NORMAL or SINGULARITY
    blackHolePull: 0,
    blackHolePos: new THREE.Vector3(),
    globalTunnelFactor: 0,
    clenchStage: 0,
    lastTextTime: 0,
    fistHoldStart: null
};

export const QUALITY = [
    { name: "0", dprCap: 2.0, mpEvery: 1, hudEvery: 1, physicsEvery: 1, sparkSpawn: 6, sparkCount: 140, kRayCount: 8, kDiskParticles: 520 },
    { name: "1", dprCap: 2.0, mpEvery: 2, hudEvery: 1, physicsEvery: 1, sparkSpawn: 4, sparkCount: 120, kRayCount: 5, kDiskParticles: 360 },
    { name: "2", dprCap: 1.75, mpEvery: 3, hudEvery: 1, physicsEvery: 2, sparkSpawn: 2, sparkCount: 90, kRayCount: 3, kDiskParticles: 220 }
];
