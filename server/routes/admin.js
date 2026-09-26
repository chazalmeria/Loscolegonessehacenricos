// Endpoint pensado para automatizar la actualizacion de la jornada desde fuera
// (por ejemplo, una tarea programada que busca la jornada de La Quiniela y la publica aqui).
// Protegido por un token secreto (ADMIN_UPDATE_TOKEN en el .env), NO por la sesion de usuario.
const express = require('express');
const db = require('../db');

const router = express.Router();

function checkToken(req, res, next) {
  const token = req.header('x-admin-token');
  const expected = process.env.ADMIN_UPDATE_TOKEN;
  if (!expected || token !== expected) {
    return res.status(403).json({ error: 'Token invalido' });
  }
  next();
}

router.get('/jornada/activa-numero', checkToken, (req, res) => {
  const jornada = db
    .prepare('SELECT numero, temporada FROM jornadas WHERE activa = 1 ORDER BY id DESC LIMIT 1')
    .get();
  res.json({ jornada: jornada || null });
});

router.post('/jornada', checkToken, (req, res) => {
  const { numero, temporada, partidos, pleno } = req.body || {};
  if (!numero || !Array.isArray(partidos) || partidos.length === 0) {
    return res.status(400).json({ error: 'Faltan datos: numero y partidos son obligatorios' });
  }

  const yaExiste = db
    .prepare('SELECT id FROM jornadas WHERE numero = ? AND activa = 1')
    .get(String(numero));
  if (yaExiste) {
    return res.json({ ok: true, sinCambios: true, mensaje: 'Esa jornada ya esta activa' });
  }

  const jornadaId = db.runInTransaction(() => {
    db.prepare('UPDATE jornadas SET activa = 0 WHERE activa = 1').run();
    const info = db
      .prepare('INSERT INTO jornadas (numero, temporada, activa) VALUES (?, ?, 1)')
      .run(String(numero), temporada || null);
    const id = info.lastInsertRowid;

    const insertPartido = db.prepare(
      'INSERT INTO partidos (jornada_id, orden, equipo_local, equipo_visitante, es_pleno) VALUES (?, ?, ?, ?, 0)'
    );
    partidos.forEach((p, idx) => insertPartido.run(id, idx + 1, p.local.trim(), p.visitante.trim()));

    if (pleno && pleno.local && pleno.visitante) {
      db.prepare(
        'INSERT INTO partidos (jornada_id, orden, equipo_local, equipo_visitante, es_pleno) VALUES (?, 99, ?, ?, 1)'
      ).run(id, pleno.local.trim(), pleno.visitante.trim());
    }
    return id;
  });

  res.json({ ok: true, jornadaId });
});

module.exports = router;
