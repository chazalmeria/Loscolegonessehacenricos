# La Quiniela de los Colegas ⚽

App privada para el grupo: portada con acceso restringido, login compartido, chat, quiniela semanal (jornada), historial de pronósticos por usuario y una pestaña de estadísticas para el futuro.

**Preparada para desplegarse en Vercel.**

## Qué incluye

- **Portada**: "Si no eres colegón o eres usero, no eres bienvenido" + botón de Login.
- **Login**: 7 usuarios fijos (Burgos, Paquero, Jordan, Pepe, Largo, Joaquin, Miguel), todos con la contraseña `MaximianoGuapo`.
- **Estadísticas**: % de acierto por competición (Primera, Segunda, Femenino, Selecciones, Europa, Copa, Otras ligas), del grupo o de cada uno, y una tabla competición × usuario con el mejor de cada una. Sobre las jornadas del Historial y solo los 14 partidos. La competición de cada partido la calcula `server/competiciones.js` con los nombres y el código de división de Eduardo Losilla; las jornadas antiguas se completan solas, unas pocas en cada sincronización.
- **Inicio**: "El Vestuario", el chat entre todos los usuarios logueados (se actualiza solo cada 4 segundos), con avatares de colores, separadores por día y emojis rápidos. En el lateral derecho, **Encuestas**: cualquiera crea una (pregunta + 2 a 6 opciones), cada uno vota una opción y puede cambiarla o quitarla (pulsando otra vez), y se ve quién ha votado qué. Solo quien la crea puede cerrarla (ya no admite votos) o borrarla. Al crear una sale un aviso en el chat.
- **Jornada**: la jornada de La Quiniela llega sola desde la API pública de Eduardo Losilla (15 partidos + Pleno al 15) y cada usuario rellena su propia columna de pronósticos (1 / X / 2). Se ve quién ha completado ya su quiniela. Si la API falla, el botón "Crear jornada manualmente" crea otra jornada que aparece encima de la de la API, con su título y la etiqueta "(a mano)", y que se pasa al Historial con "Añadir al histórico".
- **Rankings**: dos pestañas sobre las jornadas del Historial. "Aciertos": resultados acertados en total (incluido cada Pleno al 15) y % de acierto. "Dineros": premios acumulados por columna; mientras nadie haya ganado nada sale "Sois unos paquetes".
- **Economía**: lo que lleva cada uno (+/-) en el bote común y el total. Se cambia a mano con "Modificar saldos" (cualquier usuario); se guarda quién y cuándo lo cambió por última vez.
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

### Opción A — Desde el navegador, sin instalar nada (recomendada, sobre todo en Windows)

1. Entra en https://app.turso.tech/signup y crea una cuenta (puedes usar tu GitHub).
2. Crea una base de datos nueva (botón "Create Database"), llámala por ejemplo `quiniela-colegas`.
3. Dentro de la base de datos, busca su **URL de conexión** (empieza por `libsql://...`) — apúntala.
4. Busca la opción de **crear un token / access token** para esa base de datos y genera uno — apúntalo también (normalmente solo se muestra una vez).

### Opción B — Por terminal, con el CLI (Mac/Linux; en Windows hazlo desde WSL)

```bash
curl -sSfL https://get.tur.so/install.sh | bash
turso auth login
turso db create quiniela-colegas
turso db show quiniela-colegas --url        # esto es TURSO_DATABASE_URL
turso db tokens create quiniela-colegas     # esto es TURSO_AUTH_TOKEN
```

Con cualquiera de las dos opciones, te quedas con dos valores: la URL (`TURSO_DATABASE_URL`) y el token (`TURSO_AUTH_TOKEN`).

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
   | `CRON_SECRET` | otra cadena larga y aleatoria (Vercel la usa para llamar al cron diario) |

4. Pulsa "Deploy". En un minuto tendrás una URL tipo `https://quiniela-colegas.vercel.app` — compártela con Burgos, Paquero, Jordan, Pepe, Largo, Joaquin y Miguel.
5. Cada vez que hagas `git push` a `main`, Vercel vuelve a desplegar solo.

## Jornadas y resultados automáticos (Eduardo Losilla)

La app lee La Quiniela de la API pública de [Eduardo Losilla](https://www.eduardolosilla.es) (`api.eduardolosilla.es`, la misma que usa su web). No necesita clave ni tiene cupo de peticiones.

- **Jornada nueva**: en cuanto se abre la jornada siguiente (antes de jugarse, para poder rellenar los pronósticos), se crea sola como jornada activa. La anterior no desaparece: se queda en la pestaña Jornada, encima de la nueva, marcada "En juego", con los pronósticos congelados, la tabla de lo que puso cada uno y los premios. Pasa sola al Historial cuando tiene todos los resultados y los premios (o con "Añadir al histórico" si se queda atascada). Las jornadas creadas a mano no se tocan nunca.
- **Resultados**: se guarda el signo real de cada partido (1/X/2) y el marcador del Pleno al 15. En la tabla "Resultados de todos" (Jornada e Historial) cada casilla sale en verde si es acierto y en rojo si es fallo, con el recuento de aciertos de cada uno abajo. El Pleno al 15 de cada uno es solo informativo: se ve lo que puso cada uno (en verde o rojo, comparando 0, 1, 2 o M por equipo como en la quiniela oficial), pero no suma en los aciertos ni en los rankings.
- **Cuándo se consulta**: un cron de Vercel llama a `/api/admin/sync` una vez al día (ver `vercel.json`), y además la app sincroniza al abrir Jornada o Historial, como mucho una vez cada 30 minutos. Revisa las 3 últimas jornadas.
- Para forzar una sincronización a mano: `curl -H "x-admin-token: TU_ADMIN_UPDATE_TOKEN" https://tu-app.vercel.app/api/admin/sync`.
- **Resultados a mano**: si la API va con retraso, en cada jornada (abierta o ya en el Historial) el botón "Poner resultados" (en "Resultados de todos") permite poner el signo de cada partido y los goles del Pleno (un número o M) mirando la web oficial. Salen con un * y la API ya no los cambia; si se borran, la API los vuelve a rellenar cuando los tenga.
- **Pleno al 15 definitivo**: debajo del Pleno al 15 de cada uno hay una fila con el Pleno común que juega el grupo. Es una sola casilla, se pone o cambia a mano con su botón "Poner"/"Cambiar" (o dentro de "Poner resultados"), se colorea según el resultado real del Pleno y no suma en los aciertos individuales.
- **Premios**: cuando SELAE publica el escrutinio, la sincronización guarda los premios de cada categoría (Pleno al 15, 14, 13, 12, 11 y 10 aciertos) en "Premios de la jornada". Solo se revisan las 3 últimas jornadas, así que las más antiguas (p. ej. las importadas del Excel) hay que rellenarlas a mano con "Poner premios"; la API no pisa lo puesto a mano. En "Resultados de todos", la fila "Premio" muestra la categoría y el premio de cada columna y el total del bote. Como en un boleto real, el Pleno al 15 es común: la categoría Pleno al 15 (14 + Pleno) se decide con el Pleno definitivo.
- Si la API no funciona o aún no tiene la jornada: "Jornada" → "Crear jornada manualmente". Esas jornadas no reciben resultados de la API y pasan al Historial solo cuando alguien pulsa "Añadir al histórico".

## Estructura del proyecto

```
quiniela-colegas/
├── package.json
├── vercel.json           # redirige /api/* a la funcion serverless + cron diario
├── .env.example
├── api/
│   └── index.js          # punto de entrada de Vercel (expone server/app.js)
├── server/
│   ├── app.js             # la app de Express (rutas, middlewares) sin arrancar servidor
│   ├── index.js           # arranque local ("npm start"); no se usa en Vercel
│   ├── db.js              # acceso a datos (Turso / SQLite via @libsql/client)
│   ├── auth.js             # usuarios fijos + contraseña compartida + cookie firmada
│   ├── losilla.js          # cliente de la API pública de Eduardo Losilla (La Quiniela)
│   ├── competiciones.js    # clasifica cada partido en su competición (Estadísticas)
│   ├── sync.js             # crea jornadas nuevas y rellena resultados y premios desde la API
│   ├── premios.js          # premios por categoria (API o a mano)
│   └── routes/
│       ├── auth.js         # login / logout / usuario actual
│       ├── chat.js         # mensajes del chat (sondeo periodico)
│       ├── encuestas.js    # encuestas del lateral del chat
│       ├── jornada.js      # partidos de la semana + pronosticos
│       ├── historial.js    # pronosticos pasados por usuario
│       ├── economia.js     # saldo de cada uno en el bote comun (a mano)
│       └── admin.js        # sincronizacion con la API (token secreto / cron de Vercel)
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
