import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';
import { STATE, BLACK_HOLE, CFG } from '../config.js';
import { SoftBody } from './SoftBody.js';
import { Singularity } from './Singularity.js';
import { AccretionDisk } from '../visuals/AccretionDisk.js';
import { Jets } from '../visuals/Jets.js';
import { EventHorizon } from '../visuals/EventHorizon.js';

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

        // Event Horizon Glow (New visual effect)
        this.eventHorizon = new EventHorizon(scene, BLACK_HOLE);

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
                type: 'ar-cube',
                initPos: cube.position.clone(),
                angle: angle,
                targetNeuronIdx: targetNeuronIdx,
                grabbed: false
            };
            this.scene.add(cube);
            this.arObjects.push(cube);
        }
    }

    update(hands, camera, deltaTime) {
        // Safe deltaTime with bounds
        const dt = Math.min(0.05, Math.max(0.001, deltaTime || 0.016));
        const t = Date.now() * 0.001;
        this.singularity.update(camera);

        // Physics substeps for stability at high pull values
        const pull = STATE.blackHolePull;
        const substeps = pull > 0.7 ? 2 : 1;
        const subDt = dt / substeps;

        for (let s = 0; s < substeps; s++) {
            // Update Sphere SoftBody with Neuron Repulsion
            // Pass neuralNet.neurons so SoftBody can calculate internal pressure from neurons
            this.softBody.update(hands, this.singularity, subDt, this.neuralNet.neurons);
        }

        // Physics Loop specific to Singularity Mode
        if (STATE.mode === 'SINGULARITY') {
            // Update Black Hole Visuals
            const bhPos = this.singularity.pos;
            const pull = STATE.blackHolePull; // Eased value from main.js

            if (this.disk) {
                this.disk.setCenter(bhPos);
                this.disk.update(dt, t, pull);
                if (!this.disk.points.visible) this.disk.points.visible = true;
            }

            if (this.jets) {
                this.jets.setCenter(bhPos);
                this.jets.update(dt, t, pull, STATE.stressEMA);
                if (!this.jets.points.visible) this.jets.points.visible = true;
            }

            // Event Horizon Glow
            if (this.eventHorizon) {
                this.eventHorizon.setCenter(bhPos);
                this.eventHorizon.update(dt, t, pull);
            }

            // Global pull towards black hole
            this.singularity.applyPull(this.sphere, dt);
        } else {
            // Hide visuals when not active
            if (this.disk && this.disk.points.visible) this.disk.points.visible = false;
            if (this.jets && this.jets.points.visible) this.jets.points.visible = false;
            // EventHorizon handles its own visibility based on pull
            if (this.eventHorizon) this.eventHorizon.update(dt, t, 0);
        }

        // Update AR Objects
        this.arObjects.forEach(obj => {
            if (obj.userData.grabbed) {
                // Logic for grabbed items is handled in main loop (mapping to hand)
            } else {
                // Orbit
                obj.userData.angle += dt * 0.2;
                const r = 18 + Math.sin(t + obj.userData.angle) * 2;
                obj.position.x = Math.cos(obj.userData.angle) * r;
                obj.position.y = Math.sin(obj.userData.angle) * r;
                obj.position.z = Math.sin(t * 0.5 + obj.userData.angle) * 5;
            }
            obj.rotation.x += dt;
            obj.rotation.y += dt;

            // Connect line to neuron
            // (Optional visual logic could go here)
        });
    }

    reset() {
        if (this.softBody && this.softBody.reset) this.softBody.reset();
        if (this.singularity && this.singularity.reset) this.singularity.reset(this.sphere);

        // Reset Visuals
        if (this.disk && this.disk.points) this.disk.points.visible = false;
        if (this.jets && this.jets.points) this.jets.points.visible = false;
        console.log("🌌 Physics World Reset");
    }
}
