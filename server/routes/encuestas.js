// Encuestas del lateral del chat (pestaña Inicio). Cualquiera puede crear una;
// cada usuario vota una opcion y puede cambiarla o quitarla. Solo quien la
// creo la puede cerrar (ya no admite votos) o borrar.
const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

const MAX_OPCIONES = 6;
const MAX_LISTADO = 20;

async function listar(username) {
  const encuestas = await db.all(
    `SELECT id, username, pregunta, cerrada, created_at FROM encuestas
     ORDER BY cerrada ASC, id DESC LIMIT ${MAX_LISTADO}`
  );
  if (!encuestas.length) return [];
  const ids = encuestas.map((e) => e.id);
  const marcas = ids.map(() => '?').join(',');
  const opciones = await db.all(
    `SELECT id, encuesta_id, texto FROM encuesta_opciones WHERE encuesta_id IN (${marcas}) ORDER BY orden`,
    ids
  );
  const votos = await db.all(
    `SELECT encuesta_id, username, opcion_id FROM encuesta_votos WHERE encuesta_id IN (${marcas})`,
    ids
  );

  return encuestas.map((e) => {
    const suyos = votos.filter((v) => v.encuesta_id === e.id);
    const mio = suyos.find((v) => v.username === username);
    return {
      id: e.id,
      autor: e.username,
      pregunta: e.pregunta,
      cerrada: !!e.cerrada,
      created_at: e.created_at,
      total_votos: suyos.length,
      mi_voto: mio ? mio.opcion_id : null,
      opciones: opciones
        .filter((o) => o.encuesta_id === e.id)
        .map((o) => ({
          id: o.id,
          texto: o.texto,
          votantes: suyos.filter((v) => v.opcion_id === o.id).map((v) => v.username),
        })),
    };
  });
}

router.get('/', requireAuth, async (req, res, next) => {
  try {
    res.json({ encuestas: await listar(req.username) });
  } catch (err) {
    next(err);
  }
});

// Body: { pregunta, opciones: ["...", "..."] } (de 2 a 6 opciones)
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const pregunta = String((req.body && req.body.pregunta) || '').trim().slice(0, 200);
    const opciones = [...new Set(
      ((req.body && req.body.opciones) || []).map((o) => String(o || '').trim().slice(0, 100)).filter(Boolean)
    )];
    if (!pregunta) return res.status(400).json({ error: 'Escribe la pregunta' });
    if (opciones.length < 2) return res.status(400).json({ error: 'Pon al menos 2 opciones distintas' });
    if (opciones.length > MAX_OPCIONES) return res.status(400).json({ error: `Como mucho ${MAX_OPCIONES} opciones` });

    await db.tx(async (t) => {
      const info = await t.run('INSERT INTO encuestas (username, pregunta) VALUES (?, ?)', [req.username, pregunta]);
      const id = info.lastInsertRowid;
      for (let i = 0; i < opciones.length; i++) {
        await t.run('INSERT INTO encuesta_opciones (encuesta_id, orden, texto) VALUES (?, ?, ?)', [id, i + 1, opciones[i]]);
      }
      // Aviso en el chat para que todos se enteren
      await t.run('INSERT INTO messages (username, text) VALUES (?, ?)', [req.username, `📊 Nueva encuesta: ${pregunta}`]);
    });
    res.json({ ok: true, encuestas: await listar(req.username) });
  } catch (err) {
    next(err);
  }
});

// Body: { opcion_id }. Votar la opcion que ya tenias votada quita el voto.
router.post('/:id/votar', requireAuth, async (req, res, next) => {
  try {
    const encuesta = await db.get('SELECT id, cerrada FROM encuestas WHERE id = ?', [Number(req.params.id)]);
    if (!encuesta) return res.status(404).json({ error: 'Esa encuesta ya no existe' });
    if (encuesta.cerrada) return res.status(400).json({ error: 'La encuesta está cerrada' });
    const opcion = await db.get('SELECT id FROM encuesta_opciones WHERE id = ? AND encuesta_id = ?', [
      Number(req.body && req.body.opcion_id),
      encuesta.id,
    ]);
    if (!opcion) return res.status(400).json({ error: 'Opción no válida' });

    const actual = await db.get('SELECT opcion_id FROM encuesta_votos WHERE encuesta_id = ? AND username = ?', [
      encuesta.id,
      req.username,
    ]);
    if (actual && Number(actual.opcion_id) === Number(opcion.id)) {
      await db.run('DELETE FROM encuesta_votos WHERE encuesta_id = ? AND username = ?', [encuesta.id, req.username]);
    } else {
      await db.run(
        `INSERT INTO encuesta_votos (encuesta_id, username, opcion_id) VALUES (?, ?, ?)
         ON CONFLICT(encuesta_id, username) DO UPDATE SET opcion_id = excluded.opcion_id`,
        [encuesta.id, req.username, opcion.id]
      );
    }
    res.json({ ok: true, encuestas: await listar(req.username) });
  } catch (err) {
    next(err);
  }
});

async function soloAutor(req, res) {
  const encuesta = await db.get('SELECT id, username FROM encuestas WHERE id = ?', [Number(req.params.id)]);
  if (!encuesta) {
    res.status(404).json({ error: 'Esa encuesta ya no existe' });
    return null;
  }
  if (encuesta.username !== req.username) {
    res.status(403).json({ error: 'Solo quien creó la encuesta puede hacer eso' });
    return null;
  }
  return encuesta;
}

// Cerrar (o reabrir) la encuesta: cerrada ya no admite votos
router.post('/:id/cerrar', requireAuth, async (req, res, next) => {
  try {
    const encuesta = await soloAutor(req, res);
    if (!encuesta) return;
    await db.run('UPDATE encuestas SET cerrada = 1 - cerrada WHERE id = ?', [encuesta.id]);
    res.json({ ok: true, encuestas: await listar(req.username) });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const encuesta = await soloAutor(req, res);
    if (!encuesta) return;
    await db.tx(async (t) => {
      await t.run('DELETE FROM encuesta_votos WHERE encuesta_id = ?', [encuesta.id]);
      await t.run('DELETE FROM encuesta_opciones WHERE encuesta_id = ?', [encuesta.id]);
      await t.run('DELETE FROM encuestas WHERE id = ?', [encuesta.id]);
    });
    res.json({ ok: true, encuestas: await listar(req.username) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
