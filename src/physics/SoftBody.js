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

        // Cinematic Physics Vectors
        this.axis = new THREE.Vector3(0, 0, 1);
        this.tan = new THREE.Vector3();
        this.tmpV3 = new THREE.Vector3();
        this.tmpV4 = new THREE.Vector3();
        this.absorb = new Float32Array(this.count); // 0..1 per vertex absorption state

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

            // -- SAFETY CHECK --
            if (isNaN(this.currentPos[idx]) || isNaN(this.currentPos[idx + 1]) || isNaN(this.currentPos[idx + 2])) {
                hasNaN = true;
                break;
            }

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
        let dt = Math.min(0.033, Math.max(0.008, deltaTime || 0.016));
        const t = performance.now() * 0.001;

        this.mesh.updateMatrixWorld();
        this.matInv.copy(this.mesh.matrixWorld).invert();

        // Pass 1: Reset forces & apply gravity
        const pos = this.currentPos;
        const vel = this.velocity;
        const count = this.count; // Corrected from `this.numVertices`
        const springK = 0.035; // These variables are introduced but not used in the provided snippet's loop.
        const friction = 0.92; // They might be intended for a later part of the physics update.

        // -- SAFETY FLAG --
        let hasNaN = false;

        for (let i = 0; i < count; i++) {
            const idx = i * 3;

            // -- SAFETY CHECK --
            if (isNaN(pos[idx]) || isNaN(pos[idx + 1]) || isNaN(pos[idx + 2])) {
                hasNaN = true;
                break;
            }
        }

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
                    // Check if this hand just released a pinch (was grabbing something)
                    // We prevent immediate push if the hand is still very close where it was pinching
                    // to prevent "explosion" effect
                    const justReleased = hand.grabVertex >= 0; // This might be cleared already by input system?
                    // Actually, grabVertex is set to -1 in update loop when !pinch.
                    // So we need a better heuristic. 

                    // PUSH interaction
                    // Only push if we are somewhat outside the sphere or if the movement is slow
                    if (d2h < pushRange2) {
                        const d = Math.sqrt(d2h) + 1e-6;
                        // Reduce push strength significantly to prevent "flying away"
                        // Also, maybe only push if d > sphereRadius * 0.8?
                        const tFac = 1 - (d / pushRange);
                        const str = this._ease(tFac) * 0.15; // Reduced from 0.4 to 0.15

                        this.velocity[idx] += (dxh / d) * str;
                        this.velocity[idx + 1] += (dyh / d) * str;
                        this.velocity[idx + 2] += (dzh / d) * str;
                    }
                }
            }

            // ---- CINEMATIC BLACK HOLE PHYSICS ----
            let bhFade = 0;

            if (bhEnabled) {
                const dx = bhX - x;
                const dy = bhY - y;
                const dz = bhZ - z;

                const r2 = dx * dx + dy * dy + dz * dz + BLACK_HOLE.eps * BLACK_HOLE.eps;
                const r = Math.sqrt(r2);

                if (r < influenceR) {
                    const t = 1 - (r / influenceR);
                    const infl = t * t * (3 - 2 * t); // smoothstep

                    const pullStr = pull; // Use global pull factor

                    // rHat (direction to BH)
                    const invR = 1 / r;
                    // We want vector FROM vertex TO BH, so (dx, dy, dz) is correct
                    const rHatX = dx * invR;
                    const rHatY = dy * invR;
                    const rHatZ = dz * invR;

                    // Gravity: GM / r^2
                    let aMag = BLACK_HOLE.mass / r2;
                    if (aMag > BLACK_HOLE.maxAccel) aMag = BLACK_HOLE.maxAccel;

                    // Swirl: Tangential acceleration around Z axis
                    // tHat = zAxis (0,0,1) cross rHat
                    // zAxis = (0,0,1) -> cross product simplified:
                    // cx = 0*rz - 1*ry = -ry
                    // cy = 1*rx - 0*rz = rx
                    // cz = 0*ry - 0*rx = 0
                    let tHatX = -rHatY;
                    let tHatY = rHatX;
                    let tHatZ = 0;

                    // Hardened Swirl: prevent division by zero near center
                    // r is distance to BH center.
                    // If r -> 0 and eps -> 0, this explodes.
                    const safeR = Math.sqrt(r2 + BLACK_HOLE.eps * BLACK_HOLE.eps) + 0.1;
                    const swirlMag = BLACK_HOLE.spin / safeR;

                    // Total acceleration
                    const aRadX = rHatX * aMag;
                    const aRadY = rHatY * aMag;
                    const aRadZ = rHatZ * aMag;

                    const aTanX = tHatX * swirlMag;
                    const aTanY = tHatY * swirlMag;
                    const aTanZ = tHatZ * swirlMag;

                    // Apply acceleration
                    this.velocity[idx] += (aRadX + aTanX) * dt * infl * pullStr;
                    this.velocity[idx + 1] += (aRadY + aTanY) * dt * infl * pullStr;
                    this.velocity[idx + 2] += (aRadZ + aTanZ) * dt * infl * pullStr;

                    // Drag (Inspiral energy loss)
                    const d = 1 - (BLACK_HOLE.drag * dt * infl * pullStr);
                    const damp = Math.max(0.86, d);
                    this.velocity[idx] *= damp;
                    this.velocity[idx + 1] *= damp;
                    this.velocity[idx + 2] *= damp;

                    // Tidal Forces (Spaghettification)
                    const tidalR = BLACK_HOLE.tidalRadius / sphereScale;
                    if (r < tidalR) {
                        const k = 1 - (r / tidalR);
                        // Radial stretching along rHat
                        const vDotR = this.velocity[idx] * rHatX + this.velocity[idx + 1] * rHatY + this.velocity[idx + 2] * rHatZ;
                        const add = vDotR * (k * 0.65 * BLACK_HOLE.tidalStrength) * dt;

                        this.velocity[idx] += rHatX * add;
                        this.velocity[idx + 1] += rHatY * add;
                        this.velocity[idx + 2] += rHatZ * add;

                        // Squeeze tangential
                        const squeeze = 1 - k * 0.12 * BLACK_HOLE.tidalStrength;
                        this.velocity[idx] *= squeeze;
                        this.velocity[idx + 1] *= squeeze;
                        this.velocity[idx + 2] *= squeeze;
                    }

                    // Absorption at Horizon
                    if (r < horizonR) {
                        // Absorption (Clamp per frame for smoothness)
                        const absorbRaw = Math.min(1, Math.max(0, (horizonR - r) / (horizonR - BLACK_HOLE.absorbRadius))) * BLACK_HOLE.absorbRate * dt * pull;
                        const absorb = Math.min(absorbRaw, 0.012); // Limit change per frame

                        // Audio Rumble Trigger (Safe)
                        if (absorb > 0.001 && Math.random() < 0.03) {
                            try {
                                if (window.audio && window.audio.triggerRumble) {
                                    window.audio.triggerRumble(0.8);
                                }
                            } catch (e) { console.warn('Audio Rumble fail', e); }
                        }

                        this.absorb[i] = Math.min(1, this.absorb[i] + absorb);

                        // Soften Z-pull
                        const depth = BLACK_HOLE.tunnelDepth * (0.35 + 0.65 * pull);
                        this.currentPos[idx + 2] -= absorb * depth; // Apply to Z component directly

                        // Gentle Shrink (assuming p is a vector, applying to currentPos components)
                        const shrinkFactor = (1 - absorb * BLACK_HOLE.shrinkRate);
                        this.currentPos[idx] *= shrinkFactor;
                        this.currentPos[idx + 1] *= shrinkFactor;
                        this.currentPos[idx + 2] *= shrinkFactor;

                        // Cheap Tidal Stretch (Spaghettification)
                        if (r < 30) { // Using 'r' for distance to BH center
                            const tidal = Math.max(0, (30 - r) / 30) * 0.03 * pull;
                            // Stretch along radial direction (rHat)
                            this.currentPos[idx] += rHatX * tidal * 2.5;
                            this.currentPos[idx + 1] += rHatY * tidal * 2.5;
                            this.currentPos[idx + 2] += rHatZ * tidal * 2.5;
                            // Squeeze
                            const squeezeFactor = (1 - tidal * 0.35);
                            this.currentPos[idx] *= squeezeFactor;
                            this.currentPos[idx + 1] *= squeezeFactor;
                            this.currentPos[idx + 2] *= squeezeFactor;
                        }
                        this.velocity[idx] *= (1 - 0.55 * this.absorb[i]); // Kill velocity

                        // Inside absorb radius: clamp to center to prevent explosion
                        const absR = BLACK_HOLE.absorbRadius / sphereScale;
                        if (r < absR) {
                            this.currentPos[idx] += (dx - this.currentPos[idx]) * 0.15 * a01;
                            this.currentPos[idx + 1] += (dy - this.currentPos[idx + 1]) * 0.15 * a01;
                            this.velocity[idx] *= 0.2;
                            this.velocity[idx + 1] *= 0.2;
                            this.velocity[idx + 2] *= 0.2;
                        }
                    } else {
                        // Relax absorption
                        this.absorb[i] = Math.max(0, this.absorb[i] - 0.25 * dt);
                    }

                    bhFade = this.absorb[i];
                } else {
                    this.absorb[i] = Math.max(0, this.absorb[i] - 1.0 * dt);
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

            // Apply black hole absorption fade
            // Use this.absorb[i] for accurate per-vertex fading
            const absorb = this.absorb[i];
            if (absorb > 0) {
                const energy = 1 - 0.85 * absorb;
                this.tmpColor.r *= energy;
                this.tmpColor.g *= energy;
                this.tmpColor.b *= energy;
            }

            this.colors[idx] = this.tmpColor.r;
            this.colors[idx + 1] = this.tmpColor.g;
            this.colors[idx + 2] = this.tmpColor.b;
        }

        // Emergency Reset if Physics Exploded
        if (hasNaN) {
            console.warn("Physics NaN detected! Emergency Reset.");
            for (let i = 0; i < count; i++) {
                const idx = i * 3;
                pos[idx] = this.originalPos[idx];
                pos[idx + 1] = this.originalPos[idx + 1];
                pos[idx + 2] = this.originalPos[idx + 2];
                vel[idx] = 0;
                vel[idx + 1] = 0;
                vel[idx + 2] = 0;
                this.absorb[i] = 0;
            }
        }

        STATE.stressEMA = STATE.stressEMA * 0.92 + maxStress * 0.08;
        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.attributes.color.needsUpdate = true;
    }
}
