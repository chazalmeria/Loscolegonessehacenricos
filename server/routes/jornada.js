const express = require('express');
const db = require('../db');
const { requireAuth, USERS } = require('../auth');

const router = express.Router();

async function getActiveJornada() {
  return db.get('SELECT * FROM jornadas WHERE activa = 1 ORDER BY id DESC LIMIT 1');
}

async function getPartidos(jornadaId) {
  return db.all(
    'SELECT * FROM partidos WHERE jornada_id = ? ORDER BY es_pleno ASC, orden ASC',
    [jornadaId]
  );
}

async function getPrediccionesDe(username, jornadaId) {
  return db.all(
    `SELECT p.id as partido_id, pr.pronostico
     FROM partidos p
     LEFT JOIN predicciones pr ON pr.partido_id = p.id AND pr.username = ?
     WHERE p.jornada_id = ?`,
    [username, jornadaId]
  );
}

async function getPrediccionesDeTodos(jornadaId) {
  const filas = await db.all(
    `SELECT pr.partido_id as partido_id, pr.username, pr.pronostico
     FROM predicciones pr
     JOIN partidos p ON p.id = pr.partido_id
     WHERE p.jornada_id = ?`,
    [jornadaId]
  );
  const mapa = {};
  for (const fila of filas) {
    if (!mapa[fila.partido_id]) mapa[fila.partido_id] = {};
    mapa[fila.partido_id][fila.username] = fila.pronostico;
  }
  return mapa;
}

async function estadoDeTodos(jornadaId) {
  const totalRow = await db.get('SELECT COUNT(*) as n FROM partidos WHERE jornada_id = ?', [jornadaId]);
  const total = totalRow.n;

  const estado = [];
  for (const username of USERS) {
    const rellenadosRow = await db.get(
      `SELECT COUNT(*) as n FROM predicciones pr
       JOIN partidos p ON p.id = pr.partido_id
       WHERE p.jornada_id = ? AND pr.username = ? AND pr.pronostico IS NOT NULL AND pr.pronostico != ''`,
      [jornadaId, username]
    );
    const rellenados = rellenadosRow.n;
    estado.push({ username, completado: total > 0 && rellenados >= total, rellenados, total });
  }
  return estado;
}

// Jornada activa + partidos + mis predicciones + estado de todos los usuarios
router.get('/current', requireAuth, async (req, res, next) => {
  try {
    const jornada = await getActiveJornada();
    if (!jornada) return res.json({ jornada: null });

    const partidos = await getPartidos(jornada.id);
    const misPredicciones = await getPrediccionesDe(req.username, jornada.id);
    const mapa = Object.fromEntries(misPredicciones.map((p) => [p.partido_id, p.pronostico]));
    const prediccionesDeTodos = await getPrediccionesDeTodos(jornada.id);
    const partidosConMiPronostico = partidos.map((p) => ({
      ...p,
      mi_pronostico: mapa[p.id] || '',
      predicciones: prediccionesDeTodos[p.id] || {},
    }));

    res.json({
      jornada,
      partidos: partidosConMiPronostico,
      usuarios: USERS,
      estado: await estadoDeTodos(jornada.id),
    });
  } catch (err) {
    next(err);
  }
});

// Crear/editar la jornada de la semana (cualquier usuario logueado puede hacerlo)
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { numero, temporada, partidos, pleno } = req.body || {};

    if (!numero || !Array.isArray(partidos) || partidos.length === 0) {
      return res.status(400).json({ error: 'Faltan datos: numero y partidos son obligatorios' });
    }
    for (const p of partidos) {
      if (!p || !p.local || !p.visitante) {
        return res.status(400).json({ error: 'Cada partido necesita equipo local y visitante' });
      }
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

// Guardar mis pronosticos para la jornada activa
router.post('/predicciones', requireAuth, async (req, res, next) => {
  try {
    const { predicciones } = req.body || {};
    if (!predicciones || typeof predicciones !== 'object') {
      return res.status(400).json({ error: 'Formato invalido' });
    }

    const jornada = await getActiveJornada();
    if (!jornada) return res.status(400).json({ error: 'No hay jornada activa' });

    const partidos = await getPartidos(jornada.id);
    const partidoIds = new Set(partidos.map((p) => p.id));

    await db.tx(async (t) => {
      for (const [partidoId, valor] of Object.entries(predicciones)) {
        const id = Number(partidoId);
        if (!partidoIds.has(id)) continue;
        await t.run(
          `INSERT INTO predicciones (partido_id, username, pronostico, updated_at)
           VALUES (?, ?, ?, datetime('now'))
           ON CONFLICT(partido_id, username)
           DO UPDATE SET pronostico = excluded.pronostico, updated_at = datetime('now')`,
          [id, req.username, String(valor || '').trim()]
        );
      }
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = { router, getActiveJornada, getPartidos };
