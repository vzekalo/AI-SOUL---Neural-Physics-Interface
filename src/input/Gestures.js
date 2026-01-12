import { STATE } from '../config.js';

export class GestureRecognizer {
    constructor() {
        this.history = [];
        this.maxHistory = 40;
    }

    addPoint(x, y) {
        this.history.push({ x, y, t: Date.now() });
        if (this.history.length > this.maxHistory) this.history.shift();
    }

    recognize() {
        if (this.history.length < 25) return null; // Need more points
        const now = Date.now();
        if (now - STATE.gestureTimeout < 2000) return null; // Longer cooldown

        const pts = this.history.slice(-20);
        const duration = pts[pts.length - 1].t - pts[0].t;

        // Must be fast enough (within 1.5 sec)
        if (duration > 1500) {
            this.history = [];
            return null;
        }

        // Detect CIRCLE - stricter thresholds
        const center = pts.reduce((a, p) => ({ x: a.x + p.x / pts.length, y: a.y + p.y / pts.length }), { x: 0, y: 0 });
        const avgDist = pts.reduce((a, p) => a + Math.hypot(p.x - center.x, p.y - center.y), 0) / pts.length;
        const variance = pts.reduce((a, p) => a + Math.abs(Math.hypot(p.x - center.x, p.y - center.y) - avgDist), 0) / pts.length;

        if (variance < avgDist * 0.2 && avgDist > 50) { // Stricter variance, larger circle
            const start = pts[0], end = pts[pts.length - 1];
            if (Math.hypot(end.x - start.x, end.y - start.y) < avgDist * 0.4) { // Must close loop
                STATE.gestureTimeout = now;
                this.history = [];
                return 'circle';
            }
        }

        // Detect SWIPE - need longer, faster swipe
        const dx = pts[pts.length - 1].x - pts[0].x;
        const dy = pts[pts.length - 1].y - pts[0].y;
        const swipeDist = Math.hypot(dx, dy);
        if (swipeDist > 200 && duration < 800) { // Faster swipe required
            STATE.gestureTimeout = now;
            this.history = [];
            if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'swipe-right' : 'swipe-left';
            return dy > 0 ? 'swipe-down' : 'swipe-up';
        }

        return null;
    }

    clear() {
        this.history = [];
    }
}
