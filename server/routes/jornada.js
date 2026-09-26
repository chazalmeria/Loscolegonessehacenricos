const express = require('express');
const db = require('../db');
const { requireAuth, USERS } = require('../auth');

const router = express.Router();

function getActiveJornada() {
  return db
    .prepare('SELECT * FROM jornadas WHERE activa = 1 ORDER BY id DESC LIMIT 1')
    .get();
}

function getPartidos(jornadaId) {
  return db
    .prepare('SELECT * FROM partidos WHERE jornada_id = ? ORDER BY es_pleno ASC, orden ASC')
    .all(jornadaId);
}

function getPrediccionesDe(username, jornadaId) {
  return db
    .prepare(
      `SELECT p.id as partido_id, pr.pronostico
       FROM partidos p
       LEFT JOIN predicciones pr ON pr.partido_id = p.id AND pr.username = ?
       WHERE p.jornada_id = ?`
    )
    .all(username, jornadaId);
}

function estadoDeTodos(jornadaId) {
  const total = db
    .prepare('SELECT COUNT(*) as n FROM partidos WHERE jornada_id = ?')
    .get(jornadaId).n;

  return USERS.map((username) => {
    const rellenados = db
      .prepare(
        `SELECT COUNT(*) as n FROM predicciones pr
         JOIN partidos p ON p.id = pr.partido_id
         WHERE p.jornada_id = ? AND pr.username = ? AND pr.pronostico IS NOT NULL AND pr.pronostico != ''`
      )
      .get(jornadaId, username).n;
    return { username, completado: total > 0 && rellenados >= total, rellenados, total };
  });
}

// Jornada activa + partidos + mis predicciones + estado de todos los usuarios
router.get('/current', requireAuth, (req, res) => {
  const jornada = getActiveJornada();
  if (!jornada) return res.json({ jornada: null });

  const partidos = getPartidos(jornada.id);
  const misPredicciones = getPrediccionesDe(req.session.username, jornada.id);
  const mapa = Object.fromEntries(misPredicciones.map((p) => [p.partido_id, p.pronostico]));
  const partidosConMiPronostico = partidos.map((p) => ({ ...p, mi_pronostico: mapa[p.id] || '' }));

  res.json({
    jornada,
    partidos: partidosConMiPronostico,
    estado: estadoDeTodos(jornada.id),
  });
});

// Crear/editar la jornada de la semana (cualquier usuario logueado puede hacerlo)
router.post('/', requireAuth, (req, res) => {
  const { numero, temporada, partidos, pleno } = req.body || {};

  if (!numero || !Array.isArray(partidos) || partidos.length === 0) {
    return res.status(400).json({ error: 'Faltan datos: numero y partidos son obligatorios' });
  }
  for (const p of partidos) {
    if (!p || !p.local || !p.visitante) {
      return res.status(400).json({ error: 'Cada partido necesita equipo local y visitante' });
    }
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
    partidos.forEach((p, idx) => {
      insertPartido.run(id, idx + 1, p.local.trim(), p.visitante.trim());
    });

    if (pleno && pleno.local && pleno.visitante) {
      db.prepare(
        'INSERT INTO partidos (jornada_id, orden, equipo_local, equipo_visitante, es_pleno) VALUES (?, 99, ?, ?, 1)'
      ).run(id, pleno.local.trim(), pleno.visitante.trim());
    }

    return id;
  });

  res.json({ ok: true, jornadaId });
});

// Guardar mis pronosticos para la jornada activa
router.post('/predicciones', requireAuth, (req, res) => {
  const { predicciones } = req.body || {};
  if (!predicciones || typeof predicciones !== 'object') {
    return res.status(400).json({ error: 'Formato invalido' });
  }

  const jornada = getActiveJornada();
  if (!jornada) return res.status(400).json({ error: 'No hay jornada activa' });

  const partidoIds = new Set(getPartidos(jornada.id).map((p) => p.id));
  const upsert = db.prepare(`
    INSERT INTO predicciones (partido_id, username, pronostico, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(partido_id, username)
    DO UPDATE SET pronostico = excluded.pronostico, updated_at = datetime('now')
  `);

  db.runInTransaction(() => {
    for (const [partidoId, valor] of Object.entries(predicciones)) {
      const id = Number(partidoId);
      if (!partidoIds.has(id)) continue;
      upsert.run(id, req.session.username, String(valor || '').trim());
    }
  });

  res.json({ ok: true });
});

module.exports = { router, getActiveJornada, getPartidos };
