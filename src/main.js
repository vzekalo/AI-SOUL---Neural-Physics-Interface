import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';
import { CFG, STATE, QUALITY, LOW_LIGHT, M1_MODE, BLACK_HOLE } from './config.js';
import { setupScene } from './visuals/SceneSetup.js';
import { HandTracker } from './input/HandTracker.js';
import { PhysicsWorld } from './physics/PhysicsWorld.js';
import { HUD } from './visuals/HUD.js';
import { NeuralNet } from './visuals/NeuralNet.js';
import { SparkSystem } from './visuals/Particles.js';
import { Tuner } from './visuals/Tuner.js';
import { AudioManager } from './core/AudioManager.js';
import { HapticEngine } from './core/HapticEngine.js';
import { GestureRecognizer } from './input/Gestures.js';
import { VoiceCommand } from './input/Voice.js';
import { Calibration } from './core/Calibration.js';
import { RecordingSystem } from './core/RecordingSystem.js';
import { LinePicker } from './core/SoulDB.js';
import { TwoHandInteraction } from './utils/TwoHandInteraction.js';
import { getScreenPos, get3DFromScreen, clamp01 } from './utils/MathUtils.js';

// --- DOM ELEMENTS ---
const $ = (id) => document.getElementById(id);
const el = {
    start: $("start-screen"),
    btnStart: $("btn-start"),
    vRaw: $("webcam-feed"),
    vAR: $("ar-video"),
    hud: $("hud-canvas"),
    gl: $("gl-canvas"),
    chat: $("chat"),
    fps: $("fps"),
    qTier: $("q-tier"),
    menuFab: $("menu-fab"),
    menuSubmenu: $("menu-submenu"),
    btnAr: $("btn-ar"),
    btnInfo: $("btn-info"),
    btnLowLight: $("btn-lowlight"),
    btnTuning: $("btn-tuning"),
    infoPanel: $("info-panel"),
    hudStatus: $("hud-status")
};

// --- SUBSYSTEMS ---
const { scene, camera, renderer } = setupScene(el.gl);
const audio = new AudioManager();
window.audio = audio; // Expose for physics triggers
const tracker = new HandTracker();
const hud = new HUD(el.hud, el);
const sparks = new SparkSystem(scene);
const gestures = new GestureRecognizer();
const calibration = new Calibration(postLine);
const recorder = new RecordingSystem(postLine);
const messenger = new LinePicker();
const twoHand = new TwoHandInteraction();
const tuner = new Tuner(STATE, BLACK_HOLE); // Press 'T' to toggle

// Hand smoothing (EMA filter for trembling fix)
const smoothedHands = {};
const SMOOTH_FACTOR = 0.35; // 0 = no smoothing, 1 = frozen

// --- CORE MESHES ---
const geo = new THREE.IcosahedronGeometry(CFG.radius, window.innerWidth < 800 ? 4 : 5);
geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3));
const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    wireframe: true,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending
});
const sphere = new THREE.Mesh(geo, mat);
scene.add(sphere);

const neural = new NeuralNet(scene);
const physics = new PhysicsWorld(scene, sphere, neural);
physics.initARObjects();

// --- VOICE ---
const voice = new VoiceCommand({
    'запис': () => { STATE.recording = !STATE.recording; postLine(STATE.recording ? '> Запис...' : '> Запис зупинено'); },
    'стоп': () => { STATE.recording = false; postLine('> Стоп'); },
    'скинути': () => { sphere.scale.setScalar(1); postLine('> Скинути розмір'); },
    'більше': () => { sphere.scale.multiplyScalar(1.2); HapticEngine.pulse(30); },
    'менше': () => { sphere.scale.multiplyScalar(0.8); HapticEngine.pulse(30); },
    'колір': () => {
        const hue = Math.random();
        mat.color.setHSL(hue, 1, 0.5);
        physics.arObjects.forEach(obj => obj.material.color.setHSL((hue + 0.5) % 1.0, 1, 0.5));
        postLine('> Колір змінено');
    },
    'червоний': () => { mat.color.setHex(0xff0000); postLine('> Червоний'); },
    'синій': () => { mat.color.setHex(0x0000ff); postLine('> Синій'); },
    'режим': () => toggleAR()
});

// --- STATE HELPERS ---
function postLine(text) {
    el.chat.textContent = "";
    const div = document.createElement("div");
    div.className = "log-msg";
    div.textContent = `> ${text}`;
    el.chat.appendChild(div);
}

let techStatusTimeout = null;
function postTechStatus(text) {
    if (!el.hudStatus) return;
    el.hudStatus.textContent = text;
    el.hudStatus.style.opacity = "1";

    if (techStatusTimeout) clearTimeout(techStatusTimeout);
    techStatusTimeout = setTimeout(() => {
        el.hudStatus.style.opacity = "0";
        setTimeout(() => { if (el.hudStatus.style.opacity === "0") el.hudStatus.textContent = ""; }, 300);
    }, 2000);
}

// Priority: true = can interrupt quickly, false = respects long cooldown
function say(type, cooldownMs = 8000, priority = false) {
    const now = Date.now();
    const effectiveCooldown = priority ? Math.min(cooldownMs, 2000) : cooldownMs;
    if (now - STATE.lastChatAt < effectiveCooldown) return false;
    const line = messenger.next(type);
    if (!line) return false;
    postLine(line);
    STATE.lastChatAt = now;
    return true;
}

function triggerBlackHoleMode() {
    STATE.mode = 'SINGULARITY';
    // Show status in header only (not in monologue)
    updateSingularityStatus('⚫ SINGULARITY ACTIVATED');
}

function exitBlackHoleMode() {
    STATE.mode = 'NORMAL';
    updateSingularityStatus('◎ SINGULARITY CONTAINED');
    setTimeout(() => updateSingularityStatus(''), 3000); // Clear after 3s
}

function updateSingularityStatus(text) {
    if (el.hudStatus) {
        el.hudStatus.textContent = text;
        el.hudStatus.style.color = STATE.mode === 'SINGULARITY' ? '#ff0055' : '#00ff88';
    }
}

function toggleAR() {
    STATE.ar = !STATE.ar;
    document.body.classList.toggle("ar-active", STATE.ar);
    if (el.btnAr) el.btnAr.classList.toggle("active", STATE.ar);
    if (STATE.streamReady) say("ar");
}

// Low-light mode toggle
function toggleLowLight() {
    LOW_LIGHT.enabled = !LOW_LIGHT.enabled;
    applyLowLightFilter();
    tracker.setLowLightMode(LOW_LIGHT.enabled);
    // Status only in header, not in monologue
    if (el.btnLowLight) el.btnLowLight.classList.toggle('active', LOW_LIGHT.enabled);
    updateLowLightStatus();
}

function updateLowLightStatus() {
    // Show low-light status in header
    const statusEl = document.querySelector('.sub');
    if (statusEl && LOW_LIGHT.enabled) {
        if (!statusEl.querySelector('.lowlight-indicator')) {
            const indicator = document.createElement('span');
            indicator.className = 'lowlight-indicator';
            indicator.style.cssText = 'color:#ffcc00; margin-left:10px;';
            indicator.textContent = '🌙 LOW-LIGHT: ON';
            statusEl.appendChild(indicator);
        }
    } else if (statusEl) {
        const indicator = statusEl.querySelector('.lowlight-indicator');
        if (indicator) indicator.remove();
    }
}

function applyLowLightFilter() {
    if (LOW_LIGHT.enabled) {
        const sat = LOW_LIGHT.saturation || 1.2;
        // Stronger filter for better detection
        el.vRaw.style.filter = `brightness(${LOW_LIGHT.brightness}) contrast(${LOW_LIGHT.contrast}) saturate(${sat})`;
        if (el.vAR) el.vAR.style.filter = `brightness(${LOW_LIGHT.brightness * 0.7}) contrast(${LOW_LIGHT.contrast})`;
    } else {
        el.vRaw.style.filter = 'none';
        if (el.vAR) el.vAR.style.filter = '';
    }
}

function applyQuality(tier) {
    STATE.tier = Math.max(0, Math.min(QUALITY.length - 1, tier));
    el.qTier.textContent = QUALITY[STATE.tier].name;

    // Update Systems
    sparks.init(QUALITY[STATE.tier].sparkCount);

    // Black Hole Visuals Quality
    if (physics.disk) physics.disk.setQuality(STATE.tier);
    if (physics.jets) physics.jets.setQuality(STATE.tier);
    BLACK_HOLE.rayCount = QUALITY[STATE.tier].kRayCount || 6;

    // Renderer settings
    const dpr = window.devicePixelRatio || 1;
    renderer.setPixelRatio(Math.min(dpr, QUALITY[STATE.tier].dprCap));
    resizeHUD();
}

function resizeHUD() {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    el.hud.width = w * dpr;
    el.hud.height = h * dpr;
    el.hud.style.width = w + 'px';
    el.hud.style.height = h + 'px';
    hud.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    renderer.setPixelRatio(Math.min(dpr, QUALITY[STATE.tier].dprCap));
}

// --- MAIN LOOP ---
let frames = 0, lastFpsTick = 0, animFrame = 0;

function animate() {
    requestAnimationFrame(animate);
    animFrame++;
    const q = QUALITY[STATE.tier];

    const now = Date.now();
    const deltaTime = 0.016; // Fix to 60fps for stability

    // 1. Physics & Logic
    if ((animFrame % q.physicsEvery) === 0) {
        physics.update(STATE.hands, camera, deltaTime);
        neural.update(STATE.stressEMA, sphere.scale.x, sphere.position);
        updateMonologue();
    }
    sparks.update();

    // 2. Rendering
    renderer.render(scene, camera);

    // 3. FPS Monitoring
    frames++;
    const pNow = performance.now();
    if (pNow - lastFpsTick > 1000) {
        STATE.fpsAvg = frames;
        el.fps.textContent = frames;

        // Auto-downgrade if FPS < 35 for consecutive seconds
        if (frames < 35 && STATE.tier < 2) {
            if (!STATE.fpsLowCounter) STATE.fpsLowCounter = 0;
            STATE.fpsLowCounter++;

            if (STATE.fpsLowCounter > 2) { // 3 seconds of low FPS
                applyQuality(STATE.tier + 1);
                STATE.fpsLowCounter = 0;
                postLine(`> Quality optimized to Tier ${STATE.tier}`);
            }
        } else {
            STATE.fpsLowCounter = 0;
        }

        frames = 0;
        lastFpsTick = pNow;
    }
}

function updateMonologue() {
    const now = Date.now();
    const handsArr = Object.values(STATE.hands);
    const interacting = handsArr.length > 0;
    const isGrip = handsArr.some(h => h.pinch);
    const stress = STATE.stressEMA;

    if (interacting) STATE.lastInteractionAt = now;

    // High stress or fist = priority (can interrupt)
    const highStress = stress > 1.5;
    const isFist = handsArr.some(h => h.fistFactor > 0.7);
    const isPriority = highStress || isFist;

    if (isGrip && highStress) { say("magnet", 2000, true); audio.triggerSwell(); }
    else if (isGrip) { say("magnet", 10000, false); audio.triggerSwell(); }
    else if (interacting) { say("touch", 15000, false); }
    else if (now - STATE.lastInteractionAt > 8000) { say("idle", 20000, false); }
}

// --- HAND HANDLER ---
tracker.onResults((res) => {
    const q = QUALITY[STATE.tier];
    hud.hudFrame++;

    if ((hud.hudFrame % q.hudEvery) === 0) {
        hud.clear();
        hud.drawGlobal(camera);
    }

    const currentHands = {};
    let maxFistFactor = 0;

    if (res.multiHandLandmarks) {
        res.multiHandLandmarks.forEach((lm, i) => {
            const palmSize = Math.hypot(lm[5].x - lm[17].x, lm[5].y - lm[17].y);
            const pinchDist = Math.hypot(lm[8].x - lm[4].x, lm[8].y - lm[4].y);
            const pinch = pinchDist < (palmSize * 0.6);

            const handScale = Math.hypot(lm[9].x - lm[0].x, lm[9].y - lm[0].y) || 0.1;
            let avgTipDist = 0;
            [8, 12, 16, 20].forEach(idx => avgTipDist += Math.hypot(lm[idx].x - lm[0].x, lm[idx].y - lm[0].y));
            avgTipDist /= 4;
            const fistFactor = clamp01((1.1 - avgTipDist / handScale) * 2.0);
            if (fistFactor > maxFistFactor) maxFistFactor = fistFactor;

            const sPos = getScreenPos(lm[8].x, lm[8].y, el.vRaw);
            const rawPos3D = get3DFromScreen(sPos.x, sPos.y, camera);

            // Apply EMA smoothing to reduce trembling
            if (!smoothedHands[i]) {
                smoothedHands[i] = rawPos3D.clone();
            } else {
                smoothedHands[i].lerp(rawPos3D, 1 - SMOOTH_FACTOR);
            }
            const pos3D = smoothedHands[i].clone();

            const handData = { pos: pos3D, pinch, lm, fistFactor, rawPos: rawPos3D };
            currentHands[i] = handData;

            gestures.addPoint(sPos.x, sPos.y);

            if (pinch) {
                STATE.ghosts[i] = { ...handData, timestamp: Date.now() };
                HapticEngine.onGrip();

                // Check for specific UI interactions (Menu etc)
                // ... omitted for brevity or added later ...
            }

            if ((hud.hudFrame % q.hudEvery) === 0) {
                hud.drawHand(lm, i, pinch, handData, camera, el.vRaw, sphere);
            }
        });
    }

    // Singularity Activation Logic
    const now = Date.now();
    let globalTunnelFactor = 0;
    if (maxFistFactor > 0.5) {
        if (!STATE.fistHoldStart) STATE.fistHoldStart = now;
        globalTunnelFactor = clamp01((now - STATE.fistHoldStart) / 3000);
    } else {
        STATE.fistHoldStart = null;
    }
    STATE.globalTunnelFactor = globalTunnelFactor;
    STATE.blackHolePull = globalTunnelFactor;

    if (globalTunnelFactor > 0.5 && STATE.mode !== 'SINGULARITY') {
        triggerBlackHoleMode();
    } else if (maxFistFactor < 0.2 && STATE.mode === 'SINGULARITY') {
        exitBlackHoleMode();
    }

    // Two Hand
    const hKeys = Object.keys(currentHands);
    if (hKeys.length >= 2) {
        const res = twoHand.update(currentHands[hKeys[0]], currentHands[hKeys[1]]);
        if (res && currentHands[hKeys[0]].pinch && currentHands[hKeys[1]].pinch) {
            sphere.scale.multiplyScalar(res.scale);
            sphere.rotation.z += res.rotate;
        }
    }

    STATE.hands = currentHands;
    recorder.addFrame(currentHands);

    // Re-recognize gestures
    const g = gestures.recognize();
    if (g) handleGesture(g);
});

function handleGesture(g) {
    let text = '';
    switch (g) {
        case 'circle': mat.color.setHSL(Math.random(), 1, 0.5); text = 'GESTURE: CIRCLE'; break;
        case 'swipe-up': sphere.scale.multiplyScalar(1.2); text = 'GESTURE: SCALE+'; break;
        case 'swipe-down': sphere.scale.multiplyScalar(0.8); text = 'GESTURE: SCALE-'; break;
    }
    if (text) postTechStatus(text);
}

// --- INITIALIZATION ---
async function startApp() {
    try {
        el.start.style.opacity = 0;
        setTimeout(() => { el.start.style.display = "none"; }, 800);

        await audio.init();
        voice.start();
        say("boot", 0);

        // Advanced camera constraints for better low-light performance
        const videoConstraints = {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: "user"
        };

        // Try advanced constraints (may not be supported on all devices)
        try {
            videoConstraints.advanced = [
                { exposureMode: "continuous" },
                { exposureCompensation: { ideal: 2 } }
            ];
        } catch (e) {
            console.log('Advanced camera constraints not supported');
        }

        const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });

        // Apply low-light filter if enabled
        if (LOW_LIGHT.enabled) applyLowLightFilter();
        el.vRaw.srcObject = stream;
        el.vAR.srcObject = stream;
        await el.vRaw.play();
        STATE.streamReady = true;

        animate();

        // MediaPipe loop (use setTimeout instead of rAF to reduce GPU pressure on Mac)
        let mpActive = true;
        async function mpLoop() {
            if (!mpActive) return;
            if (STATE.streamReady && el.vRaw.readyState >= 2) {
                try {
                    await tracker.send(el.vRaw);
                } catch (e) {
                    console.warn('MediaPipe frame dropped:', e);
                }
            }
            setTimeout(mpLoop, 33); // ~30fps max, throttled further by HandTracker
        }
        mpLoop();

    } catch (err) {
        alert("System Failure: " + err.message);
    }
}

// --- UI LISTENERS ---
el.btnStart.addEventListener('click', startApp);
el.menuFab.addEventListener('click', () => {
    el.menuFab.classList.toggle('open');
    el.menuSubmenu.classList.toggle('open');
});
el.btnAr.addEventListener('click', toggleAR);
if (el.btnLowLight) el.btnLowLight.addEventListener('click', toggleLowLight);
el.btnInfo.addEventListener('click', () => {
    el.infoPanel.classList.toggle('open');
    el.btnInfo.classList.toggle('active');
});

// Tuning Menu
if (el.btnTuning) {
    el.btnTuning.addEventListener('click', () => {
        tuner.toggle();
        el.menuSubmenu.classList.remove('active');
        el.menuFab.classList.remove('active');
    });
}
applyQuality(0);
window.addEventListener('resize', resizeHUD);
window.addEventListener('load', init);
