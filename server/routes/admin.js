// Endpoint pensado para automatizar la actualizacion de la jornada desde fuera
// (la tarea programada que busca la jornada de La Quiniela y la publica aqui).
// Protegido por un token secreto (ADMIN_UPDATE_TOKEN), NO por la cookie de sesion.
const express = require('express');
const db = require('../db');
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

router.get('/jornada/activa-numero', checkToken, async (req, res, next) => {
  try {
    const jornada = await db.get(
      'SELECT numero, temporada FROM jornadas WHERE activa = 1 ORDER BY id DESC LIMIT 1'
    );
    res.json({ jornada: jornada || null });
  } catch (err) {
    next(err);
  }
});

router.post('/jornada', checkToken, async (req, res, next) => {
  try {
    const { numero, temporada, partidos, pleno } = req.body || {};
    if (!numero || !Array.isArray(partidos) || partidos.length === 0) {
      return res.status(400).json({ error: 'Faltan datos: numero y partidos son obligatorios' });
    }

    const yaExiste = await db.get('SELECT id FROM jornadas WHERE numero = ? AND activa = 1', [
      String(numero),
    ]);
    if (yaExiste) {
      return res.json({ ok: true, sinCambios: true, mensaje: 'Esa jornada ya esta activa' });
    }

    const jornadaId = await db.tx(async (t) => {
      await t.run('UPDATE jornadas SET activa = 0 WHERE activa = 1');
      const info = await t.run('INSERT INTO jornadas (numero, temporada, activa) VALUES (?, ?, 1)', [
        String(numero),
        temporada || null,
      ]);
      const id = info.lastInsertRowid;

      for (let idx = 0; idx < partidos.length; idx++) {
        const p = partidos[idx];
        await t.run(
          'INSERT INTO partidos (jornada_id, orden, equipo_local, equipo_visitante, es_pleno) VALUES (?, ?, ?, ?, 0)',
          [id, idx + 1, p.local.trim(), p.visitante.trim()]
        );
      }

      if (pleno && pleno.local && pleno.visitante) {
        await t.run(
          'INSERT INTO partidos (jornada_id, orden, equipo_local, equipo_visitante, es_pleno) VALUES (?, 99, ?, ?, 1)',
          [id, pleno.local.trim(), pleno.visitante.trim()]
        );
      }
      return id;
    });

    res.json({ ok: true, jornadaId });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
