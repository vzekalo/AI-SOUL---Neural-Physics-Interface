import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';

export function clamp(x, min, max) {
    return Math.max(min, Math.min(max, x));
}

export function clamp01(x) {
    return Math.max(0, Math.min(1, x));
}

export function getScreenPos(normX, normY, video) {
    const W = window.innerWidth;
    const H = window.innerHeight;

    if (!video || video.readyState < 2) {
        return { x: normX * W, y: normY * H };
    }

    const vidW = video.videoWidth;
    const vidH = video.videoHeight;
    const scaleW = W / vidW;
    const scaleH = H / vidH;
    const scale = Math.max(scaleW, scaleH);

    const scaledW = vidW * scale;
    const scaledH = vidH * scale;

    const cropX = (scaledW - W) / 2;
    const cropY = (scaledH - H) / 2;

    const x = normX * scaledW - cropX;
    const y = normY * scaledH - cropY;

    return { x, y };
}

export function get3DFromScreen(sx, sy, camera) {
    // selfieMode: true already mirrors landmarks, no need to mirror here
    const ndcX = (sx / window.innerWidth) * 2 - 1;
    const ndcY = -(sy / window.innerHeight) * 2 + 1;

    const dist = camera.position.z;
    const vFOV = THREE.MathUtils.degToRad(camera.fov);
    const h = 2 * Math.tan(vFOV / 2) * dist;
    const w = h * camera.aspect;

    return new THREE.Vector3(ndcX * (w / 2), ndcY * (h / 2), 0);
}
