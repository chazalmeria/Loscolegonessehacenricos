const { createClient } = require('@libsql/client');

// Base de datos: Turso (SQLite alojado, compatible con Vercel).
// En local, si no defines TURSO_DATABASE_URL, se usa un archivo SQLite en disco
// (data/quiniela.db) gracias a que libSQL entiende URLs "file:...".
const client = createClient({
  url: process.env.TURSO_DATABASE_URL || 'file:./data/quiniela.db',
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const USERS = ['Burgos', 'Paquero', 'Jordan', 'Pepe', 'Largo', 'Joaquin', 'Miguel'];

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    display_name TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS jornadas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numero TEXT NOT NULL,
    temporada TEXT,
    activa INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS partidos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    jornada_id INTEGER NOT NULL REFERENCES jornadas(id) ON DELETE CASCADE,
    orden INTEGER NOT NULL,
    equipo_local TEXT NOT NULL,
    equipo_visitante TEXT NOT NULL,
    es_pleno INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS predicciones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    partido_id INTEGER NOT NULL REFERENCES partidos(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    pronostico TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(partido_id, username)
  )`,
];

let readyPromise = null;

// Se llama al principio de cada peticion (ver server/app.js). La primera vez
// crea las tablas y siembra los usuarios; las siguientes es casi gratis
// porque readyPromise ya esta resuelta (se reutiliza mientras la funcion
// serverless siga "caliente").
function ready() {
  if (!readyPromise) {
    readyPromise = (async () => {
      await client.batch(SCHEMA, 'write');
      for (const u of USERS) {
        await client.execute({
          sql: 'INSERT OR IGNORE INTO users (username, display_name) VALUES (?, ?)',
          args: [u, u],
        });
      }
    })();
  }
  return readyPromise;
}

function toPlainRow(row) {
  return row ? { ...row } : undefined;
}

async function run(sql, args = []) {
  const res = await client.execute({ sql, args });
  return {
    lastInsertRowid:
      res.lastInsertRowid !== undefined && res.lastInsertRowid !== null
        ? Number(res.lastInsertRowid)
        : undefined,
    changes: res.rowsAffected,
  };
}

async function get(sql, args = []) {
  const res = await client.execute({ sql, args });
  return toPlainRow(res.rows[0]);
}

async function all(sql, args = []) {
  const res = await client.execute({ sql, args });
  return res.rows.map(toPlainRow);
}

// Transaccion interactiva: fn recibe un objeto {run, get, all} que ejecuta
// dentro de la misma transaccion, y se hace commit/rollback automaticamente.
async function tx(fn) {
  const t = await client.transaction('write');
  const scoped = {
    run: async (sql, args = []) => {
      const res = await t.execute({ sql, args });
      return {
        lastInsertRowid:
          res.lastInsertRowid !== undefined && res.lastInsertRowid !== null
            ? Number(res.lastInsertRowid)
            : undefined,
        changes: res.rowsAffected,
      };
    },
    get: async (sql, args = []) => {
      const res = await t.execute({ sql, args });
      return toPlainRow(res.rows[0]);
    },
    all: async (sql, args = []) => {
      const res = await t.execute({ sql, args });
      return res.rows.map(toPlainRow);
    },
  };

  try {
    const result = await fn(scoped);
    await t.commit();
    return result;
  } catch (err) {
    try { await t.rollback(); } catch (_) { /* ya cerrada */ }
    throw err;
  }
}

module.exports = { ready, run, get, all, tx, USERS };
