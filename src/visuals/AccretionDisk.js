import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';

export class AccretionDisk {
    constructor(scene, config) {
        this.scene = scene;
        this.cfg = config;
        this.center = new THREE.Vector3();
        this.tmpV = new THREE.Vector3();

        // Quality tiers
        this.baseCount = config.particles || 520;
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

        // Attributes
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);

        this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        // State buffers (not attributes)
        this.state = {
            r: new Float32Array(count),
            theta: new Float32Array(count),
            zBase: new Float32Array(count), // Base Z position
            heat: new Float32Array(count),  // 0..1
            speedOffset: new Float32Array(count) // Per-particle speed variation
        };

        // Initialize state
        const cfg = this.cfg;
        for (let i = 0; i < count; i++) {
            this.resetParticle(i, true);
        }

        // Material
        const texture = this.createParticleTexture();
        this.material = new THREE.PointsMaterial({
            size: cfg.size || 0.85, // Slightly smaller
            map: texture,
            vertexColors: true,
            transparent: true,
            opacity: 0.45, // Reduced base opacity (was 0.85)
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });

        this.points = new THREE.Points(this.geometry, this.material);
        this.points.frustumCulled = false; // Always render if visible
        this.scene.add(this.points);
    }

    createParticleTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 32; canvas.height = 32;
        const ctx = canvas.getContext('2d');
        const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(0.4, 'rgba(255,255,255,0.4)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 32, 32);
        const tex = new THREE.CanvasTexture(canvas);
        return tex;
    }

    resetParticle(i, randomR = false) {
        const cfg = this.cfg;
        // Bias towards outer edge for new particles
        const t = Math.random();
        const rNorm = randomR ? t : (0.9 + 0.1 * t);
        this.state.r[i] = cfg.innerR + (cfg.outerR - cfg.innerR) * rNorm;

        this.state.theta[i] = Math.random() * Math.PI * 2;
        this.state.zBase[i] = (Math.random() - 0.5) * cfg.thickness;
        this.state.heat[i] = 0;
        this.state.speedOffset[i] = 0.8 + Math.random() * 0.4; // 0.8x .. 1.2x speed
    }

    setCenter(pos) {
        this.center.copy(pos);
    }

    setQuality(tier) {
        let newCount = this.baseCount;
        if (tier === 1) newCount = Math.floor(this.baseCount * 0.7); // ~360
        if (tier === 2) newCount = Math.floor(this.baseCount * 0.4); // ~220

        if (this.count !== newCount) {
            this.count = newCount;
            this.initParticles();
        }
    }

    update(dt, time, pullFactor = 1.0) {
        const positions = this.geometry.attributes.position.array;
        const colors = this.geometry.attributes.color.array;

        // Dynamic opacity based on pull (flare up when active)
        if (this.material) {
            this.material.opacity = 0.18 + 0.35 * Math.min(1, pullFactor);
        }

        const cfg = this.cfg;
        const count = this.count;
        const cx = this.center.x, cy = this.center.y, cz = this.center.z;
        const turb = cfg.turbulence;
        const innerR = cfg.innerR;
        const outerR = cfg.outerR;
        const range = outerR - innerR;

        for (let i = 0; i < count; i++) {
            let r = this.state.r[i];
            let theta = this.state.theta[i];

            // Motion
            const speed = cfg.orbitSpeed * this.state.speedOffset[i] * dt * (30 / (r + 1.0)); // Faster near center
            theta += speed;
            r -= dt * cfg.spiralIn * (20 / (r + 1.0)); // Spiraling in

            // Reset if absorbed
            if (r < innerR) {
                // Fade out before reset? Simplification: Just reset for continuous flow
                this.resetParticle(i, false);
                r = this.state.r[i]; // Update usage
                theta = this.state.theta[i];
            }

            // Save state
            this.state.r[i] = r;
            this.state.theta[i] = theta;

            // Calculate Position
            // Swirl wobble
            const wobble = Math.sin(time * 0.7 + theta * 2.0) * turb * dt * 60; // scale by FPS
            const z = this.state.zBase[i] + wobble;

            const px = Math.cos(theta) * r;
            const py = Math.sin(theta) * r;

            // Transform to World Space (assuming Z is depth)
            // BH plane is typically XY, but let's match scene orientation
            // SoftBody seems to be XY roughly.
            positions[i * 3] = cx + px;
            positions[i * 3 + 1] = cy + py;
            positions[i * 3 + 2] = cz + z;

            // Thermodynamics / Color
            // Heat increases near inner radius
            const normalizedDist = (r - innerR) / range; // 0 (inner) to 1 (outer)
            let heat = (1.0 - normalizedDist);
            heat = Math.pow(heat, cfg.heatGain); // Curve it

            // Color mapping: 
            // Outer (cold): Cyan/Blue (0.0, 0.6, 1.0)
            // Inner (hot): Orange/White (1.0, 0.9, 0.5) -> (1, 1, 1)

            const rCol = 0.0 + heat * 1.0;
            const gCol = 0.6 + heat * 0.35;
            const bCol = 1.0 - heat * 0.2;

            // Intensity boost near horizon
            const intensity = 0.5 + heat * 1.5;

            colors[i * 3] = Math.min(1, rCol * intensity);
            colors[i * 3 + 1] = Math.min(1, gCol * intensity);
            colors[i * 3 + 2] = Math.min(1, bCol * intensity);
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
