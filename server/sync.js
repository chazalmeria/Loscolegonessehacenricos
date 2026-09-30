// Sincroniza la app con la API publica de Eduardo Losilla (ver server/losilla.js):
//   1. Si hay una jornada abierta nueva (sus 15 partidos), la crea como
//      jornada activa. La anterior de la API queda "en juego" (en_juego = 1):
//      sigue en la pestaña Jornada, encima de la nueva, con los pronosticos
//      congelados. Las jornadas creadas a mano (manual = 1) no se tocan nunca.
//   2. Rellena el resultado real de cada partido (signo 1/X/2 y, en el Pleno
//      al 15, los goles) y los premios en las ultimas jornadas enlazadas.
//   3. Pasa al Historial las jornadas en juego que ya han terminado.
//
// Se lanza desde el cron diario de Vercel (/api/admin/sync) y, ademas, cuando
// alguien abre Jornada o Historial, como mucho una vez cada INTERVALO_MIN
// minutos. No depende de ningun servicio externo con clave ni cupo.

const db = require('./db');
const losilla = require('./losilla');
const premios = require('./premios');

const INTERVALO_MIN = 30;

async function aplicarResultados(jornadaId, resultado) {
  const partidos = await db.all(
    'SELECT id, orden, es_pleno, resultado, resultado_manual FROM partidos WHERE jornada_id = ?',
    [jornadaId]
  );
  let actualizados = 0;
  for (const p of partidos) {
    if (p.resultado_manual) continue; // lo puso alguien a mano: no se pisa
    const api = resultado.partidos.find((x) => x.posicion === (p.es_pleno ? 15 : p.orden));
    if (!api) continue;
    const valor = p.es_pleno ? api.marcador : api.signo;
    if (valor && valor !== p.resultado) {
      await db.run('UPDATE partidos SET resultado = ? WHERE id = ?', [valor, p.id]);
      actualizados++;
    }
  }
  return actualizados;
}

async function crearJornada(resultado) {
  return db.tx(async (t) => {
    // La que estaba abierta pasa a "en juego": sigue en Jornada, sin pronosticos
    await t.run('UPDATE jornadas SET en_juego = 1 WHERE activa = 1 AND manual = 0');
    const info = await t.run(
      'INSERT INTO jornadas (numero, temporada, activa, draw_id, draw_date) VALUES (?, ?, 1, ?, ?)',
      [resultado.numero, resultado.temporada, resultado.drawId, resultado.drawDate]
    );
    const id = info.lastInsertRowid;
    for (const p of resultado.partidos) {
      const esPleno = p.posicion === 15;
      await t.run(
        'INSERT INTO partidos (jornada_id, orden, equipo_local, equipo_visitante, es_pleno) VALUES (?, ?, ?, ?, ?)',
        [id, esPleno ? 99 : p.posicion, p.local, p.visitante, esPleno ? 1 : 0]
      );
    }
    return id;
  });
}

// Busca la jornada de la API en la base de datos. Las que se crearon con
// loteriasapi.com tienen otro draw_id: se reconocen por temporada + numero y
// se re-enlazan con el id de Losilla para seguir recibiendo resultados.
async function buscarJornada(r) {
  const enlazada = await db.get('SELECT id FROM jornadas WHERE draw_id = ?', [r.drawId]);
  if (enlazada) return enlazada;
  const antigua = await db.get(
    `SELECT id FROM jornadas WHERE manual = 0 AND temporada = ? AND numero = ?
       AND (draw_id IS NULL OR draw_id NOT LIKE 'losilla-%') ORDER BY id DESC LIMIT 1`,
    [r.temporada, r.numero]
  );
  if (antigua) await db.run('UPDATE jornadas SET draw_id = ? WHERE id = ?', [r.drawId, antigua.id]);
  return antigua || null;
}

async function sincronizar() {
  const resumen = { jornadaNueva: null, resultadosActualizados: 0, premiosActualizados: 0 };
  const resultados = await losilla.ultimasJornadas(3);
  if (resultados.length === 0) return resumen;

  // 1. Jornada nueva (la abierta en Losilla, si aun no la tenemos)
  const reciente = resultados[0];
  if (!(await buscarJornada(reciente))) {
    // No pisamos una jornada de la API mas nueva que esta
    const activa = await db.get(
      'SELECT draw_date FROM jornadas WHERE activa = 1 AND manual = 0 ORDER BY id DESC LIMIT 1'
    );
    if (!activa || !activa.draw_date || !reciente.drawDate || activa.draw_date < reciente.drawDate) {
      resumen.jornadaNueva = await crearJornada(reciente);
    }
  }

  // 2. Resultados y premios de las jornadas enlazadas
  for (const r of resultados) {
    const jornada = await buscarJornada(r);
    if (!jornada) continue;
    resumen.resultadosActualizados += await aplicarResultados(jornada.id, r);
    if (r.premios.length) resumen.premiosActualizados += await premios.guardarPremiosApi(jornada.id, r.premios);
  }

  // 3. Las jornadas en juego terminadas pasan al Historial
  resumen.alHistorial = await archivarTerminadas(resultados);

  await marcarSync();
  return resumen;
}

// Una jornada en juego pasa al Historial cuando tiene el resultado de todos
// sus partidos y los premios, o cuando ya no esta entre las que revisa la
// sincronizacion (no le van a llegar mas datos).
async function archivarTerminadas(resultados) {
  const revisadas = new Set(resultados.map((r) => r.drawId));
  const enJuego = await db.all('SELECT id, draw_id FROM jornadas WHERE activa = 1 AND en_juego = 1');
  let archivadas = 0;
  for (const j of enJuego) {
    const pendientes = await db.get('SELECT COUNT(*) AS n FROM partidos WHERE jornada_id = ? AND resultado IS NULL', [j.id]);
    const conPremios = await db.get('SELECT COUNT(*) AS n FROM premios WHERE jornada_id = ?', [j.id]);
    const terminada = Number(pendientes.n) === 0 && Number(conPremios.n) > 0;
    if (terminada || !revisadas.has(j.draw_id)) {
      await db.run('UPDATE jornadas SET activa = 0, en_juego = 0 WHERE id = ?', [j.id]);
      archivadas++;
    }
  }
  return archivadas;
}

function marcarSync() {
  return db.run(
    `INSERT INTO meta (clave, valor) VALUES ('ultima_sync', ?)
     ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`,
    [new Date().toISOString()]
  );
}

// Version "de paso" para las pantallas: respeta el intervalo minimo y nunca
// lanza errores (si la API falla, la pagina se sirve igual con lo que haya).
async function sincronizarSiToca() {
  try {
    const fila = await db.get("SELECT valor FROM meta WHERE clave = 'ultima_sync'");
    if (fila && Date.now() - Date.parse(fila.valor) < INTERVALO_MIN * 60 * 1000) return;
    // Se apunta el intento antes de llamar a la API: si esta falla, no se
    // reintenta en cada peticion hasta que pase el intervalo.
    await marcarSync();
    await sincronizar();
  } catch (err) {
    console.error('[sync] Fallo al sincronizar con eduardolosilla.es:', err.message);
  }
}

module.exports = { sincronizar, sincronizarSiToca };
