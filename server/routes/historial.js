const express = require('express');
const db = require('../db');
const { requireAuth, USERS } = require('../auth');

const router = express.Router();

// Historial: para cada usuario, todas las jornadas pasadas (no activas) con sus pronosticos.
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const jornadasPasadas = await db.all('SELECT * FROM jornadas WHERE activa = 0 ORDER BY id DESC');

    const porUsuario = {};
    for (const username of USERS) {
      const jornadasDeEsteUsuario = [];
      for (const jornada of jornadasPasadas) {
        const partidos = await db.all(
          'SELECT * FROM partidos WHERE jornada_id = ? ORDER BY es_pleno ASC, orden ASC',
          [jornada.id]
        );
        const partidosConPronostico = [];
        for (const p of partidos) {
          const pred = await db.get(
            'SELECT pronostico FROM predicciones WHERE partido_id = ? AND username = ?',
            [p.id, username]
          );
          partidosConPronostico.push({
            equipo_local: p.equipo_local,
            equipo_visitante: p.equipo_visitante,
            es_pleno: !!p.es_pleno,
            pronostico: pred ? pred.pronostico : '',
          });
        }
        jornadasDeEsteUsuario.push({
          jornada_id: jornada.id,
          numero: jornada.numero,
          temporada: jornada.temporada,
          partidos: partidosConPronostico,
        });
      }
      porUsuario[username] = jornadasDeEsteUsuario;
    }

    res.json({ usuarios: USERS, historial: porUsuario });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
