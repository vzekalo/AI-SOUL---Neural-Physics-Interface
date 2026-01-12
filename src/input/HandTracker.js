import { LOW_LIGHT, M1_MODE } from '../config.js';

// Detect Apple Silicon
function isAppleSilicon() {
    if (!M1_MODE.autoDetect) return false;
    const ua = navigator.userAgent || '';
    const platform = navigator.platform || '';
    // Check for Mac with ARM
    const isMac = platform.includes('Mac') || ua.includes('Macintosh');
    const isARM = ua.includes('ARM') ||
        (navigator.userAgentData?.platform === 'macOS' &&
            navigator.userAgentData?.architecture === 'arm');
    // Also check for Safari on Mac (often M1/M2/M3)
    const isSafariMac = isMac && /Safari/.test(ua) && !/Chrome/.test(ua);
    return isMac && (isARM || isSafariMac);
}

export class HandTracker {
    constructor() {
        const useM1Mode = M1_MODE.enabled || isAppleSilicon();
        const useLowLight = LOW_LIGHT.enabled;

        // Log detection
        if (useM1Mode) console.log('🍎 Apple Silicon detected, using optimized settings');
        if (useLowLight) console.log('🌙 Low-light mode enabled');

        this.hands = new Hands({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
        });

        // Adaptive settings based on mode
        const modelComplexity = useM1Mode ? M1_MODE.modelComplexity : 1;
        const minDetection = useLowLight ? LOW_LIGHT.minDetectionConfidence : 0.5;
        const minTracking = useLowLight ? LOW_LIGHT.minTrackingConfidence : 0.5;

        this.hands.setOptions({
            maxNumHands: 2,
            modelComplexity: modelComplexity,
            minDetectionConfidence: minDetection,
            minTrackingConfidence: minTracking,
            selfieMode: true
        });

        this.throttleMs = useM1Mode ? M1_MODE.throttleMs : 0;
        this.lastSendTime = 0;
    }

    onResults(callback) {
        this.hands.onResults(callback);
    }

    async send(image) {
        // Throttle if M1 mode is active
        if (this.throttleMs > 0) {
            const now = performance.now();
            if (now - this.lastSendTime < this.throttleMs) {
                return; // Skip this frame
            }
            this.lastSendTime = now;
        }
        await this.hands.send({ image });
    }

    // Allow runtime updates
    setLowLightMode(enabled) {
        const confidence = enabled ? LOW_LIGHT.minDetectionConfidence : 0.5;
        this.hands.setOptions({
            minDetectionConfidence: confidence,
            minTrackingConfidence: confidence
        });
    }
}

