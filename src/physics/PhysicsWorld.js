import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';
import { STATE, BLACK_HOLE, CFG } from '../config.js';
import { SoftBody } from './SoftBody.js';
import { Singularity } from './Singularity.js';
import { AccretionDisk } from '../visuals/AccretionDisk.js';
import { Jets } from '../visuals/Jets.js';

export class PhysicsWorld {
    constructor(scene, sphere, neuralNet) {
        this.scene = scene;
        this.sphere = sphere;
        this.neuralNet = neuralNet;
        this.softBody = new SoftBody(sphere);
        this.singularity = new Singularity();

        // Visuals
        if (BLACK_HOLE.accretion && BLACK_HOLE.accretion.enabled) {
            this.disk = new AccretionDisk(scene, BLACK_HOLE.accretion);
            // Ensure hidden initially
            if (this.disk && this.disk.points) this.disk.points.visible = false;
        }
        if (BLACK_HOLE.jets && BLACK_HOLE.jets.enabled) {
            this.jets = new Jets(scene, BLACK_HOLE.jets);
            if (this.jets && this.jets.points) this.jets.points.visible = false;
        }

        this.arObjects = [];
    }

    initARObjects() {
        const cubeGeo = new THREE.BoxGeometry(1.5, 1.5, 1.5);
        for (let i = 0; i < 6; i++) {
            const cubeMat = new THREE.MeshBasicMaterial({
                color: 0xffffff,
                wireframe: true,
                transparent: true,
                opacity: 0.6
            });
            const cube = new THREE.Mesh(cubeGeo, cubeMat);
            const angle = (i / 6) * Math.PI * 2;
            cube.position.set(Math.cos(angle) * 18, Math.sin(angle) * 18, 0);

            // Bind each cube to a neuron
            const targetNeuronIdx = i % this.neuralNet.neurons.length;

            cube.userData = {
                orbitAngle: angle,
                orbitSpeed: 0.005 + Math.random() * 0.005,
                grabbed: false,
                velocity: new THREE.Vector3(),
                lastPos: new THREE.Vector3().copy(cube.position),
                targetNeuronIdx: targetNeuronIdx
            };
            this.scene.add(cube);
            this.arObjects.push(cube);

            // Link lines (Neural Links)
            const lineMat = new THREE.LineBasicMaterial({
                color: 0x00f3ff,
                transparent: true,
                opacity: 0.15,
                blending: THREE.AdditiveBlending
            });
            const line = new THREE.Line(new THREE.BufferGeometry(), lineMat);
            this.scene.add(line);
            cube.userData.linkLine = line;
        }
    }

    update(hands, camera, deltaTime) {
        const t = Date.now() * 0.001;
        this.singularity.update(camera);

        // Update Sphere SoftBody
        this.softBody.update(hands, this.singularity, deltaTime);

        // Physics Loop specific to Singularity Mode
        if (STATE.mode === 'SINGULARITY') {
            // Update Black Hole Visuals
            const bhPos = this.singularity.pos;
            const pull = STATE.blackHolePull; // Eased value from main.js

            if (this.disk) {
                this.disk.setCenter(bhPos);
                this.disk.update(deltaTime, t, pull);
                if (!this.disk.points.visible) this.disk.points.visible = true;
            }
            if (this.jets) {
                this.jets.setCenter(bhPos);
                this.jets.update(deltaTime, t);
                if (!this.jets.points.visible) this.jets.points.visible = true;
            }

            // Global pull towards black hole
            this.singularity.applyPull(this.sphere, deltaTime);
        } else {
            // Hide visuals when not active
            if (this.disk && this.disk.points.visible) this.disk.points.visible = false;
            if (this.jets && this.jets.points.visible) this.jets.points.visible = false;
        }

        // Update AR Objects
        this.arObjects.forEach(obj => {
            if (obj.userData.grabbed) {
                // Logic for grabbed items is handled in main loop (mapping to hand)
            } else {
                // Orbit
                obj.userData.orbitAngle += obj.userData.orbitSpeed;
                const r = 18 + Math.sin(t + obj.userData.orbitAngle) * 2;
                const targetPos = new THREE.Vector3(
                    Math.cos(obj.userData.orbitAngle) * r,
                    Math.sin(obj.userData.orbitAngle) * r,
                    Math.sin(t * 0.5) * 5
                );
                obj.position.lerp(targetPos, 0.05);

                // Singularity Pull
                this.singularity.applyPull(obj, deltaTime);
            }

            // Update visual links to Neurons
            if (obj.userData.linkLine && this.neuralNet.neurons[obj.userData.targetNeuronIdx]) {
                const targetPos = this.neuralNet.neurons[obj.userData.targetNeuronIdx].position;
                obj.userData.linkLine.geometry.setFromPoints([obj.position, targetPos]);
                obj.userData.linkLine.material.opacity = 0.05 + Math.sin(t * 2) * 0.05 + (STATE.stressEMA * 0.2);
            }

            // Momentum coupling: Grabbed cubes pull the sphere
            if (obj.userData.grabbed) {
                const deltaPos = obj.position.clone().sub(obj.userData.lastPos);
                STATE.sphereVelocity.addScaledVector(deltaPos, 0.35); // Dragging influence
            }
            obj.userData.lastPos.copy(obj.position);
        });

        // Global Sphere Physics (Slow drift & Hand Push)
        if (STATE.mode === 'NORMAL') {
            // Push sphere by hands
            Object.values(hands).forEach(hand => {
                const dist = hand.pos.distanceTo(this.sphere.position);
                if (dist < 20) {
                    const force = (1.0 - dist / 20) * 0.15;
                    const dir = this.sphere.position.clone().sub(hand.pos).normalize();
                    STATE.sphereVelocity.addScaledVector(dir, force);
                }
            });

            this.sphere.position.addScaledVector(STATE.sphereVelocity, 0.1);
            STATE.sphereVelocity.multiplyScalar(0.92); // Friction for whole sphere

            // Stay near center
            this.sphere.position.multiplyScalar(0.995);
        }
    }
}
