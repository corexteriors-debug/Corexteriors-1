const crypto = require('crypto');

// Password hashing for per-rep door-hanger accounts, using Node's built-in
// scrypt so no extra dependency (e.g. bcrypt, which needs native bindings
// that don't always play well with Vercel's serverless runtime) is required.

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return { salt, hash };
}

function verifyPassword(password, salt, hash) {
    if (!salt || !hash) return false;
    const candidate = crypto.scryptSync(password, salt, 64).toString('hex');
    const a = Buffer.from(candidate, 'hex');
    const b = Buffer.from(hash, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

module.exports = { hashPassword, verifyPassword };
