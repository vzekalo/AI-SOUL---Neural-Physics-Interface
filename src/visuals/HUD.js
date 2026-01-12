import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';
import { STATE, QUALITY } from '../config.js';
import { getScreenPos } from '../utils/MathUtils.js';

export class HUD {
    constructor(canvas, el) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.el = el;
        this.handHistory = {};
        this.smoothedVel = {};
        this.historyLength = 12;
        this.hudFrame = 0;
    }

    clear() {
        this.ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    }

    drawGlobal(camera) {
        if (!camera) return;
        const ctx = this.ctx;
        const ndc = new THREE.Vector3(0.7, 0.7, 0);
        const bhPos = ndc.unproject(camera);
        bhPos.project(camera);

        let tunnelX = (bhPos.x * 0.5 + 0.5) * window.innerWidth;
        const tunnelY = (-(bhPos.y * 0.5) + 0.5) * window.innerHeight;
        tunnelX = window.innerWidth - tunnelX;

        const baseSize = 40;
        const baseGrad = ctx.createRadialGradient(tunnelX, tunnelY, 0, tunnelX, tunnelY, baseSize);
        baseGrad.addColorStop(0, `rgba(0, 0, 0, 0.8)`);
        baseGrad.addColorStop(0.5, `rgba(40, 0, 0, 0.3)`);
        baseGrad.addColorStop(1, `rgba(0, 0, 0, 0)`);
        ctx.fillStyle = baseGrad;
        ctx.beginPath();
        ctx.arc(tunnelX, tunnelY, baseSize, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = `rgba(50, 0, 0, 0.3)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(tunnelX, tunnelY, baseSize, baseSize * 0.3, Date.now() * 0.001, 0, Math.PI * 2);
        ctx.stroke();
    }

    drawHand(lm, id, isPinch, hand, camera, video, sphere) {
        const ctx = this.ctx;
        const t = Date.now() * 0.001;
        const col = isPinch ? "#ff0055" : "#00f3ff";
        const colWarn = "#ff9900";
        const colDim = isPinch ? "rgba(255,0,85,0.12)" : "rgba(0,243,255,0.12)";
        const colAccent = "#00ff88";

        ctx.strokeStyle = col;
        ctx.fillStyle = col;
        ctx.lineWidth = 1.5;
        ctx.font = "9px 'Share Tech Mono'";

        const points = lm.map(p => getScreenPos(p.x, p.y, video));
        const raw = lm;

        if (!this.handHistory[id]) this.handHistory[id] = [];
        if (!this.smoothedVel[id]) this.smoothedVel[id] = { x: 0, y: 0 };

        const frameData = { points: points.map(p => ({ x: p.x, y: p.y })), raw: raw.map(p => ({ x: p.x, y: p.y, z: p.z })), t };
        this.handHistory[id].push(frameData);
        if (this.handHistory[id].length > this.historyLength) this.handHistory[id].shift();
        const history = this.handHistory[id];

        // Skeleton
        ctx.globalAlpha = 0.7;
        ctx.lineWidth = 2;
        const cons = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [0, 9], [9, 10], [10, 11], [11, 12], [0, 13], [13, 14], [14, 15], [15, 16], [0, 17], [17, 18], [18, 19], [19, 20]];
        ctx.beginPath();
        for (const c of cons) {
            ctx.moveTo(points[c[0]].x, points[c[0]].y);
            ctx.lineTo(points[c[1]].x, points[c[1]].y);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1.5;

        // Biometrics & Math
        const p0 = points[0], p8 = points[8];
        const fingerBases = [1, 5, 9, 13, 17];
        const fingerLengths = [];
        fingerBases.forEach(base => {
            let len = 0;
            for (let j = 0; j < 3; j++) {
                len += Math.hypot(raw[base + j + 1].x - raw[base + j].x, raw[base + j + 1].y - raw[base + j].y, raw[base + j + 1].z - raw[base + j].z);
            }
            fingerLengths.push(len);
        });

        const calcAngle = (a, b, c) => {
            const ba = { x: a.x - b.x, y: a.y - b.y };
            const bc = { x: c.x - b.x, y: c.y - b.y };
            const dot = ba.x * bc.x + ba.y * bc.y;
            const magA = Math.hypot(ba.x, ba.y);
            const magB = Math.hypot(bc.x, bc.y);
            return Math.acos(Math.max(-1, Math.min(1, dot / (magA * magB)))) * 180 / Math.PI;
        };

        const indexMCP = calcAngle(raw[0], raw[5], raw[6]);
        const indexPIP = calcAngle(raw[5], raw[6], raw[7]);
        const indexDIP = calcAngle(raw[6], raw[7], raw[8]);

        const palmVec = { x: raw[9].x - raw[0].x, y: raw[9].y - raw[0].y };
        const handAngle = Math.atan2(palmVec.y, palmVec.x) * 180 / Math.PI;

        if (history.length >= 2) {
            const prev = history[history.length - 2];
            const dt = (t - prev.t) || 0.016;
            this.smoothedVel[id].x = this.smoothedVel[id].x * 0.85 + ((raw[8].x - prev.raw[8].x) / dt) * 0.15;
            this.smoothedVel[id].y = this.smoothedVel[id].y * 0.85 + ((raw[8].y - prev.raw[8].y) / dt) * 0.15;
        }
        const vel = this.smoothedVel[id];
        const speed = Math.hypot(vel.x, vel.y);

        // Render Metrics
        ctx.fillStyle = "#00ff88";
        ctx.fillText(`${indexMCP.toFixed(0)}°`, points[5].x + 10, points[5].y - 2);
        ctx.fillText(`${indexPIP.toFixed(0)}°`, points[6].x + 10, points[6].y - 2);
        ctx.fillText(`${indexDIP.toFixed(0)}°`, points[7].x + 10, points[7].y - 2);

        // Singularity visuals for hand
        const tunnelFactor = STATE.globalTunnelFactor || 0;
        if (hand.fistFactor > 0.01) {
            const cx = points[9].x, cy = points[9].y;
            const r = 50 * hand.fistFactor;
            const hue = (t * 0.3) % 1;

            if (tunnelFactor < 0.1) {
                ctx.strokeStyle = `hsl(${hue * 360}, 100%, 50%)`;
                for (let k = 0; k <= 6; k++) {
                    let px = cx, py = cy;
                    const segmentAngle = ((k - 1) / 6) * Math.PI * 2 + t * 0.5;
                    if (k > 0) {
                        px += Math.cos(segmentAngle) * r;
                        py += Math.sin(segmentAngle) * r;
                    }
                    ctx.beginPath();
                    ctx.arc(px, py, r, 0, Math.PI * 2);
                    ctx.stroke();
                }
            }

            if (tunnelFactor > 0.01) {
                this.drawActiveSingularity(tunnelFactor, sphere, camera, hue, ctx);
            }
        }

        // Phalanx Data
        ctx.globalAlpha = 0.6;
        ctx.font = "6px 'Share Tech Mono'";
        for (let i = 1; i <= 20; i++) {
            if (i % 4 === 0) continue;
            const p = points[i];
            ctx.fillText(`${(p.x / 10).toFixed(0)}.${(p.y / 10).toFixed(0)}`, p.x + 4, p.y - 4);
        }
        ctx.globalAlpha = 1;
    }

    drawActiveSingularity(tunnelFactor, sphere, camera, hue, ctx) {
        const ndc = new THREE.Vector3(0.7, 0.7, 0);
        const bhPos = ndc.unproject(camera);
        bhPos.project(camera);
        let tunnelX = (bhPos.x * 0.5 + 0.5) * window.innerWidth;
        const tunnelY = (-(bhPos.y * 0.5) + 0.5) * window.innerHeight;
        tunnelX = window.innerWidth - tunnelX;

        ctx.save();

        // Draw flowing streams with bezier curves - FEWER, more subtle
        const posAttr = sphere.geometry.attributes.position;
        const vTmp = new THREE.Vector3();
        const streamCount = Math.min(8, Math.floor(4 + tunnelFactor * 5)); // Much fewer streams

        for (let i = 0; i < streamCount; i++) {
            const idx = Math.floor(Math.random() * posAttr.count) * 3;
            vTmp.set(posAttr.array[idx], posAttr.array[idx + 1], posAttr.array[idx + 2]);
            vTmp.applyMatrix4(sphere.matrixWorld).project(camera);

            let vx = (vTmp.x * 0.5 + 0.5) * window.innerWidth;
            const vy = (-(vTmp.y * 0.5) + 0.5) * window.innerHeight;
            vx = window.innerWidth - vx;

            // Control points for bezier curve
            const midX = (vx + tunnelX) / 2 + (Math.random() - 0.5) * 40 * tunnelFactor;
            const midY = (vy + tunnelY) / 2 + (Math.random() - 0.5) * 40 * tunnelFactor;

            // Single subtle layer
            const alpha = 0.25 * tunnelFactor;
            ctx.strokeStyle = `hsla(${(hue * 360 + i * 20) % 360}, 60%, 50%, ${alpha})`;
            ctx.lineWidth = 1.5;
            ctx.shadowColor = `hsla(${(hue * 360 + i * 20) % 360}, 80%, 40%, 0.3)`;
            ctx.shadowBlur = 6;

            ctx.beginPath();
            ctx.moveTo(vx, vy);
            ctx.quadraticCurveTo(midX, midY, tunnelX, tunnelY);
            ctx.stroke();
        }

        ctx.shadowBlur = 0;

        // Outer glow rings (multiple layers for blur)
        const maxGlowSize = 80 + tunnelFactor * 60;
        for (let ring = 0; ring < 4; ring++) {
            const ringSize = maxGlowSize - ring * 15;
            const alpha = (0.15 + ring * 0.05) * tunnelFactor;

            const ringGrad = ctx.createRadialGradient(tunnelX, tunnelY, ringSize * 0.3, tunnelX, tunnelY, ringSize);
            ringGrad.addColorStop(0, `rgba(80, 0, 40, 0)`);
            ringGrad.addColorStop(0.6, `rgba(100, 0, 50, ${alpha})`);
            ringGrad.addColorStop(1, `rgba(0, 0, 0, 0)`);

            ctx.fillStyle = ringGrad;
            ctx.beginPath();
            ctx.arc(tunnelX, tunnelY, ringSize, 0, Math.PI * 2);
            ctx.fill();
        }

        // Core black hole (deep black center)
        const coreSize = 25 + tunnelFactor * 40;
        const coreGrad = ctx.createRadialGradient(tunnelX, tunnelY, 0, tunnelX, tunnelY, coreSize);
        coreGrad.addColorStop(0, `rgba(0, 0, 0, 1)`);
        coreGrad.addColorStop(0.3, `rgba(10, 0, 5, 0.95)`);
        coreGrad.addColorStop(0.6, `rgba(30, 0, 15, ${0.7 * tunnelFactor})`);
        coreGrad.addColorStop(1, `rgba(0, 0, 0, 0)`);

        ctx.fillStyle = coreGrad;
        ctx.beginPath();
        ctx.arc(tunnelX, tunnelY, coreSize, 0, Math.PI * 2);
        ctx.fill();

        // Subtle distortion rings instead of obvious ellipse
        ctx.globalAlpha = tunnelFactor * 0.3;
        for (let r = 0; r < 3; r++) {
            const ringR = coreSize * (0.8 + r * 0.3);
            ctx.strokeStyle = `rgba(80, 20, 40, ${0.3 - r * 0.08})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(tunnelX, tunnelY, ringR, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;

        ctx.restore();

        if (this.el.hudStatus) this.el.hudStatus.textContent = `⚠ SINGULARITY: ${(tunnelFactor * 100).toFixed(0)}%`;
    }
}
