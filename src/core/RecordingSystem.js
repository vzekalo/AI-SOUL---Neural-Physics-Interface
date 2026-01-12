import { STATE } from '../config.js';

export class RecordingSystem {
    constructor(postLineCallback) {
        this.data = [];
        this.maxFrames = 300;
        this.postLine = postLineCallback;
    }

    addFrame(hands) {
        if (!STATE.recording) return;
        const frame = { t: Date.now(), hands: JSON.parse(JSON.stringify(hands)) };
        this.data.push(frame);
        if (this.data.length > this.maxFrames) {
            STATE.recording = false;
            if (this.postLine) this.postLine('> Max recording length reached');
        }
    }

    clear() {
        this.data = [];
    }

    getStats() {
        return {
            frames: this.data.length,
            duration: this.data.length > 1 ? (this.data[this.data.length - 1].t - this.data[0].t) / 1000 : 0
        };
    }
}
