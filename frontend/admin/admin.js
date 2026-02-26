// admin/admin.js — Panel de administración JR Stars

// ── AUTH ──────────────────────────────────────────────
const token = localStorage.getItem('jr_admin_token');
if (!token) window.location.href = '/admin/login';

document.getElementById('admin-email').textContent =
  localStorage.getItem('jr_admin_email') || '';

const H = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${token}`
};

function logout() {
  localStorage.removeItem('jr_admin_token');
  localStorage.removeItem('jr_admin_email');
  window.location.href = '/admin/login';
}

// ── SIDEBAR MOBILE ────────────────────────────────────
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  sidebar.classList.toggle('open');
  overlay.classList.toggle('visible');
  document.body.style.overflow = sidebar.classList.contains('open') ? 'hidden' : '';
}

function closeSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  sidebar.classList.remove('open');
  overlay.classList.remove('visible');
  document.body.style.overflow = '';
}

// ── NAVEGACIÓN ────────────────────────────────────────
let scannerInit = false;
let paginaActual = 'stats';

function goTo(page, ev) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
  document.getElementById(`page-${page}`).classList.add('active');
  const navItem = document.getElementById(`nav-${page}`);
  if (navItem) navItem.classList.add('active');

  paginaActual = page;
  closeSidebar();

  if (page === 'stats') loadStats();
  if (page === 'alumnos') loadAlumnos();
  if (page === 'batidos') loadCreditos();
  if (page === 'rendimiento') resetBioSearch();
  if (page === 'ranking') cargarRanking();
  if (page === 'entrenadores') loadEntrenadores();
  if (page === 'scanner' && !scannerInit) initScanner();
}

// Barra de navegación inferior (móvil)
function setBottomNav(page) {
  document.querySelectorAll('.bottom-nav-item').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById(`bnav-${page}`);
  if (btn) btn.classList.add('active');
}

// ── TOAST ─────────────────────────────────────────────
function showToast(msg, type = 'ok') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast visible ${type === 'error' ? 'error' : ''}`;
  setTimeout(() => t.classList.remove('visible'), 3000);
}

// ── STATS ─────────────────────────────────────────────
async function loadStats() {
  try {
    const res = await fetch('/admin/stats', { headers: H });
    if (res.status === 401) { logout(); return; }
    const d = await res.json();
    document.getElementById('s-total').textContent = d.total_alumnos;
    document.getElementById('s-presentes').textContent = d.presentes_hoy;
    document.getElementById('s-ausentes').textContent = d.ausentes_hoy;
    document.getElementById('s-fecha').textContent = d.fecha;
  } catch { }
}

// ── SCANNER ───────────────────────────────────────────
function initScanner() {
  scannerInit = true;
  const scanner = new Html5QrcodeScanner('admin-reader', {
    fps: 15,
    qrbox: { width: 250, height: 250 }
  });
  scanner.render(async (code) => {
    scanner.pause();
    const clean = code.includes('?code=') ? code.split('?code=')[1] : code;
    try {
      const res = await fetch('/attendance/scan', {
        method: 'POST',
        headers: H,
        body: JSON.stringify({ code: clean })
      });
      const d = await res.json();
      const el = document.getElementById('scan-result');
      el.style.display = 'block';
      el.className = `scan-result ${d.status}`;

      if (d.status === 'debe') {
        el.innerHTML = `🚫 <strong>${d.student_name}</strong><br>
          <span style="color:#ff6ec7;font-size:.85rem">MENSUALIDAD VENCIDA</span><br>
          <span style="font-size:.8rem;opacity:.8">${d.detalle || ''}</span>`;
      } else {
        el.innerHTML = d.message;
      }

      const li = document.createElement('li');
      li.style.cssText = 'padding:.5rem 0;border-bottom:1px solid var(--border);font-family:var(--font-cond);font-size:.9rem';
      const color = d.status === 'debe' ? '#e91e8c' : 'var(--gold)';
      li.innerHTML = `<strong style="color:${color}">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong> — ${d.student_name || clean}`;
      document.getElementById('scan-history').prepend(li);

      setTimeout(() => { el.style.display = 'none'; scanner.resume(); }, 3000);
    } catch { setTimeout(() => scanner.resume(), 2000); }
  });
}


// ── ALUMNOS (Registro + Cobro Inicial y Tabla Semáforo) ──
let alumnosData = []; // cache para filtros

async function loadAlumnos() {
  const res = await fetch('/admin/alumnos', { headers: H });
  if (res.status === 401) { logout(); return; }
  alumnosData = await res.json();
  renderAlumnos(alumnosData);
}

function aplicarFiltros() {
  const estado = document.getElementById('filtro-estado')?.value || '';
  const horario = document.getElementById('filtro-horario')?.value || '';
  const busqueda = (document.getElementById('filtro-busqueda')?.value || '').toLowerCase().trim();
  const hoy = new Date();

  const filtrados = alumnosData.filter(a => {
    // Filtro búsqueda de texto
    if (busqueda && !a.full_name.toLowerCase().includes(busqueda)) return false;
    // Filtro horario
    if (horario && a.horario !== horario) return false;
    // Filtro estado
    if (estado) {
      if (estado === 'inactivo' && a.is_active !== false) return false;
      if (estado !== 'inactivo' && !a.is_active) return false;
      if (estado === 'al-dia') {
        // Sin fecha de vencimiento = sin pago = no está al día
        if (!a.valid_until) return false;
        const f = new Date(a.valid_until); f.setMinutes(f.getMinutes() + f.getTimezoneOffset());
        if (f < hoy) return false;
      }
      if (estado === 'vencido') {
        // Sin fecha de vencimiento = sin pago = se considera vencido
        if (!a.valid_until) return true;
        const f = new Date(a.valid_until); f.setMinutes(f.getMinutes() + f.getTimezoneOffset());
        if (f >= hoy) return false;
      }
    }
    return true;
  });

  renderAlumnos(filtrados);
}

function renderAlumnos(data) {
  const container = document.getElementById('alumnos-list');
  if (!data.length) {
    container.innerHTML = '<p style="color:var(--gray);font-family:var(--font-cond);padding:1rem 0">No se encontraron alumnos con esos filtros.</p>';
    return;
  }
  const hoy = new Date();

  // Vista mobile: cards en lugar de tabla
  const esMobile = window.innerWidth <= 700;

  if (esMobile) {
    container.innerHTML = data.map(a => {
      let estadoColor = 'var(--red2)', estadoTexto = 'Inactivo', vencimiento = '—';
      if (a.is_active) {
        if (a.valid_until) {
          const fv = new Date(a.valid_until); fv.setMinutes(fv.getMinutes() + fv.getTimezoneOffset());
          vencimiento = fv.toLocaleDateString('es-PE');
          if (fv >= hoy) { estadoColor = '#00ff88'; estadoTexto = 'Al Día'; }
          else { estadoColor = 'var(--gold)'; estadoTexto = 'Vencido'; }
        } else { estadoColor = 'var(--gold)'; estadoTexto = 'Sin Pago'; }
      }
      return `
      <div class="alumno-card" style="opacity:${a.is_active ? '1' : '0.55'}">
        <div class="alumno-card-header">
          <div>
            <div class="alumno-card-name">${a.full_name}</div>
            <div style="font-size:.72rem;color:var(--gray);font-family:var(--font-mono)">DNI: ${a.dni || '—'}</div>
          </div>
          <span style="color:${estadoColor};font-weight:bold;font-size:.8rem;font-family:var(--font-cond)">${estadoTexto}</span>
        </div>
        <div class="alumno-card-row">
          <span class="badge badge-gold">${a.horario || 'LMV'}</span>
          <span style="font-family:var(--font-mono);font-size:.8rem;color:var(--gray)">Vence: ${vencimiento}</span>
        </div>
        <div class="alumno-card-actions">
          <button class="btn btn-outline" style="font-size:.75rem;padding:.3rem .9rem" onclick="verQR('${a.id}')">📱 QR</button>
          ${a.is_active
          ? `<button class="btn btn-red" style="font-size:.75rem;padding:.3rem .9rem" onclick="toggleEstadoAlumno('${a.id}','${a.full_name.replace(/'/g, "\\'")}', false)">Desactivar</button>`
          : `<button class="btn btn-outline" style="font-size:.75rem;padding:.3rem .9rem;border-color:#00ff88;color:#00ff88" onclick="toggleEstadoAlumno('${a.id}','${a.full_name.replace(/'/g, "\\'")}', true)">Reactivar</button>`
        }
        </div>
      </div>`;
    }).join('');
  } else {
    container.innerHTML = `
    <table class="admin-table">
      <thead><tr>
        <th>Nombre</th><th>Estado</th><th>Vence</th><th>Horario</th><th>Acciones</th>
      </tr></thead>
      <tbody>
        ${data.map(a => {
      let estadoColor = 'var(--red2)', estadoTexto = 'Inactivo', vencimiento = '—';
      if (a.is_active) {
        if (a.valid_until) {
          const fv = new Date(a.valid_until); fv.setMinutes(fv.getMinutes() + fv.getTimezoneOffset());
          vencimiento = fv.toLocaleDateString('es-PE');
          if (fv >= hoy) { estadoColor = '#00ff88'; estadoTexto = 'Al Día'; }
          else { estadoColor = 'var(--gold)'; estadoTexto = 'Vencido'; }
        } else { estadoColor = 'var(--gold)'; estadoTexto = 'Sin Pago'; }
      }
      return `
          <tr style="opacity:${a.is_active ? '1' : '0.5'}">
            <td><strong>${a.full_name}</strong><br><span style="font-size:.75rem;color:var(--gray)">DNI: ${a.dni || '—'}</span></td>
            <td><span style="color:${estadoColor};font-weight:bold;font-size:.85rem">${estadoTexto}</span></td>
            <td style="font-family:var(--font-mono);font-size:.85rem">${vencimiento}</td>
            <td><span class="badge badge-gold">${a.horario || 'LMV'}</span></td>
            <td>
              <button class="btn btn-outline" style="font-size:.75rem;padding:.3rem .7rem" onclick="verQR('${a.id}')">QR</button>
              ${a.is_active
          ? `<button class="btn btn-red" style="font-size:.75rem;padding:.3rem .7rem;margin-left:.3rem" onclick="toggleEstadoAlumno('${a.id}','${a.full_name.replace(/'/g, "\\'")}', false)">Desactivar</button>`
          : `<button class="btn btn-outline" style="font-size:.75rem;padding:.3rem .7rem;margin-left:.3rem;border-color:#00ff88;color:#00ff88" onclick="toggleEstadoAlumno('${a.id}','${a.full_name.replace(/'/g, "\\'")}', true)">Reactivar</button>`
        }
            </td>
          </tr>`;
    }).join('')}
      </tbody>
    </table>`;
  }
}

async function crearAlumno() {
  const nombre = document.getElementById('a-nombre').value.trim();
  const dni = document.getElementById('a-dni').value.trim();
  const apoderado = document.getElementById('a-apoderado').value.trim();
  const telefono = document.getElementById('a-telefono').value.trim();
  const pagoMes = parseFloat(document.getElementById('a-pago-mes').value) || 0;
  const pagoMat = parseFloat(document.getElementById('a-pago-mat').value) || 0;
  const metodo = document.getElementById('a-metodo').value;

  if (!nombre) return showToast('El nombre es obligatorio', 'error');

  const res = await fetch('/admin/alumnos', {
    method: 'POST',
    headers: H,
    body: JSON.stringify({
      full_name: nombre,
      dni: dni || null,
      parent_name: apoderado || null,
      parent_phone: telefono || null,
      horario: document.getElementById('a-horario').value,
      turno: document.getElementById('a-turno')?.value || null,
      sede: null,
      pago_mensualidad: pagoMes,
      pago_matricula: pagoMat,
      metodo_pago: metodo
    })
  });

  if (res.ok) {
    document.getElementById('a-nombre').value = '';
    document.getElementById('a-dni').value = '';
    document.getElementById('a-apoderado').value = '';
    document.getElementById('a-telefono').value = '';
    showToast('✅ Alumno inscrito. Cobro registrado.');
    loadAlumnos();
  } else {
    showToast('❌ Error. ¿DNI duplicado?', 'error');
  }
}

async function toggleEstadoAlumno(id, nombre, reactivar) {
  const accion = reactivar ? 'Reactivar' : 'Desactivar';
  if (!confirm(`¿${accion} a ${nombre}?`)) return;
  await fetch(`/admin/alumnos/${id}`, { method: 'DELETE', headers: H });
  showToast(`✅ Alumno actualizado`);
  loadAlumnos();
}

async function verQR(studentId) {
  try {
    const res = await fetch(`/credentials/${studentId}`, { headers: H });
    const data = await res.json();
    let codeStr = '';
    if (data.length > 0) {
      codeStr = data[0].code;
    } else {
      showToast('Generando nuevo QR...', 'ok');
      const gen = await fetch(`/credentials/generate/${studentId}`, { method: 'POST', headers: H });
      const d = await gen.json();
      codeStr = d.code;
    }
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${codeStr}`;
    window.open(qrImageUrl, '_blank');
  } catch {
    showToast('❌ Error al obtener el QR.', 'error');
  }
}

// ── CAJA / PAGOS — BÚSQUEDA POR NOMBRE ───────────────────
let searchDebounce = null;
let chipActivo = 'todos';
let alumnoSeleccionado = null;

function loadCreditos() {
  const container = document.getElementById('creditos-result');
  if (!container) return;
  container.innerHTML = `
    <div class="empty-search-state">
      <div class="empty-icon">👆</div>
      <p>Escribe el nombre del alumno para buscarlo</p>
    </div>`;
  const input = document.getElementById('batidos-nombre-search');
  if (input) {
    input.value = '';
    cerrarDropdown();
  }
  alumnoSeleccionado = null;
  actualizarBtnClear();
  // Resetear chip activo al navegar a esta sección
  chipActivo = 'todos';
  document.querySelectorAll('.filtro-chip').forEach(c => c.classList.remove('active'));
  const chipTodos = document.getElementById('chip-todos');
  if (chipTodos) chipTodos.classList.add('active');
}

function onSearchInput() {
  clearTimeout(searchDebounce);
  actualizarBtnClear();
  const q = document.getElementById('batidos-nombre-search')?.value?.trim();
  if (!q || q.length < 2) {
    cerrarDropdown();
    return;
  }
  searchDebounce = setTimeout(() => buscarPorNombre(q), 380);
}

function onSearchKeydown(e) {
  const dropdown = document.getElementById('search-dropdown');
  const items = dropdown.querySelectorAll('.dropdown-item');
  const focused = dropdown.querySelector('.dropdown-item.focused');
  let idx = Array.from(items).indexOf(focused);

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (idx < items.length - 1) {
      if (focused) focused.classList.remove('focused');
      items[idx + 1].classList.add('focused');
      items[idx + 1].scrollIntoView({ block: 'nearest' });
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (idx > 0) {
      if (focused) focused.classList.remove('focused');
      items[idx - 1].classList.add('focused');
      items[idx - 1].scrollIntoView({ block: 'nearest' });
    }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (focused) focused.click();
  } else if (e.key === 'Escape') {
    cerrarDropdown();
  }
}

let ultimosResultados = []; // Cache del último resultado de búsqueda

async function buscarPorNombre(q) {
  const dropdown = document.getElementById('search-dropdown');
  dropdown.innerHTML = '<div class="dropdown-loading">Buscando…</div>';
  dropdown.classList.add('visible');
  try {
    const res = await fetch(`/admin/alumnos/buscar?q=${encodeURIComponent(q)}`, { headers: H });
    if (res.status === 401) { logout(); return; }
    let resultados = await res.json();
    ultimosResultados = resultados; // Guardar en cache

    // Aplicar filtro de chip activo
    resultados = filtrarPorChip(resultados);

    if (!resultados.length) {
      dropdown.innerHTML = '<div class="dropdown-empty">No se encontraron alumnos</div>';
      return;
    }

    dropdown.innerHTML = resultados.map(a => {
      const dias = a.dias_restantes || 0;
      const estado = !a.is_active ? '<span class="dd-badge inactivo">Inactivo</span>'
        : dias > 0 ? `<span class="dd-badge al-dia">Al Día · ${dias}d</span>`
          : '<span class="dd-badge vencido">Vencido</span>';
      return `<div class="dropdown-item" onclick="seleccionarAlumno('${a.id}')">
        <div class="dd-nombre">${a.full_name}</div>
        <div class="dd-meta">
          <span class="dd-horario">${a.horario || 'LMV'}</span>
          ${estado}
        </div>
      </div>`;
    }).join('');
  } catch {
    dropdown.innerHTML = '<div class="dropdown-empty">Error de conexión</div>';
  }
}

function filtrarPorChip(lista) {
  if (chipActivo === 'todos') return lista;
  return lista.filter(a => {
    if (chipActivo === 'lmv') return a.horario === 'LMV';
    if (chipActivo === 'mjs') return a.horario === 'MJS';
    // Para filtros de estado, excluir inactivos
    if (!a.is_active) return false;
    if (chipActivo === 'al-dia') return (a.dias_restantes ?? 0) > 0;
    if (chipActivo === 'vencido') return (a.dias_restantes ?? 0) <= 0;
    return true;
  });
}

function setChip(chip, ev) {
  chipActivo = chip;
  document.querySelectorAll('.filtro-chip').forEach(c => c.classList.remove('active'));
  const chipEl = document.getElementById(`chip-${chip}`);
  if (chipEl) chipEl.classList.add('active');
  // Re-buscar si hay texto en el input
  const q = document.getElementById('batidos-nombre-search')?.value?.trim();
  if (q && q.length >= 2) {
    buscarPorNombre(q);
  } else {
    // Sin texto: cerrar dropdown para no mostrar resultados vacíos
    cerrarDropdown();
  }
}

function cerrarDropdown() {
  const d = document.getElementById('search-dropdown');
  if (d) { d.innerHTML = ''; d.classList.remove('visible'); }
}

function actualizarBtnClear() {
  const val = document.getElementById('batidos-nombre-search')?.value || '';
  const btn = document.getElementById('btn-clear-search');
  if (btn) btn.style.display = val ? 'flex' : 'none';
}

function limpiarBusqueda() {
  const input = document.getElementById('batidos-nombre-search');
  if (input) input.value = '';
  cerrarDropdown();
  actualizarBtnClear();
  document.getElementById('creditos-result').innerHTML = `
    <div class="empty-search-state">
      <div class="empty-icon">👆</div>
      <p>Escribe el nombre del alumno para buscarlo</p>
    </div>`;
  alumnoSeleccionado = null;
}

async function seleccionarAlumno(id) {
  cerrarDropdown();
  alumnoSeleccionado = id;

  const container = document.getElementById('creditos-result');
  container.innerHTML = '<p style="color:var(--gray);padding:1rem">Cargando…</p>';

  try {
    // Buscar en el cache primero, si no hay, hacer fetch puntual
    let a = ultimosResultados.find(x => x.id === id);

    if (!a) {
      // Fetch de respaldo: buscar por ID en la lista completa
      const res = await fetch('/admin/alumnos', { headers: H });
      if (res.status === 401) { logout(); return; }
      const todos = await res.json();
      // Calcular días restantes
      const hoyDate = new Date();
      a = todos.find(x => x.id === id);
      if (a && a.valid_until) {
        const fv = new Date(a.valid_until);
        fv.setMinutes(fv.getMinutes() + fv.getTimezoneOffset());
        a.dias_restantes = Math.max(0, Math.floor((fv - hoyDate) / (1000 * 60 * 60 * 24)));
      }
    }

    if (!a) {
      container.innerHTML = '<p style="color:var(--red2)">Alumno no encontrado.</p>';
      return;
    }

    // Poner nombre en el input
    const input = document.getElementById('batidos-nombre-search');
    if (input) input.value = a.full_name;
    actualizarBtnClear();

    const dias = a.dias_restantes || 0;
    const estadoMensualidad = dias > 0
      ? `<span style="color:#00ff88;font-weight:bold">ACTIVO (${dias} días restantes)</span>`
      : `<span style="color:var(--red2);font-weight:bold">VENCIDO</span>`;

    container.innerHTML = `
      <div class="form-card alumno-pago-card">
        <div class="alumno-pago-header">
          <div>
            <div class="form-card-title" style="margin-bottom:.3rem">👤 ${a.full_name}</div>
            <div style="font-family:var(--font-cond);color:var(--gray);font-size:.88rem">
              DNI: ${a.dni || '—'} &nbsp;·&nbsp; Horario: <span class="badge badge-gold">${a.horario || 'LMV'}</span>
            </div>
          </div>
          <div style="text-align:right;font-family:var(--font-cond);font-size:.88rem">
            ${estadoMensualidad}
          </div>
        </div>

        <div class="pago-acciones">
          <div class="pago-opcion" onclick="pagarMensualidad('${a.id}')">
            <div class="pago-opcion-icon">💵</div>
            <div class="pago-opcion-info">
              <div class="pago-opcion-titulo">Mensualidad</div>
              <div class="pago-opcion-precio">S/ 80.00 / mes</div>
            </div>
            <button class="btn btn-gold pago-opcion-btn">Cobrar</button>
          </div>

          <div class="pago-opcion">
            <div class="pago-opcion-icon">🥤</div>
            <div class="pago-opcion-info">
              <div class="pago-opcion-titulo">Créditos Batidos</div>
              <div class="pago-opcion-precio">${a.batido_credits ?? 0} créditos actuales</div>
            </div>
            <div style="display:flex;align-items:center;gap:.5rem;flex-shrink:0">
              <input class="input-jr credit-input" type="number" min="1" max="20" value="4" id="cr-${a.id}">
              <button class="btn btn-outline pago-opcion-btn" style="border-color:var(--gold);color:var(--gold)" onclick="recargar('${a.id}')">+ Recargar</button>
            </div>
          </div>
        </div>
      </div>`;
  } catch {
    container.innerHTML = '<p style="color:var(--red2)">Error de conexión.</p>';
  }
}

async function pagarMensualidad(id) {
  const confirmacion = confirm('¿Confirmar el cobro de S/ 80 por 1 mes de entrenamiento?');
  if (!confirmacion) return;

  let metodo = prompt('¿Cómo pagó? (Escribe: Efectivo, Yape o Plin):', 'Efectivo');
  if (!metodo) return;

  const res = await fetch('/admin/mensualidades/pagar', {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ student_id: id, monto: 80.00, metodo: metodo })
  });

  if (res.ok) {
    const d = await res.json();
    showToast(`✅ Pago registrado. Vence el: ${d.nueva_fecha_vencimiento}`);
    seleccionarAlumno(id);
  } else {
    showToast('❌ Error al procesar el pago', 'error');
  }
}

async function recargar(id) {
  const cantidad = parseInt(document.getElementById(`cr-${id}`)?.value) || 4;
  const res = await fetch('/admin/batidos/recargar', {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ student_id: id, cantidad, motivo: 'Recarga Yape/Plin' })
  });
  const d = await res.json();
  if (res.ok) {
    showToast(`✅ ${d.alumno}: ahora tiene ${d.creditos_nuevos} cr.`);
    seleccionarAlumno(id);
  } else {
    showToast('❌ Error al recargar', 'error');
  }
}

// Cerrar dropdown al click fuera
document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-autocomplete-wrap')) cerrarDropdown();
});

// ── NOTICIAS ───────────────────────────────────────────
async function loadNoticias() {
  const res = await fetch('/admin/noticias', { headers: H });
  const data = await res.json();
  const container = document.getElementById('noticias-list');
  if (!data.length) { container.innerHTML = '<p style="color:var(--gray);font-family:var(--font-cond)">No hay noticias publicadas.</p>'; return; }
  container.innerHTML = data.map(n => `
    <div class="noticia-admin-card">
      <span class="emoji">${n.emoji || '📢'}</span>
      <div class="info">
        <div class="titulo">${n.titulo}</div>
        <div class="desc">${n.descripcion}</div>
        <div class="meta">${new Date(n.created_at).toLocaleDateString('es-PE')} · ${n.categoria}</div>
      </div>
      <button class="btn btn-red" style="font-size:.75rem;padding:.3rem .7rem;flex-shrink:0"
        onclick="eliminarNoticia('${n.id}')">✕</button>
    </div>
  `).join('');
}

async function crearNoticia() {
  const titulo = document.getElementById('n-titulo').value.trim();
  const desc = document.getElementById('n-desc').value.trim();
  if (!titulo || !desc) return;
  const res = await fetch('/admin/noticias', {
    method: 'POST',
    headers: H,
    body: JSON.stringify({
      titulo,
      descripcion: desc,
      categoria: document.getElementById('n-categoria').value,
      emoji: document.getElementById('n-emoji').value || '📢',
      imagen_url: document.getElementById('n-imagen').value || null
    })
  });
  if (res.ok) {
    document.getElementById('n-titulo').value = '';
    document.getElementById('n-desc').value = '';
    showToast('✅ Noticia publicada');
    loadNoticias();
  } else showToast('❌ Error al publicar', 'error');
}

async function eliminarNoticia(id) {
  await fetch(`/admin/noticias/${id}`, { method: 'DELETE', headers: H });
  showToast('✅ Noticia eliminada');
  loadNoticias();
}

// ── FOTOS ─────────────────────────────────────────────
async function loadFotos() {
  const res = await fetch('/admin/fotos', { headers: H });
  const data = await res.json();
  const grid = document.getElementById('fotos-grid');
  if (!data.length) { grid.innerHTML = '<p style="color:var(--gray);font-family:var(--font-cond)">No hay fotos aún.</p>'; return; }
  grid.innerHTML = data.map(f => `
    <div style="position:relative;aspect-ratio:1;background:var(--card);border:1px solid var(--border);overflow:hidden">
      <img src="${f.url}" style="width:100%;height:100%;object-fit:cover" onerror="this.parentElement.innerHTML='<div style=padding:1rem;font-size:.75rem;color:var(--gray)>Error al cargar</div>'">
      <div style="position:absolute;bottom:0;left:0;right:0;background:rgba(8,8,8,.8);padding:.4rem .6rem;font-family:var(--font-cond);font-size:.72rem;color:var(--gray)">
        ${f.descripcion || ''}
        <button onclick="eliminarFoto('${f.id}')" style="float:right;background:none;border:none;color:var(--red2);cursor:pointer;font-size:.9rem">✕</button>
      </div>
    </div>
  `).join('');
}

async function agregarFoto() {
  const url = document.getElementById('f-url').value.trim();
  const desc = document.getElementById('f-desc').value.trim();
  if (!url) return;
  const res = await fetch('/admin/fotos', {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ url, descripcion: desc })
  });
  if (res.ok) {
    document.getElementById('f-url').value = '';
    document.getElementById('f-desc').value = '';
    showToast('✅ Foto agregada');
    loadFotos();
  } else showToast('❌ Error al agregar foto', 'error');
}

async function eliminarFoto(id) {
  await fetch(`/admin/fotos/${id}`, { method: 'DELETE', headers: H });
  showToast('✅ Foto eliminada');
  loadFotos();
}

// ── INIT ──────────────────────────────────────────────
loadStats();

// ── RENDIMIENTO FÍSICO (BIOMETRÍA) ────────────────────
let _bioStudents = [];
let _bioSelected = null;

function resetBioSearch() {
  const inp = document.getElementById('bio-search');
  if (inp) inp.value = '';
  document.getElementById('bio-search-results').innerHTML = '';
  document.getElementById('bio-form-card').style.display = 'none';
  _bioSelected = null;
}

async function buscarParaBio() {
  const q = document.getElementById('bio-search').value.trim().toLowerCase();
  const el = document.getElementById('bio-search-results');
  if (q.length < 2) { el.innerHTML = ''; return; }

  if (!_bioStudents.length) {
    const res = await fetch('/admin/alumnos', { headers: H });
    _bioStudents = await res.json();
  }

  const hits = _bioStudents.filter(s =>
    s.full_name.toLowerCase().includes(q) ||
    (s.dni || '').includes(q)
  ).slice(0, 6);

  if (!hits.length) {
    el.innerHTML = '<p style="font-family:var(--font-cond);color:var(--gray);font-size:.85rem">Sin resultados.</p>';
    return;
  }

  el.innerHTML = hits.map(s => `
    <div class="alumno-card" style="cursor:pointer;margin-bottom:.5rem;padding:.6rem 1rem"
         onclick="seleccionarBioAlumno('${s.id}','${s.full_name.replace(/'/g, "\\'")}')"
         onmouseenter="this.style.borderColor='var(--gold)'"
         onmouseleave="this.style.borderColor='var(--border)'">
      <span style="font-family:var(--font-cond);font-weight:700">${s.full_name}</span>
      <span style="font-family:var(--font-mono);font-size:.72rem;color:var(--gray);margin-left:.5rem">${s.dni || ''}</span>
    </div>`).join('');
}

async function seleccionarBioAlumno(id, nombre) {
  _bioSelected = { id, nombre };
  document.getElementById('bio-student-id').value = id;
  document.getElementById('bio-alumno-label').textContent = `📋 ${nombre}`;
  document.getElementById('bio-search-results').innerHTML = '';
  document.getElementById('bio-search').value = nombre;

  // Mes actual como default
  const ahora = new Date();
  const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  document.getElementById('bio-fecha').value = `${meses[ahora.getMonth()]} ${ahora.getFullYear()}`;

  document.getElementById('bio-form-card').style.display = 'block';
  await cargarHistorialBio(id);
}

async function cargarHistorialBio(sid) {
  const wrap = document.getElementById('bio-historial-wrap');
  wrap.innerHTML = '<p style="font-family:var(--font-cond);color:var(--gray)">Cargando historial...</p>';
  try {
    const res = await fetch(`/admin/biometria/${sid}`, { headers: H });
    const data = await res.json();

    if (!data.length) {
      wrap.innerHTML = '<p style="font-family:var(--font-cond);color:var(--gray);font-size:.85rem">Sin mediciones registradas aún.</p>';
      return;
    }

    wrap.innerHTML = `
      <div style="font-family:var(--font-cond);font-size:.72rem;letter-spacing:.2em;text-transform:uppercase;color:var(--gold);margin-bottom:.6rem">// HISTORIAL BIOMÉTRICO</div>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-family:var(--font-cond)">
          <thead>
            <tr style="border-bottom:1px solid var(--border)">
              <th style="text-align:left;padding:.4rem .6rem;font-size:.72rem;letter-spacing:.12em;color:var(--gray)">Mes</th>
              <th style="padding:.4rem .6rem;font-size:.72rem;letter-spacing:.12em;color:var(--gray)">Talla</th>
              <th style="padding:.4rem .6rem;font-size:.72rem;letter-spacing:.12em;color:var(--gray)">Peso</th>
              <th style="padding:.4rem .6rem"></th>
            </tr>
          </thead>
          <tbody>
            ${data.map(r => `
              <tr style="border-bottom:1px solid rgba(255,255,255,.04)">
                <td style="padding:.4rem .6rem;color:var(--gray);font-size:.85rem">${r.fecha}</td>
                <td style="padding:.4rem .6rem;text-align:center;font-size:1rem;font-weight:700;color:var(--white)">${r.talla != null ? r.talla + 'm' : '—'}</td>
                <td style="padding:.4rem .6rem;text-align:center;font-size:1rem;font-weight:700;color:var(--white)">${r.peso != null ? r.peso + 'kg' : '—'}</td>
                <td style="padding:.4rem .6rem;text-align:right">
                  <button onclick="eliminarBio('${r.id}')" style="background:none;border:none;color:var(--red2);cursor:pointer;font-size:.9rem">✕</button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  } catch {
    wrap.innerHTML = '<p style="color:var(--red2);font-family:var(--font-cond)">Error al cargar historial.</p>';
  }
}

async function guardarBiometria() {
  const sid = document.getElementById('bio-student-id').value;
  const fecha = document.getElementById('bio-fecha').value.trim();
  const talla = parseFloat(document.getElementById('bio-talla').value);
  const peso = parseInt(document.getElementById('bio-peso').value);

  if (!sid || !fecha) return showToast('Completa mes y alumno', 'error');

  const body = { student_id: sid, fecha };
  if (!isNaN(talla)) body.talla = talla;
  if (!isNaN(peso)) body.peso = peso;

  const res = await fetch('/admin/biometria', {
    method: 'POST', headers: H, body: JSON.stringify(body)
  });

  if (res.ok) {
    showToast('✅ Medición guardada');
    document.getElementById('bio-talla').value = '';
    document.getElementById('bio-peso').value = '';
    await cargarHistorialBio(sid);
  } else {
    showToast('❌ Error al guardar', 'error');
  }
}

async function eliminarBio(id) {
  if (!confirm('¿Eliminar esta medición?')) return;
  await fetch(`/admin/biometria/${id}`, { method: 'DELETE', headers: H });
  showToast('✅ Eliminado');
  if (_bioSelected) await cargarHistorialBio(_bioSelected.id);
}

function cancelarBio() {
  document.getElementById('bio-form-card').style.display = 'none';
  document.getElementById('bio-search').value = '';
  document.getElementById('bio-search-results').innerHTML = '';
  _bioSelected = null;
}

// ── RANKING ───────────────────────────────────────────
async function cargarRanking() {
  const campo = document.getElementById('rk-campo')?.value || 'talla';
  const sede = document.getElementById('rk-sede')?.value || '';
  const cat = document.getElementById('rk-cat')?.value || '';
  const wrap = document.getElementById('ranking-table-wrap');
  if (!wrap) return;

  wrap.innerHTML = '<p style="font-family:var(--font-cond);color:var(--gray)">Cargando...</p>';

  const params = new URLSearchParams({ campo });
  if (sede) params.append('sede', sede);
  if (cat) params.append('categoria', cat);

  try {
    const res = await fetch(`/public/ranking?${params}`);
    const data = await res.json();

    if (!data.length) {
      wrap.innerHTML = '<p style="font-family:var(--font-cond);color:var(--gray)">Sin datos aún. Registra mediciones en la sección Rendimiento.</p>';
      return;
    }

    const label = campo === 'talla' ? 'Talla' : 'Peso';
    const unit = campo === 'talla' ? 'm' : 'kg';
    const emoji = campo === 'talla' ? '📏' : '⚖️';

    wrap.innerHTML = `
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-family:var(--font-cond)">
          <thead>
            <tr style="border-bottom:2px solid var(--border)">
              <th style="padding:.5rem .7rem;text-align:center;font-size:.72rem;letter-spacing:.12em;color:var(--gray)">#</th>
              <th style="padding:.5rem .7rem;text-align:left;font-size:.72rem;letter-spacing:.12em;color:var(--gray)">Atleta</th>
              <th style="padding:.5rem .7rem;text-align:center;font-size:.72rem;letter-spacing:.12em;color:var(--gray)">Sede</th>
              <th style="padding:.5rem .7rem;text-align:center;font-size:.72rem;letter-spacing:.12em;color:var(--gray)">Horario</th>
              <th style="padding:.5rem .7rem;text-align:center;font-size:.72rem;letter-spacing:.12em;color:var(--gold)">${emoji} ${label}</th>
              <th style="padding:.5rem .7rem;text-align:center;font-size:.72rem;letter-spacing:.12em;color:var(--gray)">Mes</th>
            </tr>
          </thead>
          <tbody>
            ${data.map((r, i) => `
              <tr style="border-bottom:1px solid rgba(255,255,255,.04);${i === 0 ? 'background:rgba(212,160,23,.07)' : ''}"
                  onmouseenter="this.style.background='rgba(255,255,255,.04)'"
                  onmouseleave="this.style.background='${i === 0 ? 'rgba(212,160,23,.07)' : ''}'"
              >
                <td style="padding:.5rem .7rem;text-align:center;font-family:var(--font-display);font-size:${i === 0 ? '1.4rem' : '1.1rem'};color:${i === 0 ? 'var(--gold)' : 'var(--gray)'}">${i + 1}</td>
                <td style="padding:.5rem .7rem;font-weight:700;color:var(--white)">${r.full_name}</td>
                <td style="padding:.5rem .7rem;text-align:center;color:var(--gray);font-size:.88rem">${r.sede || '—'}</td>
                <td style="padding:.5rem .7rem;text-align:center;color:var(--gray);font-size:.88rem">${r.horario || '—'}</td>
                <td style="padding:.5rem .7rem;text-align:center;font-size:1.1rem;font-weight:700;color:var(--white)">${r.valor}${unit}</td>
                <td style="padding:.5rem .7rem;text-align:center;color:var(--gray);font-size:.82rem">${r.fecha || '—'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  } catch {
    wrap.innerHTML = '<p style="color:var(--red2);font-family:var(--font-cond)">Error al cargar ranking.</p>';
  }
}



// ── ENTRENADORES ──────────────────────────────────────
let _entrenadoresData = [];

async function loadEntrenadores() {
  const el = document.getElementById('entrenadores-list');
  if (!el) return;
  el.innerHTML = '<p style="color:var(--gray);font-family:var(--font-cond)">Cargando...</p>';
  try {
    const res = await fetch('/admin/entrenadores', { headers: H });
    if (res.status === 401) { logout(); return; }
    _entrenadoresData = await res.json();
    renderEntrenadores();
  } catch {
    el.innerHTML = '<p style="color:var(--red2);font-family:var(--font-cond)">Error al cargar.</p>';
  }
}

function renderEntrenadores() {
  const el = document.getElementById('entrenadores-list');
  if (!_entrenadoresData.length) {
    el.innerHTML = '<p style="color:var(--gray);font-family:var(--font-cond)">No hay entrenadores creados aún.</p>';
    return;
  }
  el.innerHTML = _entrenadoresData.map(e => `
    <div class="alumno-card" style="opacity:${e.is_active ? '1' : '0.5'};flex-direction:column;align-items:stretch;gap:1rem;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div class="alumno-card-name">🏃 ${e.nombre}</div>
          <div style="font-family:var(--font-mono);font-size:.72rem;color:var(--gray)">${e.is_active ? '✅ Acceso habilitado' : '🚫 Acceso revocado'}</div>
        </div>
        <div class="alumno-card-actions">
          ${e.is_active
      ? `<button class="btn btn-red" style="font-size:.75rem;padding:.3rem .9rem"
                 onclick="toggleEntrenador('${e.id}', '${e.nombre.replace(/'/g, "\\'")}', false)">Revocar</button>`
      : `<button class="btn btn-outline" style="font-size:.75rem;padding:.3rem .9rem;border-color:#00ff88;color:#00ff88"
                 onclick="toggleEntrenador('${e.id}', '${e.nombre.replace(/'/g, "\\'")}', true)">Reactivar</button>`
    }
        </div>
      </div>
      ${e.is_active ? `
      <div style="background:var(--dark);padding:10px;border-radius:6px;display:flex;justify-content:space-between;align-items:center;">
        <div style="font-family:var(--font-mono);font-size:0.75rem;color:var(--gold);overflow:hidden;white-space:nowrap;text-overflow:ellipsis;margin-right:10px;">
          /entrenador/login?token=${e.token.substring(0, 8)}...
        </div>
        <button class="btn btn-gold" style="font-size:0.75rem;padding:0.4rem 0.8rem;" onclick="copyMagicLink('${e.token}')">📋 Copiar Enlace</button>
      </div>` : ''}
    </div>`).join('');
}

function copyMagicLink(token) {
  const url = window.location.origin + '/entrenador/login?token=' + token;
  navigator.clipboard.writeText(url).then(() => {
    showToast('✅ Enlace copiado. Envíalo por WhatsApp.');
  }).catch(err => {
    showToast('❌ Error al copiar enlace', 'error');
  });
}

async function crearEntrenador() {
  const nombre = document.getElementById('ent-nombre')?.value.trim();
  if (!nombre) return showToast('Completa el nombre', 'error');

  const res = await fetch('/admin/entrenadores', {
    method: 'POST', headers: H,
    body: JSON.stringify({ nombre })
  });
  if (!res.ok) return showToast('❌ Error al crear', 'error');

  const data = await res.json();
  document.getElementById('ent-nombre').value = '';
  showToast('✅ Entrenador creado.');
  // Automáticamente copiar
  copyMagicLink(data.token);
  loadEntrenadores();
}

async function toggleEntrenador(id, nombre, reactivar) {
  if (!confirm(`¿${reactivar ? 'Reactivar' : 'Desactivar'} a ${nombre}?`)) return;
  await fetch(`/admin/entrenadores/${id}?reactivar=${reactivar}`, { method: 'DELETE', headers: H });
  showToast('✅ Actualizado');
  loadEntrenadores();
}
