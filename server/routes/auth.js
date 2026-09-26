const express = require('express');
const { checkCredentials, setSessionCookie, clearSessionCookie, USERS } = require('../auth');

const router = express.Router();

// Lista de usuarios para rellenar el desplegable del login (sin exponer nada sensible)
router.get('/users', (req, res) => {
  res.json({ users: USERS });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!checkCredentials(username, password)) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }
  setSessionCookie(res, username);
  res.json({ ok: true, username });
});

router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  if (req.username) {
    return res.json({ username: req.username });
  }
  res.status(401).json({ error: 'No has iniciado sesion' });
});

module.exports = router;
