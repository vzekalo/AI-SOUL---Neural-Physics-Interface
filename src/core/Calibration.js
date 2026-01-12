import { CFG, STATE } from '../config.js';

export class Calibration {
    constructor(postLineCallback) {
        this.samples = [];
        this.postLine = postLineCallback;
    }

    addSample(handSpan) {
        this.samples.push(handSpan);
        if (this.samples.length >= 30) {
            this.finish();
        }
    }

    finish() {
        if (this.samples.length < 10) return;
        const avg = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
        CFG.handScale = 0.15 / avg;
        STATE.calibrated = true;
        STATE.calibrationData = { avgSpan: avg, scale: CFG.handScale };
        if (this.postLine) this.postLine(`> Calibrated: scale ${CFG.handScale.toFixed(2)}`);
        this.samples = [];
    }

    reset() {
        this.samples = [];
        CFG.handScale = 1.0;
        STATE.calibrated = false;
    }
}
