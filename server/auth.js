const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const cookie = require('cookie');
const { USERS } = require('./db');

const SHARED_PASSWORD = process.env.SHARED_PASSWORD || 'MaximianoGuapo';
// Hash calculado una vez al arrancar; todos los usuarios comparten la misma contraseña.
const SHARED_HASH = bcrypt.hashSync(SHARED_PASSWORD, 10);

const COOKIE_NAME = 'quiniela_sesion';
const COOKIE_SECRET = process.env.COOKIE_SECRET || 'cambia-esto-por-algo-largo-y-aleatorio';
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30; // 30 dias

function checkCredentials(username, password) {
  if (!USERS.includes(username)) return false;
  return bcrypt.compareSync(password || '', SHARED_HASH);
}

// --- Cookie de sesion firmada (sin estado en el servidor: ideal para Vercel) ---

function sign(username) {
  const payload = Buffer.from(JSON.stringify({ u: username, t: Date.now() })).toString('base64url');
  const firma = crypto.createHmac('sha256', COOKIE_SECRET).update(payload).digest('base64url');
  return `${payload}.${firma}`;
}

function verify(token) {
  if (!token || typeof token !== 'string') return null;
  const [payload, firma] = token.split('.');
  if (!payload || !firma) return null;

  const esperada = crypto.createHmac('sha256', COOKIE_SECRET).update(payload).digest('base64url');
  const a = Buffer.from(firma);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data || !USERS.includes(data.u)) return null;
    return data.u;
  } catch (_) {
    return null;
  }
}

function setSessionCookie(res, username) {
  res.setHeader(
    'Set-Cookie',
    cookie.serialize(COOKIE_NAME, sign(username), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: MAX_AGE_MS / 1000,
      path: '/',
    })
  );
}

function clearSessionCookie(res) {
  res.setHeader(
    'Set-Cookie',
    cookie.serialize(COOKIE_NAME, '', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 0,
      path: '/',
    })
  );
}

// Lee la cookie en cualquier request y, si es valida, expone req.username
function attachUser(req, res, next) {
  const cookies = cookie.parse(req.headers.cookie || '');
  const username = verify(cookies[COOKIE_NAME]);
  req.username = username || null;
  next();
}

function requireAuth(req, res, next) {
  if (req.username) return next();
  return res.status(401).json({ error: 'No has iniciado sesion' });
}

module.exports = {
  checkCredentials,
  requireAuth,
  attachUser,
  setSessionCookie,
  clearSessionCookie,
  USERS,
};
