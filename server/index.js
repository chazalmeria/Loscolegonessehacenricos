require('dotenv').config();
const path = require('path');
const http = require('http');
const express = require('express');
const session = require('express-session');
const { Server } = require('socket.io');

const authRoutes = require('./routes/auth');
const { buildChatRouter } = require('./routes/chat');
const { router: jornadaRoutes } = require('./routes/jornada');
const historialRoutes = require('./routes/historial');
const adminRoutes = require('./routes/admin');

const PORT = process.env.PORT || 3000;

const app = express();
app.set('trust proxy', 1); // necesario si se despliega detras de un proxy (Render, Railway, etc.)
const server = http.createServer(app);
const io = new Server(server);

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'cambia-esto',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 30 }, // 30 dias
});

app.use(express.json());
app.use(sessionMiddleware);
app.use(express.static(path.join(__dirname, '..', 'public')));

// Compartir la sesion con los sockets, para saber quien escribe en el chat
io.engine.use(sessionMiddleware);

app.use('/api/auth', authRoutes);
app.use('/api/chat', buildChatRouter(io));
app.use('/api/jornada', jornadaRoutes);
app.use('/api/historial', historialRoutes);
app.use('/api/admin', adminRoutes);

// Cualquier ruta desconocida de la app (no /api) devuelve el index para que el front la maneje
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

io.on('connection', (socket) => {
  const sess = socket.request.session;
  if (!sess || !sess.username) {
    socket.disconnect(true);
    return;
  }
});

server.listen(PORT, () => {
  console.log(`Quiniela de colegas escuchando en http://localhost:${PORT}`);
});
