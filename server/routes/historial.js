const express = require('express');
const db = require('../db');
const sync = require('../sync');
const { requireAuth, USERS } = require('../auth');

const router = express.Router();

// Historial: una entrada por cada jornada ya cerrada (activa = 0), con la tabla
// "Resultados de todos" de esa jornada (partido x usuario).
router.get('/', requireAuth, async (req, res, next) => {
  try {
    await sync.sincronizarSiToca();
    const jornadasPasadas = await db.all('SELECT * FROM jornadas WHERE activa = 0 ORDER BY id DESC');

    const jornadas = [];
    for (const jornada of jornadasPasadas) {
      const partidos = await db.all(
        'SELECT * FROM partidos WHERE jornada_id = ? ORDER BY es_pleno ASC, orden ASC',
        [jornada.id]
      );

      const predicciones = await db.all(
        `SELECT pr.partido_id as partido_id, pr.username, pr.pronostico
         FROM predicciones pr
         JOIN partidos p ON p.id = pr.partido_id
         WHERE p.jornada_id = ?`,
        [jornada.id]
      );
      const mapaPorPartido = {};
      for (const pr of predicciones) {
        if (!mapaPorPartido[pr.partido_id]) mapaPorPartido[pr.partido_id] = {};
        mapaPorPartido[pr.partido_id][pr.username] = pr.pronostico;
      }

      jornadas.push({
        jornada_id: jornada.id,
        numero: jornada.numero,
        temporada: jornada.temporada,
        manual: !!jornada.manual,
        partidos: partidos.map((p) => ({
          equipo_local: p.equipo_local,
          equipo_visitante: p.equipo_visitante,
          es_pleno: !!p.es_pleno,
          resultado: p.resultado || null,
          predicciones: mapaPorPartido[p.id] || {},
        })),
      });
    }

    res.json({ usuarios: USERS, jornadas });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
