# La Quiniela de los Colegas ⚽

App privada para el grupo: portada con acceso restringido, login compartido, chat, quiniela semanal (jornada), historial de pronósticos por usuario y una pestaña de estadísticas para el futuro.

## Qué incluye

- **Portada**: "Si no eres colegón o eres usero, no eres bienvenido" + botón de Login.
- **Login**: 7 usuarios fijos (Burgos, Paquero, Jordan, Pepe, Largo, Joaquin, Miguel), todos con la contraseña `MaximianoGuapo`.
- **Inicio**: chat en tiempo real (Socket.IO) entre todos los usuarios logueados.
- **Jornada**: carga los 15 partidos de la semana + el Pleno al 15 (cualquier usuario puede introducirlos/editarlos desde el botón "Editar partidos"), y cada usuario rellena su propia columna de pronósticos (1 / X / 2). Se ve quién ha completado ya su quiniela.
- **Historial**: una pestaña por usuario con todas sus jornadas pasadas y lo que pronosticó en cada una.
- **Estadísticas**: vacía por ahora ("Próximamente"), lista para lo que se quiera añadir más adelante.

## Stack técnico

- Backend: Node.js + Express + `node:sqlite` (el módulo de SQLite **incluido en Node.js**, no hace falta instalar ni compilar ninguna base de datos aparte).
- Tiempo real: Socket.IO para el chat.
- Frontend: HTML/CSS/JS "vanilla", sin frameworks ni build step.
- Todo en un único servidor: `npm start` y ya tienes la web + la API funcionando.

**Requisito importante:** Node.js **22.5 o superior** (usa `node:sqlite`, que es una función moderna de Node). Compruébalo con `node -v`. Si tu hosting solo ofrece Node 18/20, dímelo y adapto el proyecto para usar `better-sqlite3` en su lugar.

## 1. Probarlo en tu ordenador

```bash
# Descomprime el proyecto y entra en la carpeta
cd quiniela-colegas

# Copia el archivo de variables de entorno y ajusta lo que quieras (opcional para probar en local)
cp .env.example .env

# Instala dependencias
npm install

# Arranca el servidor
npm start
```

Abre `http://localhost:3000` en el navegador. La base de datos (`data/quiniela.db`) se crea sola la primera vez.

## 2. Subirlo a tu cuenta de GitHub

Desde la carpeta del proyecto:

```bash
git init
git add .
git commit -m "Primera version de la Quiniela de los Colegas"
```

Crea el repositorio vacío en GitHub (sustituye `TU-USUARIO` y el nombre que quieras):

- Opción A, desde la web: entra en https://github.com/new, ponle nombre (ej. `quiniela-colegas`), NO marques "Add a README", y pulsa "Create repository". GitHub te mostrará los comandos; básicamente son estos:

```bash
git branch -M main
git remote add origin https://github.com/TU-USUARIO/quiniela-colegas.git
git push -u origin main
```

- Opción B, con GitHub CLI (si lo tienes instalado y autenticado con `gh auth login`):

```bash
gh repo create quiniela-colegas --private --source=. --remote=origin --push
```

Con eso el proyecto ya está en tu GitHub (te recomiendo dejarlo como **repositorio privado**, ya que contiene el login de tus colegas).

## 3. Desplegarlo para que todos puedan entrar

Cualquier hosting de Node.js vale (Render, Railway, Fly.io, un VPS propio...). Pasos generales:

1. Conecta el repositorio de GitHub a la plataforma elegida.
2. Comando de arranque: `npm install && npm start`.
3. Configura las variables de entorno del `.env.example` en el panel de la plataforma (como mínimo `SESSION_SECRET`; puedes dejar `SHARED_PASSWORD` como está si no quieres cambiar la contraseña).
4. Asegúrate de que el disco donde vive `data/quiniela.db` sea persistente (en Render, por ejemplo, hay que añadir un "Persistent Disk"; si no, cada vez que se reinicie el servicio se perderían el chat y las quinielas guardadas).

## Notas sobre la carga automática de la jornada

No existe una API pública oficial fiable de La Quiniela para traer los partidos automáticamente sin riesgo de romperse. Por eso:

- Cualquier usuario puede escribir los partidos de la semana a mano desde la pestaña "Jornada" → "Editar partidos" (tarda menos de un minuto).
- Además, he programado una tarea que hago yo (Claude) todos los días a las 8:00 (hora de Madrid): busco en internet si hay una jornada nueva de La Quiniela y, si la encuentro, te la paso para que la cargues (o, si me pasas la URL de la app ya desplegada y el `ADMIN_UPDATE_TOKEN` de tu `.env`, puedo publicarla yo directamente contra el endpoint `POST /api/admin/jornada`, que está pensado exactamente para eso).

## Estructura del proyecto

```
quiniela-colegas/
├── package.json
├── .env.example
├── server/
│   ├── index.js          # arranque del servidor, sesiones, sockets
│   ├── db.js             # esquema de la base de datos (node:sqlite)
│   ├── auth.js           # usuarios fijos + contraseña compartida
│   └── routes/
│       ├── auth.js       # login / logout / usuario actual
│       ├── chat.js       # mensajes del chat
│       ├── jornada.js    # partidos de la semana + pronosticos
│       ├── historial.js  # pronosticos pasados por usuario
│       └── admin.js      # actualizacion automatizada de la jornada (token secreto)
├── public/
│   ├── index.html        # portada + login + app (SPA sencilla)
│   ├── css/style.css
│   └── js/app.js
└── data/                 # aqui vive quiniela.db (no se sube a git)
```
