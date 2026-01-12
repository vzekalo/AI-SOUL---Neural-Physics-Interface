import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';
import { BLACK_HOLE, STATE } from '../config.js';

export class Singularity {
    constructor() {
        this.enabled = false;
        this.pos = new THREE.Vector3(15, 15, 0);
    }

    update(camera) {
        this.enabled = STATE.mode === 'SINGULARITY';
        if (camera) {
            // Sync with top-right corner
            const ndc = new THREE.Vector3(0.7, 0.7, 0);
            this.pos.copy(ndc.unproject(camera));
            STATE.blackHolePos.copy(this.pos);
        }
    }

    applyPull(object, deltaTime) {
        if (!this.enabled || STATE.blackHolePull < 0.01) return;

        const dist = object.position.distanceTo(this.pos);
        if (dist < 40) {
            const force = (1.0 - dist / 40) * BLACK_HOLE.gravity * STATE.blackHolePull;
            const dir = this.pos.clone().sub(object.position).normalize();

            // Slow disintegration/pull
            object.position.addScaledVector(dir, force * 0.1);

            // Add swirl
            const swirl = new THREE.Vector3(-dir.y, dir.x, 0).multiplyScalar(BLACK_HOLE.swirlSpeed * STATE.blackHolePull);
            object.position.add(swirl);
        }
    }
}
