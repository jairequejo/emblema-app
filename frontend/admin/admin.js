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
  if (page === 'calendario') loadCalendario();
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
  const sede = document.getElementById('filtro-sede')?.value || '';
  const grupo = document.getElementById('filtro-grupo')?.value || '';
  const busqueda = (document.getElementById('filtro-busqueda')?.value || '').toLowerCase().trim();
  const hoy = new Date();

  const filtrados = alumnosData.filter(a => {
    // Filtro búsqueda de texto
    if (busqueda && !a.full_name.toLowerCase().includes(busqueda)) return false;
    // Filtro horario
    if (horario && a.horario !== horario) return false;
    // Filtro sede
    if (sede && a.sede !== sede) return false;
    // Filtro grupo
    if (grupo && a.grupo !== grupo) return false;
    // Filtro estado
    if (estado) {
      if (estado === 'inactivo' && a.is_active !== false) return false;
      if (estado !== 'inactivo' && !a.is_active) return false;
      if (estado === 'al-dia') {
        if (!a.valid_until) return false;
        const f = new Date(a.valid_until); f.setMinutes(f.getMinutes() + f.getTimezoneOffset());
        if (f < hoy) return false;
      }
      if (estado === 'vencido') {
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
          <button class="btn btn-outline" style="font-size:.75rem;padding:.3rem .9rem;border-color:var(--gold);color:var(--gold)" onclick="abrirModalEdicion('${a.id}')">✏️ Editar</button>
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
              <button class="btn btn-outline" style="font-size:.75rem;padding:.3rem .7rem;margin-left:.3rem;border-color:var(--gold);color:var(--gold)" onclick="abrirModalEdicion('${a.id}')">✏️ Editar</button>
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
  const fechaNac = document.getElementById('a-fecha-nacimiento')?.value || null;
  const apoderado = document.getElementById('a-apoderado').value.trim();
  const telefono = document.getElementById('a-telefono').value.trim();
  const sede = document.getElementById('a-sede')?.value || null;
  const grupo = document.getElementById('a-grupo')?.value || null;
  const categoria = document.getElementById('a-categoria')?.value || null;
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
      fecha_nacimiento: fechaNac || null,
      parent_name: apoderado || null,
      parent_phone: telefono || null,
      sede: sede || null,
      grupo: grupo || null,
      categoria: categoria || null,
      horario: document.getElementById('a-horario').value,
      turno: document.getElementById('a-turno')?.value || null,
      pago_mensualidad: pagoMes,
      pago_matricula: pagoMat,
      metodo_pago: metodo
    })
  });

  if (res.ok) {
    document.getElementById('a-nombre').value = '';
    document.getElementById('a-dni').value = '';
    document.getElementById('a-fecha-nacimiento').value = '';
    document.getElementById('a-apoderado').value = '';
    document.getElementById('a-telefono').value = '';
    document.getElementById('a-sede').value = '';
    document.getElementById('a-grupo').value = '';
    document.getElementById('a-categoria').value = '';
    showToast('✅ Alumno inscrito. Cobro registrado.');
    loadAlumnos();
  } else {
    const err = await res.json().catch(() => ({}));
    showToast(`❌ ${err.detail || 'Error. ¿DNI duplicado?'}`, 'error');
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

// ── MODAL EDITAR ALUMNO ────────────────────────────────────
function abrirModalEdicion(student_id) {
  const a = alumnosData.find(x => x.id === student_id);
  if (!a) { showToast('Alumno no encontrado en caché. Recarga la lista.', 'error'); return; }

  // Rellenar campos
  document.getElementById('edit-id').value = a.id;
  document.getElementById('edit-full-name').value = a.full_name || '';
  document.getElementById('edit-dni').value = a.dni || '';
  document.getElementById('edit-fecha-nacimiento').value = a.fecha_nacimiento || '';
  document.getElementById('edit-parent-name').value = a.parent_name || '';
  document.getElementById('edit-parent-phone').value = a.parent_phone || '';
  document.getElementById('edit-sede').value = a.sede || '';
  document.getElementById('edit-turno').value = a.turno || '';
  document.getElementById('edit-horario').value = a.horario || 'LMV';
  document.getElementById('edit-grupo').value = a.grupo || '';
  document.getElementById('edit-categoria').value = a.categoria || '';
  // tarifa_mensual: '' vacío → null (reset a default), número → valor (0 = becado)
  const tarifaRaw = a.tarifa_mensual;
  document.getElementById('edit-tarifa').value = tarifaRaw !== null && tarifaRaw !== undefined ? tarifaRaw : '';
  document.getElementById('edit-codigo-legacy').value = a.codigo_legacy || '';

  document.getElementById('modal-editar-alumno').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function cerrarModalEdicion() {
  document.getElementById('modal-editar-alumno').classList.add('hidden');
  document.body.style.overflow = '';
}

function cerrarModalEdicionOutside(event) {
  // Solo cerrar si el click fue en el overlay (no en el modal-box)
  if (event.target === document.getElementById('modal-editar-alumno')) {
    cerrarModalEdicion();
  }
}

async function guardarEdicionAlumno(event) {
  event.preventDefault();

  const id = document.getElementById('edit-id').value;
  if (!id) return;

  // Recopilar y normalizar campos. Excluir strings vacíos → null para no enviarlos
  const val = (id) => {
    const el = document.getElementById(id);
    return el ? el.value.trim() : null;
  };

  const payload = {};
  const fullName = val('edit-full-name');
  if (fullName) payload.full_name = fullName;

  const dni = val('edit-dni');
  if (dni) payload.dni = dni;

  const fechaNac = val('edit-fecha-nacimiento');
  if (fechaNac) payload.fecha_nacimiento = fechaNac;

  const parentName = val('edit-parent-name');
  if (parentName) payload.parent_name = parentName;

  const parentPhone = val('edit-parent-phone');
  if (parentPhone) payload.parent_phone = parentPhone;

  const sede = val('edit-sede');
  if (sede) payload.sede = sede;

  const turno = document.getElementById('edit-turno').value;
  if (turno) payload.turno = turno;

  const horario = document.getElementById('edit-horario').value;
  if (horario) payload.horario = horario;

  const grupo = val('edit-grupo');
  if (grupo) payload.grupo = grupo;

  const categoria = val('edit-categoria');
  if (categoria) payload.categoria = categoria;

  // tarifa_mensual: siempre incluir en el payload para poder enviar null o 0
  const tarifaInput = document.getElementById('edit-tarifa').value;
  payload.tarifa_mensual = tarifaInput === '' ? null : parseFloat(tarifaInput);

  const codigoLegacy = val('edit-codigo-legacy');
  if (codigoLegacy) payload.codigo_legacy = codigoLegacy;

  if (!Object.keys(payload).length) {
    showToast('No hay cambios para guardar', 'error');
    return;
  }

  try {
    const res = await fetch(`/admin/alumnos/${id}`, {
      method: 'PATCH',
      headers: H,
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      cerrarModalEdicion();
      showToast('✅ Alumno actualizado correctamente');
      loadAlumnos();
    } else {
      const err = await res.json().catch(() => ({}));
      const msg = err.detail || 'Error al actualizar';
      showToast(`❌ ${msg}`, 'error');
    }
  } catch {
    showToast('❌ Error de conexión', 'error');
  }
}

// Cerrar modal con tecla Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const modal = document.getElementById('modal-editar-alumno');
    if (modal && !modal.classList.contains('hidden')) cerrarModalEdicion();
  }
});

// ── CAJA / PAGOS ─────────────────────────────────────────────
let searchDebounce = null;
let chipActivo = 'todos';
let todosPagosData = []; // cache completo de alumnos para Caja

async function loadCreditos() {
  const container = document.getElementById('creditos-result');
  if (!container) return;

  container.innerHTML = '<p style="color:var(--gray);padding:1.5rem;font-family:var(--font-cond);text-align:center">⏳ Cargando alumnos…</p>';

  // Resetear UI
  chipActivo = 'todos';
  document.querySelectorAll('.filtro-chip').forEach(c => c.classList.remove('active'));
  const chipTodos = document.getElementById('chip-todos');
  if (chipTodos) chipTodos.classList.add('active');
  const input = document.getElementById('batidos-nombre-search');
  if (input) input.value = '';
  actualizarBtnClear();

  try {
    const res = await fetch('/admin/alumnos', { headers: H });
    if (res.status === 401) { logout(); return; }
    const data = await res.json();

    const hoy = new Date();
    todosPagosData = data.map(a => {
      let dias_restantes = null;
      if (a.valid_until) {
        const fv = new Date(a.valid_until);
        fv.setMinutes(fv.getMinutes() + fv.getTimezoneOffset());
        dias_restantes = Math.floor((fv - hoy) / (1000 * 60 * 60 * 24));
      }
      return { ...a, dias_restantes };
    });

    aplicarFiltrosPagos();
  } catch {
    container.innerHTML = '<p style="color:var(--red2);font-family:var(--font-cond);padding:1rem">❌ Error al cargar alumnos.</p>';
  }
}

function onSearchInput() {
  clearTimeout(searchDebounce);
  actualizarBtnClear();
  searchDebounce = setTimeout(() => aplicarFiltrosPagos(), 250);
}

function setChip(chip, ev) {
  chipActivo = chip;
  document.querySelectorAll('.filtro-chip').forEach(c => c.classList.remove('active'));
  const chipEl = document.getElementById(`chip-${chip}`);
  if (chipEl) chipEl.classList.add('active');
  aplicarFiltrosPagos();
}

function aplicarFiltrosPagos() {
  const q = (document.getElementById('batidos-nombre-search')?.value || '').toLowerCase().trim();

  let lista = todosPagosData.filter(a => {
    // Búsqueda por nombre
    if (q && !a.full_name.toLowerCase().includes(q)) return false;
    // Filtro por chip
    if (chipActivo === 'lmv') return a.horario === 'LMV';
    if (chipActivo === 'mjs') return a.horario === 'MJS';
    if (chipActivo === 'al-dia') return a.is_active && (a.dias_restantes ?? -1) > 0;
    if (chipActivo === 'vencido') return a.is_active && (a.dias_restantes ?? -1) <= 0;
    return true; // 'todos'
  });

  // Ordenar por urgencia:
  // 1º Activos vencidos (dias <= 0) → más negativos primero
  // 2º Activos próximos a vencer (dias pequeños)
  // 3º Activos con muchos días
  // 4º Inactivos al fondo
  lista.sort((a, b) => {
    const priA = !a.is_active ? 99999 : (a.dias_restantes ?? -9999);
    const priB = !b.is_active ? 99999 : (b.dias_restantes ?? -9999);
    return priA - priB;
  });

  renderListaPagos(lista);
}

function renderListaPagos(lista) {
  const container = document.getElementById('creditos-result');
  if (!lista.length) {
    container.innerHTML = '<div class="empty-search-state"><div class="empty-icon">🔍</div><p>No hay alumnos con ese filtro.</p></div>';
    return;
  }

  container.innerHTML = lista.map(a => {
    const dias = a.dias_restantes;
    const tarifa = a.tarifa_mensual || 80;

    let estadoTexto, estadoColor, borde;
    if (!a.is_active) {
      estadoTexto = 'INACTIVO';
      estadoColor = 'var(--gray2)';
      borde = 'var(--border)';
    } else if (dias === null) {
      estadoTexto = 'SIN PAGO';
      estadoColor = 'var(--gold)';
      borde = 'rgba(212,160,23,.35)';
    } else if (dias <= 0) {
      estadoTexto = `VENCIDO · ${Math.abs(dias)}d`;
      estadoColor = 'var(--red2)';
      borde = 'rgba(255,60,60,.35)';
    } else if (dias <= 7) {
      estadoTexto = `⚠️ ${dias}d restantes`;
      estadoColor = '#ff9800';
      borde = 'rgba(255,152,0,.35)';
    } else {
      estadoTexto = `✅ ${dias}d restantes`;
      estadoColor = '#00ff88';
      borde = 'rgba(0,255,136,.15)';
    }

    const btnCobrar = a.is_active ? `
      <button class="btn btn-gold" style="font-size:.78rem;padding:.35rem 1rem;flex-shrink:0"
        onclick="abrirPagoAlumno('${a.id}', '${a.full_name.replace(/'/g, "\\'")}')">
        💵 Cobrar
      </button>` : '';

    return `
    <div class="apr-row" style="border-color:${borde};opacity:${a.is_active ? '1' : '0.45'}">
      <div class="apr-info">
        <div class="apr-nombre">${a.full_name}</div>
        <div class="apr-meta">
          <span class="badge badge-gold">${a.horario || 'LMV'}</span>
          ${a.sede ? `<span style="font-family:var(--font-mono);font-size:.72rem;color:var(--gray2)">${a.sede}</span>` : ''}
          <span class="apr-estado" style="color:${estadoColor}">${estadoTexto}</span>
        </div>
      </div>
      ${btnCobrar}
    </div>`;
  }).join('');
}

// Abre un mini-panel de pago para el alumno seleccionado
function abrirPagoAlumno(id, nombre) {
  const a = todosPagosData.find(x => x.id === id);
  const creditos = a?.batido_credits ?? 0;

  // ── Lógica de tarifa inteligente ──
  // tarifa_mensual null → default S/80 | 0 → BECADO | número → tarifa real
  const tarifaRaw = a?.tarifa_mensual;
  let tarifa, tarifaLabel, esBecado;
  if (tarifaRaw === 0) {
    tarifa = 0;
    esBecado = true;
    tarifaLabel = `<span style="color:#00ff88;font-weight:700">BECADO (S/ 0.00)</span>`;
  } else if (tarifaRaw == null) {
    tarifa = 80;
    esBecado = false;
    tarifaLabel = `S/ 80.00 / mes <span style="color:var(--gray);font-size:.75rem">(Por defecto)</span>`;
  } else {
    tarifa = tarifaRaw;
    esBecado = false;
    tarifaLabel = `S/ ${tarifa.toFixed(2)} / mes`;
  }

  const overlay = document.createElement('div');
  overlay.id = 'pago-overlay';
  overlay.dataset.tarifa = tarifa;  // guardamos para pagarMensualidad
  overlay.dataset.studentId = id;
  overlay.style.cssText = 'position:fixed;inset:0;z-index:490;background:rgba(0,0,0,.75);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:1rem;overflow-y:auto';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  overlay.innerHTML = `
    <div style="background:#111114;border:1px solid rgba(212,160,23,.25);border-radius:12px;padding:2rem;width:100%;max-width:440px;animation:slideUp .2s ease">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.4rem;padding-bottom:.8rem;border-bottom:1px solid rgba(212,160,23,.15)">
        <div style="font-family:var(--font-display);font-size:1.3rem">💰 <span style="color:var(--gold)">${nombre}</span></div>
        <button onclick="document.getElementById('pago-overlay').remove()"
          style="background:none;border:1px solid var(--border);color:var(--gray);width:32px;height:32px;border-radius:6px;cursor:pointer;font-size:.9rem">✕</button>
      </div>

      <div class="pago-opcion" style="cursor:pointer" onclick="pagarMensualidad('${id}'); document.getElementById('pago-overlay').remove()">
        <div class="pago-opcion-icon">${esBecado ? '🎓' : '💵'}</div>
        <div class="pago-opcion-info">
          <div class="pago-opcion-titulo">Mensualidad</div>
          <div class="pago-opcion-precio">${tarifaLabel}</div>
        </div>
        <button class="btn ${esBecado ? 'btn-outline' : 'btn-gold'} pago-opcion-btn"
          style="${esBecado ? 'border-color:#00ff88;color:#00ff88' : ''}">
          ${esBecado ? 'Renovar Gratis' : 'Cobrar'}
        </button>
      </div>

      <div class="pago-opcion" style="margin-top:.8rem">
        <div class="pago-opcion-icon">🥤</div>
        <div class="pago-opcion-info">
          <div class="pago-opcion-titulo">Créditos Batidos</div>
          <div class="pago-opcion-precio">${creditos} créditos actuales</div>
        </div>
        <div style="display:flex;align-items:center;gap:.5rem;flex-shrink:0">
          <input class="input-jr credit-input" type="number" min="1" max="20" value="4" id="cr-${id}">
          <button class="btn btn-outline pago-opcion-btn" style="border-color:var(--gold);color:var(--gold)"
            onclick="recargar('${id}')">+ Recargar</button>
        </div>
      </div>

      <!-- Historial de pagos -->
      <div id="historial-pagos-wrap" style="margin-top:1.2rem;border-top:1px solid rgba(255,255,255,.06);padding-top:1rem">
        <div style="font-family:var(--font-cond);font-size:.72rem;letter-spacing:.2em;color:var(--gold);margin-bottom:.6rem">// HISTORIAL DE PAGOS</div>
        <p style="color:var(--gray);font-family:var(--font-cond);font-size:.85rem">Cargando...</p>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  loadHistorialPagos(id);
}

function actualizarBtnClear() {
  const val = document.getElementById('batidos-nombre-search')?.value || '';
  const btn = document.getElementById('btn-clear-search');
  if (btn) btn.style.display = val ? 'flex' : 'none';
}

function limpiarBusqueda() {
  const input = document.getElementById('batidos-nombre-search');
  if (input) input.value = '';
  actualizarBtnClear();
  aplicarFiltrosPagos();
}

// Mantener para compatibilidad (Caja > búsqueda dropdown ELIMINADO, ahora filtro en tabla)
function cerrarDropdown() {
  const d = document.getElementById('search-dropdown');
  if (d) { d.innerHTML = ''; d.classList.remove('visible'); }
}

async function loadHistorialPagos(student_id) {
  const wrap = document.getElementById('historial-pagos-wrap');
  if (!wrap) return;
  try {
    const res = await fetch(`/admin/mensualidades/${student_id}`, { headers: H });
    if (!res.ok) throw new Error();
    const data = await res.json();
    if (!data.length) {
      wrap.innerHTML = `
        <div style="font-family:var(--font-cond);font-size:.72rem;letter-spacing:.2em;color:var(--gold);margin-bottom:.6rem">// HISTORIAL DE PAGOS</div>
        <p style="color:var(--gray);font-family:var(--font-cond);font-size:.85rem">No hay pagos registrados.</p>`;
      return;
    }
    wrap.innerHTML = `
      <div style="font-family:var(--font-cond);font-size:.72rem;letter-spacing:.2em;color:var(--gold);margin-bottom:.6rem">// HISTORIAL DE PAGOS</div>
      <div style="display:flex;flex-direction:column;gap:.3rem">
        ${data.map(p => {
      const fecha = p.fecha_pago
        ? new Date(p.fecha_pago).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' })
        : '—';
      const monto = (p.monto ?? 0) === 0
        ? '<span style="color:#00ff88">BECADO</span>'
        : `<span style="color:var(--white);font-weight:700">S/ ${Number(p.monto).toFixed(2)}</span>`;
      const metodo = p.metodo_pago || '—';
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:.35rem 0;border-bottom:1px solid rgba(255,255,255,.05);font-family:var(--font-cond);font-size:.82rem">
            <span style="color:var(--gray)">${fecha}</span>
            ${monto}
            <span style="color:var(--gray2);font-size:.76rem">${metodo}</span>
          </div>`;
    }).join('')}
      </div>`;
  } catch {
    wrap.innerHTML = `
      <div style="font-family:var(--font-cond);font-size:.72rem;letter-spacing:.2em;color:var(--gold);margin-bottom:.6rem">// HISTORIAL DE PAGOS</div>
      <p style="color:var(--gray);font-family:var(--font-cond);font-size:.85rem">Error al cargar historial.</p>`;
  }
}

async function pagarMensualidad(id) {
  // Leer tarifa dinámica del overlay (dataset guardado en abrirPagoAlumno)
  const overlay = document.getElementById('pago-overlay');
  const tarifa = parseFloat(overlay?.dataset?.tarifa ?? 80);
  const esBecado = tarifa === 0;

  const msgConfirm = esBecado
    ? `¿Renovar 1 mes GRATIS (BECADO) a este alumno?`
    : `¿Confirmar el cobro de S/ ${tarifa.toFixed(2)} por 1 mes de entrenamiento?`;

  const confirmacion = confirm(msgConfirm);
  if (!confirmacion) return;

  let metodo = 'Becado';
  if (!esBecado) {
    metodo = prompt('¿Cómo pagó? (Efectivo, Yape o Plin):', 'Efectivo');
    if (metodo === null) return;
    metodo = metodo.trim() || 'Efectivo';
  }

  const res = await fetch('/admin/mensualidades/pagar', {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ student_id: id, monto: tarifa, metodo })
  });

  if (res.ok) {
    const d = await res.json();
    showToast(esBecado
      ? `🎓 Mes renovado gratis. Vence: ${d.nueva_fecha_vencimiento}`
      : `✅ S/${tarifa.toFixed(2)} registrados. Vence: ${d.nueva_fecha_vencimiento}`);
    loadCreditos();
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
    document.getElementById('pago-overlay')?.remove();
    loadCreditos();
  } else {
    showToast('❌ Error al recargar', 'error');
  }
}

// Cerrar dropdown al click fuera
document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-autocomplete-wrap')) cerrarDropdown();
});



// ── INIT ──────────────────────────────────────────────
loadStats();

// ── ASISTENCIA GLOBAL (CALENDARIO MAESTRO) ────────────
const CAL_MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const CAL_DIAS = ['Do', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa'];
const CAL_SCHEDULE = { 'LMV': [1, 3, 5], 'MJS': [2, 4, 6] };

let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth();
let _calStudents = [];
let _calAttMap = {};

function updateCalLabel() {
  const el = document.getElementById('cal-month-label');
  if (el) el.textContent = `${CAL_MESES[calMonth]} ${calYear}`;
}

function calChangeMonth(delta) {
  calMonth += delta;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  if (calMonth < 0) { calMonth = 11; calYear--; }
  loadCalendario();
}

async function loadCalendario() {
  const loading = document.getElementById('cal-loading');
  const container = document.getElementById('cal-table-container');
  if (!loading || !container) return;

  loading.style.display = 'flex';
  container.innerHTML = '';
  updateCalLabel();

  try {
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const mm = String(calMonth + 1).padStart(2, '0');
    const dd = String(daysInMonth).padStart(2, '0');
    const first = `${calYear}-${mm}-01T00:00:00`;
    const last = `${calYear}-${mm}-${dd}T23:59:59`;
    const ts = Date.now();

    const [studRes, rangeRes] = await Promise.all([
      fetch(`/admin/students?_=${ts}`, { headers: H }),
      fetch(`/admin/attendance/range?start=${first}&end=${last}&_=${ts}`, { headers: H })
    ]);

    if (studRes.status === 401 || rangeRes.status === 401) { logout(); return; }
    if (!studRes.ok) throw new Error(`Error alumnos: ${studRes.status}`);
    if (!rangeRes.ok) throw new Error(`Error asistencia: ${rangeRes.status}`);

    _calStudents = await studRes.json();
    const attData = await rangeRes.json();

    // Mapear student_id + fecha → true
    _calAttMap = {};
    attData.forEach(r => {
      if (r.student_id && r.created_at) {
        const fecha = r.created_at.substring(0, 10);
        _calAttMap[`${r.student_id}_${fecha}`] = true;
      }
    });

    // Filtro de sede dinámico
    const sedeSelect = document.getElementById('cal-filter-sede');
    const sedes = [...new Set(_calStudents.map(s => s.sede).filter(Boolean))];
    sedeSelect.innerHTML = '<option value="">Todas las sedes</option>';
    sedes.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s; opt.textContent = s;
      sedeSelect.appendChild(opt);
    });

    renderCalendario();

    const lu = document.getElementById('cal-last-update');
    if (lu) lu.textContent = `Actualizado: ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

  } catch (e) {
    loading.innerHTML = `<span style="color:var(--red2);font-family:var(--font-cond)">❌ ${e.message}</span>`;
    return;
  }

  loading.style.display = 'none';
}

function renderCalendario() {
  const turnoFilter = document.getElementById('cal-filter-turno')?.value || '';
  const sedeFilter = document.getElementById('cal-filter-sede')?.value || '';
  const searchFilter = (document.getElementById('cal-search')?.value || '').toLowerCase();

  const students = _calStudents.filter(s => {
    const matchSearch = (s.full_name || '').toLowerCase().includes(searchFilter);
    const matchTurno = !turnoFilter || (s.turno || '') === turnoFilter;
    const matchSede = !sedeFilter || (s.sede || '') === sedeFilter;
    return matchSearch && matchTurno && matchSede;
  });

  const today = new Date();
  const isCurrentMonth = today.getMonth() === calMonth && today.getFullYear() === calYear;
  const todayDay = today.getDate();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const mm = String(calMonth + 1).padStart(2, '0');
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const days = [];
  for (let d = 1; d <= daysInMonth; d++) {
    days.push({ day: d, dow: new Date(calYear, calMonth, d).getDay() });
  }

  // Stats globales
  let totalPresencias = 0, totalEsperadas = 0, presentHoy = 0;
  students.forEach(s => {
    const schedule = CAL_SCHEDULE[s.horario] || null;
    days.forEach(({ day, dow }) => {
      if (dow === 0) return;
      const dateStr = `${calYear}-${mm}-${String(day).padStart(2, '0')}`;
      if (new Date(calYear, calMonth, day) > today) return;
      if (schedule && !schedule.includes(dow)) return;
      if (dow === 6 && (!schedule || !schedule.includes(6))) return;
      totalEsperadas++;
      if (_calAttMap[`${s.id}_${dateStr}`]) {
        totalPresencias++;
        if (dateStr === todayStr) presentHoy++;
      }
    });
  });

  const elTotal = document.getElementById('cal-total');
  const elPresent = document.getElementById('cal-present');
  const elAbsent = document.getElementById('cal-absent');
  const elPct = document.getElementById('cal-pct');
  if (elTotal) elTotal.textContent = students.length;
  if (elPresent) elPresent.textContent = presentHoy;
  if (elAbsent) elAbsent.textContent = Math.max(0, students.length - presentHoy);
  if (elPct) elPct.textContent = totalEsperadas > 0
    ? `${Math.round((totalPresencias / totalEsperadas) * 100)}%` : '—';

  const container = document.getElementById('cal-table-container');
  if (!container) return;

  if (!students.length) {
    container.innerHTML = `<div class="empty-state"><div class="big">—</div><p>No se encontraron alumnos</p></div>`;
    return;
  }

  let html = `<table class="attendance-table"><thead><tr>
    <th style="min-width:160px">Alumno</th>`;

  days.forEach(({ day, dow }) => {
    const isToday = isCurrentMonth && day === todayDay;
    const isWeekend = dow === 0 || dow === 6;
    const cls = isToday ? 'day-col today-h' : isWeekend ? 'day-col weekend-h' : 'day-col';
    html += `<th class="${cls}">${CAL_DIAS[dow]}<br>${day}</th>`;
  });
  html += `<th style="min-width:52px;border-left:1px solid var(--border);text-align:center">%</th>
    </tr></thead><tbody>`;

  students.forEach(s => {
    const schedule = CAL_SCHEDULE[s.horario] || null;
    let presentCount = 0, workdayCount = 0;
    const horarioBadge = s.horario
      ? `<span style="font-size:.65rem;font-family:var(--font-cond);letter-spacing:.1em;color:var(--gold);margin-left:.4rem">${s.horario}</span>`
      : '';

    html += `<tr>
      <td>
        <div class="student-name">${s.full_name}${horarioBadge}</div>
        ${s.sede ? `<div class="student-sede">${s.sede}</div>` : ''}
      </td>`;

    days.forEach(({ day, dow }) => {
      const isToday = isCurrentMonth && day === todayDay;
      const dateStr = `${calYear}-${mm}-${String(day).padStart(2, '0')}`;
      const isFuture = new Date(calYear, calMonth, day) > today;
      const isPresent = _calAttMap[`${s.id}_${dateStr}`];
      const todayCls = isToday ? ' day-today' : '';
      const isDomingo = dow === 0;
      const isSabado = dow === 6;
      const esDiaAlumno = schedule
        ? schedule.includes(dow)
        : (!isDomingo && !isSabado);

      if (isDomingo || (isSabado && (!schedule || !schedule.includes(6)))) {
        html += `<td><div class="day-cell day-weekend">—</div></td>`;
      } else if (!esDiaAlumno) {
        html += `<td><div class="day-cell day-weekend" style="opacity:.3">·</div></td>`;
      } else if (isFuture) {
        html += `<td><div class="day-cell day-future">·</div></td>`;
      } else {
        workdayCount++;
        if (isPresent) {
          presentCount++;
          html += `<td><div class="day-cell day-present${todayCls}" title="${dateStr}">✓</div></td>`;
        } else {
          html += `<td><div class="day-cell day-absent${todayCls}" title="${dateStr}">✗</div></td>`;
        }
      }
    });

    const pct = workdayCount > 0 ? Math.round((presentCount / workdayCount) * 100) : 0;
    const pctClass = pct >= 80 ? 'pct-high' : pct >= 50 ? 'pct-mid' : 'pct-low';
    html += `<td style="text-align:center"><span class="pct-cell ${pctClass}">${pct}%</span></td></tr>`;
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

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
