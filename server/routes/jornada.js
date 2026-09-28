const express = require('express');
const db = require('../db');
const sync = require('../sync');
const { requireAuth, USERS } = require('../auth');

const router = express.Router();

// Jornadas abiertas (activa = 1): las creadas a mano primero (mas nueva
// arriba) y despues la de la API.
async function getJornadasAbiertas() {
  return db.all('SELECT * FROM jornadas WHERE activa = 1 ORDER BY manual DESC, id DESC');
}

async function getPartidos(jornadaId) {
  return db.all(
    'SELECT * FROM partidos WHERE jornada_id = ? ORDER BY es_pleno ASC, orden ASC',
    [jornadaId]
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

function estadoDeTodos(partidos, prediccionesDeTodos) {
  const total = partidos.length;
  return USERS.map((username) => {
    const rellenados = partidos.filter((p) => {
      const valor = prediccionesDeTodos[p.id] && prediccionesDeTodos[p.id][username];
      return valor && valor !== '';
    }).length;
    return { username, completado: total > 0 && rellenados >= total, rellenados, total };
  });
}

// Todas las jornadas abiertas, cada una con sus partidos, mis pronosticos y
// el estado de todos los usuarios
router.get('/current', requireAuth, async (req, res, next) => {
  try {
    await sync.sincronizarSiToca();

    const jornadas = [];
    for (const jornada of await getJornadasAbiertas()) {
      const partidos = await getPartidos(jornada.id);
      const prediccionesDeTodos = await getPrediccionesDeTodos(jornada.id);
      jornadas.push({
        jornada: { ...jornada, manual: !!jornada.manual },
        partidos: partidos.map((p) => {
          const predicciones = prediccionesDeTodos[p.id] || {};
          return { ...p, mi_pronostico: predicciones[req.username] || '', predicciones };
        }),
        estado: estadoDeTodos(partidos, prediccionesDeTodos),
      });
    }

    res.json({ usuarios: USERS, jornadas });
  } catch (err) {
    next(err);
  }
});

// Crear una jornada a mano (por si la API no funciona). Convive con la de la
// API, que no se toca.
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { titulo, partidos, pleno } = req.body || {};

    if (!titulo || !String(titulo).trim() || !Array.isArray(partidos) || partidos.length === 0) {
      return res.status(400).json({ error: 'Faltan datos: el título y al menos un partido son obligatorios' });
    }
    for (const p of partidos) {
      if (!p || !p.local || !p.visitante) {
        return res.status(400).json({ error: 'Cada partido necesita equipo local y visitante' });
      }
    }

    const jornadaId = await db.tx(async (t) => {
      const info = await t.run('INSERT INTO jornadas (numero, activa, manual) VALUES (?, 1, 1)', [
        String(titulo).trim(),
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

// Pasar una jornada creada a mano al Historial
router.post('/:id/archivar', requireAuth, async (req, res, next) => {
  try {
    const info = await db.run('UPDATE jornadas SET activa = 0 WHERE id = ? AND manual = 1 AND activa = 1', [
      Number(req.params.id),
    ]);
    if (!info.changes) return res.status(404).json({ error: 'No hay ninguna jornada a mano abierta con ese id' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Poner (o corregir) a mano el resultado real de los partidos de una jornada
// abierta, por si la API va con retraso. Body: { resultados: { partidoId: valor } }
// con valor "1"/"X"/"2" (o "2-1" en el Pleno al 15). Un valor vacio borra el
// resultado y deja que lo vuelva a rellenar la API.
router.post('/:id/resultados', requireAuth, async (req, res, next) => {
  try {
    const { resultados } = req.body || {};
    if (!resultados || typeof resultados !== 'object') {
      return res.status(400).json({ error: 'Formato invalido' });
    }

    const jornada = await db.get('SELECT id FROM jornadas WHERE id = ? AND activa = 1', [Number(req.params.id)]);
    if (!jornada) return res.status(400).json({ error: 'Esa jornada ya no está abierta' });

    const partidos = new Map((await getPartidos(jornada.id)).map((p) => [p.id, p]));
    const cambios = [];
    for (const [partidoId, bruto] of Object.entries(resultados)) {
      const p = partidos.get(Number(partidoId));
      if (!p) continue;
      const valor = String(bruto || '').trim().toUpperCase();
      const valido = valor === '' || (p.es_pleno ? /^\d{1,2}-\d{1,2}$/.test(valor) : ['1', 'X', '2'].includes(valor));
      if (!valido) {
        return res.status(400).json({ error: `Resultado no válido en ${p.equipo_local} - ${p.equipo_visitante}` });
      }
      // Solo lo que cambia: reenviar un resultado que ya vino de la API no lo convierte en "a mano"
      if (valor === (p.resultado || '')) continue;
      cambios.push([valor || null, valor ? 1 : 0, p.id]);
    }

    await db.tx(async (t) => {
      for (const args of cambios) {
        await t.run('UPDATE partidos SET resultado = ?, resultado_manual = ? WHERE id = ?', args);
      }
    });

    res.json({ ok: true, cambiados: cambios.length });
  } catch (err) {
    next(err);
  }
});

// Guardar mis pronosticos de una jornada abierta
router.post('/predicciones', requireAuth, async (req, res, next) => {
  try {
    const { jornada_id: jornadaId, predicciones } = req.body || {};
    if (!predicciones || typeof predicciones !== 'object') {
      return res.status(400).json({ error: 'Formato invalido' });
    }

    const jornada = await db.get('SELECT id FROM jornadas WHERE id = ? AND activa = 1', [Number(jornadaId)]);
    if (!jornada) return res.status(400).json({ error: 'Esa jornada ya no está abierta' });

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

module.exports = { router };
