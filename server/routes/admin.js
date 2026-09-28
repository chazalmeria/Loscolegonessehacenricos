// Endpoints de administracion: sincronizacion con loteriasapi.com.
// Protegidos por un token secreto (ADMIN_UPDATE_TOKEN o el CRON_SECRET de
// Vercel), NO por la cookie de sesion.
const express = require('express');
const sync = require('../sync');

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

// Busca jornada nueva y resultados en loteriasapi.com (ver server/sync.js)
router.all('/sync', checkCronOrToken, async (req, res, next) => {
  try {
    res.json({ ok: true, ...(await sync.sincronizar()) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
