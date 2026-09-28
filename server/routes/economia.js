// Economia: lo que lleva cada usuario (+/-) en el bote comun. Se modifica a
// mano desde la pestaña Economia; cualquier usuario logueado puede hacerlo.
const express = require('express');
const db = require('../db');
const { requireAuth, USERS } = require('../auth');

const router = express.Router();

async function leerSaldos() {
  const filas = await db.all('SELECT * FROM economia');
  const porUsuario = Object.fromEntries(filas.map((f) => [f.username, f]));
  const usuarios = USERS.map((username) => {
    const f = porUsuario[username];
    return {
      username,
      saldo_centimos: f ? Number(f.saldo_centimos) : 0,
      updated_at: (f && f.updated_at) || null,
      updated_by: (f && f.updated_by) || null,
    };
  });
  const total = usuarios.reduce((n, u) => n + u.saldo_centimos, 0);
  return { usuarios, total_centimos: total };
}

router.get('/', requireAuth, async (req, res, next) => {
  try {
    res.json(await leerSaldos());
  } catch (err) {
    next(err);
  }
});

// Body: { saldos: { Burgos: 1250, Pepe: -300, ... } } en centimos (enteros).
// Solo se tocan los usuarios cuyo saldo cambia.
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { saldos } = req.body || {};
    if (!saldos || typeof saldos !== 'object') return res.status(400).json({ error: 'Formato invalido' });

    const actuales = Object.fromEntries((await leerSaldos()).usuarios.map((u) => [u.username, u.saldo_centimos]));
    const cambios = [];
    for (const [username, valor] of Object.entries(saldos)) {
      if (!USERS.includes(username)) return res.status(400).json({ error: `Usuario desconocido: ${username}` });
      const centimos = Number(valor);
      if (!Number.isSafeInteger(centimos) || Math.abs(centimos) > 100000000) {
        return res.status(400).json({ error: `Cantidad no válida para ${username}` });
      }
      if (centimos !== actuales[username]) cambios.push([username, centimos]);
    }

    await db.tx(async (t) => {
      for (const [username, centimos] of cambios) {
        await t.run(
          `INSERT INTO economia (username, saldo_centimos, updated_at, updated_by)
           VALUES (?, ?, datetime('now'), ?)
           ON CONFLICT(username) DO UPDATE SET
             saldo_centimos = excluded.saldo_centimos,
             updated_at = excluded.updated_at,
             updated_by = excluded.updated_by`,
          [username, centimos, req.username]
        );
      }
    });

    res.json({ ok: true, cambiados: cambios.length, ...(await leerSaldos()) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
