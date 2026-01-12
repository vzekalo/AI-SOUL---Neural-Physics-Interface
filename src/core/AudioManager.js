export class AudioManager {
    constructor() {
        this.ctx = null;
        this.masterGain = null;
        this.filter = null;
        this.voices = [];
    }

    async init() {
        if (this.ctx) return;
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioContext();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.03; // Quiet

        this.filter = this.ctx.createBiquadFilter();
        this.filter.type = "lowpass";
        this.filter.frequency.value = 350;

        const lfo = this.ctx.createOscillator();
        lfo.frequency.value = 0.1;
        const lfoGain = this.ctx.createGain();
        lfoGain.gain.value = 200;
        lfo.connect(lfoGain);
        lfoGain.connect(this.filter.frequency);
        lfo.start();

        this.filter.connect(this.masterGain);
        this.masterGain.connect(this.ctx.destination);

        try { await this.ctx.resume(); } catch (_) { }

        this._createVoice("sawtooth", 55, 0.5, 0.05);
        this._createVoice("triangle", 110, 0.3, 0.08);
        this._createVoice("sine", 165, 0.2, 0.1);
    }

    _createVoice(type, freq, vol, rate) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const lfo = this.ctx.createOscillator();
        const lfoGain = this.ctx.createGain();

        osc.type = type;
        osc.frequency.value = freq;
        lfo.type = "sine";
        lfo.frequency.value = rate;
        lfoGain.gain.value = 4;

        lfo.connect(lfoGain);
        lfoGain.connect(osc.frequency);

        const panner = this.ctx.createStereoPanner();
        gain.gain.value = vol;

        osc.connect(gain);
        gain.connect(panner);
        panner.connect(this.filter);

        osc.start();
        lfo.start();
        this.voices.push({ osc, lfo });
    }

    triggerSwell() {
        if (!this.ctx || !this.masterGain) return;
        const now = this.ctx.currentTime;
        this.masterGain.gain.cancelScheduledValues(now);
        this.masterGain.gain.linearRampToValueAtTime(0.06, now + 0.5);
        this.masterGain.gain.linearRampToValueAtTime(0.03, now + 3.0);
    }

    destroy() {
        if (!this.ctx) return;
        try {
            this.voices.forEach(v => {
                v.osc.stop();
                v.lfo.stop();
            });
        } catch (_) { }
        this.ctx.close();
    }
}
