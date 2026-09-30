const express = require('express');
const db = require('../db');
const sync = require('../sync');
const { requireAuth, USERS } = require('../auth');

const router = express.Router();

// Agrupa filas por una clave: { clave: [filas...] }
function agrupar(filas, clave) {
  const mapa = {};
  for (const f of filas) (mapa[f[clave]] = mapa[f[clave]] || []).push(f);
  return mapa;
}

// Historial: una entrada por cada jornada ya cerrada (activa = 0), con la tabla
// "Resultados de todos" de esa jornada (partido x usuario), sus premios y los
// premios fijados por usuario.
//
// Se leen todas las jornadas de golpe (5 consultas en total, en paralelo) en vez
// de 4 por jornada: con Turso cada consulta es un viaje de red y con ~8 jornadas
// la version por jornada tardaba unos 3,5 s.
router.get('/', requireAuth, async (req, res, next) => {
  try {
    await sync.sincronizarSiToca();

    const cerradas = 'SELECT id FROM jornadas WHERE activa = 0';
    const [jornadasPasadas, partidos, predicciones, premios, premiosUsuario] = await Promise.all([
      // Por fecha de creacion (la mas reciente primero), no por id: las jornadas
      // importadas del Excel se insertaron despues pero son anteriores.
      db.all('SELECT * FROM jornadas WHERE activa = 0 ORDER BY created_at DESC, id DESC'),
      db.all(`SELECT * FROM partidos WHERE jornada_id IN (${cerradas}) ORDER BY es_pleno ASC, orden ASC`),
      db.all(
        `SELECT pr.partido_id, pr.username, pr.pronostico
         FROM predicciones pr JOIN partidos p ON p.id = pr.partido_id
         WHERE p.jornada_id IN (${cerradas})`
      ),
      db.all(
        `SELECT jornada_id, aciertos, acertantes, premio_centimos, manual FROM premios
         WHERE jornada_id IN (${cerradas}) ORDER BY aciertos DESC`
      ),
      db.all(`SELECT jornada_id, username, premio_centimos FROM premios_usuario WHERE jornada_id IN (${cerradas})`),
    ]);

    const partidosPorJornada = agrupar(partidos, 'jornada_id');
    const premiosPorJornada = agrupar(premios, 'jornada_id');
    const premiosUsuarioPorJornada = agrupar(premiosUsuario, 'jornada_id');
    const prediccionesPorPartido = {};
    for (const pr of predicciones) {
      if (!prediccionesPorPartido[pr.partido_id]) prediccionesPorPartido[pr.partido_id] = {};
      prediccionesPorPartido[pr.partido_id][pr.username] = pr.pronostico;
    }

    const jornadas = jornadasPasadas.map((jornada) => ({
      jornada_id: jornada.id,
      numero: jornada.numero,
      temporada: jornada.temporada,
      manual: !!jornada.manual,
      pleno_definitivo: jornada.pleno_definitivo || null,
      premios: (premiosPorJornada[jornada.id] || []).map((f) => ({
        aciertos: Number(f.aciertos),
        acertantes: f.acertantes === null ? null : Number(f.acertantes),
        premio_centimos: f.premio_centimos === null ? null : Number(f.premio_centimos),
        manual: !!f.manual,
      })),
      premios_usuario: Object.fromEntries(
        (premiosUsuarioPorJornada[jornada.id] || []).map((f) => [f.username, Number(f.premio_centimos)])
      ),
      partidos: (partidosPorJornada[jornada.id] || []).map((p) => ({
        id: p.id,
        equipo_local: p.equipo_local,
        equipo_visitante: p.equipo_visitante,
        es_pleno: !!p.es_pleno,
        competicion: p.competicion || null,
        resultado: p.resultado || null,
        resultado_manual: !!p.resultado_manual,
        predicciones: prediccionesPorPartido[p.id] || {},
      })),
    }));

    res.json({ usuarios: USERS, jornadas });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
