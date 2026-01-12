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
    // Radii (world units; SoftBody converts to local via mesh scale)
    influenceRadius: 100,    // Increased range
    horizonRadius: 8,        // Larger event horizon
    softening: 1.0,          // Less softening = stronger pull

    // Field / motion
    gravity: 1.2,            // Stronger inverse-square pull
    maxAccel: 2.0,           // Higher max acceleration
    swirlSpeed: 0.8,         // More swirl
    tidal: 1.0,              // Stronger spaghettification
    horizonPull: 0.6,        // Faster collapse inside horizon

    // Legacy (for backwards compatibility)
    spaghettification: 0.5
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
    { name: "0", dprCap: 2.0, mpEvery: 1, hudEvery: 1, physicsEvery: 1, sparkSpawn: 6, sparkCount: 140 },
    { name: "1", dprCap: 2.0, mpEvery: 2, hudEvery: 1, physicsEvery: 1, sparkSpawn: 4, sparkCount: 120 },
    { name: "2", dprCap: 1.75, mpEvery: 3, hudEvery: 1, physicsEvery: 2, sparkSpawn: 2, sparkCount: 90 }
];
