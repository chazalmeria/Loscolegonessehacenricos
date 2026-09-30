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
    'SELECT id, orden, es_pleno, resultado, resultado_manual, competicion FROM partidos WHERE jornada_id = ?',
    [jornadaId]
  );
  let actualizados = 0;
  for (const p of partidos) {
    const api = resultado.partidos.find((x) => x.posicion === (p.es_pleno ? 15 : p.orden));
    if (!api) continue;
    // Competicion para Estadisticas (las jornadas antiguas no la tenian)
    if (!p.competicion && api.competicion) {
      await db.run('UPDATE partidos SET competicion = ?, division = ? WHERE id = ?', [api.competicion, api.division, p.id]);
    }
    if (p.resultado_manual) continue; // lo puso alguien a mano: no se pisa
    const valor = p.es_pleno ? api.marcador : api.signo;
    if (valor && valor !== p.resultado) {
      await db.run('UPDATE partidos SET resultado = ? WHERE id = ?', [valor, p.id]);
      actualizados++;
    }
  }
  return actualizados;
}

// enJuego = true: se crea ya "en juego" (jornada pasada) sin tocar las demas
async function crearJornada(resultado, { enJuego = false } = {}) {
  return db.tx(async (t) => {
    // La que estaba abierta pasa a "en juego": sigue en Jornada, sin pronosticos
    if (!enJuego) await t.run('UPDATE jornadas SET en_juego = 1 WHERE activa = 1 AND manual = 0');
    const info = await t.run(
      'INSERT INTO jornadas (numero, temporada, activa, en_juego, draw_id, draw_date) VALUES (?, ?, 1, ?, ?, ?)',
      [resultado.numero, resultado.temporada, enJuego ? 1 : 0, resultado.drawId, resultado.drawDate]
    );
    const id = info.lastInsertRowid;
    for (const p of resultado.partidos) {
      const esPleno = p.posicion === 15;
      await t.run(
        `INSERT INTO partidos (jornada_id, orden, equipo_local, equipo_visitante, es_pleno, division, competicion)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, esPleno ? 99 : p.posicion, p.local, p.visitante, esPleno ? 1 : 0, p.division, p.competicion]
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
  // Solo si son los mismos partidos: el numero de las antiguas puede no cuadrar
  if (!antigua || !(await coincideJornada(antigua.id, r))) return null;
  await db.run('UPDATE jornadas SET draw_id = ? WHERE id = ?', [r.drawId, antigua.id]);
  return antigua;
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

  // 4. Competicion de los partidos de jornadas antiguas (unas pocas por vuelta)
  resumen.competicionesCompletadas = await completarCompeticiones();

  await marcarSync();
  return resumen;
}

// Mete una jornada pasada que no llego a crearse (p. ej. porque la API fallaba),
// con los pronosticos de cada uno apuntados fuera de la app.
// temporada = la de Losilla (2027 = 2026/27). pronosticos = { usuario: [14 signos..., pleno] }.
// Si ya hay una jornada de la API mas nueva, entra "en juego" (encima de ella)
// y pasa sola al Historial cuando tenga resultados y premios.
async function importarJornada(temporada, numero, pronosticos) {
  const r = await losilla.jornada(temporada, numero);
  if (!r) throw new Error(`Losilla no tiene la jornada ${numero} de ${temporada}`);

  let jornada = await buscarJornada(r);
  if (!jornada) {
    const masNueva = await db.get(
      'SELECT id FROM jornadas WHERE activa = 1 AND manual = 0 AND draw_date > ? LIMIT 1',
      [r.drawDate]
    );
    jornada = { id: await crearJornada(r, { enJuego: !!masNueva }) };
  }

  const partidos = await db.all('SELECT id, orden, es_pleno FROM partidos WHERE jornada_id = ? ORDER BY es_pleno, orden', [
    jornada.id,
  ]);
  let guardados = 0;
  await db.tx(async (t) => {
    for (const [usuario, valores] of Object.entries(pronosticos || {})) {
      for (let i = 0; i < partidos.length && i < valores.length; i++) {
        const valor = String(valores[i] || '').trim().toUpperCase();
        if (!valor) continue;
        await t.run(
          `INSERT INTO predicciones (partido_id, username, pronostico, updated_at)
           VALUES (?, ?, ?, datetime('now'))
           ON CONFLICT(partido_id, username)
           DO UPDATE SET pronostico = excluded.pronostico, updated_at = datetime('now')`,
          [partidos[i].id, usuario, valor]
        );
        guardados++;
      }
    }
  });

  const resultados = await aplicarResultados(jornada.id, r);
  if (r.premios.length) await premios.guardarPremiosApi(jornada.id, r.premios);
  return { jornadaId: jornada.id, pronosticosGuardados: guardados, resultadosActualizados: resultados };
}

// Las jornadas de la API creadas antes de guardar la competicion no la tienen:
// se pide cada una a Losilla (por temporada + numero) y se rellena. Como mucho
// POR_VUELTA jornadas en cada sincronizacion; las que Losilla no tenga se
// apuntan en meta para no volver a pedirlas.
const POR_VUELTA = 4;

// Clave corta de un equipo para comparar nombres de distintas fuentes:
// "Athletic Club" / "ATH.CLUB", "Real Madrid" / "R.MADRID", "Real Valladolid" / "VALLADOLID"
function claveEquipo(nombre) {
  return String(nombre || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]/g, '')
    .replace(/^ATLETICODE/, 'AT')
    .replace(/^ATHLETIC/, 'ATH')
    .replace(/^REAL/, 'R');
}
function mismoEquipo(a, b) {
  const x = claveEquipo(a);
  const y = claveEquipo(b);
  if (!x || !y) return false;
  return x.slice(0, 4) === y.slice(0, 4) || x.includes(y.slice(-5)) || y.includes(x.slice(-5));
}

// ¿Es la misma jornada? Al menos 10 de los 14 partidos con el mismo local.
// (El numero no basta: las jornadas del Excel se numeraron seguidas y saltan
// las que el grupo no jugo, p. ej. la de Champions.)
async function coincideJornada(jornadaId, r) {
  const partidos = await db.all('SELECT orden, equipo_local FROM partidos WHERE jornada_id = ? AND es_pleno = 0', [jornadaId]);
  const iguales = partidos.filter((p) => {
    const api = r.partidos.find((x) => x.posicion === Number(p.orden));
    return api && mismoEquipo(p.equipo_local, api.local);
  }).length;
  return iguales >= Math.min(10, partidos.length);
}

// Busca en Losilla la jornada que corresponde a una de la base de datos:
// primero la de su numero y luego las cercanas (±3)
async function jornadaLosillaDe(j) {
  const m = String(j.temporada || '').match(/^(\d{4})\//);
  if (!m || !/^\d+$/.test(String(j.numero))) return null;
  const temporada = Number(m[1]) + 1; // "2026/27" -> 2027
  const numero = Number(j.numero);
  for (const n of [numero, numero + 1, numero - 1, numero + 2, numero - 2, numero + 3, numero - 3]) {
    if (n < 1) continue;
    const r = await losilla.jornada(temporada, n);
    if (r && (await coincideJornada(j.id, r))) return r;
  }
  return null;
}

async function completarCompeticiones() {
  // Una sola vez: la primera version emparejaba solo por numero y clasifico
  // (y piso resultados de) jornadas que no eran. Se vuelven a emparejar todas.
  const reparada = await db.get("SELECT valor FROM meta WHERE clave = 'competiciones_v2'");
  if (!reparada) {
    await db.run('UPDATE partidos SET competicion = NULL, division = NULL WHERE jornada_id IN (SELECT id FROM jornadas WHERE manual = 0)');
    await db.run("DELETE FROM meta WHERE clave = 'competiciones_sin_datos'");
    await db.run("INSERT INTO meta (clave, valor) VALUES ('competiciones_v2', '1')");
  }

  const fila = await db.get("SELECT valor FROM meta WHERE clave = 'competiciones_sin_datos'");
  const sinDatos = new Set(fila && fila.valor ? fila.valor.split(',').map(Number) : []);
  const pendientes = (
    await db.all(
      `SELECT DISTINCT j.id, j.numero, j.temporada FROM jornadas j JOIN partidos p ON p.jornada_id = j.id
       WHERE j.manual = 0 AND p.competicion IS NULL ORDER BY j.id DESC`
    )
  ).filter((j) => !sinDatos.has(Number(j.id)));

  let hechas = 0;
  for (const j of pendientes.slice(0, POR_VUELTA)) {
    const r = await jornadaLosillaDe(j);
    if (!r) {
      sinDatos.add(Number(j.id));
      continue;
    }
    // aplicarResultados rellena la competicion (y los resultados que falten)
    await aplicarResultados(j.id, r);
    hechas++;
  }
  if (sinDatos.size) {
    await db.run(
      `INSERT INTO meta (clave, valor) VALUES ('competiciones_sin_datos', ?)
       ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`,
      [[...sinDatos].join(',')]
    );
  }
  return hechas;
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

module.exports = { sincronizar, sincronizarSiToca, importarJornada };
