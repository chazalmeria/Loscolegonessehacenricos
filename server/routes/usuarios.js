// Fotos de perfil (boton "Ajustes"). Cada usuario sube la suya: el navegador
// la recorta en cuadrado y la reduce a 256 px antes de enviarla, asi que en la
// base de datos se guarda un JPEG pequeño en base64.
const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

const MAX_BYTES = 200 * 1024; // de la imagen ya decodificada

// Version de la foto de cada uno: { Burgos: 1727700000000, Pepe: null, ... }.
// Es muy ligera, asi que el cliente la consulta de vez en cuando.
router.get('/avatares', requireAuth, async (req, res, next) => {
  try {
    const filas = await db.all('SELECT username, avatar_v FROM users');
    res.json({ avatares: Object.fromEntries(filas.map((f) => [f.username, f.avatar_v ? Number(f.avatar_v) : null])) });
  } catch (err) {
    next(err);
  }
});

// La foto en si. La URL lleva ?v=<version>, asi que se puede cachear mucho.
router.get('/:username/avatar', requireAuth, async (req, res, next) => {
  try {
    const fila = await db.get('SELECT avatar FROM users WHERE username = ?', [req.params.username]);
    if (!fila || !fila.avatar) return res.status(404).json({ error: 'Sin foto' });
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'private, max-age=31536000, immutable');
    res.send(Buffer.from(fila.avatar, 'base64'));
  } catch (err) {
    next(err);
  }
});

// Body: { imagen: "data:image/jpeg;base64,..." }
router.post('/me/avatar', requireAuth, async (req, res, next) => {
  try {
    const m = String((req.body && req.body.imagen) || '').match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return res.status(400).json({ error: 'La imagen no es válida' });
    const bytes = Buffer.from(m[1], 'base64');
    // Un JPEG empieza por FF D8
    if (bytes.length < 100 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      return res.status(400).json({ error: 'La imagen no es válida' });
    }
    if (bytes.length > MAX_BYTES) return res.status(400).json({ error: 'La imagen es demasiado grande' });

    const version = Date.now();
    await db.run('UPDATE users SET avatar = ?, avatar_v = ? WHERE username = ?', [m[1], version, req.username]);
    res.json({ ok: true, avatar_v: version });
  } catch (err) {
    next(err);
  }
});

router.delete('/me/avatar', requireAuth, async (req, res, next) => {
  try {
    await db.run('UPDATE users SET avatar = NULL, avatar_v = NULL WHERE username = ?', [req.username]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
