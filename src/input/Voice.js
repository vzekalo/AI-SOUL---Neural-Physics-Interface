import { STATE } from '../config.js';

export class VoiceCommand {
    constructor(handlers) {
        this.recognition = null;
        this.handlers = handlers;
        this.init();
    }

    init() {
        if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) return;
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        this.recognition = new SR();
        this.recognition.continuous = true;
        this.recognition.interimResults = false;
        this.recognition.lang = 'uk-UA';

        this.recognition.onresult = (e) => {
            const last = e.results[e.results.length - 1];
            if (last.isFinal) {
                const cmdText = last[0].transcript.toLowerCase().trim();
                for (const key in this.handlers) {
                    if (cmdText.includes(key)) {
                        this.handlers[key]();
                        break;
                    }
                }
            }
        };
    }

    start() {
        if (this.recognition) {
            try {
                this.recognition.start();
                STATE.voiceActive = true;
            } catch (_) { }
        }
    }

    stop() {
        if (this.recognition) {
            try {
                this.recognition.stop();
                STATE.voiceActive = false;
            } catch (_) { }
        }
    }
}
