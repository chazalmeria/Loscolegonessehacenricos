# La Quiniela de los Colegas ⚽

App privada para el grupo: portada con acceso restringido, login compartido, chat, quiniela semanal (jornada), historial de pronósticos por usuario y una pestaña de estadísticas para el futuro.

**Preparada para desplegarse en Vercel.**

## Qué incluye

- **Portada**: "Si no eres colegón o eres usero, no eres bienvenido" + botón de Login.
- **Login**: 7 usuarios fijos (Burgos, Paquero, Jordan, Pepe, Largo, Joaquin, Miguel), todos con la contraseña `MaximianoGuapo`.
- **Inicio**: chat entre todos los usuarios logueados (se actualiza solo cada 4 segundos).
- **Jornada**: carga los 15 partidos de la semana + el Pleno al 15 (cualquier usuario puede introducirlos/editarlos desde el botón "Editar partidos"), y cada usuario rellena su propia columna de pronósticos (1 / X / 2). Se ve quién ha completado ya su quiniela.
- **Historial**: una pestaña por usuario con todas sus jornadas pasadas y lo que pronosticó en cada una.
- **Estadísticas**: vacía por ahora ("Próximamente"), lista para lo que se quiera añadir más adelante.

## Stack técnico

- Backend: Node.js + Express, empaquetado como función serverless para Vercel (`api/index.js`).
- Base de datos: **Turso** (SQLite alojado en la nube), a través de `@libsql/client`. En local, si no configuras Turso, usa automáticamente un archivo SQLite (`data/quiniela.db`) — no hace falta cuenta de Turso solo para probarlo en tu ordenador.
- Sesión de usuario: cookie firmada (sin estado en el servidor), pensada para entornos serverless.
- Chat: sondeo periódico por HTTP (sin WebSockets, ya que Vercel no sostiene conexiones persistentes de forma fiable en funciones serverless).
- Frontend: HTML/CSS/JS "vanilla", sin frameworks ni build step.

> Nota: la primera versión de este proyecto usaba Socket.IO (chat instantáneo) y una base SQLite en disco con sesiones en memoria, pensada para un servidor tradicional (Render/Railway/VPS). Para que funcione en Vercel tuve que cambiar esas tres piezas por alternativas compatibles con serverless (ver la nota técnica al final). Si en algún momento prefieres volver a un hosting "de toda la vida" en vez de Vercel, dímelo y te devuelvo esa versión con chat instantáneo.

## 1. Probarlo en tu ordenador

```bash
# Descomprime el proyecto y entra en la carpeta
cd quiniela-colegas

# Copia el archivo de variables de entorno (puedes dejarlo tal cual para probar en local)
cp .env.example .env

# Instala dependencias
npm install

# Arranca el servidor
npm start
```

Abre `http://localhost:3000`. Como no has puesto `TURSO_DATABASE_URL`, se crea solo un archivo `data/quiniela.db` en tu ordenador.

## 2. Subirlo a tu cuenta de GitHub

El proyecto ya trae un repositorio Git inicializado (con `.git` incluido), así que no hace falta `git init` ni `git commit`. Solo conectarlo con GitHub:

```bash
git branch -M main
git remote add origin https://github.com/TU-USUARIO/quiniela-colegas.git
git push -u origin main
```

Si no tienes aún el repositorio vacío creado en GitHub: entra en https://github.com/new, ponle nombre (ej. `quiniela-colegas`), NO marques "Add a README" y pulsa "Create repository" — te enseñará estos mismos comandos con tu usuario. Te recomiendo dejarlo **privado**, ya que contiene el login de tus colegas.

## 3. Crear la base de datos en Turso (necesaria para Vercel)

Vercel no tiene disco persistente, así que la base de datos tiene que vivir fuera, en Turso (tiene plan gratuito de sobra para esto).

```bash
# Instalar el CLI de turso (Mac/Linux; en Windows hazlo desde WSL)
curl -sSfL https://get.tur.so/install.sh | bash

# Iniciar sesión (abre el navegador)
turso auth login

# Crear la base de datos
turso db create quiniela-colegas

# Obtener la URL de conexión (empieza por libsql://...) — apunta este valor
turso db show quiniela-colegas --url

# Crear un token de acceso — apunta este valor tambien (solo se muestra una vez)
turso db tokens create quiniela-colegas
```

Guarda esos dos valores: la URL es `TURSO_DATABASE_URL` y el token es `TURSO_AUTH_TOKEN`.

## 4. Desplegar en Vercel

1. Entra en https://vercel.com, inicia sesión (puedes hacerlo con tu cuenta de GitHub) y pulsa "Add New... -> Project".
2. Elige el repositorio `quiniela-colegas` que acabas de subir. Vercel detectará que es un proyecto Node normal; no hace falta tocar el "Build command" ni el "Output directory".
3. Antes de darle a "Deploy", abre la sección **Environment Variables** y añade:

   | Nombre | Valor |
   |---|---|
   | `TURSO_DATABASE_URL` | la URL que obtuviste con `turso db show` |
   | `TURSO_AUTH_TOKEN` | el token que obtuviste con `turso db tokens create` |
   | `SHARED_PASSWORD` | `MaximianoGuapo` (o la que prefieras) |
   | `COOKIE_SECRET` | cualquier cadena larga y aleatoria (invéntatela) |
   | `ADMIN_UPDATE_TOKEN` | otra cadena larga y aleatoria (para la actualización automática de la jornada) |

4. Pulsa "Deploy". En un minuto tendrás una URL tipo `https://quiniela-colegas.vercel.app` — compártela con Burgos, Paquero, Jordan, Pepe, Largo, Joaquin y Miguel.
5. Cada vez que hagas `git push` a `main`, Vercel vuelve a desplegar solo.

## Notas sobre la carga automática de la jornada

No existe una API pública oficial fiable de La Quiniela para traer los partidos automáticamente sin riesgo de romperse. Por eso:

- Cualquier usuario puede escribir los partidos de la semana a mano desde la pestaña "Jornada" → "Editar partidos" (tarda menos de un minuto).
- Además, hay una tarea programada que hago yo (Claude) todos los días a las 8:00 (hora de Madrid): busco en internet si hay una jornada nueva de La Quiniela. Cuando me pases la URL de tu app ya desplegada en Vercel y el `ADMIN_UPDATE_TOKEN` que hayas puesto, empezaré a publicarla yo directamente contra `POST https://tu-app.vercel.app/api/admin/jornada` (con la cabecera `x-admin-token`), que es justo lo que ese endpoint espera. Hasta entonces, solo te aviso con lo que encuentro.

## Estructura del proyecto

```
quiniela-colegas/
├── package.json
├── vercel.json           # redirige /api/* a la funcion serverless
├── .env.example
├── api/
│   └── index.js          # punto de entrada de Vercel (expone server/app.js)
├── server/
│   ├── app.js             # la app de Express (rutas, middlewares) sin arrancar servidor
│   ├── index.js           # arranque local ("npm start"); no se usa en Vercel
│   ├── db.js              # acceso a datos (Turso / SQLite via @libsql/client)
│   ├── auth.js             # usuarios fijos + contraseña compartida + cookie firmada
│   └── routes/
│       ├── auth.js         # login / logout / usuario actual
│       ├── chat.js         # mensajes del chat (sondeo periodico)
│       ├── jornada.js      # partidos de la semana + pronosticos
│       ├── historial.js    # pronosticos pasados por usuario
│       └── admin.js        # actualizacion automatizada de la jornada (token secreto)
├── public/
│   ├── index.html          # portada + login + app (SPA sencilla), servido por Vercel como estatico
│   ├── css/style.css
│   └── js/app.js
└── data/                    # solo se usa en local, si no configuras Turso (no se sube a git)
```

## Nota técnica: qué cambió para que funcione en Vercel

Si alguna vez quieres volver a un servidor tradicional (Render, Railway, un VPS...), estas son las tres piezas que se sustituyeron y por qué:

1. **Base de datos**: de un archivo SQLite en disco (`node:sqlite`) a Turso, porque el sistema de archivos de las funciones de Vercel es efímero: cualquier dato escrito en disco desaparece entre peticiones.
2. **Sesión de usuario**: de `express-session` (guardada en memoria del proceso) a una cookie firmada con HMAC sin estado en el servidor, porque cada petición puede caer en una instancia distinta de la función y perdería la sesión guardada en memoria.
3. **Chat en tiempo real**: de Socket.IO (conexión persistente) a sondeo por HTTP cada 4 segundos, porque las funciones serverless de Vercel no mantienen conexiones abiertas de forma fiable. El chat sigue funcionando entre todos, solo que con un pequeño retraso en vez de ser instantáneo.
