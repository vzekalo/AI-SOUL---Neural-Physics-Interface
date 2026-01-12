import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';

export class SparkSystem {
    constructor(scene) {
        this.scene = scene;
        this.sparks = null;
        this.pGeo = null;
        this.pPos = null;
        this.pLife = null;
        this.pVel = null;
        this.pCount = 0;
        this.pIdx = 0;
    }

    init(count) {
        if (this.sparks) this.scene.remove(this.sparks);

        this.pCount = count;
        this.pIdx = 0;
        this.pGeo = new THREE.BufferGeometry();
        this.pPos = new Float32Array(this.pCount * 3);
        this.pLife = new Float32Array(this.pCount).fill(0);
        this.pVel = Array.from({ length: this.pCount }, () => new THREE.Vector3());

        this.pGeo.setAttribute("position", new THREE.BufferAttribute(this.pPos, 3));
        this.sparks = new THREE.Points(this.pGeo, new THREE.PointsMaterial({
            color: 0xffffff,
            size: 0.6,
            transparent: true,
            opacity: 0.9
        }));
        this.scene.add(this.sparks);
    }

    spawn(worldPos, count) {
        if (!this.sparks) return;
        for (let i = 0; i < count; i++) {
            this.pIdx = (this.pIdx + 1) % this.pCount;
            const idx = this.pIdx * 3;
            this.pPos[idx] = worldPos.x;
            this.pPos[idx + 1] = worldPos.y;
            this.pPos[idx + 2] = worldPos.z;
            this.pVel[this.pIdx].set(
                Math.random() - 0.5,
                Math.random() - 0.5,
                Math.random() - 0.5
            ).multiplyScalar(0.7);
            this.pLife[this.pIdx] = 1;
        }
        this.sparks.geometry.attributes.position.needsUpdate = true;
    }

    update() {
        if (!this.sparks) return;
        let any = false;
        for (let i = 0; i < this.pCount; i++) {
            if (this.pLife[i] > 0) {
                any = true;
                this.pLife[i] -= 0.06;
                const idx = i * 3;
                this.pPos[idx] += this.pVel[i].x;
                this.pPos[idx + 1] += this.pVel[i].y;
                this.pPos[idx + 2] += this.pVel[i].z;
                if (this.pLife[i] <= 0) this.pPos[idx] = 9999;
            }
        }
        if (any) this.sparks.geometry.attributes.position.needsUpdate = true;
    }
}
