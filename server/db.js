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
  // Saldo (+/-) de cada usuario en el bote comun, en centimos. Se modifica a mano
  // desde la pestaña Economia.
  `CREATE TABLE IF NOT EXISTS economia (
    username TEXT PRIMARY KEY,
    saldo_centimos INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT,
    updated_by TEXT
  )`,
  // Premios de cada jornada por categoria: aciertos = 15 (Pleno al 15: 14 + Pleno),
  // 14, 13, 12, 11 o 10. Vienen de la API (Eduardo Losilla) o se ponen a mano (manual = 1,
  // y entonces la API no los pisa).
  `CREATE TABLE IF NOT EXISTS premios (
    jornada_id INTEGER NOT NULL REFERENCES jornadas(id) ON DELETE CASCADE,
    aciertos INTEGER NOT NULL,
    acertantes INTEGER,
    premio_centimos INTEGER,
    manual INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (jornada_id, aciertos)
  )`,
  // Premio fijado a mano para un usuario en una jornada (manda sobre el
  // calculado por categorias). Se uso para dejar a 0 las jornadas del Excel.
  `CREATE TABLE IF NOT EXISTS premios_usuario (
    jornada_id INTEGER NOT NULL REFERENCES jornadas(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    premio_centimos INTEGER NOT NULL,
    PRIMARY KEY (jornada_id, username)
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
  'ALTER TABLE jornadas ADD COLUMN draw_id TEXT',   // id de la jornada en la API ("losilla-2027-11"; las antiguas, de loteriasapi.com)
  'ALTER TABLE jornadas ADD COLUMN draw_date TEXT', // fecha del sorteo (YYYY-MM-DD)
  'ALTER TABLE partidos ADD COLUMN resultado TEXT', // signo real (1/X/2) o, en el pleno, goles "2-1"
  // 1 = creada a mano desde la pestaña Jornada (convive con la de la API y se
  // pasa al Historial con el boton "Añadir al historico"). En ese caso "numero"
  // guarda el titulo que le puso quien la creo.
  'ALTER TABLE jornadas ADD COLUMN manual INTEGER NOT NULL DEFAULT 0',
  // 1 = el resultado lo puso alguien a mano (boton "Poner resultados"); la
  // sincronizacion con la API ya no lo toca.
  'ALTER TABLE partidos ADD COLUMN resultado_manual INTEGER NOT NULL DEFAULT 0',
  // Pleno al 15 comun que juega el grupo ("2-1", "M-0"...). Solo se pone a mano
  // desde "Resultados de todos".
  'ALTER TABLE jornadas ADD COLUMN pleno_definitivo TEXT',
  // 1 = jornada de la API que se esta jugando: ya salio la siguiente, asi que
  // sus pronosticos estan congelados, pero sigue en la pestaña Jornada (encima
  // de la nueva) hasta tener todos los resultados y los premios.
  'ALTER TABLE jornadas ADD COLUMN en_juego INTEGER NOT NULL DEFAULT 0',
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
