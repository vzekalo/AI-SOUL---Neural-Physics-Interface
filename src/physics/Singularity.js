import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';
import { BLACK_HOLE, STATE } from '../config.js';

export class Singularity {
    constructor() {
        this.enabled = false;
        this.pos = new THREE.Vector3(15, 15, 0);

        // Cache vectors
        this.tmpV = new THREE.Vector3();
        this.tmpV2 = new THREE.Vector3();
        this.tmpV3 = new THREE.Vector3();
        this.tmpV4 = new THREE.Vector3();
        this.tmpV5 = new THREE.Vector3();
        this.tmpAxis = new THREE.Vector3();
        this.tmpT = new THREE.Vector3();
        this.params = BLACK_HOLE;
    }

    update(camera) {
        this.enabled = STATE.mode === 'SINGULARITY';
        if (camera) {
            // Sync with top-LEFT corner (-0.78, 0.62)
            const ndc = new THREE.Vector3(-0.78, 0.62, 0);
            this.pos.copy(ndc.unproject(camera));
            STATE.blackHolePos.copy(this.pos);
        }
    }

    applyPull(object, dt) {
        if (!object || !this.enabled || STATE.blackHolePull < 0.01) return;

        const cfg = this.params;
        const bh = this.pos; // world position
        const eps = cfg.eps || 1.0;

        // Init velocity once
        if (!object.userData.vel) object.userData.vel = new THREE.Vector3();
        if (object.userData.absorbed == null) object.userData.absorbed = 0;

        const vel = object.userData.vel;

        // rVec = obj - bh
        this.tmpV2.subVectors(object.position, bh);
        const r2 = this.tmpV2.lengthSq() + eps * eps;
        const r = Math.sqrt(r2);

        // Outside influence -> slight decay to stabilize
        if (r > (cfg.influenceRadius || 100)) {
            vel.multiplyScalar(0.98);
            return;
        }

        // rHat
        const invR = 1 / r;
        const rHat = this.tmpV.copy(this.tmpV2).multiplyScalar(invR);

        // Base constant pull (lower base for cinematic feel)
        const base = 0.08;
        const pull = base + (1 - base) * STATE.blackHolePull;
        const easedPull = pull * pull; // Quadratic easing for force

        // Sharp Two-Layer Gravity
        let aMag;
        // Outside influence? Almost zero pull.
        if (r > (cfg.influenceRadius || 95)) {
            // Tiny residual pull to guide far objects eventually
            aMag = (cfg.mass || 1200) / (r2 * 4.0);
        } else {
            // Inside: Full standard gravity
            aMag = (cfg.mass || 1200) / r2;
        }

        if (aMag > (cfg.maxAccel || 120)) aMag = (cfg.maxAccel || 120);
        if (!isFinite(aMag)) aMag = 0; // Safety check

        // Scale force by global pull factor
        aMag *= easedPull;

        // aRad = -rHat * aMag
        const aRad = this.tmpV3.copy(rHat).multiplyScalar(-aMag);

        // Swirl: tangential direction around Z
        this.tmpAxis.set(0, 0, 1);
        this.tmpT.crossVectors(this.tmpAxis, rHat); // tHat
        const tLen = this.tmpT.length();
        if (tLen > 1e-5) this.tmpT.multiplyScalar(1 / tLen);

        // Swirl magnitude increases closer to BH
        const swirlMag = (cfg.spin || 14) / (r + eps);
        const aTan = this.tmpV4.copy(this.tmpT).multiplyScalar(swirlMag);

        // Total accel = aRad + aTan
        this.tmpV5.copy(aRad).add(aTan);

        // Integrate velocity
        vel.addScaledVector(this.tmpV5, dt);

        // Drag (Inspiral energy loss)
        const drag = cfg.drag || 0.25;
        vel.multiplyScalar(1 - drag * dt);

        // Update position
        object.position.addScaledVector(vel, dt);

        // Near horizon: stretch + fade (Spaghettification visual)
        const tidalR = cfg.tidalRadius || 22;
        if (r < tidalR) {
            const k = 1 - (r / tidalR);
            const stretch = 1 + k * 0.9;
            const squeeze = 1 - k * 0.45;

            // Simple scaling approximation
            object.scale.set(stretch, squeeze, 1);

            // Rotate object to align with radius (optional, might be expensive/glitchy)
            // For simple particles/spheres, scale is enough
        } else {
            object.scale.setScalar(1);
        }

        // Absorption
        const horizonR = cfg.horizonRadius || 10;
        if (r < horizonR) {
            object.userData.absorbed = Math.min(1, object.userData.absorbed + (cfg.absorbRate || 1.4) * dt);
            const a01 = object.userData.absorbed;

            object.scale.multiplyScalar(1 - 0.85 * a01);

            if (object.material) {
                object.material.transparent = true;
                object.material.opacity = Math.max(0, 1 - a01);
            }

            // Pull into tunnel
            object.position.z -= (cfg.tunnelDepth || 40) * dt * a01;

            if (r < (cfg.absorbRadius || 3.5) || a01 >= 1) {
                object.visible = false;
            }
        }
    }

    reset(object) {
        if (!object) return;

        // Reset physics state
        if (object.userData.vel) object.userData.vel.set(0, 0, 0);
        object.userData.absorbed = 0;

        // Restore visibility
        object.visible = true;

        // Restore material
        if (object.material) {
            object.material.opacity = 0.85; // Default opacity from main.js
            object.material.transparent = true;
        }

        // Restore transform
        object.scale.setScalar(1);
        object.position.set(0, 0, 0);
        object.rotation.set(0, 0, 0);
        object.updateMatrix();

        console.log("⚫ Singularity reset object state");
    }
}
