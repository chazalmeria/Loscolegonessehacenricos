const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

// Usamos el modulo nativo "node:sqlite" (incluido en Node.js desde la version 22.5),
// asi no hace falta compilar ningun paquete nativo para tener base de datos.
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'quiniela.db'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  display_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS jornadas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  numero TEXT NOT NULL,
  temporada TEXT,
  activa INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS partidos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jornada_id INTEGER NOT NULL REFERENCES jornadas(id) ON DELETE CASCADE,
  orden INTEGER NOT NULL,
  equipo_local TEXT NOT NULL,
  equipo_visitante TEXT NOT NULL,
  es_pleno INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS predicciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partido_id INTEGER NOT NULL REFERENCES partidos(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  pronostico TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(partido_id, username)
);
`);

const USERS = ['Burgos', 'Paquero', 'Jordan', 'Pepe', 'Largo', 'Joaquin', 'Miguel'];
const insertUser = db.prepare('INSERT OR IGNORE INTO users (username, display_name) VALUES (?, ?)');
for (const u of USERS) insertUser.run(u, u);

// Pequeño helper de transacciones (node:sqlite no trae el azucar .transaction() de better-sqlite3)
function runInTransaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  }
}

module.exports = db;
module.exports.USERS = USERS;
module.exports.runInTransaction = runInTransaction;
