const express = require('express');
const db = require('../db');
const { requireAuth, USERS } = require('../auth');

const router = express.Router();

// Historial: para cada usuario, todas las jornadas pasadas (no activas) con sus pronosticos.
router.get('/', requireAuth, (req, res) => {
  const jornadasPasadas = db
    .prepare('SELECT * FROM jornadas WHERE activa = 0 ORDER BY id DESC')
    .all();

  const partidosStmt = db.prepare(
    'SELECT * FROM partidos WHERE jornada_id = ? ORDER BY es_pleno ASC, orden ASC'
  );
  const prediccionStmt = db.prepare(
    'SELECT pronostico FROM predicciones WHERE partido_id = ? AND username = ?'
  );

  const porUsuario = {};
  for (const username of USERS) {
    porUsuario[username] = jornadasPasadas.map((jornada) => {
      const partidos = partidosStmt.all(jornada.id).map((p) => {
        const pred = prediccionStmt.get(p.id, username);
        return {
          equipo_local: p.equipo_local,
          equipo_visitante: p.equipo_visitante,
          es_pleno: !!p.es_pleno,
          pronostico: pred ? pred.pronostico : '',
        };
      });
      return {
        jornada_id: jornada.id,
        numero: jornada.numero,
        temporada: jornada.temporada,
        partidos,
      };
    });
  }

  res.json({ usuarios: USERS, historial: porUsuario });
});

module.exports = router;
