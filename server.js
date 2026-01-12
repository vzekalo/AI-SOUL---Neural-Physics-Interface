/**
 * HTTPS Server для AI SOUL
 * Дозволяє доступ до камери по локальній мережі
 * 
 * Запуск: node server.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = 8443;
const CERT_DIR = path.join(__dirname, 'certs');
const KEY_PATH = path.join(CERT_DIR, 'key.pem');
const CERT_PATH = path.join(CERT_DIR, 'cert.pem');

// MIME types
const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
};

// Generate self-signed certificate using Node.js crypto
function generateCertificate() {
    console.log('🔐 Генерація самопідписаного сертифікату...');

    if (!fs.existsSync(CERT_DIR)) {
        fs.mkdirSync(CERT_DIR, { recursive: true });
    }

    // Generate key pair
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
    });

    // Get local IPs for Subject Alternative Names
    const ips = getLocalIPs();
    const altNames = ['localhost', ...ips];

    // Create a self-signed certificate
    const cert = crypto.createSign('SHA256');

    // For proper X.509 certificate, we need to use a different approach
    // Node.js doesn't have built-in X.509 cert generation, so we'll use
    // the forge-like approach with raw ASN.1

    const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });

    // Generate certificate using openssl-like structure
    const certPem = generateSelfSignedCertPem(privateKey, publicKey, altNames);

    fs.writeFileSync(KEY_PATH, keyPem);
    fs.writeFileSync(CERT_PATH, certPem);

    console.log('✅ Сертифікат створено!');
}

// Simple self-signed cert generator (valid X.509)
function generateSelfSignedCertPem(privateKey, publicKey, altNames) {
    // We'll create a minimal valid X.509 v3 certificate
    const publicKeyDer = publicKey.export({ type: 'spki', format: 'der' });

    // Certificate validity: 1 year
    const notBefore = new Date();
    const notAfter = new Date();
    notAfter.setFullYear(notAfter.getFullYear() + 1);

    // Build certificate structure
    const tbsCertificate = buildTBSCertificate(publicKeyDer, notBefore, notAfter);

    // Sign the TBS certificate
    const sign = crypto.createSign('SHA256');
    sign.update(tbsCertificate);
    const signature = sign.sign(privateKey);

    // Build complete certificate
    const certificate = buildCertificate(tbsCertificate, signature);

    // Convert to PEM
    const certBase64 = certificate.toString('base64');
    const certPem = '-----BEGIN CERTIFICATE-----\n' +
        certBase64.match(/.{1,64}/g).join('\n') +
        '\n-----END CERTIFICATE-----\n';

    return certPem;
}

// ASN.1 DER encoding helpers
function encodeLength(len) {
    if (len < 128) {
        return Buffer.from([len]);
    } else if (len < 256) {
        return Buffer.from([0x81, len]);
    } else {
        return Buffer.from([0x82, (len >> 8) & 0xff, len & 0xff]);
    }
}

function encodeSequence(contents) {
    const contentBuf = Buffer.isBuffer(contents) ? contents : Buffer.concat(contents);
    return Buffer.concat([Buffer.from([0x30]), encodeLength(contentBuf.length), contentBuf]);
}

function encodeSet(contents) {
    const contentBuf = Buffer.isBuffer(contents) ? contents : Buffer.concat(contents);
    return Buffer.concat([Buffer.from([0x31]), encodeLength(contentBuf.length), contentBuf]);
}

function encodeInteger(value) {
    let buf;
    if (typeof value === 'number') {
        if (value === 0) {
            buf = Buffer.from([0]);
        } else {
            const bytes = [];
            let v = value;
            while (v > 0) {
                bytes.unshift(v & 0xff);
                v = Math.floor(v / 256);
            }
            if (bytes[0] & 0x80) bytes.unshift(0);
            buf = Buffer.from(bytes);
        }
    } else {
        buf = value;
        if (buf[0] & 0x80) {
            buf = Buffer.concat([Buffer.from([0]), buf]);
        }
    }
    return Buffer.concat([Buffer.from([0x02]), encodeLength(buf.length), buf]);
}

function encodeOID(oid) {
    const parts = oid.split('.').map(Number);
    const bytes = [parts[0] * 40 + parts[1]];
    for (let i = 2; i < parts.length; i++) {
        let v = parts[i];
        if (v === 0) {
            bytes.push(0);
        } else {
            const septets = [];
            while (v > 0) {
                septets.unshift(v & 0x7f);
                v = Math.floor(v / 128);
            }
            for (let j = 0; j < septets.length - 1; j++) {
                septets[j] |= 0x80;
            }
            bytes.push(...septets);
        }
    }
    const buf = Buffer.from(bytes);
    return Buffer.concat([Buffer.from([0x06]), encodeLength(buf.length), buf]);
}

function encodePrintableString(str) {
    const buf = Buffer.from(str, 'ascii');
    return Buffer.concat([Buffer.from([0x13]), encodeLength(buf.length), buf]);
}

function encodeUTCTime(date) {
    const str = date.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z';
    const buf = Buffer.from(str, 'ascii');
    return Buffer.concat([Buffer.from([0x17]), encodeLength(buf.length), buf]);
}

function encodeBitString(data) {
    const buf = Buffer.concat([Buffer.from([0]), data]);
    return Buffer.concat([Buffer.from([0x03]), encodeLength(buf.length), buf]);
}

function encodeNull() {
    return Buffer.from([0x05, 0x00]);
}

function buildTBSCertificate(publicKeyDer, notBefore, notAfter) {
    // Version (v3 = 2)
    const version = Buffer.concat([Buffer.from([0xa0, 0x03]), encodeInteger(2)]);

    // Serial number (random)
    const serial = encodeInteger(crypto.randomBytes(8));

    // Signature algorithm (SHA256 with RSA)
    const signatureAlgorithm = encodeSequence([
        encodeOID('1.2.840.113549.1.1.11'), // sha256WithRSAEncryption
        encodeNull()
    ]);

    // Issuer (CN=localhost)
    const issuer = encodeSequence([
        encodeSet([
            encodeSequence([
                encodeOID('2.5.4.3'), // commonName
                encodePrintableString('localhost')
            ])
        ])
    ]);

    // Validity
    const validity = encodeSequence([
        encodeUTCTime(notBefore),
        encodeUTCTime(notAfter)
    ]);

    // Subject (same as issuer for self-signed)
    const subject = issuer;

    // Subject Public Key Info (already in SPKI format)
    const subjectPublicKeyInfo = publicKeyDer;

    // TBS Certificate
    return encodeSequence([
        version,
        serial,
        signatureAlgorithm,
        issuer,
        validity,
        subject,
        subjectPublicKeyInfo
    ]);
}

function buildCertificate(tbsCertificate, signature) {
    const signatureAlgorithm = encodeSequence([
        encodeOID('1.2.840.113549.1.1.11'), // sha256WithRSAEncryption
        encodeNull()
    ]);

    return encodeSequence([
        tbsCertificate,
        signatureAlgorithm,
        encodeBitString(signature)
    ]);
}

// Ensure certificate exists
function ensureCertificate() {
    if (!fs.existsSync(KEY_PATH) || !fs.existsSync(CERT_PATH)) {
        generateCertificate();
    } else {
        console.log('🔐 Використовую існуючий сертифікат');
    }
}

// Get local IP addresses
function getLocalIPs() {
    const interfaces = os.networkInterfaces();
    const ips = [];

    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                ips.push(iface.address);
            }
        }
    }

    return ips;
}

// Request handler
function handleRequest(req, res) {
    let urlPath = req.url.split('?')[0]; // Remove query string
    let filePath = path.join(__dirname, urlPath === '/' ? 'index.html' : urlPath);

    // Security: prevent directory traversal
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(__dirname)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    // Skip certs directory
    if (resolvedPath.startsWith(CERT_DIR)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, data) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404);
                res.end('Not Found');
            } else {
                res.writeHead(500);
                res.end('Server Error');
            }
            return;
        }

        res.writeHead(200, {
            'Content-Type': contentType,
            'Access-Control-Allow-Origin': '*'
        });
        res.end(data);
    });
}

// Main
function main() {
    // Delete old invalid certs
    if (fs.existsSync(CERT_DIR)) {
        try {
            fs.rmSync(CERT_DIR, { recursive: true });
            console.log('🗑️ Видалено старі сертифікати');
        } catch (e) { }
    }

    ensureCertificate();

    const options = {
        key: fs.readFileSync(KEY_PATH),
        cert: fs.readFileSync(CERT_PATH)
    };

    const server = https.createServer(options, handleRequest);

    server.listen(PORT, '0.0.0.0', () => {
        const ips = getLocalIPs();

        console.log('\n╔══════════════════════════════════════════════════╗');
        console.log('║         🚀 AI SOUL HTTPS SERVER                  ║');
        console.log('╠══════════════════════════════════════════════════╣');
        console.log(`║  Local:   https://localhost:${PORT}                ║`);

        if (ips.length > 0) {
            console.log('╠══════════════════════════════════════════════════╣');
            console.log('║  📱 Для підключення з телефону/планшету:         ║');
            ips.forEach(ip => {
                const url = `https://${ip}:${PORT}`;
                const padding = ' '.repeat(Math.max(0, 34 - url.length));
                console.log(`║  ${url}${padding}║`);
            });
        }

        console.log('╠══════════════════════════════════════════════════╣');
        console.log('║  ⚠️  Прийміть попередження про сертифікат!        ║');
        console.log('║  Ctrl+C щоб зупинити сервер                      ║');
        console.log('╚══════════════════════════════════════════════════╝\n');
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.error(`❌ Порт ${PORT} вже використовується!`);
        } else {
            console.error('❌ Помилка сервера:', err.message);
        }
        process.exit(1);
    });
}

main();
