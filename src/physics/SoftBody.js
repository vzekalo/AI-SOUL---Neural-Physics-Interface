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
        this.dir = new THREE.Vector3();
        this.tangent = new THREE.Vector3();
        this.matInv = new THREE.Matrix4();

        // Dynamic Center of Mass for neuron tracking
        this.centerOfMass = new THREE.Vector3();

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

            // -- SAFETY CHECK -- Skip NaN vertices
            if (!isFinite(this.currentPos[idx]) || !isFinite(this.currentPos[idx + 1]) || !isFinite(this.currentPos[idx + 2])) {
                continue; // Skip invalid vertices instead of breaking
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

    // Reset soft body to initial state
    reset() {
        const count = this.count;
        for (let i = 0; i < count; i++) {
            const idx = i * 3;
            // Reset positions to original
            this.currentPos[idx] = this.origPos[idx];
            this.currentPos[idx + 1] = this.origPos[idx + 1];
            this.currentPos[idx + 2] = this.origPos[idx + 2];

            // Zero velocities
            this.velocity[idx] = 0;
            this.velocity[idx + 1] = 0;
            this.velocity[idx + 2] = 0;

            // Reset absorption
            this.absorb[i] = 0;
        }

        // Update geometry
        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.attributes.color.needsUpdate = true;

        // Reset CoM
        this.centerOfMass.set(0, 0, 0);
        if (this.mesh.userData.centerOfMass) this.mesh.userData.centerOfMass.set(0, 0, 0);
        this.mesh.userData.currentRadius = CFG.radius;

        // CRITICAL: Recompute bounds to ensure frustum culling doesn't hide the reset sphere
        this.geometry.computeBoundingSphere();
        this.geometry.computeBoundingBox();

        console.log("🔄 SoftBody reset & bounds recomputed");
    }

    update(hands, singularity, deltaTime, neurons = null) {
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

        // Breathing - DISABLED during black hole to prevent expansion
        // Use STATE directly since local bhEnabled/pull are defined later
        const breathingActive = STATE.mode !== 'SINGULARITY' || STATE.blackHolePull < 0.3;
        const breathing = breathingActive ? (1.0 + Math.sin(t * 1.2) * 0.025) : 1.0;

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
        let sumRadius = 0;
        let sumRadiusXY = 0;
        let sumRadiusZ = 0;
        let sumX = 0, sumY = 0, sumZ = 0;
        const cx = this.centerOfMass.x; // Use previous frame CoM for radius calc
        const cy = this.centerOfMass.y;
        const cz = this.centerOfMass.z;

        for (let i = 0; i < this.count; i++) {
            const idx = i * 3;

            const x = this.currentPos[idx];
            const y = this.currentPos[idx + 1];
            const z = this.currentPos[idx + 2];

            // Accumulate Center of Mass
            sumX += x; sumY += y; sumZ += z;

            // Accumulate radius relative to Center of Mass (not Origin!)
            const dx = x - cx;
            const dy = y - cy;
            const dz = z - cz;
            sumRadius += Math.sqrt(dx * dx + dy * dy + dz * dz);
            sumRadiusXY += Math.sqrt(dx * dx + dy * dy);
            sumRadiusZ += Math.abs(dz);

            // ... rest of loop ...


            // Calculate per-vertex shrink based on absorption
            const vertexAbsorb = this.absorb[i] || 0;
            // Fix: Allow full shrink to 0.0
            const shrinkFactor = Math.max(0, 1.0 - vertexAbsorb);

            const ox = this.origPos[idx] * breathing * shrinkFactor;
            const oy = this.origPos[idx + 1] * breathing * shrinkFactor;
            const oz = this.origPos[idx + 2] * breathing * shrinkFactor;

            // Spring force - REDUCED during black hole to allow suction
            // Also reduce based on absorption (absorbed vertices lose spring)
            const absorbReduction = 1.0 - vertexAbsorb * 0.8;
            const springFactor = bhEnabled ? Math.max(0.05, (1 - pull * 0.9) * absorbReduction) : 1.0;
            this.velocity[idx] += (ox - x) * CFG.spring * springFactor;
            this.velocity[idx + 1] += (oy - y) * CFG.spring * springFactor;
            this.velocity[idx + 2] += (oz - z) * CFG.spring * springFactor;

            // ---- NEURON REPULSION (Internal Pressure) ----
            if (neurons) {
                // Optimized CPU repulsion
                // User Request: Interact only on "Direct Touch"
                // Reduced from 4.0 to 1.5 (Sq: 2.25)
                const neuronPushRadiusSq = 2.25;
                const touchRadius = 1.5;

                for (let k = 0; k < neurons.length; k++) {
                    const nUserData = neurons[k].userData;
                    const nx = nUserData.basePos.x;
                    const ny = nUserData.basePos.y;
                    const nz = nUserData.basePos.z;

                    const dx = x - nx;
                    const dy = y - ny;
                    const dz = z - nz;
                    const d2 = dx * dx + dy * dy + dz * dz;

                    if (d2 < neuronPushRadiusSq) {
                        const dist = Math.sqrt(d2) + 0.001;
                        // Push stronger if closer. 
                        const pushFactor = (1.0 - dist / touchRadius);
                        const activity = nUserData.activity || 0;
                        const strength = pushFactor * (0.15 + activity * 0.25);

                        this.velocity[idx] += (dx / dist) * strength;
                        this.velocity[idx + 1] += (dy / dist) * strength;
                        this.velocity[idx + 2] += (dz / dist) * strength;
                    }
                }
            }

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

            // ---- REALISTIC SPAGHETTIFICATION PHYSICS ----
            let bhFade = 0;

            if (bhEnabled) {
                // UNIFIED TARGET: Pull everything into the deep tunnel
                // This ensures Gravity and Funnel forces agree on direction (-Z)
                const tunnelDepth = BLACK_HOLE.tunnelDepth || 8;
                const targetZ = bhZ - tunnelDepth;

                const dx = bhX - x;
                const dy = bhY - y;
                const dz = targetZ - z; // Gravity pulls to deep point

                // OPTIMIZATION: Use distSq for early exit
                const distSq = dx * dx + dy * dy + dz * dz;
                const influenceRSq = influenceR * influenceR;

                // For distant vertices - still apply gravity but weaker
                // DO NOT use continue - it skips integration!

                const softening = BLACK_HOLE.eps * BLACK_HOLE.eps;
                const safeDist = Math.sqrt(distSq + softening);
                const invDist = 1 / safeDist;

                // Normalized direction TO deep center
                const rHatX = dx * invDist;
                const rHatY = dy * invDist;
                const rHatZ = dz * invDist;

                // === UNIVERSAL GRAVITY ===
                // Now pulls towards the deep targetZ, preventing "forward pull"
                const basePull = BLACK_HOLE.mass / (distSq + softening + 100);
                const distantPull = Math.min(basePull, BLACK_HOLE.maxAccel * 0.3);

                // Apply base gravity to ALL vertices
                this.velocity[idx] += rHatX * distantPull * dt * pull;
                this.velocity[idx + 1] += rHatY * distantPull * dt * pull;
                this.velocity[idx + 2] += rHatZ * distantPull * dt * pull;

                // === DIRECT POSITION PULL (Funnel Effect) ===
                const suctionSpeed = BLACK_HOLE.suctionSpeed || 0.15;
                const ease = pull * dt * suctionSpeed * 8.0;

                // Apply force towards the DEEP target (Funnel)
                // We use the same dx, dy, dz (which are already pointing to target)
                this.currentPos[idx] += dx * ease * 0.8;     // Strong XY alignment
                this.currentPos[idx + 1] += dy * ease * 0.8; // Strong XY alignment
                this.currentPos[idx + 2] += dz * ease * 0.5; // Moderate Z depth

                // Skip detailed physics for very distant vertices
                if (distSq > influenceRSq) {
                    this.absorb[i] = Math.max(0, this.absorb[i] - 1.0 * dt);
                } else {
                    // === CLAMP TO CENTER IF ABSORBED ===
                    if (this.absorb[i] >= 0.95 || distSq < 1.0) {
                        this.currentPos[idx] = bhX;
                        this.currentPos[idx + 1] = bhY;
                        this.currentPos[idx + 2] = bhZ;
                        this.velocity[idx] = 0;
                        this.velocity[idx + 1] = 0;
                        this.velocity[idx + 2] = 0;
                        continue; // Stop processing this vertex
                    }
                    // === INSIDE INFLUENCE ZONE ===
                    const t = 1 - (safeDist / influenceR);
                    const infl = t * t * (3 - 2 * t);

                    // Strong pinch for close vertices
                    const pinchStrength = BLACK_HOLE.mass / (distSq + softening);
                    const clampedPinch = Math.min(pinchStrength, BLACK_HOLE.maxAccel);
                    const radialAccel = clampedPinch * dt * infl * pull;

                    this.velocity[idx] += rHatX * radialAccel;
                    this.velocity[idx + 1] += rHatY * radialAccel;
                    this.velocity[idx + 2] += rHatZ * radialAccel;

                    // === STRONGER DIRECT POSITION PULL for close vertices ===
                    const strongPull = infl * pull * dt * suctionSpeed * 12;
                    this.currentPos[idx] += dx * strongPull * 0.1;
                    this.currentPos[idx + 1] += dy * strongPull * 0.1;
                    this.currentPos[idx + 2] += dz * strongPull * 0.1;

                    // === PHASE 3: SWIRL (Spiral Rotation) ===
                    // Cross product: upAxis(0,0,1) × rHat = (-rHatY, rHatX, 0)
                    const tangentX = -rHatY;
                    const tangentY = rHatX;
                    // tangentZ = 0 for rotation around Z axis

                    // Swirl increases closer to center
                    const swirlStrength = BLACK_HOLE.spin / (safeDist + 1.0);
                    const swirlAccel = swirlStrength * dt * infl * pull;

                    this.velocity[idx] += tangentX * swirlAccel;
                    this.velocity[idx + 1] += tangentY * swirlAccel;

                    // === PHASE 4: COMPRESSION (Perpendicular Squeeze) ===
                    // Compute radial velocity component
                    const vDotR = this.velocity[idx] * rHatX +
                        this.velocity[idx + 1] * rHatY +
                        this.velocity[idx + 2] * rHatZ;

                    // Tidal zone: compress perpendicular to pull direction
                    const tidalR = BLACK_HOLE.tidalRadius / sphereScale;
                    if (safeDist < tidalR) {
                        const tidalFactor = 1 - (safeDist / tidalR);

                        // Decompose velocity into radial and perpendicular
                        const radialVx = vDotR * rHatX;
                        const radialVy = vDotR * rHatY;
                        const radialVz = vDotR * rHatZ;

                        const perpVx = this.velocity[idx] - radialVx;
                        const perpVy = this.velocity[idx + 1] - radialVy;
                        const perpVz = this.velocity[idx + 2] - radialVz;

                        // COMPRESS perpendicular (makes stream thinner)
                        // PRESERVE radial (keeps pulling towards BH)
                        // FIX: Stronger compression for "tight" funnel
                        const compression = 1 - tidalFactor * 0.75 * BLACK_HOLE.tidalStrength;

                        this.velocity[idx] = radialVx + perpVx * compression;
                        this.velocity[idx + 1] = radialVy + perpVy * compression;
                        this.velocity[idx + 2] = radialVz + perpVz * compression;

                        // BOOST radial velocity slightly (accelerate towards BH)
                        const radialBoost = 1 + tidalFactor * 0.15 * BLACK_HOLE.tidalStrength;
                        this.velocity[idx] += rHatX * (radialBoost - 1) * Math.abs(vDotR);
                        this.velocity[idx + 1] += rHatY * (radialBoost - 1) * Math.abs(vDotR);
                        this.velocity[idx + 2] += rHatZ * (radialBoost - 1) * Math.abs(vDotR);
                    }

                    // Drag (energy loss during inspiral)
                    const dragFactor = 1 - (BLACK_HOLE.drag * dt * infl * pull);
                    const damp = Math.max(0.85, dragFactor);
                    this.velocity[idx] *= damp;
                    this.velocity[idx + 1] *= damp;
                    this.velocity[idx + 2] *= damp;

                    // === PHASE 5: ABSORPTION & VERTEX CLAMPING ===
                    if (safeDist < horizonR) {
                        // Calculate absorption rate
                        const absorbRaw = Math.min(1, (horizonR - safeDist) / (horizonR - (BLACK_HOLE.absorbRadius || 3)))
                            * BLACK_HOLE.absorbRate * dt * pull;
                        const absorb = Math.min(absorbRaw, 0.015);

                        // Audio trigger
                        if (absorb > 0.001 && Math.random() < 0.03) {
                            try {
                                if (window.audio && window.audio.triggerRumble) {
                                    window.audio.triggerRumble(0.8);
                                }
                            } catch (e) { /* ignore */ }
                        }

                        this.absorb[i] = Math.min(1, this.absorb[i] + absorb);

                        // Pull vertex towards BH center (suction effect)
                        const pullToBH = absorb * 2.5;
                        this.currentPos[idx] += dx * pullToBH * 0.1;
                        this.currentPos[idx + 1] += dy * pullToBH * 0.1;
                        this.currentPos[idx + 2] += dz * pullToBH * 0.1;

                        // Z-depth tunnel effect
                        const depth = BLACK_HOLE.tunnelDepth * (0.35 + 0.65 * pull);
                        this.currentPos[idx + 2] -= absorb * depth * 0.5;

                        // Kill velocity as absorbed
                        const velocityDampen = 1 - 0.6 * this.absorb[i];
                        this.velocity[idx] *= velocityDampen;
                        this.velocity[idx + 1] *= velocityDampen;
                        this.velocity[idx + 2] *= velocityDampen;

                        // Very close to center: clamp to BH position
                        const absR = (BLACK_HOLE.absorbRadius || 3) / sphereScale;
                        if (safeDist < absR) {
                            const lerpFactor = 0.2 * this.absorb[i];
                            this.currentPos[idx] += (bhX - this.currentPos[idx]) * lerpFactor;
                            this.currentPos[idx + 1] += (bhY - this.currentPos[idx + 1]) * lerpFactor;
                            this.currentPos[idx + 2] += (bhZ - this.currentPos[idx + 2]) * lerpFactor;

                            // Almost no velocity at center
                            this.velocity[idx] *= 0.15;
                            this.velocity[idx + 1] *= 0.15;
                            this.velocity[idx + 2] *= 0.15;
                        }
                    } else {
                        // Relax absorption when outside horizon
                        this.absorb[i] = Math.max(0, this.absorb[i] - 0.25 * dt);
                    }

                    bhFade = this.absorb[i];
                } // end of else (inside influence zone)
            } // end of if (bhEnabled)

            // Integration & Friction - MUST be outside bhEnabled block!
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
            const stressNorm = Math.min(1.0, stress * 0.5);

            if (stressNorm < 0.2) {
                this.tmpColor.setHSL(0.55, 1.0, 0.5);
            } else if (stressNorm < 0.4) {
                const t = (stressNorm - 0.2) / 0.2;
                this.tmpColor.setHSL(0.55 - t * 0.4, 1.0, 0.5);
            } else if (stressNorm < 0.7) {
                const t = (stressNorm - 0.4) / 0.3;
                this.tmpColor.setHSL(0.15 - t * 0.08, 1.0, 0.5);
            } else {
                const t = (stressNorm - 0.7) / 0.3;
                this.tmpColor.setHSL(0.07 - t * 0.07, 1.0, 0.45 + t * 0.1);
            }

            // Apply black hole absorption fade
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
        } // end of main vertex loop

        // Emergency Reset if Physics Exploded
        if (hasNaN) {
            console.warn("Physics NaN detected! Emergency Reset.");
            for (let i = 0; i < count; i++) {
                const idx = i * 3;
                pos[idx] = this.origPos[idx];       // Fixed: was 'originalPos'
                pos[idx + 1] = this.origPos[idx + 1];
                pos[idx + 2] = this.origPos[idx + 2];
                vel[idx] = 0;
                vel[idx + 1] = 0;
                vel[idx + 2] = 0;
                this.absorb[i] = 0;
            }
        }

        STATE.stressEMA = STATE.stressEMA * 0.92 + maxStress * 0.08;

        // Update Sphere UserData for NeuralNet to use
        if (this.count > 0) {
            const avgR = sumRadius / this.count;
            this.mesh.userData.currentRadius = avgR;
            this.mesh.userData.currentRadiusXY = sumRadiusXY / this.count;
            this.mesh.userData.currentRadiusZ = sumRadiusZ / this.count;

            // Update CoM for next frame
            this.centerOfMass.set(sumX / this.count, sumY / this.count, sumZ / this.count);

            // Copy to userData so NeuralNet can read it
            if (!this.mesh.userData.centerOfMass) this.mesh.userData.centerOfMass = new THREE.Vector3();
            this.mesh.userData.centerOfMass.copy(this.centerOfMass);
        }

        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.attributes.color.needsUpdate = true;
    }
}
