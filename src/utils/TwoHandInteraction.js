export class TwoHandInteraction {
    constructor() {
        this.lastDist = null;
        this.lastAngle = null;
    }

    update(hand0, hand1) {
        if (!hand0 || !hand1) {
            this.lastDist = null;
            this.lastAngle = null;
            return null;
        }

        const dx = hand1.pos.x - hand0.pos.x;
        const dy = hand1.pos.y - hand0.pos.y;
        const dist = Math.hypot(dx, dy);
        const angle = Math.atan2(dy, dx);

        const result = { scale: 1, rotate: 0 };

        if (this.lastDist !== null) {
            const scaleDelta = dist / this.lastDist;
            if (scaleDelta > 0.8 && scaleDelta < 1.2) {
                result.scale = scaleDelta;
            }
        }

        if (this.lastAngle !== null) {
            result.rotate = angle - this.lastAngle;
        }

        this.lastDist = dist;
        this.lastAngle = angle;

        return result;
    }
}
