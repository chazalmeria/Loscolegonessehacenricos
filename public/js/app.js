(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const screens = {
    portada: $('#screen-portada'),
    login: $('#screen-login'),
    home: $('#screen-home'),
  };

  let currentUser = null;
  let chatPollHandle = null;
  let ultimoMensajeId = 0;

  function showScreen(name) {
    Object.values(screens).forEach((s) => (s.hidden = true));
    screens[name].hidden = false;
  }

  async function api(path, options = {}) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Error de red');
    return data;
  }

  // ---------- ARRANQUE ----------
  async function init() {
    try {
      const { users } = await api('/api/auth/users');
      const select = $('#login-username');
      users.forEach((u) => {
        const opt = document.createElement('option');
        opt.value = u;
        opt.textContent = u;
        select.appendChild(opt);
      });
    } catch (e) { /* ignore */ }

    try {
      const me = await api('/api/auth/me');
      currentUser = me.username;
      entrarEnApp();
    } catch (e) {
      showScreen('portada');
    }
  }

  // ---------- NAVEGACION PORTADA/LOGIN ----------
  $('#btn-ir-login').addEventListener('click', () => showScreen('login'));
  $('#btn-volver-portada').addEventListener('click', () => showScreen('portada'));

  $('#form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = $('#login-username').value;
    const password = $('#login-password').value;
    const errorEl = $('#login-error');
    errorEl.hidden = true;
    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      currentUser = data.username;
      entrarEnApp();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  });

  $('#btn-logout').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    currentUser = null;
    detenerSondeoChat();
    $('#login-password').value = '';
    showScreen('portada');
  });

  // ---------- ENTRAR EN LA APP ----------
  function entrarEnApp() {
    $('#usuario-actual').textContent = currentUser;
    showScreen('home');
    reiniciarChat();
    cargarChat();
    iniciarSondeoChat();
    cargarEncuestas();
    cargarJornada();
    cargarHistorial();
    cargarEconomia();
  }

  // ---------- MENU LATERAL ----------
  $$('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.nav-item').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      $$('.tab-panel').forEach((p) => p.classList.remove('active'));
      $(`#tab-${btn.dataset.tab}`).classList.add('active');
      // Economia se recarga al abrirla (otro puede haber cambiado los saldos), salvo si se esta editando
      if (btn.dataset.tab === 'economia' && !editandoEconomia) cargarEconomia();
      if (btn.dataset.tab === 'rankings') cargarRankings();
    });
  });

  // ---------- CHAT (sondeo periodico, sin websockets: compatible con Vercel) ----------
  // Cada usuario tiene su color de avatar (fijo, sacado de su nombre)
  const COLORES_AVATAR = ['#2fbf71', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#ec4899', '#64748b'];
  function colorDe(nombre) {
    let h = 0;
    for (const c of String(nombre)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return COLORES_AVATAR[h % COLORES_AVATAR.length];
  }
  function htmlAvatar(nombre, clase = 'avatar') {
    return `<span class="${clase}" style="background:${colorDe(nombre)}" title="${escapeHtml(nombre)}">${escapeHtml(String(nombre).charAt(0).toUpperCase())}</span>`;
  }

  // Estado para agrupar mensajes seguidos del mismo autor y separar por dias
  let chatUltimoAutor = null;
  let chatUltimoDia = null;
  let chatUltimaFecha = 0;

  function fechaMensaje(msg) {
    return new Date(msg.created_at.replace(' ', 'T') + 'Z');
  }

  function etiquetaDia(fecha) {
    const hoy = new Date();
    const ayer = new Date();
    ayer.setDate(hoy.getDate() - 1);
    if (fecha.toDateString() === hoy.toDateString()) return 'Hoy';
    if (fecha.toDateString() === ayer.toDateString()) return 'Ayer';
    return fecha.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  function reiniciarChat() {
    ultimoMensajeId = 0;
    chatUltimoAutor = null;
    chatUltimoDia = null;
    chatUltimaFecha = 0;
    $('#chat-messages').innerHTML = '';
  }

  function pintarMensaje(msg) {
    const cont = $('#chat-messages');
    const pegadoAbajo = cont.scrollHeight - cont.scrollTop - cont.clientHeight < 80;
    const fecha = fechaMensaje(msg);
    const dia = fecha.toDateString();
    if (dia !== chatUltimoDia) {
      const sep = document.createElement('div');
      sep.className = 'chat-dia';
      sep.innerHTML = `<span>${escapeHtml(etiquetaDia(fecha))}</span>`;
      cont.appendChild(sep);
      chatUltimoDia = dia;
      chatUltimoAutor = null;
    }

    // Mismo autor en menos de 5 minutos: va pegado al anterior, sin nombre ni avatar
    const seguido = msg.username === chatUltimoAutor && fecha - chatUltimaFecha < 5 * 60 * 1000;
    const mio = msg.username === currentUser;
    const esEncuesta = msg.text.startsWith('📊 Nueva encuesta:');
    const hora = fecha.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

    const fila = document.createElement('div');
    fila.className = `chat-fila${mio ? ' mio' : ''}${seguido ? ' seguido' : ''}`;
    fila.innerHTML = `
      ${mio ? '' : seguido ? '<span class="avatar avatar-hueco"></span>' : htmlAvatar(msg.username)}
      <div class="chat-msg${esEncuesta ? ' chat-msg-encuesta' : ''}">
        ${seguido || mio ? '' : `<span class="autor" style="color:${colorDe(msg.username)}">${escapeHtml(msg.username)}</span>`}
        <span class="texto">${escapeHtml(msg.text)}</span>
        <span class="hora">${hora}</span>
      </div>
    `;
    cont.appendChild(fila);
    chatUltimoAutor = msg.username;
    chatUltimaFecha = fecha.getTime();
    if (pegadoAbajo || mio) cont.scrollTop = cont.scrollHeight;
    if (msg.id > ultimoMensajeId) ultimoMensajeId = msg.id;
  }

  async function cargarChat() {
    try {
      const { messages } = await api(`/api/chat/messages?since=${ultimoMensajeId}`);
      const cont = $('#chat-messages');
      const primeraCarga = ultimoMensajeId === 0;
      messages.forEach(pintarMensaje);
      if (primeraCarga) cont.scrollTop = cont.scrollHeight;
      if (primeraCarga && !messages.length) {
        cont.innerHTML = '<div class="chat-vacio">Nadie ha dicho nada todavía. ¡Rompe el hielo! ⚽</div>';
      } else if (messages.length) {
        const vacio = cont.querySelector('.chat-vacio');
        if (vacio) vacio.remove();
      }
    } catch (e) { /* ignore */ }
  }

  let ticksChat = 0;
  function iniciarSondeoChat() {
    detenerSondeoChat();
    ticksChat = 0;
    chatPollHandle = setInterval(() => {
      cargarChat();
      // Las encuestas se refrescan cada 3 vueltas (12 s), salvo si estas creando una
      if (++ticksChat % 3 === 0 && $('#form-encuesta').hidden) cargarEncuestas();
    }, 4000);
  }

  // Emojis rapidos: se insertan donde este el cursor
  $('.chat-emojis').addEventListener('click', (e) => {
    const boton = e.target.closest('[data-emoji]');
    if (!boton) return;
    const input = $('#chat-input');
    const ini = input.selectionStart ?? input.value.length;
    const fin = input.selectionEnd ?? input.value.length;
    input.value = input.value.slice(0, ini) + boton.dataset.emoji + input.value.slice(fin);
    input.focus();
    const pos = ini + boton.dataset.emoji.length;
    input.setSelectionRange(pos, pos);
  });

  // ---------- ENCUESTAS (lateral derecho de Inicio) ----------
  const MAX_OPCIONES_ENCUESTA = 6;
  let encuestas = [];

  async function cargarEncuestas() {
    try {
      ({ encuestas } = await api('/api/encuestas'));
      pintarEncuestas();
    } catch (e) { /* ignore */ }
  }

  function pintarEncuestas() {
    const lista = $('#encuestas-lista');
    if (!encuestas.length) {
      lista.innerHTML = '<p class="encuestas-vacio">Aún no hay encuestas. Crea la primera con "+ Nueva".</p>';
      return;
    }
    lista.innerHTML = encuestas.map(htmlEncuesta).join('');
  }

  function htmlEncuesta(e) {
    const total = e.total_votos;
    const max = Math.max(0, ...e.opciones.map((o) => o.votantes.length));
    const opciones = e.opciones.map((o) => {
      const n = o.votantes.length;
      const pct = total ? Math.round((n / total) * 100) : 0;
      const clases = ['encuesta-opcion'];
      if (e.mi_voto === o.id) clases.push('votada');
      if (e.cerrada && n > 0 && n === max) clases.push('ganadora');
      return `
        <button type="button" class="${clases.join(' ')}" data-accion="votar" data-opcion="${o.id}" ${e.cerrada ? 'disabled' : ''}>
          <span class="encuesta-barra" style="width:${pct}%"></span>
          <span class="encuesta-opcion-texto">${e.mi_voto === o.id ? '✓ ' : ''}${escapeHtml(o.texto)}</span>
          <span class="encuesta-opcion-pct">${pct}%</span>
          ${n ? `<span class="encuesta-votantes">${o.votantes.map((v) => htmlAvatar(v, 'avatar avatar-mini')).join('')}</span>` : ''}
        </button>
      `;
    }).join('');

    const acciones = e.autor === currentUser
      ? `<div class="encuesta-acciones">
           <button type="button" class="btn-link" data-accion="cerrar">${e.cerrada ? 'Reabrir' : 'Cerrar'}</button>
           <button type="button" class="btn-link peligro" data-accion="borrar">Borrar</button>
         </div>`
      : '';

    return `
      <article class="encuesta${e.cerrada ? ' cerrada' : ''}" data-encuesta-id="${e.id}">
        <p class="encuesta-pregunta">${escapeHtml(e.pregunta)}</p>
        <p class="encuesta-meta">${htmlAvatar(e.autor, 'avatar avatar-mini')} ${escapeHtml(e.autor)} · ${total} voto${total === 1 ? '' : 's'}${e.cerrada ? ' · <strong>Cerrada</strong>' : ''}</p>
        <div class="encuesta-opciones">${opciones}</div>
        ${acciones}
      </article>
    `;
  }

  $('#encuestas-lista').addEventListener('click', async (ev) => {
    const boton = ev.target.closest('[data-accion]');
    if (!boton) return;
    const id = Number(boton.closest('[data-encuesta-id]').dataset.encuestaId);
    const accion = boton.dataset.accion;
    try {
      if (accion === 'votar') {
        ({ encuestas } = await api(`/api/encuestas/${id}/votar`, {
          method: 'POST',
          body: JSON.stringify({ opcion_id: Number(boton.dataset.opcion) }),
        }));
      } else if (accion === 'cerrar') {
        ({ encuestas } = await api(`/api/encuestas/${id}/cerrar`, { method: 'POST' }));
      } else if (accion === 'borrar') {
        if (!confirm('¿Borrar esta encuesta y todos sus votos?')) return;
        ({ encuestas } = await api(`/api/encuestas/${id}`, { method: 'DELETE' }));
      }
      pintarEncuestas();
    } catch (err) {
      alert(err.message);
    }
  });

  function htmlInputOpcion(n) {
    return `<input type="text" class="encuesta-opcion-input" maxlength="100" placeholder="Opción ${n}" />`;
  }

  function abrirFormEncuesta(abrir) {
    const form = $('#form-encuesta');
    form.hidden = !abrir;
    $('#btn-nueva-encuesta').hidden = abrir;
    $('#encuesta-error').hidden = true;
    if (abrir) {
      $('#encuesta-pregunta').value = '';
      $('#encuesta-opciones').innerHTML = htmlInputOpcion(1) + htmlInputOpcion(2);
      $('#btn-mas-opcion').hidden = false;
      $('#encuesta-pregunta').focus();
    }
  }

  $('#btn-nueva-encuesta').addEventListener('click', () => abrirFormEncuesta(true));
  $('#btn-cancelar-encuesta').addEventListener('click', () => abrirFormEncuesta(false));
  $('#btn-mas-opcion').addEventListener('click', () => {
    const cont = $('#encuesta-opciones');
    const n = cont.querySelectorAll('input').length;
    if (n >= MAX_OPCIONES_ENCUESTA) return;
    cont.insertAdjacentHTML('beforeend', htmlInputOpcion(n + 1));
    cont.lastElementChild.focus();
    if (n + 1 >= MAX_OPCIONES_ENCUESTA) $('#btn-mas-opcion').hidden = true;
  });

  $('#form-encuesta').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const errorEl = $('#encuesta-error');
    errorEl.hidden = true;
    const pregunta = $('#encuesta-pregunta').value.trim();
    const opciones = $$('#encuesta-opciones input').map((i) => i.value.trim()).filter(Boolean);
    try {
      ({ encuestas } = await api('/api/encuestas', { method: 'POST', body: JSON.stringify({ pregunta, opciones }) }));
      abrirFormEncuesta(false);
      pintarEncuestas();
      cargarChat(); // el aviso de la encuesta nueva sale en el chat
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  });

  function detenerSondeoChat() {
    if (chatPollHandle) {
      clearInterval(chatPollHandle);
      chatPollHandle = null;
    }
  }

  $('#form-chat').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#chat-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    try {
      const { message } = await api('/api/chat/messages', { method: 'POST', body: JSON.stringify({ text }) });
      if (message) pintarMensaje(message);
    } catch (e) { /* ignore */ }
  });

  // ---------- JORNADA ----------
  // Puede haber varias jornadas abiertas a la vez: las creadas a mano (arriba)
  // y las de la API (Eduardo Losilla): la que se esta jugando ("en juego", ya
  // sin pronosticos) encima de la siguiente. Cada una se pinta en su propio bloque.
  let usuariosJornada = [];
  const bloquesJornada = new Map(); // jornada id -> { jornada, partidos, estado } (lo ultimo pintado)
  const editandoResultados = new Set(); // jornadas con "Poner resultados" abierto
  const editandoDefinitivo = new Set(); // jornadas editando solo la casilla "Pleno al 15 definitivo"
  const editandoPremios = new Set(); // jornadas con "Poner premios" abierto

  async function cargarJornada() {
    try {
      const data = await api('/api/jornada/current');
      usuariosJornada = data.usuarios || [];
      const jornadas = data.jornadas || [];
      const manuales = jornadas.filter((j) => j.jornada.manual);
      const deLaApi = jornadas.filter((j) => !j.jornada.manual);
      bloquesJornada.clear();

      $('#jornadas-manuales').innerHTML = manuales.map(htmlBloqueJornada).join('');
      $('#jornada-api').innerHTML = deLaApi.length
        ? deLaApi.map(htmlBloqueJornada).join('')
        : `<div class="empty-state"><p>Todavía no hay jornada de la API. En cuanto se abra la próxima jornada aparecerá aquí sola. Si no funciona, usa "Crear jornada manualmente".</p></div>`;
    } catch (e) {
      console.error('Error cargando la jornada:', e);
    }
  }

  // Titulo en HTML: "Jornada 9 (2026/27)" o, si se creo a mano, "<titulo> (a mano)"
  function tituloJornada(j) {
    return j.manual
      ? `${escapeHtml(j.numero)} <span class="etiqueta-manual">(a mano)</span>`
      : `Jornada ${escapeHtml(j.numero)}${j.temporada ? ` (${escapeHtml(j.temporada)})` : ''}`;
  }

  function htmlBloqueJornada({ jornada: datosJornada, partidos, estado, premios, premios_usuario: premiosUsuario }) {
    const jornada = { ...datosJornada, premios: premios || [], premios_usuario: premiosUsuario || {} };
    bloquesJornada.set(jornada.id, { jornada, partidos, estado, usuarios: usuariosJornada });

    // Jornada en juego: ya salio la siguiente, asi que solo se ve lo que puso
    // cada uno, los resultados y los premios. Pasa sola al Historial al terminar.
    if (jornada.en_juego) {
      return `
        <section class="jornada-bloque jornada-bloque-en-juego" data-jornada-id="${jornada.id}">
          <div class="tab-header-row">
            <h3 class="jornada-bloque-titulo">${tituloJornada(jornada)} <span class="etiqueta-en-juego">En juego</span></h3>
            <button type="button" class="btn btn-ghost btn-small" data-accion="archivar">Añadir al histórico</button>
          </div>
          <p class="resultados-todos-hint">Ya no se pueden cambiar los pronósticos. Pasará sola al Historial cuando estén todos los resultados y los premios.</p>
          ${htmlResultadosDeTodos(jornada, partidos, usuariosJornada)}
        </section>
      `;
    }

    const filas = partidos.filter((p) => !p.es_pleno).map((p) => `
      <tr>
        <td>${p.orden}</td>
        <td>${escapeHtml(p.equipo_local)} - ${escapeHtml(p.equipo_visitante)}</td>
        ${['1', 'X', '2'].map((v) => `
          <td><input type="radio" name="partido-${p.id}" value="${v}" ${p.mi_pronostico === v ? 'checked' : ''} /></td>
        `).join('')}
      </tr>
    `).join('');

    const pleno = partidos.find((p) => p.es_pleno);
    let plenoHtml = '';
    if (pleno) {
      const [gl, gv] = (pleno.mi_pronostico || '').split('-');
      plenoHtml = `
        <div class="pleno-form" data-pleno-id="${pleno.id}">
          <strong>Pleno al 15:</strong> ${escapeHtml(pleno.equipo_local)}
          <input type="number" min="0" data-goles="local" value="${escapeHtml(gl || '')}" />
          -
          <input type="number" min="0" data-goles="visitante" value="${escapeHtml(gv || '')}" />
          ${escapeHtml(pleno.equipo_visitante)}
        </div>
      `;
    }

    const estadoHtml = (estado || []).map((u) => `
      <li class="${u.completado ? 'completado' : ''}">${escapeHtml(u.username)}: ${u.rellenados}/${u.total}${u.completado ? ' ✓' : ''}</li>
    `).join('');

    return `
      <section class="jornada-bloque${jornada.manual ? ' jornada-bloque-manual' : ''}" data-jornada-id="${jornada.id}">
        <div class="tab-header-row">
          <h3 class="jornada-bloque-titulo">${tituloJornada(jornada)}</h3>
          ${jornada.manual ? '<button type="button" class="btn btn-ghost btn-small" data-accion="archivar">Añadir al histórico</button>' : ''}
        </div>
        <table class="jornada-tabla">
          <thead>
            <tr><th>#</th><th>Partido</th><th>1</th><th>X</th><th>2</th></tr>
          </thead>
          <tbody>${filas}</tbody>
        </table>
        ${plenoHtml}
        <button type="button" class="btn btn-primary btn-guardar" data-accion="guardar">Guardar mis pronósticos</button>
        <p class="ok-msg" data-guardado hidden>¡Guardado!</p>

        <h4>¿Quién ha rellenado ya?</h4>
        <ul class="estado-lista">${estadoHtml}</ul>

        ${htmlResultadosDeTodos(jornada, partidos, usuariosJornada)}
      </section>
    `;
  }

  // "Resultados de todos" de un bloque (en Jornada o en Historial). Se repinta
  // por separado al entrar o salir del modo "Poner resultados", para no perder
  // pronosticos sin guardar.
  function htmlResultadosDeTodos(jornada, partidos, usuarios) {
    const editable = editandoResultados.has(jornada.id);
    const tabla = htmlTablaResultados(usuarios, partidos, {
      editable,
      plenoDefinitivo: jornada.pleno_definitivo || null,
      editandoDefinitivo: editandoDefinitivo.has(jornada.id),
      conColumnaResultado: editable || !jornada.manual || partidos.some((p) => p.resultado),
      jornadaPremios: jornada,
    });

    let hint = 'Lo que ha puesto cada uno. En verde los aciertos y en rojo los fallos, según se van conociendo los resultados.';
    if (editable) {
      hint = 'Pon el signo de cada partido ya jugado (y los goles del Pleno al 15: un número o M si son 3 o más). Deja en blanco lo que no sepas. La API no cambia lo que pongáis a mano; si lo borras, lo volverá a rellenar ella. En "Pleno al 15 definitivo" va el Pleno común que jugáis entre todos.';
    } else if (partidos.some((p) => p.resultado_manual)) {
      hint += ' Los marcados con * los ha puesto alguien a mano.';
    }

    const acciones = editable
      ? `
        <button type="button" class="btn btn-ghost btn-small" data-accion="cancelar-resultados">Cancelar</button>
        <button type="button" class="btn btn-primary btn-small" data-accion="guardar-resultados">Guardar resultados</button>
      `
      : '<button type="button" class="btn btn-ghost btn-small" data-accion="poner-resultados">Poner resultados</button>';

    return `
      <div class="resultados-todos-wrap">
        <div class="tab-header-row">
          <h4>Resultados de todos</h4>
          <div class="resultados-acciones">${acciones}</div>
        </div>
        <p class="resultados-todos-hint">${hint}</p>
        <div class="resultados-todos-tabla-scroll">
          <table class="resultados-todos-tabla">
            <thead>${tabla.cabecera}</thead>
            <tbody>${tabla.cuerpo}</tbody>
            <tfoot>${tabla.pie}</tfoot>
          </table>
        </div>
        ${htmlPremiosJornada(jornada)}
      </div>
    `;
  }

  function repintarResultados(bloque, jornadaId) {
    const datos = bloquesJornada.get(jornadaId) || jornadasHistorial.get(jornadaId);
    if (!datos) return;
    bloque.querySelector('.resultados-todos-wrap').outerHTML =
      htmlResultadosDeTodos(datos.jornada, datos.partidos, datos.usuarios);
  }

  // Botones de "Poner resultados" (valen en Jornada y en Historial)
  async function accionResultados(accion, bloque, jornadaId) {
    if (accion === 'poner-resultados' || accion === 'cancelar-resultados') {
      editandoDefinitivo.delete(jornadaId);
      if (accion === 'poner-resultados') editandoResultados.add(jornadaId);
      else editandoResultados.delete(jornadaId);
      repintarResultados(bloque, jornadaId);
    }
    if (accion === 'guardar-resultados') await guardarResultados(bloque, jornadaId);

    // Casilla "Pleno al 15 definitivo" editable por separado
    if (accion === 'editar-definitivo' || accion === 'cancelar-definitivo') {
      if (accion === 'editar-definitivo') editandoDefinitivo.add(jornadaId);
      else editandoDefinitivo.delete(jornadaId);
      repintarResultados(bloque, jornadaId);
      if (accion === 'editar-definitivo') {
        const input = bloque.querySelector('[data-res-definitivo] input');
        if (input) input.focus();
      }
    }
    if (accion === 'guardar-definitivo') await guardarPlenoDefinitivo(bloque, jornadaId);

    // Premios de la jornada
    if (accion === 'editar-premios' || accion === 'cancelar-premios') {
      if (accion === 'editar-premios') editandoPremios.add(jornadaId);
      else editandoPremios.delete(jornadaId);
      repintarResultados(bloque, jornadaId);
    }
    if (accion === 'guardar-premios') await guardarPremios(bloque, jornadaId);
  }

  async function guardarPlenoDefinitivo(bloque, jornadaId) {
    const celda = bloque.querySelector('[data-res-definitivo]');
    const valor = leerGolesPleno(celda, 'Pleno al 15 definitivo');
    if (valor === null) return;
    try {
      await api(`/api/jornada/${jornadaId}/resultados`, {
        method: 'POST',
        body: JSON.stringify({ resultados: {}, pleno_definitivo: valor }),
      });
      editandoDefinitivo.delete(jornadaId);
      if (bloque.closest('#tab-historial')) await cargarHistorial(jornadaId);
      else await cargarJornada();
    } catch (err) {
      alert(err.message);
    }
  }

  // Botones de cada bloque (Guardar / Añadir al historico / Poner resultados)
  $('#tab-jornada').addEventListener('click', async (e) => {
    const boton = e.target.closest('[data-accion]');
    if (!boton) return;
    const bloque = boton.closest('.jornada-bloque');
    const jornadaId = Number(bloque.dataset.jornadaId);
    const accion = boton.dataset.accion;
    if (accion === 'guardar') await guardarPronosticos(bloque, jornadaId);
    if (accion === 'archivar') await archivarJornada(bloque, jornadaId);
    await accionResultados(accion, bloque, jornadaId);
  });

  // Lee las dos casillas de goles (un numero o "M" = 3 o mas) de un Pleno.
  // Devuelve "2-M", "" si estan vacias, o null (tras avisar) si no son validas.
  function leerGolesPleno(contenedor, nombre) {
    const leer = (lado) => contenedor.querySelector(`[data-res-goles="${lado}"]`).value.trim().toUpperCase();
    const gl = leer('local');
    const gv = leer('visitante');
    if ((gl === '') !== (gv === '')) {
      alert(`En el ${nombre} pon los goles de los dos equipos (o deja los dos en blanco).`);
      return null;
    }
    if (gl === '') return '';
    const valido = (g) => g === 'M' || /^\d{1,2}$/.test(g);
    if (!valido(gl) || !valido(gv)) {
      alert(`En el ${nombre} pon un número de goles o M (3 o más) para cada equipo.`);
      return null;
    }
    const norm = (g) => (g === 'M' ? 'M' : String(Number(g)));
    return `${norm(gl)}-${norm(gv)}`;
  }

  async function guardarResultados(bloque, jornadaId) {
    const resultados = {};
    bloque.querySelectorAll('[data-res-partido]').forEach((sel) => {
      resultados[sel.dataset.resPartido] = sel.value;
    });
    const pleno = bloque.querySelector('[data-res-pleno]');
    if (pleno) {
      const valor = leerGolesPleno(pleno, 'Pleno al 15');
      if (valor === null) return;
      resultados[pleno.dataset.resPleno] = valor;
    }
    const body = { resultados };
    const definitivo = bloque.querySelector('[data-res-definitivo]');
    if (definitivo) {
      const valor = leerGolesPleno(definitivo, 'Pleno al 15 definitivo');
      if (valor === null) return;
      body.pleno_definitivo = valor;
    }

    try {
      await api(`/api/jornada/${jornadaId}/resultados`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      editandoResultados.delete(jornadaId);
      if (bloque.closest('#tab-historial')) await cargarHistorial(jornadaId);
      else await cargarJornada();
    } catch (err) {
      alert(err.message);
    }
  }

  async function guardarPronosticos(bloque, jornadaId) {
    const predicciones = {};
    bloque.querySelectorAll('.jornada-tabla input[type="radio"]:checked').forEach((radio) => {
      predicciones[radio.name.replace('partido-', '')] = radio.value;
    });
    const pleno = bloque.querySelector('[data-pleno-id]');
    if (pleno) {
      const gl = pleno.querySelector('[data-goles="local"]').value;
      const gv = pleno.querySelector('[data-goles="visitante"]').value;
      if (gl !== '' && gv !== '') predicciones[pleno.dataset.plenoId] = `${gl}-${gv}`;
    }

    try {
      await api('/api/jornada/predicciones', {
        method: 'POST',
        body: JSON.stringify({ jornada_id: jornadaId, predicciones }),
      });
      await cargarJornada();
      const ok = $(`.jornada-bloque[data-jornada-id="${jornadaId}"] [data-guardado]`);
      if (ok) {
        ok.hidden = false;
        setTimeout(() => (ok.hidden = true), 2000);
      }
    } catch (err) {
      alert(err.message);
    }
  }

  async function archivarJornada(bloque, jornadaId) {
    const titulo = bloque.querySelector('.jornada-bloque-titulo').textContent.trim();
    const aviso = bloque.classList.contains('jornada-bloque-en-juego')
      ? 'Los resultados y premios que falten seguirán llegando solos.'
      : 'Ya no se podrán cambiar los pronósticos.';
    if (!confirm(`¿Pasar "${titulo}" al histórico? ${aviso}`)) return;
    try {
      await api(`/api/jornada/${jornadaId}/archivar`, { method: 'POST' });
      await cargarJornada();
      await cargarHistorial();
    } catch (err) {
      alert(err.message);
    }
  }

  // ---------- CREAR JORNADA A MANO (por si la API no funciona) ----------
  const PARTIDOS_MANUAL = 14; // + el Pleno al 15, que va aparte

  $('#btn-crear-manual').addEventListener('click', () => {
    prepararFormularioManual();
    $('#form-jornada-manual').hidden = false;
    $('#manual-titulo').focus();
  });

  $('#btn-cancelar-manual').addEventListener('click', cerrarFormularioManual);

  function prepararFormularioManual() {
    const wrap = $('#manual-partidos');
    if (wrap.dataset.listo) return;
    wrap.innerHTML = '';
    for (let i = 1; i <= PARTIDOS_MANUAL; i++) {
      const row = document.createElement('div');
      row.className = 'partido-editor-row';
      row.innerHTML = `
        <span>${i}</span>
        <input type="text" placeholder="Equipo local" data-idx="${i - 1}" data-campo="local" />
        <input type="text" placeholder="Equipo visitante" data-idx="${i - 1}" data-campo="visitante" />
      `;
      wrap.appendChild(row);
    }
    wrap.dataset.listo = '1';
  }

  function cerrarFormularioManual() {
    const form = $('#form-jornada-manual');
    form.reset();
    form.hidden = true;
  }

  $('#form-jornada-manual').addEventListener('submit', async (e) => {
    e.preventDefault();
    const titulo = $('#manual-titulo').value.trim();
    const partidos = [];
    for (let i = 0; i < PARTIDOS_MANUAL; i++) {
      const local = $(`#manual-partidos input[data-idx="${i}"][data-campo="local"]`).value.trim();
      const visitante = $(`#manual-partidos input[data-idx="${i}"][data-campo="visitante"]`).value.trim();
      if (local && visitante) partidos.push({ local, visitante });
    }
    const plenoLocal = $('#manual-pleno-local').value.trim();
    const plenoVisitante = $('#manual-pleno-visitante').value.trim();

    if (!titulo || partidos.length === 0) {
      alert('Pon al menos un título y un partido.');
      return;
    }

    try {
      await api('/api/jornada', {
        method: 'POST',
        body: JSON.stringify({
          titulo,
          partidos,
          pleno: plenoLocal && plenoVisitante ? { local: plenoLocal, visitante: plenoVisitante } : null,
        }),
      });
      cerrarFormularioManual();
      await cargarJornada();
    } catch (err) {
      alert(err.message);
    }
  });

  // ---------- COMPROBACION DE RESULTADOS ----------
  // Pleno al 15: se juega por goles de cada equipo en 0, 1, 2 o M (3 o mas).
  function categoriaGoles(n) {
    const g = Number(n);
    if (!Number.isFinite(g) || g < 0) return null;
    return g >= 3 ? 'M' : String(g);
  }

  // Acepta goles ("3-1") o la categoria ya puesta ("2-M", como en el Excel)
  function categoriaPleno(marcador) {
    const m = String(marcador || '').toUpperCase().match(/^\s*(\d+|M)\s*-\s*(\d+|M)\s*$/);
    const cat = (g) => (g === 'M' ? 'M' : categoriaGoles(g));
    return m ? `${cat(m[1])}-${cat(m[2])}` : null;
  }

  // true = acierto, false = fallo, null = aun no hay resultado o no hay pronostico
  function esAcierto(partido, pronostico) {
    if (!partido.resultado || !pronostico) return null;
    if (partido.es_pleno) {
      const real = categoriaPleno(partido.resultado);
      const puesto = categoriaPleno(pronostico);
      return real && puesto ? real === puesto : null;
    }
    return String(pronostico).toUpperCase() === String(partido.resultado).toUpperCase();
  }

  // Celda "Resultado": el valor (marcado si se puso a mano) o, en modo edicion,
  // un selector 1/X/2 (o los goles del Pleno al 15).
  function htmlCeldaResultado(p, editable) {
    if (editable) {
      if (p.es_pleno) {
        const [gl, gv] = (p.resultado || '').split('-');
        return `
          <td class="col-resultado editando" data-res-pleno="${p.id}">
            <input type="text" maxlength="2" data-res-goles="local" value="${escapeHtml(gl || '')}" aria-label="Goles local (número o M)" title="Goles o M (3 o más)" />
            -
            <input type="text" maxlength="2" data-res-goles="visitante" value="${escapeHtml(gv || '')}" aria-label="Goles visitante (número o M)" title="Goles o M (3 o más)" />
          </td>
        `;
      }
      return `
        <td class="col-resultado editando">
          <select data-res-partido="${p.id}" aria-label="Resultado">
            ${['', '1', 'X', '2'].map((v) => `<option value="${v}" ${(p.resultado || '') === v ? 'selected' : ''}>${v || '—'}</option>`).join('')}
          </select>
        </td>
      `;
    }
    if (!p.resultado) return `<td class="col-resultado valor-vacio" title="Aún sin resultado">·</td>`;
    return p.resultado_manual
      ? `<td class="col-resultado resultado-manual" title="Puesto a mano">${escapeHtml(p.resultado)}*</td>`
      : `<td class="col-resultado">${escapeHtml(p.resultado)}</td>`;
  }

  // Tabla "Resultados de todos" (partido x usuario) usada en Jornada y en Historial.
  // Si la jornada no tiene ningun resultado (tipico de las creadas a mano) y no
  // se esta editando, se puede ocultar la columna Resultado.
  // Fila "Pleno al 15 definitivo": el Pleno comun que juega el grupo. Una sola
  // casilla para todos, que solo se pone a mano (modo "Poner resultados") y se
  // compara con el resultado real del Pleno. No suma en los aciertos de nadie.
  function htmlInputsPlenoDefinitivo(plenoDefinitivo) {
    const [dl, dv] = (plenoDefinitivo || '').split('-');
    return `
      <input type="text" maxlength="2" data-res-goles="local" value="${escapeHtml(dl || '')}" aria-label="Pleno definitivo: goles local (número o M)" title="Goles o M (3 o más)" />
      -
      <input type="text" maxlength="2" data-res-goles="visitante" value="${escapeHtml(dv || '')}" aria-label="Pleno definitivo: goles visitante (número o M)" title="Goles o M (3 o más)" />
    `;
  }

  function htmlFilaPlenoDefinitivo(pleno, plenoDefinitivo, usuarios, { conColumnaResultado, editable, editandoDefinitivo }) {
    // La columna Resultado se deja vacia: el resultado real del Pleno solo se
    // muestra en la fila "Pleno al 15" de los usuarios.
    const colResultado = conColumnaResultado ? '<td class="col-resultado"></td>' : '';

    let celda;
    if (editable) {
      // Dentro de "Poner resultados": se guarda junto con el resto
      celda = `
        <td colspan="${usuarios.length}" class="pleno-definitivo editando" data-res-definitivo>
          ${htmlInputsPlenoDefinitivo(plenoDefinitivo)}
        </td>
      `;
    } else if (editandoDefinitivo) {
      // Edicion suelta de solo esta casilla
      celda = `
        <td colspan="${usuarios.length}" class="pleno-definitivo editando" data-res-definitivo>
          ${htmlInputsPlenoDefinitivo(plenoDefinitivo)}
          <button type="button" class="btn btn-primary btn-small" data-accion="guardar-definitivo">Guardar</button>
          <button type="button" class="btn btn-ghost btn-small" data-accion="cancelar-definitivo">Cancelar</button>
        </td>
      `;
    } else {
      const acierto = plenoDefinitivo ? esAcierto(pleno, plenoDefinitivo) : null;
      const clase = !plenoDefinitivo ? 'valor-vacio' : acierto === true ? 'acierto' : acierto === false ? 'fallo' : 'valor-relleno';
      celda = `
        <td colspan="${usuarios.length}" class="pleno-definitivo ${clase}">
          <span class="pleno-definitivo-valor">${plenoDefinitivo ? escapeHtml(plenoDefinitivo) : '—'}</span>
          <button type="button" class="btn btn-ghost btn-small btn-cambiar-definitivo" data-accion="editar-definitivo">${plenoDefinitivo ? 'Cambiar' : 'Poner'}</button>
        </td>
      `;
    }

    return `<tr class="fila-pleno-definitivo"><td>Pleno al 15 definitivo</td>${colResultado}${celda}</tr>`;
  }

  // ---------- PREMIOS ----------
  // Categorias de La Quiniela: 15 = Pleno al 15 (14 aciertos + Pleno), 14..10 aciertos
  const CATEGORIAS_PREMIO = [15, 14, 13, 12, 11, 10];

  function nombreCategoria(aciertos) {
    return aciertos === 15 ? 'Pleno al 15' : `${aciertos} aciertos`;
  }

  // Categoria que consigue la columna de un usuario. Como en un boleto real, el
  // Pleno al 15 es comun a todas las columnas: se usa el Pleno definitivo.
  function categoriaDeUsuario(partidos, usuario, plenoDefinitivo) {
    const normales = partidos.filter((p) => !p.es_pleno);
    const pendientes = normales.filter((p) => !p.resultado).length;
    const aciertos = normales.filter((p) => esAcierto(p, p.predicciones && p.predicciones[usuario])).length;
    const pleno = partidos.find((p) => p.es_pleno);
    let categoria = aciertos >= 10 ? aciertos : null;
    if (aciertos === 14 && pleno && plenoDefinitivo && esAcierto(pleno, plenoDefinitivo)) categoria = 15;
    return { aciertos, categoria, pendientes };
  }

  // Premio de un usuario en una jornada: el fijado a mano (premios_usuario) si
  // lo hay; si no, el de su categoria segun la tabla de premios.
  // importe = centimos, o null si todavia no se sabe.
  function premioDeUsuario(jornada, partidos, usuario) {
    const { categoria, pendientes } = categoriaDeUsuario(partidos, usuario, jornada.pleno_definitivo || null);
    const fijado = jornada.premios_usuario && jornada.premios_usuario[usuario];
    if (fijado !== undefined && fijado !== null) return { categoria, pendientes, importe: fijado, fijado: true };
    if (!categoria) return { categoria, pendientes, importe: pendientes ? null : 0, fijado: false };
    const premio = (jornada.premios || []).find((p) => p.aciertos === categoria);
    const importe = premio && premio.premio_centimos !== null ? premio.premio_centimos : null;
    return { categoria, pendientes, importe, fijado: false };
  }

  // Fila "Premio" del pie: categoria e importe de cada columna, y el total del bote
  function htmlFilaPremio(usuarios, partidos, jornada, conColumnaResultado) {
    if (!partidos.some((p) => !p.es_pleno && p.resultado)) return '';
    let total = 0;
    let totalConocido = true;
    let provisional = false;

    const celdas = usuarios.map((u) => {
      const { categoria, pendientes, importe, fijado } = premioDeUsuario(jornada, partidos, u);
      if (pendientes && !fijado) provisional = true;
      if (importe === null) totalConocido = false;
      else total += importe;
      const textoImporte = importe !== null ? euros(importe).replace('+', '') : '';
      if (fijado) {
        return `<td class="premio-celda${importe > 0 ? ' con-premio' : ' valor-vacio'}" title="Premio puesto a mano">${textoImporte}</td>`;
      }
      if (!categoria) return `<td class="premio-celda valor-vacio">${pendientes ? '…' : '—'}</td>`;
      return `
        <td class="premio-celda con-premio" title="${escapeHtml(nombreCategoria(categoria))}">
          <span class="premio-categoria">${categoria === 15 ? 'P15' : categoria}</span>
          ${textoImporte ? `<span class="premio-importe">${textoImporte}</span>` : ''}
        </td>
      `;
    }).join('');

    const totalTexto = total > 0 || totalConocido ? euros(total).replace('+', '') : '¿?';
    const resumen = conColumnaResultado
      ? `<td class="col-resultado premio-total" title="Total que gana el bote">${totalTexto}${provisional ? ' ~' : ''}</td>`
      : '';
    return `<tr class="fila-premio"><td>Premio${provisional ? ' <span class="etiqueta-manual">(provisional)</span>' : ''}</td>${resumen}${celdas}</tr>`;
  }

  // Seccion "Premios de la jornada": tabla por categoria (de la API o a mano)
  function htmlPremiosJornada(jornada) {
    const editando = editandoPremios.has(jornada.id);
    const porCategoria = Object.fromEntries((jornada.premios || []).map((p) => [p.aciertos, p]));
    const hayPremios = (jornada.premios || []).length > 0;
    const hayManual = (jornada.premios || []).some((p) => p.manual);

    const filas = CATEGORIAS_PREMIO.map((c) => {
      const p = porCategoria[c];
      if (editando) {
        return `
          <tr>
            <td>${nombreCategoria(c)}</td>
            <td class="editando"><input type="text" inputmode="numeric" data-premio-acertantes="${c}" value="${p && p.acertantes !== null ? p.acertantes : ''}" aria-label="Acertantes de ${nombreCategoria(c)}" /></td>
            <td class="editando"><input type="text" inputmode="decimal" data-premio-importe="${c}" value="${p && p.premio_centimos !== null ? escapeHtml(eurosParaEditar(p.premio_centimos)) : ''}" aria-label="Premio de ${nombreCategoria(c)} en euros" /> €</td>
          </tr>
        `;
      }
      const acertantes = p && p.acertantes !== null ? p.acertantes.toLocaleString('es-ES') : '—';
      const importe = p && p.premio_centimos !== null ? euros(p.premio_centimos).replace('+', '') : '—';
      return `<tr><td>${nombreCategoria(c)}</td><td>${acertantes}</td><td class="premio-importe-tabla">${importe}${p && p.manual ? '*' : ''}</td></tr>`;
    }).join('');

    const acciones = editando
      ? `
        <button type="button" class="btn btn-ghost btn-small" data-accion="cancelar-premios">Cancelar</button>
        <button type="button" class="btn btn-primary btn-small" data-accion="guardar-premios">Guardar premios</button>
      `
      : '<button type="button" class="btn btn-ghost btn-small" data-accion="editar-premios">Poner premios</button>';

    let hint = 'Premio por acertante de cada categoría. Llegan solos cuando se publica el escrutinio (normalmente lunes o martes).';
    if (editando) hint = 'Pon el premio por acertante (en euros) y, si quieres, el número de acertantes. Deja en blanco una categoría para borrarla. La API no cambia lo que pongáis a mano.';
    else if (!hayPremios) hint = 'Todavía no hay premios. Llegarán solos cuando se publique el escrutinio, o podéis ponerlos a mano.';
    else if (hayManual) hint += ' Los marcados con * los ha puesto alguien a mano.';

    return `
      <div class="premios-wrap">
        <div class="tab-header-row">
          <h4>Premios de la jornada</h4>
          <div class="resultados-acciones">${acciones}</div>
        </div>
        <p class="resultados-todos-hint">${hint}</p>
        <div class="resultados-todos-tabla-scroll premios-tabla-wrap">
          <table class="resultados-todos-tabla premios-tabla">
            <thead><tr><th>Categoría</th><th>Acertantes</th><th>Premio</th></tr></thead>
            <tbody>${filas}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  async function guardarPremios(bloque, jornadaId) {
    const entrada = {};
    for (const c of CATEGORIAS_PREMIO) {
      const inputImporte = bloque.querySelector(`[data-premio-importe="${c}"]`);
      const inputAcertantes = bloque.querySelector(`[data-premio-acertantes="${c}"]`);
      const textoImporte = inputImporte.value.trim();
      const textoAcertantes = inputAcertantes.value.trim().replace(/\./g, '');
      const importe = textoImporte === '' ? null : leerEuros(textoImporte);
      if (importe === null && textoImporte !== '') {
        alert(`El premio de ${nombreCategoria(c)} no es válido. Usa por ejemplo 12,50.`);
        inputImporte.focus();
        return;
      }
      if (importe !== null && importe < 0) {
        alert(`El premio de ${nombreCategoria(c)} no puede ser negativo.`);
        inputImporte.focus();
        return;
      }
      if (textoAcertantes !== '' && !/^\d+$/.test(textoAcertantes)) {
        alert(`Los acertantes de ${nombreCategoria(c)} tienen que ser un número entero.`);
        inputAcertantes.focus();
        return;
      }
      entrada[c] = { premio_centimos: importe, acertantes: textoAcertantes === '' ? null : Number(textoAcertantes) };
    }
    try {
      await api(`/api/jornada/${jornadaId}/premios`, { method: 'POST', body: JSON.stringify({ premios: entrada }) });
      editandoPremios.delete(jornadaId);
      if (bloque.closest('#tab-historial')) await cargarHistorial(jornadaId);
      else await cargarJornada();
    } catch (err) {
      alert(err.message);
    }
  }

  function htmlTablaResultados(usuarios, partidos, { conColumnaResultado = true, editable = false, plenoDefinitivo = null, editandoDefinitivo = false, jornadaPremios = null } = {}) {
    // El Pleno al 15 de cada uno se ve en la tabla pero no suma: solo cuentan los 14
    const aciertos = Object.fromEntries(usuarios.map((u) => [u, 0]));
    const normales = partidos.filter((p) => !p.es_pleno);
    const conResultado = normales.filter((p) => p.resultado).length;

    const cabecera = `
      <tr>
        <th>Partido</th>
        ${conColumnaResultado ? `<th class="col-resultado">Resultado</th>` : ""}
        ${usuarios.map((u) => `<th>${escapeHtml(u)}</th>`).join('')}
      </tr>
    `;

    const cuerpo = partidos.map((p) => {
      const etiqueta = (p.es_pleno ? 'Pleno al 15: ' : '') + `${escapeHtml(p.equipo_local)} - ${escapeHtml(p.equipo_visitante)}`;
      const resultado = conColumnaResultado ? htmlCeldaResultado(p, editable) : '';
      const celdas = usuarios.map((u) => {
        const valor = (p.predicciones && p.predicciones[u]) || '';
        if (!valor) return `<td class="valor-vacio">—</td>`;
        const acierto = esAcierto(p, valor);
        if (acierto && !p.es_pleno) aciertos[u]++;
        const clase = acierto === true ? 'acierto' : acierto === false ? 'fallo' : 'valor-relleno';
        return `<td class="${clase}">${escapeHtml(valor)}</td>`;
      }).join('');
      const fila = `<tr><td>${etiqueta}</td>${resultado}${celdas}</tr>`;
      return p.es_pleno
        ? fila + htmlFilaPlenoDefinitivo(p, plenoDefinitivo, usuarios, { conColumnaResultado, editable, editandoDefinitivo })
        : fila;
    }).join('');

    const pie = conResultado === 0 ? '' : `
      <tr>
        <td>Aciertos</td>
        <td class="col-resultado">${conResultado}/${normales.length}</td>
        ${usuarios.map((u) => `<td>${aciertos[u]}/${conResultado}</td>`).join('')}
      </tr>
      ${jornadaPremios ? htmlFilaPremio(usuarios, partidos, jornadaPremios, conColumnaResultado) : ''}
    `;

    return { cabecera, cuerpo, pie };
  }

  // ---------- HISTORIAL (una pestaña por jornada cerrada, con la tabla de Resultados de todos) ----------
  const jornadasHistorial = new Map(); // jornada id -> { jornada, partidos, usuarios }

  // seleccionarId: jornada que se deja abierta al recargar (p. ej. tras guardar resultados)
  async function cargarHistorial(seleccionarId) {
    try {
      const { usuarios, jornadas } = await api('/api/historial');
      const tabsWrap = $('#historial-tabs');
      tabsWrap.innerHTML = '';
      jornadasHistorial.clear();

      if (!jornadas || jornadas.length === 0) {
        $('#historial-contenido').innerHTML =
          '<div class="empty-state"><p>Todavía no hay jornadas cerradas en el historial. En cuanto se cargue una jornada nueva, la anterior aparecerá aquí.</p></div>';
        return;
      }

      jornadas.forEach((j) => {
        const jornada = { ...j, id: j.jornada_id };
        jornadasHistorial.set(jornada.id, { jornada, partidos: j.partidos, usuarios });
      });

      const inicial = jornadasHistorial.has(seleccionarId) ? seleccionarId : jornadas[0].jornada_id;
      jornadas.forEach((j) => {
        const btn = document.createElement('button');
        btn.textContent = j.manual ? `${j.numero} (a mano)` : `Jornada ${j.numero}`;
        if (j.jornada_id === inicial) btn.classList.add('active');
        btn.addEventListener('click', () => {
          $$('#historial-tabs button').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          pintarHistorialJornada(j.jornada_id);
        });
        tabsWrap.appendChild(btn);
      });

      pintarHistorialJornada(inicial);
    } catch (e) {
      console.error('Error cargando el historial:', e);
    }
  }

  function pintarHistorialJornada(jornadaId) {
    const cont = $('#historial-contenido');
    const datos = jornadasHistorial.get(jornadaId);
    if (!datos) {
      cont.innerHTML = '<div class="empty-state"><p>Todavía no hay jornadas cerradas en el historial.</p></div>';
      return;
    }

    cont.innerHTML = `
      <section class="jornada-bloque" data-jornada-id="${datos.jornada.id}">
        <h3 class="jornada-bloque-titulo">${tituloJornada(datos.jornada)}</h3>
        ${htmlResultadosDeTodos(datos.jornada, datos.partidos, datos.usuarios)}
      </section>
    `;
  }

  $('#tab-historial').addEventListener('click', async (e) => {
    const boton = e.target.closest('[data-accion]');
    if (!boton) return;
    const bloque = boton.closest('.jornada-bloque');
    await accionResultados(boton.dataset.accion, bloque, Number(bloque.dataset.jornadaId));
  });

  // ---------- ECONOMIA (saldo de cada uno en el bote comun, a mano) ----------
  let datosEconomia = null;
  let editandoEconomia = false;

  const formatoEuros = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });

  function euros(centimos) {
    const texto = formatoEuros.format(centimos / 100);
    return centimos > 0 ? `+${texto}` : texto;
  }

  function claseSaldo(centimos) {
    return centimos > 0 ? 'saldo-positivo' : centimos < 0 ? 'saldo-negativo' : 'saldo-cero';
  }

  // "12,50" / "-3" / "+5.5" / "1.234,56" -> centimos (entero), o null si no es valido
  function leerEuros(texto) {
    let s = String(texto || '').trim().replace(/\s|€/g, '');
    if (s === '') return 0;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    if (!/^[+-]?\d+(\.\d{1,2})?$/.test(s)) return null;
    return Math.round(Number(s) * 100);
  }

  // "12,50" / "20" para rellenar la casilla al editar (sin simbolo ni signo +)
  function eurosParaEditar(centimos) {
    const decimales = centimos % 100 === 0 ? 0 : 2;
    return (centimos / 100).toLocaleString('es-ES', {
      minimumFractionDigits: decimales, maximumFractionDigits: decimales, useGrouping: false,
    });
  }

  function fechaCorta(sqlUtc) {
    if (!sqlUtc) return '';
    return new Date(sqlUtc.replace(' ', 'T') + 'Z').toLocaleString('es-ES', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  }

  async function cargarEconomia() {
    try {
      datosEconomia = await api('/api/economia');
      pintarEconomia();
    } catch (e) {
      console.error('Error cargando la economía:', e);
    }
  }

  function pintarEconomia() {
    if (!datosEconomia) return;
    const { usuarios, total_centimos: total } = datosEconomia;

    $('#economia-acciones').innerHTML = editandoEconomia
      ? `
        <button type="button" class="btn btn-ghost btn-small" data-accion="cancelar-economia">Cancelar</button>
        <button type="button" class="btn btn-primary btn-small" data-accion="guardar-economia">Guardar saldos</button>
      `
      : '<button type="button" class="btn btn-ghost btn-small" data-accion="editar-economia">Modificar saldos</button>';

    const filas = usuarios.map((u) => {
      const saldo = editandoEconomia
        ? `<td class="economia-saldo editando"><input type="text" inputmode="decimal" data-saldo="${escapeHtml(u.username)}" value="${escapeHtml(eurosParaEditar(u.saldo_centimos))}" aria-label="Saldo de ${escapeHtml(u.username)} en euros" /> €</td>`
        : `<td class="economia-saldo ${claseSaldo(u.saldo_centimos)}">${euros(u.saldo_centimos)}</td>`;
      const modificado = u.updated_at
        ? `${escapeHtml(fechaCorta(u.updated_at))}${u.updated_by ? ` · ${escapeHtml(u.updated_by)}` : ''}`
        : '—';
      return `
        <tr>
          <td>${escapeHtml(u.username)}</td>
          ${saldo}
          <td class="economia-modificado">${modificado}</td>
        </tr>
      `;
    }).join('');

    $('#economia-contenido').innerHTML = `
      <div class="resultados-todos-tabla-scroll economia-wrap">
        <table class="resultados-todos-tabla economia-tabla">
          <thead>
            <tr><th>Usuario</th><th>Saldo en el bote</th><th>Última modificación</th></tr>
          </thead>
          <tbody>${filas}</tbody>
          <tfoot>
            <tr>
              <td>Total del bote</td>
              <td class="economia-saldo ${claseSaldo(total)}">${euros(total)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
      ${editandoEconomia ? '<p class="resultados-todos-hint">Pon cada saldo en euros, por ejemplo 12,50 o -3. En negativo si debe dinero al bote.</p>' : ''}
    `;
  }

  async function guardarEconomia() {
    const saldos = {};
    for (const input of $$('#economia-contenido [data-saldo]')) {
      const centimos = leerEuros(input.value);
      if (centimos === null) {
        alert(`La cantidad de ${input.dataset.saldo} no es válida. Usa por ejemplo 12,50 o -3.`);
        input.focus();
        return;
      }
      saldos[input.dataset.saldo] = centimos;
    }
    try {
      datosEconomia = await api('/api/economia', { method: 'POST', body: JSON.stringify({ saldos }) });
      editandoEconomia = false;
      pintarEconomia();
    } catch (err) {
      alert(err.message);
    }
  }

  $('#tab-economia').addEventListener('click', async (e) => {
    const boton = e.target.closest('[data-accion]');
    if (!boton) return;
    const accion = boton.dataset.accion;
    if (accion === 'editar-economia') {
      editandoEconomia = true;
      await cargarEconomia(); // parte de lo ultimo guardado
      const primero = $('#economia-contenido [data-saldo]');
      if (primero) primero.focus();
    }
    if (accion === 'cancelar-economia') {
      editandoEconomia = false;
      pintarEconomia();
    }
    if (accion === 'guardar-economia') await guardarEconomia();
  });

  // ---------- RANKINGS (sobre las jornadas del Historial) ----------
  let rankingActivo = 'aciertos';
  let datosRankings = null;

  async function cargarRankings() {
    if (!datosRankings) $('#rankings-contenido').innerHTML = '<p class="resultados-todos-hint">Cargando…</p>';
    try {
      datosRankings = await api('/api/historial');
      pintarRanking();
    } catch (e) {
      console.error('Error cargando los rankings:', e);
    }
  }

  // Ordena de mayor a menor y reparte posiciones seguidas: los empatados
  // comparten puesto y el siguiente va justo detras (1, 1, 2, 2, 3...), para
  // que siempre haya oro, plata y bronce aunque haya empates.
  function conPosiciones(filas, valor) {
    const ordenadas = [...filas].sort((a, b) => valor(b) - valor(a) || a.username.localeCompare(b.username));
    return ordenadas.map((f, i) => {
      const anterior = ordenadas[i - 1];
      f.posicion = !anterior ? 1 : valor(anterior) === valor(f) ? anterior.posicion : anterior.posicion + 1;
      return f;
    });
  }

  function medalla(posicion) {
    return { 1: '🥇', 2: '🥈', 3: '🥉' }[posicion] || posicion;
  }

  function rankingAciertos(usuarios, jornadas) {
    const filas = usuarios.map((username) => {
      let aciertos = 0;
      let comprobados = 0; // partidos con resultado en los que puso pronostico
      let jugadas = 0;
      for (const j of jornadas) {
        let jugo = false;
        for (const p of j.partidos) {
          if (p.es_pleno) continue; // el Pleno al 15 es solo informativo
          const valor = p.predicciones && p.predicciones[username];
          if (valor) jugo = true;
          const acierto = esAcierto(p, valor);
          if (acierto !== null) comprobados++;
          if (acierto) aciertos++;
        }
        if (jugo) jugadas++;
      }
      return { username, aciertos, comprobados, jugadas };
    });
    return conPosiciones(filas, (f) => f.aciertos);
  }

  function rankingDineros(usuarios, jornadas) {
    const filas = usuarios.map((username) => {
      let total = 0;
      let conPremio = 0;
      let pendientes = 0; // jornadas con categoria pero sin importe conocido
      for (const j of jornadas) {
        const jornada = { ...j, id: j.jornada_id };
        const { importe, categoria } = premioDeUsuario(jornada, j.partidos, username);
        if (importe === null) {
          if (categoria) pendientes++;
          continue;
        }
        total += importe;
        if (importe > 0) conPremio++;
      }
      return { username, total, conPremio, pendientes };
    });
    return conPosiciones(filas, (f) => f.total);
  }

  function pintarRanking() {
    $$('#rankings-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.ranking === rankingActivo));
    const cont = $('#rankings-contenido');
    if (!datosRankings) return;
    const { usuarios, jornadas } = datosRankings;

    if (!jornadas || jornadas.length === 0) {
      cont.innerHTML = '<div class="empty-state"><p>Todavía no hay jornadas en el Historial.</p></div>';
      return;
    }
    const nJornadas = `${jornadas.length} jornada${jornadas.length === 1 ? '' : 's'} del Historial`;

    if (rankingActivo === 'aciertos') {
      const ranking = rankingAciertos(usuarios, jornadas);
      // El ultimo (o los ultimos, si empatan) se lleva el dedo acusatorio,
      // salvo que esten todos empatados en el primer puesto
      const ultimaPosicion = Math.max(...ranking.map((f) => f.posicion));
      const filas = ranking.map((f) => `
        <tr>
          <td class="ranking-posicion">${ultimaPosicion > 1 && f.posicion === ultimaPosicion ? '<span title="El último">🫵</span>' : medalla(f.posicion)}</td>
          <td>${escapeHtml(f.username)}</td>
          <td class="ranking-valor">${f.aciertos}</td>
          <td class="ranking-extra">${f.comprobados ? Math.round((f.aciertos / f.comprobados) * 100) : 0}%</td>
          <td class="ranking-extra">${f.jugadas}</td>
        </tr>
      `).join('');
      cont.innerHTML = `
        <p class="resultados-todos-hint">Resultados acertados en las ${nJornadas} (los 14 partidos; el Pleno al 15 no cuenta). El % es sobre los partidos con resultado en los que puso pronóstico.</p>
        <div class="resultados-todos-tabla-scroll ranking-wrap">
          <table class="resultados-todos-tabla ranking-tabla">
            <thead><tr><th>#</th><th>Usuario</th><th>Aciertos</th><th>% acierto</th><th>Jornadas</th></tr></thead>
            <tbody>${filas}</tbody>
          </table>
        </div>
      `;
      return;
    }

    const ranking = rankingDineros(usuarios, jornadas);
    const totalGanado = ranking.reduce((n, f) => n + f.total, 0);
    const hayPendientes = ranking.some((f) => f.pendientes);
    const filas = ranking.map((f) => `
      <tr>
        <td class="ranking-posicion">${totalGanado > 0 ? medalla(f.posicion) : '—'}</td>
        <td>${escapeHtml(f.username)}</td>
        <td class="ranking-valor ${f.total > 0 ? 'saldo-positivo' : 'saldo-cero'}">${euros(f.total).replace('+', '')}</td>
        <td class="ranking-extra">${f.conPremio}</td>
      </tr>
    `).join('');
    cont.innerHTML = `
      ${totalGanado === 0 ? '<div class="ranking-paquetes">Sois unos paquetes</div>' : ''}
      <p class="resultados-todos-hint">Premios acumulados de cada columna en las ${nJornadas}.${hayPendientes ? ' Hay premios conseguidos cuyo importe aún no se conoce: se sumarán cuando estén.' : ''}</p>
      <div class="resultados-todos-tabla-scroll ranking-wrap">
        <table class="resultados-todos-tabla ranking-tabla">
          <thead><tr><th>#</th><th>Usuario</th><th>Premios</th><th>Jornadas con premio</th></tr></thead>
          <tbody>${filas}</tbody>
          <tfoot><tr><td></td><td>Total</td><td class="ranking-valor">${euros(totalGanado).replace('+', '')}</td><td></td></tr></tfoot>
        </table>
      </div>
    `;
  }

  $('#rankings-tabs').addEventListener('click', (e) => {
    const boton = e.target.closest('[data-ranking]');
    if (!boton) return;
    rankingActivo = boton.dataset.ranking;
    pintarRanking();
  });

  // ---------- UTIL ----------
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  init();
})();
