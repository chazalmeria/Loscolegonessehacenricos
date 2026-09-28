// Premios de La Quiniela por categoria (ver tabla "premios" en db.js).
//   aciertos = 15 -> Pleno al 15 (categoria Especial: 14 aciertos + Pleno)
//   aciertos = 14..10 -> 1ª..5ª categoria
const db = require('./db');

const CATEGORIAS = [15, 14, 13, 12, 11, 10];

// Categoria de la API -> aciertos. loteriasapi.com usa nombres tipo
// "1ª (14 Aciertos)" o "Especial (14 + Pleno)"; en su documentacion aparece
// tambien "Pleno al 15". Devuelve null si no se reconoce.
function aciertosDeCategoria(premio) {
  const nombre = String(premio.categoryName || premio.category || '');
  if (/pleno|especial|15/i.test(nombre)) return 15;
  const m = nombre.match(/(1[0-4])\s*aciertos?/i) || nombre.match(/\b(1[0-4])\b/);
  if (m) return Number(m[1]);
  // Solo el ordinal ("3ª categoría"): 1ª = 14 aciertos ... 5ª = 10 aciertos
  const ordinal = nombre.match(/\b([1-5])\s*[ªa]/i);
  return ordinal ? 15 - Number(ordinal[1]) : null;
}

// Importe en centimos: prizeAmount viene en centimos como texto ("2550784" =
// 25.507,84 €); en la documentacion tambien aparece "prize" en euros (215324.18).
function centimosDePremio(premio) {
  if (premio.prizeAmount !== undefined && premio.prizeAmount !== null && /^\d+$/.test(String(premio.prizeAmount))) {
    return Number(premio.prizeAmount);
  }
  if (typeof premio.prize === 'number') return Math.round(premio.prize * 100);
  return null;
}

function normalizarPremiosApi(prizes) {
  const premios = [];
  for (const p of prizes || []) {
    const aciertos = aciertosDeCategoria(p);
    if (!aciertos || premios.some((x) => x.aciertos === aciertos)) continue;
    premios.push({
      aciertos,
      acertantes: Number.isFinite(Number(p.winners)) ? Number(p.winners) : null,
      premio_centimos: centimosDePremio(p),
    });
  }
  return premios;
}

async function getPremios(jornadaId) {
  const filas = await db.all(
    'SELECT aciertos, acertantes, premio_centimos, manual FROM premios WHERE jornada_id = ? ORDER BY aciertos DESC',
    [jornadaId]
  );
  return filas.map((f) => ({
    aciertos: Number(f.aciertos),
    acertantes: f.acertantes === null ? null : Number(f.acertantes),
    premio_centimos: f.premio_centimos === null ? null : Number(f.premio_centimos),
    manual: !!f.manual,
  }));
}

// Guarda los premios que llegan de la API sin pisar los puestos a mano.
// Devuelve cuantas categorias se han guardado o cambiado.
async function guardarPremiosApi(jornadaId, premios) {
  let cambiados = 0;
  for (const p of premios) {
    const actual = await db.get('SELECT * FROM premios WHERE jornada_id = ? AND aciertos = ?', [jornadaId, p.aciertos]);
    if (actual && actual.manual) continue;
    if (actual && Number(actual.acertantes) === p.acertantes && Number(actual.premio_centimos) === p.premio_centimos) continue;
    await db.run(
      `INSERT INTO premios (jornada_id, aciertos, acertantes, premio_centimos, manual) VALUES (?, ?, ?, ?, 0)
       ON CONFLICT(jornada_id, aciertos) DO UPDATE SET
         acertantes = excluded.acertantes, premio_centimos = excluded.premio_centimos, manual = 0`,
      [jornadaId, p.aciertos, p.acertantes, p.premio_centimos]
    );
    cambiados++;
  }
  return cambiados;
}

module.exports = { CATEGORIAS, normalizarPremiosApi, getPremios, guardarPremiosApi };
