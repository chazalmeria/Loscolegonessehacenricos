const bcrypt = require('bcryptjs');
const { USERS } = require('./db');

const SHARED_PASSWORD = process.env.SHARED_PASSWORD || 'MaximianoGuapo';
// Hash calculado una vez al arrancar; todos los usuarios comparten la misma contraseña.
const SHARED_HASH = bcrypt.hashSync(SHARED_PASSWORD, 10);

function checkCredentials(username, password) {
  if (!USERS.includes(username)) return false;
  return bcrypt.compareSync(password || '', SHARED_HASH);
}

function requireAuth(req, res, next) {
  if (req.session && req.session.username) return next();
  return res.status(401).json({ error: 'No has iniciado sesion' });
}

module.exports = { checkCredentials, requireAuth, USERS };
