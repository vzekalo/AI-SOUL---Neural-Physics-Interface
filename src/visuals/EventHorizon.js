import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';

/**
 * EventHorizon - Візуальне світіння горизонту подій
 * Створює кільце світіння навколо чорної діри з пульсацією
 */
export class EventHorizon {
    constructor(scene, config) {
        this.scene = scene;
        this.cfg = config;
        this.center = new THREE.Vector3();

        // Horizon Ring
        const horizonR = config.horizonRadius || 6.5;
        this.innerR = horizonR * 0.8;
        this.outerR = horizonR * 2.5;

        this.initRing();
        this.initPhotonSphere();
    }

    initRing() {
        // Main glow ring
        const ringGeo = new THREE.RingGeometry(this.innerR, this.outerR, 64);

        // Custom shader for gradient glow
        this.ringMat = new THREE.ShaderMaterial({
            uniforms: {
                innerR: { value: this.innerR },
                outerR: { value: this.outerR },
                time: { value: 0 },
                pull: { value: 0 },
                color1: { value: new THREE.Color(0xff3300) }, // Inner: hot orange
                color2: { value: new THREE.Color(0x000000) }  // Outer: transparent
            },
            vertexShader: `
                varying vec2 vUv;
                varying float vDist;
                void main() {
                    vUv = uv;
                    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
                    vDist = length(position.xy);
                    gl_Position = projectionMatrix * mvPos;
                }
            `,
            fragmentShader: `
                uniform float innerR;
                uniform float outerR;
                uniform float time;
                uniform float pull;
                uniform vec3 color1;
                uniform vec3 color2;
                varying float vDist;
                
                void main() {
                    float t = (vDist - innerR) / (outerR - innerR);
                    t = clamp(t, 0.0, 1.0);
                    
                    // Gradient falloff (inverse square for realism)
                    float alpha = pow(1.0 - t, 2.5) * pull;
                    
                    // Pulsating effect
                    float pulse = 0.8 + 0.2 * sin(time * 3.0 + vDist * 0.5);
                    alpha *= pulse;
                    
                    // Color interpolation (hot core to cold edge)
                    vec3 col = mix(color1, color2, t * 0.7);
                    
                    gl_FragColor = vec4(col, alpha * 0.6);
                }
            `,
            transparent: true,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        this.ring = new THREE.Mesh(ringGeo, this.ringMat);
        this.ring.visible = false;
        this.scene.add(this.ring);
    }

    initPhotonSphere() {
        // Photon sphere: particles orbiting at 1.5x Schwarzschild radius
        const photonR = this.innerR * 1.5;
        const count = 60;

        const geo = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);

        this.photonState = {
            angles: new Float32Array(count),
            speeds: new Float32Array(count)
        };

        for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2;
            this.photonState.angles[i] = angle;
            this.photonState.speeds[i] = 2.5 + Math.random() * 1.5; // rad/s

            positions[i * 3] = Math.cos(angle) * photonR;
            positions[i * 3 + 1] = Math.sin(angle) * photonR;
            positions[i * 3 + 2] = 0;

            // Cyan-white color
            colors[i * 3] = 0.7 + Math.random() * 0.3;
            colors[i * 3 + 1] = 0.9 + Math.random() * 0.1;
            colors[i * 3 + 2] = 1.0;
        }

        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const mat = new THREE.PointsMaterial({
            size: 0.4,
            vertexColors: true,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        this.photonSphere = new THREE.Points(geo, mat);
        this.photonSphere.visible = false;
        this.photonR = photonR;
        this.scene.add(this.photonSphere);
    }

    setCenter(pos) {
        this.center.copy(pos);
        this.ring.position.copy(pos);
        this.photonSphere.position.copy(pos);
    }

    update(dt, time, pull) {
        // Update visibility
        const visible = pull > 0.1;
        this.ring.visible = visible;
        this.photonSphere.visible = visible;

        if (!visible) return;

        // Update ring shader uniforms
        this.ringMat.uniforms.time.value = time;
        this.ringMat.uniforms.pull.value = pull;

        // Update photon sphere particles (orbiting rapidly)
        const positions = this.photonSphere.geometry.attributes.position.array;
        const count = this.photonState.angles.length;

        for (let i = 0; i < count; i++) {
            this.photonState.angles[i] += this.photonState.speeds[i] * dt;
            const angle = this.photonState.angles[i];

            positions[i * 3] = Math.cos(angle) * this.photonR;
            positions[i * 3 + 1] = Math.sin(angle) * this.photonR;
        }

        this.photonSphere.geometry.attributes.position.needsUpdate = true;

        // Photon sphere opacity based on pull
        this.photonSphere.material.opacity = 0.4 + pull * 0.5;
    }

    dispose() {
        if (this.ring) {
            this.scene.remove(this.ring);
            this.ring.geometry.dispose();
            this.ringMat.dispose();
        }
        if (this.photonSphere) {
            this.scene.remove(this.photonSphere);
            this.photonSphere.geometry.dispose();
            this.photonSphere.material.dispose();
        }
    }
}
