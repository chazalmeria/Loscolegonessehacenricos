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
    ultimoMensajeId = 0;
    $('#chat-messages').innerHTML = '';
    cargarChat();
    iniciarSondeoChat();
    cargarJornada();
    cargarHistorial();
  }

  // ---------- MENU LATERAL ----------
  $$('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.nav-item').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      $$('.tab-panel').forEach((p) => p.classList.remove('active'));
      $(`#tab-${btn.dataset.tab}`).classList.add('active');
    });
  });

  // ---------- CHAT (sondeo periodico, sin websockets: compatible con Vercel) ----------
  function pintarMensaje(msg) {
    const div = document.createElement('div');
    div.className = 'chat-msg' + (msg.username === currentUser ? ' mio' : '');
    const hora = new Date(msg.created_at.replace(' ', 'T') + 'Z').toLocaleTimeString('es-ES', {
      hour: '2-digit', minute: '2-digit',
    });
    div.innerHTML = `<span class="autor">${escapeHtml(msg.username)}<span class="hora">${hora}</span></span>${escapeHtml(msg.text)}`;
    $('#chat-messages').appendChild(div);
    $('#chat-messages').scrollTop = $('#chat-messages').scrollHeight;
    if (msg.id > ultimoMensajeId) ultimoMensajeId = msg.id;
  }

  async function cargarChat() {
    try {
      const { messages } = await api(`/api/chat/messages?since=${ultimoMensajeId}`);
      messages.forEach(pintarMensaje);
    } catch (e) { /* ignore */ }
  }

  function iniciarSondeoChat() {
    detenerSondeoChat();
    chatPollHandle = setInterval(cargarChat, 4000);
  }

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
  // y la que llega de loteriasapi.com. Cada una se pinta en su propio bloque.
  let usuariosJornada = [];
  const bloquesJornada = new Map(); // jornada id -> { jornada, partidos, estado } (lo ultimo pintado)
  const editandoResultados = new Set(); // jornadas con "Poner resultados" abierto

  async function cargarJornada() {
    try {
      const data = await api('/api/jornada/current');
      usuariosJornada = data.usuarios || [];
      const jornadas = data.jornadas || [];
      const manuales = jornadas.filter((j) => j.jornada.manual);
      const deLaApi = jornadas.find((j) => !j.jornada.manual);
      bloquesJornada.clear();

      $('#jornadas-manuales').innerHTML = manuales.map(htmlBloqueJornada).join('');
      $('#jornada-api').innerHTML = deLaApi
        ? htmlBloqueJornada(deLaApi)
        : `<div class="empty-state"><p>Todavía no hay jornada de la API. En cuanto loteriasapi.com publique los partidos aparecerá aquí sola. Si no funciona, usa "Crear jornada manualmente".</p></div>`;
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

  function htmlBloqueJornada({ jornada, partidos, estado }) {
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

    bloquesJornada.set(jornada.id, { jornada, partidos, estado });

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

        ${htmlResultadosDeTodos(jornada, partidos)}
      </section>
    `;
  }

  // "Resultados de todos" de un bloque. Se repinta por separado al entrar o
  // salir del modo "Poner resultados", para no perder pronosticos sin guardar.
  function htmlResultadosDeTodos(jornada, partidos) {
    const editable = editandoResultados.has(jornada.id);
    const tabla = htmlTablaResultados(usuariosJornada, partidos, {
      editable,
      conColumnaResultado: editable || !jornada.manual || partidos.some((p) => p.resultado),
    });

    let hint = 'Lo que ha puesto cada uno. En verde los aciertos y en rojo los fallos, según se van conociendo los resultados.';
    if (editable) {
      hint = 'Pon el signo de cada partido ya jugado (y los goles del Pleno al 15). Deja en blanco lo que no sepas. La API no cambia lo que pongáis a mano; si lo borras, lo volverá a rellenar ella.';
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
      </div>
    `;
  }

  function repintarResultados(bloque, jornadaId) {
    const datos = bloquesJornada.get(jornadaId);
    if (!datos) return;
    bloque.querySelector('.resultados-todos-wrap').outerHTML = htmlResultadosDeTodos(datos.jornada, datos.partidos);
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
    if (accion === 'poner-resultados' || accion === 'cancelar-resultados') {
      if (accion === 'poner-resultados') editandoResultados.add(jornadaId);
      else editandoResultados.delete(jornadaId);
      repintarResultados(bloque, jornadaId);
    }
    if (accion === 'guardar-resultados') await guardarResultados(bloque, jornadaId);
  });

  async function guardarResultados(bloque, jornadaId) {
    const resultados = {};
    bloque.querySelectorAll('[data-res-partido]').forEach((sel) => {
      resultados[sel.dataset.resPartido] = sel.value;
    });
    const pleno = bloque.querySelector('[data-res-pleno]');
    if (pleno) {
      const gl = pleno.querySelector('[data-res-goles="local"]').value.trim();
      const gv = pleno.querySelector('[data-res-goles="visitante"]').value.trim();
      if ((gl === '') !== (gv === '')) {
        alert('En el Pleno al 15 pon los goles de los dos equipos (o deja los dos en blanco).');
        return;
      }
      resultados[pleno.dataset.resPleno] = gl === '' ? '' : `${Number(gl)}-${Number(gv)}`;
    }

    try {
      await api(`/api/jornada/${jornadaId}/resultados`, {
        method: 'POST',
        body: JSON.stringify({ resultados }),
      });
      editandoResultados.delete(jornadaId);
      await cargarJornada();
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
    if (!confirm(`¿Pasar "${titulo}" al histórico? Ya no se podrán cambiar los pronósticos.`)) return;
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
            <input type="number" min="0" max="99" data-res-goles="local" value="${escapeHtml(gl || '')}" aria-label="Goles local" />
            -
            <input type="number" min="0" max="99" data-res-goles="visitante" value="${escapeHtml(gv || '')}" aria-label="Goles visitante" />
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
  function htmlTablaResultados(usuarios, partidos, { conColumnaResultado = true, editable = false } = {}) {
    const aciertos = Object.fromEntries(usuarios.map((u) => [u, 0]));
    const conResultado = partidos.filter((p) => p.resultado).length;

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
        if (acierto) aciertos[u]++;
        const clase = acierto === true ? 'acierto' : acierto === false ? 'fallo' : 'valor-relleno';
        return `<td class="${clase}">${escapeHtml(valor)}</td>`;
      }).join('');
      return `<tr><td>${etiqueta}</td>${resultado}${celdas}</tr>`;
    }).join('');

    const pie = conResultado === 0 ? '' : `
      <tr>
        <td>Aciertos</td>
        <td class="col-resultado">${conResultado}/${partidos.length}</td>
        ${usuarios.map((u) => `<td>${aciertos[u]}/${conResultado}</td>`).join('')}
      </tr>
    `;

    return { cabecera, cuerpo, pie };
  }

  // ---------- HISTORIAL (una pestaña por jornada cerrada, con la tabla de Resultados de todos) ----------
  async function cargarHistorial() {
    try {
      const { usuarios, jornadas } = await api('/api/historial');
      const tabsWrap = $('#historial-tabs');
      tabsWrap.innerHTML = '';

      if (!jornadas || jornadas.length === 0) {
        $('#historial-contenido').innerHTML =
          '<div class="empty-state"><p>Todavía no hay jornadas cerradas en el historial. En cuanto se cargue una jornada nueva, la anterior aparecerá aquí.</p></div>';
        return;
      }

      jornadas.forEach((j, idx) => {
        const btn = document.createElement('button');
        btn.textContent = j.manual ? `${j.numero} (a mano)` : `Jornada ${j.numero}`;
        if (idx === 0) btn.classList.add('active');
        btn.addEventListener('click', () => {
          $$('#historial-tabs button').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          pintarHistorialJornada(usuarios, j);
        });
        tabsWrap.appendChild(btn);
      });

      pintarHistorialJornada(usuarios, jornadas[0]);
    } catch (e) {
      console.error('Error cargando el historial:', e);
    }
  }

  function pintarHistorialJornada(usuarios, jornada) {
    const cont = $('#historial-contenido');
    if (!jornada) {
      cont.innerHTML = '<div class="empty-state"><p>Todavía no hay jornadas cerradas en el historial.</p></div>';
      return;
    }

    const { cabecera, cuerpo, pie } = htmlTablaResultados(usuarios, jornada.partidos, {
      conColumnaResultado: !jornada.manual || jornada.partidos.some((p) => p.resultado),
    });

    cont.innerHTML = `
      <h3>${tituloJornada(jornada)}</h3>
      <div class="resultados-todos-tabla-scroll">
        <table class="resultados-todos-tabla">
          <thead>${cabecera}</thead>
          <tbody>${cuerpo}</tbody>
          <tfoot>${pie}</tfoot>
        </table>
      </div>
    `;
  }

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
