import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';
import { CFG, BLACK_HOLE, STATE } from '../config.js';

/**
 * SoftBody (CPU deformation)
 *
 * Features:
 * - Inverse-square gravity with softening
 * - Swirl (accretion spiral) + tidal squeeze
 * - Event horizon collapse + darkening
 * - Grab points: pinch attaches to nearest vertex and pulls it
 * - Tunnel stretching: sphere deforms into funnel shape during black hole
 * - Pinch only works when touching the sphere
 */
export class SoftBody {
    constructor(mesh) {
        this.mesh = mesh;
        this.geometry = mesh.geometry;
        this.posAttr = this.geometry.attributes.position;
        this.origPos = this.posAttr.array.slice();
        this.colors = this.geometry.attributes.color.array;
        this.count = this.posAttr.count;

        // Physics buffers
        this.currentPos = this.posAttr.array.slice();
        this.velocity = new Float32Array(this.count * 3);

        // Grab points: Map<handId, {vertexIndex, offset}>
        this.grabPoints = new Map();

        // Scratch vectors
        this.vTmp = new THREE.Vector3();
        this.vWorld = new THREE.Vector3();
        this.vOrig = new THREE.Vector3();
        this.vBH = new THREE.Vector3();
        this.vHandWorld = new THREE.Vector3();
        this.dir = new THREE.Vector3();
        this.tangent = new THREE.Vector3();
        this.matInv = new THREE.Matrix4();

        // Reusable color object
        this.tmpColor = new THREE.Color();

        // Local hands array
        this._handsLocal = [];
        this._prevPinch = {};
    }

    _clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }
    _ease(t) {
        t = this._clamp01(t);
        return t * t * (3 - 2 * t);
    }

    // Find closest vertex to a world position
    _findClosestVertex(worldPos) {
        let minDist = Infinity;
        let closestIdx = -1;

        for (let i = 0; i < this.count; i++) {
            const idx = i * 3;
            this.vTmp.set(this.currentPos[idx], this.currentPos[idx + 1], this.currentPos[idx + 2]);
            this.vTmp.applyMatrix4(this.mesh.matrixWorld);

            const dist = this.vTmp.distanceTo(worldPos);
            if (dist < minDist) {
                minDist = dist;
                closestIdx = i;
            }
        }

        return { index: closestIdx, distance: minDist };
    }

    update(hands, singularity, deltaTime) {
        const dt = Math.min(0.033, Math.max(0.001, deltaTime || 0.016));
        const t = performance.now() * 0.001;

        this.mesh.updateMatrixWorld();
        this.matInv.copy(this.mesh.matrixWorld).invert();

        const sphereScale = this.mesh.scale.x || 1;
        const sphereRadius = CFG.radius * sphereScale;

        // Breathing
        const breathing = 1.0 + Math.sin(t * 1.2) * 0.025;

        // ---- Process hands and grab points ----
        const hl = this._handsLocal;
        hl.length = 0;

        const currentPinchState = {};
        const touchRadius = sphereRadius * 2.5; // Increased range for easier grabbing

        if (hands) {
            for (const k in hands) {
                const h = hands[k];
                if (!h || !h.pos) continue;

                const handId = k;
                currentPinchState[handId] = h.pinch;

                // Transform hand to local space
                this.vTmp.copy(h.pos).applyMatrix4(this.matInv);
                this.vHandWorld.copy(h.pos);

                // Distance to sphere center
                const distToCenter = this.vHandWorld.length();
                const isTouchingSphere = distToCenter < touchRadius;

                if (h.pinch) {
                    if (!this._prevPinch[handId]) {
                        // Just started pinching - find grab point if close enough
                        const closest = this._findClosestVertex(this.vHandWorld);
                        if (closest.index >= 0 && closest.distance < touchRadius) {
                            this.grabPoints.set(handId, {
                                vertexIndex: closest.index,
                                initialHandPos: this.vHandWorld.clone()
                            });
                        }
                    }
                    // Add to local hands list for processing
                    const grab = this.grabPoints.get(handId);
                    hl.push({
                        x: this.vTmp.x,
                        y: this.vTmp.y,
                        z: this.vTmp.z,
                        pinch: true,
                        grabVertex: grab ? grab.vertexIndex : -1,
                        handId
                    });
                } else {
                    // Not pinching - clear grab point
                    this.grabPoints.delete(handId);

                    // Push interaction (when not pinching)
                    hl.push({
                        x: this.vTmp.x,
                        y: this.vTmp.y,
                        z: this.vTmp.z,
                        pinch: false,
                        grabVertex: -1,
                        handId
                    });
                }

                this._prevPinch[handId] = h.pinch;
            }
        }

        // Clean up old grab points for hands that disappeared
        for (const handId of this.grabPoints.keys()) {
            if (!(handId in (hands || {}))) {
                this.grabPoints.delete(handId);
            }
        }

        // ---- Black hole state ----
        let bhEnabled = false;
        let bhX = 0, bhY = 0, bhZ = 0;
        let influenceR = 0, horizonR = 0, softR = 0;
        let pull = 0;

        if (singularity && singularity.enabled && STATE.blackHolePull > 0.001) {
            this.vBH.copy(singularity.pos).applyMatrix4(this.matInv);
            bhX = this.vBH.x; bhY = this.vBH.y; bhZ = this.vBH.z;

            influenceR = (BLACK_HOLE.influenceRadius ?? 70) / sphereScale;
            horizonR = (BLACK_HOLE.horizonRadius ?? 6) / sphereScale;
            softR = (BLACK_HOLE.softening ?? 1.25) / sphereScale;

            pull = STATE.blackHolePull;
            bhEnabled = true;
        }

        const pushRange = CFG.pushRange;
        const pushRange2 = pushRange * pushRange;

        const gravBase = BLACK_HOLE.gravity ?? 0.85;
        const maxAccel = BLACK_HOLE.maxAccel ?? 1.35;
        const swirlBase = BLACK_HOLE.swirlSpeed ?? 0.65;
        const tidalBase = BLACK_HOLE.tidal ?? 0.5;
        const horizonPull = BLACK_HOLE.horizonPull ?? 0.42;

        let maxStress = 0;

        for (let i = 0; i < this.count; i++) {
            const idx = i * 3;

            const x = this.currentPos[idx];
            const y = this.currentPos[idx + 1];
            const z = this.currentPos[idx + 2];

            const ox = this.origPos[idx] * breathing;
            const oy = this.origPos[idx + 1] * breathing;
            const oz = this.origPos[idx + 2] * breathing;

            // Spring force
            this.velocity[idx] += (ox - x) * CFG.spring;
            this.velocity[idx + 1] += (oy - y) * CFG.spring;
            this.velocity[idx + 2] += (oz - z) * CFG.spring;

            // ---- Hand interactions ----
            for (let h = 0; h < hl.length; h++) {
                const hand = hl[h];
                const dxh = x - hand.x;
                const dyh = y - hand.y;
                const dzh = z - hand.z;
                const d2h = dxh * dxh + dyh * dyh + dzh * dzh;

                if (hand.pinch && hand.grabVertex >= 0) {
                    // Calculate pull based on hand distance
                    const handDist = Math.sqrt(d2h);

                    // Get grabbed vertex current position
                    const grabIdx = hand.grabVertex * 3;
                    const gx = this.currentPos[grabIdx];
                    const gy = this.currentPos[grabIdx + 1];
                    const gz = this.currentPos[grabIdx + 2];

                    if (i === hand.grabVertex) {
                        // Main grabbed vertex - pull toward hand
                        const basePull = Math.min(handDist * 0.12, CFG.gripStrength);
                        const pullStrength = basePull * 0.8;

                        if (handDist > 0.1) {
                            this.velocity[idx] += (-dxh / handDist) * pullStrength;
                            this.velocity[idx + 1] += (-dyh / handDist) * pullStrength;
                            this.velocity[idx + 2] += (-dzh / handDist) * pullStrength;
                        }
                    } else {
                        // Nearby vertices: FOLLOW the grabbed vertex, not the hand
                        const distToGrab = Math.sqrt(
                            (x - gx) ** 2 + (y - gy) ** 2 + (z - gz) ** 2
                        );

                        const influenceRadius = 10.0; // Large influence for proper stretching

                        if (distToGrab < influenceRadius) {
                            // Direction from this vertex toward grabbed vertex
                            const dgx = gx - x;
                            const dgy = gy - y;
                            const dgz = gz - z;

                            // How far is grabbed vertex from its original position?
                            const origGrabIdx = hand.grabVertex * 3;
                            const origGx = this.origPos[origGrabIdx];
                            const origGy = this.origPos[origGrabIdx + 1];
                            const origGz = this.origPos[origGrabIdx + 2];
                            const grabDisplacement = Math.sqrt(
                                (gx - origGx) ** 2 + (gy - origGy) ** 2 + (gz - origGz) ** 2
                            );

                            // Falloff based on distance to grab point
                            const falloff = Math.pow(1 - distToGrab / influenceRadius, 1.5);

                            // Pull strength based on how much the grabbed vertex moved
                            const followStrength = grabDisplacement * 0.15 * falloff;

                            if (followStrength > 0.001) {
                                const norm = distToGrab + 0.01;
                                this.velocity[idx] += (dgx / norm) * followStrength;
                                this.velocity[idx + 1] += (dgy / norm) * followStrength;
                                this.velocity[idx + 2] += (dgz / norm) * followStrength;
                            }
                        }
                    }
                } else if (!hand.pinch) {
                    // Push interaction (repulsion when not pinching)
                    if (d2h < pushRange2) {
                        const d = Math.sqrt(d2h) + 1e-6;
                        const tFac = 1 - (d / pushRange);
                        const str = this._ease(tFac) * 0.4;

                        this.velocity[idx] += (dxh / d) * str;
                        this.velocity[idx + 1] += (dyh / d) * str;
                        this.velocity[idx + 2] += (dzh / d) * str;
                    }
                }
            }

            // ---- Black hole like PINCH but SLOWER ----
            let bhFade = 0;

            if (bhEnabled) {
                const dx = bhX - x;
                const dy = bhY - y;
                const dz = bhZ - z;

                const r2 = dx * dx + dy * dy + dz * dz;
                const r = Math.sqrt(r2) + 1e-6;

                // Influence falloff: strong near BH, weak far away
                const normalizedDist = r / influenceR;
                const influence = Math.max(0, 1 - normalizedDist) * pull;

                if (influence > 0.01) {
                    // Find how far this vertex is from center of sphere (origin)
                    const distFromCenter = Math.sqrt(x * x + y * y + z * z);

                    // Vertices CLOSER to BH get pulled more (like pinch grabs nearest point)
                    const proximityFactor = Math.pow(1 - normalizedDist, 2);

                    // Slow pull toward BH (much slower than pinch)
                    const pullStrength = proximityFactor * pull * 0.015; // Very slow

                    if (pullStrength > 0.001) {
                        const invR = 1 / r;
                        // Pull toward BH center
                        this.velocity[idx] += dx * invR * pullStrength;
                        this.velocity[idx + 1] += dy * invR * pullStrength;
                        this.velocity[idx + 2] += dz * invR * pullStrength;
                    }

                    // Slight swirl for visual effect
                    const swirl = swirlBase * influence * 0.3 / (r + softR);
                    this.tangent.set(-dy, dx, 0);
                    const tl2 = this.tangent.lengthSq();
                    if (tl2 > 1e-8) {
                        this.tangent.multiplyScalar(1 / Math.sqrt(tl2));
                        this.velocity[idx] += this.tangent.x * swirl;
                        this.velocity[idx + 1] += this.tangent.y * swirl;
                        this.velocity[idx + 2] += this.tangent.z * swirl;
                    }

                    // Direct position pull for vertices VERY close to BH
                    if (r < influenceR * 0.5) {
                        const tearStrength = pull * 0.03 * (1 - r / (influenceR * 0.5));
                        this.currentPos[idx] += dx * tearStrength;
                        this.currentPos[idx + 1] += dy * tearStrength;
                        this.currentPos[idx + 2] += dz * tearStrength;
                    }

                    // Tidal squeeze: damp perpendicular velocity (creates stretching)
                    const tidal = tidalBase * influence / (r + 1.0);

                    const vx = this.velocity[idx];
                    const vy = this.velocity[idx + 1];
                    const vz = this.velocity[idx + 2];

                    const vDotR = vx * this.dir.x + vy * this.dir.y + vz * this.dir.z;
                    const vRx = this.dir.x * vDotR;
                    const vRy = this.dir.y * vDotR;
                    const vRz = this.dir.z * vDotR;

                    const pDx = vx - vRx;
                    const pDy = vy - vRy;
                    const pDz = vz - vRz;

                    const damp = Math.max(0, 1 - tidal * 0.5);
                    this.velocity[idx] = vRx + pDx * damp;
                    this.velocity[idx + 1] = vRy + pDy * damp;
                    this.velocity[idx + 2] = vRz + pDz * damp;

                    // Event horizon: strong collapse
                    if (r < horizonR) {
                        const c = (horizonR - r) / Math.max(1e-6, horizonR);
                        const collapse = Math.min(1, c * horizonPull * 1.5);
                        this.currentPos[idx] += dx * collapse;
                        this.currentPos[idx + 1] += dy * collapse;
                        this.currentPos[idx + 2] += dz * collapse;
                        bhFade = 1;
                    } else {
                        const fadeStart = horizonR * 2.0;
                        bhFade = this._ease((fadeStart - r) / Math.max(1e-6, fadeStart));
                    }
                }
            }

            // Integration & Friction
            this.velocity[idx] *= 0.88;
            this.velocity[idx + 1] *= 0.88;
            this.velocity[idx + 2] *= 0.88;

            this.currentPos[idx] += this.velocity[idx] * dt * 60;
            this.currentPos[idx + 1] += this.velocity[idx + 1] * dt * 60;
            this.currentPos[idx + 2] += this.velocity[idx + 2] * dt * 60;

            this.posAttr.setXYZ(i, this.currentPos[idx], this.currentPos[idx + 1], this.currentPos[idx + 2]);

            // Stress
            const sx = this.currentPos[idx] - this.origPos[idx];
            const sy = this.currentPos[idx + 1] - this.origPos[idx + 1];
            const sz = this.currentPos[idx + 2] - this.origPos[idx + 2];
            const stress = Math.sqrt(sx * sx + sy * sy + sz * sz);
            maxStress = Math.max(maxStress, stress);

            // Color based on stress: cyan → yellow → orange → red
            const stressNorm = Math.min(1.0, stress * 0.5); // More sensitive

            if (stressNorm < 0.2) {
                // Low stress: cyan/blue
                this.tmpColor.setHSL(0.55, 1.0, 0.5);
            } else if (stressNorm < 0.4) {
                // Light stress: yellow
                const t = (stressNorm - 0.2) / 0.2;
                this.tmpColor.setHSL(0.55 - t * 0.4, 1.0, 0.5); // cyan to yellow
            } else if (stressNorm < 0.7) {
                // Medium stress: orange
                const t = (stressNorm - 0.4) / 0.3;
                this.tmpColor.setHSL(0.15 - t * 0.08, 1.0, 0.5); // yellow to orange
            } else {
                // High stress: red
                const t = (stressNorm - 0.7) / 0.3;
                this.tmpColor.setHSL(0.07 - t * 0.07, 1.0, 0.45 + t * 0.1); // orange to red
            }

            if (bhFade > 0) {
                const m = 1 - bhFade * 0.9;
                this.tmpColor.r *= m;
                this.tmpColor.g *= m;
                this.tmpColor.b *= m;
            }

            this.colors[idx] = this.tmpColor.r;
            this.colors[idx + 1] = this.tmpColor.g;
            this.colors[idx + 2] = this.tmpColor.b;
        }

        STATE.stressEMA = STATE.stressEMA * 0.92 + maxStress * 0.08;
        this.posAttr.needsUpdate = true;
        this.geometry.attributes.color.needsUpdate = true;
    }
}
