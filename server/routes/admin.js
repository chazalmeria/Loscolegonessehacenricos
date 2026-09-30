// Endpoints de administracion: sincronizacion con la API de Eduardo Losilla.
// Protegidos por un token secreto (ADMIN_UPDATE_TOKEN o el CRON_SECRET de
// Vercel), NO por la cookie de sesion.
const express = require('express');
const sync = require('../sync');
const { USERS } = require('../auth');

const router = express.Router();

function checkToken(req, res, next) {
  const token = req.header('x-admin-token');
  const expected = process.env.ADMIN_UPDATE_TOKEN;
  if (!expected || token !== expected) {
    return res.status(403).json({ error: 'Token invalido' });
  }
  next();
}

// El cron de Vercel manda "Authorization: Bearer <CRON_SECRET>"; a mano
// tambien vale la cabecera x-admin-token de siempre.
function checkCronOrToken(req, res, next) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.header('authorization') === `Bearer ${cronSecret}`) return next();
  return checkToken(req, res, next);
}

// Busca jornada nueva y resultados en la API de Eduardo Losilla (ver server/sync.js)
router.all('/sync', checkCronOrToken, async (req, res, next) => {
  try {
    res.json({ ok: true, ...(await sync.sincronizar()) });
  } catch (err) {
    next(err);
  }
});

// Mete una jornada pasada de Losilla con los pronosticos de cada uno (ver
// sync.importarJornada). Body: { temporada: 2027, jornada: 10,
// pronosticos: { Burgos: ["2", "1", ..., "M-2"], ... } } (14 signos + el Pleno)
router.post('/importar-jornada', checkToken, express.json(), async (req, res, next) => {
  try {
    const { temporada, jornada, pronosticos } = req.body || {};
    if (!Number(temporada) || !Number(jornada) || !pronosticos || typeof pronosticos !== 'object') {
      return res.status(400).json({ error: 'Faltan temporada, jornada o pronosticos' });
    }
    for (const [usuario, valores] of Object.entries(pronosticos)) {
      if (!USERS.includes(usuario)) return res.status(400).json({ error: `Usuario desconocido: ${usuario}` });
      if (!Array.isArray(valores) || valores.length !== 15) {
        return res.status(400).json({ error: `${usuario}: hacen falta 15 valores (14 signos + Pleno)` });
      }
      const malos = valores.filter((v, i) => {
        const valor = String(v || '').trim().toUpperCase();
        if (!valor) return false;
        return i < 14 ? !['1', 'X', '2'].includes(valor) : !/^(\d{1,2}|M)-(\d{1,2}|M)$/.test(valor);
      });
      if (malos.length) return res.status(400).json({ error: `${usuario}: valores no validos ${malos.join(', ')}` });
    }
    res.json({ ok: true, ...(await sync.importarJornada(Number(temporada), Number(jornada), pronosticos)) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
