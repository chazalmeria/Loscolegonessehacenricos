// Cliente minimo de loteriasapi.com (solo lo que necesitamos de La Quiniela).
// Docs: https://loteriasapi.com/docs/results  y  https://loteriasapi.com/docs/draws
//
// Plan gratuito: 1.000 peticiones al mes y 10 por minuto, asi que el resto de
// la app lo llama con moderacion (ver server/sync.js).

const { normalizarPremiosApi } = require('./premios');

const BASE_URL = 'https://api.loteriasapi.com/api/v1';

async function pedir(path) {
  const apiKey = process.env.LOTERIAS_API_KEY;
  if (!apiKey) throw new Error('Falta la variable LOTERIAS_API_KEY');

  const res = await fetch(BASE_URL + path, {
    headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) {
    const msg = (body.error && body.error.message) || `HTTP ${res.status}`;
    throw new Error(`loteriasapi.com ${path}: ${msg}`);
  }
  return body.data;
}

// "Ceuta (m)" -> "Ceuta". Se deja el "(f)" porque indica que es partido femenino.
function limpiarNombre(nombre) {
  return String(nombre || '').replace(/\s*\(m\)\s*$/i, '').trim();
}

// "3 - 1" -> "3-1"; null si todavia no hay marcador.
function limpiarMarcador(marcador) {
  const m = String(marcador || '').match(/(\d+)\s*-\s*(\d+)/);
  return m ? `${m[1]}-${m[2]}` : null;
}

function normalizarResultado(r) {
  const partidos = ((r.resultData && r.resultData.partidos) || [])
    .map((p) => ({
      posicion: Number(p.posicion),
      local: limpiarNombre(p.local),
      visitante: limpiarNombre(p.visitante),
      signo: p.signo || null,
      marcador: limpiarMarcador(p.marcador),
    }))
    .sort((a, b) => a.posicion - b.posicion);

  // Premios por categoria (vacio hasta que SELAE publica el escrutinio)
  const premios = normalizarPremiosApi(r.prizes);

  return { drawId: String(r.drawId), drawDate: r.drawDate, partidos, premios };
}

// Ultimos sorteos de La Quiniela con sus 15 partidos (los que aun no se han
// jugado vienen con signo/marcador a null). Ordenados del mas reciente al mas antiguo.
async function ultimosResultados(limit = 3) {
  const data = await pedir(`/results/quiniela?limit=${limit}&sort=drawDate&order=desc`);
  return (Array.isArray(data) ? data : [])
    .map(normalizarResultado)
    .filter((r) => r.partidos.length > 0);
}

// Numero de jornada de liga de un sorteo (viene en los metadatos del sorteo, no en el resultado).
async function numeroJornada(drawId) {
  const data = await pedir(`/draws/${encodeURIComponent(drawId)}`);
  return (data && data.metadata && data.metadata.jornada) || null;
}

module.exports = { ultimosResultados, numeroJornada };
