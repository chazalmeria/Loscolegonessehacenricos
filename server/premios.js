// Premios de La Quiniela por categoria (ver tabla "premios" en db.js).
//   aciertos = 15 -> Pleno al 15 (categoria Especial: 14 aciertos + Pleno)
//   aciertos = 14..10 -> 1ª..5ª categoria
const db = require('./db');

const CATEGORIAS = [15, 14, 13, 12, 11, 10];

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

// Premios fijados a mano por usuario: { Burgos: 0, Pepe: 1250, ... } (centimos)
async function getPremiosUsuario(jornadaId) {
  const filas = await db.all('SELECT username, premio_centimos FROM premios_usuario WHERE jornada_id = ?', [jornadaId]);
  return Object.fromEntries(filas.map((f) => [f.username, Number(f.premio_centimos)]));
}

module.exports = { CATEGORIAS, getPremios, guardarPremiosApi, getPremiosUsuario };
