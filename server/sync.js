// Sincroniza la app con loteriasapi.com:
//   1. Si la API ya publica una jornada nueva (sus 15 partidos), la crea como
//      jornada activa. La anterior de la API pasa sola al Historial. Las
//      jornadas creadas a mano (manual = 1) no se tocan nunca.
//   2. Rellena el resultado real de cada partido (signo 1/X/2 y, en el Pleno
//      al 15, los goles) en todas las jornadas enlazadas con la API.
//
// Se lanza desde el cron diario de Vercel (/api/admin/sync) y, ademas, cuando
// alguien abre Jornada o Historial, como mucho una vez cada INTERVALO_MIN
// minutos, para no gastar el cupo del plan gratuito (1.000 peticiones/mes).

const db = require('./db');
const loterias = require('./loterias');

const INTERVALO_MIN = 60;

function temporadaDe(fecha) {
  const [y, m] = fecha.split('-').map(Number);
  const inicio = m >= 7 ? y : y - 1;
  return `${inicio}/${String((inicio + 1) % 100).padStart(2, '0')}`;
}

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
  let numero = null;
  try {
    numero = await loterias.numeroJornada(resultado.drawId);
  } catch (err) {
    console.error('[sync] No se pudo leer el numero de jornada:', err.message);
  }

  return db.tx(async (t) => {
    await t.run('UPDATE jornadas SET activa = 0 WHERE activa = 1 AND manual = 0');
    const info = await t.run(
      'INSERT INTO jornadas (numero, temporada, activa, draw_id, draw_date) VALUES (?, ?, 1, ?, ?)',
      [String(numero || resultado.drawDate), temporadaDe(resultado.drawDate), resultado.drawId, resultado.drawDate]
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

async function sincronizar() {
  const resumen = { jornadaNueva: null, resultadosActualizados: 0 };
  const resultados = await loterias.ultimosResultados(3);
  if (resultados.length === 0) return resumen;

  // 1. Jornada nueva (el sorteo mas reciente de la API que aun no tenemos)
  const reciente = resultados[0];
  const yaEsta = await db.get('SELECT id FROM jornadas WHERE draw_id = ?', [reciente.drawId]);
  if (!yaEsta) {
    // No pisamos una jornada de la API mas nueva que este sorteo
    const activa = await db.get(
      'SELECT draw_date FROM jornadas WHERE activa = 1 AND manual = 0 ORDER BY id DESC LIMIT 1'
    );
    if (!activa || !activa.draw_date || activa.draw_date < reciente.drawDate) {
      resumen.jornadaNueva = await crearJornada(reciente);
    }
  }

  // 2. Resultados de todas las jornadas enlazadas que siguen en la API
  for (const r of resultados) {
    const jornada = await db.get('SELECT id FROM jornadas WHERE draw_id = ?', [r.drawId]);
    if (jornada) resumen.resultadosActualizados += await aplicarResultados(jornada.id, r);
  }

  await marcarSync();
  return resumen;
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
  if (!process.env.LOTERIAS_API_KEY) return;
  try {
    const fila = await db.get("SELECT valor FROM meta WHERE clave = 'ultima_sync'");
    if (fila && Date.now() - Date.parse(fila.valor) < INTERVALO_MIN * 60 * 1000) return;
    // Se apunta el intento antes de llamar a la API: si esta falla, no se
    // reintenta en cada peticion hasta que pase el intervalo.
    await marcarSync();
    await sincronizar();
  } catch (err) {
    console.error('[sync] Fallo al sincronizar con loteriasapi.com:', err.message);
  }
}

module.exports = { sincronizar, sincronizarSiToca };
