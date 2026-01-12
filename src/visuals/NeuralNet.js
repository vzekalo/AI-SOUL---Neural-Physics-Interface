import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';
import { CFG } from '../config.js';

export class NeuralNet {
    constructor(scene) {
        this.scene = scene;
        this.neurons = [];
        this.synapses = [];
        this.neuronCount = 15;
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
                unitDir: new THREE.Vector3(x, y, z).normalize(),
                initR: r,
                pulsePhase: Math.random() * Math.PI * 2,
                driftVel: new THREE.Vector3(
                    (Math.random() - 0.5) * 0.015,
                    (Math.random() - 0.5) * 0.015,
                    (Math.random() - 0.5) * 0.015
                ),
                activity: 0
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

    update(stressLevel, sphereScale, spherePos) {
        const t = Date.now() * 0.001;
        this.neurons.forEach((neuron, i) => {
            const pulse = Math.sin(t * 2 + neuron.userData.pulsePhase) * 0.5 + 0.5;
            const activity = stressLevel * 1.0 + pulse * 0.2;
            const scale = 1 + activity * 0.25;
            neuron.scale.setScalar(scale);

            // Floating motion inside sphere bounds
            const drift = neuron.userData.driftVel;
            if (drift) {
                neuron.userData.basePos.add(drift);
                // Constrain within sphere radius
                const distFromCent = neuron.userData.basePos.length();
                if (distFromCent > CFG.radius * 0.8) {
                    neuron.userData.driftVel.reflect(neuron.userData.basePos.clone().normalize()).multiplyScalar(0.8);
                }
            }

            const hue = (0.5 - activity * 0.2 + t * 0.1) % 1;
            neuron.material.color.setHSL(hue, 1, 0.5 + activity * 0.2);
            neuron.material.opacity = 0.4 + activity * 0.4;

            const offset = Math.sin(t * 3 + i) * 0.1;
            neuron.position.copy(neuron.userData.basePos).multiplyScalar(sphereScale).add(spherePos).addScaledVector(neuron.userData.unitDir, offset);
        });

        this.synapses.forEach((synapse, i) => {
            const pulse = Math.sin(t * 4 + i * 0.5) * 0.5 + 0.5;
            const fireIntensity = stressLevel + pulse * 0.2;
            synapse.material.opacity = 0.05 + fireIntensity * 0.1;

            // Update line positions as neurons move
            const fromPos = this.neurons[synapse.userData.from].position;
            const toPos = this.neurons[synapse.userData.to].position;
            synapse.geometry.setFromPoints([fromPos, toPos]);
        });
    }
}
