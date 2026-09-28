require('dotenv').config();
const path = require('path');
const express = require('express');

const db = require('./db');
const { attachUser } = require('./auth');
const authRoutes = require('./routes/auth');
const chatRoutes = require('./routes/chat');
const { router: jornadaRoutes } = require('./routes/jornada');
const historialRoutes = require('./routes/historial');
const economiaRoutes = require('./routes/economia');
const adminRoutes = require('./routes/admin');

const app = express();
app.set('trust proxy', 1); // necesario detras de un proxy (Vercel, Render, etc.)

app.use(express.json());
app.use(attachUser);

// Se asegura de que las tablas existan (y los 7 usuarios esten sembrados)
// antes de atender cualquier peticion. Es casi gratis salvo la primera vez.
app.use((req, res, next) => {
  db.ready().then(() => next()).catch(next);
});

// Sirve el frontend estatico cuando se ejecuta con "npm start" (en Vercel
// estos archivos los sirve la plataforma directamente desde /public, sin
// pasar por esta funcion).
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/jornada', jornadaRoutes);
app.use('/api/historial', historialRoutes);
app.use('/api/economia', economiaRoutes);
app.use('/api/admin', adminRoutes);

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Manejo de errores centralizado.
// Incluimos el mensaje del error en la respuesta (no solo en los logs de Vercel):
// esto es una app privada para un grupo de colegas, así que preferimos poder
// diagnosticar abriendo la URL en el navegador antes que ocultar el detalle.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({
    error: 'Error interno del servidor',
    detalle: err && err.message,
  });
});

module.exports = app;
