const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

router.get('/messages', requireAuth, async (req, res, next) => {
  try {
    const since = Number(req.query.since);
    let messages;
    if (Number.isFinite(since) && since > 0) {
      // Solo los mensajes nuevos desde el ultimo que ya tiene el cliente (para el sondeo periodico)
      messages = await db.all(
        'SELECT id, username, text, created_at FROM messages WHERE id > ? ORDER BY id ASC LIMIT 200',
        [since]
      );
    } else {
      const recientes = await db.all(
        'SELECT id, username, text, created_at FROM messages ORDER BY id DESC LIMIT 200'
      );
      messages = recientes.reverse();
    }
    res.json({ messages });
  } catch (err) {
    next(err);
  }
});

router.post('/messages', requireAuth, async (req, res, next) => {
  try {
    const text = ((req.body && req.body.text) || '').toString().trim().slice(0, 1000);
    if (!text) return res.status(400).json({ error: 'Mensaje vacio' });

    const info = await db.run('INSERT INTO messages (username, text) VALUES (?, ?)', [
      req.username,
      text,
    ]);
    const message = await db.get('SELECT id, username, text, created_at FROM messages WHERE id = ?', [
      info.lastInsertRowid,
    ]);
    res.json({ message });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
