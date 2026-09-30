// Cliente minimo de la API publica de Eduardo Losilla (api.eduardolosilla.es),
// la misma que usa su web. No pide clave ni tiene cupo, y publica la jornada
// abierta con sus 15 partidos en cuanto se puede apostar, los resultados
// mientras se juegan y los premios cuando sale el escrutinio.

const BASE_URL = 'https://api.eduardolosilla.es';

async function pedir(path) {
  const res = await fetch(BASE_URL + path, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`eduardolosilla.es ${path}: HTTP ${res.status}`);
  return res.json();
}

// 2027 -> "2026/27" (Losilla numera la temporada por el año en que acaba)
function etiquetaTemporada(temporada) {
  const fin = Number(temporada);
  return `${fin - 1}/${String(fin % 100).padStart(2, '0')}`;
}

// Timestamp en segundos -> "YYYY-MM-DD" en hora de Madrid
function fechaMadrid(segundos) {
  return new Date(segundos * 1000).toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });
}

// "3-1" -> "3-1"; "-" o vacio (partido sin jugar) -> null
function limpiarMarcador(marcador) {
  const m = String(marcador || '').match(/(\d+)\s*-\s*(\d+)/);
  return m ? `${m[1]}-${m[2]}` : null;
}

// Premios solo cuando la jornada esta escrutada: antes vienen todos a 0.
// "premio" viene en euros (51595.23).
function normalizarPremios(d) {
  if (d.estado !== 'ESCRUTADA') return [];
  return (d.acertantes || [])
    .filter((a) => Number(a.acierto) >= 10 && Number(a.acierto) <= 15)
    .map((a) => ({
      aciertos: Number(a.acierto),
      acertantes: Number.isFinite(Number(a.acertantes)) ? Number(a.acertantes) : null,
      premio_centimos: Number.isFinite(Number(a.premio)) ? Math.round(Number(a.premio) * 100) : null,
    }));
}

// Una jornada con sus 15 partidos (los que aun no se han jugado llevan
// signo/marcador a null). Devuelve null si Losilla todavia no la tiene.
async function jornada(temporada, numero) {
  const d = await pedir(`/escrutinios?num_jornada=${numero}&num_temporada=${temporada}`);
  const partidos = (d.partidos || [])
    .map((p) => ({
      posicion: Number(p.num),
      local: String(p.local || '').trim(),
      visitante: String(p.visitante || '').trim(),
      signo: ['1', 'X', '2'].includes(p.signo) ? p.signo : null,
      marcador: limpiarMarcador(p.resultado),
    }))
    .sort((a, b) => a.posicion - b.posicion);
  if (partidos.length === 0) return null;

  return {
    drawId: `losilla-${temporada}-${numero}`,
    numero: String(numero),
    temporada: etiquetaTemporada(temporada),
    drawDate: d.fecha_jornada ? fechaMadrid(d.fecha_jornada) : null,
    partidos,
    premios: normalizarPremios(d),
  };
}

// Ultimas `cuantas` jornadas, de la mas nueva (la abierta) a la mas antigua.
// Al principio de temporada tira de las ultimas de la temporada anterior.
async function ultimasJornadas(cuantas = 3) {
  const general = await pedir('/datosGeneralesJornada');
  const temporada = Number(general.temporada);
  const actual = Number(general.jornada);
  if (!temporada || !actual) throw new Error('eduardolosilla.es no devuelve la jornada actual');

  const pedidas = [];
  let anteriores = null; // jornadas de la temporada anterior (solo si hace falta)
  for (let i = 0; i < cuantas; i++) {
    let t = temporada;
    let n = actual - i;
    if (n < 1) {
      if (anteriores === null) {
        const d = await pedir(`/escrutinios?num_jornada=${actual}&num_temporada=${temporada}`);
        anteriores = Number(d.jornadas_temporada_anterior) || 0;
      }
      if (!anteriores) break;
      t = temporada - 1;
      n = anteriores + n;
    }
    pedidas.push(jornada(t, n));
  }
  return (await Promise.all(pedidas)).filter(Boolean);
}

module.exports = { ultimasJornadas };
