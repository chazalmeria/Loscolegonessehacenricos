// Punto de entrada SOLO para desarrollo/uso local ("npm start").
// En Vercel no se usa este archivo: la plataforma invoca directamente
// server/app.js a traves de api/index.js.
const app = require('./app');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Quiniela de colegas escuchando en http://localhost:${PORT}`);
});
