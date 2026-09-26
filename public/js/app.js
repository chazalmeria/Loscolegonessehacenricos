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
  let jornadaActualId = null;

  async function cargarJornada() {
    try {
      const data = await api('/api/jornada/current');
      if (!data.jornada) {
        jornadaActualId = null;
        $('#jornada-sin-datos').hidden = false;
        $('#jornada-tabla-wrap').hidden = true;
        mostrarEditorJornada(true);
        prepararEditorVacio();
        return;
      }
      jornadaActualId = data.jornada.id;
      $('#jornada-sin-datos').hidden = true;
      $('#jornada-titulo').textContent = `Jornada ${data.jornada.numero}` + (data.jornada.temporada ? ` (${data.jornada.temporada})` : '');
      pintarTablaJornada(data.partidos);
      pintarEstado(data.estado);
      pintarResultadosDeTodos(data.usuarios, data.partidos);
      $('#jornada-tabla-wrap').hidden = false;
      mostrarEditorJornada(false);
      prepararEditorVacio();
    } catch (e) { /* ignore */ }
  }

  function mostrarEditorJornada(forzarVisible) {
    $('#form-jornada-editor').hidden = !forzarVisible;
  }

  $('#btn-toggle-editor-jornada').addEventListener('click', () => {
    const editor = $('#form-jornada-editor');
    editor.hidden = !editor.hidden;
  });

  function prepararEditorVacio() {
    const wrap = $('#jornada-editor-partidos');
    if (wrap.dataset.listo) return;
    wrap.innerHTML = '';
    for (let i = 1; i <= 15; i++) {
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

  $('#form-jornada-editor').addEventListener('submit', async (e) => {
    e.preventDefault();
    const numero = $('#jornada-numero').value.trim();
    const temporada = $('#jornada-temporada').value.trim();
    const partidos = [];
    for (let i = 0; i < 15; i++) {
      const local = $(`input[data-idx="${i}"][data-campo="local"]`).value.trim();
      const visitante = $(`input[data-idx="${i}"][data-campo="visitante"]`).value.trim();
      if (local && visitante) partidos.push({ local, visitante });
    }
    const plenoLocal = $('#pleno-local').value.trim();
    const plenoVisitante = $('#pleno-visitante').value.trim();

    if (!numero || partidos.length === 0) {
      alert('Pon al menos el número de jornada y un partido.');
      return;
    }

    try {
      await api('/api/jornada', {
        method: 'POST',
        body: JSON.stringify({
          numero,
          temporada,
          partidos,
          pleno: plenoLocal && plenoVisitante ? { local: plenoLocal, visitante: plenoVisitante } : null,
        }),
      });
      e.target.reset();
      $('#jornada-editor-partidos').dataset.listo = '';
      await cargarJornada();
    } catch (err) {
      alert(err.message);
    }
  });

  function pintarTablaJornada(partidos) {
    const body = $('#jornada-tabla-body');
    body.innerHTML = '';
    const plenoWrap = $('#pleno-form');
    plenoWrap.innerHTML = '';

    partidos.filter((p) => !p.es_pleno).forEach((p) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${p.orden}</td>
        <td>${escapeHtml(p.equipo_local)} - ${escapeHtml(p.equipo_visitante)}</td>
        ${['1', 'X', '2'].map((v) => `
          <td><input type="radio" name="partido-${p.id}" value="${v}" ${p.mi_pronostico === v ? 'checked' : ''} /></td>
        `).join('')}
      `;
      body.appendChild(tr);
    });

    const pleno = partidos.find((p) => p.es_pleno);
    if (pleno) {
      const [gl, gv] = (pleno.mi_pronostico || '-').split('-');
      plenoWrap.innerHTML = `
        <strong>Pleno al 15:</strong> ${escapeHtml(pleno.equipo_local)}
        <input type="number" min="0" id="pleno-goles-local" value="${gl && gl !== '-' ? gl : ''}" />
        -
        <input type="number" min="0" id="pleno-goles-visitante" value="${gv || ''}" />
        ${escapeHtml(pleno.equipo_visitante)}
        <input type="hidden" id="pleno-partido-id" value="${pleno.id}" />
      `;
    }
  }

  function pintarEstado(estado) {
    const ul = $('#jornada-estado');
    ul.innerHTML = '';
    estado.forEach((u) => {
      const li = document.createElement('li');
      li.className = u.completado ? 'completado' : '';
      li.textContent = `${u.username}: ${u.rellenados}/${u.total}${u.completado ? ' ✓' : ''}`;
      ul.appendChild(li);
    });
  }

  function pintarResultadosDeTodos(usuarios, partidos) {
    const cabecera = $('#resultados-todos-cabecera');
    const cuerpo = $('#resultados-todos-cuerpo');

    cabecera.innerHTML = `
      <tr>
        <th>Partido</th>
        ${usuarios.map((u) => `<th>${escapeHtml(u)}</th>`).join('')}
      </tr>
    `;

    cuerpo.innerHTML = partidos.map((p) => {
      const etiqueta = (p.es_pleno ? 'Pleno al 15: ' : '') + `${escapeHtml(p.equipo_local)} - ${escapeHtml(p.equipo_visitante)}`;
      const celdas = usuarios.map((u) => {
        const valor = (p.predicciones && p.predicciones[u]) || '';
        return valor
          ? `<td class="valor-relleno">${escapeHtml(valor)}</td>`
          : `<td class="valor-vacio">—</td>`;
      }).join('');
      return `<tr><td>${etiqueta}</td>${celdas}</tr>`;
    }).join('');
  }

  $('#btn-guardar-predicciones').addEventListener('click', async () => {
    if (!jornadaActualId) return;
    const predicciones = {};
    $$('#jornada-tabla-body tr').forEach((tr) => {
      const checked = tr.querySelector('input[type="radio"]:checked');
      if (checked) {
        const partidoId = checked.name.replace('partido-', '');
        predicciones[partidoId] = checked.value;
      }
    });
    const plenoIdInput = $('#pleno-partido-id');
    if (plenoIdInput) {
      const gl = $('#pleno-goles-local').value;
      const gv = $('#pleno-goles-visitante').value;
      if (gl !== '' && gv !== '') {
        predicciones[plenoIdInput.value] = `${gl}-${gv}`;
      }
    }

    try {
      await api('/api/jornada/predicciones', {
        method: 'POST',
        body: JSON.stringify({ predicciones }),
      });
      $('#guardar-ok').hidden = false;
      setTimeout(() => ($('#guardar-ok').hidden = true), 2000);
      const data = await api('/api/jornada/current');
      if (data.jornada) {
        pintarEstado(data.estado);
        pintarResultadosDeTodos(data.usuarios, data.partidos);
      }
    } catch (err) {
      alert(err.message);
    }
  });

  // ---------- HISTORIAL ----------
  async function cargarHistorial() {
    try {
      const { usuarios, historial } = await api('/api/historial');
      const tabsWrap = $('#historial-tabs');
      tabsWrap.innerHTML = '';
      usuarios.forEach((u, idx) => {
        const btn = document.createElement('button');
        btn.textContent = u;
        if (idx === 0) btn.classList.add('active');
        btn.addEventListener('click', () => {
          $$('#historial-tabs button').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          pintarHistorialUsuario(historial[u]);
        });
        tabsWrap.appendChild(btn);
      });
      if (usuarios.length) pintarHistorialUsuario(historial[usuarios[0]]);
    } catch (e) { /* ignore */ }
  }

  function pintarHistorialUsuario(jornadas) {
    const cont = $('#historial-contenido');
    cont.innerHTML = '';
    if (!jornadas || jornadas.length === 0) {
      cont.innerHTML = '<div class="empty-state"><p>Todavía no hay jornadas cerradas en el historial.</p></div>';
      return;
    }
    jornadas.forEach((j) => {
      const div = document.createElement('div');
      div.className = 'historial-jornada';
      const filas = j.partidos.map((p) => `
        <tr>
          <td>${p.es_pleno ? 'Pleno al 15: ' : ''}${escapeHtml(p.equipo_local)} - ${escapeHtml(p.equipo_visitante)}</td>
          <td class="pronostico">${p.pronostico ? escapeHtml(p.pronostico) : '—'}</td>
        </tr>
      `).join('');
      div.innerHTML = `<h4>Jornada ${escapeHtml(j.numero)}${j.temporada ? ` (${escapeHtml(j.temporada)})` : ''}</h4><table>${filas}</table>`;
      cont.appendChild(div);
    });
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
