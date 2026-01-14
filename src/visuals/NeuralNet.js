import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';
import { CFG, STATE, BLACK_HOLE } from '../config.js';

export class NeuralNet {
    constructor(scene, sphere) {
        this.scene = scene;
        this.sphere = sphere; // Required for dynamic radius access
        this.neurons = [];
        this.synapses = [];
        this.neuronCount = 15;
        this.tmpVec = new THREE.Vector3();
        this.tmpVec2 = new THREE.Vector3();
        this.init();
    }

    init() {
        const neuronGeo = new THREE.IcosahedronGeometry(0.3, 1);
        const synapseMat = new THREE.LineBasicMaterial({
            color: 0x00f3ff,
            transparent: true,
            opacity: 0.15,
            blending: THREE.AdditiveBlending
        });

        for (let i = 0; i < this.neuronCount; i++) {
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const r = (0.1 + Math.random() * 0.6) * CFG.radius;

            const x = r * Math.sin(phi) * Math.cos(theta);
            const y = r * Math.sin(phi) * Math.sin(theta);
            const z = r * Math.cos(phi);

            const neuronMat = new THREE.MeshBasicMaterial({
                color: 0x00f3ff,
                wireframe: true,
                transparent: true,
                opacity: 0.6
            });
            const neuron = new THREE.Mesh(neuronGeo, neuronMat);
            neuron.position.set(x, y, z);
            neuron.userData = {
                basePos: new THREE.Vector3(x, y, z),
                origPos: new THREE.Vector3(x, y, z), // Store original for reset
                unitDir: new THREE.Vector3(x, y, z).normalize(),
                initR: r,
                pulsePhase: Math.random() * Math.PI * 2,
                driftVel: new THREE.Vector3(
                    (Math.random() - 0.5) * 0.015,
                    (Math.random() - 0.5) * 0.015,
                    (Math.random() - 0.5) * 0.015
                ),
                activity: 0,
                absorbed: 0
            };
            this.scene.add(neuron);
            this.neurons.push(neuron);
        }

        for (let i = 0; i < this.neurons.length; i++) {
            for (let j = i + 1; j < this.neurons.length; j++) {
                const dist = this.neurons[i].position.distanceTo(this.neurons[j].position);
                if (dist < 5) {
                    const geometry = new THREE.BufferGeometry().setFromPoints([
                        this.neurons[i].position.clone(),
                        this.neurons[j].position.clone()
                    ]);
                    const line = new THREE.Line(geometry, synapseMat.clone());
                    line.userData = { from: i, to: j, baseDist: dist };
                    this.scene.add(line);
                    this.synapses.push(line);
                }
            }
        }
    }

    // Reset neurons to original positions
    reset() {
        this.neurons.forEach(neuron => {
            neuron.userData.basePos.copy(neuron.userData.origPos);
            neuron.userData.absorbed = 0;
            neuron.userData.driftVel.set(
                (Math.random() - 0.5) * 0.015,
                (Math.random() - 0.5) * 0.015,
                (Math.random() - 0.5) * 0.015
            );
        });
    }

    update(stressLevel, sphereScale, spherePos, blackHolePos = null) {
        const t = Date.now() * 0.001;
        const bhActive = STATE.mode === 'SINGULARITY' && STATE.blackHolePull > 0.01;
        const pull = STATE.blackHolePull || 0;
        const suctionSpeed = BLACK_HOLE.suctionSpeed || 0.15;

        this.neurons.forEach((neuron, i) => {
            const pulse = Math.sin(t * 2 + neuron.userData.pulsePhase) * 0.5 + 0.5;

            // Reduce activity during BH (neurons calm down when being absorbed)
            const baseActivity = bhActive ? stressLevel * 0.3 : stressLevel * 1.0;
            const activity = baseActivity + pulse * 0.2;

            // Shrink neurons when absorbed
            const absorb = neuron.userData.absorbed;
            const scale = (1 + activity * 0.25) * (1 - absorb * 0.9);
            neuron.scale.setScalar(scale);

            const drift = neuron.userData.driftVel;
            if (drift) {
                neuron.userData.basePos.add(drift);

                // === BLACK HOLE SUCTION FOR NEURONS ===
                if (bhActive && blackHolePos) {
                    // Convert neuron basePos to world space for comparison
                    this.tmpVec.copy(neuron.userData.basePos)
                        .multiplyScalar(sphereScale)
                        .add(spherePos);

                    // Direction FROM neuron (world) TO black hole (world)
                    this.tmpVec2.copy(blackHolePos).sub(this.tmpVec);
                    const distToBH = this.tmpVec2.length();

                    if (distToBH < BLACK_HOLE.influenceRadius) {
                        // Normalize direction
                        this.tmpVec2.normalize();

                        // Pull strength (inverse square, slower than sphere)
                        const pullStrength = suctionSpeed * pull * 0.5 / (distToBH * 0.1 + 1);

                        // Apply suction to basePos (in LOCAL space, so scale down)
                        const localPull = pullStrength / sphereScale;
                        neuron.userData.basePos.addScaledVector(this.tmpVec2, localPull);

                        // Swirl effect (local space)
                        const swirlX = -this.tmpVec2.y * BLACK_HOLE.spin * 0.02 * pull / sphereScale;
                        const swirlY = this.tmpVec2.x * BLACK_HOLE.spin * 0.02 * pull / sphereScale;
                        neuron.userData.basePos.x += swirlX;
                        neuron.userData.basePos.y += swirlY;

                        // Absorption near horizon
                        if (distToBH < BLACK_HOLE.horizonRadius * 3) {
                            neuron.userData.absorbed = Math.min(1, neuron.userData.absorbed + 0.015 * pull);
                        }
                    }

                    // === SHRINK BASEPOS when absorbed (pull to center in local space) ===
                    // This makes neurons follow sphere deformation
                    if (absorb > 0.1) {
                        const shrinkFactor = 1 - absorb * 0.02; // Gradual shrink
                        neuron.userData.basePos.multiplyScalar(shrinkFactor);
                    }
                }

                // === CONSTRAIN WITHIN SPHERE BOUNDS ===
                // basePos is in LOCAL space
                const distFromCenter = neuron.userData.basePos.length();

                // Dynamic max radius from SoftBody (Physics Real-time)
                // Fallback to CFG.radius if undefined (e.g. first frame or missing reference)
                const currentR = this.sphere?.userData?.currentRadius;
                const dynamicRadius = (currentR || CFG.radius) * 0.9;

                // Allow sphereScale to affect it too (redundant if SoftBody handles vertices, but safe)
                // Actually, SoftBody vertices ARE scaled if sphere is scaled? 
                // SoftBody works on World Pos? No, Local Pos usually.
                // Let's assume currentRadius is correct.
                const effectiveMaxRadius = dynamicRadius;

                if (distFromCenter > effectiveMaxRadius) {
                    // Hard Clamp
                    neuron.userData.basePos.normalize().multiplyScalar(effectiveMaxRadius);

                    // Strong Dampening (User request: "sphere decreases velocity")
                    // Reflect velocity but lose 60% energy (0.4 restitution)
                    const normal = neuron.userData.basePos.clone().normalize();
                    neuron.userData.driftVel.reflect(normal).multiplyScalar(0.4);

                    // Add slight random jitter to prevent sticking
                    neuron.userData.driftVel.x += (Math.random() - 0.5) * 0.01;
                    neuron.userData.driftVel.y += (Math.random() - 0.5) * 0.01;
                    neuron.userData.driftVel.z += (Math.random() - 0.5) * 0.01;
                }

                // Minimum radius (don't go to center)
                const minRadius = CFG.radius * 0.05;
                if (distFromCenter < minRadius) {
                    neuron.userData.basePos.normalize().multiplyScalar(minRadius);
                }
            }

            // Relax absorption when BH inactive
            if (!bhActive) {
                neuron.userData.absorbed = Math.max(0, neuron.userData.absorbed - 0.02);
            }

            // Color: shift to red/orange when being absorbed
            const hue = absorb > 0.1
                ? 0.1 - absorb * 0.1
                : (0.5 - activity * 0.2 + t * 0.1) % 1;
            neuron.material.color.setHSL(Math.max(0, hue), 1, 0.5 + activity * 0.2);

            // Fix: Fully fade out and shrink
            neuron.material.opacity = (0.4 + activity * 0.4) * Math.max(0, 1 - absorb);
            neuron.scale.setScalar(Math.max(0.01, 1 - absorb)); // Scale down to almost zero

            // Final position: local basePos * sphereScale + spherePos
            const offset = Math.sin(t * 3 + i) * 0.1 * (1 - absorb * 0.5);
            neuron.position.copy(neuron.userData.basePos)
                .multiplyScalar(sphereScale)
                .add(spherePos)
                .addScaledVector(neuron.userData.unitDir, offset);
        });

        this.synapses.forEach((synapse, i) => {
            const pulse = Math.sin(t * 4 + i * 0.5) * 0.5 + 0.5;
            const fireIntensity = stressLevel + pulse * 0.2;
            synapse.material.opacity = 0.05 + fireIntensity * 0.1;

            const fromPos = this.neurons[synapse.userData.from].position;
            const toPos = this.neurons[synapse.userData.to].position;
            synapse.geometry.setFromPoints([fromPos, toPos]);
        });
    }
}
