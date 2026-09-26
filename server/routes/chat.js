const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');

function buildChatRouter(io) {
  const router = express.Router();

  router.get('/messages', requireAuth, (req, res) => {
    const rows = db
      .prepare('SELECT id, username, text, created_at FROM messages ORDER BY id DESC LIMIT 200')
      .all()
      .reverse();
    res.json({ messages: rows });
  });

  router.post('/messages', requireAuth, (req, res) => {
    const text = ((req.body && req.body.text) || '').toString().trim().slice(0, 1000);
    if (!text) return res.status(400).json({ error: 'Mensaje vacio' });

    const info = db
      .prepare('INSERT INTO messages (username, text) VALUES (?, ?)')
      .run(req.session.username, text);

    const message = db
      .prepare('SELECT id, username, text, created_at FROM messages WHERE id = ?')
      .get(info.lastInsertRowid);

    if (io) io.emit('chat:new-message', message);
    res.json({ message });
  });

  return router;
}

module.exports = { buildChatRouter };
