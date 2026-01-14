import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';

export class Jets {
    constructor(scene, config) {
        this.scene = scene;
        this.cfg = config;
        this.center = new THREE.Vector3();

        // Quality
        this.baseCount = config.particles || 120;
        this.count = this.baseCount;

        this.initParticles();
    }

    initParticles() {
        if (this.points) {
            this.scene.remove(this.points);
            this.geometry.dispose();
            this.material.dispose();
        }

        const count = this.count;
        this.geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);

        this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        // State
        this.state = {
            offset: new Float32Array(count * 2), // xy offset from center
            dist: new Float32Array(count),       // distance along jet axis (z)
            speed: new Float32Array(count),
            dir: new Float32Array(count)         // 1 (up) or -1 (down)
        };

        const cfg = this.cfg;
        for (let i = 0; i < count; i++) {
            this.resetParticle(i, true);
        }

        // Texture (Reuse same logic or generic point)
        const canvas = document.createElement('canvas');
        canvas.width = 16; canvas.height = 16;
        const ctx = canvas.getContext('2d');
        const grad = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
        grad.addColorStop(0, 'rgba(200,255,255,1)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 16, 16);
        const texture = new THREE.CanvasTexture(canvas);

        this.material = new THREE.PointsMaterial({
            size: cfg.size || 0.7,
            map: texture,
            vertexColors: true,
            transparent: true,
            opacity: 0.8,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });

        this.points = new THREE.Points(this.geometry, this.material);
        this.points.frustumCulled = false;
        this.scene.add(this.points);
    }

    resetParticle(i, randomPos = false) {
        const cfg = this.cfg;
        const jitter = cfg.jitter || 0.5;

        // Random offset near center
        this.state.offset[i * 2] = (Math.random() - 0.5) * jitter;
        this.state.offset[i * 2 + 1] = (Math.random() - 0.5) * jitter;

        // Direction: half up, half down (along Z or Y?)
        // Let's assume Jets go PERPENDICULAR to accretion disk.
        // If disk is XY, Jets are Z. 
        this.state.dir[i] = Math.random() > 0.5 ? 1 : -1;

        // Distance
        this.state.dist[i] = randomPos ? Math.random() * cfg.length : 0;

        this.state.speed[i] = cfg.speed * (0.8 + Math.random() * 0.4);
    }

    setCenter(pos) {
        this.center.copy(pos);
    }

    setQuality(tier) {
        let newCount = this.baseCount;
        if (tier === 1) newCount = Math.floor(this.baseCount * 0.7); // ~80
        if (tier === 2) newCount = Math.floor(this.baseCount * 0.4); // ~50

        if (this.count !== newCount) {
            this.count = newCount;
            this.initParticles();
        }
    }

    update(dt, time, pull = 1.0, stressEMA = 0) {
        const positions = this.geometry.attributes.position.array;
        const colors = this.geometry.attributes.color.array;
        const cfg = this.cfg;
        const count = this.count;
        const cx = this.center.x, cy = this.center.y, cz = this.center.z;
        const length = cfg.length;

        // Pulse effect synchronized with absorption intensity
        const basePulse = 0.6 + 0.4 * Math.sin(time * (cfg.pulse || 1.0));
        const stressPulse = 1.0 + stressEMA * 0.3; // Respond to sphere stress
        const pullBoost = 0.8 + pull * 0.4; // Boost with pull strength
        const pulse = basePulse * stressPulse * pullBoost;

        for (let i = 0; i < count; i++) {
            let dist = this.state.dist[i];

            // Move
            dist += this.state.speed[i] * dt;

            if (dist > length) {
                this.resetParticle(i, false);
                dist = this.state.dist[i];
            }
            this.state.dist[i] = dist;

            const dir = this.state.dir[i];
            const ox = this.state.offset[i * 2];
            const oy = this.state.offset[i * 2 + 1];

            // Spread out slightly as they get further?
            const spread = 1.0 + (dist / length) * 2.0;

            positions[i * 3] = cx + ox * spread;
            positions[i * 3 + 1] = cy + oy * spread;
            positions[i * 3] = cx + ox * spread;
            positions[i * 3 + 1] = cy + oy * spread;

            // Z-axis jets
            // FIX: If Black Hole is active, force suction/ejection into the screen (negative Z)
            // Users dislike particles flying "forward" (towards camera)
            const effectiveDir = (pull > 0.1) ? -1.0 : dir;

            // If suction is strong, maybe pull them IN towards center? 
            // For now, just ensure they go AWAY from camera (-Z)
            positions[i * 3 + 2] = cz + (dist * effectiveDir);

            // Fade out at end
            const life = 1.0 - (dist / length);
            const alpha = life * pulse;

            // Cyan -> White -> Transparent
            // Pure white core
            colors[i * 3] = 0.6 + 0.4 * life;
            colors[i * 3 + 1] = 0.9 + 0.1 * life;
            colors[i * 3 + 2] = 1.0;

            // Since we use global opacity, we can't change per-vertex alpha easily without 
            // separate attribute or shader. 
            // We'll modulate color BLACK to fade out with AdditiveBlending
            colors[i * 3] *= alpha;
            colors[i * 3 + 1] *= alpha;
            colors[i * 3 + 2] *= alpha;
        }

        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.attributes.color.needsUpdate = true;
    }

    dispose() {
        if (this.points) {
            this.scene.remove(this.points);
            this.geometry.dispose();
            this.material.dispose();
        }
    }
}
