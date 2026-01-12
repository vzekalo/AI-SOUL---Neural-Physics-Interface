export const HapticEngine = {
    supported: 'vibrate' in navigator,
    pulse(ms = 50) {
        if (this.supported) navigator.vibrate(ms);
    },
    pattern(pattern) {
        if (this.supported) navigator.vibrate(pattern);
    },
    onGrip() { this.pulse(30); },
    onPush() { this.pattern([10, 20, 10]); },
    onGesture() { this.pattern([50, 30, 50]); }
};
