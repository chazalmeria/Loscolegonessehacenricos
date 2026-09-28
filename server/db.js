// Base de datos: Turso (SQLite alojado, compatible con Vercel).
// En local, si no defines TURSO_DATABASE_URL, se usa un archivo SQLite en disco
// (data/quiniela.db) gracias a que libSQL entiende URLs "file:...".
//
// IMPORTANTE: tanto el require('@libsql/client') como la conexion se hacen de
// forma perezosa (dentro de ready(), no aqui arriba). Si algo falla al conectar
// (URL mal copiada, token invalido, etc.) queremos que sea un error normal que
// Express pueda capturar y convertir en una respuesta JSON, no un fallo que
// tumbe toda la funcion serverless antes de que nada pueda reaccionar.

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
  `CREATE TABLE IF NOT EXISTS meta (
    clave TEXT PRIMARY KEY,
    valor TEXT
  )`,
];

// Columnas añadidas despues de la primera version. SQLite no tiene
// "ADD COLUMN IF NOT EXISTS", asi que se intentan una a una y se ignora el
// error de "duplicate column" cuando ya existen.
const MIGRACIONES = [
  'ALTER TABLE jornadas ADD COLUMN draw_id TEXT',   // id del sorteo en loteriasapi.com
  'ALTER TABLE jornadas ADD COLUMN draw_date TEXT', // fecha del sorteo (YYYY-MM-DD)
  'ALTER TABLE partidos ADD COLUMN resultado TEXT', // signo real (1/X/2) o, en el pleno, goles "2-1"
  // Evita crear dos veces la misma jornada si dos peticiones sincronizan a la vez
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_jornadas_draw_id ON jornadas(draw_id)',
];

let client = null;
let readyPromise = null;

function describirConfiguracion() {
  const url = process.env.TURSO_DATABASE_URL || 'file:./data/quiniela.db';
  const tieneToken = !!process.env.TURSO_AUTH_TOKEN;
  // Nunca imprimimos el token, solo si existe y cuantos caracteres tiene (para detectar cortes al copiar).
  return `url=${url} | TURSO_AUTH_TOKEN presente=${tieneToken} (${
    process.env.TURSO_AUTH_TOKEN ? process.env.TURSO_AUTH_TOKEN.length : 0
  } caracteres)`;
}

// Se llama al principio de cada peticion (ver server/app.js). La primera vez
// crea el cliente, crea las tablas y siembra los usuarios; las siguientes es
// casi gratis porque readyPromise ya esta resuelta (se reutiliza mientras la
// funcion serverless siga "caliente").
function ready() {
  if (!readyPromise) {
    readyPromise = (async () => {
      try {
        const { createClient } = require('@libsql/client');
        client = createClient({
          url: process.env.TURSO_DATABASE_URL || 'file:./data/quiniela.db',
          authToken: process.env.TURSO_AUTH_TOKEN,
        });

        await client.batch(SCHEMA, 'write');
        for (const sql of MIGRACIONES) {
          try {
            await client.execute(sql);
          } catch (err) {
            if (!/duplicate column/i.test(err.message)) throw err;
          }
        }
        for (const u of USERS) {
          await client.execute({
            sql: 'INSERT OR IGNORE INTO users (username, display_name) VALUES (?, ?)',
            args: [u, u],
          });
        }
      } catch (err) {
        console.error('[db] Fallo al conectar/inicializar la base de datos.', describirConfiguracion());
        console.error(err);
        // Reseteamos para que el siguiente intento (proxima peticion) vuelva a probar
        // en vez de quedarse atascado con una promesa ya rechazada para siempre.
        readyPromise = null;
        client = null;
        const wrapped = new Error(`No se pudo conectar con la base de datos (Turso). Detalle: ${err.message}`);
        wrapped.cause = err;
        throw wrapped;
      }
    })();
  }
  return readyPromise;
}

function toPlainRow(row) {
  return row ? { ...row } : undefined;
}

async function run(sql, args = []) {
  await ready();
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
  await ready();
  const res = await client.execute({ sql, args });
  return toPlainRow(res.rows[0]);
}

async function all(sql, args = []) {
  await ready();
  const res = await client.execute({ sql, args });
  return res.rows.map(toPlainRow);
}

// Transaccion interactiva: fn recibe un objeto {run, get, all} que ejecuta
// dentro de la misma transaccion, y se hace commit/rollback automaticamente.
async function tx(fn) {
  await ready();
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
