// Endpoints de administracion: sincronizacion con loteriasapi.com.
// Protegidos por un token secreto (ADMIN_UPDATE_TOKEN o el CRON_SECRET de
// Vercel), NO por la cookie de sesion.
const express = require('express');
const sync = require('../sync');
const db = require('../db');
const { USERS } = require('../db');

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

// TEMPORAL: importa jornadas pasadas (del Excel de los colegas) directamente al
// Historial. Se puede repetir sin duplicar: salta las que ya existen.
router.post('/importar-historial', checkCronOrToken, async (req, res, next) => {
  try {
    const { jornadas } = req.body || {};
    if (!Array.isArray(jornadas)) return res.status(400).json({ error: 'Falta "jornadas"' });

    const creadas = [];
    const saltadas = [];
    for (const j of jornadas) {
      const existe = await db.get(
        'SELECT id FROM jornadas WHERE numero = ? AND temporada = ? AND activa = 0 AND manual = 0 AND draw_id IS NULL',
        [String(j.numero), j.temporada]
      );
      if (existe) {
        saltadas.push(j.numero);
        continue;
      }
      await db.tx(async (t) => {
        // created_at artificial y antiguo, solo para que el Historial las ordene por numero
        const creada = `2026-08-01 00:${String(Number(j.numero) || 0).padStart(2, '0')}:00`;
        const info = await t.run(
          'INSERT INTO jornadas (numero, temporada, activa, manual, created_at) VALUES (?, ?, 0, 0, ?)',
          [String(j.numero), j.temporada, creada]
        );
        for (const p of j.partidos) {
          const pInfo = await t.run(
            `INSERT INTO partidos (jornada_id, orden, equipo_local, equipo_visitante, es_pleno, resultado, resultado_manual)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            // resultado_manual = 0: no tienen draw_id, asi que la API nunca los toca y no hace falta el *
            [info.lastInsertRowid, p.orden, p.local, p.visitante, p.es_pleno ? 1 : 0, p.resultado || null, 0]
          );
          for (const [usuario, pronostico] of Object.entries(p.predicciones || {})) {
            if (!USERS.includes(usuario)) throw new Error(`Usuario desconocido: ${usuario}`);
            await t.run('INSERT INTO predicciones (partido_id, username, pronostico) VALUES (?, ?, ?)', [
              pInfo.lastInsertRowid,
              usuario,
              pronostico,
            ]);
          }
        }
      });
      creadas.push(j.numero);
    }
    res.json({ ok: true, creadas, saltadas });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
